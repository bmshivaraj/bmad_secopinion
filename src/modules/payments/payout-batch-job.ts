import { Prisma } from "../../generated/prisma/client";
import { casesService } from "../cases/service";
import { doctorsService } from "../doctors/service";
import { paymentsService, calculateDoctorPayout } from "./service";
import type { PayoutAttempt } from "./domain";
import { getSafeOperatorErrorType, sendOperatorAlert } from "../../shared/operator-alert";
import type { OperatorAlert, OperatorAlertLogger, OperatorAlertSender } from "../../shared/operator-alert";

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

type PayoutCasesService = Pick<typeof casesService, "listClosedOpinionsForPayout">;
type PayoutDoctorsService = Pick<typeof doctorsService, "getPayoutDestination">;
type PayoutPaymentsService = Pick<typeof paymentsService,
	| "preparePayoutAttempt" | "submitPayout" | "listRetryablePayoutAttempts"
	| "getPayoutBatchCheckpoint" | "advancePayoutBatchCheckpoint"
>;

interface PayoutBatchLogger {
	info(message: string): void;
	error(message: string): void;
}

interface PayoutBatchDependencies {
	cases: PayoutCasesService;
	doctors: PayoutDoctorsService;
	payments: PayoutPaymentsService;
}

export interface PayoutBatchResult {
	eligibleCount: number;
	succeededCount: number;
	pendingCount: number;
	failedCount: number;
	uncertainCount: number;
	errorCount: number;
}

function countAttempt(result: PayoutBatchResult, attempt: PayoutAttempt): void {
	if (attempt.status === "Succeeded") result.succeededCount += 1;
	else if (attempt.status === "Failed") result.failedCount += 1;
	else if (attempt.status === "Uncertain") result.uncertainCount += 1;
	else result.pendingCount += 1;
}

export async function runDailyDoctorPayoutBatch(
	dependencies: PayoutBatchDependencies = { cases: casesService, doctors: doctorsService, payments: paymentsService },
	logger: PayoutBatchLogger = console,
	alertSender: OperatorAlertSender = sendOperatorAlert,
): Promise<PayoutBatchResult> {
	const startedAt = new Date();
	const result: PayoutBatchResult = {
		eligibleCount: 0,
		succeededCount: 0,
		pendingCount: 0,
		failedCount: 0,
		uncertainCount: 0,
		errorCount: 0,
	};
	let cursor: { caseId: string; opinionCreatedAt: Date } | null = null;
	const processedCaseIds = new Set<string>();

	const processAttempt = async (attempt: PayoutAttempt) => {
		processedCaseIds.add(attempt.caseId);
		result.eligibleCount += 1;
		try {
			const prepared = await dependencies.payments.preparePayoutAttempt({
				caseId: attempt.caseId,
				doctorId: attempt.doctorId,
				chargedAmount: attempt.chargedAmount,
				platformFeePercent: attempt.platformFeePercent,
				payoutAmount: attempt.payoutAmount,
			});
			const destination = await dependencies.doctors.getPayoutDestination(attempt.doctorId);
			countAttempt(result, await dependencies.payments.submitPayout(prepared, destination?.upiId ?? null));
		} catch (error) {
			result.errorCount += 1;
			logger.error(JSON.stringify({
				event: "doctor_payout_case",
				outcome: "failure",
				caseId: attempt.caseId,
				errorType: error instanceof Error ? error.name : "UnknownError",
			}));
		}
	};

	try {
		let retryCursor: { id: string; createdAt: Date } | null = null;
		while (true) {
			const retryPage = await dependencies.payments.listRetryablePayoutAttempts(retryCursor);
			for (const attempt of retryPage.items) await processAttempt(attempt);
			if (!retryPage.nextCursor) break;
			retryCursor = retryPage.nextCursor;
		}
		const checkpoint = await dependencies.payments.getPayoutBatchCheckpoint();
		if (checkpoint.caseId && checkpoint.opinionCreatedAt) {
			cursor = { caseId: checkpoint.caseId, opinionCreatedAt: checkpoint.opinionCreatedAt };
		}
		let checkpointCanAdvance = true;
		while (true) {
			const page = await dependencies.cases.listClosedOpinionsForPayout(cursor);
			for (const eligible of page.items) {
				const nextCursor = { caseId: eligible.caseId, opinionCreatedAt: new Date(eligible.opinionCreatedAt) };
				if (processedCaseIds.has(eligible.caseId)) {
					if (checkpointCanAdvance) {
						try {
							await dependencies.payments.advancePayoutBatchCheckpoint(nextCursor);
						} catch {
						checkpointCanAdvance = false;
						result.errorCount += 1;
					}
					}
					continue;
				}
				let attempt: PayoutAttempt;
				try {
					const chargedAmount = new Prisma.Decimal(eligible.chargedAmount);
					const platformFeePercent = new Prisma.Decimal(eligible.platformFeePercent);
					const payoutAmount = calculateDoctorPayout(chargedAmount, platformFeePercent);
					attempt = await dependencies.payments.preparePayoutAttempt({
						caseId: eligible.caseId,
						doctorId: eligible.doctorId,
						chargedAmount,
						platformFeePercent,
						payoutAmount,
					});
				} catch (error) {
					result.errorCount += 1;
					checkpointCanAdvance = false;
					logger.error(JSON.stringify({
						event: "doctor_payout_case",
						outcome: "failure",
						caseId: eligible.caseId,
						errorType: error instanceof Error ? error.name : "UnknownError",
					}));
					continue;
				}
				processedCaseIds.add(eligible.caseId);
				if (checkpointCanAdvance) {
					try {
						await dependencies.payments.advancePayoutBatchCheckpoint(nextCursor);
					} catch {
						checkpointCanAdvance = false;
						result.errorCount += 1;
					}
				}
				result.eligibleCount += 1;
				try {
					const destination = await dependencies.doctors.getPayoutDestination(eligible.doctorId);
					countAttempt(result, await dependencies.payments.submitPayout(attempt, destination?.upiId ?? null));
				} catch (error) {
					result.errorCount += 1;
					logger.error(JSON.stringify({
						event: "doctor_payout_case",
						outcome: "failure",
						caseId: eligible.caseId,
						errorType: error instanceof Error ? error.name : "UnknownError",
					}));
				}
			}
			if (!page.nextCursor) break;
			cursor = {
				caseId: page.nextCursor.caseId,
				opinionCreatedAt: new Date(page.nextCursor.opinionCreatedAt),
			};
		}
	} catch (error) {
		logger.error(JSON.stringify({
			event: "doctor_payout_batch",
			outcome: "failure",
			startedAt: startedAt.toISOString(),
			...result,
			errorType: getSafeOperatorErrorType(error),
		}));
		const alert: OperatorAlert = {
			event: "operator_job_failure",
			jobName: "doctor_payout_batch",
			outcome: "failure",
			startedAt: startedAt.toISOString(),
			...result,
			errorType: getSafeOperatorErrorType(error),
		};
		try {
			await alertSender(alert, logger as OperatorAlertLogger);
		} catch (alertError) {
			logger.error(JSON.stringify({
				event: "operator_alert_delivery",
				outcome: "failure",
				jobName: alert.jobName,
				errorType: getSafeOperatorErrorType(alertError),
			}));
		}
		throw error;
	}

	const outcome = result.errorCount > 0 || result.pendingCount > 0 || result.failedCount > 0 || result.uncertainCount > 0
		? "partial"
		: "success";
	logger.info(JSON.stringify({
		event: "doctor_payout_batch",
		outcome,
		startedAt: startedAt.toISOString(),
		...result,
	}));
	return result;
}

type PayoutJobGlobal = typeof globalThis & { __secOpinionDoctorPayoutJobStarted?: boolean };
type PayoutScheduler = (callback: () => void, delay: number) => { unref?: () => void };

export function startDailyDoctorPayoutJob(
	run: () => Promise<PayoutBatchResult> = () => runDailyDoctorPayoutBatch(),
	logger: PayoutBatchLogger = console,
	schedule: PayoutScheduler = setInterval,
): void {
	const jobGlobal = globalThis as PayoutJobGlobal;
	if (jobGlobal.__secOpinionDoctorPayoutJobStarted) return;
	jobGlobal.__secOpinionDoctorPayoutJobStarted = true;

	let isRunning = false;
	const runSafely = async () => {
		if (isRunning) return;
		isRunning = true;
		try {
			await run();
		} catch (error) {
			logger.error(JSON.stringify({
				event: "doctor_payout_job",
				outcome: "failure",
				errorType: error instanceof Error ? error.name : "UnknownError",
			}));
		} finally {
			isRunning = false;
		}
	};
	void runSafely();
	const timer = schedule(() => void runSafely(), DAILY_INTERVAL_MS);
	timer.unref?.();
}
