import { NextResponse } from "next/server";
import { doctorsService } from "../../../../../modules/doctors/service";
import {
  DOCTOR_REGISTRATION_COOKIE,
  parseVerifyRegistrationRequest,
  toErrorResponse,
} from "../../../../../modules/doctors/routes";
import { ok } from "../../../../../shared/api-envelope";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const input = await parseVerifyRegistrationRequest(request);
    const result = await doctorsService.verifyRegistration(input.mobileNumber, input.otpId, input.code);
    const response = NextResponse.json(ok({ verified: true, expiresInSeconds: result.expiresInSeconds }));
    response.cookies.set(DOCTOR_REGISTRATION_COOKIE, result.registrationToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/doctors/register/submit",
      maxAge: result.expiresInSeconds,
    });
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}