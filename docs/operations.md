# Operations

## Batch Job Failure Alerts

The daily SLA-breach and Doctor payout jobs send fatal whole-job failures to an optional HTTP webhook. Set `OPERATOR_ALERT_WEBHOOK_URL` to the receiver endpoint and, when required, set `OPERATOR_ALERT_AUTHORIZATION` to its authorization header value. Docker Compose passes both variables to the app container; Compose reads them from the shell or the local `.env` file.

The request is a JSON `POST` with a five-second timeout. Its allow-listed fields are the job name, failure outcome, start time, error type, and available aggregate counts. It does not include Case text, Opinion content, Patient or Doctor identity, payout destinations, credentials, or provider response bodies. Payout partial outcomes, including expected pending payouts, do not trigger alerts.

Example SLA-breach failure payload:

```json
{"event":"operator_job_failure","jobName":"case_sla_breach_scan","outcome":"failure","startedAt":"2026-10-23T12:00:00.000Z","errorType":"PrismaClientKnownRequestError","scannedCount":0,"transitionedCount":0}
```

Example payout failure payload:

```json
{"event":"operator_job_failure","jobName":"doctor_payout_batch","outcome":"failure","startedAt":"2026-10-23T12:00:00.000Z","errorType":"PrismaClientKnownRequestError","eligibleCount":0,"succeededCount":0,"pendingCount":0,"failedCount":0,"uncertainCount":0,"errorCount":0}
```

If the URL is unset, alert delivery is logged as unavailable. HTTP errors and timeouts are logged and swallowed; they do not change job results or prevent the next scheduled run. Never put webhook credentials in source control or logs.