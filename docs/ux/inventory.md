# Capability inventory and migration map

Baseline: `e404028`. Audited before redesign against `web/index.html`, `app.js`, `viewer.js`, `jointeditor.js` and the browser tests. Lane B keeps the existing planner, geometry worker and export formats. **No capability is intentionally removed.**

The destination column is the implementation checklist. Guided shows the essentials; the single **Expert mode** switch reveals detailed controls in the same step. A per-step Advanced disclosure provides the same access without changing mode. The four viewer presentations remain independent of the five workflow steps.

| Current capability / controls | Destination | Verification |
|---|---|---|
| Choose/drop STL (ASCII/binary), OBJ, 3MF; 300 MB guard | Load: Choose model, whole-window drop | Pending |
| Bracket, bowl shell, cube, damaged bunny samples | Load: sample chooser | Pending |
| Browser/server privacy statement, model name and dimensions | Load; persistent model title | Pending |
| Repair outcomes, triangle/volume/format details, unit hint | Load: model report | Pending |
| Unit conversion and absolute scale; Apply | Load: Advanced | Pending |
| Simplification banner; measured deviation; full-detail opt-out; simplify again | Load: always shown when applicable | Pending |
| Memory refusal, invalid mesh explanation, crash breadcrumb and recovery | Load: alert, never hidden in Advanced | Pending |
| Staged load/plan progress, elapsed/estimated time, cancel and model restoration | Global progress region | Pending |
| Printer catalogue with manufacturer source | Fit: printer selector | Pending |
| Custom X/Y/Z volume | Fit: editable dimensions | Pending |
| Margin, nozzle, minimum piece size | Fit: Advanced | Pending |
| Press, glue, slip, snap, seam radial fit clearances | Fit: Advanced → clearances | Pending |
| Persist and restore settings; explicit reset to defaults | Fit: restored note + Reset | Pending |
| Auto split; all 13 joint-style presets | Split: automatic planning; Join: style selector | Pending |
| Fewer parts ↔ less support weight; pending-change warning | Split: three intent choices + Advanced precise slider | Pending |
| Keep upright / allow tilted orientations | Split: Advanced | Pending |
| Plan totals, fit status, warnings, timing, support proxy and prior comparison | Split: result summary | Pending |
| Select each leaf, dimensions, print face, overhang and warnings | Split: part buttons + inspector | Pending |
| Add X/Y/Z cut through selected part; auto-split oversized part | Split: contextual part inspector | Pending |
| Select each cut; drag gizmo in 3D | Split: cut buttons / canvas selection | Pending |
| Cut offset slider/number, tilt A/B, axis X/Y/Z, Apply/Delete | Split: contextual cut inspector | Pending |
| Auto-complete oversized manual plan | Split: fit warning action | Pending |
| Cut-face list, inline joint map, contact selection | Join: face buttons + map | Pending |
| Joint fallback/single-pin warnings; force style; use seam/keyed peg; back to automatic | Join contact inspector; warnings linked from Split | Pending |
| Distance field visibility, add-kind selector, add-joint mode | Join: editor; Advanced inline controls | Pending |
| Pop-out map; zoom/pan/pinch, fit, dock beside 3D | Join: Zoom & edit | Pending |
| Map select/drag/delete joints, keyboard selection/nudge/add, focus return | Join: accessible editor | Pending |
| Contact area, wall thickness, inscribed diameter, notes | Join: contact inspector | Pending |
| Seam kind/depth/pitch/clearance/male side, Apply; warnings | Join: Advanced / pop-out inspector | Pending |
| Joint type/fit/diameter/depth or size/screw length; male side; keyed shape | Join: selected-joint inspector | Pending |
| Joint clearance/holes/material depth/warnings; Apply/Delete | Join: selected-joint inspector | Pending |
| Build parts; full-original vs simplified source | Export: Build; always-visible source control | Pending |
| Built exploded view; adjustable explode distance | Export: assembled/exploded choice + Advanced slider | Pending |
| Per-part manifold/volume/genus; pins; mating interference/outside/void checks | Export: verification report | Pending |
| Export package; ZIP, assembly HTML, all-parts 3MF, plate 3MF, individual STL | Export: files and downloads | Pending |
| Coupon diameter, start clearance, step, Generate, downloads | Export: Test fit first disclosure | Pending |
| Model/Cuts/Parts/Plates views; orbit/pan/zoom; select cut/joint/part | Persistent viewer toolbar; canvas keyboard alternatives | Pending |
| 1–4 views, Delete selected cut/joint, Esc deselect, A add mode | Focus-scoped viewer/editor shortcuts; documented | Pending |
| Help dialog, licenses, source link, build ID | Header guide/help + footer licenses/build | Pending |

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
