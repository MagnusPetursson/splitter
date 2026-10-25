# splitter

**Split a 3D model that is too big for your printer into parts that fit, with joints on every cut face, and export print-ready plates and an assembly sheet.**

**Live:** <https://magnusp.is/splitter/>. It runs entirely in your browser. Your model is never uploaded.

![Exploded view of a 300 mm bowl split into four parts for a 180 mm printer, joined by finger seams](docs/built.png)

## What it does

1. **Load** an STL (binary or ASCII), OBJ or 3MF up to 300 MB. The mesh is welded and repaired: holes are capped, flipped and inside-out faces are fixed, duplicate and degenerate faces are removed, non-manifold edges are split and debris is dropped. Each repair is counted in the UI.
2. **Choose a printer** (Prusa, Bambu Lab, Creality, Voron presets, or a custom volume) and a safety margin.
3. **Auto split.** A BSP search over cut planes finds the fewest parts that fit in some print orientation. You can move, tilt, delete or add cuts. **Auto-complete** then splits only the parts that still do not fit.
4. **Joints.** Every cut face is analysed, and joints are placed where the wall can hold them. You can edit them on a 2D joint map.
5. **Build** every part as a closed manifold solid with the [Manifold](https://github.com/elalish/manifold) kernel. The interference between mating parts is checked.
6. **Export** a zip: oriented STLs, one 3MF per print plate, an all-plates 3MF, an assembled preview, an HTML assembly sheet, `plan.json` and a per-part report.

![Cut planning: the bowl with its cut planes and the joint map for a ring-shaped section](docs/plan.png)

## Joint placement

- Each cut face is rasterised and split into **contact patches**, one for each pair of parts that touch there.
- A Euclidean distance transform of each patch gives the largest inscribed circle at every point. Its ridge is the medial axis, and the typical ridge value gives the wall thickness.
- A point joint may sit only where the distance is at least joint radius + clearance + minimum wall. The minimum wall is 2 × nozzle × 1.05 and never below 1.2 mm. This stops a joint from breaking through a visible surface.
- **Depth** comes from ray casts into both parts from the centre and 8 rim points. Pins get shorter (down to 4 mm per side), or move elsewhere.
- Joints are spread by farthest-point sampling: at least 2 per patch so parts cannot rotate, and 3–4 on large faces.
- **Thin shells** are ring-shaped sections whose wall is thinner than 3 × the minimum wall. They get a seam joint around the whole wall, such as a finger joint, instead of a few pins.
- Integrated pegs and seams go on the part that does **not** print on that face, so the face stays flat on the bed. Horizontal holes get teardrop roofs, and horizontal pegs get a flat underside.

| | Glued | Unglued |
|---|---|---|
| **Point joints** | dowel pin (printed separately; glue groove; vented flat) · Ø1.75 mm filament pin · integrated peg · keyed hex/D peg | press-fit pin · magnet pockets (Ø5/6/8/10 × 2–3 mm) · heat-set insert + screw (M2.5–M5) · bolt + hex nut trap · cantilever snap clip |
| **Seam joints** | finger/box joint · tongue & groove · half lap | sliding dovetail |

Clearances are radial, per side, and editable. The defaults for a 0.4 mm nozzle are: press 0.05, glue 0.15, slip 0.20, snap 0.25, seam 0.15 mm. A 0.6 mm nozzle adds 0.05 mm.

## Limits and caveats

- **Physical fit is untested until you print the coupon.** The clearances are geometric. Your printer, filament and slicer decide the real fit. Step 5 generates a **joint test coupon** with six graded clearances. Print it first, then enter the loosest step that still holds.
- **Support material is not yet included** in the cost when choosing cuts and orientations. "Allow tilted" can save parts but usually adds support.
- No STEP import. The 3MF files contain geometry only, with no slicer profiles.
- Very large meshes (millions of triangles) are slow in the browser and use a lot of memory.
- Cut planning is a heuristic search. It does not guarantee the global optimum, and on strongly curved shells it may need a manual cut.

## How it works

```
model file ─► Go (WebAssembly, Web Worker): parse, weld, repair ─► plan cuts ─► analyse cut faces, place joints, orient parts
                                                                          │ plan JSON
            Manifold (WebAssembly, second Web Worker): build every part ◄─┘
                                                                          │ part meshes
            Go (WebAssembly): orient + pack plates, write STL / 3MF / assembly sheet / zip ◄─┘
```

The planner is plain Go with no third-party modules. It is compiled with the standard toolchain (`GOOS=js GOARCH=wasm`). The same code also runs as a normal HTTP server (`splitter serve`) if you prefer to self-host the processing.

## Build and run

Requires Go 1.27 or newer (see `go.mod`).

```sh
# static, fully client-side site → ./site (serve it from any static host, sub-paths work)
scripts/build-static.sh site
python3 -m http.server -d site 8000        # http://localhost:8000/

# or: server mode (same UI, processing on the server)
go build -o bin/splitter ./cmd/print-splitter
bin/splitter serve -addr 127.0.0.1:8097    # http://127.0.0.1:8097/

# CLI planning only
bin/splitter plan -printer prusa-mini -style glued model.stl > plan.json
```

The static site serves `.wasm` files. Most hosts send them as `application/wasm`, and the loader falls back if they do not.

Tests: `go test ./...`. Browser smoke test (Playwright): `node e2e/smoke.mjs http://localhost:8000/ bracket_320mm.stl prusa-mini`.

Sample models in `web/samples/`:
- the bracket and bowl are generated by `tools/make_samples.mjs`;
- the cube is generated;
- `bunny_damaged.stl` is the Stanford Bunny scaled to 260 mm with holes, flipped, duplicate and degenerate faces added, to exercise mesh repair.

## Licence

MIT, see [LICENSE](LICENSE). Third-party components (Manifold, three.js, Go's `wasm_exec.js`, Stanford Bunny) are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
