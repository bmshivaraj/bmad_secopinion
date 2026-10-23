---
title: 'Batch Job Logging & Failure Alerting'
type: 'feature'
created: '2026-10-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['_bmad-output/implementation-artifacts/epic-5-context.md']
baseline_commit: '3cb9469abc7e46f2a4556bd6268ef74c5c881741'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The daily SLA and Doctor payout jobs log structured outcomes but have no operator-alert path, so an outage can go unnoticed while Patients wait for refunds or Doctors wait for payouts.

**Approach:** Add a shared, best-effort failure-alert mechanism for both jobs without changing their domain decisions or blocking future scheduled runs. Preserve structured stdout logs and send concise, safe event summaries to a generic HTTP webhook configured through environment variables; the receiver owns downstream channel formatting.

## Boundaries & Constraints

**Always:** Keep structured logs with job name, outcome, start time, and relevant counts. Alert only on fatal whole-job failures; do not alert on payout partial outcomes, per-Case failures that the batch handles, or expected pending payouts due to missing UPI. Never send Case text, Opinion content, Patient identity, credentials, or payout destination data. A delivery failure must itself be logged and must not change a completed job result, prevent the other job from running, or disable the next daily run. Configure the webhook URL and optional authorization credential through environment variables; never commit or log secrets. Keep the single-process daily scheduling model and existing job idempotency.

**Never:** Put notification credentials in source control or logs; make webhook/email delivery a prerequisite for processing cases or payouts; change Case, refund, or payout eligibility rules; or add a database-backed alert queue unless required by the selected delivery design.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fatal job failure | Either daily job throws before completing its batch | Emit its structured failure log and send one operator alert with safe summary fields | Alert send is bounded; failure is logged and swallowed without stopping future runs |
| Payout partial outcome | Payout batch completes with failed, uncertain, or pending attempts | Keep structured logs/history, but send no operator alert | Do not send case or Doctor private data |
| Alert delivery fails | Configured alert endpoint is unavailable or returns failure | Preserve the original job outcome and keep the scheduler active | Log structured alert-delivery failure without recursive alerting |
| Alert not configured | No delivery endpoint is configured | Continue structured logging and job execution | Log that operator alert delivery is unavailable; do not fabricate delivery success |

</frozen-after-approval>

## Code Map

- `src/modules/cases/sla-breach-job.ts` -- `runCaseSlaBreachJob()` logs success/failure; `startDailyCaseSlaBreachJob()` catches the rejection so the interval survives, but no operator alert is sent.
- `src/modules/payments/payout-batch-job.ts` -- logs success/partial/failure counts and per-Case errors; partial includes pending payouts, including missing UPI, so alert policy must distinguish expected pending from failures if selected.
- `src/instrumentation.ts` -- starts both jobs only in the Node.js runtime; preserve this runtime guard and existing immediate/daily registration.
- `docker-compose.yml` -- currently configures only database/JWT settings and has no alert destination; add documented external alert configuration without committing secrets.
- `src/modules/cases/service.test.ts` and `src/modules/payments/payout-batch-job.test.ts` -- existing scheduler and outcome tests are the base for verifying alerts and recovery.
- `package.json` -- `npm test` runs the Node test suites; add shared alert-provider tests to this command.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/*` -- define a shared alert-delivery contract and the selected configured adapter with timeout, safe payload, and delivery-failure logging.
- [x] `src/modules/cases/sla-breach-job.ts` and `src/modules/payments/payout-batch-job.ts` -- send alerts for the selected outcomes while preserving existing structured logs and scheduler recovery.
- [x] `docker-compose.yml` and deployment configuration docs -- expose the selected channel configuration through environment variables without committing credentials.
- [x] `src/modules/cases/service.test.ts`, `src/modules/payments/payout-batch-job.test.ts`, and shared alert tests -- cover fatal/selected partial outcomes, delivery failures, and no-config behavior.

**Acceptance Criteria:**
- Given either scheduled job has an unhandled failure, when its run ends, then an operator alert is attempted with a safe structured summary and the failure remains logged.
- Given the alert endpoint fails or is not configured, when a job fails, then job outcome handling and the next daily run remain unaffected and no recursive alert is attempted.
- Given a payout batch has a partial outcome, when the selected alert policy applies, then it emits the chosen alert once with counts and no Doctor/Patient private data.
- Given the job completes normally, when its result is recorded, then the existing structured logs and job behavior remain unchanged.

## Implementation Notes

Both scheduled jobs now send a safe, allow-listed JSON alert to the optional environment-configured webhook on fatal whole-job failures only. The sender uses a five-second timeout, logs missing configuration and delivery errors without secrets or response bodies, and never changes the original job result or scheduler behavior. Payout partials and expected missing-UPI pending entries remain log/history-only. `docker-compose.yml` passes the webhook URL and optional authorization header; `docs/operations.md` documents configuration and payload safety.

Verification passed: 184 project tests, `npx tsc --noEmit`, and `npm run build`. Live receiver delivery was mocked in tests; no production webhook is configured. Review fixes enforce a runtime per-job payload allow-list, verify the actual timeout abort and production environment wrapper, and replace raw SLA exception text in logs with a safe error type.

## Spec Change Log

## Review Triage Log

- false (rejected): Blind Hunter said the Code Map contradicted the implementation; that map records the baseline state discovered during planning, while this spec's implementation notes and the current code describe the new alert path.
- medium (patch): Blind Hunter found the sprint tracker still said `in-progress` while this spec was `in-review`; the tracker is now synchronized to `review`.
- false (rejected): Blind Hunter called the partial-outcome acceptance criterion ambiguous; the frozen policy says fatal failures only and the matrix explicitly says partial outcomes do not alert, so the criterion is conditional on that selected policy.
- false (rejected): Blind Hunter found raw SLA exception text in the failure log; the current `sla-breach-job.ts` logs the safe `errorType` only and the regression assertion verifies the message field is absent.
- false (rejected): Blind Hunter found the operations guide omitted the webhook payload contract; `docs/operations.md` already contains concrete SLA and payout JSON examples.
- medium (patch): Blind Hunter and Verification Gap Reviewer found the timeout test checked only for an `AbortSignal`; a new test waits for the abort event and asserts the timeout is logged as a safe delivery failure.
- medium (patch): Edge Case Hunter found structural extra fields could be serialized into the webhook; the sender now constructs an explicit per-job payload allow-list and a regression test verifies extra credentials are stripped.
- medium (patch): Verification Gap Reviewer found the production `sendOperatorAlert` environment wrapper was not tested; a new test verifies it reads the configured URL and authorization credential and forwards them to fetch.

## Design Notes

The two jobs already own their result counts and logger injection points. Alert delivery should observe a completed outcome rather than wrap business processing, so a notification outage cannot retry/refire a payment or refund. Avoid including personal or provider-specific data in the operator payload.

## Verification

**Commands:**
- `npm test` -- expected: all job, alert-adapter, and existing module tests pass.
- `npx tsc --noEmit` -- expected: no TypeScript errors.
- `npm run build` -- expected: both job registrations and alert configuration compile.

**Manual checks:**
- Trigger fatal and selected partial outcomes with a test receiver and verify event name/counts while confirming no private data is included.
- Make alert delivery fail and verify the job result, scheduler registration, and next scheduled run remain intact.