package plan

import (
	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
	"math"
	"testing"
)

// Keep the explicitly inward cavity winding: mesh.Repair treats disconnected
// inner shells as solids. This independent fixture must not share that assumption.
func cavityModel() *Model {
	out := mesh.Box(geom.Vec3{}, geom.Vec3{100, 100, 100})
	in := mesh.Box(geom.Vec3{10, 10, 10}, geom.Vec3{90, 90, 90})
	for _, f := range in.Tris {
		out.Tris = append(out.Tris, [3]geom.Vec3{f[0], f[2], f[1]})
	}
	m := &mesh.Mesh{}
	indices := map[geom.Vec3]int32{}
	for _, f := range out.Tris {
		var face [3]int32
		for k, p := range f {
			i, ok := indices[p]
			if !ok {
				i = int32(len(m.V))
				indices[p] = i
				m.V = append(m.V, p)
			}
			face[k] = i
		}
		m.F = append(m.F, face)
	}
	return NewModel(m)
}

func TestSupportRasterAnalyticCavityAndCaps(t *testing.T) {
	md := cavityModel()
	down := geom.Vec3{0, 0, -1}
	estimate := func(hs []HalfSpace, d geom.Vec3) float64 {
		return md.supportGeometry(hs).estimate(md.CellPoints(hs), d)
	}
	// Inner ceiling: 80×80 at z=90. Outer bottom is on the bed.
	if v := estimate(nil, down); math.Abs(v-576000) > 1e-6 {
		t.Fatalf("ceiling area × bed height: got %g, want 576000 mm³", v)
	}
	// The top slab inverted has its outer top on the bed. Its cut cap and
	// inner ceiling face UP: neither needs support (sign must be preserved).
	hs := []HalfSpace{{P: Plane{N: geom.Vec3{0, 0, 1}, D: 50}, Side: 1}}
	if v := estimate(hs, geom.Vec3{0, 0, 1}); v != 0 {
		t.Fatalf("upward cap counted as support: %g", v)
	}
	// Clipping the big ceiling triangles at x=50 must halve their area,
	// regardless of which side contains their centroids.
	half := []HalfSpace{{P: Plane{N: geom.Vec3{1, 0, 0}, D: 50}, Side: -1}}
	if v := estimate(half, down); math.Abs(v-288000) > 1e-6 {
		t.Fatalf("clipped ceiling got %g, want 288000 mm³", v)
	}
	// Translation cannot change support demand.
	for i := range md.M.V {
		md.M.V[i] = md.M.V[i].Add(geom.Vec3{432, -567, 123})
	}
	moved := NewModel(md.M)
	v := moved.supportGeometry(nil).estimate(moved.CellPoints(nil), down)
	if math.Abs(v-576000) > 1e-6 {
		t.Fatalf("translation changed support proxy to %g", v)
	}
}

func TestSupportRasterTiltedCapsAndHoles(t *testing.T) {
	// Lower half of a cube cut by z = x/2 + 50. Inverted, its tilted cut
	// face needs supports up to 50 mm high. Integral is 100*100*25/cos(a).
	md := boxModel(t, geom.Vec3{}, geom.Vec3{100, 100, 100})
	n := geom.Vec3{-0.5, 0, 1}.Norm()
	p := Plane{N: n, D: 50 / math.Sqrt(1.25)}
	hs := []HalfSpace{{P: p, Side: -1}}
	got := md.supportGeometry(hs).estimate(md.CellPoints(hs), geom.Vec3{0, 0, 1})
	want := 250000 * math.Sqrt(1.25)
	if math.Abs(got-want) > 1e-6 {
		t.Fatalf("tilted cap %g, want %g", got, want)
	}
	// Isolate a ring-shaped cut face, with a centred 80×80 hole. Symmetry
	// keeps the mean height 25 mm; 3600*25/cos(a) is independent of code.
	fr := geom.PlaneFrame(n, p.D)
	sec := &Section{Frame: fr}
	for _, span := range [][2]float64{{0, 100}, {10, 90}} {
		a, b := span[0], span[1]
		loop := Loop2{}
		for _, q := range []geom.Vec2{{a, a}, {b, a}, {b, b}, {a, b}} {
			loop.P = append(loop.P, fr.To2(geom.Vec3{q[0], q[1], 50 + q[0]/2}))
		}
		sec.Loops = append(sec.Loops, loop)
	}
	cell := &supportCell{caps: []supportCap{{sec, n}}}
	got = cell.estimate(md.CellPoints(hs), geom.Vec3{0, 0, 1})
	want = 90000 * math.Sqrt(1.25)
	if math.Abs(got-want) > 1e-6 {
		t.Fatalf("ring cap %g, want %g (hole must be empty)", got, want)
	}
}

func TestSupportRasterStrict45AndBedContact(t *testing.T) {
	pts := []geom.Vec3{{0, 0, 0}, {100, 0, 0}, {0, 100, 100}, {100, 100, 100}}
	poly := supportPoly{p: []geom.Vec3{{0, 0, 10}, {100, 0, 10}, {100, 100, 10}, {0, 100, 10}}}
	for _, tc := range []struct {
		name string
		dot  float64
		want bool
	}{
		{"vertical", 0, false}, {"45 degrees", overhangCos, false}, {"steeper", overhangCos + 0.01, true}, {"horizontal", 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			poly.n = geom.Vec3{math.Sqrt(1 - tc.dot*tc.dot), 0, -tc.dot}
			c := &supportCell{polys: []supportPoly{poly}}
			v := c.estimate(pts, geom.Vec3{0, 0, -1})
			if (v > 0) != tc.want {
				t.Fatalf("got %g at dot=%g", v, tc.dot)
			}
		})
	}
	md := boxModel(t, geom.Vec3{}, geom.Vec3{100, 80, 20})
	for _, d := range []geom.Vec3{{0, 0, -1}, {0, 0, 1}, {1, 0, 0}, {0, 1, 0}} {
		if v := md.supportGeometry(nil).estimate(md.CellPoints(nil), d); v != 0 {
			t.Fatalf("bed contact counted as %g mm³", v)
		}
	}
}

func TestSupportDefaultSplitsCorrectlyWoundCavity(t *testing.T) {
	md := cavityModel()
	req := supportRequest(t, 0)
	req.Settings.SupportWeight = nil
	pl, err := md.Run(req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(pl.Leaves) != 2 || !pl.Fits {
		t.Fatalf("default should open the cavity into 2 fitting parts, got %d", len(pl.Leaves))
	}
	if v := supportTotalJSON(t, pl); v != 0 {
		t.Fatalf("open halves should need no support, got %g", v)
	}
}

func TestSupportRasterUnionAndScale(t *testing.T) {
	md := cavityModel()
	pts := md.CellPoints(nil)
	cell := md.supportGeometry(nil)
	cell.polys = append(cell.polys, cell.polys...)
	if v := cell.estimate(pts, geom.Vec3{0, 0, -1}); math.Abs(v-576000) > 1e-6 {
		t.Fatalf("overlapping support columns counted twice: %g", v)
	}
	md.M.Scale(2)
	bigger := NewModel(md.M)
	if v := bigger.supportGeometry(nil).estimate(bigger.CellPoints(nil), geom.Vec3{0, 0, -1}); math.Abs(v-4608000) > 1e-6 {
		t.Fatalf("area×height must scale cubically, got %g", v)
	}
}

func TestSupportSettingsAndManualCuts(t *testing.T) {
	for _, tc := range []struct{ raw, want float64 }{{-1, 0}, {0, 0}, {0.5, 0.5}, {1, 1}, {2, 1}, {math.NaN(), 0.5}, {math.Inf(1), 0.5}} {
		s := Settings{SupportWeight: &tc.raw}
		s.Normalize()
		if s.supportWeight() != tc.want {
			t.Fatalf("%g normalized to %g", tc.raw, s.supportWeight())
		}
	}
	s := Settings{}
	s.Normalize()
	if s.supportWeight() != 0.5 {
		t.Fatal("omitted weight not balanced")
	}
	md := cavityModel()
	req := supportRequest(t, 1)
	req.Mode = "tree"
	req.Tree = NewTree()
	req.Settings.AutoSplit = true
	pl, err := md.Run(req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(pl.Leaves) != 1 {
		t.Fatal("auto-complete must not add support-only cuts to a fitting manual tree")
	}
	req.Mode = "auto"
	req.Settings.MaxParts = 2
	pl, err = md.Run(req, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(pl.Leaves) != 2 || !pl.Fits {
		t.Fatalf("part budget not respected: %d, fits=%v", len(pl.Leaves), pl.Fits)
	}
	req.Settings.Upright = true
	pl, err = md.Run(req, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range pl.Leaves {
		if l.Down != (geom.Vec3{0, 0, -1}) {
			t.Fatal("support objective overrode Keep upright")
		}
	}
}
