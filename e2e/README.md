# Browser verification

Install the pinned development-only dependencies and Chromium:

```sh
npm ci --prefix e2e
npm exec --prefix e2e -- playwright install chromium
scripts/build-static.sh site
python3 -m http.server 8792 --bind 127.0.0.1 --directory site
```

In a second shell, from the repository root:

```sh
URL=http://127.0.0.1:8792/
go test -count=1 ./...
go vet ./...
node e2e/guided-flow.mjs "$URL" evidence/flow
node e2e/round2-editing.mjs "$URL" evidence/direct
node e2e/round2-touch.mjs "$URL" evidence/touch
node e2e/ux-audit.mjs "$URL" evidence/audit
node e2e/interactions.mjs "$URL" evidence/interactions
node e2e/expert-controls.mjs "$URL" evidence/expert
node e2e/smoke.mjs "$URL" bracket_320mm.stl prusa-mini evidence/smoke
node e2e/joints.mjs "$URL" evidence/joints
node e2e/mobile-ui.mjs "$URL" evidence/mobile
node e2e/support.mjs "$URL" web/samples/bowl_shell_300mm.stl evidence/support prusa-mini
node e2e/large-mesh.mjs "$URL" evidence/large
```

`round2-editing` exercises actual pin drag/add/delete, individual fit settings, rejected edge placement, history, cut arc rotation/cancellation and exploded part picking. `round2-touch` uses real Chromium touch events and guards against building unapplied pin drafts. `guided-flow` activates controls using real Tab/Enter events, without `.focus()` or scripted clicks. It downloads and checks a ZIP. `ux-audit` scans desktop/phone steps, expert states, help/licenses, expanded 3D and the joint dialog with axe, and checks 44 px targets and overflow. `interactions` actually drags the 3D gizmo, moves the camera with keys, nudges/pans joints, downloads a coupon and checks the guide. Supply an optional third argument (a model path) to run that model through load/plan/build/export without saving its geometry into the repository.

`expert-controls` exercises scale, custom volumes, fit inputs, all thirteen joint presets, manual/deleted cuts, deleted joints, auto-completion and explosion. `mobile-ui` measures actual contact-label bounds and pointer hits, keyboard contact selection and the detailed support slider. `large-mesh` generates its own 720k-triangle torus and broken input, then tests simplification, measured deviation, cancellation/restoration, pop-out editing, full-detail build and phone layout.

The support comparison needs a model/printer combination where extra cuts actually help: the supplied bowl on a Prusa MINI is the standard regression. Equal results on another model/printer are not an algorithm failure.

An existing browser installation can be used with `SPLITTER_PLAYWRIGHT` pointing to its Playwright module. `SPLITTER_AXE` optionally points to an axe script. The default is the pinned local installation. The browser launches with software WebGL (`--use-angle=swiftshader --enable-unsafe-swiftshader`) for repeatable headless rendering.

All output goes to the requested ignored evidence directory. Never place private model files in the repository. The guide screenshots use only shipped samples. Automated accessibility results are not a full WCAG conformance certification.
