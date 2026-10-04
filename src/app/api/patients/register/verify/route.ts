import { NextResponse } from "next/server";
import { ok } from "../../../../../shared/api-envelope";
import { signPatientPasswordSetupToken } from "../../../../../shared/auth-context";
import { patientsService } from "../../../../../modules/patients/service";
import { parseVerifyRegistrationRequest, PATIENT_SETUP_COOKIE, toErrorResponse } from "../../../../../modules/patients/routes";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { mobileNumber, otpId, code } = await parseVerifyRegistrationRequest(request);
    const patient = await patientsService.verifyRegistration(mobileNumber, otpId, code);
    const response = NextResponse.json(ok({ patientId: patient.id, mobileNumber: patient.mobileNumber }));
    response.cookies.set(PATIENT_SETUP_COOKIE, signPatientPasswordSetupToken(patient.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/patients/password/setup",
      maxAge: 15 * 60,
    });
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
