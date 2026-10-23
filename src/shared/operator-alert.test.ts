import assert from "node:assert/strict";
import test from "node:test";
import { createOperatorAlertSender, sendOperatorAlert } from "./operator-alert";

const alert = {
	event: "operator_job_failure" as const,
	jobName: "doctor_payout_batch" as const,
	outcome: "failure" as const,
	startedAt: "2026-10-23T00:00:00.000Z",
	eligibleCount: 4,
	succeededCount: 2,
	pendingCount: 1,
	failedCount: 1,
	uncertainCount: 0,
	errorCount: 0,
	errorType: "Error",
};

test("operator webhook sends the allow-listed summary with optional authorization and a timeout", async () => {
	const errors: string[] = [];
	let requestUrl: string | URL | Request | undefined;
	let requestInit: RequestInit | undefined;
	const sender = createOperatorAlertSender({
		webhookUrl: "https://alerts.example.test/events",
		authorization: "Bearer test-secret",
		timeoutMs: 1_500,
		logger: { error: (message) => errors.push(message) },
		fetch: async (input, init) => {
			requestUrl = input;
			requestInit = init;
			return new Response(null, { status: 202 });
		},
	});

	await sender(alert);

	assert.equal(requestUrl, "https://alerts.example.test/events");
	assert.equal(requestInit?.method, "POST");
	assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer test-secret");
	assert.deepEqual(JSON.parse(String(requestInit?.body)), alert);
	assert.ok(requestInit?.signal instanceof AbortSignal);
	assert.equal(errors.length, 0);
});

test("operator webhook serializes only allow-listed payload fields", async () => {
	let body = "";
	const sender = createOperatorAlertSender({
		webhookUrl: "https://alerts.example.test/events",
		logger: { error() {} },
		fetch: async (_input, init) => {
			body = String(init?.body);
			return new Response(null, { status: 202 });
		},
	});
	const alertWithExtraField = { ...alert, credential: "private" } as typeof alert;

	await sender(alertWithExtraField);

	assert.deepEqual(JSON.parse(body), alert);
});

test("operator webhook timeout aborts the request and logs a safe delivery failure", async () => {
	const errors: string[] = [];
	const sender = createOperatorAlertSender({
		webhookUrl: "https://alerts.example.test/events",
		timeoutMs: 1,
		logger: { error: (message) => errors.push(message) },
		fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
			const signal = init?.signal;
			if (!signal || signal.aborted) {
				reject(signal?.reason ?? new Error("missing abort signal"));
				return;
			}
			signal.addEventListener("abort", () => reject(signal.reason), { once: true });
		}),
	});

	await sender(alert);

	assert.equal(JSON.parse(errors[0] ?? "{}").errorType, "TimeoutError");
});

test("production sender reads webhook URL and authorization from environment", async () => {
	const originalUrl = process.env.OPERATOR_ALERT_WEBHOOK_URL;
	const originalAuthorization = process.env.OPERATOR_ALERT_AUTHORIZATION;
	const originalFetch = globalThis.fetch;
	let requestUrl: string | URL | Request | undefined;
	let authorization: string | null = null;
	process.env.OPERATOR_ALERT_WEBHOOK_URL = "https://alerts.example.test/configured";
	process.env.OPERATOR_ALERT_AUTHORIZATION = "Bearer configured-secret";
	globalThis.fetch = (async (input, init) => {
		requestUrl = input;
		authorization = new Headers(init?.headers).get("authorization");
		return new Response(null, { status: 202 });
	}) as typeof fetch;
	try {
		await sendOperatorAlert(alert, { error() {} });
		assert.equal(requestUrl, "https://alerts.example.test/configured");
		assert.equal(authorization, "Bearer configured-secret");
	} finally {
		globalThis.fetch = originalFetch;
		if (originalUrl === undefined) delete process.env.OPERATOR_ALERT_WEBHOOK_URL;
		else process.env.OPERATOR_ALERT_WEBHOOK_URL = originalUrl;
		if (originalAuthorization === undefined) delete process.env.OPERATOR_ALERT_AUTHORIZATION;
		else process.env.OPERATOR_ALERT_AUTHORIZATION = originalAuthorization;
	}
});

test("operator webhook delivery errors are logged without propagating or exposing credentials", async () => {
	const errors: string[] = [];
	const networkError = new Error("private-header-token");
	networkError.name = "private-url-token";
	const sender = createOperatorAlertSender({
		webhookUrl: "https://alerts.example.test/events?key=private-url-token",
		authorization: "Bearer private-header-token",
		logger: { error: (message) => errors.push(message) },
		fetch: async () => { throw networkError; },
	});

	await assert.doesNotReject(sender(alert));
	assert.deepEqual(JSON.parse(errors[0] ?? "{}"), {
		event: "operator_alert_delivery",
		outcome: "failure",
		jobName: "doctor_payout_batch",
		errorType: "UnknownError",
	});
	assert.doesNotMatch(errors.join(" "), /private-url-token|private-header-token|network failure/);
});

test("non-success webhook responses are logged without reading the response body", async () => {
	const errors: string[] = [];
	const sender = createOperatorAlertSender({
		webhookUrl: "https://alerts.example.test/events",
		logger: { error: (message) => errors.push(message) },
		fetch: async () => new Response("sensitive response", { status: 503 }),
	});

	await sender(alert);
	assert.deepEqual(JSON.parse(errors[0] ?? "{}"), {
		event: "operator_alert_delivery",
		outcome: "failure",
		jobName: "doctor_payout_batch",
		errorType: "HttpError",
		statusCode: 503,
	});
	assert.doesNotMatch(errors.join(" "), /sensitive response/);
});