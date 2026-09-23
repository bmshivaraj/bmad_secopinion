import { randomUUID } from "node:crypto";

/**
 * Abstraction over OTP delivery (AD-7). Business logic must depend on this
 * interface, never on MockOtpProvider directly, so a real SMS gateway can be
 * swapped in later (v2) without touching calling code.
 */
export interface OtpProvider {
  sendOtp(mobileNumber: string): Promise<{ otpId: string; expiresAt: Date }>;
  verifyOtp(otpId: string, code: string): Promise<boolean>;
}

interface IssuedOtp {
  mobileNumber: string;
  code: string;
  expiresAt: Date;
}

const OTP_TTL_MS = 10 * 60 * 1000; // OTP expires 10 minutes after issuance.
const FIXED_OTP_CODE = "123456";

/**
 * v1 mock implementation: no real SMS is sent. The fixed code is logged so a
 * developer/tester can complete the OTP flow locally.
 */
export class MockOtpProvider implements OtpProvider {
  private readonly issuedOtps = new Map<string, IssuedOtp>();

  async sendOtp(mobileNumber: string): Promise<{ otpId: string; expiresAt: Date }> {
    const otpId = randomUUID();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    this.issuedOtps.set(otpId, { mobileNumber, code: FIXED_OTP_CODE, expiresAt });

    console.log(`[MockOtpProvider] OTP for ${mobileNumber}: ${FIXED_OTP_CODE} (otpId=${otpId})`);

    return { otpId, expiresAt };
  }

  async verifyOtp(otpId: string, code: string): Promise<boolean> {
    const issued = this.issuedOtps.get(otpId);
    if (!issued) {
      return false;
    }

    if (issued.expiresAt.getTime() < Date.now()) {
      this.issuedOtps.delete(otpId);
      return false;
    }

    const matches = issued.code === code;
    if (matches) {
      this.issuedOtps.delete(otpId);
    }
    return matches;
  }
}
