// Package mesh provides an indexed triangle mesh, file import/export
// (STL, OBJ, 3MF) and a repair pipeline that produces closed, consistently
// oriented meshes suitable for the Manifold boolean kernel.
package mesh

import (
	"encoding/binary"
	"io"
	"math"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

// Mesh is an indexed triangle mesh in millimetres.
type Mesh struct {
	V []geom.Vec3
	F [][3]int32
}

func (m *Mesh) Clone() *Mesh {
	c := &Mesh{V: make([]geom.Vec3, len(m.V)), F: make([][3]int32, len(m.F))}
	copy(c.V, m.V)
	copy(c.F, m.F)
	return c
}

func (m *Mesh) Bounds() geom.AABB {
	b := geom.EmptyAABB()
	for _, v := range m.V {
		b.Add(v)
	}
	return b
}

// TriNormal returns the unnormalised normal (twice the area vector).
func (m *Mesh) TriNormal(i int) geom.Vec3 {
	f := m.F[i]
	a, b, c := m.V[f[0]], m.V[f[1]], m.V[f[2]]
	return b.Sub(a).Cross(c.Sub(a))
}

// Volume is the signed enclosed volume (positive for outward-oriented closed meshes).
func (m *Mesh) Volume() float64 {
	s := 0.0
	for _, f := range m.F {
		a, b, c := m.V[f[0]], m.V[f[1]], m.V[f[2]]
		s += a.Dot(b.Cross(c))
	}
	return s / 6
}

func (m *Mesh) Area() float64 {
	s := 0.0
	for i := range m.F {
		s += m.TriNormal(i).Len() / 2
	}
	return s
}

// Transform applies p' = R p + t to every vertex (R must be a rotation).
func (m *Mesh) Transform(r geom.Mat3, t geom.Vec3) {
	for i, v := range m.V {
		m.V[i] = r.Apply(v).Add(t)
	}
}

func (m *Mesh) Scale(s float64) {
	for i, v := range m.V {
		m.V[i] = v.Scale(s)
	}
}

// EdgeStats counts boundary (1 face) and non-manifold (>2 faces) edges, and
// edges whose two faces disagree on orientation.
type EdgeStats struct {
	Edges, Boundary, NonManifold, Misoriented int
}

func edgeKey(a, b int32) uint64 {
	if a > b {
		a, b = b, a
	}
	return uint64(uint32(a))<<32 | uint64(uint32(b))
}

func (m *Mesh) EdgeStats() EdgeStats {
	type rec struct{ n, dir int }
	mp := make(map[uint64]*rec, len(m.F)*2)
	for _, f := range m.F {
		for k := 0; k < 3; k++ {
			a, b := f[k], f[(k+1)%3]
			key := edgeKey(a, b)
			r := mp[key]
			if r == nil {
				r = &rec{}
				mp[key] = r
			}
			r.n++
			if a < b {
				r.dir++
			} else {
				r.dir--
			}
		}
	}
	var s EdgeStats
	s.Edges = len(mp)
	for _, r := range mp {
		switch {
		case r.n == 1:
			s.Boundary++
		case r.n > 2:
			s.NonManifold++
		case r.dir != 0:
			s.Misoriented++
		}
	}
	return s
}

// Closed reports a watertight, edge-manifold, consistently oriented mesh.
func (m *Mesh) Closed() bool {
	s := m.EdgeStats()
	return s.Boundary == 0 && s.NonManifold == 0 && s.Misoriented == 0 && len(m.F) > 0
}

// WriteBinarySTL writes the mesh as binary STL.
func (m *Mesh) WriteBinarySTL(w io.Writer, name string) error {
	hdr := make([]byte, 80)
	copy(hdr, name)
	if _, err := w.Write(hdr); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(len(m.F))); err != nil {
		return err
	}
	buf := make([]byte, 50)
	for i, f := range m.F {
		n := m.TriNormal(i).Norm()
		vals := []float64{n[0], n[1], n[2]}
		for k := 0; k < 3; k++ {
			p := m.V[f[k]]
			vals = append(vals, p[0], p[1], p[2])
		}
		for j, v := range vals {
			binary.LittleEndian.PutUint32(buf[j*4:], math.Float32bits(float32(v)))
		}
		buf[48], buf[49] = 0, 0
		if _, err := w.Write(buf); err != nil {
			return err
		}
	}
	return nil
}

// Components returns face-index groups connected through shared vertices.
func (m *Mesh) Components() [][]int {
	parent := make([]int32, len(m.V))
	for i := range parent {
		parent[i] = int32(i)
	}
	var find func(int32) int32
	find = func(x int32) int32 {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	for _, f := range m.F {
		a := find(f[0])
		for k := 1; k < 3; k++ {
			b := find(f[k])
			if a != b {
				parent[b] = a
			}
		}
	}
	groups := map[int32][]int{}
	var order []int32
	for i, f := range m.F {
		r := find(f[0])
		if _, ok := groups[r]; !ok {
			order = append(order, r)
		}
		groups[r] = append(groups[r], i)
	}
	out := make([][]int, 0, len(order))
	for _, r := range order {
		out = append(out, groups[r])
	}
	return out
}

// Submesh extracts the faces listed (compacting vertices).
func (m *Mesh) Submesh(faces []int) *Mesh {
	remap := map[int32]int32{}
	out := &Mesh{}
	for _, fi := range faces {
		f := m.F[fi]
		var nf [3]int32
		for k := 0; k < 3; k++ {
			id, ok := remap[f[k]]
			if !ok {
				id = int32(len(out.V))
				remap[f[k]] = id
				out.V = append(out.V, m.V[f[k]])
			}
			nf[k] = id
		}
		out.F = append(out.F, nf)
	}
	return out
}

// EncodeBinary serialises the mesh for the browser: magic "PSM1", uint32
// nverts, uint32 ntris, float32 xyz..., uint32 indices.
func (m *Mesh) EncodeBinary(w io.Writer) error {
	hdr := make([]byte, 12)
	copy(hdr, "PSM1")
	binary.LittleEndian.PutUint32(hdr[4:], uint32(len(m.V)))
	binary.LittleEndian.PutUint32(hdr[8:], uint32(len(m.F)))
	if _, err := w.Write(hdr); err != nil {
		return err
	}
	buf := make([]byte, 12*len(m.V))
	for i, v := range m.V {
		for k := 0; k < 3; k++ {
			binary.LittleEndian.PutUint32(buf[i*12+k*4:], math.Float32bits(float32(v[k])))
		}
	}
	if _, err := w.Write(buf); err != nil {
		return err
	}
	buf = make([]byte, 12*len(m.F))
	for i, f := range m.F {
		for k := 0; k < 3; k++ {
			binary.LittleEndian.PutUint32(buf[i*12+k*4:], uint32(f[k]))
		}
	}
	_, err := w.Write(buf)
	return err
}

// DecodeBinary is the inverse of EncodeBinary.
func DecodeBinary(b []byte) (*Mesh, error) {
	if len(b) < 12 || string(b[:4]) != "PSM1" {
		return nil, errBadFormat("PSM1 header")
	}
	nv := int(binary.LittleEndian.Uint32(b[4:]))
	nt := int(binary.LittleEndian.Uint32(b[8:]))
	if len(b) != 12+nv*12+nt*12 {
		return nil, errBadFormat("PSM1 length")
	}
	m := &Mesh{V: make([]geom.Vec3, nv), F: make([][3]int32, nt)}
	o := 12
	for i := 0; i < nv; i++ {
		for k := 0; k < 3; k++ {
			m.V[i][k] = float64(math.Float32frombits(binary.LittleEndian.Uint32(b[o:])))
			o += 4
		}
	}
	for i := 0; i < nt; i++ {
		for k := 0; k < 3; k++ {
			x := binary.LittleEndian.Uint32(b[o:])
			if int(x) >= nv {
				return nil, errBadFormat("PSM1 index")
			}
			m.F[i][k] = int32(x)
			o += 4
		}
	}
	return m, nil
}

type errBadFormat string

func (e errBadFormat) Error() string { return "bad mesh data: " + string(e) }
