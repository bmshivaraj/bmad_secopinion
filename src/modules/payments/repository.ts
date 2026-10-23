// Payments module's own DB access (AD-2) -- no other module may query these tables directly.
import { prisma } from "../../shared/prisma-client";
import type { PaymentAttempt, PaymentAttemptInput } from "./domain";

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
};
