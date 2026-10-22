import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client";
import type { AuthContext } from "../../shared/auth-context";
import type { StorageProvider } from "../../shared/storage-provider";
import type { CaseDocumentRecord, CaseDocumentUpload, CaseDraftInput, CaseRecord } from "./domain";
import type { PaymentAttempt } from "../payments/domain";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";
process.env.JWT_SECRET ??= "cases-auth-test-secret";

const { createCasesService } = await import("./service");
const { casesRepository } = await import("./repository");
const { prisma } = await import("../../shared/prisma-client");
const { PaymentDeclinedError } = await import("../payments/domain");
const { CASE_RESPONSE_SLA_MS, computeElapsedSlaTime } = await import("./domain/sla");

const PATIENT: AuthContext = { userId: "patient-a", role: "patient" };
const OTHER_PATIENT: AuthContext = { userId: "patient-b", role: "patient" };
const ADMIN: AuthContext = { userId: "admin-a", role: "admin" };
const DOCTOR: AuthContext = { userId: "doctor-a", role: "doctor" };
const VERIFIED_DOCTOR: AuthContext = { userId: "doctor-verified", role: "doctor" };

const VALID_INPUT: CaseDraftInput = {
	affectedBodyArea: "Left knee",
	condition: "Pain and swelling after a sports injury.",
	recommendation: "Arthroscopy was recommended.",
	additionalDetails: "Symptoms began six weeks ago.",
};

function upload(contentType = "application/pdf", bytes = new TextEncoder().encode("%PDF-1.7 report"), fileName = "report.pdf"): CaseDocumentUpload {
	return { contentType, bytes, fileName };
}

function createFixture(options: {
	failSaveAt?: number;
	failDocumentPersistence?: boolean;
	failDelete?: boolean;
	failSubmissionPersistence?: boolean;
	failPayment?: boolean;
	failSettings?: boolean;
	standardCaseFee?: string;
	urgentCaseFee?: string;
} = {}) {
	const cases = new Map<string, CaseRecord>();
		const requestCases = new Map<string, string>();
	const documents = new Map<string, CaseDocumentRecord>();
	const files = new Map<string, Uint8Array>();
	let saveCalls = 0;
	let readCalls = 0;
	let failDelete = options.failDelete ?? false;
	let failSubmissionPersistence = options.failSubmissionPersistence ?? false;
	let failPayment = options.failPayment ?? false;
	let failSettings = options.failSettings ?? false;
	let standardCaseFee = options.standardCaseFee ?? "1000.00";
	let urgentCaseFee = options.urgentCaseFee ?? "2000.00";
	let chargeCalls = 0;
	const attempts = new Map<string, PaymentAttempt>();
	const deleteCalls: string[] = [];

	const repository = {
		async createDraft(patientId: string, creationRequestId: string, input: Required<CaseDraftInput>): Promise<CaseRecord> {
			if (requestCases.has(creationRequestId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
			const now = new Date();
			const record: CaseRecord = {
				id: randomUUID(), patientId, doctorId: null, specialtyId: null, ...input, selectedDoctorId: null, urgencyTier: null, chargedAmount: null, status: "Draft", submittedAt: null, slaPauseHistory: [], assignmentLockVersion: 0, documents: [], createdAt: now, updatedAt: now,
			};
			cases.set(record.id, record);
			requestCases.set(creationRequestId, record.id);
			return record;
		},
		async findByCreationRequestId(creationRequestId: string): Promise<CaseRecord | null> {
			const caseId = requestCases.get(creationRequestId);
			return caseId ? cases.get(caseId) ?? null : null;
		},
		async findLatestDraft(patientId: string): Promise<CaseRecord | null> {
			return [...cases.values()].filter((record) => record.patientId === patientId && record.status === "Draft")
				.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null;
		},
		async updateDraft(caseId: string, patientId: string, input: Required<CaseDraftInput>): Promise<CaseRecord | null> {
			const record = cases.get(caseId);
			if (!record || record.patientId !== patientId || record.status !== "Draft") return null;
			const updated = { ...record, ...input, updatedAt: new Date() };
			cases.set(caseId, updated);
			return updated;
		},
		async updateDraftDoctorSelection(caseId: string, patientId: string, selectedDoctorId: string | null): Promise<CaseRecord | null> {
			const record = cases.get(caseId);
			if (!record || record.patientId !== patientId || record.status !== "Draft") return null;
			const updated = { ...record, selectedDoctorId, updatedAt: new Date() };
			cases.set(caseId, updated);
			return updated;
		},
		async updateCaseToSubmitted(
			caseId: string,
			patientId: string,
			urgencyTier: "Standard" | "Urgent",
			chargedAmount: CaseRecord["chargedAmount"] & {},
			doctorId: string | null,
			submittedAt: Date,
		): Promise<CaseRecord | null> {
			if (failSubmissionPersistence) throw new Error("case submission persistence failed");
			const record = cases.get(caseId);
			if (!record || record.patientId !== patientId || record.status !== "Draft" || !chargedAmount) return null;
			const updated = { ...record, urgencyTier, chargedAmount, doctorId, selectedDoctorId: doctorId, status: "Submitted" as const, submittedAt, updatedAt: new Date() };
			cases.set(caseId, updated);
			return updated;
		},
		async findById(caseId: string): Promise<CaseRecord | null> {
			return cases.get(caseId) ?? null;
		},
		async listUnclassifiedSubmittedCases(): Promise<CaseRecord[]> {
			return [...cases.values()].filter((record) => record.status === "Submitted" && record.specialtyId === null);
		},
		async listDoctorQueue(specialtyIds: string[], doctorId: string): Promise<CaseRecord[]> {
			return [...cases.values()].filter((record) => specialtyIds.includes(record.specialtyId ?? "")
				&& ["Submitted", "UnderReview", "MoreInfoRequested"].includes(record.status)
				&& record.submittedAt !== null
				&& (record.doctorId === null || record.doctorId === doctorId));
		},
		async classifySubmittedCase(caseId: string, specialtyId: string, expectedVersion: number, clearDoctorAssignment: boolean): Promise<CaseRecord | null> {
			const record = cases.get(caseId);
			if (!record || record.status !== "Submitted" || record.specialtyId !== null || record.assignmentLockVersion !== expectedVersion) return null;
			const updated = {
				...record,
				specialtyId,
				doctorId: clearDoctorAssignment ? null : record.doctorId,
				assignmentLockVersion: record.assignmentLockVersion + 1,
			};
			cases.set(caseId, updated);
			return updated;
		},
		async findDoctorVisibleCase(caseId: string, specialtyIds: string[], doctorId: string): Promise<CaseRecord | null> {
			const record = cases.get(caseId);
			return record && specialtyIds.includes(record.specialtyId ?? "")
				&& ["Submitted", "UnderReview", "MoreInfoRequested"].includes(record.status)
				&& record.submittedAt !== null
				&& (record.doctorId === null || record.doctorId === doctorId) ? record : null;
		},
		async createDocuments(caseId: string, newDocuments: Omit<CaseDocumentRecord, "id" | "caseId" | "createdAt">[]): Promise<CaseDocumentRecord[]> {
			if (options.failDocumentPersistence) throw new Error("document persistence failed");
			const created = newDocuments.map((document) => ({
				...document, id: randomUUID(), caseId, createdAt: new Date(),
			}));
			created.forEach((document) => documents.set(document.id, document));
			const record = cases.get(caseId);
			if (record) cases.set(caseId, { ...record, documents: [...record.documents, ...created] });
			return created;
		},
		async findDocumentById(documentId: string) {
			const document = documents.get(documentId);
			const record = document ? cases.get(document.caseId) : null;
			return document && record ? {
				...document,
				case: { patientId: record.patientId, doctorId: record.doctorId, specialtyId: record.specialtyId },
			} : null;
		},
		async deleteDocument(documentId: string): Promise<void> {
			const document = documents.get(documentId);
			documents.delete(documentId);
			const record = document ? cases.get(document.caseId) : null;
			if (document && record) {
				cases.set(record.id, { ...record, documents: record.documents.filter(({ id }) => id !== documentId) });
			}
		},
	};

	const storage: StorageProvider = {
		async save(bytes) {
			saveCalls += 1;
			if (options.failSaveAt === saveCalls) throw new Error("storage save failed");
			const storageKey = randomUUID();
			files.set(storageKey, Uint8Array.from(bytes));
			return { storageKey };
		},
		async read(storageKey) {
			readCalls += 1;
			const bytes = files.get(storageKey);
			return bytes ? Uint8Array.from(bytes) : null;
		},
		async delete(storageKey) {
			deleteCalls.push(storageKey);
			if (failDelete) throw new Error("storage delete failed");
			files.delete(storageKey);
		},
	};
	const verifiedDirectory = [{
		id: "doctor-verified",
		fullName: "Dr. Visible",
		specialties: ["Cardiology"],
	}];
	let doctorLookupCalls = 0;
	const doctors = {
		async listVerifiedDoctors() {
			return verifiedDirectory;
		},
		async getVerifiedDoctor(doctorId: string) {
			doctorLookupCalls += 1;
			if (doctorId !== "doctor-verified") return null;
			const now = new Date();
			return {
				id: doctorId,
				mobileNumber: "private-mobile",
				fullName: "Dr. Visible",
				username: "private-username",
				verificationStatus: "Verified" as const,
				createdAt: now,
				updatedAt: now,
			};
		},
		async getVerifiedDoctorSpecialtyIds(doctorId: string): Promise<string[] | null> {
			return doctorId === "doctor-verified" ? ["specialty-cardiology"] : null;
		},
		async listActiveSpecialties() {
			return [{ id: "specialty-cardiology", name: "Cardiology" }, { id: "specialty-neurology", name: "Neurology" }];
		},
	};
	const admin = {
		async getPlatformSettings() {
			if (failSettings) throw new Error("platform settings unavailable");
			return {
				standardCaseFee: new Prisma.Decimal(standardCaseFee),
				urgentCaseFee: new Prisma.Decimal(urgentCaseFee),
			};
		},
	};
	const payments = {
		async findAttemptByCaseId(caseId: string) {
			return attempts.get(caseId) ?? null;
		},
		async prepareAttempt(input: Omit<PaymentAttempt, "id" | "idempotencyKey" | "transactionId" | "status" | "providerError" | "createdAt" | "updatedAt">) {
			const existing = attempts.get(input.caseId);
			if (existing && existing.status !== "Failed") return existing;
			const now = new Date();
			const attempt: PaymentAttempt = {
				...input,
				id: existing?.id ?? randomUUID(),
				idempotencyKey: randomUUID(),
				transactionId: null,
				status: "Pending",
				providerError: null,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
			};
			attempts.set(input.caseId, attempt);
			return attempt;
		},
		async chargeAttempt(attempt: PaymentAttempt) {
			chargeCalls += 1;
			if (failPayment) {
				attempts.set(attempt.caseId, { ...attempt, status: "Failed", providerError: "declined" });
				throw new PaymentDeclinedError();
			}
			const succeeded = { ...attempt, status: "Succeeded" as const, transactionId: randomUUID(), updatedAt: new Date() };
			attempts.set(attempt.caseId, succeeded);
			return succeeded;
		},
	};

	return {
		cases,
		documents,
		files,
		deleteCalls,
		get saveCalls() { return saveCalls; },
		get readCalls() { return readCalls; },
		get doctorLookupCalls() { return doctorLookupCalls; },
		get chargeCalls() { return chargeCalls; },
		attempts,
		setFailDelete(value: boolean) { failDelete = value; },
		setFailSubmissionPersistence(value: boolean) { failSubmissionPersistence = value; },
		setFailPayment(value: boolean) { failPayment = value; },
		setFailSettings(value: boolean) { failSettings = value; },
		setFees(standard: string, urgent: string) { standardCaseFee = standard; urgentCaseFee = urgent; },
		repository,
		service: createCasesService(repository, storage, doctors, admin, payments),
	};
}

async function createSubmittedCase(
	fixture: ReturnType<typeof createFixture>,
	urgencyTier: "Standard" | "Urgent" = "Standard",
	doctorId: string | null = null,
) {
	const draft = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	await fixture.service.uploadDocuments(PATIENT, draft.id, [upload()]);
	await fixture.service.submitCase(PATIENT, draft.id, urgencyTier, doctorId);
	return fixture.cases.get(draft.id)!;
}

test("SLA arithmetic starts at submission, excludes completed and open pauses, and caps at the 120-hour boundary", () => {
	const submittedAt = new Date("2026-01-01T00:00:00.000Z");
	const now = new Date(submittedAt.getTime() + CASE_RESPONSE_SLA_MS);
	const caseRecord = {
		submittedAt,
		slaPauseHistory: [
			{ pausedAt: "2026-01-02T00:00:00.000Z", resumedAt: "2026-01-03T00:00:00.000Z" },
			{ pausedAt: "2026-01-04T00:00:00.000Z", resumedAt: null },
		],
	};
	assert.equal(computeElapsedSlaTime({ submittedAt, slaPauseHistory: [] }, now), CASE_RESPONSE_SLA_MS);
	assert.equal(computeElapsedSlaTime(caseRecord, now), 48 * 60 * 60 * 1000);
	assert.equal(computeElapsedSlaTime({
		submittedAt,
		slaPauseHistory: [
			{ pausedAt: new Date(submittedAt.getTime() + 60 * 60 * 1000).toISOString(), resumedAt: new Date(submittedAt.getTime() + 6 * 60 * 60 * 1000).toISOString() },
			{ pausedAt: new Date(submittedAt.getTime() + 4 * 60 * 60 * 1000).toISOString(), resumedAt: new Date(submittedAt.getTime() + 8 * 60 * 60 * 1000).toISOString() },
		],
	}, new Date(submittedAt.getTime() + 10 * 60 * 60 * 1000)), 3 * 60 * 60 * 1000);
	assert.equal(computeElapsedSlaTime({ submittedAt: null, slaPauseHistory: [] }, now), null);
});

test("Admin classification uses an active Specialty and atomically clears only an incompatible assignment", async () => {
	const fixture = createFixture();
	const record = await createSubmittedCase(fixture, "Urgent", "doctor-verified");
	const submittedAt = record.submittedAt;
	const unclassified = await fixture.service.listUnclassifiedSubmittedCases(ADMIN);
	assert.equal(unclassified.length, 1);
	assert.equal(unclassified[0].recommendation, VALID_INPUT.recommendation);
	assert.equal(unclassified[0].assignedDoctorName, "Dr. Visible");
	assert.equal(unclassified[0].documents[0].id, record.documents[0].id);
	await assert.rejects(fixture.service.listUnclassifiedSubmittedCases(DOCTOR), { code: "CASE_ADMIN_ACCESS_DENIED" });
	await assert.rejects(fixture.service.classifySubmittedCase(ADMIN, record.id, "specialty-inactive"), { code: "VALIDATION_ERROR" });

	const classified = await fixture.service.classifySubmittedCase(ADMIN, record.id, "specialty-neurology");
	assert.deepEqual(classified, {
		id: record.id,
		specialtyId: "specialty-neurology",
		doctorId: null,
		selectedDoctorId: "doctor-verified",
		submittedAt: submittedAt?.toISOString(),
	});
	assert.equal(fixture.cases.get(record.id)?.assignmentLockVersion, 1);
	assert.equal(fixture.cases.get(record.id)?.submittedAt, submittedAt);
	assert.equal((await fixture.service.listUnclassifiedSubmittedCases(ADMIN)).length, 0);
	await assert.rejects(fixture.service.classifySubmittedCase(ADMIN, record.id, "specialty-cardiology"), { code: "CASE_CLASSIFICATION_CONFLICT" });

	const compatibleFixture = createFixture();
	const compatibleRecord = await createSubmittedCase(compatibleFixture, "Urgent", "doctor-verified");
	const compatible = await compatibleFixture.service.classifySubmittedCase(ADMIN, compatibleRecord.id, "specialty-cardiology");
	assert.equal(compatible.doctorId, "doctor-verified");
	assert.equal(compatible.selectedDoctorId, "doctor-verified");
	assert.equal(compatibleFixture.cases.get(compatibleRecord.id)?.assignmentLockVersion, 1);

	const racedFixture = createFixture();
	const racedRecord = await createSubmittedCase(racedFixture);
	racedFixture.repository.classifySubmittedCase = async () => null;
	await assert.rejects(racedFixture.service.classifySubmittedCase(ADMIN, racedRecord.id, "specialty-cardiology"), { code: "CASE_CLASSIFICATION_CONFLICT" });
});

test("Doctor queue filters classification, specialty, status, and assignment, with Urgent first and shortest SLA next", async () => {
	const fixture = createFixture();
	const urgent = await createSubmittedCase(fixture, "Urgent");
	const standardDueSoon = await createSubmittedCase(fixture);
	const standardLater = await createSubmittedCase(fixture);
	const assignedElsewhere = await createSubmittedCase(fixture);
	const otherSpecialty = await createSubmittedCase(fixture);
	const unclassified = await createSubmittedCase(fixture);
	for (const record of [urgent, standardDueSoon, standardLater, assignedElsewhere]) {
		await fixture.service.classifySubmittedCase(ADMIN, record.id, "specialty-cardiology");
	}
	await fixture.service.classifySubmittedCase(ADMIN, otherSpecialty.id, "specialty-neurology");
	const now = new Date();
	fixture.cases.set(standardDueSoon.id, { ...fixture.cases.get(standardDueSoon.id)!, submittedAt: new Date(now.getTime() - 119 * 60 * 60 * 1000) });
	fixture.cases.set(standardLater.id, { ...fixture.cases.get(standardLater.id)!, submittedAt: new Date(now.getTime() - 30 * 60 * 60 * 1000), status: "UnderReview" });
	fixture.cases.set(assignedElsewhere.id, { ...fixture.cases.get(assignedElsewhere.id)!, doctorId: "doctor-other" });

	const queue = await fixture.service.listDoctorQueue(VERIFIED_DOCTOR);
	assert.deepEqual(queue.map(({ id }) => id), [urgent.id, standardDueSoon.id, standardLater.id]);
	assert.equal(queue[0].urgencyTier, "Urgent");
	assert.equal(queue[1].remainingSlaMs! < queue[2].remainingSlaMs!, true);
	assert.equal(queue.some(({ id }) => id === unclassified.id || id === otherSpecialty.id || id === assignedElsewhere.id), false);
	assert.equal((await fixture.service.getDoctorCase(VERIFIED_DOCTOR, urgent.id)).id, urgent.id);
	await assert.rejects(fixture.service.listDoctorQueue(DOCTOR), { code: "CASE_DOCTOR_ACCESS_DENIED" });
	await assert.rejects(fixture.service.getDoctorCase(VERIFIED_DOCTOR, otherSpecialty.id), { code: "CASE_NOT_FOUND" });
	await assert.rejects(fixture.service.getDoctorCase(VERIFIED_DOCTOR, assignedElsewhere.id), { code: "CASE_NOT_FOUND" });
	await assert.rejects(fixture.service.getDoctorCase(VERIFIED_DOCTOR, unclassified.id), { code: "CASE_NOT_FOUND" });
});

test("Doctor Document reads require current verification, matching Specialty, and current assignment before storage", async () => {
	const fixture = createFixture();
	const assigned = await createSubmittedCase(fixture, "Standard", "doctor-verified");
	await fixture.service.classifySubmittedCase(ADMIN, assigned.id, "specialty-cardiology");
	const assignedDocument = assigned.documents[0];
	assert.equal(new TextDecoder().decode((await fixture.service.getDocument(assignedDocument.id, VERIFIED_DOCTOR)).bytes), "%PDF-1.7 report");
	assert.equal(fixture.readCalls, 1);

	const unassigned = await createSubmittedCase(fixture);
	await fixture.service.classifySubmittedCase(ADMIN, unassigned.id, "specialty-cardiology");
	await assert.rejects(fixture.service.getDocument(unassigned.documents[0].id, VERIFIED_DOCTOR), { code: "CASE_DOCUMENT_NOT_FOUND" });

	const wrongSpecialty = await createSubmittedCase(fixture);
	await fixture.service.classifySubmittedCase(ADMIN, wrongSpecialty.id, "specialty-neurology");
	fixture.cases.set(wrongSpecialty.id, { ...fixture.cases.get(wrongSpecialty.id)!, doctorId: "doctor-verified" });
	await assert.rejects(fixture.service.getDocument(wrongSpecialty.documents[0].id, VERIFIED_DOCTOR), { code: "CASE_DOCUMENT_NOT_FOUND" });
	assert.equal(fixture.readCalls, 1);
});

test("Patient Doctor directory is verified-only and returns only approved display fields", async () => {
	const fixture = createFixture();
	assert.deepEqual(await fixture.service.listVerifiedDoctors(PATIENT), [{
		id: "doctor-verified",
		fullName: "Dr. Visible",
		specialties: ["Cardiology"],
	}]);
	await assert.rejects(fixture.service.listVerifiedDoctors(DOCTOR), { code: "SESSION_UNAUTHORIZED" });
});

test("Doctor preference saves, restores, rejects stale IDs, and can be cleared without assignment", async () => {
	const fixture = createFixture();
	const created = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	assert.equal(created.selectedDoctorId, null);

	const selected = await fixture.service.saveDraftDoctorSelection(PATIENT, created.id, "doctor-verified");
	assert.equal(selected.selectedDoctorId, "doctor-verified");
	assert.equal(fixture.cases.get(created.id)?.selectedDoctorId, "doctor-verified");
	assert.equal(selected.doctorId, null);
	assert.equal((await fixture.service.getOwnDraft(PATIENT))?.selectedDoctorId, "doctor-verified");
	const normalized = await fixture.service.saveDraftDoctorSelection(PATIENT, created.id, " doctor-verified ");
	assert.equal(normalized.selectedDoctorId, "doctor-verified");

	for (const doctorId of ["doctor-pending", "doctor-rejected", "doctor-unknown"]) {
		await assert.rejects(fixture.service.saveDraftDoctorSelection(PATIENT, created.id, doctorId), {
			code: "CASE_DOCTOR_SELECTION_CONFLICT",
			message: "The selected Doctor is not verified or available. Choose another Doctor or continue without a preference.",
		});
		assert.equal(fixture.cases.get(created.id)?.selectedDoctorId, "doctor-verified");
	}

	const lookupsBeforeForeignWrite = fixture.doctorLookupCalls;
	await assert.rejects(fixture.service.saveDraftDoctorSelection(OTHER_PATIENT, created.id, "doctor-verified"), {
		code: "CASE_ACCESS_DENIED",
	});
	assert.equal(fixture.doctorLookupCalls, lookupsBeforeForeignWrite);

	const cleared = await fixture.service.saveDraftDoctorSelection(PATIENT, created.id, null);
	assert.equal(cleared.selectedDoctorId, null);
	assert.equal(fixture.cases.get(created.id)?.selectedDoctorId, null);
	assert.equal((await fixture.service.getOwnDraft(PATIENT))?.selectedDoctorId, null);
});

test("Patient draft create and update use the verified session owner and preserve only Draft state", async () => {
	const fixture = createFixture();
	const created = await fixture.service.saveDraft(PATIENT, { ...VALID_INPUT, patientId: "caller-controlled" } as CaseDraftInput);
	assert.equal(fixture.cases.get(created.id)?.patientId, PATIENT.userId);
	assert.equal(created.status, "Draft");
	assert.equal("patientId" in created, false);

	const updated = await fixture.service.saveDraft(PATIENT, { ...VALID_INPUT, condition: "Updated diagnosis." }, created.id);
	assert.equal(updated.condition, "Updated diagnosis.");
	assert.equal((await fixture.service.getOwnDraft(PATIENT))?.id, created.id);
	await assert.rejects(fixture.service.saveDraft(OTHER_PATIENT, VALID_INPUT, created.id), { code: "CASE_ACCESS_DENIED" });
	await assert.rejects(fixture.service.getOwnDraft(DOCTOR), { code: "SESSION_UNAUTHORIZED" });
});

test("retrying draft creation reuses the Patient's current draft", async () => {
	const fixture = createFixture();
	const first = await fixture.service.saveDraft(PATIENT, VALID_INPUT, undefined, "draft-request-1");
	const retry = await fixture.service.saveDraft(PATIENT, { ...VALID_INPUT, condition: "Updated after retry." }, undefined, "draft-request-1");
	assert.equal(retry.id, first.id);
	assert.equal(fixture.cases.size, 1);
	assert.equal(retry.condition, "Updated after retry.");
});

test("payment readiness stays blocked until a valid supporting Document is attached", async () => {
	const fixture = createFixture();
	const draft = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	await assert.rejects(fixture.service.assertPaymentReady(PATIENT, draft.id), { code: "CASE_DOCUMENT_REQUIRED" });
	assert.equal((await fixture.service.getOwnDraft(PATIENT))?.status, "Draft");

	await fixture.service.uploadDocuments(PATIENT, draft.id, [upload()]);
	assert.deepEqual(await fixture.service.assertPaymentReady(PATIENT, draft.id), { caseId: draft.id, ready: true });
});

test("fee settings failure prevents payment and leaves the Case Draft", async () => {
	const fixture = createFixture({ failSettings: true });
	const draft = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	await fixture.service.uploadDocuments(PATIENT, draft.id, [upload()]);

	await assert.rejects(fixture.service.submitCase(PATIENT, draft.id, "Standard"), /platform settings unavailable/);
	assert.equal(fixture.chargeCalls, 0);
	assert.equal(fixture.attempts.has(draft.id), false);
	assert.equal(fixture.cases.get(draft.id)?.status, "Draft");
});

test("submission requires a Document, charges the current selected fee, snapshots it, and treats duplicates idempotently", async () => {
	const fixture = createFixture();
	const missingDocument = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	await assert.rejects(fixture.service.submitCase(PATIENT, missingDocument.id, "Standard"), { code: "CASE_DOCUMENT_REQUIRED" });
	assert.equal(fixture.chargeCalls, 0);

	const standardDraft = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	await fixture.service.uploadDocuments(PATIENT, standardDraft.id, [upload()]);
	assert.deepEqual(await fixture.service.getPaymentOptions(PATIENT), { standardCaseFee: "1000.00", urgentCaseFee: "2000.00" });
	const standard = await fixture.service.submitCase(PATIENT, standardDraft.id, "Standard");
	assert.deepEqual(standard, {
		caseId: standardDraft.id,
		doctorId: null,
		urgencyTier: "Standard",
		chargedAmount: "1000.00",
		selectedDoctorId: null,
		status: "Submitted",
	});
	assert.equal(fixture.cases.get(standardDraft.id)?.status, "Submitted");

	fixture.setFees("1250.75", "2500.25");
	const urgentDraft = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	await fixture.service.uploadDocuments(PATIENT, urgentDraft.id, [upload()]);
	const urgent = await fixture.service.submitCase(PATIENT, urgentDraft.id, "Urgent", "doctor-verified");
	assert.equal(urgent.chargedAmount, "2500.25");
	assert.equal(urgent.urgencyTier, "Urgent");
	assert.equal(urgent.doctorId, "doctor-verified");
	assert.equal(fixture.cases.get(urgentDraft.id)?.selectedDoctorId, "doctor-verified");
	assert.equal(fixture.cases.get(urgentDraft.id)?.doctorId, "doctor-verified");
	assert.equal(fixture.cases.get(standardDraft.id)?.chargedAmount?.toFixed(2), "1000.00");
	assert.equal(fixture.chargeCalls, 2);

	const duplicate = await fixture.service.submitCase(PATIENT, standardDraft.id, "Urgent");
	assert.equal(duplicate.chargedAmount, "1000.00");
	assert.equal(fixture.chargeCalls, 2);
	await assert.rejects(fixture.service.submitCase(OTHER_PATIENT, standardDraft.id, "Standard"), { code: "CASE_ACCESS_DENIED" });
});

test("failed payment keeps the Case Draft and restores urgency and Doctor choice for retry", async () => {
	const fixture = createFixture({ failPayment: true });
	const draft = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	await fixture.service.uploadDocuments(PATIENT, draft.id, [upload()]);
	await assert.rejects(fixture.service.submitCase(PATIENT, draft.id, "Urgent", "doctor-verified"), { code: "PAYMENT_DECLINED" });
	assert.equal(fixture.cases.get(draft.id)?.status, "Draft");
	assert.equal(fixture.cases.get(draft.id)?.urgencyTier, null);
	assert.equal(fixture.attempts.get(draft.id)?.status, "Failed");
	const restoredDraft = await fixture.service.getOwnDraft(PATIENT);
	assert.equal(restoredDraft?.urgencyTier, "Urgent");
	assert.equal(restoredDraft?.selectedDoctorId, "doctor-verified");
	assert.equal(restoredDraft?.paymentAttemptStatus, "Failed");
	assert.equal(restoredDraft?.chargedAmount, null);
	await fixture.service.saveDraftDoctorSelection(PATIENT, draft.id, null);
	assert.equal((await fixture.service.getOwnDraft(PATIENT))?.selectedDoctorId, null);

	fixture.setFailPayment(false);
	fixture.setFees("1200.00", "2200.00");
	const retried = await fixture.service.submitCase(PATIENT, draft.id, "Urgent");
	assert.equal(retried.chargedAmount, "2200.00");
	assert.equal(retried.selectedDoctorId, null);
	assert.equal(fixture.chargeCalls, 2);
});

test("stale Doctor preference blocks charging and confirmed payment recovers Case finalization without another charge", async () => {
	const staleDoctor = createFixture();
	const staleDraft = await staleDoctor.service.saveDraft(PATIENT, VALID_INPUT);
	await staleDoctor.service.uploadDocuments(PATIENT, staleDraft.id, [upload()]);
	await assert.rejects(staleDoctor.service.submitCase(PATIENT, staleDraft.id, "Standard", "doctor-pending"), { code: "CASE_DOCTOR_SELECTION_CONFLICT" });
	assert.equal(staleDoctor.chargeCalls, 0);
	assert.equal(staleDoctor.cases.get(staleDraft.id)?.status, "Draft");

	const recovery = createFixture({ failSubmissionPersistence: true });
	const recoveryDraft = await recovery.service.saveDraft(PATIENT, VALID_INPUT);
	const recoveryDocuments = await recovery.service.uploadDocuments(PATIENT, recoveryDraft.id, [upload()]);
	await assert.rejects(recovery.service.submitCase(PATIENT, recoveryDraft.id, "Urgent"), { code: "PAYMENT_RECOVERY_REQUIRED" });
	assert.equal(recovery.attempts.get(recoveryDraft.id)?.status, "Succeeded");
	assert.equal(recovery.cases.get(recoveryDraft.id)?.status, "Draft");
	assert.equal(recovery.chargeCalls, 1);
	const recoverableDraft = await recovery.service.getOwnDraft(PATIENT);
	assert.equal(recoverableDraft?.paymentAttemptStatus, "Succeeded");
	assert.equal(recoverableDraft?.chargedAmount, "2000.00");
	const paymentSucceededAt = recovery.attempts.get(recoveryDraft.id)?.updatedAt;
	assert.ok(paymentSucceededAt);
	const recoveryRecord = recovery.cases.get(recoveryDraft.id);
	assert.ok(recoveryRecord);
	recovery.cases.set(recoveryDraft.id, { ...recoveryRecord, documents: [] });
	await assert.rejects(recovery.service.saveDraft(PATIENT, VALID_INPUT, recoveryDraft.id), { code: "CASE_SUBMISSION_CONFLICT" });
	await assert.rejects(recovery.service.saveDraftDoctorSelection(PATIENT, recoveryDraft.id, "doctor-verified"), { code: "CASE_SUBMISSION_CONFLICT" });
	await assert.rejects(recovery.service.deleteDocument(recoveryDocuments[0].id, PATIENT), { code: "CASE_SUBMISSION_CONFLICT" });
	assert.equal(recovery.deleteCalls.length, 0);

	recovery.setFailSubmissionPersistence(false);
	const finalized = await recovery.service.submitCase(PATIENT, recoveryDraft.id, "Standard");
	assert.equal(finalized.urgencyTier, "Urgent");
	assert.equal(finalized.chargedAmount, "2000.00");
	assert.equal(recovery.cases.get(recoveryDraft.id)?.submittedAt, paymentSucceededAt);
	assert.equal(recovery.chargeCalls, 1);
});

test("JPEG, PNG, and PDF uploads validate signatures and accept five files at the 10 MiB boundary", async () => {
	const fixture = createFixture();
	const draft = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	const jpeg = upload("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "scan.jpg");
	const png = upload("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "scan.png");
	const pdf = upload();
	const exactLimit = new Uint8Array(10 * 1024 * 1024);
	exactLimit.set([0xff, 0xd8, 0xff]);
	const exactSizeJpeg = upload("image/jpeg", exactLimit, "large-scan.jpg");
	const saved = await fixture.service.uploadDocuments(PATIENT, draft.id, [jpeg, png, pdf, exactSizeJpeg, pdf]);
	assert.equal(saved.length, 5);
	assert.deepEqual(saved.map(({ contentType }) => contentType), [
		"image/jpeg", "image/png", "application/pdf", "image/jpeg", "application/pdf",
	]);
	assert.equal("storageKey" in saved[0], false);
});

test("unsupported content, bad signatures, six files, and files over 10 MiB are rejected before storage", async () => {
	const fixture = createFixture();
	const draft = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	await assert.rejects(fixture.service.uploadDocuments(PATIENT, draft.id, [upload("image/gif", new Uint8Array([1]), "bad.gif")]), { code: "VALIDATION_ERROR" });
	await assert.rejects(fixture.service.uploadDocuments(PATIENT, draft.id, [upload("image/png", new Uint8Array([1, 2, 3]), "bad.png")]), { code: "VALIDATION_ERROR" });
	await assert.rejects(fixture.service.uploadDocuments(PATIENT, draft.id, Array.from({ length: 6 }, () => upload())), { code: "VALIDATION_ERROR" });
	await assert.rejects(fixture.service.uploadDocuments(PATIENT, draft.id, [upload("application/pdf", new Uint8Array(10 * 1024 * 1024 + 1), "large.pdf")]), { code: "UPLOAD_TOO_LARGE" });
	assert.equal(fixture.saveCalls, 0);
});

test("foreign Patients and Doctors are denied before StorageProvider.read; Patient and Admin can read", async () => {
	const fixture = createFixture();
	const draft = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	const [metadata] = await fixture.service.uploadDocuments(PATIENT, draft.id, [upload()]);
	const document = fixture.documents.get(metadata.id)!;

	assert.equal(new TextDecoder().decode((await fixture.service.getDocument(metadata.id, PATIENT)).bytes), "%PDF-1.7 report");
	assert.equal(new TextDecoder().decode((await fixture.service.getDocument(metadata.id, ADMIN)).bytes), "%PDF-1.7 report");
	assert.equal(fixture.readCalls, 2);
	await assert.rejects(fixture.service.getDocument(metadata.id, OTHER_PATIENT), { code: "CASE_ACCESS_DENIED" });
	await assert.rejects(fixture.service.getDocument(metadata.id, DOCTOR), { code: "CASE_DOCTOR_ACCESS_DENIED" });
	await assert.rejects(fixture.service.getDocument(randomUUID(), PATIENT), { code: "CASE_DOCUMENT_NOT_FOUND" });
	assert.equal(fixture.readCalls, 2);
	assert.ok(document.storageKey);
});

test("document deletion is owner-scoped and preserves metadata when storage deletion fails", async () => {
	const fixture = createFixture({ failDelete: true });
	const draft = await fixture.service.saveDraft(PATIENT, VALID_INPUT);
	const [metadata] = await fixture.service.uploadDocuments(PATIENT, draft.id, [upload()]);
	const document = fixture.documents.get(metadata.id)!;

	await assert.rejects(fixture.service.deleteDocument(metadata.id, OTHER_PATIENT), { code: "CASE_ACCESS_DENIED" });
	assert.equal(fixture.deleteCalls.length, 0);
	await assert.rejects(fixture.service.deleteDocument(metadata.id, PATIENT), /storage delete failed/);
	assert.equal(fixture.documents.has(metadata.id), true);
	assert.equal(fixture.files.has(document.storageKey), true);

	fixture.setFailDelete(false);
	await fixture.service.deleteDocument(metadata.id, PATIENT);
	assert.equal(fixture.documents.has(metadata.id), false);
	assert.equal(fixture.files.has(document.storageKey), false);
});

test("failed partial storage or metadata persistence removes every saved byte", async () => {
	const storageFailure = createFixture({ failSaveAt: 2 });
	const storageFailureDraft = await storageFailure.service.saveDraft(PATIENT, VALID_INPUT);
	await assert.rejects(storageFailure.service.uploadDocuments(PATIENT, storageFailureDraft.id, [upload(), upload()]), /storage save failed/);
	assert.equal(storageFailure.files.size, 0);
	assert.equal(storageFailure.deleteCalls.length, 1);

	const databaseFailure = createFixture({ failDocumentPersistence: true });
	const databaseFailureDraft = await databaseFailure.service.saveDraft(PATIENT, VALID_INPUT);
	await assert.rejects(databaseFailure.service.uploadDocuments(PATIENT, databaseFailureDraft.id, [upload(), upload()]), /document persistence failed/);
	assert.equal(databaseFailure.files.size, 0);
	assert.equal(databaseFailure.deleteCalls.length, 2);
});

test("selection repository updates only the Patient-owned Draft and returns the selected value", async () => {
	const caseDelegate = prisma.case as unknown as {
		updateMany: (args: unknown) => Promise<{ count: number }>;
		findUnique: (args: unknown) => Promise<unknown>;
	};
	const originals = { updateMany: caseDelegate.updateMany, findUnique: caseDelegate.findUnique };
	const caseId = randomUUID();
	let updateArgs: unknown;
	let findArgs: unknown;
	caseDelegate.updateMany = async (args) => {
		updateArgs = args;
		return { count: 1 };
	};
	caseDelegate.findUnique = async (args) => {
		findArgs = args;
		return {
			id: caseId,
			patientId: PATIENT.userId,
			affectedBodyArea: "Knee",
			condition: "Pain",
			recommendation: "Review",
			additionalDetails: "",
			selectedDoctorId: "doctor-verified",
			urgencyTier: null,
			chargedAmount: null,
			status: "Draft",
			documents: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	};
	try {
		const updated = await casesRepository.updateDraftDoctorSelection(caseId, PATIENT.userId, "doctor-verified");
		assert.equal(updated?.selectedDoctorId, "doctor-verified");
		assert.deepEqual(updateArgs, {
			where: { id: caseId, patientId: PATIENT.userId, status: "Draft" },
			data: { selectedDoctorId: "doctor-verified" },
		});
		assert.deepEqual(findArgs, {
			where: { id: caseId },
			include: { documents: { orderBy: { createdAt: "asc" } } },
		});
	} finally {
		caseDelegate.updateMany = originals.updateMany;
		caseDelegate.findUnique = originals.findUnique;
	}
});

test("submission repository conditionally transitions only an owned Draft and stores the exact fee snapshot", async () => {
	const caseDelegate = prisma.case as unknown as {
		updateMany: (args: unknown) => Promise<{ count: number }>;
		findUnique: (args: unknown) => Promise<unknown>;
	};
	const originals = { updateMany: caseDelegate.updateMany, findUnique: caseDelegate.findUnique };
	const caseId = randomUUID();
	let updateArgs: unknown;
	caseDelegate.updateMany = async (args) => {
		updateArgs = args;
		return { count: 1 };
	};
	caseDelegate.findUnique = async () => ({
		id: caseId,
		patientId: PATIENT.userId,
		affectedBodyArea: "Knee",
		condition: "Pain",
		recommendation: "Review",
		additionalDetails: "",
		selectedDoctorId: "doctor-verified",
		urgencyTier: "Urgent",
		chargedAmount: new Prisma.Decimal("2000.00"),
		doctorId: "doctor-verified",
		status: "Submitted",
		documents: [],
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	try {
		const amount = new Prisma.Decimal("2000.00");
		const submittedAt = new Date("2026-10-22T12:00:00.000Z");
		const submitted = await casesRepository.updateCaseToSubmitted(caseId, PATIENT.userId, "Urgent", amount, "doctor-verified", submittedAt);
		assert.equal(submitted?.status, "Submitted");
		assert.equal(submitted?.doctorId, "doctor-verified");
		assert.equal(submitted?.chargedAmount?.toFixed(2), "2000.00");
		const args = updateArgs as { where: Record<string, unknown>; data: Record<string, unknown> };
		assert.deepEqual(args.where, { id: caseId, patientId: PATIENT.userId, status: "Draft" });
		assert.equal(args.data.status, "Submitted");
		assert.equal(args.data.doctorId, "doctor-verified");
		assert.equal(args.data.submittedAt, submittedAt);
		assert.equal((args.data.chargedAmount as Prisma.Decimal).toFixed(2), "2000.00");
		assert.ok(args.data.submittedAt instanceof Date);
	} finally {
		caseDelegate.updateMany = originals.updateMany;
		caseDelegate.findUnique = originals.findUnique;
	}
});

test("queue repository enforces active statuses, Specialty membership, and assignment visibility", async () => {
	const caseDelegate = prisma.case as unknown as {
		findMany: (args: unknown) => Promise<CaseRecord[]>;
		findFirst: (args: unknown) => Promise<CaseRecord | null>;
	};
	const originals = { findMany: caseDelegate.findMany, findFirst: caseDelegate.findFirst };
	let queueQuery: unknown;
	let detailQuery: unknown;
	caseDelegate.findMany = async (args) => { queueQuery = args; return []; };
	caseDelegate.findFirst = async (args) => { detailQuery = args; return null; };
	try {
		await casesRepository.listDoctorQueue(["specialty-a", "specialty-b"], "doctor-a");
		const where = {
			specialtyId: { in: ["specialty-a", "specialty-b"] },
			status: { in: ["Submitted", "UnderReview", "MoreInfoRequested"] },
			submittedAt: { not: null },
			OR: [{ doctorId: null }, { doctorId: "doctor-a" }],
		};
		assert.deepEqual(queueQuery, { where, include: { documents: { orderBy: { createdAt: "asc" } } } });
		await casesRepository.findDoctorVisibleCase("case-a", ["specialty-a"], "doctor-a");
		assert.deepEqual(detailQuery, {
			where: {
				id: "case-a",
				specialtyId: { in: ["specialty-a"] },
				status: { in: ["Submitted", "UnderReview", "MoreInfoRequested"] },
				submittedAt: { not: null },
				OR: [{ doctorId: null }, { doctorId: "doctor-a" }],
			},
			include: { documents: { orderBy: { createdAt: "asc" } } },
		});
	} finally {
		Object.assign(caseDelegate, originals);
	}
});

test("classification repository uses the expected assignment version and leaves Patient preference untouched", async () => {
	const caseDelegate = prisma.case as unknown as {
		updateMany: (args: unknown) => Promise<{ count: number }>;
	};
	const originalUpdateMany = caseDelegate.updateMany;
	let updateArgs: unknown;
	caseDelegate.updateMany = async (args) => { updateArgs = args; return { count: 0 }; };
	try {
		assert.equal(await casesRepository.classifySubmittedCase("case-a", "specialty-neurology", 7, true), null);
		assert.deepEqual(updateArgs, {
			where: { id: "case-a", status: "Submitted", specialtyId: null, assignmentLockVersion: 7 },
			data: { specialtyId: "specialty-neurology", doctorId: null, assignmentLockVersion: { increment: 1 } },
		});
	} finally {
		caseDelegate.updateMany = originalUpdateMany;
	}
});