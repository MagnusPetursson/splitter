# Interface copy cleanup: Splitter

Copy-only pass over the app (`web/index.html`, `web/js/*.js`), the guide (`web/guide.html`), `README.md` and `docs/`. No layout, feature or behaviour changes. Rules: buttons, links and menu items are a verb or verb + object in 1–3 words, in the trade's term; headings name the thing or state; helper text is one factual sentence and only where the label cannot carry it.

Evidence: `e2e/copy-check.mjs` drives 14 states at 1440×900 and 13 at 390×844 (the Objects panel is desktop-only), captures every visible control, heading and text block, and fails on a control label over three words or a heading that reads as a tagline. On the build before this pass it reports **127 rule failures**; after it reports **0** (27 states, about 1,800 strings, 759 control labels).

## Totals

Counted as rows in the tables below; a row can cover a set of parallel strings (for example the five "Go to step N" commands), so the number of edited string literals is higher.

| Kind | Rows |
|---|---:|
| Buttons (incl. each state of the footer primary) | 20 |
| Links and disclosures | 11 |
| Command-search items | 19 |
| Headings, page and dialog titles | 13 |
| Helper and intro text | 24 |
| Status, summaries, toasts, announcements | 27 |
| Tooltips and aria-labels | 7 |
| Guide sentences, headings, captions | 17 |
| README and docs | 7 |
| **Total** | **145** |

Tests that asserted old copy were updated to the new copy, not loosened: `design-r2`, `design-r3`, `design-r4`, `design-r3-shots`, `design-r4-shots`, `merge-expert`, `large-mesh`.

## Before → after

### Buttons

| Location | Before | After | Reason |
|---|---|---|---|
| footer, no model | Load a model to continue | Next (disabled) | instruction on a disabled button; the drop zone is the action |
| footer, loading | Preparing model… | Loading… | plain state |
| footer, Fit, turn fits | Turn 90° to fit | Turn 90° | the headline already says it fits after the turn |
| footer, Fit, lay flat fits | Lay on side to fit | Lay on side | same; 3 words |
| footer, Fit, fits as placed | Export as one piece | Export one piece | 3 words |
| footer, Join | Build & prepare downloads | Build and export | 3 words; one term for packaging ("Export") |
| footer, Join, stale build | Rebuild & prepare downloads | Rebuild and export | same |
| footer, Export, built | Prepare downloads | Export files | trade term |
| footer, warnings | Resolve warnings first | Resolve warnings | verb + object |
| footer, pin edits pending | Apply or discard pin edits | Apply pin edits | 3 words; the tooltip keeps "Apply or discard the pin edits first" |
| Export step | Prepare downloads | Export files | trade term; matches footer |
| Join, contact override | Back to automatic (Dowel pins (glue)) | Reset to automatic | 3 words; style name moved to tooltip |
| Join, contact override | Use dowels here anyway | Force dowels | 2 words; tooltip explains the relaxed limits |
| Join, single-pin contact | Use seam here | Use seam | "here" is implied by the card |
| Join, single-pin contact | Use keyed peg here | Use keyed peg | same |
| Load, sample | 320 mm bracket · *A simple first split* | 320 mm bracket | subtitle tagline removed |
| Export, coupon | (summary) Test the fit first · Joint coupon | Joint coupon · Fit test | noun, not advice |
| phone sheet toggle | Why? / Details | Details | one label; no question |
| Split result card | (title) Auto split: N parts | Planned: N parts | the button is "Plan cuts" |
| Load, skip link | Skip to current step | Skip to step | 3 words |

### Links and disclosures

| Location | Before | After | Reason |
|---|---|---|---|
| Load help link | First time? Start here | Getting started | no question; names the guide section |
| Fit help link | How margins and clearances work | Margins and clearances | noun |
| Split help link | Why these cuts? / How cuts are chosen | How splitting works | one label; matches guide chapter |
| Join help link | Choose a joint and calibrate its fit | Choosing joints | matches guide chapter |
| Export help link | Open in your slicer & assemble | Printing and assembly | matches guide chapter |
| load-error help link | How to fix a model | Troubleshooting | 1 word |
| Help dialog | Read the complete guide | Full guide | 2 words |
| Load samples | More sample models | More samples | shorter |
| Join | How joints are placed | Joint placement | noun |
| Join | Select a pin · *Keyboard alternative* | Pin list · *Keyboard selection* | noun |
| Join | Precision map · *Optional 2D view* | Precision map · *2D view* | "optional" is implied by a disclosure |

### Command search (Expert mode, Ctrl K)

| Before | After |
|---|---|
| Go to step 1: Load … Go to step 5: Export | Go to Load … Go to Export (step number moved to the hint column) |
| Open a model file… | Open model… |
| Load sample: bracket 320mm (and three more) | Load 320 mm bracket, Load 300 mm bowl shell, Load 300 mm cube, Load damaged bunny (uses the visible sample names) |
| Plan cuts for Prusa CORE One / One+ | Plan cuts (printer moved to the hint column) |
| Auto-complete the remaining oversized parts | Auto-complete (same as the button) |
| Prepare downloads | Export files |
| Download ZIP package | Download ZIP |
| Generate joint test coupon | Generate coupon |
| Undo plan edit / Redo plan edit | Undo edit / Redo edit |
| Fit model in view | Fit view (same as the button) |
| Show Model/Cuts/Parts/Plates presentation | Show model / cuts / parts / plates |
| Switch to guided mode / Switch to expert mode | Exit expert mode / Enter expert mode |
| Add a pin on the selected cut face | Add pin (same as the button) |
| Printer and clearances | Printer settings |
| Joint style for all contacts | Joint style |
| Open the large joint editor | Open joint editor |
| Reset settings to defaults | Reset defaults (same as the button) |
| Quick help / Open the guide | Help / Open guide |
| reason: Find cuts first · Prepare downloads first | Plan cuts first · Export files first |

### Headings and titles

| Location | Before | After | Reason |
|---|---|---|---|
| `<title>` | Splitter — a model, made printable | Splitter — split a model to fit your printer | says what it does |
| header model title (empty) | A model, made printable. | (empty, as after Remove) | tagline |
| Load | Start with your model. | Model (→ "*name* loaded") | noun |
| Load samples | Or try a sample | Samples | noun |
| Fit, no model | What are you printing on? | Printer fit | rhetorical question |
| Split | Find a good split. | Cuts | noun |
| Join | Make it whole again. | Joints | the brief's main example |
| Export | From model to parts. | Export | noun |
| viewport empty state | Your model appears here | No model loaded | state |
| Help dialog | A short path to printable parts. | Help | tagline |
| Help dialog | Navigate the 3D view / Edit joints / Expert workspace | 3D view / Joint map / Expert mode | nouns that match the UI |
| guide `<title>` | Splitter guide — from one model to printable parts | Splitter guide | tagline |
| guide hero | *Keep the model. Change how you print it.* / A big model. A smaller printer. A clear way through. | *Guide* / Splitter | taglines |

### Helper and intro text

| Location | Before | After |
|---|---|---|
| Load intro | Keep its size. We'll make the pieces fit your printer. | The model keeps its size and is cut into pieces that fit the printer. |
| Load intro, loaded | Original size retained. Replace the file or review its measurements below. | Original size. |
| Fit intro | Checked against usable space. Nothing is scaled. | Model size against the usable build volume. ("Nothing is scaled" stays in the readout) |
| Fit, turn | The turn keeps the size and changes only the footprint on the bed. You can undo it. | Turning keeps the size; only the orientation on the bed changes. (Undo turn is a visible button) |
| Fit, doesn't fit | … Plan cuts proposes cuts and a print orientation for each piece; you review them before anything is built. | … Plan cuts proposes cuts and a print orientation for each piece. |
| Fit, turn alternative | Prefer pieces? Plan cuts anyway | Or split it: Plan cuts anyway |
| Fit, simplified mesh | … See Load for the complete repair and simplification report. | … Full report in Load. |
| Split intro (no plan) | Choose what matters more, then Plan cuts. You review the proposed cuts here before anything is built. | Choose a preference, then Plan cuts. |
| Split intro (planned) | Plan first, build later. Review the suggested cuts; drag the highlighted arrow to move one, or use Tilt cut. | Drag the blue arrow to move a cut, or use Tilt cut. |
| Split intro (whole) | No cut needed: it prints in one piece in the orientation shown. Add a cut only if you want one; otherwise continue. | No cut needed: the model prints in one piece as shown. |
| Split preference | Extra cuts can reduce supports, but mean more assembly. Always check in your slicer. | Extra cuts can reduce support but add assembly work. |
| Split slider ends | Keep it together / Allow extra cuts | Fewer cuts / More cuts |
| Split slider help | A geometric support estimate, not filament volume or print time. Plan cuts again after changing it. | Weights a geometric support estimate, not filament volume or print time. (the pending notice already says "Plan cuts again") |
| Split result card | … Adjust a cut in the view, or regenerate with the current settings. | (sentence removed; the two buttons say it) |
| Split part/cut lists | Parts (click to select, then add a cut through it) / Cuts (click, then drag the arrow in the 3D view or edit below) | Parts / Cuts |
| Split cut editor | Drag the blue arrow in 3D to slide. Choose Tilt cut for rotation arcs. Release to apply; Esc cancels. Precise values provides the keyboard alternative. | Drag the blue arrow to move the cut, or choose Tilt cut to rotate it. Release applies; Esc cancels. |
| Join intro | Joints align the pieces. Review each cut face before building. | Review the joints on each cut face before building. |
| Join label | Join the pieces with | Joint style |
| Join help | Click a pin to select it. Drag it across the cut face. Use Add pin, then click the face to place another. | Click a pin to select it; drag to move it. To add one, choose Add pin, then click the face. |
| Join explainer | … substitutions are explained, not silently accepted. | … each substitution is shown with its reason. |
| Export intro | Build the actual solids, check the result, then download your print package. | Build the solids, review the checks, then download the package. |
| Export spacing | Distance between parts | Part spacing |
| viewport legend | Model outside it | Outside the volume |
| Help dialog body | Loading advances to Fit. The bottom action splits, then builds and packages the checked plan. You can revisit earlier steps at any time; Expert mode opens the detailed settings without starting over. | Loading opens Fit. The button at the bottom runs the next step: plan cuts, then build and export. Use the step bar to go back; Expert mode shows every setting and keeps your work. |

### Status, summaries, toasts and announcements

| Before | After |
|---|---|
| Load a model to begin. (phone summary) | No model loaded. |
| Ready to plan cuts. | No cuts planned. |
| Downloads ready. / Parts built. Prepare downloads. / Changes since last build. Rebuild. / Build parts, then download. | Export ready. / Parts built, not exported. / Plan changed since the last build. / Parts not built. |
| Print package ready. Downloads match the current plan. | Files exported from the current plan. |
| Parts are built from the current plan. Downloads are not prepared yet. | Parts built from the current plan; files not exported yet. |
| Changes since last build. Rebuild to update the parts and downloads. | Plan changed since the last build. Rebuild the parts. |
| Printer settings changed. Return to Split and find cuts again before exporting. | Printer settings changed. Plan cuts again before exporting. |
| Printer settings changed. Recalculate the split. / Find cuts first. | Printer settings changed. Plan cuts again. / Plan cuts first. |
| step tooltips: Recalculate split / Find cuts first | Plan cuts again / Plan cuts first |
| Preference changed. Plan cuts again to apply it; the current plan is unchanged. | Preference changed. Plan cuts again to apply it. |
| … · Ready to build & export. | … · Ready to build. |
| Edit cancelled. Nothing changed. | Edit cancelled. |
| Edit applied · select a pin to inspect its diameter and depth into both pieces. | Edit applied. |
| Inspector: "… Edit it in the pin card below." / "… Add a cut through it below." / "… Joint settings are below." / "… Precise values are below; drag it in the view." | (trailing directions removed; the controls are directly below) |
| Model restored after cancellation. You can try the split again. | Model restored after cancel. |
| Model loaded. Check the dimensions against *printer*, then split. | Model loaded. Fit checked against *printer*. |
| Split ready. N parts. All fit. Continue to Join. | Split ready. N parts. All fit. |
| Plan cuts proposed N parts for your Split preference. Review them, or plan again. | Plan cuts proposed N parts. Review them in Split. |
| Guided mode on. Advanced controls remain available in each step. | Expert mode off. |
| Parts built. Review the geometry checks, then prepare downloads. | Parts built. Review the checks, then export. |
| Downloads ready. The package contains parts, plates and an assembly sheet. | Export ready: parts, plates and assembly sheet. |
| Resolve geometry warnings and build before exporting. | Resolve the warnings and build the parts before exporting. |
| *zip* (everything) | *zip* (all files) |
| The last planning of *file* stopped the tab / … That is almost always the browser running out of memory; a file problem would have shown an explanation instead. | The tab crashed while planning *file* / … ended the tab before it finished, almost certainly by running out of memory (a file problem shows an error instead). |
| … running out would stop the tab without a word. | … running out would crash the tab without an error message. |
| Large-mesh banners: "Auto split ≈ …", "you can cancel it" | "Planning ≈ …", "it can be cancelled" (the button is "Plan cuts") |
| The file itself may be fine: let it simplify the mesh, … | The file may be fine: simplify the mesh, … |

### Tooltips and aria-labels

| Before | After |
|---|---|
| Find any command or object (Ctrl K) | Search commands and objects (Ctrl K) |
| Reveal detailed controls without leaving this step | Show all settings in every step |
| aria-label Quick help · title Quick help and keyboard controls | Help · Help and keyboard controls |
| nav aria-label Split a model in five steps | Steps |
| step `<small>` initial text Your model / Your printer / Find the cuts / Make it whole / Ready to print | Current / Load a model (matches the screen-reader state the script sets) |
| Preview of the selected cut face; use Zoom and edit for keyboard controls | Map of the selected cut face; Zoom & edit has keyboard controls |
| footer tooltip, one piece: … build the single part and prepare downloads | … build the part and export the files |

### Guide (`web/guide.html`)

| Before | After |
|---|---|
| Loading advances to Fit. Return to Load for the loaded-model summary, repair report, Replace or Remove. | Loading opens Fit. Load shows the model summary and repair report, with Replace and Remove. |
| The primary action finds cuts and advances to Join when all parts fit. … Balanced is the starting preference. | **Plan cuts** plans the cuts and opens Join when all parts fit. … The default preference is Balanced. |
| Start with glued dowel pins. … Use Face-on view to isolate the section. | The default is glued dowel pins. … Face-on view isolates the section. |
| Choose Build & prepare downloads at Join, then save the ZIP. The separate Build and Prepare controls remain available in Export. | Choose Build and export at Join, then download the ZIP. Export also has separate Build parts and Export files buttons. |
| The bottom action does the next meaningful job; there are no empty Continue confirmations on the simple path. … Done/current/upcoming/blocked states explain what is available. Expert mode opens the detailed controls in every step without discarding your work. | The button at the bottom runs the next step. Use the numbered steps to go back; each shows whether it is done, current, available or blocked. Expert mode opens every Advanced section and keeps your work. |
| The view comes first | Layout |
| Choose Why? or Details … your choice is remembered. | Choose Details … the choice is remembered. |
| … find cuts again before exporting. / … until you find cuts again. | … plan cuts again … |
| Move the cut, not a pile of sliders | Editing cuts |
| Drag for exploration. Use the numeric offset for a reproducible position. | Dragging a cut. For an exact position, type the offset. |
| "Use here anyway" relaxes geometric limits … | **Force** (for example "Force dowels") relaxes the geometric limits … |
| … the inspector and Select a pin list. | … the inspector and the Pin list. |
| Optional precision map | Precision map |
| … it says Changes since last build … never presented as current. | … it says Plan changed since the last build … never shown as current. |
| The combined Build & prepare downloads action performs both jobs … The package download is a separate action, so you choose when to save it. | Build and export does both jobs … Downloading the ZIP is a separate step. |
| Large meshes, without surprises | Large meshes |
| This redesign includes named native controls, … | The app uses named native controls, … |

### README and docs

| File | Before | After |
|---|---|---|
| README | 3. **Auto split.** … / On a fresh **Auto split** … / press Auto split to apply it | **Plan cuts** (the button's name) |
| README | **Your joint style wins.** | **The chosen joint style takes priority.** |
| README | **Substitutions are never silent.** | **Substitutions are shown.** |
| README | a "use dowels here anyway" action | a "Force dowels" action |
| README | **Reset to defaults** (×2) | **Reset defaults** (the button's name) |
| docs/large-meshes.md | died during Auto split / Auto split shows the cut being searched | … Plan cuts … |
| docs/support-cost-evaluation.md | # Support-aware splitting — evaluation / a pending notice asks for Auto split | # Support-aware splitting: evaluation / … asks for Plan cuts |

## Kept deliberately

- **"Plan cuts anyway"** (3 words, Fit when a turn would fit): "anyway" carries the meaning that cutting is optional here.
- **"Check printer fit"** (footer on Load after a model loads): verb + object, 3 words.
- **"Fits in one piece after a 90° turn"**, **"Doesn't fit: 76.0 mm too wide"**: result headings with numbers, which the rules ask for.
- **Guide FAQ summaries** ("Why does the model look the wrong size?" …): questions are the FAQ convention; they are not control labels or section titles.
- **Safety and data facts**: "Runs entirely in your browser: your model is never uploaded", "Geometric checks are not a physical fit guarantee. Print a test coupon …", the support-proxy caveats, the coupon calibration note and the "does not establish strength" sentences are unchanged in substance.
- **Assembly-sheet text and joint descriptions in Go** (`internal/bundle/sheet.go`, `internal/plan/joints.go`): already instructional and factual.
- **`docs/ux/*`**: design-round records that quote the copy of their time; rewriting them would falsify the record.
- **Allowlisted long labels** in the check: sample names, step number + name, object chips and rows (`P1 · 82 mm`, `C1 · P1↔P2`), joint-substitution rows, file names in the download list, the licence source link, and command rows of the form verb + generated object name ("Select C1 · P1↔P2"). These are generated names or data, not prose.
