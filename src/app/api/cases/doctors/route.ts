import { NextResponse } from "next/server";
import { casesService } from "../../../../modules/cases/service";
import { requirePatientContext, toCasesErrorResponse } from "../../../../modules/cases/routes";
import { ok } from "../../../../shared/api-envelope";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

export async function GET(request: Request): Promise<NextResponse> {
	try {
		const doctors = await casesService.listVerifiedDoctors(requirePatientContext(request));
		return NextResponse.json(ok(doctors), { headers: PRIVATE_HEADERS });
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}