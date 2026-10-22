---
title: 'Urgency Selection & Payment'
type: 'feature'
created: '2026-10-13'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'b56a96edc90849cf47464e2e4bf215a5b314a077'
context: ['_bmad-output/implementation-artifacts/epic-3-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Patients can create a private Case draft but cannot choose Standard/Urgent review or pay to submit it, so a completed Case never enters the review lifecycle.

**Approach:** Let the authenticated Patient choose an urgency tier and submit a payment-ready draft through one “Pay ₹X and submit” action using the v1 `MockPaymentProvider`. Read the current fees from Admin-owned `PlatformSettings`; only a successful provider result may transition the Case from Draft to Submitted and capture its tier, amount, and optional Doctor preference. A failed attempt preserves the Draft and selections for retry; a successful charge whose Case finalization fails is retried with the same durable idempotency key, never charged twice.

## Boundaries & Constraints

**Always:** Require the verified Patient session and Case ownership; require at least one Document; use only Standard or Urgent; read current platform-wide prices through an exported service, not constants or cross-module repositories; use INR-safe decimal/currency arithmetic without JavaScript floating-point money calculations; capture the charged amount and tier so later price changes do not alter a submitted Case; revalidate a selected Doctor through Doctors before assignment; use `PaymentProvider` with the Mock implementation in v1; keep failed/unpaid Cases Draft and invisible to Doctors, preserving urgency and Doctor preference for retry; persist a stable idempotency key and payment attempt outcome so a confirmed charge can finalize without a second charge; store no raw payment credentials; define the complete AD-13 CaseStatus enum/transition graph centrally but implement only Draft → Submitted here; preserve Cases/Payments/Admin ownership boundaries and `{ data, error }` envelopes.

**Never:** Integrate a real payment gateway, implement refunds/payouts or Admin pricing edits, allow urgency changes after submission, expose unpaid drafts to Doctors, or transition Submitted into the Doctor review lifecycle owned by Epic 4.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Missing supporting Document | Patient submits a Draft with no Documents | Payment is not attempted; Case remains Draft | Typed `CASE_DOCUMENT_REQUIRED` |
| Successful Standard/Urgent payment | Owned payment-ready Draft and selected tier | Charge current configured fee, then atomically capture tier/amount and transition to Submitted | Typed failure leaves Case unsubmitted |
| Provider declines/fails | Owned payment-ready Draft | Case remains Draft and invisible to Doctors; urgency and Doctor preference remain for retry | Typed payment error; no false Submitted response |
| Duplicate/stale submit | Case is already Submitted or another submit won | No second charge or transition | Typed conflict/idempotent result |
| Fee settings change | Draft submitted before/after a settings change | Each submission uses the current fee; submitted amount remains unchanged afterward | Settings read failure prevents payment |
| Selected Doctor no longer Verified | Saved preference became invalid before submission | Payment/submission does not assign the unverified Doctor | Typed conflict; Case remains Draft |
| Payment succeeds but persistence fails | Provider confirms charge; local submit update fails | Persist attempt outcome and retry finalization with the same idempotency key; do not charge again | Typed recoverable outcome |

</frozen-after-approval>

## Code Map

- `src/modules/cases/domain/index.ts`, `service.ts`, `repository.ts`, and `prisma/schema.prisma` currently support Draft/readiness and `selectedDoctorId`; add AD-13 states, tier/amount snapshots, and conditional Draft → Submitted persistence.
- `src/modules/admin/repository.ts` and `service.ts` own the seeded `PlatformSettings` table but expose no fee read; add a read-only service method.
- `src/modules/payments/` and `src/shared/` are placeholders for payment behavior/provider abstractions; implement the mock charge path plus durable stable-key attempt recovery.
- `src/app/api/cases/` and `src/app/cases/new/page.tsx` already support draft, documents, and Doctor preference; add an authenticated submit route plus urgency, fee, and result/retry UI.
- Cases/Admin/Payments tests and `package.json` follow `tsx --test`; cover fees, tiers, readiness, provider outcomes, stale/double submit, Doctor revalidation, and recovery.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/cases/domain/` and `prisma/schema.prisma` -- define AD-13 statuses, urgency, and submitted fee snapshot -- establishes one lifecycle source.
- [x] `src/modules/admin/repository.ts` and `service.ts` -- expose current Admin-owned fees through a read-only service -- avoids hardcoding or cross-repository reads.
- [x] `src/shared/payment-provider.ts` and `src/modules/payments/` -- add injectable mock charging and durable stable-key attempt recovery -- avoids gateway coupling and duplicate charges.
- [x] Cases/Payments repositories and `prisma/migrations/` -- persist payment attempts/submission snapshots and conditionally transition Draft to Submitted -- recovers confirmed charges without resubmission.
- [x] `src/modules/cases/service.ts`, `routes/index.ts`, and `src/app/api/cases/[caseId]/submit/route.ts` -- authorize, check readiness, read fees, revalidate Doctor, charge, and submit on success -- coordinates module boundaries.
- [x] `src/app/cases/new/page.tsx`, `package.json`, and Cases/Admin/Payments tests -- add tier/fee/result UI and cover fees, provider outcomes, stale submits, Doctor validation, and recovery -- verifies the matrix.

**Acceptance Criteria:**
- Given a payment-ready Draft, when either tier is selected and mock payment succeeds, then the current fee/tier are captured and the Case becomes Submitted once.
- Given missing Documents or provider failure, when submission is attempted, then the Case remains Draft and Doctor-invisible with urgency/Doctor preference preserved for retry.
- Given a duplicate submit or a selected Doctor who is no longer Verified, when submission is attempted, then no duplicate charge or invalid assignment occurs.
- Given the provider confirms payment but Case finalization fails, when the Patient retries, then the same idempotent attempt finalizes without a second charge.
- Given platform pricing changes, when a later Case is submitted, then it uses the current fee while prior submissions retain their captured amount.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

`PlatformSettings` stores fees as `Decimal(10,2)` and AD-16 makes changes prospective; preserve a two-decimal INR snapshot. AD-13 requires the full status graph, while Story 3.3 implements only Draft → Submitted. Since provider and database effects cannot share a transaction, persist a stable idempotency key and payment attempt outcome so a confirmed charge can finalize on retry without a second charge.

## Verification

**Commands:**
- `npm test` -- expected: all Patient, Doctor, Admin, Cases, and Payments suites pass.
- `npx tsc --noEmit` and `npm run build` -- expected: submit/provider/settings routes compile.
- `npx prisma validate` and `npx prisma generate` -- expected: payment/submission schema validates and client types generate.
- `npx prisma migrate status` -- expected: inspect migration state; do not claim database-backed submission without valid credentials.

**Manual checks:**
- Submit Standard and Urgent drafts with the mock provider, test provider failure and retry, confirm Doctor visibility only after success, and verify the charged snapshot survives a fee change.
