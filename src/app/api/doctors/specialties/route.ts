import { NextResponse } from "next/server";
import { doctorsService } from "../../../../modules/doctors/service";
import { toErrorResponse } from "../../../../modules/doctors/routes";
import { ok } from "../../../../shared/api-envelope";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(ok(await doctorsService.listActiveSpecialties()));
  } catch (error) {
    return toErrorResponse(error);
  }
}