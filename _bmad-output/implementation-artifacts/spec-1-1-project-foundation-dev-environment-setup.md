---
title: 'Project Foundation & Dev Environment Setup'
type: 'chore'
created: '2026-09-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '22589b439290ca5a5bec9e8ad206ae83f545c62b'
context: ['_bmad-output/implementation-artifacts/epic-1-context.md', '_bmad-output/planning-artifacts/architecture/architecture-secopinion-2026-09-22/ARCHITECTURE-SPINE.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No project scaffold exists yet — there is no Next.js app, module structure, database schema, or local dev environment, so no other story (in any epic) can be implemented.

**Approach:** Bootstrap a Next.js 16.3.6 (App Router, TypeScript) modular-monolith scaffold matching the Architecture Spine's Structural Seed, initialize Prisma against PostgreSQL 18.6 with an initial migration that seeds the Specialty catalog and PlatformSettings defaults, wire up Docker Compose for local dev, and stub the shared `OtpProvider`, API response envelope, and JWT auth-context conventions that every later module depends on.

## Boundaries & Constraints

**Always:**
- Follow the Structural Seed exactly: `src/modules/{patients,doctors,cases,payments,admin}/{domain,service.ts,repository.ts,routes}`, `src/shared/`, `src/app/`, `prisma/schema.prisma`, `docker-compose.yml`.
- Pin exact stack versions: Next.js 16.3.6, Node.js 26 LTS, PostgreSQL 18.6, Prisma ORM v7.
- All primary keys are UUIDs; no cross-module DB foreign keys; Postgres tables/columns are `snake_case`, Prisma models `camelCase`.
- API responses use a `{ data, error }` envelope; JWT auth context carries `userId` + `role`.

**Never:**
- Do not implement Patient/Doctor/Case business logic or CRUD — that belongs to Stories 1.2+ and later epics. This story only proves the scaffold boots and the shared conventions exist.
- Do not wire a real OTP/SMS gateway, real payment gateway, or real cloud storage — only the mock/interface abstractions this story needs (`OtpProvider`/`MockOtpProvider`).
- Do not create module-owned business tables beyond `Specialty` and `PlatformSettings` — every other module's tables are created by the story that first needs them.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh clone, `docker-compose up` | Empty local environment | Postgres 18.6 + app containers start; app reachable on configured port | N/A |
| Prisma migrate on empty DB | New Postgres instance | `Specialty` seeded with 15 rows; `PlatformSettings` seeded with 1 row (₹1,000/₹2,000/20%) | Migration fails loudly (non-zero exit) if DB is unreachable |
| Re-running migrate/seed on an already-seeded DB | Existing `Specialty`/`PlatformSettings` rows | Seed is idempotent — no duplicate rows created | N/A |

## Code Map

- Repository is currently empty of source code (only `.git/`, `.claude/`, `_bmad/`, `_bmad-output/` exist) — this is the first commit of application code. Nothing to reuse or preserve.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `tsconfig.json`, `next.config.ts` -- initialize a Next.js 16.3.6 (App Router) + TypeScript project -- base runtime for everything else
- [x] `src/app/layout.tsx`, `src/app/page.tsx` -- minimal App Router entry (layout + placeholder home page) -- proves the app boots end-to-end
- [x] `src/modules/{patients,doctors,cases,payments,admin}/{domain,service.ts,repository.ts,routes}` -- empty-but-present module skeleton (index/placeholder files) -- establishes the module-isolation boundary for every later story
- [x] `src/shared/otp-provider.ts` -- `OtpProvider` interface + `MockOtpProvider` implementation (fixed/logged OTP, no real SMS) -- required by Story 1.2
- [x] `src/shared/api-envelope.ts` -- `{ data, error }` response-envelope helper + typed domain-error base class -- required by every module's routes
- [x] `src/shared/auth-context.ts` -- JWT payload shape (`userId`, `role`) + sign/verify helpers -- required by Story 1.3 login
- [x] `prisma/schema.prisma` -- PostgreSQL 18.6 datasource, Prisma v7, UUID-default convention, `Specialty` and `PlatformSettings` models -- foundation for all module schemas
- [x] `prisma/migrations/`, seed script -- initial migration + idempotent seed (15 default Specialties, one PlatformSettings row) -- required by Epic 2/3/5 stories
- [x] `docker-compose.yml` -- local Postgres 18.6 service + app service -- required local dev environment
- [x] `.env.example` -- documented required environment variables (DB connection string, JWT secret) -- onboarding for future contributors

**Acceptance Criteria:**
- Given an empty repository, when the project is scaffolded, then `npm run dev` starts the app successfully with the Structural Seed's module layout present on disk.
- Given `docker-compose up`, when Postgres and the app start, then the app connects to Postgres and Prisma migrations apply cleanly.
- Given the initial migration runs, when it completes, then `Specialty` has exactly 15 seeded rows and `PlatformSettings` has exactly 1 row with defaults ₹1,000 / ₹2,000 / 20%.
- Given `src/shared/`, when inspected, then `OtpProvider`/`MockOtpProvider`, the `{ data, error }` envelope helper, and the JWT auth-context shape all exist and are exported for later modules to import.

## Implementation Notes

- Implemented by dispatched subagent: Next.js 16.3.6 + TypeScript App Router scaffold, 5-module skeleton, `src/shared/` (`otp-provider.ts`, `api-envelope.ts`, `auth-context.ts`, plus a `prisma-client.ts` helper), `prisma/schema.prisma` (`Specialty`, `PlatformSettings`), `prisma/seed.ts`, `docker-compose.yml`, `Dockerfile`, `.env.example`, `.gitignore`.
- Verified directly (subagent returned no final report, so all verification below was independently re-run and confirmed against the actual repo state): `npm run build` compiles and generates static pages successfully.
- Local port 5432/3000 were already occupied by an unrelated pre-existing Docker stack on this machine; host-based `npx prisma migrate dev`/`db seed` verification (below) used a temporary standalone container on port 5433, but the actual `docker-compose up --build` path was subsequently verified for real (see Review Triage Log and third-party review below) using a locally-temporary port remap (5434/3001) that was reverted afterward -- `docker-compose.yml`'s committed ports (5432/3000) are the standard defaults for a clean machine.
- `npx prisma migrate dev --name init` applied cleanly, creating `prisma/migrations/20260923143944_init/migration.sql`.
- `npx prisma db seed` run twice confirmed idempotency: `specialties` stayed at 15 rows, `platform_settings` stayed at 1 row (₹1,000 / ₹2,000 / 20.00%) across both runs.
- **Post-review re-verification:** after applying the Review Triage Log's patch fixes, ran a real `docker compose up --build -d` end-to-end (temporary port remap, reverted after): image built successfully (including the corrected `Dockerfile` `prisma generate` step), `app` container's startup command generated the Prisma client, applied the `20260923143944_init` migration automatically, and started `next dev`; `curl` against the app returned `HTTP 200`; `prisma db seed` run again inside the container confirmed 15 `specialties` / 1 `platform_settings` row (still idempotent). All verification containers and the temporary port override were removed afterward -- no leftover state.
- Temporary verification containers/files removed after checks; no leftover state.

## Spec Change Log

## Review Triage Log

- **high | patch** — `docker-compose.yml`'s `app` service `command` is plain `npm run dev`, with no `prisma generate`/`prisma migrate deploy` step, and the bind mount (`.:/app`) shadows the image's build-time-generated Prisma client. This fails the story's own AC ("Given docker-compose up... Prisma migrations apply cleanly") and would break as soon as any `repository.ts` imports `prisma-client.ts`. Verified by reading `docker-compose.yml`/`Dockerfile` directly. Fix: run `prisma generate && prisma migrate deploy` before `next dev` in the `app` command.
- **high | patch (found during patch verification)** — Applying the fix above and actually running `docker-compose up --build` (as the verification-gap reviewer noted had never been done) surfaced a second, previously-undetected bug: `Dockerfile`'s `RUN npx prisma generate` failed at image-build time with `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`, because `prisma.config.ts` resolves `DATABASE_URL` eagerly even for `generate`, and no env var is available during the build stage. Fix: scope a placeholder `DATABASE_URL` to that one `RUN` instruction only (`RUN DATABASE_URL="...placeholder..." npx prisma generate`) -- the real value from `docker-compose.yml`'s `environment:` still overrides it at container runtime.
- **high | patch** — `Dockerfile` has no `.dockerignore`; `COPY . .` after `RUN npm install` would copy a host `node_modules` (if present) over the container's freshly-installed Linux one, breaking native bindings, plus risk copying `.git`/`.env`. Verified by inspecting `Dockerfile` and confirming no `.dockerignore` exists. Fix: add `.dockerignore`.
- **low | patch** — `MockOtpProvider.verifyOtp` (`src/shared/otp-provider.ts`) returns `true` on a correct code without deleting the entry, allowing replay of the same OTP until its 10-minute TTL. Verified by reading the method. Fix: delete the entry on successful match (one-line change).
- **low | patch** — `src/shared/prisma-client.ts` and `prisma/seed.ts` both pass `process.env.DATABASE_URL` to `PrismaPg` unguarded, unlike the fail-loud pattern already established for `JWT_SECRET` in `auth-context.ts` in this same diff. Verified by reading both files. Fix: add the same guard-and-throw pattern.
- **low | patch** — Stack pins Node.js 26 LTS but no `.nvmrc` exists for contributors working outside Docker. Verified by directory listing. Fix: add `.nvmrc` with `26`.
- **low | rejected** — `verifyAuthToken` (`src/shared/auth-context.ts`) doesn't catch `jwt.verify`'s exceptions or validate `role` against the fixed enum. Real but unlikely to be met in this diff's everyday use (no caller exists yet — Story 1.3 is the first caller), and the fix requires new try/catch + enum-validation branches, not a direct correction — rejected per the low-finding reject rule.
- **low | rejected** — `MockOtpProvider.issuedOtps` (`src/shared/otp-provider.ts`) is only pruned lazily inside `verifyOtp`; never-verified OTPs accumulate for the process lifetime. Real but unlikely to matter at this diff's scale (nothing calls it yet), and the fix (a sweep mechanism) is more than a direct correction — rejected.
- **low | rejected** — `prisma/seed.ts` constructs its own `PrismaPg`/`PrismaClient` instead of importing the shared singleton from `src/shared/prisma-client.ts`. Real duplication, but a defensible pattern for a standalone seed script run via `tsx` outside Next.js's module system, and reconciling it is more than a direct correction — rejected.
- **false** — `MockOtpProvider` has no exported singleton instance. No caller exists in this diff to demonstrate broken behavior; instantiation/wiring lifecycle belongs to Story 1.2, not this story's AC.
- **false** — `docker-compose.yml`'s `JWT_SECRET: ${JWT_SECRET:-dev-secret-change-me}` "defeats" `getJwtSecret()`'s fail-loud guard. This is an intentional, clearly-named dev-only convenience default for `docker-compose up`; it doesn't violate any Always/Never boundary, and the fail-loud guard still holds for host-based `npm run dev` without Docker.
- **false** — `src/shared/api-envelope.ts` has no `DomainError`→`ApiFailure` mapping helper. No route handler exists yet in this diff to need one; the AC only required the envelope helper and error base class to exist, both of which do.
- **maybe-false, would be low if true** — `agentRules: false` in `next.config.ts` may not be a real `NextConfig` field. `npm run build`'s TypeScript check passed against this exact object literal with no excess-property error, which weighs against "invalid option," but Next.js 16.3.6's actual runtime handling of this field cannot be independently confirmed from here. Rejected per the maybe-false rule (would only be low severity if true).
- **defer** — No lint/formatting tooling (ESLint/Prettier), no test framework/script, no CI workflow, and no root `README.md` walkthrough exist. These were not in this story's human-approved Tasks & Acceptance list at Checkpoint 1, and adding them now would expand approved scope rather than fix a defect in what was built. Logged to `deferred-work.md` for the human to decide: fold into a follow-up story, or accept as-is for this POC.

## Design Notes

The seed script must be idempotent (safe to re-run against an already-seeded DB, e.g. via upsert-by-name for `Specialty` and a fixed singleton id for `PlatformSettings`) since `prisma migrate dev` may run its seed hook multiple times in local development.

## Verification

**Commands:**
- `npm install` -- expected: completes with no errors
- `docker-compose up -d db && npx prisma migrate dev` -- expected: migration applies, seed runs, exits 0
- `npm run dev` -- expected: server starts on the configured port with no runtime errors
- `npx prisma studio` (or an equivalent query) -- expected: `Specialty` shows 15 rows, `PlatformSettings` shows 1 row with the default values
