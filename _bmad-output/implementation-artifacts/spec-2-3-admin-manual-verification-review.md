---
title: 'Admin Manual Verification Review'
type: 'feature'
created: '2026-10-05'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'be593749450748c15e8d980c0ce316eb1641f243'
context: ['_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Doctor applications remain Pending because the platform has no Admin workflow to review their credential documents and make a verification decision.

**Approach:** Provide the single authenticated Admin with a minimal review queue of Pending Doctors, their declared specialties, and secure credential links; let the Admin set each pending application to Verified or Rejected. Verification status remains owned by the Doctors module, and rejection must notify the Doctor using the approved notification behavior.

## Boundaries & Constraints

**Always:** Require an Admin-role session for queue and review actions; never trust a caller-supplied Admin or Doctor identity; have Admin use the Doctors service for Doctor-owned reads and status changes; list only Pending Doctors with specialties and credential metadata; serve credential bytes through the existing Doctors service authorization and private credential route; ensure only Verified Doctors pass `getVerifiedDoctor`; return typed errors in `{ data, error }` envelopes; support the single Admin role only; seed one Admin from operator-provided `ADMIN_USERNAME` and `ADMIN_PASSWORD`, hash the password with Argon2id, and fail seeding if either value is missing; upsert the fixed Admin account from those values on each seed run so environment changes rotate credentials; show rejection status at the Doctor's next sign-in without outbound notification; allow only Pending → Verified/Rejected through this queue, with decisions final.

**Never:** Permit Admin self-registration, expose storage keys or public credential URLs, allow Doctors/Patients to review applications or change status, add automated registry checks, or add case assignment, payout, specialty-catalog, or multi-admin permissions workflows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open verification queue | Authenticated Admin | Pending Doctors with specialties and credential metadata are listed | Missing/invalid/non-Admin session is rejected |
| View a credential | Admin opens a credential link from a Pending application | Bytes are served through the existing owner/Admin-authorized Doctors service | Unknown credential returns typed not-found; other roles are denied |
| Verify a Pending Doctor | Admin selects Verified | Doctor status persists as Verified and the existing verification gate allows eligibility | Stale/non-Pending record is rejected without a second transition |
| Reject a Pending Doctor | Admin selects Rejected | Doctor status persists as Rejected and is shown at the Doctor's next sign-in | Stale/non-Pending record is rejected without a second transition |
| Revisit a decision | Doctor is already Verified or Rejected | Queue does not offer another status transition | Typed conflict; no status change |
| Queue is empty | No Doctors are Pending | Empty state is shown without error | N/A |

</frozen-after-approval>

## Code Map

- `src/modules/admin/{domain/index.ts,repository.ts,service.ts,routes/index.ts}` -- Admin files are placeholders. Keep Admin orchestration here; its repository owns Admin-account lookup, while Doctor data/status must go through `doctorsService`.
- `src/shared/auth-context.ts` and `src/modules/doctors/routes/index.ts` -- `signAuthToken`/`verifyAuthToken` accept the `admin` role; reuse `ADMIN_SESSION_COOKIE`, cookie parsing, and session-token validation.
- `src/modules/doctors/{domain/index.ts,repository.ts,service.ts}` -- Doctor owns verification status, credential access, and `getVerifiedDoctor`; add a Pending-only projection and conditional Pending-to-final status transition here. `getCredential` already permits Admin or owning Doctor.
- `src/app/api/doctors/credentials/[credentialId]/route.ts` -- existing private credential endpoint delegates authorization to `doctorsService`; return credential metadata/links in the queue, never storage keys or file bytes.
- `src/app/api/doctors/login/route.ts` and `src/app/doctors/login/page.tsx` -- login already returns and displays any verification status, including Rejected. Verify this behavior; no outbound-notification or UI rewrite is needed.
- `src/app/api/admin/` and `src/app/admin/` -- add Admin login, protected queue/decision endpoints, and the minimal review UI.
- `prisma/schema.prisma`, `prisma/migrations/`, and `prisma/seed.ts` -- no Admin account model exists. Reuse Prisma model/migration conventions and `argon2.hash(..., { type: argon2.argon2id })`; the existing settings seed demonstrates fixed-ID idempotent upsert.
- `src/modules/doctors/service.test.ts`, new Admin tests, and `package.json` -- follow Node's `tsx --test` patterns; include new Admin tests in the explicit `npm test` script.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/doctors/repository.ts` and `src/modules/doctors/service.ts` -- list Pending applications and conditionally change status -- preserves Doctor ownership and rejects stale writes.
- [x] `src/modules/admin/` and `src/app/api/admin/` -- implement Admin login and protected review operations through `doctorsService` -- protects actions and respects module ownership.
- [x] `src/app/admin/` -- build the minimal review queue/detail UI with credential links, final decisions, and empty/error states -- supports manual review.
- [x] `prisma/schema.prisma`, migration, and `prisma/seed.ts` -- seed one Admin from required environment credentials with an Argon2id hash; fail when values are missing -- provides secure operator access without a default password.
- [x] `src/app/api/doctors/login/route.ts` and `src/app/doctors/login/page.tsx` -- verify the existing login response and notice show Rejected -- fulfills notice behavior without outbound delivery.
- [x] Doctor/Admin tests and `package.json` -- cover queue filtering, role gates, credential authorization, final Pending-only transitions, missing-seed-credential failure, and rejection status; include Admin tests in `npm test` -- covers the matrix.

**Acceptance Criteria:**
- Given a valid Admin session, when the Admin opens the review queue, then it lists every Pending Doctor with specialties and secure links to their uploaded credentials.
- Given a missing, invalid, Patient, or Doctor session, when a caller requests the queue or changes a Doctor status, then the request is rejected and no data changes.
- Given an Admin opens a credential link, when the credential exists, then the private bytes are returned only to the Admin or owning Doctor through the existing service authorization boundary.
- Given a Pending Doctor, when the Admin marks the application Verified, then the persisted status is Verified and `getVerifiedDoctor` returns the Doctor summary.
- Given a Pending Doctor, when the Admin rejects the application, then the persisted status is Rejected, the Doctor cannot pass the verified-Doctor gate, and the Doctor sees Rejected at next sign-in without SMS/email delivery.
- Given a non-Pending Doctor or a duplicate/stale decision, when the Admin submits another status change, then the API returns a typed conflict and leaves the final decision unchanged.

## Implementation Notes

- Added the single fixed-ID Admin account model and environment-driven Argon2id seed; reseeding with changed environment values updates the account credentials.
- Added Admin login, protected Pending queue and final decision endpoints, and the manual review UI. The Admin service delegates Doctor reads and status changes through `doctorsService`; Doctor status transitions are conditional on the persisted Pending state.
- Added Admin and Doctor tests for role gates, private credential metadata/access, empty queues, final decisions, and rejected status at login. `npm test` passed all 65 tests; focused Admin tests passed all 5 tests; `npx tsc --noEmit`, `npx prisma validate`, `npx prisma generate`, and `npm run build` passed.
- Added Admin and Doctor tests for role gates, private credential metadata/access, empty queues, final decisions, and rejected status at login. `npm test` passed all 67 tests; focused Admin tests passed; `npx tsc --noEmit`, `npx prisma validate`, `npx prisma generate`, and `npm run build` passed.
- Migration application and database-backed manual review remain unverified: `npx prisma migrate dev --name add_admin_verification_review` failed with PostgreSQL `P1000` because the configured credentials were rejected. No migration success is claimed.

Review fixes also enforce the existing Doctor password-strength policy for seeded Admin credentials, confirm irreversible decisions, handle logout failures, and test the pending-only Prisma predicate and Admin credential rotation payload.
## Spec Change Log

## Review Triage Log

- blind-hunter: process-local login throttle -- **low**. Shared storage is already deferred until multi-instance deployment, and this v1 uses the existing single-replica assumption; shared throttling would add an unneeded storage dependency now.
- blind-hunter: weak or whitespace Admin seed password -- **medium**. Patched by requiring 8-1024 characters including uppercase, lowercase, and numeric characters, matching the established Doctor password policy; focused seed tests pass.
- blind-hunter: irreversible decision has no confirmation -- **medium**. Patched with a confirmation naming the Doctor, outcome, and finality before the request is sent.
- blind-hunter: no rejection reason or remediation path -- **low**. Rejected because the approved acceptance requires a Rejected status at next sign-in; adding reason fields and remediation is a separate workflow not required here.
- blind-hunter: no durable decision actor/rationale audit record -- **low**. Rejected because this story provisions a single Admin and requires only a final status; an audit ledger would add a new persistence model without an approved audit requirement.
- blind-hunter: no HTTP credential-route test -- **false**. The unchanged credential route delegates to the service boundary; existing tests verify Admin/owner bytes, foreign-role denial, and typed not-found, while the new queue test verifies it exposes only a private route link and metadata.
- blind-hunter: no route/UI assertion for Rejected at next login -- **false**. The service test verifies Rejected is returned, the login route forwards `verificationStatus`, and the existing Doctor page interpolates that value into its status notice.
- blind-hunter: queue has no pagination -- **low**. The requirement is to list every Pending application and no volume/SLA target is defined; pagination would add API/UI contract beyond the current single-Admin queue.
- blind-hunter: queue does not show application age -- **low**. The repository orders oldest applications first, and age display is not part of the approved review criteria.
- edge-case-hunter: logout network failure is unhandled -- **medium**. Patched to catch failed requests and keep the authenticated view with a visible error instead of an unhandled rejection.
- verification-gap: pending-only repository predicate lacks a test -- **medium**. Patched with a repository-level test that captures the real Prisma call and asserts the `id` plus `verificationStatus: Pending` filter; Doctor tests pass.
- verification-gap: Admin seed create/rotation/hash payload lacks a test -- **medium**. Patched with tests for the fixed account ID, updated username, and Argon2id hash verifying only the new password.
## Design Notes

The Admin module orchestrates review, but Doctors owns Doctor records and status. The existing credential endpoint already delegates authorization to the Doctors service; the queue should return credential metadata/links, not file bytes or storage paths. The current Case queue is not implemented, so status integration for Epic 4 is through the existing `getVerifiedDoctor` eligibility seam. Admin seed credentials must come from deployment/local environment and never be embedded in source; the Doctor sees a rejected status at next sign-in, so no notification store or outbound provider is introduced.

## Verification

**Commands:**
- `npm test` -- expected: Patient, Doctor, and new Admin tests pass.
- `npx tsc --noEmit` and `npm run build` -- expected: new Admin APIs and pages compile.
- `npx prisma validate` and `npx prisma generate` -- expected: any approved Admin model/schema changes validate and generate.
- `npx prisma migrate dev --name add_admin_verification_review` -- expected: additive schema changes apply to PostgreSQL; report any environment/authentication blocker without claiming the migration ran.

**Manual checks:**
- Sign in as the seeded Admin, review a Pending Doctor and credential, perform each decision, and verify Doctor-visible status/notification and non-Admin access denial.