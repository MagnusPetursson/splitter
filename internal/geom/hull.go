package geom

import (
	"math"
	"sort"
)

// ConvexHull2 returns the convex hull (counter-clockwise, no collinear points)
// using Andrew's monotone chain.
func ConvexHull2(pts []Vec2) []Vec2 {
	if len(pts) < 3 {
		out := make([]Vec2, len(pts))
		copy(out, pts)
		return out
	}
	p := make([]Vec2, len(pts))
	copy(p, pts)
	sort.Slice(p, func(i, j int) bool {
		if p[i][0] != p[j][0] {
			return p[i][0] < p[j][0]
		}
		return p[i][1] < p[j][1]
	})
	h := make([]Vec2, 0, 2*len(p))
	for _, q := range p {
		for len(h) >= 2 && h[len(h)-1].Sub(h[len(h)-2]).Cross(q.Sub(h[len(h)-2])) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, q)
	}
	lo := len(h) + 1
	for i := len(p) - 2; i >= 0; i-- {
		q := p[i]
		for len(h) >= lo && h[len(h)-1].Sub(h[len(h)-2]).Cross(q.Sub(h[len(h)-2])) <= 0 {
			h = h[:len(h)-1]
		}
		h = append(h, q)
	}
	return h[:len(h)-1]
}

// RectFit tells whether a 2D point set (given as its hull) fits into a w×h
// rectangle under some in-plane rotation. It returns the best rotation angle
// (radians) and the resulting extents. Angles are sampled at 0.5° and then
// refined; the result is exact for the reported angle.
func RectFit(hull []Vec2, w, h float64) (ok bool, angle float64, ex, ey float64) {
	if len(hull) == 0 {
		return true, 0, 0, 0
	}
	bestSlack := math.Inf(-1)
	eval := func(a float64) (float64, float64, float64) {
		c, s := math.Cos(a), math.Sin(a)
		minx, maxx, miny, maxy := math.Inf(1), math.Inf(-1), math.Inf(1), math.Inf(-1)
		for _, p := range hull {
			x := c*p[0] - s*p[1]
			y := s*p[0] + c*p[1]
			minx, maxx = math.Min(minx, x), math.Max(maxx, x)
			miny, maxy = math.Min(miny, y), math.Max(maxy, y)
		}
		dx, dy := maxx-minx, maxy-miny
		return math.Min(w-dx, h-dy), dx, dy
	}
	// Rotations of exactly 0/90° first so axis-aligned results stay tidy.
	for i := 0; i < 360; i++ {
		a := float64(i) * math.Pi / 360
		slack, dx, dy := eval(a)
		if slack > bestSlack+1e-9 {
			bestSlack, angle, ex, ey = slack, a, dx, dy
		}
	}
	// local refinement
	step := math.Pi / 720
	for it := 0; it < 20; it++ {
		for _, a := range []float64{angle - step, angle + step} {
			slack, dx, dy := eval(a)
			if slack > bestSlack+1e-9 {
				bestSlack, angle, ex, ey = slack, a, dx, dy
			}
		}
		step /= 2
	}
	return bestSlack >= 0, angle, ex, ey
}

// PolygonArea returns the signed area (CCW positive).
func PolygonArea(p []Vec2) float64 {
	a := 0.0
	for i := range p {
		j := (i + 1) % len(p)
		a += p[i].Cross(p[j])
	}
	return a / 2
}

// PointInPolygons uses the even-odd rule over all loops.
func PointInPolygons(loops [][]Vec2, q Vec2) bool {
	in := false
	for _, l := range loops {
		n := len(l)
		for i, j := 0, n-1; i < n; j, i = i, i+1 {
			a, b := l[i], l[j]
			if (a[1] > q[1]) != (b[1] > q[1]) {
				x := (b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1]) + a[0]
				if q[0] < x {
					in = !in
				}
			}
		}
	}
	return in
}
