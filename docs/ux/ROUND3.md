# Lane B — round 3

## Result

The guided path still takes **four real keyboard activations from the bracket sample to a downloaded ZIP**. This round makes the geometry, pending edits and fit limits visible without adding another confirmation step. Application build: **`98f6fd9`** on local branch `ux/b`. No remote push or public publication.

![Round-three desktop and phone overview](ROUND3-review.png)

The screenshots are from the working application, not mock-ups. Desktop: 1440 × 900; phone: 390 × 844. The before set is the unchanged round-two application at `368ba25` (its application code matches `f148716`); the after set is the tested round-three build. Private-file geometry is not included in this report or repository.

## What changed

### 1. A cut is an actual plane

Selected cuts now have a translucent plane extending beyond the model, a pale high-contrast boundary that remains visible through the model, a centre ring and a normal arrow. Inactive boundaries are subdued. The manipulation handles are larger, enlarge again on engagement, and de-emphasise the other axis while a handle is active. The gizmo remains attached to the selected plane.

A projected readout stays near the gizmo. Translation names the axis: **Offset X 160.0 mm**. Rotation names the world axis and sign where axis-aligned, for example **Tilt about Y +4.2°**; oblique axes are explicitly local. The angle is the change during the current drag, not an absolute Euler angle. Release commits; Escape cancels. Actual pointer translation, tilt, release, cancellation and the next part-selection click passed regression tests.

![Real pointer tilt in progress](screenshots/r3-desktop-cut-tilt.png)

### 2. Pins carry identity, depth and an honest edit state

A gold selection ring and numbered badge match the selected pin's inspector and keyboard list. Numbering is consistent across all contacts on a cut, rather than restarting on each contact. A dashed leader connects the pin to its inspector. On desktop the inspector uses the sidebar instead of covering the selected footprint; on phone it sits below the ordinary inspection area. The body scrolls independently of the fixed heading, pending/applied status, and Apply/Delete actions. In enlarged-phone mode it moves into the active expanded-view subtree so it does not inherit the inert sidebar.

All footprint discs now use the same unlit appearance and true diameter. The selected ring is a selection affordance, not a drilling boundary. The accepted plan supplies both mating hole depths to a two-sided section diagram and translucent 3D depth envelopes. Face-on view hides the redundant axial envelopes; orbiting reveals them. The diagram explains the **0.3 mm end allowance** on dowel/press holes, so a requested 12 mm insertion depth is not silently presented as a 12.3 mm setting.

**Apply is disabled when unchanged or reverted.** Editing a value shows “Not applied · preview still shows accepted geometry”; building is blocked until those edits are applied or discarded. No live-draft geometry is implied. The existing red edge/hole/overlap checks and replan validation remain in place.

| Accepted depth inspection | Phone: scrolled details, fixed actions |
|---|---|
| ![Desktop depth envelopes](screenshots/r3-desktop-depth.png) | ![Phone depth section](screenshots/r3-phone-depth.png) |

The depth captures use real camera keys to orbit and zoom out, and real scrolling on the phone. A depth envelope is a cylinder illustrating axial extent, **not** an exact mesh preview of a keyed peg, insert, bolt or seam. Built solids remain the authoritative geometry inspection.

### 3. Fit says what exceeds what

Fit now states the excess in ordinary language, labels the order **W × D × H**, and projects dimension arrows from the model bounds. Failed dimensions use the warning colour; the legend explicitly calls the blue box **usable printer volume**.

The private helmet fixture was checked on desktop and phone. Both read:

> 9.8 mm too deep for the usable space (Depth 223.8 mm > 214 mm).

The accompanying values are 250 × 220 × 270 mm nominal and 244 × 214 × 267 mm usable, with **3 mm reserved at each side and at the top**. The phone also has a compact loaded-file/original-scale/Replace row. Margin details remain available by scrolling the Fit panel, rather than being removed on phone.

Importantly, this is an **as-placed** overflow. The unchanged planner subsequently found an orientation that fits that helmet as one piece. Its downloaded build contains one manifold 226,172-triangle part. The UI does not force unnecessary cuts or pretend that the initial pose predicts the final part count.

### 4. Plan first, build later

The primary action is now **Plan cuts for [printer]**. The fit explanation says “Splitting finds pieces that fit” and explicitly tells the user that cuts and joints are reviewed before anything is built. It no longer guarantees success before planning. The original Load → Fit → Split → Join → Export structure and four-action fast path remain intact.

### 5. More phone inspection space

Split/Join canvas height grows from **146.16 px to 263 px**. Fit grows from **284.16 px to 289 px**, while reserving separate space for the legend and view buttons; the big gain is in editing, not Fit. View controls sit outside the ordinary inspection rectangle. The loaded-file row costs one visible phone control but makes replacement explicit.

### 6. State labels agree

Face-on selection now agrees with **Face-on section** in the camera readout. Orbiting changes that to **Orbit view** and unpresses Face-on; Fit view returns to **Perspective**. Replans preserve camera pose semantics as well as position/isolation. Pressed-plus-hovered buttons were separately checked and their contrast corrected.

The closed Precision map hides its contents; opening shows **−**. The separate contact selector now belongs to its own Advanced disclosure, so content below a closed “Precision map +” no longer looks like an already-open map. A new text-leak guard checks for `[object`, `undefined` and `NaN` in every captured round-three state.

## Before / after evidence for every priority

Each image opens at its original resolution. The same bracket sample and printer are used for both sides of these comparisons.

| Priority | Desktop before | Desktop after | Phone before | Phone after |
|---|---|---|---|---|
| 1 · Cut plane / pivot / readout | ![Before desktop cut](screenshots/r3-before-desktop-cut.png) | ![After desktop cut](screenshots/r3-after-desktop-cut.png) | ![Before phone cut](screenshots/r3-before-phone-cut.png) | ![After phone cut](screenshots/r3-after-phone-cut.png) |
| 2 · Pin identity / depth | ![Before desktop pin](screenshots/r3-before-desktop-pin.png) | ![After desktop pin](screenshots/r3-after-desktop-pin.png) | ![Before phone pin](screenshots/r3-before-phone-pin.png) | ![After phone pin](screenshots/r3-after-phone-pin.png) |
| 2 · Honest draft / Apply | ![Before desktop draft](screenshots/r3-before-desktop-draft.png) | ![After desktop draft](screenshots/r3-after-desktop-draft.png) | ![Before phone draft](screenshots/r3-before-phone-draft.png) | ![After phone draft](screenshots/r3-after-phone-draft.png) |
| 3 + 4 · Fit overflow / loaded file / planning expectation | ![Before desktop fit](screenshots/r3-before-desktop-fit.png) | ![After desktop fit](screenshots/r3-after-desktop-fit.png) | ![Before phone fit](screenshots/r3-before-phone-fit.png) | ![After phone fit](screenshots/r3-after-phone-fit.png) |
| 5 · Inspection space / fewer controls | ![Before desktop join](screenshots/r3-before-desktop-join.png) | ![After desktop join](screenshots/r3-after-desktop-join.png) | ![Before phone join](screenshots/r3-before-phone-join.png) | ![After phone join](screenshots/r3-after-phone-join.png) |
| 6 · Map disclosure / camera state | ![Before desktop map](screenshots/r3-before-desktop-map.png) | ![After desktop map](screenshots/r3-after-desktop-map.png) | ![Before phone map](screenshots/r3-before-phone-map.png) | ![After phone map](screenshots/r3-after-phone-map.png) |
| Expert mode preserved | ![Before desktop expert](screenshots/r3-before-desktop-expert.png) | ![After desktop expert](screenshots/r3-after-desktop-expert.png) | ![Before phone expert](screenshots/r3-before-phone-expert.png) | ![After phone expert](screenshots/r3-after-phone-expert.png) |

## Measurements

Raw measurements: [`measurements-round3.json`](measurements-round3.json). Counts use `checkVisibility()` and require the full control rectangle to be inside the viewport; disabled controls still count. Total rendered controls are recorded separately. Sidebar scroll position matters, particularly after selecting a pin; an in-viewport reduction is not automatically removal of a capability.

| Measure | Before | After |
|---|---:|---:|
| Real keyboard activations: sample → downloaded ZIP | 4 | **4** |
| Desktop Join controls, in viewport | 25 | **22** |
| Desktop selected-pin controls, in viewport | 31 | **22** |
| Desktop selected-pin controls, total rendered | 33 | **31** |
| Desktop Export controls, in viewport | 21 | **21** |
| Desktop Export controls, total rendered | 26 | **24** |
| Phone Join controls, in viewport | 18 | **16** |
| Phone selected-pin controls, in viewport | 29 | **27** |
| Phone Split/Join canvas height | 146.16 px | **263 px** |
| Phone Fit canvas height | 284.16 px | **289 px** |
| Desktop Fit canvas height | 626 px | **552 px** |
| Round-three axe states | — | **30** |
| Axe violations / undersized targets / horizontal overflows | — | **0 / 0 / 0** |
| Core edits still working directly in 3D | 5/5 | **5/5** |

The five core edits are move cut, tilt cut, add pin, move pin, delete pin through its contextual inspector. Exploded built-part selection also passed. Disabled history buttons, the pin selector and completed build/package buttons account for some density reduction. **This lane has not reached the competing lane's approximately 13-control baseline.** The workflow navigator and explicit alternatives remain deliberate overhead.

## Verification and regression evidence

### Tests-first contract

- **Behaviour protected:** visible geometric context, unchanged/pending pin edits, camera/disclosure truth, fit explanation, phone inspection space and absence of rendered JS-value leaks.
- **Plausible regression:** removing the plane overlay, leaving Apply enabled, dropping the selected badge, or allowing a camera pose to retain the wrong label makes the browser contract fail.
- **Why prior coverage missed it:** round-two tests proved that edits and exports changed the accepted geometry, not that the active plane, mating depths or editor state were visually understandable.
- **Production seam:** no new planner API, test flag or mutator. Tests operate normal DOM controls and pointer/keyboard/touch input; read-only inspection uses the existing `window.__ps` and `window.__viewer` diagnostics.

The failing test was committed as **`43f3589` before implementation**. The same context runner returned non-zero on the old application with **29 failed checks of 53**; after implementation **all 53 passed**. Representative red output:

```text
FAIL desktop plan action states next consequence
FAIL desktop active plane outline and pivot
FAIL desktop unchanged Apply disabled
FAIL desktop both depth sides previewed
FAIL phone compact loaded file
FAIL phone camera agrees with face-on
AssertionError [ERR_ASSERTION]
```

Green:

```text
PASS round-three context
PASS round-two keyboard workflow ... simpleActivations:4
PASS all responsive states, editing, reduced motion and accessibility
PASS accepted depths, orbit state, phone inspector scroll and fixed actions
```

The committed red test changed only to open the new Select a pin disclosure before choosing a pin. Existing label expectations were updated from “Split for” to “Plan cuts for”; the audit likewise opens the disclosure. No skips, weakened geometry assertions or regenerated golden expectations. The separate private-file test allows the planner's valid zero-cut result; it asserts overflow, margins, a visible depth dimension, a successful build and downloaded ZIP—not an arbitrary cut count.

### Fresh execution on the actual preview build

All browser suites below passed against build `98f6fd9` at its deployed sub-path. Ordinary hostname resolution failed in the test host, so Chromium's opt-in host-resolver override and curl's equivalent were used to reach the same HTTPS virtual host through loopback. The certificate and exact preview path were retained. This verifies serving/routing/assets and application execution, **not remote-client name resolution**. Two older harnesses initially lacked that option; their launch arguments were corrected and both were rerun successfully.

```sh
go test -count=1 ./...
go vet ./...
node e2e/round3-context.mjs "$URL" evidence/round3-after
node e2e/round3-depth.mjs "$URL" evidence/round3-depth
node e2e/guided-flow.mjs "$URL" evidence/round3-keyboard
node e2e/ux-audit.mjs "$URL" evidence/round3-audit
node e2e/round2-editing.mjs "$URL" evidence/round3-direct
node e2e/round2-touch.mjs "$URL" evidence/round3-touch
node e2e/interactions.mjs "$URL" evidence/round3-interactions
node e2e/expert-controls.mjs "$URL" evidence/round3-expert
node e2e/mobile-ui.mjs "$URL" evidence/round3-mobile
node e2e/smoke.mjs "$URL" bracket_320mm.stl prusa-mini evidence/round3-smoke
node e2e/joints.mjs "$URL" evidence/round3-joints
node e2e/support.mjs "$URL" web/samples/bowl_shell_300mm.stl evidence/round3-support prusa-mini
node e2e/round3-fit-file.mjs "$URL" "$MODEL" evidence/round3-private
node e2e/large-mesh.mjs "$URL" evidence/round3-large
```

The final suite includes all 13 assembly styles, custom volumes and scale, fallback/contact controls, manual cuts and deletion, auto-completion, history, coupon download, support comparison, 720k-triangle simplification, cancellation/restoration, full-detail building and modal/docked/mobile editor behaviour. The MINI bracket exported 12 files on two plates with zero non-manifold parts. The large-mesh fixture simplified to 400,000 triangles with measured maximum deviation 0.0033 mm, then built from the original detail. No Go/planner API changed.

### Capability reachability

The original [inventory](inventory.md) remains the capability checklist. The changed routes are:

| Capability | Route in this round |
|---|---|
| Choose individual pin without pointing | Join → Select a pin; expanded automatically in Expert mode |
| Pin diameter, insertion depth, individual clearance, delete | Select pin → contextual inspector |
| Contact/seam settings | Join → Advanced → contact selector; precision editor remains available |
| Separate Build / Prepare actions | Export; hidden in simple mode only after downloads already exist; Expert mode keeps them |
| Cut numerical edits / add / delete | Split → selected cut → Precise values; unchanged |
| Undo / Redo | Viewport toolbar when available; disabled buttons retained in Expert mode |
| Replace loaded file on phone | Compact loaded-file row, or Load → Replace |
| Scale, printer settings, joint styles, simplification, coupons, STL/3MF/ZIP | Unchanged routes in inventory; regression suite passed |

## Honest remaining limits

- Automated axe checks and keyboard/touch regressions are not full WCAG certification or physical-device testing. Native mobile software-keyboard behaviour, screen-reader speech and browser engines other than Chromium were not exercised.
- The phone pin inspector deliberately scrolls its detail body. Diameter/depth/clearance and the whole depth diagram cannot all fit at once while preserving useful 3D height and fixed actions. The margin explanation likewise needs a Fit-panel scroll. A screenshot at an intermediate scroll can show a partial paragraph; content is scrollable, not removed.
- Phone plane/pivot/normal are materially clearer, but the small pivot and normal still crowd the model from some angles. The depth annotation is closest to the volume boundary on narrow screens. Pan/orbit/zoom and Enlarge view remain important.
- Dimension arrows describe model bounds in the displayed pose, not an oriented minimum bounding box or a guarantee that a later packing result fits. Geometry warnings and built-part checks remain authoritative.
- The depth preview is schematic for non-cylindrical joint families. It does not establish strength, printable support, clearance after shrinkage or physical fit; use built meshes, a slicer and a coupon.
- Desktop Fit loses 74 px of raw canvas height to keep legend/dimension space clear. Phone editing gains substantially more space, but Fit's gain is modest.
- Export is no denser in the viewport than before, but it is not a minimal 13-control UI. The contextual pin state has less competing chrome, not a fundamentally different navigation model.

No source model was copied into the repository. All work and commits remain local.
