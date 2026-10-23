import { NextResponse } from "next/server";
import { adminService } from "../../../../modules/admin/service";
import {
	parseAdminPlatformSettingsRequest,
	requireAdminContext,
	toAdminErrorResponse,
} from "../../../../modules/admin/routes";
import { ok } from "../../../../shared/api-envelope";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

export async function GET(request: Request): Promise<NextResponse> {
	try {
		const caller = requireAdminContext(request);
		const settings = await adminService.getAdminPlatformSettings(caller);
		return NextResponse.json(ok(settings), { headers: PRIVATE_HEADERS });
	} catch (error) {
		return toAdminErrorResponse(error);
	}
}

export async function PUT(request: Request): Promise<NextResponse> {
	try {
		const caller = requireAdminContext(request);
		const settings = await adminService.updatePlatformSettings(
			caller,
			await parseAdminPlatformSettingsRequest(request),
		);
		return NextResponse.json(ok(settings), { headers: PRIVATE_HEADERS });
	} catch (error) {
		return toAdminErrorResponse(error);
	}
}