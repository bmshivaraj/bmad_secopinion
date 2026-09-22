---
title: Version Verification & Technology Currency Review
reviewed: '2026-09-23'
spine: ARCHITECTURE-SPINE.md
lens: Web-researched technology currency and provider pattern viability
---

# Version Verification Review — SecOpinion Architecture Spine

**Verdict:** Stack versions are plausible and mostly current as of the document date, but the Node.js pin looks stale by one LTS generation and the Prisma major-version choice lacks a stated rationale; provider-abstraction patterns (Otp/Storage/Payment) are technically sound and real v2 equivalents exist.

## Findings

- **Next.js 16.3.6** — current as of the document date; no concern.
- **Node.js 24 LTS ("Krypton", 24.21.0)** — MEDIUM: v24 entered Maintenance LTS ~2 weeks before the document date, and v26 entered LTS one day before it. A greenfield POC authored on this date should either justify staying on v24 or move to v26 LTS.
- **PostgreSQL 18.6** — current as of the document date; no concern.
- **Prisma ORM v7** — LOW-MEDIUM: v8 is now the default for new projects; v7 remains supported but the spine gives no rationale for staying on v7.
- **AWS EKS as production target** — realistic and current; single-Deployment topology for a monolith is standard; S3-compatible storage via CSI drivers is a reasonable v2 path.
- **OtpProvider abstraction (AD-7)** — sound; real SMS/OTP gateways exist to slot in behind it in v2.
- **StorageProvider / LocalDiskStorageProvider (AD-7)** — MEDIUM: local disk inside a Kubernetes pod is ephemeral — a pod restart loses uploaded documents unless a PersistentVolume is attached. The spine doesn't flag this risk anywhere.
- **PaymentProvider abstraction (AD-3, AD-10)** — sound; real UPI gateways with batch-payout APIs exist for the v2 swap.
- **Module isolation / reference-by-ID (AD-2, AD-4)** — standard, well-established pattern for future service extraction; no concerns.
- **Multi-specialty doctor model (AD-12)** — correct design for the stated requirement.

## Recommendations applied at Finalize

1. Bump Stack table's Node.js entry to the now-current LTS line.
2. Add an explicit ephemeral-storage caveat for `LocalDiskStorageProvider` under Deferred/Structural Seed.
3. Leave Prisma v7 as-is (LOW-MEDIUM, not blocking) — noted as an open item rather than auto-changed, since a major-version bump is a real tradeoff, not a mechanical fix.
