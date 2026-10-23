import { DomainError } from "../../../shared/api-envelope";

export const GUARDIAN_RELATIONSHIPS = ["parent", "legal_guardian", "other_authorized_guardian"] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export interface Patient {
  id: string;
  mobileNumber: string;
  username: string | null;
  passwordHash: string | null;
  isMinor: boolean;
  isGuardianRegistered: boolean;
  minorName: string | null;
  guardianRelationship: GuardianRelationship | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GuardianRegistrationInput {
  isMinor?: boolean;
  minorName?: string;
  guardianRelationship?: string;
  authorityAttested?: boolean;
}

export interface GuardianRegistrationData {
  isMinor: boolean;
  isGuardianRegistered: boolean;
  minorName: string | null;
  guardianRelationship: GuardianRelationship | null;
}

export interface PatientMinorContext extends GuardianRegistrationData {
  patientId: string;
}

export class InvalidRequestError extends DomainError {
  readonly code = "VALIDATION_ERROR";
}

export class PatientSessionAuthorizationError extends DomainError {
  readonly code = "SESSION_UNAUTHORIZED";

  constructor() {
    super("A valid Patient session is required.");
  }
}

export class PatientProfileNotFoundError extends DomainError {
  readonly code = "PATIENT_PROFILE_NOT_FOUND";

  constructor() {
    super("The Patient profile was not found.");
  }
}

export class InvalidGuardianDeclarationError extends DomainError {
  readonly code = "GUARDIAN_DECLARATION_INVALID";
  constructor() {
    super("Minor registration requires a name, guardian relationship, and authority attestation.");
  }
}

export class PasswordPolicyError extends DomainError {
  readonly code = "PASSWORD_POLICY_ERROR";
  constructor() {
    super("Password must be 8-1024 characters and include uppercase, lowercase, and a number.");
  }
}

export class PasswordSetupAuthorizationError extends DomainError {
  readonly code = "PASSWORD_SETUP_UNAUTHORIZED";
  constructor() {
    super("Password setup authorization is invalid, expired, or already used.");
  }
}

export class UsernameAlreadyTakenError extends DomainError {
  readonly code = "USERNAME_ALREADY_TAKEN";
  constructor() {
    super("That username is already taken.");
  }
}

export class InvalidCredentialsError extends DomainError {
  readonly code = "INVALID_CREDENTIALS";
  constructor() {
    super("Invalid username or password.");
  }
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
