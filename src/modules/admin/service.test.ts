import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import argon2 from "argon2";
import { Prisma } from "../../generated/prisma/client";
import { verifyAuthToken } from "../../shared/auth-context";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";
process.env.JWT_SECRET ??= "admin-auth-test-secret";

const { AdminAccessDeniedError } = await import("./domain");
const { createAdminService } = await import("./service");
const { buildAdminAccountUpsert, getAdminSeedCredentials } = await import("../../../prisma/seed");
const accountId = randomUUID();
const now = new Date();
const passwordHash = await argon2.hash("SecureAdminPass1", { type: argon2.argon2id });
const account = { id: accountId, username: "review-admin", passwordHash, createdAt: now, updatedAt: now };

function createFixture() {
  const calls: unknown[][] = [];
  const doctors = {
    async listPendingApplications(caller: { userId: string; role: "patient" | "doctor" | "admin" }) {
      calls.push(["list", caller]);
      return [{
        doctorId: "doctor-1",
        fullName: "Dr. Asha Mehta",
        username: "asha_mehta1",
        verificationStatus: "Pending" as const,
        specialties: [{ id: "specialty-cardio", name: "Cardiology" }],
        credentials: [{ id: "credential-1", fileName: "degree.pdf", contentType: "application/pdf", sizeBytes: 100, createdAt: now }],
      }];
    },
    async setVerificationStatus(
      caller: { userId: string; role: "patient" | "doctor" | "admin" },
      doctorId: string,
      status: "Verified" | "Rejected",
    ) {
      calls.push(["decide", caller, doctorId, status]);
      return {
        doctorId,
        fullName: "Dr. Asha Mehta",
        username: "asha_mehta1",
        verificationStatus: status,
        specialties: [{ id: "specialty-cardio", name: "Cardiology" }],
        credentials: [{ id: "credential-1", fileName: "degree.pdf", contentType: "application/pdf", sizeBytes: 100, createdAt: now }],
      };
    },
    async listActiveSpecialties() {
      calls.push(["list-specialties"]);
      return [{ id: "specialty-cardio", name: "Cardiology" }];
    },
    async createSpecialty(name: string) {
      calls.push(["create-specialty", name]);
      return { id: "specialty-new", name };
    },
  };
  const service = createAdminService({ async findByUsername(username) { return username === account.username ? account : null; } }, doctors);
  return { service, calls };
}

test("Admin login issues an Admin-role session and rejects invalid credentials", async () => {
  const { service } = createFixture();
  const result = await service.login(" REVIEW-ADMIN ", "SecureAdminPass1");
  assert.equal(result.adminId, accountId);
  assert.deepEqual(verifyAuthToken(result.token), { userId: accountId, role: "admin" });
  await assert.rejects(service.login("review-admin", "WrongPassword1"), { code: "INVALID_CREDENTIALS" });
  await assert.rejects(service.login("unknown-admin", "SecureAdminPass1"), { code: "INVALID_CREDENTIALS" });
});

test("Admin login stops checking credentials after twenty failures for one username", async () => {
  let lookupCount = 0;
  const service = createAdminService({
    async findByUsername() {
      lookupCount += 1;
      return null;
    },
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await assert.rejects(service.login("locked-admin", "WrongPassword1"), { code: "INVALID_CREDENTIALS" });
  }
  assert.equal(lookupCount, 20);
  await assert.rejects(service.login("locked-admin", "WrongPassword1"), { code: "INVALID_CREDENTIALS" });
  assert.equal(lookupCount, 20);
});

test("Admin review delegates pending reads and decisions to Doctors with secure credential links", async () => {
  const { service, calls } = createFixture();
  const caller = { userId: accountId, role: "admin" as const };

  const applications = await service.listPendingApplications(caller);
  assert.equal(applications[0].credentials[0].href, "/api/doctors/credentials/credential-1");
  assert.equal("storageKey" in applications[0].credentials[0], false);
  assert.deepEqual(calls[0], ["list", caller]);

  assert.deepEqual(await service.decideApplication(caller, "doctor-1", "Rejected"), {
    doctorId: "doctor-1",
    fullName: "Dr. Asha Mehta",
    username: "asha_mehta1",
    verificationStatus: "Rejected",
    specialties: [{ id: "specialty-cardio", name: "Cardiology" }],
    credentials: [{ id: "credential-1", fileName: "degree.pdf", contentType: "application/pdf", sizeBytes: 100, createdAt: now }],
  });
  assert.deepEqual(calls[1], ["decide", caller, "doctor-1", "Rejected"]);
});

test("Admin catalog operations delegate active listing and creation to Doctors", async () => {
  const { service, calls } = createFixture();
  const caller = { userId: accountId, role: "admin" as const };

  assert.deepEqual(await service.listSpecialties(caller), [{ id: "specialty-cardio", name: "Cardiology" }]);
  assert.deepEqual(await service.addSpecialty(caller, "Rheumatology"), {
    id: "specialty-new",
    name: "Rheumatology",
  });
  assert.deepEqual(calls.slice(-2), [["list-specialties"], ["create-specialty", "Rheumatology"]]);
});

test("Admin service exposes only the current fee values to internal consumers", async () => {
  const standardCaseFee = new Prisma.Decimal("1000.00");
  const urgentCaseFee = new Prisma.Decimal("2000.00");
  const now = new Date();
  const service = createAdminService({
    async findByUsername() { return null; },
    async getPlatformSettings() {
      return {
        id: randomUUID(),
        standardCaseFee,
        urgentCaseFee,
        platformFeePercent: new Prisma.Decimal("20.00"),
        createdAt: now,
        updatedAt: now,
      };
    },
  });

  assert.deepEqual(await service.getPlatformSettings(), {
    standardCaseFee,
    urgentCaseFee,
    platformFeePercent: new Prisma.Decimal("20.00"),
  });
});

test("non-Admin callers cannot read or decide applications", async () => {
  const { service, calls } = createFixture();
  const caller = { userId: randomUUID(), role: "doctor" as const };
  await assert.rejects(service.listPendingApplications(caller), AdminAccessDeniedError);
  await assert.rejects(service.decideApplication(caller, "doctor-1", "Verified"), AdminAccessDeniedError);
  await assert.rejects(service.listSpecialties(caller), AdminAccessDeniedError);
  await assert.rejects(service.addSpecialty(caller, "Rheumatology"), AdminAccessDeniedError);
  assert.deepEqual(calls, []);
});

test("Admin seed requires operator credentials and normalizes the username", () => {
  assert.throws(() => getAdminSeedCredentials({}), /ADMIN_USERNAME and ADMIN_PASSWORD/);
  assert.throws(() => getAdminSeedCredentials({ ADMIN_USERNAME: "operator" }), /ADMIN_USERNAME and ADMIN_PASSWORD/);
  assert.throws(() => getAdminSeedCredentials({ ADMIN_USERNAME: "operator", ADMIN_PASSWORD: "        " }), /ADMIN_PASSWORD must be/);
  assert.throws(() => getAdminSeedCredentials({ ADMIN_USERNAME: "operator", ADMIN_PASSWORD: "weakpass" }), /ADMIN_PASSWORD must be/);
  assert.throws(() => getAdminSeedCredentials({ ADMIN_USERNAME: "o".repeat(101), ADMIN_PASSWORD: "Secret1!" }), /ADMIN_USERNAME must be/);
  assert.deepEqual(getAdminSeedCredentials({ ADMIN_USERNAME: " Operator ", ADMIN_PASSWORD: "Secret1!" }), {
    username: "operator",
    password: "Secret1!",
  });
});

test("Admin seed hashes the password and rotates the fixed account on rerun", async () => {
  const first = await buildAdminAccountUpsert({ username: "operator", password: "FirstPass1" });
  const second = await buildAdminAccountUpsert({ username: "new-operator", password: "SecondPass2" });

  assert.equal(first.where.id, first.create.id);
  assert.equal(second.where.id, first.where.id);
  assert.equal(second.update.username, "new-operator");
  assert.equal(await argon2.verify(second.update.passwordHash, "SecondPass2"), true);
  assert.equal(await argon2.verify(second.update.passwordHash, "FirstPass1"), false);
});

test("Admin settings updates validate every field before one atomic repository write", async () => {
  const caller = { userId: accountId, role: "admin" as const };
  let persisted = {
    standardCaseFee: new Prisma.Decimal("1000.00"),
    urgentCaseFee: new Prisma.Decimal("2000.00"),
    platformFeePercent: new Prisma.Decimal("20.00"),
  };
  const writes: unknown[] = [];
  const service = createAdminService({
    async findByUsername() { return null; },
    async getPlatformSettings() { return { ...persisted, id: randomUUID(), createdAt: now, updatedAt: now }; },
    async updatePlatformSettings(values) {
      writes.push(values);
      persisted = values;
      return { ...persisted, id: randomUUID(), createdAt: now, updatedAt: now };
    },
  });

  assert.deepEqual(await service.updatePlatformSettings(caller, {
    standardCaseFee: "1250.75",
    urgentCaseFee: "2500.25",
    platformFeePercent: "0.00",
  }), {
    standardCaseFee: "1250.75",
    urgentCaseFee: "2500.25",
    platformFeePercent: "0.00",
  });
  assert.equal(writes.length, 1);
  assert.ok((writes[0] as { standardCaseFee: Prisma.Decimal }).standardCaseFee instanceof Prisma.Decimal);

  for (const invalid of [
    { standardCaseFee: "0.00", urgentCaseFee: "1.00", platformFeePercent: "20.00" },
    { standardCaseFee: "1.001", urgentCaseFee: "1.00", platformFeePercent: "20.00" },
    { standardCaseFee: "1.00", urgentCaseFee: "-1.00", platformFeePercent: "20.00" },
    { standardCaseFee: "1.00", urgentCaseFee: "1.00", platformFeePercent: "100.01" },
    { standardCaseFee: "1.00", urgentCaseFee: "1.00", platformFeePercent: "1e1" },
  ]) {
    await assert.rejects(service.updatePlatformSettings(caller, invalid), { code: "VALIDATION_ERROR" });
  }
  assert.equal(writes.length, 1);
  assert.deepEqual(await service.getAdminPlatformSettings(caller), {
    standardCaseFee: "1250.75",
    urgentCaseFee: "2500.25",
    platformFeePercent: "0.00",
  });
});

test("Admin settings accept exact maximum fee and inclusive platform-fee endpoints", async () => {
  const caller = { userId: accountId, role: "admin" as const };
  let persisted = {
    standardCaseFee: new Prisma.Decimal("1000.00"),
    urgentCaseFee: new Prisma.Decimal("2000.00"),
    platformFeePercent: new Prisma.Decimal("20.00"),
  };
  const service = createAdminService({
    async findByUsername() { return null; },
    async updatePlatformSettings(values) {
      persisted = values;
      return { ...values, id: randomUUID(), createdAt: now, updatedAt: now };
    },
  });

  assert.deepEqual(await service.updatePlatformSettings(caller, {
    standardCaseFee: "99999999.99",
    urgentCaseFee: "0.01",
    platformFeePercent: "100.00",
  }), {
    standardCaseFee: "99999999.99",
    urgentCaseFee: "0.01",
    platformFeePercent: "100.00",
  });
  assert.deepEqual(await service.updatePlatformSettings(caller, {
    standardCaseFee: "0.01",
    urgentCaseFee: "99999999.99",
    platformFeePercent: "0.00",
  }), {
    standardCaseFee: "0.01",
    urgentCaseFee: "99999999.99",
    platformFeePercent: "0.00",
  });
  await assert.rejects(service.updatePlatformSettings(caller, {
    standardCaseFee: "100000000.00",
    urgentCaseFee: "1.00",
    platformFeePercent: "20.00",
  }), { code: "VALIDATION_ERROR" });
  assert.equal(persisted.standardCaseFee.toFixed(2), "0.01");
});

test("Admin settings are available only to an Admin and failed persistence preserves the prior values", async () => {
  const existing = {
    standardCaseFee: new Prisma.Decimal("1000.00"),
    urgentCaseFee: new Prisma.Decimal("2000.00"),
    platformFeePercent: new Prisma.Decimal("20.00"),
  };
  const service = createAdminService({
    async findByUsername() { return null; },
    async getPlatformSettings() { return { ...existing, id: randomUUID(), createdAt: now, updatedAt: now }; },
    async updatePlatformSettings() { throw new Error("database unavailable"); },
  });
  const caller = { userId: randomUUID(), role: "doctor" as const };
  await assert.rejects(service.getAdminPlatformSettings(caller), AdminAccessDeniedError);
  await assert.rejects(service.updatePlatformSettings(caller, {
    standardCaseFee: "1500.00", urgentCaseFee: "2500.00", platformFeePercent: "25.00",
  }), AdminAccessDeniedError);
  await assert.rejects(service.updatePlatformSettings({ userId: accountId, role: "admin" }, {
    standardCaseFee: "1500.00", urgentCaseFee: "2500.00", platformFeePercent: "25.00",
  }), /database unavailable/);
  assert.deepEqual(existing, {
    standardCaseFee: new Prisma.Decimal("1000.00"),
    urgentCaseFee: new Prisma.Decimal("2000.00"),
    platformFeePercent: new Prisma.Decimal("20.00"),
  });
});