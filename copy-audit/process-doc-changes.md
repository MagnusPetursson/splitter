# Process documentation removed from the app and guide

Rule: user-facing text says what Splitter does and what the user needs to know. It does not say how Splitter was built, tested or reviewed. That belongs in `docs/`, the README, commit messages and reports.

Scope swept: `web/index.html` (controls, headings, helper text, tooltips, `aria-label`s, dialogs), every rendered string in `web/js/*.js`, `web/guide.html` (chapters, figure alt text, captions, FAQ, footer) and the downloadable assembly sheet (`internal/bundle/sheet.go`). The README, `docs/` and e2e comments were not changed.

Status: local commit on `copy/clean` and the private tailnet preview only. Nothing is pushed or public.

## Changes

### Guide: FAQ (`web/guide.html`, chapter 08)

| Before | After | Why |
| --- | --- | --- |
| **Which accessibility checks have been done?** The app uses named native controls, visible focus, status announcements, keyboard alternatives and reduced motion. Automated axe checks and keyboard walkthroughs are part of development. They are not a substitute for a full screen-reader and assistive-technology conformance audit. | *(entry deleted)* | Describes how the app was checked and adds an audit disclaimer. The user-facing facts are already in chapter 07 (Keyboard controls): "File selection, all settings, cut editing, joint editing and downloads are available without a mouse" and the Reduced motion entry. Nothing that a user needs was lost. |

### Guide: footer

| Before | After | Why |
| --- | --- | --- |
| Measurements in millimetres unless noted. Screenshots are from the working application, not mock-ups. | Measurements in millimetres unless noted. | Screenshot provenance is a note about how the guide was produced. |

### Guide: figure alt text and captions

The "actual", "real" and "working application" wording was there to say the images were not mock-ups. That is provenance, and screen-reader users heard it on every figure.

| Location | Before | After |
| --- | --- | --- |
| Ch. 01 figure alt | Actual Splitter screen: the bracket has three coloured pieces, … | Splitter screen: the bracket has three coloured pieces, … |
| Ch. 01 caption | The real bracket sample, planned for a Prusa MINI. … | The bracket sample, planned for a Prusa MINI. … |
| Ch. 03 figure alt | Selected cut in the real app, showing the 3D movement arrow … | Selected cut, showing the 3D movement arrow … |
| Ch. 04 figure alt | Join step in the actual app: a selected dowel pin … | Join step: a selected dowel pin … |
| Ch. 05 figure alt | Actual built bracket parts and pins arranged on printable plates in Splitter. | Built bracket parts and pins arranged on printable plates in Splitter. |
| Ch. 07 figure alt | Actual Splitter screen in Expert mode: the Objects list … | Splitter in Expert mode: the Objects list … |

### App: 3D view accessible name (`web/js/viewer.js`)

| Before | After | Why |
| --- | --- | --- |
| Interactive 3D model. Arrow keys orbit, Shift and arrows pan, plus and minus zoom, F fits. Cut and part buttons in Split provide an accessible selection alternative. | Interactive 3D model. Arrow keys orbit, Shift and arrows pan, plus and minus zoom, F fits. To select a cut or part, use its button in Split. | "Provide an accessible selection alternative" is conformance language. The user only needs to know what to press. |

## Checked and kept

These lines mention checks, tests or limits, but they describe how to use the product. None of them describes how it was made.

- Help dialog and guide ch. 05: "Geometric checks are not a physical fit guarantee. Print a test coupon and inspect every plate in your slicer." / "A successful geometric check does not establish strength, manufacturability or physical fit." These are real limits, and each comes with an action for the user.
- Joint coupon summary "Fit test" and coupon help text: the coupon is a product feature.
- Export `aria-label="Build verification"` and "Review the checks, then export": these name the manifold and mating checks that the product runs on the user's parts.
- Assembly sheet: "Physical fit is untested until printed." Clearances are starting values, so the user has to print the coupon.
- FAQ "Does 'manifold' mean safe to manufacture? … Verify critical parts independently.": a limit on the result, with an action for the user.
- Guide ch. 06: "use the repository's command-line planner": a real alternative for files too large for the browser.
- Status text "Building parts in your browser (Manifold WASM)": names the engine that is running. It does not describe development.
- `jointeditor.js` DOM comment `joint editors return here`: an HTML comment that is never rendered.
- `e2e/guide-shots.mjs` header comment "(no mock-ups)": developer tooling, outside the product.

## Verification

| Target | copy-check | design-r3 | design-r4 | profiles |
| --- | --- | --- | --- | --- |
| Local static build (`scripts/build-static.sh`, served by `caddy file-server`) | PASS, exit 0 | PASS, 121 checks | PASS, 111 checks | PASS, 118 checks, 0 errors |
| Tailnet preview `splitter-wip/copy/`, build `56a7d16` | PASS, exit 0 | PASS, 121 checks | PASS, 111 checks | PASS, 118 checks, 0 errors |

A browser probe of the preview read back the new 3D view name, a seven-entry FAQ with no accessibility entry, the shortened footer and the five rewritten alt texts.
