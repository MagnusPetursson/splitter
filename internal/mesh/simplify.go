package mesh

import (
	"fmt"
	"math"
	"time"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

// SimplifyOptions controls Simplify.
type SimplifyOptions struct {
	// TargetTris is the triangle count to stop at.
	TargetTris int
	// MaxError (mm) stops collapsing once the cheapest remaining edge
	// collapse would move the surface by more than this (quadric estimate).
	// 0 = no limit: simplify down to TargetTris whatever it costs.
	MaxError float64
	// Progress, when set, receives (done, total) in collapsed triangles.
	Progress func(done, total int)
}

// SimplifyReport describes a simplification and its measured deviation.
type SimplifyReport struct {
	InputTris  int     `json:"inputTris"`
	OutputTris int     `json:"outputTris"`
	MaxDev     float64 `json:"maxDev"`  // mm, measured (see Deviation)
	MeanDev    float64 `json:"meanDev"` // mm
	RMSDev     float64 `json:"rmsDev"`  // mm
	Samples    int     `json:"samples"` // points the deviation was measured at
	Shells     int     `json:"shells"`
	Closed     bool    `json:"closed"`
	Seconds    float64 `json:"seconds"`
	// Limited is true when MaxError stopped the simplification before
	// TargetTris was reached.
	Limited bool `json:"limited"`
	// Failed is set (and the full mesh kept) when simplification could
	// not keep the mesh closed.
	Failed string `json:"failed,omitempty"`
}

// symmetric 4×4 quadric, upper triangle
type quadric [10]float64

func planeQuadric(a, b, c, d float64) quadric {
	return quadric{a * a, a * b, a * c, a * d, b * b, b * c, b * d, c * c, c * d, d * d}
}

func (q *quadric) add(o *quadric) {
	for i := range q {
		q[i] += o[i]
	}
}

func (q *quadric) eval(p geom.Vec3) float64 {
	x, y, z := p[0], p[1], p[2]
	return q[0]*x*x + 2*q[1]*x*y + 2*q[2]*x*z + 2*q[3]*x + q[4]*y*y + 2*q[5]*y*z + 2*q[6]*y + q[7]*z*z + 2*q[8]*z + q[9]
}

func det3(a11, a12, a13, a21, a22, a23, a31, a32, a33 float64) float64 {
	return a11*a22*a33 + a13*a21*a32 + a12*a23*a31 - a13*a22*a31 - a11*a23*a32 - a12*a21*a33
}

type sTri struct {
	v       [3]int32
	err     [4]float32 // per edge (v[k], v[k+1]) and min
	deleted bool
	dirty   bool
}

type sVert struct {
	p            geom.Vec3
	q            quadric
	tstart, tcnt int32
}

type sRef struct {
	t int32
	k int8
}

type simplifier struct {
	V    []sVert
	T    []sTri
	refs []sRef
	// scratch
	mark  []int32
	stamp int32
}

// Simplify reduces a closed, manifold mesh by quadric-error edge
// collapse (Garland–Heckbert, in the iterative-threshold form of
// "fast quadric mesh simplification"). A collapse is only made when it
// keeps the surface a closed 2-manifold (the link condition: the two
// endpoints share exactly two neighbours) and flips no triangle, so the
// result stays watertight and keeps every shell. It returns an error and
// no mesh if the result is not closed or lost a shell; callers should
// then keep the original.
func Simplify(m *Mesh, opt SimplifyOptions) (*Mesh, *SimplifyReport, error) {
	t0 := time.Now()
	rep := &SimplifyReport{InputTris: len(m.F)}
	shellsBefore := len(m.Components())
	s := &simplifier{V: make([]sVert, len(m.V)), T: make([]sTri, len(m.F))}
	for i, v := range m.V {
		s.V[i].p = v
	}
	for i, f := range m.F {
		s.T[i].v = f
	}
	target := opt.TargetTris
	if target < 4 {
		target = 4
	}
	maxErr := math.Inf(1)
	if opt.MaxError > 0 {
		maxErr = opt.MaxError * opt.MaxError
	}
	// quadric errors are sums of squared distances (mm²); the threshold
	// schedule below is scaled to the model so flat areas go first
	bb := m.Bounds()
	scale := bb.Size().Len()
	if scale <= 0 {
		return nil, nil, fmt.Errorf("empty mesh")
	}
	s.initQuadrics()
	live := len(s.T)
	start := live
	deleted0 := make([]bool, 0, 64)
	deleted1 := make([]bool, 0, 64)
	limited := false
	for iter := 0; iter < 200 && live > target; iter++ {
		if iter%5 == 0 {
			s.compact()
		}
		for i := range s.T {
			s.T[i].dirty = false
		}
		// threshold grows each pass; scaled to the model so the schedule
		// is independent of units and size
		thr := 1e-12 * scale * scale * math.Pow(float64(iter+3), 6)
		if thr > maxErr {
			thr = maxErr
		}
		collapsed := 0
		for ti := range s.T {
			if live <= target {
				break
			}
			t := &s.T[ti]
			if t.deleted || t.dirty || float64(t.err[3]) > thr {
				continue
			}
			for j := 0; j < 3; j++ {
				if float64(t.err[j]) > thr {
					continue
				}
				i0, i1 := t.v[j], t.v[(j+1)%3]
				p, _ := s.edgeError(i0, i1)
				if !s.linkOK(i0, i1) {
					continue
				}
				deleted0 = s.flipped(p, i0, i1, deleted0)
				if deleted0 == nil {
					continue
				}
				deleted1 = s.flipped(p, i1, i0, deleted1)
				if deleted1 == nil {
					deleted0 = deleted0[:0]
					continue
				}
				v0 := &s.V[i0]
				v1 := &s.V[i1]
				v0.p = p
				v0.q.add(&v1.q)
				tstart := int32(len(s.refs))
				n := s.updateTris(i0, v0, deleted0)
				n += s.updateTris(i0, v1, deleted1)
				live -= n
				collapsed += n
				tcnt := int32(len(s.refs)) - tstart
				if tcnt <= v0.tcnt {
					// reuse v0's slot
					copy(s.refs[v0.tstart:], s.refs[tstart:tstart+tcnt])
					s.refs = s.refs[:tstart]
				} else {
					v0.tstart = tstart
				}
				v0.tcnt = tcnt
				v1.tcnt = 0
				break
			}
		}
		if opt.Progress != nil {
			opt.Progress(start-live, start-target)
		}
		checkpoint()
		if collapsed == 0 && thr >= maxErr {
			limited = live > target
			break
		}
	}
	s.compact()
	out := &Mesh{V: make([]geom.Vec3, 0, len(s.V)), F: make([][3]int32, 0, len(s.T))}
	remap := make([]int32, len(s.V))
	for i := range remap {
		remap[i] = -1
	}
	for _, t := range s.T {
		var f [3]int32
		for k := 0; k < 3; k++ {
			v := t.v[k]
			if remap[v] < 0 {
				remap[v] = int32(len(out.V))
				out.V = append(out.V, s.V[v].p)
			}
			f[k] = remap[v]
		}
		out.F = append(out.F, f)
	}
	rep.OutputTris = len(out.F)
	rep.Limited = limited
	rep.Closed = out.Closed()
	rep.Shells = len(out.Components())
	rep.Seconds = time.Since(t0).Seconds()
	if !rep.Closed {
		st := out.EdgeStats()
		return nil, rep, fmt.Errorf("simplified mesh is not closed (%d open, %d non-manifold edges)", st.Boundary, st.NonManifold)
	}
	if rep.Shells != shellsBefore {
		return nil, rep, fmt.Errorf("simplification changed the number of shells (%d → %d)", shellsBefore, rep.Shells)
	}
	return out, rep, nil
}

func (s *simplifier) triPlane(t *sTri) (geom.Vec3, float64, bool) {
	a, b, c := s.V[t.v[0]].p, s.V[t.v[1]].p, s.V[t.v[2]].p
	n := b.Sub(a).Cross(c.Sub(a))
	l := n.Len()
	if l < 1e-300 {
		return n, 0, false
	}
	n = n.Scale(1 / l)
	return n, -n.Dot(a), true
}

func (s *simplifier) initQuadrics() {
	for i := range s.T {
		t := &s.T[i]
		n, d, ok := s.triPlane(t)
		if !ok {
			continue
		}
		q := planeQuadric(n[0], n[1], n[2], d)
		for k := 0; k < 3; k++ {
			s.V[t.v[k]].q.add(&q)
		}
	}
	for i := range s.T {
		s.setTriErr(&s.T[i])
	}
}

func (s *simplifier) setTriErr(t *sTri) {
	for k := 0; k < 3; k++ {
		_, e := s.edgeError(t.v[k], t.v[(k+1)%3])
		t.err[k] = float32(e)
	}
	t.err[3] = min(t.err[0], t.err[1], t.err[2])
}

// edgeError returns the optimal position for collapsing (a, b) and its
// quadric error.
func (s *simplifier) edgeError(a, b int32) (geom.Vec3, float64) {
	q := s.V[a].q
	q.add(&s.V[b].q)
	det := det3(q[0], q[1], q[2], q[1], q[4], q[5], q[2], q[5], q[7])
	// relative conditioning: on a crease (two plane families) or a flat
	// area the 3×3 part is (nearly) singular and the "optimum" slides
	// along the crease, past its end; use the edge points instead
	tr := (q[0] + q[4] + q[7]) / 3
	if math.Abs(det) > 1e-6*tr*tr*tr {
		p := geom.Vec3{
			-1 / det * det3(q[1], q[2], q[3], q[4], q[5], q[6], q[5], q[7], q[8]),
			1 / det * det3(q[0], q[2], q[3], q[1], q[5], q[6], q[2], q[7], q[8]),
			-1 / det * det3(q[0], q[1], q[3], q[1], q[4], q[6], q[2], q[5], q[8]),
		}
		// keep the vertex near the edge: an ill-conditioned quadric can
		// put the optimum far away
		pa, pb := s.V[a].p, s.V[b].p
		mid := pa.Add(pb).Scale(0.5)
		if p.Sub(mid).Len() <= pa.Sub(pb).Len() {
			return p, math.Max(0, q.eval(p))
		}
	}
	pa, pb := s.V[a].p, s.V[b].p
	pm := pa.Add(pb).Scale(0.5)
	ea, eb, em := q.eval(pa), q.eval(pb), q.eval(pm)
	e := math.Min(ea, math.Min(eb, em))
	switch e {
	case ea:
		return pa, math.Max(0, ea)
	case eb:
		return pb, math.Max(0, eb)
	}
	return pm, math.Max(0, em)
}

// linkOK: an edge of a closed 2-manifold may be collapsed only when its
// endpoints have exactly two common neighbours (the apexes of its two
// triangles); otherwise the collapse pinches the surface.
func (s *simplifier) linkOK(a, b int32) bool {
	va, vb := &s.V[a], &s.V[b]
	if va.tcnt < 3 || vb.tcnt < 3 || va.tcnt+vb.tcnt <= 6 {
		// collapsing a tetrahedron-like corner would remove a shell
		return false
	}
	if len(s.mark) < len(s.V) {
		s.mark = make([]int32, len(s.V))
		s.stamp = 0
	}
	s.stamp++
	if s.stamp == math.MaxInt32 {
		for i := range s.mark {
			s.mark[i] = 0
		}
		s.stamp = 1
	}
	st := s.stamp
	for i := int32(0); i < va.tcnt; i++ {
		r := s.refs[va.tstart+i]
		t := &s.T[r.t]
		if t.deleted {
			continue
		}
		for k := 0; k < 3; k++ {
			s.mark[t.v[k]] = st
		}
	}
	common := 0
	st2 := st // count each common vertex once: re-stamp after counting
	s.stamp++
	seen := s.stamp
	for i := int32(0); i < vb.tcnt; i++ {
		r := s.refs[vb.tstart+i]
		t := &s.T[r.t]
		if t.deleted {
			continue
		}
		for k := 0; k < 3; k++ {
			v := t.v[k]
			if v == a || v == b {
				continue
			}
			if s.mark[v] == st2 {
				common++
				s.mark[v] = seen
			}
		}
	}
	return common == 2
}

// flipped checks the triangles around i0 (other than those shared with
// i1) when i0 moves to p. It returns nil if any would flip or degenerate,
// else the per-ref "deleted" flags (triangles containing i1).
func (s *simplifier) flipped(p geom.Vec3, i0, i1 int32, del []bool) []bool {
	v := &s.V[i0]
	del = del[:0]
	for k := int32(0); k < v.tcnt; k++ {
		r := s.refs[v.tstart+k]
		t := &s.T[r.t]
		if t.deleted {
			del = append(del, false)
			continue
		}
		s1 := t.v[(int(r.k)+1)%3]
		s2 := t.v[(int(r.k)+2)%3]
		if s1 == i1 || s2 == i1 {
			del = append(del, true)
			continue
		}
		d1 := s.V[s1].p.Sub(p)
		d2 := s.V[s2].p.Sub(p)
		l1, l2 := d1.Len(), d2.Len()
		if l1 < 1e-300 || l2 < 1e-300 {
			return nil
		}
		d1, d2 = d1.Scale(1/l1), d2.Scale(1/l2)
		if math.Abs(d1.Dot(d2)) > 0.999 {
			return nil
		}
		n := d1.Cross(d2)
		nl := n.Len()
		if nl < 1e-300 {
			return nil
		}
		n = n.Scale(1 / nl)
		on, _, ok := s.triPlane(t)
		if !ok || n.Dot(on) < 0.2 {
			return nil
		}
		del = append(del, false)
	}
	return del
}

func (s *simplifier) updateTris(i0 int32, v *sVert, del []bool) int {
	n := 0
	for k := int32(0); k < v.tcnt; k++ {
		r := s.refs[v.tstart+k]
		t := &s.T[r.t]
		if t.deleted {
			continue
		}
		if del[k] {
			t.deleted = true
			n++
			continue
		}
		t.v[r.k] = i0
		t.dirty = true
		s.setTriErr(t)
		s.refs = append(s.refs, r)
	}
	return n
}

// compact drops deleted triangles and rebuilds the vertex → triangle refs.
func (s *simplifier) compact() {
	dst := 0
	for i := range s.T {
		if !s.T[i].deleted {
			s.T[dst] = s.T[i]
			dst++
		}
	}
	s.T = s.T[:dst]
	for i := range s.V {
		s.V[i].tstart, s.V[i].tcnt = 0, 0
	}
	for i := range s.T {
		for k := 0; k < 3; k++ {
			s.V[s.T[i].v[k]].tcnt++
		}
	}
	var acc int32
	for i := range s.V {
		s.V[i].tstart = acc
		acc += s.V[i].tcnt
		s.V[i].tcnt = 0
	}
	if cap(s.refs) < int(acc) {
		s.refs = make([]sRef, acc, acc+acc/2)
	} else {
		s.refs = s.refs[:acc]
	}
	for i := range s.T {
		for k := 0; k < 3; k++ {
			v := &s.V[s.T[i].v[k]]
			s.refs[v.tstart+v.tcnt] = sRef{int32(i), int8(k)}
			v.tcnt++
		}
	}
}

// Deviation measures the distance between two surfaces by sampling: every
// vertex (up to maxSamples, evenly strided) of a is projected onto the
// closest point of b and vice versa. It returns the largest, mean and RMS
// distance and the number of samples. Vertex sampling can miss the exact
// Hausdorff maximum inside a large triangle, so treat MaxDev as measured,
// not a bound.
func Deviation(a, b *Mesh, maxSamples int) (maxD, mean, rms float64, n int) {
	ba := newClosestBVH(a)
	bb := newClosestBVH(b)
	var sum, sum2 float64
	one := func(src *Mesh, dst *closestBVH, quota int) {
		step := len(src.V)/quota + 1
		for i := 0; i < len(src.V); i += step {
			d := dst.dist(src.V[i])
			maxD = math.Max(maxD, d)
			sum += d
			sum2 += d * d
			n++
		}
	}
	checkpoint()
	one(a, bb, maxSamples/2)
	one(b, ba, maxSamples/2)
	if n > 0 {
		mean = sum / float64(n)
		rms = math.Sqrt(sum2 / float64(n))
	}
	return
}

type cbNode struct {
	box         geom.AABB
	left, right int32 // children, or -1
	first, cnt  int32 // leaf triangle range in order
}

type closestBVH struct {
	m     *Mesh
	nodes []cbNode
	order []int32
}

func triBox(m *Mesh, f [3]int32) geom.AABB {
	b := geom.EmptyAABB()
	b.Add(m.V[f[0]])
	b.Add(m.V[f[1]])
	b.Add(m.V[f[2]])
	return b
}

func newClosestBVH(m *Mesh) *closestBVH {
	b := &closestBVH{m: m, order: make([]int32, len(m.F))}
	cents := make([]geom.Vec3, len(m.F))
	for i, f := range m.F {
		b.order[i] = int32(i)
		cents[i] = m.V[f[0]].Add(m.V[f[1]]).Add(m.V[f[2]]).Scale(1.0 / 3)
	}
	var build func(lo, hi int) int32
	build = func(lo, hi int) int32 {
		box := geom.EmptyAABB()
		cb := geom.EmptyAABB()
		for _, t := range b.order[lo:hi] {
			tb := triBox(m, m.F[t])
			box.Add(tb.Min)
			box.Add(tb.Max)
			cb.Add(cents[t])
		}
		id := int32(len(b.nodes))
		b.nodes = append(b.nodes, cbNode{box: box, left: -1, right: -1, first: int32(lo), cnt: int32(hi - lo)})
		if hi-lo <= 8 {
			return id
		}
		sz := cb.Size()
		ax := 0
		if sz[1] > sz[ax] {
			ax = 1
		}
		if sz[2] > sz[ax] {
			ax = 2
		}
		mid := (lo + hi) / 2
		selectNth(b.order[lo:hi], mid-lo, func(t int32) float64 { return cents[t][ax] })
		l := build(lo, mid)
		r := build(mid, hi)
		b.nodes[id].left, b.nodes[id].right = l, r
		return id
	}
	if len(m.F) > 0 {
		build(0, len(m.F))
	}
	return b
}

// selectNth partially orders a so a[k] has rank k by key (quickselect).
func selectNth(a []int32, k int, key func(int32) float64) {
	lo, hi := 0, len(a)-1
	seed := uint32(2463534242)
	for lo < hi {
		seed ^= seed << 13
		seed ^= seed >> 17
		seed ^= seed << 5
		pv := key(a[lo+int(seed%uint32(hi-lo+1))])
		i, j := lo, hi
		for i <= j {
			for key(a[i]) < pv {
				i++
			}
			for key(a[j]) > pv {
				j--
			}
			if i <= j {
				a[i], a[j] = a[j], a[i]
				i++
				j--
			}
		}
		if k <= j {
			hi = j
		} else if k >= i {
			lo = i
		} else {
			return
		}
	}
}

func boxDist2(b geom.AABB, p geom.Vec3) float64 {
	d := 0.0
	for k := 0; k < 3; k++ {
		if p[k] < b.Min[k] {
			x := b.Min[k] - p[k]
			d += x * x
		} else if p[k] > b.Max[k] {
			x := p[k] - b.Max[k]
			d += x * x
		}
	}
	return d
}

func (b *closestBVH) dist(p geom.Vec3) float64 {
	best := math.Inf(1)
	stack := []int32{0}
	for len(stack) > 0 {
		id := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		nd := &b.nodes[id]
		if boxDist2(nd.box, p) >= best {
			continue
		}
		if nd.left < 0 {
			for _, t := range b.order[nd.first : nd.first+nd.cnt] {
				f := b.m.F[t]
				q := ClosestOnTri(p, b.m.V[f[0]], b.m.V[f[1]], b.m.V[f[2]])
				if d := q.Sub(p); d.Dot(d) < best {
					best = d.Dot(d)
				}
			}
			continue
		}
		l, r := nd.left, nd.right
		if boxDist2(b.nodes[l].box, p) > boxDist2(b.nodes[r].box, p) {
			l, r = r, l
		}
		stack = append(stack, r, l)
	}
	return math.Sqrt(best)
}

// ClosestOnTri returns the point of triangle abc closest to p (Ericson,
// Real-Time Collision Detection 5.1.5).
func ClosestOnTri(p, a, b, c geom.Vec3) geom.Vec3 {
	ab, ac, ap := b.Sub(a), c.Sub(a), p.Sub(a)
	d1, d2 := ab.Dot(ap), ac.Dot(ap)
	if d1 <= 0 && d2 <= 0 {
		return a
	}
	bp := p.Sub(b)
	d3, d4 := ab.Dot(bp), ac.Dot(bp)
	if d3 >= 0 && d4 <= d3 {
		return b
	}
	vc := d1*d4 - d3*d2
	if vc <= 0 && d1 >= 0 && d3 <= 0 {
		return a.Add(ab.Scale(d1 / (d1 - d3)))
	}
	cp := p.Sub(c)
	d5, d6 := ab.Dot(cp), ac.Dot(cp)
	if d6 >= 0 && d5 <= d6 {
		return c
	}
	vb := d5*d2 - d1*d6
	if vb <= 0 && d2 >= 0 && d6 <= 0 {
		return a.Add(ac.Scale(d2 / (d2 - d6)))
	}
	va := d3*d6 - d5*d4
	if va <= 0 && d4-d3 >= 0 && d5-d6 >= 0 {
		return b.Add(c.Sub(b).Scale((d4 - d3) / ((d4 - d3) + (d5 - d6))))
	}
	den := 1 / (va + vb + vc)
	v, w := vb*den, vc*den
	return a.Add(ab.Scale(v)).Add(ac.Scale(w))
}
