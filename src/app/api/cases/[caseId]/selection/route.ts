import { NextResponse } from "next/server";
import { casesService } from "../../../../../modules/cases/service";
import {
	parseDoctorSelectionRequest,
	requirePatientContext,
	toCasesErrorResponse,
} from "../../../../../modules/cases/routes";
import { ok } from "../../../../../shared/api-envelope";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

type SelectionRouteContext = { params: Promise<{ caseId: string }> };

export async function PATCH(request: Request, context: SelectionRouteContext): Promise<NextResponse> {
	try {
		const caller = requirePatientContext(request);
		const { caseId } = await context.params;
		const selectedDoctorId = await parseDoctorSelectionRequest(request);
		const draft = await casesService.saveDraftDoctorSelection(caller, caseId, selectedDoctorId);
		return NextResponse.json(ok(draft), { headers: PRIVATE_HEADERS });
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}