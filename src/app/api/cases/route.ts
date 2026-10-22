import { NextResponse } from "next/server";
import { casesService } from "../../../modules/cases/service";
import { requirePatientContext, toCasesErrorResponse } from "../../../modules/cases/routes";
import { ok } from "../../../shared/api-envelope";

export async function GET(request: Request): Promise<NextResponse> {
	try {
		const caller = requirePatientContext(request);
		return NextResponse.json(ok(await casesService.listPatientCases(caller)), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}
