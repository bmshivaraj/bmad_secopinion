import { DomainError } from "../../../shared/api-envelope";

export const DOCTOR_VERIFICATION_STATUSES = ["Pending", "Verified", "Rejected"] as const;
export type DoctorVerificationStatus = (typeof DOCTOR_VERIFICATION_STATUSES)[number];

export interface SpecialtySummary {
	id: string;
	name: string;
}

export interface DoctorDirectoryEntry {
	id: string;
	fullName: string;
	specialties: string[];
}

export interface DoctorIdentityProfile {
	fullName: string;
	username: string;
	mobileNumber: string;
	verificationStatus: DoctorVerificationStatus;
	specialties: string[];
}

export interface DoctorCredentialRecord {
	id: string;
	doctorId: string;
	fileName: string;
	contentType: string;
	sizeBytes: number;
	storageKey: string;
	createdAt: Date;
}

export interface DoctorAccount {
	id: string;
	mobileNumber: string;
	fullName: string;
	username: string;
	passwordHash: string;
	upiId: string | null;
	verificationStatus: DoctorVerificationStatus;
	createdAt: Date;
	updatedAt: Date;
}

export type DoctorSummary = Omit<DoctorAccount, "passwordHash" | "upiId">;

export interface DoctorApplication extends DoctorAccount {
	specialties: SpecialtySummary[];
	credentials: DoctorCredentialRecord[];
}

export interface CredentialUpload {
	fileName: string;
	contentType: string;
	bytes: Uint8Array;
}

export class InvalidRequestError extends DomainError {
	readonly code = "VALIDATION_ERROR";
}

export class SpecialtyNameAlreadyExistsError extends DomainError {
	readonly code = "SPECIALTY_NAME_ALREADY_EXISTS";

	constructor() {
		super("A Specialty with this name already exists.");
	}
}

export class InvalidUpiIdError extends DomainError {
	readonly code = "INVALID_UPI_ID";

	constructor() {
		super("Enter a UPI ID in local-part@handle format.");
	}
}

export class DoctorPayoutAccessDeniedError extends DomainError {
	readonly code = "DOCTOR_PAYOUT_ACCESS_DENIED";

	constructor() {
		super("A Doctor session is required to access payout details.");
	}
}

export class DoctorPayoutProfileNotFoundError extends DomainError {
	readonly code = "DOCTOR_PAYOUT_PROFILE_NOT_FOUND";

	constructor() {
		super("The Doctor payout profile was not found.");
	}
}

export class DoctorProfileAccessDeniedError extends DomainError {
	readonly code = "DOCTOR_PROFILE_ACCESS_DENIED";

	constructor() {
		super("A Doctor session is required to access account identity.");
	}
}

export class DoctorProfileNotFoundError extends DomainError {
	readonly code = "DOCTOR_PROFILE_NOT_FOUND";

	constructor() {
		super("The Doctor profile was not found.");
	}
}

export const MAX_UPI_ID_LENGTH = 255;

export function isValidUpiId(upiId: string): boolean {
	return upiId.length <= MAX_UPI_ID_LENGTH
		&& /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*@[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(upiId);
}

export class MobileAlreadyRegisteredError extends DomainError {
	readonly code = "MOBILE_ALREADY_REGISTERED";

	constructor() {
		super("A Doctor account already uses this mobile number.");
	}
}

export class RegistrationStartUnavailableError extends DomainError {
	readonly code = "DOCTOR_REGISTRATION_UNAVAILABLE";

	constructor() {
		super("Unable to start registration. Sign in if you already have a Doctor account, or try again later.");
	}
}

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

export class RegistrationAuthorizationError extends DomainError {
	readonly code = "DOCTOR_REGISTRATION_UNAUTHORIZED";

	constructor() {
		super("Doctor registration authorization is invalid or expired.");
	}
}

export class UsernameAlreadyTakenError extends DomainError {
	readonly code = "USERNAME_ALREADY_TAKEN";

	constructor() {
		super("That Doctor username is already taken.");
	}
}

export class PasswordPolicyError extends DomainError {
	readonly code = "PASSWORD_POLICY_ERROR";

	constructor() {
		super("Password must be 8-1024 characters and include uppercase, lowercase, and a number.");
	}
}

export class InvalidCredentialsError extends DomainError {
	readonly code = "INVALID_CREDENTIALS";

	constructor() {
		super("Invalid username or password.");
	}
}

export class CredentialAccessDeniedError extends DomainError {
	readonly code = "CREDENTIAL_ACCESS_DENIED";

	constructor() {
		super("You are not authorized to view this credential.");
	}
}

export class CredentialNotFoundError extends DomainError {
	readonly code = "CREDENTIAL_NOT_FOUND";

	constructor() {
		super("The requested credential was not found.");
	}
}

export class DoctorVerificationAccessDeniedError extends DomainError {
	readonly code = "DOCTOR_VERIFICATION_ACCESS_DENIED";

	constructor() {
		super("An Admin session is required to review Doctor applications.");
	}
}

export class DoctorNotFoundError extends DomainError {
	readonly code = "DOCTOR_NOT_FOUND";

	constructor() {
		super("The Doctor application was not found.");
	}
}

export class DoctorVerificationConflictError extends DomainError {
	readonly code = "DOCTOR_VERIFICATION_CONFLICT";

	constructor() {
		super("Only Pending Doctor applications can receive a verification decision.");
	}
}

export class SessionAuthorizationError extends DomainError {
	readonly code = "SESSION_UNAUTHORIZED";

	constructor() {
		super("A valid Doctor or Admin session is required.");
	}
}

const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const MAX_OTP_REQUESTS_PER_WINDOW = 3;
const otpRequestLog = new Map<string, number[]>();
let requestsSinceCleanup = 0;

export function isOtpRequestRateLimited(mobileNumber: string): boolean {
	const now = Date.now();
	const recent = (otpRequestLog.get(mobileNumber) ?? []).filter(
		(timestamp) => now - timestamp < OTP_REQUEST_WINDOW_MS,
	);
	otpRequestLog.set(mobileNumber, recent);
	return recent.length >= MAX_OTP_REQUESTS_PER_WINDOW;
}

export function recordOtpRequest(mobileNumber: string): void {
	const recent = (otpRequestLog.get(mobileNumber) ?? []).filter(
		(timestamp) => Date.now() - timestamp < OTP_REQUEST_WINDOW_MS,
	);
	recent.push(Date.now());
	otpRequestLog.set(mobileNumber, recent);

	requestsSinceCleanup += 1;
	if (requestsSinceCleanup >= 100) {
		const now = Date.now();
		for (const [loggedMobileNumber, timestamps] of otpRequestLog) {
			const activeTimestamps = timestamps.filter((timestamp) => now - timestamp < OTP_REQUEST_WINDOW_MS);
			if (activeTimestamps.length === 0) otpRequestLog.delete(loggedMobileNumber);
			else if (activeTimestamps.length !== timestamps.length) otpRequestLog.set(loggedMobileNumber, activeTimestamps);
		}
		requestsSinceCleanup = 0;
	}
}
