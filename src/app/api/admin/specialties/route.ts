import { NextResponse } from "next/server";
import { adminService } from "../../../../modules/admin/service";
import {
	parseAdminSpecialtyRequest,
	requireAdminContext,
	toAdminErrorResponse,
} from "../../../../modules/admin/routes";
import { ok } from "../../../../shared/api-envelope";

export async function GET(request: Request): Promise<NextResponse> {
	try {
		const caller = requireAdminContext(request);
		const specialties = await adminService.listSpecialties(caller);
		return NextResponse.json(ok(specialties), { headers: { "cache-control": "private, no-store" } });
	} catch (error) {
		return toAdminErrorResponse(error);
	}
}

export async function POST(request: Request): Promise<NextResponse> {
	try {
		const caller = requireAdminContext(request);
		const { name } = await parseAdminSpecialtyRequest(request);
		const specialty = await adminService.addSpecialty(caller, name);
		return NextResponse.json(ok(specialty), {
			status: 201,
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toAdminErrorResponse(error);
	}
}