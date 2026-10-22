# Epic 5 Context: Payouts & SLA Refund Resolution

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Complete the Case money lifecycle: resolve Cases that exceed the response SLA through an Admin-approved refund, pay Doctors for Opinions closed successfully, and let Admins tune pricing without a code deployment. Both daily jobs must be observable because silent failure can leave a Patient unrefunded or a Doctor unpaid.

## Stories

- Story 5.1: Daily SLA-Breach Detection & Refund Pending
- Story 5.2: Admin Refund Approval/Rejection
- Story 5.3: Daily Doctor Payout Batch
- Story 5.4: Batch Job Logging & Failure Alerting
- Story 5.5: Admin Configures Case Fees & Platform Fee Percentage

## Requirements & Constraints

- The daily SLA job scans paid, unclosed Cases in Submitted, UnderReview, or MoreInfoRequested and uses the Cases-owned `computeElapsedSlaTime(case)` function. When cumulative active-review time exceeds 120 hours, transition the Case to RefundPending and show its ID and captured amount in the in-app Admin worklist. Daily precision is acceptable; this is not a real-time timer.
- RefundPending locks Doctor Opinion submission and Patient Document uploads/Case edits. Admin approval refunds the full fee captured at submission, marks the Case Refunded then Closed, and excludes it from Doctor payout. Rejection returns it to UnderReview with a fresh 120-hour SLA window; the cycle may repeat without a v1 cap.
- The daily payout job processes Cases closed with an Opinion since its last successful run. Calculate each Doctor's share from the Case fee and Platform Fee percentage applicable at closure, use currency-safe arithmetic, and pay through the registered UPI ID via `PaymentProvider`. Unprocessed payouts remain pending in Doctor history.
- Standard/Urgent fees and the Platform Fee percentage live in one Admin-owned PlatformSettings record. Defaults are ₹1,000, ₹2,000, and 20%; changes apply prospectively and never recalculate submitted Case fees or already-calculated payouts.
- Both daily jobs emit structured stdout logs with outcome/counts and alert an operator on unhandled failure. This is the minimum v1 operational floor.

## Technical Decisions

- Cases owns Case status, transitions, SLA pauses, Opinion closure, and Document access. Other modules must use exported service APIs; Payments must not query Cases-owned tables directly.
- Payments owns payout/refund orchestration and calls `PaymentProvider`; provider calls must not run synchronously on the Case closure request path.
- Keep the formal CaseStatus enum/transition graph in Cases. SLA pauses remain timestamp pairs; all elapsed-time decisions use `computeElapsedSlaTime()`.
- Store money in currency-safe Decimal representations, never floating-point arithmetic. Preserve the fee captured on Case submission and the split used when payout is calculated.
- Use the existing modular-monolith conventions: module-owned repositories, typed domain errors, role/session guards at route boundaries, `{ data, error }` envelopes, and UUID IDs with plain-ID cross-module references.

## Cross-Story Dependencies

- Story 5.1 requires Epic 4 Case assignment, Opinion status, and pause-aware SLA calculation; it creates the RefundPending state consumed by Story 5.2.
- Story 5.2 owns Admin refund decisions and the fresh-SLA return path after rejection.
- Story 5.3 depends on Epic 4's closed Opinions and Cases' payout-eligibility service; it owns calculation/disbursal and Doctor payout history.
- Story 5.4 instruments both jobs from Stories 5.1 and 5.3.
- Story 5.5 owns PlatformSettings used prospectively by Case submission and payout calculation.