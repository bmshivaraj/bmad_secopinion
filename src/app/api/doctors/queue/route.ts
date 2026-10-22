import { NextResponse } from "next/server";
import { casesService } from "../../../../modules/cases/service";
import { requireDoctorContext, toCasesErrorResponse } from "../../../../modules/cases/routes";
import { ok } from "../../../../shared/api-envelope";

export async function GET(request: Request): Promise<NextResponse> {
	try {
		const caller = requireDoctorContext(request);
		return NextResponse.json(ok(await casesService.listDoctorQueue(caller)), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}