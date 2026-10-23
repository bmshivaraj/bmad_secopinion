import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import type { AuthContext } from "../../shared/auth-context";
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
	PayoutAttemptConflictError,
	PayoutHistoryAccessDeniedError,
} from "./domain";
import type { PaymentAttempt, PaymentAttemptInput, PayoutAttempt, PayoutAttemptInput, PayoutRetryCursor } from "./domain";

type PaymentsRepository = Pick<
	typeof paymentsRepository,
	"findAttemptByCaseId" | "createAttempt" | "renewFailedAttempt" | "markFailed" | "markSucceeded"
	| "prepareRefund" | "retryFailedRefund" | "markRefundFailed" | "markRefundSucceeded"
	| "findPayoutAttemptByCaseId" | "createPayoutAttempt" | "retryPayoutAttempt" | "setPayoutDestination"
	| "markPayoutOutcome" | "listPayoutAttemptsByDoctorId" | "listRetryablePayoutAttempts"
	| "getPayoutBatchCheckpoint" | "advancePayoutBatchCheckpoint"
>;

function isUniqueConstraintViolation(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function payoutInputMatches(attempt: PayoutAttempt, input: PayoutAttemptInput): boolean {
	return attempt.doctorId === input.doctorId
		&& attempt.chargedAmount.equals(input.chargedAmount)
		&& attempt.platformFeePercent.equals(input.platformFeePercent)
		&& attempt.payoutAmount.equals(input.payoutAmount);
}

export function calculateDoctorPayout(chargedAmount: Prisma.Decimal, platformFeePercent: Prisma.Decimal): Prisma.Decimal {
	if (platformFeePercent.lt(0) || platformFeePercent.gt(100)) {
		throw new RangeError("Platform fee percentage must be between 0 and 100.");
	}
	return chargedAmount
		.mul(new Prisma.Decimal(100).minus(platformFeePercent))
		.div(100)
		.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
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

		async preparePayoutAttempt(input: PayoutAttemptInput): Promise<PayoutAttempt> {
			let attempt = await repository.findPayoutAttemptByCaseId(input.caseId);
			if (!attempt) {
				try {
					attempt = await repository.createPayoutAttempt({ ...input, idempotencyKey: randomUUID() });
				} catch (error) {
					if (!isUniqueConstraintViolation(error)) throw error;
					attempt = await repository.findPayoutAttemptByCaseId(input.caseId);
					if (!attempt) throw error;
				}
			}
			if (!payoutInputMatches(attempt, input)) throw new PayoutAttemptConflictError();
			if (attempt.status === "Failed" || attempt.status === "Uncertain") {
				const retryKey = attempt.status === "Failed" ? randomUUID() : attempt.idempotencyKey;
				attempt = await repository.retryPayoutAttempt(input.caseId, attempt.status, retryKey)
					?? await repository.findPayoutAttemptByCaseId(input.caseId);
			}
			if (!attempt) throw new PaymentRecoveryRequiredError();
			return attempt;
		},

		async submitPayout(attempt: PayoutAttempt, currentUpiId: string | null): Promise<PayoutAttempt> {
			if (attempt.status === "Succeeded") return attempt;
			if (!attempt.upiId && (typeof currentUpiId !== "string" || !currentUpiId.trim())) return attempt;
			let prepared = attempt;
			if (!prepared.upiId) {
				prepared = await repository.setPayoutDestination(
					attempt.caseId,
					attempt.idempotencyKey,
					currentUpiId!.trim(),
				) ?? await repository.findPayoutAttemptByCaseId(attempt.caseId) as PayoutAttempt;
			}
			if (prepared.status !== "Pending") return prepared;
			if (!prepared.upiId) return prepared;

			let result: Awaited<ReturnType<PaymentProvider["payout"]>>;
			try {
				result = await provider.payout(
					prepared.doctorId,
					prepared.upiId,
					prepared.payoutAmount,
					prepared.idempotencyKey,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : "Payout provider outcome is unknown.";
				return await repository.markPayoutOutcome(
					prepared.caseId,
					prepared.idempotencyKey,
					"Uncertain",
					message,
				) ?? await repository.findPayoutAttemptByCaseId(prepared.caseId) as PayoutAttempt;
			}

			if (!result.success) {
				return await repository.markPayoutOutcome(
					prepared.caseId,
					prepared.idempotencyKey,
					"Failed",
					result.error ?? "Provider did not confirm the payout.",
				) ?? await repository.findPayoutAttemptByCaseId(prepared.caseId) as PayoutAttempt;
			}
			if (!result.transactionId) {
				return await repository.markPayoutOutcome(
					prepared.caseId,
					prepared.idempotencyKey,
					"Uncertain",
					"Provider did not return a transaction identifier.",
				) ?? await repository.findPayoutAttemptByCaseId(prepared.caseId) as PayoutAttempt;
			}
			return await repository.markPayoutOutcome(
				prepared.caseId,
				prepared.idempotencyKey,
				"Succeeded",
				null,
				result.transactionId,
			) ?? await repository.findPayoutAttemptByCaseId(prepared.caseId) as PayoutAttempt;
		},

		async listOwnPayoutHistory(caller: AuthContext) {
			if (caller.role !== "doctor") throw new PayoutHistoryAccessDeniedError();
			const attempts = await repository.listPayoutAttemptsByDoctorId(caller.userId);
			return attempts.map((attempt) => ({
				caseId: attempt.caseId,
				amount: attempt.payoutAmount.toFixed(2),
				status: attempt.status,
				transactionId: attempt.transactionId,
				createdAt: attempt.createdAt.toISOString(),
				updatedAt: attempt.updatedAt.toISOString(),
			}));
		},

		listRetryablePayoutAttempts(after: PayoutRetryCursor | null) {
			return repository.listRetryablePayoutAttempts(after);
		},

		getPayoutBatchCheckpoint() {
			return repository.getPayoutBatchCheckpoint();
		},

		advancePayoutBatchCheckpoint(cursor: { opinionCreatedAt: Date; caseId: string }) {
			return repository.advancePayoutBatchCheckpoint(cursor);
		},
	};
}

export const paymentsService = createPaymentsService();
