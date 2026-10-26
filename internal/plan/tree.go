package plan

import (
	"fmt"
	"math"
	"sort"

	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
)

// Node is a BSP node. Internal nodes carry a cut plane; Neg is the child on
// the n·x < d side, Pos on the n·x > d side. Leaves are parts.
type Node struct {
	ID     int    `json:"id"`
	Parent int    `json:"parent"`
	Cut    *Plane `json:"cut,omitempty"`
	Neg    int    `json:"neg"`
	Pos    int    `json:"pos"`
	Locked bool   `json:"locked,omitempty"` // user-placed or user-edited cut
	Label  string `json:"label,omitempty"`
	Reason string `json:"reason,omitempty"` // why the planner chose this cut
}

// Tree is the split plan.
type Tree struct {
	Nodes []Node `json:"nodes"`
	Root  int    `json:"root"`
}

func NewTree() *Tree {
	return &Tree{Nodes: []Node{{ID: 0, Parent: -1, Neg: -1, Pos: -1}}, Root: 0}
}

func (t *Tree) IsLeaf(id int) bool { return t.Nodes[id].Cut == nil }

func (t *Tree) Leaves() []int {
	var out []int
	var walk func(int)
	walk = func(id int) {
		n := t.Nodes[id]
		if n.Cut == nil {
			out = append(out, id)
			return
		}
		walk(n.Neg)
		walk(n.Pos)
	}
	walk(t.Root)
	return out
}

func (t *Tree) Internal() []int {
	var out []int
	var walk func(int)
	walk = func(id int) {
		n := t.Nodes[id]
		if n.Cut == nil {
			return
		}
		out = append(out, id)
		walk(n.Neg)
		walk(n.Pos)
	}
	walk(t.Root)
	return out
}

// Path returns the half-spaces bounding node id (root to node).
func (t *Tree) Path(id int) []HalfSpace {
	var hs []HalfSpace
	for id != t.Root && id >= 0 {
		p := t.Nodes[id].Parent
		if p < 0 {
			break
		}
		pn := t.Nodes[p]
		side := 1.0
		if pn.Neg == id {
			side = -1
		}
		hs = append(hs, HalfSpace{P: *pn.Cut, Side: side})
		id = p
	}
	// reverse to root-first
	for i, j := 0, len(hs)-1; i < j; i, j = i+1, j-1 {
		hs[i], hs[j] = hs[j], hs[i]
	}
	return hs
}

// PathBetween returns half-spaces from ancestor (exclusive) down to node.
func (t *Tree) PathBetween(ancestor, id int) []HalfSpace {
	full := t.Path(id)
	depthA := len(t.Path(ancestor))
	if depthA+1 > len(full) {
		return nil
	}
	return full[depthA+1:]
}

// LeafOf descends from node id to the leaf containing p.
func (t *Tree) LeafOf(id int, p geom.Vec3) int {
	for {
		n := t.Nodes[id]
		if n.Cut == nil {
			return id
		}
		if n.Cut.Eval(p) < 0 {
			id = n.Neg
		} else {
			id = n.Pos
		}
	}
}

// SplitLeaf turns leaf id into an internal node with the given plane.
func (t *Tree) SplitLeaf(id int, p Plane) (int, int) {
	neg := len(t.Nodes)
	pos := neg + 1
	t.Nodes = append(t.Nodes, Node{ID: neg, Parent: id, Neg: -1, Pos: -1}, Node{ID: pos, Parent: id, Neg: -1, Pos: -1})
	t.Nodes[id].Cut = &p
	t.Nodes[id].Neg = neg
	t.Nodes[id].Pos = pos
	t.Nodes[id].Label = ""
	return neg, pos
}

// Validate checks structural integrity of a client-supplied tree.
func (t *Tree) Validate() error {
	if len(t.Nodes) == 0 || t.Root < 0 || t.Root >= len(t.Nodes) {
		return fmt.Errorf("empty tree")
	}
	seen := make([]bool, len(t.Nodes))
	var walk func(id, depth int) error
	walk = func(id, depth int) error {
		if id < 0 || id >= len(t.Nodes) || seen[id] {
			return fmt.Errorf("bad node reference %d", id)
		}
		if depth > 64 {
			return fmt.Errorf("tree too deep")
		}
		seen[id] = true
		n := &t.Nodes[id]
		n.ID = id
		if n.Cut == nil {
			n.Neg, n.Pos = -1, -1
			return nil
		}
		l := n.Cut.N.Len()
		if l < 1e-9 || math.IsNaN(l) || math.IsNaN(n.Cut.D) {
			return fmt.Errorf("node %d: invalid plane", id)
		}
		n.Cut.N = n.Cut.N.Scale(1 / l)
		n.Cut.D /= l
		for _, c := range []int{n.Neg, n.Pos} {
			if c < 0 || c >= len(t.Nodes) {
				return fmt.Errorf("node %d: bad child", id)
			}
			t.Nodes[c].Parent = id
			if err := walk(c, depth+1); err != nil {
				return err
			}
		}
		return nil
	}
	t.Nodes[t.Root].Parent = -1
	return walk(t.Root, 0)
}

// Compact drops unreachable nodes and renumbers.
func (t *Tree) Compact() *Tree {
	out := &Tree{}
	var walk func(id, parent int) int
	walk = func(id, parent int) int {
		n := t.Nodes[id]
		nid := len(out.Nodes)
		out.Nodes = append(out.Nodes, Node{ID: nid, Parent: parent, Cut: n.Cut, Locked: n.Locked, Reason: n.Reason, Neg: -1, Pos: -1})
		if n.Cut != nil {
			a := walk(n.Neg, nid)
			b := walk(n.Pos, nid)
			out.Nodes[nid].Neg, out.Nodes[nid].Pos = a, b
		}
		return nid
	}
	walk(t.Root, -1)
	out.Root = 0
	return out
}

// Model wraps the repaired mesh with caches used by the planner.
type Model struct {
	M             *mesh.Mesh
	Nrm           []geom.Vec3
	Bounds        geom.AABB
	Diag          float64
	Tilted        bool // allow tilted print orientations (set per run)
	Upright       bool // keep the model's +Z up for every part
	supportWeight float64
	slicers       map[[3]int64]*Slicer
	bvh           *BVH
	Area          []float64
	cents         []geom.Vec3
}

func NewModel(m *mesh.Mesh) *Model {
	md := &Model{M: m, Nrm: FaceNormals(m), Bounds: m.Bounds(), slicers: map[[3]int64]*Slicer{}}
	md.Diag = md.Bounds.Size().Len()
	md.Area = make([]float64, len(m.F))
	for i := range m.F {
		md.Area[i] = m.TriNormal(i).Len() / 2
	}
	return md
}

func (md *Model) Slicer(n geom.Vec3) *Slicer {
	k := [3]int64{int64(math.Round(n[0] * 1e9)), int64(math.Round(n[1] * 1e9)), int64(math.Round(n[2] * 1e9))}
	if s, ok := md.slicers[k]; ok {
		return s
	}
	if len(md.slicers) > 64 {
		md.slicers = map[[3]int64]*Slicer{}
	}
	s := NewSlicer(md.M, n, md.Nrm)
	md.slicers[k] = s
	return s
}

func (md *Model) BVH() *BVH {
	if md.bvh == nil {
		md.bvh = BuildBVH(md.M)
	}
	return md.bvh
}

// CellPoints returns the vertices of model ∩ cell: inside vertices plus the
// clipped section outlines on every bounding plane.
func (md *Model) CellPoints(hs []HalfSpace) []geom.Vec3 {
	eps := md.Diag * 1e-9
	var pts []geom.Vec3
	for _, v := range md.M.V {
		in := true
		for _, h := range hs {
			if !h.Inside(v, eps) {
				in = false
				break
			}
		}
		if in {
			pts = append(pts, v)
		}
	}
	for i, h := range hs {
		others := make([]HalfSpace, 0, len(hs)-1)
		others = append(others, hs[:i]...)
		others = append(others, hs[i+1:]...)
		sec := md.Slicer(h.P.N).Slice(h.P.D, others)
		for _, l := range sec.Loops {
			for _, p := range l.P {
				pts = append(pts, sec.Frame.To3(p))
			}
		}
	}
	return pts
}

// Settings controls planning.
type Settings struct {
	Bed           Bed      `json:"bed"`    // raw printer volume
	Margin        float64  `json:"margin"` // safety margin per side (XY) and on Z
	MinPiece      float64  `json:"minPiece"`
	AutoSplit     bool     `json:"autoSplit"`
	MaxParts      int      `json:"maxParts"`
	JointStyle    string   `json:"jointStyle"`
	Nozzle        float64  `json:"nozzle"`
	Fits          FitTable `json:"fits"`
	AutoJoints    bool     `json:"autoJoints"`
	MinWall       float64  `json:"minWall"`
	Tilted        bool     `json:"tilted"`                  // allow PCA (tilted) print orientations
	Upright       bool     `json:"upright"`                 // print every part as modelled (only rotate about Z)
	SupportWeight *float64 `json:"supportWeight,omitempty"` // nil = 0.5; 0 = legacy fewest-parts
	supportSplit  bool
	allowance     float64
}

func (s *Settings) Usable() Bed {
	m := s.Margin
	return Bed{X: s.Bed.X - 2*m, Y: s.Bed.Y - 2*m, Z: s.Bed.Z - m}
}

// splitBed is the volume the cut planner aims for (usable minus the
// protrusion allowance for male joint features).
func (s *Settings) splitBed() Bed {
	b := s.Usable()
	a := s.allowance
	return Bed{X: b.X - a, Y: b.Y - a, Z: b.Z - a}
}

func (s *Settings) Normalize() {
	if s.Bed.X <= 0 || s.Bed.Y <= 0 || s.Bed.Z <= 0 {
		s.Bed = Bed{250, 210, 220}
	}
	if s.Margin < 0 || s.Margin > 40 {
		s.Margin = 3
	}
	if s.MinPiece <= 0 {
		s.MinPiece = 15
	}
	if s.MaxParts <= 0 || s.MaxParts > 200 {
		s.MaxParts = 64
	}
	if s.Nozzle <= 0 {
		s.Nozzle = 0.4
	}
	if s.JointStyle == "" {
		s.JointStyle = "glued"
	}
	if s.MinWall <= 0 {
		s.MinWall = math.Max(1.2, 2*s.Nozzle*1.05)
	}
	if s.SupportWeight != nil {
		w := *s.SupportWeight
		if math.IsNaN(w) || math.IsInf(w, 0) {
			w = 0.5
		}
		w = math.Max(0, math.Min(1, w))
		s.SupportWeight = &w
	}
	s.Fits.normalize(s.Nozzle)
}

func (s *Settings) supportWeight() float64 {
	if s.SupportWeight == nil {
		return 0.5
	}
	return *s.SupportWeight
}

// candidateDowns gathers orientations worth testing for a cell.
// candidateDowns gathers print orientations worth testing for a cell: world
// axes, the cell's cut faces and its largest flat faces. Principal (PCA) axes
// are only added when tilted orientations are allowed: they often "fit" on
// paper but print as support-covered slabs.
func candidateDowns(pts []geom.Vec3, hs []HalfSpace, tilted, upright bool, extra ...geom.Vec3) []geom.Vec3 {
	if upright {
		return []geom.Vec3{{0, 0, -1}}
	}
	dirs := []geom.Vec3{{0, 0, 1}, {1, 0, 0}, {0, 1, 0}}
	if tilted {
		ax := PCA(pts)
		dirs = append(dirs, ax[0], ax[1], ax[2])
	}
	for _, h := range hs {
		dirs = append(dirs, h.P.N)
	}
	dirs = append(dirs, extra...)
	return dedupeDirs(dirs, false)
}

// cellTris returns triangles whose centroid lies inside the cell.
func (md *Model) cellTris(hs []HalfSpace) []int {
	if md.cents == nil {
		md.cents = md.centroids()
	}
	eps := md.Diag * 1e-9
	var out []int
	for ti, c := range md.cents {
		in := true
		for _, h := range hs {
			if !h.Inside(c, eps) {
				in = false
				break
			}
		}
		if in {
			out = append(out, ti)
		}
	}
	return out
}

type cutCand struct {
	plane      Plane
	sec        *Section
	est        int
	cost       float64
	fitN, fitP FitResult
	reason     string
	worldAxis  bool
	lo, hi     float64
	support    float64
}

// AutoSplit first makes leaves fit, then considers optional support-saving cuts.
func (md *Model) AutoSplit(t *Tree, s *Settings, progress func(string)) []string {
	var warnings []string
	bed := s.splitBed()
	queue := t.Leaves()
	var optional []int
	supportPhase := false
	for len(queue) > 0 || len(optional) > 0 {
		if len(queue) == 0 {
			queue, optional = optional, nil
			supportPhase = true
		}
		if len(t.Leaves()) >= s.MaxParts {
			warnings = append(warnings, fmt.Sprintf("stopped at the part limit (%d); some parts may not fit", s.MaxParts))
			break
		}
		id := queue[0]
		queue = queue[1:]
		hs := t.Path(id)
		pts := md.CellPoints(hs)
		if len(pts) == 0 {
			continue
		}
		rep := Representative(pts, 2500)
		downs := candidateDowns(rep, hs, s.Tilted, s.Upright, flatDirs(md, md.cellTris(hs), 6)...)
		f := FitPoints(rep, downs, bed)
		fits := false
		if f.Fits || (f.Slack > -15 && len(pts) <= 400000) {
			fits = FitPoints(pts, downs, bed).Fits
		}
		parentSupport := 0.0
		if fits {
			// Manual trees / auto-complete keep fitting leaves. Only a fresh
			// Auto split may add cuts solely to save support.
			if !s.supportSplit || s.supportWeight() == 0 {
				continue
			}
			if !supportPhase {
				optional = append(optional, id)
				continue
			}
			_, parentSupport = md.supportFit(pts, hs, downs, bed, s.supportWeight())
			// Even eliminating ALL support cannot pay for another part.
			if supportCost(parentSupport, s.supportWeight()) <= 100 {
				continue
			}
		}
		if progress != nil {
			progress(fmt.Sprintf("searching cut %d", len(t.Internal())+1))
		}
		c := md.bestCut(rep, hs, downs, s, fits)
		if c == nil && fits {
			continue
		}
		if c == nil {
			warnings = append(warnings, fmt.Sprintf("could not find a cut for a %.0f×%.0f×%.0f mm region", f.Extent[0], f.Extent[1], f.Extent[2]))
			continue
		}
		if fits && (c.est != 2 || c.cost >= 100+supportCost(parentSupport, s.supportWeight())) {
			continue
		}
		neg, pos := t.SplitLeaf(id, c.plane)
		t.Nodes[id].Reason = c.reason
		queue = append(queue, neg, pos)
	}
	return warnings
}

func isWorldAxis(n geom.Vec3) bool {
	return math.Abs(n[0]) > 0.9999 || math.Abs(n[1]) > 0.9999 || math.Abs(n[2]) > 0.9999
}

func (md *Model) bestCut(rep []geom.Vec3, hs []HalfSpace, downs []geom.Vec3, s *Settings, supportOnly bool) *cutCand {
	bed := s.splitBed()
	ax := PCA(rep)
	normals := dedupeDirs([]geom.Vec3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}, ax[0], ax[1], ax[2]}, false)
	var cands []*cutCand
	for _, n := range normals {
		// canonical sign: largest component positive
		mi := 0
		for k := 1; k < 3; k++ {
			if math.Abs(n[k]) > math.Abs(n[mi]) {
				mi = k
			}
		}
		if n[mi] < 0 {
			n = n.Scale(-1)
		}
		lo, hi := math.Inf(1), math.Inf(-1)
		for _, p := range rep {
			x := n.Dot(p)
			lo, hi = math.Min(lo, x), math.Max(hi, x)
		}
		minP := math.Min(s.MinPiece, (hi-lo)/4)
		if hi-lo < 2*minP+1 {
			continue
		}
		var ds []float64
		const K = 40
		for i := 0; i <= K; i++ {
			ds = append(ds, lo+minP+(hi-lo-2*minP)*float64(i)/K)
		}
		for _, b := range []float64{bed.X, bed.Y, bed.Z} {
			for _, f := range []float64{0.985, 0.95} {
				if lo+b*f > lo+minP && lo+b*f < hi-minP {
					ds = append(ds, lo+b*f)
				}
				if hi-b*f > lo+minP && hi-b*f < hi-minP {
					ds = append(ds, hi-b*f)
				}
			}
		}
		sl := md.Slicer(n)
		pdowns := append(append([]geom.Vec3{}, downs...), n)
		if s.Upright {
			pdowns = downs
		}
		for _, d := range ds {
			sec := sl.Slice(d, hs)
			var negPts, posPts []geom.Vec3
			for _, p := range rep {
				if n.Dot(p) < d {
					negPts = append(negPts, p)
				} else {
					posPts = append(posPts, p)
				}
			}
			var spts []geom.Vec3
			for _, l := range sec.Loops {
				step := len(l.P)/200 + 1
				for i := 0; i < len(l.P); i += step {
					spts = append(spts, sec.Frame.To3(l.P[i]))
				}
			}
			negPts = append(negPts, spts...)
			posPts = append(posPts, spts...)
			if len(negPts) < 4 || len(posPts) < 4 {
				continue
			}
			fn := FitPoints(negPts, pdowns, bed)
			fp := FitPoints(posPts, pdowns, bed)
			est := 0
			for _, side := range []struct {
				f   FitResult
				pts []geom.Vec3
			}{{fn, negPts}, {fp, posPts}} {
				if side.f.Fits {
					est++
				} else {
					est += max(2, EstParts(side.pts, bed))
				}
			}
			cands = append(cands, &cutCand{plane: Plane{N: n, D: d}, sec: sec, est: est, fitN: fn, fitP: fp, worldAxis: isWorldAxis(n), lo: lo, hi: hi})
		}
	}
	if len(cands) == 0 {
		return nil
	}
	maxT, maxA := 1e-9, 1e-9
	for _, c := range cands {
		maxT = math.Max(maxT, c.sec.Thickness)
		maxA = math.Max(maxA, c.sec.Area)
	}
	for _, c := range cands {
		sec := c.sec
		cost := 100 * float64(c.est)
		cost += 25 * sec.GrazeFrac
		cost += 6 * math.Min(5, float64(sec.SmallLoops))
		cost += 3 * math.Min(5, math.Max(0, float64(len(sec.Loops)-1)))
		cost += 15 * (1 - sec.Thickness/maxT)
		cost += 8 * sec.Area / maxA
		if !c.worldAxis {
			cost += 4
		}
		// similar-sized pieces are easier to print, pack and assemble
		a, b := c.plane.D-c.lo, c.hi-c.plane.D
		cost += 8 * (1 - math.Min(a, b)/math.Max(a, b))
		if c.fitN.Fits && c.fitP.Fits {
			cost += 10 * (1 - math.Min(1, math.Min(c.fitN.Slack, c.fitP.Slack)/30))
		} else if c.fitN.Fits || c.fitP.Fits {
			// one side done: prefer it as large as possible (less slack)
			sl := c.fitN.Slack
			if !c.fitN.Fits {
				sl = c.fitP.Slack
			}
			cost += 6 * math.Min(1, sl/60)
		}
		c.cost = cost
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].cost < cands[j].cost })
	if s.supportWeight() > 0 {
		// Bound the expensive geometry work: keep the best seam in each of
		// five offset bands per normal (<= 30 candidates). Do not let a
		// hundred near-identical mid-plane cuts crowd out another direction.
		shortlist := []*cutCand{}
		seen := map[[4]int]bool{}
		for _, c := range cands {
			n := c.plane.N
			key := [4]int{int(math.Round(n[0] * 1000)), int(math.Round(n[1] * 1000)), int(math.Round(n[2] * 1000)), min(4, int(5*(c.plane.D-c.lo)/(c.hi-c.lo)))}
			if seen[key] {
				continue
			}
			// Empty-space cuts can separate disconnected components that must
			// fit. Only optional support cuts require a material section.
			if supportOnly && c.sec.Area <= 1e-6 {
				continue
			}
			seen[key] = true
			dirs := append(append([]geom.Vec3{}, downs...), n)
			if s.Upright {
				dirs = downs
			}
			oldEst := c.est
			c.est = 0
			for _, side := range []float64{-1, 1} {
				child := append(append([]HalfSpace{}, hs...), HalfSpace{P: c.plane, Side: side})
				pts := md.CellPoints(child)
				f, v := md.supportFit(pts, child, dirs, bed, s.supportWeight())
				if f.Fits {
					c.est++
				} else {
					c.est += max(2, f.Est)
				}
				if side < 0 {
					c.fitN = f
				} else {
					c.fitP = f
				}
				c.support += v
			}
			c.cost += 100*float64(c.est-oldEst) + supportCost(c.support, s.supportWeight())
			shortlist = append(shortlist, c)
		}
		if len(shortlist) == 0 {
			return nil
		}
		cands = shortlist
		sort.SliceStable(cands, func(i, j int) bool { return cands[i].cost < cands[j].cost })
	}
	b := cands[0]
	b.reason = fmt.Sprintf("estimated %d part(s) on this branch; section %.0f mm², wall ~%.1f mm, %d loop(s), %.0f%% grazing", b.est, b.sec.Area, b.sec.Thickness, len(b.sec.Loops), 100*b.sec.GrazeFrac)
	if s.supportWeight() > 0 {
		b.reason += fmt.Sprintf("; support proxy ~%.0f cm³", b.support/1000)
	}
	return b
}
