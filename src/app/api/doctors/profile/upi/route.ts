import { NextResponse } from "next/server";
import {
	DOCTOR_SESSION_COOKIE,
	parseDoctorPayoutUpdateRequest,
	readRequestCookie,
	toErrorResponse,
} from "../../../../../modules/doctors/routes";
import { SessionAuthorizationError } from "../../../../../modules/doctors/domain";
import { doctorsService } from "../../../../../modules/doctors/service";
import { ok } from "../../../../../shared/api-envelope";
import { verifyAuthToken, type AuthContext } from "../../../../../shared/auth-context";

function getSession(request: Request): AuthContext {
	const token = readRequestCookie(request, DOCTOR_SESSION_COOKIE);
	if (!token) throw new SessionAuthorizationError();
	try {
		return verifyAuthToken(token);
	} catch {
		throw new SessionAuthorizationError();
	}
}

export async function GET(request: Request): Promise<NextResponse> {
	try {
		return NextResponse.json(ok(await doctorsService.getOwnPayoutProfile(getSession(request))), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}

export async function PATCH(request: Request): Promise<NextResponse> {
	try {
		const caller = getSession(request);
		const input = await parseDoctorPayoutUpdateRequest(request);
		return NextResponse.json(ok(await doctorsService.updateOwnPayoutProfile(caller, input.upiId)));
	} catch (error) {
		return toErrorResponse(error);
	}
}