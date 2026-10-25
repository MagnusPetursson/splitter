package plan

import (
	"math"
	"sort"

	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
)

// BVH is a simple median-split bounding volume hierarchy for ray casts.
type BVH struct {
	m     *mesh.Mesh
	nodes []bvhNode
	tris  []int32
}

type bvhNode struct {
	box         geom.AABB
	left, right int32 // children, or -1
	start, cnt  int32 // leaf range in tris
}

func BuildBVH(m *mesh.Mesh) *BVH {
	b := &BVH{m: m, tris: make([]int32, len(m.F))}
	cent := make([]geom.Vec3, len(m.F))
	for i, f := range m.F {
		b.tris[i] = int32(i)
		cent[i] = m.V[f[0]].Add(m.V[f[1]]).Add(m.V[f[2]]).Scale(1.0 / 3)
	}
	var build func(start, end int) int32
	build = func(start, end int) int32 {
		box := geom.EmptyAABB()
		cb := geom.EmptyAABB()
		for _, t := range b.tris[start:end] {
			f := m.F[t]
			for k := 0; k < 3; k++ {
				box.Add(m.V[f[k]])
			}
			cb.Add(cent[t])
		}
		id := int32(len(b.nodes))
		b.nodes = append(b.nodes, bvhNode{box: box, left: -1, right: -1, start: int32(start), cnt: int32(end - start)})
		if end-start <= 8 {
			return id
		}
		sz := cb.Size()
		axis := 0
		if sz[1] > sz[axis] {
			axis = 1
		}
		if sz[2] > sz[axis] {
			axis = 2
		}
		sub := b.tris[start:end]
		sort.Slice(sub, func(i, j int) bool { return cent[sub[i]][axis] < cent[sub[j]][axis] })
		mid := (start + end) / 2
		l := build(start, mid)
		r := build(mid, end)
		b.nodes[id].left, b.nodes[id].right = l, r
		b.nodes[id].cnt = 0
		return id
	}
	if len(m.F) > 0 {
		build(0, len(m.F))
	}
	return b
}

func rayBox(o, invd geom.Vec3, b geom.AABB, tmax float64) bool {
	t0, t1 := 0.0, tmax
	for k := 0; k < 3; k++ {
		ta := (b.Min[k] - o[k]) * invd[k]
		tb := (b.Max[k] - o[k]) * invd[k]
		if ta > tb {
			ta, tb = tb, ta
		}
		t0 = math.Max(t0, ta)
		t1 = math.Min(t1, tb)
		if t0 > t1 {
			return false
		}
	}
	return true
}

// Ray returns the distance to the nearest triangle hit along unit dir d from
// o (ignoring hits closer than tmin), or +Inf.
func (b *BVH) Ray(o, d geom.Vec3, tmin, tmax float64) float64 {
	if len(b.nodes) == 0 {
		return math.Inf(1)
	}
	inv := geom.Vec3{1 / d[0], 1 / d[1], 1 / d[2]}
	best := tmax
	stack := []int32{0}
	m := b.m
	for len(stack) > 0 {
		id := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		n := &b.nodes[id]
		if !rayBox(o, inv, n.box, best) {
			continue
		}
		if n.left < 0 {
			for _, t := range b.tris[n.start : n.start+n.cnt] {
				f := m.F[t]
				if h, ok := rayTri(o, d, m.V[f[0]], m.V[f[1]], m.V[f[2]]); ok && h > tmin && h < best {
					best = h
				}
			}
			continue
		}
		stack = append(stack, n.left, n.right)
	}
	if best >= tmax {
		return math.Inf(1)
	}
	return best
}

func rayTri(o, d, a, b, c geom.Vec3) (float64, bool) {
	e1 := b.Sub(a)
	e2 := c.Sub(a)
	p := d.Cross(e2)
	det := e1.Dot(p)
	if math.Abs(det) < 1e-14 {
		return 0, false
	}
	inv := 1 / det
	s := o.Sub(a)
	u := s.Dot(p) * inv
	if u < 0 || u > 1 {
		return 0, false
	}
	q := s.Cross(e1)
	v := d.Dot(q) * inv
	if v < 0 || u+v > 1 {
		return 0, false
	}
	t := e2.Dot(q) * inv
	return t, true
}
