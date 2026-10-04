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
