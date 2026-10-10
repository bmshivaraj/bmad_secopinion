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

**Always:** Require an Admin-role session for queue and review actions; never trust a caller-supplied Admin or Doctor identity; have Admin use the Doctors service for Doctor-owned reads and status changes; list only Pending Doctors with specialties and credential metadata; serve credential bytes through the existing Doctors service authorization and private credential route; ensure only Verified Doctors pass `getVerifiedDoctor`; return typed errors in `{ data, error }` envelopes; support the single Admin role only; seed one Admin from operator-provided `ADMIN_USERNAME` and `ADMIN_PASSWORD`, hash the password with Argon2id, and fail seeding if either value is missing; show rejection status at the Doctor's next sign-in without outbound notification; allow only Pending → Verified/Rejected through this queue, with decisions final; restore only the minimal Doctors-owned Specialty list/create operations required by existing Admin routes, without changing their UI or route behavior.

**Never:** Permit Admin self-registration, expose storage keys or public credential URLs, allow Doctors/Patients to review applications or change status, add automated registry checks, or add case assignment, payout, new Specialty UI/routes, or multi-admin permissions workflows.

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

- `src/modules/admin/service.ts`, `src/modules/admin/routes/index.ts`, `src/app/api/admin/`, and `src/app/admin/page.tsx` -- Admin auth, queue/decision orchestration, private credential links, and review UI already exist; preserve these contracts and current empty/error states.
- `src/modules/doctors/domain/index.ts`, `repository.ts`, and `service.ts` -- add typed review errors, a Pending-only application read, and a conditional final-status update; reuse `getCredential` authorization and `getVerifiedDoctor` eligibility checks.
- `src/shared/auth-context.ts`, `src/modules/doctors/routes/index.ts`, and the credential API route -- reuse verified Admin claims and the existing Admin-or-owner credential access boundary; never expose storage keys.
- `prisma/schema.prisma`, existing Admin/Specialty migrations, and `prisma/seed.ts` -- reconcile the Prisma models/fields with existing SQL and seed usage; do not add a duplicate migration or alter seed credential policy.
- `src/modules/admin/service.test.ts`, `src/modules/admin/routes.test.ts`, `src/modules/doctors/service.test.ts`, and `package.json` -- review suites exist, but `npm test` excludes Admin tests; current typecheck errors are localized to missing Doctor review/catalog service contracts.
- `src/app/doctors/login/page.tsx` and Doctor login service -- preserve the existing verification-status response and Rejected notice; no outbound notification provider exists or is in scope.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/doctors/domain/index.ts`, `src/modules/doctors/repository.ts`, `src/modules/doctors/service.ts` -- add typed review errors, Pending-only reads, conditional final decisions, and the minimal existing Specialty create contract -- preserves Doctors ownership and rejects stale writes without changing Admin UI/routes.
- [x] `prisma/schema.prisma` -- restore existing `AdminAccount` and `Specialty.normalizedName` fields to match migrations and seed -- fixes generated-client consistency without a duplicate migration.
- [x] `src/modules/admin/service.ts`, `src/modules/admin/routes/index.ts`, `src/app/api/admin/`, `src/app/admin/page.tsx` -- complete and verify review through `doctorsService`, retaining private links and existing empty/error states -- enforces module and role boundaries.
- [x] `src/modules/admin/service.test.ts`, `src/modules/admin/routes.test.ts`, `src/modules/doctors/service.test.ts`, `package.json` -- cover queue, authorization, privacy, final decisions, Specialty compatibility, seed, and rejection notice; include Admin suites in `npm test` -- restores the test gate.
- [x] `prisma/seed.ts` -- retain operator-provided credentials, Argon2id hashing, and the fixed-ID upsert without a default password -- supports secure provisioning.

**Acceptance Criteria:**
- Given an authenticated Admin, when they review applications, then only Pending Doctors and private credential links are exposed; other roles cannot read or decide.
- Given a Pending Doctor, when the Admin chooses Verified or Rejected, then the Doctor-owned status changes once, stale decisions conflict, and `getVerifiedDoctor` admits only Verified Doctors.
- Given a rejected Doctor, when they next sign in, then the response and UI show Rejected without sending an external notification.
- Given the existing Admin Specialty routes, when they list or create catalog entries, then the current behavior continues through Doctors-owned operations without UI or route changes.

## Implementation Notes

- Added Doctors-owned Specialty creation and Pending-only review persistence. Status updates use a transactional `updateMany` predicate so only a currently Pending Doctor can transition once.
- Restored `AdminAccount` and `Specialty.normalizedName` in Prisma to match existing migrations; no migration was added. Registered the existing Admin service and route suites in `npm test`.
- `npm test` passed all 69 Patient, Doctor, and Admin tests; `npx tsc --noEmit`, `npx prisma validate`, `npx prisma generate`, and `npm run build` passed.
- Browser checks with mocked APIs covered Admin sign-in, queue records and private credential links, Verify/Reject confirmations, empty queue, and the Doctor's Rejected sign-in notice. These checks did not exercise database persistence.
- `npx prisma migrate status` returned PostgreSQL `P1000` with the available local credentials. No migration was applied; database-backed persistence remains unverified.
- Review fixes aligned the sprint story state, constrained Admin seed usernames to the login limit, tested the login lockout, and separated queue-load failure from the empty state with retry. The mocked browser retry recovered to the empty queue.

## Spec Change Log

## Review Triage Log

- **low | defer** — Blind Hunter: Story 2.2 frontmatter is malformed in the pre-existing working tree, preventing reliable metadata parsing; unrelated to this story and left unchanged.
- **low | defer** — Edge Case Hunter: Story 2.2 frontmatter is malformed in the pre-existing working tree, preventing reliable metadata parsing; same pre-existing issue, left unchanged.
- **false** — Blind Hunter: the phrase “notify the Doctor” is clarified by the approved constraint and acceptance criterion: show Rejected at next sign-in with no outbound notification.
- **low | patch** — Blind Hunter: spec was `in-review` while sprint status remained `in-progress`; the sprint entry was advanced to `review`. The final workflow marks the spec `done` while retaining sprint `review` for its separate review gate.
- **low | defer** — Blind Hunter: Story 2.4 says `done` while sprint status says `backlog`; this pre-existing tracker mismatch is outside Story 2.3.
- **false** — Blind Hunter: Admin services, routes, page, and tests already existed in the working tree when Story 2.3 planning began; the diff's older baseline predates them.
- **maybe-false | defer** — Blind Hunter: a separate actor/reason audit record may be required for irreversible review decisions; the approved single-Admin intent does not define that requirement. Product/compliance confirmation would settle it.
- **false** — Blind Hunter: appeal/reapplication behavior is not required by the approved final-decision scope; adding it would change the approved workflow.
- **maybe-false | defer** — Blind Hunter: Story 2.4 migration/backfill and durable uniqueness could not be checked against PostgreSQL because credentials fail with `P1000`; valid database access and persisted-row assertions would settle the risk.
- **maybe-false | defer** — Verification Gap Reviewer: Story 2.4 migration/backfill and durable uniqueness lack database-backed verification because credentials fail with `P1000`; valid database access and persisted-row assertions would settle the risk.
- **false** — Blind Hunter: supported Specialty writes compute `normalizedName` with JavaScript for every new row, while the migration normalizes only existing seeded ASCII names; the cited implementation mismatch does not produce divergent app writes.
- **false** — Blind Hunter: typo recovery would require editing/removing a Specialty, explicitly excluded by the approved add-only intent.
- **maybe-false | defer** — Blind Hunter: Epic 3 document size/content limits remain unspecified; resolve these before implementing its upload flow.
- **maybe-false | defer** — Blind Hunter: Epic 3 payment idempotency and recovery after provider success/database failure remain unspecified; resolve before implementing payment submission.
- **maybe-false | defer** — Blind Hunter: Epic 3 currency storage precision/rounding is unspecified; define it before money persistence is implemented.
- **maybe-false | defer** — Blind Hunter: Epic 3 draft retention after failed payment is unspecified; define the retry/expiry behavior before implementing payment submission.
- **low | defer** — Blind Hunter: Story 2.4 implementation and review notes are placed under Verification; this pre-existing document-organization issue is outside Story 2.3.
- **low | defer** — Edge Case Hunter: Story 2.2 frontmatter metadata remains malformed; same pre-existing documentation issue as the Blind Hunter finding.
- **low | patch** — Edge Case Hunter: Admin seed accepted usernames longer than the login service's 100-character limit; seed validation now rejects them and has regression coverage.
- **maybe-false | defer** — Verification Gap Reviewer: fake repositories do not verify the database concurrency predicate; a live overlapping-decision test is still blocked by PostgreSQL `P1000`.
- **low | patch** — Verification Gap Reviewer: Admin lockout had no threshold test; added coverage proving the 21st attempt is rejected before another repository lookup.
- **medium | patch** — Verification Gap Reviewer: queue-load failure also rendered “Queue clear”; the UI now shows an unavailable state, hides the count, and offers retry. Mocked browser checks confirmed failure and recovery states.

## Design Notes

Doctors owns verification status; Admin delegates through its service. The queue returns private credential links and metadata only. Decisions are persisted and final, so updates must be conditional on the current Pending status. Epic 4 uses the existing `getVerifiedDoctor` gate. Existing SQL migrations already define the Admin account and normalized Specialty name; reconcile Prisma without creating duplicate migrations. Seed credentials remain environment-provided; rejection is shown at sign-in without outbound notification. The existing Specialty create contract is included only as a compatibility repair; its UI and routes remain unchanged.

## Verification

**Commands:**
- `npm test`, `npx tsc --noEmit`, and `npm run build` -- expected: Patient, Doctor, and Admin suites pass; app compiles.
- `npx prisma validate` and `npx prisma generate` -- expected: schema matches existing migrations and seed.
- `npx prisma migrate status` -- expected: inspect existing Admin migration; apply only if configured PostgreSQL credentials are valid, and report any blocker without claiming success.

**Manual checks:**
- Sign in as the seeded Admin, review a Pending Doctor and private credential link, perform Verified and Rejected decisions, then verify the Doctor login notice and denial of non-Admin queue/decision access.
- Confirm a repeated/stale decision leaves the original final status unchanged; do not claim database-backed migration or persistence verification unless PostgreSQL accepts the configured credentials.

**Pre-implementation baseline:**
- `npx tsc --noEmit` reports 19 errors in `src/modules/admin/service.ts` and `src/modules/admin/routes.test.ts`, reflecting missing Doctors review and Specialty service/repository contracts.
- `npx prisma validate` passes when `DATABASE_URL` is supplied; the current `npm test` script omits both Admin suites.