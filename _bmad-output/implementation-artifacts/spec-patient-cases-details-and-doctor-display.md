---
title: 'Patient Case Details and Doctor Display'
type: 'feature'
created: '2026-10-23'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: ['_bmad-output/implementation-artifacts/epic-3-context.md', '_bmad-output/implementation-artifacts/spec-3-2-optional-doctor-selection.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Patients can see submitted Cases in Your Cases but cannot open an individual Case details view, and the list does not identify the current Doctor assigned to a Case.

**Approach:** Add a patient-owned Case details page reachable from each list item. Show the assigned Doctor's name and specialties on the list and detail view only when `Case.doctorId` resolves through the Doctors service's verified public directory; include the existing patient-safe Case history, Documents, requests, and Opinion details without exposing private Doctor account data.

</frozen-after-approval>

## Implementation Notes

- Added `GET /api/cases/{caseId}` with Patient authentication, owner/status scoping, and private no-store responses; Draft and foreign Cases return not found.
- Reused the Doctors service's verified public directory and projected only Doctor name and Specialty names into Patient Case list/detail responses.
- Added a `View details` link and assigned-Doctor summary to each Your Cases entry, plus a responsive Case details page with intake, fee/status, documents, requests, refund, and Opinion information.
- No schema migration or payment behavior changed. Verification passed: 190 tests, `npx tsc --noEmit`, `npm run build`, and HTTP smoke checks for detail-page 200, anonymous API 401, and authenticated Patient API 200.
- The first blind-review invocation inspected an unrelated foundation spec; a targeted review of the actual changed Cases files followed.

## Review Triage Log

- low (rejected) — The detail projection reads the verified Doctors directory to resolve one Doctor; there is no current directory size or latency target, and adding a new cross-module lookup API would be disproportionate.
- false — An unavailable Doctor maps to `doctor: null`; supported assignment paths require a Verified Doctor, and the Admin decision path only changes Pending verification records.
- false — The public Case projection explicitly constructs `doctor` from only `fullName` and `specialties`; it does not serialize a Doctor account object.
- false — Wrong-role requests are rejected by `requirePatientContext` with 401; foreign and Draft Cases are intentionally hidden as not found by `getPatientCase`.
- false — Draft Cases are intentionally excluded from patient history/detail; the detail page is for submitted Cases, matching the existing Your Cases list.
- false — The new detail and Doctor selectors have desktop and mobile CSS definitions in the changed `globals.css`.
