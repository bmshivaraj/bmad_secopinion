---
title: 'Admin Configures Case Fees & Platform Fee Percentage'
type: 'feature'
created: '2026-10-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: ['_bmad-output/implementation-artifacts/epic-5-context.md']
baseline_commit: 'fee39f6a7f9241e42d532b2fd7484422979d9b80'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Standard and Urgent Case fees and the Platform Fee percentage exist only as seeded settings, so an Admin cannot tune pricing without changing code or touching the database.

**Approach:** Add an Admin-only settings editor for the Standard fee, Urgent fee, and Platform Fee percentage. Validate and save the values atomically; apply Case fees to new submissions and the Platform Fee percentage to Opinions closed after the change, preserving all already-captured fees and closure-time payout snapshots.

## Boundaries & Constraints

**Always:** Only an authenticated Admin may read or update settings. Keep one Admin-owned `PlatformSettings` record and update it atomically; store and calculate with Prisma Decimal values at two decimal places. Standard and Urgent Case fees must each be strictly greater than zero; Platform Fee percentage must be between 0% and 100%, inclusive. Preserve the seeded defaults of ₹1,000 Standard, ₹2,000 Urgent, and 20% until changed. Case submission must continue to use the current fee and snapshot `chargedAmount`; Opinion closure must continue to snapshot the then-current Platform Fee percentage for Story 5.3 payouts. Changes are prospective only and must not rewrite submitted Case fees, existing closure snapshots, or calculated payout attempts. Show current values, validation errors, saving state, and save confirmation in the Admin experience.

**Never:** Let Patient or Doctor sessions access the Admin settings API; let UI or routes write the settings table outside the Admin service/repository; use floating-point arithmetic; recalculate existing Case charges or payouts; or change refund and payout provider behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid update | Admin submits all three valid values | Persist all values atomically and display the saved settings | Preserve previous settings if persistence fails |
| Invalid values | Malformed, out-of-range, or over-precision amount/percentage | Reject without changing any setting | Return field-safe validation error |
| Unauthorized access | Patient/Doctor or missing Admin session | Do not read or modify settings | Private 401/403 response |
| Prospective update | Settings change after Cases/payouts already have snapshots | New submissions/Opinions use current settings; existing snapshots stay unchanged | None |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` and `prisma/seed.ts` -- `PlatformSettings` already stores Standard/Urgent fees and Platform Fee percentage; the seed creates the default singleton values.
- `src/modules/admin/repository.ts` and `src/modules/admin/service.ts` -- repository reads the latest settings; the internal Admin service currently exposes them to Case consumers but has no Admin-authenticated update operation.
- `src/modules/admin/routes/index.ts` and `src/app/api/admin/specialties/route.ts` -- reuse Admin-cookie authentication, JSON parsing, private cache headers, and typed error responses for the new settings API.
- `src/app/admin/page.tsx` -- current Admin dashboard hosts Specialty and Case worklists; add a settings editor consistent with its loading/error/success states.
- `src/modules/cases/service.ts` and `src/app/cases/new/page.tsx` -- payment options and submission read current fees; the composer refreshes fees before submit, and the Case snapshots its captured amount. Preserve that flow.
- `src/modules/cases/repository.ts` and `src/modules/payments/service.ts` -- Opinion closure snapshots `platformFeePercentAtClosure`, and payout math uses that snapshot; do not recalculate previous Cases when settings change.
- `src/modules/admin/service.test.ts`, `src/modules/admin/routes.test.ts`, `src/modules/cases/service.test.ts`, and `src/modules/cases/routes.test.ts` -- extend existing auth, settings delegation, fee-read, prospective snapshot, and validation coverage.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/admin/domain/index.ts`, `repository.ts`, and `service.ts` -- add typed fee validation and Admin-only atomic settings update/read behavior.
- [x] `src/modules/admin/routes/index.ts` and `src/app/api/admin/platform-settings/route.ts` -- add private Admin GET/PUT endpoints with typed validation/conflict errors.
- [x] `src/app/admin/page.tsx` and `src/app/globals.css` -- add a settings editor with current values, numeric controls, loading/save/error states, and confirmation.
- [x] Cases/Payments consumers and tests -- verify new settings apply prospectively while existing captured fees and closure-time payout percentages remain unchanged.
- [x] Admin/Cases route and service tests -- cover authentication, atomic validation, persistence errors, and current-value reads.

**Acceptance Criteria:**
- Given an Admin saves valid Standard, Urgent, and Platform Fee values, when a new Patient submits a Case or a Doctor closes an Opinion, then the new values are used and captured at the correct lifecycle point.
- Given a Patient/Doctor or unauthenticated caller requests or updates platform settings, when the API runs, then access is denied and no setting changes.
- Given an invalid update, when it is submitted, then all prior values remain unchanged and a typed validation error is returned.
- Given settings change after a Case fee or Opinion fee snapshot is recorded, when a payout runs, then the existing snapshots determine its amount and are not recalculated.

## Implementation Notes

The Admin settings API validates decimal strings before one PlatformSettings upsert; the Admin page displays save/load state and the existing Case and Opinion paths continue to snapshot settings prospectively. Verification passed: 187 project tests, `npx tsc --noEmit`, `npx prisma validate`, and `npm run build`. Route and service tests mock persistence; no live PostgreSQL write was performed in this environment.

## Spec Change Log

## Review Triage Log

- maybe-false (defer; medium unverified): Blind Hunter noted that if the PlatformSettings row is missing, Admin GET fails and the UI cannot use the update upsert to initialize it; supported seed setup creates both the Admin account and the fixed settings singleton, so verify whether any supported bootstrap path permits Admin without settings before adding a fallback.
- false (rejected): Blind Hunter and Edge Case Hunter reported that a failed refresh leaves stale settings editable; `loadPlatformSettings()` clears `platformSettings` on both response and network errors, and the form is hidden when settings are null.
- false (rejected): Blind Hunter said a “Current values” indicator remains while editing; the current Admin settings section contains no such label.
- false (rejected): Blind Hunter and Verification Gap Reviewer reported no cross-module prospective snapshot test; the Cases test closes one Opinion at 20%, changes the fixture setting to 45%, closes another Opinion, and asserts both snapshots and payout eligibility values.
- false (rejected): Blind Hunter reported missing fee/percentage endpoint tests; the Admin service test accepts `99999999.99`, `0.01`, 0%, and 100%, and rejects `100000000.00`.
- medium (patch): Blind Hunter found the spec was `in-review` while the sprint key remained `in-progress`; the sprint entry is now set to `review` to match.
- medium (patch): Blind Hunter found verification results were not recorded; this Implementation Notes section now records the full 187-test, typecheck, schema validation, and build results, plus the lack of live database persistence verification.

## Design Notes

Settings must be updated as one unit so concurrent Case submissions and Opinion closures observe a complete configuration rather than a mixture of old and new values. Existing Case and payout snapshots are the historical source of truth; changing the singleton is not a retroactive migration.

## Verification

**Commands:**
- `npm test` -- expected: all existing and new Admin/Cases/Payments tests pass.
- `npx tsc --noEmit` -- expected: no TypeScript errors.
- `npx prisma validate` -- expected: existing settings schema remains valid without a new table migration.
- `npm run build` -- expected: Admin settings API and editor compile.

**Manual checks:**
- As Admin, change each value, refresh the page, and verify the current values persist.
- Submit a Case before and after a fee change and verify only the later Case captures the new fee.
- Close an Opinion, change the Platform Fee percentage, and verify the earlier payout still uses its closure-time snapshot.