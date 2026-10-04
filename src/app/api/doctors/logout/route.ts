import { NextResponse } from "next/server";
import { DOCTOR_SESSION_COOKIE } from "../../../../modules/doctors/routes";
import { ok } from "../../../../shared/api-envelope";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json(ok({ loggedOut: true }));
  response.cookies.set(DOCTOR_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}