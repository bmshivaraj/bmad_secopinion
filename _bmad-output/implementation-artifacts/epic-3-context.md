# Epic 3 Context: Case Submission & Payment

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let a logged-in Patient or guardian create a complete, paid second-opinion Case by describing the condition, providing supporting Documents, optionally choosing a verified Doctor, and selecting Standard or Urgent review. A Case becomes available for Doctor workflow only after successful payment, so intake and payment form a complete patient-facing submission without depending on the later review lifecycle.

## Stories

- Story 3.1: Describe Condition & Upload Documents
- Story 3.2: Optional Doctor Selection
- Story 3.3: Urgency Selection & Payment

## Requirements & Constraints

- Require an authenticated Patient or guardian. Capture the condition and recommended treatment or surgery using structured fields and free text. Require at least one supporting Document before payment; accept JPEG, PNG, and PDF.
- Document reads are limited at this stage to the Case's Patient and Admin. Enforce authorization before storage retrieval; Doctors gain access only through the later assigned-Doctor workflow.
- Doctor selection is optional. Only verified Doctors may be offered; a Case without a selection remains unassigned. Selection must not bypass payment.
- Urgency is either Standard or Urgent and cannot be changed after submission. Charge the current platform-configured fee (launch defaults: ₹1,000 Standard, ₹2,000 Urgent); preserve the amount charged for the submitted Case if settings later change.
- Keep the Case draft/unsubmitted and invisible to Doctors unless payment succeeds. A failed payment must not expose a partial Case. Do not store raw card data; payment processing is delegated to the provider abstraction.
- Store and calculate money using a currency-safe representation, never floating-point arithmetic.

## Technical Decisions

- Cases owns Case and Document behavior. Keep module data isolated; call Patients, Doctors, and Payments only through their exported `service.ts` interfaces, without cross-module table queries or repository imports. Cross-module references are IDs, not database foreign keys; primary keys use UUIDs.
- Keep `Case.doctorId` nullable. Read the verified-Doctor list through the Doctors service; validate any selected Doctor through that boundary.
- Use the shared `StorageProvider` for file bytes (`LocalDiskStorageProvider` in v1). Authorization belongs in the Cases service before storage is called; the provider and route handlers do not implement their own access rules.
- Route payment through `PaymentProvider` (`MockPaymentProvider` in v1). On success, capture the configured fee and transition the Case to `Submitted` using the Cases module's single status state machine. Keep it unsubmitted on failure.
- Pricing comes from the Admin-owned platform settings record, not hardcoded fee constants. Settings apply prospectively; a submitted Case retains its captured fee.

## UX & Interaction Patterns

The patient flow should work on a phone and support completing description, photo/document upload, optional Doctor choice, urgency selection, and payment in one sitting. Urgent means expedited written review, not emergency care; there is no mid-Case urgency upgrade in v1. No formal visual design contract exists.

## Cross-Story Dependencies

- Stories 3.1 and 3.2 provide the completed draft and its required details for Story 3.3; payment cannot proceed without the description and at least one Document.
- Depends on Epic 1 for Patient authentication and guardian context, and Epic 2 for the verified-Doctor directory and Specialty catalog used by Case selection/classification.
- Epic 4 consumes only successfully submitted Cases and extends Document access to the currently assigned Doctor; this Epic enforces Patient/Admin access before that assignment.