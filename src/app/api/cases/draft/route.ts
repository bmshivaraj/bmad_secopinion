import { NextResponse } from "next/server";
import { casesService } from "../../../../modules/cases/service";
import { parseCaseDraftRequest, requirePatientContext, toCasesErrorResponse } from "../../../../modules/cases/routes";
import { ok } from "../../../../shared/api-envelope";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

export async function GET(request: Request): Promise<NextResponse> {
	try {
		return NextResponse.json(ok(await casesService.getOwnDraft(requirePatientContext(request))), { headers: PRIVATE_HEADERS });
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}

export async function PUT(request: Request): Promise<NextResponse> {
	try {
		const caller = requirePatientContext(request);
		const { input, caseId, creationRequestId } = await parseCaseDraftRequest(request);
		return NextResponse.json(ok(await casesService.saveDraft(caller, input, caseId, creationRequestId)), { headers: PRIVATE_HEADERS });
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}