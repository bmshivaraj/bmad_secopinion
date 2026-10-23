import { NextResponse } from "next/server";
import {
	DOCTOR_SESSION_COOKIE,
	readRequestCookie,
	toErrorResponse,
} from "../../../../../modules/doctors/routes";
import { SessionAuthorizationError } from "../../../../../modules/doctors/domain";
import { paymentsService } from "../../../../../modules/payments/service";
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
		return NextResponse.json(ok(await paymentsService.listOwnPayoutHistory(getSession(request))), {
			headers: { "cache-control": "private, no-store" },
		});
	} catch (error) {
		return toErrorResponse(error);
	}
}