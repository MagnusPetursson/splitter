package mesh

import (
	"bytes"
	"math"
	"strings"
	"testing"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

func TestBoxRepairClean(t *testing.T) {
	m, rep, err := Repair(Box(geom.Vec3{0, 0, 0}, geom.Vec3{10, 20, 30}))
	if err != nil {
		t.Fatal(err)
	}
	if !rep.Closed || rep.Changed() {
		t.Fatalf("clean box reported changes: %+v", rep)
	}
	if math.Abs(m.Volume()-6000) > 1e-6 {
		t.Fatalf("volume %v", m.Volume())
	}
}

func TestRepairDefects(t *testing.T) {
	s := Box(geom.Vec3{0, 0, 0}, geom.Vec3{10, 10, 10})
	// flip one face, drop one face (hole), add a duplicate and a degenerate
	s.Tris[0][1], s.Tris[0][2] = s.Tris[0][2], s.Tris[0][1]
	s.Tris = append(s.Tris[:3], s.Tris[4:]...)
	s.Tris = append(s.Tris, s.Tris[5])
	s.Tris = append(s.Tris, [3]geom.Vec3{{1, 1, 1}, {1, 1, 1}, {2, 2, 2}})
	m, rep, err := Repair(s)
	if err != nil {
		t.Fatal(err)
	}
	if !rep.Closed {
		t.Fatalf("not closed: %+v", rep)
	}
	if rep.HolesFilled != 1 || rep.DegenerateRemoved != 1 || rep.DuplicateRemoved != 1 || rep.FlippedFaces == 0 {
		t.Fatalf("unexpected report %+v", rep)
	}
	if math.Abs(m.Volume()-1000) > 1e-6 {
		t.Fatalf("volume %v", m.Volume())
	}
}

func TestInsideOut(t *testing.T) {
	s := Box(geom.Vec3{0, 0, 0}, geom.Vec3{10, 10, 10})
	for i := range s.Tris {
		s.Tris[i][1], s.Tris[i][2] = s.Tris[i][2], s.Tris[i][1]
	}
	m, rep, _ := Repair(s)
	if rep.InvertedShells != 1 || m.Volume() <= 0 {
		t.Fatalf("inside-out not fixed: %+v", rep)
	}
}

func TestSTLRoundTripAndASCII(t *testing.T) {
	m, _, _ := Repair(Box(geom.Vec3{0, 0, 0}, geom.Vec3{1, 2, 3}))
	var buf bytes.Buffer
	if err := m.WriteBinarySTL(&buf, "x"); err != nil {
		t.Fatal(err)
	}
	s, kind, err := Load("a.stl", buf.Bytes())
	if err != nil || kind != "stl-binary" || len(s.Tris) != 12 {
		t.Fatalf("binary stl: %v %s %d", err, kind, len(s.Tris))
	}
	ascii := "solid t\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid t\n"
	s, kind, err = Load("b.stl", []byte(ascii))
	if err != nil || kind != "stl-ascii" || len(s.Tris) != 1 {
		t.Fatalf("ascii stl: %v %s", err, kind)
	}
	obj := "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1/1 2/2 3/3 4/4\n"
	s, _, err = Load("c.obj", []byte(obj))
	if err != nil || len(s.Tris) != 2 {
		t.Fatalf("obj: %v %d", err, len(s.Tris))
	}
	var enc bytes.Buffer
	m.EncodeBinary(&enc)
	m2, err := DecodeBinary(enc.Bytes())
	if err != nil || len(m2.F) != len(m.F) {
		t.Fatal("binary codec")
	}
}

func TestTinyUnitsSurvive(t *testing.T) {
	// a model exported in metres: 0.15 m box
	m, rep, err := Repair(Box(geom.Vec3{0, 0, 0}, geom.Vec3{0.15, 0.1, 0.05}))
	if err != nil || !rep.Closed || len(m.F) != 12 {
		t.Fatalf("metre-scale model lost: %v %+v", err, rep)
	}
}

// A refused mesh must say what is wrong with it, and that it is not a
// memory problem: the two failures look alike to users otherwise.
func TestRepairExplainNamesTheDefects(t *testing.T) {
	m, rep, err := Repair(Box(geom.Vec3{}, geom.Vec3{10, 10, 10}))
	if err != nil || m == nil || rep.Explain() != "" {
		t.Fatalf("closed box explains %q (%v)", rep.Explain(), err)
	}
	bad := &RepairReport{OpenEdges: 12, BadEdges: 3, HolesFilled: 2}
	s := bad.Explain()
	for _, want := range []string{"12 open edges", "3 edges are shared by more than two faces", "2 holes capped", "not a memory limit"} {
		if !strings.Contains(s, want) {
			t.Errorf("explanation %q lacks %q", s, want)
		}
	}
}
