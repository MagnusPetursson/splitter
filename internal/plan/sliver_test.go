package plan

import (
	"math"
	"testing"

	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
)

// slopedSoup is a box whose top face slopes from height h0 at x=0 to h1 at
// x=w. Cutting it across X first leaves two halves of different heights, so
// a planner that picks each half's next cut on its own puts them at
// slightly different heights.
func slopedSoup(min geom.Vec3, w, d, h0, h1 float64) *mesh.Soup {
	s := mesh.Box(min, geom.Vec3{min[0] + w, min[1] + d, min[2] + 1})
	for i := range s.Tris {
		for k := 0; k < 3; k++ {
			p := &s.Tris[i][k]
			if p[2] > min[2]+0.5 {
				p[2] = min[2] + h0 + (h1-h0)*(p[0]-min[0])/w
			}
		}
	}
	return s
}

func slopedShellModel(t *testing.T, w, d, h0, h1, wall float64) *Model {
	t.Helper()
	s := slopedSoup(geom.Vec3{0, 0, 0}, w, d, h0, h1)
	// inner cavity: same slope, inset by the wall, inverted
	in := slopedSoup(geom.Vec3{wall, wall, wall}, w-2*wall, d-2*wall, h0-2*wall+(h1-h0)*wall/w, h1-2*wall-(h1-h0)*wall/w)
	for _, tri := range in.Tris {
		s.Tris = append(s.Tris, [3]geom.Vec3{tri[0], tri[2], tri[1]})
	}
	m, rep, err := mesh.Repair(s)
	if err != nil {
		t.Fatal(err)
	}
	if !rep.Closed {
		t.Fatalf("sloped shell repair: %+v", rep)
	}
	return NewModel(m)
}

// staggeredCuts returns pairs of parallel cuts in the tree whose offsets
// differ by less than tol (but are not the same plane). On the face of a
// common ancestor cut, the strip between two such cuts becomes its own
// contact patch only gap mm wide: the "chunk along the edge".
func staggeredCuts(t *Tree, tol float64) [][2]int {
	var out [][2]int
	ids := t.Internal()
	for a := 0; a < len(ids); a++ {
		for b := a + 1; b < len(ids); b++ {
			ca, cb := t.Nodes[ids[a]].Cut, t.Nodes[ids[b]].Cut
			dot := ca.N.Dot(cb.N)
			if math.Abs(dot) < 0.9995 {
				continue
			}
			db := cb.D
			if dot < 0 {
				db = -db
			}
			if gap := math.Abs(ca.D - db); gap > 1e-6 && gap < tol {
				out = append(out, [2]int{ids[a], ids[b]})
			}
		}
	}
	return out
}

// A plan must not create sliver contacts: thin strips of an earlier cut's
// face, left between two nearly-coincident later cuts on its two sides.
// This is the friend's helmet bug (cut 0 at Y, then Z cuts at 163.3 and
// 159.3 → a 56 mm², 4 mm wide contact with no room for any joint).
func TestNoStaggeredSiblingCuts(t *testing.T) {
	a1mini := Settings{Bed: Bed{180, 180, 180}, Margin: 3, AutoJoints: true, JointStyle: "filament"}
	cases := []struct {
		name string
		md   *Model
	}{
		{"sloped solid", func() *Model {
			m, _, err := mesh.Repair(slopedSoup(geom.Vec3{0, 0, 0}, 300, 150, 300, 262))
			if err != nil {
				t.Fatal(err)
			}
			return NewModel(m)
		}()},
		{"sloped shell", slopedShellModel(t, 300, 150, 300, 262, 7)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := a1mini
			pl, err := c.md.Run(&Request{Mode: "auto", Settings: s}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if !pl.Fits {
				t.Fatalf("plan does not fit")
			}
			for _, pr := range staggeredCuts(pl.Tree, pl.Settings.MinPiece) {
				a, b := pl.Tree.Nodes[pr[0]].Cut, pl.Tree.Nodes[pr[1]].Cut
				t.Errorf("staggered parallel cuts %d (d=%.1f) and %d (d=%.1f): a %.1f mm strip of the shared face becomes a sliver contact",
					pr[0], a.D, pr[1], b.D, math.Abs(math.Abs(a.D)-math.Abs(b.D)))
			}
			for _, p := range pl.Patches {
				if p.RMax < pl.Settings.MinWall {
					t.Errorf("patch %d on node %d is a sliver: area %.0f mm², largest inscribed radius %.1f mm < min wall %.1f", p.ID, p.Node, p.Area, p.RMax, pl.Settings.MinWall)
				}
			}
		})
	}
}
