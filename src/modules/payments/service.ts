import { randomUUID } from "node:crypto";
import { paymentProvider } from "../../shared/payment-provider";
import type { PaymentProvider } from "../../shared/payment-provider";
import { paymentsRepository } from "./repository";
import { PaymentAttemptConflictError, PaymentDeclinedError, PaymentRecoveryRequiredError } from "./domain";
import type { PaymentAttempt, PaymentAttemptInput } from "./domain";

type PaymentsRepository = Pick<
	typeof paymentsRepository,
	"findAttemptByCaseId" | "createAttempt" | "renewFailedAttempt" | "markFailed" | "markSucceeded"
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
	};
}

export const paymentsService = createPaymentsService();
