---
title: 'Public Homepage and Role Portals'
type: 'feature'
created: '2026-10-23'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: ['_bmad-output/planning-artifacts/prds/prd-secopinion-2026-09-20/prd.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The public home route is a placeholder and does not explain why a patient might seek an independent medical second opinion or help any of SecOpinion's three audiences find the correct entry point.

**Approach:** Replace it with a responsive, welcoming homepage that explains the patient benefit, shows a concise review journey, and presents separate Patient, Doctor, and Admin portal tiles. Use existing role-specific sign-in and registration routes; protected data and actions remain guarded by their existing APIs and pages.

</frozen-after-approval>

## Implementation Notes

- Ground patient-facing copy in the PRD: a qualified, independent Doctor reviews existing reports and provides a written opinion to support a discussion with the treating Doctor. Avoid promising a particular medical outcome; clarify this service is not emergency care or a replacement for the treating Doctor.
- Use a relevant medical consultation photograph and a distinct, restrained visual system that fits the existing site while making the homepage feel like a complete public entry point.
- Persona tiles link to Patient sign-in (`/login`), Doctor sign-in (`/doctors/login`), and the Admin portal (`/admin`). Include Doctor registration (`/doctors/register`) and the existing post-OTP Patient password setup (`/register/password`) as secondary links without implying it starts OTP registration.
- Do not add or change registration flows, authentication/session behavior, protected dashboards, APIs, or dependencies.
- Expected footprint: `src/app/page.tsx`, homepage-scoped additions to `src/app/globals.css`, this spec, and deferred-work entries for the pre-existing missing Patient registration start page and privacy disclosure.
- Verification passed: `npm test` (202 tests), `npx tsc --noEmit`, and `npm run build`. A shared screenshot confirmed the hero and image rendered; the browser CDP connection timed out on final desktop/mobile navigation checks, so the last responsive tweaks could not be visually verified.

## Review Triage Log

- defer — Blind Hunter: the Patient tile cannot start OTP registration because no public registration-start page exists; recorded in `deferred-work.md` rather than inventing a new onboarding flow in this homepage task.
- defer — Blind Hunter: no privacy/data-handling policy exists to link before inviting sensitive record uploads; recorded in `deferred-work.md` because the PRD leaves the policy undefined and approved legal language is required.
- patch — Blind Hunter: qualified the “without another hospital visit” claim to clarify that an in-person exam or follow-up may still be recommended.
- patch — Blind Hunter: added the documented five-day response SLA with its pause condition, current fee disclosure timing, and clarification that urgent is expedited written review rather than emergency care.
- patch — Blind Hunter: added a visible Portals shortcut in the header and kept it visible on mobile, where the informational anchors are hidden.
- patch — Blind Hunter: darkened section kicker text to improve contrast against the light background.
- false — Blind Hunter: reduced-motion support was already present in the homepage stylesheet's `prefers-reduced-motion` media query.