import argon2 from "argon2";
import { Prisma } from "../../generated/prisma/client";
import { signAuthToken, type AuthContext } from "../../shared/auth-context";
import { doctorsService } from "../doctors/service";
import {
	AdminAccessDeniedError,
	AdminInvalidCredentialsError,
	PlatformSettingsUnavailableError,
	PlatformSettingsValidationError,
} from "./domain";
import { adminRepository } from "./repository";

const MAX_PASSWORD_LENGTH = 1024;
const MAX_LOGIN_FAILURES = 20;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const DUMMY_PASSWORD_HASH = argon2.hash("secopinion-invalid-admin-dummy", { type: argon2.argon2id });

type AdminRepository = Pick<typeof adminRepository, "findByUsername"> & Partial<Pick<typeof adminRepository, "getPlatformSettings" | "updatePlatformSettings">>;
type ReviewDoctorsService = Pick<
	typeof doctorsService,
	"listPendingApplications" | "setVerificationStatus" | "listActiveSpecialties" | "createSpecialty"
>;

export function createAdminService(
	repository: AdminRepository = adminRepository,
	doctors: ReviewDoctorsService = doctorsService,
) {
	const loginFailures = new Map<string, number[]>();
	let loginFailuresSinceCleanup = 0;

	function parseSettingsAmount(value: unknown, field: string): Prisma.Decimal {
		if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) {
			throw new PlatformSettingsValidationError(`${field} must be a decimal amount with no more than two decimal places.`);
		}
		return new Prisma.Decimal(value);
	}

	function parsePlatformSettings(input: unknown) {
		if (typeof input !== "object" || input === null || Array.isArray(input)) {
			throw new PlatformSettingsValidationError("Platform settings must be a JSON object.");
		}
		const values = input as Record<string, unknown>;
		const standardCaseFee = parseSettingsAmount(values.standardCaseFee, "standardCaseFee");
		const urgentCaseFee = parseSettingsAmount(values.urgentCaseFee, "urgentCaseFee");
		const platformFeePercent = parseSettingsAmount(values.platformFeePercent, "platformFeePercent");

		if (standardCaseFee.lte(0) || standardCaseFee.gt("99999999.99")) {
			throw new PlatformSettingsValidationError("standardCaseFee must be greater than 0 and fit in a currency amount.");
		}
		if (urgentCaseFee.lte(0) || urgentCaseFee.gt("99999999.99")) {
			throw new PlatformSettingsValidationError("urgentCaseFee must be greater than 0 and fit in a currency amount.");
		}
		if (platformFeePercent.lt(0) || platformFeePercent.gt(100)) {
			throw new PlatformSettingsValidationError("platformFeePercent must be between 0 and 100, inclusive.");
		}

		return { standardCaseFee, urgentCaseFee, platformFeePercent };
	}

	async function readPlatformSettings() {
		const settings = await repository.getPlatformSettings?.();
		if (!settings) throw new PlatformSettingsUnavailableError();
		return {
			standardCaseFee: settings.standardCaseFee,
			urgentCaseFee: settings.urgentCaseFee,
			platformFeePercent: settings.platformFeePercent,
		};
	}

	function formatPlatformSettings(settings: Awaited<ReturnType<typeof readPlatformSettings>>) {
		return {
			standardCaseFee: settings.standardCaseFee.toFixed(2),
			urgentCaseFee: settings.urgentCaseFee.toFixed(2),
			platformFeePercent: settings.platformFeePercent.toFixed(2),
		};
	}

	function assertAdmin(caller: AuthContext): void {
		if (caller.role !== "admin") throw new AdminAccessDeniedError();
	}

	function recentLoginFailures(username: string): number[] {
		const recent = (loginFailures.get(username) ?? []).filter(
			(timestamp) => Date.now() - timestamp < LOGIN_FAILURE_WINDOW_MS,
		);
		loginFailures.set(username, recent);
		return recent;
	}

	function recordLoginFailure(username: string): void {
		loginFailures.set(username, [...recentLoginFailures(username), Date.now()]);
		loginFailuresSinceCleanup += 1;
		if (loginFailuresSinceCleanup >= 100) {
			const now = Date.now();
			for (const [failedUsername, timestamps] of loginFailures) {
				const activeTimestamps = timestamps.filter((timestamp) => now - timestamp < LOGIN_FAILURE_WINDOW_MS);
				if (activeTimestamps.length === 0) loginFailures.delete(failedUsername);
				else if (activeTimestamps.length !== timestamps.length) loginFailures.set(failedUsername, activeTimestamps);
			}
			loginFailuresSinceCleanup = 0;
		}
	}

	return {
		async login(username: string, password: string): Promise<{ adminId: string; token: string }> {
			const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
			if (!normalizedUsername || normalizedUsername.length > 100 || !password || password.length > MAX_PASSWORD_LENGTH) {
				throw new AdminInvalidCredentialsError();
			}
			if (recentLoginFailures(normalizedUsername).length >= MAX_LOGIN_FAILURES) {
				throw new AdminInvalidCredentialsError();
			}

			const admin = await repository.findByUsername(normalizedUsername);
			const passwordHash = admin?.passwordHash ?? await DUMMY_PASSWORD_HASH;
			let passwordMatches = false;
			try {
				passwordMatches = await argon2.verify(passwordHash, password);
			} catch {
				passwordMatches = false;
			}
			if (!admin || !passwordMatches) {
				recordLoginFailure(normalizedUsername);
				throw new AdminInvalidCredentialsError();
			}

			loginFailures.delete(normalizedUsername);
			return { adminId: admin.id, token: signAuthToken({ userId: admin.id, role: "admin" }) };
		},

		async listPendingApplications(caller: AuthContext) {
			assertAdmin(caller);
			const applications = await doctors.listPendingApplications(caller);
			return applications.map((application) => ({
				...application,
				credentials: application.credentials.map((credential) => ({
					...credential,
					href: `/api/doctors/credentials/${encodeURIComponent(credential.id)}`,
				})),
			}));
		},

		async listSpecialties(caller: AuthContext) {
			assertAdmin(caller);
			return doctors.listActiveSpecialties();
		},

		async addSpecialty(caller: AuthContext, name: string) {
			assertAdmin(caller);
			return doctors.createSpecialty(name);
		},

		async getPlatformSettings() {
			return readPlatformSettings();
		},

		async getAdminPlatformSettings(caller: AuthContext) {
			assertAdmin(caller);
			return formatPlatformSettings(await readPlatformSettings());
		},

		async updatePlatformSettings(caller: AuthContext, input: unknown) {
			assertAdmin(caller);
			const values = parsePlatformSettings(input);
			const update = repository.updatePlatformSettings;
			if (!update) throw new PlatformSettingsUnavailableError();
			const settings = await update(values);
			return formatPlatformSettings({
				standardCaseFee: settings.standardCaseFee,
				urgentCaseFee: settings.urgentCaseFee,
				platformFeePercent: settings.platformFeePercent,
			});
		},

		async decideApplication(
			caller: AuthContext,
			doctorId: string,
			verificationStatus: "Verified" | "Rejected",
		) {
			assertAdmin(caller);
			return doctors.setVerificationStatus(caller, doctorId, verificationStatus);
		},
	};
}

export const adminService = createAdminService();
