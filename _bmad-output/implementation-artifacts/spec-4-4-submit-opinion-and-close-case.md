---
title: 'Submit Opinion and Close Case'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['_bmad-output/implementation-artifacts/epic-4-context.md']
baseline_commit: '1c66f2c67b6036097ba5c7752f28ab7d4082230a'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Doctor can review an assigned Case but cannot save a final Opinion; the Patient therefore cannot receive the completed second opinion or see the Case closed.

**Approach:** Let the assigned Verified Doctor submit one final plain-text Opinion (1-10,000 characters) from UnderReview or MoreInfoRequested. Cases persists the Opinion and atomically closes the Case through the approved status graph; the Patient can view it. If the Case has a pending Document request, close it without marking it fulfilled and show “Closed by Opinion”; end its SLA pause at Opinion submission. Closed Case plus Opinion data is the durable input for Epic 5's daily payout batch; no payout is disbursed synchronously here.

## Boundaries & Constraints

**Always:** Require a currently Verified Doctor assigned to the Case and a specialty match; accept trimmed, non-empty plain text up to 10,000 characters; permit submission only from UnderReview or MoreInfoRequested; permit one Opinion per Case; persist Opinion and closure atomically; make the final Opinion visible only to the Case's Patient, assigned Doctor, or Admin; preserve `submittedAt` and earlier SLA intervals, closing any open pause and pending request (`closedAt`, not `fulfilledAt`) at Opinion submission; expose closed Opinions through a Cases-owned payout-eligibility query for the later daily batch; use private API envelopes.

**Never:** Accept an Opinion from an unassigned/wrong Doctor or for RefundPending, Refunded, OpinionGiven, or Closed Cases; edit or reopen a closed Case; create multiple Opinions; call `PaymentProvider.payout()` or perform payout calculations synchronously; add post-closure chat or clarification; create cross-module foreign keys or allow Payments to query Cases tables directly.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Assigned Doctor submits Opinion | Verified, specialty-matched assigned Doctor; UnderReview Case; trimmed plain text of 1-10,000 characters | Persist one Opinion; transition through OpinionGiven to Closed atomically | Success only after Opinion and closure persist |
| Opinion while more information is requested | Same Doctor; MoreInfoRequested Case with pending request and open SLA pause | Persist Opinion, close Case and pause, set request `closedAt` without `fulfilledAt`; Patient history says “Closed by Opinion” | No partial Opinion, status, request, or SLA mutation |
| Wrong Doctor or invalid state | Unassigned/other Doctor, RefundPending, or terminal Case | No Opinion or Case mutation; do not reveal another Patient's Case | Typed not-found, denied, validation, or conflict response |
| Patient views closed Opinion | Patient owns a Closed Case with an Opinion | Show the final Opinion in the Patient Case view; other Patients cannot retrieve it | Private response; owner-scoped not-found/denial |
| Repeated submission or attempted edit | Case already has an Opinion or is Closed | Keep the original Opinion and Closed state unchanged | Typed conflict |
| Payout scheduling | Case closed with persisted Opinion | Leave a durable record for Epic 5's next daily batch; make no immediate provider call | Payout execution remains owned by Epic 5 |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma`, migration, and `src/modules/cases/domain/index.ts` -- add one Case-owned plain-text Opinion (1-10,000 chars) with a unique Case relation; add `CaseDocumentRequest.closedAt` to distinguish Opinion closure from upload fulfillment.
- `src/modules/cases/domain/case-state-machine.ts` -- `UnderReview → OpinionGiven → Closed` exists; add the FR-11 `MoreInfoRequested → OpinionGiven` path.
- `src/modules/cases/repository.ts` and `service.ts` -- reuse Cases authorization and transactions; atomically create Opinion, close Case/pause, close any active request, and provide bounded keyset payout pages ordered by Opinion timestamp and Case ID.
- `src/modules/cases/routes/index.ts`, `src/app/api/cases/[caseId]/opinion/route.ts`, and `src/app/api/admin/cases/[caseId]/opinion/route.ts` -- bound JSON body size before parsing; enforce Doctor/Admin guards and private envelopes.
- `src/app/doctors/queue/page.tsx`, `src/app/api/cases/route.ts`, and `src/app/cases/page.tsx` -- add the eligible Doctor form and owner-only Patient Opinion display.
- `src/modules/payments/service.ts` and `src/shared/payment-provider.ts` -- payout batching is not implemented here; Epic 5 consumes the Cases cursor query under AD-10, without direct table access or synchronous payout.
- `src/modules/cases/service.test.ts` and `src/modules/cases/routes.test.ts` -- cover state, assignment, privacy, duplicate, and transactional failure behavior; PostgreSQL remains blocked by P1000.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` and migration -- add one durable plain-text Opinion per Case and `CaseDocumentRequest.closedAt` for closure without upload fulfillment.
- [x] Cases domain/repository/service -- add the MoreInfoRequested transition, note validation, assigned-Doctor check, atomic Opinion/Case/pause/request closeout, and payout-eligibility query.
- [x] Cases routes and Doctor/Admin/Patient access -- add private submission and display flows using the approved Opinion format.
- [x] Cases service/route tests -- cover lifecycle, authorization, privacy, duplicates, and transaction failures.

**Acceptance Criteria:**
- Given a valid Doctor submission, when Opinion and closure commit, then the one final Opinion is Patient-visible and immutable.
- Given MoreInfoRequested, when Opinion commits, then the Case closes, the pause ends at submission time, and the request shows Closed by Opinion without setting `fulfilledAt`.
- Given an unauthorized Doctor, RefundPending, or terminal Case, when submission is attempted, then no Opinion or Case mutation occurs.
- Given an Admin session, when an Opinion is requested by Case ID, then Admin can read it privately and other roles are denied.
- Given a closed Opinion, when Epic 5 requests payout inputs, then Cases returns the Doctor, amount, Case ID, and Opinion timestamp without disbursing.

## Implementation Notes

Added a unique CaseOpinion record with an indexed timestamp/Case cursor, Doctor Opinion POST/form, Admin read endpoint, Patient-owned Opinion display, MoreInfoRequested closeout with `closedAt`, and bounded Cases payout pages. Opinion creation, Case closure, pause completion, and pending-request closure are transactional; Opinion text is Unicode-counted and JSON-bounded; closed-case SLA display freezes at Opinion time; no synchronous payout is called.

Verification passed: 135 project tests, `npx tsc --noEmit`, `npx prisma validate`, and `npm run build`. `/cases` rendered over the shared browser. `npx prisma migrate status` remains blocked by PostgreSQL `P1000`; authenticated Doctor/Patient interactions and database-backed migration/concurrency were not verified. Review fixes covered bounded parsing, Unicode character counts, closed-case SLA snapshots, Admin Opinion access, and payout cursor pagination.

## Spec Change Log

## Review Triage Log

- medium (patch): Blind review found the payout eligibility query unbounded; it now returns 100-row pages with a composite Opinion timestamp/Case ID cursor.
- medium (patch): Blind review found timestamp-only watermarks could skip same-millisecond Opinions; the composite cursor includes Case ID as a stable tie-breaker.
- low (rejected): Blind review noted Doctors lack a closed-Opinion history panel. Closed Opinions remain readable to the assigned Doctor through the Case detail endpoint, and the approved story requires no post-closure edits or history archive; adding a separate archive is not necessary for the accepted workflow.
- medium (patch): Blind review found no Admin Opinion read path; added an Admin-session-only, private Opinion endpoint.
- medium (patch): Blind/edge reviews found Opinion JSON was parsed before size validation; parsing now reads at most 64 KiB before JSON decoding and returns 413 for oversized bodies.
- medium (patch): Edge review independently found oversized JSON could be buffered before validation; the same bounded 64 KiB parser fixes this reachable memory-pressure path.
- low (patch): Blind review found UTF-16 length disagreed with PostgreSQL character limits; service and UI now count Unicode code points, with a matching counter.
- medium (defer): Blind review found the new Opinion migration/index had not been exercised against PostgreSQL; credentials return `P1000`, so migration execution is deferred.
- medium (defer): Blind review found no PostgreSQL-backed concurrent Opinion submission test; `P1000` blocks exercising the production compare-and-swap transaction.
- medium (patch): Edge review found SLA display advanced after a Case closed; Doctor detail now calculates closed-case SLA at Opinion creation time.
- false: Edge review claimed a Doctor could lose Verified status between authorization and Opinion commit; supported Admin repository updates only records in `Pending`, so a Verified Doctor cannot be revoked through the current service.
- medium (patch): Edge review repeated the Admin Opinion visibility finding; Admin retrieval now uses an Admin-only Cases endpoint.
- medium (defer): Verification-gap review found no Patient page-level test proving Opinion text renders; this repo has no UI test harness, so rendering coverage is deferred until one is available.
- medium (defer): Verification-gap review found no Doctor page interaction test for the Opinion form; the repo has no UI test harness, so the eligible-state and submit interaction test is deferred.

## Design Notes

AD-10 assigns payout calculation and disbursal to the daily batch; Cases provides bounded keyset pages using an Opinion timestamp and Case ID cursor. FR-11 excludes post-closure edits; the PRD's clarification question has no v1 mechanism. The additive Opinion migration preserves permanent Opinion data once deployed; PostgreSQL verification may be blocked by P1000.

## Verification

**Commands:**
- `npm test` -- expected: all existing and new module tests pass.
- `npx tsc --noEmit` -- expected: no TypeScript errors.
- `npx prisma validate` -- expected: schema is valid.
- `npm run build` -- expected: Opinion route and Patient/Doctor pages compile.
- `npx prisma migrate status` -- inspect migration state; database-backed persistence requires working PostgreSQL credentials.

**Manual checks:**
- As the assigned Doctor, submit an Opinion from UnderReview and MoreInfoRequested and verify Case closure and Patient visibility.
- Try another Doctor, RefundPending, and already-closed Case; verify no data or state change.
- As the Patient, verify only the owning account can view/download the Opinion.