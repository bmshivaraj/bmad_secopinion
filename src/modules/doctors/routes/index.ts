// Doctors module route-handler logic; HTTP concerns stay at this boundary.
import { NextResponse } from "next/server";
import { DomainError, fail } from "../../../shared/api-envelope";
import {
	InvalidRequestError,
	InvalidUpiIdError,
	SessionAuthorizationError,
	type CredentialUpload,
} from "../domain";

const MOBILE_NUMBER_PATTERN = /^\+?[0-9]{10,15}$/;

export const DOCTOR_REGISTRATION_COOKIE = "doctor_registration";
export const DOCTOR_SESSION_COOKIE = "doctor_session";
export const ADMIN_SESSION_COOKIE = "admin_session";

export interface StartRegistrationRequest {
	mobileNumber: string;
}

export interface VerifyRegistrationRequest {
	mobileNumber: string;
	otpId: string;
	code: string;
}

export interface DoctorLoginRequest {
	username: string;
	password: string;
}

function requireString(body: Record<string, unknown>, field: string): string {
	const value = body[field];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new InvalidRequestError(`${field} is required.`);
	}
	return value;
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new InvalidRequestError("Request body must be valid JSON.");
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new InvalidRequestError("Request body must be a JSON object.");
	}
	return body as Record<string, unknown>;
}

export async function parseStartRegistrationRequest(request: Request): Promise<StartRegistrationRequest> {
	const body = await parseJsonBody(request);
	const mobileNumber = requireString(body, "mobileNumber");
	if (!MOBILE_NUMBER_PATTERN.test(mobileNumber)) {
		throw new InvalidRequestError("mobileNumber must be a valid phone number.");
	}
	return { mobileNumber };
}

export async function parseVerifyRegistrationRequest(request: Request): Promise<VerifyRegistrationRequest> {
	const body = await parseJsonBody(request);
	const mobileNumber = requireString(body, "mobileNumber");
	if (!MOBILE_NUMBER_PATTERN.test(mobileNumber)) {
		throw new InvalidRequestError("mobileNumber must be a valid phone number.");
	}
	return { mobileNumber, otpId: requireString(body, "otpId"), code: requireString(body, "code") };
}

export async function parseDoctorApplicationRequest(request: Request): Promise<{
	fullName: string;
	username: string;
	password: string;
	upiId?: string;
	specialtyIds: string[];
	credentials: CredentialUpload[];
}> {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		throw new InvalidRequestError("Request body must be valid multipart form data.");
	}
	const fullName = formData.get("fullName");
	const username = formData.get("username");
	const password = formData.get("password");
	const upiId = formData.get("upiId");
	if (typeof fullName !== "string" || typeof username !== "string" || typeof password !== "string") {
		throw new InvalidRequestError("fullName, username, and password are required.");
	}
	if (upiId !== null && typeof upiId !== "string") throw new InvalidUpiIdError();
	const specialtyIds = formData.getAll("specialtyIds").map((value) => {
		if (typeof value !== "string") throw new InvalidRequestError("specialtyIds must be text values.");
		return value;
	});
	const credentialValues = formData.getAll("credentials");
	if (credentialValues.length < 1 || credentialValues.length > 5) {
		throw new InvalidRequestError("Upload between 1 and 5 credential files.");
	}
	const credentials: CredentialUpload[] = [];
	for (const value of credentialValues) {
		if (typeof File === "undefined" || !(value instanceof File)) {
			throw new InvalidRequestError("Each credential must be an uploaded file.");
		}
		if (value.size === 0 || value.size > 10 * 1024 * 1024) {
			throw new InvalidRequestError("Each credential must be non-empty and no larger than 10 MiB.");
		}
		credentials.push({
			fileName: value.name,
			contentType: value.type,
			bytes: new Uint8Array(await value.arrayBuffer()),
		});
	}
	return { fullName, username, password, ...(typeof upiId === "string" ? { upiId } : {}), specialtyIds, credentials };
}

export async function parseDoctorPayoutUpdateRequest(request: Request): Promise<{ upiId: string }> {
	const body = await parseJsonBody(request);
	if (typeof body.upiId !== "string") throw new InvalidUpiIdError();
	return { upiId: body.upiId };
}

export async function parseDoctorLoginRequest(request: Request): Promise<DoctorLoginRequest> {
	const body = await parseJsonBody(request);
	return { username: requireString(body, "username"), password: requireString(body, "password") };
}

export function readRequestCookie(request: Request, name: string): string | null {
	const cookieHeader = request.headers.get("cookie");
	if (!cookieHeader) return null;
	for (const cookie of cookieHeader.split(";")) {
		const separator = cookie.indexOf("=");
		if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
		try {
			return decodeURIComponent(cookie.slice(separator + 1).trim());
		} catch {
			return null;
		}
	}
	return null;
}

export function requireSessionToken(token: string | null): string {
	if (!token) throw new SessionAuthorizationError();
	return token;
}

const STATUS_BY_ERROR_CODE: Record<string, number> = {
	VALIDATION_ERROR: 400,
	MOBILE_ALREADY_REGISTERED: 409,
	DOCTOR_REGISTRATION_UNAVAILABLE: 429,
	OTP_RATE_LIMIT_EXCEEDED: 429,
	OTP_VERIFICATION_FAILED: 400,
	OTP_EXPIRED: 400,
	DOCTOR_REGISTRATION_UNAUTHORIZED: 401,
	PASSWORD_POLICY_ERROR: 400,
	USERNAME_ALREADY_TAKEN: 409,
	INVALID_CREDENTIALS: 401,
	CREDENTIAL_ACCESS_DENIED: 403,
	CREDENTIAL_NOT_FOUND: 404,
	SESSION_UNAUTHORIZED: 401,
	INVALID_UPI_ID: 400,
	DOCTOR_PAYOUT_ACCESS_DENIED: 403,
	DOCTOR_PAYOUT_PROFILE_NOT_FOUND: 404,
	PAYOUT_HISTORY_ACCESS_DENIED: 403,
};

export function toErrorResponse(error: unknown): NextResponse {
	if (error instanceof DomainError) {
		return NextResponse.json(fail(error.code, error.message), { status: STATUS_BY_ERROR_CODE[error.code] ?? 400 });
	}
	console.error("[doctors] unexpected error", error);
	return NextResponse.json(fail("INTERNAL_ERROR", "An unexpected error occurred."), { status: 500 });
}
