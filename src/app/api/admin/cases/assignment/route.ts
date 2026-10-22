import { NextResponse } from "next/server";
import { casesService } from "../../../../../modules/cases/service";
import { requireAdminCaseContext, toCasesErrorResponse } from "../../../../../modules/cases/routes";
import { ok } from "../../../../../shared/api-envelope";

export async function GET(request: Request): Promise<NextResponse> {
	try {
		const caller = requireAdminCaseContext(request);
		return NextResponse.json(ok(await casesService.listAdminAssignmentCases(caller)), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}