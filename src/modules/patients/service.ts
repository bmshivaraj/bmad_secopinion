// Patients module's public service interface (AD-2 seam). Patients is a leaf
// module -- it never calls Cases, Payments, or Admin. Other modules may only
// read Patients data through functions exported from this file, never by
// importing repository.ts or domain/ directly. Implemented starting Story 1.2.
import argon2 from "argon2";
import { signAuthToken, verifyPatientPasswordSetupToken, type AuthContext } from "../../shared/auth-context";
import { otpProvider } from "../../shared/otp-provider";
import type { OtpProvider } from "../../shared/otp-provider";
import {
  InvalidCredentialsError,
  InvalidGuardianDeclarationError,
  InvalidRequestError,
  PatientProfileNotFoundError,
  PatientSessionAuthorizationError,
  GUARDIAN_RELATIONSHIPS,
  isOtpRequestRateLimited,
  MobileAlreadyRegisteredError,
  OtpExpiredError,
  OtpRateLimitExceededError,
  OtpVerificationFailedError,
  PasswordPolicyError,
  PasswordSetupAuthorizationError,
  recordOtpRequest,
  type GuardianRegistrationData,
  type GuardianRegistrationInput,
  type GuardianRelationship,
  type PatientMinorContext as PatientMinorContextType,
  UsernameAlreadyTakenError,
  type Patient,
} from "./domain";
import { patientsRepository } from "./repository";

export type { PatientMinorContext } from "./domain";

const MAX_PASSWORD_LENGTH = 1024;
const MAX_MINOR_NAME_LENGTH = 120;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 20;
const DUMMY_PASSWORD_HASH = argon2.hash("secopinion-invalid-account-dummy", { type: argon2.argon2id });

type PatientsRepository = Pick<
  typeof patientsRepository,
  "findByMobileNumber" | "create" | "findById" | "findByUsername" | "setCredentials"
>;

interface OtpChallenge {
  mobileNumber: string;
  expiresAt: number;
}

function normalizeMobileNumber(mobileNumber: string): string {
  return mobileNumber.startsWith("+") ? mobileNumber.slice(1) : mobileNumber;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
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

function validateGuardianRegistration(input: GuardianRegistrationInput = {}): GuardianRegistrationData {
  if (input.isMinor !== true) {
    if (
      input.minorName !== undefined
      || input.guardianRelationship !== undefined
      || input.authorityAttested !== undefined
    ) {
      throw new InvalidGuardianDeclarationError();
    }
    return {
      isMinor: false,
      isGuardianRegistered: false,
      minorName: null,
      guardianRelationship: null,
    };
  }

  const minorName = input.minorName?.trim();
  const relationship = input.guardianRelationship;
  if (
    !minorName
    || minorName.length > MAX_MINOR_NAME_LENGTH
    || /[\u0000-\u001f\u007f]/.test(minorName)
    || !GUARDIAN_RELATIONSHIPS.includes(relationship as GuardianRelationship)
    || input.authorityAttested !== true
  ) {
    throw new InvalidGuardianDeclarationError();
  }

  return {
    isMinor: true,
    isGuardianRegistered: true,
    minorName,
    guardianRelationship: relationship as GuardianRelationship,
  };
}

export function createPatientsService(
  repository: PatientsRepository = patientsRepository,
  provider: OtpProvider = otpProvider,
) {
  const otpChallenges = new Map<string, OtpChallenge>();
  const loginFailures = new Map<string, number[]>();
  let loginFailuresSinceCleanup = 0;

  function recentLoginFailures(username: string): number[] {
    const now = Date.now();
    const recent = (loginFailures.get(username) ?? []).filter(
      (timestamp) => now - timestamp < LOGIN_FAILURE_WINDOW_MS,
    );
    loginFailures.set(username, recent);
    return recent;
  }

  function recordLoginFailure(username: string): void {
    const recent = recentLoginFailures(username);
    recent.push(Date.now());
    loginFailures.set(username, recent);

    loginFailuresSinceCleanup += 1;
    if (loginFailuresSinceCleanup >= 100) {
      const now = Date.now();
      for (const [loggedUsername, timestamps] of loginFailures) {
        const activeTimestamps = timestamps.filter((timestamp) => now - timestamp < LOGIN_FAILURE_WINDOW_MS);
        if (activeTimestamps.length === 0) {
          loginFailures.delete(loggedUsername);
        } else if (activeTimestamps.length !== timestamps.length) {
          loginFailures.set(loggedUsername, activeTimestamps);
        }
      }
      loginFailuresSinceCleanup = 0;
    }
  }

  return {
    async getOwnProfile(caller: AuthContext) {
      if (caller.role !== "patient") throw new PatientSessionAuthorizationError();
      const patient = await repository.findById(caller.userId);
      if (!patient) throw new PatientProfileNotFoundError();
      return {
        displayName: patient.username ?? "Patient",
        username: patient.username,
        mobileNumber: patient.mobileNumber,
      };
    },

    async startRegistration(mobileNumber: string): Promise<{ otpId: string; expiresAt: Date }> {
      const normalizedMobileNumber = normalizeMobileNumber(mobileNumber);
      const existing = await repository.findByMobileNumber(normalizedMobileNumber);
      if (existing) {
        throw new MobileAlreadyRegisteredError(normalizedMobileNumber);
      }

      if (isOtpRequestRateLimited(normalizedMobileNumber)) {
        throw new OtpRateLimitExceededError(normalizedMobileNumber);
      }

      recordOtpRequest(normalizedMobileNumber);
      const issuedOtp = await provider.sendOtp(normalizedMobileNumber);
      otpChallenges.set(issuedOtp.otpId, {
        mobileNumber: normalizedMobileNumber,
        expiresAt: issuedOtp.expiresAt.getTime(),
      });
      return issuedOtp;
    },

    async verifyRegistration(mobileNumber: string, otpId: string, code: string): Promise<Patient> {
      const normalizedMobileNumber = normalizeMobileNumber(mobileNumber);
      const challenge = otpChallenges.get(otpId);
      if (challenge && challenge.mobileNumber !== normalizedMobileNumber) {
        throw new OtpVerificationFailedError();
      }
      if (challenge && challenge.expiresAt <= Date.now()) {
        otpChallenges.delete(otpId);
        throw new OtpExpiredError();
      }

      const verified = await provider.verifyOtp(otpId, code);
      if (!verified) {
        throw new OtpVerificationFailedError();
      }

      otpChallenges.delete(otpId);
      const existing = await repository.findByMobileNumber(normalizedMobileNumber);
      if (existing) {
        throw new MobileAlreadyRegisteredError(normalizedMobileNumber);
      }

      try {
        return await repository.create(normalizedMobileNumber);
      } catch (error) {
        // Defense in depth: DB-level unique constraint catches a concurrent registration.
        if (isUniqueConstraintViolation(error)) {
          throw new MobileAlreadyRegisteredError(normalizedMobileNumber);
        }
        throw error;
      }
    },

    async setPassword(
      setupToken: string,
      username: string,
      password: string,
      guardianInput: GuardianRegistrationInput = {},
    ): Promise<{ patientId: string; username: string }> {
      let patientId: string;
      try {
        patientId = verifyPatientPasswordSetupToken(setupToken).patientId;
      } catch {
        throw new PasswordSetupAuthorizationError();
      }

      if (!isValidUsername(username)) {
        throw new InvalidRequestError("username must be 3-30 ASCII letters, numbers, or underscores");
      }
      if (!isValidPassword(password)) {
        throw new PasswordPolicyError();
      }
      const guardianRegistration = validateGuardianRegistration(guardianInput);

      const patient = await repository.findById(patientId);
      if (!patient || patient.passwordHash !== null) {
        throw new PasswordSetupAuthorizationError();
      }

      const normalizedUsername = username.toLowerCase();
      const existing = await repository.findByUsername(normalizedUsername);
      if (existing && existing.id !== patientId) {
        throw new UsernameAlreadyTakenError();
      }

      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      try {
        const updated = await repository.setCredentials(
          patientId,
          normalizedUsername,
          passwordHash,
          guardianRegistration,
        );
        if (!updated) {
          throw new PasswordSetupAuthorizationError();
        }
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          throw new UsernameAlreadyTakenError();
        }
        throw error;
      }

      return { patientId, username: normalizedUsername };
    },

    async getPatientMinorContext(patientId: string): Promise<PatientMinorContextType | null> {
      const patient = await repository.findById(patientId);
      if (!patient) return null;
      return {
        patientId: patient.id,
        isMinor: patient.isMinor,
        isGuardianRegistered: patient.isGuardianRegistered,
        minorName: patient.minorName,
        guardianRelationship: patient.guardianRelationship,
      };
    },

    async login(username: string, password: string): Promise<{ patientId: string; token: string }> {
      if (!isValidUsername(username) || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
        throw new InvalidCredentialsError();
      }
      const normalizedUsername = username.toLowerCase();
      const failures = recentLoginFailures(normalizedUsername);
      if (failures.length >= MAX_LOGIN_FAILURES) {
        throw new InvalidCredentialsError();
      }

      const patient = await repository.findByUsername(normalizedUsername);
      const passwordHash = patient?.passwordHash ?? await DUMMY_PASSWORD_HASH;
      let passwordMatches = false;
      try {
        passwordMatches = await argon2.verify(passwordHash, password);
      } catch {
        passwordMatches = false;
      }
      if (!patient?.passwordHash || !passwordMatches) {
        recordLoginFailure(normalizedUsername);
        throw new InvalidCredentialsError();
      }

      loginFailures.delete(normalizedUsername);
      return {
        patientId: patient.id,
        token: signAuthToken({ userId: patient.id, role: "patient" }),
      };
    },
  };
}

export const patientsService = createPatientsService();
