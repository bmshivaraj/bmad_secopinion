import { NextResponse } from "next/server";
import { casesService } from "../../../../../../modules/cases/service";
import {
	parseCaseAssignmentRequest,
	requireAdminCaseContext,
	toCasesErrorResponse,
} from "../../../../../../modules/cases/routes";
import { ok } from "../../../../../../shared/api-envelope";

type CaseAssignmentRouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, context: CaseAssignmentRouteContext): Promise<NextResponse> {
	try {
		const caller = requireAdminCaseContext(request);
		const { caseId } = await context.params;
		const { doctorId, specialtyId, expectedVersion } = await parseCaseAssignmentRequest(request);
		const result = specialtyId !== undefined
			? await casesService.correctSubmittedCaseRouting(caller, caseId, specialtyId, doctorId!, expectedVersion)
			: await casesService.assignCaseToDoctor(caller, caseId, doctorId, expectedVersion);
		return NextResponse.json(ok(result), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}