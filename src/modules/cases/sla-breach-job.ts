import { casesService } from "./service";
import { getSafeOperatorErrorType, sendOperatorAlert } from "../../shared/operator-alert";
import type { OperatorAlert, OperatorAlertLogger, OperatorAlertSender } from "../../shared/operator-alert";

const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface SlaBreachScanResult {
	scannedCount: number;
	transitionedCount: number;
	refundCases: { caseId: string; chargedAmount: string }[];
}

interface SlaBreachLogger {
	info(message: string): void;
	error(message: string): void;
}

type SlaBreachScanner = (now: Date) => Promise<SlaBreachScanResult>;
type SlaBreachScheduler = (callback: () => void, delay: number) => { unref?: () => void };

export async function runCaseSlaBreachJob(
	scan: SlaBreachScanner = (now) => casesService.runSlaBreachScan(now),
	logger: SlaBreachLogger = console,
	alertSender: OperatorAlertSender = sendOperatorAlert,
): Promise<SlaBreachScanResult> {
	const startedAt = new Date();
	try {
		const result = await scan(startedAt);
		logger.info(JSON.stringify({
			event: "case_sla_breach_scan",
			outcome: "success",
			startedAt: startedAt.toISOString(),
			scannedCount: result.scannedCount,
			transitionedCount: result.transitionedCount,
		}));
		return result;
	} catch (error) {
		logger.error(JSON.stringify({
			event: "case_sla_breach_scan",
			outcome: "failure",
			startedAt: startedAt.toISOString(),
			errorType: getSafeOperatorErrorType(error),
		}));
		const alert: OperatorAlert = {
			event: "operator_job_failure",
			jobName: "case_sla_breach_scan",
			outcome: "failure",
			startedAt: startedAt.toISOString(),
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
}

type SlaBreachJobGlobal = typeof globalThis & { __secOpinionSlaBreachJobStarted?: boolean };

export function startDailyCaseSlaBreachJob(
	scan: SlaBreachScanner = (now) => casesService.runSlaBreachScan(now),
	logger: SlaBreachLogger = console,
	schedule: SlaBreachScheduler = setInterval,
	alertSender: OperatorAlertSender = sendOperatorAlert,
): void {
	const jobGlobal = globalThis as SlaBreachJobGlobal;
	if (jobGlobal.__secOpinionSlaBreachJobStarted) return;
	jobGlobal.__secOpinionSlaBreachJobStarted = true;

	let isRunning = false;
	const run = async () => {
		if (isRunning) return;
		isRunning = true;
		try {
			await runCaseSlaBreachJob(scan, logger, alertSender);
		} catch {
			// The structured failure log is emitted by runCaseSlaBreachJob.
		} finally {
			isRunning = false;
		}
	};
	void run();
	const timer = schedule(() => void run(), DAILY_INTERVAL_MS);
	timer.unref?.();
}