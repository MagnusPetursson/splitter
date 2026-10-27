package geom

import "testing"

func TestQuarterTurn(t *testing.T) {
	ok := [][]float64{
		{1, 0, 0, 0, 1, 0, 0, 0, 1},
		{0, -1, 0, 1, 0, 0, 0, 0, 1}, // 90° about Z
		{1, 0, 0, 0, 0, -1, 0, 1, 0}, // 90° about X
		{0, 0, 1, 1, 0, 0, 0, 1, 0},  // cyclic
	}
	for _, a := range ok {
		m, err := QuarterTurn(a)
		if err != nil {
			t.Fatalf("%v: %v", a, err)
		}
		// lengths are preserved
		v := m.Apply(Vec3{3, 4, 12})
		if v.Len() != 13 {
			t.Fatalf("%v changed length: %v", a, v)
		}
	}
	bad := [][]float64{
		{0, 1, 0, 1, 0, 0, 0, 0, 1},  // swap = mirror
		{-1, 0, 0, 0, 1, 0, 0, 0, 1}, // mirror
		{2, 0, 0, 0, 1, 0, 0, 0, 1},  // scale
		{1, 0, 0, 1, 0, 0, 0, 0, 1},  // repeated column
		{1, 0, 0, 0, 1, 0, 0, 0},     // short
		{.7, .7, 0, -.7, .7, 0, 0, 0, 1},
	}
	for _, a := range bad {
		if _, err := QuarterTurn(a); err == nil {
			t.Fatalf("%v accepted", a)
		}
	}
}
