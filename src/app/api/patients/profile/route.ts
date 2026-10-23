import { NextResponse } from "next/server";
import { patientsService } from "../../../../modules/patients/service";
import { requirePatientContext, toErrorResponse } from "../../../../modules/patients/routes";
import { ok } from "../../../../shared/api-envelope";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    return NextResponse.json(ok(await patientsService.getOwnProfile(requirePatientContext(request))), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}