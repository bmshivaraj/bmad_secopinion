---
title: 'Admin Case Routing Correction'
type: 'feature'
created: '2026-10-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '493b8cbf127d660654521e0008fe3eff52996c90'
context: ['_bmad-output/implementation-artifacts/epic-4-context.md', '_bmad-output/implementation-artifacts/spec-4-1-specialty-filtered-case-queue-with-sla-visibility.md', '_bmad-output/implementation-artifacts/spec-4-2-claim-or-admin-assign-a-case.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Admin Active Case assignments view only offers Doctors compatible with the Case's existing Specialty, and it does not let Admin correct that Specialty. If a Patient selected the wrong Doctor or the Case was classified incorrectly, Admin cannot route it to the appropriate Doctor/Specialty.

**Approach:** Add Specialty and Doctor selectors to each Admin routing row while a Case is still `Submitted`, including a Case with a selected/assigned Doctor that has not yet started review. Specialty choices come from the active catalog; Doctor choices include every verified Doctor compatible with the currently selected Specialty and show each Doctor's specialties. Save the new routing as one owner-authorized, optimistic-locking operation. The review starts at `Submitted → UnderReview`; after that transition, lock both Doctor and Specialty, including while `MoreInfoRequested`.

## Boundaries & Constraints

**Always:** Only Admin sessions may change Case routing, and only while status is `Submitted`. Derive available specialties and Doctors through their owning services; permit only active Specialties and currently Verified Doctors whose declared specialties include the selected Case Specialty. Persist Specialty and Doctor together with the current `assignmentLockVersion` so stale edits cannot partially apply. Preserve `selectedDoctorId`, `submittedAt`, and SLA pause history. Use private envelopes and retain current assignment behavior when the Admin makes no changes.

**Never:** Allow Patients or Doctors to edit Case routing; accept unverified, unknown, or specialty-incompatible Doctor IDs; bypass optimistic locking; reassign a Doctor or change Specialty after review begins (`UnderReview` or `MoreInfoRequested`); change payment/refund state; reset SLA timestamps; or edit the Patient's original Doctor preference.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Correct Submitted Case routing | A Case is still Submitted, whether unassigned or assigned to a Doctor who has not started review; Admin chooses an active Specialty and compatible verified Doctor | Save the pair atomically; Admin may then confirm review | Private success envelope |
| Specialty changes | New Specialty selected while status is Submitted | Doctor options refresh to every verified Doctor compatible with that Specialty; labels identify name and specialties | Keep Save disabled if no compatible Doctor exists |
| Review already started | Case is UnderReview or MoreInfoRequested | Doctor and Specialty remain locked; no routing write occurs | Typed conflict; refresh current row |
| Stale routing row | Expected assignment version is old | No Specialty or Doctor field changes | Typed version conflict; refresh row |
| Wrong-role or invalid target | Non-Admin, inactive Specialty, or incompatible/unverified Doctor | No routing changes | 401/403 or typed validation/conflict |

</frozen-after-approval>

## Code Map

- `src/app/admin/page.tsx` -- Active Case assignments currently display a fixed Specialty and a Doctor selector sourced from `availableDoctors`; add Specialty selection, compatible Doctor refresh, and a combined save action.
- `src/modules/cases/service.ts` -- `listAdminAssignmentCases` already joins verified Doctors and active Specialties; add a Submitted-only atomic routing correction and make assignment guards reject reassignment after review starts.
- `src/modules/cases/repository.ts` -- `assignCaseToDoctor` uses `assignmentLockVersion`; add a conditional write for the combined Specialty/Doctor correction and preserve status/SLA.
- `src/modules/cases/routes/index.ts` and `src/app/api/admin/cases/[caseId]/assignment/route.ts` -- extend assignment parsing/response for Specialty and retain `requireAdminContext`.
- `src/modules/doctors/service.ts` -- reuse `listVerifiedDoctors` and `listActiveSpecialties`; do not read Doctor or Specialty tables from Cases/Admin.
- `src/modules/cases/service.test.ts` and `src/modules/cases/routes.test.ts` -- cover compatible targets, changed Specialty, stale versions, status/SLA/preference preservation, and authorization.
- `src/modules/admin/routes.test.ts` -- cover the Admin UI's profile-free routing API contract as needed.

## Tasks & Acceptance

**Execution:**
- [x] Add an atomic Cases service/repository operation to update Specialty and Doctor on Submitted Cases under the current assignment version.
- [x] Restrict Admin assignment/reassignment to Submitted Cases; reject changes once UnderReview begins, including while MoreInfoRequested.
- [x] Extend the Admin routing API and UI with active Specialty selection and all verified Doctors compatible with that selection.
- [x] Preserve Case status, SLA timestamps, and `selectedDoctorId`; do not create new charges or payouts for routing corrections.
- [x] Add Cases service/repository and Admin route tests for compatible options, atomic writes, review locks, stale conflicts, and role authorization.

**Acceptance Criteria:**
- Given an Admin views an active Case, when Specialty changes, then the Doctor selector offers all verified Doctors compatible with the selected Specialty, with their specialty names visible.
- Given an Admin saves a valid Specialty/Doctor pair, when the assignment version is current, then both routing values are applied atomically and the assigned Doctor matches the Specialty.
- Given an invalid target or stale assignment version, when routing is saved, then neither Specialty nor Doctor changes.
- Given a Specialty/Doctor correction, when the update succeeds, then the Patient's original `selectedDoctorId`, `submittedAt`, and SLA pause history are preserved.
- Given a Case reaches `UnderReview`, when Admin attempts to change its Doctor or Specialty, then the write is rejected and the assignment remains unchanged, including during `MoreInfoRequested`.

## Implementation Notes

- Added `correctSubmittedCaseRouting` and a conditional repository write that compare-and-swaps the prior Specialty, Doctor, status, and assignment version, updates the pair together, and moves the Case to `UnderReview`.
- Changed the existing Admin assignment operation to reject any routing changes after `Submitted`; Doctor claims remain limited to unassigned Submitted Cases.
- The Admin assignment projection now includes all verified Doctors with active Specialty names/IDs. Submitted rows expose paired selectors and a combined confirm action; UnderReview and MoreInfoRequested rows show a locked routing state.
- Correction preserves the Patient's `selectedDoctorId`, submission timestamp, and SLA history. Payment and payout logic remain unchanged: one Case charge and at most one payout to the Doctor who closes the Case with the final Opinion.
- Verification passed: `npm test` (202 tests), `npx tsc --noEmit`, and `npm run build`. The live Admin queue returned the target Submitted Case with the complete verified Doctor directory. The integrated browser connection was unavailable, so the click interaction was not browser-automated.

## Spec Change Log

- Completed Admin routing correction review and validation; added defensive handling for a missing verified Doctor directory and concurrent-correction coverage.

## Review Triage Log

- medium (patch) — Blind Hunter: an older/mismatched Admin assignment response without `verifiedDoctors` crashed the new row initialization; the UI now handles the absent directory, shows a refresh warning, and disables routing controls until options are available.
- false — Blind Hunter: both Specialty and Doctor selectors are disabled while `busyAssignmentCaseId` is non-null, so their values cannot be changed during a save.
- false — Blind Hunter: a separate confirmation dialog is not required; the action explicitly says “Save routing and start review” and the spec defines confirmation as the transition that locks routing.
- false — Blind Hunter: the native Doctor option text contains the Doctor name and all specialty names, which are exposed as the option's accessible text.
- false — Blind Hunter: Specialty fetch failures leave loading state, set `specialtyError`, and expose a Retry control in the Specialty catalog section.
- false — Blind Hunter: the correction service returns `specialtyId`, and the route test now asserts the complete correction response body.
- medium (patch) — Blind Hunter: same-version concurrent corrections lacked service coverage; added a race test proving one winner, one version conflict, and a single increment.
- low (rejected) — Blind Hunter: changed fields have no separate highlight, but the save action changes to “Save routing and start review” whenever the pair differs; additional visual state is not needed to understand the operation.
- false — Blind Hunter: the UI handler checks `caseRecord.status === "Submitted"` and the API/service independently reject non-Submitted corrections.
- low (rejected) — Blind Hunter: there is no component test for the empty compatible-Doctor state; the UI explicitly renders a no-compatible-Doctor option and disables saving, while service/route tests cover incompatible targets. Adding a UI harness solely for this state is disproportionate.
- false — Edge Case Hunter: `SessionAuthorizationError` is defined and exported in the Doctors domain and used by the existing payout-profile route.
- false — Edge Case Hunter: `patientsRepository.findById` exists and is used by existing Patient service operations.
- false — Edge Case Hunter: `doctorsRepository.findById` exists; the new identity projection uses the separate Doctors-owned `findIdentityProfileById` method.
- false — Edge Case Hunter: the selected Doctor identity fields are required in the Prisma schema and the repository returns a typed projection; no nullable account fields are rendered as `undefined`.
- low (rejected) — Verification Gap Reviewer: the SSR test does not execute the client-side fetch effect; role API tests and live authenticated checks cover the endpoints, while the integrated browser runner was unavailable and the repository has no DOM test harness.
- low (rejected) — Verification Gap Reviewer: the Patient profile page has no component test; its API/service and live page checks passed, and adding a UI test framework for this read-only view is disproportionate.
- low (rejected) — Verification Gap Reviewer: the Doctor identity section has no component test; service/route tests and live profile checks passed, and the existing payout flow remains unchanged.
- low (rejected) — Verification Gap Reviewer: the Admin profile page has no component test; service/route tests and live profile checks passed, and adding a UI framework is outside this routing-focused work.

## Design Notes

The Doctor selector should be filtered by the selected Specialty but enumerate every compatible verified Doctor; this avoids presenting assignments the service will reject. A combined save is needed so the Case cannot be left with a new Specialty and stale Doctor between separate API calls. A Case has one patient charge and at most one payout, to the Doctor who closes it with the final Opinion; pre-review routing corrections do not create additional payment or payout records.

## Verification

**Commands:**
- `npm test` -- expected: Cases and Admin route/service tests pass with the new routing matrix.
- `npx tsc --noEmit` and `npm run build` -- expected: Admin controls and the combined routing endpoint compile.
- Authenticated HTTP checks -- expected: only Admin can perform a routing correction; invalid/stale writes leave both fields unchanged.
