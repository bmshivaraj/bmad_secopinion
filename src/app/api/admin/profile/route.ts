import { NextResponse } from "next/server";
import { adminService } from "../../../../modules/admin/service";
import { requireAdminContext, toAdminErrorResponse } from "../../../../modules/admin/routes";
import { ok } from "../../../../shared/api-envelope";

export async function GET(request: Request): Promise<NextResponse> {
	try {
		return NextResponse.json(ok(await adminService.getOwnProfile(requireAdminContext(request))), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toAdminErrorResponse(error);
	}
}