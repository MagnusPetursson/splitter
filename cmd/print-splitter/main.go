package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
	"github.com/MagnusPetursson/splitter/internal/plan"
	"github.com/MagnusPetursson/splitter/internal/printers"
)

// cmdPlan: print-splitter plan [-printer id] [-style s] [-scale f] model > plan.json
func cmdPlan(args []string) error {
	fs := flag.NewFlagSet("plan", flag.ExitOnError)
	printer := fs.String("printer", "prusa-core-one", "printer preset id")
	style := fs.String("style", "glued", "joint style")
	scale := fs.Float64("scale", 1, "scale factor")
	margin := fs.Float64("margin", 3, "safety margin mm")
	meshOut := fs.String("mesh", "", "write repaired mesh (PSM1) here")
	tilted := fs.Bool("tilted", false, "allow tilted print orientations")
	upright := fs.Bool("upright", false, "print every part upright as modelled")
	supportWeight := fs.Float64("support-weight", 0.5, "0 = fewer parts (legacy), 1 = less support; geometric proxy only")
	fs.Parse(args)
	if fs.NArg() != 1 {
		return fmt.Errorf("usage: plan [flags] model")
	}
	m, rep, err := loadFile(fs.Arg(0))
	if err != nil {
		return err
	}
	if *scale != 1 {
		m.Scale(*scale)
	}
	pr, ok := printers.ByID(*printer)
	if !ok {
		return fmt.Errorf("unknown printer %q", *printer)
	}
	md := plan.NewModel(m)
	req := &plan.Request{Mode: "auto", Settings: plan.Settings{
		Bed: plan.Bed{X: pr.X, Y: pr.Y, Z: pr.Z}, Margin: *margin, Nozzle: pr.Nozzle,
		SupportWeight: supportWeight,
		JointStyle:    *style, AutoSplit: true, AutoJoints: true, Tilted: *tilted, Upright: *upright,
	}}
	pl, err := md.Run(req, func(s string) { fmt.Fprintln(os.Stderr, "…", s) })
	if err != nil {
		return err
	}
	if *meshOut != "" {
		f, err := os.Create(*meshOut)
		if err != nil {
			return err
		}
		m.EncodeBinary(f)
		f.Close()
	}
	fmt.Fprintf(os.Stderr, "repair: %+v\n", *rep)
	fmt.Fprintf(os.Stderr, "parts: %d, joints: %d, patches: %d, fits=%v, timing=%v\n", len(pl.Leaves), len(pl.Joints), len(pl.Patches), pl.Fits, pl.Timing)
	for _, l := range pl.Leaves {
		fmt.Fprintf(os.Stderr, "  %s fits=%v ext=%.1f×%.1f×%.1f face=%s overhang=%.0f%% %v\n", l.Label, l.Fits, l.Extent[0], l.Extent[1], l.Extent[2], l.PrintFace, 100*l.Overhang, l.Warnings)
	}
	for _, id := range pl.Tree.Internal() {
		n := pl.Tree.Nodes[id]
		fmt.Fprintf(os.Stderr, "  cut %d n=%.2f,%.2f,%.2f d=%.1f: %s\n", id, n.Cut.N[0], n.Cut.N[1], n.Cut.N[2], n.Cut.D, n.Reason)
	}
	for _, p := range pl.Patches {
		seam := ""
		if p.Seam != nil {
			seam = p.Seam.Kind
		}
		nj := 0
		for _, j := range pl.Joints {
			if j.Patch == p.ID {
				nj++
			}
		}
		fmt.Fprintf(os.Stderr, "  patch %d node %d: area %.0f rmax %.1f t %.1f ring=%v joints=%d seam=%s %v\n", p.ID, p.Node, p.Area, p.RMax, p.Thickness, p.Ring, nj, seam, p.Notes)
	}
	for _, j := range pl.Joints {
		if len(j.Warnings) > 0 {
			fmt.Fprintf(os.Stderr, "  joint %d %s: %v\n", j.ID, j.Kind, j.Warnings)
		}
	}
	enc := json.NewEncoder(os.Stdout)
	return enc.Encode(pl)
}

func loadFile(path string) (*mesh.Mesh, *mesh.RepairReport, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	s, _, err := mesh.Load(filepath.Base(path), data)
	if err != nil {
		return nil, nil, err
	}
	return mesh.Repair(s)
}

// cmdGen writes the synthetic parts of the test corpus.
func cmdGen(args []string) error {
	dir := "testdata/generated"
	if len(args) > 0 {
		dir = args[0]
	}
	os.MkdirAll(dir, 0o755)
	write := func(name string, s *mesh.Soup) error {
		f, err := os.Create(filepath.Join(dir, name))
		if err != nil {
			return err
		}
		defer f.Close()
		m := &mesh.Mesh{}
		for _, t := range s.Tris {
			n := int32(len(m.V))
			m.V = append(m.V, t[0], t[1], t[2])
			m.F = append(m.F, [3]int32{n, n + 1, n + 2})
		}
		return m.WriteBinarySTL(f, name)
	}
	// 1. cube larger than every bed
	if err := write("cube300.stl", mesh.Box(geom.Vec3{0, 0, 0}, geom.Vec3{300, 300, 300})); err != nil {
		return err
	}
	// 2. bunny scaled to ~260 mm and a damaged copy
	data, err := os.ReadFile("testdata/bunny_src.obj")
	if err != nil {
		return err
	}
	s, _, err := mesh.Load("bunny.obj", data)
	if err != nil {
		return err
	}
	b := geom.EmptyAABB()
	for _, t := range s.Tris {
		for _, p := range t {
			b.Add(p)
		}
	}
	sz := b.Size()
	k := 260 / maxf(sz[0], sz[1], sz[2])
	for i := range s.Tris {
		for j := 0; j < 3; j++ {
			p := s.Tris[i][j].Sub(b.Min).Scale(k)
			// bunny OBJ is Y-up; make it Z-up
			s.Tris[i][j] = geom.Vec3{p[0], -p[2] + sz[2]*k, p[1]}
		}
	}
	// the source bunny has open holes in its base; the repaired-only copy
	// tests hole capping, the damaged copy adds flipped/duplicate/degenerate faces
	if err := write("bunny260_holes.stl", s); err != nil {
		return err
	}
	d := &mesh.Soup{Tris: append([][3]geom.Vec3{}, s.Tris...)}
	for i := 0; i < len(d.Tris); i += 97 {
		d.Tris[i][1], d.Tris[i][2] = d.Tris[i][2], d.Tris[i][1]
	}
	for i := 5; i < len(d.Tris); i += 1013 {
		d.Tris = append(d.Tris, d.Tris[i])
	}
	d.Tris = append(d.Tris, [3]geom.Vec3{{10, 10, 10}, {10, 10, 10}, {20, 20, 20}})
	// remove a small patch of triangles to punch extra holes
	d.Tris = append(d.Tris[:2000], d.Tris[2004:]...)
	if err := write("bunny260_damaged.stl", d); err != nil {
		return err
	}
	fmt.Println("wrote", dir)
	return nil
}

func maxf(a ...float64) float64 {
	m := a[0]
	for _, x := range a[1:] {
		if x > m {
			m = x
		}
	}
	return m
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: print-splitter serve|plan|gen-testdata ...")
		os.Exit(2)
	}
	var err error
	switch strings.ToLower(os.Args[1]) {
	case "plan":
		err = cmdPlan(os.Args[2:])
	case "gen-testdata":
		err = cmdGen(os.Args[2:])
	case "serve":
		err = cmdServe(os.Args[2:])
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
