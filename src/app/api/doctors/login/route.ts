import { NextResponse } from "next/server";
import { doctorsService } from "../../../../modules/doctors/service";
import { DOCTOR_SESSION_COOKIE, parseDoctorLoginRequest, toErrorResponse } from "../../../../modules/doctors/routes";
import { ok } from "../../../../shared/api-envelope";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { username, password } = await parseDoctorLoginRequest(request);
    const result = await doctorsService.login(username, password);
    const response = NextResponse.json(ok({ doctorId: result.doctorId, verificationStatus: result.verificationStatus }));
    response.cookies.set(DOCTOR_SESSION_COOKIE, result.token, {
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