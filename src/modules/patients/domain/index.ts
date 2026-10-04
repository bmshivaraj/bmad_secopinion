import { DomainError } from "../../../shared/api-envelope";

export interface Patient {
  id: string;
  mobileNumber: string;
  passwordHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class InvalidRequestError extends DomainError {
  readonly code = "VALIDATION_ERROR";
}

export class MobileAlreadyRegisteredError extends DomainError {
  readonly code = "MOBILE_ALREADY_REGISTERED";
  constructor(mobileNumber: string) {
    super(`Mobile number ${mobileNumber} is already registered. Please log in or recover your account.`);
  }
}

export class OtpRateLimitExceededError extends DomainError {
  readonly code = "OTP_RATE_LIMIT_EXCEEDED";
  constructor(mobileNumber: string) {
    super(`Too many OTP requests for ${mobileNumber}. Please wait before requesting another OTP.`);
  }
}

// MockOtpProvider.verifyOtp only returns a boolean (Story 1.1's interface is
// frozen); known expiry is tracked by the Patients service from sendOtp's result.
export class OtpVerificationFailedError extends DomainError {
  readonly code = "OTP_VERIFICATION_FAILED";
  constructor() {
    super("The OTP code is incorrect or invalid.");
  }
}

export class OtpExpiredError extends DomainError {
  readonly code = "OTP_EXPIRED";
  constructor() {
    super("The OTP code has expired. Please request a new code.");
  }
}

// Registration OTP-request rate limiting (max 3 requests / 10-minute window,
// per mobile number). Lives in the Patients module -- not MockOtpProvider,
// which is shared infra -- since the limit is specific to registration abuse.
const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const MAX_OTP_REQUESTS_PER_WINDOW = 3;
const otpRequestLog = new Map<string, number[]>();
let requestsSinceCleanup = 0;

function recentRequestTimestamps(mobileNumber: string): number[] {
  const now = Date.now();
  const recent = (otpRequestLog.get(mobileNumber) ?? []).filter(
    (timestamp) => now - timestamp < OTP_REQUEST_WINDOW_MS,
  );
  otpRequestLog.set(mobileNumber, recent);
  return recent;
}

export function isOtpRequestRateLimited(mobileNumber: string): boolean {
  return recentRequestTimestamps(mobileNumber).length >= MAX_OTP_REQUESTS_PER_WINDOW;
}

export function recordOtpRequest(mobileNumber: string): void {
  const recent = recentRequestTimestamps(mobileNumber);
  recent.push(Date.now());
  otpRequestLog.set(mobileNumber, recent);

  requestsSinceCleanup += 1;
  if (requestsSinceCleanup >= 100) {
    const now = Date.now();
    for (const [loggedMobileNumber, timestamps] of otpRequestLog) {
      const activeTimestamps = timestamps.filter((timestamp) => now - timestamp < OTP_REQUEST_WINDOW_MS);
      if (activeTimestamps.length === 0) {
        otpRequestLog.delete(loggedMobileNumber);
      } else if (activeTimestamps.length !== timestamps.length) {
        otpRequestLog.set(loggedMobileNumber, activeTimestamps);
      }
    }
    requestsSinceCleanup = 0;
  }
}
