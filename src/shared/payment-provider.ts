import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";

export type PaymentUrgencyTier = "Standard" | "Urgent";

export interface PaymentProvider {
	charge(
		caseId: string,
		amount: Prisma.Decimal,
		urgencyTier: PaymentUrgencyTier,
		idempotencyKey: string,
	): Promise<{ success: boolean; transactionId?: string; error?: string }>;
	refund(transactionId: string, amount: Prisma.Decimal, idempotencyKey: string): Promise<{ success: boolean; refundId?: string; error?: string }>;
	payout(doctorId: string, upiId: string, amount: Prisma.Decimal, idempotencyKey: string): Promise<{ success: boolean; transactionId?: string; error?: string }>;
}

export class MockPaymentProvider implements PaymentProvider {
	private readonly chargeResults = new Map<string, { success: boolean; transactionId: string }>();
	private readonly refundResults = new Map<string, { success: boolean; refundId?: string; error?: string }>();
	private readonly payoutResults = new Map<string, { success: boolean; transactionId?: string; error?: string }>();

	async charge(
		caseId: string,
		amount: Prisma.Decimal,
		urgencyTier: PaymentUrgencyTier,
		idempotencyKey: string,
	): Promise<{ success: boolean; transactionId?: string }> {
		const previous = this.chargeResults.get(idempotencyKey);
		if (previous) return previous;

		const result = { success: true, transactionId: randomUUID() };
		this.chargeResults.set(idempotencyKey, result);
		console.info(`[MockPaymentProvider] charged case=${caseId} amount=${amount.toFixed(2)} tier=${urgencyTier} transaction=${result.transactionId}`);
		return result;
	}

	async refund(transactionId: string, amount: Prisma.Decimal, idempotencyKey: string): Promise<{ success: boolean; refundId?: string; error?: string }> {
		const previous = this.refundResults.get(idempotencyKey);
		if (previous) return previous;
		const result = { success: true, refundId: randomUUID() };
		this.refundResults.set(idempotencyKey, result);
		console.info(`[MockPaymentProvider] refunded transaction=${transactionId} amount=${amount.toFixed(2)} refund=${result.refundId}`);
		return result;
	}

	async payout(doctorId: string, upiId: string, amount: Prisma.Decimal, idempotencyKey: string): Promise<{ success: boolean; transactionId?: string; error?: string }> {
		const previous = this.payoutResults.get(idempotencyKey);
		if (previous) return previous;
		const result = { success: true, transactionId: randomUUID() };
		this.payoutResults.set(idempotencyKey, result);
		console.info(`[MockPaymentProvider] paid doctor=${doctorId} amount=${amount.toFixed(2)} transaction=${result.transactionId}`);
		return result;
	}
}

export const paymentProvider: PaymentProvider = new MockPaymentProvider();