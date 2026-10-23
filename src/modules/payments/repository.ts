// Payments module's own DB access (AD-2) -- no other module may query these tables directly.
import { prisma } from "../../shared/prisma-client";
import type { PaymentAttempt, PaymentAttemptInput, PayoutAttempt, PayoutAttemptInput, PayoutBatchCheckpoint, PayoutRetryCursor } from "./domain";

const PAYOUT_BATCH_CHECKPOINT_ID = "daily-doctor-payout";

export const paymentsRepository = {
	findAttemptByCaseId(caseId: string): Promise<PaymentAttempt | null> {
		return prisma.paymentAttempt.findUnique({ where: { caseId } });
	},

	createAttempt(input: PaymentAttemptInput & { idempotencyKey: string }): Promise<PaymentAttempt> {
		return prisma.paymentAttempt.create({ data: input });
	},

	async renewFailedAttempt(caseId: string, input: PaymentAttemptInput & { idempotencyKey: string }): Promise<PaymentAttempt | null> {
		const updated = await prisma.paymentAttempt.updateMany({
			where: { caseId, status: "Failed" },
			data: { ...input, status: "Pending", transactionId: null, providerError: null },
		});
		return updated.count === 0 ? null : this.findAttemptByCaseId(caseId);
	},

	async markFailed(caseId: string, idempotencyKey: string, providerError: string): Promise<void> {
		await prisma.paymentAttempt.updateMany({
			where: { caseId, idempotencyKey, status: "Pending" },
			data: { status: "Failed", providerError: providerError.slice(0, 500) },
		});
	},

	async markSucceeded(caseId: string, idempotencyKey: string, transactionId: string): Promise<PaymentAttempt | null> {
		await prisma.paymentAttempt.updateMany({
			where: { caseId, idempotencyKey, status: "Pending" },
			data: { status: "Succeeded", transactionId, providerError: null },
		});
		return this.findAttemptByCaseId(caseId);
	},

	async prepareRefund(caseId: string, idempotencyKey: string): Promise<PaymentAttempt | null> {
		await prisma.paymentAttempt.updateMany({
			where: { caseId, status: "Succeeded", transactionId: { not: null }, refundIdempotencyKey: null },
			data: { refundIdempotencyKey: idempotencyKey, refundStatus: "Pending", refundProviderError: null },
		});
		return this.findAttemptByCaseId(caseId);
	},

	async retryFailedRefund(caseId: string, idempotencyKey: string): Promise<PaymentAttempt | null> {
		await prisma.paymentAttempt.updateMany({
			where: { caseId, status: "Succeeded", refundStatus: "Failed" },
			data: {
				refundIdempotencyKey: idempotencyKey,
				refundStatus: "Pending",
				refundTransactionId: null,
				refundProviderError: null,
			},
		});
		return this.findAttemptByCaseId(caseId);
	},

	async markRefundFailed(
		caseId: string,
		idempotencyKey: string,
		status: "Failed" | "Uncertain",
		providerError: string,
	): Promise<PaymentAttempt | null> {
		await prisma.paymentAttempt.updateMany({
			where: { caseId, refundIdempotencyKey: idempotencyKey, refundStatus: { in: ["Pending", "Failed", "Uncertain"] } },
			data: { refundStatus: status, refundProviderError: providerError.slice(0, 500) },
		});
		return this.findAttemptByCaseId(caseId);
	},

	async markRefundSucceeded(
		caseId: string,
		idempotencyKey: string,
		refundTransactionId: string | null,
	): Promise<PaymentAttempt | null> {
		await prisma.paymentAttempt.updateMany({
			where: { caseId, refundIdempotencyKey: idempotencyKey, refundStatus: { in: ["Pending", "Failed", "Uncertain"] } },
			data: { refundStatus: "Succeeded", refundTransactionId, refundProviderError: null },
		});
		return this.findAttemptByCaseId(caseId);
	},

	findPayoutAttemptByCaseId(caseId: string): Promise<PayoutAttempt | null> {
		return prisma.payoutAttempt.findUnique({ where: { caseId } });
	},

	createPayoutAttempt(input: PayoutAttemptInput & { idempotencyKey: string }): Promise<PayoutAttempt> {
		return prisma.payoutAttempt.create({ data: input });
	},

	async retryPayoutAttempt(caseId: string, status: "Failed" | "Uncertain", idempotencyKey: string): Promise<PayoutAttempt | null> {
		const updated = await prisma.payoutAttempt.updateMany({
			where: { caseId, status },
			data: {
				idempotencyKey,
				status: "Pending",
				transactionId: null,
				providerError: null,
				...(status === "Failed" ? { upiId: null } : {}),
			},
		});
		return updated.count === 0 ? null : this.findPayoutAttemptByCaseId(caseId);
	},

	async setPayoutDestination(caseId: string, idempotencyKey: string, upiId: string): Promise<PayoutAttempt | null> {
		await prisma.payoutAttempt.updateMany({
			where: { caseId, idempotencyKey, status: "Pending", upiId: null },
			data: { upiId },
		});
		return this.findPayoutAttemptByCaseId(caseId);
	},

	async markPayoutOutcome(
		caseId: string,
		idempotencyKey: string,
		status: "Failed" | "Uncertain" | "Succeeded",
		providerError: string | null,
		transactionId: string | null = null,
	): Promise<PayoutAttempt | null> {
		await prisma.payoutAttempt.updateMany({
			where: { caseId, idempotencyKey, status: { in: ["Pending", "Failed", "Uncertain"] } },
			data: { status, providerError: providerError?.slice(0, 500) ?? null, transactionId },
		});
		return this.findPayoutAttemptByCaseId(caseId);
	},

	listPayoutAttemptsByDoctorId(doctorId: string): Promise<PayoutAttempt[]> {
		return prisma.payoutAttempt.findMany({ where: { doctorId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
	},

	async listRetryablePayoutAttempts(after: PayoutRetryCursor | null): Promise<{ items: PayoutAttempt[]; nextCursor: PayoutRetryCursor | null }> {
		const items = await prisma.payoutAttempt.findMany({
			where: {
				status: { in: ["Pending", "Failed", "Uncertain"] },
				...(after ? { OR: [
					{ createdAt: { gt: after.createdAt } },
					{ createdAt: after.createdAt, id: { gt: after.id } },
				] } : {}),
			},
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			take: 100,
		});
		const last = items.at(-1);
		return {
			items,
			nextCursor: items.length === 100 && last ? { id: last.id, createdAt: last.createdAt } : null,
		};
	},

	async getPayoutBatchCheckpoint(): Promise<PayoutBatchCheckpoint> {
		const checkpoint = await prisma.payoutBatchCheckpoint.findUnique({ where: { id: PAYOUT_BATCH_CHECKPOINT_ID } });
		return checkpoint ?? { opinionCreatedAt: null, caseId: null };
	},

	async advancePayoutBatchCheckpoint(cursor: { opinionCreatedAt: Date; caseId: string }): Promise<void> {
		await prisma.payoutBatchCheckpoint.upsert({
			where: { id: PAYOUT_BATCH_CHECKPOINT_ID },
			create: { id: PAYOUT_BATCH_CHECKPOINT_ID, ...cursor },
			update: cursor,
		});
	},
};
