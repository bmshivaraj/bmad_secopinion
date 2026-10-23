import { NextResponse } from "next/server";
import {
	DOCTOR_SESSION_COOKIE,
	readRequestCookie,
	toErrorResponse,
} from "../../../../../modules/doctors/routes";
import { DoctorProfileAccessDeniedError, SessionAuthorizationError } from "../../../../../modules/doctors/domain";
import { doctorsService } from "../../../../../modules/doctors/service";
import { ok } from "../../../../../shared/api-envelope";
import { verifyAuthToken, type AuthContext } from "../../../../../shared/auth-context";

function getSession(request: Request): AuthContext {
	const token = readRequestCookie(request, DOCTOR_SESSION_COOKIE);
	if (!token) throw new SessionAuthorizationError();
	let caller: AuthContext;
	try {
		caller = verifyAuthToken(token);
	} catch {
		throw new SessionAuthorizationError();
	}
	if (caller.role !== "doctor") throw new DoctorProfileAccessDeniedError();
	return caller;
}

export async function GET(request: Request): Promise<NextResponse> {
	try {
		return NextResponse.json(ok(await doctorsService.getOwnIdentityProfile(getSession(request))), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}