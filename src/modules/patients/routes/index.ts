// Patients module route-handler logic, wired into src/app/api routes starting Story 1.2.
import { NextResponse } from "next/server";
import { DomainError, fail } from "../../../shared/api-envelope";
import { GUARDIAN_RELATIONSHIPS, InvalidRequestError, type GuardianRegistrationInput } from "../domain";

const MOBILE_NUMBER_PATTERN = /^\+?[0-9]{10,15}$/;

export interface StartRegistrationRequest {
  mobileNumber: string;
}

export interface VerifyRegistrationRequest {
  mobileNumber: string;
  otpId: string;
  code: string;
}

export interface PasswordSetupRequest {
  username: string;
  password: string;
  guardianRegistration: GuardianRegistrationInput;
}

export interface PatientLoginRequest {
  username: string;
  password: string;
}

export const PATIENT_SETUP_COOKIE = "patient_password_setup";
export const PATIENT_SESSION_COOKIE = "patient_session";

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidRequestError(`${field} is required`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new InvalidRequestError(`${field} must be a string`);
  return value;
}

function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new InvalidRequestError(`${field} must be a boolean`);
  return value;
}

export async function parseStartRegistrationRequest(request: Request): Promise<StartRegistrationRequest> {
  const body = await parseJsonBody(request);
  const mobileNumber = requireString(body, "mobileNumber");
  if (!MOBILE_NUMBER_PATTERN.test(mobileNumber)) {
    throw new InvalidRequestError("mobileNumber must be a valid phone number");
  }
  return { mobileNumber };
}

export async function parseVerifyRegistrationRequest(request: Request): Promise<VerifyRegistrationRequest> {
  const body = await parseJsonBody(request);
  const mobileNumber = requireString(body, "mobileNumber");
  if (!MOBILE_NUMBER_PATTERN.test(mobileNumber)) {
    throw new InvalidRequestError("mobileNumber must be a valid phone number");
  }
  const otpId = requireString(body, "otpId");
  const code = requireString(body, "code");
  return { mobileNumber, otpId, code };
}

export async function parsePasswordSetupRequest(request: Request): Promise<PasswordSetupRequest> {
  const body = await parseJsonBody(request);
  const guardianRelationship = optionalString(body, "guardianRelationship");
  if (
    guardianRelationship !== undefined
    && !GUARDIAN_RELATIONSHIPS.includes(guardianRelationship as (typeof GUARDIAN_RELATIONSHIPS)[number])
  ) {
    throw new InvalidRequestError("guardianRelationship is invalid");
  }
  return {
    username: requireString(body, "username"),
    password: requireString(body, "password"),
    guardianRegistration: {
      isMinor: optionalBoolean(body, "isMinor") ?? false,
      minorName: optionalString(body, "minorName"),
      guardianRelationship,
      authorityAttested: optionalBoolean(body, "authorityAttested"),
    },
  };
}

export async function parsePatientLoginRequest(request: Request): Promise<PatientLoginRequest> {
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

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new InvalidRequestError("Request body must be valid JSON");
  }
  if (typeof body !== "object" || body === null) {
    throw new InvalidRequestError("Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

const STATUS_BY_ERROR_CODE: Record<string, number> = {
  VALIDATION_ERROR: 400,
  MOBILE_ALREADY_REGISTERED: 409,
  OTP_RATE_LIMIT_EXCEEDED: 429,
  OTP_VERIFICATION_FAILED: 400,
  OTP_EXPIRED: 400,
  PASSWORD_POLICY_ERROR: 400,
  PASSWORD_SETUP_UNAUTHORIZED: 401,
  GUARDIAN_DECLARATION_INVALID: 400,
  USERNAME_ALREADY_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
};

// Maps a typed domain error to an ApiFailure + HTTP status (AD-9: business
// logic never throws raw HTTP errors -- that mapping happens only here).
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    const status = STATUS_BY_ERROR_CODE[error.code] ?? 400;
    return NextResponse.json(fail(error.code, error.message), { status });
  }
  console.error("[patients] unexpected error", error);
  return NextResponse.json(fail("INTERNAL_ERROR", "An unexpected error occurred."), { status: 500 });
}
