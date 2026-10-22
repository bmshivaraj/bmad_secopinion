import { NextResponse } from "next/server";
import { casesService } from "../../../../../modules/cases/service";
import {
	parseCaseClassificationRequest,
	requireAdminCaseContext,
	toCasesErrorResponse,
} from "../../../../../modules/cases/routes";
import { ok } from "../../../../../shared/api-envelope";

type ClassificationRouteContext = { params: Promise<{ caseId: string }> };

export async function PATCH(request: Request, context: ClassificationRouteContext): Promise<NextResponse> {
	try {
		const caller = requireAdminCaseContext(request);
		const { caseId } = await context.params;
		const { specialtyId } = await parseCaseClassificationRequest(request);
		const result = await casesService.classifySubmittedCase(caller, caseId, specialtyId);
		return NextResponse.json(ok(result), { headers: { "cache-control": "private, no-store" } });
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}