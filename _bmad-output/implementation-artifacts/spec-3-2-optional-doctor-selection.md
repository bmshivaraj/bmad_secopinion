---
title: 'Optional Doctor Selection'
type: 'feature'
created: '2026-10-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'f2bbe90fd0cbabb7fcb9a5d3c55fb5b31307f6c7'
context: ['_bmad-output/implementation-artifacts/epic-3-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Patient can create a Case draft but cannot choose a specific Doctor to review it, even when they have a preference.

**Approach:** Let an authenticated Patient browse the Doctors-owned verified directory, showing Doctor name and declared specialties, and optionally select or clear a Doctor preference for their Case draft. Persist the preference separately from `Case.doctorId` and restore it when the draft is reopened. Do not expose the Case to a Doctor before payment succeeds; Story 3.3 sets `doctorId` on successful submission.

## Boundaries & Constraints

**Always:** Require a verified Patient session; derive draft ownership from its claims; list Doctors only through the Doctors service and include only `Verified` Doctors; show only Doctor names and declared specialties, never mobile numbers, usernames, password hashes, UPI IDs, or credentials; validate any selected Doctor through the Doctors service when saved; persist the optional selection separately as a private draft preference and restore it when the draft is reopened; let the Patient clear the choice or proceed with no selection; keep the draft and selection unavailable to Doctors; preserve Cases/Doctors module boundaries and `{ data, error }` envelopes.

**Never:** Make Doctor selection mandatory; expose Pending/Rejected Doctors; access Doctor tables from Cases; assign a Doctor or expose the Case to that Doctor before successful payment; implement payment, urgency, Doctor queue, or later reassignment behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Browse directory | Authenticated Patient | Only verified Doctors are returned with the approved public fields | Missing/invalid session is unauthorized |
| Verified Doctor selected | Patient selects an entry for their own draft | The selected Doctor ID is saved as the draft preference; `Case.doctorId` remains unset | Unknown or no-longer-Verified Doctor is rejected |
| No Doctor selected | Patient leaves or clears selection | Draft remains valid and unassigned | No error; selection is not required |
| Foreign Case edited | Patient supplies another Patient's Case ID | No preference or Case data changes | Typed access denial/not-found |
| Unverified Doctor selected | Patient submits Pending, Rejected, or unknown Doctor ID | Selection is not saved | Typed validation/conflict response |

</frozen-after-approval>

## Code Map

- `src/modules/doctors/domain/index.ts`, `repository.ts`, and `service.ts` -- `DoctorSummary` and `getVerifiedDoctor(doctorId)` exist, but there is no verified-directory list operation. Add a Doctors-owned listing that filters status in the repository and returns only the approved public summary.
- `src/modules/cases/domain/index.ts` and `src/modules/cases/service.ts` -- Case drafts currently contain intake fields/documents; add an optional selection contract and call the exported Doctors service to validate/list Doctors rather than reading its repository.
- `src/modules/cases/repository.ts` and `prisma/schema.prisma` -- Case currently has no Doctor selection fields. Preserve nullable `doctorId` semantics for submission; if the human chooses persistence, add a separate optional draft selection field without a cross-module foreign key.
- `src/modules/cases/routes/index.ts` and `src/app/api/cases/` -- authenticated draft and readiness routes exist; extend those contracts for a verified-directory read and draft selection update while retaining owner checks and private no-store behavior.
- `src/app/cases/new/page.tsx` -- Story 3.1 intake page already saves/loads the patient's latest draft and renders readiness; add optional browse/select/clear UI that never blocks document readiness or payment progression.
- `src/modules/cases/service.test.ts`, `src/modules/cases/routes.test.ts`, Doctor tests, and `package.json` -- reuse Node `tsx --test` fixtures and include coverage for verified-only filtering, selection ownership/validation, optional clearing, and the chosen persistence behavior.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/doctors/domain/index.ts`, `src/modules/doctors/repository.ts`, and `src/modules/doctors/service.ts` -- expose a verified-only Doctor directory with only patient-approved public fields -- keeps filtering and Doctor data ownership in Doctors.
- [x] `src/modules/cases/domain/index.ts`, `src/modules/cases/service.ts`, and `src/modules/cases/repository.ts` -- list verified Doctors through the Doctors service and validate/save/clear a Patient's optional draft selection -- prevents arbitrary or unverified assignments.
- [x] `prisma/schema.prisma` and a new migration -- add a nullable `selectedDoctorId` draft-preference column, separate from `Case.doctorId` -- preserves module isolation and payment gating.
- [x] `src/modules/cases/routes/index.ts` and `src/app/api/cases/` -- add authenticated verified-directory and owner-scoped selection operations -- rejects unauthorized and foreign-Case writes.
- [x] `src/app/cases/new/page.tsx` and `src/app/globals.css` -- add optional verified-Doctor browsing, selection, clearing, and empty/loading/error states -- gives Patients control without blocking an unassigned Case.
- [x] Cases/Doctors tests and `package.json` -- cover verified-only results, invalid/stale IDs, owner access, optional no-selection behavior, and selection persistence/clearing -- verifies the acceptance matrix.

**Acceptance Criteria:**
- Given an authenticated Patient, when they browse Doctors for their draft, then only `Verified` Doctors are returned through the Doctors service.
- Given a Patient selects a verified Doctor, when the choice is saved, then it is associated only with their draft and does not expose or assign the Case before payment succeeds.
- Given a Patient makes no selection or clears one, when the draft is saved, then the Case remains valid and unassigned.
- Given a Patient reopens a draft, when a Doctor preference was saved, then the same verified Doctor is shown as selected.
- Given an invalid or unverified Doctor ID, when the Patient attempts to select it, then the selection is rejected and existing draft state remains unchanged.

## Implementation Notes

- Added a Doctors-owned verified directory projection with only Doctor ID, name, and specialty names. Cases exposes it to Patient sessions and validates saved selections through `getVerifiedDoctor`.
- Added nullable `selectedDoctorId` to the private Case draft and a migration; it remains distinct from `Case.doctorId`, which Story 3.3 sets on paid submission.
- Added selection save/clear, restore-on-reopen, no-selection and unavailable-directory UI states, plus private no-store directory/selection routes.
- Review fixes trim Doctor IDs consistently, test the Prisma patient-and-Draft update predicate and the PATCH role gate, and clarify the conflict message for unknown/unverified IDs.
- `npm test` passed all 91 tests; `npx tsc --noEmit`, `npx prisma validate`, `npx prisma generate`, and `npm run build` passed.
- `npx prisma migrate status` returns PostgreSQL `P1000`; no migration was applied. The integrated browser tool timed out, so the UI select/save/reload flow remains unverified by browser automation.

## Spec Change Log

## Review Triage Log

- **false** — Blind Hunter: the Doctor-specialty separator is U+00B7 (`·`) in the source; the garbling occurred only in diff rendering.
- **false** — Blind Hunter: the frozen-intent marker contains a valid em dash in the source; the reported `ΓÇö` is an encoding/rendering artifact.
- **low | patch** — Blind Hunter: whitespace-padded Doctor IDs previously passed non-empty validation but were looked up with whitespace; Cases now trims before validation and persistence, and regression coverage verifies normalization.
- **maybe-false | defer** — Blind Hunter: a Doctor may become unverified between save-time validation and draft update; the current Story 3.2 contract validates on save, while Story 3.3 must revalidate before setting `Case.doctorId` at submission. A test/review of that submit-time gate will settle the remaining race exposure.
- **maybe-false | defer** — Blind Hunter: returning the entire verified directory may become slow as the Doctor catalog grows; there is no current directory-size or latency target. Establish expected catalog size/performance targets before adding pagination/search complexity.
- **low | patch** — Blind Hunter: the selection PATCH route lacked direct unauthenticated/wrong-role assertions; route tests now verify both return 401 without relying on service stubs for authorization.
- **maybe-false | defer** — Blind Hunter: selection persistence has not been verified against the migration-backed database; Prisma validation/client generation pass, but PostgreSQL credentials return `P1000`. A working test database and reload assertion would settle this.
- **low | patch** — Blind Hunter: one conflict message described an ID as “no longer available” even when it was unknown or never verified; it now accurately says the Doctor is not verified or available.
- **low | patch** — Verification Gap Reviewer: the Prisma selection write had no direct test; added a repository test asserting the `patientId`/`Draft` predicate, `selectedDoctorId` write, and returned selection.
- **low | defer** — Verification Gap Reviewer: no automated browser test covers select/save/reload UI behavior; the repository has no component/browser test harness and the integrated browser service timed out. Revisit when browser automation is available; service and route behavior are covered by `npm test`.

## Design Notes

AD-5 places actual `Case.doctorId` assignment at submission, and Story 3.2 precedes Story 3.3. Keep `selectedDoctorId` as a private draft preference; payment/submission remains the transition that sets `doctorId`. The directory response contains Doctor name and declared specialties only, not `DoctorSummary` account identifiers.

## Verification

**Commands:**
- `npm test` -- expected: all Patient, Doctor, Admin, and Cases tests pass.
- `npx tsc --noEmit` and `npm run build` -- expected: directory and selection UI/API compile.
- `npx prisma validate` and `npx prisma generate` -- expected: any approved draft selection field validates and client types generate.
- `npx prisma migrate status` -- expected: inspect status; do not claim database-backed persistence unless credentials permit it.

**Manual checks:**
- Browse as a Patient, select and clear a verified Doctor, resume the draft if persistence is selected, and confirm selection does not mark the Case submitted or expose it in Doctor workflows.