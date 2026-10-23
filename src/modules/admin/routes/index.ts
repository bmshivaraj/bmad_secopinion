import { NextResponse } from "next/server";
import { DomainError, fail } from "../../../shared/api-envelope";
import { verifyAuthToken, type AuthContext } from "../../../shared/auth-context";
import { ADMIN_SESSION_COOKIE, readRequestCookie } from "../../doctors/routes";
import {
	AdminAccessDeniedError,
	AdminSessionAuthorizationError,
	InvalidAdminRequestError,
} from "../domain";

export { ADMIN_SESSION_COOKIE };

export interface AdminLoginRequest {
	username: string;
	password: string;
}

export async function parseAdminLoginRequest(request: Request): Promise<AdminLoginRequest> {
	const body = await parseJsonBody(request);
	if (typeof body.username !== "string" || !body.username.trim()) {
		throw new InvalidAdminRequestError("username is required.");
	}
	if (typeof body.password !== "string" || !body.password) {
		throw new InvalidAdminRequestError("password is required.");
	}
	return { username: body.username, password: body.password };
}

export async function parseAdminDecisionRequest(request: Request): Promise<{ verificationStatus: "Verified" | "Rejected" }> {
	const body = await parseJsonBody(request);
	if (body.verificationStatus !== "Verified" && body.verificationStatus !== "Rejected") {
		throw new InvalidAdminRequestError("verificationStatus must be Verified or Rejected.");
	}
	return { verificationStatus: body.verificationStatus };
}

export async function parseAdminSpecialtyRequest(request: Request): Promise<{ name: string }> {
	const body = await parseJsonBody(request);
	if (typeof body.name !== "string") throw new InvalidAdminRequestError("name must be a string.");
	return { name: body.name };
}

export async function parseAdminPlatformSettingsRequest(request: Request): Promise<unknown> {
	return parseJsonBody(request);
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw new InvalidAdminRequestError("Request body must be valid JSON.");
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		throw new InvalidAdminRequestError("Request body must be a JSON object.");
	}
	return body as Record<string, unknown>;
}

export function requireAdminContext(request: Request): AuthContext {
	const token = readRequestCookie(request, ADMIN_SESSION_COOKIE);
	if (!token) throw new AdminSessionAuthorizationError();

	let caller: AuthContext;
	try {
		caller = verifyAuthToken(token);
	} catch {
		throw new AdminSessionAuthorizationError();
	}
	if (caller.role !== "admin") throw new AdminAccessDeniedError();
	return caller;
}

const STATUS_BY_ERROR_CODE: Record<string, number> = {
	VALIDATION_ERROR: 400,
	INVALID_CREDENTIALS: 401,
	ADMIN_SESSION_UNAUTHORIZED: 401,
	ADMIN_ACCESS_DENIED: 403,
	DOCTOR_VERIFICATION_ACCESS_DENIED: 403,
	DOCTOR_NOT_FOUND: 404,
	DOCTOR_VERIFICATION_CONFLICT: 409,
	PLATFORM_SETTINGS_UNAVAILABLE: 503,
	ADMIN_PROFILE_NOT_FOUND: 404,
	SPECIALTY_NAME_ALREADY_EXISTS: 409,
};

export function toAdminErrorResponse(error: unknown): NextResponse {
	const headers = { "cache-control": "private, no-store" };
	if (error instanceof DomainError) {
		return NextResponse.json(fail(error.code, error.message), { status: STATUS_BY_ERROR_CODE[error.code] ?? 400, headers });
	}
	console.error("[admin] unexpected error", error);
	return NextResponse.json(fail("INTERNAL_ERROR", "An unexpected error occurred."), { status: 500, headers });
}
