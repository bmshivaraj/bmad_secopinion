export interface ApiResult<T> {
	data: T | null;
	error: { message: string } | null;
}

export interface CaseDocument {
	id: string;
	fileName: string;
	contentType: string;
	sizeBytes: number;
	createdAt: string;
}

export interface CaseDocumentRequest {
	id: string;
	note: string;
	createdAt: string;
	fulfilledAt: string | null;
	closedAt: string | null;
}

export interface CaseOpinion {
	text: string;
	createdAt: string;
}

export interface PatientCase {
	id: string;
	affectedBodyArea: string;
	condition: string;
	recommendation: string;
	additionalDetails: string;
	status: string;
	urgencyTier: "Standard" | "Urgent" | null;
	chargedAmount: string | null;
	doctor: { fullName: string; specialties: string[] } | null;
	submittedAt: string | null;
	createdAt: string;
	updatedAt: string;
	refundConfirmedAt: string | null;
	refundedAmount: string | null;
	documents: CaseDocument[];
	documentRequests: CaseDocumentRequest[];
	opinion: CaseOpinion | null;
}