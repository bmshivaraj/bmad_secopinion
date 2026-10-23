import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { OtpProvider } from "../../shared/otp-provider";
import type { Patient } from "./domain";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";
process.env.JWT_SECRET ??= "patient-auth-test-secret";

const { createPatientsService, patientsService } = await import("./service");
const { patientsRepository } = await import("./repository");
const { signAuthToken, signPatientPasswordSetupToken, verifyAuthToken } = await import("../../shared/auth-context");
const { POST: startRegistrationPost } = await import("../../app/api/patients/register/start/route");
const { POST: verifyRegistrationPost } = await import("../../app/api/patients/register/verify/route");
const { POST: passwordSetupPost } = await import("../../app/api/patients/password/setup/route");
const { POST: patientLoginPost } = await import("../../app/api/patients/login/route");
const { POST: patientLogoutPost } = await import("../../app/api/patients/logout/route");
const { GET: patientProfileGet } = await import("../../app/api/patients/profile/route");

function createFixture(options: { expiresAt?: Date; validCode?: string; createError?: unknown } = {}) {
  const patients = new Map<string, Patient>();
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 60_000);
  const validCode = options.validCode ?? "123456";
  const otpExpiryById = new Map<string, Date>();
  let otpSendCount = 0;
  let otpVerifyCount = 0;

  const repository = {
    async findByMobileNumber(mobileNumber: string) {
      return patients.get(mobileNumber) ?? null;
    },
    async create(mobileNumber: string) {
      if (options.createError !== undefined) {
        throw options.createError;
      }
      const patient: Patient = {
        id: randomUUID(),
        mobileNumber,
        username: null,
        passwordHash: null,
        isMinor: false,
        isGuardianRegistered: false,
        minorName: null,
        guardianRelationship: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      patients.set(mobileNumber, patient);
      return patient;
    },
    async findById(patientId: string) {
      return [...patients.values()].find((patient) => patient.id === patientId) ?? null;
    },
    async findByUsername(username: string) {
      return [...patients.values()].find((patient) => patient.username === username) ?? null;
    },
    async setCredentials(patientId: string, username: string, passwordHash: string, guardianRegistration: {
      isMinor: boolean;
      isGuardianRegistered: boolean;
      minorName: string | null;
      guardianRelationship: Patient["guardianRelationship"];
    }) {
      const patient = [...patients.values()].find((entry) => entry.id === patientId);
      if (!patient || patient.passwordHash !== null) return false;
      if ([...patients.values()].some((entry) => entry.id !== patientId && entry.username === username)) {
        throw { code: "P2002" };
      }
      patients.set(patient.mobileNumber, {
        ...patient,
        username,
        passwordHash,
        ...guardianRegistration,
        updatedAt: new Date(),
      });
      return true;
    },
  };
  const provider: OtpProvider = {
    async sendOtp() {
      otpSendCount += 1;
      const otpId = `otp-${otpSendCount}`;
      otpExpiryById.set(otpId, expiresAt);
      return { otpId, expiresAt };
    },
    async verifyOtp(otpId, code) {
      otpVerifyCount += 1;
      const otpExpiry = otpExpiryById.get(otpId);
      return otpExpiry !== undefined && otpExpiry.getTime() > Date.now() && code === validCode;
    },
  };

  return {
    patients,
    service: createPatientsService(repository, provider),
    get otpSendCount() {
      return otpSendCount;
    },
    get otpVerifyCount() {
      return otpVerifyCount;
    },
  };
}

function uniqueMobileNumber(): string {
  return `+1${Math.floor(Math.random() * 10_000_000_000).toString().padStart(10, "0")}`;
}

async function createRegisteredPatient(
  fixture: ReturnType<typeof createFixture>,
  mobileNumber = uniqueMobileNumber(),
): Promise<Patient> {
  const otp = await fixture.service.startRegistration(mobileNumber);
  return fixture.service.verifyRegistration(mobileNumber, otp.otpId, "123456");
}

test("starts registration and creates a passwordless patient after valid OTP", async () => {
  const fixture = createFixture();
  const mobileNumber = uniqueMobileNumber();
  const otp = await fixture.service.startRegistration(mobileNumber);

  assert.equal(otp.otpId, "otp-1");
  assert.ok(otp.expiresAt instanceof Date);
  const patient = await fixture.service.verifyRegistration(mobileNumber, otp.otpId, "123456");
  assert.equal(patient.mobileNumber, mobileNumber.slice(1));
  assert.equal(patient.username, null);
  assert.equal(patient.passwordHash, null);
});

test("sets a normalized username and Argon2id hash with valid setup authorization", async () => {
  const fixture = createFixture();
  const patient = await createRegisteredPatient(fixture);
  const setupToken = signPatientPasswordSetupToken(patient.id);

  const result = await fixture.service.setPassword(setupToken, "Alice_01", "StrongPass1");
  const storedPatient = fixture.patients.get(patient.mobileNumber);

  assert.deepEqual(result, { patientId: patient.id, username: "alice_01" });
  assert.equal(storedPatient?.username, "alice_01");
  assert.ok(storedPatient?.passwordHash?.startsWith("$argon2id$"));
  assert.notEqual(storedPatient?.passwordHash, "StrongPass1");
  assert.equal(storedPatient?.isMinor, false);
  assert.equal(storedPatient?.isGuardianRegistered, false);
  assert.equal(storedPatient?.minorName, null);
  assert.equal(storedPatient?.guardianRelationship, null);
  assert.equal("passwordHash" in result, false);
});

test("persists an attested minor declaration and exposes it through the Patients service", async () => {
  const fixture = createFixture();
  const patient = await createRegisteredPatient(fixture);
  const result = await fixture.service.setPassword(
    signPatientPasswordSetupToken(patient.id),
    "guardian_user",
    "StrongPass1",
    {
      isMinor: true,
      minorName: "  Jordan Doe  ",
      guardianRelationship: "legal_guardian",
      authorityAttested: true,
    },
  );
  const storedPatient = fixture.patients.get(patient.mobileNumber);

  assert.equal(result.patientId, patient.id);
  assert.equal(storedPatient?.isMinor, true);
  assert.equal(storedPatient?.isGuardianRegistered, true);
  assert.equal(storedPatient?.minorName, "Jordan Doe");
  assert.equal(storedPatient?.guardianRelationship, "legal_guardian");
  assert.deepEqual(await fixture.service.getPatientMinorContext(patient.id), {
    patientId: patient.id,
    isMinor: true,
    isGuardianRegistered: true,
    minorName: "Jordan Doe",
    guardianRelationship: "legal_guardian",
  });
  assert.equal(await fixture.service.getPatientMinorContext(randomUUID()), null);
});

test("rejects incomplete guardian declarations without changing patient credentials or role flags", async () => {
  const fixture = createFixture();
  const patient = await createRegisteredPatient(fixture);
  const setupToken = signPatientPasswordSetupToken(patient.id);
  const incompleteDeclarations = [
    { isMinor: true, guardianRelationship: "parent", authorityAttested: true },
    { isMinor: true, minorName: "Jordan Doe", authorityAttested: true },
    { isMinor: true, minorName: "Jordan Doe", guardianRelationship: "parent", authorityAttested: false },
    { isMinor: true, minorName: "Jordan Doe", guardianRelationship: "sibling", authorityAttested: true },
    { isMinor: true, minorName: "   ", guardianRelationship: "parent", authorityAttested: true },
    { isMinor: true, minorName: "a".repeat(121), guardianRelationship: "parent", authorityAttested: true },
    { isMinor: true, minorName: "Jordan\nDoe", guardianRelationship: "parent", authorityAttested: true },
    { isMinor: false, minorName: "Jordan Doe", guardianRelationship: "parent", authorityAttested: true },
  ];

  for (const declaration of incompleteDeclarations) {
    await assert.rejects(
      fixture.service.setPassword(setupToken, "guardian_user", "StrongPass1", declaration),
      { code: "GUARDIAN_DECLARATION_INVALID" },
    );
  }

  const unchangedPatient = fixture.patients.get(patient.mobileNumber);
  assert.equal(unchangedPatient?.username, null);
  assert.equal(unchangedPatient?.passwordHash, null);
  assert.equal(unchangedPatient?.isMinor, false);
  assert.equal(unchangedPatient?.isGuardianRegistered, false);
  assert.equal(unchangedPatient?.minorName, null);
  assert.equal(unchangedPatient?.guardianRelationship, null);
});

test("accepts exact username and password minimums and rejects overlong values", async () => {
  const fixture = createFixture();
  const patient = await createRegisteredPatient(fixture);
  const setupToken = signPatientPasswordSetupToken(patient.id);

  const result = await fixture.service.setPassword(setupToken, "abc", "Aa1bcdef");
  assert.equal(result.username, "abc");

  const secondPatient = await createRegisteredPatient(fixture);
  await fixture.service.setPassword(signPatientPasswordSetupToken(secondPatient.id), "a".repeat(30), "Aa1bcdef");

  const thirdPatient = await createRegisteredPatient(fixture);
  await assert.rejects(
    fixture.service.setPassword(signPatientPasswordSetupToken(thirdPatient.id), "ab", "Aa1bcdef"),
    { code: "VALIDATION_ERROR" },
  );
  await assert.rejects(
    fixture.service.setPassword(
      signPatientPasswordSetupToken(thirdPatient.id),
      "valid_user",
      `Aa1${"b".repeat(1022)}`,
    ),
    { code: "PASSWORD_POLICY_ERROR" },
  );
  await assert.rejects(
    fixture.service.setPassword(
      signPatientPasswordSetupToken(thirdPatient.id),
      "valid_user",
      "Aa1bcdef",
    ).then(() => fixture.service.setPassword(
      signPatientPasswordSetupToken(thirdPatient.id),
      "a".repeat(31),
      "Aa1bcdef",
    )),
    { code: "VALIDATION_ERROR" },
  );
});

test("rejects invalid usernames and passwords without changing credentials", async () => {
  const fixture = createFixture();
  const patient = await createRegisteredPatient(fixture);
  const setupToken = signPatientPasswordSetupToken(patient.id);

  for (const invalidPassword of ["Short1A", "alllowercase1", "ALLUPPERCASE1", "NoNumberAA"]) {
    await assert.rejects(fixture.service.setPassword(setupToken, "valid_user", invalidPassword), {
      code: "PASSWORD_POLICY_ERROR",
    });
  }
  await assert.rejects(fixture.service.setPassword(setupToken, "bad-name", "StrongPass1"), {
    code: "VALIDATION_ERROR",
  });

  const unchanged = fixture.patients.get(patient.mobileNumber);
  assert.equal(unchanged?.username, null);
  assert.equal(unchanged?.passwordHash, null);
});

test("rejects expired, invalid, and replayed password setup authorization", async () => {
  const fixture = createFixture();
  const patient = await createRegisteredPatient(fixture);

  await assert.rejects(fixture.service.setPassword("not-a-token", "new_user", "StrongPass1"), {
    code: "PASSWORD_SETUP_UNAUTHORIZED",
  });
  await assert.rejects(
    fixture.service.setPassword("not-a-token", "new_user", "StrongPass1", {
      isMinor: true,
      minorName: "Jordan Doe",
      guardianRelationship: "parent",
      authorityAttested: true,
    }),
    { code: "PASSWORD_SETUP_UNAUTHORIZED" },
  );
  await assert.rejects(
    fixture.service.setPassword(signPatientPasswordSetupToken(patient.id, "-1s"), "new_user", "StrongPass1"),
    { code: "PASSWORD_SETUP_UNAUTHORIZED" },
  );

  const setupToken = signPatientPasswordSetupToken(patient.id);
  await fixture.service.setPassword(setupToken, "new_user", "StrongPass1");
  await assert.rejects(fixture.service.setPassword(setupToken, "other_user", "OtherPass2"), {
    code: "PASSWORD_SETUP_UNAUTHORIZED",
  });
});

test("enforces case-insensitive username uniqueness without changing the second patient", async () => {
  const fixture = createFixture();
  const firstPatient = await createRegisteredPatient(fixture);
  const secondPatient = await createRegisteredPatient(fixture);

  await fixture.service.setPassword(signPatientPasswordSetupToken(firstPatient.id), "Clinic_User", "StrongPass1");
  await assert.rejects(
    fixture.service.setPassword(signPatientPasswordSetupToken(secondPatient.id), "CLINIC_USER", "OtherPass2"),
    { code: "USERNAME_ALREADY_TAKEN" },
  );
  const unchanged = fixture.patients.get(secondPatient.mobileNumber);
  assert.equal(unchanged?.username, null);
  assert.equal(unchanged?.passwordHash, null);
});

test("authenticates valid credentials and uses one generic failure for invalid login", async () => {
  const fixture = createFixture();
  const registeredPatient = await createRegisteredPatient(fixture);
  await fixture.service.setPassword(
    signPatientPasswordSetupToken(registeredPatient.id),
    "patient_1",
    "StrongPass1",
  );

  const login = await fixture.service.login("PATIENT_1", "StrongPass1");
  assert.equal(login.patientId, registeredPatient.id);
  assert.deepEqual(verifyAuthToken(login.token), { userId: registeredPatient.id, role: "patient" });
  await assert.rejects(fixture.service.login("patient_1", "WrongPass2"), { code: "INVALID_CREDENTIALS" });
  await assert.rejects(fixture.service.login("unknown_1", "StrongPass1"), { code: "INVALID_CREDENTIALS" });

  const passwordlessPatient = await createRegisteredPatient(fixture);
  fixture.patients.set(passwordlessPatient.mobileNumber, { ...passwordlessPatient, username: "passwordless_user" });
  await assert.rejects(fixture.service.login("passwordless_user", "StrongPass1"), { code: "INVALID_CREDENTIALS" });
  assert.equal(fixture.patients.get(passwordlessPatient.mobileNumber)?.passwordHash, null);
});

test("limits repeated patient login failures within the window", async () => {
  const fixture = createFixture();
  const patient = await createRegisteredPatient(fixture);
  await fixture.service.setPassword(signPatientPasswordSetupToken(patient.id), "throttle_user", "StrongPass1");

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await assert.rejects(fixture.service.login("throttle_user", "WrongPass2"), { code: "INVALID_CREDENTIALS" });
  }
  await assert.rejects(fixture.service.login("throttle_user", "StrongPass1"), { code: "INVALID_CREDENTIALS" });
});

test("allows only one concurrent password setup to consume a setup token", async () => {
  const fixture = createFixture();
  const patient = await createRegisteredPatient(fixture);
  const setupToken = signPatientPasswordSetupToken(patient.id);

  const results = await Promise.allSettled([
    fixture.service.setPassword(setupToken, "first_user", "StrongPass1"),
    fixture.service.setPassword(setupToken, "second_user", "OtherPass2"),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(fixture.patients.get(patient.mobileNumber)?.passwordHash === null, false);
});

test("rejects an already-registered number without issuing an OTP", async () => {
  const fixture = createFixture();
  const mobileNumber = uniqueMobileNumber();
  await fixture.service.startRegistration(mobileNumber);
  await fixture.service.verifyRegistration(mobileNumber, "otp-1", "123456");

  await assert.rejects(fixture.service.startRegistration(mobileNumber), { code: "MOBILE_ALREADY_REGISTERED" });
  assert.equal(fixture.otpSendCount, 1);
});

test("rejects an incorrect OTP without creating a patient", async () => {
  const fixture = createFixture();
  const mobileNumber = uniqueMobileNumber();
  const otp = await fixture.service.startRegistration(mobileNumber);

  await assert.rejects(fixture.service.verifyRegistration(mobileNumber, otp.otpId, "000000"), {
    code: "OTP_VERIFICATION_FAILED",
  });
  assert.equal(fixture.patients.size, 0);
});

test("distinguishes an expired OTP from an incorrect code", async () => {
  const fixture = createFixture({ expiresAt: new Date(Date.now() - 1) });
  const mobileNumber = uniqueMobileNumber();
  const otp = await fixture.service.startRegistration(mobileNumber);

  await assert.rejects(fixture.service.verifyRegistration(mobileNumber, otp.otpId, "123456"), {
    code: "OTP_EXPIRED",
  });
  assert.equal(fixture.otpVerifyCount, 0);
  assert.equal(fixture.patients.size, 0);
});

test("rejects the fourth OTP request within the rate-limit window", async () => {
  const fixture = createFixture();
  const mobileNumber = uniqueMobileNumber();

  await fixture.service.startRegistration(mobileNumber);
  await fixture.service.startRegistration(mobileNumber);
  await fixture.service.startRegistration(mobileNumber);
  await assert.rejects(fixture.service.startRegistration(mobileNumber), { code: "OTP_RATE_LIMIT_EXCEEDED" });
  assert.equal(fixture.otpSendCount, 3);
});

test("binds an OTP to its normalized mobile number", async () => {
  const fixture = createFixture();
  const mobileNumber = uniqueMobileNumber();
  const otp = await fixture.service.startRegistration(mobileNumber);

  await assert.rejects(
    fixture.service.verifyRegistration(`${mobileNumber}9`, otp.otpId, "123456"),
    { code: "OTP_VERIFICATION_FAILED" },
  );
  assert.equal(fixture.patients.size, 0);

  const patient = await fixture.service.verifyRegistration(mobileNumber.slice(1), otp.otpId, "123456");
  assert.equal(patient.mobileNumber, mobileNumber.slice(1));
  await assert.rejects(fixture.service.startRegistration(mobileNumber), { code: "MOBILE_ALREADY_REGISTERED" });
  assert.equal(fixture.otpSendCount, 1);
});

test("keeps an expired OTP distinguishable after another registration starts", async () => {
  const fixture = createFixture({ expiresAt: new Date(Date.now() - 1) });
  const expiredMobileNumber = uniqueMobileNumber();
  const expiredOtp = await fixture.service.startRegistration(expiredMobileNumber);
  await fixture.service.startRegistration(uniqueMobileNumber());

  await assert.rejects(
    fixture.service.verifyRegistration(expiredMobileNumber, expiredOtp.otpId, "123456"),
    { code: "OTP_EXPIRED" },
  );
  assert.equal(fixture.otpVerifyCount, 0);
});

test("maps a database unique-constraint race to duplicate registration", async () => {
  const fixture = createFixture({ createError: { code: "P2002" } });
  const mobileNumber = uniqueMobileNumber();
  const otp = await fixture.service.startRegistration(mobileNumber);

  await assert.rejects(
    fixture.service.verifyRegistration(mobileNumber, otp.otpId, "123456"),
    { code: "MOBILE_ALREADY_REGISTERED" },
  );
});

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/patients/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("registration routes share OTP state across requests and keep the public envelope", async () => {
  const originalFindByMobileNumber = patientsRepository.findByMobileNumber;
  const originalCreate = patientsRepository.create;
  const mobileNumber = uniqueMobileNumber();
  const patientId = randomUUID();
  patientsRepository.findByMobileNumber = async () => null;
  patientsRepository.create = async (number) => ({
    id: patientId,
    mobileNumber: number,
    username: null,
    passwordHash: null,
    isMinor: false,
    isGuardianRegistered: false,
    minorName: null,
    guardianRelationship: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const startResponse = await startRegistrationPost(postJson({ mobileNumber }));
    assert.equal(startResponse.status, 200);
    const startBody = await startResponse.json() as {
      data: { otpId: string; expiresAt: string };
      error: null;
    };
    assert.equal(startBody.error, null);
    assert.ok(startBody.data.otpId);
    assert.ok(startBody.data.expiresAt);

    const verifyResponse = await verifyRegistrationPost(postJson({
      mobileNumber,
      otpId: startBody.data.otpId,
      code: "123456",
    }));
    assert.equal(verifyResponse.status, 200);
    const setupCookie = verifyResponse.headers.get("set-cookie") ?? "";
    assert.match(setupCookie, /patient_password_setup=/);
    assert.match(setupCookie, /HttpOnly/i);
    assert.match(setupCookie, /SameSite=lax/i);
    const verifyBody = await verifyResponse.json() as {
      data: { patientId: string; mobileNumber: string };
      error: null;
    };
    assert.deepEqual(verifyBody, {
      data: { patientId, mobileNumber: mobileNumber.slice(1) },
      error: null,
    });
    assert.equal("passwordHash" in verifyBody.data, false);
  } finally {
    patientsRepository.findByMobileNumber = originalFindByMobileNumber;
    patientsRepository.create = originalCreate;
  }
});

test("setup, login, and logout routes preserve envelopes and cookie security", async () => {
  const originalMethods = {
    findByMobileNumber: patientsRepository.findByMobileNumber,
    create: patientsRepository.create,
    findById: patientsRepository.findById,
    findByUsername: patientsRepository.findByUsername,
    setCredentials: patientsRepository.setCredentials,
  };
  const mobileNumber = uniqueMobileNumber();
  const patientId = randomUUID();
  const patientState: { current: Patient | null } = { current: null };
  patientsRepository.findByMobileNumber = async () => patientState.current;
  patientsRepository.create = async (number) => {
    const createdPatient: Patient = {
      id: patientId,
      mobileNumber: number,
      username: null,
      passwordHash: null,
      isMinor: false,
      isGuardianRegistered: false,
      minorName: null,
      guardianRelationship: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    patientState.current = createdPatient;
    return createdPatient;
  };
  patientsRepository.findById = async (id) => (id === patientState.current?.id ? patientState.current : null);
  patientsRepository.findByUsername = async (username) => (
    username === patientState.current?.username ? patientState.current : null
  );
  patientsRepository.setCredentials = async (id, username, passwordHash, guardianRegistration) => {
    const currentPatient = patientState.current;
    if (!currentPatient || id !== currentPatient.id || currentPatient.passwordHash !== null) return false;
    patientState.current = {
      ...currentPatient,
      username,
      passwordHash,
      ...guardianRegistration,
      updatedAt: new Date(),
    };
    return true;
  };

  try {
    const missingSetupResponse = await passwordSetupPost(new Request("http://localhost/api/patients/password/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "route_user", password: "StrongPass1" }),
    }));
    assert.equal(missingSetupResponse.status, 401);
    const missingSetupBody = await missingSetupResponse.json() as { data: null; error: { code: string } };
    assert.equal(missingSetupBody.error.code, "PASSWORD_SETUP_UNAUTHORIZED");

    const startResponse = await startRegistrationPost(postJson({ mobileNumber }));
    const startBody = await startResponse.json() as { data: { otpId: string }; error: null };
    const verifyResponse = await verifyRegistrationPost(postJson({
      mobileNumber,
      otpId: startBody.data.otpId,
      code: "123456",
    }));
    const setupCookie = (verifyResponse.headers.get("set-cookie") ?? "").split(";")[0];
    const incompleteGuardianSetup = await passwordSetupPost(new Request("http://localhost/api/patients/password/setup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: setupCookie },
      body: JSON.stringify({
        username: "route_user",
        password: "StrongPass1",
        isMinor: true,
        minorName: "Jordan Doe",
        guardianRelationship: "parent",
        authorityAttested: false,
      }),
    }));
    assert.equal(incompleteGuardianSetup.status, 400);
    const incompleteGuardianBody = await incompleteGuardianSetup.json() as {
      data: null;
      error: { code: string };
    };
    assert.equal(incompleteGuardianBody.error.code, "GUARDIAN_DECLARATION_INVALID");
    assert.equal(patientState.current?.passwordHash, null);

    const invalidRelationshipResponse = await passwordSetupPost(new Request("http://localhost/api/patients/password/setup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: setupCookie },
      body: JSON.stringify({
        username: "route_user",
        password: "StrongPass1",
        isMinor: true,
        minorName: "Jordan Doe",
        guardianRelationship: "sibling",
        authorityAttested: true,
      }),
    }));
    assert.equal(invalidRelationshipResponse.status, 400);
    const invalidRelationshipBody = await invalidRelationshipResponse.json() as {
      data: null;
      error: { code: string };
    };
    assert.equal(invalidRelationshipBody.error.code, "VALIDATION_ERROR");
    assert.equal(patientState.current?.passwordHash, null);

    const setupResponse = await passwordSetupPost(new Request("http://localhost/api/patients/password/setup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: setupCookie },
      body: JSON.stringify({
        username: "route_user",
        password: "StrongPass1",
        isMinor: true,
        minorName: "Jordan Doe",
        guardianRelationship: "other_authorized_guardian",
        authorityAttested: true,
      }),
    }));
    assert.equal(setupResponse.status, 200);
    const setupBody = await setupResponse.json() as { data: { patientId: string; username: string }; error: null };
    assert.deepEqual(setupBody, { data: { patientId, username: "route_user" }, error: null });
    assert.equal("passwordHash" in setupBody.data, false);
    assert.equal(patientState.current?.isMinor, true);
    assert.equal(patientState.current?.isGuardianRegistered, true);
    assert.equal(patientState.current?.minorName, "Jordan Doe");
    assert.equal(patientState.current?.guardianRelationship, "other_authorized_guardian");
    const clearedSetupCookie = setupResponse.headers.get("set-cookie") ?? "";
    assert.match(clearedSetupCookie, /Max-Age=0/i);
    assert.doesNotMatch(clearedSetupCookie, /patient_session=/);

    const loginResponse = await patientLoginPost(postJson({ username: "ROUTE_USER", password: "StrongPass1" }));
    assert.equal(loginResponse.status, 200);
    const loginBody = await loginResponse.json() as { data: { patientId: string }; error: null };
    assert.deepEqual(loginBody, { data: { patientId }, error: null });
    const sessionCookie = (loginResponse.headers.get("set-cookie") ?? "").split(";")[0];
    assert.match(loginResponse.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(loginResponse.headers.get("set-cookie") ?? "", /SameSite=lax/i);
    const token = decodeURIComponent(sessionCookie.slice(sessionCookie.indexOf("=") + 1));
    assert.deepEqual(verifyAuthToken(token), { userId: patientId, role: "patient" });

    const previousNodeEnv = process.env.NODE_ENV;
    Reflect.set(process.env, "NODE_ENV", "production");
    try {
      const secureLoginResponse = await patientLoginPost(postJson({ username: "route_user", password: "StrongPass1" }));
      assert.match(secureLoginResponse.headers.get("set-cookie") ?? "", /Secure/i);
    } finally {
      if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
      else Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
    }

    const failedLogin = await patientLoginPost(postJson({ username: "route_user", password: "WrongPass2" }));
    assert.equal(failedLogin.status, 401);
    assert.equal(failedLogin.headers.get("set-cookie"), null);
    const failedBody = await failedLogin.json() as { data: null; error: { code: string } };
    assert.equal(failedBody.error.code, "INVALID_CREDENTIALS");

    const logoutResponse = await patientLogoutPost();
    assert.equal(logoutResponse.status, 200);
    assert.match(logoutResponse.headers.get("set-cookie") ?? "", /Max-Age=0/i);
  } finally {
    Object.assign(patientsRepository, originalMethods);
  }
});

test("registration route returns typed validation and duplicate error responses", async () => {
  const originalFindByMobileNumber = patientsRepository.findByMobileNumber;
  const mobileNumber = uniqueMobileNumber();
  patientsRepository.findByMobileNumber = async () => ({
    id: randomUUID(),
    mobileNumber,
    username: null,
    passwordHash: null,
    isMinor: false,
    isGuardianRegistered: false,
    minorName: null,
    guardianRelationship: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const invalidResponse = await startRegistrationPost(new Request("http://localhost/api/patients/register/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }));
    assert.equal(invalidResponse.status, 400);
    const invalidBody = await invalidResponse.json() as { data: null; error: { code: string } };
    assert.equal(invalidBody.error.code, "VALIDATION_ERROR");

    const duplicateResponse = await startRegistrationPost(postJson({ mobileNumber }));
    assert.equal(duplicateResponse.status, 409);
    const duplicateBody = await duplicateResponse.json() as { data: null; error: { code: string } };
    assert.equal(duplicateBody.error.code, "MOBILE_ALREADY_REGISTERED");
  } finally {
    patientsRepository.findByMobileNumber = originalFindByMobileNumber;
  }
});

test("Patient profile returns only the session owner's safe identity fields", async () => {
  const fixture = createFixture();
  const patient = await createRegisteredPatient(fixture);
  patient.username = "patient_profile";

  assert.deepEqual(await fixture.service.getOwnProfile({ userId: patient.id, role: "patient" }), {
    displayName: "patient_profile",
    username: "patient_profile",
    mobileNumber: patient.mobileNumber,
  });
  await assert.rejects(fixture.service.getOwnProfile({ userId: patient.id, role: "doctor" }), { code: "SESSION_UNAUTHORIZED" });
  await assert.rejects(fixture.service.getOwnProfile({ userId: randomUUID(), role: "patient" }), { code: "PATIENT_PROFILE_NOT_FOUND" });
});

test("Patient profile API is authenticated, private, and derives identity from its session", async () => {
  const originalGetOwnProfile = patientsService.getOwnProfile;
  let requestedBy = "";
  patientsService.getOwnProfile = async (caller) => {
    requestedBy = caller.userId;
    return { displayName: "profile_patient", username: "profile_patient", mobileNumber: "15550000001" };
  };
  try {
    const patientToken = signAuthToken({ userId: "patient-profile-id", role: "patient" });
    const response = await patientProfileGet(new Request("http://localhost/api/patients/profile", {
      headers: { cookie: `patient_session=${patientToken}` },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(requestedBy, "patient-profile-id");
    assert.deepEqual((await response.json() as { data: unknown }).data, {
      displayName: "profile_patient",
      username: "profile_patient",
      mobileNumber: "15550000001",
    });

    const anonymous = await patientProfileGet(new Request("http://localhost/api/patients/profile"));
    assert.equal(anonymous.status, 401);
    const doctorToken = signAuthToken({ userId: "doctor-profile-id", role: "doctor" });
    const wrongRole = await patientProfileGet(new Request("http://localhost/api/patients/profile", {
      headers: { cookie: `patient_session=${doctorToken}` },
    }));
    assert.equal(wrongRole.status, 401);
  } finally {
    patientsService.getOwnProfile = originalGetOwnProfile;
  }
});