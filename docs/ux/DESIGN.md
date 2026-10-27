# Splitter design pass

This pass works on the merged app (`ux/merge`) and covers readability, aesthetics and interaction polish. It changes no capabilities: every baseline control id remains present and every regression suite still runs.

## 1. Audit (before any code changes)

Method. I captured 43 contract states with `e2e/merge-expert.mjs`, which covers both modes, every step, dialogs, the palette, editing and the phone layout. I captured 24 more with the new `e2e/design-shots.mjs`: the empty state, load errors, loading and planning progress on the 226k-triangle private helmet, tilt mode, toasts, the precision map, the joint editor and the guide. Viewports were 1440×900 and 390×844. I critiqued each state against a written rubric covering type, spacing, colour, icons, chrome, scene and state design, then confirmed the findings against the CSS. Severity: **H** means it hurts comprehension or trust, **M** means it is visibly unprofessional, **L** means polish.

### 1.1 Visual system

| # | Problem (evidence) | Sev | Fix |
|---|---|---|---|
| V1 | Three stacked stylesheets (`app.css` → `flow.css` → `merge.css`) define two palettes. The blue/orange base is overridden by mint, and a "round two" block re-overrides sizes. There are **22 distinct fixed-pixel font sizes from 9 px to 34 px**, and **115 distinct hex colours** outside `:root`. | H | One token file (`tokens.css`) for colour roles, a 6-step app type scale, a 4 px spacing grid, radii, elevation and motion. Rewrite one-off values to tokens. |
| V2 | Body text is 13–14 px, but metadata goes down to 9–11 px: the brand note, view caption, phone step labels, joint-editor keys and phone HUD. | H | 12 px is the floor for metadata and 14 px for body. Mono is used only for numbers and keys. |
| V3 | Muted text `#b3c3c0` is fine, but the inactive tabs (`.views button`), disabled step labels, dashed blocked-step rings and the placeholder sit near 3:1. Disabled buttons use `opacity:.48`, which makes text contrast unpredictable. | M | Muted and subtle roles are measured against `--surface-1/2`. Disabled state uses explicit colours, not opacity. |
| V4 | Punctuation is used as icons: `?` help, `↑` upload, `↗` on four links and a button, `×` close, `+`/`−` disclosure, `⚠` warnings, `✓` steps, `←` Back. Glyph sizes and baselines vary by font. | M | One 24-grid, 1.75-stroke SVG icon sprite (`#i-*`), drawn for this app, used everywhere. Warnings and successes get icons in the status colour. |
| V5 | Radii are 3, 4, 5, 6 and 8 px and 50 % at random. Borders range from `#2a3d3f` to `#88ae9e`. Elevation is three ad-hoc shadows. | M | Radii 6 (controls) / 10 (cards, popovers) / 14 (dialogs). One border role plus a strong variant. Two elevation levels. |
| V6 | The focus ring is a 3 px light-mint outline with offset 3. It is good, but `.drop` and the palette use different rings. | L | One `--focus` ring token, used everywhere. |
| V7 | Secondary buttons, tool buttons, the view tabs and the `Expert mode` toggle all share one bordered style. Primary mint is also used for "pressed" tools and for the Expert toggle, so it stops meaning "the next action". | H | Button roles: **primary** (mint fill, once per view), **secondary** (surface + border), **tertiary/ghost** (no border), **destructive** (red text, red border on hover), **toggle** (pressed = accent tint + accent text, never the primary fill). Expert becomes a labelled switch. |

### 1.2 Layout, chrome and states

| # | Problem | Sev | Fix |
|---|---|---|---|
| L1 | Desktop chrome: a 60 px header plus a 66 px step bar, where each step shows a number, a title and a subtitle, plus a 74 px footer. That is 200 px before any content. The subtitles ("Your printer", "Make it whole") repeat the panel heading. | M | Header 56, step bar 52 (one line: number + label; the subtitle becomes the tooltip), footer 72. |
| L2 | Phone: header 52 + steps 58 + view bar 48 + peek row + 68 footer. In Expert cut mode there are **five stacked control bands**, and about 40 % of the height is chrome. | H | Phone header 48 with icon-only Guide and Help. Steps 52. View actions become icon buttons. Preserve 44 px targets and two rows for Expert mode: collapsing both into one row would violate the touch-target or readability bar. |
| L3 | The empty state repeats its heading twice: "Start with your model." in the panel and "Your model belongs here" in the viewport. On the phone, "bracket.We'll" loses its space, and the primary footer button says "Choose a model first" while disabled. | M | One quiet viewport placeholder: an icon, one heading, one line. Keep the working upload and sample actions in the adjacent panel (below on phones), rather than duplicate them. Shorten the empty phone viewport. The disabled footer reads "Load a model to continue" ("Preparing model…" during loading). |
| L4 | Loading: the progress card floats under the view corner, the filename is the headline, the stage chips look clickable, and "Index"/"Kernel" are implementation words. The empty-state copy stays visible behind it. | H | Centred in the stage. Title "Preparing model" / "Planning cuts", with the file as secondary text. The stepper uses check, spinner and dot markers. Stages are renamed (Read, Parse, Repair, Simplify, Measure, Index → "Prepare", Kernel → "Build solid"). The empty state is hidden while busy. |
| L5 | Errors: an unclosed or garbage file produces a small red-outlined toast far from the upload ("nothing printable remained after repair"). There is no file name and no recovery action. | H | Load failures render an error card in the Load panel with an icon, a heading naming the file, a plain cause and actions (**Choose a file**, **How to fix a model**). The toast keeps only transient errors and gets an icon plus an error surface. |
| L6 | Toasts are pill-like text on a dark field with a thin red border. Success and error differ only by border colour. | M | Toast = elevated surface-3 card + status icon + message. Error adds a red left rule. Placed bottom-centre above the footer. |
| L7 | Export success is spread across "Downloads match the current plan", "all closed, all fit", a viewport banner and an "Export ready" pill, and "3 files on 2 plate(s)" is ambiguous. | M | The output state becomes a success banner with an icon and one sentence. Plural-aware counts. The verification table gets column headers. |
| L8 | The command palette has a heavy input outline plus an outlined selected row, a 60 px footer for one Close button, and no keyboard legend. | M | Filled selection, no outline. Footer legend `↑↓ navigate · ↵ run · Esc close` (keys as `kbd`). |
| L9 | The joint editor's 9 px key legend and `+ Add joint` / `✓ Adding…` glyph labels. | L | 12 px legend; icon + label. |

### 1.3 3D scene

| # | Problem | Sev | Fix |
|---|---|---|---|
| S1 | The model is flat grey-blue (`#b8c4cf`, roughness 0.62) under a hemisphere + sun + camera light. It has no grounding: it floats over a solid navy plate with a grid. | H | Warm neutral material, three-point lighting (key / fill / rim), a soft radial contact shadow under the model footprint, and a subtle vertical background gradient. |
| S2 | Build volume: all 12 edges are drawn at 0.8 opacity in saturated `#3fa7e0`, the plate is a 45 % navy fill, and grid lines are dense (10 mm). The volume competes with the model. | H | Edges at 0.55 with **rear edges dimmed** (depth-faded, view-dependent). Lighter plate tint, 10 mm minor / 50 mm major grid at low contrast, and a bed outline. |
| S3 | Part colours are a saturated rainbow (orange `#e07a3f`, blue `#3fa7e0`, …) inherited from the old palette. They clash with the mint UI and look "toy". | M | A 12-colour palette tuned to the dark-mint UI (desaturated, equal lightness), so parts read as identification, not warning. Part swatches in the UI use the same values. |
| S4 | Fit annotations: dimension lines in light grey with thick text halos, plus over-size lines in pink. Busy around the model. | M | Thinner lines (1 px), smaller arrowheads, 12 px tabular labels on a rounded backing. Only the over-size axis is emphasised. |
| S5 | Cut plane: the selected and unselected cuts differ only by quad opacity (0.20 vs 0.035) and rim opacity, and hover has no distinct state. | M | Three states: inactive (faint rim, no fill), hover (rim brightens), selected (fill + accent rim + pivot). |
| S6 | The pin badge is a 28 px yellow disc with a long dashed leader to the sidebar. | L | Keep the badge (it is the selected-pin anchor) and tone the leader down (shorter dash, 0.6 opacity). |

### 1.4 Readability and copy

| # | Problem | Sev | Fix |
|---|---|---|---|
| R1 | The Fit step stacks an intro, a verdict, a W × D × H readout with three lines of small text, the printer source and a two-line legend. | M | Verdict as a status line with an icon. The readout becomes a three-column metric grid (W / D / H, mm). Legend as inline keys. |
| R2 | Mixed capitalisation and terminology: "Build & prepare downloads", "Plan cuts for …", "Export ready", "Precision map", "Expert mode". The disabled primary says "Choose a model first". | L | Sentence case throughout. The primary always names the next step ("Check fit", "Plan cuts", "Review joints", "Build parts", "Download ZIP"). |
| R3 | "2 plate(s)", "≈" before every support number, "−/+ side" in the pin depth figure. | L | Plural-aware counts. |
| R4 | Guide: 64 px hero, 820 px prose measure, 13 px navigation and no active-section marker. | M | Hero 40 px, a 68 ch measure, a 14 px nav with a current-section marker (scroll-spy), and screenshots regenerated from this build. |

## 2. Decisions

The token system is recorded in `web/css/tokens.css`, and each fix above is tagged in the commit history. Behavioural changes are listed in §4.
