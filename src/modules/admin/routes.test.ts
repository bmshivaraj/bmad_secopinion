import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import argon2 from "argon2";
import { signAuthToken } from "../../shared/auth-context";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";
process.env.JWT_SECRET ??= "admin-routes-test-secret";

const { adminRepository } = await import("./repository");
const { doctorsRepository } = await import("../doctors/repository");
const { POST: loginPost } = await import("../../app/api/admin/login/route");
const { GET: queueGet } = await import("../../app/api/admin/verification-queue/route");
const { GET: specialtiesGet, POST: specialtiesPost } = await import("../../app/api/admin/specialties/route");
const { GET: platformSettingsGet, PUT: platformSettingsPut } = await import("../../app/api/admin/platform-settings/route");
const { GET: doctorSpecialtiesGet } = await import("../../app/api/doctors/specialties/route");
const { PATCH: verificationPatch } = await import("../../app/api/admin/doctors/[doctorId]/verification/route");

const adminId = randomUUID();
const doctorId = randomUUID();
const credentialId = randomUUID();
const passwordHash = await argon2.hash("SecureAdminPass1", { type: argon2.argon2id });
const adminAccount = {
  id: adminId,
  username: "review-admin",
  passwordHash,
  createdAt: new Date(),
  updatedAt: new Date(),
};

test("Admin API authenticates from its cookie, returns private links, and only accepts final path decisions", async () => {
  const originals = {
    findByUsername: adminRepository.findByUsername,
    listPendingApplications: doctorsRepository.listPendingApplications,
    findById: doctorsRepository.findById,
    updatePendingVerificationStatus: doctorsRepository.updatePendingVerificationStatus,
  };
  const application = {
    id: doctorId,
    mobileNumber: "15550000001",
    fullName: "Dr. Asha Mehta",
    username: "asha_mehta1",
    passwordHash: "doctor-secret-hash",
    upiId: null,
    verificationStatus: "Pending" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    specialties: [{ id: "cardiology", name: "Cardiology" }],
    credentials: [{
      id: credentialId,
      doctorId,
      fileName: "degree.pdf",
      contentType: "application/pdf",
      sizeBytes: 123,
      storageKey: "private-storage-key",
      createdAt: new Date(),
    }],
  };
  let currentStatus: "Pending" | "Verified" | "Rejected" = "Pending";
  const decisions: { doctorId: string; status: "Verified" | "Rejected" }[] = [];

  adminRepository.findByUsername = async (username) => username === adminAccount.username ? adminAccount : null;
  doctorsRepository.listPendingApplications = async () => currentStatus === "Pending"
    ? [{ ...application, verificationStatus: currentStatus }]
    : [];
  doctorsRepository.findById = async (id) => id === doctorId
    ? { ...application, verificationStatus: currentStatus }
    : null;
  doctorsRepository.updatePendingVerificationStatus = async (id, status) => {
    decisions.push({ doctorId: id, status });
    if (id !== doctorId || currentStatus !== "Pending") return null;
    currentStatus = status;
    return { ...application, verificationStatus: status };
  };

  try {
    const login = await loginPost(new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: adminAccount.username, password: "SecureAdminPass1", role: "admin", userId: "forged" }),
    }));
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie") ?? "", /admin_session=/);
    assert.match(login.headers.get("set-cookie") ?? "", /HttpOnly/i);
    const loginBody = await login.json() as { data: Record<string, unknown>; error: null };
    assert.deepEqual(loginBody.data, { adminId });

    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const queue = await queueGet(new Request("http://localhost/api/admin/verification-queue", {
      headers: { cookie },
    }));
    assert.equal(queue.status, 200);
    assert.equal(queue.headers.get("cache-control"), "private, no-store");
    const queueBody = await queue.json() as { data: { credentials: Record<string, unknown>[] }[]; error: null };
    assert.equal(queueBody.data[0].credentials[0].href, `/api/doctors/credentials/${credentialId}`);
    assert.equal("storageKey" in queueBody.data[0].credentials[0], false);

    currentStatus = "Verified";
    const emptyQueue = await queueGet(new Request("http://localhost/api/admin/verification-queue", {
      headers: { cookie: `admin_session=${signAuthToken({ userId: adminId, role: "admin" })}` },
    }));
    assert.deepEqual((await emptyQueue.json() as { data: unknown[] }).data, []);

    const missingSession = await queueGet(new Request("http://localhost/api/admin/verification-queue"));
    assert.equal(missingSession.status, 401);
    const invalidSession = await queueGet(new Request("http://localhost/api/admin/verification-queue", {
      headers: { cookie: "admin_session=invalid-token" },
    }));
    assert.equal(invalidSession.status, 401);
    const doctorSession = `admin_session=${signAuthToken({ userId: randomUUID(), role: "doctor" })}`;
    const deniedQueue = await queueGet(new Request("http://localhost/api/admin/verification-queue", {
      headers: { cookie: doctorSession },
    }));
    assert.equal(deniedQueue.status, 403);
    const patientSession = `admin_session=${signAuthToken({ userId: randomUUID(), role: "patient" })}`;
    const patientQueue = await queueGet(new Request("http://localhost/api/admin/verification-queue", {
      headers: { cookie: patientSession },
    }));
    assert.equal(patientQueue.status, 403);

    currentStatus = "Pending";
    const decision = await verificationPatch(new Request(`http://localhost/api/admin/doctors/${doctorId}/verification`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ doctorId: "caller-controlled-id", verificationStatus: "Rejected" }),
    }), { params: Promise.resolve({ doctorId }) });
    assert.equal(decision.status, 200);
    assert.deepEqual(decisions, [{ doctorId, status: "Rejected" }]);

    const staleDecision = await verificationPatch(new Request(`http://localhost/api/admin/doctors/${doctorId}/verification`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ verificationStatus: "Verified" }),
    }), { params: Promise.resolve({ doctorId }) });
    assert.equal(staleDecision.status, 409);
    assert.equal(currentStatus, "Rejected");

    const deniedDecision = await verificationPatch(new Request(`http://localhost/api/admin/doctors/${doctorId}/verification`, {
      method: "PATCH",
      headers: { cookie: doctorSession, "content-type": "application/json" },
      body: JSON.stringify({ verificationStatus: "Verified" }),
    }), { params: Promise.resolve({ doctorId }) });
    assert.equal(deniedDecision.status, 403);
    assert.equal(currentStatus, "Rejected");

    const missingSessionDecision = await verificationPatch(new Request(`http://localhost/api/admin/doctors/${doctorId}/verification`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ verificationStatus: "Verified" }),
    }), { params: Promise.resolve({ doctorId }) });
    assert.equal(missingSessionDecision.status, 401);
    const invalidSessionDecision = await verificationPatch(new Request(`http://localhost/api/admin/doctors/${doctorId}/verification`, {
      method: "PATCH",
      headers: { cookie: "admin_session=invalid-token", "content-type": "application/json" },
      body: JSON.stringify({ verificationStatus: "Verified" }),
    }), { params: Promise.resolve({ doctorId }) });
    assert.equal(invalidSessionDecision.status, 401);
    const patientDecision = await verificationPatch(new Request(`http://localhost/api/admin/doctors/${doctorId}/verification`, {
      method: "PATCH",
      headers: { cookie: patientSession, "content-type": "application/json" },
      body: JSON.stringify({ verificationStatus: "Verified" }),
    }), { params: Promise.resolve({ doctorId }) });
    assert.equal(patientDecision.status, 403);
    assert.equal(currentStatus, "Rejected");
  } finally {
    adminRepository.findByUsername = originals.findByUsername;
    doctorsRepository.listPendingApplications = originals.listPendingApplications;
    doctorsRepository.findById = originals.findById;
    doctorsRepository.updatePendingVerificationStatus = originals.updatePendingVerificationStatus;
  }
});

test("Admin Specialty API lists, adds, validates, and denies non-Admin callers", async () => {
  const originals = {
    listActiveSpecialties: doctorsRepository.listActiveSpecialties,
    createSpecialty: doctorsRepository.createSpecialty,
  };
  const catalog = [{ id: "specialty-cardio", name: "Cardiology" }];
  doctorsRepository.listActiveSpecialties = async () => catalog;
  doctorsRepository.createSpecialty = async (input) => {
    if (catalog.some(({ name }) => name.toLowerCase() === input.normalizedName)) {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    }
    const specialty = { id: randomUUID(), name: input.name };
    catalog.push(specialty);
    catalog.sort((left, right) => left.name.localeCompare(right.name));
    return specialty;
  };

  const adminCookie = `admin_session=${signAuthToken({ userId: adminId, role: "admin" })}`;
  const post = (name: unknown, cookie = adminCookie) => specialtiesPost(new Request(
    "http://localhost/api/admin/specialties",
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
  ));

  try {
    const initial = await specialtiesGet(new Request("http://localhost/api/admin/specialties", {
      headers: { cookie: adminCookie },
    }));
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await initial.json() as { data: { name: string }[] }).data.map(({ name }) => name), ["Cardiology"]);

    for (const cookie of ["", "admin_session=invalid-token"]) {
      const request = cookie
        ? new Request("http://localhost/api/admin/specialties", { headers: { cookie } })
        : new Request("http://localhost/api/admin/specialties");
      const deniedList = await specialtiesGet(request);
      assert.equal(deniedList.status, 401);
    }

    const added = await post("  Rheumatology  ");
    assert.equal(added.status, 201);
    assert.equal((await added.json() as { data: { name: string } }).data.name, "Rheumatology");
    const updated = await specialtiesGet(new Request("http://localhost/api/admin/specialties", {
      headers: { cookie: adminCookie },
    }));
    assert.deepEqual((await updated.json() as { data: { name: string }[] }).data.map(({ name }) => name), [
      "Cardiology",
      "Rheumatology",
    ]);
    const doctorRegistrationList = await doctorSpecialtiesGet();
    assert.deepEqual(
      (await doctorRegistrationList.json() as { data: { name: string }[] }).data.map(({ name }) => name),
      ["Cardiology", "Rheumatology"],
    );

    const duplicate = await post("rHeUmAtOlOgY");
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json() as { error: { code: string } }).error.code, "SPECIALTY_NAME_ALREADY_EXISTS");
    for (const invalidName of ["   ", "x".repeat(121), 42]) {
      const invalid = await post(invalidName);
      assert.equal(invalid.status, 400);
    }

    for (const role of ["doctor", "patient"] as const) {
      const denied = await post("Unauthorized Specialty", `admin_session=${signAuthToken({ userId: randomUUID(), role })}`);
      assert.equal(denied.status, 403);
      const deniedList = await specialtiesGet(new Request("http://localhost/api/admin/specialties", {
        headers: { cookie: `admin_session=${signAuthToken({ userId: randomUUID(), role })}` },
      }));
      assert.equal(deniedList.status, 403);
    }
    for (const cookie of ["", "admin_session=invalid-token"]) {
      assert.equal((await post("Unauthorized Specialty", cookie)).status, 401);
    }
    assert.equal(catalog.length, 2);
  } finally {
    doctorsRepository.listActiveSpecialties = originals.listActiveSpecialties;
    doctorsRepository.createSpecialty = originals.createSpecialty;
  }
});

test("Admin platform settings API reads and atomically updates settings with private Admin-only access", async () => {
  const originals = {
    getPlatformSettings: adminRepository.getPlatformSettings,
    updatePlatformSettings: adminRepository.updatePlatformSettings,
  };
  let values = {
    standardCaseFee: new (await import("../../generated/prisma/client")).Prisma.Decimal("1000.00"),
    urgentCaseFee: new (await import("../../generated/prisma/client")).Prisma.Decimal("2000.00"),
    platformFeePercent: new (await import("../../generated/prisma/client")).Prisma.Decimal("20.00"),
  };
  let writeCount = 0;
  let readCount = 0;
  const adminCookie = `admin_session=${signAuthToken({ userId: adminId, role: "admin" })}`;
  const endpoint = "http://localhost/api/admin/platform-settings";
  const read = (cookie?: string) => platformSettingsGet(new Request(endpoint, { headers: cookie ? { cookie } : {} }));
  const update = (body: unknown, cookie = adminCookie) => platformSettingsPut(new Request(endpoint, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));

  adminRepository.getPlatformSettings = async () => {
    readCount += 1;
    return { ...values, id: "settings", createdAt: new Date(), updatedAt: new Date() };
  };
  adminRepository.updatePlatformSettings = async (next) => {
    writeCount += 1;
    values = next;
    return { ...values, id: "settings", createdAt: new Date(), updatedAt: new Date() };
  };
  try {
    const current = await read(adminCookie);
    assert.equal(current.status, 200);
    assert.equal(current.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await current.json() as { data: unknown }).data, {
      standardCaseFee: "1000.00", urgentCaseFee: "2000.00", platformFeePercent: "20.00",
    });

    const saved = await update({ standardCaseFee: "1500.50", urgentCaseFee: "3000.25", platformFeePercent: "12.50" });
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await saved.json() as { data: unknown }).data, {
      standardCaseFee: "1500.50", urgentCaseFee: "3000.25", platformFeePercent: "12.50",
    });
    assert.equal(writeCount, 1);

    for (const cookie of [undefined, "admin_session=invalid-token"]) {
      const deniedRead = await read(cookie);
      assert.equal(deniedRead.status, 401);
      assert.equal(deniedRead.headers.get("cache-control"), "private, no-store");
      assert.equal((await update({ standardCaseFee: "1600.00", urgentCaseFee: "3100.00", platformFeePercent: "10.00" }, cookie ?? "")).status, 401);
    }
    for (const role of ["doctor", "patient"] as const) {
      const cookie = `admin_session=${signAuthToken({ userId: randomUUID(), role })}`;
      const deniedRead = await read(cookie);
      assert.equal(deniedRead.status, 403);
      assert.equal(deniedRead.headers.get("cache-control"), "private, no-store");
      assert.equal((await update({ standardCaseFee: "1600.00", urgentCaseFee: "3100.00", platformFeePercent: "10.00" }, cookie)).status, 403);
    }
    for (const body of [
      { standardCaseFee: "0", urgentCaseFee: "1", platformFeePercent: "20" },
      { standardCaseFee: "1.001", urgentCaseFee: "1", platformFeePercent: "20" },
      { standardCaseFee: "1", urgentCaseFee: "1", platformFeePercent: "100.01" },
    ]) {
      const invalid = await update(body);
      assert.equal(invalid.status, 400);
    }
    const malformed = await platformSettingsPut(new Request(endpoint, {
      method: "PUT", headers: { cookie: adminCookie, "content-type": "application/json" }, body: "{",
    }));
    assert.equal(malformed.status, 400);
    assert.equal(writeCount, 1);
    assert.equal(readCount, 1);
    assert.deepEqual(values, {
      standardCaseFee: new (await import("../../generated/prisma/client")).Prisma.Decimal("1500.50"),
      urgentCaseFee: new (await import("../../generated/prisma/client")).Prisma.Decimal("3000.25"),
      platformFeePercent: new (await import("../../generated/prisma/client")).Prisma.Decimal("12.50"),
    });
  } finally {
    adminRepository.getPlatformSettings = originals.getPlatformSettings;
    adminRepository.updatePlatformSettings = originals.updatePlatformSettings;
  }
});