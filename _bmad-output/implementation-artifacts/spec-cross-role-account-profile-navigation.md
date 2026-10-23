---
title: 'Cross-Role Account Profile Navigation'
type: 'feature'
created: '2026-10-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'bc706ff6a54c65f4b43c0e27e08e97bf98db0843'
context: ['_bmad-output/implementation-artifacts/epic-1-context.md', '_bmad-output/implementation-artifacts/spec-1-3-post-otp-password-setup-login.md', '_bmad-output/implementation-artifacts/spec-2-2-doctor-upi-payout-details.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Patient, Doctor, and Admin workspaces do not consistently identify the signed-in account or provide an obvious path to its profile. Patient and Admin have no profile destination, while the Doctor profile currently focuses on payout details.

**Approach:** Add a shared account identity link to authenticated workspace headers, backed by role-specific, owner-scoped profile APIs. Create read-only Patient and Admin profile pages and extend the Doctor profile with read-only account identity details while preserving its existing editable payout controls.

## Boundaries & Constraints

**Always:** Keep identity fields read-only in this feature. Derive profile ownership from the HttpOnly role session and signed JWT; never accept a caller-supplied account ID as authorization. Return only explicitly allow-listed profile fields with `private, no-store`; never expose password hashes, session tokens, Doctor credentials, or another account's data. Use Doctor full name as the Doctor display identity and the account username for Patient and Admin. Keep login and registration pages unauthenticated and unchanged.

**Never:** Change authentication token shape, role behavior, password policy, payment behavior, or add database migrations without need. Preserve the existing Doctor UPI edit and payout-history behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signed-in workspace | Valid Patient, Doctor, or Admin cookie | Header identifies the current account and links to that role's profile | Keep a role-specific fallback link if identity fetch fails |
| Read own profile | Valid role session | Return only the caller's profile-safe data | Private no-store response |
| Missing or wrong-role session | No valid matching role cookie | No account data is returned | 401/403 using the module's typed error pattern |
| Profile link navigation | User opens the header link | Navigate to `/patients/profile`, `/doctors/profile`, or `/admin/profile` | Unauthorized pages show sign-in guidance |

</frozen-after-approval>

## Code Map

- `src/app/cases/page.tsx`, `src/app/cases/new/page.tsx`, and `src/app/cases/[caseId]/page.tsx` -- Patient workspace headers need the shared identity link; `/patients/profile` is new.
- `src/app/doctors/queue/page.tsx` and `src/app/doctors/profile/page.tsx` -- add identity navigation and extend the existing payout profile with account details.
- `src/app/admin/page.tsx` -- add the signed-in Admin identity link; `/admin/profile` is new.
- `src/modules/patients/service.ts`, `repository.ts`, and `routes/index.ts` -- add owner-scoped Patient profile lookup and role-session guard.
- `src/modules/doctors/service.ts`, `repository.ts`, and `routes/index.ts` -- add a safe self-profile projection and Doctor-session guard; preserve payout operations.
- `src/modules/admin/service.ts`, `repository.ts`, and `routes/index.ts` -- add Admin self-lookup by session user ID and reuse `requireAdminContext`.
- `src/app/api/{patients,doctors,admin}/profile/` -- add private GET profile endpoints; keep data access inside each owning module.
- `src/app/components/account-profile-link.tsx` and `src/app/globals.css` -- create the shared topbar identity link and responsive styling.
- Existing Patient, Doctor, and Admin service/route test suites -- verify role authorization, owner derivation, safe projections, and profile responses.

## Tasks & Acceptance

**Execution:**
- [x] Add role-owned profile read operations and GET endpoints with auth, safe projections, and `private, no-store` headers.
- [x] Build shared account identity navigation and show it on authenticated Patient, Doctor, and Admin workspace/profile headers.
- [x] Add Patient/Admin profile destinations and complete the Doctor identity section, including registered specialties, without changing UPI/payout behavior.
- [x] Extend each module's service/route tests for correct identity, role rejection, and absence of private fields.

**Acceptance Criteria:**
- Given a signed-in user in any role workspace, when a page loads, then the header identifies that account and links to its role's profile.
- Given a user requests profile data, when the role session is valid, then only the session owner's approved fields are returned.
- Given a missing, invalid, or wrong-role session, when profile data is requested, then no account data is disclosed.
- Given a Doctor opens their profile, when account identity is shown, then existing UPI editing and payout history remain available.
- Given a Doctor has declared specialties, when they open their profile, then all registered specialty names are visible; if none are registered, the profile shows an empty state.

## Implementation Notes

- Added owner-scoped Patient, Doctor, and Admin profile GET operations using each module's own repository and role guard; projections exclude credentials and hashes and responses use `private, no-store`.
- Added Patient and Admin read-only profile pages, identity details on the existing Doctor payout profile, and an explicit-role `AccountProfileLink` on all authenticated workspace/profile headers. Doctor UPI editing and payout history remain unchanged.
- Added an SSR test for all three role-specific identity fallbacks and destinations, plus service/route tests for safe fields, session-derived ownership, wrong-role rejection, and missing accounts.
- Verification passed: `npm test` (199 tests), `npx tsc --noEmit`, and `npm run build`. Live checks for all roles returned 200 for login, profile API, and profile page; APIs returned `private, no-store`.
- Integrated browser click-through could not be verified because the browser connection timed out; SSR link rendering and live HTTP/API checks passed.

- Added Patient `/api/patients/profile` and `/patients/profile`, Doctor `/api/doctors/profile/account` plus identity details on `/doctors/profile`, and Admin `/api/admin/profile` plus `/admin/profile`.
- Added `AccountProfileLink` with explicit role selection to all authenticated Patient, Doctor, and Admin workspace/profile headers. It displays the role's safe display name, links to its profile, and keeps a fallback account label if identity loading fails.
- Profile ownership is derived only from role cookies/JWTs; responses are allow-listed and `private, no-store`. Existing Doctor UPI editing and payout history are unchanged. No schema migration was needed.
- Verification passed: `npm test` (196 tests), `npx tsc --noEmit`, and `npm run build`. Live smoke checks for Patient, Doctor, and Admin login/profile API/profile page each returned 200; profile APIs returned `private, no-store`.
- Browser click-through could not be verified because the integrated browser connection timed out twice; endpoint and page HTTP checks passed.
- Follow-up: Doctor identity profile now includes specialty names from the Doctors-owned relation. The known demo Doctor API returned Orthopedics, and the aditya database row contains Dermatology and Neurosurgery.

## Spec Change Log

## Review Triage Log

- false — Blind Hunter: the Doctor profile endpoint's session extraction follows the existing `/api/doctors/profile/upi` pattern; the service enforces the Doctor role and the route maps wrong-role access to 403.
- false — Blind Hunter: the generic fallback on profile-fetch failure is explicitly required by the I/O matrix, so the identity link remains usable with a role-specific profile destination.
- false — Blind Hunter: Patient profile reuses the app's existing case shell classes, while the new account content and shared identity link have dedicated styles; this is consistent with the established page system.
- false — Blind Hunter: role-specific display names are deliberate and specified: Doctor full name, Patient/Admin username; the header does not combine identities in one list.
- false — Blind Hunter: Patient profile has a Your Cases navigation link; Admin profile has a Back to Admin dashboard link; Doctor profile links to the Case queue.
- low (rejected) — Blind Hunter: Doctor profile currently fetches identity once for the profile section and once for the shared header; this is one extra self-profile read per visit, and eliminating it would require more shared-state complexity than the negligible cost warrants.
- false — Blind Hunter: service and route tests for all three modules cover own-session identity, missing/wrong-role rejection, and private no-store responses.
- false — Blind Hunter: long display names are visually truncated with CSS ellipsis, and the profile name has a bounded width on desktop and mobile.
- false — Blind Hunter: `AccountProfileLink` is typed to accept only the three internal role literals, and its callers provide explicit literals; there is no untyped role input path.
- false — Blind Hunter: audit logging is not required by the approved profile-navigation intent and would add account-access logging outside the requested scope.
- false — Edge Case Hunter: `SessionAuthorizationError` is defined and exported by the Doctor domain and is already used by the existing payout profile route.
- false — Edge Case Hunter: `patientsRepository.findById` exists in the Patients module and is used by existing Patient service operations.
- false — Edge Case Hunter: `doctorsRepository.findById` exists in the Doctors module and is used by existing Doctor service operations.
- false — Edge Case Hunter: Doctor `fullName`, `username`, and `mobileNumber` are required schema/domain fields; the profile query returns an account or a typed not-found error, not a partial projection.
- low (rejected) — Verification Gap Reviewer: client-side identity fetch state is not mounted in a UI test; the SSR test covers all fallback labels/links, API tests cover returned names and authorization, and live role smoke tests passed. Adding a DOM test harness is disproportionate in this repository, which has none.
- low (rejected) — Verification Gap Reviewer: the Patient profile page has no component test; its profile service/route are tested and the live Patient profile page/API returned 200. Adding a UI harness solely for this read-only page is disproportionate.
- low (rejected) — Verification Gap Reviewer: the Doctor identity section has no component test; its service/route are tested and the live Doctor profile page/API returned 200. The existing payout UI is unchanged, and a new component harness is disproportionate.
- low (rejected) — Verification Gap Reviewer: the Admin profile page has no component test; its service/route are tested and the live Admin profile page/API returned 200. Adding a UI harness solely for this read-only page is disproportionate.

## Design Notes

Display names follow existing account data: Doctor full name, Patient username, and Admin username. The shared header link should show the role-appropriate identity plus a clear `Profile` label; it should not become a dropdown or replace existing workspace navigation/sign-out controls.

## Verification

**Commands:**
- `npm test` -- expected: all module and route tests pass with profile coverage.
- `npx tsc --noEmit` and `npm run build` -- expected: new APIs, shared header, and role pages compile.
- Manual/authenticated HTTP checks -- expected: each role sees its own profile, anonymous and cross-role requests are rejected, and response headers prevent caching.
