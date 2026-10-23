import { NextResponse } from "next/server";
import { casesService } from "../../../../../../modules/cases/service";
import { parseRefundDecisionRequest, requireAdminCaseContext, toCasesErrorResponse } from "../../../../../../modules/cases/routes";
import { ok } from "../../../../../../shared/api-envelope";

export async function POST(
	request: Request,
	context: { params: Promise<{ caseId: string }> },
): Promise<NextResponse> {
	try {
		const caller = requireAdminCaseContext(request);
		const { caseId } = await context.params;
		const decision = await parseRefundDecisionRequest(request);
		return NextResponse.json(ok(await casesService.decideRefund(caller, caseId, decision)), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}