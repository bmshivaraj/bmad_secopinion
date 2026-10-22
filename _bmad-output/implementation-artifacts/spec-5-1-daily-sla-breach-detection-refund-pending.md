---
title: 'Daily SLA-Breach Detection & Refund Pending'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['_bmad-output/implementation-artifacts/epic-5-context.md']
baseline_commit: 'f11b1e3f97048ac42e4db18b0410c44d6679df14'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent
**Problem:** Cases can remain without an Opinion after the 120-hour response SLA, with no daily process to move the Case into the Admin refund-decision workflow.

**Approach:** Run one daily Cases-owned breach scan over paid, unclosed Submitted, UnderReview, and MoreInfoRequested Cases using `computeElapsedSlaTime(case)`. Atomically transition each breached Case to RefundPending and surface its Case ID and captured amount in an in-app Admin worklist; this story does not approve refunds or send money.

## Boundaries & Constraints

**Always:** Scan paid, unclosed Submitted, UnderReview, and MoreInfoRequested Cases; use the single Cases SLA calculation and its 120-hour threshold; use the formal CaseStatus transition graph; atomically condition each transition on the Case's current eligible status; preserve `submittedAt` and `slaPauseHistory`; ensure a concurrent Opinion wins or the breach transition wins, never both; block Doctor Opinion submission and Patient edits/uploads once RefundPending; expose the Case and `chargedAmount` in an in-app Admin worklist for Story 5.2; follow module ownership and private API conventions.

**Never:** Reimplement SLA arithmetic; transition directly to Refunded or call a payment/refund provider; reset the SLA clock; let the scheduler or Admin UI write Cases tables outside the Cases module; add external email/SMS delivery, a real-time SLA timer, or a distributed job system beyond the single-process v1 deployment assumption.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Daily breach scan | Paid, unclosed Submitted/UnderReview/MoreInfoRequested Case; elapsed SLA exceeds 120 hours | Conditionally transition to RefundPending; add Case ID and captured amount to the in-app Admin worklist | Lost state race is a no-op; continue scanning other Cases |
| Not yet breached | Eligible open Case; elapsed SLA is at or below 120 hours | Leave Case status and timestamps unchanged | None |
| Opinion or Patient response races the scan | Case changes status before conditional transition | Only the first valid state transition takes effect; Closed is never changed to RefundPending | Treat conditional update miss as a lost race, not a batch failure |
| SLA pause is open or completed | MoreInfoRequested or previously paused Case | `computeElapsedSlaTime()` excludes paused duration; do not edit pause history | Invalid/missing SLA data is not treated as a breach |
| Admin reviews a breached Case | Case is RefundPending | Admin can see Case ID and original `chargedAmount` for Story 5.2 decision | Private Admin response; other roles denied |

</frozen-after-approval>

## Code Map

- `src/modules/cases/domain/sla.ts` -- `CASE_RESPONSE_SLA_MS` and `computeElapsedSlaTime()` are the sole 120-hour clock source; preserve pause handling.
- `src/modules/cases/domain/case-state-machine.ts` -- UnderReview/MoreInfoRequested may enter RefundPending; reuse `canTransitionCase()` and never duplicate the graph.
- `src/modules/cases/domain/sla.ts` and `case-state-machine.ts` -- reuse the 120-hour threshold/calculator and transition graph.
- `src/modules/cases/repository.ts` and `service.ts` -- scan paid open statuses; atomically compare-and-swap each still-eligible Case to RefundPending; return Admin worklist fields through Cases.
- `src/modules/cases/sla-breach-job.ts` and `src/instrumentation.ts` -- run once at Node startup and every 24 hours in-process; prevent duplicate registration within the process and emit structured outcome logs.
- `src/modules/cases/routes/index.ts`, `src/app/api/admin/cases/refunds/route.ts`, and `src/app/admin/page.tsx` -- enforce Admin auth and show a refreshable in-app worklist; do not expose repository access to Admin.
- `src/modules/cases/service.test.ts` and `src/modules/cases/routes.test.ts` -- cover SLA thresholds/pauses, race handling, Admin visibility, and role denial.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/cases/repository.ts` and `service.ts` -- select SLA candidates and atomically transition only still-eligible breached Cases to RefundPending.
- [x] Cases-owned daily job entry point -- invoke the breach scan once per day using the canonical Cases service; keep job execution idempotent across races.
- [x] Cases service and Admin API/UI -- expose RefundPending Case ID and captured amount to Admin without direct cross-module repository access.
- [x] `src/modules/cases/service.ts` -- enforce RefundPending locks for Doctor Opinion, Patient uploads, and Case edits.
- [x] Cases/Admin tests -- cover SLA boundary/pauses, status races, amount visibility, and unauthorized access.

**Acceptance Criteria:**
- Given an eligible Case past the 120-hour SLA, when the daily job runs, then the Case moves to RefundPending only if its status is still eligible and the Admin can see its ID and captured amount.
- Given a Case at or below the SLA threshold, when scanned, then no Case state or timing data changes.
- Given an Opinion or Patient upload racing the scan, when both transitions contend, then only the first valid transition is applied.
- Given RefundPending, when a Doctor submits an Opinion or a Patient uploads/edits, then the operation is rejected without mutation.

## Implementation Notes

Implemented the SLA candidate scan, conditional RefundPending transitions, startup/24-hour in-process runner, structured run outcome logs, and private Admin worklist. The worklist is the chosen in-app breach notice; refund decisions/provider calls remain with Story 5.2, and external alerting remains with Story 5.4.

Verification passed: 145 project tests, `npx tsc --noEmit`, `npx prisma validate`, and `npm run build`. Database-backed checks remain limited by the known PostgreSQL `P1000`; the repository has no page-level test harness. The review pass strengthened the scheduler overlap test and recorded remaining scale, invalid-data observability, PostgreSQL concurrency, and UI-rendering follow-ups in the Review Triage Log and `deferred-work.md`.

## Spec Change Log

## Review Triage Log

- false (rejected): Blind Hunter reported mojibake in the UI and planning files; reading the source files confirms the intended `₹` symbol and punctuation are intact, so the corruption was confined to the temporary diff export.
- medium (defer): Blind Hunter found that malformed SLA history returns `null` and is silently skipped while the scan reports success; defer skipped-candidate diagnostics/data remediation to the operational follow-up, since this story explicitly must not treat invalid SLA data as a breach.
- maybe-false (defer; medium unverified): Blind Hunter found the SLA candidate scan loads and processes every eligible Case in one run; no daily candidate ceiling or runtime budget exists to establish whether this is a current failure, so workload sizing/load evidence is needed before choosing bounded batching.
- maybe-false (defer; medium unverified): Blind Hunter found the Admin worklist loads every RefundPending Case at once; no expected queue size or response-time target exists, so measure realistic queue size/latency before selecting pagination behavior.
- medium (defer): Blind Hunter found no PostgreSQL-backed race test for the conditional refund transition; the repository uses a conditional status update and service tests cover losing races, but PostgreSQL rejects configured credentials with `P1000`, preventing database-backed verification.
- medium (patch): Blind Hunter found the scheduler test title claimed overlap prevention without invoking a timer while a scan was active; the test now holds its first scan open, invokes the interval callback, and asserts only one scan is active.
- medium (defer): Blind Hunter and Verification Gap Reviewer found no Admin-page rendering assertion for Case ID and captured amount; route tests verify the API only, and the repository has no page/browser test harness.
- low (rejected): Blind Hunter noted duplicate SLA/state-machine references in this spec's Code Map; this documentation-only cleanup has no user or developer consequence for the implementation, and review findings whose fix edits this build's spec are rejected by the workflow.

## Design Notes

AD-8 permits a once-daily in-process job; AD-11 requires pause-aware calculations through the Cases SLA function. The scan only queues Admin refund decisions; Story 5.2 owns approve/reject and provider refund calls. The configured PostgreSQL credentials currently fail with P1000, so database-backed scheduling/migration checks may be unavailable.

## Verification

**Commands:**
- `npm test` -- expected: all existing and new module/job tests pass.
- `npx tsc --noEmit` -- expected: no TypeScript errors.
- `npx prisma validate` -- expected: schema remains valid; migration may not be required.
- `npm run build` -- expected: job wiring and Admin refund views compile.
- `npx prisma migrate status` -- inspect state if persistence changes; PostgreSQL credentials are currently blocked by P1000.

**Manual checks:**
- Verify a Case over 120 active-review hours appears in the Admin worklist after a daily scan; a paused interval does not count toward the breach.
- Race a Doctor Opinion or Patient response against the scan and verify only one transition wins.
- Verify RefundPending blocks Doctor and Patient mutations while preserving the captured fee for Story 5.2.