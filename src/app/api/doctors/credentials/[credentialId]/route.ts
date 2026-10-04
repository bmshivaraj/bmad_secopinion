import { NextResponse } from "next/server";
import { doctorsService } from "../../../../../modules/doctors/service";
import {
  ADMIN_SESSION_COOKIE,
  DOCTOR_SESSION_COOKIE,
  readRequestCookie,
  requireSessionToken,
  toErrorResponse,
} from "../../../../../modules/doctors/routes";
import { verifyAuthToken } from "../../../../../shared/auth-context";

export async function GET(
  request: Request,
  context: { params: Promise<{ credentialId: string }> },
): Promise<NextResponse> {
  try {
    const token = readRequestCookie(request, DOCTOR_SESSION_COOKIE)
      ?? readRequestCookie(request, ADMIN_SESSION_COOKIE);
    const caller = verifyAuthToken(requireSessionToken(token));
    const { credentialId } = await context.params;
    const credential = await doctorsService.getCredential(credentialId, caller);
    return new NextResponse(credential.bytes, {
      headers: {
        "content-type": credential.contentType,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(credential.fileName)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
