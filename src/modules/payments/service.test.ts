import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client";
import type { PaymentAttempt, PaymentAttemptInput } from "./domain";
import type { PaymentProvider } from "../../shared/payment-provider";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";

const { createPaymentsService } = await import("./service");
const { MockPaymentProvider } = await import("../../shared/payment-provider");

function createFixture(options: { failResultPersistence?: boolean; failFirstCharge?: boolean; throwFirstCharge?: boolean; omitTransactionIdFirst?: boolean } = {}) {
	let attempt: PaymentAttempt | null = null;
	let failResultPersistence = options.failResultPersistence ?? false;
	let failFirstCharge = options.failFirstCharge ?? false;
	let throwFirstCharge = options.throwFirstCharge ?? false;
	let omitTransactionIdFirst = options.omitTransactionIdFirst ?? false;
	const providerResults = new Map<string, { success: boolean; transactionId?: string; error?: string }>();
	const chargeKeys: string[] = [];
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
		async refund() { return { success: false }; },
		async payout() { return { success: false }; },
	};
	return {
		service: createPaymentsService(repository, provider),
		get attempt() { return attempt; },
		chargeKeys,
	};
}

test("MockPaymentProvider returns the same transaction for a repeated idempotency key", async () => {
	const provider = new MockPaymentProvider();
	const amount = new Prisma.Decimal("1000.00");
	const first = await provider.charge("case-1", amount, "Standard", "stable-key");
	const retry = await provider.charge("case-1", amount, "Standard", "stable-key");
	assert.deepEqual(retry, first);
	assert.ok(first.transactionId);
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