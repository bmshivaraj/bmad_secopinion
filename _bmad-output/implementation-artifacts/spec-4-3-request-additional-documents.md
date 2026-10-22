---
title: 'Request Additional Documents'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['_bmad-output/implementation-artifacts/epic-4-context.md']
baseline_commit: '27b60d7bada1576dc812ed5d4b87b721281e513c'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Doctors reviewing a Case cannot ask for specific missing Documents, and Patients have no way to see or respond to such a request after submission.

**Approach:** Let the assigned Verified Doctor save one required free-text request note (1-2,000 characters) while a Case is UnderReview. Persist the request, transition to MoreInfoRequested, and open one SLA pause interval; show it in the Patient and Doctor Case views. The Patient's next valid Document upload closes the interval and returns the Case to UnderReview; both users see the updated state in-app.

## Boundaries & Constraints

**Always:** Only the currently assigned Verified Doctor may request Documents on a specialty-matched UnderReview Case; accept a trimmed, non-empty request note up to 2,000 characters; persist it for both Case views; atomically record the request, transition to MoreInfoRequested, and append `{ pausedAt, resumedAt: null }`; allow only the Case's Patient to upload while MoreInfoRequested; reuse upload validation, storage cleanup, and access control; on successful upload, atomically set the open interval's `resumedAt`, fulfill the active request, transition to UnderReview, preserve `submittedAt`, and expose the update in-app; allow later cycles to append intervals; use the single Cases SLA function and private API envelopes.

**Never:** Allow Doctor requests on unassigned, Submitted, RefundPending, or terminal Cases; resume on failed/partial persistence, unrelated actions, or duplicate requests; reset the 120-hour anchor; expose requests/Documents to another user; integrate SMS/email notifications; implement Opinion, refund, or payout flows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Doctor requests Documents | UnderReview Case assigned to the requesting Verified Doctor; trimmed request note of 1-2,000 characters | Persist exact note, transition to MoreInfoRequested, append an open pause interval | Typed validation/conflict; no partial state change |
| Wrong Doctor or status | Case is unassigned, assigned elsewhere, not UnderReview, or requester is not Verified | No request, status change, or pause is written | Denied/not-found/conflict without leaking another Case |
| Patient views request | Patient owns the Case in MoreInfoRequested | Show exact request and upload action in Patient Case list/detail | Private Patient response |
| Patient upload succeeds | Owned MoreInfoRequested Case; valid Document upload | Persist Document, fulfill active request, resume open interval at upload time, transition to UnderReview, and surface update in Doctor Case view | Success only after metadata/state persistence |
| Upload or persistence fails | MoreInfoRequested Case | Keep request, paused status, and open interval; remove any partially stored bytes | Typed upload/persistence error |
| Repeated request cycle | Case returned to UnderReview after a prior request | Store the new request and append a distinct pause interval | Existing history remains unchanged |
| Duplicate request during pause | Case already MoreInfoRequested | Do not append another active request/interval | Typed state conflict |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma`, migration -- add Case-owned request history (note, requester ID, created/fulfilled timestamps); no Doctor FK, per AD-4.
- `src/modules/cases/domain/index.ts`, `repository.ts`, `service.ts` -- add the public request type and typed conflict; transact request/status/pause creation and upload/request fulfillment/status/pause resume. Reuse existing authorization, validation, cleanup, state graph, and SLA calculation; do not apply the paid-Draft mutation guard to an authorized MoreInfoRequested upload.
- `src/modules/cases/routes/index.ts` and new `src/app/api/cases/[caseId]/document-requests/route.ts` -- reuse role guards/error envelopes; validate trimmed note input and add Doctor request POST.
- `src/app/api/cases/route.ts`, `src/app/api/cases/[caseId]/documents/route.ts`, `src/app/api/doctors/queue/[caseId]/route.ts` -- add private Patient-owned list; allow owned MoreInfoRequested upload; include request history in assigned Doctor detail.
- `src/app/doctors/queue/page.tsx`, `src/app/cases/new/page.tsx`, new `src/app/cases/page.tsx` -- add Doctor form/history, Patient list navigation, and Patient Case list with request/status history and upload action.
- `src/modules/cases/service.test.ts`, `src/modules/cases/routes.test.ts` -- extend memory fixtures for cycles, authorization, persistence failure, and byte cleanup. PostgreSQL verification remains blocked by P1000.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` and additive migration -- add indexed Case-owned request history with a one-active-request constraint; preserve existing Case/SLA data.
- [x] Cases domain/repository/service -- validate 1-2,000 character notes; atomically request/pause and upload/fulfill/resume; reuse the state machine and storage rollback.
- [x] Cases routes and new API handlers -- add Doctor request and Patient list endpoints; enforce role/ownership and allow upload only for owned Draft or MoreInfoRequested Cases.
- [x] Doctor queue and Patient Case pages -- add request form/history, Patient list navigation, request/status display, and existing upload action.
- [x] Cases service/route tests -- cover auth, validation, repeat cycles, transactional state/SLA behavior, failed uploads, and byte cleanup.

**Acceptance Criteria:**
- Given an assigned Verified Doctor and an UnderReview Case, when a valid note is submitted, then request, MoreInfoRequested status, and one open pause persist atomically.
- Given a Patient-owned submitted Case, when its Patient opens `/cases`, then only their Case/request history appears and an active request has an upload action.
- Given a valid response upload, when persistence succeeds, then the Document attaches, request is fulfilled, SLA pause closes, and status returns to UnderReview without changing `submittedAt`.
- Given invalid authorization/input or failed persistence, when an operation runs, then Case/request/SLA state is unchanged and partial upload bytes are removed.

## Implementation Notes

Implemented Case-owned request history, a Doctor request endpoint/form, and a Patient Case list with private status/request history and response upload. Request creation and successful response persistence update request/status/SLA state transactionally; a partial unique index prevents multiple active requests. Existing Draft payment/upload behavior is unchanged.

Verification passed: 126 project tests, `npx tsc --noEmit`, `npx prisma validate`, and `npm run build`. `http://localhost:3000/cases` returned HTTP 200. `npx prisma migrate status` remains blocked by PostgreSQL `P1000`; authenticated page interaction was not browser-verified because the browser bridge could not connect.

## Spec Change Log

## Review Triage Log

- medium (patch): Blind review found Doctor request text could carry into another Case; opening a different Case and closing detail now clear the draft.
- medium (patch): Blind review found an open Doctor detail could stay stale after Patient response; added a detail-level refresh that preserves the selected Case.
- low (patch): Blind review found an open Patient list would not show a new request until reload; added an explicit in-app list refresh.
- low (patch): Blind review found sign-in discarded the Patient's `/cases` destination; added a whitelisted `returnTo=/cases` redirect.
- false: Blind review reported no upload reauthentication path; 401 now enters the signed-out state, which presents a sign-in link and preserves `/cases` as the return path.
- medium (patch): Blind review found the spec and sprint tracker disagreed during review; tracker now uses the defined `review` story state.
- medium (defer): Blind review noted missing page-level request/upload interaction coverage; no UI harness exists, so automated page tests are deferred to UI-test infrastructure.
- medium (defer): Blind review noted the migration and partial unique index are not database-verified; PostgreSQL rejected credentials with `P1000`.
- medium (defer): Blind review noted no PostgreSQL-backed request/response concurrency test; the same `P1000` prevents database-backed concurrency verification.
- medium (patch): Edge review repeated the Doctor draft-text carryover finding; the draft now clears when changing or closing Cases.
- false: Edge review claimed an UnderReview Case can already have an open request pause; current request creation opens the pause while transitioning to MoreInfoRequested, and the only implemented return to UnderReview closes it transactionally.
- medium (patch): Verification-gap review found no failure injected after response state writes; added a repository test that fails a later Document write and verifies transactional rollback of Case, request, and Document state.

## Design Notes

The next successful upload batch resumes the open interval; this story does not infer whether its files semantically satisfy the note. The Doctor may request more Documents after the Case returns to UnderReview. The additive migration introduces no external side effects; production rollback would remove request history, so preserve the table once deployed. PostgreSQL-backed verification is blocked by the known P1000 credentials issue.

## Verification

**Commands:**
- `npm test` -- expected: all existing and new module tests pass.
- `npx tsc --noEmit` -- expected: no TypeScript errors.
- `npx prisma validate` -- expected: schema is valid.
- `npm run build` -- expected: request/upload routes and both Patient/Doctor pages compile.
- `npx prisma migrate status` -- inspect migration state; database-backed persistence requires working PostgreSQL credentials.

**Manual checks:**
- As the assigned Doctor, submit a request note and verify it appears in both users' Case views.
- As the Patient, upload a valid Document and verify the request is fulfilled, Case returns to UnderReview, and the same SLA anchor has a closed pause interval.
- Retry with invalid upload, another Patient, or another Doctor and verify no state or storage leak occurs.
