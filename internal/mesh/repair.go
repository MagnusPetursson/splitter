package mesh

import (
	"fmt"
	"math"
	"sort"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

// RepairReport lists what the repair pipeline changed.
type RepairReport struct {
	InputTriangles      int      `json:"inputTriangles"`
	OutputTriangles     int      `json:"outputTriangles"`
	InputVertices       int      `json:"inputVertices"`
	OutputVertices      int      `json:"outputVertices"`
	WeldedVertices      int      `json:"weldedVertices"`
	DegenerateRemoved   int      `json:"degenerateRemoved"`
	DuplicateRemoved    int      `json:"duplicateRemoved"`
	FlippedFaces        int      `json:"flippedFaces"`
	InvertedShells      int      `json:"invertedShells"`
	HolesFilled         int      `json:"holesFilled"`
	HoleTriangles       int      `json:"holeTriangles"`
	LargestHolePerimMM  float64  `json:"largestHolePerimMM"`
	DebrisRemoved       int      `json:"debrisRemoved"`
	NonManifoldEdges    int      `json:"nonManifoldEdges"`
	NonManifoldResolved int      `json:"nonManifoldResolved"`
	Shells              int      `json:"shells"`
	Closed              bool     `json:"closed"`
	VolumeMM3           float64  `json:"volumeMM3"`
	Notes               []string `json:"notes"`
}

// Changed reports whether repair modified anything material.
func (r *RepairReport) Changed() bool {
	return r.DegenerateRemoved+r.DuplicateRemoved+r.FlippedFaces+r.InvertedShells+r.HolesFilled+r.DebrisRemoved+r.NonManifoldResolved > 0
}

// Weld converts a soup to an indexed mesh, merging coincident vertices.
// Vertices closer than tol (absolute, mm) are merged via a quantised hash.
func Weld(s *Soup, tol float64) (*Mesh, int) {
	m := &Mesh{F: make([][3]int32, 0, len(s.Tris))}
	type key [3]int64
	q := func(p geom.Vec3) key {
		return key{int64(math.Round(p[0] / tol)), int64(math.Round(p[1] / tol)), int64(math.Round(p[2] / tol))}
	}
	idx := make(map[key]int32, len(s.Tris))
	in := 0
	for _, t := range s.Tris {
		var f [3]int32
		for k := 0; k < 3; k++ {
			in++
			kk := q(t[k])
			id, ok := idx[kk]
			if !ok {
				// check neighbouring cells so points straddling a cell boundary merge
				found := false
				for dx := int64(-1); dx <= 1 && !found; dx++ {
					for dy := int64(-1); dy <= 1 && !found; dy++ {
						for dz := int64(-1); dz <= 1 && !found; dz++ {
							if dx == 0 && dy == 0 && dz == 0 {
								continue
							}
							if j, ok2 := idx[key{kk[0] + dx, kk[1] + dy, kk[2] + dz}]; ok2 {
								if m.V[j].Sub(t[k]).Len() <= tol {
									id, found = j, true
								}
							}
						}
					}
				}
				if !found {
					id = int32(len(m.V))
					m.V = append(m.V, t[k])
				}
				idx[kk] = id
			}
			f[k] = id
		}
		m.F = append(m.F, f)
	}
	return m, in - len(m.V)
}

// Repair runs the full pipeline on a soup.
func Repair(s *Soup) (*Mesh, *RepairReport, error) {
	rep := &RepairReport{InputTriangles: len(s.Tris), InputVertices: len(s.Tris) * 3}
	if len(s.Tris) == 0 {
		return nil, rep, fmt.Errorf("the file contains no triangles")
	}
	b := geom.EmptyAABB()
	for _, t := range s.Tris {
		for _, p := range t {
			b.Add(p)
		}
	}
	diag := b.Size().Len()
	if diag <= 0 {
		return nil, rep, fmt.Errorf("the model has zero size")
	}
	tol := math.Max(diag*1e-7, 1e-6)
	m, welded := Weld(s, tol)
	rep.WeldedVertices = welded

	// 1. degenerate (repeated index) faces
	out := m.F[:0]
	for _, f := range m.F {
		if f[0] == f[1] || f[1] == f[2] || f[0] == f[2] {
			rep.DegenerateRemoved++
			continue
		}
		out = append(out, f)
	}
	m.F = out

	// 2. duplicate faces (same vertex set). Opposite-oriented pairs are
	// internal double walls: remove both. Same-oriented copies: keep one.
	type fk [3]int32
	sortKey := func(f [3]int32) fk {
		a := []int32{f[0], f[1], f[2]}
		sort.Slice(a, func(i, j int) bool { return a[i] < a[j] })
		return fk{a[0], a[1], a[2]}
	}
	parity := func(f [3]int32) bool { // true if cyclic order is ascending rotation
		// rotate so the smallest index is first
		for f[0] > f[1] || f[0] > f[2] {
			f = [3]int32{f[1], f[2], f[0]}
		}
		return f[1] < f[2]
	}
	groups := map[fk][]int{}
	for i, f := range m.F {
		k := sortKey(f)
		groups[k] = append(groups[k], i)
	}
	drop := make([]bool, len(m.F))
	for _, g := range groups {
		if len(g) < 2 {
			continue
		}
		var pos, neg []int
		for _, i := range g {
			if parity(m.F[i]) {
				pos = append(pos, i)
			} else {
				neg = append(neg, i)
			}
		}
		// cancel opposite pairs
		for len(pos) > 0 && len(neg) > 0 {
			drop[pos[len(pos)-1]], drop[neg[len(neg)-1]] = true, true
			pos, neg = pos[:len(pos)-1], neg[:len(neg)-1]
			rep.DuplicateRemoved += 2
		}
		for _, rest := range [][]int{pos, neg} {
			for j := 1; j < len(rest); j++ {
				drop[rest[j]] = true
				rep.DuplicateRemoved++
			}
		}
	}
	m.F = filterFaces(m.F, drop)

	// 3. non-manifold edges: split them by duplicating vertices per fan
	rep.NonManifoldEdges = m.EdgeStats().NonManifold
	if rep.NonManifoldEdges > 0 {
		rep.NonManifoldResolved = resolveNonManifold(m)
	}

	// 4. consistent orientation via BFS across manifold edges
	rep.FlippedFaces = orient(m)

	// 5. fill holes
	nh, nt, perim := fillHoles(m)
	rep.HolesFilled, rep.HoleTriangles, rep.LargestHolePerimMM = nh, nt, perim
	if nh > 0 {
		rep.FlippedFaces += orient(m)
	}

	// 6. per-shell: drop debris, fix inside-out shells
	comps := m.Components()
	keep := make([]bool, len(m.F))
	var shellVol []float64
	for _, c := range comps {
		sub := m.Submesh(c)
		v := sub.Volume()
		// debris threshold is relative so models in metres or inches survive
		if len(c) < 4 || math.Abs(v) < 1e-9*diag*diag*diag {
			rep.DebrisRemoved++
			continue
		}
		if v < 0 {
			for _, fi := range c {
				f := m.F[fi]
				m.F[fi] = [3]int32{f[0], f[2], f[1]}
			}
			rep.InvertedShells++
		}
		for _, fi := range c {
			keep[fi] = true
		}
		shellVol = append(shellVol, math.Abs(v))
	}
	drop = make([]bool, len(m.F))
	for i := range m.F {
		drop[i] = !keep[i]
	}
	m.F = filterFaces(m.F, drop)
	m = compact(m)
	rep.Shells = len(shellVol)
	st := m.EdgeStats()
	rep.Closed = st.Boundary == 0 && st.NonManifold == 0 && st.Misoriented == 0
	rep.VolumeMM3 = m.Volume()
	rep.OutputTriangles = len(m.F)
	rep.OutputVertices = len(m.V)
	if !rep.Closed {
		rep.Notes = append(rep.Notes, fmt.Sprintf("mesh still has %d open and %d non-manifold edges after repair", st.Boundary, st.NonManifold))
	}
	if rep.LargestHolePerimMM > 0.25*diag {
		rep.Notes = append(rep.Notes, fmt.Sprintf("a large opening (perimeter %.3g model units) was capped flat; check that this was intended", rep.LargestHolePerimMM))
	}
	if rep.Shells > 1 {
		rep.Notes = append(rep.Notes, fmt.Sprintf("model has %d separate shells; overlapping shells are united by the boolean kernel", rep.Shells))
	}
	if len(m.F) == 0 {
		return nil, rep, fmt.Errorf("nothing printable remained after repair")
	}
	return m, rep, nil
}

func filterFaces(f [][3]int32, drop []bool) [][3]int32 {
	out := f[:0]
	for i, x := range f {
		if !drop[i] {
			out = append(out, x)
		}
	}
	return out
}

func compact(m *Mesh) *Mesh {
	used := make([]int32, len(m.V))
	for i := range used {
		used[i] = -1
	}
	out := &Mesh{F: make([][3]int32, len(m.F))}
	for i, f := range m.F {
		for k := 0; k < 3; k++ {
			if used[f[k]] < 0 {
				used[f[k]] = int32(len(out.V))
				out.V = append(out.V, m.V[f[k]])
			}
			out.F[i][k] = used[f[k]]
		}
	}
	return out
}

type halfEdge struct {
	face int
	a, b int32
}

func edgeFaces(m *Mesh) map[uint64][]halfEdge {
	mp := make(map[uint64][]halfEdge, len(m.F)*2)
	for i, f := range m.F {
		for k := 0; k < 3; k++ {
			a, b := f[k], f[(k+1)%3]
			key := edgeKey(a, b)
			mp[key] = append(mp[key], halfEdge{i, a, b})
		}
	}
	return mp
}

// resolveNonManifold detaches faces around edges shared by more than two
// faces: faces are paired by opposite orientation and each extra pair gets its
// own copies of the edge's vertices. Returns number of edges resolved.
func resolveNonManifold(m *Mesh) int {
	ef := edgeFaces(m)
	n := 0
	for _, hs := range ef {
		if len(hs) <= 2 {
			continue
		}
		n++
		// keep first opposite pair, detach the rest
		used := make([]bool, len(hs))
		paired := 0
		for i := 0; i < len(hs) && paired == 0; i++ {
			for j := i + 1; j < len(hs); j++ {
				if hs[i].a == hs[j].b && hs[i].b == hs[j].a {
					used[i], used[j] = true, true
					paired++
					break
				}
			}
		}
		if paired == 0 {
			used[0], used[1] = true, true
		}
		for i, h := range hs {
			if used[i] {
				continue
			}
			f := &m.F[h.face]
			for k := 0; k < 3; k++ {
				if f[k] == h.a || f[k] == h.b {
					m.V = append(m.V, m.V[f[k]])
					f[k] = int32(len(m.V) - 1)
				}
			}
		}
	}
	return n
}

func orient(m *Mesh) int {
	ef := edgeFaces(m)
	visited := make([]bool, len(m.F))
	flipped := 0
	queue := []int{}
	for seed := range m.F {
		if visited[seed] {
			continue
		}
		visited[seed] = true
		queue = append(queue[:0], seed)
		compFlips, compSize := 0, 0
		for len(queue) > 0 {
			compSize++
			fi := queue[0]
			queue = queue[1:]
			f := m.F[fi]
			for k := 0; k < 3; k++ {
				a, b := f[k], f[(k+1)%3]
				hs := ef[edgeKey(a, b)]
				if len(hs) != 2 {
					continue
				}
				for _, h := range hs {
					if h.face == fi || visited[h.face] {
						continue
					}
					g := m.F[h.face]
					// does g contain a->b in the same direction?
					same := false
					for j := 0; j < 3; j++ {
						if g[j] == a && g[(j+1)%3] == b {
							same = true
						}
					}
					if same {
						m.F[h.face] = [3]int32{g[0], g[2], g[1]}
						compFlips++
					}
					visited[h.face] = true
					queue = append(queue, h.face)
				}
			}
		}
		// ef only stores face membership per edge, which flipping doesn't change
		// If the seed face was the odd one out, the majority got flipped and
		// the inside-out fix later flips the shell back: report the faces
		// that actually change orientation.
		flipped += min(compFlips, compSize-compFlips)
	}
	return flipped
}

// fillHoles caps every boundary loop. Returns holes, triangles added, and the
// largest perimeter.
func fillHoles(m *Mesh) (int, int, float64) {
	ef := edgeFaces(m)
	next := map[int32][]int32{}
	for _, hs := range ef {
		if len(hs) == 1 {
			h := hs[0]
			// the cap must contain b->a; walk the loop in reverse: b -> a
			next[h.b] = append(next[h.b], h.a)
		}
	}
	holes, tris := 0, 0
	largest := 0.0
	for {
		var start int32 = -1
		for k, v := range next {
			if len(v) > 0 {
				start = k
				break
			}
		}
		if start < 0 {
			break
		}
		loop := []int32{start}
		cur := start
		for guard := 0; guard < 1<<22; guard++ {
			nx := next[cur]
			if len(nx) == 0 {
				break
			}
			n := nx[len(nx)-1]
			next[cur] = nx[:len(nx)-1]
			if n == start {
				break
			}
			loop = append(loop, n)
			cur = n
		}
		if len(loop) < 3 {
			continue
		}
		perim := 0.0
		for i := range loop {
			perim += m.V[loop[i]].Sub(m.V[loop[(i+1)%len(loop)]]).Len()
		}
		largest = math.Max(largest, perim)
		t := triangulateLoop(m, loop)
		m.F = append(m.F, t...)
		tris += len(t)
		holes++
	}
	return holes, tris, largest
}

// triangulateLoop ear-clips a 3D loop projected on its Newell plane; the loop
// order is already the cap's winding.
func triangulateLoop(m *Mesh, loop []int32) [][3]int32 {
	var n geom.Vec3
	for i := range loop {
		a, b := m.V[loop[i]], m.V[loop[(i+1)%len(loop)]]
		n[0] += (a[1] - b[1]) * (a[2] + b[2])
		n[1] += (a[2] - b[2]) * (a[0] + b[0])
		n[2] += (a[0] - b[0]) * (a[1] + b[1])
	}
	if n.Len() == 0 {
		return fan(loop)
	}
	fr := geom.PlaneFrame(n, 0)
	pts := make([]geom.Vec2, len(loop))
	for i, vi := range loop {
		pts[i] = fr.To2(m.V[vi])
	}
	idx := make([]int, len(loop))
	for i := range idx {
		idx[i] = i
	}
	if geom.PolygonArea(pts) < 0 { // projection reversed: walk backwards
		for i, j := 0, len(idx)-1; i < j; i, j = i+1, j-1 {
			idx[i], idx[j] = idx[j], idx[i]
		}
	}
	var out [][3]int32
	emit := func(a, b, c int) {
		// emit in original loop winding
		if geom.PolygonArea(pts) < 0 {
			out = append(out, [3]int32{loop[c], loop[b], loop[a]})
		} else {
			out = append(out, [3]int32{loop[a], loop[b], loop[c]})
		}
	}
	guard := 0
	for len(idx) > 3 && guard < 10*len(loop)*len(loop)+100 {
		guard++
		found := false
		for i := range idx {
			ia, ib, ic := idx[(i+len(idx)-1)%len(idx)], idx[i], idx[(i+1)%len(idx)]
			a, b, c := pts[ia], pts[ib], pts[ic]
			if b.Sub(a).Cross(c.Sub(b)) <= 1e-12 {
				continue
			}
			ok := true
			for _, j := range idx {
				if j == ia || j == ib || j == ic {
					continue
				}
				if inTri(pts[j], a, b, c) {
					ok = false
					break
				}
			}
			if !ok {
				continue
			}
			emit(ia, ib, ic)
			idx = append(idx[:i], idx[i+1:]...)
			found = true
			break
		}
		if !found {
			// fall back: fan the remainder
			for i := 1; i+1 < len(idx); i++ {
				emit(idx[0], idx[i], idx[i+1])
			}
			return out
		}
	}
	if len(idx) == 3 {
		emit(idx[0], idx[1], idx[2])
	}
	return out
}

func inTri(p, a, b, c geom.Vec2) bool {
	d1 := b.Sub(a).Cross(p.Sub(a))
	d2 := c.Sub(b).Cross(p.Sub(b))
	d3 := a.Sub(c).Cross(p.Sub(c))
	return d1 >= 0 && d2 >= 0 && d3 >= 0
}

func fan(loop []int32) [][3]int32 {
	var out [][3]int32
	for i := 1; i+1 < len(loop); i++ {
		out = append(out, [3]int32{loop[0], loop[i], loop[i+1]})
	}
	return out
}
