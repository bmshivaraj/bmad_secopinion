import { randomUUID } from "node:crypto";
import { paymentProvider } from "../../shared/payment-provider";
import type { PaymentProvider } from "../../shared/payment-provider";
import { paymentsRepository } from "./repository";
import {
	PaymentAttemptConflictError,
	PaymentDeclinedError,
	PaymentRecoveryRequiredError,
	PaymentRefundFailedError,
	PaymentRefundRecoveryRequiredError,
	PaymentRefundUnavailableError,
} from "./domain";
import type { PaymentAttempt, PaymentAttemptInput } from "./domain";

type PaymentsRepository = Pick<
	typeof paymentsRepository,
	"findAttemptByCaseId" | "createAttempt" | "renewFailedAttempt" | "markFailed" | "markSucceeded"
	| "prepareRefund" | "retryFailedRefund" | "markRefundFailed" | "markRefundSucceeded"
>;

function isUniqueConstraintViolation(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function createPaymentsService(
	repository: PaymentsRepository = paymentsRepository,
	provider: PaymentProvider = paymentProvider,
) {
	return {
		findAttemptByCaseId(caseId: string) {
			return repository.findAttemptByCaseId(caseId);
		},

		async prepareAttempt(input: PaymentAttemptInput) {
			let attempt = await repository.findAttemptByCaseId(input.caseId);
			if (!attempt) {
				try {
					attempt = await repository.createAttempt({ ...input, idempotencyKey: randomUUID() });
				} catch (error) {
					if (!isUniqueConstraintViolation(error)) throw error;
					attempt = await repository.findAttemptByCaseId(input.caseId);
					if (!attempt) throw error;
				}
			}
			if (attempt.patientId !== input.patientId) throw new PaymentAttemptConflictError();
			if (attempt.status === "Failed") {
				const renewed = await repository.renewFailedAttempt(input.caseId, { ...input, idempotencyKey: randomUUID() });
				attempt = renewed ?? await repository.findAttemptByCaseId(input.caseId);
			}
			if (!attempt) throw new PaymentRecoveryRequiredError();
			return attempt;
		},

		async chargeAttempt(attempt: PaymentAttempt) {
			if (attempt.status === "Succeeded") return attempt;
			let result: Awaited<ReturnType<PaymentProvider["charge"]>>;
			try {
				result = await provider.charge(
					attempt.caseId,
					attempt.chargedAmount,
					attempt.urgencyTier,
					attempt.idempotencyKey,
				);
			} catch {
				throw new PaymentRecoveryRequiredError();
			}
			if (!result.success) {
				const message = result.error?.slice(0, 500);
				await repository.markFailed(attempt.caseId, attempt.idempotencyKey, message ?? "Provider declined the payment.");
				throw new PaymentDeclinedError();
			}
			if (!result.transactionId) throw new PaymentRecoveryRequiredError();
			try {
				const saved = await repository.markSucceeded(attempt.caseId, attempt.idempotencyKey, result.transactionId);
				if (!saved || saved.status !== "Succeeded") throw new Error("Payment result was not persisted.");
				return saved;
			} catch {
				throw new PaymentRecoveryRequiredError();
			}
		},

		async refundCapturedPayment(caseId: string) {
			let attempt = await repository.findAttemptByCaseId(caseId);
			if (!attempt || attempt.status !== "Succeeded" || !attempt.transactionId) {
				throw new PaymentRefundUnavailableError();
			}
			if (attempt.refundStatus === "Succeeded") return attempt;
			if (attempt.refundStatus === "Failed") {
				attempt = await repository.retryFailedRefund(caseId, randomUUID());
			}
			if (!attempt) throw new PaymentRefundRecoveryRequiredError();

			if (!attempt.refundIdempotencyKey) {
				attempt = await repository.prepareRefund(caseId, randomUUID());
			}
			if (!attempt?.refundIdempotencyKey || attempt.status !== "Succeeded" || !attempt.transactionId) {
				throw new PaymentRefundRecoveryRequiredError();
			}
			if (attempt.refundStatus === "Succeeded") return attempt;

			let result: Awaited<ReturnType<PaymentProvider["refund"]>>;
			try {
				result = await provider.refund(attempt.transactionId, attempt.chargedAmount, attempt.refundIdempotencyKey);
			} catch (error) {
				const message = error instanceof Error ? error.message : "Refund provider outcome is unknown.";
				const saved = await repository.markRefundFailed(caseId, attempt.refundIdempotencyKey, "Uncertain", message).catch(() => null);
				if (saved?.refundStatus === "Succeeded") return saved;
				throw new PaymentRefundRecoveryRequiredError();
			}

			if (!result.success) {
				const message = result.error?.slice(0, 500) ?? "Provider did not confirm the refund.";
				const saved = await repository.markRefundFailed(caseId, attempt.refundIdempotencyKey, "Failed", message).catch(() => null);
				if (saved?.refundStatus === "Succeeded") return saved;
				throw new PaymentRefundFailedError();
			}

			try {
				const saved = await repository.markRefundSucceeded(caseId, attempt.refundIdempotencyKey, result.refundId ?? null);
				if (!saved || saved.refundStatus !== "Succeeded") throw new Error("Refund result was not persisted.");
				return saved;
			} catch {
				throw new PaymentRefundRecoveryRequiredError();
			}
		},
	};
}

export const paymentsService = createPaymentsService();
