import { NextResponse } from "next/server";
import { ok } from "../../../../../shared/api-envelope";
import { patientsService } from "../../../../../modules/patients/service";
import { parseStartRegistrationRequest, toErrorResponse } from "../../../../../modules/patients/routes";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { mobileNumber } = await parseStartRegistrationRequest(request);
    const result = await patientsService.startRegistration(mobileNumber);
    return NextResponse.json(ok(result));
  } catch (error) {
    return toErrorResponse(error);
  }
}
