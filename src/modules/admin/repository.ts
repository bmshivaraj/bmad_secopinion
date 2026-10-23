// Admin module's own DB access (AD-2) -- no other module may query these tables directly.
import { prisma } from "../../shared/prisma-client";
import type { Prisma } from "../../generated/prisma/client";
import type { AdminAccount } from "./domain";

const PLATFORM_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

export interface PlatformSettingsValues {
	standardCaseFee: Prisma.Decimal;
	urgentCaseFee: Prisma.Decimal;
	platformFeePercent: Prisma.Decimal;
}

export const adminRepository = {
	async findByUsername(username: string): Promise<AdminAccount | null> {
		return prisma.adminAccount.findUnique({ where: { username } });
	},

	async getPlatformSettings() {
		return prisma.platformSettings.findUnique({ where: { id: PLATFORM_SETTINGS_ID } });
	},

	async updatePlatformSettings(values: PlatformSettingsValues) {
		return prisma.platformSettings.upsert({
			where: { id: PLATFORM_SETTINGS_ID },
			update: values,
			create: { id: PLATFORM_SETTINGS_ID, ...values },
		});
	},
};
