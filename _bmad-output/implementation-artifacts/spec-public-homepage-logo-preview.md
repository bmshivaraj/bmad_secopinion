---
title: 'Preview Supplied Logo on Public Homepage'
type: 'feature'
created: '2026-10-25'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
baseline_commit: '1515d617066e34f672782e387d240f4eb95b2ec4'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The public homepage currently uses a text label and an “S” monogram instead of the supplied SecOpinion logo.

**Approach:** Preview the supplied logo in the public homepage header and footer, with responsive sizing and accessible alternative text. Keep other application surfaces, homepage copy, and navigation behavior unchanged.

</frozen-after-approval>

## Implementation Notes

- Add the supplied image as a static public asset and use it for both homepage brand links.
- Source image: supplied session attachment.
- Keep the artwork legible at desktop and mobile sizes without changing the page's existing content or routes.
- Verify the homepage builds and visually inspect the result in the browser.
- Implementation: copied the supplied artwork to `public/secopinion-logo.png` and replaced both homepage brand marks with that accessible logo image.
- Responsive sizing: the logo renders at 90px in the desktop header, 74px in the mobile header, and 68px in the footer; existing homepage copy, navigation links, and routes are unchanged.

## Review Triage Log

- False: the supplied logo has a white background; preserving the provided artwork is intentional and matches the selected asset.
- Rejected low: the larger footer logo increases the brand row height, but the 68px logo is needed to keep the supplied wordmark legible at footer scale.
- Rejected low: the 277 KB PNG is 560px wide and used only on the homepage; extra image-processing tooling is not justified for this small asset.
- Deferred: clarify whether the five-day SLA counts calendar or business days and when it starts; pre-existing homepage copy outside this logo-only scope.
- Deferred: explain the expected expedited-review timeframe; pre-existing homepage copy outside this logo-only scope.
- Deferred: make fees discoverable before sign-in; pre-existing homepage copy outside this logo-only scope.
- Deferred: explain the Doctor verification claim; pre-existing homepage copy outside this logo-only scope.
- Deferred: link privacy information before record sharing; pre-existing homepage copy outside this logo-only scope.
- Deferred: explain that a reviewing specialist may request additional information or an examination; pre-existing homepage copy outside this logo-only scope.
- Deferred: explain reviewer-independence safeguards; pre-existing homepage copy outside this logo-only scope.
- Fixed: replaced the attachment's local user-profile path with a non-identifying source description in this spec.
