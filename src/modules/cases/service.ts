import type { AuthContext } from "../../shared/auth-context";
import { randomUUID } from "node:crypto";
import { adminService } from "../admin/service";
import { doctorsService } from "../doctors/service";
import { paymentsService } from "../payments/service";
import { PaymentRecoveryRequiredError } from "../payments/domain";
import type { PaymentAttemptInput } from "../payments/domain";
import { storageProvider } from "../../shared/storage-provider";
import type { StorageProvider } from "../../shared/storage-provider";
import type { Prisma } from "../../generated/prisma/client";
import {
	CaseAccessDeniedError,
	CaseDoctorSelectionConflictError,
	CaseDocumentNotFoundError,
	CaseDocumentRequiredError,
	CaseNotFoundError,
	CaseSessionUnauthorizedError,
	CaseSubmissionConflictError,
	CaseUploadTooLargeError,
	InvalidCaseInputError,
	type CaseDocumentRecord,
	type CaseDocumentUpload,
	type CaseDraftInput,
	type CaseRecord,
} from "./domain";
import { canTransitionCase } from "./domain";
import { casesRepository } from "./repository";

const MAX_DOCUMENT_COUNT = 5;
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const ACCEPTED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

type CasesRepository = Pick<
	typeof casesRepository,
	"createDraft" | "findByCreationRequestId" | "findLatestDraft" | "updateDraft" | "updateDraftDoctorSelection" | "updateCaseToSubmitted" | "findById" | "createDocuments" | "findDocumentById" | "deleteDocument"
>;

type DoctorsService = Pick<typeof doctorsService, "listVerifiedDoctors" | "getVerifiedDoctor">;
type AdminSettingsService = Pick<typeof adminService, "getPlatformSettings">;
type PaymentsService = Pick<typeof paymentsService, "findAttemptByCaseId" | "prepareAttempt" | "chargeAttempt">;

async function assertDraftMutationAllowed(payments: PaymentsService, caseId: string) {
	const attempt = await payments.findAttemptByCaseId(caseId);
	if (attempt && attempt.status !== "Failed") throw new CaseSubmissionConflictError();
}

function isUniqueConstraintViolation(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function normalizeDraftInput(input: CaseDraftInput): Required<CaseDraftInput> {
	const requiredText = (value: unknown, field: string, maxLength: number): string => {
		if (typeof value !== "string") throw new InvalidCaseInputError(`${field} must be text.`);
		const normalized = value.trim();
		if (!normalized || normalized.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
			throw new InvalidCaseInputError(`${field} must be 1-${maxLength} characters without control characters.`);
		}
		return normalized;
	};
	const details = input.additionalDetails ?? "";
	if (typeof details !== "string" || details.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(details)) {
		throw new InvalidCaseInputError("additionalDetails must be no more than 5000 characters.");
	}
	return {
		affectedBodyArea: requiredText(input.affectedBodyArea, "affectedBodyArea", 120),
		condition: requiredText(input.condition, "condition", 2000),
		recommendation: requiredText(input.recommendation, "recommendation", 2000),
		additionalDetails: details.trim(),
	};
}

function normalizeFileName(fileName: string): string {
	const baseName = fileName.replace(/\\/g, "/").split("/").pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
	if (!baseName || baseName.length > 255) {
		throw new InvalidCaseInputError("Each Document must have a file name no longer than 255 characters.");
	}
	return baseName;
}

function hasExpectedFileSignature(upload: CaseDocumentUpload): boolean {
	const bytes = upload.bytes;
	if (upload.contentType === "image/jpeg") {
		return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	}
	if (upload.contentType === "image/png") {
		return bytes.length >= 8
			&& bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
			&& bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
	}
	return upload.contentType === "application/pdf"
		&& bytes.length >= 5
		&& new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
}

function validateUploads(uploads: CaseDocumentUpload[]): CaseDocumentUpload[] {
	if (uploads.length < 1 || uploads.length > MAX_DOCUMENT_COUNT) {
		throw new InvalidCaseInputError("Upload between 1 and 5 Documents at a time.");
	}
	return uploads.map((upload) => {
		if (!ACCEPTED_CONTENT_TYPES.has(upload.contentType)) {
			throw new InvalidCaseInputError("Documents must be JPEG, PNG, or PDF files.");
		}
		if (upload.bytes.byteLength > MAX_DOCUMENT_SIZE) {
			throw new CaseUploadTooLargeError("Each Document must be no larger than 10 MiB.");
		}
		if (upload.bytes.byteLength === 0) {
			throw new InvalidCaseInputError("Each Document must be non-empty and no larger than 10 MiB.");
		}
		if (!hasExpectedFileSignature(upload)) {
			throw new InvalidCaseInputError("Document contents do not match the declared file type.");
		}
		return { ...upload, fileName: normalizeFileName(upload.fileName) };
	});
}

function assertPatient(caller: AuthContext): void {
	if (caller.role !== "patient" || !caller.userId) throw new CaseSessionUnauthorizedError();
}

function publicDocument(document: CaseDocumentRecord) {
	return {
		id: document.id,
		fileName: document.fileName,
		contentType: document.contentType,
		sizeBytes: document.sizeBytes,
		createdAt: document.createdAt,
	};
}

function publicDraft(record: CaseRecord) {
	return {
		id: record.id,
		doctorId: record.doctorId,
		affectedBodyArea: record.affectedBodyArea,
		condition: record.condition,
		recommendation: record.recommendation,
		additionalDetails: record.additionalDetails,
		selectedDoctorId: record.selectedDoctorId,
		urgencyTier: record.urgencyTier,
		chargedAmount: record.chargedAmount?.toFixed(2) ?? null,
		status: record.status,
		documents: record.documents.map(publicDocument),
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

function assertDraftOwner(record: CaseRecord | null, patientId: string): asserts record is CaseRecord {
	if (!record || record.status !== "Draft") throw new CaseNotFoundError();
	if (record.patientId !== patientId) throw new CaseAccessDeniedError();
}

async function assertPaymentReadyFor(repository: CasesRepository, caller: AuthContext, caseId: string) {
	assertPatient(caller);
	const record = await repository.findById(caseId);
	assertDraftOwner(record, caller.userId);
	if (record.documents.length === 0) throw new CaseDocumentRequiredError();
	return { caseId: record.id, ready: true as const };
}

export function createCasesService(
	repository: CasesRepository = casesRepository,
	storage: StorageProvider = storageProvider,
	doctors: DoctorsService = doctorsService,
	admin: AdminSettingsService = adminService,
	payments: PaymentsService = paymentsService,
) {
	return {
		async listVerifiedDoctors(caller: AuthContext) {
			assertPatient(caller);
			return doctors.listVerifiedDoctors();
		},

		async getOwnDraft(caller: AuthContext) {
			assertPatient(caller);
			const record = await repository.findLatestDraft(caller.userId);
			if (!record) return null;
			const attempt = await payments.findAttemptByCaseId(record.id);
			return {
				...publicDraft(record),
				selectedDoctorId: attempt && attempt.status !== "Failed" ? attempt.selectedDoctorId : record.selectedDoctorId,
				urgencyTier: attempt ? attempt.urgencyTier : record.urgencyTier,
				chargedAmount: attempt && attempt.status !== "Failed"
					? attempt.chargedAmount.toFixed(2)
					: record.chargedAmount?.toFixed(2) ?? null,
				paymentAttemptStatus: attempt?.status ?? null,
			};
		},

		async saveDraft(caller: AuthContext, input: CaseDraftInput, caseId?: string, creationRequestId?: string) {
			assertPatient(caller);
			const normalized = normalizeDraftInput(input);
			if (caseId) {
				const existing = await repository.findById(caseId);
				assertDraftOwner(existing, caller.userId);
				await assertDraftMutationAllowed(payments, caseId);
				const updated = await repository.updateDraft(caseId, caller.userId, normalized);
				if (!updated) {
					throw new CaseNotFoundError();
				}
				return publicDraft(updated);
			}
			const requestId = creationRequestId ?? randomUUID();
			const alreadyCreated = await repository.findByCreationRequestId(requestId);
			if (alreadyCreated) {
				assertDraftOwner(alreadyCreated, caller.userId);
				await assertDraftMutationAllowed(payments, alreadyCreated.id);
				const updated = await repository.updateDraft(alreadyCreated.id, caller.userId, normalized);
				if (!updated) throw new CaseNotFoundError();
				return publicDraft(updated);
			}
			try {
				return publicDraft(await repository.createDraft(caller.userId, requestId, normalized));
			} catch (error) {
				if (!isUniqueConstraintViolation(error)) throw error;
				const retried = await repository.findByCreationRequestId(requestId);
				if (!retried) throw error;
				assertDraftOwner(retried, caller.userId);
				await assertDraftMutationAllowed(payments, retried.id);
				const updated = await repository.updateDraft(retried.id, caller.userId, normalized);
				if (!updated) throw new CaseNotFoundError();
				return publicDraft(updated);
			}
		},

		async saveDraftDoctorSelection(caller: AuthContext, caseId: string, selectedDoctorId: string | null) {
			assertPatient(caller);
			if (typeof selectedDoctorId !== "string" && selectedDoctorId !== null) {
				throw new InvalidCaseInputError("selectedDoctorId must be a string or null.");
			}
			const normalizedDoctorId = typeof selectedDoctorId === "string" ? selectedDoctorId.trim() : null;
			if (typeof selectedDoctorId === "string" && !normalizedDoctorId) {
				throw new InvalidCaseInputError("selectedDoctorId must be a non-empty string or null.");
			}

			const existing = await repository.findById(caseId);
			assertDraftOwner(existing, caller.userId);
			await assertDraftMutationAllowed(payments, caseId);
			if (normalizedDoctorId !== null && !await doctors.getVerifiedDoctor(normalizedDoctorId)) {
				throw new CaseDoctorSelectionConflictError();
			}

			const updated = await repository.updateDraftDoctorSelection(caseId, caller.userId, normalizedDoctorId);
			if (!updated) {
				const current = await repository.findById(caseId);
				assertDraftOwner(current, caller.userId);
				throw new CaseNotFoundError();
			}
			return publicDraft(updated);
		},

		async uploadDocuments(caller: AuthContext, caseId: string, uploads: CaseDocumentUpload[]) {
			assertPatient(caller);
			const record = await repository.findById(caseId);
			assertDraftOwner(record, caller.userId);
			await assertDraftMutationAllowed(payments, caseId);
			const validUploads = validateUploads(uploads);
			const savedFiles: { storageKey: string; upload: CaseDocumentUpload }[] = [];
			try {
				for (const upload of validUploads) {
					const saved = await storage.save(upload.bytes);
					savedFiles.push({ storageKey: saved.storageKey, upload });
				}
				const documents = await repository.createDocuments(caseId, savedFiles.map(({ storageKey, upload }) => ({
					fileName: upload.fileName,
					contentType: upload.contentType,
					sizeBytes: upload.bytes.byteLength,
					storageKey,
				})));
				return documents.map(publicDocument);
			} catch (error) {
				await Promise.all(savedFiles.map(({ storageKey }) => storage.delete(storageKey).catch(() => undefined)));
				throw error;
			}
		},

		async getDocument(documentId: string, caller: AuthContext) {
			const document = await repository.findDocumentById(documentId);
			if (!document) throw new CaseDocumentNotFoundError();
			if (caller.role !== "admin" && !(caller.role === "patient" && caller.userId === document.case.patientId)) {
				throw new CaseAccessDeniedError();
			}
			const bytes = await storage.read(document.storageKey);
			if (!bytes) throw new CaseDocumentNotFoundError();
			return {
				bytes,
				fileName: document.fileName,
				contentType: document.contentType,
			};
		},

		async deleteDocument(documentId: string, caller: AuthContext) {
			assertPatient(caller);
			const document = await repository.findDocumentById(documentId);
			if (!document) throw new CaseDocumentNotFoundError();
			if (caller.userId !== document.case.patientId) throw new CaseAccessDeniedError();
			await assertDraftMutationAllowed(payments, document.caseId);
			await storage.delete(document.storageKey);
			await repository.deleteDocument(documentId, document.caseId);
		},

		async assertPaymentReady(caller: AuthContext, caseId: string) {
			return assertPaymentReadyFor(repository, caller, caseId);
		},

		async getPaymentOptions(caller: AuthContext) {
			assertPatient(caller);
			const settings = await admin.getPlatformSettings();
			return {
				standardCaseFee: settings.standardCaseFee.toFixed(2),
				urgentCaseFee: settings.urgentCaseFee.toFixed(2),
			};
		},

		async submitCase(caller: AuthContext, caseId: string, urgencyTier: "Standard" | "Urgent", requestedDoctorId?: string | null) {
			assertPatient(caller);
			if (urgencyTier !== "Standard" && urgencyTier !== "Urgent") throw new InvalidCaseInputError("urgencyTier must be Standard or Urgent.");

			let record = await repository.findById(caseId);
			if (!record) throw new CaseNotFoundError();
			if (record.patientId !== caller.userId) throw new CaseAccessDeniedError();
			const previousAttempt = await payments.findAttemptByCaseId(caseId);
			if (record.status !== "Draft") {
				if (
					record.status === "Submitted"
					&& previousAttempt?.patientId === caller.userId
					&& previousAttempt.status === "Succeeded"
					&& record.chargedAmount?.equals(previousAttempt.chargedAmount)
				) {
					return {
						caseId,
						doctorId: previousAttempt.selectedDoctorId,
						urgencyTier: previousAttempt.urgencyTier,
						chargedAmount: previousAttempt.chargedAmount.toFixed(2),
						selectedDoctorId: previousAttempt.selectedDoctorId,
						status: "Submitted" as const,
					};
				}
				throw new CaseSubmissionConflictError();
			}
			const recovering = previousAttempt && previousAttempt.status !== "Failed";
			if (!recovering) await assertPaymentReadyFor(repository, caller, caseId);
			let selectedDoctorId = recovering
				? previousAttempt.selectedDoctorId
				: requestedDoctorId === undefined
					? (previousAttempt?.status === "Failed" ? record.selectedDoctorId : previousAttempt ? previousAttempt.selectedDoctorId : record.selectedDoctorId)
					: requestedDoctorId;
			if (selectedDoctorId !== null && !await doctors.getVerifiedDoctor(selectedDoctorId)) {
				throw new CaseDoctorSelectionConflictError();
			}

			let chargedAmount: Prisma.Decimal;
			if (recovering) {
				urgencyTier = previousAttempt.urgencyTier;
				chargedAmount = previousAttempt.chargedAmount;
			} else {
				const settings = await admin.getPlatformSettings();
				chargedAmount = urgencyTier === "Urgent" ? settings.urgentCaseFee : settings.standardCaseFee;
			}
			if (!recovering) {
				const updated = await repository.updateDraftDoctorSelection(caseId, caller.userId, selectedDoctorId);
				if (!updated) throw new CaseSubmissionConflictError();
			}

			const attemptInput: PaymentAttemptInput = {
				caseId,
				patientId: caller.userId,
				urgencyTier,
				chargedAmount,
				selectedDoctorId,
			};
			let attempt = await payments.prepareAttempt(attemptInput);
			if (attempt.patientId !== caller.userId) throw new CaseSubmissionConflictError();
			if (attempt.urgencyTier !== urgencyTier || attempt.selectedDoctorId !== selectedDoctorId) {
				urgencyTier = attempt.urgencyTier;
				selectedDoctorId = attempt.selectedDoctorId;
				chargedAmount = attempt.chargedAmount;
				if (selectedDoctorId !== null && !await doctors.getVerifiedDoctor(selectedDoctorId)) {
					throw new CaseDoctorSelectionConflictError();
				}
			}
			if (attempt.status !== "Succeeded") attempt = await payments.chargeAttempt(attempt);

			if (!canTransitionCase(record.status, "Submitted")) throw new CaseSubmissionConflictError();
			let submitted: CaseRecord | null;
			try {
				submitted = await repository.updateCaseToSubmitted(caseId, caller.userId, attempt.urgencyTier, attempt.chargedAmount, attempt.selectedDoctorId);
			} catch {
				throw new PaymentRecoveryRequiredError();
			}
			if (!submitted) {
				record = await repository.findById(caseId);
				if (
					record?.status !== "Submitted"
					|| record.urgencyTier !== attempt.urgencyTier
					|| !record.chargedAmount?.equals(attempt.chargedAmount)
					|| record.doctorId !== attempt.selectedDoctorId
				) {
					if (record?.status === "Draft") throw new PaymentRecoveryRequiredError();
					throw new CaseSubmissionConflictError();
				}
			}
			return {
				caseId,
				doctorId: attempt.selectedDoctorId,
				urgencyTier: attempt.urgencyTier,
				chargedAmount: attempt.chargedAmount.toFixed(2),
				selectedDoctorId: attempt.selectedDoctorId,
				status: "Submitted" as const,
			};
		},
	};
}

export const casesService = createCasesService();
