package bundle

import (
	"fmt"
	"html"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/MagnusPetursson/splitter/internal/plan"
)

var palette = []string{"#e07a3f", "#3fa7e0", "#7bc96f", "#c96fb8", "#e0c23f", "#6f8fc9", "#c9786f", "#4fc9b0", "#a3a3e0", "#e09f9f", "#9fe0c6", "#d4a373"}

func partColor(i int) string { return palette[i%len(palette)] }

var kindLabel = map[string]string{
	"dowel": "dowel pin", "press": "press-fit pin", "filament": "Ø1.75 filament pin", "peg": "peg", "keyed": "keyed peg",
	"magnet": "magnet pockets", "insert": "heat-set insert + screw", "bolt": "bolt + nut", "snap": "snap clip",
	"finger": "finger joint", "tongue": "tongue & groove", "lap": "half lap", "dovetail": "sliding dovetail",
}

func renderSheet(name string, pl *plan.Plan, res *ExportResult, bed plan.Bed, snapshot []byte) string {
	var b strings.Builder
	e := html.EscapeString
	w := func(f string, a ...any) { fmt.Fprintf(&b, f, a...) }
	leafIdx := map[int]int{}
	leafLabel := map[int]string{}
	for i, l := range pl.Leaves {
		leafIdx[l.ID] = i
		leafLabel[l.ID] = l.Label
	}
	w(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>%s — assembly sheet</title><style>
:root{--ink:#1d232b;--mute:#5b6673;--line:#d9dee4;--acc:#e07a3f}
*{box-sizing:border-box}body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);margin:0;background:#f4f6f8}
main{max-width:1050px;margin:0 auto;padding:28px 32px 60px;background:#fff}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:30px 0 10px;border-bottom:2px solid var(--acc);padding-bottom:4px}
h3{font-size:15px;margin:18px 0 6px}.mute{color:var(--mute)}table{border-collapse:collapse;width:100%%;margin:6px 0}
th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}th{background:#f0f3f6;font-weight:600}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;margin-right:6px}
.note{background:#fff6ec;border-left:4px solid var(--acc);padding:10px 14px;margin:12px 0}
.warn{color:#a4461b}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px}.small{font-size:12px}
.card{border:1px solid var(--line);border-radius:8px;padding:10px}.card svg{width:100%%;height:auto;background:#fafbfc;border-radius:6px}
img.hero{width:100%%;border-radius:8px;border:1px solid var(--line)}ol li{margin:4px 0}code{background:#f0f3f6;padding:1px 4px;border-radius:3px}
@media print{body{background:#fff}main{padding:0}h2{break-after:avoid}.card,tr{break-inside:avoid}}
</style></head><body><main>`, e(name))
	nPins := 0
	for _, p := range pl.Pins {
		if p.Print {
			nPins += p.Count
		}
	}
	extra := ""
	if nPins > 0 {
		extra = fmt.Sprintf(" + %d printed pin%s", nPins, plural(nPins))
	}
	w(`<h1>%s — assembly sheet</h1><div class="mute">print-splitter · %s · usable build volume %.0f × %.0f × %.0f mm · %d main part%s%s on %d plate%s</div>`,
		e(name), time.Now().UTC().Format("2006-01-02 15:04 UTC"), bed.X, bed.Y, bed.Z, len(pl.Leaves), plural(len(pl.Leaves)), extra, res.Plates, plural(res.Plates))
	if len(snapshot) > 0 {
		w(`<p><img class="hero" src="%s" alt="exploded view"></p>`, dataURI(snapshot))
	}
	w(`<div class="note"><b>Physical fit is untested until printed.</b> Clearances below are starting values (radial, per side). Print the joint test coupon (<code>joint-coupon</code> in the app, &lt; 30 min) on the same printer, nozzle and filament first and adjust the fit table if pegs are too tight or loose.</div>`)

	// parts
	w(`<h2>Parts</h2><table><tr><th>Part</th><th>Qty</th><th>Print size (mm)</th><th>Solid volume (each)</th><th>Solid-model PLA, all qty</th><th>Plate</th><th>On the bed</th><th>Mesh closed</th></tr>`)
	totalG := 0.0
	for _, p := range res.Parts {
		col := "#999"
		for _, l := range pl.Leaves {
			if strings.HasPrefix(p.Label, l.Label) && (len(p.Label) == len(l.Label) || p.Label[len(l.Label)] >= 'a') {
				col = partColor(leafIdx[l.ID])
			}
		}
		check := "✓"
		if !p.Closed {
			check = `<span class="warn">not closed</span>`
		}
		if !p.Fits {
			check += ` <span class="warn">does not fit</span>`
		}
		plates := make([]string, 0, len(p.Plate))
		seen := map[int]bool{}
		for _, x := range p.Plate {
			if !seen[x] {
				plates = append(plates, fmt.Sprint(x))
				seen[x] = true
			}
		}
		g := p.VolumeCM3 * 1.24 * float64(p.Count)
		totalG += g
		file := "parts/" + SafeName.ReplaceAllString(p.Label, "_") + ".stl"
		w(`<tr><td><span class="sw" style="background:%s"></span><b>%s</b><br><span class="mute small">%s</span></td><td>%d</td><td>%.1f × %.1f × %.1f</td><td>%.1f cm³</td><td>%.0f g</td><td>%s</td><td>%s</td><td>%s</td></tr>`,
			col, e(p.Label), e(file), p.Count, p.Size[0], p.Size[1], p.Size[2], p.VolumeCM3, g, strings.Join(plates, ", "), e(bedFace(p.Down, pl)), check)
	}
	w(`<tr><td colspan="4"><b>Total</b> <span class="mute">(solid model at 100 %% infill; the slicer's estimate will be lower)</span></td><td><b>%.0f g</b></td><td colspan="3"></td></tr></table>`, totalG)

	// hardware
	if len(pl.Pins) > 0 || len(pl.Hardware) > 0 {
		w(`<h2>Pins and hardware</h2><ul>`)
		for _, p := range pl.Pins {
			if p.Print {
				w(`<li><b>%d ×</b> printed %s Ø%g × %g mm — <code>%s</code> (prints lying on its flat; hole clearance %.2f mm)</li>`, p.Count, e(kindLabel[p.Kind]), p.D, p.Length, e(pinFile(p.D, p.Length)), p.Clear)
			} else {
				w(`<li><b>%d ×</b> 1.75 mm filament cut to %.0f mm (sand the ends)</li>`, p.Count, p.Length)
			}
		}
		for _, h := range pl.Hardware {
			w(`<li>%s</li>`, e(h))
		}
		w(`</ul>`)
	}

	// assembly order: post-order over the tree
	w(`<h2>Assembly order</h2><ol>`)
	patchesByNode := map[int][]*plan.Patch{}
	for _, p := range pl.Patches {
		patchesByNode[p.Node] = append(patchesByNode[p.Node], p)
	}
	jointsByPatch := map[int][]*plan.Joint{}
	for _, j := range pl.Joints {
		jointsByPatch[j.Patch] = append(jointsByPatch[j.Patch], j)
	}
	var group func(id int) []string
	group = func(id int) []string {
		n := pl.Tree.Nodes[id]
		if n.Cut == nil {
			return []string{leafLabel[id]}
		}
		return append(group(n.Neg), group(n.Pos)...)
	}
	var steps []int
	var post func(id int)
	post = func(id int) {
		n := pl.Tree.Nodes[id]
		if n.Cut == nil {
			return
		}
		post(n.Neg)
		post(n.Pos)
		steps = append(steps, id)
	}
	post(pl.Tree.Root)
	for _, id := range steps {
		n := pl.Tree.Nodes[id]
		var desc []string
		for _, p := range patchesByNode[id] {
			cnt := map[string]int{}
			for _, j := range jointsByPatch[p.ID] {
				cnt[kindLabel[j.Kind]]++
			}
			var parts []string
			for k, v := range cnt {
				parts = append(parts, fmt.Sprintf("%d× %s", v, k))
			}
			sort.Strings(parts)
			if p.Seam != nil && p.Seam.Kind != "none" {
				parts = append(parts, kindLabel[p.Seam.Kind])
			}
			if len(parts) == 0 {
				parts = []string{"butt joint"}
			}
			desc = append(desc, fmt.Sprintf("<b>%s↔%s</b>: %s. %s", leafLabel[p.NegLeaf], leafLabel[p.PosLeaf], e(strings.Join(parts, ", ")), e(howTo(jointsByPatch[p.ID], p.Seam, leafLabel, p))))
		}
		w(`<li><b>%s</b>: join <b>%s</b> to <b>%s</b>.<ul>`, e(n.Label), e(strings.Join(group(n.Neg), " + ")), e(strings.Join(group(n.Pos), " + ")))
		for _, d := range desc {
			w(`<li>%s</li>`, d)
		}
		w(`</ul></li>`)
	}
	w(`</ol>`)

	// joint maps
	used := map[string]bool{}
	hasSeam := false
	for _, j := range pl.Joints {
		used[symbolOf(j.Kind)] = true
	}
	for _, p := range pl.Patches {
		if p.Seam != nil && p.Seam.Kind != "none" {
			hasSeam = true
		}
	}
	var legend []string
	for _, k := range []string{"pin", "peg", "magnet", "screw", "snap"} {
		if used[k] {
			legend = append(legend, legendSVG(k)+" "+map[string]string{"pin": "pin / dowel hole", "peg": "peg + socket", "magnet": "magnet pockets", "screw": "screw / bolt", "snap": "snap clip"}[k])
		}
	}
	if hasSeam {
		legend = append(legend, `<svg width="14" height="14"><rect width="14" height="14" fill="url(#lh)"/><defs><pattern id="lh" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.2" height="3" fill="#0008"/></pattern></defs></svg> seam joint along the wall`)
	}
	w(`<h2>Joint maps</h2><p class="mute">Each card is a cut face drawn to scale, seen from the second part of each pair, looking back at the first. Colour = which pair of parts meet there. %s</p><div class="grid">`, strings.Join(legend, " · "))
	for _, f := range pl.Faces {
		if len(f.Loops) == 0 {
			continue
		}
		var pairs []string
		for _, pid := range f.Patches {
			p := pl.Patches[pid]
			pairs = append(pairs, fmt.Sprintf(`<span class="sw" style="background:%s"></span>%s ↔ %s`, partColor(leafIdx[p.PosLeaf]), leafLabel[p.NegLeaf], leafLabel[p.PosLeaf]))
		}
		w(`<div class="card"><h3>%s <span class="mute small">%s</span></h3>%s</div>`, e(pl.Tree.Nodes[f.Node].Label), strings.Join(pairs, " &nbsp; "), faceSVG(f, pl, leafLabel, leafIdx, jointsByPatch))
	}
	w(`</div>`)

	// joint table
	if len(pl.Joints) > 0 {
		anyWarn := false
		for _, j := range pl.Joints {
			if len(j.Warnings) > 0 {
				anyWarn = true
			}
		}
		notesH := ""
		if anyWarn {
			notesH = "<th>Notes</th>"
		}
		w(`<h2>Joint list</h2><table><tr><th>#</th><th>Cut</th><th>Parts</th><th>Type</th><th>Size</th><th>Radial clearance (mm/side)</th>%s</tr>`, notesH)
		for _, j := range pl.Joints {
			p := pl.Patches[j.Patch]
			size := fmt.Sprintf("Ø%.1f", j.D)
			switch j.Kind {
			case "dowel", "press":
				size = fmt.Sprintf("pin <code>%s</code>; hole depth %.1f mm in %s, %.1f mm in %s", e(pinFile(j.D, math.Round(j.PinLength()*10)/10)), j.HoleNeg, leafLabel[p.NegLeaf], j.HolePos, leafLabel[p.PosLeaf])
			case "filament":
				size = fmt.Sprintf("Ø1.75 filament × %.0f mm; hole depth %.1f + %.1f mm", math.Round(j.PinLength()), j.HoleNeg, j.HolePos)
			case "magnet":
				size = fmt.Sprintf("Ø%g × %g mm disc magnet in each part", j.D, j.Depth)
			case "insert":
				size = fmt.Sprintf("%s × %.0f screw; insert in %s", j.Size, j.ScrewLen, leafLabel[maleLeaf(j, p)])
			case "bolt":
				size = fmt.Sprintf("%s × %.0f bolt; nut trap in %s", j.Size, j.ScrewLen, leafLabel[maleLeaf(j, p)])
			case "peg", "keyed":
				size = fmt.Sprintf("Ø%.1f × %.1f %s on %s", j.D, j.Depth, j.Shape, leafLabel[maleLeaf(j, p)])
			case "snap":
				size = fmt.Sprintf("%.0f mm wide, %.0f mm beam on %s", j.D, j.Depth, leafLabel[maleLeaf(j, p)])
			}
			notes := ""
			if anyWarn {
				notes = "<td>" + e(strings.Join(j.Warnings, "; ")) + "</td>"
			}
			w(`<tr><td>J%d</td><td>%s</td><td>%s↔%s</td><td>%s</td><td>%s</td><td>%.2f (%s)</td>%s</tr>`, j.ID, e(pl.Tree.Nodes[p.Node].Label), leafLabel[p.NegLeaf], leafLabel[p.PosLeaf], e(kindLabel[j.Kind]), size, j.Clear, e(j.Fit), notes)
		}
		w(`</table>`)
	}
	ft := pl.Settings.Fits
	w(`<h2>Fit table used</h2><table><tr><th>press</th><th>glue</th><th>slip</th><th>snap</th><th>seam</th><th>nozzle</th></tr><tr><td>%.2f</td><td>%.2f</td><td>%.2f</td><td>%.2f</td><td>%.2f</td><td>%.1f mm</td></tr></table><p class="mute">Radial clearance per side in mm. Glued holes have an axial glue-escape groove; pins have a flat that prints on the bed and vents air.</p>`,
		ft.Press, ft.Glue, ft.Slip, ft.Snap, ft.Seam, pl.Settings.Nozzle)
	var warns []string
	warns = append(warns, pl.Warnings...)
	warns = append(warns, res.Warnings...)
	for _, l := range pl.Leaves {
		for _, x := range l.Warnings {
			warns = append(warns, l.Label+": "+x)
		}
	}
	for _, p := range pl.Patches {
		for _, x := range p.Notes {
			warns = append(warns, fmt.Sprintf("cut %d %s↔%s: %s", p.Node, leafLabel[p.NegLeaf], leafLabel[p.PosLeaf], x))
		}
	}
	if len(warns) > 0 {
		w(`<h2>Notes and warnings</h2><ul>`)
		for _, x := range warns {
			w(`<li>%s</li>`, e(x))
		}
		w(`</ul>`)
	}
	w(`</main></body></html>`)
	return b.String()
}

func allUnglued(js []*plan.Joint, s *plan.Seam) bool {
	if s != nil && s.Kind != "none" && s.Glue {
		return false
	}
	if len(js) == 0 && (s == nil || s.Kind == "none") {
		return false
	}
	for _, j := range js {
		if j.Glue || j.Kind == "dowel" || j.Kind == "filament" || j.Kind == "peg" || j.Kind == "keyed" {
			return false
		}
	}
	return true
}

func faceSVG(f *plan.Face, pl *plan.Plan, leafLabel map[int]string, leafIdx map[int]int, jointsByPatch map[int][]*plan.Joint) string {
	minX, minY, maxX, maxY := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for _, l := range f.Loops {
		for _, p := range l {
			minX, maxX = math.Min(minX, p[0]), math.Max(maxX, p[0])
			minY, maxY = math.Min(minY, p[1]), math.Max(maxY, p[1])
		}
	}
	pad := 0.08 * math.Max(maxX-minX, maxY-minY)
	minX, minY, maxX, maxY = minX-pad, minY-2.2*pad, maxX+pad, maxY+pad
	W, H := maxX-minX, maxY-minY
	var b strings.Builder
	fmt.Fprintf(&b, `<svg viewBox="0 0 %.2f %.2f" xmlns="http://www.w3.org/2000/svg">`, W, H)
	tx := func(x float64) float64 { return x - minX }
	ty := func(y float64) float64 { return maxY - y }
	// patches as raster-free approximation: draw the loops, then tint by the
	// patch polygons clipped visually
	fmt.Fprintf(&b, `<defs><clipPath id="c%d"><path fill-rule="evenodd" d="`, f.Node)
	path := func() {
		for _, l := range f.Loops {
			for i, p := range l {
				c := "L"
				if i == 0 {
					c = "M"
				}
				fmt.Fprintf(&b, "%s%.2f %.2f", c, tx(p[0]), ty(p[1]))
			}
			b.WriteString("Z")
		}
	}
	path()
	fmt.Fprintf(&b, `"/></clipPath><pattern id="h%d" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.2" height="3" fill="#0006"/></pattern></defs>`, f.Node)
	sw := 0.004 * math.Max(W, H)
	for _, pid := range f.Patches {
		p := pl.Patches[pid]
		if len(p.Poly) < 3 {
			continue
		}
		b.WriteString(`<path clip-path="url(#c` + fmt.Sprint(f.Node) + `)" d="`)
		for i, q := range p.Poly {
			c := "L"
			if i == 0 {
				c = "M"
			}
			fmt.Fprintf(&b, "%s%.2f %.2f", c, tx(clampF(q[0], minX-W, maxX+W)), ty(clampF(q[1], minY-H, maxY+H)))
		}
		fmt.Fprintf(&b, `Z" fill="%s" fill-opacity="0.55"/>`, partColor(leafIdx[p.PosLeaf]))
		if p.Seam != nil && p.Seam.Kind != "none" {
			b.WriteString(`<path clip-path="url(#c` + fmt.Sprint(f.Node) + `)" d="`)
			for i, q := range p.Poly {
				c := "L"
				if i == 0 {
					c = "M"
				}
				fmt.Fprintf(&b, "%s%.2f %.2f", c, tx(clampF(q[0], minX-W, maxX+W)), ty(clampF(q[1], minY-H, maxY+H)))
			}
			fmt.Fprintf(&b, `Z" fill="url(#h%d)"/>`, f.Node)
		}
	}
	b.WriteString(`<path fill="none" stroke="#1d232b" stroke-width="` + fmt.Sprintf("%.3f", sw) + `" d="`)
	path()
	b.WriteString(`"/>`)
	fs := 0.055 * math.Max(W, H)
	for _, pid := range f.Patches {
		for _, j := range jointsByPatch[pid] {
			r := math.Max(j.RReq-pl.Settings.MinWall, 0.018*math.Max(W, H))
			col := "#1d232b"
			if len(j.Warnings) > 0 {
				col = "#c0392b"
			}
			fmt.Fprintf(&b, `%s fill="#fff" stroke="%s" stroke-width="%.3f"/>`, symbolPath(symbolOf(j.Kind), tx(j.P[0]), ty(j.P[1]), r), col, sw*1.6)
			// label towards the patch interior, where there is room
			pc := pl.Patches[pid].Centroid
			dx, dy := pc[0]-j.P[0], pc[1]-j.P[1]
			if l := math.Hypot(dx, dy); l > 1e-6 {
				dx, dy = dx/l, dy/l
			} else {
				dx, dy = 0, -1
			}
			// try towards the interior first, then the other directions, and
			// keep the first spot that does not sit on another joint
			lx, ly := 0.0, 0.0
			for _, dir := range [][2]float64{{dx, dy}, {-dy, dx}, {dy, -dx}, {-dx, -dy}} {
				lx = tx(j.P[0]) + dir[0]*(r+fs*0.9)
				ly = ty(j.P[1]) - dir[1]*(r+fs*0.7) + fs*0.35
				clash := false
				for _, pid2 := range f.Patches {
					for _, o := range jointsByPatch[pid2] {
						if o.ID == j.ID {
							continue
						}
						ro := math.Max(o.RReq-pl.Settings.MinWall, 0.018*math.Max(W, H))
						if math.Hypot(lx-tx(o.P[0]), ly-fs*0.35-ty(o.P[1])) < ro+fs*0.9 {
							clash = true
						}
					}
				}
				if !clash {
					break
				}
			}
			fmt.Fprintf(&b, `<text x="%.2f" y="%.2f" font-size="%.2f" text-anchor="middle" fill="%s" font-family="system-ui" font-weight="700" stroke="#fff" stroke-width="%.2f" paint-order="stroke">J%d</text>`, lx, ly, fs, col, fs*0.25, j.ID)
		}
	}
	// scale bar
	bar := niceLen(0.25 * W)
	y0 := H - fs*0.6
	fmt.Fprintf(&b, `<path d="M%.2f %.2fh%.2f" stroke="#1d232b" stroke-width="%.3f"/><text x="%.2f" y="%.2f" font-size="%.2f" font-family="system-ui" fill="#5b6673">%g mm</text>`, 0.03*W, y0, bar, sw*2, 0.03*W+bar+fs*0.3, y0+fs*0.35, fs*0.8, bar)
	b.WriteString(`</svg>`)
	return b.String()
}

func clampF(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func pinFile(d, l float64) string {
	return "parts/" + SafeName.ReplaceAllString(fmt.Sprintf("pin_d%s_L%s", trimF(d, 2), trimF(l, 1)), "_") + ".stl"
}

func trimF(x float64, dec int) string {
	s := fmt.Sprintf("%.*f", dec, x)
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return s
}

func maleLeaf(j *plan.Joint, p *plan.Patch) int {
	if j.Male == "pos" {
		return p.PosLeaf
	}
	return p.NegLeaf
}

func bedFace(down string, pl *plan.Plan) string {
	if strings.HasPrefix(down, "cut face ") {
		var id int
		if _, err := fmt.Sscanf(down, "cut face %d", &id); err == nil && id >= 0 && id < len(pl.Tree.Nodes) {
			return "cut face " + pl.Tree.Nodes[id].Label
		}
	}
	switch down {
	case "flat face":
		return "largest flat face"
	case "axis":
		return "as oriented"
	case "as built":
		return "flat side"
	}
	return down
}

// howTo gives the physical steps for one contact patch.
func howTo(js []*plan.Joint, s *plan.Seam, leafLabel map[int]string, p *plan.Patch) string {
	var steps []string
	kinds := map[string]bool{}
	for _, j := range js {
		kinds[j.Kind] = true
	}
	if kinds["magnet"] {
		steps = append(steps, "Glue one magnet into each pocket with CA or epoxy; mark the facing pole on both parts first so they attract, and let it cure before closing the joint")
	}
	if kinds["insert"] {
		steps = append(steps, "Press the heat-set inserts in with a soldering iron (≈ 220 °C for PLA) and let them cool flush")
	}
	if kinds["bolt"] {
		steps = append(steps, "Drop the hex nuts into their traps (a dab of glue keeps them in place)")
	}
	if kinds["dowel"] || kinds["filament"] {
		steps = append(steps, "Glue the pins into the "+leafLabel[p.NegLeaf]+" holes first, then dry-fit "+leafLabel[p.PosLeaf])
	}
	if kinds["press"] {
		steps = append(steps, "Tap the press-fit pins fully into "+leafLabel[p.NegLeaf]+", then press "+leafLabel[p.PosLeaf]+" on; no glue")
	}
	if kinds["peg"] || kinds["keyed"] {
		steps = append(steps, "Dry-fit pegs into their sockets")
	}
	if kinds["snap"] {
		steps = append(steps, "Push straight together until the clips click")
	}
	if s != nil && s.Kind != "none" {
		switch s.Kind {
		case "dovetail":
			steps = append(steps, "Slide the dovetail rail into its slot from the open end")
		default:
			steps = append(steps, "Dry-fit the "+kindLabel[s.Kind])
		}
	}
	glue := !allUnglued(js, s)
	if glue {
		steps = append(steps, "Glue the cut faces (CA for PLA, or epoxy for gap filling) and clamp; wipe squeeze-out")
	} else if !kinds["magnet"] {
		steps = append(steps, "No glue needed: this joint can be taken apart")
	} else {
		steps = append(steps, "Faces stay unglued: the magnets hold the parts and the joint can be taken apart")
	}
	return strings.Join(steps, ". ") + "."
}

func symbolOf(kind string) string {
	switch kind {
	case "dowel", "press", "filament":
		return "pin"
	case "peg", "keyed":
		return "peg"
	case "magnet":
		return "magnet"
	case "insert", "bolt":
		return "screw"
	case "snap":
		return "snap"
	}
	return "pin"
}

func symbolPath(sym string, x, y, r float64) string {
	switch sym {
	case "magnet":
		return fmt.Sprintf(`<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="%.2f"`, x-r, y-r, 2*r, 2*r, r*0.25)
	case "screw":
		var pts []string
		for k := 0; k < 6; k++ {
			a := math.Pi/6 + float64(k)*math.Pi/3
			pts = append(pts, fmt.Sprintf("%.2f,%.2f", x+r*math.Cos(a), y+r*math.Sin(a)))
		}
		return `<polygon points="` + strings.Join(pts, " ") + `"`
	case "snap":
		return fmt.Sprintf(`<polygon points="%.2f,%.2f %.2f,%.2f %.2f,%.2f"`, x, y-r, x+r, y+r*0.8, x-r, y+r*0.8)
	case "peg":
		return fmt.Sprintf(`<circle cx="%.2f" cy="%.2f" r="%.2f" stroke-dasharray="%.2f %.2f"`, x, y, r, r*0.5, r*0.3)
	}
	return fmt.Sprintf(`<circle cx="%.2f" cy="%.2f" r="%.2f"`, x, y, r)
}

func legendSVG(sym string) string {
	return `<svg width="14" height="14" viewBox="0 0 14 14">` + symbolPath(sym, 7, 7, 5.5) + ` fill="#fff" stroke="#1d232b" stroke-width="1.5"/></svg>`
}

func niceLen(x float64) float64 {
	if x <= 0 {
		return 10
	}
	p := math.Pow(10, math.Floor(math.Log10(x)))
	for _, m := range []float64{5, 2, 1} {
		if m*p <= x {
			return m * p
		}
	}
	return p
}
