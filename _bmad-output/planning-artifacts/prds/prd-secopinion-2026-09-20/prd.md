---
title: SecOpinion
status: final
created: 2026-09-20
updated: 2026-09-22
---

# PRD: SecOpinion
*Working title — confirm.*

## 0. Document Purpose

This PRD is written for the product owner, downstream UX/architecture workflows, and the engineering team that will build SecOpinion. It builds on [brief.md](../../briefs/brief-secopinion-2026-09-20/brief.md); vocabulary is Glossary-anchored (§3), features are grouped with functional requirements nested under them (§4), and inferred details are tagged inline as `[ASSUMPTION]` and indexed in §9.

## 1. Vision

Healthcare has a structural conflict of interest: some multi-specialty hospitals and doctors are incentivized to recommend surgery because surgery is revenue, not because it is always the best or only path for the patient. A patient sitting across from that doctor rarely has the medical expertise, the composure in the moment, or the practical means to challenge the recommendation — getting a genuinely independent second opinion today means another hospital visit, another consultation fee, and re-doing paperwork with reports they already have in hand.

SecOpinion exists to close that gap at a deliberately low, transparent cost — not free, but priced to stay far below the cost of a redundant hospital consultation. A patient who has just been told they need surgery can, from their phone, describe their condition, upload the reports and scans they already have, pay a modest fee (₹1,000 standard, ₹2,000 for an urgent/expedited review), and get a written opinion from a different, qualified doctor — one who has no financial stake in the treating hospital's recommendation. `[CHANGE: earlier drafts of this Vision and the source brief.md described SecOpinion as fully free; the founder has since decided a nominal fee is required to reliably attract doctor supply — see §9 Assumptions Index and the Monetization section in §4.]` The platform is deliberately positioned as a public-good counterweight: enough independent, fairly-compensated doctors reviewing enough cases should, over time, make it harder for profit-motivated overtreatment to go unchallenged, and easier for a patient to know when surgery is genuinely necessary versus when it was the profitable answer rather than the right one.

This is not a seasonal or trend-driven need — it is evergreen, rooted in a lasting split between doctors who practice for the patient's benefit and hospitals/doctors whose incentives skew toward billable procedures. Success is not just usage: internally, the clearest signal the product is working is a meaningful share of cases — the founder's working estimate is **20-30%** — where the second opinion diverges from or avoids an originally-recommended surgery, and the patient is spared an unnecessary procedure. `[ASSUMPTION: 20-30% is a founder hypothesis to validate post-launch, not a committed target — see Success Metrics §7.]`

## 2. Target User

### 2.1 Jobs To Be Done

**Patients (opinion seekers):**
- When a specialist recommends surgery, I want an independent, qualified doctor to review my actual reports and tell me honestly whether surgery is necessary, so I can decide with confidence rather than blind trust.
- When I'm worried I'm being pushed toward an expensive procedure for the hospital's benefit rather than mine, I want a channel to check that isn't another hospital visit.
- When my case is urgent, I want a way to signal that and get a faster (paid) turnaround rather than waiting in a general queue.

**Doctors (opinion givers):**
- I want to review cases in my own specialty, on my own time, and be paid fairly for that expertise — rather than donating time indefinitely for goodwill alone.
- I want enough information (reports, scans, history) up front to give a responsible opinion, and an easy way to ask for more before I commit to one.

### 2.2 Non-Users (v1)

- **Minors' own registration** is not supported directly — a patient under 18 is registered and represented via a parent/guardian's mobile number (see §2.3). `[ASSUMPTION: age is self-declared at registration; no ID verification of age in v1.]`
- **Patients unable to independently operate a phone** (e.g., very elderly, cognitively impaired, no literate family member) are explicitly out of scope for v1 — `[NOTE FOR PM: this is a real access gap the founder chose to defer, not solve; revisit if adoption data shows this excludes a large share of the target population.]`
- **Emergency/life-threatening cases** requiring immediate treatment are not the target use case — SecOpinion assumes the patient has time to wait for a written opinion (hours-to-days, or paid-urgent turnaround), not a life-or-death decision window.
- **Mental health / psychiatric second opinions** are out of scope for v1. `[ASSUMPTION: excluded due to a different risk/expertise profile than physical-surgery cases; revisit as a v2 vertical.]`

### 2.3 Key User Journeys

- **UJ-1. Ramesh gets a second opinion before his knee replacement.**
  - **Persona + context:** Ramesh, 58, was told by his orthopedic surgeon he needs a total knee replacement. He's skeptical because a neighbor was told the same thing and later avoided surgery entirely via physiotherapy.
  - **Entry state:** New user, not yet registered, on his phone.
  - **Path:** Registers with mobile + OTP → sets username/password → describes his knee pain and the surgery recommendation → uploads X-ray and MRI photos taken with his phone → selects "standard" urgency → pays ₹1,000 → case enters the queue for orthopedic specialists.
  - **Climax:** An orthopedic doctor reviews the case, requests one additional report (a recent blood test), Ramesh uploads it, and the doctor closes the case with a written opinion: physiotherapy first, surgery not yet warranted.
  - **Resolution:** Ramesh takes the written opinion back to discuss physiotherapy-first with his own doctor, avoiding immediate surgery.

- **UJ-2. Priya registers her father, who was told he needs urgent surgery.**
  - **Persona + context:** Priya's father (68) was just told by a hospital he needs urgent gallbladder surgery. He's not comfortable with apps; Priya manages this for him.
  - **Entry state:** Priya registers using her own mobile + OTP, `[ASSUMPTION: v1 treats Priya-as-registrant and the patient as the same account — see §9 — meaning the case is technically "hers" even though the patient is her father; this is a known simplification, not a deliberate proxy-account model.]`
  - **Path:** Marks the case "urgent," uploads her father's reports, pays ₹2,000.
  - **Climax:** A doctor reviews within the expedited window and gives a same/next-day opinion.
  - **Resolution:** Priya and her father use the opinion to decide whether to proceed with the hospital's urgent surgery recommendation or seek more time.

- **UJ-3. Dr. Iyer reviews cases in his specialty between patients.**
  - **Persona + context:** Dr. Iyer is a cardiologist who wants to help patients get honest second opinions and earn supplemental income reviewing cases in downtime.
  - **Entry state:** Registered and verified (see Doctor Onboarding), logged in.
  - **Path:** Opens his dashboard, sees a queue of open cardiology cases → opens one → reviews uploaded reports → decides he needs an additional ECG reading → requests it from the patient → case stays open, patient notified.
  - **Climax:** Patient uploads the ECG; Dr. Iyer reviews and submits his written opinion, closing the case.
  - **Resolution:** Dr. Iyer is credited his share of the case fee; case moves to "closed" in both his and the patient's view.

## 3. Glossary

- **Patient** — The individual whose medical case is being reviewed. In v1, the Patient and the Registrant (§2.3, UJ-2) are the same account; no separate proxy/caregiver identity exists.
- **Registrant** — The person who creates the account and completes OTP verification. Equivalent to Patient in v1 (see above). For a Patient under 18, the Registrant uses a parent/guardian's mobile number.
- **Doctor** — A registered, credential-submitted medical professional who reviews Cases within their declared Specialty and issues Opinions.
- **Specialty** — A medical domain (e.g., Orthopedics, Cardiology, Oncology) a Doctor declares at registration; determines which Cases appear in their queue. A Doctor may declare more than one Specialty `[RESOLVED during Architecture: AD-12, architecture-secopinion-2026-09-22 — Doctor.specialties is a collection, not a single scalar; a Case matches a Doctor if the Case's specialty is in any of the Doctor's declared Specialties]`. `[OPEN QUESTION: fixed enum list vs. free text — see §8.]`
- **Case** — A single second-opinion request: one Patient's problem description, uploaded Documents, an Urgency Tier, and payment, tracked through a Case Status lifecycle to a closed Opinion.
- **Document** — A file (image or PDF) uploaded against a Case — X-ray, MRI, blood report, discharge summary, or similar.
- **Urgency Tier** — **Standard** (₹1,000) or **Urgent** (₹2,000); set once at Case submission and fixed for the life of the Case in v1 — determines queue priority and target turnaround. `[DECISION: mid-case escalation from Standard to Urgent is explicitly deferred to v2, not built in v1.]`
- **Case Status** — The Case's lifecycle state: `Submitted` → `Under Review` → `More Info Requested` (may cycle back to `Under Review`) → `Opinion Given` / `Closed`, **or** `Under Review`/`More Info Requested` → `Refund Pending` (on Response SLA breach) → `Refunded` (Admin-approved) or back to `Under Review` (Admin-rejected).
- **Opinion** — The Doctor's written second-opinion output that closes a Case.
- **Platform Fee** — The portion of the Case fee (₹1,000/₹2,000) retained by SecOpinion; the remainder is the Doctor Payout. `[OPEN QUESTION: exact split % — see §8.]`
- **Doctor Payout** — The portion of the Case fee paid directly to the reviewing Doctor's registered UPI ID after the platform's cut is deducted.
- **Doctor Verification Status** — `Pending` / `Verified` / `Rejected`, set by the single Admin after manually reviewing the submitted credential Document (certificate or Doctor ID) — see FR-5.
- **Admin** — The single application-owner/operator role (founder or designated staff) who manually reviews Doctor credential submissions (FR-5) and manually approves or rejects SLA-breach refunds (FR-13). `[ASSUMPTION: one Admin, no multi-admin roles or RBAC in v1 — revisit if verification/refund volume requires a team.]`
- **Platform Admin Account** — The application-owned financial account (bank/payment-aggregator account) that receives the full Case fee first, deducts the Platform Fee, and disburses the Doctor Payout to the Doctor's UPI ID. Managed by application admin staff, not by end users.
- **Response SLA** — The single 5-day (120-hour) window of cumulative `Under Review` time within which a Doctor must submit an Opinion (FR-11) or the Case enters `Refund Pending` (FR-13). `[CHANGE: brief.md's earlier "48-72 hour" aspirational target is retired — 5 days/120h is now the single Response SLA number used everywhere in this PRD, including Success Metrics §7.]` The clock **pauses** whenever Case Status is `More Info Requested` (waiting on the Patient) and **resumes** once the Patient uploads the requested Document(s) and status returns to `Under Review` — a slow-uploading Patient cannot cause a Doctor to breach the SLA.

## 4. Features

### 4.1 Patient Registration & Authentication

**Description:** A Patient (or a parent/guardian Registrant, for minors) creates an account using their mobile number, verified via OTP, and is then prompted to set a username and password for subsequent logins. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-1: Mobile + OTP Registration

A new Registrant can register using a mobile number and a one-time password sent to that number. Realizes UJ-1.

**Consequences (testable):**
- System sends a numeric OTP to the provided mobile number and rejects registration if the OTP is not confirmed within a defined expiry window. `[ASSUMPTION: 10-minute OTP expiry — confirm.]`
- A mobile number already registered cannot be re-registered as a new account; the system directs the user to log in or recover their account instead.
- Rate limiting applies to OTP requests per mobile number to prevent abuse. `[NFR — see Cross-Cutting NFRs.]`

#### FR-2: Post-OTP Credential Setup

After successful OTP verification, a Registrant can set a username and password for future logins, without needing OTP every time. Realizes UJ-1.

**Consequences (testable):**
- Password must meet a minimum complexity policy (length + character mix). `[ASSUMPTION: standard policy — min 8 chars, mixed case + number — confirm at Architecture stage.]`
- Subsequent logins accept username/password OR mobile+OTP as a fallback. `[OPEN QUESTION: is OTP-fallback login in scope for v1, or username/password only? — see §8.]`

#### FR-3: Guardian Registration for Minors

A Registrant can indicate the Patient is under 18 and register using their own (guardian's) mobile number on the Patient's behalf. Realizes UJ-2 (by extension).

**Consequences (testable):**
- Case records capture that the Patient is a minor and the Registrant is a guardian, for downstream doctor context.
- Age/guardian status is self-declared; no ID verification in v1 (see §2.2 Non-Users).

### 4.2 Doctor Registration & Verification

**Description:** A Doctor registers by submitting proof of credentials (a medical certificate or an official Doctor ID), one or more declared Specialties, and a UPI payment method for payouts. Verification is manual in v1 — no automated third-party credential check. Realizes UJ-3.

**Functional Requirements:**

#### FR-4: Doctor Registration with Credential Submission

A prospective Doctor can register with mobile+OTP (same mechanism as FR-1) and upload a credential document (certificate image/PDF or Doctor ID) plus one or more declared Specialties.

**Consequences (testable):**
- A Doctor account's Doctor Verification Status starts as `Pending` and the Doctor cannot access the case queue (FR-9) until moved to `Verified`.
- Doctor registration requires at least one credential Document and one or more declared Specialties before submission is accepted.

#### FR-5: Manual Verification Review

The Admin can view a Doctor's submitted credentials (degree certificate / Doctor ID Document) and set Doctor Verification Status to `Verified` or `Rejected`. Automated third-party verification against medical board/education registries is explicitly out of scope for v1 per the source brief.

**Consequences (testable):**
- A `Rejected` Doctor is notified and cannot access the case queue.
- A `Verified` Doctor gains access to cases matching any of their declared Specialties (FR-9).
- The Admin has a simple review UI/queue listing `Pending` Doctors and their uploaded credential Document(s). `[ASSUMPTION: a minimal internal admin screen, not a polished product surface — confirm scope at Architecture stage.]`

**Out of Scope:** Automated verification against medical board/education registries (explicitly deferred — see brief.md).

#### FR-6: Doctor UPI Payment Details

A Doctor can add their UPI ID during registration, and can add or update it later from their profile/settings. Realizes UJ-3 (payout path).

**Consequences (testable):**
- A Doctor's Doctor Payout cannot be disbursed (FR-12) until at least one valid UPI ID is on file.
- A Doctor can update their UPI ID at any time; the change applies to future Payouts only, not ones already disbursed.
- UPI ID format is validated at entry (basic format check); `[ASSUMPTION: no real-time UPI-handle verification with the bank/NPCI in v1 — confirm at Architecture stage.]`

### 4.3 Case Submission

**Description:** A Patient describes their problem, uploads supporting Documents, selects an Urgency Tier, and pays the applicable fee — into the Platform Admin Account — to submit a Case. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-7: Problem Description and Document Upload

A Patient can describe their condition and the treatment/surgery recommendation in structured + free-text fields, and attach one or more Documents (image/PDF). Realizes UJ-1.

**Consequences (testable):**
- At least one Document is required before a Case can be submitted for payment. `[ASSUMPTION: zero-document submission is not allowed — confirm.]`
- Supported Document formats: JPEG, PNG, PDF. `[ASSUMPTION — confirm against real-world report formats, e.g. DICOM for imaging.]`

#### FR-8: Urgency Selection and Payment

A Patient selects Standard (₹1,000) or Urgent (₹2,000) and completes payment — into the Platform Admin Account — before the Case enters a Doctor's queue.

**Consequences (testable):**
- Case Status remains `Draft`/unsubmitted until payment succeeds; a failed payment does not create a visible Case for Doctors.
- The Urgency Tier chosen at submission is fixed for the life of the Case in v1 — no mid-case Standard→Urgent escalation (deferred to v2; see Glossary, §6.2).
- The full fee (₹1,000/₹2,000) is captured into the Platform Admin Account at submission; the Doctor Payout split (FR-12) is calculated and disbursed only on Case closure (FR-11) or refunded in full on SLA breach (FR-13) — the platform never holds a doctor's share separately mid-Case.

**Feature-specific NFRs:**
- Payment processing goes through a third-party UPI/payment gateway (offloading PCI-DSS card-data scope to that provider); SecOpinion does not store raw card data. `[Cross-reference: Compliance and Regulatory, §4.6 — v1 is POC-scoped; see risk flag there.]`

### 4.4 Doctor Case Queue & Review Workflow

**Description:** A Verified Doctor sees Cases in their Specialty awaiting review, can request more Documents, or submit an Opinion and close the Case. Realizes UJ-3.

**Functional Requirements:**

#### FR-9: Specialty-Filtered Case Queue

A Verified Doctor can view a queue of Cases whose Patient-selected condition maps to any of the Doctor's declared Specialties, filtered from the wider Case pool.

**Consequences (testable):**
- A Doctor cannot see or open Cases outside their declared Specialties. `[RESOLVED during Architecture: AD-12 — a Doctor may declare multiple Specialties; a Case is visible if its specialty matches any one of them.]`
- Urgent Cases are visually distinguished and/or prioritized above Standard Cases in the queue ordering.
- Each Case in the queue shows time remaining against the 5-day/120h Response SLA (see Glossary), so Doctors can see which Cases are close to entering `Refund Pending`.

#### FR-10: Request Additional Documents

A Doctor reviewing a Case can request specific additional Documents from the Patient without closing the Case. Realizes UJ-3.

**Consequences (testable):**
- Case Status changes to `More Info Requested`; the Patient is notified of exactly what was requested; the Response SLA clock pauses at the moment of this transition.
- Once the Patient uploads the requested Document(s), Case Status returns to `Under Review`, the Doctor is notified, and the Response SLA clock resumes from where it paused.

#### FR-11: Submit Opinion and Close Case

A Doctor can submit a written Opinion, which closes the Case and makes the Opinion visible to the Patient.

**Consequences (testable):**
- A closed Case cannot be reopened by the Doctor; the Patient can only view/download the Opinion, not request edits. `[OPEN QUESTION: is there any post-closure clarification channel, or is the written Opinion final? See §8.]`
- Submitting an Opinion while Case Status is `Under Review` or `More Info Requested` triggers the Doctor Payout calculation and disbursal (FR-12) as normal.
- Once a Case enters `Refund Pending` (FR-13), the Doctor can no longer submit an Opinion until the Admin resolves the refund decision — this removes the race condition between a last-minute Opinion and an SLA-triggered refund (previously an open question, now resolved by the manual Admin approval step in FR-13).

### 4.5 Payments and Payouts

**Description:** Handles the patient-facing Case fee (captured into the Platform Admin Account), the resulting split between Platform Fee and Doctor Payout (disbursed to the Doctor's UPI ID), and the 5-day Response SLA refund guarantee.

**Functional Requirements:**

#### FR-12: Doctor Payout on Case Closure

When a Doctor closes a Case with an Opinion within the Response SLA (FR-11), the system calculates the Doctor's Payout share of the Case fee and disburses it directly to the Doctor's registered UPI ID (FR-6), deducting the Platform Fee first into the Platform Admin Account.

**Consequences (testable):**
- Payout split is a configurable percentage, not hardcoded, since the exact split (a founder-chosen value in the 20-30% platform / 70-80% doctor range) is not yet finalized. `[OPEN QUESTION: exact % split — see §8.]`
- Doctors can view a running log of Payouts owed/disbursed, and the UPI ID each was sent to.
- `[OPEN QUESTION: payout timing — immediately on Case closure, or batched (e.g. daily/weekly)? See §8 — an Architecture-stage decision informed by payment-gateway/UPI payout API capabilities.]`

**Feature-specific NFRs:**
- All payment and payout amounts are stored in a currency-safe representation (no floating-point money arithmetic).

#### FR-13: Admin-Approved Refund on Response SLA Breach

If no Doctor submits an Opinion within the 5-day (120h) Response SLA, the Case moves to `Refund Pending` and the Admin is notified to manually approve or reject the refund — refunds are not fully automatic, precisely to give the Admin a chance to catch a last-minute Opinion or other edge case before money moves.

**Consequences (testable):**
- The 5-day/120h clock starts at Case submission (payment success), pauses during `More Info Requested` (see Glossary), and is tracked per Case, visible to both Patient and queued Doctors (FR-9).
- On breach, Case Status moves to `Refund Pending` (not directly to `Refunded`); the Admin receives an intimation (notification) naming the Case and amount.
- While a Case is `Refund Pending`: the Doctor cannot submit an Opinion (FR-11) and the Patient cannot upload further Documents or edit the Case — the Case is fully locked pending the Admin's decision.
- **Admin approves:** Case Status moves to `Refunded`, the full amount (₹1,000 or ₹2,000, including any urgency top-up) is returned to the Patient's original payment method, no Doctor Payout is calculated, and the Case is closed to further action. Patient is notified of the refund and reason (no doctor available within SLA). `[NOTE FOR PM: this means an abandoned Case costs the platform the payment-gateway transaction fee with zero revenue — worth monitoring refund rate as an early operational health metric.]`
- **Admin rejects (keep Case open):** the Admin contacts the Patient directly (phone call, manual — v1 has no in-app mechanism for this) to ask whether they want to close the Case (→ Admin then approves the refund per above) or keep waiting for a Doctor. If the Patient chooses to keep waiting, the Case returns to `Under Review` with a **fresh 5-day/120h Response SLA window** (not a resumed clock — a new full cycle). If this second window also breaches with no Opinion, the same `Refund Pending` → Admin-contacts-Patient cycle repeats; there is no v1 cap on how many times this can recur. `[NOTE FOR PM: an unbounded retry cycle is fine for early, low-volume operation but will not scale — worth a v2 policy (e.g., cap retries, or auto-refund after N cycles) once Admin call volume becomes a bottleneck.]`

### 4.6 Compliance and Regulatory

**Description:** `[DECISION: the founder has scoped v1 as a proof-of-concept and explicitly chosen not to invest in formal encryption, data-privacy, or regulatory-compliance work at this stage.]` SecOpinion still handles real medical documents (PHI) and real money (UPI payments) even as a POC, so this section records the minimum baseline being kept, not a full compliance program.

**Functional Requirements:**

#### FR-14: Baseline Access Control for Medical Documents

A Document uploaded against a Case is only viewable by that Case's Patient and the Doctor currently assigned to it — ordinary application-level access control, not a formal security/compliance program.

**Consequences (testable):**
- No Doctor can access a Document belonging to a Case outside their assigned queue/specialty.
- Standard transport security (HTTPS/TLS) is used for all traffic; no additional encryption-at-rest, key management, or data-residency work is planned for v1. `[RISK, flagged by PM rather than silently accepted: this POC still stores real patients' medical records and processes real payments. A security incident or data leak carries real legal/reputational consequences regardless of the "POC" label. Revisit before any wider rollout, marketing push, or fundraising conversation that increases real-user exposure.]`

**Feature-specific NFRs:**
- No formal HIPAA/DPDP Act/GDPR compliance program, data residency commitment, or retention policy is defined for v1 — deferred to a post-POC phase. `[NOTE FOR PM: this is an accepted founder decision, not an oversight — but it should be revisited the moment real (non-test) patient and doctor data starts flowing through the system at any meaningful volume.]`
- Terms of Service must still include a liability disclaimer clarifying that a SecOpinion Opinion is advisory and does not replace the treating physician's care — this is a legal-exposure basic, not a compliance-program item, and is kept in scope even for the POC.
- Payment processing is delegated to a third-party UPI/payment gateway, which carries its own PCI-DSS obligations; SecOpinion itself does not store card data (see FR-8).

## 5. Non-Goals (Explicit)

- SecOpinion is **not** a telemedicine or live-consultation platform — no video/voice/chat between Patient and Doctor; the entire interaction is document + written-opinion based.
- SecOpinion does **not** provide emergency/urgent-care triage — "Urgent" (₹2,000) means expedited *written review*, not immediate medical attention. It is not a substitute for calling emergency services.
- SecOpinion does **not** book or coordinate the actual surgery, alternate treatment, or a referral to a third hospital — the Opinion is informational; what the Patient does next happens outside the platform.
- SecOpinion is **not** becoming a general telehealth or multi-opinion marketplace in v1 — one Opinion per Case, one Doctor per Case, no doctor shopping/rating/multiple-bids flow.
- SecOpinion does **not** perform automated/third-party doctor credential verification in v1 (manual review only — see FR-5); this is explicitly deferred, not solved.

## 6. MVP Scope

### 6.1 In Scope

- Patient registration (mobile + OTP, username/password), including guardian registration for minors.
- Doctor registration with credential submission, UPI payout details, and manual verification (Pending/Verified/Rejected).
- Case submission: problem description, document upload, Standard/Urgent tier selection, payment.
- Specialty-filtered doctor case queue with SLA-remaining visibility.
- Doctor workflow: request more documents, or submit opinion and close case.
- Payments: fee capture to Platform Admin Account, doctor payout to UPI on closure, Admin-approved full refund on 5-day/120h SLA breach.
- Basic case status visibility and notifications for the patient (submitted → under review → more info requested → opinion given/closed → refunded).

### 6.2 Out of Scope for MVP

- Automated/third-party doctor credential verification (deferred to v2 — see brief.md and FR-5).
- Multiple opinions per case, doctor ratings/reviews, or a doctor-choice marketplace.
- Live chat/video consultation between patient and doctor.
- Mental health/psychiatric case category (§2.2).
- Native mobile apps — v1 is a responsive web app. `[ASSUMPTION — confirm.]`
- Mid-case urgency escalation (Standard → Urgent top-up) — confirmed deferred to v2 (see §3 Glossary, FR-8).
- Formal encryption/data-privacy/regulatory-compliance program — v1 is explicitly POC-scoped (see §4.6); revisit before wider rollout.
- Care coordination, referral booking, or any post-opinion action beyond delivering the written Opinion.

## 7. Success Metrics

**Primary**
- **SM-1**: Share of closed Cases where the Opinion diverges from or avoids the originally-recommended surgery. Target: **20-30%** (founder hypothesis, to validate post-launch). Validates FR-11.
- **SM-2**: Median time from Case submission to Opinion (within the Response SLA). Target: a majority of Standard Cases resolved well inside the 5-day/120h SLA, Urgent Cases materially faster. Validates FR-8, FR-9, FR-11.

**Secondary**
- **SM-3**: Doctor-side retention — % of Verified Doctors who review more than one Case within their first month. Validates the doctor incentive model (UPI payout, FR-6/FR-12).
- **SM-4**: Refund rate — % of Cases that hit the 5-day SLA breach (FR-13). Validates doctor-supply adequacy relative to demand.

**Counter-metrics (do not optimize)**
- **SM-C1**: Doctor Verification approval rate should **not** be pushed up by loosening the manual review bar just to grow doctor supply faster — counterbalances SM-3 (retention/growth pressure should never trade off against the credibility of who's giving opinions).
- **SM-C2**: Time-to-Opinion should **not** be gamed by doctors submitting rushed, low-quality Opinions just to beat the SLA clock — counterbalances SM-2.

## 8. Open Questions

1. Doctor specialty model: fixed enum list vs. free text? (§3 Glossary, FR-9) `[Cardinality sub-question — single specialty per doctor or multiple — resolved during Architecture: AD-12, multiple specialties per doctor.]`
2. Is OTP-fallback login supported alongside username/password, or username/password only in v1? (FR-2)
3. Is zero-document Case submission ever allowed, or is at least one Document always required? (FR-7)
4. Supported Document formats — is DICOM (native medical imaging format) needed in v1, or is JPEG/PNG/PDF sufficient? (FR-7)
5. Exact Platform Fee / Doctor Payout split percentage within the confirmed 20-30% platform range. (FR-12)
6. Payout timing/mechanism — instant UPI transfer on closure, or batched (daily/weekly)? (FR-12)
7. Is there any post-closure clarification channel between Patient and Doctor, or is the written Opinion final once the Case is closed? (FR-11)

**Resolved or deferred during Finalize (kept for traceability, no longer open):**
- ~~Should a Success Metric explicitly track doctor-verification integrity?~~ Deferred to v2 — not a v1 Success Metric.
- ~~Should a Doctor be able to submit a late Opinion for the record even after the Case has auto-refunded?~~ Resolved — refunds now go through an Admin-approved `Refund Pending` step (FR-13) instead of firing automatically, which locks the Case to further Doctor/Patient action until the Admin approves or rejects, removing the race condition entirely.

## 9. Assumptions Index

- §1 Vision: Launch targets a single country/regulatory regime (inherited from brief.md).
- §1 Vision: The 20-30% "avoided surgery" figure is a founder hypothesis to validate, not a committed target.
- §2.2: Age/guardian status at registration is self-declared; no ID verification of age in v1.
- §2.3 UJ-2: Registrant and Patient are the same account in v1, even when the Registrant is acting on behalf of a family member (no separate proxy/caregiver identity model).
- §3/§4.2: Doctor verification is performed by a single Admin (founder/designated staff); no multi-admin roles or RBAC in v1.
- §3/§6.2: Mid-case Standard→Urgent escalation is explicitly deferred to v2 (confirmed decision, not an open question).
- §4.1 FR-1: OTP expiry assumed at 10 minutes.
- §4.1 FR-2: Password policy assumed as standard (min 8 characters, mixed case + number).
- §4.3 FR-7: Zero-document Case submission assumed not allowed (see Open Question 3).
- §4.3 FR-7: Supported Document formats assumed as JPEG/PNG/PDF (see Open Question 4).
- §4.2 FR-6: No real-time UPI-handle verification with bank/NPCI in v1 — basic format validation only.
- §4.2 FR-5: The Admin's verification review surface is assumed to be a minimal internal screen, not a polished product surface.
- §4.5 FR-13: On refund rejection, the Admin contacts the Patient by phone (manual, no in-app mechanism in v1) to decide close-vs-continue; continuing grants a fresh 5-day/120h SLA window with no cap on how many cycles can repeat.
- §7: Doctor-verification-integrity tracking (raised during brief.md reconciliation) is explicitly deferred to v2, not a v1 Success Metric.
- §4.6: V1 is explicitly POC-scoped — no formal encryption-at-rest, data-residency, or regulatory-compliance program; founder-accepted risk, flagged for revisit before wider rollout (see §4.6 risk note).
- §6.2: v1 is assumed to be a responsive web app, not native mobile apps.
