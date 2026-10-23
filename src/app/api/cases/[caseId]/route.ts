import { NextResponse } from "next/server";
import { casesService } from "../../../../modules/cases/service";
import { requirePatientContext, toCasesErrorResponse } from "../../../../modules/cases/routes";
import { ok } from "../../../../shared/api-envelope";

interface RouteContext {
	params: Promise<{ caseId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
	try {
		const caller = requirePatientContext(request);
		const { caseId } = await context.params;
		return NextResponse.json(ok(await casesService.getPatientCase(caller, caseId)), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}