import { NextResponse } from "next/server";
import { ok } from "../../../../shared/api-envelope";
import { patientsService } from "../../../../modules/patients/service";
import { parsePatientLoginRequest, PATIENT_SESSION_COOKIE, toErrorResponse } from "../../../../modules/patients/routes";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { username, password } = await parsePatientLoginRequest(request);
    const result = await patientsService.login(username, password);
    const response = NextResponse.json(ok({ patientId: result.patientId }));
    response.cookies.set(PATIENT_SESSION_COOKIE, result.token, {
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