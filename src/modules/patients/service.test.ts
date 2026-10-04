import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { OtpProvider } from "../../shared/otp-provider";
import type { Patient } from "./domain";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";

const { createPatientsService } = await import("./service");
const { patientsRepository } = await import("./repository");
const { POST: startRegistrationPost } = await import("../../app/api/patients/register/start/route");
const { POST: verifyRegistrationPost } = await import("../../app/api/patients/register/verify/route");

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
        passwordHash: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      patients.set(mobileNumber, patient);
      return patient;
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

test("starts registration and creates a passwordless patient after valid OTP", async () => {
  const fixture = createFixture();
  const mobileNumber = uniqueMobileNumber();
  const otp = await fixture.service.startRegistration(mobileNumber);

  assert.equal(otp.otpId, "otp-1");
  assert.ok(otp.expiresAt instanceof Date);
  const patient = await fixture.service.verifyRegistration(mobileNumber, otp.otpId, "123456");
  assert.equal(patient.mobileNumber, mobileNumber.slice(1));
  assert.equal(patient.passwordHash, null);
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
    passwordHash: null,
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

test("registration route returns typed validation and duplicate error responses", async () => {
  const originalFindByMobileNumber = patientsRepository.findByMobileNumber;
  const mobileNumber = uniqueMobileNumber();
  patientsRepository.findByMobileNumber = async () => ({
    id: randomUUID(),
    mobileNumber,
    passwordHash: null,
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