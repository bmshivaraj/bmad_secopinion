---
title: 'Admin Manages Specialty Catalog'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['_bmad-output/implementation-artifacts/epic-2-context.md']
baseline_commit: 'f9a386bde7c5bfba98b8d1b69936858dedf5e262'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent
**Problem:** The platform has a database-backed Specialty catalog seeded with 15 defaults, but Admin has no way to extend it without a code change and deployment.

**Approach:** Add an authenticated, add-only catalog view and creation flow to the Admin dashboard. New entries are active immediately and flow through the existing active-specialty read path used by Doctor registration and future Case selection.

## Boundaries & Constraints

**Always:** Require the existing Admin session for catalog management; have Admin orchestration call the Doctors service for Specialty data and never access Doctors-owned tables directly; list only active entries in the existing alphabetical order; trim submitted names, require 1-120 characters, and reject blanks and duplicates with typed API errors; treat names differing only by letter case as duplicates and enforce uniqueness durably; create new entries as active; make successful additions visible in the Admin list immediately; preserve existing Doctor-specialty links and the 15 seeded names.

**Never:** Add edit, remove, or deactivate actions; replace the database catalog with a code enum; change Doctor registration validation or existing Specialty assignments; add Case matching logic before its owning stories; expose catalog mutations to non-Admin callers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| View catalog | Authenticated Admin | All active specialties, alphabetically, including defaults and additions | Missing, invalid, or non-Admin session is rejected |
| Add specialty | Authenticated Admin submits a valid unique name | Active Specialty is persisted and appears in the Admin list and Doctor registration list | N/A |
| Invalid name | Blank/whitespace or over-limit name | No row is created | Typed validation error |
| Duplicate name | A Specialty with the selected duplicate semantics already exists | No duplicate row is created | Typed conflict error |
| Non-Admin mutation | Patient, Doctor, or missing/invalid session submits an add | Catalog remains unchanged | 401/403 typed error |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` and `prisma/migrations/` -- `Specialty` already has unique `name`, `active` defaulting to true, timestamps, and the Doctor join. Add a normalized uniqueness field/constraint and an additive migration to enforce case-insensitive uniqueness; backfill existing seeded rows without changing their display names or Doctor joins.
- `prisma/seed.ts` -- seeds the 15 fixed defaults with name-keyed upserts; preserve the list and idempotence, and populate the normalized uniqueness key for each default.
- `src/modules/doctors/domain/index.ts`, `src/modules/doctors/repository.ts`, and `src/modules/doctors/service.ts` -- validate the trimmed 1-120 character name and create an active Specialty through the Doctors service, handling database uniqueness conflicts -- preserves data ownership and makes new entries available from the existing read path.
- `src/modules/admin/service.ts` -- already owns Admin orchestration and delegates Doctor operations through `doctorsService`; add catalog list/create orchestration here.
- `src/modules/admin/routes/index.ts` -- reuse `requireAdminContext`, JSON parsing, and `toAdminErrorResponse`; map any new duplicate error to HTTP 409.
- `src/app/api/doctors/specialties/route.ts` -- public registration listing already reads the live active catalog; leave its contract intact so additions are immediately available.
- `src/app/api/admin/specialties/route.ts` and `src/app/admin/page.tsx` -- add authenticated GET/POST catalog operations and a Specialty view/form within the existing logged-in Admin dashboard; preserve the verification queue.
- `src/modules/doctors/service.test.ts`, `src/modules/admin/service.test.ts`, and `src/modules/admin/routes.test.ts` -- extend existing fixtures to cover validation, uniqueness, role authorization, immediate list visibility, and unchanged Doctor specialty behavior.
## Tasks & Acceptance

**Execution:**
- [x] `src/modules/doctors/domain/index.ts`, `repository.ts`, and `service.ts` -- validate and create an active Specialty through the Doctors service, handling unique conflicts -- preserves data ownership and makes new entries available from the existing read path.
- [x] `prisma/schema.prisma`, `prisma/migrations/`, and `prisma/seed.ts` -- add/backfill the case-insensitive uniqueness key while preserving default names and idempotence -- prevents case-only duplicates, including concurrent writes.
- [x] `src/modules/admin/service.ts`, `src/modules/admin/routes/index.ts`, and `src/app/api/admin/specialties/route.ts` -- add Admin-authenticated catalog listing and creation endpoints via `doctorsService` -- prevents non-Admin writes and avoids cross-module repository access.
- [x] `src/app/admin/page.tsx` and `src/app/globals.css` -- add an authenticated catalog view and add form with loading, validation, duplicate, success, and empty states -- lets Admin manage the catalog in place.
- [x] Doctor and Admin tests -- cover active listing, successful creation and immediate visibility, invalid/duplicate names, role gates, and preservation of existing Doctor assignments -- verifies the matrix.

**Acceptance Criteria:**
- Given an authenticated Admin, when they open the Specialty view, then it lists every active Specialty, including all seeded defaults and previously added entries.
- Given an authenticated Admin submits a valid new name, when creation succeeds, then it is active and immediately appears in both the Admin catalog and the existing Doctor registration listing.
- Given a Specialty already exists, when an Admin submits its name with different casing, then the API returns a typed conflict and retains a single catalog entry.
- Given an existing Doctor or Case record, when an Admin adds a Specialty, then the existing record and its Specialty relationships remain unchanged.
- Given a missing, invalid, Patient, or Doctor session, when it requests the Admin catalog or submits a Specialty, then the operation is denied and no data changes.
- Given the Admin views a Specialty, when they look for edit, removal, or deactivation controls, then none are available in v1.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

FR-15 is assigned to Admin and Doctors modules, and AD-2 requires Admin to call the Doctors service. The active listing already orders names alphabetically and is consumed dynamically by Doctor registration, so new entries should be written to the same table and returned through that existing path. Case specialty selection is a future consumer; this story establishes catalog data only.

## Verification

**Commands:**
- `npm test` -- expected: Patient, Doctor, and Admin suites pass with new catalog coverage.
- `npx tsc --noEmit` and `npm run build` -- expected: Admin catalog UI and API compile and build.
- `npx prisma validate` and `npx prisma generate` -- expected: Specialty uniqueness schema validates and the Prisma client is generated.
- `npx prisma migrate dev --name specialty_case_insensitive_names` -- expected: additive normalized-key migration applies and existing Specialty rows retain their names and relations.

**Manual checks:**
- Sign in as Admin, add a Specialty, verify it appears in the catalog and Doctor registration list; verify an unauthenticated caller cannot add one.

- Added the normalized Specialty name and unique constraint, migration backfill, and seed normalization for case-insensitive uniqueness while preserving display names and Doctor joins.
- Added Doctors-owned active Specialty creation with 1-120 character validation and typed uniqueness conflicts; Admin catalog GET/POST delegates through `doctorsService`, and the Admin dashboard lists and adds active entries without leaving the verification queue.
- `npm test` passed all 71 tests; `npx tsc --noEmit`, `npx prisma validate`, `npx prisma generate`, and `npm run build` passed. Route tests cover Admin, Doctor, Patient, missing, and invalid sessions for catalog operations.
- Review fixes prevent adds during the initial catalog load, distinguish failed loads from an empty catalog with a retry action, and invalidate in-flight catalog fetches after logout.
- Migration application and database-backed verification remain unverified: `npx prisma migrate dev --name specialty_case_insensitive_names` failed with PostgreSQL `P1000` because configured credentials were rejected. No migration success is claimed.

- blind-hunter: existing case/whitespace collisions may block the migration -- **maybe-false (medium, unverified)**. The repository seeds only 15 names that normalize uniquely and had no Specialty-create application path before this story, but deployed rows could not be inspected after PostgreSQL returned `P1000`; deferred for database verification.
- blind-hunter: `BTRIM` and JavaScript `trim()` differ for some whitespace -- **false**. Existing rows come from the fixed seed list with no leading/trailing whitespace, and all new application writes trim before normalization.
- blind-hunter: Unicode full case-folding can differ from `toLowerCase()` -- **low**. The current catalog vocabulary and user-facing application are English; full Unicode case folding would add a new normalization contract and database backfill complexity for an uncommon v1 input.
- blind-hunter: a direct database writer could mismatch `name` and `normalized_name` -- **false**. The application has only the Doctors-service create path and seed writer for Specialty rows, and both derive the normalized value from the display name before the unique constraint is applied.
- blind-hunter: add submission can race the initial catalog fetch -- **medium**. Patched by disabling the add controls and guarding submit until the first Specialty load finishes, preventing a stale GET response from hiding a successful addition.
- blind-hunter: load failure is also shown as an empty catalog -- **medium**. Patched so an errored load suppresses the empty state and displays a retry action.
- blind-hunter: catalog load failure has no retry -- **low**. Patched with a catalog retry action using the existing refresh mechanism.
- edge-case-hunter: existing normalized-name collisions could prevent migration deployment -- **maybe-false (medium, unverified)**. The fixed seed rows are unique under normalization, but the deployed database cannot be checked until valid PostgreSQL credentials are available; covered by the deferred database verification entry.
- edge-case-hunter: a late catalog response can restore authenticated state after logout -- **medium**. Patched to increment the refresh key after logout, invalidating the in-flight effect and reloading with the cleared session.
- verification-gap: no database-backed migration/backfill test -- **maybe-false (medium, unverified)**. Prisma schema/client checks and unit tests pass, but the migration could not run because of PostgreSQL `P1000`; the deferred item requires checking backfill, Doctor-Specialty links, and duplicate rejection against PostgreSQL.
