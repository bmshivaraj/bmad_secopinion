---
id: SPEC-secopinion
companions:
  - ../../planning-artifacts/prds/prd-secopinion-2026-09-20/prd.md
  - ../../planning-artifacts/architecture/architecture-secopinion-2026-09-22/ARCHITECTURE-SPINE.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. The adopted PRD carries full FR-level testable-consequence and user-journey detail; the adopted Architecture Spine carries the full AD-n Binds/Prevents/Rule detail, diagrams, stack, and structural seed. Consult both directly for anything this kernel references by name but doesn't restate.

# SecOpinion — v1 POC

## Why

Healthcare has a structural conflict of interest: some multi-specialty hospitals and doctors are incentivized toward surgery or major treatment because it is revenue, not always because it is the best or only path for the patient — and a patient sitting across from that doctor rarely has the medical expertise or practical means to challenge the recommendation in the moment. Getting a genuinely independent second opinion today means another hospital visit and another consultation fee. SecOpinion exists to make an independent, paid, document-based second opinion fast and accessible before a patient commits to major treatment — a vision to realize, combined with a mandate the founder has explicitly accepted: real money and real medical documents flow through v1 even though it is deliberately scoped as a proof-of-concept.

## Capabilities

- **CAP-1**
  - **intent:** A Patient can register via mobile number + OTP.
  - **success:** An OTP-verified mobile number creates a Patient account; OTP delivery goes through an `OtpProvider` (mocked in v1).

- **CAP-2**
  - **intent:** A Patient sets up a password credential after OTP verification, completing registration.
  - **success:** A registered Patient can subsequently log in via mobile + password (OTP-fallback login availability is an open question).

- **CAP-3**
  - **intent:** A Registrant can register a Case on behalf of a minor as their guardian.
  - **success:** A guardian-registered account can submit Cases where the Patient is declared a minor, self-declared with no ID age verification in v1.

- **CAP-4**
  - **intent:** A prospective Doctor can register with mobile + OTP, upload credential Document(s), declare one or more Specialties, and provide a UPI payout method.
  - **success:** Registration is rejected without at least one credential Document and at least one declared Specialty; Doctor Verification Status starts `Pending`; declared Specialties are selected from the fixed, Admin-extensible Specialty catalog (CAP-15), not free text.

- **CAP-5**
  - **intent:** The single Admin can manually review a Doctor's submitted credentials and set Doctor Verification Status to `Verified` or `Rejected`.
  - **success:** A `Rejected` Doctor cannot access the case queue; a `Verified` Doctor gains access to Cases matching any of their declared Specialties (CAP-9). No automated third-party credential verification in v1.

- **CAP-6**
  - **intent:** A Doctor provides a UPI ID as their payout destination during registration.
  - **success:** Doctor Payouts (CAP-12) are disbursed to this UPI ID; only basic format validation in v1, no real-time bank/NPCI verification.

- **CAP-7**
  - **intent:** A Patient describes their condition/treatment recommendation and uploads supporting Documents to a Case.
  - **success:** At least one Document is required before a Case can proceed to payment; read access to uploaded Documents is enforced at the Cases module's service boundary, never inside generic storage (CAP-14).

- **CAP-8**
  - **intent:** A Patient selects Standard or Urgent urgency and pays before the Case enters a Doctor's queue, at Admin-configured fee amounts (CAP-16, defaulting to ₹1,000/₹2,000 at launch).
  - **success:** The Case remains unsubmitted/invisible to Doctors until payment succeeds; payment goes through a `PaymentProvider` (mocked in v1, real UPI gateway in v2). The Urgency Tier is fixed for the Case's life — no mid-case escalation (v2 item). A fee change by the Admin applies prospectively only.

- **CAP-9**
  - **intent:** A Verified Doctor views a queue of Cases matching any of their declared Specialties (drawn from the fixed catalog, CAP-15), with unassigned Cases claimable and urgent Cases prioritized/distinguished.
  - **success:** A Doctor cannot see Cases outside their declared Specialties; a claim is atomic (optimistic locking) so two Doctors cannot claim the same Case; each Case shows time remaining against the Response SLA.

- **CAP-10**
  - **intent:** A Doctor can request specific additional Documents from the Patient without closing the Case.
  - **success:** Case Status moves to `More Info Requested` and the Response SLA clock pauses; uploading the requested Document(s) returns status to `Under Review` and resumes (not restarts) the clock.

- **CAP-11**
  - **intent:** A Doctor submits a written Opinion, closing the Case and making it visible to the Patient.
  - **success:** A closed Case cannot be reopened by the Doctor (a post-closure clarification channel is an open question); submitting an Opinion while `Under Review` or `More Info Requested` triggers Doctor Payout calculation (CAP-12); a Case in `Refund Pending` blocks Opinion submission entirely.

- **CAP-12**
  - **intent:** A Doctor is paid their Payout share of the Case fee (Platform Fee deducted first) after closing a Case with an Opinion within the Response SLA, at the Admin-configured split (CAP-16, defaulting to 20% platform / 80% doctor at launch).
  - **success:** Payout is batched via a daily job, not synchronous with Case closure; disbursed via `PaymentProvider` to the Doctor's registered UPI ID; amounts are stored in a currency-safe representation. A split-percentage change by the Admin applies prospectively only — Payouts already calculated keep their original percentage.

- **CAP-13**
  - **intent:** If no Doctor submits an Opinion within the 5-day/120h Response SLA, the Case moves to `Refund Pending` and the Admin is notified to manually approve or reject a refund.
  - **success:** The clock is paused-adjusted and evaluated once per day; `Refund Pending` locks the Case (no Opinion, no further Patient uploads) pending Admin action. Admin-approve refunds in full and closes the Case (no Payout). Admin-reject leads to a manual phone contact — continuing grants a fresh 5-day/120h window, with no v1 cap on retry cycles.

- **CAP-14**
  - **intent:** A Document uploaded against a Case is viewable only by that Case's Patient and its currently assigned Doctor (or Admin).
  - **success:** Access control is enforced at the Cases module's service boundary — never inside the generic storage layer or a route handler. Standard HTTPS/TLS in transit; no encryption-at-rest or formal compliance program in v1 (explicit, PM-flagged risk).

- **CAP-15**
  - **intent:** The Admin can add new Specialties to the fixed Specialty catalog that Doctors declare against (CAP-4) and Cases match against (CAP-9).
  - **success:** The catalog is seeded with 15 default Specialties at launch; the Admin can add more without a code deploy; removing/deactivating a Specialty is out of scope for v1.

- **CAP-16**
  - **intent:** The Admin can configure the Standard/Urgent Case fee amounts and the Platform Fee percentage applied to every Case.
  - **success:** Defaults at launch: ₹1,000 Standard / ₹2,000 Urgent / 20% Platform Fee. v1 pricing is platform-wide, not per-doctor (v2 item). Changes apply prospectively only — already-submitted Cases and already-calculated Payouts are unaffected.

## Constraints

- Modular Monolith paradigm: module isolation, no cross-module DB joins or foreign keys.
- Payment, OTP, and file-storage integrations go through provider interfaces with v1 mocks and clean v2 real-implementation swaps — no real external gateway integration work happens in v1.
- SLA breach detection and Doctor Payout are both daily batch jobs, not real-time — sub-hour precision is explicitly not required.
- Case status is a single formal state machine shared by every module that reads or writes it — no module invents its own state names.
- v1 is POC-scoped for security/compliance: no formal encryption-at-rest, DPDP/HIPAA-equivalent program, or data-residency commitment. This carries an explicit, PM-flagged risk given real medical documents and real payments flow through v1.
- A single Admin role only — no multi-admin RBAC in v1.
- Deployment target is AWS EKS as a single Deployment/Service — no per-module services in v1.
- Stack is pinned: Next.js 16.3.6, Node.js 26 LTS, PostgreSQL 18.6, Prisma ORM v7.

## Non-goals

- Not a telemedicine or live-consultation platform — no video/voice/chat between Patient and Doctor; the interaction is document + written-opinion only.
- Not an emergency/urgent-care triage service — the Urgent tier means expedited written review, not immediate medical attention.
- Not a multi-opinion marketplace in v1 — one Opinion per Case, one Doctor per Case; no doctor shopping, ratings, or multiple-bids flow.
- No mid-case Standard-to-Urgent escalation (v2 item).
- No specialty-based auto-assignment/routing in v1 — only doctor self-claim and Admin assign/reassign.
- No formal security/compliance program in v1 (see Constraints).

## Success signal

SecOpinion v1 succeeds if a meaningful share of submitted Cases receive a Doctor Opinion within the 5-day/120h Response SLA (a low refund rate), Doctors return to review additional Cases after their first (retention), and time-to-Opinion trends down over time — all without loosening the manual Doctor-verification bar to inflate doctor supply, or Doctors rushing low-quality Opinions just to beat the SLA clock. Demonstrable via a cohort of real Cases moving from `Submitted` through `Opinion Given`/`Refunded`, with refund-rate and time-to-Opinion trending as intended and Doctor Verification approval rate staying stable rather than being pushed up artificially.

## Assumptions

- Capability numbering CAP-1..CAP-14 mirrors the PRD's FR-1..FR-14 one-to-one for traceability, since the PRD's own functional-requirement breakdown already maps cleanly to independently reviewable capabilities; CAP-15/CAP-16 extend this same mirror to the later-added FR-15/FR-16.

## Open Questions

- Is OTP-fallback login supported alongside password login, or is v1 password-only (CAP-2)?
- Is zero-document Case submission ever allowed (CAP-7)?
- Are JPEG/PNG/PDF sufficient Document formats, or is DICOM needed in v1 (CAP-7)?
- Is there any post-closure clarification channel between Patient and Doctor, or is the written Opinion final (CAP-11)?
- What are the platform uptime SLA target, deployment scaling specifics (replica count, resource limits, DB connection pooling), and observability/backup-DR policy before production cutover?
