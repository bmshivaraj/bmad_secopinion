// Patients module's public service interface (AD-2 seam). Patients is a leaf
// module -- it never calls Cases, Payments, or Admin. Other modules may only
// read Patients data through functions exported from this file, never by
// importing repository.ts or domain/ directly. Implemented starting Story 1.2.
import { otpProvider } from "../../shared/otp-provider";
import type { OtpProvider } from "../../shared/otp-provider";
import {
  isOtpRequestRateLimited,
  MobileAlreadyRegisteredError,
  OtpExpiredError,
  OtpRateLimitExceededError,
  OtpVerificationFailedError,
  recordOtpRequest,
  type Patient,
} from "./domain";
import { patientsRepository } from "./repository";

type PatientsRepository = Pick<typeof patientsRepository, "findByMobileNumber" | "create">;

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

export function createPatientsService(
  repository: PatientsRepository = patientsRepository,
  provider: OtpProvider = otpProvider,
) {
  const otpChallenges = new Map<string, OtpChallenge>();

  return {
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
  };
}

export const patientsService = createPatientsService();
