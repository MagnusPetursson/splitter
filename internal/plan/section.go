package plan

import (
	"math"

	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
)

// Plane is the set n·x = d (n unit length).
type Plane struct {
	N geom.Vec3 `json:"n"`
	D float64   `json:"d"`
}

func (p Plane) Eval(x geom.Vec3) float64 { return p.N.Dot(x) - p.D }

// HalfSpace is side*(n·x - d) >= 0, side = -1 (neg child) or +1 (pos child).
type HalfSpace struct {
	P    Plane
	Side float64
}

func (h HalfSpace) Inside(x geom.Vec3, eps float64) bool { return h.Side*h.P.Eval(x) >= -eps }

// Loop2 is a closed polygon in a plane frame. ClipEdge[i] marks the edge
// from point i to i+1 as lying on a clip line (not on the model surface).
type Loop2 struct {
	P        []geom.Vec2
	ClipEdge []bool
}

// Section is a planar cross-section of the model.
type Section struct {
	Frame      geom.Frame
	Loops      []Loop2
	Area       float64
	Perimeter  float64 // surface-boundary length only
	GrazeFrac  float64 // fraction of seam length where the surface is nearly parallel to the cut
	SmallLoops int
	Thickness  float64 // 2A/P proxy
}

// Slicer precomputes per-normal vertex projections of the repaired model.
type Slicer struct {
	M     *mesh.Mesh
	N     geom.Vec3
	S     []float64 // n·v per vertex
	triLo []float64
	triHi []float64
	nrm   []geom.Vec3 // unit face normals
}

func NewSlicer(m *mesh.Mesh, n geom.Vec3, nrm []geom.Vec3) *Slicer {
	s := &Slicer{M: m, N: n, S: make([]float64, len(m.V)), triLo: make([]float64, len(m.F)), triHi: make([]float64, len(m.F)), nrm: nrm}
	for i, v := range m.V {
		s.S[i] = n.Dot(v)
	}
	for i, f := range m.F {
		a, b, c := s.S[f[0]], s.S[f[1]], s.S[f[2]]
		s.triLo[i] = math.Min(a, math.Min(b, c))
		s.triHi[i] = math.Max(a, math.Max(b, c))
	}
	return s
}

// FaceNormals returns unit normals for each triangle.
func FaceNormals(m *mesh.Mesh) []geom.Vec3 {
	out := make([]geom.Vec3, len(m.F))
	for i := range m.F {
		out[i] = m.TriNormal(i).Norm()
	}
	return out
}

type segRec struct {
	a, b   uint64 // edge keys
	pa, pb geom.Vec2
	graze  float64
}

func ekey(a, b int32) uint64 {
	if a > b {
		a, b = b, a
	}
	return uint64(uint32(a))<<32 | uint64(uint32(b))
}

// Slice computes the section at n·x = d, clipped to the given half-spaces.
func (s *Slicer) Slice(d float64, clip []HalfSpace) *Section {
	fr := geom.PlaneFrame(s.N, d)
	m := s.M
	var segs []segRec
	sv := func(i int32) float64 {
		x := s.S[i] - d
		if x == 0 {
			x = 1e-12
		}
		return x
	}
	for ti, f := range m.F {
		if s.triLo[ti] > d || s.triHi[ti] < d {
			continue
		}
		v0, v1, v2 := sv(f[0]), sv(f[1]), sv(f[2])
		vs := [3]float64{v0, v1, v2}
		pos := 0
		for _, x := range vs {
			if x > 0 {
				pos++
			}
		}
		if pos == 0 || pos == 3 {
			continue
		}
		// find lone vertex
		lone := -1
		for k := 0; k < 3; k++ {
			if (vs[k] > 0) == (pos == 1) {
				lone = k
			}
		}
		A := f[lone]
		B := f[(lone+1)%3]
		C := f[(lone+2)%3]
		ip := func(i, j int32) geom.Vec2 {
			si, sj := sv(i), sv(j)
			t := si / (si - sj)
			p := m.V[i].Lerp(m.V[j], t)
			return fr.To2(p)
		}
		pAB, pAC := ip(A, B), ip(A, C)
		kAB, kAC := ekey(A, B), ekey(A, C)
		// orient so that direction · (n × Ntri) > 0 (outer loops CCW)
		nt := s.nrm[ti]
		tang := s.N.Cross(nt)
		t2 := geom.Vec2{tang.Dot(fr.U), tang.Dot(fr.V)}
		r := segRec{a: kAB, b: kAC, pa: pAB, pb: pAC, graze: math.Abs(nt.Dot(s.N))}
		if pAC.Sub(pAB).Dot(t2) < 0 {
			r.a, r.b, r.pa, r.pb = kAC, kAB, pAC, pAB
		}
		segs = append(segs, r)
	}
	sec := &Section{Frame: fr}
	if len(segs) == 0 {
		return sec
	}
	// chain
	byStart := make(map[uint64]int, len(segs))
	for i, sg := range segs {
		byStart[sg.a] = i
	}
	used := make([]bool, len(segs))
	grazeLen, totLen := 0.0, 0.0
	var loops []Loop2
	for i := range segs {
		if used[i] {
			continue
		}
		var pts []geom.Vec2
		j := i
		for guard := 0; guard <= len(segs); guard++ {
			if used[j] {
				break
			}
			used[j] = true
			pts = append(pts, segs[j].pa)
			nx, ok := byStart[segs[j].b]
			if !ok {
				break
			}
			j = nx
		}
		if len(pts) >= 3 {
			loops = append(loops, Loop2{P: pts, ClipEdge: make([]bool, len(pts))})
		}
	}
	// clip
	for _, h := range clip {
		a, b, c := halfPlane2(fr, h)
		if a == 0 && b == 0 {
			if c < 0 {
				return &Section{Frame: fr}
			}
			continue
		}
		var out []Loop2
		for _, l := range loops {
			if cl := clipLoop(l, a, b, c); len(cl.P) >= 3 {
				out = append(out, cl)
			}
		}
		loops = out
	}
	// segment-based graze fraction (only segments inside the clip region)
	for _, sg := range segs {
		mid := sg.pa.Add(sg.pb).Scale(0.5)
		inside := true
		for _, h := range clip {
			a, b, c := halfPlane2(fr, h)
			if a*mid[0]+b*mid[1]+c < -1e-9 {
				inside = false
				break
			}
		}
		if !inside {
			continue
		}
		l := sg.pb.Sub(sg.pa).Len()
		totLen += l
		if sg.graze > 0.9 {
			grazeLen += l
		}
	}
	sec.Loops = loops
	for _, l := range loops {
		ar := geom.PolygonArea(l.P)
		sec.Area += ar
		if math.Abs(ar) < 25 && ar > 0 {
			sec.SmallLoops++
		}
		for i := range l.P {
			if !l.ClipEdge[i] {
				sec.Perimeter += l.P[(i+1)%len(l.P)].Sub(l.P[i]).Len()
			}
		}
	}
	if sec.Area < 0 { // inconsistent orientation (open/odd input); use magnitude
		sec.Area = -sec.Area
	}
	if totLen > 0 {
		sec.GrazeFrac = grazeLen / totLen
	}
	if sec.Perimeter > 0 {
		sec.Thickness = 2 * sec.Area / sec.Perimeter
	}
	return sec
}

// halfPlane2 expresses a 3D half-space restricted to the frame plane as
// a*u + b*v + c >= 0.
func halfPlane2(fr geom.Frame, h HalfSpace) (float64, float64, float64) {
	a := h.Side * h.P.N.Dot(fr.U)
	b := h.Side * h.P.N.Dot(fr.V)
	c := h.Side * (h.P.N.Dot(fr.O) - h.P.D)
	if math.Abs(a) < 1e-12 && math.Abs(b) < 1e-12 {
		return 0, 0, c
	}
	return a, b, c
}

// clipLoop is Sutherland–Hodgman against a*u+b*v+c >= 0 preserving clip-edge flags.
func clipLoop(l Loop2, a, b, c float64) Loop2 {
	n := len(l.P)
	val := func(p geom.Vec2) float64 { return a*p[0] + b*p[1] + c }
	var out Loop2
	for i := 0; i < n; i++ {
		p, q := l.P[i], l.P[(i+1)%n]
		vp, vq := val(p), val(q)
		pin, qin := vp >= 0, vq >= 0
		if pin {
			out.P = append(out.P, p)
			if qin {
				out.ClipEdge = append(out.ClipEdge, l.ClipEdge[i])
			} else {
				out.ClipEdge = append(out.ClipEdge, l.ClipEdge[i])
			}
		}
		if pin != qin {
			t := vp / (vp - vq)
			x := p.Add(q.Sub(p).Scale(t))
			out.P = append(out.P, x)
			// edge leaving the region becomes a clip edge until re-entry
			out.ClipEdge = append(out.ClipEdge, pin)
			if !pin {
				// entering: the previously appended point's edge (the clip
				// run) ends here; the new point's edge continues along q
				out.ClipEdge[len(out.ClipEdge)-1] = l.ClipEdge[i]
			}
		}
	}
	// fix: an exit point's outgoing edge runs along the clip line
	return out
}

// ClipPoly clips a convex polygon by a set of half-spaces in a frame.
func ClipPoly(fr geom.Frame, poly []geom.Vec2, hs []HalfSpace) []geom.Vec2 {
	l := Loop2{P: poly, ClipEdge: make([]bool, len(poly))}
	for _, h := range hs {
		a, b, c := halfPlane2(fr, h)
		if a == 0 && b == 0 {
			if c < 0 {
				return nil
			}
			continue
		}
		l = clipLoop(l, a, b, c)
		if len(l.P) < 3 {
			return nil
		}
	}
	return l.P
}
