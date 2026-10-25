package plan

import (
	"strings"
	"testing"

	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
)

// hollowBox is a closed box with per-axis wall thicknesses.
func hollowBox(t *testing.T, size, wall geom.Vec3) *Model {
	t.Helper()
	s := mesh.Box(geom.Vec3{0, 0, 0}, size)
	in := mesh.Box(wall, size.Sub(wall))
	for _, tri := range in.Tris {
		s.Tris = append(s.Tris, [3]geom.Vec3{tri[0], tri[2], tri[1]})
	}
	m, _, err := mesh.Repair(s)
	if err != nil {
		t.Fatal(err)
	}
	return NewModel(m)
}

// cutAt plans with one manual cut and a bed large enough not to split more.
func cutAt(t *testing.T, md *Model, n geom.Vec3, d float64, style string, styles ...StyleOverride) *Plan {
	t.Helper()
	tr := NewTree()
	tr.SplitLeaf(0, Plane{N: n, D: d})
	tr.Nodes[0].Locked = true
	pl, err := md.Run(&Request{Mode: "tree", Tree: tr, Styles: styles,
		Settings: Settings{Bed: Bed{500, 500, 500}, AutoJoints: true, JointStyle: style}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(pl.Patches) == 0 {
		t.Fatal("no contact patch")
	}
	return pl
}

func kindsOf(pl *Plan) map[string]int {
	k := map[string]int{}
	for _, j := range pl.Joints {
		k[j.Kind]++
	}
	return k
}

func TestSolidCubeGetsDowels(t *testing.T) {
	md := boxModel(t, geom.Vec3{0, 0, 0}, geom.Vec3{120, 120, 120})
	pl := cutAt(t, md, geom.Vec3{1, 0, 0}, 60, "glued")
	if k := kindsOf(pl); k["dowel"] < 2 || len(k) != 1 {
		t.Fatalf("want ≥ 2 dowels only, got %v", k)
	}
	for _, p := range pl.Patches {
		if p.Fallback != nil || p.Seam != nil {
			t.Fatalf("solid cube: unexpected fallback/seam %+v %+v", p.Fallback, p.Seam)
		}
	}
}

// A shell whose section is mostly a 2.4 mm wall but with two 20 mm thick
// ends: the old shell rule replaced the dowels with a finger seam. The
// user's dowels must win because two fit in the thick ends.
func TestThinShellWithThickEndsKeepsDowels(t *testing.T) {
	md := hollowBox(t, geom.Vec3{300, 160, 120}, geom.Vec3{20, 2.4, 2.4})
	pl := cutAt(t, md, geom.Vec3{0, 1, 0}, 80, "glued")
	p := pl.Patches[0]
	if !p.Ring || p.Thickness >= 3*1.26 {
		t.Fatalf("test shape should be a thin shell section: ring=%v t=%.2f", p.Ring, p.Thickness)
	}
	if k := kindsOf(pl); k["dowel"] < 2 {
		t.Fatalf("want ≥ 2 dowels, got %v (notes %v, fallback %+v)", k, p.Notes, p.Fallback)
	}
	if p.Seam != nil || p.Fallback != nil {
		t.Fatalf("dowels fit: no seam/fallback expected, got %+v %+v", p.Seam, p.Fallback)
	}
	// switching the style re-places with the new kind on the same tree
	pl = cutAt(t, md, geom.Vec3{0, 1, 0}, 80, "magnets")
	if k := kindsOf(pl); k["magnet"] < 2 {
		t.Fatalf("want magnets, got %v", k)
	}
}

func TestUniformShellFallsBackVisibly(t *testing.T) {
	md := shellModel(t, 300, 160, 120, 2.4)
	pl := cutAt(t, md, geom.Vec3{1, 0, 0}, 150, "glued")
	for _, p := range pl.Patches {
		fb := p.Fallback
		if fb == nil {
			t.Fatalf("patch %d: substitution without a fallback record", p.ID)
		}
		if fb.Want != "Dowels" || !strings.HasPrefix(fb.Reason, "wall ") || fb.Why == "" {
			t.Errorf("fallback %+v", fb)
		}
		// substitute follows the measured wall: tongue ≥ 3·minWall, lap ≥ 2·minWall, else finger
		want := substituteSeamKind(p.Thickness, &pl.Settings)
		if want == "tongue" || p.Seam == nil || p.Seam.Kind != want || !strings.HasPrefix(fb.Got, want) {
			t.Errorf("t=%.2f: want %s seam, got %+v / %q", p.Thickness, want, p.Seam, fb.Got)
		}
	}
	if len(pl.Joints) != 0 {
		t.Fatalf("no dowel fits a 2.4 mm wall, got %v", kindsOf(pl))
	}
	// forcing dowels cannot work either: the record says so
	pl = cutAt(t, md, geom.Vec3{1, 0, 0}, 150, "glued", StyleOverride{At: pl.Patches[0].Anchor, Force: true})
	if fb := pl.Patches[0].Fallback; fb == nil || !fb.Forced || !strings.Contains(fb.Why, "inscribed") {
		t.Fatalf("forced revert should fail with a reason, got %+v", fb)
	}
}

// The bowl case: a ~5 mm shell is just too thin for a 3 mm dowel with the
// recommended walls, so it falls back visibly to tongue-and-groove; "use
// dowels anyway" (force) places dowels with 2-perimeter walls.
func TestForceDowelsOnModerateShell(t *testing.T) {
	md := shellModel(t, 300, 160, 120, 4.6)
	pl := cutAt(t, md, geom.Vec3{1, 0, 0}, 150, "glued")
	p := pl.Patches[0]
	if p.Fallback == nil || p.Seam == nil || p.Seam.Kind != "tongue" {
		t.Fatalf("t=%.2f rmax=%.2f: want visible tongue fallback, got %+v %+v", p.Thickness, p.RMax, p.Fallback, p.Seam)
	}
	pl = cutAt(t, md, geom.Vec3{1, 0, 0}, 150, "glued", StyleOverride{At: p.Anchor, Force: true})
	q := pl.Patches[0]
	if k := kindsOf(pl); k["dowel"] < 2 || q.Fallback != nil || q.Seam != nil {
		t.Fatalf("forced: kinds %v fb %+v seam %+v notes %v", k, q.Fallback, q.Seam, q.Notes)
	}
	for _, j := range pl.Joints {
		if j.MinWall <= 0 || len(j.Warnings) > 0 {
			t.Errorf("forced joint %d: minWall %.2f warnings %v", j.ID, j.MinWall, j.Warnings)
		}
	}
}

func TestSinglePinFaceKeepsDowelWithWarning(t *testing.T) {
	// 10 × 16 mm bar section (160 mm²): only one 3 mm dowel fits with the
	// 12 mm minimum spacing
	md := boxModel(t, geom.Vec3{0, 0, 0}, geom.Vec3{200, 10, 16})
	pl := cutAt(t, md, geom.Vec3{1, 0, 0}, 100, "glued")
	p := pl.Patches[0]
	if k := kindsOf(pl); k["dowel"] != 1 || len(k) != 1 {
		t.Fatalf("want exactly 1 dowel, got %v", k)
	}
	if !p.Single || p.Seam != nil || p.Fallback != nil {
		t.Fatalf("single=%v seam=%+v fallback=%+v", p.Single, p.Seam, p.Fallback)
	}
	if !strings.Contains(strings.Join(p.Notes, ";"), "only one dowel fits") {
		t.Fatalf("missing warning: %v", p.Notes)
	}
	// "use seam here" → a seam chosen by wall thickness, no fallback badge
	pl = cutAt(t, md, geom.Vec3{1, 0, 0}, 100, "glued", StyleOverride{At: p.Anchor, Style: "seam"})
	if q := pl.Patches[0]; q.Seam == nil || len(pl.Joints) != 0 || q.Fallback != nil {
		t.Fatalf("seam override: seam=%+v joints=%d fb=%+v", q.Seam, len(pl.Joints), q.Fallback)
	}
}

func TestPrefersSizeThatGivesTwo(t *testing.T) {
	// 12 × 20 section: one 8 mm dowel or two 3 mm dowels; two wins
	md := boxModel(t, geom.Vec3{0, 0, 0}, geom.Vec3{200, 12, 20})
	pl := cutAt(t, md, geom.Vec3{1, 0, 0}, 100, "glued")
	if len(pl.Joints) < 2 {
		t.Fatalf("want 2 smaller dowels, got %d", len(pl.Joints))
	}
}

func TestSeamThicknessThresholds(t *testing.T) {
	s := &Settings{Nozzle: 0.4}
	s.Normalize() // MinWall 1.2
	for _, c := range []struct {
		t    float64
		want string
	}{{4, "tongue"}, {3.6, "tongue"}, {3, "lap"}, {2.4, "lap"}, {2, "finger"}, {1.1, "finger"}, {1, ""}} {
		if got := substituteSeamKind(c.t, s); got != c.want {
			t.Errorf("t=%.1f: got %q want %q", c.t, got, c.want)
		}
	}
	fc := func(th float64, style string) (*faceCtx, *Seam) {
		ss := *s
		ss.JointStyle = style
		f := &faceCtx{patch: &Patch{Thickness: th}, s: &ss}
		_, sm, _ := f.placeAuto(new(int))
		return f, sm
	}
	// explicit tongue on a 3 mm wall: visible fallback to lap
	f, sm := fc(3, "tongue")
	if sm == nil || sm.Kind != "lap" || f.patch.Fallback == nil || f.patch.Fallback.Got != "lap seam" {
		t.Fatalf("tongue@3mm: %+v %+v", sm, f.patch.Fallback)
	}
	// explicit lap on a 2 mm wall: finger, with a badge
	f, sm = fc(2, "lap")
	if sm == nil || sm.Kind != "finger" || f.patch.Fallback == nil {
		t.Fatalf("lap@2mm: %+v %+v", sm, f.patch.Fallback)
	}
	// tongue that fits: no badge
	f, sm = fc(4, "tongue")
	if sm == nil || sm.Kind != "tongue" || f.patch.Fallback != nil {
		t.Fatalf("tongue@4mm: %+v %+v", sm, f.patch.Fallback)
	}
	// forced tongue on 3 mm (≥ 3 × 0.8 hard wall): placed with a note
	ss := *s
	ss.JointStyle = "tongue"
	g := &faceCtx{patch: &Patch{Thickness: 3, Force: true}, s: &ss}
	_, sm, notes := g.placeAuto(new(int))
	if sm == nil || sm.Kind != "tongue" || g.patch.Fallback != nil || len(notes) == 0 {
		t.Fatalf("forced tongue@3mm: %+v %+v %v", sm, g.patch.Fallback, notes)
	}
}
