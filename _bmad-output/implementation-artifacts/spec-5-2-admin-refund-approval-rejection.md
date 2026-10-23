---
title: 'Admin Refund Approval/Rejection'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['_bmad-output/implementation-artifacts/epic-5-context.md']
baseline_commit: '84e03efc0492eb1c7a56ca098842bd4f54cd472c'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Case in RefundPending needs an Admin decision to either return the amount charged or resume Doctor review; without this resolution the Patient remains blocked indefinitely.

**Approach:** Add a private Admin approve/reject workflow. Approval returns the full captured charge through Payments and closes the Case only after confirmed success; rejection returns the Case to UnderReview with a fresh 120-hour SLA cycle. After confirmed approval, show an in-app notice on the Patient Cases page when the Patient next visits or refreshes; do not send email/SMS.

## Boundaries & Constraints

**Always:** Only an Admin may decide a RefundPending Case; concurrent or repeated decisions must not both take effect. Refund exactly the amount captured at submission to the original payment transaction, using currency-safe values and a durable idempotency/recovery path. Keep provider calls and refund-attempt data in Payments, and Case status and SLA reset logic in Cases. Do not mark a Case Refunded/Closed until the provider confirms the refund. Rejection must set UnderReview with a new 120-hour SLA anchor and clear prior pause intervals; repeated breach/decision cycles remain allowed. After confirmed approval, show the Patient an in-app notice on the Patient Cases page at their next visit or refresh.

**Never:** Refund a different amount or transaction, calculate a Doctor payout for a refunded Case, let Admin routes access module repositories directly, or permit Patient/Doctor operations while a Case is RefundPending. Do not add email/SMS delivery or an external notification-provider integration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Approve | Admin; RefundPending Case with a successful captured PaymentAttempt | Refund full captured amount to its original transaction; transition Case through Refunded to Closed; notify Patient | Provider failure leaves a safe, recoverable decision; do not report completion |
| Reject | Admin; RefundPending Case after Patient chooses to keep waiting | Return Case to UnderReview with a fresh full SLA cycle; do not call refund provider | A competing decision or changed Case state returns a conflict |
| Concurrent decisions | Two Admin requests attempt approve/reject | At most one decision takes effect; no refund follows a winning rejection | Losing request reports conflict; retry must not duplicate a refund |
| Repeated cycle | Rejected Case later breaches SLA again | Case can re-enter RefundPending and receive another Admin decision | No v1 cycle cap |

</frozen-after-approval>

## Code Map

- `src/modules/cases/domain/case-state-machine.ts` -- formal graph already permits RefundPending to UnderReview or Refunded and Refunded to Closed; preserve it as the transition source.
- `src/modules/cases/repository.ts` and `src/modules/cases/service.ts` -- Cases owns status writes, Admin authorization, Patient Case projection, and SLA fields; reset the SLA anchor and pause history on rejection here.
- `src/modules/cases/routes/index.ts` and `src/app/api/admin/cases/refunds/route.ts` -- reuse private Admin context and `{ data, error }` conventions; add decision endpoint(s) without repository access in routes.
- `src/app/admin/page.tsx` -- the RefundPending worklist already shows captured amount; add approve/reject actions and pending, conflict, and provider-failure states.
- `src/app/cases/page.tsx` and `src/modules/cases/service.ts` -- existing Patient Case list displays Case status; extend it only as needed for the approved notification choice.
- `src/modules/payments/domain/index.ts`, `service.ts`, `repository.ts`, and `src/shared/payment-provider.ts` -- own the captured transaction and provider call; current refund contract lacks idempotency and the MockPaymentProvider returns failure, so build on charge recovery semantics.
- `prisma/schema.prisma` and `prisma/migrations/` -- persist any refund attempt/idempotency state needed to make provider outcomes recoverable across retries and restarts.
- `src/modules/cases/service.test.ts`, `routes.test.ts`, and `src/modules/payments/service.test.ts` -- cover decision authorization/races, SLA reset, exact refund amount/transaction, idempotent retry, and provider failure.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/payments/*`, `src/shared/payment-provider.ts`, and Prisma schema/migration -- implement a Payments-owned refund operation using the captured successful charge, durable idempotency, and recoverable provider outcomes.
- [x] `src/modules/cases/domain/case-state-machine.ts`, `repository.ts`, and `service.ts` -- add conditional Admin decisions; finalize approval only after refund success, and reset the SLA anchor/pause history on rejection.
- [x] `src/modules/cases/routes/index.ts` and `src/app/api/admin/cases/refunds/route.ts` -- expose private Admin decision actions with typed conflict/failure responses.
- [x] `src/app/admin/page.tsx` and the Patient Cases projection/UI -- provide the decision controls and the Patient notification chosen at approval.
- [x] Cases/Payments tests -- cover exact captured amount and transaction, authorization, concurrent/repeated decisions, uncertain provider outcomes, and recurring SLA cycles.

**Acceptance Criteria:**
- Given a RefundPending Case with a confirmed captured payment, when an Admin approves, then the original payment receives one full-amount refund and the Case closes only after provider confirmation.
- Given an approval whose provider outcome fails or is uncertain, when the Admin retries, then the operation recovers safely without a duplicate refund or a false closed status.
- Given a RefundPending Case, when an Admin rejects it after the Patient chooses to keep waiting, then the Case returns to UnderReview with a fresh 120-hour SLA window and no refund is issued.
- Given concurrent Admin approve/reject requests, when both contend, then only one decision wins and no losing decision causes an external refund.
- Given a confirmed refund, when the Patient returns to the application, then they receive the notification selected above.

## Implementation Notes

Implemented a durable PaymentAttempt refund key/status and retry path that always uses the captured transaction and amount. Cases claims Admin decisions conditionally, returns rejected Cases to UnderReview with a reset SLA anchor/pause history, and closes approved Cases only after confirmed refund success. The Admin can retry failed/uncertain approvals; the Patient Cases page shows the confirmed refund amount and date on the next visit/refresh. `MockPaymentProvider` now simulates successful idempotent refunds so the current local provider configuration can exercise the complete flow; this is not a real payment-gateway integration.

Verification passed: 160 project tests, `npx tsc --noEmit`, `npx prisma validate`, and `npm run build`. `npx prisma migrate status` remains blocked by PostgreSQL `P1000`, so the migration and database-backed decision concurrency are not verified against a live database. The review pass added recovery for definitive provider failures, rotates their retry key while preserving the key for uncertain outcomes, bounds decision payloads, and covers failed Case finalization recovery.

## Spec Change Log

## Review Triage Log

- false (rejected): Blind Hunter reported that the mock refund could be mistaken for a real money movement; the application already uses `MockPaymentProvider` for successful charges, and this workflow records the configured provider's result rather than claiming an independent live-gateway integration.
- false (rejected): Blind Hunter reported that rejection does not persist Patient consent; Epic 5 explicitly places the phone contact out-of-band, and the Admin's reject action is the decision after that contact rather than a separate Patient-authenticated workflow.
- maybe-false (defer; medium unverified): Blind Hunter noted that refund decisions retain no Admin actor or dedicated decision time, and repeated rejection cycles overwrite the SLA anchor; compliance/audit requirements are not specified, so retention and attribution policy must determine whether a decision-history record is needed.
- medium (patch): Blind Hunter found a definitive provider failure or missing captured PaymentAttempt could leave the Case `Approving`, preventing rejection; definitive `Failed` and unavailable outcomes now release the conditional claim while uncertain outcomes keep it locked for safe retry.
- medium (patch): Blind Hunter found retries reused the same idempotency key after a definitive decline that a provider may cache; Payments now rotates the persisted key only after `Failed`, while `Uncertain` outcomes retain the original key.
- low (patch): Blind Hunter found `CaseRefundRecoveryRequiredError` claimed the refund had succeeded when the payment service returned an unexpected non-success state; Cases now uses the Payments recovery error whose message accurately says the outcome is unconfirmed.
- false (rejected): Blind Hunter noted that the Patient refund notice remains visible on later visits; the approved behavior requires an in-app notice on visit/refresh and does not require one-time acknowledgement, so the persistent receipt remains consistent.
- medium (defer): Blind Hunter found mocked repository/service races do not verify PostgreSQL migration or conditional-write behavior; the configured database rejects credentials with `P1000`, so apply the migration and test competing decisions in a working PostgreSQL environment.
- false (rejected): Blind Hunter noted the implementation task was checked despite the failed migration-status command; the task is to implement and include the migration, which exists and validates, while live application is separately disclosed as blocked by `P1000`.
- medium (patch): Edge Case Hunter independently found that a missing successful captured PaymentAttempt could leave the Case locked `Approving`; the same conditional release fix now leaves that Case available for a new Admin decision.
- medium (patch): Edge Case Hunter found the Admin refund parser buffered arbitrary JSON before validation; it now enforces a 1 KiB content-length and streaming limit before parsing.
- medium (patch): Verification Gap Reviewer found no test for a confirmed refund followed by failed Case finalization; a regression now proves a subsequent approval completes closure through the already-succeeded refund without a second provider operation.
- medium (defer): Verification Gap Reviewer found no database-backed migration or competing-decision test; `P1000` prevents running these checks against PostgreSQL, so they remain an environment-dependent follow-up.
- medium (defer): Verification Gap Reviewer found no Admin/Patient page interaction tests for the decision controls or refund notice; the repository has no page/browser test harness, so UI-level automation remains a follow-up.

## Design Notes

Keep the Case decision and payment side effect as separate module-owned operations. Provider idempotency must use a key persisted before the external call; a timeout cannot be treated as a definitive decline. If local persistence fails after provider success, retry the same key and finish the Case transition without issuing a second refund. A rejection resets the existing SLA anchor used by `computeElapsedSlaTime()` and starts with no carried pause time.

## Verification

**Commands:**
- `npm test` -- expected: all existing and new Cases/Payments tests pass.
- `npx tsc --noEmit` -- expected: no TypeScript errors.
- `npx prisma validate` -- expected: schema remains valid.
- `npm run build` -- expected: Admin decision endpoints and Patient/Admin views compile.
- `npx prisma migrate status` -- inspect migration state; PostgreSQL credentials previously failed with `P1000`.

**Manual checks:**
- Approve and reject as Admin, then verify Patient/Doctor sessions cannot decide.
- Simulate a definitive provider decline and uncertain timeout; verify the Case remains recoverable, a definitive retry uses a new key and remains rejectable, and an uncertain retry uses the same key.
- Verify rejection resets elapsed SLA to zero and a later 120-hour breach can repeat the cycle.