# Large meshes

splitter runs entirely in the browser: the planner is Go compiled to
WebAssembly and the solids are cut by Manifold (also WebAssembly). Both
share one tab, and a tab gets a few gigabytes at most. This page lists
what that means for big models, what the app does about it, and the
numbers behind the choices. All figures were measured on a desktop PC
(Chrome headless and Node, the same `.wasm` file) with a 226k-triangle
helmet, its 4× and 16× subdivisions (905k and 3.6M triangles) and two
copies of the 905k mesh (1.8M).

## Limits

| | |
|---|---|
| File size | 300 MB (any format) |
| Planned on directly | up to 600k triangles |
| Simplified for planning | above 600k triangles, to ≤ 400k |
| Exports cut from the full-detail original | up to 1.5M triangles |
| Refused before loading | estimated peak memory above 3 GB |

Before reading a file the app estimates its triangle count (exact for
binary STL, from the header) and the memory it will need. If that is more
than a tab can reliably get, it says so and offers to simplify instead of
starting work that would end with a dead tab. All limits can be
overridden for testing with
`localStorage['ps.limits'] = '{"threshold": 300000}'` (keys: `threshold`,
`target`, `maxError`, `keepOriginal`, `warnMB`, `refuseMB`).

## Why memory ran out

On WebAssembly the Go runtime has a single thread. While a call from
JavaScript runs (loading, planning), the collector's background workers
never get scheduled, so garbage collection cycles do not finish and the
heap grows until the call returns. Measured before the fix:

| | wasm memory |
|---|---|
| plan 226k triangles | 1.8 GB (live data ≈ 0.2 GB) |
| load 3.6M triangles | 3.7 GB, then the tab died |
| plan 1.8M triangles | the tab died during Plan cuts |

The planner now runs a blocking collection at checkpoints (every progress
step, at most every 0.75 s, and between repair stages). It also keeps
less: per-normal slice caches hold one value per vertex instead of three
per triangle and are bounded (64 MB, least recently used), and the
support estimate refers to unclipped triangles by index instead of
copying them. After:

| | wasm memory | time |
|---|---|---|
| plan 226k (full detail) | 232 MB | 43 s |
| load 905k (full detail) | 881 MB | 6 s |
| plan 905k (full detail) | 396 MB peak | 117 s |
| load 3.6M → simplify to 400k | 1.07 GB | 66 s |
| plan that 400k mesh | 1.07 GB (no growth) | 65 s |
| 1.8M (two 905k helmets) → 400k, plan, build | 1.0 GB planner; 3.95 GB whole tab when building from the 1.8M original (why that limit is now 1.5M) | 36 s load, 114 s plan (8 parts), 18 s build |

Native (`print-splitter plan`) on the 905k helmet went from 763 MB to
401 MB peak RSS and from 82 s to 63 s, with an identical plan.

## Simplification

Meshes above the threshold are simplified before planning with quadric
edge collapse (Garland–Heckbert). A collapse is only made if it keeps the
surface a closed 2-manifold (its endpoints share exactly two neighbours)
and flips no triangle, so the result stays watertight and keeps every
shell; if it somehow does not, the full mesh is kept and the app says so.
Collapses stop at the target triangle count or when the next one would
move the surface by more than 0.05 mm (quadric estimate), whichever comes
first.

The deviation is then measured, not estimated: up to 100,000 vertices of
each mesh are projected onto the nearest point of the other (both
directions) and the maximum, mean and RMS distances are reported in the
banner. Vertex sampling can miss the exact maximum inside a large
triangle, so the maximum is a measurement, not a bound.

| model | triangles | max deviation | mean | time (browser) |
|---|---|---|---|---|
| helmet ×16 | 3.62M → 400k | 0.035 mm | 0.0005 mm | 39 s |
| two helmets ×4 | 1.81M → 400k | 0.086 mm | 0.0015 mm | 20 s |
| bumpy torus (e2e) | 720k → 400k | 0.003 mm | 0.0006 mm | 8 s |
| helmet ×4 (native) | 905k → 400k | 0.033 mm | 0.0003 mm | 1.4 s |

For comparison, a 0.4 mm nozzle lays 0.4–0.45 mm lines at 0.1–0.3 mm
layers; printers position to about ±0.05 mm.

### What uses which mesh

* **Planning** (cut search, cut faces, joint placement) uses the
  simplified mesh.
* **The 3D view** shows the simplified mesh.
* **Building and export** (step 5) cut the **full-detail original** with
  the same planes and joints when it has at most 1.5M triangles ("Cut parts
  from the full-detail original", on by default). Above that the original
  is not kept, and the app states that exports come from the simplified
  mesh. Manifold needs about 1 kB per triangle to cut a mesh: cutting the
  3.6M original took 3.7 GB on top of the planner (1.8M: 2.9 GB), which is
  why the limit is 1.5M.
* Above 1.2M triangles in the geometry kernel, the post-build checks look
  for interference only within 40 mm of each cut (where the joints are)
  and skip the whole-model void/outside volumes, which took more than
  seven minutes and 5 GB at 3.6M triangles.

**Use full detail** reloads the file without simplification after
confirming the estimated time and memory. If the browser runs out
anyway, the tab dies; the app leaves a note before heavy steps, so the
next visit explains that the tab stopped during loading or planning and
that this was almost certainly memory, not the file.

## Progress, time estimates and cancel

Loading shows its stages (read, parse, repair, simplify, measure, index,
geometry kernel); Plan cuts shows the cut being searched ("Cut 2 of ~3"),
the candidate planes evaluated and support checks done for that cut, then
cut-face analysis and joint placement, with elapsed and estimated
remaining time. Estimates come from the measurements above (≈ 0.1 ms per
triangle per plan in the browser plus ~15 s), and the remaining time
from progress so far.

**Cancel** ends the planner's worker (the Go runtime cannot be interrupted
from inside a call); the model is then reloaded from the file you chose,
so you can change settings and try again. The same happens if the planner
runs out of memory.

## Two different refusals

* **"… is not a closed solid"**: the file's surface has holes that could
  not be capped, edges shared by more than two faces, or inconsistent
  winding. The message gives the counts and what the repair already did.
  This is a problem with the file; fix it in a modeller or slicer.
* **"Out of memory" / "… is too large for this browser tab"**: the file
  may be fine. Simplify it (the default), reduce it beforehand, or use the
  command-line planner, which has no browser limit:
  `print-splitter plan -printer bambu-a1-mini model.stl > plan.json`.

## Reproducing the measurements

    GOOS=js GOARCH=wasm go build -o web/wasm/splitter.wasm ./cmd/splitter-wasm
    node tools/wasm-mem.mjs model.stl '{"simplify":"off"}' plan
    node tools/wasm-mem.mjs model.stl '{"simplify":"auto","threshold":600000,"target":400000,"maxError":0.05}'
    node e2e/large-mesh.mjs http://127.0.0.1:8765/
