import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client";
import type { PaymentAttempt, PaymentAttemptInput } from "./domain";
import type { PaymentProvider } from "../../shared/payment-provider";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";

const { createPaymentsService } = await import("./service");
const { paymentsRepository } = await import("./repository");
const { prisma } = await import("../../shared/prisma-client");
const { MockPaymentProvider } = await import("../../shared/payment-provider");

function createFixture(options: {
	failResultPersistence?: boolean;
	failFirstCharge?: boolean;
	throwFirstCharge?: boolean;
	omitTransactionIdFirst?: boolean;
	failRefundPersistence?: boolean;
	failFirstRefund?: boolean;
	throwFirstRefund?: boolean;
} = {}) {
	let attempt: PaymentAttempt | null = null;
	let failResultPersistence = options.failResultPersistence ?? false;
	let failRefundPersistence = options.failRefundPersistence ?? false;
	let failFirstCharge = options.failFirstCharge ?? false;
	let throwFirstCharge = options.throwFirstCharge ?? false;
	let failFirstRefund = options.failFirstRefund ?? false;
	let throwFirstRefund = options.throwFirstRefund ?? false;
	let omitTransactionIdFirst = options.omitTransactionIdFirst ?? false;
	const providerResults = new Map<string, { success: boolean; transactionId?: string; error?: string }>();
	const refundResults = new Map<string, { success: boolean; refundId?: string; error?: string }>();
	const chargeKeys: string[] = [];
	const refundKeys: string[] = [];
	let refundSuccesses = 0;
	const repository = {
		async findAttemptByCaseId(caseId: string) {
			return attempt?.caseId === caseId ? attempt : null;
		},
		async createAttempt(input: PaymentAttemptInput & { idempotencyKey: string }) {
			const now = new Date();
			attempt = {
				...input,
				id: randomUUID(),
				transactionId: null,
				status: "Pending",
				providerError: null,
				refundIdempotencyKey: null,
				refundStatus: null,
				refundTransactionId: null,
				refundProviderError: null,
				createdAt: now,
				updatedAt: now,
			};
			return attempt;
		},
		async renewFailedAttempt(caseId: string, input: PaymentAttemptInput & { idempotencyKey: string }) {
			if (!attempt || attempt.caseId !== caseId || attempt.status !== "Failed") return null;
			attempt = { ...attempt, ...input, status: "Pending", transactionId: null, providerError: null, updatedAt: new Date() };
			return attempt;
		},
		async markFailed(caseId: string, idempotencyKey: string, providerError: string) {
			if (attempt?.caseId === caseId && attempt.idempotencyKey === idempotencyKey) {
				attempt = { ...attempt, status: "Failed", providerError, updatedAt: new Date() };
			}
		},
		async markSucceeded(caseId: string, idempotencyKey: string, transactionId: string) {
			if (failResultPersistence) {
				failResultPersistence = false;
				throw new Error("attempt result persistence failed");
			}
			if (!attempt || attempt.caseId !== caseId || attempt.idempotencyKey !== idempotencyKey) return null;
			attempt = { ...attempt, status: "Succeeded", transactionId, providerError: null, updatedAt: new Date() };
			return attempt;
		},
		async prepareRefund(caseId: string, idempotencyKey: string) {
			if (attempt?.caseId !== caseId || attempt.status !== "Succeeded") return null;
			if (!attempt.refundIdempotencyKey) {
				attempt = { ...attempt, refundIdempotencyKey: idempotencyKey, refundStatus: "Pending", refundProviderError: null };
			}
			return attempt;
		},
		async retryFailedRefund(caseId: string, idempotencyKey: string) {
			if (attempt?.caseId === caseId && attempt.status === "Succeeded" && attempt.refundStatus === "Failed") {
				attempt = {
					...attempt,
					refundIdempotencyKey: idempotencyKey,
					refundStatus: "Pending",
					refundTransactionId: null,
					refundProviderError: null,
				};
			}
			return attempt;
		},
		async markRefundFailed(caseId: string, idempotencyKey: string, status: "Failed" | "Uncertain", providerError: string) {
			if (attempt?.caseId !== caseId || attempt.refundIdempotencyKey !== idempotencyKey || attempt.refundStatus === "Succeeded") return attempt;
			attempt = { ...attempt, refundStatus: status, refundProviderError: providerError, updatedAt: new Date() };
			return attempt;
		},
		async markRefundSucceeded(caseId: string, idempotencyKey: string, refundTransactionId: string | null) {
			if (failRefundPersistence) {
				failRefundPersistence = false;
				throw new Error("refund result persistence failed");
			}
			if (attempt?.caseId !== caseId || attempt.refundIdempotencyKey !== idempotencyKey) return null;
			attempt = { ...attempt, refundStatus: "Succeeded", refundTransactionId, refundProviderError: null, updatedAt: new Date() };
			return attempt;
		},
	};
	const provider: PaymentProvider = {
		async charge(_caseId, _amount, _tier, idempotencyKey) {
			chargeKeys.push(idempotencyKey);
			if (omitTransactionIdFirst) {
				omitTransactionIdFirst = false;
				return { success: true };
			}
			if (throwFirstCharge) {
				throwFirstCharge = false;
				throw new Error("provider connection closed");
			}
			const previous = providerResults.get(idempotencyKey);
			if (previous) return previous;
			if (failFirstCharge) {
				failFirstCharge = false;
				const failed = { success: false, error: "declined" };
				providerResults.set(idempotencyKey, failed);
				return failed;
			}
			const result = { success: true, transactionId: randomUUID() };
			providerResults.set(idempotencyKey, result);
			return result;
		},
		async refund(transactionId, amount, idempotencyKey) {
			refundKeys.push(`${transactionId}:${amount.toFixed(2)}:${idempotencyKey}`);
			assert.equal(attempt?.refundIdempotencyKey, idempotencyKey);
			const previous = refundResults.get(idempotencyKey);
			if (previous) return previous;
			if (throwFirstRefund) {
				throwFirstRefund = false;
				throw new Error("provider timed out");
			}
			if (failFirstRefund) {
				failFirstRefund = false;
				return { success: false, error: "declined" };
			}
			const result = { success: true, refundId: "refund-1" };
			refundResults.set(idempotencyKey, result);
			refundSuccesses += 1;
			return result;
		},
		async payout() { return { success: false }; },
	};
	return {
		service: createPaymentsService(repository, provider),
		get attempt() { return attempt; },
		chargeKeys,
		refundKeys,
		get refundSuccesses() { return refundSuccesses; },
	};
}

async function createCapturedAttempt(fixture: ReturnType<typeof createFixture>, caseId: string) {
	const input: PaymentAttemptInput = {
		caseId,
		patientId: "patient-1",
		urgencyTier: "Urgent",
		chargedAmount: new Prisma.Decimal("2000.75"),
		selectedDoctorId: null,
	};
	const attempt = await fixture.service.prepareAttempt(input);
	const charged = await fixture.service.chargeAttempt(attempt);
	return charged;
}

test("MockPaymentProvider returns the same transaction for a repeated idempotency key", async () => {
	const provider = new MockPaymentProvider();
	const amount = new Prisma.Decimal("1000.00");
	const first = await provider.charge("case-1", amount, "Standard", "stable-key");
	const retry = await provider.charge("case-1", amount, "Standard", "stable-key");
	assert.deepEqual(retry, first);
	assert.ok(first.transactionId);
	const refund = await provider.refund(first.transactionId, amount, "refund-stable-key");
	assert.equal(refund.success, true);
	assert.ok(refund.refundId);
	assert.deepEqual(await provider.refund(first.transactionId, amount, "refund-stable-key"), refund);
});

test("confirmed payment retries a failed local outcome write using the same key and transaction", async () => {
	const fixture = createFixture({ failResultPersistence: true });
	const input: PaymentAttemptInput = {
		caseId: "case-1",
		patientId: "patient-1",
		urgencyTier: "Urgent",
		chargedAmount: new Prisma.Decimal("2000.00"),
		selectedDoctorId: null,
	};
	const pending = await fixture.service.prepareAttempt(input);
	await assert.rejects(fixture.service.chargeAttempt(pending), { code: "PAYMENT_RECOVERY_REQUIRED" });
	assert.equal(fixture.attempt?.status, "Pending");

	const recovered = await fixture.service.prepareAttempt(input);
	assert.equal(recovered.idempotencyKey, pending.idempotencyKey);
	const succeeded = await fixture.service.chargeAttempt(recovered);
	assert.equal(succeeded.status, "Succeeded");
	assert.equal(fixture.attempt?.transactionId, succeeded.transactionId);
	assert.deepEqual(fixture.chargeKeys, [pending.idempotencyKey, pending.idempotencyKey]);
});

test("a definitive decline can be retried with a new key and current fee", async () => {
	const fixture = createFixture({ failFirstCharge: true });
	const first = await fixture.service.prepareAttempt({
		caseId: "case-2",
		patientId: "patient-1",
		urgencyTier: "Standard",
		chargedAmount: new Prisma.Decimal("1000.00"),
		selectedDoctorId: null,
	});
	await assert.rejects(fixture.service.chargeAttempt(first), { code: "PAYMENT_DECLINED" });
	const retry = await fixture.service.prepareAttempt({
		caseId: "case-2",
		patientId: "patient-1",
		urgencyTier: "Urgent",
		chargedAmount: new Prisma.Decimal("2300.50"),
		selectedDoctorId: "doctor-1",
	});
	assert.notEqual(retry.idempotencyKey, first.idempotencyKey);
	assert.equal(retry.chargedAmount.toFixed(2), "2300.50");
	assert.equal((await fixture.service.chargeAttempt(retry)).status, "Succeeded");
});

test("an uncertain provider exception keeps the attempt pending and retries with the same key", async () => {
	const fixture = createFixture({ throwFirstCharge: true });
	const input: PaymentAttemptInput = {
		caseId: "case-uncertain",
		patientId: "patient-1",
		urgencyTier: "Standard",
		chargedAmount: new Prisma.Decimal("1000.00"),
		selectedDoctorId: null,
	};
	const pending = await fixture.service.prepareAttempt(input);
	await assert.rejects(fixture.service.chargeAttempt(pending), { code: "PAYMENT_RECOVERY_REQUIRED" });
	assert.equal(fixture.attempt?.status, "Pending");
	const retried = await fixture.service.prepareAttempt(input);
	assert.equal(retried.idempotencyKey, pending.idempotencyKey);
	assert.equal((await fixture.service.chargeAttempt(retried)).status, "Succeeded");
});

test("a provider success without a transaction ID stays recoverable instead of renewing the charge", async () => {
	const fixture = createFixture({ omitTransactionIdFirst: true });
	const input: PaymentAttemptInput = {
		caseId: "case-missing-transaction",
		patientId: "patient-1",
		urgencyTier: "Standard",
		chargedAmount: new Prisma.Decimal("1000.00"),
		selectedDoctorId: null,
	};
	const pending = await fixture.service.prepareAttempt(input);
	await assert.rejects(fixture.service.chargeAttempt(pending), { code: "PAYMENT_RECOVERY_REQUIRED" });
	assert.equal(fixture.attempt?.status, "Pending");
	const recovered = await fixture.service.prepareAttempt(input);
	assert.equal(recovered.idempotencyKey, pending.idempotencyKey);
	assert.equal((await fixture.service.chargeAttempt(recovered)).status, "Succeeded");
	assert.deepEqual(fixture.chargeKeys, [pending.idempotencyKey, pending.idempotencyKey]);
});

test("refund uses the exact captured transaction and amount with a persisted idempotency key", async () => {
	const fixture = createFixture();
	const captured = await createCapturedAttempt(fixture, "case-refund");
	const refunded = await fixture.service.refundCapturedPayment(captured.caseId);

	assert.equal(refunded.refundStatus, "Succeeded");
	assert.equal(refunded.refundTransactionId, "refund-1");
	assert.ok(refunded.refundIdempotencyKey);
	assert.deepEqual(fixture.refundKeys, [`${captured.transactionId}:2000.75:${refunded.refundIdempotencyKey}`]);
	assert.equal((await fixture.service.refundCapturedPayment(captured.caseId)).refundStatus, "Succeeded");
	assert.equal(fixture.refundKeys.length, 1);
});

test("refund provider decline remains retryable and retries with a new key", async () => {
	const fixture = createFixture({ failFirstRefund: true });
	const captured = await createCapturedAttempt(fixture, "case-refund-decline");
	await assert.rejects(fixture.service.refundCapturedPayment(captured.caseId), { code: "PAYMENT_REFUND_FAILED" });
	const firstKey = fixture.attempt?.refundIdempotencyKey;
	assert.equal(fixture.attempt?.refundStatus, "Failed");
	const refunded = await fixture.service.refundCapturedPayment(captured.caseId);
	assert.equal(refunded.refundStatus, "Succeeded");
	assert.notEqual(fixture.attempt?.refundIdempotencyKey, firstKey);
	assert.equal(fixture.refundKeys.length, 2);
	assert.notEqual(fixture.refundKeys[0]?.split(":").at(-1), fixture.refundKeys[1]?.split(":").at(-1));
});

test("uncertain refund provider outcome retries the same key and amount", async () => {
	const fixture = createFixture({ throwFirstRefund: true });
	const captured = await createCapturedAttempt(fixture, "case-refund-timeout");
	await assert.rejects(fixture.service.refundCapturedPayment(captured.caseId), { code: "PAYMENT_REFUND_RECOVERY_REQUIRED" });
	assert.equal(fixture.attempt?.refundStatus, "Uncertain");
	const key = fixture.attempt?.refundIdempotencyKey;
	const refunded = await fixture.service.refundCapturedPayment(captured.caseId);
	assert.equal(refunded.refundStatus, "Succeeded");
	assert.equal(fixture.attempt?.refundIdempotencyKey, key);
	assert.equal(fixture.refundKeys.length, 2);
	assert.equal(fixture.refundSuccesses, 1);
});

test("confirmed provider refund recovers after local persistence failure without changing the idempotency key", async () => {
	const fixture = createFixture({ failRefundPersistence: true });
	const captured = await createCapturedAttempt(fixture, "case-refund-persistence");
	await assert.rejects(fixture.service.refundCapturedPayment(captured.caseId), { code: "PAYMENT_REFUND_RECOVERY_REQUIRED" });
	const key = fixture.attempt?.refundIdempotencyKey;
	const refunded = await fixture.service.refundCapturedPayment(captured.caseId);
	assert.equal(refunded.refundStatus, "Succeeded");
	assert.equal(fixture.attempt?.refundIdempotencyKey, key);
	assert.equal(fixture.refundKeys.length, 2);
});

test("refund requires a successful captured charge with its original transaction", async () => {
	const fixture = createFixture();
	await assert.rejects(fixture.service.refundCapturedPayment("missing-case"), { code: "PAYMENT_REFUND_UNAVAILABLE" });
});

test("refund repository persists one key only for a successful captured transaction", async () => {
	const delegate = prisma.paymentAttempt as unknown as {
		updateMany: (args: unknown) => Promise<{ count: number }>;
		findUnique: (args: unknown) => Promise<unknown>;
	};
	const originals = { updateMany: delegate.updateMany, findUnique: delegate.findUnique };
	const caseId = "case-refund-repository";
	const idempotencyKey = "durable-refund-key";
	let updateArgs: unknown;
	let findArgs: unknown;
	delegate.updateMany = async (args) => { updateArgs = args; return { count: 1 }; };
	delegate.findUnique = async (args) => {
		findArgs = args;
		return {
			id: "attempt-1",
			caseId,
			patientId: "patient-1",
			urgencyTier: "Urgent",
			chargedAmount: new Prisma.Decimal("2000.75"),
			selectedDoctorId: null,
			idempotencyKey: "charge-key",
			transactionId: "original-transaction",
			status: "Succeeded",
			providerError: null,
			refundIdempotencyKey: idempotencyKey,
			refundStatus: "Pending",
			refundTransactionId: null,
			refundProviderError: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	};
	try {
		const attempt = await paymentsRepository.prepareRefund(caseId, idempotencyKey);
		assert.equal(attempt?.refundIdempotencyKey, idempotencyKey);
		assert.deepEqual(updateArgs, {
			where: { caseId, status: "Succeeded", transactionId: { not: null }, refundIdempotencyKey: null },
			data: { refundIdempotencyKey: idempotencyKey, refundStatus: "Pending", refundProviderError: null },
		});
		assert.deepEqual(findArgs, { where: { caseId } });
	} finally {
		Object.assign(delegate, originals);
	}
});

test("refund repository rotates the idempotency key only after a definitive failure", async () => {
	const delegate = prisma.paymentAttempt as unknown as {
		updateMany: (args: unknown) => Promise<{ count: number }>;
		findUnique: (args: unknown) => Promise<unknown>;
	};
	const originals = { updateMany: delegate.updateMany, findUnique: delegate.findUnique };
	const caseId = "case-refund-retry";
	const idempotencyKey = "replacement-refund-key";
	let updateArgs: unknown;
	delegate.updateMany = async (args) => { updateArgs = args; return { count: 1 }; };
	delegate.findUnique = async () => ({ caseId, refundIdempotencyKey: idempotencyKey, refundStatus: "Pending" });
	try {
		const attempt = await paymentsRepository.retryFailedRefund(caseId, idempotencyKey);
		assert.equal(attempt?.refundIdempotencyKey, idempotencyKey);
		assert.deepEqual(updateArgs, {
			where: { caseId, status: "Succeeded", refundStatus: "Failed" },
			data: {
				refundIdempotencyKey: idempotencyKey,
				refundStatus: "Pending",
				refundTransactionId: null,
				refundProviderError: null,
			},
		});
	} finally {
		Object.assign(delegate, originals);
	}
});