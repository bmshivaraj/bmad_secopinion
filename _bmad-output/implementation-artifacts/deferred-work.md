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

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-doctor-upi-payout-details.md`
  summary: Repair malformed Story 2.2 frontmatter so the title and metadata parse correctly.
  evidence: The current working-tree file starts with a stray title fragment instead of a YAML frontmatter delimiter; it predates and is unrelated to Story 2.3.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-admin-manual-verification-review.md`
  summary: Verify Pending-only Doctor status updates and application persistence against PostgreSQL, including overlapping decisions.
  evidence: The repository uses a transactional conditional update and fake-based suites pass, but a database-backed race/persistence assertion is unavailable because PostgreSQL authentication returns `P1000`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-admin-manual-verification-review.md`
  summary: Confirm whether verification decisions require a retained actor, rationale, and audit history.
  evidence: The approved workflow makes decisions final but specifies one Admin and does not define an audit record; product/compliance requirements are needed before adding persistence or UI.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-admin-manual-verification-review.md`
  summary: Reconcile Story 2.4's done spec status with its backlog sprint-status entry.
  evidence: The Story 2.4 spec is marked done while `2-4-admin-manages-specialty-catalog` remains backlog; this unrelated tracker discrepancy was not changed.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-doctor-upi-payout-details.md`
  summary: Repair malformed Story 2.2 frontmatter so the title and metadata parse correctly.
  evidence: The current working-tree file starts with a stray title fragment instead of a YAML frontmatter delimiter; it predates and is unrelated to Story 2.3.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-admin-manual-verification-review.md`
  summary: Verify Pending-only Doctor status updates and application persistence against PostgreSQL, including overlapping decisions.
  evidence: The repository uses a transactional conditional update and fake-based suites pass, but a database-backed race/persistence assertion is unavailable because PostgreSQL authentication returns `P1000`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-admin-manual-verification-review.md`
  summary: Confirm whether verification decisions require a retained actor, rationale, and audit history.
  evidence: The approved workflow makes decisions final but specifies one Admin and does not define an audit record; product/compliance requirements are needed before adding persistence or UI.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-admin-manual-verification-review.md`
  summary: Reconcile Story 2.4's done spec status with its backlog sprint-status entry.
  evidence: The Story 2.4 spec is marked done while `2-4-admin-manages-specialty-catalog` remains backlog; this unrelated tracker discrepancy was not changed.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-admin-manages-specialty-catalog.md`
  summary: Apply the Specialty normalized-name migration against PostgreSQL and verify backfill, Doctor-Specialty relationships, and case-only duplicate rejection.
  evidence: The migration could not be applied because PostgreSQL rejected the configured credentials with `P1000`; the shipped 15 default names are unique after normalization, but deployed database contents and data relationships could not be inspected.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-describe-condition-upload-documents.md`
  summary: Apply the Case/Document migration and verify production Prisma draft and document persistence against PostgreSQL.
  evidence: Prisma validation and client generation pass, but migration status returns `P1000`; a working PostgreSQL test database is required to verify migration application and repository create/update/read behavior.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-describe-condition-upload-documents.md`
  summary: Load-test concurrent authenticated 50 MiB document uploads under the intended application memory limit.
  evidence: The parser enforces a streaming 50 MiB cap and avoids an extra whole-body buffer, but concurrent multipart parsing and storage allocations have not been measured at deployment concurrency.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-optional-doctor-selection.md`
  summary: Revalidate a saved selected Doctor through the Doctors service at Story 3.3 submission before assigning `Case.doctorId`.
  evidence: Story 3.2 verifies status when saving the draft preference, but Admin can later revoke a Doctor before payment/submission; revalidation belongs at the submission transition and avoids assigning a no-longer-Verified Doctor.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-optional-doctor-selection.md`
  summary: Define and test pagination/search for the verified Doctor directory if its expected size or latency target requires it.
  evidence: The current directory returns all verified Doctors and no catalog-size or response-time target is defined; establish expected scale before adding list parameters and UI complexity.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-optional-doctor-selection.md`
  summary: Verify selectedDoctorId persistence and migration behavior against PostgreSQL.
  evidence: Prisma schema validation and client generation pass, but migration status fails with `P1000`; a working database and draft reload assertion are required.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-optional-doctor-selection.md`
  summary: Add automated browser coverage for selecting, saving, reloading, and clearing a Doctor preference when browser-test infrastructure is available.
  evidence: Current tests cover the Doctors service, Cases service, and routes, but the repo has no UI test harness and the integrated browser tool returned a CDP connection timeout during this verification attempt.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-specialty-filtered-case-queue-with-sla-visibility.md`
  summary: Add a database-backed regression test that verifies the Story 4.1 migration backfills `submitted_at` for pre-existing Submitted Cases.
  evidence: The SQL backfills from `updated_at`, but PostgreSQL rejects the configured credentials with `P1000`, so the migration could not be exercised against a pre-migration Case row.
