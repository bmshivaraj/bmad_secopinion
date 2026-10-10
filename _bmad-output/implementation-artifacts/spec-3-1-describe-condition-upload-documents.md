---
title: 'Describe Condition & Upload Documents'
type: 'feature'
created: '2026-10-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '2ee276da8962e831c11c612826e81c1bd225af43'
context: ['_bmad-output/implementation-artifacts/epic-3-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Patients cannot create a Case describing the condition and recommendation they received or attach the medical documents a Doctor needs for a second opinion.

**Approach:** Let an authenticated Patient create and maintain their own Case draft with structured fields for affected body area, current condition/diagnosis, and received treatment/surgery recommendation, plus free text, and upload supporting JPEG, PNG, or PDF Documents. Require at least one Document before the draft can proceed to payment; enforce document reads in the Cases service before storage access.

## Boundaries & Constraints

**Always:** Cases owns Case and Document persistence, validation, and authorization; capture affected body area, current condition/diagnosis, received treatment/surgery recommendation, and free text; identify the owner from the verified Patient session, never caller-supplied IDs; permit the Case's Patient and Admin to read its Documents at this stage, but not Doctors; validate authorization before calling `StorageProvider`; keep an incomplete draft out of Doctor-visible workflows; require at least one Document before progression to payment; accept JPEG, PNG, and PDF only; allow 1-5 files per upload, no file over 10 MiB, and no multipart request over 50 MiB; keep Cases-to-Patients/module references by ID without cross-module foreign keys; use the shared storage abstraction; return typed errors in `{ data, error }` envelopes.

**Never:** Implement Doctor selection, urgency, payment, Doctor queue visibility, additional-document requests, or later Case lifecycle transitions; put authorization in `StorageProvider` or route handlers; accept document storage keys from callers; store uploaded medical bytes in the database.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create or edit draft | Authenticated Patient submits the approved description fields | A draft owned by that session's Patient is created or updated | Missing/invalid session is unauthorized; invalid fields are typed validation errors |
| Proceed without a Document | Draft has no Documents | Progression to payment is blocked | Typed missing-document error; draft remains available |
| Upload a Document | Owner submits 1-5 JPEG, PNG, or PDF files, each at most 10 MiB, with a request at most 50 MiB | Bytes are stored through `StorageProvider`; private metadata is associated with the Case | Invalid format/content or exceeded limits are rejected; failed persistence cleans up saved bytes |
| Read a Document | Case Patient or Admin requests it | Cases authorizes before storage read and returns the file safely | Other roles, foreign owners, and unknown IDs are denied/not found without storage access |
| Incomplete draft | Patient saves description without uploading files | Draft remains private and is not payment-ready or Doctor-visible | No submission or payment side effect occurs |

</frozen-after-approval>

## Code Map

- `src/modules/cases/domain/index.ts`, `repository.ts`, `service.ts`, and `routes/index.ts` are placeholders; implement the Cases-owned draft/document contracts here and keep business rules in the service.
- `prisma/schema.prisma` and `prisma/migrations/` contain no Case or Document models/migrations; add Case and Document persistence with Patient IDs as module references, not cross-module foreign keys.
- `src/shared/storage-provider.ts` defines `StorageProvider` and `LocalDiskStorageProvider`; reuse `save/read/delete` for bytes, and do not add authorization to the provider.
- `src/shared/auth-context.ts` defines Patient/Admin role claims; `src/modules/patients/routes/index.ts` exports `PATIENT_SESSION_COOKIE` and `readRequestCookie` for the existing cookie pattern. Resolve owner identity from verified claims.
- `src/app/api/patients/login/route.ts` and `src/app/login/page.tsx` establish Patient session and UI conventions. No Case API route or Case page exists; add the draft/document endpoints and a patient-facing draft workflow without changing login.
- `src/modules/doctors/routes/index.ts` and `src/modules/doctors/service.ts` validate credential uploads; reuse only applicable format/byte-signature patterns after the upload limits are decided. Doctor credentials and Case Documents must remain separate records and ownership checks.
- `src/modules/doctors/service.test.ts` and `package.json` show the Node `tsx --test` pattern. Add Cases service/route coverage and include it in `npm test`.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` and a new migration -- add Case draft and Document metadata storage -- persists owner-scoped drafts without cross-module foreign keys.
- [x] `src/modules/cases/domain/index.ts`, `repository.ts`, and `service.ts` -- implement draft validation, owner-scoped create/update, document save/read/delete, payment-readiness validation, and cleanup on partial upload failure -- keeps data and authorization within Cases.
- [x] `src/modules/cases/routes/index.ts` and `src/app/api/cases/` -- parse requests and resolve Patient/Admin sessions at the HTTP boundary -- exposes typed envelopes without trusting caller ownership IDs.
- [x] `src/app/cases/new/page.tsx` and `src/app/globals.css` -- build a responsive Patient draft editor and document upload/list/read states -- supports completing or resuming the intake before payment.
- [x] `src/modules/cases/service.test.ts`, route tests, and `package.json` -- cover draft ownership, required documents, allowed/invalid formats, 5-file/10-MiB/50-MiB boundaries, authorization-before-storage, and storage cleanup -- verifies the matrix.

**Acceptance Criteria:**
- Given an authenticated Patient, when they create or update a draft, then its owner is derived from the session and their approved structured/free-text details persist.
- Given a draft with no Documents, when the Patient tries to proceed to payment, then progression is blocked and the draft is not exposed to Doctors.
- Given a valid Document upload, when it is attached to the Patient's draft, then JPEG, PNG, or PDF bytes and private metadata are stored and the Document can be read by that Patient or Admin only.
- Given a foreign Patient or Doctor requests a Document, when access is attempted, then the Cases service denies it before `StorageProvider.read` is called.

## Implementation Notes

- Added Patient-owned Draft Cases and private Document metadata, with Case-owned authorization before storage reads and upload cleanup after partial storage/database failures.
- Added 1-5 file upload parsing, 10 MiB per-file checks, a streaming 50 MiB request cap, JPEG/PNG/PDF signature validation, draft editing, document listing/removal/read, and readiness validation.
- Added a unique client creation request ID to make draft creation retries idempotent while allowing distinct Cases; document changes refresh the parent draft timestamp.
- Document deletion removes bytes before metadata so a storage failure leaves a retryable metadata record. Expired Patient sessions redirect to sign-in; controls remain disabled during writes; oversized files return 413.
- The multipart limit is enforced by a counting stream rather than a whole-request buffer. Route tests verify actual exact-limit acceptance and the binary document response's security/download headers.
- `npm test` passed all 85 Patient, Doctor, Admin, and Cases tests; `npx tsc --noEmit`, `npx prisma validate`, `npx prisma generate`, and `npm run build` passed.
- Browser checks covered the signed-out redirect, mocked draft save/readiness, and a narrow viewport with no horizontal overflow. The browser harness could not provide a file because its runner lacks a Node `Buffer`; file upload is covered by automated parser/service tests.
- `npx prisma migrate status` returned PostgreSQL `P1000`; no migration was applied and database-backed persistence/signed-in browser flow remain unverified.

## Spec Change Log

## Review Triage Log

- **low | patch** — Blind Hunter: a retry after a successful create with a lost response could create an inaccessible duplicate draft; added a unique client creation request ID, conflict recovery, and retry coverage while allowing distinct requests to create distinct Cases.
- **low | patch** — Blind Hunter: document add/remove operations did not refresh the parent draft timestamp; repository transactions now update `Case.updatedAt` with document changes.
- **medium | patch** — Blind Hunter and Edge Case Hunter: storage deletion failure after metadata deletion orphaned inaccessible bytes; storage is now deleted first, metadata is retained on failure, and retry/foreign-owner tests cover recovery.
- **medium | patch** — Blind Hunter: a 401 draft load left an editable form visible; all 401 API responses now redirect to Patient sign-in.
- **low | patch** — Blind Hunter: fields remained editable during asynchronous writes and could imply unsaved changes were saved; form and file inputs are disabled while busy.
- **maybe-false | defer** — Blind Hunter: concurrent authorized 50 MiB uploads may multiply parser/storage memory and pressure the process; settle with a concurrency/load test under deployment memory limits before production-scale rollout.
- **low | patch** — Blind Hunter: per-file size failures mapped to generic HTTP 400; oversized individual files now use typed `UPLOAD_TOO_LARGE` and HTTP 413.
- **low | patch** — Blind Hunter and Edge Case Hunter: the claimed 50 MiB acceptance test used a forged Content-Length with a tiny body; replaced it with an actual multipart body exactly at the byte cap.
- **low | patch** — Blind Hunter: document deletion lacked regression coverage; added foreign-owner denial and storage-delete failure/retry assertions.
- **false** — Blind Hunter: the frozen-intent marker's em dash is valid UTF-8 in the spec; the mojibake was only in the review diff rendering.
- **false** — Edge Case Hunter: `updateDraft` can return `null` after `updateMany` only if the Case is concurrently deleted, but Story 3.1 exposes no Case deletion path; current service callers cannot trigger the cited outcome.
- **low | patch** — Verification Gap Reviewer: document GET response bytes and security/download headers were not route-tested; added an HTTP-level handler test for binary content, private cache, attachment disposition, `nosniff`, and denied roles.
- **maybe-false | defer** — Verification Gap Reviewer: real Prisma repository and migration behavior lack a database-backed test; Prisma validation/client generation and fake-based service tests pass, but PostgreSQL returns `P1000`. Settle with a working test database, applied migration, and create/update/document read assertions.
- **medium | patch** — Verification Gap Reviewer: storage deletion failure could remove metadata before bytes; fixed by deleting bytes first and retaining metadata until cleanup succeeds, with an explicit retry test.

## Design Notes

Story 3.1 establishes private drafts and supporting Documents only. Story 3.3 owns payment and transition to the submitted state; Story 3.2 owns optional Doctor selection. A draft may be saved before it is payment-ready, but must not enter any Doctor-facing workflow. The upload limits intentionally reuse the existing Doctor credential limits. The Epic 3 context is the primary source for shared constraints.

## Verification

**Commands:**
- `npm test` -- expected: Patient, Doctor, Admin, and Cases suites pass.
- `npx tsc --noEmit` and `npm run build` -- expected: Case APIs and draft UI compile.
- `npx prisma validate` and `npx prisma generate` -- expected: Case/Document models validate and client types generate.
- `npx prisma migrate status` -- expected: inspect migration status; do not claim database-backed persistence unless credentials permit it.

**Manual checks:**
- Sign in as Patient, save a draft, upload an allowed file, confirm payment readiness only after a Document exists, and verify that foreign Patients/Doctors cannot read it while Admin can.