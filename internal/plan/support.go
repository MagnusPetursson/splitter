package plan

import (
	"math"
	"sort"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

// Support is an area × height-to-bed proxy, NOT slicer support material.
// A 40×40 projected raster unions overlapping downward faces. Each covered
// pixel contributes height / cos(normal, down) × pixel area, approximating
// actual face area rather than projected area. It ignores bridging, support
// density, support resting on the model, trees, and joint geometry.
const supportGrid = 40
const overhangCos = 0.7071067811865476 // cos(45°); strictly steeper only
const bedContactTolerance = 0.6        // mm; suppress bed contact, not whole low faces

type supportPoly struct {
	p []geom.Vec3
	n geom.Vec3
}
type supportCap struct {
	sec *Section
	n   geom.Vec3
}
type supportCell struct {
	polys []supportPoly
	caps  []supportCap
}

// Clip actual triangles, not their centroids: large triangles frequently
// straddle several parts (a twelve-triangle cube is the important case).
func (md *Model) supportGeometry(hs []HalfSpace) *supportCell {
	cell := &supportCell{}
	for ti, f := range md.M.F {
		p := []geom.Vec3{md.M.V[f[0]], md.M.V[f[1]], md.M.V[f[2]]}
		for _, h := range hs {
			if len(p) < 3 {
				break
			}
			var out []geom.Vec3
			for i, a := range p {
				b := p[(i+1)%len(p)]
				da, db := h.Side*h.P.Eval(a), h.Side*h.P.Eval(b)
				if da >= 0 {
					out = append(out, a)
				}
				if (da >= 0) != (db >= 0) {
					out = append(out, a.Lerp(b, da/(da-db)))
				}
			}
			p = out
		}
		if len(p) >= 3 {
			cell.polys = append(cell.polys, supportPoly{p, md.Nrm[ti]})
		}
	}
	for i, h := range hs {
		others := append([]HalfSpace{}, hs[:i]...)
		others = append(others, hs[i+1:]...)
		sec := md.Slicer(h.P.N).Slice(h.P.D, others)
		cell.caps = append(cell.caps, supportCap{sec, h.P.N.Scale(-h.Side)})
	}
	return cell
}

func (cell *supportCell) estimate(pts []geom.Vec3, down geom.Vec3) float64 {
	if len(pts) == 0 {
		return 0
	}
	r := geom.AlignToDown(down)
	bounds := geom.EmptyAABB()
	for _, p := range pts {
		bounds.Add(r.Apply(p))
	}
	size := bounds.Size()
	dx, dy := size[0]/supportGrid, size[1]/supportGrid
	if dx <= 1e-9 || dy <= 1e-9 {
		return 0
	}
	var columns [supportGrid * supportGrid]float64
	set := func(x, y int, z, nd float64) {
		h := z - bounds.Min[2]
		if h > bedContactTolerance {
			idx := y*supportGrid + x
			columns[idx] = math.Max(columns[idx], h/nd)
		}
	}
	// Rasterise each clipped convex triangle polygon as a fan. Max per pixel
	// removes shared-edge hits and stacked duplicate support columns.
	for _, poly := range cell.polys {
		nd := poly.n.Dot(down)
		if nd <= overhangCos+1e-9 {
			continue
		}
		a := r.Apply(poly.p[0])
		for i := 1; i+1 < len(poly.p); i++ {
			b, c := r.Apply(poly.p[i]), r.Apply(poly.p[i+1])
			den := (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1])
			if math.Abs(den) < 1e-12 {
				continue
			}
			x0 := max(0, int(math.Floor((min(a[0], b[0], c[0])-bounds.Min[0])/dx)))
			x1 := min(supportGrid-1, int(math.Floor((max(a[0], b[0], c[0])-bounds.Min[0])/dx)))
			y0 := max(0, int(math.Floor((min(a[1], b[1], c[1])-bounds.Min[1])/dy)))
			y1 := min(supportGrid-1, int(math.Floor((max(a[1], b[1], c[1])-bounds.Min[1])/dy)))
			for y := y0; y <= y1; y++ {
				for x := x0; x <= x1; x++ {
					px, py := bounds.Min[0]+(float64(x)+0.5)*dx, bounds.Min[1]+(float64(y)+0.5)*dy
					u := ((b[1]-c[1])*(px-c[0]) + (c[0]-b[0])*(py-c[1])) / den
					v := ((c[1]-a[1])*(px-c[0]) + (a[0]-c[0])*(py-c[1])) / den
					if u >= -1e-9 && v >= -1e-9 && u+v <= 1+1e-9 {
						set(x, y, u*a[2]+v*b[2]+(1-u-v)*c[2], nd)
					}
				}
			}
		}
	}
	// Cut caps include holes and disconnected patches, using even-odd loops.
	// Their winding is independent of the child's outward normal.
	for _, cap := range cell.caps {
		nd := cap.n.Dot(down)
		if nd <= overhangCos+1e-9 {
			continue
		}
		var loops [][]geom.Vec2
		for _, l := range cap.sec.Loops {
			var loop []geom.Vec2
			for _, p := range l.P {
				q := r.Apply(cap.sec.Frame.To3(p))
				loop = append(loop, geom.Vec2{q[0], q[1]})
			}
			loops = append(loops, loop)
		}
		n, o := r.Apply(cap.n), r.Apply(cap.sec.Frame.O)
		for y := 0; y < supportGrid; y++ {
			for x := 0; x < supportGrid; x++ {
				px, py := bounds.Min[0]+(float64(x)+0.5)*dx, bounds.Min[1]+(float64(y)+0.5)*dy
				if geom.PointInPolygons(loops, geom.Vec2{px, py}) {
					z := o[2] - (n[0]*(px-o[0])+n[1]*(py-o[1]))/n[2]
					set(x, y, z, nd)
				}
			}
		}
	}
	total := 0.0
	for _, h := range columns {
		total += h
	}
	return total * dx * dy
}

// At the default 0.5, saving about 100 cm³ of proxy pays for one extra
// part (100 score units), before seam penalties. At 1 it takes 25 cm³.
// A nonzero part penalty even at 1 prevents gratuitous fragmentation.
func supportCost(volume, weight float64) float64 { return volume * 0.004 * weight * weight }

// Pick the least-cost feasible signed direction. Fit alone is sign-invariant;
// supports are not. Reusing only FitPoints' arbitrary sign hides open shells.
func (md *Model) supportFit(pts []geom.Vec3, hs []HalfSpace, downs []geom.Vec3, bed Bed, weight float64) (FitResult, float64) {
	cell := md.supportGeometry(hs)
	var dirs []geom.Vec3
	for _, d := range downs {
		dirs = append(dirs, d)
		if !md.Upright {
			dirs = append(dirs, d.Scale(-1))
		}
	}
	dirs = dedupeDirs(dirs, true)
	type scored struct {
		fit          FitResult
		volume, cost float64
	}
	var ranked []scored
	rep := Representative(pts, 2500)
	for _, d := range dirs {
		f := FitPoints(rep, []geom.Vec3{d}, bed)
		volume := cell.estimate(pts, d)
		cost := supportCost(volume, weight) + 12*f.Extent[2]/bed.Z
		if !f.Fits {
			cost += 100 * float64(f.Est)
		}
		ranked = append(ranked, scored{f, volume, cost})
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].fit.Fits != ranked[j].fit.Fits {
			return ranked[i].fit.Fits
		}
		return ranked[i].cost < ranked[j].cost
	})
	if len(ranked) == 0 {
		return FitResult{}, 0
	}
	// Exact hulls dominate runtime on dense meshes. Only confirm them in
	// score order, never using approximate fit as a final feasibility gate.
	var fallback FitResult
	for i, r := range ranked {
		ex := FitPoints(pts, []geom.Vec3{r.fit.Down}, bed)
		if i == 0 {
			fallback = ex
		}
		if ex.Fits {
			return ex, r.volume
		}
		if !r.fit.Fits {
			break
		}
	}
	return fallback, ranked[0].volume
}
