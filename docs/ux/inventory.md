# Capability inventory and migration map

Baseline: `e404028`. Audited before redesign against `web/index.html`, `app.js`, `viewer.js`, `jointeditor.js` and the browser tests. Lane B keeps the existing planner, geometry worker and export formats. **No capability is intentionally removed.**

The destination column is the implementation checklist. Guided shows the essentials; the single **Expert mode** switch reveals detailed controls in the same step. A per-step Advanced disclosure provides the same access without changing mode. In round 2 the step selects the appropriate view. Simple Export offers Parts/Plates; Expert exposes all four view-only presentations. They are not a second task navigation.

| Current capability / controls | Destination | Verification |
|---|---|---|
| Choose/drop STL (ASCII/binary), OBJ, 3MF; 300 MB guard | Load: Choose model, whole-window drop | Mapped; smoke + real mesh + unchanged file-format backend |
| Bracket, bowl shell, cube, damaged bunny samples | Load: sample chooser; Remove a loaded model to reveal it | Mapped; bracket/bowl browser-tested; all four sample buttons retained |
| Browser/server privacy statement, model name and dimensions | Load; persistent model title | Passed; flow + preview browser state |
| Repair outcomes, triangle/volume/format details, unit hint | Load: model report | Passed; large-mesh defect report + measured fixture |
| Unit conversion and absolute scale; Apply | Load: Advanced | Passed; expert-controls scale 100 → 200 → 100%; unit selector retained |
| Simplification banner; measured deviation; full-detail opt-out; simplify again | Load: always shown when applicable | Passed; large-mesh 720k → 400k and retained original |
| Memory refusal, invalid mesh explanation, crash breadcrumb and recovery | Load: alert, never hidden in Advanced | Mapped; invalid-mesh + crash recovery tested; memory guard unchanged |
| Staged load/plan progress, elapsed/estimated time, cancel and model restoration | Global progress region | Passed; large-mesh staged progress/cancel/restore |
| Printer catalogue with manufacturer source | Fit: printer selector | Passed; MINI/Core One/custom selection + source link audit |
| Custom X/Y/Z volume | Fit: editable dimensions | Passed; expert-controls custom volume |
| Margin, nozzle, minimum piece size | Fit: Advanced | Passed; expert-controls nozzle/volume and retained numeric inputs |
| Press, glue, slip, snap, seam radial fit clearances | Fit: Advanced → clearances | Passed; all five fit inputs visible + persisted settings wiring |
| Persist and restore settings; explicit reset to defaults | Fit: restored note + Reset | Passed; joints reload/reset tests |
| Auto split; all 13 joint-style presets | Split: automatic planning; Join: style selector | Passed; all 13 presets selected; cuts preserved |
| Fewer parts ↔ less support weight; pending-change warning | Split: three intent choices + Advanced precise slider | Passed; support persistence + 4 vs 6 part comparison |
| Keep upright / allow tilted orientations | Split: Advanced | Mapped; retained controls and planner settings; source parity |
| Plan totals, fit status, warnings, timing, support proxy and prior comparison | Split: result summary | Passed; smoke/support summaries + warnings |
| Select each leaf, dimensions, print face, overhang and warnings | Split: part buttons + inspector | Passed; expert-controls part inspector |
| Add X/Y/Z cut through selected part; auto-split oversized part | Split: contextual part inspector | Passed; expert-controls manual Z cut + autocomplete; X/Y retained |
| Select each cut; drag gizmo in 3D | Split: cut buttons / canvas selection | Passed; actual 3D pointer drag + cut selection |
| Cut offset slider/number, tilt A/B, axis X/Y/Z, Apply/Delete | Split: Move/Tilt in 3D; Precise values disclosure | Passed; actual normal drag, arc tilt, Esc cancel, offset Apply and delete |
| Auto-complete oversized manual plan | Split: fit warning action | Passed; expert-controls auto-complete |
| Cut-face list, inline joint map, contact selection | Join: face buttons, direct 3D editor, optional Precision map | Passed; mobile measured contact labels + native keyboard contact buttons |
| Joint fallback/single-pin warnings; force style; use seam/keyed peg; back to automatic | Join contact inspector; warnings linked from Split | Passed; joints fallback/force-single-contact test |
| Distance field visibility, add-kind selector, add-joint mode | Join: editor; Advanced inline controls | Passed; large-mesh add-mode/type/field controls |
| Pop-out map; zoom/pan/pinch, fit, dock beside 3D | Join: Zoom & edit | Passed; large-mesh zoom/wheel/dock; phone expansion and map |
| Map select/drag/delete joints, keyboard selection/nudge/add, focus return | Join: accessible editor | Passed; pointer add, keyboard nudge/pan, delete and Tab exit |
| Contact area, wall thickness, inscribed diameter, notes | Join: contact inspector | Passed; joints contact inspector + native contact selection |
| Seam kind/depth/pitch/clearance/male side, Apply; warnings | Join: Advanced / pop-out inspector | Mapped; existing seam handlers retained and reachable; joints forced/automatic checks |
| Joint type/fit/diameter/depth or size/screw length; male side; keyed shape | Join: selected-joint inspector | Passed; 13 presets + selected-joint controls; underlying per-kind handlers unchanged |
| Joint clearance/holes/material depth/warnings; Apply/Delete | Join: 3D pin popover + advanced inspector | Passed; pointer add/move/delete, individual diameter/depth/clearance and Undo/Redo; advanced per-kind controls preserved |
| Build parts; full-original vs simplified source | Export: Build; always-visible source control | Passed; 720k original full-detail build |
| Built exploded view; adjustable explode distance | Export: assembled/exploded choice + Advanced slider | Passed; expert-controls assembly/explosion toggle |
| Per-part manifold/volume/genus; pins; mating interference/outside/void checks | Export: verification report | Passed; build results and manifold assertions |
| Export package; ZIP, assembly HTML, all-parts 3MF, plate 3MF, individual STL | Export: files and downloads | Passed; real ZIP download + 3MF/STL/assembly links retained |
| Coupon diameter, start clearance, step, Generate, downloads | Export: Test fit first disclosure | Passed; real coupon STL download |
| Model/Cuts/Parts/Plates views; orbit/pan/zoom; select cut/joint/part | Step-selected view; Expert view toolbar; canvas keyboard alternatives | Passed; mobile tabs + camera keys + 3D drag |
| 1–4 views, Delete selected cut/joint, Esc deselect, A add mode | Focus-scoped viewer/editor shortcuts; documented | Passed; focus-scoped shortcuts + editor Tab/Escape; delete via native button |
| Help dialog, licenses, source link, build ID | Header guide/help + footer licenses/build | Passed; help/licenses axe; guide links and build stamp |

## New requirements

- Five-step navigation with prerequisites, clear next action, result announcements and no silent loss of work.
- One-click Expert mode, preserving all model/plan state and current step.
- Keyboard-accessible file chooser, native cut/part buttons, camera operation and joint editor with ordinary Tab navigation.
- Visible focus, 44 px controls, reduced motion, labelled progress/results, phone layout without horizontal overflow.
- Proper local guide: getting started, splitting, joints, printing/assembly, large meshes, FAQ, real-app images.

## Test design

1. **Behaviour protected:** a new maker can load, fit, split, inspect joins, build and download using only keyboard controls; Expert exposes the same editable plan.
2. **Plausible regression:** removing a next-step transition, disabling a required action, replacing a button with a click-only element, losing state on mode switch, or hiding download links makes the browser test fail.
3. **Existing coverage gap:** smoke/joint/support tests assume all five panels are simultaneously visible and do not exercise a guided flow, keyboard-only navigation, step prerequisites or accessibility audit.
4. **Production seam:** tests use real UI actions and existing `window.__ps`/`window.__viewer` read-only observations; no new test-only production hooks.
