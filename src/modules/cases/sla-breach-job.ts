import { casesService } from "./service";

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
			error: error instanceof Error ? error.message : "Unknown error",
		}));
		throw error;
	}
}

type SlaBreachJobGlobal = typeof globalThis & { __secOpinionSlaBreachJobStarted?: boolean };

export function startDailyCaseSlaBreachJob(
	scan: SlaBreachScanner = (now) => casesService.runSlaBreachScan(now),
	logger: SlaBreachLogger = console,
	schedule: SlaBreachScheduler = setInterval,
): void {
	const jobGlobal = globalThis as SlaBreachJobGlobal;
	if (jobGlobal.__secOpinionSlaBreachJobStarted) return;
	jobGlobal.__secOpinionSlaBreachJobStarted = true;

	let isRunning = false;
	const run = async () => {
		if (isRunning) return;
		isRunning = true;
		try {
			await runCaseSlaBreachJob(scan, logger);
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