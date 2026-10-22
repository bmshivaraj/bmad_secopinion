// Doctors is a leaf module and never calls Cases, Payments, or Admin.
// Other modules must read Doctor data only through this exported service,
// not by importing the repository or domain internals.
import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import {
	signAuthToken,
	signDoctorRegistrationToken,
	verifyDoctorRegistrationToken,
	type AuthContext,
} from "../../shared/auth-context";
import { otpProvider } from "../../shared/otp-provider";
import type { OtpProvider } from "../../shared/otp-provider";
import { storageProvider } from "../../shared/storage-provider";
import type { StorageProvider } from "../../shared/storage-provider";
import {
	CredentialAccessDeniedError,
	CredentialNotFoundError,
	DoctorNotFoundError,
	DoctorPayoutAccessDeniedError,
	DoctorPayoutProfileNotFoundError,
	DoctorVerificationAccessDeniedError,
	DoctorVerificationConflictError,
	InvalidCredentialsError,
	InvalidRequestError,
	InvalidUpiIdError,
	isValidUpiId,
	isOtpRequestRateLimited,
	MobileAlreadyRegisteredError,
	OtpExpiredError,
	OtpVerificationFailedError,
	PasswordPolicyError,
	recordOtpRequest,
	RegistrationAuthorizationError,
	RegistrationStartUnavailableError,
	SpecialtyNameAlreadyExistsError,
	UsernameAlreadyTakenError,
	type CredentialUpload,
	type DoctorAccount,
	type DoctorApplication,
	type DoctorCredentialRecord,
	type DoctorDirectoryEntry,
	type DoctorSummary,
	type SpecialtySummary,
} from "./domain";
import { doctorsRepository } from "./repository";

const MAX_PASSWORD_LENGTH = 1024;
const MAX_CREDENTIAL_COUNT = 5;
const MAX_CREDENTIAL_SIZE = 10 * 1024 * 1024;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 20;
const MAX_OTP_VERIFICATION_ATTEMPTS = 5;
const DUMMY_PASSWORD_HASH = argon2.hash("secopinion-invalid-doctor-dummy", { type: argon2.argon2id });
const ACCEPTED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

interface OtpChallenge {
	mobileNumber: string;
	expiresAt: number;
	failedAttempts: number;
}

type DoctorsRepository = Pick<
	typeof doctorsRepository,
	| "findByMobileNumber"
	| "findByUsername"
	| "findById"
	| "findVerifiedDoctorSpecialtyIds"
	| "listVerifiedDoctors"
	| "findPayoutProfile"
	| "updateUpiId"
	| "findActiveSpecialties"
	| "listActiveSpecialties"
	| "createSpecialty"
	| "createApplication"
	| "findCredentialById"
	| "listPendingApplications"
	| "updatePendingVerificationStatus"
>;

function normalizeMobileNumber(mobileNumber: string): string {
	return mobileNumber.startsWith("+") ? mobileNumber.slice(1) : mobileNumber;
}

function isValidUsername(username: string): boolean {
	return /^[A-Za-z0-9_]{3,30}$/.test(username);
}

function isValidPassword(password: string): boolean {
	return password.length >= 8
		&& password.length <= MAX_PASSWORD_LENGTH
		&& /[A-Z]/.test(password)
		&& /[a-z]/.test(password)
		&& /[0-9]/.test(password);
}

function isUniqueConstraintViolation(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function hasExpectedFileSignature(upload: CredentialUpload): boolean {
	const bytes = upload.bytes;
	if (upload.contentType === "image/jpeg") {
		return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	}
	if (upload.contentType === "image/png") {
		return bytes.length >= 8
			&& bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
			&& bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
	}
	if (upload.contentType === "application/pdf") {
		return bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
	}
	return false;
}

function normalizeFileName(fileName: string): string {
	const baseName = fileName.replace(/\\/g, "/").split("/").pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
	if (!baseName || baseName.length > 255) {
		throw new InvalidRequestError("Each credential must have a valid file name no longer than 255 characters.");
	}
	return baseName;
}

function validateUploads(uploads: CredentialUpload[]): CredentialUpload[] {
	if (uploads.length < 1 || uploads.length > MAX_CREDENTIAL_COUNT) {
		throw new InvalidRequestError("Upload between 1 and 5 credential files.");
	}
	return uploads.map((upload) => {
		if (!ACCEPTED_CONTENT_TYPES.has(upload.contentType)) {
			throw new InvalidRequestError("Credentials must be JPEG, PNG, or PDF files.");
		}
		if (upload.bytes.byteLength === 0 || upload.bytes.byteLength > MAX_CREDENTIAL_SIZE) {
			throw new InvalidRequestError("Each credential must be non-empty and no larger than 10 MiB.");
		}
		if (!hasExpectedFileSignature(upload)) {
			throw new InvalidRequestError("Credential contents do not match the declared file type.");
		}
		return { ...upload, fileName: normalizeFileName(upload.fileName) };
	});
}

function publicApplication(application: DoctorApplication) {
	return {
		doctorId: application.id,
		fullName: application.fullName,
		username: application.username,
		verificationStatus: application.verificationStatus,
		specialties: application.specialties,
		credentials: application.credentials.map(({ id, fileName, contentType, sizeBytes, createdAt }) => ({
			id,
			fileName,
			contentType,
			sizeBytes,
			createdAt,
		})),
	};
}

export function createDoctorsService(
	repository: DoctorsRepository = doctorsRepository,
	provider: OtpProvider = otpProvider,
	storage: StorageProvider = storageProvider,
) {
	const otpChallenges = new Map<string, OtpChallenge>();
	const loginFailures = new Map<string, number[]>();
	let challengesSinceCleanup = 0;
	let loginFailuresSinceCleanup = 0;

	function recentLoginFailures(username: string): number[] {
		const recent = (loginFailures.get(username) ?? []).filter(
			(timestamp) => Date.now() - timestamp < LOGIN_FAILURE_WINDOW_MS,
		);
		loginFailures.set(username, recent);
		return recent;
	}

	function recordLoginFailure(username: string): void {
		const recent = [...recentLoginFailures(username), Date.now()];
		loginFailures.set(username, recent);
		loginFailuresSinceCleanup += 1;
		if (loginFailuresSinceCleanup >= 100) {
			const now = Date.now();
			for (const [loggedUsername, timestamps] of loginFailures) {
				const activeTimestamps = timestamps.filter((timestamp) => now - timestamp < LOGIN_FAILURE_WINDOW_MS);
				if (activeTimestamps.length === 0) loginFailures.delete(loggedUsername);
				else if (activeTimestamps.length !== timestamps.length) loginFailures.set(loggedUsername, activeTimestamps);
			}
			loginFailuresSinceCleanup = 0;
		}
	}

	return {
		async startRegistration(mobileNumber: string): Promise<{ otpId: string; expiresAt: Date }> {
			const normalizedMobileNumber = normalizeMobileNumber(mobileNumber);
			if (await repository.findByMobileNumber(normalizedMobileNumber)) {
				throw new RegistrationStartUnavailableError();
			}
			if (isOtpRequestRateLimited(normalizedMobileNumber)) throw new RegistrationStartUnavailableError();
			recordOtpRequest(normalizedMobileNumber);
			const challenge = await provider.sendOtp(normalizedMobileNumber);
			challengesSinceCleanup += 1;
			if (challengesSinceCleanup >= 100) {
				const now = Date.now();
				for (const [issuedOtpId, issuedChallenge] of otpChallenges) {
					if (issuedChallenge.expiresAt <= now) otpChallenges.delete(issuedOtpId);
				}
				challengesSinceCleanup = 0;
			}
			otpChallenges.set(challenge.otpId, {
				mobileNumber: normalizedMobileNumber,
				expiresAt: challenge.expiresAt.getTime(),
				failedAttempts: 0,
			});
			return challenge;
		},

		async verifyRegistration(
			mobileNumber: string,
			otpId: string,
			code: string,
		): Promise<{ registrationToken: string; expiresInSeconds: number }> {
			const normalizedMobileNumber = normalizeMobileNumber(mobileNumber);
			const challenge = otpChallenges.get(otpId);
			if (!challenge || challenge.mobileNumber !== normalizedMobileNumber) throw new OtpVerificationFailedError();
			if (challenge.expiresAt <= Date.now()) {
				otpChallenges.delete(otpId);
				throw new OtpExpiredError();
			}
			if (challenge.failedAttempts >= MAX_OTP_VERIFICATION_ATTEMPTS) {
				otpChallenges.delete(otpId);
				throw new OtpVerificationFailedError();
			}
			if (!await provider.verifyOtp(otpId, code)) {
				challenge.failedAttempts += 1;
				if (challenge.failedAttempts >= MAX_OTP_VERIFICATION_ATTEMPTS) otpChallenges.delete(otpId);
				throw new OtpVerificationFailedError();
			}
			otpChallenges.delete(otpId);
			if (await repository.findByMobileNumber(normalizedMobileNumber)) throw new MobileAlreadyRegisteredError();
			return {
				registrationToken: signDoctorRegistrationToken(normalizedMobileNumber),
				expiresInSeconds: 15 * 60,
			};
		},

		async listActiveSpecialties(): Promise<SpecialtySummary[]> {
			return repository.listActiveSpecialties();
		},

		async listVerifiedDoctors(): Promise<DoctorDirectoryEntry[]> {
			return repository.listVerifiedDoctors();
		},

		async createSpecialty(name: string): Promise<SpecialtySummary> {
			if (typeof name !== "string") throw new InvalidRequestError("name must be a string.");
			const trimmedName = name.trim();
			if (!trimmedName || trimmedName.length > 120) {
				throw new InvalidRequestError("name must be 1-120 characters.");
			}
			try {
				return await repository.createSpecialty({
					name: trimmedName,
					normalizedName: trimmedName.toLowerCase(),
				});
			} catch (error) {
				if (isUniqueConstraintViolation(error)) throw new SpecialtyNameAlreadyExistsError();
				throw error;
			}
		},

		assertRegistrationAuthorization(registrationToken: string): void {
			try {
				verifyDoctorRegistrationToken(registrationToken);
			} catch {
				throw new RegistrationAuthorizationError();
			}
		},

		async submitApplication(
			registrationToken: string,
			input: {
				fullName: string;
				username: string;
				password: string;
				upiId?: string | null;
				specialtyIds: string[];
				credentials: CredentialUpload[];
			},
		) {
			this.assertRegistrationAuthorization(registrationToken);
			const mobileNumber = verifyDoctorRegistrationToken(registrationToken).mobileNumber;

			const fullName = input.fullName.trim();
			if (!fullName || fullName.length > 120 || /[\u0000-\u001f\u007f]/.test(fullName)) {
				throw new InvalidRequestError("fullName must be 1-120 characters without control characters.");
			}
			if (!isValidUsername(input.username)) {
				throw new InvalidRequestError("username must be 3-30 ASCII letters, numbers, or underscores.");
			}
			if (!isValidPassword(input.password)) throw new PasswordPolicyError();
			const upiId = input.upiId === undefined || input.upiId === "" ? null : input.upiId;
			if (upiId !== null && !isValidUpiId(upiId)) throw new InvalidUpiIdError();
			if (input.specialtyIds.length === 0 || input.specialtyIds.some((id) => !id.trim())) {
				throw new InvalidRequestError("Select at least one active specialty.");
			}
			if (new Set(input.specialtyIds).size !== input.specialtyIds.length) {
				throw new InvalidRequestError("A specialty may only be selected once.");
			}
			const credentials = validateUploads(input.credentials);

			if (await repository.findByMobileNumber(mobileNumber)) throw new MobileAlreadyRegisteredError();
			const username = input.username.toLowerCase();
			if (await repository.findByUsername(username)) throw new UsernameAlreadyTakenError();
			const specialties = await repository.findActiveSpecialties(input.specialtyIds);
			if (specialties.length !== input.specialtyIds.length) {
				throw new InvalidRequestError("One or more selected specialties are unavailable.");
			}

			const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
			const savedFiles: { storageKey: string; upload: CredentialUpload }[] = [];
			try {
				for (const upload of credentials) {
					const saved = await storage.save(upload.bytes);
					savedFiles.push({ storageKey: saved.storageKey, upload });
				}
				const application = await repository.createApplication({
					mobileNumber,
					fullName,
					username,
					passwordHash,
					upiId,
					specialtyIds: specialties.map(({ id }) => id),
					credentials: savedFiles.map(({ storageKey, upload }) => ({
						fileName: upload.fileName,
						contentType: upload.contentType,
						sizeBytes: upload.bytes.byteLength,
						storageKey,
					})),
				});
				return publicApplication(application);
			} catch (error) {
				await Promise.all(savedFiles.map(({ storageKey }) => storage.delete(storageKey).catch(() => undefined)));
				if (isUniqueConstraintViolation(error)) {
					const existingDoctor = await repository.findByMobileNumber(mobileNumber);
					if (existingDoctor) throw new MobileAlreadyRegisteredError();
					throw new UsernameAlreadyTakenError();
				}
				throw error;
			}
		},

		async login(username: string, password: string): Promise<{
			doctorId: string;
			verificationStatus: DoctorAccount["verificationStatus"];
			token: string;
		}> {
			if (!isValidUsername(username) || !password || password.length > MAX_PASSWORD_LENGTH) {
				throw new InvalidCredentialsError();
			}
			const normalizedUsername = username.toLowerCase();
			if (recentLoginFailures(normalizedUsername).length >= MAX_LOGIN_FAILURES) {
				throw new InvalidCredentialsError();
			}
			const doctor = await repository.findByUsername(normalizedUsername);
			const passwordHash = doctor?.passwordHash ?? await DUMMY_PASSWORD_HASH;
			let passwordMatches = false;
			try {
				passwordMatches = await argon2.verify(passwordHash, password);
			} catch {
				passwordMatches = false;
			}
			if (!doctor || !passwordMatches) {
				recordLoginFailure(normalizedUsername);
				throw new InvalidCredentialsError();
			}
			loginFailures.delete(normalizedUsername);
			return {
				doctorId: doctor.id,
				verificationStatus: doctor.verificationStatus,
				token: signAuthToken({ userId: doctor.id, role: "doctor" }),
			};
		},

		async getCredential(credentialId: string, caller: AuthContext): Promise<{
			bytes: ArrayBuffer;
			fileName: string;
			contentType: string;
		}> {
			const credential = await repository.findCredentialById(credentialId);
			if (!credential) throw new CredentialNotFoundError();
			if (caller.role !== "admin" && !(caller.role === "doctor" && caller.userId === credential.doctorId)) {
				throw new CredentialAccessDeniedError();
			}
			const bytes = await storage.read(credential.storageKey);
			if (!bytes) throw new CredentialNotFoundError();
			const responseBytes = new Uint8Array(bytes.byteLength);
			responseBytes.set(bytes);
			return {
				bytes: responseBytes.buffer as ArrayBuffer,
				fileName: credential.fileName,
				contentType: credential.contentType,
			};
		},

		async listPendingApplications(caller: AuthContext) {
			if (caller.role !== "admin") throw new DoctorVerificationAccessDeniedError();
			const applications = await repository.listPendingApplications();
			return applications.map(publicApplication);
		},

		async setVerificationStatus(
			caller: AuthContext,
			doctorId: string,
			verificationStatus: Exclude<DoctorAccount["verificationStatus"], "Pending">,
		) {
			if (caller.role !== "admin") throw new DoctorVerificationAccessDeniedError();
			const application = await repository.updatePendingVerificationStatus(doctorId, verificationStatus);
			if (application) return publicApplication(application);
			if (!await repository.findById(doctorId)) throw new DoctorNotFoundError();
			throw new DoctorVerificationConflictError();
		},

		async getOwnPayoutProfile(caller: AuthContext): Promise<{ upiId: string | null }> {
			if (caller.role !== "doctor") throw new DoctorPayoutAccessDeniedError();
			const profile = await repository.findPayoutProfile(caller.userId);
			if (!profile) throw new DoctorPayoutProfileNotFoundError();
			return profile;
		},

		async updateOwnPayoutProfile(caller: AuthContext, upiId: string): Promise<{ upiId: string | null }> {
			if (caller.role !== "doctor") throw new DoctorPayoutAccessDeniedError();
			if (typeof upiId !== "string" || !isValidUpiId(upiId)) throw new InvalidUpiIdError();
			const profile = await repository.updateUpiId(caller.userId, upiId);
			if (!profile) throw new DoctorPayoutProfileNotFoundError();
			return profile;
		},

		async getVerifiedDoctor(doctorId: string): Promise<DoctorSummary | null> {
			const doctor = await repository.findById(doctorId);
			if (!doctor || doctor.verificationStatus !== "Verified") return null;
			return {
				id: doctor.id,
				mobileNumber: doctor.mobileNumber,
				fullName: doctor.fullName,
				username: doctor.username,
				verificationStatus: doctor.verificationStatus,
				createdAt: doctor.createdAt,
				updatedAt: doctor.updatedAt,
			};
		},

		async getVerifiedDoctorSpecialtyIds(doctorId: string): Promise<string[] | null> {
			return repository.findVerifiedDoctorSpecialtyIds(doctorId);
		},
	};
}

export const doctorsService = createDoctorsService();
