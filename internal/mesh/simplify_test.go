package mesh

import (
	"math"
	"testing"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

// sphereSoup is an octahedron subdivided `level` times and pushed onto a
// sphere: 8·4^level triangles, closed, outward wound.
func sphereSoup(c geom.Vec3, r float64, level int, inward bool) *Soup {
	tris := [][3]geom.Vec3{}
	px, nx, py, ny, pz, nz := geom.Vec3{1, 0, 0}, geom.Vec3{-1, 0, 0}, geom.Vec3{0, 1, 0}, geom.Vec3{0, -1, 0}, geom.Vec3{0, 0, 1}, geom.Vec3{0, 0, -1}
	tris = append(tris, [3]geom.Vec3{px, py, pz}, [3]geom.Vec3{py, nx, pz}, [3]geom.Vec3{nx, ny, pz}, [3]geom.Vec3{ny, px, pz},
		[3]geom.Vec3{py, px, nz}, [3]geom.Vec3{nx, py, nz}, [3]geom.Vec3{ny, nx, nz}, [3]geom.Vec3{px, ny, nz})
	for l := 0; l < level; l++ {
		var out [][3]geom.Vec3
		for _, t := range tris {
			a, b, cc := t[0], t[1], t[2]
			ab, bc, ca := a.Add(b).Norm(), b.Add(cc).Norm(), cc.Add(a).Norm()
			out = append(out, [3]geom.Vec3{a, ab, ca}, [3]geom.Vec3{ab, b, bc}, [3]geom.Vec3{ca, bc, cc}, [3]geom.Vec3{ab, bc, ca})
		}
		tris = out
	}
	s := &Soup{}
	for _, t := range tris {
		p := [3]geom.Vec3{c.Add(t[0].Scale(r)), c.Add(t[1].Scale(r)), c.Add(t[2].Scale(r))}
		if inward {
			p[1], p[2] = p[2], p[1]
		}
		s.Tris = append(s.Tris, p)
	}
	return s
}

func repaired(t *testing.T, s *Soup) *Mesh {
	t.Helper()
	m, rep, err := Repair(s)
	if err != nil || !rep.Closed {
		t.Fatalf("repair: %v %+v", err, rep)
	}
	return m
}

func TestSimplifySphereStaysClosedAndClose(t *testing.T) {
	m := repaired(t, sphereSoup(geom.Vec3{}, 50, 6, false)) // 32768 triangles
	out, rep, err := Simplify(m, SimplifyOptions{TargetTris: 4000})
	if err != nil {
		t.Fatal(err)
	}
	if !out.Closed() || len(out.Components()) != 1 {
		t.Fatalf("simplified sphere not a closed single shell: %+v", rep)
	}
	if len(out.F) > 4000 || len(out.F) < 3000 {
		t.Fatalf("got %d triangles, want ~4000", len(out.F))
	}
	// a 4000-triangle sphere of radius 50 has chord sag ≈ r·(1-cos(θ/2)),
	// edge ≈ 5.6 mm → sag ≈ 0.08 mm; allow 0.2 mm
	maxD, mean, _, n := Deviation(m, out, 100000)
	if maxD > 0.2 || mean > 0.05 || n < 1000 {
		t.Fatalf("deviation max %.3f mean %.3f over %d samples", maxD, mean, n)
	}
	if v0, v1 := m.Volume(), out.Volume(); math.Abs(v1-v0)/v0 > 0.01 {
		t.Fatalf("volume %g → %g", v0, v1)
	}
}

func TestSimplifyKeepsHollowShells(t *testing.T) {
	s := sphereSoup(geom.Vec3{}, 50, 5, false)
	in := sphereSoup(geom.Vec3{}, 48, 5, true) // 2 mm wall, cavity inward
	s.Tris = append(s.Tris, in.Tris...)
	m := repaired(t, s)
	out, rep, err := Simplify(m, SimplifyOptions{TargetTris: 1200})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Shells != 2 || !rep.Closed {
		t.Fatalf("hollow sphere lost a shell or closure: %+v", rep)
	}
	if v0, v1 := m.Volume(), out.Volume(); math.Abs(v1-v0)/v0 > 0.05 {
		t.Fatalf("shell volume %g → %g", v0, v1)
	}
}

func TestSimplifyFlatAreasCollapseFreeAndMaxErrorLimits(t *testing.T) {
	// a box tessellated into many coplanar triangles collapses to almost
	// nothing at zero error...
	b := Box(geom.Vec3{0, 0, 0}, geom.Vec3{40, 30, 20})
	for l := 0; l < 5; l++ {
		var out [][3]geom.Vec3
		for _, t := range b.Tris {
			a, bb, c := t[0], t[1], t[2]
			ab, bc, ca := a.Lerp(bb, 0.5), bb.Lerp(c, 0.5), c.Lerp(a, 0.5)
			out = append(out, [3]geom.Vec3{a, ab, ca}, [3]geom.Vec3{ab, bb, bc}, [3]geom.Vec3{ca, bc, c}, [3]geom.Vec3{ab, bc, ca})
		}
		b.Tris = out
	}
	m := repaired(t, b)
	out, rep, err := Simplify(m, SimplifyOptions{TargetTris: 12, MaxError: 0.001})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.F) > 200 {
		t.Fatalf("coplanar box kept %d of %d triangles", len(out.F), len(m.F))
	}
	if maxD, _, _, _ := Deviation(m, out, 50000); maxD > 1e-6 {
		t.Fatalf("flat collapse moved the surface by %g mm (%+v)", maxD, rep)
	}
	// ...while a tight error limit stops a curved surface early
	sph := repaired(t, sphereSoup(geom.Vec3{}, 50, 6, false))
	lim, lrep, err := Simplify(sph, SimplifyOptions{TargetTris: 100, MaxError: 0.01})
	if err != nil {
		t.Fatal(err)
	}
	if !lrep.Limited || len(lim.F) < 2000 {
		t.Fatalf("0.01 mm limit should stop well above 100 triangles: %d, %+v", len(lim.F), lrep)
	}
	if maxD, _, _, _ := Deviation(sph, lim, 100000); maxD > 0.05 {
		t.Fatalf("0.01 mm-limited result deviates %.3f mm", maxD)
	}
}

// torusSoup: a (R, r) torus as an nu × nv quad grid, closed, genus 1.
func torusSoup(R, r float64, nu, nv int) *Soup {
	pt := func(i, j int) geom.Vec3 {
		u := 2 * math.Pi * float64(i%nu) / float64(nu)
		v := 2 * math.Pi * float64(j%nv) / float64(nv)
		return geom.Vec3{(R + r*math.Cos(v)) * math.Cos(u), (R + r*math.Cos(v)) * math.Sin(u), r * math.Sin(v)}
	}
	s := &Soup{}
	for i := 0; i < nu; i++ {
		for j := 0; j < nv; j++ {
			a, b, c, d := pt(i, j), pt(i+1, j), pt(i+1, j+1), pt(i, j+1)
			s.Tris = append(s.Tris, [3]geom.Vec3{a, b, c}, [3]geom.Vec3{a, c, d})
		}
	}
	return s
}

// Pushed to extremes, an unchecked collapse pinches the surface (two
// sheets share an edge or vertex) or folds triangles over. Every result,
// however coarse, must still be a closed manifold with the same shells.
func TestSimplifyAggressiveStaysManifold(t *testing.T) {
	cases := []struct {
		name   string
		s      *Soup
		target int
	}{
		{"sphere to 8", sphereSoup(geom.Vec3{}, 30, 5, false), 8},
		{"torus to 40", torusSoup(40, 6, 120, 40), 40},
		// coarse tori: the ring is only a few edges round, so most
		// collapses would pinch it (link condition)
		{"coarse torus to 4", torusSoup(40, 6, 6, 3), 4},
		{"coarse torus to 20", torusSoup(40, 6, 12, 4), 20},
		{"thin torus to 100", torusSoup(40, 1.5, 200, 24), 100},
		{"hollow sphere to 30", func() *Soup {
			s := sphereSoup(geom.Vec3{}, 30, 4, false)
			s.Tris = append(s.Tris, sphereSoup(geom.Vec3{}, 29, 4, true).Tris...)
			return s
		}(), 30},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := repaired(t, c.s)
			shells := len(m.Components())
			out, rep, err := Simplify(m, SimplifyOptions{TargetTris: c.target})
			if err != nil {
				t.Fatalf("%v (%+v)", err, rep)
			}
			st := out.EdgeStats()
			if st.Boundary+st.NonManifold+st.Misoriented != 0 || len(out.Components()) != shells {
				t.Fatalf("not a closed manifold with %d shell(s): %+v, %d shells", shells, st, len(out.Components()))
			}
			// no pinched vertices either: every vertex's triangle fan is one disc
			if v := pinchedVertices(out); v > 0 {
				t.Fatalf("%d pinched (non-manifold) vertices", v)
			}
			// every remaining triangle keeps a positive area and the solid
			// keeps a positive volume per shell
			for i := range out.F {
				if out.TriNormal(i).Len() < 1e-12 {
					t.Fatalf("degenerate triangle %d", i)
				}
			}
			if out.Volume() <= 0 {
				t.Fatalf("volume %g", out.Volume())
			}
		})
	}
}

// pinchedVertices counts vertices whose incident triangles form more than
// one edge-connected fan.
func pinchedVertices(m *Mesh) int {
	inc := make([][]int, len(m.V))
	for i, f := range m.F {
		for k := 0; k < 3; k++ {
			inc[f[k]] = append(inc[f[k]], i)
		}
	}
	bad := 0
	for v, fs := range inc {
		if len(fs) == 0 {
			continue
		}
		seen := map[int]bool{fs[0]: true}
		stack := []int{fs[0]}
		for len(stack) > 0 {
			a := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, b := range fs {
				if seen[b] {
					continue
				}
				shared := 0
				for _, x := range m.F[a] {
					for _, y := range m.F[b] {
						if x == y && x != int32(v) {
							shared++
						}
					}
				}
				if shared > 0 {
					seen[b] = true
					stack = append(stack, b)
				}
			}
		}
		if len(seen) != len(fs) {
			bad++
		}
	}
	return bad
}

func TestDeviationConcentricSpheres(t *testing.T) {
	// independent oracle: two concentric spheres 0.5 mm apart. Vertices
	// of the finer one lie between the coarse one's facets and its sphere,
	// so distances are within [0.5 - sag, 0.5].
	a := repaired(t, sphereSoup(geom.Vec3{}, 20, 5, false))
	b := repaired(t, sphereSoup(geom.Vec3{}, 20.5, 5, false))
	maxD, mean, _, n := Deviation(a, b, 20000)
	if n == 0 || maxD > 0.5+1e-9 || maxD < 0.45 || mean < 0.4 {
		t.Fatalf("concentric spheres: max %.4f mean %.4f n %d", maxD, mean, n)
	}
}
