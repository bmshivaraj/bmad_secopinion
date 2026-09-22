---
title: "Product Brief: SecOpinion"
status: superseded-in-part
created: 2026-09-20
updated: 2026-09-20
---

# Product Brief: SecOpinion

> **[UPDATE 2026-09-20, during PRD authoring]** This brief describes SecOpinion as a fully free service. That has since changed: the founder confirmed a paid model — ₹1,000 for a standard second opinion, ₹2,000 for an urgent/expedited one, split between platform and reviewing doctor (exact split TBD) — to ensure sustainable doctor supply. Every "free" reference below is superseded by the PRD at [prd.md](../../prds/prd-secopinion-2026-09-20/prd.md), which is now the source of truth for scope and monetization.

## Executive Summary

SecOpinion is a free digital platform that lets patients who have been advised to undergo surgery or major treatment at a multi-specialty hospital get an independent second opinion from another qualified doctor — without another round of physical hospital visits. Patients register with just a mobile number, describe their problem, and upload the scans and reports they already have (X-ray, MRI, blood work, discharge summaries). Doctors registered on the platform review cases within their specialty, request more information if needed, and close the case with a written opinion. The goal is to reduce unnecessary or premature surgeries by making a qualified second opinion as easy to get as the first one was hard to question. [ASSUMPTION] Initial launch targets a single country/region with one regulatory regime (e.g., India) rather than a multi-country launch.

## The Problem

Patients told by a specialist that they need surgery are in a uniquely powerless moment: they are worried, they trust the doctor in front of them, and getting an independent opinion today means finding another specialist, taking another day off work, physically carrying or re-doing scans, and paying another consultation fee — friction big enough that most people simply proceed with the original recommendation, informed or not. The cost of skipping a second opinion shows up later: unnecessary surgeries, avoidable complications, and patients who felt they had no real say in a decision about their own body. [ASSUMPTION] The immediate trigger for most users will be a surgery recommendation specifically, not general diagnosis-shopping — this shapes the "case" model around a single recommended procedure.

## The Solution

A two-sided marketplace-style platform (free, not a marketplace on price) that separates "getting a second opinion" into a simple, asynchronous, document-first workflow:

- Patients sign up in minutes (mobile + OTP), open a case describing their condition and the recommended surgery/treatment, and upload whatever reports they have.
- The case is routed to doctors whose registered specialty matches the case.
- A reviewing doctor can ask for more documents (keeping the case open) or submit a written second opinion and close the case.
- Patients read the opinion in the app and decide, with their original doctor, how to proceed.

No live video/chat consultation, no payment, no scheduling in v1 — this is a document review and written-opinion workflow, not telemedicine.

## What Makes This Different

Most "second opinion" services online bundle in a paid teleconsultation and are positioned as premium/international (concierge medicine for people who can already afford to travel). SecOpinion is deliberately free and asynchronous first — it optimizes for the much larger population who just wants a qualified second set of eyes on their reports before a serious procedure, not a full alternate consultation. The honest moat here is not technology — it is **being the trusted, no-cost, low-friction default** people reach for right after leaving a doctor's office, plus (over time) the credibility of a real doctor-verification process. [ASSUMPTION] Being free is a deliberate initial differentiator/growth lever, not a permanent constraint — monetization is explicitly deferred, not ruled out (see Scope).

## Who This Serves

**Primary: Patients ("opinion seekers").** Someone recently told by a specialist they need surgery or major treatment, who is anxious, has physical or digital copies of reports, and wants reassurance or an alternative view before committing — often on behalf of an older parent or family member, not only themselves. [ASSUMPTION] Many users will be registering on behalf of a family member, which has implications for identity/OTP ownership (addressed as open question below).

**Primary: Doctors ("opinion givers").** Qualified, practicing specialists willing to review outside cases in their area of expertise asynchronously, in spare time, for visibility/goodwill/reputation rather than direct fee-per-case in v1. Success for them is a low-friction queue filtered to their specialty, enough information to give a responsible opinion, and a simple way to say "not enough information yet."

## Success Criteria

- Patients can go from "just left the doctor's office" to "case submitted with documents" in a single sitting, on a phone, without needing a laptop or scanner (photo upload is sufficient).
- A meaningful share of submitted cases receive a doctor's opinion within a defined SLA window. [ASSUMPTION] Target first-response SLA of 48–72 hours; needs validation once doctor supply is known.
- Doctors report the specialty-filtered queue and uploaded documents give them enough to responsibly opine or clearly say what's missing, without back-and-forth outside the app.
- Zero incidents of an unverified/impersonating "doctor" account giving opinions (tracked manually in v1 given deferred identity verification — see Scope).

## Scope

**In for v1:**
- Patient registration: mobile number + OTP verification, then system issues/lets them set a username + password for subsequent logins.
- Doctor registration: submits a doctor certificate / registration ID as proof; **manual review process** (ops team or the doctor's own attestation) rather than automated third-party verification.
- Patient case creation: structured problem description + free-text notes + multi-file upload (images/PDF) for X-ray, MRI, blood reports, discharge summaries, etc.
- Doctor dashboard: queue of open cases filtered to the doctor's declared specialty; case detail view with all documents; two actions — request more documents (case stays open, patient notified) or submit opinion and close case.
- Case status visible to the patient (submitted → under review → more info requested → opinion given/closed).
- No payments anywhere in v1.

**Explicitly out for v1** (candidates for later phases):
- Automated/third-party doctor credential verification (explicitly called out by the user as an open item for a future phase).
- Any payment, subscription, or paid-priority flow.
- Live chat, video consultation, or real-time messaging between patient and doctor.
- Multiple opinions / doctor marketplace / doctor ratings or reviews.
- Care coordination features (booking the actual surgery, second-hospital referral, etc.).
- Native mobile apps (v1 assumed to be a responsive web app). [ASSUMPTION]

## Key Risks & Open Questions

- **Doctor identity verification** is unresolved by design (user's own words: "open item for now"). Even a manual process needs an owner and a minimum bar before doctors can see real patient medical data — this cannot stay open once real PHI is involved and should be one of the first hard decisions in the PRD/architecture stage.
- **Regulatory exposure**: this handles medical images and reports (PHI/sensitive personal data). Depending on launch geography this likely implicates HIPAA, India's DPDP Act, or equivalent — needs explicit legal/compliance scoping before storing real patient data, not just "later."
- **Liability**: a doctor's "second opinion" that conflicts with the treating doctor's advice carries real medical-legal weight. Terms of service / disclaimer language and doctor liability need deliberate design, not an afterthought.
- **Free-service sustainability**: doctors reviewing cases for free need a non-monetary incentive (reputation, CME credit, visibility) to keep supply healthy — worth naming even though payments are out of scope for v1.
- **Family-member registration**: many cases will be submitted by a child/relative on behalf of the actual patient — the identity model (whose mobile number, whose consent) needs a decision.

## Vision

If SecOpinion works, it becomes the default first move after any serious diagnosis — a trusted, free layer between "the doctor said surgery" and "I'm scheduling surgery," backed over time by verified specialist credentials, faster-than-SLA turnaround, and enough trust that hospitals themselves recommend patients get their "SecOpinion" before signing consent forms.
