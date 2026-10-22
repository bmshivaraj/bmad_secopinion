---
title: 'Specialty-Filtered Case Queue with SLA Visibility'
type: 'feature'
created: '2026-10-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['_bmad-output/implementation-artifacts/epic-4-context.md']
baseline_commit: 'ba33d5b630f1b85c2578d8ce16fea7a785af3272'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Verified Doctors cannot find specialty-relevant Cases or see which are approaching the Response SLA.

**Approach:** Admin classifies submitted Cases with an active Specialty; Verified Doctors get a filtered queue showing urgency and SLA time. If classification conflicts with the assigned Doctor, atomically clear `doctorId` but preserve the Patient's `selectedDoctorId`. The SLA starts at successful payment submission.

## Boundaries & Constraints

**Always:** Verify Doctor role and current Verified status server-side; show only Submitted, UnderReview, or MoreInfoRequested Cases matching any Doctor specialty and either unassigned or assigned to that Doctor; keep unclassified Cases out of Doctor queues; classify only against active Specialties; store `specialtyId` as a cross-module ID without a foreign key; clear an incompatible `doctorId` atomically with optimistic locking while preserving `selectedDoctorId`; calculate remaining time from successful submission using the single Cases SLA function and pause/resume history; protect direct Case and Document access; preserve module ownership and `{ data, error }` envelopes.

**Never:** Implement Doctor self-claim, assigning/reassigning a Case to a Doctor, request-more-information actions, Opinion submission/closure, SLA-breach refunds, or payout processing; infer a Case Specialty from free text without an approved classification rule; expose Documents to an unassigned Doctor.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin classifies | Submitted, unclassified Case; active Specialty selected | Case enters matching queues; `submittedAt` is unchanged | Typed validation/conflict |
| Assigned Doctor mismatches Specialty | Selected Specialty is outside assigned Doctor's specialties | Clear `doctorId` atomically; preserve `selectedDoctorId` | Version conflict |
| Doctor opens queue | Verified session | Return classified, eligible Cases matching any specialty and assignment visibility | Private envelope |
| Unverified Doctor opens queue | Pending or Rejected account | Return no Case data | Typed forbidden |
| Doctor requests Case by ID | Case outside specialty or assigned to another Doctor | Return no Case details or Documents; do not leak existence | Not-found/access denied |
| Doctor reads Case Document | Doctor is assigned and specialty-matched | Return private Document bytes | Unassigned or non-matching Doctor is denied before storage read |
| Queue includes Urgent and Standard | Both tiers are eligible | Urgent is clearly labeled and ordered first | N/A |
| SLA is paused | Open pause interval exists | Exclude paused duration from remaining time | N/A |
| Case is unclassified | Submitted Case awaits Admin action | Hide from Doctors; show in Admin worklist | N/A |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` -- `Case` lacks Specialty, `submittedAt`, SLA pause history, and assignment lock version; reuse `DoctorSpecialty` and the Specialty catalog exposed by Doctors.
- `src/modules/cases/domain/case-state-machine.ts` -- reuse centralized lifecycle states for queue eligibility; do not add review actions.
- `src/modules/cases/service.ts` and `repository.ts` -- extend Cases-owned authorization, Admin classification, queue/detail queries, optimistic assignment clearing, and canonical SLA calculation.
- `src/modules/doctors/service.ts` and `repository.ts` -- verified directory exposes specialties, but `getVerifiedDoctor()` omits them; add a narrow current-Doctor specialty lookup rather than cross-module queries.
- `src/modules/doctors/routes/index.ts` and `src/app/api/doctors/profile/upi/route.ts` -- reuse Doctor cookie/JWT, private envelope, and route error patterns; verify current status for queue access.
- `src/app/admin/page.tsx` -- extend the existing worklist pattern with unclassified Cases and an active-Specialty selector; do not add Doctor assignment UI.
- `src/app/doctors/` -- registration, login, and profile exist; add the queue page. Reuse Cases, Doctors, and Admin test fixtures in their existing test files.

## Tasks & Acceptance

**Execution:**
- [ ] `prisma/schema.prisma` and migration -- add Case Specialty, `submittedAt`, pause history, and `assignmentLockVersion`; leave existing Cases unclassified, backfill Submitted timestamps from `updatedAt`, and add query indexes.
- [ ] `src/modules/cases/service.ts`, `src/modules/cases/repository.ts`, `src/app/api/cases/unclassified/route.ts`, `src/app/api/cases/[caseId]/specialty/route.ts`, and `src/app/admin/page.tsx` -- add Admin classification worklist; atomically clear incompatible assignment and preserve `submittedAt`.
- [ ] `src/modules/doctors/domain/index.ts`, `src/modules/doctors/repository.ts`, and `src/modules/doctors/service.ts` -- expose the authenticated Verified Doctor's specialty IDs through a narrow contract.
- [ ] `src/modules/cases/domain/`, `src/modules/cases/repository.ts`, and `src/modules/cases/service.ts` -- implement canonical SLA calculation, eligible queue/detail access, specialty filtering, and optimistic-lock assignment clearing.
- [ ] `src/app/api/doctors/queue/route.ts`, `src/app/api/doctors/queue/[caseId]/route.ts`, and `src/modules/cases/routes.test.ts` -- add authenticated queue/detail endpoints and verify authorization/error envelopes.
- [ ] `src/app/api/cases/documents/[documentId]/route.ts` and Cases tests -- allow only an assigned, specialty-matched Doctor to read Documents; deny before storage access otherwise.
- [ ] `src/app/doctors/queue/page.tsx` and `src/app/globals.css` -- provide responsive queue, urgency/SLA display, and loading/empty/error states.
- [ ] Cases/Doctors/Admin tests -- cover classification, matching, verification, assignment visibility/races, direct-access denial, pause arithmetic, and the 120-hour boundary.

**Acceptance Criteria:**
- Given a submitted unclassified Case, when Admin selects an active Specialty, then it becomes eligible for matching queues without resetting the SLA anchor.
- Given an assigned Doctor incompatible with the selected Specialty, when Admin classifies the Case, then assignment clearing is version-checked, `selectedDoctorId` is preserved, and the Case is visible only to matching Doctors.
- Given a Verified Doctor with multiple specialties, when the queue loads, then only eligible Cases matching any specialty and assignment visibility are returned.
- Given a Pending or Rejected Doctor, when they request the queue, then no Case information is returned.
- Given an out-of-specialty or other-Doctor-assigned Case ID, when requested directly, then details and Documents remain inaccessible.
- Given an assigned, specialty-matched Doctor, when they read a Case Document, then access is authorized before storage; unassigned or out-of-specialty Doctors are denied.
- Given eligible Urgent and Standard Cases, when rendered, then Urgent is labeled and ordered first.
- Given a paused Case SLA, when remaining time is calculated, then it starts at successful submission and excludes every paused interval through the single Cases function.

## Implementation Notes

## Spec Change Log

## Review Triage Log

- blind-hunter: queue timer refreshes only on load — false; Design Notes explicitly choose server recalculation on queue refresh rather than a ticking client timer.
- blind-hunter: Admin worklist lacks refresh — false; the existing Admin page refresh action reloads the worklist through `refreshKey`.
- blind-hunter: classification lacks enough case context — medium; the Admin response/UI shows body area and condition but omits recommendation, additional details, and documents needed to classify accurately; patch.
- blind-hunter: current Doctor assignment/clear consequence is hidden — medium; the worklist response has `doctorId` but the row does not display it and the success notice does not say assignment was cleared; patch.
- blind-hunter: Doctor-facing recommendation provenance is ambiguous — low; the queue labels the Patient-entered recommendation as “Recommendation”; patch the label.
- blind-hunter: queue omits the matched Specialty name — low; filtering still enforces Specialty membership and the spec does not require a per-row label; reject as non-blocking optional context.
- blind-hunter: detail requests can complete out of order — medium; all “View Case” buttons remain enabled while `openCase` is pending and no request identity check exists; patch.
- blind-hunter: queue results are unbounded — low; the current POC has no volume requirement and pagination would add new API behavior; reject pending scale evidence.
- blind-hunter: compatible assigned-Doctor classification branch lacks a test — medium; current classification test covers only clearing an incompatible Doctor; add preservation coverage.
- blind-hunter: overlapping SLA pauses lack a test — low; `computeElapsedSlaTime` merges overlapping intervals with `currentEnd`, but add a focused arithmetic test to pin that behavior.
- edge-case-hunter: positive remaining SLA below one minute renders as 0h 0m — low; the formatter floors hours/minutes without a positive sub-minute case; patch to show `<1m remaining`.
- edge-case-hunter: null urgency renders as Standard — false; permitted submission writes a non-null tier atomically with Submitted, and the migration introduces no legacy Submitted rows.
- edge-case-hunter: out-of-order detail response can replace current selection — medium; verified as the same reachable request race reported by blind-hunter; patch with a request identity guard.
- edge-case-hunter: recovery finalization resets the SLA anchor — high; `updateCaseToSubmitted` writes `new Date()` on every Draft finalization, including an already-Succeeded attempt; use the durable successful-attempt timestamp.
- verification-gap: compatible Doctor assignment preservation lacks a test — medium; the current Cases classification test asserts only the incompatible branch clears assignment; patch with a compatible branch assertion.
- verification-gap: migration backfill lacks a database-backed regression test — medium, unverified; the SQL backfills legacy Submitted rows from `updated_at`, but PostgreSQL credentials fail with P1000; defer DB-backed verification until credentials are available.

## Design Notes

Admin classifies each submitted Case; unclassified submissions stay out of Doctor queues. A mismatch clears only `doctorId` via the optimistic-locking operation, preserving `selectedDoctorId`. Order Urgent first, then least SLA time remaining; show a text label and refresh server-calculated time when loaded.

## Verification

**Commands:**
- `npm test` -- expected: all existing and new module tests pass.
- `npx tsc --noEmit` -- expected: no TypeScript errors.
- `npx prisma validate` -- expected: schema is valid.
- `npm run build` -- expected: Doctor queue route and page compile.
- `npx prisma migrate status` -- expected: inspect migration state; database-backed verification requires working credentials.

**Manual checks:**
- With a Verified Doctor session, confirm matching Cases appear, unrelated specialties and Cases assigned to another Doctor do not, urgency is clear, and SLA time reflects the 120-hour window.
- With Pending/Rejected Doctor sessions, confirm queue and direct Case requests return no Case data.