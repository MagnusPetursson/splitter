package plan

import (
	"fmt"
	"math"
	"sort"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

// LeafInfo is a planned part with its print orientation.
type LeafInfo struct {
	ID        int       `json:"id"`
	Label     string    `json:"label"`
	Fits      bool      `json:"fits"`
	Down      geom.Vec3 `json:"down"`
	Angle     float64   `json:"angle"`
	Extent    geom.Vec3 `json:"extent"`
	Overhang  float64   `json:"overhang"` // fraction of surface needing support
	Contact   float64   `json:"contact"`  // mm² on the bed
	PrintFace string    `json:"printFace"`
	Center    geom.Vec3 `json:"center"`
	Bounds    geom.AABB `json:"bounds"`
	Warnings  []string  `json:"warnings,omitempty"`
	Empty     bool      `json:"empty,omitempty"`
}

type capInfo struct {
	normal geom.Vec3 // outward from the leaf
	area   float64
	center geom.Vec3
	node   int
	male   bool
}

func (md *Model) centroids() []geom.Vec3 {
	c := make([]geom.Vec3, len(md.M.F))
	for i, f := range md.M.F {
		c[i] = md.M.V[f[0]].Add(md.M.V[f[1]]).Add(md.M.V[f[2]]).Scale(1.0 / 3)
	}
	return c
}

// Orient chooses a print orientation for every leaf. male[leaf][node] marks
// cut faces that carry protruding joint features (cannot sit on the bed).
// Protrusion is a point of a male joint feature that sticks out of a leaf's
// cell; it counts towards the part's print size.
type Protrusion struct {
	Leaf int
	P    geom.Vec3
}

func (md *Model) Orient(t *Tree, faces []*Face, patches []*Patch, male map[[2]int]bool, prot []Protrusion, bed Bed) []*LeafInfo {
	if md.cents == nil {
		md.cents = md.centroids()
	}
	cents := md.cents
	var out []*LeafInfo
	frames := map[int]geom.Frame{}
	for _, f := range faces {
		frames[f.Node] = f.fr
	}
	for i, leaf := range t.Leaves() {
		li := &LeafInfo{ID: leaf, Label: fmt.Sprintf("P%d", i+1)}
		t.Nodes[leaf].Label = li.Label
		hs := t.Path(leaf)
		pts := md.CellPoints(hs)
		for _, pr := range prot {
			if pr.Leaf == leaf && len(pts) >= 4 {
				pts = append(pts, pr.P)
			}
		}
		if len(pts) < 4 {
			li.Empty = true
			li.Warnings = append(li.Warnings, "this region contains no material")
			out = append(out, li)
			continue
		}
		b := geom.EmptyAABB()
		for _, p := range pts {
			b.Add(p)
		}
		li.Bounds = b
		li.Center = b.Center()
		rep := Representative(pts, 3000)
		// triangles of this leaf
		tris := md.cellTris(hs)
		var caps []capInfo
		for _, p := range patches {
			fr := frames[p.Node]
			c3 := fr.To3(p.Centroid)
			if p.NegLeaf == leaf {
				caps = append(caps, capInfo{normal: fr.N, area: p.Area, center: c3, node: p.Node, male: male[[2]int{leaf, p.Node}]})
			}
			if p.PosLeaf == leaf {
				caps = append(caps, capInfo{normal: fr.N.Scale(-1), area: p.Area, center: c3, node: p.Node, male: male[[2]int{leaf, p.Node}]})
			}
		}
		// merge caps per node
		sort.Slice(caps, func(a, b int) bool { return caps[a].node < caps[b].node })
		var mcaps []capInfo
		for _, c := range caps {
			if n := len(mcaps); n > 0 && mcaps[n-1].node == c.node {
				m := &mcaps[n-1]
				m.center = m.center.Scale(m.area).Add(c.center.Scale(c.area)).Scale(1 / (m.area + c.area))
				m.area += c.area
				m.male = m.male || c.male
				continue
			}
			mcaps = append(mcaps, c)
		}
		caps = mcaps
		totalArea := 0.0
		for _, ti := range tris {
			totalArea += md.Area[ti]
		}
		for _, c := range caps {
			totalArea += c.area
		}
		// candidate downs (signed)
		type cand struct {
			d    geom.Vec3
			name string
		}
		var cands []cand
		for _, c := range caps {
			if !c.male {
				cands = append(cands, cand{c.normal, fmt.Sprintf("cut face %d", c.node)})
			}
		}
		for _, d := range flatDirs(md, tris, 6) {
			cands = append(cands, cand{d, "flat face"})
		}
		ax := PCA(rep)
		for _, d := range []geom.Vec3{{0, 0, -1}, {0, 0, 1}, {1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}} {
			cands = append(cands, cand{d, "axis"})
		}
		if md.Tilted {
			for _, d := range []geom.Vec3{ax[0], ax[0].Scale(-1), ax[1], ax[1].Scale(-1), ax[2], ax[2].Scale(-1)} {
				cands = append(cands, cand{d, "tilted"})
			}
		}
		if md.Upright {
			cands = []cand{{geom.Vec3{0, 0, -1}, "as modelled (upright)"}}
		}
		type scored struct {
			li   LeafInfo
			cost float64
		}
		var ranked []scored
		seen := []geom.Vec3{}
		for _, c := range cands {
			d := c.d.Norm()
			dup := false
			for _, s := range seen {
				if s.Dot(d) > 0.9995 {
					dup = true
				}
			}
			if dup {
				continue
			}
			seen = append(seen, d)
			// a cut face carrying male features cannot be the bed face
			blocked := false
			for _, cp := range caps {
				if cp.male && cp.normal.Dot(d) > 0.985 {
					blocked = true
				}
			}
			if blocked {
				continue
			}
			f := FitPoints(rep, []geom.Vec3{d}, bed)
			maxDot := math.Inf(-1)
			for _, p := range rep {
				maxDot = math.Max(maxDot, p.Dot(d))
			}
			over, contact := 0.0, 0.0
			for _, ti := range tris {
				nd := md.Nrm[ti].Dot(d)
				h := maxDot - cents[ti].Dot(d)
				if nd > 0.985 && h < 0.4 {
					contact += md.Area[ti]
				} else if nd > 0.707 && h > 0.6 {
					over += md.Area[ti]
				}
			}
			for _, cp := range caps {
				nd := cp.normal.Dot(d)
				h := maxDot - cp.center.Dot(d)
				if nd > 0.985 && h < 0.4 {
					contact += cp.area
				} else if nd > 0.707 && h > 0.6 {
					over += cp.area
				}
			}
			overFrac := over / math.Max(totalArea, 1e-9)
			cost := 100*overFrac + 12*f.Extent[2]/bed.Z - 25*math.Min(1, contact/math.Max(1, 0.25*f.Extent[0]*f.Extent[1]))
			if c.name == "cut face 0" || c.name == "flat face" || (len(c.name) > 8 && c.name[:8] == "cut face") {
				cost -= 2
			}
			if c.name == "tilted" {
				cost += 3
			}
			if !f.Fits {
				cost += 1e4 + 100*float64(EstParts(rep, bed))
			}
			ranked = append(ranked, scored{LeafInfo{Fits: f.Fits, Down: d, Angle: f.Angle, Extent: f.Extent, Overhang: overFrac, Contact: contact, PrintFace: c.name}, cost})
		}
		sort.SliceStable(ranked, func(a, b int) bool { return ranked[a].cost < ranked[b].cost })
		// confirm on the exact point set, in cost order
		chosen := false
		for _, r := range ranked {
			ex := FitPoints(pts, []geom.Vec3{r.li.Down}, bed)
			if ex.Fits || !r.li.Fits {
				li.Fits, li.Down, li.Angle, li.Extent = ex.Fits, r.li.Down, ex.Angle, ex.Extent
				li.Overhang, li.Contact, li.PrintFace = r.li.Overhang, r.li.Contact, r.li.PrintFace
				chosen = true
				if ex.Fits || !r.li.Fits {
					break
				}
			}
		}
		if !chosen && len(ranked) > 0 {
			r := ranked[0]
			ex := FitPoints(pts, []geom.Vec3{r.li.Down}, bed)
			li.Fits, li.Down, li.Angle, li.Extent = ex.Fits, r.li.Down, ex.Angle, ex.Extent
		}
		if !li.Fits {
			li.Warnings = append(li.Warnings, fmt.Sprintf("does not fit the build volume (%.0f×%.0f×%.0f mm)", li.Extent[0], li.Extent[1], li.Extent[2]))
		}
		if li.Overhang > 0.15 {
			li.Warnings = append(li.Warnings, fmt.Sprintf("%.0f%% of the surface overhangs: needs supports", 100*li.Overhang))
		}
		out = append(out, li)
	}
	return out
}

// flatDirs finds the k largest planar regions by binning triangle normals.
func flatDirs(md *Model, tris []int, k int) []geom.Vec3 {
	type bin struct {
		n    geom.Vec3
		area float64
	}
	bins := map[[3]int]*bin{}
	for _, ti := range tris {
		n := md.Nrm[ti]
		key := [3]int{int(math.Round(n[0] * 20)), int(math.Round(n[1] * 20)), int(math.Round(n[2] * 20))}
		b := bins[key]
		if b == nil {
			b = &bin{}
			bins[key] = b
		}
		b.n = b.n.Add(n.Scale(md.Area[ti]))
		b.area += md.Area[ti]
	}
	var list []*bin
	for _, b := range bins {
		list = append(list, b)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].area != list[j].area {
			return list[i].area > list[j].area
		}
		return list[i].n[0] < list[j].n[0]
	})
	var out []geom.Vec3
	for i := 0; i < len(list) && len(out) < k; i++ {
		if list[i].area < 50 {
			break
		}
		// the outward normal of a flat face points to the bed when laid on it
		out = append(out, list[i].n.Norm())
	}
	return out
}

// PrintTransform returns the rotation that puts the part in print
// orientation: down → -Z then the in-plane rotation from RectFit.
func PrintTransform(down geom.Vec3, angle float64) geom.Mat3 {
	r := geom.AlignToDown(down)
	return geom.RotateZ(angle).Mul(r)
}
