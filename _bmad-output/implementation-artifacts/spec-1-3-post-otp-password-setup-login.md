---
title: 'Post-OTP Password Setup & Login'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '3d949315195cbf69a2088eab5741a93f23e17ff8'
context: ['_bmad-output/implementation-artifacts/epic-1-context.md', '_bmad-output/implementation-artifacts/spec-1-2-mobile-otp-registration.md', '_bmad-output/planning-artifacts/architecture/architecture-secopinion-2026-09-22/ARCHITECTURE-SPINE.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Patient created through mobile + OTP registration has no password and cannot complete registration or log in again. The Patients module has no password setup or login path.

**Approach:** After OTP registration, let the Patient choose a unique username and password, then log in with those credentials. Successful login issues the existing patient JWT in an HttpOnly cookie; OTP remains registration-only in v1.

## Boundaries & Constraints

**Always:** Enforce at least 8 characters with uppercase, lowercase, and a number; hash passwords with Argon2id; accept usernames of 3-30 ASCII letters, numbers, or underscores, normalize them to lowercase, and enforce uniqueness; permit setup only with a short-lived, purpose-specific credential issued by successful OTP registration and only while `passwordHash` is null; return typed errors in `{ data, error }`; map errors to HTTP only at route handlers; login JWTs carry the existing `userId` and `role: patient` claims in an HttpOnly, SameSite=Lax cookie with Secure enabled in production; incorrect credentials issue no session.

**Never:** Store or expose plaintext passwords or password hashes; allow password setup to act as password reset; permit OTP login fallback; change OTP delivery to real SMS; implement guardian registration (Story 1.4); issue a patient session before credentials are set or automatically log the Patient in after setup.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Set password after OTP | Valid setup authorization, patient has no password, valid unique username, compliant password | Hash and normalized username are stored; account becomes eligible for login | Success envelope; no password/hash returned |
| Invalid password | Password is too short or lacks required character classes | No password change | Typed validation failure |
| Invalid or duplicate username | Username fails the format rule or is already taken case-insensitively | No account credential change | Typed validation or username-conflict failure |
| Unauthorized or repeated setup | Missing/invalid/expired setup credential, or password already set | No password change | Typed failure; no session |
| Login success | Existing patient with password and matching username/password | Patient JWT issued with `userId` and `role: patient` in the session cookie | Success envelope; cookie set |
| Login failure | Unknown username, unset password, or incorrect password | No session issued | Generic typed invalid-credentials failure |

</frozen-after-approval>

## Code Map

- `src/shared/auth-context.ts` -- reuse `signAuthToken` and `verifyAuthToken`; signing already defaults to a 7-day JWT and the `AuthContext` shape is `userId` + `role`.
- `src/modules/patients/domain/index.ts` -- reuse `Patient` and `DomainError`; place password/login errors with the Patients domain.
- `src/modules/patients/service.ts` -- current registration flow creates the patient with `passwordHash: null`; issue the setup credential after OTP verification and add Patients-owned setup/login operations here.
- `src/modules/patients/repository.ts` -- add username lookup, normalized unique username/password update, and login lookup; keep patient-table access inside this repository.
- `src/modules/patients/routes/index.ts` -- reuse request parsing and domain-error-to-HTTP mapping conventions.
- `src/app/api/patients/register/verify/route.ts` -- current successful verification returns `patientId` and `mobileNumber`; extend it to issue the short-lived setup credential as an HttpOnly cookie.
- `prisma/schema.prisma` -- `Patient.passwordHash` is already nullable; add a normalized unique `username` field with an additive migration.
- `package.json` -- no password-hashing dependency exists; add a maintained Argon2id implementation.
- `src/app/login/page.tsx` and `src/app/register/password/page.tsx` -- add patient-facing username/password login and first-password setup forms.
- `src/modules/patients/service.test.ts` -- extend current Node test patterns for service behavior and route envelopes.

## Tasks & Acceptance

**Execution:**
- [x] `src/modules/patients/service.ts` -- implement authorized one-time password setup and username/password authentication -- completes the existing patient registration lifecycle.
- [x] `src/modules/patients/domain/index.ts` -- add typed password-policy, setup-authorization, and invalid-credentials errors -- keeps domain failures explicit.
- [x] `src/modules/patients/repository.ts` -- persist a normalized username/password hash and load a patient for authentication without exposing the hash outside the module -- maintains Patients table ownership.
- [x] `src/modules/patients/routes/index.ts` -- parse setup/login requests and map typed errors to HTTP responses -- preserves route-boundary error mapping.
- [x] `src/app/api/patients/password/setup/route.ts`, `src/app/api/patients/login/route.ts`, and `src/app/api/patients/logout/route.ts` -- expose credential setup, cookie-backed login, and cookie clearing -- make the session flow available to clients.
- [x] `src/shared/auth-context.ts` -- add purpose-specific setup-token helpers and retain the standard session claim contract -- separate setup authorization from authenticated sessions.
- [x] `package.json` -- add and configure Argon2id password hashing -- protect stored credentials.
- [x] `prisma/schema.prisma` and a new migration -- add the normalized unique username field -- keep database schema aligned.
- [x] `src/app/login/page.tsx` and `src/app/register/password/page.tsx` -- implement responsive patient login and first-password setup screens -- complete the user-facing authentication flow.
- [x] `src/modules/patients/service.test.ts` -- cover policy boundaries, setup authorization/replay, username uniqueness, successful login, and failed login -- verifies the edge-case matrix.

**Acceptance Criteria:**
- Given an OTP-verified Patient with a valid setup credential, when they submit a unique valid username and compliant password, then normalized username and password hash are stored and no plaintext or hash is returned.
- Given an invalid/duplicate username, password that violates policy, expired setup credential, or Patient whose password is already set, when setup is attempted, then the request fails with a typed error and stored credentials remain unchanged.
- Given a Patient with credentials, when they log in with the correct username and password, then a patient JWT with the standard auth claims is issued in an HttpOnly session cookie.
- Given incorrect credentials, an unknown username, or a passwordless Patient, when login is attempted, then a generic typed authentication failure is returned and no JWT/session is issued.
- Given an authenticated Patient, when they log out, then the session cookie is cleared.

## Implementation Notes

- Added a 1024-character password maximum to bound Argon2 input, and a process-local limit of 20 failed login attempts per normalized username per 15-minute window. Unknown and passwordless usernames run a dummy Argon2id verification to reduce timing-based account enumeration.
- Password setup uses an atomic repository update requiring `passwordHash: null`; a concurrent service test confirms only one setup request consumes the credential. The login page confirms successful password setup before asking the patient to sign in.
- The setup/login pages were smoke-tested at desktop and mobile sizes, and their mocked API request payloads and redirects were exercised in the browser.
- `npm test` passes all 19 patient service and route tests; `npm run build` passes and generates the expected API and page routes.
- Database-backed migration verification remains blocked: `npx prisma migrate dev --name add-patient-username` failed with `P1000` because credentials for `secopinion_build` were rejected. The dev server also had no `DATABASE_URL`; no database changes were made.
- `npm audit --omit=dev` reports four high-severity findings in the Prisma dependency tree (`deepmerge-ts` and `mysql2`). The suggested `npm audit fix --force` would downgrade Prisma to 6.19.3, so no dependency downgrade was applied.

## Spec Change Log

## Review Triage Log

- **low | rejected** — Blind Hunter: no client registration screen navigates from OTP verification to password setup. This story's approved UI scope is the setup and login screens; Story 1.2 owns OTP registration and exposes API routes, so adding a new OTP registration screen would expand this story.
- **low | rejected** — Blind Hunter: successful login returns to the scaffold home page rather than a patient dashboard. The approved acceptance requires issuing a patient session cookie, which the login route does; a dashboard and protected patient home are not part of this story.
- **false** — Blind Hunter: logout does not revoke a copied JWT. The approved session is a stateless JWT in an HttpOnly cookie, and logout clears that cookie at the same path; server-side revocation was not specified.
- **medium | patch** — Blind Hunter: unknown/passwordless usernames skipped Argon2 verification and could be distinguished by response time. Login now performs a dummy Argon2id verification for those cases and retains one generic error response.
- **medium | patch** — Blind Hunter: repeated login guesses were not throttled. Added a limit of 20 failures per normalized username per 15-minute window; failures remain generic.
- **medium | patch** — Blind Hunter: unbounded passwords could drive oversized Argon2 inputs. Setup and login now cap passwords at 1024 characters, and the setup form reflects that limit.
- **false** — Blind Hunter: username uniqueness relied only on a case-sensitive database index. All service setup writes normalize usernames to lowercase before lookup and persistence, and no alternate module write path exists under the Patients-module ownership rule.
- **false** — Blind Hunter: `.next/dev/types` imports might fail in production. `npm run build` completed successfully with the current `next-env.d.ts` contents and generated all routes.
- **low | patch** — Blind Hunter: the setup-completion query parameter had no visible confirmation. The login page now displays a status message when setup redirects with `setup=complete`.
- **medium | patch** — Edge Case Hunter: Argon2 inputs had no maximum length. Added the 1024-character service/form bound and a regression test for an overlong password.
- **medium | patch** — Edge Case Hunter: patient login permitted unbounded repeated guesses. Added the per-username failure window and test coverage for the threshold.
- **medium | patch** — Edge Case Hunter: tests did not exercise exact credential boundaries. Added tests for the minimum password length and minimum/maximum username lengths.
- **low | rejected** — Verification Gap Reviewer: the database concurrency predicate lacks a live database race test. The repository uses one atomic `updateMany` filtered by `passwordHash: null`, and a concurrent service test verifies only one setup succeeds; a database-backed test could not be run because the configured credentials fail with `P1000`.
- **low | rejected** — Verification Gap Reviewer: client page requests and navigation lack a persistent browser test. Browser smoke tests exercised setup confirmation, request payloads, login navigation, and desktop/mobile layouts; adding a UI test harness is beyond the current repository's test setup.

## Design Notes

Use Argon2id for password hashing; password comparisons must never use plaintext equality against stored data. Compare normalized usernames case-insensitively and avoid distinguishing unknown usernames from incorrect passwords in login responses. The setup credential is separate from a patient session and is only accepted while the patient's password is unset; successful setup clears it and sends the Patient to the login page. The login failure window is process-local for this v1 slice and must move to shared TTL storage before running multiple application instances.

## Verification

**Commands:**
- `npm test` -- expected: all patient registration and Story 1.3 service/route tests pass.
- `npm run build` -- expected: TypeScript and Next.js build succeed with setup/login routes included.
- `npx prisma migrate dev` -- expected: any approved additive migration applies cleanly to the configured development database.

**Latest verification run:**
- `npm test` -- passed all 19 tests.
- `npm run build` -- passed; setup, login, logout, registration, and patient-facing pages were generated.
- `npx prisma migrate dev --name add-patient-username` -- blocked by PostgreSQL authentication failure (`P1000`); no database state was changed.
- Browser smoke test -- login and setup pages rendered at desktop and mobile sizes; mocked requests verified payloads, setup confirmation, and post-login navigation.