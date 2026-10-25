package mesh

import "github.com/MagnusPetursson/splitter/internal/geom"

// Box returns a closed axis-aligned box soup (12 triangles, outward winding).
func Box(min, max geom.Vec3) *Soup {
	v := func(i int) geom.Vec3 {
		return geom.Vec3{
			[]float64{min[0], max[0]}[i&1],
			[]float64{min[1], max[1]}[(i>>1)&1],
			[]float64{min[2], max[2]}[(i>>2)&1],
		}
	}
	quads := [][4]int{{0, 2, 3, 1}, {4, 5, 7, 6}, {0, 1, 5, 4}, {2, 6, 7, 3}, {0, 4, 6, 2}, {1, 3, 7, 5}}
	s := &Soup{}
	for _, q := range quads {
		s.Tris = append(s.Tris, [3]geom.Vec3{v(q[0]), v(q[1]), v(q[2])}, [3]geom.Vec3{v(q[0]), v(q[2]), v(q[3])})
	}
	return s
}
