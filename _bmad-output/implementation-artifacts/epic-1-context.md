# Epic 1 Context: Patient Registration & Authentication

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A Patient (or a guardian acting on behalf of a minor Patient) can register using a mobile number and OTP, set a password, and log back in with mobile + password. This epic delivers a complete, standalone authentication path for the Patient side, and its first story also lays down the project's foundational scaffold (module layout, database, dev environment) since no starter template exists — everything later work builds on top of it.

## Stories

- Story 1.1: Project Foundation & Dev Environment Setup
- Story 1.2: Mobile + OTP Registration
- Story 1.3: Post-OTP Password Setup & Login
- Story 1.4: Guardian Registration for a Minor Patient

## Requirements & Constraints

- A new registrant creates an account using only a mobile number and OTP — no email or pre-existing credential required.
- OTP delivery is mocked in v1 (no real SMS); the OTP expires 10 minutes after issuance.
- A mobile number that is already registered cannot be re-registered as a new account; the registrant is directed to log in or recover their account instead.
- OTP requests are rate-limited per mobile number to prevent abuse.
- After OTP verification, the registrant sets a password meeting a minimum complexity policy (at least 8 characters, mixed case + a number) before the account is considered fully registered.
- Login uses mobile number + password and issues a session; incorrect credentials are rejected with a typed error and no session is issued.
- A registrant can self-declare that the Patient is a minor; this is captured with no ID-based age verification, and flags the account as guardian-registered so later Case submission can carry guardian context.
- Whether OTP can be used as a fallback login method alongside password is still an open question — do not assume it is in scope.

## Technical Decisions

- No starter template exists, so Story 1.1 bootstraps the project from scratch per the architecture's Structural Seed: a Next.js app with per-module folders (`domain/`, `service.ts`, `repository.ts`, `routes/`) for each of the five domain modules, plus a `src/shared/` folder for cross-cutting provider interfaces, and a Prisma schema.
- Stack is pinned: Next.js 16.3.6, Node.js 26 LTS, PostgreSQL 18.6, Prisma ORM v7. Local dev runs via Docker Compose (app + Postgres).
- Consistency conventions to establish in the scaffold and follow throughout: `camelCase` for variables/functions, `PascalCase` for types/classes, `kebab-case` for file/folder names; `snake_case` for Postgres tables/columns; all cross-module API responses use a `{ data, error }` envelope; domain errors are typed per module and only mapped to HTTP status at the route-handler boundary.
- Auth sessions are real JWTs (only the OTP delivery channel is mocked) carrying `userId` and `role` (`patient` / `doctor` / `admin`); this shape must be established in the scaffold for later modules to reuse.
- OTP delivery is abstracted behind an `OtpProvider` interface with a `MockOtpProvider` implementation (fixed/logged OTP) — business logic must depend on the interface, not the mock directly, so a real SMS gateway can be swapped in later without touching calling code.
- All primary keys are UUIDs, and cross-module references are stored as plain ID columns only (e.g. no DB-level foreign keys across module boundaries) — this applies even though Patients is a leaf module in v1.
- Story 1.1's initial migration also seeds the `Specialty` reference table (15 defaults) and a single `PlatformSettings` record (default fees/platform-fee percentage); these are consumed by later epics but must exist from the first migration onward.

## Cross-Story Dependencies

- Story 1.1 (scaffold, DB, dev environment) must land before Stories 1.2–1.4, which all depend on the module layout, Prisma setup, and `OtpProvider` abstraction it establishes.
- Story 1.3 (password setup & login) builds directly on the OTP-verified account created in Story 1.2.
- Story 1.4 (guardian registration) extends the registration flow from Stories 1.2/1.3; the guardian/minor flag it sets is consumed downstream by Case submission in Epic 3.
