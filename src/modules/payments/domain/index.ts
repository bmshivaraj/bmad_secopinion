import type { Prisma } from "../../../generated/prisma/client";
import { DomainError } from "../../../shared/api-envelope";
import type { PaymentUrgencyTier } from "../../../shared/payment-provider";

export type PaymentAttemptStatus = "Pending" | "Failed" | "Succeeded";
export type PaymentRefundStatus = "Pending" | "Failed" | "Uncertain" | "Succeeded";
export type PayoutAttemptStatus = "Pending" | "Failed" | "Uncertain" | "Succeeded";

export interface PaymentAttempt {
	id: string;
	caseId: string;
	patientId: string;
	urgencyTier: PaymentUrgencyTier;
	chargedAmount: Prisma.Decimal;
	selectedDoctorId: string | null;
	idempotencyKey: string;
	transactionId: string | null;
	status: PaymentAttemptStatus;
	providerError: string | null;
	refundIdempotencyKey: string | null;
	refundStatus: PaymentRefundStatus | null;
	refundTransactionId: string | null;
	refundProviderError: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface PaymentAttemptInput {
	caseId: string;
	patientId: string;
	urgencyTier: PaymentUrgencyTier;
	chargedAmount: Prisma.Decimal;
	selectedDoctorId: string | null;
}

export interface PayoutAttempt {
	id: string;
	caseId: string;
	doctorId: string;
	chargedAmount: Prisma.Decimal;
	platformFeePercent: Prisma.Decimal;
	payoutAmount: Prisma.Decimal;
	upiId: string | null;
	idempotencyKey: string;
	transactionId: string | null;
	status: PayoutAttemptStatus;
	providerError: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface PayoutAttemptInput {
	caseId: string;
	doctorId: string;
	chargedAmount: Prisma.Decimal;
	platformFeePercent: Prisma.Decimal;
	payoutAmount: Prisma.Decimal;
}

export interface PayoutBatchCheckpoint {
	opinionCreatedAt: Date | null;
	caseId: string | null;
}

export interface PayoutRetryCursor {
	id: string;
	createdAt: Date;
}

export class PayoutAttemptConflictError extends DomainError {
	readonly code = "PAYOUT_ATTEMPT_CONFLICT";

	constructor() {
		super("A payout attempt already exists for different Case details.");
	}
}

export class PayoutHistoryAccessDeniedError extends DomainError {
	readonly code = "PAYOUT_HISTORY_ACCESS_DENIED";

	constructor() {
		super("A Doctor session is required to access payout history.");
	}
}

export class PaymentAttemptConflictError extends DomainError {
	readonly code = "PAYMENT_ATTEMPT_CONFLICT";

	constructor() {
		super("A payment attempt already exists for another Patient.");
	}
}

export class PaymentDeclinedError extends DomainError {
	readonly code = "PAYMENT_DECLINED";

	constructor(message = "Payment was not completed. Your Case remains a private draft.") {
		super(message);
	}
}

export class PaymentRecoveryRequiredError extends DomainError {
	readonly code = "PAYMENT_RECOVERY_REQUIRED";

	constructor() {
		super("Payment may have succeeded. Retry submission to safely complete your Case.");
	}
}

export class PaymentRefundUnavailableError extends DomainError {
	readonly code = "PAYMENT_REFUND_UNAVAILABLE";

	constructor() {
		super("A confirmed captured payment is required before this Case can be refunded.");
	}
}

export class PaymentRefundFailedError extends DomainError {
	readonly code = "PAYMENT_REFUND_FAILED";

	constructor() {
		super("The refund was not confirmed. The Admin decision remains recoverable; retry to check the same refund attempt.");
	}
}

export class PaymentRefundRecoveryRequiredError extends DomainError {
	readonly code = "PAYMENT_REFUND_RECOVERY_REQUIRED";

	constructor() {
		super("The refund outcome could not be confirmed. Retry to safely recover the same refund attempt.");
	}
}
