import { NextResponse } from "next/server";
import { ok } from "../../../../../shared/api-envelope";
import {
  parsePasswordSetupRequest,
  PATIENT_SETUP_COOKIE,
  readRequestCookie,
  toErrorResponse,
} from "../../../../../modules/patients/routes";
import { patientsService } from "../../../../../modules/patients/service";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const setupToken = readRequestCookie(request, PATIENT_SETUP_COOKIE);
    const { username, password } = await parsePasswordSetupRequest(request);
    const result = await patientsService.setPassword(setupToken ?? "", username, password);
    const response = NextResponse.json(ok(result));
    response.cookies.set(PATIENT_SETUP_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/patients/password/setup",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}