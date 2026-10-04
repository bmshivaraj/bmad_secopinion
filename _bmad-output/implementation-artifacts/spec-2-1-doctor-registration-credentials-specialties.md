---
title: 'Doctor Registration with Credentials & Specialties'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '93b0d5b5f42faa8d83c67b00b59acc220d967343'
context: ['_bmad-output/implementation-artifacts/epic-2-context.md', '_bmad-output/planning-artifacts/architecture/architecture-secopinion-2026-09-22/ARCHITECTURE-SPINE.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Doctors cannot register in SecOpinion, submit credential documents, or declare specialties, so the platform has no candidate pool for manual verification.

**Approach:** Let a prospective Doctor verify a mobile number via the shared OTP flow, then submit a full professional name, Doctor-scoped username/password, up to five private credentials, and specialties from the active database catalog. Create a `Pending` Doctor application and issue a Doctor-role session after successful submission.

## Boundaries & Constraints

**Always:** Reuse `OtpProvider` and `MockOtpProvider`; use the active database-backed `Specialty` catalog (not a hardcoded enum); allow multiple specialties; require 1-5 JPEG, PNG, or PDF credentials, each no larger than 10 MiB; use `StorageProvider` with `LocalDiskStorageProvider` for v1; store files in private `.data/doctor-credentials` outside `public/` and never expose disk paths; authorize credential reads at the Doctors service boundary for the submitting Doctor and Admin; create submissions with `verificationStatus: Pending`; enforce the Patient password policy (username 3-30 ASCII letters/numbers/underscores; password 8-1024 characters with mixed case and a number; Argon2id hash); use a short-lived Doctor-registration credential after OTP and a Doctor-role HttpOnly session cookie after submission; allow the same mobile on Patient and Doctor role-specific records; use `{ data, error }` and typed errors; preserve module ownership, UUID IDs, and `userId`/`role` JWT conventions.

**Never:** Allow free-text specialties; mark a Doctor Verified or Rejected during self-registration; merge Patient and Doctor records because their mobile numbers match; implement automated credential verification, UPI payout details (Story 2.2), Admin review UI/status changes (Story 2.3), specialty-catalog management (Story 2.4), or Case queue access; expose credentials through public URLs; use real SMS, cloud storage, or bank/NPCI verification.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Begin Doctor registration | New mobile number | OTP is issued through the shared mock provider | N/A |
| Verify registration OTP | Correct, unexpired OTP | Short-lived authorization is issued for Doctor application submission | Typed failure for invalid/expired OTP |
| Submit complete application | Authorized Doctor, required profile fields, credential file(s), active specialties | Doctor and private credential metadata are stored; status is `Pending` | Success envelope; no storage path exposed |
| Missing or invalid application data | No credential, no active specialty, malformed field, or unsupported file | No Doctor application is created | Typed error identifies invalid/missing field(s) |
| View credential | Authenticated submitting Doctor or Admin requests an owned credential | Bytes are read through the storage provider after service authorization | Unauthorized/unknown credentials return typed failure |
| Doctor is Pending | Doctor attempts future case-queue access | Registration provides no queue access; eligibility remains false until Admin verification | Typed authorization failure at the owning queue flow |

</frozen-after-approval>

## Code Map

- `src/shared/otp-provider.ts` -- reuse `OtpProvider` and the existing `otpProvider` singleton for Doctor mobile verification.
- `src/shared/auth-context.ts` -- reuse `Role`/`signAuthToken`; `doctor` is already an allowed role. Add purpose-specific Doctor registration token helpers and sign the final Doctor-role session.
- `src/shared/storage-provider.ts` -- does not exist; add the architecture-required `StorageProvider` interface and a private local-disk v1 implementation.
- `src/modules/doctors/{domain,index.ts,service.ts,repository.ts,routes/index.ts}` -- existing module stubs; Doctor owns registration, credential metadata, specialties, authentication, and document authorization.
- `prisma/schema.prisma` -- `Specialty` is already seeded and active-aware; add Doctor status, specialties relation, and credential metadata models without changing the catalog schema.
- `prisma/seed.ts` -- already idempotently seeds the 15 specialties; reuse the current catalog rather than adding another source of truth.
- `docker-compose.yml` and `.gitignore` -- source is bind-mounted at `/app`; add a private uploads directory/volume convention and ignore local credential bytes.
- `src/app/api/doctors/register/start/route.ts` and `verify/route.ts` -- no Doctor OTP routes exist; implement shared-provider OTP and a short-lived application credential.
- `src/app/api/doctors/register/submit/route.ts` -- accept the authorized multipart application, persist document metadata/specialties, create `Pending`, and issue the Doctor session.
- `src/app/api/doctors/specialties/route.ts` -- return active specialties through the Doctors service for registration choices.
- `src/app/api/doctors/login/route.ts`, `logout/route.ts`, and `credentials/[credentialId]/route.ts` -- provide role-specific session handling and service-authorized credential reads.
- `src/app/doctors/register/page.tsx` and `src/app/doctors/login/page.tsx` -- no Doctor UI exists; add onboarding and role-specific login pages.
- `src/modules/patients/service.test.ts` -- provides the current Node service/route test conventions; add Doctor-specific tests alongside or split only if the test script remains focused and registered.

## Tasks & Acceptance

**Execution:**
- [x] `src/shared/storage-provider.ts` and local-disk adapter -- define private save/read/delete operations and safe generated storage keys -- implements AD-7 without leaking filesystem details.
- [x] `prisma/schema.prisma` and a migration -- add Doctor identity/password/status, Doctor-to-Specialty collection, and credential metadata -- records a pending application without modifying seeded specialties.
- [x] `src/modules/doctors/domain/index.ts` -- add typed Doctor/status/document data and registration validation errors -- centralizes Doctors rules.
- [x] `src/modules/doctors/repository.ts` -- persist Doctor applications, credential metadata, and active Specialty associations -- keeps Doctor-owned DB access inside the module.
- [x] `src/modules/doctors/service.ts` -- implement OTP-gated submission, Specialty lookup, `Pending` initialization, Doctor login, and owner/Admin-authorized credential reads -- enforces Doctors business and access rules.
- [x] `src/modules/doctors/routes/index.ts` and Doctor App Router routes -- parse start/verify, multipart submit, Specialty list, login/logout, and credential reads; return typed envelopes -- exposes the approved API contract.
- [x] `src/app/doctors/register/page.tsx` and `src/app/doctors/login/page.tsx` -- implement responsive OTP registration/application submission and role-specific Doctor login -- makes onboarding usable.
- [x] `.gitignore` and `docker-compose.yml` -- keep local credential files private, out of Git and `public/`, and persistent for local development -- avoids accidental disclosure/data loss.
- [x] `package.json` test script and Doctor tests -- cover OTP, invalid files, missing specialties/documents, pending status, and credential authorization -- verifies the matrix.

**Acceptance Criteria:**
- Given a new Doctor mobile number, when OTP registration is completed, then only the verified mobile receives an application-submission authorization.
- Given an authorized applicant with at least one accepted credential file and one or more active Specialty IDs, when they submit, then a Doctor application is stored with `Pending` status and its files remain private.
- Given a missing credential, empty/inactive/unknown Specialty selection, invalid upload, or absent required profile field, when submission is attempted, then no partial Doctor application is created and a typed error is returned.
- Given a credential read request from the owning Doctor or Admin, when the request is authorized, then the storage provider returns bytes; other roles/Doctors cannot read it.
- Given a newly registered Pending Doctor, when registration finishes, then the application is not eligible for case-queue access until the Admin verifies it in Story 2.3.

## Implementation Notes

- Added the Doctors-owned local storage abstraction with generated opaque keys, private `.data/doctor-credentials` files, signature/MIME checks, a 10 MiB per-file limit, and cleanup for partial writes and caught submission failures.
- Doctor registration uses OTP and a 15-minute application token, active DB specialties, Argon2id credentials, and a `Pending` status. Credential reads require the owning Doctor or Admin at the Doctors service; public responses omit storage keys and hashes.
- Added generic duplicate/rate-limited registration-start errors, five-attempt OTP challenge invalidation, a 51 MiB aggregate multipart bound, authorization before multipart parsing, OTP resend/change-mobile controls, and client-side specialty/file-count/upload-size feedback.
- `getVerifiedDoctor` returns a password-free summary only for Verified Doctors; no Case queue endpoints exist yet, and Epic 4 must use this gate.
- `npm test` passes all 44 Patient and Doctor tests; `npm run build`, `npx prisma validate`, and `npx prisma generate` pass. Both Doctor pages return HTTP 200 locally; integrated browser automation timed out before rendering.
- `npx prisma migrate dev --name add-doctor-registration` is blocked by `P1000` because the configured PostgreSQL credentials are rejected; Docker Desktop is unavailable and no database changes were made.

## Spec Change Log

## Review Triage Log

- **medium | patch** — Blind Hunter: incorrect OTP submissions did not consume or bound a challenge. Five-attempt invalidation was added and tested; no sixth provider verification occurs.
- **medium | patch** — Blind Hunter: registration start distinguished existing Doctor accounts from new/rate-limited mobiles. Both now return the same `DOCTOR_REGISTRATION_UNAVAILABLE` response.
- **maybe-false | defer** — Blind Hunter: OTP challenge state is process-local and can be lost on restart or split across instances. The v1 architecture assumes one replica for local disk; shared challenge state is required before multi-instance deployment.
- **maybe-false | defer** — Blind Hunter: the OTP rate limit is process-local. Expired keys are pruned, but multiple instances do not share counters; use shared atomic throttling before scale-out.
- **medium | patch** — Blind Hunter: multipart data was parsed before request-size and authorization checks. The route now validates its short-lived registration token first and caps parsed requests at 51 MiB.
- **low | rejected** — Blind Hunter: a process crash after file save but before DB commit can leave an orphan file. Caught transaction failures clean up; the abrupt-crash window is narrow and durable reconciliation is operationally disproportionate for v1.
- **maybe-false | defer** — Blind Hunter: login throttling is process-local and can be bypassed across instances. The deployment topology must be confirmed; use shared throttling before scale-out.
- **low | patch** — Blind Hunter: the OTP form lacked resend/change-mobile actions. Added both controls using the existing rate-limited endpoint.
- **low | patch** — Blind Hunter: specialty minimum and credential limits were only reported server-side. Added client-side specialty, count, type, and size feedback while retaining server validation.
- **false** — Blind Hunter: Pending/Rejected Doctors could access a Case queue through this story. No queue endpoint exists yet, and `getVerifiedDoctor` returns `null` unless status is Verified; Epic 4 must use that gate.
- **medium | patch** — Edge Case Hunter: unauthenticated oversized multipart requests could be buffered. Added pre-parse registration-token validation, a 51 MiB bound, and a route-level oversized unauthenticated test.
- **false** — Edge Case Hunter: expired rate-limit keys accumulate indefinitely. `recordOtpRequest` prunes expired keys every 100 requests, bounding the map; shared state across replicas is separately deferred.
- **maybe-false | defer** — Edge Case Hunter: per-process rate-limit state can be bypassed across replicas. A single replica is the current v1 assumption; shared TTL state is required before scaling out.
- **false** — Edge Case Hunter: expired Doctor OTP challenge records accumulate indefinitely. Challenge state is pruned every 100 starts, so stale entries are bounded; a shared store is separately deferred for multi-instance operation.
- **false** — Edge Case Hunter: expired login-failure records accumulate indefinitely. The failure map is pruned every 100 failures, bounding stale records; cross-instance coordination remains deferred.
- **low | patch** — Edge Case Hunter: partial files could remain after a failed local-disk write. `LocalDiskStorageProvider.save` now unlinks the generated path before rethrowing.
- **low | rejected** — Edge Case Hunter: cleanup can itself fail after a DB submission error. This requires simultaneous DB and filesystem deletion failure; durable retry infrastructure is beyond the approved local-storage scope.
- **low | patch** — Edge Case Hunter: the Doctors module ownership contract was removed. Restored the rule that callers must use `doctorsService`, not repository/domain internals.
- **medium | patch** — Verification Gap Reviewer: Doctor submission did not verify its session cookie or public response. Added an HTTP multipart test for the `doctor_session` cookie, Pending status, and omitted storage key.
- **medium | patch** — Verification Gap Reviewer: the Doctor OTP request limit lacked a test. Added coverage for the first three successes and generic fourth-request rejection.
## Design Notes

`Specialty` is treated as Doctors-owned reference data because AD-15 maps Admin catalog changes through `doctors.service` and the architecture forbids Doctors calling Admin. The storage provider persists opaque keys only; the Doctors service authorizes a caller before it asks the provider for bytes.

OTP challenges, rate limits, and login failure counts remain process-local under the current single-replica v1 assumption. These state stores and local-disk credentials must move to shared persistent services before scaling to multiple app instances. Abrupt process termination between saving local bytes and committing DB metadata may leave an orphan; the ordinary caught-error path deletes saved files.

## Verification

**Commands:**
- `npm test` -- expected: Patient and Doctor service/route tests pass.
- `npm run build` -- expected: all Doctor registration and credential routes/pages compile and are generated.
- `npx prisma validate` -- expected: Doctor, Specialty relation, and credential metadata schema validate.
- `npx prisma generate` -- expected: Prisma client generates from the Doctor schema.
- `npx prisma migrate dev` -- expected: additive Doctor/credential migration applies cleanly to the configured development database.

**Manual checks:**
- Submit a Doctor application with valid/invalid credentials and specialties; verify success shows `Pending` and invalid submission creates no partial Doctor.
- Confirm uploaded credential files are outside `public/` and another Doctor cannot retrieve them.

**Latest verification run:**
- `npm test` -- passed all 44 Patient and Doctor tests.
- `npm run build`, `npx prisma validate`, and `npx prisma generate` -- passed.
- `GET /doctors/register` and `GET /doctors/login` -- both returned HTTP 200; integrated browser automation timed out before screenshot/interaction.
- `npx prisma migrate dev --name add-doctor-registration` -- blocked by PostgreSQL authentication failure (`P1000`); Docker Desktop is unavailable, so migration application remains unverified.

Migration application and repository persistence need verification against PostgreSQL once valid credentials or a local database are available.

