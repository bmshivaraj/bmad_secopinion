import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AuthContext } from "../../shared/auth-context";
import type { StorageProvider } from "../../shared/storage-provider";
import type { CaseDocumentRecord, CaseDocumentUpload, CaseDraftInput, CaseRecord } from "./domain";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";
process.env.JWT_SECRET ??= "cases-auth-test-secret";

const { createCasesService } = await import("./service");
const { casesRepository } = await import("./repository");
const { prisma } = await import("../../shared/prisma-client");

const PATIENT: AuthContext = { userId: "patient-a", role: "patient" };
const OTHER_PATIENT: AuthContext = { userId: "patient-b", role: "patient" };
const ADMIN: AuthContext = { userId: "admin-a", role: "admin" };
const DOCTOR: AuthContext = { userId: "doctor-a", role: "doctor" };

const VALID_INPUT: CaseDraftInput = {
	affectedBodyArea: "Left knee",
	condition: "Pain and swelling after a sports injury.",
	recommendation: "Arthroscopy was recommended.",
	additionalDetails: "Symptoms began six weeks ago.",
};

function upload(contentType = "application/pdf", bytes = new TextEncoder().encode("%PDF-1.7 report"), fileName = "report.pdf"): CaseDocumentUpload {
	return { contentType, bytes, fileName };
}

function createFixture(options: { failSaveAt?: number; failDocumentPersistence?: boolean; failDelete?: boolean } = {}) {
	const cases = new Map<string, CaseRecord>();
		const requestCases = new Map<string, string>();
	const documents = new Map<string, CaseDocumentRecord>();
	const files = new Map<string, Uint8Array>();
	let saveCalls = 0;
	let readCalls = 0;
	let failDelete = options.failDelete ?? false;
	const deleteCalls: string[] = [];

	const repository = {
		async createDraft(patientId: string, creationRequestId: string, input: Required<CaseDraftInput>): Promise<CaseRecord> {
			if (requestCases.has(creationRequestId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
			const now = new Date();
			const record: CaseRecord = {
				id: randomUUID(), patientId, ...input, selectedDoctorId: null, status: "Draft", documents: [], createdAt: now, updatedAt: now,
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
		async findById(caseId: string): Promise<CaseRecord | null> {
			return cases.get(caseId) ?? null;
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
			return document && record ? { ...document, case: { patientId: record.patientId } } : null;
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
	};

	return {
		cases,
		documents,
		files,
		deleteCalls,
		get saveCalls() { return saveCalls; },
		get readCalls() { return readCalls; },
		get doctorLookupCalls() { return doctorLookupCalls; },
		setFailDelete(value: boolean) { failDelete = value; },
		service: createCasesService(repository, storage, doctors),
	};
}

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
	assert.equal("doctorId" in selected, false);
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
	await assert.rejects(fixture.service.getDocument(metadata.id, DOCTOR), { code: "CASE_ACCESS_DENIED" });
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