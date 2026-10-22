import type { Prisma } from "../../../generated/prisma/client";
import { DomainError } from "../../../shared/api-envelope";
import type { PaymentUrgencyTier } from "../../../shared/payment-provider";

export type PaymentAttemptStatus = "Pending" | "Failed" | "Succeeded";

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
