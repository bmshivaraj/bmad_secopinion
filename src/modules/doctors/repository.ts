// Doctors module's own DB access (AD-2) -- no other module may query these tables directly.
import { prisma } from "../../shared/prisma-client";
import type {
	DoctorAccount,
	DoctorApplication,
	DoctorCredentialRecord,
	DoctorVerificationStatus,
	SpecialtySummary,
} from "./domain";

const applicationInclude = {
	specialties: { include: { specialty: { select: { id: true, name: true } } } },
	credentials: true,
} as const;

function mapAccount(record: DoctorAccount): DoctorAccount {
	return record;
}

function mapApplication(record: {
	id: string;
	mobileNumber: string;
	fullName: string;
	username: string;
	passwordHash: string;
	verificationStatus: DoctorVerificationStatus;
	createdAt: Date;
	updatedAt: Date;
	specialties: { specialty: SpecialtySummary }[];
	credentials: DoctorCredentialRecord[];
}): DoctorApplication {
	return {
		...mapAccount(record),
		specialties: record.specialties.map(({ specialty }) => specialty),
		credentials: record.credentials,
	};
}

export const doctorsRepository = {
	async findByMobileNumber(mobileNumber: string): Promise<DoctorAccount | null> {
		const record = await prisma.doctor.findUnique({ where: { mobileNumber } });
		return record ? mapAccount(record) : null;
	},

	async findByUsername(username: string): Promise<DoctorAccount | null> {
		const record = await prisma.doctor.findUnique({ where: { username } });
		return record ? mapAccount(record) : null;
	},

	async findById(doctorId: string): Promise<DoctorAccount | null> {
		const record = await prisma.doctor.findUnique({ where: { id: doctorId } });
		return record ? mapAccount(record) : null;
	},

	async findActiveSpecialties(specialtyIds: string[]): Promise<SpecialtySummary[]> {
		return prisma.specialty.findMany({
			where: { id: { in: specialtyIds }, active: true },
			select: { id: true, name: true },
			orderBy: { name: "asc" },
		});
	},

	async listActiveSpecialties(): Promise<SpecialtySummary[]> {
		return prisma.specialty.findMany({
			where: { active: true },
			select: { id: true, name: true },
			orderBy: { name: "asc" },
		});
	},

	async createApplication(input: {
		mobileNumber: string;
		fullName: string;
		username: string;
		passwordHash: string;
		specialtyIds: string[];
		credentials: Omit<DoctorCredentialRecord, "id" | "doctorId" | "createdAt">[];
	}): Promise<DoctorApplication> {
		const record = await prisma.$transaction(async (transaction) => transaction.doctor.create({
			data: {
				mobileNumber: input.mobileNumber,
				fullName: input.fullName,
				username: input.username,
				passwordHash: input.passwordHash,
				verificationStatus: "Pending",
				specialties: {
					create: input.specialtyIds.map((specialtyId) => ({ specialty: { connect: { id: specialtyId } } })),
				},
				credentials: { create: input.credentials },
			},
			include: applicationInclude,
		}));
		return mapApplication(record);
	},

	async findCredentialById(credentialId: string): Promise<DoctorCredentialRecord | null> {
		return prisma.doctorCredential.findUnique({ where: { id: credentialId } });
	},
};
