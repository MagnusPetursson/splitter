// Package geom holds the small amount of linear algebra and 2D computational
// geometry the planner needs: vectors, plane frames, convex hulls, rectangle
// fitting and Euclidean distance transforms.
package geom

import (
	"fmt"
	"math"
)

// Vec3 is a 3D vector in millimetres.
type Vec3 [3]float64

func (a Vec3) Add(b Vec3) Vec3      { return Vec3{a[0] + b[0], a[1] + b[1], a[2] + b[2]} }
func (a Vec3) Sub(b Vec3) Vec3      { return Vec3{a[0] - b[0], a[1] - b[1], a[2] - b[2]} }
func (a Vec3) Scale(s float64) Vec3 { return Vec3{a[0] * s, a[1] * s, a[2] * s} }
func (a Vec3) Dot(b Vec3) float64   { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
func (a Vec3) Cross(b Vec3) Vec3 {
	return Vec3{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
}
func (a Vec3) Len() float64 { return math.Sqrt(a.Dot(a)) }
func (a Vec3) Norm() Vec3 {
	l := a.Len()
	if l == 0 {
		return a
	}
	return a.Scale(1 / l)
}
func (a Vec3) Lerp(b Vec3, t float64) Vec3 { return a.Add(b.Sub(a).Scale(t)) }

// Vec2 is a 2D vector in a plane frame.
type Vec2 [2]float64

func (a Vec2) Sub(b Vec2) Vec2      { return Vec2{a[0] - b[0], a[1] - b[1]} }
func (a Vec2) Add(b Vec2) Vec2      { return Vec2{a[0] + b[0], a[1] + b[1]} }
func (a Vec2) Scale(s float64) Vec2 { return Vec2{a[0] * s, a[1] * s} }
func (a Vec2) Dot(b Vec2) float64   { return a[0]*b[0] + a[1]*b[1] }
func (a Vec2) Cross(b Vec2) float64 { return a[0]*b[1] - a[1]*b[0] }
func (a Vec2) Len() float64         { return math.Hypot(a[0], a[1]) }

// Frame is an orthonormal basis (U, V, N) with origin O; N is the plane normal.
type Frame struct {
	O, U, V, N Vec3
}

// PlaneFrame builds a deterministic in-plane basis for plane n·x = d.
func PlaneFrame(n Vec3, d float64) Frame {
	n = n.Norm()
	// pick the world axis least aligned with n as helper
	h := Vec3{1, 0, 0}
	if math.Abs(n[0]) > 0.6 {
		h = Vec3{0, 1, 0}
		if math.Abs(n[1]) > 0.6 {
			h = Vec3{0, 0, 1}
		}
	}
	// Prefer Z as "up" in the in-plane V axis when the plane is vertical, so
	// 2D drawings of vertical cut faces read naturally.
	if math.Abs(n[2]) < 0.6 {
		h = Vec3{0, 0, 1}
		v := h.Sub(n.Scale(n.Dot(h))).Norm()
		u := v.Cross(n).Norm()
		return Frame{O: n.Scale(d), U: u, V: v, N: n}
	}
	u := h.Sub(n.Scale(n.Dot(h))).Norm()
	v := n.Cross(u).Norm()
	return Frame{O: n.Scale(d), U: u, V: v, N: n}
}

// To2 projects a world point into frame coordinates.
func (f Frame) To2(p Vec3) Vec2 {
	q := p.Sub(f.O)
	return Vec2{q.Dot(f.U), q.Dot(f.V)}
}

// To3 lifts frame coordinates back to world space (on the plane).
func (f Frame) To3(p Vec2) Vec3 {
	return f.O.Add(f.U.Scale(p[0])).Add(f.V.Scale(p[1]))
}

// AABB is an axis aligned box.
type AABB struct{ Min, Max Vec3 }

func EmptyAABB() AABB {
	inf := math.Inf(1)
	return AABB{Vec3{inf, inf, inf}, Vec3{-inf, -inf, -inf}}
}
func (b *AABB) Add(p Vec3) {
	for i := 0; i < 3; i++ {
		b.Min[i] = math.Min(b.Min[i], p[i])
		b.Max[i] = math.Max(b.Max[i], p[i])
	}
}
func (b AABB) Size() Vec3   { return b.Max.Sub(b.Min) }
func (b AABB) Center() Vec3 { return b.Min.Add(b.Max).Scale(0.5) }
func (b AABB) Valid() bool  { return b.Min[0] <= b.Max[0] }

// Mat3 is a row-major rotation matrix.
type Mat3 [3][3]float64

func (m Mat3) Apply(v Vec3) Vec3 {
	return Vec3{
		m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
		m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
		m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2],
	}
}
func (m Mat3) Mul(o Mat3) Mat3 {
	var r Mat3
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			for k := 0; k < 3; k++ {
				r[i][j] += m[i][k] * o[k][j]
			}
		}
	}
	return r
}
func Identity() Mat3 { return Mat3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}} }

// RotateZ returns a rotation about +Z by angle a (radians).
func RotateZ(a float64) Mat3 {
	c, s := math.Cos(a), math.Sin(a)
	return Mat3{{c, -s, 0}, {s, c, 0}, {0, 0, 1}}
}

// AlignToDown returns a rotation that maps direction d onto -Z.
func AlignToDown(d Vec3) Mat3 {
	d = d.Norm()
	t := Vec3{0, 0, -1}
	c := d.Dot(t)
	if c > 1-1e-12 {
		return Identity()
	}
	if c < -1+1e-12 { // d is +Z: rotate 180° about X
		return Mat3{{1, 0, 0}, {0, -1, 0}, {0, 0, -1}}
	}
	ax := d.Cross(t).Norm()
	s := math.Sqrt(1 - c*c)
	x, y, z := ax[0], ax[1], ax[2]
	C := 1 - c
	return Mat3{
		{c + x*x*C, x*y*C - z*s, x*z*C + y*s},
		{y*x*C + z*s, c + y*y*C, y*z*C - x*s},
		{z*x*C - y*s, z*y*C + x*s, c + z*z*C},
	}
}

// Clamp limits v to [lo,hi].
func Clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

// QuarterTurn validates a row-major 3×3 matrix as a whole-model quarter-turn
// rotation: a signed permutation with determinant +1 (no mirroring, no
// scaling). Used to lay a model on another side before planning.
func QuarterTurn(a []float64) (Mat3, error) {
	var m Mat3
	if len(a) != 9 {
		return m, fmt.Errorf("rotation needs 9 values, got %d", len(a))
	}
	var used [3]bool
	for i := 0; i < 3; i++ {
		n := 0
		for j := 0; j < 3; j++ {
			v := a[i*3+j]
			m[i][j] = v
			switch v {
			case 0:
			case 1, -1:
				if used[j] {
					return m, fmt.Errorf("rotation is not a signed permutation")
				}
				used[j] = true
				n++
			default:
				return m, fmt.Errorf("rotation entries must be -1, 0 or 1")
			}
		}
		if n != 1 {
			return m, fmt.Errorf("rotation is not a signed permutation")
		}
	}
	det := m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])
	if det != 1 {
		return m, fmt.Errorf("rotation would mirror the model")
	}
	return m, nil
}
