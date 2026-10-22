// Cases module's own DB access (AD-2) -- no other module may query these tables directly.
import { prisma } from "../../shared/prisma-client";
import type { Prisma } from "../../generated/prisma/client";
import { CaseDocumentRequestConflictError } from "./domain";
import type { CaseDocumentRecord, CaseDocumentRequestRecord, CaseDraftInput, CaseRecord, CaseStatus } from "./domain";

const draftInclude = { documents: { orderBy: { createdAt: "asc" as const } } } as const;
const caseHistoryInclude = {
	documents: { orderBy: { createdAt: "asc" as const } },
	documentRequests: { orderBy: { createdAt: "asc" as const } },
} as const;

function resumeOpenPauseHistory(value: Prisma.JsonValue, resumedAt: Date): Prisma.InputJsonValue | null {
	if (!Array.isArray(value)) return null;
	const openIntervals = value.flatMap((entry, index) => (
		typeof entry === "object" && entry !== null && !Array.isArray(entry) && entry.resumedAt === null
			? [index]
			: []
	));
	if (openIntervals.length !== 1) return null;
	const [openIndex] = openIntervals;
	return value.map((entry, index) => index === openIndex && typeof entry === "object" && entry !== null && !Array.isArray(entry)
		? { ...entry, resumedAt: resumedAt.toISOString() }
		: entry) as Prisma.InputJsonValue;
}

export const casesRepository = {
	async createDraft(patientId: string, creationRequestId: string, input: Required<CaseDraftInput>): Promise<CaseRecord> {
		return prisma.case.create({ data: { patientId, creationRequestId, ...input }, include: draftInclude });
	},

	async findByCreationRequestId(creationRequestId: string): Promise<CaseRecord | null> {
		return prisma.case.findUnique({ where: { creationRequestId }, include: draftInclude });
	},

	async findLatestDraft(patientId: string): Promise<CaseRecord | null> {
		return prisma.case.findFirst({
			where: { patientId, status: "Draft" },
			orderBy: { updatedAt: "desc" },
			include: draftInclude,
		});
	},

	async updateDraft(caseId: string, patientId: string, input: Required<CaseDraftInput>): Promise<CaseRecord | null> {
		const updated = await prisma.case.updateMany({
			where: { id: caseId, patientId, status: "Draft" },
			data: input,
		});
		if (updated.count === 0) return null;
		return prisma.case.findUnique({ where: { id: caseId }, include: draftInclude });
	},

	async updateDraftDoctorSelection(
		caseId: string,
		patientId: string,
		selectedDoctorId: string | null,
	): Promise<CaseRecord | null> {
		const updated = await prisma.case.updateMany({
			where: { id: caseId, patientId, status: "Draft" },
			data: { selectedDoctorId },
		});
		if (updated.count === 0) return null;
		return prisma.case.findUnique({ where: { id: caseId }, include: draftInclude });
	},

	async updateCaseToSubmitted(
		caseId: string,
		patientId: string,
		urgencyTier: "Standard" | "Urgent",
		chargedAmount: Prisma.Decimal,
		doctorId: string | null,
		submittedAt: Date,
	): Promise<CaseRecord | null> {
		const updated = await prisma.case.updateMany({
			where: { id: caseId, patientId, status: "Draft" },
			data: { status: "Submitted", urgencyTier, chargedAmount, doctorId, selectedDoctorId: doctorId, submittedAt },
		});
		if (updated.count === 0) return null;
		return prisma.case.findUnique({ where: { id: caseId }, include: draftInclude });
	},

	async findById(caseId: string): Promise<CaseRecord | null> {
		return prisma.case.findUnique({ where: { id: caseId }, include: draftInclude });
	},

	async listPatientCases(patientId: string): Promise<CaseRecord[]> {
		return prisma.case.findMany({
			where: { patientId, status: { not: "Draft" } },
			orderBy: { updatedAt: "desc" },
			include: caseHistoryInclude,
		});
	},

	async listUnclassifiedSubmittedCases(): Promise<CaseRecord[]> {
		return prisma.case.findMany({
			where: { status: "Submitted", specialtyId: null },
			orderBy: { submittedAt: "asc" },
			include: draftInclude,
		});
	},

	async listDoctorQueue(specialtyIds: string[], doctorId: string): Promise<CaseRecord[]> {
		if (specialtyIds.length === 0) return [];
		return prisma.case.findMany({
			where: {
				specialtyId: { in: specialtyIds },
				status: { in: ["Submitted", "UnderReview", "MoreInfoRequested"] },
				submittedAt: { not: null },
				OR: [{ doctorId: null }, { doctorId }],
			},
			include: draftInclude,
		});
	},

	async listAdminAssignmentCases() {
		return prisma.case.findMany({
			where: {
				specialtyId: { not: null },
				status: { in: ["Submitted", "UnderReview", "MoreInfoRequested"] },
				submittedAt: { not: null },
			},
			orderBy: [{ urgencyTier: "desc" }, { submittedAt: "asc" }],
			select: {
				id: true,
				affectedBodyArea: true,
				condition: true,
				specialtyId: true,
				urgencyTier: true,
				status: true,
				doctorId: true,
				submittedAt: true,
				assignmentLockVersion: true,
			},
		});
	},

	async assignCaseToDoctor(
		caseId: string,
		doctorId: string,
		expectedVersion: number,
		currentDoctorId: string | null,
		currentStatus: CaseStatus,
		nextStatus: CaseStatus,
		incrementVersion: boolean,
	): Promise<boolean> {
		const updated = await prisma.case.updateMany({
			where: {
				id: caseId,
				specialtyId: { not: null },
				submittedAt: { not: null },
				status: currentStatus,
				doctorId: currentDoctorId,
				assignmentLockVersion: expectedVersion,
			},
			data: {
				doctorId,
				status: nextStatus,
				...(incrementVersion ? { assignmentLockVersion: { increment: 1 } } : {}),
			},
		});
		return updated.count === 1;
	},

	async classifySubmittedCase(caseId: string, specialtyId: string, expectedVersion: number, clearDoctorAssignment: boolean): Promise<CaseRecord | null> {
		const updated = await prisma.case.updateMany({
			where: { id: caseId, status: "Submitted", specialtyId: null, assignmentLockVersion: expectedVersion },
			data: {
				specialtyId,
				...(clearDoctorAssignment ? { doctorId: null } : {}),
				assignmentLockVersion: { increment: 1 },
			},
		});
		if (updated.count === 0) return null;
		return prisma.case.findUnique({ where: { id: caseId }, include: draftInclude });
	},

	async findDoctorVisibleCase(caseId: string, specialtyIds: string[], doctorId: string): Promise<CaseRecord | null> {
		if (specialtyIds.length === 0) return null;
		return prisma.case.findFirst({
			where: {
				id: caseId,
				specialtyId: { in: specialtyIds },
				status: { in: ["Submitted", "UnderReview", "MoreInfoRequested"] },
				submittedAt: { not: null },
				OR: [{ doctorId: null }, { doctorId }],
			},
			include: caseHistoryInclude,
		});
	},

	async createDocumentRequest(
		caseId: string,
		doctorId: string,
		note: string,
		requestedAt: Date,
	): Promise<CaseDocumentRequestRecord | null> {
		return prisma.$transaction(async (transaction) => {
			const current = await transaction.case.findFirst({
				where: { id: caseId, doctorId, status: "UnderReview" },
				select: { slaPauseHistory: true },
			});
			if (!current || !Array.isArray(current.slaPauseHistory)) return null;
			const updated = await transaction.case.updateMany({
				where: { id: caseId, doctorId, status: "UnderReview" },
				data: {
					status: "MoreInfoRequested",
					slaPauseHistory: [...current.slaPauseHistory, { pausedAt: requestedAt.toISOString(), resumedAt: null }],
				},
			});
			if (updated.count !== 1) return null;
			return transaction.caseDocumentRequest.create({
				data: { caseId, requestedByDoctorId: doctorId, note, createdAt: requestedAt },
			});
		});
	},

	async createDocuments(
		caseId: string,
		documents: Omit<CaseDocumentRecord, "id" | "caseId" | "createdAt">[],
	): Promise<CaseDocumentRecord[]> {
		return prisma.$transaction(async (transaction) => {
			const created: CaseDocumentRecord[] = [];
			for (const document of documents) {
				created.push(await transaction.caseDocument.create({ data: { caseId, ...document } }));
			}
			await transaction.case.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
			return created;
		});
	},

	async createResponseDocuments(
		caseId: string,
		patientId: string,
		documents: Omit<CaseDocumentRecord, "id" | "caseId" | "createdAt">[],
		resumedAt: Date,
	): Promise<CaseDocumentRecord[] | null> {
		return prisma.$transaction(async (transaction) => {
			const current = await transaction.case.findFirst({
				where: { id: caseId, patientId, status: "MoreInfoRequested" },
				select: { slaPauseHistory: true },
			});
			if (!current) return null;
			const slaPauseHistory = resumeOpenPauseHistory(current.slaPauseHistory, resumedAt);
			const activeRequest = await transaction.caseDocumentRequest.findFirst({
				where: { caseId, fulfilledAt: null },
				orderBy: { createdAt: "desc" },
				select: { id: true },
			});
			if (!slaPauseHistory || !activeRequest) return null;
			const updated = await transaction.case.updateMany({
				where: { id: caseId, patientId, status: "MoreInfoRequested" },
				data: { status: "UnderReview", slaPauseHistory },
			});
			if (updated.count !== 1) return null;
			const fulfilled = await transaction.caseDocumentRequest.updateMany({
				where: { id: activeRequest.id, fulfilledAt: null },
				data: { fulfilledAt: resumedAt },
			});
			if (fulfilled.count !== 1) throw new CaseDocumentRequestConflictError();
			const created: CaseDocumentRecord[] = [];
			for (const document of documents) {
				created.push(await transaction.caseDocument.create({ data: { caseId, ...document } }));
			}
			return created;
		});
	},

	async findDocumentById(documentId: string) {
		return prisma.caseDocument.findUnique({
			where: { id: documentId },
			include: { case: { select: { patientId: true, doctorId: true, specialtyId: true } } },
		});
	},

	async deleteDocument(documentId: string, caseId: string): Promise<void> {
		await prisma.$transaction(async (transaction) => {
			await transaction.caseDocument.delete({ where: { id: documentId } });
			await transaction.case.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
		});
	},
};
