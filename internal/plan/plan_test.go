package plan

import (
	"math"
	"testing"

	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
)

func boxModel(t *testing.T, min, max geom.Vec3) *Model {
	t.Helper()
	m, _, err := mesh.Repair(mesh.Box(min, max))
	if err != nil {
		t.Fatal(err)
	}
	return NewModel(m)
}

// closed hollow box with thin walls (a crude shell, like the hat).
func shellModel(t *testing.T, w, d, h, wall float64) *Model {
	t.Helper()
	s := mesh.Box(geom.Vec3{0, 0, 0}, geom.Vec3{w, d, h})
	// closed hollow box: outer shell plus an inverted inner shell
	in := mesh.Box(geom.Vec3{wall, wall, wall}, geom.Vec3{w - wall, d - wall, h - wall})
	for _, tri := range in.Tris {
		s.Tris = append(s.Tris, [3]geom.Vec3{tri[0], tri[2], tri[1]})
	}
	m, rep, err := mesh.Repair(s)
	if err != nil {
		t.Fatal(err)
	}
	if !rep.Closed || rep.Shells != 2 {
		t.Fatalf("shell repair: %+v", rep)
	}
	return NewModel(m)
}

func TestRectFitDiagonal(t *testing.T) {
	// a 220×20 bar fits a 180×180 bed only diagonally ((220+20)/√2 ≈ 170)
	hull := geom.ConvexHull2([]geom.Vec2{{0, 0}, {220, 0}, {220, 20}, {0, 20}})
	ok, _, ex, ey := geom.RectFit(hull, 180, 180)
	if !ok || ex > 180 || ey > 180 {
		t.Fatalf("diagonal fit failed: %v %v %v", ok, ex, ey)
	}
	if ok, _, _, _ := geom.RectFit(geom.ConvexHull2([]geom.Vec2{{0, 0}, {300, 0}, {300, 20}, {0, 20}}), 180, 180); ok {
		t.Fatal("300 mm bar must not fit a 180 bed")
	}
}

func TestEDT(t *testing.T) {
	w, h := 41, 21
	mask := make([]bool, w*h)
	for j := 1; j < h-1; j++ {
		for i := 1; i < w-1; i++ {
			mask[j*w+i] = true
		}
	}
	d := geom.EDT(mask, w, h, 1)
	if c := d[10*w+20]; math.Abs(c-10) > 1e-9 {
		t.Fatalf("centre distance %v, want 10", c)
	}
}

func TestSplitCubeEveryPartFits(t *testing.T) {
	md := boxModel(t, geom.Vec3{0, 0, 0}, geom.Vec3{300, 300, 300})
	pl, err := md.Run(&Request{Mode: "auto", Settings: Settings{Bed: Bed{250, 220, 270}, Margin: 3, AutoJoints: true, JointStyle: "glued"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !pl.Fits || len(pl.Leaves) != 8 {
		t.Fatalf("expected 8 fitting parts, got %d fits=%v", len(pl.Leaves), pl.Fits)
	}
	per := map[int]int{}
	for _, j := range pl.Joints {
		per[j.Patch]++
		if len(j.Warnings) > 0 {
			t.Errorf("joint %d warnings: %v", j.ID, j.Warnings)
		}
		if j.HoleNeg+MinFloor > j.AvailNeg+1e-6 || j.HolePos+MinFloor > j.AvailPos+1e-6 {
			t.Errorf("joint %d holes deeper than material", j.ID)
		}
	}
	for _, p := range pl.Patches {
		if per[p.ID] < 2 {
			t.Errorf("patch %d has %d joints, want ≥ 2 for anti-rotation", p.ID, per[p.ID])
		}
	}
}

func TestFitsWithoutSplit(t *testing.T) {
	md := boxModel(t, geom.Vec3{0, 0, 0}, geom.Vec3{100, 50, 20})
	pl, err := md.Run(&Request{Mode: "auto", Settings: Settings{Bed: Bed{180, 180, 180}, AutoJoints: true}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(pl.Leaves) != 1 || !pl.Fits || len(pl.Joints) != 0 {
		t.Fatalf("small box should stay one part: %d parts", len(pl.Leaves))
	}
}

func TestThinShellGetsSeamNotPins(t *testing.T) {
	md := shellModel(t, 300, 160, 120, 2.4)
	pl, err := md.Run(&Request{Mode: "auto", Settings: Settings{Bed: Bed{180, 180, 180}, Margin: 3, AutoJoints: true, JointStyle: "glued"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !pl.Fits {
		t.Fatal("shell parts do not fit")
	}
	if len(pl.Patches) == 0 {
		t.Fatal("no cut")
	}
	for _, p := range pl.Patches {
		if p.Thickness > 3.5 {
			t.Errorf("patch %d thickness %.2f, want ≈ 2.4", p.ID, p.Thickness)
		}
		if p.Seam == nil || p.Seam.Kind == "none" {
			t.Errorf("patch %d: thin wall should get a seam joint", p.ID)
		}
	}
	for _, j := range pl.Joints {
		t.Errorf("unexpected point joint %s in a 2.4 mm wall", j.Kind)
	}
}

func TestManualTreeKeepsCut(t *testing.T) {
	md := boxModel(t, geom.Vec3{0, 0, 0}, geom.Vec3{200, 100, 50})
	tr := NewTree()
	tr.SplitLeaf(0, Plane{N: geom.Vec3{1, 0, 0}, D: 60})
	tr.Nodes[0].Locked = true
	pl, err := md.Run(&Request{Mode: "tree", Tree: tr, Settings: Settings{Bed: Bed{250, 210, 220}, AutoJoints: true}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(pl.Leaves) != 2 || pl.Tree.Nodes[0].Cut == nil || pl.Tree.Nodes[0].Cut.D != 60 {
		t.Fatalf("manual cut lost: %+v", pl.Tree.Nodes[0])
	}
	// the 60 mm side is smaller: both parts still fit
	if !pl.Fits {
		t.Fatal("parts should fit")
	}
}

func TestSectionOfBox(t *testing.T) {
	md := boxModel(t, geom.Vec3{0, 0, 0}, geom.Vec3{40, 30, 20})
	sec := md.Slicer(geom.Vec3{0, 0, 1}).Slice(10, nil)
	if math.Abs(sec.Area-1200) > 1e-6 || len(sec.Loops) != 1 {
		t.Fatalf("section area %v loops %d", sec.Area, len(sec.Loops))
	}
	// clip with x < 10
	sec = md.Slicer(geom.Vec3{0, 0, 1}).Slice(10, []HalfSpace{{P: Plane{N: geom.Vec3{1, 0, 0}, D: 10}, Side: -1}})
	if math.Abs(sec.Area-300) > 1e-6 {
		t.Fatalf("clipped area %v", sec.Area)
	}
}
