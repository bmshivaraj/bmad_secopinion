import { NextResponse } from "next/server";
import { casesService } from "../../../../../modules/cases/service";
import { parseCaseDocumentRequest, requireDoctorContext, toCasesErrorResponse } from "../../../../../modules/cases/routes";
import { ok } from "../../../../../shared/api-envelope";

type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
	try {
		const caller = requireDoctorContext(request);
		const { caseId } = await context.params;
		const note = await parseCaseDocumentRequest(request);
		await casesService.requestDocuments(caller, caseId, note);
		return NextResponse.json(ok(await casesService.getDoctorCase(caller, caseId)), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}
