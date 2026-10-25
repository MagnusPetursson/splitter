package plan

import (
	"encoding/base64"
	"math"
	"sort"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

// FrameJSON is a plane frame for the client.
type FrameJSON struct {
	O geom.Vec3 `json:"o"`
	U geom.Vec3 `json:"u"`
	V geom.Vec3 `json:"v"`
	N geom.Vec3 `json:"n"`
}

func frameJSON(f geom.Frame) FrameJSON { return FrameJSON{f.O, f.U, f.V, f.N} }

// Face is the analysed cut face of an internal node.
type Face struct {
	Node    int           `json:"node"`
	Frame   FrameJSON     `json:"frame"`
	Loops   [][]geom.Vec2 `json:"loops"`
	Area    float64       `json:"area"`
	Raster  *RasterJSON   `json:"raster,omitempty"`
	Patches []int         `json:"patches"`

	fr    geom.Frame
	grid  *geom.Grid
	label []int16 // global patch id per pixel, -1 outside
	edt   []float32
}

// RasterJSON is a downsampled distance field + patch label image.
type RasterJSON struct {
	W      int       `json:"w"`
	H      int       `json:"h"`
	Origin geom.Vec2 `json:"origin"`
	Res    float64   `json:"res"`
	MaxD   float64   `json:"maxD"`
	EDT    string    `json:"edt"`   // base64 uint8, row-major, 0..255 = 0..MaxD
	Label  string    `json:"label"` // base64 uint8: 0 none, k = local patch index+1
}

// Patch is the contact region between one neg-side part and one pos-side part.
type Patch struct {
	ID        int         `json:"id"`
	Node      int         `json:"node"`
	NegLeaf   int         `json:"negLeaf"`
	PosLeaf   int         `json:"posLeaf"`
	Poly      []geom.Vec2 `json:"poly"` // convex region (cell intersection) in face frame
	Area      float64     `json:"area"`
	RMax      float64     `json:"rmax"`      // largest inscribed radius
	Thickness float64     `json:"thickness"` // typical wall thickness (ridge median ×2)
	Centroid  geom.Vec2   `json:"centroid"`
	Axis      float64     `json:"axis"`     // principal in-plane direction (radians)
	Solidity  float64     `json:"solidity"` // area / convex hull area
	Ring      bool        `json:"ring"`     // shell-like section (use polar fingers)
	RMean     float64     `json:"rmean"`    // mean distance from centroid (polar fingers)
	Seam      *Seam       `json:"seam,omitempty"`
	Anchor    geom.Vec3   `json:"anchor"`
	Notes     []string    `json:"notes,omitempty"`
	// Style is a per-contact joint style chosen by the user ("" = the
	// global style); Force asks for that style even below the recommended
	// wall/depth. Fallback says what was used instead and why; Single
	// marks a contact where only one point joint fits.
	Style    string         `json:"style,omitempty"`
	Force    bool           `json:"force,omitempty"`
	Fallback *JointFallback `json:"fallback,omitempty"`
	Single   bool           `json:"single,omitempty"`

	pixels []int32
}

// AnalyzeFaces computes faces and patches for every internal node.
func (md *Model) AnalyzeFaces(t *Tree) ([]*Face, []*Patch) {
	var faces []*Face
	var patches []*Patch
	for _, id := range t.Internal() {
		n := t.Nodes[id]
		hs := t.Path(id)
		sec := md.Slicer(n.Cut.N).Slice(n.Cut.D, hs)
		f := &Face{Node: id, Frame: frameJSON(sec.Frame), fr: sec.Frame, Area: sec.Area}
		if len(sec.Loops) == 0 {
			faces = append(faces, f)
			continue
		}
		mn := geom.Vec2{math.Inf(1), math.Inf(1)}
		mx := geom.Vec2{math.Inf(-1), math.Inf(-1)}
		var loops [][]geom.Vec2
		for _, l := range sec.Loops {
			for _, p := range l.P {
				mn = geom.Vec2{math.Min(mn[0], p[0]), math.Min(mn[1], p[1])}
				mx = geom.Vec2{math.Max(mx[0], p[0]), math.Max(mx[1], p[1])}
			}
			loops = append(loops, l.P)
		}
		f.Loops = simplifyLoops(loops, 0.05)
		ext := math.Max(mx[0]-mn[0], mx[1]-mn[1])
		res := math.Max(0.1, ext/900)
		g := geom.NewGrid(mn, mx, res)
		inside := rasterize(g, loops)
		f.grid = g
		f.label = make([]int16, g.W*g.H)
		f.edt = make([]float32, g.W*g.H)
		pairIdx := map[[2]int]int{}
		var local []*Patch
		for j := 0; j < g.H; j++ {
			for i := 0; i < g.W; i++ {
				k := j*g.W + i
				f.label[k] = -1
				if !inside[k] {
					continue
				}
				p3 := sec.Frame.To3(g.Center(i, j))
				a := t.LeafOf(n.Neg, p3)
				b := t.LeafOf(n.Pos, p3)
				key := [2]int{a, b}
				li, ok := pairIdx[key]
				if !ok {
					li = len(local)
					pairIdx[key] = li
					local = append(local, &Patch{Node: id, NegLeaf: a, PosLeaf: b})
				}
				local[li].pixels = append(local[li].pixels, int32(k))
			}
		}
		for li, p := range local {
			p.ID = len(patches)
			mask := make([]bool, g.W*g.H)
			for _, k := range p.pixels {
				mask[k] = true
				f.label[k] = int16(p.ID)
			}
			d := geom.EDT(mask, g.W, g.H, res)
			for _, k := range p.pixels {
				f.edt[k] = float32(d[k])
			}
			p.stats(f, d, res)
			// convex region polygon
			big := 4 * md.Diag
			sq := []geom.Vec2{{-big, -big}, {big, -big}, {big, big}, {-big, big}}
			var hsAll []HalfSpace
			hsAll = append(hsAll, hs...)
			hsAll = append(hsAll, t.PathBetween(id, p.NegLeaf)...)
			hsAll = append(hsAll, t.PathBetween(id, p.PosLeaf)...)
			p.Poly = ClipPoly(sec.Frame, sq, hsAll)
			_ = li
			if p.Area < 1 { // sub-mm² contact: ignore
				continue
			}
			patches = append(patches, p)
			f.Patches = append(f.Patches, p.ID)
		}
		// re-index so patch IDs are dense even when tiny patches were dropped
		f.Raster = encodeRaster(f, patches)
		faces = append(faces, f)
	}
	// make patch IDs dense
	remap := map[int]int{}
	for i, p := range patches {
		remap[p.ID] = i
		p.ID = i
	}
	for _, f := range faces {
		for i, pid := range f.Patches {
			f.Patches[i] = remap[pid]
		}
		for k, l := range f.label {
			if l >= 0 {
				if nl, ok := remap[int(l)]; ok {
					f.label[k] = int16(nl)
				} else {
					f.label[k] = -1
				}
			}
		}
		if f.grid != nil {
			f.Raster = encodeRaster(f, patches)
		}
	}
	return faces, patches
}

func (p *Patch) stats(f *Face, d []float64, res float64) {
	g := f.grid
	n := float64(len(p.pixels))
	p.Area = n * res * res
	var cx, cy float64
	var ridge []float64
	for _, k := range p.pixels {
		i, j := int(k)%g.W, int(k)/g.W
		c := g.Center(i, j)
		cx += c[0]
		cy += c[1]
		v := d[k]
		if v > p.RMax {
			p.RMax = v
			p.Anchor = f.fr.To3(g.Center(i, j))
		}
		// ridge: local maximum of the distance field (medial axis sample)
		isMax := true
		for dj := -1; dj <= 1 && isMax; dj++ {
			for di := -1; di <= 1; di++ {
				if di == 0 && dj == 0 {
					continue
				}
				ii, jj := i+di, j+dj
				if ii < 0 || jj < 0 || ii >= g.W || jj >= g.H {
					continue
				}
				if d[jj*g.W+ii] > v+1e-9 {
					isMax = false
					break
				}
			}
		}
		if isMax {
			ridge = append(ridge, v)
		}
	}
	if n == 0 {
		return
	}
	p.Centroid = geom.Vec2{cx / n, cy / n}
	if len(ridge) > 0 {
		sort.Float64s(ridge)
		p.Thickness = 2 * ridge[len(ridge)/2]
		// pixel-centre EDT underestimates by ~half a pixel
		p.Thickness += res
	}
	// principal axis and hull
	var sxx, syy, sxy, rsum float64
	var hullPts []geom.Vec2
	for _, k := range p.pixels {
		i, j := int(k)%g.W, int(k)/g.W
		c := g.Center(i, j).Sub(p.Centroid)
		sxx += c[0] * c[0]
		syy += c[1] * c[1]
		sxy += c[0] * c[1]
		rsum += c.Len()
		if d[k] <= res*1.01 {
			hullPts = append(hullPts, g.Center(i, j))
		}
	}
	p.RMean = rsum / n
	p.Axis = 0.5 * math.Atan2(2*sxy, sxx-syy)
	h := geom.ConvexHull2(hullPts)
	ha := math.Abs(geom.PolygonArea(h))
	if ha > 0 {
		p.Solidity = math.Min(1, p.Area/ha)
	}
	// shell-like: thin relative to size and wraps around (low solidity)
	size := math.Sqrt(ha)
	p.Ring = p.Solidity < 0.45 && p.Thickness < 0.15*size
}

// rasterize fills inside cells by the even-odd rule with a scanline.
func rasterize(g *geom.Grid, loops [][]geom.Vec2) []bool {
	inside := make([]bool, g.W*g.H)
	xs := make([]float64, 0, 64)
	for j := 0; j < g.H; j++ {
		y := g.Origin[1] + (float64(j)+0.5)*g.Res
		xs = xs[:0]
		for _, l := range loops {
			n := len(l)
			for i := 0; i < n; i++ {
				a, b := l[i], l[(i+1)%n]
				if (a[1] > y) != (b[1] > y) {
					xs = append(xs, a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]))
				}
			}
		}
		sort.Float64s(xs)
		for k := 0; k+1 < len(xs); k += 2 {
			i0 := int(math.Ceil((xs[k]-g.Origin[0])/g.Res - 0.5))
			i1 := int(math.Floor((xs[k+1]-g.Origin[0])/g.Res - 0.5))
			for i := max(i0, 0); i <= i1 && i < g.W; i++ {
				inside[j*g.W+i] = !inside[j*g.W+i]
			}
		}
	}
	return inside
}

func encodeRaster(f *Face, patches []*Patch) *RasterJSON {
	g := f.grid
	if g == nil {
		return nil
	}
	maxSide := 360
	step := int(math.Ceil(float64(max(g.W, g.H)) / float64(maxSide)))
	if step < 1 {
		step = 1
	}
	w, h := (g.W+step-1)/step, (g.H+step-1)/step
	maxD := 0.0
	for _, v := range f.edt {
		maxD = math.Max(maxD, float64(v))
	}
	if maxD == 0 {
		maxD = 1
	}
	local := map[int16]uint8{}
	for i, pid := range f.Patches {
		local[int16(pid)] = uint8(i + 1)
	}
	e := make([]byte, w*h)
	lb := make([]byte, w*h)
	for j := 0; j < h; j++ {
		for i := 0; i < w; i++ {
			// max over the block keeps thin walls visible
			best := float32(0)
			lab := int16(-1)
			for dj := 0; dj < step; dj++ {
				for di := 0; di < step; di++ {
					ii, jj := i*step+di, j*step+dj
					if ii >= g.W || jj >= g.H {
						continue
					}
					k := jj*g.W + ii
					if f.label[k] >= 0 {
						lab = f.label[k]
						if f.edt[k] > best {
							best = f.edt[k]
						}
					}
				}
			}
			e[j*w+i] = uint8(math.Round(255 * float64(best) / maxD))
			if lab >= 0 {
				lb[j*w+i] = local[lab]
			}
		}
	}
	return &RasterJSON{W: w, H: h, Origin: g.Origin, Res: g.Res * float64(step), MaxD: maxD,
		EDT: base64.StdEncoding.EncodeToString(e), Label: base64.StdEncoding.EncodeToString(lb)}
}

// simplifyLoops drops near-collinear points (Douglas–Peucker-lite) so the
// client receives compact outlines.
func simplifyLoops(loops [][]geom.Vec2, tol float64) [][]geom.Vec2 {
	var out [][]geom.Vec2
	for _, l := range loops {
		if len(l) < 3 {
			continue
		}
		s := dp(append(append([]geom.Vec2{}, l...), l[0]), tol)
		if len(s) > 1 {
			s = s[:len(s)-1]
		}
		if len(s) >= 3 {
			// round to 0.01 mm to keep JSON small
			for i := range s {
				s[i] = geom.Vec2{math.Round(s[i][0]*100) / 100, math.Round(s[i][1]*100) / 100}
			}
			out = append(out, s)
		}
	}
	return out
}

func dp(pts []geom.Vec2, tol float64) []geom.Vec2 {
	if len(pts) < 3 {
		return pts
	}
	keep := make([]bool, len(pts))
	keep[0], keep[len(pts)-1] = true, true
	type rng struct{ a, b int }
	stack := []rng{{0, len(pts) - 1}}
	for len(stack) > 0 {
		r := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		a, b := pts[r.a], pts[r.b]
		ab := b.Sub(a)
		l := ab.Len()
		best, bi := -1.0, -1
		for i := r.a + 1; i < r.b; i++ {
			var dd float64
			if l < 1e-12 {
				dd = pts[i].Sub(a).Len()
			} else {
				dd = math.Abs(ab.Cross(pts[i].Sub(a))) / l
			}
			if dd > best {
				best, bi = dd, i
			}
		}
		if best > tol && bi > 0 {
			keep[bi] = true
			stack = append(stack, rng{r.a, bi}, rng{bi, r.b})
		}
	}
	var out []geom.Vec2
	for i, k := range keep {
		if k {
			out = append(out, pts[i])
		}
	}
	return out
}

// pixel helpers used by joint placement
func (f *Face) pixelAt(p geom.Vec2) int {
	g := f.grid
	i := int((p[0] - g.Origin[0]) / g.Res)
	j := int((p[1] - g.Origin[1]) / g.Res)
	if i < 0 || j < 0 || i >= g.W || j >= g.H {
		return -1
	}
	return j*g.W + i
}

// Clearance at a point within its own patch (0 outside the patch).
func (f *Face) distIn(patch int, p geom.Vec2) float64 {
	k := f.pixelAt(p)
	if k < 0 || f.label[k] != int16(patch) {
		return 0
	}
	return float64(f.edt[k])
}

// samplePatch returns up to n world points spread over a patch.
func (f *Face) samplePatch(p *Patch, n int) []geom.Vec3 {
	if f.grid == nil || len(p.pixels) == 0 {
		return nil
	}
	step := len(p.pixels)/n + 1
	var out []geom.Vec3
	g := f.grid
	for i := 0; i < len(p.pixels); i += step {
		k := int(p.pixels[i])
		out = append(out, f.fr.To3(g.Center(k%g.W, k/g.W)))
	}
	return out
}
