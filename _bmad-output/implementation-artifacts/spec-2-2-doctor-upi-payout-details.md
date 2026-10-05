---
title: 'Doctor UPI Payout Details'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'f416af27cfb97e7b6b451a35164a850098f617b2'
context: ['_bmad-output/implementation-artifacts/epic-2-context.md', '_bmad-output/planning-artifacts/epics.md', '_bmad-output/planning-artifacts/prds/prd-secopinion-2026-09-20/prd.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Doctors need a valid payout destination, but Doctor accounts do not yet store a UPI ID or provide a way to manage one.

**Approach:** Add an optional UPI ID during Doctor registration and a minimal authenticated profile/settings experience to view and update it. Validate basic `local-part@handle` syntax only; do not contact a bank or NPCI service.

## Boundaries & Constraints

**Always:** Persist the payout ID on the Doctor record, independent of Patient accounts; permit signup without an ID but prevent future payouts until one is set; allow each Doctor to update their own ID regardless of verification status; authenticate profile access from the Doctor session and derive the Doctor ID from its verified claims; return typed validation errors in `{ data, error }` envelopes; allow duplicate UPI IDs unless a later product requirement establishes uniqueness; keep already-disbursed payout destinations and records unchanged.

**Never:** Implement a payout job, payment-provider integration, payout history, real-time bank/NPCI verification, Admin editing, or Patient payout fields; accept a Doctor ID from the caller as authority to edit another account; mutate previously disbursed payout records.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register with a UPI ID | OTP-authorized Doctor submits a syntactically valid optional ID | Doctor and ID are stored together | Success envelope |
| Register without a UPI ID | OTP-authorized Doctor leaves the optional field empty | Doctor is created with no payout destination | Success envelope |
| Register or update malformed ID | Empty-on-update, whitespace, missing local part/handle, or extra `@` | No invalid value is persisted | Typed `INVALID_UPI_ID`; existing value remains unchanged |
| View payout details | Authenticated Doctor requests their profile payout details | Only that Doctor's current ID (or unset state) is returned | Missing/invalid session is unauthorized |
| Update payout details | Authenticated Doctor submits a valid replacement ID | Only the session owner's record is updated; later payouts use the new destination | Other roles cannot update it |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` and `prisma/migrations/` -- add nullable `Doctor.upiId` mapped to `upi_id`; this is an additive migration and must not change Patient data.
- `src/modules/doctors/domain/index.ts` -- add basic syntax validation and a typed invalid-UPI error alongside existing Doctor validation rules.
- `src/modules/doctors/repository.ts` -- persist optional registration value, retrieve the current Doctor payout value, and update it within the Doctors-owned repository.
- `src/modules/doctors/service.ts` -- validate registration/update inputs and expose owner-scoped read/update operations; do not call Payments or accept caller-supplied owner IDs.
- `src/modules/doctors/routes/index.ts` and `src/app/api/doctors/` -- extend the multipart registration parser and add authenticated GET/PATCH payout-profile handlers using the existing HttpOnly Doctor session and envelope/error mapping.
- `src/app/doctors/register/page.tsx` -- add an optional UPI input with server-aligned validation feedback.
- `src/app/doctors/profile/page.tsx` (new) and `src/app/doctors/login/page.tsx` -- add a compact self-service edit screen and a sign-in path to it; show the saved value and handle missing/expired sessions.
- `src/modules/doctors/service.test.ts` -- extend the existing fixture and cover optional registration, valid/invalid updates, read ownership, and authorization failures.
- `src/modules/payments/` -- leave unchanged; Epic 5's payout flow must read the current Doctor destination and preserve the destination used for each completed disbursement.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` and a new migration -- add nullable Doctor UPI storage -- supports signup without breaking existing Doctor rows.
- [x] `src/modules/doctors/domain/index.ts` -- implement basic UPI syntax validation and a typed error -- keeps validation consistent across entry points.
- [x] `src/modules/doctors/repository.ts` and `src/modules/doctors/service.ts` -- persist optional signup values and provide owner-scoped read/update operations -- keeps Doctor data within its module boundary.
- [x] `src/modules/doctors/routes/index.ts` and `src/app/api/doctors/profile/upi/route.ts` -- parse and authorize GET/PATCH requests -- prevents cross-account edits and returns standard envelopes.
- [x] `src/app/doctors/register/page.tsx`, `src/app/doctors/profile/page.tsx`, and `src/app/doctors/login/page.tsx` -- collect, view, and update payout details -- exposes the approved Doctor workflow.
- [x] `src/modules/doctors/service.test.ts` -- cover signup, validation, update ownership, and unauthorized requests -- verifies the edge-case matrix.

**Acceptance Criteria:**
- Given a Doctor registration with a valid UPI ID, when the application is submitted, then the ID is stored on that Doctor account.
- Given a Doctor registration with no UPI ID, when the application is submitted, then registration succeeds and the payout destination remains unset.
- Given a malformed UPI ID at registration or update, when the request is submitted, then the API returns typed validation failure and does not persist the invalid value.
- Given an authenticated Doctor, when they open payout settings, then they see only their current UPI ID or an unset state and can replace it with a valid ID.
- Given a user with no Doctor session or a session for another role, when they read or update a Doctor payout destination, then access is rejected; a caller cannot select another Doctor by supplying an ID.
- Given a Doctor updates their UPI ID, when future payout processing is implemented, then it uses the updated ID and does not rewrite the recipient recorded for any payout already disbursed.
- Given a Doctor has no valid UPI ID, when payout processing is implemented, then no payout is disbursed until a valid ID is stored.

## Implementation Notes

- Added nullable `Doctor.upiId`, an additive SQL migration, and shared basic-format validation for optional signup input and authenticated profile updates.
- Added owner-scoped GET/PATCH payout profile API operations. They derive ownership from the verified Doctor session, and successful Doctor login routes to the profile page.
- Profile settings show the current or unset destination and allow a valid replacement; no payment or payout implementation was added.
- The API/service tests cover optional signup, malformed values, existing-value preservation after invalid updates, ownership, and unauthorized roles.
- Review fixes preserve verification status after sign-in, limit UPI IDs to 255 characters with separator-aware syntax, mark profile GET responses private/no-store, and keep retry/save-error recovery available. Unset profiles explain that payouts cannot be sent until an ID is saved.

## Spec Change Log

## Review Triage Log

- **medium | patch** — Blind Hunter: successful login stopped displaying verification status. Restored the status notice and added a payout-settings link; browser verification confirmed both remain visible after sign-in.
- **medium | patch** — Blind Hunter: UPI syntax accepted trailing/repeated separators. Tightened the shared server rule and matching browser patterns; tests and browser validity checks reject malformed placement.
- **low | patch** — Blind Hunter: UPI IDs had no length limit. Capped values at 255 characters in server validation and both inputs, with over-limit regression coverage.
- **medium | patch** — Blind Hunter: profile GET exposed a payout identifier without explicit cache policy. Added `private, no-store` and an API response-header assertion.
- **low | patch** — Blind Hunter: profile fetch failures had no retry and save failures hid the form. Added retry with loading state and separated load errors so an update can be corrected without losing the entered value.
- **medium | patch** — Blind Hunter: an unset destination did not explain payout impact. The profile now states that payouts cannot be sent until a valid ID is saved.
- **false** — Blind Hunter: login/profile browser flow was unverified. A Playwright browser run with mocked API responses exercised successful sign-in, profile link, unset state, retry, failed-save retention, and successful save.
- **maybe-false | defer** — Verification Gap Reviewer: repository persistence has only been exercised through fakes. Potential severity is medium (unverified); valid PostgreSQL credentials are needed to apply the migration and test create/read/update against the actual database.
- **low | rejected** — Verification Gap Reviewer: no automated component test asserts successful Doctor sign-in exposes payout settings. The behavior was exercised in the browser; this repository has no React/component test harness, and adding one solely for this page is disproportionate to the uncovered risk.
- **false** — Verification Gap Reviewer: successful sign-in no longer displays verification status. The restored notice displays `verificationStatus`; the browser run confirmed the Pending state is visible.
- **false** — Verification Gap Reviewer: successful login navigation to payout settings is untested. The implementation uses an explicit profile link rather than automatic redirect, and the browser run clicked it and loaded the profile.

## Design Notes

Use a nullable, non-unique Doctor field: the PRD allows adding the ID later and does not require uniqueness. Basic syntax validation is only a structural check, not proof that the handle exists or can receive funds; values are limited to 255 ASCII characters. This story has no payout ledger; Epic 5 must record the destination used by each disbursement so changing the current Doctor value cannot alter payout history.

## Verification

**Commands:**
- `npm test` -- expected: Patient and Doctor suites pass with new payout-profile cases.
- `npm run build` -- expected: registration/profile pages and GET/PATCH routes compile.
- `npx prisma validate` and `npx prisma generate` -- expected: nullable UPI field is valid in the generated client.
- `npx prisma migrate dev --name add_doctor_upi_id` -- expected: additive migration applies to PostgreSQL; report any environment/authentication blocker without claiming the migration ran.

**Manual checks:**
- Browser-tested successful Doctor sign-in, status notice, profile link, unset warning, profile retry, failed-save recovery, and successful update using mocked API responses.
- API tests reject Patient/Admin sessions and enforce owner-only read/update. Live registration persistence and database-backed repository behavior remain unverified until PostgreSQL access is available.

**Latest verification run:**
- `npm test` -- passed all 58 Patient and Doctor tests.
- `npx tsc --noEmit` -- passed.
- `npx prisma validate` and `npx prisma generate` -- passed.
- `npm run build` -- passed; `/doctors/profile` and `/api/doctors/profile/upi` were included in the route output.
- `npx prisma migrate dev --name add_doctor_upi_id` -- blocked by PostgreSQL authentication failure (`P1000`); migration was not applied.
- Playwright browser exercise with mocked API responses passed for sign-in, profile loading/error/retry, unset guidance, and UPI update UX; it did not exercise the database-backed registration path.
- Actual migration and repository persistence remain unverified until valid PostgreSQL credentials or a local database are available.