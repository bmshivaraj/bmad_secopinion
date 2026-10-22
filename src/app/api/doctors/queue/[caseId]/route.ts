import { NextResponse } from "next/server";
import { casesService } from "../../../../../modules/cases/service";
import { requireDoctorContext, toCasesErrorResponse } from "../../../../../modules/cases/routes";
import { ok } from "../../../../../shared/api-envelope";

type DoctorCaseRouteContext = { params: Promise<{ caseId: string }> };

export async function GET(request: Request, context: DoctorCaseRouteContext): Promise<NextResponse> {
	try {
		const caller = requireDoctorContext(request);
		const { caseId } = await context.params;
		return NextResponse.json(ok(await casesService.getDoctorCase(caller, caseId)), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}