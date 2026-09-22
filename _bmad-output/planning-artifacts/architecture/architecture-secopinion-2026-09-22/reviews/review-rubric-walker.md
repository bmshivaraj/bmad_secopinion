---
title: Rubric Walker Review
reviewed: '2026-09-23'
spine: ARCHITECTURE-SPINE.md
lens: Good-spine checklist walkthrough
---

# Rubric Walker Review — SecOpinion Architecture Spine

**Verdict:** Well-structured and decision-rich for a modular-monolith POC, but under-specifies operational/environmental baselines and leaves a few PRD open questions and capability-map rows unaddressed.

## Checklist walkthrough

1. **Real divergence points fixed, none missed** — PASS. AD-1 through AD-12 cover paradigm, module isolation, provider abstractions, cross-module references, assignment mechanics, SLA batching, consistency conventions, payout timing, SLA pause/resume, and specialty cardinality.
2. **Every AD's Rule is enforceable** — PASS. Each AD has a concrete, checkable Rule (e.g. AD-4's "no cross-module FK constraints" is verifiable by inspecting `schema.prisma`).
3. **Nothing in Deferred is secretly load-bearing** — CONDITIONAL PASS. Deferred items are genuinely non-blocking for v1 feature delivery, but two deferrals (observability, backup/DR) carry "revisit before production cutover" flags with no interim baseline, which is a real operational risk for a POC handling real money and medical documents.
4. **Named tech plausibly current** — PASS (see companion version-verification review for a deeper pass).
5. **PRD capability coverage** — CONDITIONAL PASS. Capability → Architecture Map covers 12 of 14 FRs explicitly; FR-3 (Guardian Registration) and FR-6 (Doctor UPI Payment Details) are implied by module ownership but missing as explicit rows. PRD Open Questions 2 (OTP-fallback login), 3 (zero-document submission), 4 (document formats), and 7 (post-closure clarification channel) are not addressed anywhere in the spine — not decided, not deferred, not flagged.
6. **Initiative-altitude dimensions decided/deferred/open** — PARTIAL PASS. Deployment, database, auth, inter-module communication, and error handling are decided. Deployment scaling (pod replica count, resource requests/limits, DB connection pooling), platform uptime SLA, and batch-job failure/recovery are left completely silent rather than decided or explicitly deferred.

## Tiered Findings

**High**
- H-1: Observability/monitoring and backup/DR deferred with no interim v1 baseline (structured logging, error alerting, batch-job failure alerting).
- H-2: Security/compliance carries only a PM risk flag, no minimum v1 baseline controls named (encryption at rest, access logging, secure deletion).
- H-3: PRD Open Question 2 (OTP-fallback login) not addressed by the spine.

**Medium**
- M-1: Deployment scaling (replicas, resource limits, DB connection pooling, batch-job pod coordination) unspecified.
- M-2: Capability → Architecture Map missing explicit FR-3 and FR-6 rows.
- M-3: PRD Open Questions 3 (zero-document submission), 4 (document formats), 7 (post-closure clarification) unaddressed.
- M-4: Batch job failure/recovery (AD-8, AD-10) undefined — no retry/alerting policy.
- M-5: Platform uptime SLA target not specified.
- M-6: AD-12 says "PRD should be updated" but PRD was not yet updated — sync risk.

**Low**
- L-1: AD-11's "cumulative duration or timestamp pairs" phrasing leaves the field shape ambiguous (see adversarial review C-2 — now tightened).
