import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client";
import type { AuthContext } from "../../shared/auth-context";
import type { StorageProvider } from "../../shared/storage-provider";
import type { CaseDocumentRecord, CaseDocumentRequestRecord, CaseDocumentUpload, CaseDraftInput, CaseOpinionRecord, CaseRecord, OpinionPayoutCursor } from "./domain";
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
	failResponsePersistence?: boolean;
	failDelete?: boolean;
	failSubmissionPersistence?: boolean;
	failPayment?: boolean;
	failSettings?: boolean;
	includeAdditionalDoctors?: boolean;
	standardCaseFee?: string;
	urgentCaseFee?: string;
} = {}) {
	const cases = new Map<string, CaseRecord>();
		const requestCases = new Map<string, string>();
	const documents = new Map<string, CaseDocumentRecord>();
	const documentRequests = new Map<string, CaseDocumentRequestRecord[]>();
	const opinions = new Map<string, CaseOpinionRecord>();
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
		async findOpinionByCaseId(caseId: string): Promise<CaseOpinionRecord | null> {
			return opinions.get(caseId) ?? null;
		},
		async listPatientCases(patientId: string) {
			return [...cases.values()]
				.filter((record) => record.patientId === patientId && record.status !== "Draft")
				.map((record) => ({ ...record, documentRequests: documentRequests.get(record.id) ?? [], opinion: opinions.get(record.id) ?? null }));
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
		async listAdminAssignmentCases(): Promise<CaseRecord[]> {
			return [...cases.values()].filter((record) => record.specialtyId !== null
				&& ["Submitted", "UnderReview", "MoreInfoRequested"].includes(record.status)
				&& record.submittedAt !== null);
		},
		async assignCaseToDoctor(
			caseId: string,
			doctorId: string,
			expectedVersion: number,
			currentDoctorId: string | null,
			currentStatus: CaseRecord["status"],
			nextStatus: CaseRecord["status"],
			incrementVersion: boolean,
		): Promise<boolean> {
			const record = cases.get(caseId);
			if (!record || record.specialtyId === null || record.submittedAt === null
				|| record.assignmentLockVersion !== expectedVersion || record.doctorId !== currentDoctorId || record.status !== currentStatus) return false;
			cases.set(caseId, {
				...record,
				doctorId,
				status: nextStatus,
				assignmentLockVersion: record.assignmentLockVersion + (incrementVersion ? 1 : 0),
				updatedAt: new Date(),
			});
			return true;
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
				&& ["Submitted", "UnderReview", "MoreInfoRequested", "Closed"].includes(record.status)
				&& record.submittedAt !== null
				&& (record.doctorId === null || record.doctorId === doctorId)
				? { ...record, documentRequests: documentRequests.get(record.id) ?? [], opinion: opinions.get(record.id) ?? null }
				: null;
		},
		async submitOpinion(caseId: string, doctorId: string, text: string, submittedAt: Date): Promise<CaseOpinionRecord | null> {
			const record = cases.get(caseId);
			if (!record || record.doctorId !== doctorId || !["UnderReview", "MoreInfoRequested"].includes(record.status)) return null;
			const history = Array.isArray(record.slaPauseHistory) ? [...record.slaPauseHistory] : [];
			const openIndex = history.findLastIndex((interval) => typeof interval === "object" && interval !== null && !Array.isArray(interval) && interval.resumedAt === null);
			if (record.status === "MoreInfoRequested" && openIndex < 0) return null;
			if (openIndex >= 0) {
				const openInterval = history[openIndex];
				if (typeof openInterval !== "object" || openInterval === null || Array.isArray(openInterval)) return null;
				history[openIndex] = { ...openInterval, resumedAt: submittedAt.toISOString() };
			}
			const requestHistory = documentRequests.get(caseId) ?? [];
			const activeRequestIndex = requestHistory.findLastIndex(({ fulfilledAt, closedAt }) => fulfilledAt === null && closedAt === null);
			if (record.status === "MoreInfoRequested" && activeRequestIndex < 0) return null;
			const opinion: CaseOpinionRecord = { id: randomUUID(), caseId, doctorId, text, createdAt: submittedAt };
			opinions.set(caseId, opinion);
			if (activeRequestIndex >= 0) {
				const nextRequests = [...requestHistory];
				nextRequests[activeRequestIndex] = { ...nextRequests[activeRequestIndex], closedAt: submittedAt };
				documentRequests.set(caseId, nextRequests);
			}
			cases.set(caseId, { ...record, status: "Closed", slaPauseHistory: history, updatedAt: submittedAt });
			return opinion;
		},
		async listClosedOpinionsForPayout(after: OpinionPayoutCursor | null) {
			return [...opinions.values()].flatMap((opinion) => {
				const record = cases.get(opinion.caseId);
				const isAfter = !after || opinion.createdAt > after.opinionCreatedAt
					|| (opinion.createdAt.getTime() === after.opinionCreatedAt.getTime() && opinion.caseId > after.caseId);
				return isAfter && record?.status === "Closed" && record.doctorId && record.chargedAmount
					? [{ id: record.id, doctorId: record.doctorId, chargedAmount: record.chargedAmount, opinion: { createdAt: opinion.createdAt } }]
					: [];
			}).sort((left, right) => left.opinion.createdAt.getTime() - right.opinion.createdAt.getTime() || left.id.localeCompare(right.id)).slice(0, 100);
		},
		async createDocumentRequest(caseId: string, doctorId: string, note: string, requestedAt: Date): Promise<CaseDocumentRequestRecord | null> {
			const record = cases.get(caseId);
			if (!record || record.status !== "UnderReview" || record.doctorId !== doctorId) return null;
			const request: CaseDocumentRequestRecord = {
				id: randomUUID(), caseId, requestedByDoctorId: doctorId, note, createdAt: requestedAt, fulfilledAt: null, closedAt: null,
			};
			const history = Array.isArray(record.slaPauseHistory) ? record.slaPauseHistory : [];
			cases.set(caseId, {
				...record,
				status: "MoreInfoRequested",
				slaPauseHistory: [...history, { pausedAt: requestedAt.toISOString(), resumedAt: null }],
				updatedAt: requestedAt,
			});
			documentRequests.set(caseId, [...(documentRequests.get(caseId) ?? []), request]);
			return request;
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
		async createResponseDocuments(
			caseId: string,
			patientId: string,
			newDocuments: Omit<CaseDocumentRecord, "id" | "caseId" | "createdAt">[],
			resumedAt: Date,
		): Promise<CaseDocumentRecord[] | null> {
			if (options.failDocumentPersistence || options.failResponsePersistence) throw new Error("document persistence failed");
			const record = cases.get(caseId);
			const requests = documentRequests.get(caseId) ?? [];
			const activeRequestIndex = requests.findLastIndex(({ fulfilledAt }) => fulfilledAt === null);
			if (!record || record.patientId !== patientId || record.status !== "MoreInfoRequested" || activeRequestIndex < 0) return null;
			const history = Array.isArray(record.slaPauseHistory) ? [...record.slaPauseHistory] : [];
			const openIndex = history.findLastIndex((interval) => typeof interval === "object" && interval !== null && !Array.isArray(interval) && interval.resumedAt === null);
			if (openIndex < 0) return null;
			const openInterval = history[openIndex];
			if (typeof openInterval !== "object" || openInterval === null || Array.isArray(openInterval)) return null;
			history[openIndex] = { ...openInterval, resumedAt: resumedAt.toISOString() };
			const created = newDocuments.map((document) => ({ ...document, id: randomUUID(), caseId, createdAt: resumedAt }));
			const updatedRequests = [...requests];
			updatedRequests[activeRequestIndex] = { ...updatedRequests[activeRequestIndex], fulfilledAt: resumedAt };
			documentRequests.set(caseId, updatedRequests);
			created.forEach((document) => documents.set(document.id, document));
			cases.set(caseId, {
				...record,
				status: "UnderReview",
				slaPauseHistory: history,
				documents: [...record.documents, ...created],
				updatedAt: resumedAt,
			});
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
	}, ...(options.includeAdditionalDoctors ? [
		{ id: "doctor-verified-b", fullName: "Dr. Another", specialties: ["Cardiology"] },
		{ id: "doctor-neurology", fullName: "Dr. Neurology", specialties: ["Neurology"] },
	] : [])];
	let doctorLookupCalls = 0;
	const doctors = {
		async listVerifiedDoctors() {
			return verifiedDirectory;
		},
		async getVerifiedDoctor(doctorId: string) {
			doctorLookupCalls += 1;
			if (!verifiedDirectory.some(({ id }) => id === doctorId)) return null;
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
			if (doctorId === "doctor-verified" || doctorId === "doctor-verified-b") return ["specialty-cardiology"];
			if (doctorId === "doctor-neurology") return ["specialty-neurology"];
			return null;
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
		documentRequests,
		opinions,
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

async function createAssignedCase(fixture: ReturnType<typeof createFixture>) {
	const submitted = await createSubmittedCase(fixture);
	await fixture.service.classifySubmittedCase(ADMIN, submitted.id, "specialty-cardiology");
	const classified = fixture.cases.get(submitted.id)!;
	await fixture.service.assignCaseToDoctor(VERIFIED_DOCTOR, submitted.id, undefined, classified.assignmentLockVersion);
	return fixture.cases.get(submitted.id)!;
}

test("assigned Doctor submits one final Opinion, closes the Case, and exposes payout eligibility", async () => {
	const fixture = createFixture();
	const record = await createAssignedCase(fixture);
	const submittedAt = record.submittedAt;
	const opinion = await fixture.service.submitOpinion(VERIFIED_DOCTOR, record.id, "  Conservative treatment is appropriate.  ");

	assert.deepEqual(opinion, { text: "Conservative treatment is appropriate.", createdAt: opinion.createdAt });
	assert.equal(fixture.cases.get(record.id)?.status, "Closed");
	assert.equal(fixture.cases.get(record.id)?.submittedAt, submittedAt);
	const doctorDetail = await fixture.service.getDoctorCase(VERIFIED_DOCTOR, record.id);
	assert.equal(doctorDetail.opinion?.text, opinion.text);
	assert.equal(doctorDetail.elapsedSlaMs, computeElapsedSlaTime({ submittedAt, slaPauseHistory: fixture.cases.get(record.id)!.slaPauseHistory }, new Date(opinion.createdAt)));
	assert.equal((await fixture.service.listPatientCases(PATIENT))[0].opinion?.text, opinion.text);
	assert.deepEqual(await fixture.service.listClosedOpinionsForPayout(null), {
		items: [{
			caseId: record.id,
			doctorId: VERIFIED_DOCTOR.userId,
			chargedAmount: "1000.00",
			opinionCreatedAt: opinion.createdAt,
		}],
		nextCursor: null,
	});
	await assert.rejects(fixture.service.submitOpinion(VERIFIED_DOCTOR, record.id, "A second Opinion."), { code: "CASE_OPINION_CONFLICT" });
});

test("Opinion from MoreInfoRequested closes its pause and request without claiming upload fulfillment", async () => {
	const fixture = createFixture();
	const record = await createAssignedCase(fixture);
	const submittedAt = record.submittedAt;
	await fixture.service.requestDocuments(VERIFIED_DOCTOR, record.id, "Please attach a recent scan.");
	const opinion = await fixture.service.submitOpinion(VERIFIED_DOCTOR, record.id, "The existing reports are sufficient.");
	const closed = fixture.cases.get(record.id)!;
	const request = fixture.documentRequests.get(record.id)?.[0];

	assert.equal(closed.status, "Closed");
	assert.equal(closed.submittedAt, submittedAt);
	assert.equal((closed.slaPauseHistory as { resumedAt: string | null }[])[0].resumedAt, opinion.createdAt);
	assert.equal(request?.fulfilledAt, null);
	assert.equal(request?.closedAt?.toISOString(), opinion.createdAt);
	assert.equal((await fixture.service.listPatientCases(PATIENT))[0].documentRequests[0].closedAt, opinion.createdAt);
});

test("Admin can read a final Opinion while other non-owner roles are denied", async () => {
	const fixture = createFixture();
	const record = await createAssignedCase(fixture);
	await fixture.service.submitOpinion(VERIFIED_DOCTOR, record.id, "Final Opinion.");
	assert.equal((await fixture.service.getAdminOpinion(ADMIN, record.id)).text, "Final Opinion.");
	await assert.rejects(fixture.service.getAdminOpinion(VERIFIED_DOCTOR, record.id), { code: "CASE_ADMIN_ACCESS_DENIED" });
});

test("Opinion submission rejects invalid text, wrong/unverified Doctors, and RefundPending", async () => {
	const fixture = createFixture({ includeAdditionalDoctors: true });
	const record = await createAssignedCase(fixture);
	await assert.rejects(fixture.service.submitOpinion(VERIFIED_DOCTOR, record.id, "  "), { code: "VALIDATION_ERROR" });
	await assert.rejects(fixture.service.submitOpinion(VERIFIED_DOCTOR, record.id, "x".repeat(10001)), { code: "VALIDATION_ERROR" });
	await assert.rejects(fixture.service.submitOpinion({ userId: "doctor-verified-b", role: "doctor" }, record.id, "Valid Opinion."), { code: "CASE_NOT_FOUND" });
	await assert.rejects(fixture.service.submitOpinion({ userId: "doctor-pending", role: "doctor" }, record.id, "Valid Opinion."), { code: "CASE_DOCTOR_ACCESS_DENIED" });

	fixture.cases.set(record.id, { ...record, status: "RefundPending" });
	await assert.rejects(fixture.service.submitOpinion(VERIFIED_DOCTOR, record.id, "Valid Opinion."), { code: "CASE_OPINION_CONFLICT" });
	assert.equal(fixture.opinions.has(record.id), false);

	const unicodeFixture = createFixture();
	const unicodeRecord = await createAssignedCase(unicodeFixture);
	const emojiOpinion = String.fromCodePoint(0x1f600).repeat(10000);
	assert.equal(Array.from((await unicodeFixture.service.submitOpinion(VERIFIED_DOCTOR, unicodeRecord.id, emojiOpinion)).text).length, 10000);
});

test("Doctor request persists a trimmed note and open SLA pause for Patient and Doctor views", async () => {
	const fixture = createFixture();
	const record = await createAssignedCase(fixture);
	const request = await fixture.service.requestDocuments(VERIFIED_DOCTOR, record.id, "  Please attach the latest scan.  ");

	assert.equal(request.note, "Please attach the latest scan.");
	assert.equal(fixture.cases.get(record.id)?.status, "MoreInfoRequested");
	assert.equal((fixture.cases.get(record.id)?.slaPauseHistory as { pausedAt: string; resumedAt: string | null }[]).at(-1)?.resumedAt, null);
	assert.equal(fixture.documentRequests.get(record.id)?.length, 1);
	assert.equal((await fixture.service.getDoctorCase(VERIFIED_DOCTOR, record.id)).documentRequests[0].note, request.note);
	const patientCases = await fixture.service.listPatientCases(PATIENT);
	assert.equal(patientCases.length, 1);
	assert.equal(patientCases[0].documentRequests[0].note, request.note);
	assert.deepEqual(await fixture.service.listPatientCases(OTHER_PATIENT), []);
});

test("Document requests reject invalid notes, wrong Doctors, unverified Doctors, and duplicate active requests", async () => {
	const fixture = createFixture({ includeAdditionalDoctors: true });
	const record = await createAssignedCase(fixture);
	const unassigned = await createSubmittedCase(fixture);
	await assert.rejects(fixture.service.requestDocuments(VERIFIED_DOCTOR, unassigned.id, "Please attach a scan."), { code: "CASE_NOT_FOUND" });
	await assert.rejects(fixture.service.requestDocuments(VERIFIED_DOCTOR, record.id, "  "), { code: "VALIDATION_ERROR" });
	await assert.rejects(fixture.service.requestDocuments(VERIFIED_DOCTOR, record.id, "x".repeat(2001)), { code: "VALIDATION_ERROR" });
	await assert.rejects(fixture.service.requestDocuments({ userId: "doctor-verified-b", role: "doctor" }, record.id, "Please attach a scan."), { code: "CASE_NOT_FOUND" });
	await assert.rejects(fixture.service.requestDocuments({ userId: "doctor-pending", role: "doctor" }, record.id, "Please attach a scan."), { code: "CASE_DOCTOR_ACCESS_DENIED" });
	await fixture.service.requestDocuments(VERIFIED_DOCTOR, record.id, "Please attach a scan.");
	await assert.rejects(fixture.service.requestDocuments(VERIFIED_DOCTOR, record.id, "A second active request."), { code: "CASE_DOCUMENT_REQUEST_CONFLICT" });
	assert.equal(fixture.documentRequests.get(record.id)?.length, 1);
	assert.equal((fixture.cases.get(record.id)?.slaPauseHistory as unknown[]).length, 1);
});

test("Patient response upload fulfills a request, resumes SLA, and permits a distinct later cycle", async () => {
	const fixture = createFixture();
	const record = await createAssignedCase(fixture);
	const submittedAt = record.submittedAt;
	await fixture.service.requestDocuments(VERIFIED_DOCTOR, record.id, "Please attach a scan.");
	await assert.rejects(fixture.service.uploadDocuments(OTHER_PATIENT, record.id, [upload()]), { code: "CASE_ACCESS_DENIED" });
	assert.equal(fixture.saveCalls, 1);

	const [responseDocument] = await fixture.service.uploadDocuments(PATIENT, record.id, [upload()]);
	const resumedCase = fixture.cases.get(record.id)!;
	assert.equal(responseDocument.fileName, "report.pdf");
	assert.equal(resumedCase.status, "UnderReview");
	assert.equal(resumedCase.submittedAt, submittedAt);
	assert.ok((resumedCase.slaPauseHistory as { resumedAt: string | null }[])[0].resumedAt);
	assert.ok(fixture.documentRequests.get(record.id)?.[0].fulfilledAt);

	await fixture.service.requestDocuments(VERIFIED_DOCTOR, record.id, "Please attach the final report.");
	const cycled = fixture.cases.get(record.id)!;
	assert.equal(fixture.documentRequests.get(record.id)?.length, 2);
	assert.equal((cycled.slaPauseHistory as unknown[]).length, 2);
	assert.equal((cycled.slaPauseHistory as { resumedAt: string | null }[])[1].resumedAt, null);
});

test("failed response metadata persistence preserves request pause and removes stored bytes", async () => {
	const fixture = createFixture({ failResponsePersistence: true });
	const record = await createAssignedCase(fixture);
	await fixture.service.requestDocuments(VERIFIED_DOCTOR, record.id, "Please attach a scan.");
	const before = fixture.cases.get(record.id)!;
	const pauseHistory = before.slaPauseHistory;
	const storedFileCount = fixture.files.size;
	await assert.rejects(fixture.service.uploadDocuments(PATIENT, record.id, [upload(), upload()]), /document persistence failed/);

	assert.equal(fixture.cases.get(record.id)?.status, "MoreInfoRequested");
	assert.deepEqual(fixture.cases.get(record.id)?.slaPauseHistory, pauseHistory);
	assert.equal(fixture.documentRequests.get(record.id)?.[0].fulfilledAt, null);
	assert.equal(fixture.files.size, storedFileCount);
	assert.equal(fixture.deleteCalls.length, 2);
});

test("invalid and partially stored response uploads leave the request and SLA pause open", async () => {
	const fixture = createFixture({ failSaveAt: 3 });
	const record = await createAssignedCase(fixture);
	await fixture.service.requestDocuments(VERIFIED_DOCTOR, record.id, "Please attach a scan.");
	const before = fixture.cases.get(record.id)!;
	const storedFileCount = fixture.files.size;
	await assert.rejects(fixture.service.uploadDocuments(PATIENT, record.id, [upload("image/gif", new Uint8Array([1]), "bad.gif")]), { code: "VALIDATION_ERROR" });
	await assert.rejects(fixture.service.uploadDocuments(PATIENT, record.id, [upload(), upload()]), /storage save failed/);

	assert.equal(fixture.cases.get(record.id)?.status, "MoreInfoRequested");
	assert.deepEqual(fixture.cases.get(record.id)?.slaPauseHistory, before.slaPauseHistory);
	assert.equal(fixture.documentRequests.get(record.id)?.[0].fulfilledAt, null);
	assert.equal(fixture.files.size, storedFileCount);
	assert.equal(fixture.deleteCalls.length, 1);
});

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

test("Doctor claim atomically starts review, preserves Patient preference and SLA history, and rejects stale or competing claims", async () => {
	const fixture = createFixture({ includeAdditionalDoctors: true });
	const record = await createSubmittedCase(fixture);
	await fixture.service.classifySubmittedCase(ADMIN, record.id, "specialty-cardiology");
	const submittedAt = fixture.cases.get(record.id)!.submittedAt;
	const pauseHistory = [{ pausedAt: "2026-10-20T12:00:00.000Z", resumedAt: "2026-10-21T12:00:00.000Z" }];
	fixture.cases.set(record.id, { ...fixture.cases.get(record.id)!, slaPauseHistory: pauseHistory });
	const expectedVersion = fixture.cases.get(record.id)!.assignmentLockVersion;

	const claimed = await fixture.service.assignCaseToDoctor(VERIFIED_DOCTOR, record.id, undefined, expectedVersion);
	assert.equal(claimed.doctorId, VERIFIED_DOCTOR.userId);
	assert.equal(claimed.status, "UnderReview");
	assert.equal(claimed.assignmentLockVersion, expectedVersion + 1);
	assert.equal(claimed.selectedDoctorId, null);
	assert.equal(fixture.cases.get(record.id)?.submittedAt, submittedAt);
	assert.deepEqual(fixture.cases.get(record.id)?.slaPauseHistory, pauseHistory);
	await assert.rejects(fixture.service.assignCaseToDoctor(VERIFIED_DOCTOR, record.id, undefined, expectedVersion), { code: "CASE_ASSIGNMENT_VERSION_CONFLICT" });

	const preassigned = await createSubmittedCase(fixture, "Standard", "doctor-verified");
	await fixture.service.classifySubmittedCase(ADMIN, preassigned.id, "specialty-cardiology");
	const preassignedVersion = fixture.cases.get(preassigned.id)!.assignmentLockVersion;
	await assert.rejects(fixture.service.assignCaseToDoctor({ userId: "doctor-verified-b", role: "doctor" }, preassigned.id, undefined, preassignedVersion), { code: "CASE_ALREADY_ASSIGNED" });

	const competingFixture = createFixture({ includeAdditionalDoctors: true });
	const competing = await createSubmittedCase(competingFixture);
	await competingFixture.service.classifySubmittedCase(ADMIN, competing.id, "specialty-cardiology");
	const competingVersion = competingFixture.cases.get(competing.id)!.assignmentLockVersion;
	const attempts = await Promise.allSettled([
		competingFixture.service.assignCaseToDoctor(VERIFIED_DOCTOR, competing.id, undefined, competingVersion),
		competingFixture.service.assignCaseToDoctor({ userId: "doctor-verified-b", role: "doctor" }, competing.id, undefined, competingVersion),
	]);
	assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
	assert.equal(attempts.filter(({ status }) => status === "rejected").length, 1);
	const losingAttempt = attempts.find(({ status }) => status === "rejected") as PromiseRejectedResult;
	assert.ok(["CASE_ASSIGNMENT_VERSION_CONFLICT", "CASE_ALREADY_ASSIGNED"].includes(losingAttempt.reason.code));
	assert.equal(competingFixture.cases.get(competing.id)?.assignmentLockVersion, competingVersion + 1);
});

test("Admin assignment confirms selected Doctors, starts an unassigned Case, and preserves reassignment state and no-op versions", async () => {
	const fixture = createFixture({ includeAdditionalDoctors: true });
	const selected = await createSubmittedCase(fixture, "Standard", "doctor-verified");
	await fixture.service.classifySubmittedCase(ADMIN, selected.id, "specialty-cardiology");
	const assignmentQueue = await fixture.service.listAdminAssignmentCases(ADMIN);
	assert.equal(assignmentQueue.length, 1);
	assert.equal(assignmentQueue[0].id, selected.id);
	assert.deepEqual(assignmentQueue[0].availableDoctors.map(({ id }) => id), ["doctor-verified", "doctor-verified-b"]);
	await assert.rejects(fixture.service.listAdminAssignmentCases(DOCTOR), { code: "CASE_ADMIN_ACCESS_DENIED" });
	const selectedVersion = fixture.cases.get(selected.id)!.assignmentLockVersion;
	const confirmed = await fixture.service.assignCaseToDoctor(ADMIN, selected.id, "doctor-verified", selectedVersion);
	assert.equal(confirmed.status, "UnderReview");
	assert.equal(confirmed.doctorId, "doctor-verified");
	assert.equal(confirmed.assignmentLockVersion, selectedVersion);
	assert.equal(fixture.cases.get(selected.id)?.assignmentLockVersion, selectedVersion);

	const unassigned = await createSubmittedCase(fixture);
	await fixture.service.classifySubmittedCase(ADMIN, unassigned.id, "specialty-cardiology");
	const unassignedVersion = fixture.cases.get(unassigned.id)!.assignmentLockVersion;
	const assigned = await fixture.service.assignCaseToDoctor(ADMIN, unassigned.id, "doctor-verified", unassignedVersion);
	assert.equal(assigned.status, "UnderReview");
	assert.equal(assigned.assignmentLockVersion, unassignedVersion + 1);

	const submittedAt = new Date("2026-10-19T12:00:00.000Z");
	const pauseHistory = [{ pausedAt: "2026-10-20T12:00:00.000Z", resumedAt: null }];
	fixture.cases.set(selected.id, {
		...fixture.cases.get(selected.id)!,
		status: "MoreInfoRequested",
		submittedAt,
		slaPauseHistory: pauseHistory,
	});
	const reassignmentVersion = fixture.cases.get(selected.id)!.assignmentLockVersion;
	const reassigned = await fixture.service.assignCaseToDoctor(ADMIN, selected.id, "doctor-verified-b", reassignmentVersion);
	assert.equal(reassigned.doctorId, "doctor-verified-b");
	assert.equal(reassigned.status, "MoreInfoRequested");
	assert.equal(reassigned.assignmentLockVersion, reassignmentVersion + 1);
	assert.equal(reassigned.selectedDoctorId, "doctor-verified");
	assert.equal(fixture.cases.get(selected.id)?.submittedAt, submittedAt);
	assert.deepEqual(fixture.cases.get(selected.id)?.slaPauseHistory, pauseHistory);
	assert.equal(fixture.cases.get(selected.id)?.specialtyId, "specialty-cardiology");
	await assert.rejects(fixture.service.getDocument(selected.documents[0].id, VERIFIED_DOCTOR), { code: "CASE_DOCUMENT_NOT_FOUND" });
	assert.equal(new TextDecoder().decode((await fixture.service.getDocument(selected.documents[0].id, { userId: "doctor-verified-b", role: "doctor" })).bytes), "%PDF-1.7 report");

	const noOpVersion = fixture.cases.get(selected.id)!.assignmentLockVersion;
	const noOp = await fixture.service.assignCaseToDoctor(ADMIN, selected.id, "doctor-verified-b", noOpVersion);
	assert.equal(noOp.assignmentLockVersion, noOpVersion);
	assert.equal(fixture.cases.get(selected.id)?.assignmentLockVersion, noOpVersion);
});

test("assignment rejects inactive, unavailable, incompatible, and unauthorized targets without changing the current assignee", async () => {
	const fixture = createFixture({ includeAdditionalDoctors: true });
	const record = await createSubmittedCase(fixture, "Standard", "doctor-verified");
	await fixture.service.classifySubmittedCase(ADMIN, record.id, "specialty-cardiology");
	const before = fixture.cases.get(record.id)!;
	await assert.rejects(fixture.service.assignCaseToDoctor(ADMIN, record.id, "doctor-neurology", before.assignmentLockVersion), { code: "CASE_ASSIGNMENT_DOCTOR_UNAVAILABLE" });
	await assert.rejects(fixture.service.assignCaseToDoctor(ADMIN, record.id, "doctor-pending", before.assignmentLockVersion), { code: "CASE_ASSIGNMENT_DOCTOR_UNAVAILABLE" });
	assert.equal(fixture.cases.get(record.id)?.doctorId, "doctor-verified");
	assert.equal(new TextDecoder().decode((await fixture.service.getDocument(record.documents[0].id, VERIFIED_DOCTOR)).bytes), "%PDF-1.7 report");

	fixture.cases.set(record.id, { ...before, status: "RefundPending" });
	await assert.rejects(fixture.service.assignCaseToDoctor(ADMIN, record.id, "doctor-verified-b", before.assignmentLockVersion), { code: "CASE_ASSIGNMENT_CONFLICT" });
	fixture.cases.set(record.id, { ...before, status: "Closed" });
	await assert.rejects(fixture.service.assignCaseToDoctor(ADMIN, record.id, "doctor-verified-b", before.assignmentLockVersion), { code: "CASE_ASSIGNMENT_CONFLICT" });
	await assert.rejects(fixture.service.assignCaseToDoctor(PATIENT, record.id, "doctor-verified-b", before.assignmentLockVersion), { code: "CASE_ASSIGNMENT_ACCESS_DENIED" });
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
	assert.equal(queue[0].assignmentLockVersion, fixture.cases.get(urgent.id)?.assignmentLockVersion);
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
				submittedAt: { not: null },
				OR: [
					{ status: "Closed", doctorId: "doctor-a" },
					{
						status: { in: ["Submitted", "UnderReview", "MoreInfoRequested"] },
						OR: [{ doctorId: null }, { doctorId: "doctor-a" }],
					},
				],
			},
			include: {
				documents: { orderBy: { createdAt: "asc" } },
				documentRequests: { orderBy: { createdAt: "asc" } },
				opinion: true,
			},
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

test("assignment repository compare-and-swaps the assignee, state, Specialty, and lock version", async () => {
	const caseDelegate = prisma.case as unknown as {
		updateMany: (args: unknown) => Promise<{ count: number }>;
	};
	const originalUpdateMany = caseDelegate.updateMany;
	let updateArgs: unknown;
	caseDelegate.updateMany = async (args) => { updateArgs = args; return { count: 1 }; };
	try {
		assert.equal(await casesRepository.assignCaseToDoctor("case-a", "doctor-a", 7, null, "Submitted", "UnderReview", true), true);
		assert.deepEqual(updateArgs, {
			where: {
				id: "case-a",
				specialtyId: { not: null },
				submittedAt: { not: null },
				status: "Submitted",
				doctorId: null,
				assignmentLockVersion: 7,
			},
			data: { doctorId: "doctor-a", status: "UnderReview", assignmentLockVersion: { increment: 1 } },
		});
		assert.equal(await casesRepository.assignCaseToDoctor("case-a", "doctor-a", 7, "doctor-a", "Submitted", "UnderReview", false), true);
		assert.deepEqual((updateArgs as { data: unknown }).data, { doctorId: "doctor-a", status: "UnderReview" });
	} finally {
		caseDelegate.updateMany = originalUpdateMany;
	}
});

test("Admin assignment repository selects only classified active review Cases and minimal fields", async () => {
	const caseDelegate = prisma.case as unknown as { findMany: (args: unknown) => Promise<unknown[]> };
	const originalFindMany = caseDelegate.findMany;
	let query: unknown;
	caseDelegate.findMany = async (args) => { query = args; return []; };
	try {
		assert.deepEqual(await casesRepository.listAdminAssignmentCases(), []);
		assert.deepEqual(query, {
			where: {
				specialtyId: { not: null },
				status: { in: ["Submitted", "UnderReview", "MoreInfoRequested"] },
				submittedAt: { not: null },
			},
			orderBy: [{ urgencyTier: "desc" }, { submittedAt: "asc" }],
			select: {
				id: true,
				affectedBodyArea: true,
				condition: true,
				specialtyId: true,
				urgencyTier: true,
				status: true,
				doctorId: true,
				submittedAt: true,
				assignmentLockVersion: true,
			},
		});
	} finally {
		caseDelegate.findMany = originalFindMany;
	}
});

test("Patient Case list repository scopes by owner and omits Draft Cases", async () => {
	const caseDelegate = prisma.case as unknown as { findMany: (args: unknown) => Promise<CaseRecord[]> };
	const originalFindMany = caseDelegate.findMany;
	let query: unknown;
	caseDelegate.findMany = async (args) => { query = args; return []; };
	try {
		assert.deepEqual(await casesRepository.listPatientCases(PATIENT.userId), []);
		assert.deepEqual(query, {
			where: { patientId: PATIENT.userId, status: { not: "Draft" } },
			orderBy: { updatedAt: "desc" },
			include: {
				documents: { orderBy: { createdAt: "asc" } },
				documentRequests: { orderBy: { createdAt: "asc" } },
				opinion: true,
			},
		});
	} finally {
		caseDelegate.findMany = originalFindMany;
	}
});

test("request and response repositories conditionally transition Case status with SLA and request timestamps", async () => {
	type TransactionMock = {
		case: {
			findFirst: (args: unknown) => Promise<{ slaPauseHistory: Prisma.JsonValue } | null>;
			updateMany: (args: unknown) => Promise<{ count: number }>;
		};
		caseDocumentRequest: {
			create: (args: unknown) => Promise<CaseDocumentRequestRecord>;
			findFirst: (args: unknown) => Promise<{ id: string } | null>;
			updateMany: (args: unknown) => Promise<{ count: number }>;
		};
		caseDocument: { create: (args: unknown) => Promise<CaseDocumentRecord> };
	};
	const prismaClient = prisma as unknown as {
		$transaction: (callback: (transaction: TransactionMock) => Promise<unknown>) => Promise<unknown>;
	};
	const originalTransaction = prismaClient.$transaction;
	const requestedAt = new Date("2026-10-22T12:00:00.000Z");
	const resumedAt = new Date("2026-10-22T13:00:00.000Z");
	const existingHistory = [{ pausedAt: "2026-10-20T12:00:00.000Z", resumedAt: "2026-10-21T12:00:00.000Z" }];
	const caseUpdates: unknown[] = [];
	const requestUpdates: unknown[] = [];
	const documentCreates: unknown[] = [];
	const requestCreates: unknown[] = [];
	let caseFindCount = 0;
	const transaction: TransactionMock = {
		case: {
			async findFirst() {
				caseFindCount += 1;
				return { slaPauseHistory: caseFindCount === 1
					? existingHistory
					: [...existingHistory, { pausedAt: requestedAt.toISOString(), resumedAt: null }] };
			},
			async updateMany(args) { caseUpdates.push(args); return { count: 1 }; },
		},
		caseDocumentRequest: {
			async create(args) {
				requestCreates.push(args);
				return { id: "request-1", caseId: "case-1", requestedByDoctorId: "doctor-1", note: "Attach a scan.", createdAt: requestedAt, fulfilledAt: null, closedAt: null };
			},
			async findFirst() { return { id: "request-1" }; },
			async updateMany(args) { requestUpdates.push(args); return { count: 1 }; },
		},
		caseDocument: {
			async create(args) {
				documentCreates.push(args);
				return { id: "document-1", caseId: "case-1", fileName: "scan.pdf", contentType: "application/pdf", sizeBytes: 12, storageKey: "private-key", createdAt: resumedAt };
			},
		},
	};
	prismaClient.$transaction = async (callback) => callback(transaction);
	try {
		const request = await casesRepository.createDocumentRequest("case-1", "doctor-1", "Attach a scan.", requestedAt);
		assert.equal(request?.id, "request-1");
		assert.deepEqual(caseUpdates[0], {
			where: { id: "case-1", doctorId: "doctor-1", status: "UnderReview" },
			data: {
				status: "MoreInfoRequested",
				slaPauseHistory: [...existingHistory, { pausedAt: requestedAt.toISOString(), resumedAt: null }],
			},
		});
		assert.deepEqual(requestCreates[0], {
			data: { caseId: "case-1", requestedByDoctorId: "doctor-1", note: "Attach a scan.", createdAt: requestedAt },
		});

		const documents = await casesRepository.createResponseDocuments("case-1", PATIENT.userId, [{
			fileName: "scan.pdf", contentType: "application/pdf", sizeBytes: 12, storageKey: "private-key",
		}], resumedAt);
		assert.equal(documents?.[0].id, "document-1");
		const responseUpdate = caseUpdates[1] as { where: unknown; data: { status: string; slaPauseHistory: unknown[] } };
		assert.deepEqual(responseUpdate.where, { id: "case-1", patientId: PATIENT.userId, status: "MoreInfoRequested" });
		assert.equal(responseUpdate.data.status, "UnderReview");
		assert.deepEqual(responseUpdate.data.slaPauseHistory, [
			...existingHistory,
			{ pausedAt: requestedAt.toISOString(), resumedAt: resumedAt.toISOString() },
		]);
		assert.deepEqual(requestUpdates[0], {
			where: { id: "request-1", fulfilledAt: null, closedAt: null },
			data: { fulfilledAt: resumedAt },
		});
		assert.equal(documentCreates.length, 1);
	} finally {
		prismaClient.$transaction = originalTransaction;
	}
});

test("response repository transaction rolls back Case, request, and Document writes after a later failure", async () => {
	type TransactionMock = {
		case: {
			findFirst: (args: unknown) => Promise<{ slaPauseHistory: Prisma.JsonValue } | null>;
			updateMany: (args: unknown) => Promise<{ count: number }>;
		};
		caseDocumentRequest: {
			findFirst: (args: unknown) => Promise<{ id: string } | null>;
			updateMany: (args: unknown) => Promise<{ count: number }>;
		};
		caseDocument: { create: (args: unknown) => Promise<CaseDocumentRecord> };
	};
	const prismaClient = prisma as unknown as {
		$transaction: (callback: (transaction: TransactionMock) => Promise<unknown>) => Promise<unknown>;
	};
	const originalTransaction = prismaClient.$transaction;
	const resumedAt = new Date("2026-10-22T13:00:00.000Z");
	const state = {
		status: "MoreInfoRequested",
		slaPauseHistory: [{ pausedAt: "2026-10-22T12:00:00.000Z", resumedAt: null }] as Prisma.JsonValue,
		fulfilledAt: null as Date | null,
		documentIds: [] as string[],
	};
	let documentCreateCount = 0;
	const transaction: TransactionMock = {
		case: {
			async findFirst() { return { slaPauseHistory: state.slaPauseHistory }; },
			async updateMany(args) {
				const data = (args as { data: { status: string; slaPauseHistory: Prisma.JsonValue } }).data;
				state.status = data.status;
				state.slaPauseHistory = data.slaPauseHistory;
				return { count: 1 };
			},
		},
		caseDocumentRequest: {
			async findFirst() { return { id: "request-1" }; },
			async updateMany(args) {
				state.fulfilledAt = (args as { data: { fulfilledAt: Date } }).data.fulfilledAt;
				return { count: 1 };
			},
		},
		caseDocument: {
			async create(args) {
				documentCreateCount += 1;
				if (documentCreateCount === 2) throw new Error("second document write failed");
				const data = args as { caseId: string; fileName: string; contentType: string; sizeBytes: number; storageKey: string };
				state.documentIds.push(`document-${documentCreateCount}`);
				return { ...data, id: `document-${documentCreateCount}`, createdAt: resumedAt };
			},
		},
	};
	prismaClient.$transaction = async (callback) => {
		const snapshot = structuredClone(state);
		try {
			return await callback(transaction);
		} catch (error) {
			Object.assign(state, snapshot);
			throw error;
		}
	};
	try {
		await assert.rejects(casesRepository.createResponseDocuments("case-1", PATIENT.userId, [
			{ fileName: "first.pdf", contentType: "application/pdf", sizeBytes: 12, storageKey: "first-key" },
			{ fileName: "second.pdf", contentType: "application/pdf", sizeBytes: 12, storageKey: "second-key" },
		], resumedAt), /second document write failed/);
		assert.deepEqual(state, {
			status: "MoreInfoRequested",
			slaPauseHistory: [{ pausedAt: "2026-10-22T12:00:00.000Z", resumedAt: null }],
			fulfilledAt: null,
			documentIds: [],
		});
	} finally {
		prismaClient.$transaction = originalTransaction;
	}
});

test("Opinion repository closes MoreInfoRequested through OpinionGiven and closes request without fulfillment", async () => {
	type TransactionMock = {
		case: {
			findFirst: (args: unknown) => Promise<{ status: "MoreInfoRequested"; slaPauseHistory: Prisma.JsonValue } | null>;
			updateMany: (args: unknown) => Promise<{ count: number }>;
		};
		caseOpinion: { create: (args: unknown) => Promise<CaseOpinionRecord> };
		caseDocumentRequest: {
			findFirst: (args: unknown) => Promise<{ id: string } | null>;
			updateMany: (args: unknown) => Promise<{ count: number }>;
		};
	};
	const prismaClient = prisma as unknown as {
		$transaction: (callback: (transaction: TransactionMock) => Promise<unknown>) => Promise<unknown>;
	};
	const originalTransaction = prismaClient.$transaction;
	const submittedAt = new Date("2026-10-22T14:00:00.000Z");
	const transitions: unknown[] = [];
	let requestUpdate: unknown;
	let opinionCreate: unknown;
	const transaction: TransactionMock = {
		case: {
			async findFirst() {
				return {
					status: "MoreInfoRequested",
					slaPauseHistory: [{ pausedAt: "2026-10-22T12:00:00.000Z", resumedAt: null }],
				};
			},
			async updateMany(args) { transitions.push(args); return { count: 1 }; },
		},
		caseOpinion: {
			async create(args) {
				opinionCreate = args;
				return { id: "opinion-1", caseId: "case-1", doctorId: "doctor-1", text: "Final opinion.", createdAt: submittedAt };
			},
		},
		caseDocumentRequest: {
			async findFirst() { return { id: "request-1" }; },
			async updateMany(args) { requestUpdate = args; return { count: 1 }; },
		},
	};
	prismaClient.$transaction = async (callback) => callback(transaction);
	try {
		const opinion = await casesRepository.submitOpinion("case-1", "doctor-1", "Final opinion.", submittedAt);
		assert.equal(opinion?.id, "opinion-1");
		assert.deepEqual(transitions, [
			{
				where: { id: "case-1", doctorId: "doctor-1", status: "MoreInfoRequested" },
				data: {
					status: "OpinionGiven",
					slaPauseHistory: [{ pausedAt: "2026-10-22T12:00:00.000Z", resumedAt: submittedAt.toISOString() }],
				},
			},
			{
				where: { id: "case-1", doctorId: "doctor-1", status: "OpinionGiven" },
				data: { status: "Closed" },
			},
		]);
		assert.deepEqual(opinionCreate, { data: { caseId: "case-1", doctorId: "doctor-1", text: "Final opinion.", createdAt: submittedAt } });
		assert.deepEqual(requestUpdate, {
			where: { id: "request-1", fulfilledAt: null, closedAt: null },
			data: { closedAt: submittedAt },
		});
	} finally {
		prismaClient.$transaction = originalTransaction;
	}
});

test("payout eligibility repository uses a stable composite cursor and bounded page size", async () => {
	const caseDelegate = prisma.case as unknown as { findMany: (args: unknown) => Promise<unknown[]> };
	const originalFindMany = caseDelegate.findMany;
	const after = { caseId: "case-cursor", opinionCreatedAt: new Date("2026-10-22T00:00:00.000Z") };
	let query: unknown;
	caseDelegate.findMany = async (args) => { query = args; return []; };
	try {
		assert.deepEqual(await casesRepository.listClosedOpinionsForPayout(after), []);
		assert.deepEqual(query, {
			where: {
				status: "Closed",
				doctorId: { not: null },
				chargedAmount: { not: null },
				opinion: { is: { OR: [
					{ createdAt: { gt: after.opinionCreatedAt } },
					{ createdAt: after.opinionCreatedAt, caseId: { gt: after.caseId } },
				] } },
			},
			orderBy: [{ opinion: { createdAt: "asc" } }, { id: "asc" }],
			take: 100,
			select: {
				id: true,
				doctorId: true,
				chargedAmount: true,
				opinion: { select: { createdAt: true } },
			},
		});
	} finally {
		caseDelegate.findMany = originalFindMany;
	}
});

test("Opinion repository transaction rolls back Opinion, request close, and SLA changes when Case closure loses a race", async () => {
	type TransactionMock = {
		case: {
			findFirst: (args: unknown) => Promise<{ status: "MoreInfoRequested"; slaPauseHistory: Prisma.JsonValue } | null>;
			updateMany: (args: unknown) => Promise<{ count: number }>;
		};
		caseOpinion: { create: (args: unknown) => Promise<CaseOpinionRecord> };
		caseDocumentRequest: {
			findFirst: (args: unknown) => Promise<{ id: string } | null>;
			updateMany: (args: unknown) => Promise<{ count: number }>;
		};
	};
	const prismaClient = prisma as unknown as {
		$transaction: (callback: (transaction: TransactionMock) => Promise<unknown>) => Promise<unknown>;
	};
	const originalTransaction = prismaClient.$transaction;
	const submittedAt = new Date("2026-10-22T14:00:00.000Z");
	const initialPauseHistory = [{ pausedAt: "2026-10-22T12:00:00.000Z", resumedAt: null }];
	const state = {
		status: "MoreInfoRequested",
		slaPauseHistory: initialPauseHistory as Prisma.JsonValue,
		requestClosedAt: null as Date | null,
		opinionPersisted: false,
	};
	let caseUpdateCount = 0;
	const transaction: TransactionMock = {
		case: {
			async findFirst() { return { status: "MoreInfoRequested", slaPauseHistory: state.slaPauseHistory }; },
			async updateMany(args) {
				caseUpdateCount += 1;
				if (caseUpdateCount === 2) return { count: 0 };
				const data = (args as { data: { status: string; slaPauseHistory?: Prisma.JsonValue } }).data;
				state.status = data.status;
				if (data.slaPauseHistory) state.slaPauseHistory = data.slaPauseHistory;
				return { count: 1 };
			},
		},
		caseOpinion: {
			async create() {
				state.opinionPersisted = true;
				return { id: "opinion-1", caseId: "case-1", doctorId: "doctor-1", text: "Final opinion.", createdAt: submittedAt };
			},
		},
		caseDocumentRequest: {
			async findFirst() { return { id: "request-1" }; },
			async updateMany(args) {
				state.requestClosedAt = (args as { data: { closedAt: Date } }).data.closedAt;
				return { count: 1 };
			},
		},
	};
	prismaClient.$transaction = async (callback) => {
		const snapshot = structuredClone(state);
		try {
			return await callback(transaction);
		} catch (error) {
			Object.assign(state, snapshot);
			throw error;
		}
	};
	try {
		await assert.rejects(casesRepository.submitOpinion("case-1", "doctor-1", "Final opinion.", submittedAt), { code: "CASE_OPINION_CONFLICT" });
		assert.deepEqual(state, {
			status: "MoreInfoRequested",
			slaPauseHistory: initialPauseHistory,
			requestClosedAt: null,
			opinionPersisted: false,
		});
	} finally {
		prismaClient.$transaction = originalTransaction;
	}
});
