# SecOpinion — Solution Design (v1 POC)

*A fuller, human-readable companion to [ARCHITECTURE-SPINE.md](./ARCHITECTURE-SPINE.md). The spine is the terse, enforceable contract; this document explains the reasoning behind it for anyone joining the project, reviewing it, or picking up build work.*

**Status:** Final | **Date:** 2026-09-23 | **Scope:** SecOpinion v1 POC, all features FR-1 through FR-14

---

## 1. What SecOpinion Is, in One Paragraph

SecOpinion connects patients who've been recommended surgery or major treatment with independent doctors who review their case (documents + description) and give a written second opinion — for an Admin-configured fee (defaulting to ₹1,000 standard / ₹2,000 urgent at launch, per AD-16), split between the platform and the reviewing doctor at an Admin-configured percentage (defaulting to 20% platform / 80% doctor). v1 is explicitly a proof-of-concept: real money, real medical documents, but a founder-accepted reduced bar on formal compliance and security infrastructure, offset by a few concrete v1 safety floors (see §7).

## 2. The Big Architectural Bet: Modular Monolith

We chose a **Modular Monolith** over two alternatives:

- **Layered monolith** (controllers/services/repositories cutting across the whole app) — rejected because it doesn't map cleanly to how the product is actually organized (patients, doctors, cases, payments, admin are genuinely separate concerns with separate owners over time), and it tends to accumulate cross-cutting spaghetti as it grows.
- **Microservices from day one** — rejected because at POC stage it's pure overhead: more infrastructure to run, more network calls to reason about, more deployment complexity, for a team that's still validating the product.

The Modular Monolith is the middle path: **one deployable app**, but with **hard internal walls** between five modules — Patients, Doctors, Cases, Payments, Admin. Each module is written as if it *were* a separate service, just without the network hop. This means that if a specific module later needs to scale independently, or be owned by a different team, or run on different infrastructure, it can be pulled out **without a rewrite** — because the two invariants below were enforced from day one.

### The two invariants that make future extraction possible

1. **Module isolation (AD-2):** No module ever reaches directly into another module's database tables. If Cases needs to know something about a Doctor, it asks the Doctors module's exported interface, not the database.
2. **Reference-by-ID, not foreign keys (AD-4):** A `Case` stores a `doctorId` as a plain UUID column — not a database foreign key into the Doctors table. This feels like giving something up (the database can no longer enforce "this doctorId must exist"), and it is — that's a deliberate, named trade-off. The payoff: the day a module gets its own database, nothing breaks, because nothing was ever silently relying on a cross-database constraint that can't exist once the databases are split.

If you're wondering "isn't losing database-enforced integrity risky?" — yes, mildly, and we accepted that risk explicitly (see the memlog) precisely because the alternative (keeping the FK) would make the whole point of the modular monolith — the option to split later — false advertising.

## 3. Why the Data Model Looks the Way It Does

A few specific decisions shape the Case data model in ways that aren't obvious from reading the code alone:

- **A Case doesn't need a doctor to exist.** Patients can submit a case without picking anyone; the case goes into an open queue. Doctors can also self-claim (`assignCaseToDoctor`, optimistic-locked so two doctors can't claim the same case) and Admin can assign/reassign at any time — including moving a doctor's whole caseload to someone else if that doctor leaves the platform.
- **Reassignment never resets the 5-day SLA clock.** The clock is about the patient's wait time, not about which doctor currently owns the case — the incoming doctor inherits the case history, so there's no reason to restart the clock.
- **The SLA clock can pause.** When a doctor asks for more documents, the clock pauses; it resumes (not restarts) when the patient uploads them. We store this as an explicit array of pause/resume timestamp pairs — deliberately *not* left as a vague "duration or timestamps, pick one" choice, because two different engineers picking two different representations would silently produce two different SLA calculations for the same case. There is exactly one function in the codebase allowed to compute elapsed SLA time.
- **The Case lifecycle is a formal state machine** (`Submitted → UnderReview → MoreInfoRequested/OpinionGiven → RefundPending/Closed → Refunded`, see the spine's mermaid diagram). This was tightened during review specifically because the PRD and early architecture notes only referenced state *names* in prose — which is exactly the kind of ambiguity that lets two people build two different, incompatible schemas.
- **Doctors can have more than one specialty.** A Case is visible to a doctor's queue if it matches *any* of their declared specialties, not just a single one.

## 4. What's Real Money and Real Documents, and What We Did About It

SecOpinion is a POC, but it's not a toy: real medical documents and real payments flow through it from day one. Two areas got specific, deliberate treatment as a result:

- **Document access control (AD-14).** Given the sensitivity, we pinned down *exactly* where the "can this user see this document" check happens — inside the Cases module's service layer, never inside the generic storage interface, and never re-implemented ad hoc in a route handler. This was tightened during adversarial review, which found that three different (each internally reasonable) implementations were possible without this rule.
- **A minimum v1 operational floor.** Even though the full observability stack, backup/DR policy, and formal compliance program are explicitly deferred (see §6), we did *not* defer everything: structured logging and failure alerting for the two daily batch jobs (SLA-breach detection, doctor payouts) are in scope for v1. A silently-failed batch job would mean a missed refund or an unpaid doctor — not an acceptable silent failure even at POC scale.

## 5. The Provider Abstraction Pattern (Repeated Three Times, On Purpose)

Three different external dependencies — payments, OTP delivery, and file storage — all follow the exact same shape:

```
v1: real business logic  →  [Interface]  →  Mock implementation
v2: real business logic  →  [Interface]  →  Real implementation (UPI gateway / SMS gateway / cloud blob storage)
```

This is not three separate decisions; it's one pattern applied three times, because the underlying problem is the same each time: *we know v1 needs a stub and v2 needs the real thing, and we don't want the swap to touch business logic.* The interface is the seam. `MockPaymentProvider`, `MockOtpProvider`, and `LocalDiskStorageProvider` all exist purely to make v1 runnable without external accounts/credentials; none of the calling code should need to change when v2 swaps in Razorpay, a real SMS gateway, or S3-compatible storage.

One caveat surfaced during review: `LocalDiskStorageProvider` writes to local disk, which is *ephemeral* inside a Kubernetes pod — if the pod restarts, uploaded files are gone unless a PersistentVolume is attached. This is fine under the v1 assumption of a single replica, but is explicitly called out as something that must change before running multiple replicas or before production.

## 6. Deployment Path: Laptop Today, AWS EKS Tomorrow

v1 runs locally (Next.js dev server + Postgres via Docker Compose) during development. The confirmed production target is **AWS EKS**, running the entire modular monolith as a single Kubernetes Deployment/Service — not one service per module. Kubernetes here is just a way to run a container reliably; it is **not** an implicit commitment to microservices. If a module is ever extracted, *that's* the day it becomes its own Deployment — Modular Monolith and Kubernetes are independent choices that happen to both be true for SecOpinion right now.

Two deployment questions are intentionally left open for a later, pre-production pass rather than decided now: replica count / resource sizing / DB connection pooling, and the platform's own uptime SLA target (distinct from the patient-facing 5-day case SLA, which *is* decided).

## 7. What's Explicitly Not Decided Yet (and Why That's OK)

Architecture's job is to fix only the decisions that would let two people building the same system diverge — not to pre-answer every question. Several things are deliberately left open:

- **Product-level open questions that belong to the PRD, not architecture:** whether OTP-fallback login is supported alongside password login, whether zero-document case submission is ever allowed, which document formats are supported, and whether there's any post-closure clarification channel. Architecture would be overstepping to invent answers here.
- **Operational maturity items that come before production, not before v1 code:** full observability/monitoring, backup/DR policy, CI/CD specifics, multi-region topology, and deployment scaling specifics.
- ~~A business decision, not a technical one: the exact doctor payout percentage split~~ — resolved since this snapshot was written: AD-16 makes both the doctor payout split and the Case fee amounts Admin-configurable at runtime (defaults 20% / ₹1,000 / ₹2,000), rather than a founder-fixed constant.

## 8. How This Document Relates to the Spine

This document exists to explain; [ARCHITECTURE-SPINE.md](./ARCHITECTURE-SPINE.md) exists to enforce. If the two ever seem to disagree, the spine wins — this is a snapshot explanation, the spine is the living contract. The full decision history, including every "why," lives in [`.memlog.md`](./.memlog.md), and the Reviewer Gate's independent critiques live under [`reviews/`](./reviews/).
