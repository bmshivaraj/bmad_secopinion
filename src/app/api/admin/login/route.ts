import { NextResponse } from "next/server";
import { adminService } from "../../../../modules/admin/service";
import { ADMIN_SESSION_COOKIE, parseAdminLoginRequest, toAdminErrorResponse } from "../../../../modules/admin/routes";
import { ok } from "../../../../shared/api-envelope";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const { username, password } = await parseAdminLoginRequest(request);
    const result = await adminService.login(username, password);
    const response = NextResponse.json(ok({ adminId: result.adminId }));
    response.cookies.set(ADMIN_SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return response;
  } catch (error) {
    return toAdminErrorResponse(error);
  }
}