import { DomainError } from "../../../shared/api-envelope";
import type { Prisma } from "../../../generated/prisma/client";
import type { CaseStatus } from "./case-state-machine";

export { CASE_STATUSES, CASE_STATUS_TRANSITIONS, canTransitionCase } from "./case-state-machine";
export type { CaseStatus } from "./case-state-machine";

export interface CaseDocumentRecord {
	id: string;
	caseId: string;
	fileName: string;
	contentType: string;
	sizeBytes: number;
	storageKey: string;
	createdAt: Date;
}

export interface CaseRecord {
	id: string;
	patientId: string;
	doctorId: string | null;
	specialtyId: string | null;
	affectedBodyArea: string;
	condition: string;
	recommendation: string;
	additionalDetails: string;
	selectedDoctorId: string | null;
	urgencyTier: "Standard" | "Urgent" | null;
	chargedAmount: Prisma.Decimal | null;
	status: CaseStatus;
	submittedAt: Date | null;
	slaPauseHistory: Prisma.JsonValue;
	assignmentLockVersion: number;
	createdAt: Date;
	updatedAt: Date;
	documents: CaseDocumentRecord[];
}

export interface CaseDraftInput {
	affectedBodyArea: string;
	condition: string;
	recommendation: string;
	additionalDetails?: string;
}

export interface CaseDocumentUpload {
	fileName: string;
	contentType: string;
	bytes: Uint8Array;
}

export class InvalidCaseInputError extends DomainError {
	readonly code = "VALIDATION_ERROR";

	constructor(message: string) {
		super(message);
	}
}

export class CaseSessionUnauthorizedError extends DomainError {
	readonly code = "SESSION_UNAUTHORIZED";

	constructor() {
		super("A valid Patient session is required.");
	}
}

export class CaseAdminAccessDeniedError extends DomainError {
	readonly code = "CASE_ADMIN_ACCESS_DENIED";

	constructor() {
		super("An Admin session is required to classify Cases.");
	}
}

export class CaseDoctorAccessDeniedError extends DomainError {
	readonly code = "CASE_DOCTOR_ACCESS_DENIED";

	constructor() {
		super("A currently Verified Doctor session is required to access the queue.");
	}
}

export class CaseClassificationConflictError extends DomainError {
	readonly code = "CASE_CLASSIFICATION_CONFLICT";

	constructor() {
		super("This Case was changed or is no longer available for classification.");
	}
}

export class CaseAccessDeniedError extends DomainError {
	readonly code = "CASE_ACCESS_DENIED";

	constructor() {
		super("You are not authorized to access this Case or Document.");
	}
}

export class CaseNotFoundError extends DomainError {
	readonly code = "CASE_NOT_FOUND";

	constructor() {
		super("Case not found.");
	}
}

export class CaseDoctorSelectionConflictError extends DomainError {
	readonly code = "CASE_DOCTOR_SELECTION_CONFLICT";

	constructor() {
		super("The selected Doctor is not verified or available. Choose another Doctor or continue without a preference.");
	}
}

export class CaseSubmissionConflictError extends DomainError {
	readonly code = "CASE_SUBMISSION_CONFLICT";

	constructor() {
		super("This Case can no longer be submitted with those selections.");
	}
}

export class CaseDocumentNotFoundError extends DomainError {
	readonly code = "CASE_DOCUMENT_NOT_FOUND";

	constructor() {
		super("Document not found.");
	}
}

export class CaseDocumentRequiredError extends DomainError {
	readonly code = "CASE_DOCUMENT_REQUIRED";

	constructor() {
		super("Upload at least one supporting Document before continuing.");
	}
}

export class CaseUploadTooLargeError extends DomainError {
	readonly code = "UPLOAD_TOO_LARGE";

	constructor(message = "The multipart request must not exceed 50 MiB.") {
		super(message);
	}
}
