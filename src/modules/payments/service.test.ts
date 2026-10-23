import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma } from "../../generated/prisma/client";
import type { PaymentAttempt, PaymentAttemptInput, PayoutAttempt, PayoutAttemptInput } from "./domain";
import type { PaymentProvider } from "../../shared/payment-provider";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";
process.env.JWT_SECRET ??= "payments-history-test-secret";

const { calculateDoctorPayout, createPaymentsService } = await import("./service");
const { paymentsRepository } = await import("./repository");
const { prisma } = await import("../../shared/prisma-client");
const { MockPaymentProvider } = await import("../../shared/payment-provider");
const { signAuthToken } = await import("../../shared/auth-context");
const { GET: getPayoutHistory } = await import("../../app/api/doctors/profile/payout-history/route");

function createFixture(options: {
	failResultPersistence?: boolean;
	failFirstCharge?: boolean;
	throwFirstCharge?: boolean;
	omitTransactionIdFirst?: boolean;
	failRefundPersistence?: boolean;
	failFirstRefund?: boolean;
	throwFirstRefund?: boolean;
	failPayoutPersistence?: boolean;
	failFirstPayout?: boolean;
	throwFirstPayout?: boolean;
} = {}) {
	let attempt: PaymentAttempt | null = null;
	const payoutAttempts = new Map<string, PayoutAttempt>();
	let failResultPersistence = options.failResultPersistence ?? false;
	let failRefundPersistence = options.failRefundPersistence ?? false;
	let failPayoutPersistence = options.failPayoutPersistence ?? false;
	let failFirstCharge = options.failFirstCharge ?? false;
	let throwFirstCharge = options.throwFirstCharge ?? false;
	let failFirstRefund = options.failFirstRefund ?? false;
	let throwFirstRefund = options.throwFirstRefund ?? false;
	let failFirstPayout = options.failFirstPayout ?? false;
	let throwFirstPayout = options.throwFirstPayout ?? false;
	let omitTransactionIdFirst = options.omitTransactionIdFirst ?? false;
	const providerResults = new Map<string, { success: boolean; transactionId?: string; error?: string }>();
	const refundResults = new Map<string, { success: boolean; refundId?: string; error?: string }>();
	const payoutResults = new Map<string, { success: boolean; transactionId?: string; error?: string }>();
	const chargeKeys: string[] = [];
	const refundKeys: string[] = [];
	const payoutKeys: string[] = [];
	let refundSuccesses = 0;
	let payoutSuccesses = 0;
	let payoutCheckpoint: { opinionCreatedAt: Date | null; caseId: string | null } = { opinionCreatedAt: null, caseId: null };
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
		async findPayoutAttemptByCaseId(caseId: string) {
			return payoutAttempts.get(caseId) ?? null;
		},
		async createPayoutAttempt(input: PayoutAttemptInput & { idempotencyKey: string }) {
			const now = new Date();
			const created: PayoutAttempt = {
				...input,
				id: randomUUID(),
				upiId: null,
				transactionId: null,
				status: "Pending",
				providerError: null,
				createdAt: now,
				updatedAt: now,
			};
			payoutAttempts.set(input.caseId, created);
			return created;
		},
		async retryPayoutAttempt(caseId: string, status: "Failed" | "Uncertain", idempotencyKey: string) {
			const current = payoutAttempts.get(caseId);
			if (!current || current.status !== status) return null;
			const updated = {
				...current,
				idempotencyKey,
				status: "Pending" as const,
				...(status === "Failed" ? { upiId: null } : {}),
				transactionId: null,
				providerError: null,
				updatedAt: new Date(),
			};
			payoutAttempts.set(caseId, updated);
			return updated;
		},
		async setPayoutDestination(caseId: string, idempotencyKey: string, upiId: string) {
			const current = payoutAttempts.get(caseId);
			if (current?.idempotencyKey !== idempotencyKey || current.status !== "Pending" || current.upiId !== null) return current ?? null;
			const updated = { ...current, upiId, updatedAt: new Date() };
			payoutAttempts.set(caseId, updated);
			return updated;
		},
		async markPayoutOutcome(caseId: string, idempotencyKey: string, status: "Failed" | "Uncertain" | "Succeeded", providerError: string | null, transactionId: string | null = null) {
			if (failPayoutPersistence && status === "Succeeded") {
				failPayoutPersistence = false;
				throw new Error("payout result persistence failed");
			}
			const current = payoutAttempts.get(caseId);
			if (!current || current.idempotencyKey !== idempotencyKey || current.status === "Succeeded") return current ?? null;
			const updated = { ...current, status, providerError, transactionId, updatedAt: new Date() };
			payoutAttempts.set(caseId, updated);
			return updated;
		},
		async listPayoutAttemptsByDoctorId(doctorId: string) {
			return [...payoutAttempts.values()].filter((payout) => payout.doctorId === doctorId);
		},
		async listRetryablePayoutAttempts(after: { id: string; createdAt: Date } | null) {
			const retryable = [...payoutAttempts.values()]
				.filter((payout) => payout.status !== "Succeeded")
				.filter((payout) => !after || payout.createdAt > after.createdAt
					|| (payout.createdAt.getTime() === after.createdAt.getTime() && payout.id > after.id))
				.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
			const items = retryable.slice(0, 100);
			const last = items.at(-1);
			return { items, nextCursor: items.length === 100 && last ? { id: last.id, createdAt: last.createdAt } : null };
		},
		async getPayoutBatchCheckpoint() {
			return payoutCheckpoint;
		},
		async advancePayoutBatchCheckpoint(cursor: { opinionCreatedAt: Date; caseId: string }) {
			payoutCheckpoint = cursor;
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
		async payout(_doctorId, _upiId, _amount, idempotencyKey) {
			payoutKeys.push(idempotencyKey);
			if (throwFirstPayout) {
				throwFirstPayout = false;
				payoutResults.set(idempotencyKey, { success: true, transactionId: randomUUID() });
				payoutSuccesses += 1;
				throw new Error("provider timed out after transfer");
			}
			const previous = payoutResults.get(idempotencyKey);
			if (previous) return previous;
			if (failFirstPayout) {
				failFirstPayout = false;
				const failed = { success: false, error: "declined" };
				payoutResults.set(idempotencyKey, failed);
				return failed;
			}
			const paid = { success: true, transactionId: randomUUID() };
			payoutResults.set(idempotencyKey, paid);
			payoutSuccesses += 1;
			return paid;
		},
	};
	return {
		service: createPaymentsService(repository, provider),
		get attempt() { return attempt; },
		chargeKeys,
		refundKeys,
		payoutKeys,
		get payoutAttempts() { return [...payoutAttempts.values()]; },
		get refundSuccesses() { return refundSuccesses; },
		get payoutSuccesses() { return payoutSuccesses; },
	};
}

test("doctor payout calculation uses Decimal arithmetic and rounds INR half up", () => {
	assert.equal(
		calculateDoctorPayout(new Prisma.Decimal("1000.01"), new Prisma.Decimal("33.33")).toFixed(2),
		"666.71",
	);
	assert.throws(() => calculateDoctorPayout(new Prisma.Decimal("1000.00"), new Prisma.Decimal("100.01")), RangeError);
	assert.throws(() => calculateDoctorPayout(new Prisma.Decimal("1000.00"), new Prisma.Decimal("-0.01")), RangeError);
});

test("missing UPI keeps a payout pending and a later destination completes the same Case attempt", async () => {
	const fixture = createFixture();
	const input: PayoutAttemptInput = {
		caseId: "case-payout-upi",
		doctorId: "doctor-1",
		chargedAmount: new Prisma.Decimal("1000.00"),
		platformFeePercent: new Prisma.Decimal("20.00"),
		payoutAmount: new Prisma.Decimal("800.00"),
	};
	const first = await fixture.service.preparePayoutAttempt(input);
	const pending = await fixture.service.submitPayout(first, null);
	assert.equal(pending.status, "Pending");
	assert.equal(pending.upiId, null);
	assert.equal(fixture.payoutKeys.length, 0);

	const retry = await fixture.service.preparePayoutAttempt(input);
	const completed = await fixture.service.submitPayout(retry, "asha@okaxis");
	assert.equal(completed.status, "Succeeded");
	assert.equal(completed.id, first.id);
	assert.equal(completed.idempotencyKey, first.idempotencyKey);
	assert.equal(completed.upiId, "asha@okaxis");
	assert.equal(fixture.payoutSuccesses, 1);
});

test("uncertain payout retries the same idempotency key and does not duplicate a transfer", async () => {
	const fixture = createFixture({ throwFirstPayout: true });
	const input: PayoutAttemptInput = {
		caseId: "case-payout-uncertain",
		doctorId: "doctor-1",
		chargedAmount: new Prisma.Decimal("2000.00"),
		platformFeePercent: new Prisma.Decimal("20.00"),
		payoutAmount: new Prisma.Decimal("1600.00"),
	};
	const first = await fixture.service.preparePayoutAttempt(input);
	const uncertain = await fixture.service.submitPayout(first, "asha@okaxis");
	assert.equal(uncertain.status, "Uncertain");

	const retry = await fixture.service.preparePayoutAttempt(input);
	assert.equal(retry.idempotencyKey, first.idempotencyKey);
	const completed = await fixture.service.submitPayout(retry, "asha@okaxis");
	assert.equal(completed.status, "Succeeded");
	assert.deepEqual(fixture.payoutKeys, [first.idempotencyKey, first.idempotencyKey]);
	assert.equal(fixture.payoutSuccesses, 1);
});

test("payout retries after local success persistence failure with the same provider key", async () => {
	const fixture = createFixture({ failPayoutPersistence: true });
	const input: PayoutAttemptInput = {
		caseId: "case-payout-persistence",
		doctorId: "doctor-1",
		chargedAmount: new Prisma.Decimal("1000.00"),
		platformFeePercent: new Prisma.Decimal("20.00"),
		payoutAmount: new Prisma.Decimal("800.00"),
	};
	const first = await fixture.service.preparePayoutAttempt(input);
	await assert.rejects(fixture.service.submitPayout(first, "asha@okaxis"), /payout result persistence failed/);
	assert.equal(fixture.payoutAttempts[0]?.status, "Pending");

	const retry = await fixture.service.preparePayoutAttempt(input);
	assert.equal(retry.idempotencyKey, first.idempotencyKey);
	const completed = await fixture.service.submitPayout(retry, "asha@okaxis");
	assert.equal(completed.status, "Succeeded");
	assert.deepEqual(fixture.payoutKeys, [first.idempotencyKey, first.idempotencyKey]);
	assert.equal(fixture.payoutSuccesses, 1);
});

test("definitive payout failure is visible and retry uses a new idempotency key", async () => {
	const fixture = createFixture({ failFirstPayout: true });
	const input: PayoutAttemptInput = {
		caseId: "case-payout-failed",
		doctorId: "doctor-1",
		chargedAmount: new Prisma.Decimal("1000.00"),
		platformFeePercent: new Prisma.Decimal("20.00"),
		payoutAmount: new Prisma.Decimal("800.00"),
	};
	const first = await fixture.service.preparePayoutAttempt(input);
	const failed = await fixture.service.submitPayout(first, "asha@okaxis");
	assert.equal(failed.status, "Failed");

	const retry = await fixture.service.preparePayoutAttempt(input);
	assert.notEqual(retry.idempotencyKey, first.idempotencyKey);
	const completed = await fixture.service.submitPayout(retry, "asha.new@okaxis");
	assert.equal(completed.status, "Succeeded");
	assert.equal(completed.upiId, "asha.new@okaxis");
	assert.equal(fixture.payoutKeys.length, 2);
});

test("Doctor payout history is owner-scoped and includes pending attempts", async () => {
	const fixture = createFixture();
	const input: PayoutAttemptInput = {
		caseId: "case-payout-history",
		doctorId: "doctor-1",
		chargedAmount: new Prisma.Decimal("1000.00"),
		platformFeePercent: new Prisma.Decimal("20.00"),
		payoutAmount: new Prisma.Decimal("800.00"),
	};
	await fixture.service.preparePayoutAttempt(input);
	await fixture.service.preparePayoutAttempt({ ...input, caseId: "case-payout-other", doctorId: "doctor-2" });
	const history = await fixture.service.listOwnPayoutHistory({ userId: "doctor-1", role: "doctor" });
	assert.deepEqual(history.map(({ caseId, amount, status }) => ({ caseId, amount, status })), [
		{ caseId: "case-payout-history", amount: "800.00", status: "Pending" },
	]);
	await assert.rejects(
		fixture.service.listOwnPayoutHistory({ userId: "patient-1", role: "patient" }),
		{ code: "PAYOUT_HISTORY_ACCESS_DENIED" },
	);
});

test("payout history API derives its owner from the signed Doctor session", async () => {
	const originalList = paymentsRepository.listPayoutAttemptsByDoctorId;
	const doctorId = randomUUID();
	const requestedDoctorIds: string[] = [];
	const now = new Date("2026-10-23T10:00:00.000Z");
	const attempt: PayoutAttempt = {
		id: randomUUID(),
		caseId: "case-owned",
		doctorId,
		chargedAmount: new Prisma.Decimal("1000.00"),
		platformFeePercent: new Prisma.Decimal("20.00"),
		payoutAmount: new Prisma.Decimal("800.00"),
		upiId: null,
		idempotencyKey: "private-key",
		transactionId: null,
		status: "Pending",
		providerError: "private provider detail",
		createdAt: now,
		updatedAt: now,
	};
	paymentsRepository.listPayoutAttemptsByDoctorId = async (id) => {
		requestedDoctorIds.push(id);
		return id === doctorId ? [attempt] : [];
	};

	try {
		const token = signAuthToken({ userId: doctorId, role: "doctor" });
		const response = await getPayoutHistory(new Request(
			"http://localhost/api/doctors/profile/payout-history?doctorId=other-doctor",
			{ headers: { cookie: `doctor_session=${token}` } },
		));
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "private, no-store");
		assert.deepEqual(requestedDoctorIds, [doctorId]);
		assert.deepEqual(await response.json(), {
			data: [{
				caseId: "case-owned",
				amount: "800.00",
				status: "Pending",
				transactionId: null,
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
			}],
			error: null,
		});

		const patientToken = signAuthToken({ userId: randomUUID(), role: "patient" });
		const forbidden = await getPayoutHistory(new Request("http://localhost/api/doctors/profile/payout-history", {
			headers: { cookie: `doctor_session=${patientToken}` },
		}));
		assert.equal(forbidden.status, 403);
	} finally {
		paymentsRepository.listPayoutAttemptsByDoctorId = originalList;
	}
});

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
	const payout = await provider.payout("doctor-1", "asha@okaxis", amount, "payout-stable-key");
	assert.equal(payout.success, true);
	assert.deepEqual(await provider.payout("doctor-1", "asha@okaxis", amount, "payout-stable-key"), payout);
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

test("payout repository retries definitive failures with a new key and uncertain outcomes with the same key", async () => {
	const delegate = prisma.payoutAttempt as unknown as {
		updateMany: (args: unknown) => Promise<{ count: number }>;
		findUnique: (args: unknown) => Promise<unknown>;
	};
	const originals = { updateMany: delegate.updateMany, findUnique: delegate.findUnique };
	const caseId = "case-payout-retry";
	let updateArgs: unknown;
	delegate.updateMany = async (args) => { updateArgs = args; return { count: 1 }; };
	delegate.findUnique = async () => ({ caseId });
	try {
		await paymentsRepository.retryPayoutAttempt(caseId, "Failed", "new-payout-key");
		assert.deepEqual(updateArgs, {
			where: { caseId, status: "Failed" },
			data: {
				idempotencyKey: "new-payout-key",
				status: "Pending",
				transactionId: null,
				providerError: null,
				upiId: null,
			},
		});
		await paymentsRepository.retryPayoutAttempt(caseId, "Uncertain", "same-payout-key");
		assert.deepEqual(updateArgs, {
			where: { caseId, status: "Uncertain" },
			data: {
				idempotencyKey: "same-payout-key",
				status: "Pending",
				transactionId: null,
				providerError: null,
			},
		});
	} finally {
		Object.assign(delegate, originals);
	}
});

test("payout repository lists unresolved attempts and advances the durable Opinion cursor", async () => {
	const payoutDelegate = prisma.payoutAttempt as unknown as {
		findMany: (args: unknown) => Promise<unknown[]>;
	};
	const checkpointDelegate = prisma.payoutBatchCheckpoint as unknown as {
		findUnique: (args: unknown) => Promise<unknown>;
		upsert: (args: unknown) => Promise<unknown>;
	};
	const originals = {
		findMany: payoutDelegate.findMany,
		findUnique: checkpointDelegate.findUnique,
		upsert: checkpointDelegate.upsert,
	};
	let payoutQuery: unknown;
	let checkpointRead: unknown;
	let checkpointWrite: unknown;
	payoutDelegate.findMany = async (args) => { payoutQuery = args; return []; };
	checkpointDelegate.findUnique = async (args) => { checkpointRead = args; return null; };
	checkpointDelegate.upsert = async (args) => { checkpointWrite = args; return args; };
	try {
		assert.deepEqual(await paymentsRepository.listRetryablePayoutAttempts(null), { items: [], nextCursor: null });
		assert.deepEqual(payoutQuery, {
			where: { status: { in: ["Pending", "Failed", "Uncertain"] } },
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			take: 100,
		});
		assert.deepEqual(await paymentsRepository.getPayoutBatchCheckpoint(), { opinionCreatedAt: null, caseId: null });
		assert.deepEqual(checkpointRead, { where: { id: "daily-doctor-payout" } });
		const cursor = { opinionCreatedAt: new Date("2026-10-23T12:00:00.000Z"), caseId: "case-cursor" };
		await paymentsRepository.advancePayoutBatchCheckpoint(cursor);
		assert.deepEqual(checkpointWrite, {
			where: { id: "daily-doctor-payout" },
			create: { id: "daily-doctor-payout", ...cursor },
			update: cursor,
		});
	} finally {
		payoutDelegate.findMany = originals.findMany;
		checkpointDelegate.findUnique = originals.findUnique;
		checkpointDelegate.upsert = originals.upsert;
	}
});