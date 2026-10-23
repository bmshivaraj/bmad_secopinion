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

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-claim-or-admin-assign-a-case.md`
  summary: Add a database-backed concurrent claim test against the production compare-and-swap repository write.
  evidence: The service test races in-memory fixture writes and the repository test stubs `updateMany`; PostgreSQL credentials fail with `P1000`, so an actual database race could not be exercised.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-claim-or-admin-assign-a-case.md`
  summary: Add page-level interaction coverage for Doctor claims and Admin assignment selection/refresh states.
  evidence: The repository has no page or browser test harness; route and service tests do not render or click either page's controls.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-request-additional-documents.md`
  summary: Add page-level interaction tests for Doctor request creation and Patient request visibility/response upload when UI test infrastructure is available.
  evidence: The repository has no page/browser test harness, and the integrated browser bridge failed to connect; route and service tests do not render or operate the new pages.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-request-additional-documents.md`
  summary: Apply the Case Document request migration and verify the partial unique index plus concurrent request/response rollback behavior against PostgreSQL.
  evidence: `npx prisma migrate status` and database-backed verification fail with PostgreSQL `P1000`; service and mocked repository transaction tests pass.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-submit-opinion-and-close-case.md`
  summary: Apply the Opinion/closed-request migration and verify the partial index, payout cursor query, and concurrent Opinion transaction against PostgreSQL.
  evidence: `npx prisma migrate status` fails with PostgreSQL `P1000`; schema, service, route, and mocked transaction checks pass, but production database behavior remains unverified.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-submit-opinion-and-close-case.md`
  summary: Add page-level tests for Doctor Opinion submission and Patient/Admin Opinion rendering when a UI test harness is available.
  evidence: The repository has no page/browser test harness; route and service tests do not mount or interact with the Doctor, Patient, or Admin Opinion surfaces.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-daily-sla-breach-detection-refund-pending.md`
  summary: Report invalid SLA-history candidates skipped by the daily breach scan and define remediation for those Cases.
  evidence: `computeElapsedSlaTime()` returns `null` for malformed pause history; the scan safely skips such a Case but currently logs only total scanned and transitioned counts, so operators cannot identify it from job output.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-daily-sla-breach-detection-refund-pending.md`
  summary: Establish expected daily SLA-candidate volume and job runtime, then add bounded scanning if the measured workload requires it.
  evidence: The repository currently loads all paid open candidates into memory and processes them sequentially; no maximum volume or runtime target is defined, so capacity evidence is needed to choose batching semantics.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-daily-sla-breach-detection-refund-pending.md`
  summary: Define Admin RefundPending worklist pagination after setting an expected queue size and response-time target.
  evidence: The repository and Admin page currently load all pending refunds; no queue-volume or latency target exists to establish a user-facing failure threshold.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-daily-sla-breach-detection-refund-pending.md`
  summary: Verify RefundPending compare-and-swap behavior with a PostgreSQL-backed competing-transition test.
  evidence: Service tests cover races and the repository uses a conditional status update, but configured PostgreSQL credentials fail with `P1000`, so production database concurrency behavior remains unverified.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-daily-sla-breach-detection-refund-pending.md`
  summary: Add Admin RefundPending page rendering and refresh-state tests when UI test infrastructure is available.
  evidence: Existing route tests verify private API fields but do not render the worklist; the repository has no page/browser test harness.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-admin-refund-approval-rejection.md`
  summary: Apply the refund migration and verify competing Admin refund decisions against PostgreSQL.
  evidence: Schema validation and mocked conditional-write tests pass, but `npx prisma migrate status` fails with `P1000`; a working PostgreSQL environment is required to verify migration application and database concurrency.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-admin-refund-approval-rejection.md`
  summary: Add Admin and Patient page-level refund decision and notice tests when UI test infrastructure is available.
  evidence: Current tests exercise services and routes without rendering or interacting with the Admin worklist or Patient Cases page; the repository has no page/browser test harness.

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-admin-refund-approval-rejection.md`
  summary: Decide whether Admin refund approvals and rejections require durable actor attribution and decision-history retention.
  evidence: The Case stores its current decision but not the Admin actor or a separate rejection timestamp, while repeated rejection cycles overwrite the SLA anchor; compliance and product requirements must establish the audit retention contract.
