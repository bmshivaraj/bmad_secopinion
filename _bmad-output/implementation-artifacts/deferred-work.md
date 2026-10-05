- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-project-foundation-dev-environment-setup.md`
  summary: Add lint/formatting tooling (ESLint/Prettier config) to enforce the naming conventions the scaffold establishes.
  evidence: No lint tooling exists; nothing currently enforces camelCase/PascalCase/kebab-case/snake_case for later stories. Not in the human-approved Story 1.1 task list, so not added as part of that story's patch fixes.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-project-foundation-dev-environment-setup.md`
  summary: Add a test framework (config + `test` script) to the project.
  evidence: No test framework exists anywhere in package.json. Not in the human-approved Story 1.1 task list.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-project-foundation-dev-environment-setup.md`
  summary: Add a CI workflow (e.g. GitHub Actions) to run build/lint/test on push or PR.
  evidence: No CI config exists. Not in the human-approved Story 1.1 task list.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-project-foundation-dev-environment-setup.md`
  summary: Add a root README.md walking a new contributor through docker-compose up, migrate, and seed.
  evidence: `.env.example` documents required variables but nothing narrates the end-to-end setup flow. Not in the human-approved Story 1.1 task list.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-mobile-otp-registration.md`
  summary: Replace process-local OTP challenge and registration rate-limit state with shared TTL storage before deploying multiple application instances.
  evidence: The current approved v1 uses in-memory state; a request routed to another instance cannot verify the challenge and may not observe the originating instance's per-number limit. Deployment topology is not yet specified.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-post-otp-password-setup-login.md`
  summary: Move patient login-failure throttling to shared TTL storage before deploying multiple application instances.
  evidence: The current 20-failure/15-minute throttle is process-local, so requests routed to different instances do not share the same attempt count; deployment topology is not yet specified.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-guardian-registration-for-minor-patient.md`
  summary: Run database-backed guardian migration and Patient repository verification when valid PostgreSQL credentials or a local Docker database are available.
  evidence: The configured database rejected credentials with `P1000`, and Docker Desktop was unavailable. Prisma schema validation, client generation, tests, and build passed, but the migrated Patient row could not be queried.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-guardian-registration-for-minor-patient.md`
  summary: Decide whether guardian authority attestations require timestamped/versioned audit evidence before wider rollout.
  evidence: v1 now requires the attestation and persists guardian-registration status, but the PRD does not specify attestation text retention, timestamp, or versioning requirements.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-doctor-registration-credentials-specialties.md`
  summary: Verify the Doctor registration migration and credential persistence against PostgreSQL once valid credentials or a local database are available.
  evidence: Prisma schema/client validation passed, but migration application returned `P1000`, and Docker Desktop is unavailable; the production repository write has not been exercised against a live database.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-doctor-registration-credentials-specialties.md`
  summary: Move Doctor OTP challenges, request limits, and login-failure throttles to shared TTL storage before running multiple app instances.
  evidence: These controls remain process-local under the current single-replica v1 assumption, so restarts can lose state and multiple replicas can bypass shared enforcement.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-doctor-upi-payout-details.md`
  summary: Apply the Doctor UPI migration and verify payout ID create/read/update persistence against PostgreSQL.
  evidence: Prisma validation and client generation pass, but migration application and real repository persistence could not be verified because PostgreSQL rejected the configured credentials with `P1000`.
