import { NextResponse } from "next/server";
import { adminService } from "../../../../modules/admin/service";
import { requireAdminContext, toAdminErrorResponse } from "../../../../modules/admin/routes";
import { ok } from "../../../../shared/api-envelope";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const caller = requireAdminContext(request);
    const applications = await adminService.listPendingApplications(caller);
    return NextResponse.json(ok(applications), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return toAdminErrorResponse(error);
  }
}