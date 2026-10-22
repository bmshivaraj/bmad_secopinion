// Cases module's own DB access (AD-2) -- no other module may query these tables directly.
import { prisma } from "../../shared/prisma-client";
import type { Prisma } from "../../generated/prisma/client";
import type { CaseDocumentRecord, CaseDraftInput, CaseRecord } from "./domain";

const draftInclude = { documents: { orderBy: { createdAt: "asc" as const } } } as const;

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
	): Promise<CaseRecord | null> {
		const updated = await prisma.case.updateMany({
			where: { id: caseId, patientId, status: "Draft" },
			data: { status: "Submitted", urgencyTier, chargedAmount, doctorId, selectedDoctorId: doctorId },
		});
		if (updated.count === 0) return null;
		return prisma.case.findUnique({ where: { id: caseId }, include: draftInclude });
	},

	async findById(caseId: string): Promise<CaseRecord | null> {
		return prisma.case.findUnique({ where: { id: caseId }, include: draftInclude });
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

	async findDocumentById(documentId: string) {
		return prisma.caseDocument.findUnique({
			where: { id: documentId },
			include: { case: { select: { patientId: true } } },
		});
	},

	async deleteDocument(documentId: string, caseId: string): Promise<void> {
		await prisma.$transaction(async (transaction) => {
			await transaction.caseDocument.delete({ where: { id: documentId } });
			await transaction.case.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
		});
	},
};
