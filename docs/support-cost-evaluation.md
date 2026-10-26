# Support-aware splitting — evaluation


## Result

The real TF2 shell now chooses **three fitting parts rather than one** at the Balanced default. Independent slicing—not a conversion from the geometric proxy—predicts **56% less total filament and 39% less printing time** for this case.

| Same shell, CORE One | Parts-first / legacy | Balanced / new default |
|---|---:|---:|
| Shell parts | 1 | 3 |
| Loose pins | 0 | 2 |
| Geometric support proxy | 2,402.8 cm³ | 133.0 cm³ |
| PrusaSlicer time, summed per object | 22 h 51 min 56 s | 13 h 58 min 29 s |
| PrusaSlicer total filament, pins included | 627.53 g | 275.49 g |
| Exported parts fit | yes | yes |
| Closed-manifold shell parts | 1/1 | 3/3 |
| Packed export plates | 1 | 2 |

**Conditions:** PrusaSlicer 2.9.6; Prusa CORE One 0.4 nozzle; `0.20mm STRUCTURAL @COREONE 0.4`; `Generic PLA @COREONE`; automatic supports enabled, allowed on both build plate and model. Both runs use the same resolved vendor presets. Each exported, print-oriented STL was sliced independently; the new total includes two instances of the loose pin. These are **summed object estimates**, not a timing measurement for the two packed plates and not a physical print.

The historical 17.5 h / 369 g three-part MINI-derived plan was a different cut/joint layout. It is not relabelled as the new plan here. The old one-piece result was freshly reproduced.

Fixture SHA-256: `c22e015cb086555b34517031b00082e829c389cf16018a98b39ce16bb8c05db6` (`hat_tf2_v2.stl`, 214,596 triangles). The zero-weight plan's orientation, extents and part count also match the actual baseline executable, not merely a renamed configuration of the new algorithm.

## What changed

- A 40 × 40 support raster for each signed orientation: downward faces steeper than 45°, weighted by face area and height above the bed. It clips original triangles to the BSP cell, includes cut caps with holes, unions overlapping columns, and excludes bed contact within 0.6 mm.
- Both cut ranking and print-orientation selection use the proxy. Fit is a separate gate. Required fit cuts precede optional support cuts; a fitting piece can now be split when savings outweigh the extra part/seam cost.
- Bounded candidate search: up to five offset bands per normal, at most 30 shortlisted cuts. Representative hulls rank orientations, then exact hulls confirm feasibility.
- **Fewer parts ↔ Less support** slider, Balanced default `0.5`. Zero retains the original parts-first objective; the far-right endpoint still charges for additional parts. The API clamps the weight, and the CLI supports `-support-weight`.
- Per-part `supportVolume` in mm³; UI aggregate in cm³, explicitly labelled a **proxy**. Consecutive auto plans show the previous part count/proxy when the other settings are unchanged.
- Preference persists, including zero. Reset restores Balanced. Changing the slider does not replace cuts silently; a pending notice asks for Auto split. Manual trees and Auto-complete do not gain support-only cuts. Keep upright remains authoritative.

The default's proxy penalty is 100 score units per 100 cm³ saved, versus 100 per extra estimated part, before seam penalties. The weight enters quadratically. This calibration is inspectable in `supportCost`, not trained on invented material data.

## Verification

### Tests-first and analytic geometry

The committed regression (`cfd5065`) failed before implementation because the fitting shell remained in one support-heavy piece. Cube and bracket tests also exposed the absent per-part proxy. That original regression file is unchanged after the red commit.

- **Behaviour protected:** a fitting but support-heavy shell can split; support-light cubes/brackets stay whole; exports keep fitting.
- **Plausible regression:** restoring the unconditional `if fits { continue }` or dropping the support term turns the shell regression red.
- **Why prior tests missed it:** existing tests exercised bed-fit splitting and orientation sanity, not support savings on an already-fitting part.
- **Production seam:** request JSON and normal planner entry point; no test-only production flag/export.

Additional independent tests cover known ceiling area × height, clipping big triangles, angled cap contributions, cap holes, strict 45°, bed contact, signed normals, translation, cubic scale, overlapping-column union, default/invalid weights, manual-tree preservation, upright and part limit. A correctly wound cavity fixture is built independently: the existing repair helper reorients disconnected inner shells as solids and must not serve as the analytic oracle.

Fresh checks:

- `go test -count=1 ./...` — pass.
- `go test -race -count=1 ./...` — pass.
- `go vet ./...`, JS syntax, `git diff --check` — pass.
- `e2e/wasm-plan.mjs` — actual dense-mesh worker returns complete plans at zero and default weight.
- `e2e/support.mjs` — passed locally and again against the deployed HTTPS preview: load, settings restore/reset, old/new planning, manifold builds, ZIP exports, desktop screenshots, real phone-sized slider pointer action and pending notice, no page/console errors.
- Existing bracket build/export smoke — pass.
- Existing joint-selection smoke — pass with `supportWeight=0` to preserve its original contact geometry. The new default deliberately changes the bowl cuts; the old test's “force this specific dowel” assumption did not apply to a different, shallow contact. Its assertion was not weakened. The new default has separate full-stack coverage.
- Deployment readback — index, JS and WASM hashes match local static output; HTTPS index matches byte-for-byte.

### Secondary geometry checks

- Analytic cavity: default produces two fitting open halves with zero proxy; original intact ceiling is 576,000 mm³ by independent area × height calculation.
- Small bracket and 100 mm cube: stay one part at weights 0, 0.5 and 1.
- Shipped bowl, CORE One: remains three parts, ≈13.0 cm³ proxy at both endpoints tested.
- Shipped bowl, MINI: four parts / 433.1 cm³ at zero → six parts / 88.0 cm³ at Balanced. More assembly is an intentional tradeoff, not a universal improvement claim.

### Runtime

On this host, the real shell's native default plan took about 21 s; deployed Chromium/WASM took 44.0 s. The zero-weight browser plan took 1.2 s. The support-aware search runs in a worker, but it is materially more expensive. The exact-hull shortlist roughly halved the initial native implementation's runtime without changing the selected plan.

## Evidence and reproduction

Task workspace record (not committed because it includes local fixture/export/G-code data): `evidence/support-cost/`.

- `red.log`, `green.log`, `support-tests.log`, `final-tests.log`, `final-race.log`.
- `hat-baseline.json`, `hat-old.json`, `hat-new.json`; `wasm-worker.log`.
- `tailnet/results.json`, `tailnet.log`; desktop `old/new-plan`, `old/new-built`, `old/new-plates` PNGs; `phone-control.png` shows an actual click changing weight to 0.75 while the plan stays unchanged.
- `sliced-old/hat_tf2_v2/slice/results.json` and `sliced-new/hat_tf2_v2/slice/results.json`: raw slicer time/mass fields, input hashes and vendor preset hash. G-code and process logs are alongside them.
- `comparison.png` and `comparison-data.json`: human-readable comparison and underlying measured data.

```sh
go test -count=1 ./...
scripts/build-static.sh site
# Serve site locally, then:
node e2e/wasm-plan.mjs http://localhost:8000/ path/to/hat_tf2_v2.stl
node e2e/support.mjs http://localhost:8000/ path/to/hat_tf2_v2.stl support-out
# Extract each exported ZIP, then slice with the SAME vendor file:
python3 e2e/slice-support.py extracted/hat_tf2_v2 path/to/PrusaResearch.ini
```

Local MagicDNS resolution failed during this run; the tested HTTPS browser used an explicit host mapping to the observed tailnet IP. This is not evidence of recipient-side DNS failure.

## Remaining work and limits

- Print a joint coupon and inspect supports in the slicer before fabricating. Two interfaces fall back from requested dowels to lap seams; the UI shows the reasons.
- The proxy ignores bridges, support density, support resting on the model, tree supports and joint surfaces. A coarse raster can miss narrow features. It is not a global optimum or an estimate of grams.
- Vision QA found pre-existing phone navbar clipping and overlapping joint-map labels on small contacts. The new support slider is reachable and was exercised at 412 × 915, but the rest of the mobile UI should not be called polished. These follow-ups are in the review card rather than silently broadening this implementation.
- An early unoptimized browser prototype emitted an undefined-JSON error after export/replanning. Its cause was not established; the final isolated-worker test, full local flow and deployed repeat all pass. The review handoff flags this rather than claiming a causal fix proved by the optimization.
