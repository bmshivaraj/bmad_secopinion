import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { PayoutAttempt, PayoutAttemptInput } from "./domain";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";

const { runDailyDoctorPayoutBatch, startDailyDoctorPayoutJob } = await import("./payout-batch-job");

function makeEligible(caseId: string, doctorId: string, chargedAmount: string, platformFeePercent: string) {
	return {
		caseId,
		doctorId,
		chargedAmount,
		platformFeePercent,
		opinionCreatedAt: new Date("2026-10-20T12:00:00.000Z").toISOString(),
	};
}

function createBatchFixture(options: {
	items: ReturnType<typeof makeEligible>[];
	destinations?: Record<string, string | null>;
	failingCaseId?: string;
	prepareErrorCaseId?: string;
}) {
	const attempts = new Map<string, PayoutAttempt>();
	const inputs = new Map<string, PayoutAttemptInput>();
	const providerCalls: string[] = [];
	const logs: string[] = [];
	const errors: string[] = [];
	const destinations = new Map(Object.entries(options.destinations ?? {}));
	let cursorCalls = 0;
	let checkpoint: { caseId: string | null; opinionCreatedAt: Date | null } = { caseId: null, opinionCreatedAt: null };
	const dependencies = {
		cases: {
			async listClosedOpinionsForPayout(after: { caseId: string; opinionCreatedAt: Date } | null) {
				cursorCalls += 1;
				const items = options.items.filter((item) => !after
					|| item.opinionCreatedAt > after.opinionCreatedAt.toISOString()
					|| (item.opinionCreatedAt === after.opinionCreatedAt.toISOString() && item.caseId > after.caseId));
				return { items, nextCursor: null };
			},
		},
		doctors: {
			async getPayoutDestination(doctorId: string) {
				const upiId = destinations.get(doctorId);
				return upiId === undefined ? null : { upiId };
			},
		},
		payments: {
			async listRetryablePayoutAttempts(after: { id: string; createdAt: Date } | null) {
				const retryable = [...attempts.values()]
					.filter((attempt) => attempt.status !== "Succeeded")
					.filter((attempt) => !after || attempt.createdAt > after.createdAt
						|| (attempt.createdAt.getTime() === after.createdAt.getTime() && attempt.id > after.id))
					.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
				const items = retryable.slice(0, 100);
				const last = items.at(-1);
				return { items, nextCursor: items.length === 100 && last ? { id: last.id, createdAt: last.createdAt } : null };
			},
			async getPayoutBatchCheckpoint() {
				return checkpoint;
			},
			async advancePayoutBatchCheckpoint(cursor: { caseId: string; opinionCreatedAt: Date }) {
				checkpoint = cursor;
			},
			async preparePayoutAttempt(input: PayoutAttemptInput) {
				if (input.caseId === options.prepareErrorCaseId) throw new Error("attempt persistence failed");
				inputs.set(input.caseId, input);
				let attempt = attempts.get(input.caseId);
				if (!attempt) {
					const now = new Date();
					attempt = {
						...input,
						id: randomUUID(),
						upiId: null,
						idempotencyKey: randomUUID(),
						transactionId: null,
						status: "Pending",
						providerError: null,
						createdAt: now,
						updatedAt: now,
					};
					attempts.set(input.caseId, attempt);
				}
				return attempt;
			},
			async submitPayout(attempt: PayoutAttempt, upiId: string | null) {
				if (attempt.status === "Succeeded") return attempt;
				if (!upiId) return attempt;
				providerCalls.push(attempt.caseId);
				const updated = {
					...attempt,
					upiId,
					status: "Succeeded" as const,
					transactionId: `transaction-${attempt.caseId}`,
					updatedAt: new Date(),
				};
				attempts.set(attempt.caseId, updated);
				if (attempt.caseId === options.failingCaseId) throw new Error("outcome persistence failed");
				return updated;
			},
		},
	};
	const logger = { info: (message: string) => logs.push(message), error: (message: string) => errors.push(message) };
	return { dependencies, destinations, attempts, inputs, providerCalls, logs, errors, get cursorCalls() { return cursorCalls; }, get checkpoint() { return checkpoint; }, logger };
}

test("batch creates one independent transfer per Case using closure-time fee snapshots", async () => {
	const fixture = createBatchFixture({
		items: [
			makeEligible("case-a", "doctor-1", "1000.00", "20.00"),
			makeEligible("case-b", "doctor-1", "2000.00", "35.00"),
		],
		destinations: { "doctor-1": "asha@okaxis" },
	});

	const result = await runDailyDoctorPayoutBatch(fixture.dependencies, fixture.logger);
	assert.deepEqual(result, {
		eligibleCount: 2,
		succeededCount: 2,
		pendingCount: 0,
		failedCount: 0,
		uncertainCount: 0,
		errorCount: 0,
	});
	assert.equal(fixture.inputs.get("case-a")?.payoutAmount.toFixed(2), "800.00");
	assert.equal(fixture.inputs.get("case-b")?.payoutAmount.toFixed(2), "1300.00");
	assert.equal(fixture.attempts.size, 2);
	assert.deepEqual(fixture.providerCalls, ["case-a", "case-b"]);
	assert.equal(fixture.cursorCalls, 1);
	assert.match(fixture.logs[0] ?? "", /"outcome":"success"/);
	await runDailyDoctorPayoutBatch(fixture.dependencies, fixture.logger);
	assert.equal(fixture.attempts.size, 2);
	assert.deepEqual(fixture.providerCalls, ["case-a", "case-b"]);
});

test("missing UPI remains pending and becomes payable when the destination is later saved", async () => {
	const fixture = createBatchFixture({ items: [makeEligible("case-a", "doctor-1", "1000.00", "20.00")] });
	const alerts: unknown[] = [];
	const sender = async (alert: unknown) => { alerts.push(alert); };
	const firstResult = await runDailyDoctorPayoutBatch(fixture.dependencies, fixture.logger, sender);
	const firstAttempt = fixture.attempts.get("case-a");
	assert.equal(firstResult.pendingCount, 1);
	assert.equal(firstAttempt?.status, "Pending");
	assert.equal(fixture.providerCalls.length, 0);
	assert.equal(alerts.length, 0);

	fixture.destinations.set("doctor-1", "asha@okaxis");
	const retryResult = await runDailyDoctorPayoutBatch(fixture.dependencies, fixture.logger, sender);
	assert.equal(retryResult.succeededCount, 1);
	assert.equal(fixture.attempts.get("case-a")?.id, firstAttempt?.id);
	assert.deepEqual(fixture.providerCalls, ["case-a"]);
	assert.equal(alerts.length, 0);
});

test("a Case-level failure does not stop other transfers and is logged with batch counts", async () => {
	const fixture = createBatchFixture({
		items: [
			makeEligible("case-fails", "doctor-1", "1000.00", "20.00"),
			makeEligible("case-succeeds", "doctor-2", "2000.00", "20.00"),
		],
		destinations: { "doctor-1": "asha@okaxis", "doctor-2": "dev@okaxis" },
		failingCaseId: "case-fails",
	});

	const alerts: unknown[] = [];
	const result = await runDailyDoctorPayoutBatch(fixture.dependencies, fixture.logger, async (alert) => { alerts.push(alert); });
	assert.equal(result.eligibleCount, 2);
	assert.equal(result.errorCount, 1);
	assert.equal(result.succeededCount, 1);
	assert.equal(fixture.attempts.get("case-succeeds")?.status, "Succeeded");
	assert.equal(fixture.errors.length, 1);
	assert.match(fixture.logs[0] ?? "", /"outcome":"partial"/);
	assert.equal(alerts.length, 0);
});

test("a fatal batch failure alerts once with aggregate counts and preserves the original failure", async () => {
	const fixture = createBatchFixture({ items: [] });
	fixture.dependencies.payments.listRetryablePayoutAttempts = async () => {
		throw new Error("batch storage unavailable");
	};
	const alerts: unknown[] = [];
	await assert.rejects(runDailyDoctorPayoutBatch(fixture.dependencies, fixture.logger, async (alert) => {
		alerts.push(alert);
	}), /batch storage unavailable/);
	assert.equal(alerts.length, 1);
	assert.deepEqual(alerts[0], {
		event: "operator_job_failure",
		jobName: "doctor_payout_batch",
		outcome: "failure",
		startedAt: JSON.parse(fixture.errors[0] ?? "{}").startedAt,
		eligibleCount: 0,
		succeededCount: 0,
		pendingCount: 0,
		failedCount: 0,
		uncertainCount: 0,
		errorCount: 0,
		errorType: "Error",
	});
	assert.doesNotMatch(JSON.stringify(alerts), /batch storage unavailable|doctor-|case-/);

	await assert.rejects(runDailyDoctorPayoutBatch(fixture.dependencies, fixture.logger, async () => {
		throw new Error("delivery unavailable");
	}), /batch storage unavailable/);
	assert.equal(JSON.parse(fixture.errors.at(-1) ?? "{}").event, "operator_alert_delivery");
});

test("a Case without a durable attempt does not advance the payout checkpoint past itself", async () => {
	const fixture = createBatchFixture({
		items: [
			makeEligible("case-fails", "doctor-1", "1000.00", "20.00"),
			makeEligible("case-succeeds", "doctor-2", "2000.00", "20.00"),
		],
		destinations: { "doctor-2": "dev@okaxis" },
		prepareErrorCaseId: "case-fails",
	});

	const result = await runDailyDoctorPayoutBatch(fixture.dependencies, fixture.logger);
	assert.equal(result.errorCount, 1);
	assert.equal(result.succeededCount, 1);
	assert.deepEqual(fixture.checkpoint, { caseId: null, opinionCreatedAt: null });
	assert.equal(fixture.attempts.has("case-succeeds"), true);
});

test("payout scheduler runs immediately, registers one daily timer, and prevents overlap", async () => {
	const jobGlobal = globalThis as typeof globalThis & { __secOpinionDoctorPayoutJobStarted?: boolean };
	delete jobGlobal.__secOpinionDoctorPayoutJobStarted;
	const callbacks: (() => void)[] = [];
	const releaseFirstRun: (() => void)[] = [];
	const firstRunGate = new Promise<void>((resolve) => releaseFirstRun.push(resolve));
	let runCalls = 0;
	let activeRuns = 0;
	let maxActiveRuns = 0;
	let scheduleCalls = 0;
	let unrefCalls = 0;
	try {
		startDailyDoctorPayoutJob(async () => {
			runCalls += 1;
			activeRuns += 1;
			maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
			if (runCalls === 1) await firstRunGate;
			activeRuns -= 1;
			return { eligibleCount: 0, succeededCount: 0, pendingCount: 0, failedCount: 0, uncertainCount: 0, errorCount: 0 };
		}, { info() {}, error() {} }, (callback, delay) => {
			scheduleCalls += 1;
			assert.equal(delay, 24 * 60 * 60 * 1000);
			callbacks.push(callback);
			return { unref() { unrefCalls += 1; } };
		});
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(runCalls, 1);
		assert.equal(scheduleCalls, 1);
		assert.equal(unrefCalls, 1);

		callbacks[0]?.();
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(runCalls, 1);
		releaseFirstRun[0]?.();
		await new Promise<void>((resolve) => setImmediate(resolve));
		callbacks[0]?.();
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(runCalls, 2);
		assert.equal(maxActiveRuns, 1);
	} finally {
		releaseFirstRun[0]?.();
		delete jobGlobal.__secOpinionDoctorPayoutJobStarted;
	}
});