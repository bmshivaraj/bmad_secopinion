import { NextResponse } from "next/server";
import { casesService } from "../../../../../../modules/cases/service";
import {
	parseCaseAssignmentRequest,
	requireDoctorContext,
	toCasesErrorResponse,
} from "../../../../../../modules/cases/routes";
import { InvalidCaseInputError } from "../../../../../../modules/cases/domain";
import { ok } from "../../../../../../shared/api-envelope";

type DoctorClaimRouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: Request, context: DoctorClaimRouteContext): Promise<NextResponse> {
	try {
		const caller = requireDoctorContext(request);
		const { caseId } = await context.params;
		const { doctorId, expectedVersion } = await parseCaseAssignmentRequest(request);
		if (doctorId !== undefined) throw new InvalidCaseInputError("Doctor claims do not accept a doctorId.");
		return NextResponse.json(ok(await casesService.assignCaseToDoctor(caller, caseId, undefined, expectedVersion)), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}