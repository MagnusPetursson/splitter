package plan

import (
	"math"
	"sort"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

// Bed is the usable build volume in mm (after margin).
type Bed struct {
	X, Y, Z float64
}

// FitResult describes the best print orientation found for a point set.
type FitResult struct {
	Fits   bool      `json:"fits"`
	Down   geom.Vec3 `json:"down"`   // model-space direction that points to the bed
	Angle  float64   `json:"angle"`  // in-plane rotation about Z after aligning
	Extent geom.Vec3 `json:"extent"` // footprint x, y and height in print orientation
	Slack  float64   `json:"slack"`  // smallest remaining room (mm), negative if not fitting
	Est    int       `json:"est"`    // estimated parts needed (1 if fits)
}

// candidateDowns returns de-duplicated unit directions (sign matters for
// final orientation but not for fit; both signs are kept).
func dedupeDirs(dirs []geom.Vec3, keepSign bool) []geom.Vec3 {
	var out []geom.Vec3
	for _, d := range dirs {
		d = d.Norm()
		if d.Len() == 0 {
			continue
		}
		dup := false
		for _, o := range out {
			c := o.Dot(d)
			if !keepSign {
				c = math.Abs(c)
			}
			if c > 0.9995 {
				dup = true
				break
			}
		}
		if !dup {
			out = append(out, d)
		}
	}
	return out
}

// FitPoints evaluates down directions and returns the best fitting one (max
// slack). pts should be a reasonably small representative set.
func FitPoints(pts []geom.Vec3, downs []geom.Vec3, bed Bed) FitResult {
	best := FitResult{Slack: math.Inf(-1), Est: math.MaxInt32}
	for _, d := range downs {
		// same basis as PrintTransform so the RectFit angle is directly usable
		r0 := geom.AlignToDown(d)
		p2 := make([]geom.Vec2, len(pts))
		lo, hi := math.Inf(1), math.Inf(-1)
		for i, p := range pts {
			q := r0.Apply(p)
			p2[i] = geom.Vec2{q[0], q[1]}
			z := q[2]
			lo, hi = math.Min(lo, z), math.Max(hi, z)
		}
		h := hi - lo
		hull := geom.ConvexHull2(p2)
		ok, ang, ex, ey := geom.RectFit(hull, bed.X, bed.Y)
		slack := math.Min(math.Min(bed.X-ex, bed.Y-ey), bed.Z-h)
		fits := ok && h <= bed.Z
		est := 1
		if !fits {
			e1 := ceilDiv(ex, bed.X) * ceilDiv(ey, bed.Y) * ceilDiv(h, bed.Z)
			e2 := ceilDiv(ex, bed.Y) * ceilDiv(ey, bed.X) * ceilDiv(h, bed.Z)
			est = min(e1, e2)
			if est < 2 {
				est = 2
			}
		}
		better := false
		switch {
		case fits && !best.Fits:
			better = true
		case fits == best.Fits && fits:
			better = slack > best.Slack+1e-6
		case fits == best.Fits && !fits:
			better = est < best.Est || (est == best.Est && slack > best.Slack)
		}
		if better {
			// in-plane rotation that makes the footprint axis-aligned: RectFit
			// rotates points by ang, so store it.
			best = FitResult{Fits: fits, Down: d, Angle: ang, Extent: geom.Vec3{ex, ey, h}, Slack: slack, Est: est}
		}
	}
	return best
}

// EstParts is a lower-bound-ish estimate of how many axis-aligned blocks a
// non-fitting piece needs: extents in the world and PCA frames, matched to
// the bed axes in the best permutation.
func EstParts(pts []geom.Vec3, bed Bed) int {
	if len(pts) == 0 {
		return 0
	}
	ax := PCA(pts)
	frames := [][3]geom.Vec3{{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}, ax}
	b := []float64{bed.X, bed.Y, bed.Z}
	perms := [][3]int{{0, 1, 2}, {0, 2, 1}, {1, 0, 2}, {1, 2, 0}, {2, 0, 1}, {2, 1, 0}}
	best := math.MaxInt32
	for _, f := range frames {
		var e [3]float64
		for k := 0; k < 3; k++ {
			lo, hi := math.Inf(1), math.Inf(-1)
			for _, p := range pts {
				x := p.Dot(f[k])
				lo, hi = math.Min(lo, x), math.Max(hi, x)
			}
			e[k] = hi - lo
		}
		for _, pm := range perms {
			n := ceilDiv(e[0], b[pm[0]]) * ceilDiv(e[1], b[pm[1]]) * ceilDiv(e[2], b[pm[2]])
			if n < best {
				best = n
			}
		}
	}
	return best
}

func ceilDiv(a, b float64) int {
	if b <= 0 {
		return 1 << 20
	}
	n := int(math.Ceil(a/b - 1e-9))
	if n < 1 {
		n = 1
	}
	return n
}

// PCA returns principal axes (unit, descending variance) of a point set.
func PCA(pts []geom.Vec3) [3]geom.Vec3 {
	var c geom.Vec3
	for _, p := range pts {
		c = c.Add(p)
	}
	if len(pts) == 0 {
		return [3]geom.Vec3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	}
	c = c.Scale(1 / float64(len(pts)))
	var m [3][3]float64
	for _, p := range pts {
		d := p.Sub(c)
		for i := 0; i < 3; i++ {
			for j := 0; j < 3; j++ {
				m[i][j] += d[i] * d[j]
			}
		}
	}
	// Jacobi eigen decomposition
	v := [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	for sweep := 0; sweep < 50; sweep++ {
		off := m[0][1]*m[0][1] + m[0][2]*m[0][2] + m[1][2]*m[1][2]
		if off < 1e-18 {
			break
		}
		for p := 0; p < 2; p++ {
			for q := p + 1; q < 3; q++ {
				if math.Abs(m[p][q]) < 1e-30 {
					continue
				}
				theta := (m[q][q] - m[p][p]) / (2 * m[p][q])
				t := math.Copysign(1, theta) / (math.Abs(theta) + math.Sqrt(theta*theta+1))
				cs := 1 / math.Sqrt(t*t+1)
				sn := t * cs
				for k := 0; k < 3; k++ {
					mkp, mkq := m[k][p], m[k][q]
					m[k][p] = cs*mkp - sn*mkq
					m[k][q] = sn*mkp + cs*mkq
				}
				for k := 0; k < 3; k++ {
					mpk, mqk := m[p][k], m[q][k]
					m[p][k] = cs*mpk - sn*mqk
					m[q][k] = sn*mpk + cs*mqk
				}
				for k := 0; k < 3; k++ {
					vkp, vkq := v[k][p], v[k][q]
					v[k][p] = cs*vkp - sn*vkq
					v[k][q] = sn*vkp + cs*vkq
				}
			}
		}
	}
	idx := []int{0, 1, 2}
	sort.Slice(idx, func(a, b int) bool { return m[idx[a]][idx[a]] > m[idx[b]][idx[b]] })
	var out [3]geom.Vec3
	for i, k := range idx {
		out[i] = geom.Vec3{v[0][k], v[1][k], v[2][k]}.Norm()
	}
	return out
}

// Representative reduces a point cloud to at most ~maxPts points that keep
// its outer shape: on a voxel grid each cell keeps the point farthest from
// the centroid. Hull error is bounded by the voxel size.
func Representative(pts []geom.Vec3, maxPts int) []geom.Vec3 {
	if len(pts) <= maxPts {
		return pts
	}
	b := geom.EmptyAABB()
	var c geom.Vec3
	for _, p := range pts {
		b.Add(p)
		c = c.Add(p)
	}
	c = c.Scale(1 / float64(len(pts)))
	sz := b.Size()
	// voxel size so that the surface (area-like) count is ~maxPts
	area := 2 * (sz[0]*sz[1] + sz[1]*sz[2] + sz[0]*sz[2])
	vox := math.Sqrt(area / float64(maxPts) * 1.5)
	if vox <= 0 {
		return pts[:maxPts]
	}
	type key [3]int32
	best := map[key]int{}
	bestD := map[key]float64{}
	for i, p := range pts {
		k := key{int32((p[0] - b.Min[0]) / vox), int32((p[1] - b.Min[1]) / vox), int32((p[2] - b.Min[2]) / vox)}
		d := p.Sub(c).Len()
		if od, ok := bestD[k]; !ok || d > od {
			bestD[k] = d
			best[k] = i
		}
	}
	out := make([]geom.Vec3, 0, len(best))
	for _, i := range best {
		out = append(out, pts[i])
	}
	// keep exact AABB extremes as well
	for axis := 0; axis < 3; axis++ {
		lo, hi := 0, 0
		for i, p := range pts {
			if p[axis] < pts[lo][axis] {
				lo = i
			}
			if p[axis] > pts[hi][axis] {
				hi = i
			}
		}
		out = append(out, pts[lo], pts[hi])
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i][0] != out[j][0] {
			return out[i][0] < out[j][0]
		}
		if out[i][1] != out[j][1] {
			return out[i][1] < out[j][1]
		}
		return out[i][2] < out[j][2]
	})
	return out
}
