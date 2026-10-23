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
	payout(doctorId: string, upiId: string, amount: Prisma.Decimal): Promise<{ success: boolean; error?: string }>;
}

export class MockPaymentProvider implements PaymentProvider {
	private readonly chargeResults = new Map<string, { success: boolean; transactionId: string }>();
	private readonly refundResults = new Map<string, { success: boolean; refundId?: string; error?: string }>();

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

	async payout(_doctorId: string, _upiId: string, _amount: Prisma.Decimal): Promise<{ success: boolean }> {
		return { success: false };
	}
}

export const paymentProvider: PaymentProvider = new MockPaymentProvider();