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
- Verification: `npm run build` passed. Browser inspection confirmed the logo renders in the header and footer at desktop width and at a 390px mobile viewport; the wordmark is readable at both sizes.

## Review Triage Log

- Patch (low): added the logo's intrinsic 560-by-560 dimensions to both image elements so layout can reserve their aspect ratio before loading.
- False: desktop and 390px mobile browser screenshots show the supplied wordmark remains readable at the implemented header and footer sizes.
- Patch (low): recorded the successful production build and desktop/mobile browser inspection in the implementation notes.
