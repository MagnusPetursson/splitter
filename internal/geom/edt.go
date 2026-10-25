package geom

import "math"

// Grid is a raster over a plane frame region; cell (i,j) centre is
// Origin + (i+0.5, j+0.5)*Res.
type Grid struct {
	W, H   int
	Res    float64
	Origin Vec2
	Data   []float64
}

func NewGrid(min, max Vec2, res float64) *Grid {
	w := int(math.Ceil((max[0]-min[0])/res)) + 2
	h := int(math.Ceil((max[1]-min[1])/res)) + 2
	return &Grid{W: w, H: h, Res: res, Origin: Vec2{min[0] - res, min[1] - res}, Data: make([]float64, w*h)}
}

func (g *Grid) Center(i, j int) Vec2 {
	return Vec2{g.Origin[0] + (float64(i)+0.5)*g.Res, g.Origin[1] + (float64(j)+0.5)*g.Res}
}

func (g *Grid) At(i, j int) float64 { return g.Data[j*g.W+i] }

// Sample returns the value at a world-2D point (nearest cell), or 0 outside.
func (g *Grid) Sample(p Vec2) float64 {
	i := int((p[0] - g.Origin[0]) / g.Res)
	j := int((p[1] - g.Origin[1]) / g.Res)
	if i < 0 || j < 0 || i >= g.W || j >= g.H {
		return 0
	}
	return g.Data[j*g.W+i]
}

// EDT computes, for every inside cell (mask true), the Euclidean distance in
// world units to the nearest outside cell centre (Felzenszwalb & Huttenlocher
// 1D squared-distance transform applied separably).
func EDT(mask []bool, w, h int, res float64) []float64 {
	const inf = 1e20
	f := make([]float64, w*h)
	for i, m := range mask {
		if m {
			f[i] = inf
		}
	}
	n := w
	if h > n {
		n = h
	}
	d := make([]float64, n)
	v := make([]int, n)
	z := make([]float64, n+1)
	tmp := make([]float64, n)
	dt1 := func(get func(int) float64, set func(int, float64), m int) {
		for q := 0; q < m; q++ {
			tmp[q] = get(q)
		}
		k := 0
		v[0] = 0
		z[0] = -inf
		z[1] = inf
		for q := 1; q < m; q++ {
			var s float64
			for {
				p := v[k]
				s = ((tmp[q] + float64(q*q)) - (tmp[p] + float64(p*p))) / float64(2*q-2*p)
				if s <= z[k] && k > 0 {
					k--
					continue
				}
				break
			}
			k++
			v[k] = q
			z[k] = s
			z[k+1] = inf
		}
		k = 0
		for q := 0; q < m; q++ {
			for z[k+1] < float64(q) {
				k++
			}
			p := v[k]
			d[q] = float64((q-p)*(q-p)) + tmp[p]
		}
		for q := 0; q < m; q++ {
			set(q, d[q])
		}
	}
	for x := 0; x < w; x++ {
		dt1(func(i int) float64 { return f[i*w+x] }, func(i int, val float64) { f[i*w+x] = val }, h)
	}
	for y := 0; y < h; y++ {
		dt1(func(i int) float64 { return f[y*w+i] }, func(i int, val float64) { f[y*w+i] = val }, w)
	}
	for i := range f {
		f[i] = math.Sqrt(f[i]) * res
	}
	return f
}
