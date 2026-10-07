import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { OtpProvider } from "../../shared/otp-provider";
import type { StorageProvider } from "../../shared/storage-provider";
import type {
  DoctorAccount,
  DoctorApplication,
  DoctorCredentialRecord,
  DoctorVerificationStatus,
  SpecialtySummary,
} from "./domain";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";
process.env.JWT_SECRET ??= "doctor-auth-test-secret";

const { createDoctorsService } = await import("./service");
const { doctorsRepository } = await import("./repository");
const { prisma } = await import("../../shared/prisma-client");
const { signAuthToken, verifyAuthToken, verifyDoctorRegistrationToken } = await import("../../shared/auth-context");
const { LocalDiskStorageProvider } = await import("../../shared/storage-provider");
const { storageProvider } = await import("../../shared/storage-provider");
const { POST: startRegistrationPost } = await import("../../app/api/doctors/register/start/route");
const { POST: verifyRegistrationPost } = await import("../../app/api/doctors/register/verify/route");
const { POST: submitApplicationPost } = await import("../../app/api/doctors/register/submit/route");
const { GET: getPayoutProfile, PATCH: patchPayoutProfile } = await import("../../app/api/doctors/profile/upi/route");
const { parseDoctorApplicationRequest } = await import("./routes");

const DEFAULT_SPECIALTIES: SpecialtySummary[] = [
  { id: "specialty-cardiology", name: "Cardiology" },
  { id: "specialty-neurology", name: "Neurology" },
];

test("verification status repository update is conditional on Pending state", async () => {
  const doctorDelegate = prisma.doctor as unknown as {
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  const originalUpdateMany = doctorDelegate.updateMany;
  const doctorId = randomUUID();
  let updateArgs: unknown;
  doctorDelegate.updateMany = async (args) => {
    updateArgs = args;
    return { count: 0 };
  };

  try {
    assert.equal(await doctorsRepository.updatePendingVerificationStatus(doctorId, "Verified"), null);
    assert.deepEqual(updateArgs, {
      where: { id: doctorId, verificationStatus: "Pending" },
      data: { verificationStatus: "Verified" },
    });
  } finally {
    doctorDelegate.updateMany = originalUpdateMany;
  }
});

function createFixture(options: {
  specialties?: SpecialtySummary[];
  expiresAt?: Date;
  validCode?: string;
} = {}) {
  const applications = new Map<string, DoctorApplication>();
  const storedFiles = new Map<string, Uint8Array>();
  const specialties = options.specialties ?? DEFAULT_SPECIALTIES;
  const expiration = options.expiresAt ?? new Date(Date.now() + 60_000);
  let otpCount = 0;
  let verifyCount = 0;

  const repository = {
    async findByMobileNumber(mobileNumber: string): Promise<DoctorAccount | null> {
      return [...applications.values()].find((doctor) => doctor.mobileNumber === mobileNumber) ?? null;
    },
    async findByUsername(username: string): Promise<DoctorAccount | null> {
      return [...applications.values()].find((doctor) => doctor.username === username) ?? null;
    },
    async findById(doctorId: string): Promise<DoctorAccount | null> {
      return [...applications.values()].find((doctor) => doctor.id === doctorId) ?? null;
    },
    async findPayoutProfile(doctorId: string): Promise<{ upiId: string | null } | null> {
      const doctor = applications.get(doctorId);
      return doctor ? { upiId: doctor.upiId } : null;
    },
    async updateUpiId(doctorId: string, upiId: string): Promise<{ upiId: string | null } | null> {
      const doctor = applications.get(doctorId);
      if (!doctor) return null;
      applications.set(doctorId, { ...doctor, upiId, updatedAt: new Date() });
      return { upiId };
    },
    async findActiveSpecialties(ids: string[]): Promise<SpecialtySummary[]> {
      return specialties.filter((specialty) => ids.includes(specialty.id));
    },
    async listActiveSpecialties(): Promise<SpecialtySummary[]> {
      return specialties;
    },
    async createApplication(input: {
      mobileNumber: string;
      fullName: string;
      username: string;
      passwordHash: string;
      upiId: string | null;
      specialtyIds: string[];
      credentials: Omit<DoctorCredentialRecord, "id" | "doctorId" | "createdAt">[];
    }): Promise<DoctorApplication> {
      const id = randomUUID();
      const now = new Date();
      const application: DoctorApplication = {
        id,
        mobileNumber: input.mobileNumber,
        fullName: input.fullName,
        username: input.username,
        passwordHash: input.passwordHash,
        upiId: input.upiId,
        verificationStatus: "Pending" satisfies DoctorVerificationStatus,
        createdAt: now,
        updatedAt: now,
        specialties: specialties.filter(({ id: specialtyId }) => input.specialtyIds.includes(specialtyId)),
        credentials: input.credentials.map((credential) => ({
          ...credential,
          id: randomUUID(),
          doctorId: id,
          createdAt: now,
        })),
      };
      applications.set(id, application);
      return application;
    },
    async findCredentialById(credentialId: string): Promise<DoctorCredentialRecord | null> {
      return [...applications.values()].flatMap(({ credentials }) => credentials)
        .find(({ id }) => id === credentialId) ?? null;
    },
    async listPendingApplications(): Promise<DoctorApplication[]> {
      return [...applications.values()].filter(({ verificationStatus }) => verificationStatus === "Pending");
    },
    async updatePendingVerificationStatus(
      doctorId: string,
      verificationStatus: Exclude<DoctorVerificationStatus, "Pending">,
    ): Promise<DoctorApplication | null> {
      const application = applications.get(doctorId);
      if (!application || application.verificationStatus !== "Pending") return null;
      const updated = { ...application, verificationStatus, updatedAt: new Date() };
      applications.set(doctorId, updated);
      return updated;
    },
  };

  const provider: OtpProvider = {
    async sendOtp() {
      otpCount += 1;
      return { otpId: `otp-${otpCount}`, expiresAt: expiration };
    },
    async verifyOtp(_otpId, code) {
      verifyCount += 1;
      return expiration.getTime() > Date.now() && code === (options.validCode ?? "123456");
    },
  };
  const storage: StorageProvider = {
    async save(bytes) {
      const storageKey = randomUUID();
      storedFiles.set(storageKey, Uint8Array.from(bytes));
      return { storageKey };
    },
    async read(storageKey) {
      const bytes = storedFiles.get(storageKey);
      return bytes ? Uint8Array.from(bytes) : null;
    },
    async delete(storageKey) {
      storedFiles.delete(storageKey);
    },
  };

  return {
    applications,
    storedFiles,
    service: createDoctorsService(repository, provider, storage),
    get otpCount() { return otpCount; },
    get verifyCount() { return verifyCount; },
  };
}

let mobileSequence = 1;

function uniqueMobileNumber(): string {
  mobileSequence += 1;
  return `+1555${String(mobileSequence).padStart(7, "0")}`;
}

async function authorizeApplicant(fixture: ReturnType<typeof createFixture>, mobileNumber = uniqueMobileNumber()) {
  const challenge = await fixture.service.startRegistration(mobileNumber);
  const verification = await fixture.service.verifyRegistration(mobileNumber, challenge.otpId, "123456");
  return { mobileNumber, registrationToken: verification.registrationToken };
}

function validInput() {
  return {
    fullName: "Dr. Asha Mehta",
    username: "Asha_Mehta1",
    password: "StrongPass1",
    specialtyIds: [DEFAULT_SPECIALTIES[0].id, DEFAULT_SPECIALTIES[1].id],
    credentials: [{
      fileName: "degree.pdf",
      contentType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.7 credential"),
    }],
  };
}

test("OTP registration issues an application token only for the verified mobile", async () => {
  const fixture = createFixture();
  const mobileNumber = uniqueMobileNumber();
  const challenge = await fixture.service.startRegistration(mobileNumber);

  await assert.rejects(
    fixture.service.verifyRegistration(`${mobileNumber}1`, challenge.otpId, "123456"),
    { code: "OTP_VERIFICATION_FAILED" },
  );
  const verified = await fixture.service.verifyRegistration(mobileNumber, challenge.otpId, "123456");
  assert.deepEqual(verifyDoctorRegistrationToken(verified.registrationToken), { mobileNumber: mobileNumber.slice(1) });
  assert.equal(verified.expiresInSeconds, 900);
  assert.equal(fixture.applications.size, 0);
});

test("rejects duplicate OTP requests with the same generic start error as rate limiting", async () => {
  const fixture = createFixture();
  const applicant = await authorizeApplicant(fixture);
  await fixture.service.submitApplication(applicant.registrationToken, validInput());

  await assert.rejects(fixture.service.startRegistration(applicant.mobileNumber), {
    code: "DOCTOR_REGISTRATION_UNAVAILABLE",
  });
});

test("rejects expired or incorrect OTPs without authorizing an application", async () => {
  const expiredFixture = createFixture({ expiresAt: new Date(Date.now() - 1) });
  const expiredMobile = uniqueMobileNumber();
  const expiredOtp = await expiredFixture.service.startRegistration(expiredMobile);
  await assert.rejects(
    expiredFixture.service.verifyRegistration(expiredMobile, expiredOtp.otpId, "123456"),
    { code: "OTP_EXPIRED" },
  );
  assert.equal(expiredFixture.verifyCount, 0);

  const invalidFixture = createFixture();
  const invalidMobile = uniqueMobileNumber();
  const invalidOtp = await invalidFixture.service.startRegistration(invalidMobile);
  await assert.rejects(
    invalidFixture.service.verifyRegistration(invalidMobile, invalidOtp.otpId, "000000"),
    { code: "OTP_VERIFICATION_FAILED" },
  );
  assert.equal(invalidFixture.applications.size, 0);
});

test("locks an OTP challenge after five incorrect verification attempts", async () => {
  const fixture = createFixture();
  const mobileNumber = uniqueMobileNumber();
  const challenge = await fixture.service.startRegistration(mobileNumber);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      fixture.service.verifyRegistration(mobileNumber, challenge.otpId, "000000"),
      { code: "OTP_VERIFICATION_FAILED" },
    );
  }
  await assert.rejects(
    fixture.service.verifyRegistration(mobileNumber, challenge.otpId, "123456"),
    { code: "OTP_VERIFICATION_FAILED" },
  );
  assert.equal(fixture.verifyCount, 5);
});

test("returns the same registration-start error for existing accounts and rate-limited requests", async () => {
  const existingFixture = createFixture();
  const existing = await authorizeApplicant(existingFixture);
  await existingFixture.service.submitApplication(existing.registrationToken, validInput());
  await assert.rejects(existingFixture.service.startRegistration(existing.mobileNumber), {
    code: "DOCTOR_REGISTRATION_UNAVAILABLE",
  });

  const rateLimitedFixture = createFixture();
  const rateLimitedMobile = uniqueMobileNumber();
  await rateLimitedFixture.service.startRegistration(rateLimitedMobile);
  await rateLimitedFixture.service.startRegistration(rateLimitedMobile);
  await rateLimitedFixture.service.startRegistration(rateLimitedMobile);
  await assert.rejects(rateLimitedFixture.service.startRegistration(rateLimitedMobile), {
    code: "DOCTOR_REGISTRATION_UNAVAILABLE",
  });
});

test("rejects multipart bodies above the total request size limit before parsing", async () => {
  const oversizedRequest = {
    method: "POST",
    url: "http://localhost/api/doctors/register/submit",
    headers: new Headers({ "content-length": String(51 * 1024 * 1024 + 1) }),
  } as Request;
  await assert.rejects(parseDoctorApplicationRequest(oversizedRequest), { code: "VALIDATION_ERROR" });
});

test("stores a valid application as Pending and returns no storage key", async () => {
  const fixture = createFixture();
  const applicant = await authorizeApplicant(fixture);
  const result = await fixture.service.submitApplication(applicant.registrationToken, validInput());
  const stored = [...fixture.applications.values()][0];

  assert.equal(result.verificationStatus, "Pending");
  assert.equal(stored.mobileNumber, applicant.mobileNumber.slice(1));
  assert.equal(stored.username, "asha_mehta1");
  assert.ok(stored.passwordHash.startsWith("$argon2id$"));
  assert.deepEqual(stored.specialties.map(({ id }) => id), [
    DEFAULT_SPECIALTIES[0].id,
    DEFAULT_SPECIALTIES[1].id,
  ]);
  assert.equal(fixture.storedFiles.size, 1);
  assert.equal("storageKey" in result.credentials[0], false);
  assert.equal("path" in result.credentials[0], false);
  assert.equal(await fixture.service.getVerifiedDoctor(result.doctorId), null);

  const pendingDoctor = fixture.applications.get(result.doctorId);
  assert.ok(pendingDoctor);
  fixture.applications.set(result.doctorId, { ...pendingDoctor, verificationStatus: "Verified" });
  const verifiedDoctor = await fixture.service.getVerifiedDoctor(result.doctorId);
  assert.equal(verifiedDoctor?.verificationStatus, "Verified");
  assert.equal("passwordHash" in (verifiedDoctor ?? {}), false);
});

test("invalid application data creates no Doctor and leaves no stored files", async (context) => {
  const invalidCases = [
    { name: "missing credentials", update: (input: ReturnType<typeof validInput>) => ({ ...input, credentials: [] }) },
    { name: "missing specialties", update: (input: ReturnType<typeof validInput>) => ({ ...input, specialtyIds: [] }) },
    { name: "inactive or unknown specialty", update: (input: ReturnType<typeof validInput>) => ({ ...input, specialtyIds: ["unknown-specialty"] }) },
    { name: "unsupported upload", update: (input: ReturnType<typeof validInput>) => ({
      ...input,
      credentials: [{ fileName: "credential.gif", contentType: "image/gif", bytes: new Uint8Array([1, 2, 3]) }],
    }) },
    { name: "more than five credentials", update: (input: ReturnType<typeof validInput>) => ({
      ...input,
      credentials: Array.from({ length: 6 }, (_, index) => ({
        ...input.credentials[0],
        fileName: `degree-${index}.pdf`,
      })),
    }) },
    { name: "credential larger than 10 MiB", update: (input: ReturnType<typeof validInput>) => {
      const bytes = new Uint8Array(10 * 1024 * 1024 + 1);
      bytes.set(new TextEncoder().encode("%PDF-"));
      return { ...input, credentials: [{ ...input.credentials[0], bytes }] };
    } },
    { name: "content does not match MIME type", update: (input: ReturnType<typeof validInput>) => ({
      ...input,
      credentials: [{ fileName: "credential.pdf", contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }],
    }) },
    { name: "missing professional name", update: (input: ReturnType<typeof validInput>) => ({ ...input, fullName: " " }) },
    { name: "invalid username", update: (input: ReturnType<typeof validInput>) => ({ ...input, username: "bad-name" }) },
    {
      name: "invalid password",
      code: "PASSWORD_POLICY_ERROR",
      update: (input: ReturnType<typeof validInput>) => ({ ...input, password: "weakpass" }),
    },
  ];

  for (const invalidCase of invalidCases) {
    await context.test(invalidCase.name, async () => {
      const fixture = createFixture({ specialties: [DEFAULT_SPECIALTIES[0]] });
      const applicant = await authorizeApplicant(fixture);
      await assert.rejects(
        fixture.service.submitApplication(applicant.registrationToken, invalidCase.update(validInput())),
        { code: "code" in invalidCase ? invalidCase.code : "VALIDATION_ERROR" },
      );
      assert.equal(fixture.applications.size, 0);
      assert.equal(fixture.storedFiles.size, 0);
    });
  }
});

test("credential reads are limited to the owning Doctor and Admin", async () => {
  const fixture = createFixture();
  const applicant = await authorizeApplicant(fixture);
  const application = await fixture.service.submitApplication(applicant.registrationToken, validInput());
  const stored = [...fixture.applications.values()][0];
  const credential = stored.credentials[0];

  const ownerRead = await fixture.service.getCredential(credential.id, { userId: application.doctorId, role: "doctor" });
  assert.equal(new TextDecoder().decode(ownerRead.bytes), "%PDF-1.7 credential");
  const adminRead = await fixture.service.getCredential(credential.id, { userId: randomUUID(), role: "admin" });
  assert.equal(new TextDecoder().decode(adminRead.bytes), "%PDF-1.7 credential");
  await assert.rejects(
    fixture.service.getCredential(credential.id, { userId: randomUUID(), role: "doctor" }),
    { code: "CREDENTIAL_ACCESS_DENIED" },
  );
  await assert.rejects(
    fixture.service.getCredential(credential.id, { userId: randomUUID(), role: "patient" }),
    { code: "CREDENTIAL_ACCESS_DENIED" },
  );
  await assert.rejects(
    fixture.service.getCredential(randomUUID(), { userId: application.doctorId, role: "doctor" }),
    { code: "CREDENTIAL_NOT_FOUND" },
  );
});

test("Doctor login returns a Doctor-role session for a pending application", async () => {
  const fixture = createFixture();
  const applicant = await authorizeApplicant(fixture);
  const application = await fixture.service.submitApplication(applicant.registrationToken, validInput());
  const login = await fixture.service.login("ASHA_MEHTA1", "StrongPass1");

  assert.equal(login.doctorId, application.doctorId);
  assert.equal(login.verificationStatus, "Pending");
  assert.deepEqual(verifyAuthToken(login.token), { userId: application.doctorId, role: "doctor" });
  await assert.rejects(fixture.service.login("asha_mehta1", "WrongPass2"), { code: "INVALID_CREDENTIALS" });
});

test("credential upload metadata stays private and local storage rejects unsafe keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "secopinion-credentials-"));
  try {
    const storage = new LocalDiskStorageProvider(root);
    const bytes = new TextEncoder().encode("private credential bytes");
    const { storageKey } = await storage.save(bytes);
    assert.match(storageKey, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(await readFile(join(root, storageKey)), Buffer.from(bytes));
    assert.deepEqual(Uint8Array.from(await storage.read(storageKey) ?? []), bytes);
    await assert.rejects(storage.read("../../outside"), /Invalid storage key/);
    await storage.delete(storageKey);
    assert.equal(await storage.read(storageKey), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Doctor OTP routes issue an HttpOnly application authorization cookie", async () => {
  const originalFindByMobileNumber = doctorsRepository.findByMobileNumber;
  doctorsRepository.findByMobileNumber = async () => null;
  const mobileNumber = uniqueMobileNumber();
  const postJson = (body: unknown) => new Request("http://localhost/api/doctors/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  try {
    const startResponse = await startRegistrationPost(postJson({ mobileNumber }));
    assert.equal(startResponse.status, 200);
    const startBody = await startResponse.json() as { data: { otpId: string }; error: null };
    assert.equal(startBody.error, null);
    const verifyResponse = await verifyRegistrationPost(postJson({
      mobileNumber,
      otpId: startBody.data.otpId,
      code: "123456",
    }));
    assert.equal(verifyResponse.status, 200);
    assert.match(verifyResponse.headers.get("set-cookie") ?? "", /doctor_registration=/);
    assert.match(verifyResponse.headers.get("set-cookie") ?? "", /HttpOnly/i);
  } finally {
    doctorsRepository.findByMobileNumber = originalFindByMobileNumber;
  }
});

test("Doctor submission route creates a Doctor session and does not return storage keys", async () => {
  const originalMethods = {
    findByMobileNumber: doctorsRepository.findByMobileNumber,
    findByUsername: doctorsRepository.findByUsername,
    findActiveSpecialties: doctorsRepository.findActiveSpecialties,
    createApplication: doctorsRepository.createApplication,
    findPayoutProfile: doctorsRepository.findPayoutProfile,
    updateUpiId: doctorsRepository.updateUpiId,
  };
  const originalStorageSave = storageProvider.save;
  const mobileNumber = uniqueMobileNumber();
  const doctorId = randomUUID();
  let submittedUpiId: string | null = null;
  doctorsRepository.findByMobileNumber = async () => null;
  doctorsRepository.findByUsername = async () => null;
  doctorsRepository.findActiveSpecialties = async (specialtyIds) => (
    DEFAULT_SPECIALTIES.filter(({ id }) => specialtyIds.includes(id))
  );
  storageProvider.save = async () => ({ storageKey: randomUUID() });
  doctorsRepository.createApplication = async (input) => {
    submittedUpiId = input.upiId;
    const now = new Date();
    return {
      id: doctorId,
      mobileNumber,
      fullName: input.fullName,
      username: input.username,
      passwordHash: input.passwordHash,
      upiId: input.upiId,
      verificationStatus: "Pending",
      createdAt: now,
      updatedAt: now,
      specialties: DEFAULT_SPECIALTIES.filter(({ id }) => input.specialtyIds.includes(id)),
      credentials: input.credentials.map((credential) => ({
        ...credential,
        id: randomUUID(),
        doctorId,
        createdAt: now,
      })),
    };
  };

  try {
    const unauthenticatedOversized = await submitApplicationPost(new Request(
      "http://localhost/api/doctors/register/submit",
      {
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=missing",
          "content-length": String(51 * 1024 * 1024 + 1),
        },
      },
    ));
    assert.equal(unauthenticatedOversized.status, 401);

    const startResponse = await startRegistrationPost(new Request("http://localhost/api/doctors/register/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobileNumber }),
    }));
    const startBody = await startResponse.json() as { data: { otpId: string }; error: null };
    const verifyResponse = await verifyRegistrationPost(new Request("http://localhost/api/doctors/register/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobileNumber, otpId: startBody.data.otpId, code: "123456" }),
    }));
    const registrationCookie = (verifyResponse.headers.get("set-cookie") ?? "").split(";")[0];
    const form = new FormData();
    form.set("fullName", "Dr. Route Doctor");
    form.set("username", "route_doctor");
    form.set("password", "StrongPass1");
    form.set("upiId", "route@okaxis");
    form.append("specialtyIds", DEFAULT_SPECIALTIES[0].id);
    form.append("credentials", new File(["%PDF-1.7 credential"], "degree.pdf", { type: "application/pdf" }));

    const submitResponse = await submitApplicationPost(new Request("http://localhost/api/doctors/register/submit", {
      method: "POST",
      headers: { cookie: registrationCookie },
      body: form,
    }));
    assert.equal(submitResponse.status, 201);
    const submitCookie = submitResponse.headers.get("set-cookie") ?? "";
    assert.match(submitCookie, /doctor_session=/);
    assert.match(submitCookie, /HttpOnly/i);
    const body = await submitResponse.json() as {
      data: { doctorId: string; verificationStatus: string; credentials: Record<string, unknown>[] };
      error: null;
    };
    assert.equal(body.data.doctorId, doctorId);
    assert.equal(body.data.verificationStatus, "Pending");
    assert.equal("storageKey" in body.data.credentials[0], false);
    assert.equal(submittedUpiId, "route@okaxis");

    const malformedForm = new FormData();
    malformedForm.set("fullName", "Dr. Route Doctor");
    malformedForm.set("username", "route_doctor");
    malformedForm.set("password", "StrongPass1");
    malformedForm.set("upiId", " ");
    malformedForm.append("specialtyIds", DEFAULT_SPECIALTIES[0].id);
    malformedForm.append("credentials", new File(["%PDF-1.7 credential"], "degree.pdf", { type: "application/pdf" }));
    const malformedResponse = await submitApplicationPost(new Request("http://localhost/api/doctors/register/submit", {
      method: "POST",
      headers: { cookie: registrationCookie },
      body: malformedForm,
    }));
    assert.equal(malformedResponse.status, 400);
    assert.equal((await malformedResponse.json() as { error: { code: string } }).error.code, "INVALID_UPI_ID");
    assert.equal(submittedUpiId, "route@okaxis");
  } finally {
    Object.assign(doctorsRepository, originalMethods);
    storageProvider.save = originalStorageSave;
  }
});

test("registration accepts an optional UPI ID and stores valid values", async () => {
  const fixture = createFixture();
  const applicant = await authorizeApplicant(fixture);
  const withoutUpiId = await fixture.service.submitApplication(applicant.registrationToken, validInput());
  assert.equal(fixture.applications.get(withoutUpiId.doctorId)?.upiId, null);

  const secondApplicant = await authorizeApplicant(fixture);
  const withUpiId = await fixture.service.submitApplication(secondApplicant.registrationToken, {
    ...validInput(),
    username: "Asha_Mehta2",
    upiId: "asha.mehta-1@okaxis",
  });
  assert.equal(fixture.applications.get(withUpiId.doctorId)?.upiId, "asha.mehta-1@okaxis");
});

test("registration rejects malformed UPI IDs without creating an application", async (context) => {
  for (const upiId of ["", "   ", "@okaxis", "asha.mehta", "asha@@okaxis", "asha.@okaxis", "asha@@okaxis", "asha@bank.", "asha..mehta@okaxis", `${"a".repeat(256)}@okaxis`]) {
    await context.test(JSON.stringify(upiId), async () => {
      const fixture = createFixture();
      const applicant = await authorizeApplicant(fixture);
      if (upiId === "") {
        const result = await fixture.service.submitApplication(applicant.registrationToken, { ...validInput(), upiId });
        assert.equal(fixture.applications.get(result.doctorId)?.upiId, null);
      } else {
        await assert.rejects(
          fixture.service.submitApplication(applicant.registrationToken, { ...validInput(), upiId }),
          { code: "INVALID_UPI_ID" },
        );
        assert.equal(fixture.applications.size, 0);
      }
    });
  }
});

test("payout profile reads and updates are Doctor-owner scoped", async () => {
  const fixture = createFixture();
  const applicant = await authorizeApplicant(fixture);
  const application = await fixture.service.submitApplication(applicant.registrationToken, validInput());
  const owner = { userId: application.doctorId, role: "doctor" as const };

  assert.deepEqual(await fixture.service.getOwnPayoutProfile(owner), { upiId: null });
  assert.deepEqual(await fixture.service.updateOwnPayoutProfile(owner, "asha@okaxis"), { upiId: "asha@okaxis" });
  assert.deepEqual(await fixture.service.getOwnPayoutProfile(owner), { upiId: "asha@okaxis" });
  for (const malformedUpiId of ["", "   ", "@okaxis", "asha", "asha@@okaxis", "asha.@okaxis", "asha@bank.", "asha..mehta@okaxis", `${"a".repeat(256)}@okaxis`]) {
    await assert.rejects(fixture.service.updateOwnPayoutProfile(owner, malformedUpiId), { code: "INVALID_UPI_ID" });
    assert.deepEqual(await fixture.service.getOwnPayoutProfile(owner), { upiId: "asha@okaxis" });
  }

  await assert.rejects(
    fixture.service.getOwnPayoutProfile({ userId: randomUUID(), role: "patient" }),
    { code: "DOCTOR_PAYOUT_ACCESS_DENIED" },
  );
  await assert.rejects(
    fixture.service.updateOwnPayoutProfile({ userId: randomUUID(), role: "admin" }, "other@okaxis"),
    { code: "DOCTOR_PAYOUT_ACCESS_DENIED" },
  );
  await assert.rejects(
    fixture.service.getOwnPayoutProfile({ userId: randomUUID(), role: "doctor" }),
    { code: "DOCTOR_PAYOUT_PROFILE_NOT_FOUND" },
  );
});

test("payout profile API authenticates the Doctor session and uses its owner ID", async () => {
  const originalFind = doctorsRepository.findPayoutProfile;
  const originalUpdate = doctorsRepository.updateUpiId;
  const doctorId = randomUUID();
  let savedUpiId: string | null = null;
  let updatedDoctorId = "";
  doctorsRepository.findPayoutProfile = async (id) => id === doctorId ? { upiId: savedUpiId } : null;
  doctorsRepository.updateUpiId = async (id, upiId) => {
    updatedDoctorId = id;
    if (id !== doctorId) return null;
    savedUpiId = upiId;
    return { upiId };
  };

  try {
    const session = signAuthToken({ userId: doctorId, role: "doctor" });
    const getRequest = (cookie = `doctor_session=${session}`) => new Request(
      "http://localhost/api/doctors/profile/upi",
      { headers: cookie ? { cookie } : undefined },
    );
    const initialResponse = await getPayoutProfile(getRequest());
    assert.equal(initialResponse.status, 200);
    assert.equal(initialResponse.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await initialResponse.json(), { data: { upiId: null }, error: null });

    const updateResponse = await patchPayoutProfile(new Request("http://localhost/api/doctors/profile/upi", {
      method: "PATCH",
      headers: { cookie: `doctor_session=${session}`, "content-type": "application/json" },
      body: JSON.stringify({ doctorId: randomUUID(), upiId: "route@okaxis" }),
    }));
    assert.equal(updateResponse.status, 200);
    assert.equal(updatedDoctorId, doctorId);
    assert.deepEqual(await updateResponse.json(), { data: { upiId: "route@okaxis" }, error: null });

    const invalidUpdate = await patchPayoutProfile(new Request("http://localhost/api/doctors/profile/upi", {
      method: "PATCH",
      headers: { cookie: `doctor_session=${session}`, "content-type": "application/json" },
      body: JSON.stringify({ upiId: "" }),
    }));
    assert.equal(invalidUpdate.status, 400);
    assert.equal((await invalidUpdate.json() as { error: { code: string } }).error.code, "INVALID_UPI_ID");
    assert.equal(savedUpiId, "route@okaxis");

    const patientSession = signAuthToken({ userId: randomUUID(), role: "patient" });
    const forbiddenResponse = await getPayoutProfile(getRequest(`doctor_session=${patientSession}`));
    assert.equal(forbiddenResponse.status, 403);
    for (const cookie of ["", "doctor_session=invalid-token"]) {
      const unauthorizedResponse = await getPayoutProfile(getRequest(cookie));
      assert.equal(unauthorizedResponse.status, 401);
      assert.equal((await unauthorizedResponse.json() as { error: { code: string } }).error.code, "SESSION_UNAUTHORIZED");
    }
  } finally {
    doctorsRepository.findPayoutProfile = originalFind;
    doctorsRepository.updateUpiId = originalUpdate;
  }
});

test("Admin review lists only Pending applications and allows one final decision", async () => {
  const fixture = createFixture();
  const applicant = await authorizeApplicant(fixture);
  const application = await fixture.service.submitApplication(applicant.registrationToken, validInput());
  const admin = { userId: randomUUID(), role: "admin" as const };

  assert.deepEqual(await fixture.service.listPendingApplications(admin), [{
    doctorId: application.doctorId,
    fullName: "Dr. Asha Mehta",
    username: "asha_mehta1",
    verificationStatus: "Pending",
    specialties: DEFAULT_SPECIALTIES,
    credentials: application.credentials.map(({ id, fileName, contentType, sizeBytes, createdAt }) => ({
      id, fileName, contentType, sizeBytes, createdAt,
    })),
  }]);
  await assert.rejects(
    fixture.service.listPendingApplications({ userId: randomUUID(), role: "doctor" }),
    { code: "DOCTOR_VERIFICATION_ACCESS_DENIED" },
  );
  await assert.rejects(
    fixture.service.setVerificationStatus({ userId: randomUUID(), role: "patient" }, application.doctorId, "Verified"),
    { code: "DOCTOR_VERIFICATION_ACCESS_DENIED" },
  );

  const verified = await fixture.service.setVerificationStatus(admin, application.doctorId, "Verified");
  assert.equal(verified.verificationStatus, "Verified");
  assert.equal(await fixture.service.getVerifiedDoctor(application.doctorId) !== null, true);
  assert.deepEqual(await fixture.service.listPendingApplications(admin), []);
  await assert.rejects(
    fixture.service.setVerificationStatus(admin, application.doctorId, "Rejected"),
    { code: "DOCTOR_VERIFICATION_CONFLICT" },
  );
  assert.equal(fixture.applications.get(application.doctorId)?.verificationStatus, "Verified");
});

test("rejected Doctors remain ineligible and cannot receive a second decision", async () => {
  const fixture = createFixture();
  const applicant = await authorizeApplicant(fixture);
  const application = await fixture.service.submitApplication(applicant.registrationToken, validInput());
  const admin = { userId: randomUUID(), role: "admin" as const };

  await fixture.service.setVerificationStatus(admin, application.doctorId, "Rejected");
  assert.equal(await fixture.service.getVerifiedDoctor(application.doctorId), null);
  assert.equal((await fixture.service.login("asha_mehta1", "StrongPass1")).verificationStatus, "Rejected");
  await assert.rejects(
    fixture.service.setVerificationStatus(admin, application.doctorId, "Verified"),
    { code: "DOCTOR_VERIFICATION_CONFLICT" },
  );
  assert.equal(fixture.applications.get(application.doctorId)?.verificationStatus, "Rejected");
});