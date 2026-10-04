import { NextResponse } from "next/server";
import { doctorsService } from "../../../../../modules/doctors/service";
import {
  DOCTOR_REGISTRATION_COOKIE,
  DOCTOR_SESSION_COOKIE,
  parseDoctorApplicationRequest,
  readRequestCookie,
  toErrorResponse,
} from "../../../../../modules/doctors/routes";
import { ok } from "../../../../../shared/api-envelope";
import { signAuthToken } from "../../../../../shared/auth-context";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const registrationToken = readRequestCookie(request, DOCTOR_REGISTRATION_COOKIE) ?? "";
    doctorsService.assertRegistrationAuthorization(registrationToken);
    const application = await doctorsService.submitApplication(registrationToken, await parseDoctorApplicationRequest(request));
    const response = NextResponse.json(ok(application), { status: 201 });
    response.cookies.set(DOCTOR_REGISTRATION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/doctors/register/submit",
      maxAge: 0,
    });
    response.cookies.set(DOCTOR_SESSION_COOKIE, signAuthToken({ userId: application.doctorId, role: "doctor" }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}