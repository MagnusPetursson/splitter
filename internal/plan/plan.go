package plan

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

// Request is what the client sends to (re)plan.
type Request struct {
	Settings Settings `json:"settings"`
	// Mode: "auto" = split from scratch; "tree" = keep the given tree and
	// auto-complete leaves that don't fit (if Settings.AutoSplit); "joints"
	// = keep tree, regenerate auto joints, keep locked joints.
	Mode   string         `json:"mode"`
	Tree   *Tree          `json:"tree,omitempty"`
	Joints []*Joint       `json:"joints,omitempty"` // locked/user joints to keep
	Seams  []SeamOverride `json:"seams,omitempty"`
	// Styles are per-contact joint style choices (located like seams).
	Styles []StyleOverride `json:"styles,omitempty"`
}

// StyleOverride pins a joint style (or "" = the global style, forced) to
// the contact patch at a location on a cut face.
type StyleOverride struct {
	At    geom.Vec3 `json:"at"`
	Style string    `json:"style"`
	Force bool      `json:"force,omitempty"`
}

// SeamOverride pins a user's seam choice to a location on a cut face.
type SeamOverride struct {
	At   geom.Vec3 `json:"at"`
	Seam Seam      `json:"seam"`
}

// Plan is the complete planning result.
type Plan struct {
	Settings Settings           `json:"settings"`
	Usable   Bed                `json:"usable"`
	Tree     *Tree              `json:"tree"`
	Leaves   []*LeafInfo        `json:"leaves"`
	Faces    []*Face            `json:"faces"`
	Patches  []*Patch           `json:"patches"`
	Joints   []*Joint           `json:"joints"`
	Pins     []PinSpec          `json:"pins"`
	Hardware []string           `json:"hardware"`
	Warnings []string           `json:"warnings"`
	Timing   map[string]float64 `json:"timing"`
	Fits     bool               `json:"fits"`
}

// PinSpec aggregates identical separate pins.
type PinSpec struct {
	Kind   string  `json:"kind"`
	D      float64 `json:"d"`
	Length float64 `json:"length"`
	Count  int     `json:"count"`
	Clear  float64 `json:"clear"`
	Print  bool    `json:"print"` // false for filament pins (cut from filament)
}

// Run executes a planning request. When protruding joint features (pegs,
// seams) push an automatically split part past the bed, the split is redone
// with the bed shrunk by that protrusion.
func (md *Model) Run(req *Request, progress func(string)) (*Plan, error) {
	pl, err := md.run(req, 0, progress)
	if err != nil || pl.Fits || !(req.Mode == "auto" || req.Settings.AutoSplit || req.Tree == nil) {
		return pl, err
	}
	allow := 0.0
	for _, p := range pl.Patches {
		if p.Seam != nil && p.Seam.Kind != "none" {
			allow = math.Max(allow, p.Seam.Depth+1)
		}
	}
	for _, j := range pl.Joints {
		if j.Kind == "peg" || j.Kind == "keyed" || j.Kind == "snap" {
			allow = math.Max(allow, j.Depth+1)
		}
	}
	if allow == 0 {
		return pl, nil
	}
	if progress != nil {
		progress(fmt.Sprintf("joint features stick out %.0f mm: re-planning with that allowance", allow))
	}
	pl2, err := md.run(req, allow, progress)
	if err != nil {
		return pl, nil
	}
	pl2.Warnings = append(pl2.Warnings, fmt.Sprintf("cuts were planned %.0f mm inside the bed so protruding joint features still fit", allow))
	return pl2, nil
}

func (md *Model) run(req *Request, allowance float64, progress func(string)) (*Plan, error) {
	t0 := time.Now()
	s := req.Settings
	s.Normalize()
	s.allowance = allowance
	s.supportSplit = req.Mode == "auto" || req.Tree == nil
	md.Tilted = s.Tilted
	md.Upright = s.Upright
	md.supportWeight = s.supportWeight()
	pl := &Plan{Settings: s, Usable: s.Usable(), Timing: map[string]float64{}}
	if pl.Usable.X <= 10 || pl.Usable.Y <= 10 || pl.Usable.Z <= 10 {
		return nil, fmt.Errorf("build volume too small after margin")
	}
	var t *Tree
	switch {
	case req.Tree != nil && req.Mode != "auto":
		if err := req.Tree.Validate(); err != nil {
			return nil, err
		}
		t = req.Tree.Compact()
	default:
		t = NewTree()
	}
	if req.Mode == "auto" || s.AutoSplit || req.Tree == nil {
		if progress != nil {
			progress("planning cuts")
		}
		pl.Warnings = append(pl.Warnings, md.AutoSplit(t, &s, progress)...)
	}
	pl.Timing["split"] = time.Since(t0).Seconds()
	t1 := time.Now()
	pl.Tree = t
	if progress != nil {
		progress("analysing cut faces")
	}
	faces, patches := md.AnalyzeFaces(t)
	pl.Faces, pl.Patches = faces, patches
	pl.Warnings = append(pl.Warnings, sliverWarnings(patches, &s)...)
	pl.Timing["faces"] = time.Since(t1).Seconds()
	t2 := time.Now()
	faceOf := map[int]*Face{}
	for _, f := range faces {
		faceOf[f.Node] = f
	}

	// --- joints ---
	if progress != nil {
		progress("placing joints")
	}
	nextID := 1
	var joints []*Joint
	locked := map[int]bool{} // patches with user joints
	for _, uj := range req.Joints {
		if uj == nil || !uj.Locked {
			continue
		}
		pid, p2 := locate(faces, patches, uj.Origin)
		if pid < 0 {
			pl.Warnings = append(pl.Warnings, fmt.Sprintf("a manual %s joint is no longer on a cut face and was removed", uj.Kind))
			continue
		}
		j := *uj
		j.ID = nextID
		nextID++
		j.Patch = pid
		j.P = p2
		joints = append(joints, &j)
		locked[pid] = true
	}
	for _, so := range req.Seams {
		pid, _ := locate(faces, patches, so.At)
		if pid >= 0 {
			sm := so.Seam
			sm.Locked = true
			patches[pid].Seam = &sm
			locked[pid] = true
		}
	}
	for _, so := range req.Styles {
		if pid, _ := locate(faces, patches, so.At); pid >= 0 {
			patches[pid].Style, patches[pid].Force = so.Style, so.Force
		}
	}
	for i, p := range patches {
		if md.Step != nil {
			md.Step("joints", i, len(patches))
		}
		if locked[p.ID] || !s.AutoJoints {
			continue
		}
		fc := &faceCtx{md: md, t: t, face: faceOf[p.Node], patch: p, s: &s}
		js, seam, notes := fc.placeAuto(&nextID)
		joints = append(joints, js...)
		if seam != nil {
			p.Seam = seam
		}
		p.Notes = append(p.Notes, notes...)
	}

	// --- orientation (needs male faces) then male side assignment ---
	male := map[[2]int]bool{}
	var prot []Protrusion
	markMale := func() {
		for k := range male {
			delete(male, k)
		}
		prot = prot[:0]
		for _, j := range joints {
			p := patches[j.Patch]
			j.resolve(&s)
			if j.Male == "none" {
				continue
			}
			leaf := p.NegLeaf
			out := faceOf[p.Node].fr.N
			if j.Male == "pos" {
				leaf = p.PosLeaf
				out = out.Scale(-1)
			}
			male[[2]int{leaf, p.Node}] = true
			if j.Kind == "peg" || j.Kind == "keyed" || j.Kind == "snap" {
				fr := faceOf[p.Node].fr
				c := fr.To3(j.P)
				r := j.RReq - j.wall(&s)
				for k := 0; k < 8; k++ {
					a := float64(k) * math.Pi / 4
					q := c.Add(fr.U.Scale(r * math.Cos(a))).Add(fr.V.Scale(r * math.Sin(a))).Add(out.Scale(j.Depth + 0.2))
					prot = append(prot, Protrusion{Leaf: leaf, P: q})
				}
			}
		}
		for _, p := range patches {
			if p.Seam == nil || p.Seam.Kind == "none" {
				continue
			}
			f := faceOf[p.Node]
			n := f.fr.N
			addPatch := func(leaf int, out geom.Vec3) {
				for _, q := range f.samplePatch(p, 600) {
					prot = append(prot, Protrusion{Leaf: leaf, P: q.Add(out.Scale(p.Seam.Depth + 0.2))})
				}
			}
			if p.Seam.Kind == "finger" {
				male[[2]int{p.NegLeaf, p.Node}] = true
				male[[2]int{p.PosLeaf, p.Node}] = true
				addPatch(p.NegLeaf, n)
				addPatch(p.PosLeaf, n.Scale(-1))
				continue
			}
			if p.Seam.Male == "pos" {
				male[[2]int{p.PosLeaf, p.Node}] = true
				addPatch(p.PosLeaf, n.Scale(-1))
			} else {
				male[[2]int{p.NegLeaf, p.Node}] = true
				addPatch(p.NegLeaf, n)
			}
		}
	}
	// First pass: orient ignoring male features, so integrated features can
	// go on the part that does not print on that face.
	pre := md.Orient(t, faces, patches, male, nil, pl.Usable)
	preBy := map[int]*LeafInfo{}
	for _, l := range pre {
		preBy[l.ID] = l
	}
	onFace := func(leaf int, n geom.Vec3) bool {
		l := preBy[leaf]
		return l != nil && l.Down.Dot(n) > 0.985
	}
	for _, j := range joints {
		if j.Male == "none" || j.Locked {
			continue
		}
		p := patches[j.Patch]
		n := faceOf[p.Node].fr.N
		negOn := onFace(p.NegLeaf, n)
		posOn := onFace(p.PosLeaf, n.Scale(-1))
		if negOn && !posOn {
			j.Male = "pos"
		} else if posOn && !negOn {
			j.Male = "neg"
		}
	}
	for _, p := range patches {
		if p.Seam == nil || p.Seam.Locked || p.Seam.Kind == "finger" {
			continue
		}
		n := faceOf[p.Node].fr.N
		if onFace(p.NegLeaf, n) {
			p.Seam.Male = "pos"
		}
	}
	markMale()
	pl.Leaves = md.Orient(t, faces, patches, male, prot, pl.Usable)
	for i, id := range t.Internal() {
		t.Nodes[id].Label = fmt.Sprintf("C%d", i+1)
	}
	leafBy := map[int]*LeafInfo{}
	for _, l := range pl.Leaves {
		leafBy[l.ID] = l
	}
	// finalize joints: frames, depth, teardrops
	for _, j := range joints {
		p := patches[j.Patch]
		fc := &faceCtx{md: md, t: t, face: faceOf[p.Node], patch: p, s: &s}
		fc.finalize(j)
		for _, side := range []struct {
			leaf int
			up   **geom.Vec2
		}{{p.NegLeaf, &j.UpNeg}, {p.PosLeaf, &j.UpPos}} {
			l := leafBy[side.leaf]
			if l == nil {
				continue
			}
			if math.Abs(l.Down.Dot(j.Z)) < 0.5 {
				up := l.Down.Scale(-1)
				v := geom.Vec2{up.Dot(j.X), up.Dot(j.Y)}
				if v.Len() > 1e-6 {
					v = v.Scale(1 / v.Len())
					*side.up = &v
				}
			}
		}
	}
	// joints whose footprints overlap would cut into each other
	for a := 0; a < len(joints); a++ {
		for b := a + 1; b < len(joints); b++ {
			ja, jb := joints[a], joints[b]
			if ja.Patch != jb.Patch {
				continue
			}
			need := (ja.RReq - ja.wall(&s)) + (jb.RReq - jb.wall(&s)) + math.Min(ja.wall(&s), jb.wall(&s))
			if d := ja.P.Sub(jb.P).Len(); d < need {
				ja.Warnings = append(ja.Warnings, fmt.Sprintf("overlaps J%d (%.1f mm apart, needs %.1f)", jb.ID, d, need))
				jb.Warnings = append(jb.Warnings, fmt.Sprintf("overlaps J%d (%.1f mm apart, needs %.1f)", ja.ID, d, need))
			}
		}
	}
	sortJoints(joints)
	pl.Joints = joints
	if pl.Joints == nil {
		pl.Joints = []*Joint{}
	}
	pl.Timing["joints"] = time.Since(t2).Seconds()

	// pins & hardware
	pins := map[[3]float64]*PinSpec{}
	hw := map[string]int{}
	for _, j := range joints {
		switch j.Kind {
		case "dowel", "press":
			l := math.Round(j.PinLength()*10) / 10
			key := [3]float64{j.D, l, j.Clear}
			if pins[key] == nil {
				pins[key] = &PinSpec{Kind: j.Kind, D: j.D, Length: l, Clear: j.Clear, Print: true}
			}
			pins[key].Count++
		case "filament":
			l := math.Round(j.PinLength())
			key := [3]float64{1.75, l, -1}
			if pins[key] == nil {
				pins[key] = &PinSpec{Kind: "filament", D: 1.75, Length: l, Print: false}
			}
			pins[key].Count++
		case "magnet":
			hw[fmt.Sprintf("disc magnet Ø%g×%g mm", j.D, j.Depth)] += 2
		case "insert":
			_, _, _, il, _, _ := Screw(j.Size)
			hw[fmt.Sprintf("%s heat-set insert (%g mm long)", j.Size, il)]++
			hw[fmt.Sprintf("%s×%g socket head screw", j.Size, j.ScrewLen)]++
		case "bolt":
			hw[fmt.Sprintf("%s×%g socket head screw", j.Size, j.ScrewLen)]++
			hw[fmt.Sprintf("%s hex nut", j.Size)]++
		}
	}
	for _, p := range pins {
		pl.Pins = append(pl.Pins, *p)
	}
	sort.Slice(pl.Pins, func(a, b int) bool {
		if pl.Pins[a].D != pl.Pins[b].D {
			return pl.Pins[a].D > pl.Pins[b].D
		}
		return pl.Pins[a].Length > pl.Pins[b].Length
	})
	for k, v := range hw {
		pl.Hardware = append(pl.Hardware, fmt.Sprintf("%d × %s", v, k))
	}
	sort.Strings(pl.Hardware)
	pl.Fits = true
	for _, l := range pl.Leaves {
		if !l.Empty && !l.Fits {
			pl.Fits = false
		}
	}
	pl.Timing["total"] = time.Since(t0).Seconds()
	// never send JSON nulls for lists
	if pl.Faces == nil {
		pl.Faces = []*Face{}
	}
	if pl.Patches == nil {
		pl.Patches = []*Patch{}
	}
	if pl.Pins == nil {
		pl.Pins = []PinSpec{}
	}
	if pl.Hardware == nil {
		pl.Hardware = []string{}
	}
	if pl.Warnings == nil {
		pl.Warnings = []string{}
	}
	return pl, nil
}

// locate finds the patch containing a world point lying on a cut face.
func locate(faces []*Face, patches []*Patch, at geom.Vec3) (int, geom.Vec2) {
	bestD := 1.0
	bestP := -1
	var bestQ geom.Vec2
	for _, f := range faces {
		if f.grid == nil {
			continue
		}
		d := math.Abs(f.fr.N.Dot(at.Sub(f.fr.O)))
		if d > bestD {
			continue
		}
		q := f.fr.To2(at)
		k := f.pixelAt(q)
		if k < 0 || f.label[k] < 0 {
			continue
		}
		bestD, bestP, bestQ = d, int(f.label[k]), q
	}
	return bestP, bestQ
}

// sliverWarnings names contacts too small to hold a joint: a strip of a
// cut face left between two nearly coincident later cuts, or a plane
// grazing a thin rim. Such a contact gets at most a seam and shows as a
// thin chunk along the outside of the model.
func sliverWarnings(patches []*Patch, s *Settings) []string {
	var out []string
	small := math.Pi * (s.MinPiece / 2) * (s.MinPiece / 2)
	for _, p := range patches {
		if p.Area < small && p.RMax < s.MinPiece/4 {
			msg := fmt.Sprintf("contact C%d is a sliver (%.0f mm², at most %.1f mm wide): move a neighbouring cut so the cuts meet flush, or merge the parts", p.ID, p.Area, 2*p.RMax)
			p.Notes = append(p.Notes, msg)
			out = append(out, msg)
		}
	}
	return out
}
