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