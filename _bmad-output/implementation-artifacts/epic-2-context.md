# Epic 2 Context: Doctor Onboarding & Verification

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Enable prospective Doctors to submit credentials, specialties, and a payout destination, and let the Admin review and approve or reject their applications. This establishes a verified, specialty-qualified Doctor pool for later case workflows without depending on Patient flows.

## Stories

- Story 2.1: Doctor Registration with Credentials & Specialties
- Story 2.2: Doctor UPI Payout Details
- Story 2.3: Admin Manual Verification Review
- Story 2.4: Admin Manages Specialty Catalog

## Requirements & Constraints

- Doctor registration reuses mobile OTP verification. Submission requires at least one credential document and one or more specialties selected from the current catalog; free-text specialties are not accepted.
- Verification is manual in v1. New Doctors start `Pending`; only the Admin can set `Verified` or `Rejected`. Pending and rejected Doctors cannot access the case queue; verified Doctors are eligible for cases matching any declared specialty.
- The Admin review queue exposes pending Doctors, their specialties, and their credential documents. Only the Admin and the submitting Doctor may view a credential document.
- Doctors may set or update a UPI ID. Validate its basic format only; do not add bank/NPCI verification. A payout cannot be disbursed without a valid UPI ID, and updates affect future payouts only.
- Specialty management is add-only in v1. New entries become available to subsequent Doctor registrations and case specialty selection; existing records are unchanged. Removal and deactivation are unsupported.
- Automated credential checks against medical or education registries are out of scope.

## Technical Decisions

- Keep Doctors and Admin as separate modules in the single-deployable modular monolith. Each owns its tables and exposes business operations through `service.ts`; Admin calls the Doctors service rather than accessing its repository or tables directly.
- Reuse the shared `OtpProvider` and `StorageProvider` abstractions. v1 uses `MockOtpProvider` (fixed/logged OTP, no SMS) and `LocalDiskStorageProvider`; provider-specific behavior must not leak into module business logic.
- Model `Doctor.specialties` as a collection linked to a database-backed `Specialty` reference table, not a scalar or hardcoded application enum. The table is seeded with the 15 launch specialties; Admin additions create active catalog entries.
- Use the established JWT auth context (`userId` and `role`) for Patient/Doctor/Admin roles. Keep domain errors typed within the owning module and map them to HTTP responses at route boundaries; API responses use `{ data, error }`.
- Credential-document authorization belongs at the owning service boundary, not in storage or duplicated in route handlers. Storage handles bytes only after the caller is authorized.

## UX & Interaction Patterns

Planning calls for a simple internal Admin review queue, not a polished product surface. No formal UX or visual design contract exists; keep interactions functional and consistent with the application's existing patterns.

## Cross-Story Dependencies

- Depends on Epic 1's OTP flow/provider and initial Specialty catalog seed. Doctor signup must use the existing OTP verification mechanism.
- Epic 3 and Epic 4 consume the Specialty catalog; Epic 4 also relies on Doctor verification status and specialties to control case eligibility and matching.
- Epic 5 payout processing depends on the Doctor's valid UPI destination; changing it must not alter already-disbursed payouts.