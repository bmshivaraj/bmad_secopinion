import { NextResponse } from "next/server";
import { doctorsService } from "../../../../../modules/doctors/service";
import { parseStartRegistrationRequest, toErrorResponse } from "../../../../../modules/doctors/routes";
import { ok } from "../../../../../shared/api-envelope";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { mobileNumber } = await parseStartRegistrationRequest(request);
    return NextResponse.json(ok(await doctorsService.startRegistration(mobileNumber)));
  } catch (error) {
    return toErrorResponse(error);
  }
}