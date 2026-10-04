import { NextResponse } from "next/server";
import { ok } from "../../../../../shared/api-envelope";
import { patientsService } from "../../../../../modules/patients/service";
import { parseVerifyRegistrationRequest, toErrorResponse } from "../../../../../modules/patients/routes";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { mobileNumber, otpId, code } = await parseVerifyRegistrationRequest(request);
    const patient = await patientsService.verifyRegistration(mobileNumber, otpId, code);
    return NextResponse.json(ok({ patientId: patient.id, mobileNumber: patient.mobileNumber }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
