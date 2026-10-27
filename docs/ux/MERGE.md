# Merging the three redesigns

Three complete redesigns of Splitter's interface were built in parallel from release `e404028` and reviewed over three rounds:

- **Lane A, viewer-first** (`ux/a` @ `adfb17d`): the model owns the screen; tools and explanations sit behind disclosures.
- **Lane B, guided steps plus expert mode** (`ux/b` @ `7e51552`): Load → Fit → Split → Join → Export, the four-activation simple path and the plainest wording.
- **Lane C, CAD workspace** (`ux/c` @ `9488b19`): object outliner, a single inspector, a command palette and a single authoritative build state.

This branch (`ux/merge`) starts from B and adds A's viewer and C's expert tools. One rule decided most conflicts: **the five steps are the only navigation.** Nothing from A or C adds a second progression, rail or tab set; their features sit inside a step, in the view, or behind Expert mode.

The planner, the WASM worker API and the Go code are unchanged from B. Merge-specific code lives in `web/js/merge.js` and `web/css/merge.css`. Small hooks were added to `app.js`, `flow.js`, `viewer.js` and `direct-editor.js`.

## What came from where

| From | Kept | Where it lives now |
|---|---|---|
| **B (backbone)** | Five steps with done/current/upcoming/blocked states; 4-activation simple path; printer-named primary action (“Plan cuts for Prusa CORE One / One+”); plain voice; fit card with usable vs nominal; H/W/D dimension arrows; drawn cut plane, anchored gizmo and “Offset X 160.0 mm” readout; pin selection ring, number badge and to-scale depth section; per-pin popover; Expert mode as a toggle that keeps step and plan | Unchanged in behaviour. Step eyebrows now repeat the step names (“STEP 3 · SPLIT”), replacing B's MODEL/PRINTER/CUTS/ASSEMBLY/PRINT, so only one vocabulary is used. |
| **A** | Viewer-first stage. | Desktop: the canvas runs full-bleed under a transparent top bar (61.5 % of the screen, up from B's 40–50 %). Phone: a slim summary row (“76.0 mm too wide.” + **Why?**/**Details**) above the persistent action bar; the step's full panel opens on demand and the choice is remembered. |
| A | Model fills the view | New framing in `viewer.frame()`: solves the camera distance from sampled mesh vertices (not a bounding sphere) and centres the projected silhouette. 82 % fill on landscape views, 90 % on portrait. |
| A | XYZ triad + Fit view overlay | Top-right of the view, beside Fit view. The triad is drawn from the live camera basis on every rendered frame. |
| A | Dismissible gesture hint | Bottom of the view, with a × that persists. On a phone the text says “pinch/two fingers” instead of “scroll/right-drag”. |
| A | A/B tilt fields tied to ring colours | The desktop view corner shows Offset, **Tilt A · orange ring** and **Tilt B · mint ring** for the selected cut (Enter applies, Esc restores). The same ring swatches label the precise fields in the side panel. Not shown on phones, where the side panel holds the same fields. |
| A | 1 mm / 5° snapping, Shift for 0.1 mm / 1° | Applied to the cut gizmo. |
| A | Actionable clearance readout | The pin card reads “Edge room 5.5 mm measured · 5.4 mm required.” When the pin is too close, it says what to do next. |
| A | Auto-split result card with Adjust / Regenerate | Top of Split and Join after an automatic plan. **Adjust cuts** selects the first cut and focuses the view; **Regenerate** is the existing `#autoSplit` button, moved into the card so there is only one automatic-split control. |
| **C (expert)** | Object outliner (model / cuts / parts / contacts & joints) | **Objects** panel over the left of the view. Open by default in desktop Expert mode, toggled by the **Objects** button, and full-width over the view on phones. Up/Down/Home/End, Enter selects, Esc closes. Selecting an item switches to the step that edits it. |
| C | Single inspector for the selection | An **INSPECTOR** heading pinned at the top of the step panel names the selection and its key facts. The step's existing editor below it is the only editor, so there are no duplicate forms. |
| C | Command palette (Ctrl K / Cmd K) | **Commands** button in Expert mode; Ctrl K works in both modes. It covers steps, samples, planning, build, downloads, coupon, undo/redo, views, mode, objects, every cut/part/contact/joint, delete selected, add pin, settings and help. Unavailable commands stay listed with their reason (“Build parts first”) and do not run. ARIA combobox/listbox with `aria-activedescendant`; focus returns to the opener. |
| C | Keyboard workflow | Palette and outliner keys, plus B's existing camera, joint-editor and Undo/Redo shortcuts. |
| C | Text-leak test | Every audited state in `e2e/merge-expert.mjs` fails on `[object`, `undefined` or `NaN` in rendered text, `aria-label`, `title` or `aria-description`. The round-three test keeps its own leak checks. |
| C | One authoritative build/export state | Export shows exactly one status: “Downloads match the current plan.”, “Parts are built from the current plan…” or **“Changes since last build. Rebuild to update the parts and downloads.”** When stale, the Export step reads “Rebuild needed”, the button reads **Rebuild parts** and the primary action reads **Rebuild & prepare downloads**. |

## Conflicts and decisions

1. **Navigation.** A had Model → Plan → Build → Package → Download plus Tools/View disclosures. C had Model/Cuts/Parts/Plates/Camera tabs and a 3D/Objects/Inspector phone switch. Both were dropped as navigation. B's five steps are the only progression. Model/Cuts/Parts/Plates stays as B's view-presentation toggle in Expert mode, matching the baseline.
2. **Build and Package.** A kept them as separate activations (5 to download); B merged them (4). B wins: the build checks remain visible in Export, and the separate buttons remain in the step panel.
3. **Primary action position.** C put “Preview split” in the header. B's bottom action bar wins because it is reachable by thumb and names its consequence.
4. **Where the inspector lives.** C used a right-hand inspector column, which would have taken space from A's viewer and duplicated B's step editors. Decision: the inspector is a heading and summary above the existing editor in the step panel. The outliner overlays the view only in Expert mode and can be closed, and the canvas shrinks beside it rather than hiding the model.
5. **Phone layout.** A's model-first layout was combined with B's always-visible next action: view, then a one-line summary with Why?/Details, then Back plus the printer-named action. B's fit card, legend and settings are one tap away. C's phone tab switcher was not kept.
6. **Legend.** A put the scene legend behind Why?. B drew it over the viewer. Merged: the legend sits under the fit verdict in the step panel (behind Why? on phones), so the viewer stays clear.
7. **Auto split button.** The result card's Regenerate is the same `#autoSplit` element, moved into the card while a reviewed plan is shown. Two buttons for one action caused confusion in review.
8. **“VIEW ONLY · same work”.** B's expert caption contradicted direct 3D editing, so it was removed; the step caption is shown in both modes.
9. **Viewer framing.** B used a bounding-sphere distance, so the model filled 9–15 % of the screen. Replaced with silhouette-exact framing (above). Re-framing on layout changes happens only while the camera is still in its framed pose; a user's orbit is never undone.
10. **Test selectors.** `body` also carries `data-step`, so B's unscoped `[data-step="join"]` could click the page centre once Join was current. This was the source of an intermittent failure. All tests now use `#flowNav [data-step=…]`. No assertions were weakened.
11. **Phone detail panel in old tests.** Tests that operate step-panel controls on a phone now start with the phone panel open (`localStorage ps.sheet=open`), which a user can choose with one tap. `merge-expert.mjs` covers the default collapsed summary separately.

## Capability checklist

The gate is the **union of the three inventories** (`docs/ux/inventory.md` here and in lanes A and C). `e2e/merge-expert.mjs` asserts that **all 96 baseline static control IDs from `e404028`** exist at both 1440 × 900 and 390 × 844, in both modes. It also checks that there are 13 joint styles, 5 fit clearances and 4 samples. The rows below say where each capability is reached and which test exercises it.

| Capability (union) | Reached in the merge | Exercised by |
|---|---|---|
| STL/OBJ/3MF chooser, page drop, 300 MB guard; four samples; privacy note | Load step; palette “Open a model file…”/“Load sample” | guided-flow, smoke, round3-fit-file (private 226k helmet) |
| Repair badges, model info, unit hint, unit conversion, scale/Apply | Load step (Expert: open) | expert-controls |
| Simplification banner, deviation, full-detail opt-in, simplify again, memory refusal, crash note, cancel/restore | Load step / progress panel | large-mesh (720k → 400k, cancel, full-detail build) |
| Printer catalogue + source, custom X/Y/Z, margin, nozzle, min piece, five fit clearances | Fit step (+Advanced) | expert-controls, round3-context, smoke |
| Persist/restore settings, reset defaults | Fit step; palette | joints |
| Fit verdict, usable vs nominal, axis excess, legend, H/W/D arrows | Fit step; phone summary + Why? | round3-context, round3-fit-file, merge-expert |
| Auto split, 13 joint styles, support preference + pending warning, upright/tilted | Split step / result card; Join style | joints, support, expert-controls |
| Plan totals, fit, warnings, timing, support proxy, comparison | Split step summary, result card, Objects | support, merge-expert |
| Part select, print face, add X/Y/Z cut, auto-split part | 3D click, part chips, Objects, palette | round2-editing, expert-controls |
| Cut select, 3D move/tilt with gizmo, snapping, readout, Esc cancel, undo/redo | 3D (Move/Tilt cut), view-corner fields, side panel | round2-editing, round2-touch, interactions, merge-expert |
| Offset slider/number, Tilt A/B, axis, Apply/Delete | Side panel; view-corner fields | expert-controls, merge-expert (offset −12 mm, Tilt A 10.0° measured, undo) |
| Auto-complete oversized plan | Split step; palette | expert-controls |
| Cut faces, inline map, contacts, fallback/single badges, force style/seam/keyed/back to automatic | Join step; Objects contacts | joints |
| Add/move/delete pin in 3D or map, distance field, add kind | 3D (Add pin), map, pin card, palette | round2-editing, round2-touch, joints |
| Pop-out/docked joint editor, zoom/pan/pinch, keyboard nudge/add/delete, focus return | Join step “Open editor”; palette | interactions, mobile-ui, large-mesh |
| Seam kind/depth/pitch/clearance/male side; point joint fields; hardware sizes | Join step Advanced / pin card | joints, expert-controls |
| Pin ring, badge, leader, to-scale depth section, edge room measured vs required | Join, selected pin | round3-context, round3-depth, merge-expert |
| Build, full vs simplified source, explode, manifold/volume/genus/pins/interference report | Export step | smoke, large-mesh, support |
| One output state; stale → Rebuild | Export step, Export tab label, primary action | merge-expert |
| ZIP, assembly HTML, 3MF, plates, STL | Export step; palette “Download ZIP package” | guided-flow (real ZIP), smoke, support |
| Joint coupon | Export “Test the fit first”; palette | interactions, ux-audit |
| Model/Cuts/Parts/Plates presentation, orbit/pan/zoom, F fit, 1–4 keys, triad, Fit view, gesture hint | View top bar | interactions, merge-expert |
| Delete selected, Esc deselect/cancel, A add mode, Ctrl Z / Ctrl Shift Z | Focus-scoped keys; palette | round2-editing, interactions |
| Objects outliner, inspector, command palette | Expert mode (palette also via Ctrl K in guided mode) | merge-expert |
| Help, guide, licenses, source, build ID | Header, footer, palette | merge-expert (axe on both dialogs), interactions (guide) |

## Measurements

Same harness for B and the merge: `e2e/merge-measure.mjs`, real Chromium (SwiftShader), reduced motion, bracket sample. **Controls** counts visible native buttons, inputs, selects, summaries and links (canvas handles are not counted). **Model** is the projected model bounding box, clipped to the canvas, as a fraction of the whole screen. Lanes A and C use different DOMs, so their figures come from their own round-three reports and are not directly comparable.

| State | B controls (visible) | Merge controls | B canvas / model | Merge canvas / model |
|---|---|---|---|---|
| Desktop simple · Fit | 18 | 19 | 0.44 / 0.127 | 0.62 / **0.294** |
| Desktop simple · cut selected | 26 | 30 | 0.40 / 0.105 | 0.62 / **0.294** |
| Desktop simple · Join | 23 | 24 | 0.40 / 0.105 | 0.62 / 0.294 |
| Desktop simple · Export | 24 | 25 | 0.50 / 0.150 | 0.62 / 0.281 |
| Desktop expert · cut selected | 44 | 58 | 0.40 / 0.105 | 0.44 / 0.354 |
| Phone simple · Fit | 18 | **12** | 0.34 / 0.093 | 0.71 / **0.392** |
| Phone simple · cut selected | 26 | **15** | 0.31 / 0.113 | 0.71 / 0.392 |
| Phone simple · Export | 24 | **15** | 0.45 / 0.146 | 0.71 / 0.304 |
| Phone expert · cut selected | 44 | **23** | 0.31 / 0.113 | 0.71 / 0.392 |
| **Private 226k helmet, phone Fit** | 18 | 12 | 0.34 / 0.063 | 0.71 / **0.530** |
| Private helmet, desktop Fit | 18 | 19 | 0.44 / 0.087 | 0.62 / 0.219 |

- **Simple path:** sample → downloaded ZIP in **4 activations** (sample, Plan cuts, Build & prepare downloads, Download ZIP), keyboard only (`guided-flow`). A: 5; B: 4; C: 5 (from their reports).
- **Phone model share:** the tall helmet now fills **53 %** of the phone screen (A reported 60 %; B measured 6 %). The wide bracket is width-limited at 39 %. It spans ~90 % of the screen width.
- **Lane reports for reference:** A loaded 8 / 7 controls (desktop / phone); C loaded 17 / 13. The merge's simple phone Fit has 12. Desktop expert has more controls than B because the outliner exposes every cut, part and joint as a button; this is intentional and closable.
- **Accessibility:** axe (WCAG 2 A/AA, 2.1 AA, 2.2 AA) reports **0 violations in 43 states**: desktop/phone × simple/expert × load, Fit (and phone summary), Split, cut selected, Join, pin selected, Export, help dialog, licenses dialog, command palette, plus the stale-build state. The same states have **0 targets under 44 px**, no horizontal overflow, **no overlapping or off-screen header/view controls**, and no text leaks. `ux-audit` covers reduced motion and the remaining responsive states.

## Verification

All of the following were run on this branch's final build, served locally and at the preview path:

```text
go test -count=1 ./...  ok (mesh, plan)        go vet ./...  clean
PASS guided-flow        PASS merge-expert      PASS round2-editing    PASS round2-touch
PASS round3-context     PASS round3-depth      PASS ux-audit          PASS interactions
PASS expert-controls    PASS joints            PASS mobile-ui         PASS large-mesh
PASS smoke              PASS support           PASS wasm-plan         PASS round3-fit-file (private model)
```

`scripts/e2e-all.sh URL OUTDIR` runs the whole set. Set `SPLITTER_PRIVATE_MODEL` to include the private-file check. `e2e/guide-shots.mjs` regenerates the guide images from the running app.

**Tests taken from each lane:** B's whole suite, which already carries the baseline smoke/joints/support/large-mesh tests. From A: the 96-ID capability gate, 44 px target sweep and phone model-area metric, re-implemented against the merged DOM in `merge-expert.mjs` and `merge-measure.mjs`. From C: the text-leak assertion across every state, palette/outliner keyboard checks and the stale-build contract. A's and C's own files drive DOMs that no longer exist (A's Tools/View disclosures, C's workspace tabs), so their assertions were ported rather than copied.

## Guide

`web/guide.html` remains B's eight-section guide, which had the plainest voice. It adds A's viewer material (view first, triad, Why?/Details, result card, ring-coloured tilt fields, snapping, edge room) and C's expert material (Objects, Inspector, Commands, one output state, palette keys). All five images (`web/guide/*.png`) are fresh captures of this build, including a new Expert-mode image.

## Screenshots

Bracket sample, 1440 × 900 and 390 × 844, taken from the final test run.

| | Desktop | Phone |
|---|---|---|
| Load | ![](screenshots/merge/desktop-simple-load.webp) | ![](screenshots/merge/phone-simple-load.webp) |
| Fit | ![](screenshots/merge/desktop-simple-fit.webp) | ![](screenshots/merge/phone-simple-fit-peek.webp) ![](screenshots/merge/phone-simple-fit.webp) |
| Split (result card) | ![](screenshots/merge/desktop-simple-split.webp) | ![](screenshots/merge/phone-simple-split.webp) |
| Cut selected | ![](screenshots/merge/desktop-simple-cut.webp) | ![](screenshots/merge/phone-simple-cut.webp) |
| Join | ![](screenshots/merge/desktop-simple-join.webp) | ![](screenshots/merge/phone-simple-join.webp) |
| Pin selected | ![](screenshots/merge/desktop-simple-pin.webp) | ![](screenshots/merge/phone-simple-pin.webp) |
| Export | ![](screenshots/merge/desktop-simple-export.webp) | ![](screenshots/merge/phone-simple-export.webp) |
| Expert · cut + Objects + Inspector | ![](screenshots/merge/desktop-expert-cut.webp) | ![](screenshots/merge/phone-expert-cut.webp) |
| Expert · Join / pin | ![](screenshots/merge/desktop-expert-pin.webp) | ![](screenshots/merge/phone-expert-join.webp) |
| Expert · Commands (Ctrl K) | ![](screenshots/merge/desktop-expert-palette.webp) | ![](screenshots/merge/phone-expert-palette.webp) |
| Expert · stale build | ![](screenshots/merge/desktop-expert-stale.webp) | |
| Expert · Fit / Export | ![](screenshots/merge/desktop-expert-fit.webp) ![](screenshots/merge/desktop-expert-export.webp) | |
| Help dialog | ![](screenshots/merge/desktop-simple-helpDlg.webp) | |

3D editing in the viewport (pointer and touch):

| Move cut | Tilt cut | Move pin | Add pin preview | Edge warning | Part picked | Touch drag |
|---|---|---|---|---|---|---|
| ![](screenshots/merge/edit-desktop-cut-drag.webp) | ![](screenshots/merge/edit-desktop-cut-tilt.webp) | ![](screenshots/merge/edit-desktop-moving-pin.webp) | ![](screenshots/merge/edit-desktop-add-preview.webp) | ![](screenshots/merge/edit-desktop-edge-warning.webp) | ![](screenshots/merge/edit-desktop-part-selected.webp) | ![](screenshots/merge/edit-phone-touch-drag.webp) |

## Gaps

- **Visual polish is deliberately left for the design pass.** Known rough spots:
  - the phone view bar in Expert mode is dense (four presentation tabs, Objects, Fit view and triad in 390 px; nothing overlaps or clips, and all targets are 44 px);
  - inactive tab and placeholder contrast is low but passes axe;
  - the fit annotation lines are busy over the model;
  - the step panel's top cards can sit tight under the step bar when scrolled.
- **Desktop is not fully full-bleed.** B's side panel stays at desktop widths because it holds the step's explanation and the primary action; the canvas grew from 40–50 % to 62 % of the screen rather than taking all of it. A's “fewest always-visible controls” holds on phones (12–15 in simple mode); desktop simple mode shows 19–30, mostly B's step panel.
- **View-corner tilt fields are desktop-only.** On phones the same fields are in the step panel. The gizmo and touch drag work on both.
- **The inspector is a summary, not a second editor.** C's inspector edited every field in place. Here, the fields stay in the step editor below the inspector heading, to avoid two forms editing the same object.
- **Phone outliner covers the view** while open (Esc/× closes it). Desktop shrinks the canvas beside it instead.
- **Model-share numbers depend on shape.** Wide, flat models are width-limited (bracket 39 % on a phone); tall ones exceed 50 % (helmet 53 %). A's 60 % figure was measured with its own harness.
- **Remote name resolution was not tested.** The preview was verified through the HTTPS virtual host with a host-resolver override (the test host cannot resolve its own preview hostname). This verifies assets, routing and execution, not a remote client's DNS.
