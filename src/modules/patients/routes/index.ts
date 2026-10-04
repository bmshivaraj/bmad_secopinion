// Patients module route-handler logic, wired into src/app/api routes starting Story 1.2.
import { NextResponse } from "next/server";
import { DomainError, fail } from "../../../shared/api-envelope";
import { InvalidRequestError } from "../domain";

const MOBILE_NUMBER_PATTERN = /^\+?[0-9]{10,15}$/;

export interface StartRegistrationRequest {
  mobileNumber: string;
}

export interface VerifyRegistrationRequest {
  mobileNumber: string;
  otpId: string;
  code: string;
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidRequestError(`${field} is required`);
  }
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
