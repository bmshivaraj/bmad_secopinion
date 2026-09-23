---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-secopinion-2026-09-20/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-secopinion-2026-09-22/ARCHITECTURE-SPINE.md
---

# secopinion - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for secopinion, decomposing the requirements from the PRD and Architecture Spine into implementable stories. No UX Design contract exists for this project (v1 is scoped without a formal UX spec).

## Requirements Inventory

### Functional Requirements

FR-1: Mobile + OTP Registration — a new Registrant can register using a mobile number and OTP; OTP delivery via `OtpProvider` (mocked v1).
FR-2: Post-OTP Credential Setup — after OTP verification, a Registrant sets a username/password for future logins.
FR-3: Guardian Registration for Minors — a Registrant can register a Case on behalf of a self-declared minor, using their own mobile number.
FR-4: Doctor Registration with Credential Submission — a prospective Doctor registers with mobile+OTP, uploads a credential Document, and declares one or more Specialties.
FR-5: Manual Verification Review — the Admin reviews a Doctor's submitted credentials and sets Doctor Verification Status to Verified or Rejected.
FR-6: Doctor UPI Payment Details — a Doctor provides (and can later update) a UPI ID as payout destination.
FR-7: Problem Description and Document Upload — a Patient describes their condition and uploads at least one supporting Document to a Case.
FR-8: Urgency Selection and Payment — a Patient selects Standard (₹1,000) or Urgent (₹2,000) and pays before the Case enters a Doctor's queue.
FR-9: Specialty-Filtered Case Queue — a Verified Doctor views a queue of Cases matching any of their declared Specialties; unassigned Cases are claimable; urgent Cases are prioritized/distinguished; SLA time-remaining is visible.
FR-10: Request Additional Documents — a Doctor requests specific additional Documents without closing the Case; Case Status moves to More Info Requested and the SLA clock pauses.
FR-11: Submit Opinion and Close Case — a Doctor submits a written Opinion, closing the Case and triggering Doctor Payout calculation.
FR-12: Doctor Payout on Case Closure — the system calculates and disburses (via daily batch) the Doctor's Payout share to their UPI ID, deducting the Platform Fee first.
FR-13: Admin-Approved Refund on Response SLA Breach — if no Opinion is submitted within the 5-day/120h SLA, the Case moves to Refund Pending and the Admin manually approves or rejects the refund.
FR-14: Baseline Access Control for Medical Documents — a Document is viewable only by that Case's Patient and currently assigned Doctor (or Admin).

### NonFunctional Requirements

NFR-1: OTP request rate limiting per mobile number, to prevent abuse.
NFR-2: Password complexity policy (min 8 characters, mixed case + number).
NFR-3: Payment processing delegated to a third-party UPI/payment gateway; SecOpinion does not store raw card data.
NFR-4: All payment/payout amounts stored in a currency-safe representation (no floating-point money arithmetic).
NFR-5: Standard HTTPS/TLS in transit for all traffic; no encryption-at-rest or key management in v1 (explicit POC-scoped risk).
NFR-6: No formal HIPAA/DPDP Act/GDPR compliance program, data residency commitment, or retention policy defined for v1.
NFR-7: Terms of Service must include a liability disclaimer clarifying an Opinion is advisory and does not replace the treating physician's care.

### Additional Requirements

- Modular Monolith: single deployable Next.js app with 5 domain modules — Patients, Doctors, Cases, Payments, Admin (AD-1). Each module owns its own DB tables and exposes a single `service.ts` seam; no cross-module DB joins or direct repository access (AD-2).
- No starter template specified in Architecture — greenfield source tree per the Structural Seed (`src/modules/<name>/{domain,service.ts,repository.ts,routes}`, `src/shared/`, `prisma/schema.prisma`, `docker-compose.yml`).
- `PaymentProvider` abstraction — v1 ships `MockPaymentProvider`; real UPI gateway is v2 (AD-3).
- `OtpProvider` abstraction — v1 ships `MockOtpProvider` (fixed/logged OTP, no real SMS); real JWT-based session/auth mechanism is implemented for real in v1 (AD-7).
- `StorageProvider` abstraction — v1 ships `LocalDiskStorageProvider` (ephemeral pod storage, single-replica assumption); real cloud blob storage is v2 (AD-7).
- Reference-by-ID rule: cross-module references are plain ID columns only (e.g. `Case.patientId`, `Case.doctorId`), no cross-module FK constraints; UUIDs for all primary keys (AD-4).
- `Case.doctorId` is nullable and admin-mutable after initial assignment, to support optional doctor selection and doctor offboarding reassignment (AD-5).
- Case-to-doctor assignment is hybrid pull-or-push: verified doctors self-claim from an open/unassigned queue, or Admin manually assigns/reassigns; atomic claim via optimistic locking (`Case.assignmentLockVersion`) through one exported `assignCaseToDoctor(caseId, doctorId, expectedVersion)` function — no ad hoc check-then-set (AD-6). Reassignment never resets the Response SLA clock.
- SLA breach detection runs as a daily batch job (not real-time), scanning Cases past the 5-day/120h window (AD-8).
- Doctor Payout runs as a daily batch job (not synchronous with Opinion submission) via `PaymentProvider.payout()` (AD-10).
- Response SLA clock uses explicit pause/resume timestamp-pairs on `Case` (`{ pausedAt, resumedAt }`); elapsed time is computed by exactly one exported function `computeElapsedSlaTime(case)` in the Cases module, called by any other module needing it (AD-11).
- `Doctor.specialties` is a collection (not a single scalar); a Case is visible to a Doctor if its specialty matches any of the Doctor's declared Specialties (AD-12).
- A single closed `CaseStatus` enum and its legal transition graph is defined once in the Cases module (`domain/case-state-machine.ts`) and imported everywhere else (AD-13): `Submitted → UnderReview → MoreInfoRequested ⇄ UnderReview → OpinionGiven → Closed`, or `UnderReview`/`MoreInfoRequested → RefundPending → Refunded → Closed` or back to `UnderReview` (admin-rejected, fresh SLA window).
- Document access control is enforced only at the Cases module's service boundary (never in `StorageProvider`, never re-implemented in a route handler) (AD-14).
- Consistency conventions (AD-9): `camelCase` vars/functions, `PascalCase` types/classes, `kebab-case` files; Postgres `snake_case` tables/columns; API response envelope `{ data, error }`; domain errors typed per module, mapped to HTTP only at route-handler boundary; JWT carries `userId` + `role` (`patient`/`doctor`/`admin`).
- Stack is pinned: Next.js 16.3.6, Node.js 26 LTS, PostgreSQL 18.6, Prisma ORM v7.
- Local dev environment: Docker Compose (app + Postgres). Production target: AWS EKS, single Deployment/Service (no per-module services in v1).
- Minimum v1 operational floor (not deferred): structured logging to stdout and failure alerting for both daily batch jobs (SLA-breach scan, payout run), since a silent failure means a missed refund or an unpaid doctor.

### UX Design Requirements

None — no UX design contract exists for this project. Interaction/visual details will be decided at story/implementation time within the Architecture Spine's constraints.

### FR Coverage Map

FR-1: Epic 1 — Mobile + OTP registration
FR-2: Epic 1 — Post-OTP password setup
FR-3: Epic 1 — Guardian registration for minors
FR-4: Epic 2 — Doctor registration + credential/specialty/UPI submission
FR-5: Epic 2 — Admin manual verification review
FR-6: Epic 2 — Doctor UPI payout details
FR-7: Epic 3 — Problem description + document upload
FR-8: Epic 3 — Urgency selection + payment capture
FR-9: Epic 4 — Specialty-filtered, SLA-aware Doctor queue
FR-10: Epic 4 — Request additional Documents (SLA pause/resume)
FR-11: Epic 4 — Submit Opinion, close Case
FR-12: Epic 5 — Doctor Payout batch on closure
FR-13: Epic 5 — SLA-breach Refund Pending + Admin resolution
FR-14: Epic 3 (initial) + Epic 4 (doctor-side) — Document access control

## Epic List

### Epic 1: Patient Registration & Authentication
A Patient (or guardian, for a minor) can register with mobile+OTP, set a password, and log back in. Standalone: complete auth for the Patient side.
**FRs covered:** FR-1, FR-2, FR-3

### Epic 2: Doctor Onboarding & Verification
A prospective Doctor can register with credentials + declared Specialties + UPI payout ID, and the Admin can manually review and set Verification Status. Standalone: complete Doctor onboarding, independent of Patient flows.
**FRs covered:** FR-4, FR-5, FR-6

### Epic 3: Case Submission & Payment
A logged-in Patient describes their condition, uploads Documents (access-controlled per AD-14), optionally picks a Verified Doctor (read-only use of Epic 2's Doctors module), selects Standard/Urgent, and pays before the Case becomes visible to any Doctor. Standalone: a complete, payable Case exists at the end, even with no Doctor workflow yet.
**FRs covered:** FR-7, FR-8, FR-14 (initial Patient/Admin-side enforcement; extended in Epic 4)

### Epic 4: Doctor Case Review Workflow
A Verified Doctor sees their Specialty-filtered, SLA-aware queue, can self-claim an unassigned Case (or be admin-assigned), request more Documents (pausing the SLA clock), and submit a written Opinion that closes the Case. Standalone: full review lifecycle, building on Epics 2 and 3.
**FRs covered:** FR-9, FR-10, FR-11 (FR-14 doctor-side access enforcement lands here too)

### Epic 5: Payouts & SLA Refund Resolution
Doctors are paid their share via the daily payout batch after closing a Case; Cases that breach the 5-day/120h SLA move to Refund Pending for the Admin to approve/reject, completing the money lifecycle for every Case. Standalone: closes the loop started in Epics 3 and 4.
**FRs covered:** FR-12, FR-13

Implementation note: Epic 1 Story 1 will include the foundational project scaffold (Next.js app, module skeleton, Prisma schema init, Docker Compose) since no starter template exists.

## Epic 1: Patient Registration & Authentication

A Patient (or guardian, for a minor) can register with mobile+OTP, set a password, and log back in.

### Story 1.1: Project Foundation & Dev Environment Setup

As a developer,
I want the Next.js modular-monolith scaffold, Prisma schema, and local Docker Compose environment set up,
So that subsequent stories have a working foundation (modules, DB, dev server) to build on.

**Acceptance Criteria:**

**Given** an empty repository
**When** the project is scaffolded
**Then** a Next.js 16.3.6 (Node.js 26 LTS) app exists with the Structural Seed's module layout (`src/modules/{patients,doctors,cases,payments,admin}/{domain,service.ts,repository.ts,routes}`, `src/shared/`, `src/app/`)
**And** `prisma/schema.prisma` exists with PostgreSQL 18.6 as the datasource and Prisma ORM v7, with UUID primary keys as the default convention (AD-4, AD-9)
**And** `docker-compose.yml` starts a local Postgres instance plus the app, and `npm run dev` (or equivalent) runs against it successfully

**Given** the scaffold is running
**When** a developer inspects `src/shared/`
**Then** an `OtpProvider` interface exists with a `MockOtpProvider` implementation (fixed/logged OTP, no real SMS) per AD-7
**And** the API response envelope convention (`{ data, error }`) and JWT auth-context shape (`userId` + `role`) from AD-9 are documented/stubbed for later modules to follow

### Story 1.2: Mobile + OTP Registration

As a Registrant,
I want to register using my mobile number and a one-time password,
So that I can create a verified account without needing an email or existing credential.

**Acceptance Criteria:**

**Given** a mobile number not yet registered
**When** the Registrant submits it for registration
**Then** the system generates an OTP via `MockOtpProvider` and logs/exposes it (mocked delivery, no real SMS) `[FR-1]`
**And** the OTP has a 10-minute expiry, after which it is no longer valid `[FR-1, PRD assumption]`

**Given** a valid, unexpired OTP was issued
**When** the Registrant submits the correct OTP
**Then** the mobile number is marked verified and a Patient account is created

**Given** an incorrect or expired OTP
**When** the Registrant submits it
**Then** the system rejects verification with a typed error and does not create an account

**Given** a mobile number already registered
**When** someone attempts to register that same number again
**Then** the system rejects the new registration and directs the user to log in or recover their account instead

**Given** repeated OTP requests for the same mobile number
**When** the request rate exceeds a defined threshold
**Then** further OTP requests are rate-limited `[NFR-1]`

### Story 1.3: Post-OTP Password Setup & Login

As a newly OTP-verified Registrant,
I want to set a password and later log in with mobile + password,
So that I don't need OTP verification every time I log in.

**Acceptance Criteria:**

**Given** a mobile number just verified via OTP (Story 1.2)
**When** the Registrant sets a password
**Then** the password is accepted only if it meets the complexity policy (min 8 characters, mixed case + number) `[NFR-2]`
**And** the account is now fully registered and can be used to log in

**Given** a registered Patient account with a password set
**When** the Patient logs in with mobile number + correct password
**Then** a JWT session is issued carrying `userId` and `role: patient` (AD-9)

**Given** a registered Patient account
**When** the Patient logs in with an incorrect password
**Then** the system rejects the login attempt with a typed error and does not issue a session

### Story 1.4: Guardian Registration for a Minor Patient

As a Registrant acting on behalf of a minor,
I want to declare the Patient as a minor under my own mobile-verified account,
So that I can submit Cases on their behalf as their guardian.

**Acceptance Criteria:**

**Given** a Registrant completing registration (Story 1.2/1.3)
**When** they indicate the Patient is a minor
**Then** the account is flagged as a guardian-registered account, self-declared with no ID age verification `[FR-3]`

**Given** a guardian-registered account
**When** the Registrant later submits a Case (Epic 3)
**Then** the Case record captures that the Patient is a minor and the Registrant is acting as guardian, for downstream Doctor context

## Epic 2: Doctor Onboarding & Verification

A prospective Doctor can register with credentials + declared Specialties + UPI payout ID, and the Admin can manually review and set Verification Status.

### Story 2.1: Doctor Registration with Credentials & Specialties

As a prospective Doctor,
I want to register with my mobile number, credential document, and declared Specialties,
So that I can be considered for verification and start reviewing Cases in my field.

**Acceptance Criteria:**

**Given** a mobile number verified via OTP (reusing the Story 1.2 mechanism)
**When** the Doctor completes registration
**Then** the system requires at least one credential Document (certificate/Doctor ID, image or PDF) uploaded via `StorageProvider`'s `LocalDiskStorageProvider` `[FR-4, AD-7]`
**And** requires at least one declared Specialty, stored as a collection on `Doctor.specialties` (not a single scalar) `[FR-4, AD-12]`

**Given** a Doctor registration missing a credential Document or a declared Specialty
**When** submission is attempted
**Then** the system rejects the submission with a typed error identifying the missing field(s)

**Given** a successfully submitted Doctor registration
**When** the account is created
**Then** Doctor Verification Status starts as `Pending`, and the Doctor cannot access the case queue (Epic 4) until moved to `Verified`

### Story 2.2: Doctor UPI Payout Details

As a Doctor,
I want to provide and update my UPI ID,
So that my Doctor Payouts are sent to the correct destination.

**Acceptance Criteria:**

**Given** a Doctor completing registration (Story 2.1)
**When** they enter a UPI ID
**Then** the system validates basic UPI ID format (no real-time bank/NPCI verification) `[FR-6]`
**And** rejects a malformed UPI ID with a typed error

**Given** a registered Doctor with an existing UPI ID
**When** they update it from their profile/settings
**Then** the new UPI ID is saved and applies to future Payouts only — Payouts already disbursed are unaffected

### Story 2.3: Admin Manual Verification Review

As the Admin,
I want to review a Doctor's submitted credentials and approve or reject them,
So that only credentialed Doctors can access and review Cases.

**Acceptance Criteria:**

**Given** an authenticated Admin session (single seeded Admin account, no self-registration)
**When** the Admin opens the verification queue
**Then** it lists all Doctors with Verification Status `Pending`, each showing their declared Specialties and a link/view to their uploaded credential Document `[FR-5]`

**Given** a `Pending` Doctor in the queue
**When** the Admin sets status to `Verified`
**Then** the Doctor gains access to Cases matching any of their declared Specialties (enables Epic 4)

**Given** a `Pending` Doctor in the queue
**When** the Admin sets status to `Rejected`
**Then** the Doctor is notified and cannot access the case queue

**Given** the Admin views a Doctor's credential Document
**When** access control is enforced
**Then** only the Admin (and the Doctor themself) can view that Document — consistent with the baseline access-control principle later formalized in FR-14

## Epic 3: Case Submission & Payment

A logged-in Patient describes their condition, uploads Documents, optionally picks a Verified Doctor, selects urgency, and pays before the Case becomes visible to any Doctor.

### Story 3.1: Describe Condition & Upload Documents

As a Patient,
I want to describe my condition and upload supporting Documents to a Case,
So that a Doctor has enough information to give a second opinion.

**Acceptance Criteria:**

**Given** a logged-in Patient (or guardian, Epic 1)
**When** they create a new Case
**Then** they can enter a structured + free-text problem description and the treatment/surgery recommendation they received `[FR-7]`

**Given** a Case being drafted
**When** the Patient attempts to proceed without uploading any Document
**Then** the system blocks progression — at least one Document (JPEG/PNG/PDF) is required before the Case can proceed to payment `[FR-7]`

**Given** a Document uploaded against a Case
**When** any user attempts to view it
**Then** access is enforced at the Cases module's service boundary — only that Case's Patient and Admin can view it at this stage (no Doctor assigned yet) `[FR-14, AD-14]`
**And** `StorageProvider` itself performs no authorization — the check happens before it's ever called

### Story 3.2: Optional Doctor Selection

As a Patient,
I want to optionally browse and pick a specific Verified Doctor for my Case,
So that I can choose a doctor I trust, if I have one in mind, without being forced to.

**Acceptance Criteria:**

**Given** a Case being drafted (Story 3.1)
**When** the Patient browses the doctor list
**Then** only Doctors with Verification Status `Verified` are shown (read-only call into the Doctors module's `service.ts`, per AD-2) `[AD-5]`

**Given** a Case being drafted
**When** the Patient does not pick a Doctor
**Then** the Case proceeds with `doctorId` left `null` — picking a Doctor is optional, never mandatory `[AD-5]`

**Given** a Patient has picked a Doctor for their Case
**When** the Case is later submitted (Story 3.3)
**Then** `Case.doctorId` is set to the picked Doctor's ID, without bypassing payment

### Story 3.3: Urgency Selection & Payment

As a Patient,
I want to select an urgency tier and pay for my Case,
So that my Case is submitted and becomes visible to Doctors for review.

**Acceptance Criteria:**

**Given** a Case being drafted with a description and at least one Document (Story 3.1)
**When** the Patient selects an Urgency Tier
**Then** the choice is either `Standard` (₹1,000) or `Urgent` (₹2,000), fixed for the life of the Case — no mid-case escalation `[FR-8]`

**Given** an Urgency Tier is selected
**When** the Patient completes payment via `PaymentProvider` (`MockPaymentProvider` in v1)
**Then** the full fee is captured, stored in a currency-safe representation (no float arithmetic) `[FR-8, NFR-4, AD-3]`
**And** Case Status transitions to `Submitted` per the AD-13 state machine, becoming visible to matching Doctors (Epic 4)

**Given** a payment attempt fails
**When** the failure is returned by `PaymentProvider`
**Then** the Case remains unsubmitted/invisible to Doctors — no partial or draft Case is exposed to the queue

**Given** SecOpinion's payment integration
**When** any payment is processed
**Then** no raw card data is stored by SecOpinion — that scope is delegated to the `PaymentProvider` `[NFR-3]`

## Epic 4: Doctor Case Review Workflow

A Verified Doctor sees their Specialty-filtered, SLA-aware queue, can self-claim an unassigned Case (or be admin-assigned), request more Documents, and submit a written Opinion that closes the Case.

### Story 4.1: Specialty-Filtered Case Queue with SLA Visibility

As a Verified Doctor,
I want to see a queue of Cases matching my declared Specialties with SLA time remaining,
So that I can prioritize which Cases to review.

**Acceptance Criteria:**

**Given** a Doctor with Verification Status `Verified` and one or more declared Specialties
**When** they open their Case queue
**Then** it shows only Cases whose specialty matches any of the Doctor's declared Specialties `[FR-9, AD-12]`

**Given** the queue contains both Standard and Urgent Cases
**When** it is rendered
**Then** Urgent Cases are visually distinguished and/or prioritized above Standard Cases

**Given** any Case in the queue
**When** it is displayed
**Then** it shows time remaining against the 5-day/120h Response SLA, computed via the single `computeElapsedSlaTime(case)` function `[FR-9, AD-11]`

**Given** a Doctor without a matching Specialty for a given Case
**When** they attempt to access that Case directly (e.g. by ID)
**Then** access is denied — a Doctor cannot see or open Cases outside their declared Specialties

### Story 4.2: Claim or Admin-Assign a Case

As a Verified Doctor,
I want to claim an unassigned Case from the queue,
So that I can begin reviewing it, without conflicting with another Doctor.

**Acceptance Criteria:**

**Given** an unassigned Case (`doctorId` is `null`) in the open queue
**When** a Doctor claims it
**Then** the claim goes through the single exported `assignCaseToDoctor(caseId, doctorId, expectedVersion)` function, setting `doctorId` and incrementing `Case.assignmentLockVersion` only if the passed version still matches `[FR-9, AD-6]`

**Given** two Doctors attempt to claim the same unassigned Case at nearly the same time
**When** the second claim executes
**Then** it fails with a typed "already assigned" or "version mismatch" error — no ad hoc check-then-set path exists, so only one Doctor succeeds

**Given** any Case (assigned or unassigned)
**When** the Admin manually assigns or reassigns it to a specific Verified Doctor
**Then** the assignment succeeds regardless of current `doctorId`, and the Response SLA clock is **not** reset — it stays anchored to the Case's original submission timestamp

### Story 4.3: Request Additional Documents

As a Doctor reviewing a Case,
I want to request specific additional Documents from the Patient without closing the Case,
So that I have enough information to give a responsible Opinion.

**Acceptance Criteria:**

**Given** a Case in `Under Review` assigned to the requesting Doctor
**When** the Doctor requests specific additional Document(s)
**Then** Case Status transitions to `More Info Requested` per the AD-13 state machine, and the Patient is notified of exactly what was requested `[FR-10]`

**Given** a Case just moved to `More Info Requested`
**When** the transition occurs
**Then** a new pause/resume timestamp pair is appended (`{ pausedAt: now, resumedAt: null }`) — the Response SLA clock pauses `[FR-10, AD-11]`

**Given** a Case in `More Info Requested`
**When** the Patient uploads the requested Document(s)
**Then** Case Status returns to `Under Review`, the open pause/resume pair's `resumedAt` is set, the Doctor is notified, and the SLA clock resumes (not restarts) from where it paused `[FR-10, AD-11]`

### Story 4.4: Submit Opinion and Close Case

As a Doctor,
I want to submit a written Opinion that closes the Case,
So that the Patient receives their second opinion and I'm credited for the review.

**Acceptance Criteria:**

**Given** a Case in `Under Review` or `More Info Requested`, assigned to the requesting Doctor
**When** the Doctor submits a written Opinion
**Then** Case Status transitions to `Opinion Given` → `Closed` per AD-13, and the Opinion becomes visible to the Patient `[FR-11]`
**And** the Doctor Payout calculation is triggered for the next daily batch (Epic 5) `[FR-11]`

**Given** a closed Case
**When** the Doctor attempts any further edit or reopening
**Then** the system blocks it — a closed Case cannot be reopened by the Doctor

**Given** a Case currently in `Refund Pending`
**When** the Doctor attempts to submit an Opinion
**Then** the system blocks submission entirely until the Admin resolves the refund decision (Epic 5) — eliminating the race condition between a late Opinion and an SLA-triggered refund `[FR-11, FR-13]`

**Given** a Document belonging to a Case
**When** any user attempts to view it
**Then** only that Case's Patient and its currently assigned Doctor (or Admin) can view it — enforced at the Cases module service boundary `[FR-14, AD-14]`

## Epic 5: Payouts & SLA Refund Resolution

Doctors are paid their share via the daily payout batch after closing a Case; Cases that breach the 5-day/120h SLA move to Refund Pending for the Admin to approve/reject, completing the money lifecycle for every Case.

### Story 5.1: Daily SLA-Breach Detection & Refund Pending

As the platform,
I want a daily job to detect Cases that breached the Response SLA,
So that Patients whose Case got no Doctor Opinion are not left waiting indefinitely.

**Acceptance Criteria:**

**Given** a Case in `Under Review` or `More Info Requested`
**When** the daily batch job runs
**Then** it calls `computeElapsedSlaTime(case)` for every open Case and compares the result against the 5-day/120h threshold `[FR-13, AD-8, AD-11]`

**Given** a Case whose elapsed SLA time exceeds 120 hours
**When** the job detects the breach
**Then** Case Status transitions to `Refund Pending` per AD-13, and the Admin receives a notification naming the Case and amount `[FR-13]`

**Given** a Case now in `Refund Pending`
**When** the Doctor attempts to submit an Opinion, or the Patient attempts to upload further Documents or edit the Case
**Then** both are blocked — the Case is fully locked pending the Admin's decision

### Story 5.2: Admin Refund Approval/Rejection

As the Admin,
I want to approve or reject a refund for a Case in Refund Pending,
So that Patients are fairly refunded when no Doctor was available in time, while still catching last-minute edge cases.

**Acceptance Criteria:**

**Given** a Case in `Refund Pending`
**When** the Admin approves the refund
**Then** Case Status moves to `Refunded` then `Closed` per AD-13, the full amount (₹1,000 or ₹2,000) is returned to the Patient's original payment method via `PaymentProvider`, no Doctor Payout is calculated, and the Patient is notified `[FR-13]`

**Given** a Case in `Refund Pending`
**When** the Admin rejects the refund (after out-of-band phone contact with the Patient) and the Patient chooses to keep waiting
**Then** Case Status returns to `Under Review` with a **fresh** 5-day/120h SLA window (a new full cycle, not a resumed clock) `[FR-13]`

**Given** a Case that re-enters `Under Review` after a rejected refund
**When** it breaches the SLA again
**Then** the same `Refund Pending` → Admin-decision cycle repeats, with no v1 cap on retry cycles

### Story 5.3: Daily Doctor Payout Batch

As a Doctor,
I want to be paid my share of the Case fee after closing a Case with an Opinion,
So that I'm compensated for my review work.

**Acceptance Criteria:**

**Given** one or more Cases closed with an Opinion (`Opinion Given`/`Closed`) since the last payout batch run
**When** the daily payout job runs
**Then** it calculates each Doctor's Payout share (Case fee minus the configurable Platform Fee percentage, currency-safe arithmetic) and disburses it via `PaymentProvider.payout()` to the Doctor's registered UPI ID `[FR-12, AD-10, NFR-4]`

**Given** a Case closed with an Opinion but not yet processed by the payout batch
**When** the Doctor views their payout log
**Then** the Payout appears as pending until the next daily batch run `[FR-12, AD-10]`

**Given** a Doctor's Payout history
**When** they view it
**Then** it shows a running log of amounts owed/disbursed and the UPI ID each was sent to `[FR-12]`

### Story 5.4: Batch Job Logging & Failure Alerting

As the platform operator,
I want both daily batch jobs to emit structured logs and alert on failure,
So that a missed refund or an unpaid doctor is never a silent failure.

**Acceptance Criteria:**

**Given** the SLA-breach job (Story 5.1) or the payout job (Story 5.3) runs
**When** it completes (success or failure)
**Then** it emits a structured log entry to stdout recording the run outcome and counts affected (Cases transitioned / Payouts disbursed) — picked up by EKS's logging path

**Given** either daily batch job throws an unhandled error or fails to complete
**When** the failure occurs
**Then** an alert is raised so the Admin/operator is notified — this is the minimum v1 operational floor, not the full observability stack (which remains deferred)
