# Epic 4 Context: Doctor Case Review Workflow

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable verified Doctors to review Cases matched to their declared specialties, manage the patient-response SLA when requesting more information, and issue a written Opinion. Epic 4 builds on verified Doctor accounts and paid Case submissions, and supplies the Case closure events needed by later payout and refund workflows.

## Stories

- Story 4.1: Specialty-Filtered Case Queue with SLA Visibility
- Story 4.2: Claim or Admin-Assign a Case
- Story 4.3: Request Additional Documents
- Story 4.4: Submit Opinion and Close Case

## Requirements & Constraints

- Only Verified Doctors may access the queue. A Doctor sees Cases whose Patient-selected condition maps to any of the Doctor's declared Specialties; direct access to an out-of-specialty Case must also be denied.
- Distinguish and/or prioritize Urgent Cases. Show remaining time against the 5-day/120-hour Response SLA, accounting for pauses.
- Doctor self-claim and Admin assignment/reassignment share one optimistic-locking Cases operation. Assignment races must fail safely; reassignment does not restart the SLA.
- Requesting additional Documents transitions the Case to More Info Requested and pauses the SLA. Patient upload resumes the existing clock rather than starting a new window.
- Opinions are allowed only in the appropriate review states. Refund Pending blocks Doctor submission until Admin resolves the refund; successful Opinion closure triggers the later payout workflow.
- Medical Documents are accessible only to the Case's Patient, currently assigned Doctor, or Admin. Enforce this at the Cases service boundary before storage access.
- The planning defines the condition-to-Specialty match outcome, but not how Cases are classified or how that mapping is maintained. Resolve this dependency during Story 4.1 planning; do not infer a mapping from free text.

## Technical Decisions

- Cases owns Case state, lifecycle transitions, SLA calculations, assignment, and document authorization. Other modules use its exported service boundary; cross-module references remain IDs without database foreign keys.
- Doctor specialties are a collection. Queue matching succeeds when a Case's Specialty matches any registered Doctor Specialty.
- Assignment uses `Case.assignmentLockVersion` and one exported `assignCaseToDoctor(caseId, doctorId, expectedVersion)` operation for both Doctor claims and Admin assignment.
- Store SLA pauses as timestamp pairs `{ pausedAt, resumedAt }`. One Cases-owned `computeElapsedSlaTime(case)` function calculates elapsed time for queue display and later SLA enforcement.
- Keep the complete legal Case status graph centralized in the Cases module; all lifecycle mutations use it.

## UX & Interaction Patterns

Present a scannable Doctor queue with specialty-relevant Cases, visible urgency, and SLA time remaining. Make urgent work easy to distinguish while preserving the 120-hour response window and its paused-time behavior. Do not expose Cases or Documents beyond the Doctor's specialty and assignment permissions.

## Cross-Story Dependencies

- Depends on Epic 2 for Verified Doctor identity and multi-specialty profiles.
- Depends on Epic 3 for submitted, paid Cases and the Patient condition data used for specialty matching.
- Story 4.3's request/upload flow owns SLA pause and resume behavior; Story 4.4 closes Cases and enables Epic 5 payout processing.
- Epic 5 owns SLA-breach refund resolution and daily payout/refund operations; Epic 4 must preserve the state boundaries those workflows rely on.