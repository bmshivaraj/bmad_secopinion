---
title: 'Claim or Admin-Assign a Case'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
context: ['_bmad-output/implementation-artifacts/epic-4-context.md']
baseline_commit: '8eaacabf9e92105a984adc09c9f3982e8951eaf1'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Doctors can view specialty-matched Cases but cannot claim them, and Admins cannot assign or reassign a Case to begin or redirect review.

**Approach:** Add one Cases-owned, optimistic-locking assignment operation used by Doctor self-claim and Admin assignment/reassignment. Admin targets must match the Case Specialty and Admin assignment is limited to active review states. A first assignment transitions a Submitted Case to UnderReview; Admin can confirm a Patient-selected Doctor on a still-Submitted Case through this operation to start review. Reassignment preserves status and SLA history.

## Boundaries & Constraints

**Always:** Use `Case.assignmentLockVersion` for each assignment change; atomically update `doctorId` and increment the version when the assignee changes; require a currently Verified Doctor; let Doctors claim only unassigned Cases in their specialty queue; let Admins assign/reassign only Submitted, UnderReview, or MoreInfoRequested Cases and only to a Doctor in the Case Specialty; revalidate targets; return typed stale-version/already-assigned conflicts; transition Submitted to UnderReview on first assignment or Admin confirmation of the existing Patient-selected Doctor; preserve status on reassignment and preserve `submittedAt`, `slaPauseHistory`, Specialty, and `selectedDoctorId`; keep document access limited to the currently assigned, specialty-matched Doctor or Admin; use private API envelopes.

**Never:** Assign a Doctor outside the Case Specialty or assign/reassign RefundPending or terminal Cases; add auto-assignment or separate check-then-set paths; reset or edit SLA timestamps during assignment; alter the Patient's Doctor preference; or implement document requests, Opinion submission, refunds, or payouts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Doctor claims an open Case | Verified, specialty-matched Doctor; unassigned Submitted Case; current version | Set Doctor, increment version, transition to UnderReview; preserve SLA data | Private success envelope |
| Two Doctors claim concurrently | Both submit the same version | Exactly one claim succeeds | Loser gets a typed already-assigned/version conflict |
| Stale queue view | Expected version differs from current | No assignment mutation | Typed version conflict; refresh queue |
| Admin assigns an unassigned Case | Admin chooses a currently Verified, specialty-matched Doctor for a Submitted Case | Use the same atomic operation; first assignment enters UnderReview | Typed validation/conflict |
| Patient-selected Doctor Case starts review | Submitted Case already has the selected, specialty-matched Doctor | Admin confirms the existing Doctor through the shared operation; transition to UnderReview without changing assignee | Typed validation/conflict |
| Admin reassigns an assigned Case | Active review Case; Admin chooses a Verified Doctor in its Specialty and current version | Replace Doctor and increment version; preserve status and SLA | Typed validation/conflict |
| Admin keeps the current Doctor | Active review Case; selected target equals current assignee | Return current assignment without incrementing the version | Private success envelope |
| Admin targets another Specialty or a terminal Case | Doctor is incompatible or Case is RefundPending/terminal | Do not mutate the Case | Typed validation/conflict |
| Target Doctor is no longer Verified | Doctor claim or Admin assignment | No assignment mutation | Typed unavailable-Doctor response |
| Assignment is rejected | Case assignment does not change | Existing Doctor remains able to access the Case and Documents | No false success response |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` -- assignment, Specialty, status, and SLA fields already exist; no migration.
- `src/modules/cases/repository.ts` -- reuse classification's optimistic `updateMany` pattern.
- Cases service/state machine -- own assignment guards and `Submitted → UnderReview`.
- Doctors service -- verify targets and specialties; avoid cross-module reads.
- Doctor queue API/page -- expose version, claim, and conflict refresh.
- Admin API/page -- list active Cases and select verified targets.
- Cases service/route tests -- extend race and authorization fixtures.
- Keep `selectedDoctorId` separate from `doctorId`.


## Tasks & Acceptance

**Execution:**
- [x] Cases repository/service/routes -- atomic versioned assignment, role/status/Specialty checks, and typed conflicts.
- [x] Doctor queue/Admin assignment APIs and pages -- claim, assign, reassign, Admin review-start, and conflict refresh.
- [x] Cases/Doctors tests -- cover races, authorization, targets, transitions, no-op, and SLA/preference preservation.

**Acceptance Criteria:**
- Given an unassigned Submitted Case and a matching Verified Doctor, when claimed at the current version, then the atomic operation assigns them, increments the version, and starts UnderReview.
- Given competing claims or a stale version, when assignment runs, then at most one succeeds and conflicts cause no unintended mutation.
- Given a Submitted Case with a Patient-selected Doctor, when Admin confirms that same verified, matching Doctor, then UnderReview starts without changing assignee.
- Given an unassigned Submitted Case, when Admin assigns a verified matching Doctor, then the Case enters UnderReview through the same operation.
- Given an active assigned Case, when Admin reassigns to a verified matching Doctor, then only assignee/version change; status and SLA timestamps remain unchanged.
- Given the current Doctor or an invalid/out-of-Specialty target, when Admin submits assignment, then no unnecessary version increment or unauthorized mutation occurs.
- Given any successful assignment, when the Case/Document is accessed, then `selectedDoctorId` stays unchanged and access follows the active assignee.

## Implementation Notes

## Spec Change Log

- Review loop 1: The user chose Admin confirmation of the Patient-selected Doctor to move a Submitted Case into UnderReview. Added the transition to the frozen intent and Admin assignment tasks/acceptance; this avoids leaving an assigned Case permanently hidden from Claim and ineligible for Story 4.3.

## Review Triage Log

- blind-hunter: Admin UI omits Case ID — medium; similar rows are hard to distinguish; patch.
- blind-hunter: Admin list includes terminal rows — medium; repository returns every submitted Case but only active statuses are assignable; patch filter.
- blind-hunter: current assignee may lack a displayed name — false; supported verification changes apply only to Pending Doctors.
- blind-hunter: post-write reread may show a later assignment — medium; return the row/version changed by this write; patch.
- blind-hunter: selecting current Doctor increments version — low; avoid a needless no-op write.
- blind-hunter: spec encoding is corrupt — false; only the temporary diff display was garbled.
- blind-hunter: DB race test is missing — medium, unverified; atomic predicate is unit-tested, PostgreSQL is blocked by P1000; defer.
- blind-hunter: rejected reassignment removes old Doctor access — false; service test confirms the prior Doctor still reads the Document.
- blind-hunter / verification-gap: Admin endpoints lack unauthorized tests — medium; add unauthenticated and Doctor-role requests to both route tests; patch.
- edge-case-hunter: Int32 version overflow — low; requires over 2.1 billion assignments; reject as negligible.
- verification-gap: page request wiring lacks UI tests — medium, unverified; no page-test harness exists; defer.
- implementation review: Patient-selected Cases cannot enter UnderReview — medium, intent_gap; resolved in loopback by adding Admin confirmation of the existing assignee.
- re-review: Case ID is rendered in the Admin row — false; current page includes `Case ID: {caseRecord.id}`.
- re-review: assignment list includes terminal statuses — false; repository filters to Submitted, UnderReview, and MoreInfoRequested.
- re-review: successful assignment may return a later concurrent Doctor — false; repository returns only the conditional-write count and service returns the state it attempted, not a post-write reread.
- re-review: same-Doctor assignment increments the lock — false; no-op path returns without calling the repository write.
- re-review: assignment conflict and stale selection notices are lost — fixed; notices survive refresh and selections are reconciled against refreshed targets.
- re-review: uncertain network failure leaves stale assignment state — fixed; claim and Admin handlers refresh while showing an outcome-uncertain notice.
- re-review: Admin no-op message says assignment changed — fixed; no-op has distinct feedback.
- re-review: Admin list overfetches clinical data/Documents — fixed; repository selects only fields used by the list.
- re-review: Admin specialty lookup is N+1 — fixed; use one verified directory and one active-specialty mapping.
- re-review: Admin list lacks a manual refresh action — fixed; assignment section now has Refresh assignments.
- re-review: Admin SLA countdown is absent — low, rejected; this story's SLA visibility is in the Doctor queue; Admin assignment remains urgency-ordered.
- re-review: no database-backed concurrent claim test — medium, unverified; PostgreSQL returns P1000, so defer until credentials are available.
- re-review: Doctor/Admin assignment UI interactions are untested — medium, unverified; no UI test harness exists, so defer until one is available.
- re-review: no-op lookup may race with reassignment — false; the initial versioned read is the no-write operation's linearization point.
- re-review: target verification may change before assignment — false for supported operations; Verified status and Doctor specialties are not mutable after approval in current services.
- re-review: Int32 lock overflow — low, rejected as operationally negligible.
- re-review verification: claim response version was not tested — false; service and route tests assert `assignmentLockVersion`.
- re-review verification: Admin active-state repository filter was untested — fixed; direct repository test asserts Specialty, status, timestamp, ordering, and selected fields.
- current blind review: assignment conflict error is cleared by the refresh effect — medium; 409 sets an error and increments `refreshKey`, but queue load clears the error before display; patch by retaining conflict notice through refresh.
- current blind review: stale Doctor selection survives Admin queue refresh — medium; retained ID may no longer be in `availableDoctors` and is still submitted; reconcile selection state against refreshed targets; patch.
- current blind review: network failure after a committed write leaves stale UI state — medium; Admin and Doctor catch blocks do not refresh; patch by refreshing while retaining an outcome-uncertain notice.
- current blind review: no-op confirmation says the Case was assigned — low; distinguish unchanged assignment from assignment/reassignment; patch wording.
- current blind review: Admin assignment list lacks a refresh control — low; add a direct refresh action for concurrent Admin changes; patch.
- current blind review: Admin worklist performs one Doctor specialty query per verified Doctor — medium; query count grows with directory size; patch via one batch specialty mapping.
- current blind review: assignment response loads Documents/recommendation/additional details that its UI does not use — medium; minimize query selection and response fields; patch.
- current blind review: Admin assignment queue omits SLA remaining time — low; this is not required for Admin assignment and Doctor queue already presents SLA; reject as outside the current acceptance surface.
- current blind review: reassigning a Patient-selected Submitted Case leaves it stuck — false; after refresh the new current Doctor is selected and the Admin action becomes Confirm review, which transitions it to UnderReview.
- current blind review: database concurrency path is not tested — medium, unverified; PostgreSQL authentication fails with P1000; defer.
- current blind review: Doctor/Admin page interactions lack page-level tests — medium, unverified; repository has no page-test harness; defer.
- current edge review: no-op result can race with a later reassignment — false; the no-write result is linearized at its initial versioned read and does not mutate state.
- current edge review: target verification can change between lookup and write — false; supported service operations cannot revoke a Verified Doctor or change Doctor specialties after verification.
- current edge review: Int32 assignment version may overflow — low; this would require over 2.1 billion assignments; reject as negligible.
- current verification review: claim version is not asserted in queue response — medium; add assertions that the queue summary/API expose the version consumed by the UI; patch.
- current verification review: Admin assignment query filter is untested — medium; route tests mock the service and service fixture duplicates the filter; add a repository query assertion; patch.
- current verification review: Doctor claim UI action is not page-tested — medium, unverified; no page harness exists; defer.
- current verification review: Admin assignment selector/request wiring is not page-tested — medium, unverified; no page harness exists; defer.
- current blind review: 409 conflict notice is cleared by refresh — medium; retain it in a notice that survives assignment-queue reload; patch.
- current blind review: stale Admin Doctor selection survives refresh — medium; discard selections not present in refreshed `availableDoctors`; patch.
- current blind review: ambiguous network failure can leave client state stale — medium; refresh after claim/assignment transport failure and state that outcome is unconfirmed; patch.
- current blind review: no-op confirmation says “assigned” — low; show that the existing assignment is unchanged; patch.
- current blind review: no assignment-list refresh action — low; add a local refresh control for concurrent Admin updates; patch.
- current blind review: Doctor specialty lookup is N+1 — medium; map directory specialty names to active Specialty IDs in one batch; patch.
- current blind review: Admin assignment query/response fetches unused documents and clinical fields — medium; select only fields consumed by the Admin list; patch.
- current blind review: Admin SLA display omitted — low; Admin SLA display is not part of this story's acceptance and Doctors already see remaining SLA; reject.
- current blind review: database-backed race test missing — medium, unverified; PostgreSQL is blocked by P1000; defer.
- current blind/verification reviews: claim and Admin page request wiring untested — medium, unverified; no UI harness; defer.
- current edge review: concurrent reassignment after no-op lookup can change the reported assignee — false; the initial versioned read is the no-op's linearization point and performs no mutation.
- current edge review: target verification can change before write — false; supported services cannot revoke a Verified Doctor or edit Doctor specialties after verification.
- current edge review: Int32 lock overflow — low; negligible for this product stage; reject.
- current verification review: queue version lacks an assertion — medium; add assertions that service and route responses expose the `assignmentLockVersion` consumed by the UI; patch.
- current verification review: Admin active-status repository filter lacks a direct test — medium; assert query excludes unclassified and terminal cases; patch.




## Design Notes

Admin targets must match the Case Specialty, and Admin assignment is limited to Submitted, UnderReview, and MoreInfoRequested. First assignment of Submitted enters UnderReview atomically. Admin confirms the existing Patient-selected Doctor to start review, and reassignment changes ownership only while preserving status, `submittedAt`, and pause history.

## Verification

**Commands:**
- `npm test` -- expected: all existing and new module tests pass.
- `npx tsc --noEmit` -- expected: no TypeScript errors.
- `npx prisma validate` -- expected: schema remains valid; no migration is expected.
- `npm run build` -- expected: claim and Admin assignment routes/pages compile.
- `npx prisma migrate status` -- expected: inspect current migration state; database-backed assignment verification requires working credentials.

**Manual checks:**
- With two Verified Doctor sessions on one queue item, claim nearly simultaneously and confirm only one succeeds; refresh the loser’s queue.
- As Admin, assign an unassigned Case and reassign an assigned Case; confirm timestamps and status remain correct on reassignment.