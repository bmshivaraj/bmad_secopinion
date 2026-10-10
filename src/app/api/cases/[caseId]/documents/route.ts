import { NextResponse } from "next/server";
import { casesService } from "../../../../../modules/cases/service";
import {
	parseCaseDocumentUploads,
	requirePatientContext,
	toCasesErrorResponse,
} from "../../../../../modules/cases/routes";
import { ok } from "../../../../../shared/api-envelope";

interface RouteContext {
	params: Promise<{ caseId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
	try {
		const caller = requirePatientContext(request);
		const { caseId } = await context.params;
		const uploads = await parseCaseDocumentUploads(request);
		return NextResponse.json(ok(await casesService.uploadDocuments(caller, caseId, uploads)), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}