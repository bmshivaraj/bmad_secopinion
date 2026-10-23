---
title: 'Daily Doctor Payout Batch'
type: 'feature'
created: '2026-10-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['_bmad-output/implementation-artifacts/epic-5-context.md']
baseline_commit: '414df751d88797c7bbea8460e3986b5c913de3c4'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Closed Cases with a final Opinion have no payout workflow, leaving Doctors' earned shares unpaid or impossible to reconcile.

**Approach:** Run a daily Payments-owned batch for eligible closed Opinions. Create one transfer per eligible Case, calculate the Doctor's share from the captured Case fee and platform-fee percentage recorded at Opinion closure, persist recoverable payout attempts, send through the Doctor's registered UPI destination, and expose per-Doctor payout history.

## Boundaries & Constraints

**Always:** Only Cases closed with an Opinion are eligible; refunded/closed Cases without an Opinion are excluded. Create exactly one independent payout transfer per eligible Case, even when one Doctor has several eligible Cases in a daily run. Cases remains the source of eligibility and closure-time platform-fee snapshot; Payments owns payout records, calculation, retries, and provider calls. Use Decimal arithmetic and round INR amounts to two decimal places. Persist payout identity and idempotency before an external transfer; uncertain outcomes reuse their key, and a Case must never be paid twice. A missing UPI ID or unsuccessful/uncertain transfer remains visible as pending/recoverable in the Doctor's history. Preserve each Case's fee snapshot and the platform-fee percentage applicable at closure.

**Never:** Query Cases or Doctors tables from Payments repositories; pay a Case with no Opinion, a refunded Case, or a different Doctor; call the payout provider from Opinion submission; change PlatformSettings or refund behavior; or lose pending payouts when a batch partially fails.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Eligible payout | Closed Case with Opinion, captured fee, closure fee snapshot, and Doctor UPI ID | Calculate the net share, persist one payout attempt, and call the selected transfer grouping policy | Provider failure remains recoverable and visible |
| Missing UPI | Eligible payout; Doctor has no UPI ID | Keep the payout pending without calling the provider; show it in Doctor history | Retry after a valid UPI ID is saved |
| Uncertain provider result | Provider call times out or local outcome persistence fails | Retry safely without duplicate transfer | Keep the same persisted idempotency key |
| Ineligible Case | Refunded/Closed Case with no Opinion or no captured fee | Do not create or send a payout | None |
| Partial batch failure | One payout fails while other eligible payouts remain | Continue processing other payouts; retain the failed entry for retry | Record structured batch outcome and counts |

</frozen-after-approval>

## Code Map

- `src/modules/cases/repository.ts` -- `listClosedOpinionsForPayout(after)` returns stable 100-row Opinion-time/Case-ID cursor pages; its Closed+Opinion predicate excludes refunded Cases without an Opinion.
- `src/modules/cases/service.ts` and `src/modules/cases/repository.ts` -- Cases owns Opinion closure and its eligibility API; snapshot `platformFeePercent` in the Opinion transaction using settings from the Admin service, not a Payments query.
- `src/modules/admin/service.ts` and `src/modules/admin/repository.ts` -- `PlatformSettings` already stores `platformFeePercent`; the service currently returns only case fees, so expose the fee percent needed at closure without changing setting ownership.
- `src/modules/payments/service.ts`, `repository.ts`, and `domain/index.ts` -- Payments owns provider orchestration and refund recovery but has no payout ledger; persist per-Case payout state and retry metadata here.
- `src/shared/payment-provider.ts` -- `payout(doctorId, upiId, amount)` currently has no idempotency key and the mock declines; extend the contract and mock for recoverable simulated transfers.
- `src/modules/doctors/service.ts`, `src/modules/doctors/repository.ts`, and `src/app/doctors/profile/page.tsx` -- Doctors owns current UPI data; add a Payments-backed, Doctor-owner-scoped payout history to the existing profile surface.
- `src/instrumentation.ts` and `src/modules/cases/sla-breach-job.ts` -- Node instrumentation and the immediate/daily single-process runner provide the scheduling pattern for a Payments-owned payout job.
- `prisma/schema.prisma`, `prisma/migrations/`, and Payments/Doctors/Cases tests -- persist closure snapshots and payout attempts; cover eligibility, amount calculation, retry/idempotency, history privacy, and partial batches.

## Tasks & Acceptance

**Execution:**
 - [x] `prisma/schema.prisma`, `prisma/migrations/`, `src/modules/cases/*`, and `src/modules/admin/service.ts` -- snapshot the platform-fee percentage atomically with Opinion closure for later accurate calculation.
 - [x] `src/modules/payments/*` and `src/shared/payment-provider.ts` -- implement one durable, idempotent payout attempt and transfer per eligible Case, keeping failed/uncertain work recoverable.
 - [x] `src/instrumentation.ts` and `src/modules/payments/*` -- register the daily payout batch and emit structured outcome/count logs without blocking Case closure.
 - [x] `src/modules/doctors/*`, `src/app/api/doctors/profile/*`, and `src/app/doctors/profile/page.tsx` -- expose only the signed-in Doctor's payout history, including pending entries.
 - [x] Cases/Payments/Doctors tests -- cover closure snapshot, Decimal calculation, eligibility, missing UPI, duplicate/retry safety, privacy, and partial batches.

**Acceptance Criteria:**
- Given a Case closed with a final Opinion, when the daily batch processes it, then the Doctor receives the share calculated from the Case fee and platform-fee percentage applicable at closure.
- Given multiple eligible Cases for one Doctor, when the daily batch processes them, then it creates a separate payout transfer and history entry for each Case.
- Given no valid UPI destination or a failed/uncertain provider outcome, when the batch runs, then the payout remains visible and safely retryable in that Doctor's history.
- Given a refunded Case or Case without an Opinion, when the batch runs, then no payout is created or sent.
- Given a batch containing both successful and failed payouts, when one transfer fails, then other payouts continue and every outcome remains recoverable without duplicate transfers.

## Implementation Notes

Opinion closure now snapshots the active platform-fee percentage in the same Cases transaction. The migration backfills that snapshot for existing Closed Cases with Opinions from the active PlatformSettings row; the current application has not exposed fee-percentage edits yet. Payments stores one attempt per Case and advances a durable Opinion cursor only after the attempt exists, while unresolved attempts are retried separately so partial failures do not cause historical full scans or skipped Cases. The Doctor profile exposes owner-scoped history; provider idempotency distinguishes definitive failure from uncertain outcome.

Verification passed: 175 project tests, `npx tsc --noEmit`, `npx prisma validate`, and `npm run build`. `npx prisma migrate status` remains blocked by PostgreSQL `P1000`, so migration execution and database-backed payout behavior remain unverified. The mock provider simulates successful idempotent payouts; no live payment gateway is configured.

The review pass added a bounded retry cursor and index, fee-range validation, a clear precondition for historical snapshot backfill, and provider transfer references in Doctor history. Database-backed migration verification, page-level UI tests, history-volume pagination targets, future fee-edit synchronization, and live-provider setup are recorded as follow-ups.

Review fixes added bounded retry-attempt pages and an index, a clear migration failure when existing Opinion rows lack PlatformSettings, percentage range validation, and provider transaction references in Doctor history.

## Spec Change Log

## Review Triage Log

- false (rejected): Blind Hunter claimed a refunded Case with an Opinion could enter the payout query; refund transitions are only reachable from `RefundPending`, whose Cases have no Opinion, and Opinion submission is allowed only from `UnderReview`/`MoreInfoRequested`.
- false (rejected): Blind Hunter claimed legacy closure percentages may differ from the migration backfill; the seed creates the 20% setting without updating it on rerun, and no user-facing platform-fee update service exists in this baseline.
- medium (patch): Blind Hunter found that a missing PlatformSettings row makes the scalar backfill produce null, silently excluding historical Opinions; the migration now raises when existing closed Opinions need backfill but no settings row exists.
- maybe-false (defer; medium unverified): Blind Hunter found the platform-fee value is read immediately before the Case transaction and could race a future settings edit; there is no current settings-update path, so Story 5.5 must define synchronization when edits become possible.
- medium (patch): Blind Hunter and Edge Case Hunter found a negative payout can be calculated if a malformed fee percentage falls outside 0–100; payout calculation now rejects out-of-range percentages before creating an attempt or calling the provider.
- low (patch): Blind Hunter found Doctor history omitted the provider transaction reference; the owner-scoped history now returns and displays the transfer reference when available.
- maybe-false (defer; medium unverified): Blind Hunter found payout history is unbounded; set an expected history size/latency target, then add cursor pagination if measurements require it.
- medium (patch): Blind Hunter found unresolved payout retries were loaded without a bound; the query and daily retry loop now use 100-row cursor pages.
- medium (patch): Blind Hunter found the retry status/creation-time query had no supporting index; the payout migration and Prisma model now add the composite index.
- false (rejected): Blind Hunter claimed the history date label disagreed with its timestamp; the page labels `updatedAt` as “Updated,” so the displayed value and label match.
- medium (defer): Edge Case Hunter found the default mock provider reports payout success without transferring money; the current project intentionally configures `MockPaymentProvider`, so a real payout provider must be selected and configured before live use.
- medium (defer): Verification Gap Reviewer found no PostgreSQL-backed migration/backfill test; `npx prisma migrate status` fails with `P1000`, so applying the migration and verifying existing-Opinion backfill remains environment-blocked.
- medium (defer): Verification Gap Reviewer found no Doctor profile rendering/interaction test for payout history; the repository has no page/browser test harness.

## Design Notes

The current Cases cursor supports bounded traversal but does not itself mark a payout as processed. A unique persisted payout identity must therefore be the idempotency boundary across restarts and overlapping runs. Because PlatformSettings can change between Opinion closure and the daily job, the fee percentage must be captured when the Opinion closes; calculating with the job-time setting would change historical Doctor shares.

## Verification

**Commands:**
- `npm test` -- expected: all existing and new module/job tests pass.
- `npx tsc --noEmit` -- expected: no TypeScript errors.
- `npx prisma validate` -- expected: schema remains valid.
- `npm run build` -- expected: payout job and Doctor history API compile.
- `npx prisma migrate status` -- inspect migration state; PostgreSQL credentials previously failed with `P1000`.

**Manual checks:**
- Verify a Doctor with multiple eligible Cases receives and sees one independent transfer/history entry per Case.
- Verify missing UPI and provider failure leave pending entries, then retry after UPI setup without a duplicate transfer.
- Verify a payout amount still uses the closure-time percentage after PlatformSettings changes before the batch runs.