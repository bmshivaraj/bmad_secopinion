import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../../../../modules/admin/routes";
import { ok } from "../../../../shared/api-envelope";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json(ok({ loggedOut: true }));
  response.cookies.set(ADMIN_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}