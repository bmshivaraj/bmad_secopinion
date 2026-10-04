import { NextResponse } from "next/server";
import { ok } from "../../../../shared/api-envelope";
import { PATIENT_SESSION_COOKIE } from "../../../../modules/patients/routes";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json(ok({ loggedOut: true }));
  response.cookies.set(PATIENT_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}