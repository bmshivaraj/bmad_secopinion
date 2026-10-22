// Admin module's own DB access (AD-2) -- no other module may query these tables directly.
import { prisma } from "../../shared/prisma-client";
import type { AdminAccount } from "./domain";

export const adminRepository = {
	async findByUsername(username: string): Promise<AdminAccount | null> {
		return prisma.adminAccount.findUnique({ where: { username } });
	},

	async getPlatformSettings() {
		return prisma.platformSettings.findFirst({ orderBy: { updatedAt: "desc" } });
	},
};
