---
title: 'Guardian Registration for a Minor Patient'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '51cdcac5b83c542547c1edd019de6c7e6a6b18b4'
context: ['_bmad-output/implementation-artifacts/epic-1-context.md', '_bmad-output/implementation-artifacts/spec-1-2-mobile-otp-registration.md', '_bmad-output/implementation-artifacts/spec-1-3-post-otp-password-setup-login.md', '_bmad-output/planning-artifacts/architecture/architecture-secopinion-2026-09-22/ARCHITECTURE-SPINE.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Patient registration has no way to declare that the registrant is acting for a minor, even though v1 does not support minors registering with their own mobile number. Later Case submission must distinguish the minor Patient from the guardian Registrant.

**Approach:** Keep one Patient login account using the guardian Registrant's verified mobile. During first-password setup, let the guardian declare that the account represents one minor, provide the minor's name and a fixed guardian relationship, and attest authority to act for the minor. Persist those values in Patients for Epic 3 to copy into Case records.

## Boundaries & Constraints

**Always:** Reuse the Story 1.2 mobile + OTP flow and Story 1.3 password setup; use the guardian's verified mobile number and existing login account; collect the minor's name and one fixed relationship (`parent`, `legal guardian`, or `other authorized guardian`) only when minor status is declared; require an authority attestation; treat age/guardian status as self-declared with no DOB or ID verification; default existing/adult accounts to non-minor and non-guardian; keep Patient-table access in the Patients module; return `{ data, error }` envelopes and typed domain errors; use UUIDs and additive Prisma migrations.

**Never:** Create a separate minor login/profile or support multiple minors under one account in v1; allow a minor to register directly with their own mobile number; collect or verify government identity documents or date of birth; change OTP delivery or login/session behavior; add Case tables or lifecycle behavior to this story; add cross-module database foreign keys.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Adult registration | Registrant does not declare a minor Patient | Existing registration remains unchanged and is not marked guardian-registered | N/A |
| Guardian registers a minor | OTP-verified guardian chooses the minor option, enters a name, selects a relationship, and attests authority | One Patient account stores minor and guardian flags plus the approved details | Success envelope; no ID documents or DOB collected |
| Adult registration | Registrant leaves the minor option unchecked | Minor and guardian flags remain false; minor details remain null | N/A |
| Invalid guardian declaration | Minor option is checked but name, relationship, or attestation is missing | No partial guardian/minor state is stored | Typed validation failure |
| Case-context handoff | Guardian-registered Patient is used by a later Case flow | Patient service exposes saved minor/guardian details for Epic 3 to copy into Case | Missing context is handled as typed validation failure by the owning flow |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` -- Patient currently has verified mobile, username, and password fields only; add `isMinor`, `isGuardianRegistered`, `minorName`, and a constrained guardian relationship field with safe defaults.
- `src/modules/patients/domain/index.ts` -- Patient domain type and typed domain errors; define allowed guardian relationships and required declaration fields.
- `src/modules/patients/service.ts` -- current `setPassword` verifies the one-time setup token and writes credentials atomically; extend it to persist guardian details in that same one-time update.
- `src/modules/patients/repository.ts` -- owns Patient persistence; extend the atomic credential update to include approved guardian fields.
- `src/modules/patients/routes/index.ts` -- request parsing and domain-error-to-HTTP mapping for patient routes.
- `src/app/register/password/page.tsx` -- current first-password setup screen; add the minor toggle, minor name, fixed relationship selector, and authority attestation.
- `src/app/api/patients/password/setup/route.ts` -- current authorized one-time setup route; parse and persist the optional declaration with username/password.
- `src/modules/patients/service.test.ts` -- existing service and route tests; extend adult-default, minor data, required attestation, and authorized persistence cases.
- `prisma/migrations/` -- add an additive Patient-only migration; Case storage and copying Patient context remain in Epic 3.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` and a new migration -- add minor/guardian flags, minor name, and relationship with defaults preserving existing adult Patients -- persists the approved declaration.
- [x] `src/modules/patients/domain/index.ts` -- add typed declaration validation and allowed relationship values -- keeps rules within Patients ownership.
- [x] `src/modules/patients/repository.ts` -- extend conditional credential persistence with approved minor details -- keeps the one-time setup update atomic.
- [x] `src/modules/patients/service.ts` -- validate and persist guardian details only for the OTP-authorized Patient -- prevents changes to another account.
- [x] `src/modules/patients/routes/index.ts` and `src/app/api/patients/password/setup/route.ts` -- parse declaration input and return typed envelopes -- exposes the registration contract.
- [x] `src/app/register/password/page.tsx` -- collect minor status, minor name, fixed relationship, and guardian-authority attestation -- makes the flow usable.
- [x] `src/modules/patients/service.test.ts` -- test adult defaults, valid declaration, missing fields/attestation, invalid relationship, and authorized persistence -- covers the edge-case matrix.

**Acceptance Criteria:**
- Given an adult Patient who completes password setup without the minor option, when setup finishes, then existing adult account behavior is preserved and all minor/guardian flags remain false.
- Given an OTP-authorized registrant who selects minor registration and supplies a minor name, fixed guardian relationship, and authority attestation, when password setup completes, then the same Patient account stores both minor/guardian flags and submitted details without collecting DOB or ID documents.
- Given a declaration request without valid setup authorization or with missing/invalid declaration details, when setup is attempted, then no guardian/minor state is changed and a typed failure is returned.
- Given a guardian-registered Patient used in a later Case flow, when Epic 3 submits the Case, then the Patients service provides stored context for the Case to snapshot and display to Doctors.

## Implementation Notes

- Added adult-safe defaults and persisted one minor name plus a fixed guardian relationship with the self-declared guardian/minor flags. The authority checkbox is required before setup succeeds; the minor name is limited to 120 characters and rejects control characters.
- The password setup UI conditionally presents the guardian declaration, relationship options, authority attestation, and a disclosure that minor details will be shared with the Case's reviewing Doctor. The Patients service exposes `getPatientMinorContext` for Epic 3; Case storage remains deferred to that epic.
- `npm test` passes all 21 Patient tests, `npm run build` passes, `npx prisma validate` passes, and `npx prisma generate` succeeds.
- Database-backed migration and repository verification remain blocked: `npx prisma migrate dev --name add-guardian-registration` returned `P1000` for the configured `secopinion_build` credentials, and Docker Desktop is unavailable. No database changes were made.
- Browser smoke test at a 390px viewport confirmed the conditional form fields, 120-character input limit, no horizontal overflow, and guardian declaration payload/redirect using a mocked API response.

## Spec Change Log

## Review Triage Log

- **false** — Blind Hunter: the same Patient row represents guardian and minor without separate guardian identity. This is the approved one-account model; `getPatientMinorContext` returns the Patient ID, minor/guardian flags, minor name, and relationship for Epic 3's Case context.
- **maybe-false | defer** — Blind Hunter: the authority checkbox has no timestamp or attestation-text version. The service persists `isGuardianRegistered` only after requiring the checkbox, which proves the declaration gate ran; whether v1 needs separately auditable timestamped/versioned attestation evidence is a product/legal retention decision to settle before wider rollout.
- **medium | patch** — Blind Hunter: the guardian form collected family details without explaining downstream use. Added a disclosure that the minor name and relationship identify the Patient on a Case and are shared with its reviewing Doctor.
- **medium | patch** — Blind Hunter: minor names had no length or control-character bound. Added a 120-character service/UI limit and rejected control characters, with regression coverage.
- **medium | patch** — Blind Hunter: an adult payload could include guardian fields that were silently ignored. The service now rejects guardian details unless `isMinor` is explicitly true, with regression coverage.
- **false** — Blind Hunter: database rows could contain inconsistent guardian/minor combinations if written outside the service. The Patients module is the sole Patient-table writer under AD-2; the approved setup service validates combinations and the repository applies them atomically with `passwordHash: null`.
- **medium | patch** — Blind Hunter: guardian relationship values and wrong field types were not covered at the API parser boundary. Added a route test proving an unsupported relationship returns a typed `VALIDATION_ERROR` without persisting credentials.
- **medium | patch** — Edge Case Hunter: an arbitrarily long minor name could consume storage. Added the 120-character bound and tests for overlong and control-character names.
- **low | rejected** — Verification Gap Reviewer: setup-page guardian payload had no persistent browser test. A browser smoke test checked the selected minor option, fields, relationship, attestation, serialized payload, and success redirect; the repository has no persistent UI-test harness.
- **maybe-false | defer** — Verification Gap Reviewer: the production Prisma repository write was not exercised against PostgreSQL. The source directly spreads validated guardian fields into the atomic `updateMany` write, and Prisma validation/client generation/build pass, but a DB-backed test could not run because credentials fail with `P1000` and Docker Desktop is unavailable. A working test database and persisted-row assertion would settle this.

## Design Notes

The v1 account remains a single Patient row authenticated by the guardian's verified mobile and username/password. The row represents one minor for this story: `isMinor` and `isGuardianRegistered` distinguish the roles, while the minor's display name and fixed guardian relationship identify the subject. Epic 3 will copy this Patient context into each Case; this story does not create Case persistence. The setup route only persists guardian fields when `isMinor` is true; adult setup writes false flags and null details.

## Verification

**Commands:**
- `npm test` -- expected: all Patient registration and guardian/minor tests pass.
- `npm run build` -- expected: TypeScript and Next.js build succeed with any changed patient routes/pages.
- `npx prisma validate` -- expected: schema and guardian relationship enum validate.
- `npx prisma migrate dev` -- expected: the additive guardian/minor migration applies cleanly to the configured development database.

**Latest verification run:**
- `npm test` -- passed all 21 tests.
- `npm run build` -- passed; all existing API routes and pages generated.
- `npx prisma validate` and `npx prisma generate` -- passed.
- Browser smoke test -- guardian fields and disclosure rendered at 390px with no horizontal overflow; mocked submit payload and setup redirect were correct.
- `npx prisma migrate dev --name add-guardian-registration` -- blocked by PostgreSQL authentication failure (`P1000`); Docker Desktop is unavailable, so no temporary local database could be started.