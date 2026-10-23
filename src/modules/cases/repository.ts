// Cases module's own DB access (AD-2) -- no other module may query these tables directly.
import { prisma } from "../../shared/prisma-client";
import type { Prisma } from "../../generated/prisma/client";
import { canTransitionCase } from "./domain";
import { CaseDocumentRequestConflictError } from "./domain";
import { CaseOpinionConflictError } from "./domain";
import type { CaseDocumentRecord, CaseDocumentRequestRecord, CaseDraftInput, CaseOpinionRecord, CaseRecord, CaseSlaCandidateRecord, CaseStatus, OpinionPayoutCursor } from "./domain";

const draftInclude = { documents: { orderBy: { createdAt: "asc" as const } } } as const;
const caseHistoryInclude = {
	documents: { orderBy: { createdAt: "asc" as const } },
	documentRequests: { orderBy: { createdAt: "asc" as const } },
	opinion: true,
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

function closeOpenPauseHistory(value: Prisma.JsonValue, closedAt: Date, requireOpenPause: boolean): Prisma.InputJsonValue | null {
	if (!Array.isArray(value)) return null;
	const openIntervals = value.flatMap((entry, index) => (
		typeof entry === "object" && entry !== null && !Array.isArray(entry) && entry.resumedAt === null
			? [index]
			: []
	));
	if (openIntervals.length > 1 || (requireOpenPause && openIntervals.length !== 1)) return null;
	if (openIntervals.length === 0) return value as Prisma.InputJsonValue;
	const [openIndex] = openIntervals;
	return value.map((entry, index) => index === openIndex && typeof entry === "object" && entry !== null && !Array.isArray(entry)
		? { ...entry, resumedAt: closedAt.toISOString() }
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

	async listSlaCandidates(): Promise<CaseSlaCandidateRecord[]> {
		const records = await prisma.case.findMany({
			where: {
				status: { in: ["Submitted", "UnderReview", "MoreInfoRequested"] },
				submittedAt: { not: null },
				chargedAmount: { not: null },
			},
			orderBy: { submittedAt: "asc" },
			select: { id: true, status: true, submittedAt: true, slaPauseHistory: true, chargedAmount: true },
		});
		return records.flatMap((record) => record.submittedAt && record.chargedAmount ? [{
			id: record.id,
			status: record.status,
			submittedAt: record.submittedAt,
			slaPauseHistory: record.slaPauseHistory,
			chargedAmount: record.chargedAmount,
		}] : []);
	},

	async markCaseRefundPending(caseId: string, expectedStatus: CaseStatus): Promise<boolean> {
		if (!canTransitionCase(expectedStatus, "RefundPending")) return false;
		const updated = await prisma.case.updateMany({
			where: { id: caseId, status: expectedStatus, submittedAt: { not: null }, chargedAmount: { not: null } },
			data: { status: "RefundPending", refundDecision: null, refundConfirmedAt: null },
		});
		return updated.count === 1;
	},

	async listRefundPendingCases() {
		return prisma.case.findMany({
			where: { status: "RefundPending", chargedAmount: { not: null } },
			orderBy: { submittedAt: "asc" },
			select: {
				id: true,
				affectedBodyArea: true,
				urgencyTier: true,
				doctorId: true,
				submittedAt: true,
				chargedAmount: true,
				refundDecision: true,
			},
		});
	},

	async claimRefundApproval(caseId: string): Promise<boolean> {
		const updated = await prisma.case.updateMany({
			where: { id: caseId, status: "RefundPending", refundDecision: null },
			data: { refundDecision: "Approving" },
		});
		return updated.count === 1;
	},

	async releaseRefundApproval(caseId: string): Promise<boolean> {
		const updated = await prisma.case.updateMany({
			where: { id: caseId, status: "RefundPending", refundDecision: "Approving" },
			data: { refundDecision: null },
		});
		return updated.count === 1;
	},

	async rejectRefundPendingCase(caseId: string, rejectedAt: Date): Promise<boolean> {
		if (!canTransitionCase("RefundPending", "UnderReview")) return false;
		const updated = await prisma.case.updateMany({
			where: { id: caseId, status: "RefundPending", refundDecision: null },
			data: {
				status: "UnderReview",
				submittedAt: rejectedAt,
				slaPauseHistory: [],
				refundDecision: "Rejected",
				refundConfirmedAt: null,
			},
		});
		return updated.count === 1;
	},

	async finalizeRefundApproval(caseId: string, confirmedAt: Date): Promise<boolean> {
		if (!canTransitionCase("RefundPending", "Refunded") || !canTransitionCase("Refunded", "Closed")) return false;
		return prisma.$transaction(async (transaction) => {
			const refunded = await transaction.case.updateMany({
				where: { id: caseId, status: "RefundPending", refundDecision: "Approving" },
				data: { status: "Refunded", refundConfirmedAt: confirmedAt },
			});
			if (refunded.count !== 1) return false;
			const closed = await transaction.case.updateMany({
				where: { id: caseId, status: "Refunded", refundDecision: "Approving" },
				data: { status: "Closed", refundDecision: "Approved" },
			});
			if (closed.count !== 1) throw new Error("Refunded Case could not be closed.");
			return true;
		});
	},

	async submitOpinion(
		caseId: string,
		doctorId: string,
		text: string,
		submittedAt: Date,
		platformFeePercent: Prisma.Decimal,
	): Promise<CaseOpinionRecord | null> {
		return prisma.$transaction(async (transaction) => {
			const current = await transaction.case.findFirst({
				where: { id: caseId, doctorId, status: { in: ["UnderReview", "MoreInfoRequested"] } },
				select: { status: true, slaPauseHistory: true },
			});
			if (!current || !canTransitionCase(current.status, "OpinionGiven") || !canTransitionCase("OpinionGiven", "Closed")) return null;
			const slaPauseHistory = closeOpenPauseHistory(
				current.slaPauseHistory,
				submittedAt,
				current.status === "MoreInfoRequested",
			);
			if (!slaPauseHistory) return null;
			const activeRequest = await transaction.caseDocumentRequest.findFirst({
				where: { caseId, fulfilledAt: null, closedAt: null },
				orderBy: { createdAt: "desc" },
				select: { id: true },
			});
			if (current.status === "MoreInfoRequested" && !activeRequest) return null;
			const movedToOpinion = await transaction.case.updateMany({
				where: { id: caseId, doctorId, status: current.status },
				data: { status: "OpinionGiven", slaPauseHistory, platformFeePercentAtClosure: platformFeePercent },
			});
			if (movedToOpinion.count !== 1) return null;
			const opinion = await transaction.caseOpinion.create({
				data: { caseId, doctorId, text, createdAt: submittedAt },
			});
			if (activeRequest) {
				const closedRequest = await transaction.caseDocumentRequest.updateMany({
					where: { id: activeRequest.id, fulfilledAt: null, closedAt: null },
					data: { closedAt: submittedAt },
				});
				if (closedRequest.count !== 1) throw new CaseOpinionConflictError();
			}
			const closed = await transaction.case.updateMany({
				where: { id: caseId, doctorId, status: "OpinionGiven" },
				data: { status: "Closed" },
			});
			if (closed.count !== 1) throw new CaseOpinionConflictError();
			return opinion;
		});
	},

	async listClosedOpinionsForPayout(after: OpinionPayoutCursor | null) {
		return prisma.case.findMany({
			where: {
				status: "Closed",
				doctorId: { not: null },
				chargedAmount: { not: null },
				platformFeePercentAtClosure: { not: null },
				opinion: after
					? { is: { OR: [
						{ createdAt: { gt: after.opinionCreatedAt } },
						{ createdAt: after.opinionCreatedAt, caseId: { gt: after.caseId } },
					] } }
					: { isNot: null },
			},
			orderBy: [{ opinion: { createdAt: "asc" } }, { id: "asc" }],
			take: 100,
			select: {
				id: true,
				doctorId: true,
				chargedAmount: true,
				platformFeePercentAtClosure: true,
				opinion: { select: { createdAt: true } },
			},
		});
	},

	async findOpinionByCaseId(caseId: string): Promise<CaseOpinionRecord | null> {
		return prisma.caseOpinion.findUnique({ where: { caseId } });
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

	async correctSubmittedCaseRouting(
		caseId: string,
		specialtyId: string,
		doctorId: string,
		expectedVersion: number,
		currentSpecialtyId: string | null,
		currentDoctorId: string | null,
		incrementVersion: boolean,
	): Promise<boolean> {
		const updated = await prisma.case.updateMany({
			where: {
				id: caseId,
				status: "Submitted",
				submittedAt: { not: null },
				specialtyId: currentSpecialtyId,
				doctorId: currentDoctorId,
				assignmentLockVersion: expectedVersion,
			},
			data: {
				specialtyId,
				doctorId,
				status: "UnderReview",
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
				submittedAt: { not: null },
				OR: [
					{ status: "Closed", doctorId },
					{
						status: { in: ["Submitted", "UnderReview", "MoreInfoRequested"] },
						OR: [{ doctorId: null }, { doctorId }],
					},
				],
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
				where: { caseId, fulfilledAt: null, closedAt: null },
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
				where: { id: activeRequest.id, fulfilledAt: null, closedAt: null },
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
