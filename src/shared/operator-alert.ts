export interface OperatorAlertLogger {
	error(message: string): void;
}

interface OperatorAlertBase {
	event: "operator_job_failure";
	outcome: "failure";
	startedAt: string;
	errorType: string;
}

export type OperatorAlert = OperatorAlertBase & (
	| {
		jobName: "case_sla_breach_scan";
		scannedCount?: number;
		transitionedCount?: number;
	}
	| {
		jobName: "doctor_payout_batch";
		eligibleCount?: number;
		succeededCount?: number;
		pendingCount?: number;
		failedCount?: number;
		uncertainCount?: number;
		errorCount?: number;
	}
);

export type OperatorAlertSender = (alert: OperatorAlert, logger: OperatorAlertLogger) => Promise<void>;

const SAFE_ERROR_TYPES = new Set([
	"Error",
	"TypeError",
	"RangeError",
	"SyntaxError",
	"ReferenceError",
	"PrismaClientKnownRequestError",
	"PrismaClientValidationError",
	"AbortError",
	"TimeoutError",
]);

export function getSafeOperatorErrorType(error: unknown): string {
	if (!(error instanceof Error) || !SAFE_ERROR_TYPES.has(error.name)) return "UnknownError";
	return error.name;
}

interface OperatorAlertSenderOptions {
	webhookUrl?: string;
	authorization?: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
	logger?: OperatorAlertLogger;
}

function safeOperatorAlertPayload(alert: OperatorAlert): OperatorAlert {
	const payload: OperatorAlertBase = {
		event: alert.event,
		outcome: alert.outcome,
		startedAt: alert.startedAt,
		errorType: alert.errorType,
	};
	if (alert.jobName === "case_sla_breach_scan") {
		return {
			...payload,
			jobName: alert.jobName,
			...(alert.scannedCount === undefined ? {} : { scannedCount: alert.scannedCount }),
			...(alert.transitionedCount === undefined ? {} : { transitionedCount: alert.transitionedCount }),
		};
	}
	return {
		...payload,
		jobName: alert.jobName,
		...(alert.eligibleCount === undefined ? {} : { eligibleCount: alert.eligibleCount }),
		...(alert.succeededCount === undefined ? {} : { succeededCount: alert.succeededCount }),
		...(alert.pendingCount === undefined ? {} : { pendingCount: alert.pendingCount }),
		...(alert.failedCount === undefined ? {} : { failedCount: alert.failedCount }),
		...(alert.uncertainCount === undefined ? {} : { uncertainCount: alert.uncertainCount }),
		...(alert.errorCount === undefined ? {} : { errorCount: alert.errorCount }),
	};
}

export function createOperatorAlertSender(options: OperatorAlertSenderOptions) {
	const logger = options.logger ?? console;
	const fetcher = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? 5_000;

	return async (alert: OperatorAlert): Promise<void> => {
		if (!options.webhookUrl) {
			logger.error(JSON.stringify({
				event: "operator_alert_delivery",
				outcome: "unavailable",
				jobName: alert.jobName,
			}));
			return;
		}

		try {
			const headers = new Headers({ "content-type": "application/json" });
			if (options.authorization) headers.set("authorization", options.authorization);
			const response = await fetcher(options.webhookUrl, {
				method: "POST",
				headers,
				body: JSON.stringify(safeOperatorAlertPayload(alert)),
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (!response.ok) {
				logger.error(JSON.stringify({
					event: "operator_alert_delivery",
					outcome: "failure",
					jobName: alert.jobName,
					errorType: "HttpError",
					statusCode: response.status,
				}));
			}
		} catch (error) {
			logger.error(JSON.stringify({
				event: "operator_alert_delivery",
				outcome: "failure",
				jobName: alert.jobName,
				errorType: getSafeOperatorErrorType(error),
			}));
		}
	};
}

export const sendOperatorAlert: OperatorAlertSender = async (alert, logger) => {
	const sender = createOperatorAlertSender({
		webhookUrl: process.env.OPERATOR_ALERT_WEBHOOK_URL,
		authorization: process.env.OPERATOR_ALERT_AUTHORIZATION,
		logger,
	});
	await sender(alert);
};