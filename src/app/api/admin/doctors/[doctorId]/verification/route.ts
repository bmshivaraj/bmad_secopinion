import { NextResponse } from "next/server";
import { adminService } from "../../../../../../modules/admin/service";
import { parseAdminDecisionRequest, requireAdminContext, toAdminErrorResponse } from "../../../../../../modules/admin/routes";
import { ok } from "../../../../../../shared/api-envelope";

interface RouteContext {
  params: Promise<{ doctorId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const caller = requireAdminContext(request);
    const { doctorId } = await context.params;
    const { verificationStatus } = await parseAdminDecisionRequest(request);
    const application = await adminService.decideApplication(caller, doctorId, verificationStatus);
    return NextResponse.json(ok(application), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return toAdminErrorResponse(error);
  }
}