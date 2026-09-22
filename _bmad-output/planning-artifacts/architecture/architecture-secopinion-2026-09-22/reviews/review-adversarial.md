---
title: Adversarial "Attack the Spine" Review
reviewed: '2026-09-23'
spine: ARCHITECTURE-SPINE.md
lens: Construct two units that obey every AD yet build incompatibly
---

# Adversarial Review — SecOpinion Architecture Spine

**Verdict:** Deployment paradigm and module boundaries are well pinned, but five shared-semantics gaps let two independently-built modules obey every AD to the letter and still build incompatibly.

## Findings

**Critical**

- **C-1 — No formal Case state machine.** ADs and the Glossary reference state names (`Refund Pending`, `More Info Requested`, etc.) but nowhere fixes the complete, closed set of valid Case states and their legal transitions. Two engineers (e.g. one building Cases, one building Admin's reassignment flow) could each invent a different state enum and transition set while individually satisfying every AD, breaking integration the first time Admin calls into Cases. **Fix:** new AD-13 formalizing the Case status enum and transition graph as the single source of truth.

- **C-2 — AD-11's pause/resume field shape left open ("cumulative duration value *or* timestamp pairs").** Two builders (e.g. Cases module's daily job vs. Payments module reading Case data for payout timing) could each pick a different representation and independently reimplement the elapsed-time calculation, producing two different answers for the same Case. **Fix:** AD-11 tightened to mandate one shape (explicit pause/resume timestamp pairs — more auditable) as the only representation; elapsed-time calculation is a single exported function, not reimplemented per caller.

- **C-3 — AD-6's "atomic claim-if-still-unassigned" isn't tied to a concrete concurrency mechanism.** "Atomic" is asserted but not mechanized — one builder could implement it as a DB transaction with `SELECT ... FOR UPDATE`, another as an application-level check-then-set with no locking at all (which is not actually atomic). Under concurrent load this is exactly the race AD-6 exists to prevent. **Fix:** AD-6 tightened to specify optimistic locking via a version column (`assignmentLockVersion`), with both the doctor-claim path and the admin-reassign path required to go through the same exported function.

**High**

- **H-1 — FR-14 document access control ownership is silent.** The Capability → Architecture Map assigns FR-14 to "AD-7, AD-9" but neither actually says *where* the read-access check happens — in `StorageProvider`, in each module's `service.ts`, or at the route-handler boundary. Three internally-consistent-but-incompatible implementations are equally plausible from the current wording. **Fix:** new AD-14 pins document access control to the owning module's service boundary (Cases/Payments `service.ts`), explicitly keeping `StorageProvider` authorization-free (it only stores/retrieves bytes given an already-authorized caller).

## Fixes applied at Finalize

All three Critical findings and the High finding are resolved via AD-13 (new), AD-14 (new), and tightened Rules on AD-6 and AD-11 — see `ARCHITECTURE-SPINE.md`.
