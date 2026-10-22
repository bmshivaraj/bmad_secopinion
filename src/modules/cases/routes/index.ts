import { NextResponse } from "next/server";
import { DomainError, fail } from "../../../shared/api-envelope";
import { verifyAuthToken, type AuthContext } from "../../../shared/auth-context";
import {
	ADMIN_SESSION_COOKIE,
	DOCTOR_SESSION_COOKIE,
	readRequestCookie as readDoctorRequestCookie,
} from "../../doctors/routes";
import {
	PATIENT_SESSION_COOKIE,
	readRequestCookie,
} from "../../patients/routes";
import {
	CaseAdminAccessDeniedError,
	CaseSessionUnauthorizedError,
	CaseUploadTooLargeError,
	InvalidCaseInputError,
	type CaseDocumentUpload,
	type CaseDraftInput,
} from "../domain";

const MAX_MULTIPART_SIZE = 50 * 1024 * 1024;

function createBoundedMultipartBody(request: Request): ReadableStream<Uint8Array> {
	const reader = request.body?.getReader();
	if (!reader) return new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
	let bytesRead = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { done, value } = await reader.read();
			if (done) {
				controller.close();
				return;
			}
			bytesRead += value.byteLength;
			if (bytesRead > MAX_MULTIPART_SIZE) {
				await reader.cancel().catch(() => undefined);
				controller.error(new CaseUploadTooLargeError());
				return;
			}
			controller.enqueue(value);
		},
		cancel(reason) {
			return reader.cancel(reason);
		},
	});
}

export async function parseCaseDraftRequest(request: Request): Promise<{ input: CaseDraftInput; caseId?: string; creationRequestId?: string }> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new InvalidCaseInputError("Request body must be valid JSON.");
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new InvalidCaseInputError("Request body must be a JSON object.");
	}
	const values = body as Record<string, unknown>;
	if (values.caseId !== undefined && (typeof values.caseId !== "string" || !values.caseId.trim())) {
		throw new InvalidCaseInputError("caseId must be a non-empty string.");
	}
	if (values.creationRequestId !== undefined && (typeof values.creationRequestId !== "string" || !/^[0-9a-f-]{36}$/i.test(values.creationRequestId))) {
		throw new InvalidCaseInputError("creationRequestId must be a UUID.");
	}
	return {
		input: {
			affectedBodyArea: values.affectedBodyArea as string,
			condition: values.condition as string,
			recommendation: values.recommendation as string,
			additionalDetails: values.additionalDetails as string | undefined,
		},
		...(typeof values.caseId === "string" ? { caseId: values.caseId } : {}),
		...(typeof values.creationRequestId === "string" ? { creationRequestId: values.creationRequestId } : {}),
	};
}

export async function parseDoctorSelectionRequest(request: Request): Promise<string | null> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new InvalidCaseInputError("Request body must be valid JSON.");
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new InvalidCaseInputError("Request body must be a JSON object.");
	}
	const selectedDoctorId = (body as Record<string, unknown>).selectedDoctorId;
	if (selectedDoctorId !== null && (typeof selectedDoctorId !== "string" || !selectedDoctorId.trim())) {
		throw new InvalidCaseInputError("selectedDoctorId must be a non-empty string or null.");
	}
	return typeof selectedDoctorId === "string" ? selectedDoctorId.trim() : null;
}

export async function parseCaseSubmissionRequest(request: Request): Promise<{
	urgencyTier: "Standard" | "Urgent";
	selectedDoctorId?: string | null;
}> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new InvalidCaseInputError("Request body must be valid JSON.");
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new InvalidCaseInputError("Request body must be a JSON object.");
	}
	const values = body as Record<string, unknown>;
	if (values.urgencyTier !== "Standard" && values.urgencyTier !== "Urgent") {
		throw new InvalidCaseInputError("urgencyTier must be Standard or Urgent.");
	}
	if (values.selectedDoctorId !== undefined && values.selectedDoctorId !== null
		&& (typeof values.selectedDoctorId !== "string" || !values.selectedDoctorId.trim())) {
		throw new InvalidCaseInputError("selectedDoctorId must be a non-empty string or null.");
	}
	return {
		urgencyTier: values.urgencyTier,
		...(values.selectedDoctorId !== undefined
			? { selectedDoctorId: typeof values.selectedDoctorId === "string" ? values.selectedDoctorId.trim() : null }
			: {}),
	};
}

export async function parseCaseClassificationRequest(request: Request): Promise<{ specialtyId: string }> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new InvalidCaseInputError("Request body must be valid JSON.");
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new InvalidCaseInputError("Request body must be a JSON object.");
	}
	const specialtyId = (body as Record<string, unknown>).specialtyId;
	if (typeof specialtyId !== "string" || !specialtyId.trim()) {
		throw new InvalidCaseInputError("specialtyId must be a non-empty string.");
	}
	return { specialtyId: specialtyId.trim() };
}

export async function parseCaseDocumentUploads(request: Request): Promise<CaseDocumentUpload[]> {
	const contentLength = Number(request.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_SIZE) {
		throw new CaseUploadTooLargeError();
	}

	let formData: FormData;
	try {
		formData = await new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: createBoundedMultipartBody(request),
			duplex: "half",
		} as RequestInit & { duplex: "half" }).formData();
	} catch (error) {
		if (error instanceof CaseUploadTooLargeError) throw error;
		throw new InvalidCaseInputError("Request body must be valid multipart form data.");
	}
	const values = formData.getAll("documents");
	if (values.length < 1 || values.length > 5) {
		throw new InvalidCaseInputError("Upload between 1 and 5 Documents at a time.");
	}
	const uploads: CaseDocumentUpload[] = [];
	for (const value of values) {
		if (typeof File === "undefined" || !(value instanceof File)) {
			throw new InvalidCaseInputError("Each Document must be an uploaded file.");
		}
		if (value.size > 10 * 1024 * 1024) {
			throw new CaseUploadTooLargeError("Each Document must be no larger than 10 MiB.");
		}
		uploads.push({
			fileName: value.name,
			contentType: value.type,
			bytes: new Uint8Array(await value.arrayBuffer()),
		});
	}
	return uploads;
}

function readSession(token: string | null, role: AuthContext["role"]): AuthContext {
	if (!token) throw new CaseSessionUnauthorizedError();
	try {
		const caller = verifyAuthToken(token);
		if (caller.role !== role) throw new CaseSessionUnauthorizedError();
		return caller;
	} catch {
		throw new CaseSessionUnauthorizedError();
	}
}

export function requirePatientContext(request: Request): AuthContext {
	return readSession(readRequestCookie(request, PATIENT_SESSION_COOKIE), "patient");
}

export function requireDoctorContext(request: Request): AuthContext {
	return readSession(readDoctorRequestCookie(request, DOCTOR_SESSION_COOKIE), "doctor");
}

export function requireAdminCaseContext(request: Request): AuthContext {
	const token = readDoctorRequestCookie(request, ADMIN_SESSION_COOKIE);
	if (!token) throw new CaseSessionUnauthorizedError();
	let caller: AuthContext;
	try {
		caller = verifyAuthToken(token);
	} catch {
		throw new CaseSessionUnauthorizedError();
	}
	if (caller.role !== "admin") throw new CaseAdminAccessDeniedError();
	return caller;
}

export function requireDocumentReaderContext(request: Request): AuthContext {
	const patientToken = readRequestCookie(request, PATIENT_SESSION_COOKIE);
	if (patientToken) {
		try {
			const caller = verifyAuthToken(patientToken);
			if (caller.role === "patient") return caller;
		} catch {
			// Try the Admin session cookie below; neither cookie is an authorization decision by itself.
		}
	}
	const doctorToken = readDoctorRequestCookie(request, DOCTOR_SESSION_COOKIE);
	if (doctorToken) {
		try {
			const caller = verifyAuthToken(doctorToken);
			if (caller.role === "doctor") return caller;
		} catch {
			// Continue to the Admin session cookie; a cookie is not an authorization decision by itself.
		}
	}
	return readSession(readDoctorRequestCookie(request, ADMIN_SESSION_COOKIE), "admin");
}

const STATUS_BY_ERROR_CODE: Record<string, number> = {
	VALIDATION_ERROR: 400,
	SESSION_UNAUTHORIZED: 401,
	CASE_ACCESS_DENIED: 403,
	CASE_ADMIN_ACCESS_DENIED: 403,
	CASE_DOCTOR_ACCESS_DENIED: 403,
	CASE_NOT_FOUND: 404,
	CASE_CLASSIFICATION_CONFLICT: 409,
	CASE_DOCUMENT_NOT_FOUND: 404,
	CASE_DOCUMENT_REQUIRED: 409,
	CASE_DOCTOR_SELECTION_CONFLICT: 409,
	CASE_SUBMISSION_CONFLICT: 409,
	PAYMENT_ATTEMPT_CONFLICT: 409,
	PAYMENT_DECLINED: 402,
	PAYMENT_RECOVERY_REQUIRED: 503,
	PLATFORM_SETTINGS_UNAVAILABLE: 503,
	UPLOAD_TOO_LARGE: 413,
};

export function toCasesErrorResponse(error: unknown): NextResponse {
	if (error instanceof DomainError) {
		return NextResponse.json(fail(error.code, error.message), {
			status: STATUS_BY_ERROR_CODE[error.code] ?? 400,
			headers: { "cache-control": "private, no-store" },
		});
	}
	console.error("[cases] unexpected error", error);
	return NextResponse.json(fail("INTERNAL_ERROR", "An unexpected error occurred."), {
		status: 500,
		headers: { "cache-control": "private, no-store" },
	});
}
