---
title: 'Mobile + OTP Registration'
type: 'feature'
created: '2026-09-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ff7c39b0ce0a7b02e4dc4c14b9133cd188affea5'
context: ['_bmad-output/implementation-artifacts/epic-1-context.md', '_bmad-output/planning-artifacts/architecture/architecture-secopinion-2026-09-22/ARCHITECTURE-SPINE.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way for a Patient (Registrant) to create an account — the Patients module is an empty skeleton, and no OTP-based registration flow exists.

**Approach:** Add a `Patient` model to the Prisma schema, and implement two Patients-module API routes backed by `MockOtpProvider` (from Story 1.1): one to start registration (send OTP for an unregistered mobile number) and one to verify the OTP and create the Patient account. Registration is rate-limited per mobile number.

## Boundaries & Constraints

**Always:**
- Use the existing `OtpProvider`/`MockOtpProvider` from `src/shared/otp-provider.ts` (Story 1.1) — do not reimplement OTP logic. Promote it to an exported module-level singleton (mirroring `src/shared/prisma-client.ts`'s pattern) so `sendOtp`/`verifyOtp` share state across requests.
- Use the `{ data, error }` envelope (`src/shared/api-envelope.ts`) and `DomainError` for every route response.
- `Patient.mobileNumber` is unique at the DB level (defense in depth alongside the application-level duplicate check).
- OTP expiry stays at 10 minutes (already implemented in `MockOtpProvider`, unchanged).
- OTP-request rate limit is max 3 requests per 10 minutes per mobile number (matches the OTP expiry window).

**Never:**
- Do not implement password setup or login — that is Story 1.3.
- Do not implement guardian/minor registration — that is Story 1.4.
- Do not wire a real SMS gateway — `MockOtpProvider` stays mocked.
- Do not add authentication/session issuance here — no JWT is issued by this story (first login is Story 1.3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start registration, new mobile number | Unregistered mobile number | OTP generated via `MockOtpProvider`; `otpId` + `expiresAt` returned to caller | N/A |
| Start registration, already-registered mobile number | Mobile number matches an existing `Patient` | Request rejected with typed error directing to login/recovery; no OTP issued | `ApiFailure` with a specific error code (e.g. `MOBILE_ALREADY_REGISTERED`) |
| Verify OTP, correct code within expiry | Valid `otpId` + correct `code` + the same `mobileNumber` | `Patient` row created (`mobileNumber` set, `passwordHash` null); mobile marked verified | N/A |
| Verify OTP, incorrect code | Valid `otpId` + wrong `code` | No `Patient` created | `ApiFailure`, typed error, no account created |
| Verify OTP, expired code | `otpId` whose `expiresAt` has passed | No `Patient` created | `ApiFailure`, typed error distinguishing expiry from wrong-code |
| Excessive OTP requests for one mobile number | 4th start-registration call for the same number within a 10-minute window | Request beyond the 3-per-10-minutes threshold is rejected | `ApiFailure` with a rate-limit error code |

## Code Map

- `src/shared/otp-provider.ts` -- existing `OtpProvider`/`MockOtpProvider` (Story 1.1); add an exported singleton instance here, do not change the interface.
- `src/shared/api-envelope.ts` -- existing `ok`/`fail`/`DomainError` -- reuse as-is.
- `src/shared/prisma-client.ts` -- existing shared Prisma client singleton -- import from `repository.ts`, do not construct a new client.
- `prisma/schema.prisma` -- existing file (`Specialty`, `PlatformSettings` only) -- add the new `Patient` model here.
- `src/modules/patients/{domain,service.ts,repository.ts,routes}` -- existing empty placeholders (Story 1.1) -- this story fills them in for the first time.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` -- add `Patient` model (`id` UUID, `mobileNumber` unique, `passwordHash` nullable, timestamps) -- required for FR-1's account creation
- [x] `prisma/migrations/` -- new migration for the `Patient` table -- keeps schema and DB in sync
- [x] `src/shared/otp-provider.ts` -- export a module-level `otpProvider: OtpProvider = new MockOtpProvider()` singleton -- required so state persists across the two-step start/verify flow
- [x] `src/modules/patients/domain/index.ts` -- `Patient` domain type + a simple in-memory rate-limit tracker (map of mobile number → request timestamps) -- required for the rate-limit AC
- [x] `src/modules/patients/repository.ts` -- `findByMobileNumber`, `create` against the `Patient` table via the shared Prisma client -- Patients-module-owned DB access (AD-2)
- [x] `src/modules/patients/service.ts` -- `startRegistration(mobileNumber)` and `verifyRegistration(mobileNumber, otpId, code)` exported service functions (the AD-2 seam) -- houses duplicate-check, rate-limit check, OTP calls, and Patient creation
- [x] `src/modules/patients/routes/index.ts` -- typed request/response helpers the App Router routes call into
- [x] `src/app/api/patients/register/start/route.ts` -- `POST` handler calling `patientsService.startRegistration` -- HTTP entry point for starting registration
- [x] `src/app/api/patients/register/verify/route.ts` -- `POST` handler calling `patientsService.verifyRegistration` -- HTTP entry point for completing registration

**Acceptance Criteria:**
- Given an unregistered mobile number, when `POST /api/patients/register/start` is called, then an OTP is issued via `MockOtpProvider` and `{ otpId, expiresAt }` is returned in the `data` envelope.
- Given a mobile number that already has a `Patient` row, when `POST /api/patients/register/start` is called, then the response is an `ApiFailure` with a duplicate-registration error code and no OTP is issued.
- Given a valid `otpId` and correct `code` for a mobile number, when `POST /api/patients/register/verify` is called, then a `Patient` row is created with that `mobileNumber` and a `null` `passwordHash`.
- Given an incorrect code or an expired `otpId`, when verify is called, then no `Patient` row is created and a typed `ApiFailure` is returned.
- Given 3 start-registration calls for the same mobile number within a 10-minute window, when a 4th call is made within that same window, then it is rejected with a rate-limit `ApiFailure` until the window resets.

## Implementation Notes

- Implemented by dispatched subagent (final report was truncated/partial, so all verification below was independently re-run): `Patient` model + migration, `otpProvider` singleton export, Patients module (`domain`, `repository`, `service`, `routes`) fully implemented, both App Router routes wired.
- Route handlers map the internal `Patient.id` to a public `patientId` field in responses and never expose `passwordHash` -- a deliberate, reasonable response-shaping choice, not a defect.
- `npm run build` compiles cleanly; both new routes (`/api/patients/register/start`, `/api/patients/register/verify`) appear in the build's route list as dynamic server-rendered endpoints.
- Full end-to-end verification against a real running dev server + temporary Postgres instance (migrations applied via `prisma migrate deploy`, then live HTTP requests): happy path (start → verify with the mock's fixed code → `Patient` row created with `password_hash` null) confirmed via direct DB query; duplicate-registration re-attempt correctly returned `409 MOBILE_ALREADY_REGISTERED`; wrong-code verify correctly returned `400 OTP_VERIFICATION_FAILED`; 4th start-registration call within the 10-minute window for a fresh number correctly returned `429 OTP_RATE_LIMIT_EXCEEDED` (3 prior calls all succeeded).
- All verification containers, env vars, and the ad-hoc test script were removed afterward; no leftover state.

## Spec Change Log

## Review Triage Log

- **medium | patch** — Blind Hunter: verification accepted a valid OTP challenge for a different mobile number. Bound each challenge to the normalized number used at issuance and added a regression test.
- **low | rejected** — Blind Hunter: incorrect OTP attempts are not rate-limited. The v1 provider uses a fixed, developer-visible mock code; per-attempt throttling is a separate policy for a real delivery provider and was not required by the approved scope.
- **medium | patch** — Blind Hunter: starting another registration removed expired challenge data, causing a later expired-code attempt to be reported as an incorrect code. Retained challenge expiry until verification and covered the sequence with a regression test.
- **medium | patch** — Blind Hunter: accepting the optional leading `+` without canonicalization allowed duplicate identities and separate rate-limit buckets. Normalize the number consistently before lookup, rate limiting, OTP issuance, and persistence.
- **maybe-false | defer** — Blind Hunter: process-local OTP and rate-limit state can be lost or bypassed across multiple application instances. The approved v1 explicitly uses in-memory state, and the deployment topology is unknown; replace it with shared TTL storage before adopting multi-instance hosting.
- **medium | patch** — Blind Hunter: service-only tests did not verify the HTTP route contract. Added separate start/verify route requests asserting shared OTP state, envelopes, and the public patient response.
- **medium | patch** — Edge Case Hunter: a challenge issued for one number could be used to register another. Bound challenges to the normalized destination and tested rejection plus subsequent valid verification.
- **medium | patch** — Edge Case Hunter: optional-plus variants were treated as separate patients and rate-limit keys. Canonicalized both inputs to the same digit-only representation.
- **low | patch** — Edge Case Hunter: expired per-number rate-limit entries could remain in memory indefinitely. Added periodic pruning of expired request windows.
- **low | patch** — Edge Case Hunter: abandoned mock OTP records could remain in the provider map. Added periodic pruning of expired OTP records during issuance.
- **low | rejected** — Edge Case Hunter: a persistence failure after OTP verification requires the registrant to request a new OTP. Successful verification intentionally consumes the one-time code in the existing provider contract; making consumption transactional would require a broader provider redesign, while restarting registration remains available.
- **medium | patch** — Verification Gap Reviewer: no test exercised start and verify as separate HTTP requests through the shared provider. Added a route-level flow using the application singleton and a stubbed repository.
- **medium | patch** — Verification Gap Reviewer: the public success envelope, returned patient fields, and omission of `passwordHash` were untested. Added explicit assertions to the route-level flow.
- **medium | patch** — Verification Gap Reviewer: HTTP status and failure-envelope mapping were untested. Added route assertions for malformed JSON and duplicate registration.
- **medium | patch** — Verification Gap Reviewer: the `P2002` unique-constraint race translation was untested. Added a focused service test asserting it becomes `MOBILE_ALREADY_REGISTERED`.

## Design Notes

Two-step flow: `start` returns `{ otpId, expiresAt }` to the caller, who echoes `otpId`, the mobile number, and the code to `verify`. Although `MockOtpProvider.verifyOtp(otpId, code)` only returns a boolean and does not carry the mobile number, the Patients service stores the normalized number with each issued challenge and requires the same number at verification. The in-memory rate-limit tracker lives in the Patients module (not `MockOtpProvider`, which is shared infra) since the limit is specific to registration abuse, not a general OTP concern.

## Verification

**Commands:**
- `npx prisma migrate dev --name add-patient` -- expected: applies cleanly, `patients` table created
- `npm run build` -- expected: compiles with no TypeScript errors
- Manual `curl`/Postman sequence: start → verify (happy path), start → start (duplicate), start → verify with wrong code, start → verify after simulated expiry, start ×(threshold+1) (rate limit) -- expected outcomes per the I/O matrix above

**Latest verification run:**
- `npm test` -- passed all 10 service and route tests.
- `npm run build` -- passed; both registration routes were generated.
- `npx prisma migrate dev --name add-patient` -- blocked because the configured PostgreSQL credentials for `secopinion_build` were rejected (`P1000`); no database state was changed by this attempt.
