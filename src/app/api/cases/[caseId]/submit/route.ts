import { NextResponse } from "next/server";
import { casesService } from "../../../../../modules/cases/service";
import { parseCaseSubmissionRequest, requirePatientContext, toCasesErrorResponse } from "../../../../../modules/cases/routes";
import { ok } from "../../../../../shared/api-envelope";

interface RouteContext {
	params: Promise<{ caseId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
	try {
		const caller = requirePatientContext(request);
		const { caseId } = await context.params;
		const { urgencyTier, selectedDoctorId } = await parseCaseSubmissionRequest(request);
		return NextResponse.json(ok(await casesService.submitCase(caller, caseId, urgencyTier, selectedDoctorId)), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}