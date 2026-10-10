import { DomainError } from "../../../shared/api-envelope";

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
	affectedBodyArea: string;
	condition: string;
	recommendation: string;
	additionalDetails: string;
	status: "Draft";
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
