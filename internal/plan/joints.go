package plan

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

// FitTable holds radial clearances per side (mm) for each fit class.
type FitTable struct {
	Press float64 `json:"press"`
	Glue  float64 `json:"glue"`
	Slip  float64 `json:"slip"`
	Snap  float64 `json:"snap"`
	Seam  float64 `json:"seam"`
}

// DefaultFits are starting points for a well-tuned 0.4 mm nozzle (PLA/PETG);
// the joint test coupon exists to replace them with measured values.
func DefaultFits(nozzle float64) FitTable {
	extra := 0.0
	if nozzle >= 0.55 {
		extra = 0.05
	}
	return FitTable{Press: 0.05 + extra, Glue: 0.15 + extra, Slip: 0.20 + extra, Snap: 0.25 + extra, Seam: 0.15 + extra}
}

func (f *FitTable) normalize(nozzle float64) {
	d := DefaultFits(nozzle)
	fix := func(v *float64, def float64) {
		if *v <= 0 || *v > 2 || math.IsNaN(*v) {
			*v = def
		}
	}
	fix(&f.Press, d.Press)
	fix(&f.Glue, d.Glue)
	fix(&f.Slip, d.Slip)
	fix(&f.Snap, d.Snap)
	fix(&f.Seam, d.Seam)
}

func (f FitTable) Get(name string) float64 {
	switch name {
	case "press":
		return f.Press
	case "slip":
		return f.Slip
	case "snap":
		return f.Snap
	case "seam":
		return f.Seam
	}
	return f.Glue
}

// Joint is a point joint on a patch.
type Joint struct {
	ID       int       `json:"id"`
	Patch    int       `json:"patch"`
	Kind     string    `json:"kind"`
	P        geom.Vec2 `json:"p"`
	Angle    float64   `json:"angle"`
	Male     string    `json:"male"` // neg | pos | none
	Fit      string    `json:"fit"`
	Clear    float64   `json:"clear"` // resolved radial clearance
	D        float64   `json:"d"`     // pin/peg/magnet diameter
	Depth    float64   `json:"depth"` // requested depth per side (pins) / peg length / magnet thickness
	Size     string    `json:"size,omitempty"`
	ScrewLen float64   `json:"screwLen,omitempty"`
	Shape    string    `json:"shape,omitempty"`
	Auto     bool      `json:"auto"`
	Locked   bool      `json:"locked,omitempty"`

	// derived
	Origin   geom.Vec3  `json:"origin"`
	X        geom.Vec3  `json:"x"`
	Y        geom.Vec3  `json:"y"`
	Z        geom.Vec3  `json:"z"`
	HoleNeg  float64    `json:"holeNeg"` // cavity depth into the neg part
	HolePos  float64    `json:"holePos"`
	AvailNeg float64    `json:"availNeg"`
	AvailPos float64    `json:"availPos"`
	RReq     float64    `json:"rreq"`
	UpNeg    *geom.Vec2 `json:"upNeg,omitempty"` // teardrop/flat direction in joint XY when horizontal on that side
	UpPos    *geom.Vec2 `json:"upPos,omitempty"`
	Glue     bool       `json:"glue"`
	Warnings []string   `json:"warnings,omitempty"`
	// MinWall overrides the settings' minimum wall around this joint (set
	// when the user forces a style onto a thin contact).
	MinWall float64 `json:"minWall,omitempty"`
}

func (j *Joint) wall(s *Settings) float64 {
	if j.MinWall > 0 {
		return j.MinWall
	}
	return s.MinWall
}

// Seam is a joint that runs along the whole patch.
type Seam struct {
	Kind    string    `json:"kind"` // none | finger | tongue | lap | dovetail
	Depth   float64   `json:"depth"`
	Pitch   float64   `json:"pitch"`
	Fit     string    `json:"fit"`
	Clear   float64   `json:"clear"`
	Male    string    `json:"male"`
	Mode    string    `json:"mode"` // polar | linear
	Center  geom.Vec2 `json:"center"`
	Axis    float64   `json:"axis"`
	AngStep float64   `json:"angStep"`
	Inset   float64   `json:"inset"`
	Wall    float64   `json:"wall"`
	Width   float64   `json:"width"`
	Flank   float64   `json:"flank"`
	Offset  float64   `json:"offset"`
	Glue    bool      `json:"glue"`
	Auto    bool      `json:"auto"`
	Locked  bool      `json:"locked,omitempty"`
}

// Kinds documents the catalogue for the UI.
var Kinds = []map[string]any{
	{"kind": "dowel", "label": "Dowel pin (separate)", "glue": true, "desc": "Printed pin in two blind holes. Both cut faces stay flat, so parts can print on them."},
	{"kind": "filament", "label": "Filament pin Ø1.75", "glue": true, "desc": "Holes for short lengths of 1.75 mm filament: cheap, precise alignment, glue."},
	{"kind": "press", "label": "Press-fit pin", "glue": false, "desc": "Separate pin with interference-level clearance; holds without glue."},
	{"kind": "peg", "label": "Integrated peg", "glue": true, "desc": "Round peg printed on one part, socket in the other."},
	{"kind": "keyed", "label": "Keyed peg (D / hex)", "glue": true, "desc": "Anti-rotation peg; one is enough to register a small face."},
	{"kind": "magnet", "label": "Magnet pockets", "glue": false, "desc": "Matching pockets for disc magnets (glue the magnets, watch polarity)."},
	{"kind": "insert", "label": "Heat-set insert + screw", "glue": false, "desc": "Insert hole on one side, clearance + counterbore on the other."},
	{"kind": "bolt", "label": "Bolt + nut trap", "glue": false, "desc": "Through-bolt with a hex nut trap; no inserts needed."},
	{"kind": "snap", "label": "Snap-fit clip", "glue": false, "desc": "Cantilever hook that clicks into a pocket. Needs ≥ 6 mm of solid section."},
}

var SeamKinds = []map[string]any{
	{"kind": "finger", "label": "Finger / box joint", "desc": "Interlocking fingers along the seam; works in thin shells and gives glue area."},
	{"kind": "tongue", "label": "Tongue and groove", "desc": "Continuous tongue inset from both skins; needs walls ≥ ~3.6 mm."},
	{"kind": "lap", "label": "Half lap", "desc": "Inner half of the wall overlaps the outer half; for shells ≥ ~2.4 mm."},
	{"kind": "dovetail", "label": "Sliding dovetail", "desc": "Rail and slot across the face; slides together, no glue needed."},
}

type screwSpec struct {
	clear, head, headH, insertD, insertL, nutAF, nutH float64
}

var screws = map[string]screwSpec{
	// insert hole sizes follow the common CNC Kitchen / Ruthex M3×5.7 and M4×8.1 inserts
	"M2.5": {clear: 2.9, head: 5.0, headH: 2.5, insertD: 3.6, insertL: 4.0, nutAF: 5.0, nutH: 2.0},
	"M3":   {clear: 3.4, head: 6.0, headH: 3.0, insertD: 4.0, insertL: 5.7, nutAF: 5.5, nutH: 2.4},
	"M4":   {clear: 4.5, head: 7.6, headH: 4.0, insertD: 5.6, insertL: 8.1, nutAF: 7.0, nutH: 3.2},
	"M5":   {clear: 5.5, head: 9.0, headH: 5.0, insertD: 6.4, insertL: 9.5, nutAF: 8.0, nutH: 4.0},
}

// Screw returns the screw/insert dimensions (exported for the UI/sheet).
func Screw(size string) (clear, head, insertD, insertL, nutAF, nutH float64) {
	s, ok := screws[size]
	if !ok {
		s = screws["M3"]
	}
	return s.clear, s.head, s.insertD, s.insertL, s.nutAF, s.nutH
}

// resolve fills derived requirements (RReq, hole depths) from the kind and
// parameters. It does not measure the geometry.
func (j *Joint) resolve(s *Settings) {
	j.Clear = s.Fits.Get(j.Fit)
	w := j.wall(s)
	c := j.Clear
	switch j.Kind {
	case "dowel", "press":
		if j.D <= 0 {
			j.D = 5
		}
		if j.Depth <= 0 {
			j.Depth = geom.Clamp(1.6*j.D, 5, 12)
		}
		j.Male = "none"
		j.RReq = j.D/2 + c + w
		j.HoleNeg, j.HolePos = j.Depth+0.3, j.Depth+0.3
	case "filament":
		j.D = 1.75
		if j.Depth <= 0 {
			j.Depth = 8
		}
		j.Male = "none"
		j.RReq = j.D/2 + c + w
		j.HoleNeg, j.HolePos = j.Depth+0.5, j.Depth+0.5
	case "peg", "keyed":
		if j.D <= 0 {
			j.D = 5
		}
		if j.Depth <= 0 {
			j.Depth = geom.Clamp(1.2*j.D, 4, 10)
		}
		if j.Kind == "keyed" && j.Shape == "" {
			j.Shape = "hex"
		}
		if j.Male != "pos" {
			j.Male = "neg"
		}
		r := j.D / 2
		if j.Shape == "hex" {
			r = j.D / math.Sqrt(3) // D is across flats
		}
		j.RReq = r + c + w
		if j.Male == "neg" {
			j.HoleNeg, j.HolePos = 2, j.Depth+0.4
		} else {
			j.HoleNeg, j.HolePos = j.Depth+0.4, 2
		}
	case "magnet":
		if j.D <= 0 {
			j.D = 6
		}
		if j.Depth <= 0 {
			j.Depth = 3
		}
		j.Male = "none"
		j.RReq = j.D/2 + c + w
		j.HoleNeg, j.HolePos = j.Depth+0.2, j.Depth+0.2
	case "insert":
		if j.Size == "" {
			j.Size = "M3"
		}
		sp := screws[j.Size]
		if j.ScrewLen <= 0 {
			j.ScrewLen = math.Round(sp.insertL*2/2) * 2
			if j.ScrewLen < 8 {
				j.ScrewLen = 8
			}
		}
		if j.Male != "pos" {
			j.Male = "neg" // "male" = the side holding the insert
		}
		j.RReq = sp.head/2 + c + w
		if r := sp.insertD/2 + 1.6; r > j.RReq-1e-9 {
			j.RReq = r
		}
		ins := sp.insertL + 1.0
		other := j.ScrewLen - sp.insertL*0.8 + sp.headH
		if j.Male == "neg" {
			j.HoleNeg, j.HolePos = ins, other
		} else {
			j.HoleNeg, j.HolePos = other, ins
		}
	case "bolt":
		if j.Size == "" {
			j.Size = "M3"
		}
		sp := screws[j.Size]
		if j.ScrewLen <= 0 {
			j.ScrewLen = 16
		}
		if j.Male != "pos" {
			j.Male = "neg" // nut side
		}
		nutR := (sp.nutAF + 2*c) / math.Sqrt(3)
		j.RReq = math.Max(nutR, sp.head/2+c) + w
		j.HoleNeg, j.HolePos = j.ScrewLen/2+sp.nutH, j.ScrewLen/2+sp.headH
	case "snap":
		if j.D <= 0 {
			j.D = 6 // beam width
		}
		if j.Depth <= 0 {
			j.Depth = 10 // beam length beyond the face
		}
		if j.Male != "pos" {
			j.Male = "neg"
		}
		tb, hook := 1.8, 0.9
		hw := (tb + hook + 2*c) / 2
		j.RReq = math.Hypot(j.D/2+c, hw+hook) + w
		if j.Male == "neg" {
			j.HoleNeg, j.HolePos = 2, j.Depth+c+0.4
		} else {
			j.HoleNeg, j.HolePos = j.Depth+c+0.4, 2
		}
	default:
		j.Kind = "dowel"
		j.resolve(s)
		return
	}
	j.Glue = j.Fit == "glue"
}

// MinFloor is the material left beyond the deepest cavity.
const MinFloor = 0.8

// styleKinds maps a joint style to preferred kinds and fits.
func styleKinds(style string) (kinds []string, fit string) {
	switch style {
	case "press":
		return []string{"press"}, "press"
	case "pegs":
		return []string{"peg"}, "slip"
	case "keyed":
		return []string{"keyed"}, "glue"
	case "magnets":
		return []string{"magnet", "dowel"}, "glue"
	case "screws":
		return []string{"insert", "dowel"}, "glue"
	case "bolts":
		return []string{"bolt", "dowel"}, "glue"
	case "snap":
		return []string{"snap", "press"}, "snap"
	case "filament":
		return []string{"filament"}, "glue"
	case "finger", "tongue", "lap", "dovetail", "seam":
		return nil, "seam"
	}
	return []string{"dowel"}, "glue"
}

func sizesFor(kind string) []float64 {
	switch kind {
	case "dowel", "press", "peg", "keyed":
		return []float64{8, 6, 5, 4, 3}
	case "magnet":
		return []float64{10, 8, 6, 5}
	case "snap":
		return []float64{8, 6, 5}
	case "filament":
		return []float64{1.75}
	}
	return []float64{0}
}

// faceCtx bundles what joint placement needs.
type faceCtx struct {
	md    *Model
	t     *Tree
	face  *Face
	patch *Patch
	s     *Settings
}

// avail measures how deep a cavity can go into the given side at p (frame
// coords) with lateral radius r: the minimum over the centre ray and 8 rim
// rays of the distance to the model surface or the leaf's other cut planes.
func (fc *faceCtx) avail(p geom.Vec2, r float64, side float64) float64 {
	fr := fc.face.fr
	leaf := fc.patch.NegLeaf
	if side > 0 {
		leaf = fc.patch.PosLeaf
	}
	hs := fc.t.PathBetween(fc.patch.Node, leaf)
	dir := fr.N.Scale(side)
	best := math.Inf(1)
	samples := []geom.Vec2{p}
	for k := 0; k < 8; k++ {
		a := float64(k) * math.Pi / 4
		samples = append(samples, p.Add(geom.Vec2{r * math.Cos(a), r * math.Sin(a)}))
	}
	bvh := fc.md.BVH()
	for _, q := range samples {
		o := fr.To3(q)
		d := bvh.Ray(o, dir, 1e-6, 400)
		for _, h := range hs {
			den := h.P.N.Dot(dir) * h.Side
			if den < -1e-9 {
				val := h.Side * h.P.Eval(o)
				if t := -val / den; t >= 0 && t < d {
					d = t
				}
			}
		}
		if d < best {
			best = d
		}
	}
	return best
}

// JointFallback records that a patch could not get the joint style the user
// chose, what it got instead and why. The UI shows it as a badge; it is
// never applied silently.
type JointFallback struct {
	Style  string `json:"style"`            // requested style (settings value)
	Want   string `json:"want"`             // e.g. "Dowels"
	Got    string `json:"got"`              // e.g. "lap seam", "butt joint (glue only)"
	Reason string `json:"reason"`           // short, e.g. "wall 2.3 mm"
	Why    string `json:"why"`              // full explanation with numbers
	Forced bool   `json:"forced,omitempty"` // the user asked to force the style and it still cannot be placed
}

// StyleLabel is the plural display name of a joint style.
func StyleLabel(style string) string {
	switch style {
	case "glued", "dowel", "":
		return "Dowels"
	case "filament":
		return "Filament pins"
	case "pegs":
		return "Pegs"
	case "keyed":
		return "Keyed pegs"
	case "press":
		return "Press-fit pins"
	case "snap":
		return "Snap clips"
	case "magnets":
		return "Magnets"
	case "screws":
		return "Inserts + screws"
	case "bolts":
		return "Bolts"
	case "finger":
		return "Finger joint"
	case "tongue":
		return "Tongue and groove"
	case "lap":
		return "Half lap"
	case "dovetail":
		return "Dovetail"
	case "seam", "auto":
		return "Seam joint"
	}
	return style
}

func kindNoun(kind string, n int) string {
	one := map[string]string{"dowel": "dowel", "filament": "filament pin", "press": "press-fit pin", "peg": "peg",
		"keyed": "keyed peg", "magnet": "magnet", "insert": "insert", "bolt": "bolt", "snap": "snap clip"}[kind]
	if one == "" {
		one = kind
	}
	if n == 1 {
		return one
	}
	return one + "s"
}

// hardWall is the absolute minimum skin (two perimeters) used when the user
// forces a style below the recommended wall.
func (s *Settings) hardWall() float64 { return math.Max(0.8, 2*s.Nozzle) }

// seamMin is the wall thickness a seam kind needs (recommended or forced).
func seamMin(kind string, s *Settings, force bool) float64 {
	w := s.MinWall
	if force {
		w = s.hardWall()
	}
	switch kind {
	case "tongue":
		return 3 * w
	case "lap":
		return 2 * w
	}
	return 0.9 * w
}

// substituteSeamKind picks a seam by wall thickness: tongue, then lap, then
// finger. Dovetail is only ever used when chosen.
func substituteSeamKind(t float64, s *Settings) string {
	switch {
	case t >= seamMin("tongue", s, false):
		return "tongue"
	case t >= seamMin("lap", s, false):
		return "lap"
	case t >= seamMin("finger", s, false):
		return "finger"
	}
	return ""
}

// patchStyle is the joint style in effect for this patch.
func (fc *faceCtx) patchStyle() string {
	if fc.patch.Style != "" {
		return fc.patch.Style
	}
	return fc.s.JointStyle
}

// placeAuto chooses joints for a patch. The user's style wins: point
// styles are placed wherever they physically fit (even a single one, with
// a warning); a substitute is used only when the chosen style cannot be
// placed at all, and that is recorded in patch.Fallback for the UI.
func (fc *faceCtx) placeAuto(nextID *int) ([]*Joint, *Seam, []string) {
	p := fc.patch
	s := fc.s
	style := fc.patchStyle()
	force := p.Force
	var notes []string
	p.Fallback, p.Single = nil, false
	if p.Style != "" {
		notes = append(notes, fmt.Sprintf("%s chosen for this contact", strings.ToLower(StyleLabel(style))))
	}
	kinds, fit := styleKinds(style)
	if fit == "seam" {
		kind := style
		if kind == "seam" || kind == "auto" {
			kind = substituteSeamKind(p.Thickness, s)
			if kind == "" {
				notes = append(notes, fmt.Sprintf("wall %.1f mm is too thin for any seam joint: butt-glue only", p.Thickness))
				return nil, nil, notes
			}
		}
		sm, why := fc.seam(kind, force)
		if sm != nil {
			if force && p.Thickness < seamMin(kind, s, false) {
				notes = append(notes, fmt.Sprintf("forced: wall %.1f mm is below the recommended %.1f mm for %s", p.Thickness, seamMin(kind, s, false), strings.ToLower(StyleLabel(kind))))
			}
			return nil, sm, notes
		}
		sub := fc.substitute(kind)
		fc.fallback(style, sub, nil, why, force)
		return nil, sub, notes
	}
	targetK := 2
	switch {
	case p.Area > 15000:
		targetK = 4
	case p.Area > 4000:
		targetK = 3
	case p.Area < 150:
		targetK = 1
	}
	if style == "screws" || style == "bolts" {
		targetK = min(targetK, 3)
	}
	var firstWhy string
	for ki, kind := range kinds {
		kfit := fit
		if kind == "dowel" {
			kfit = "glue"
		}
		if kind == "press" {
			kfit = "press"
		}
		out, why := fc.points(kind, kfit, targetK, force, nextID)
		if len(out) == 0 {
			if ki == 0 {
				firstWhy = why
			}
			continue
		}
		if ki > 0 {
			fc.fallback(style, nil, out, firstWhy, force)
		} else if force && out[0].RReq+s.MinWall-s.hardWall() > p.RMax {
			notes = append(notes, fmt.Sprintf("forced: %s with %.1f mm walls (recommended %.1f mm); print a coupon first", kindNoun(kind, len(out)), s.hardWall(), s.MinWall))
		}
		if len(out) == 1 && targetK > 1 && kind != "keyed" {
			p.Single = true
			notes = append(notes, fmt.Sprintf("only one %s fits: parts can rotate; consider keyed pegs or a seam", kindNoun(kind, 1)))
		}
		return out, nil, notes
	}
	sub := fc.substitute("")
	fc.fallback(style, sub, nil, firstWhy, force)
	return nil, sub, notes
}

// fallback records a substitution on the patch.
func (fc *faceCtx) fallback(style string, sm *Seam, pts []*Joint, why string, force bool) {
	p := fc.patch
	fb := &JointFallback{Style: style, Want: StyleLabel(style), Why: why, Forced: force}
	switch {
	case sm != nil:
		fb.Got = map[string]string{"finger": "finger seam", "tongue": "tongue-and-groove seam", "lap": "lap seam", "dovetail": "dovetail"}[sm.Kind]
	case len(pts) > 0:
		fb.Got = kindNoun(pts[0].Kind, len(pts))
	default:
		fb.Got = "butt joint (glue only)"
	}
	if p.Ring || p.Thickness < 3*fc.s.MinWall {
		fb.Reason = fmt.Sprintf("wall %.1f mm", p.Thickness)
	} else if strings.Contains(why, "inscribed") {
		fb.Reason = fmt.Sprintf("face too small (max Ø%.1f mm)", 2*p.RMax)
	} else {
		fb.Reason = "not enough depth"
	}
	p.Fallback = fb
}

// substitute picks the seam used when the chosen style cannot be placed.
func (fc *faceCtx) substitute(exclude string) *Seam {
	t := fc.patch.Thickness
	for _, k := range []string{"tongue", "lap", "finger"} {
		if k == exclude || t < seamMin(k, fc.s, false) {
			continue
		}
		if sm, _ := fc.seam(k, false); sm != nil {
			return sm
		}
	}
	return nil
}

// points tries every size of a point kind and returns the joints of the
// largest size that reaches min(2, k) placements, else the best single.
func (fc *faceCtx) points(kind, kfit string, k int, force bool, nextID *int) ([]*Joint, string) {
	p := fc.patch
	s := fc.s
	var sizeOpts []string
	if kind == "insert" || kind == "bolt" {
		sizeOpts = []string{"M4", "M3", "M2.5"}
	}
	ds := sizesFor(kind)
	if sizeOpts != nil {
		ds = make([]float64, len(sizeOpts))
	}
	want := min(2, k)
	var single *Joint
	var singleP []geom.Vec2
	var smallest *Joint
	shallow := false
	for si := range ds {
		proto := &Joint{Kind: kind, Fit: kfit, D: ds[si], Auto: true}
		if force {
			proto.MinWall = s.hardWall()
		}
		if sizeOpts != nil {
			proto.Size = sizeOpts[si]
			proto.D = 0
		}
		if kind == "magnet" {
			proto.Depth = map[float64]float64{10: 3, 8: 3, 6: 3, 5: 2}[ds[si]]
		}
		proto.resolve(s)
		smallest = proto
		if p.RMax < proto.RReq {
			continue
		}
		pts := fc.spread(proto, k, force)
		if len(pts) == 0 {
			shallow = true
			continue
		}
		if len(pts) >= want {
			return fc.emit(proto, pts, nextID), ""
		}
		if single == nil {
			single, singleP = proto, pts
		}
	}
	if single != nil {
		return fc.emit(single, singleP, nextID), ""
	}
	if smallest == nil {
		return nil, "no size available"
	}
	if shallow {
		return nil, fmt.Sprintf("no spot has %.1f mm of material on both sides of the cut for %s", math.Min(smallest.HoleNeg, smallest.HolePos)+MinFloor, kindNoun(kind, 2))
	}
	sz := fmt.Sprintf("Ø%g mm", smallest.D)
	if smallest.Size != "" {
		sz = smallest.Size
	}
	return nil, fmt.Sprintf("wall %.1f mm, largest inscribed Ø%.1f mm; the smallest %s (%s) needs Ø%.1f mm", p.Thickness, 2*p.RMax, kindNoun(kind, 1), sz, 2*smallest.RReq)
}

func (fc *faceCtx) emit(proto *Joint, pts []geom.Vec2, nextID *int) []*Joint {
	var out []*Joint
	for _, pt := range pts {
		j := *proto
		j.ID = *nextID
		*nextID++
		j.Patch = fc.patch.ID
		j.P = pt
		j.Angle = fc.patch.Axis
		out = append(out, &j)
	}
	return out
}

// spread picks up to k admissible points with maximal mutual spacing and
// enough depth on both sides, adjusting pin depth down where needed.
func (fc *faceCtx) spread(proto *Joint, k int, relax bool) []geom.Vec2 {
	f := fc.face
	g := f.grid
	p := fc.patch
	var cand []int32
	for _, px := range p.pixels {
		if float64(f.edt[px]) >= proto.RReq {
			cand = append(cand, px)
		}
	}
	if len(cand) == 0 {
		return nil
	}
	if len(cand) > 5000 {
		step := len(cand)/5000 + 1
		var c2 []int32
		for i := 0; i < len(cand); i += step {
			c2 = append(c2, cand[i])
		}
		cand = c2
	}
	pos := make([]geom.Vec2, len(cand))
	for i, px := range cand {
		pos[i] = g.Center(int(px)%g.W, int(px)/g.W)
	}
	rr := proto.RReq - proto.wall(fc.s)
	minSpacing := math.Max(2.5*proto.RReq, 12)
	needNeg := proto.HoleNeg + MinFloor
	needPos := proto.HolePos + MinFloor
	if proto.Kind == "insert" || proto.Kind == "bolt" {
		// screw/bolt holes may exit the far side (counterbore): only the
		// insert / nut side needs blind depth
		if proto.Male == "neg" {
			needPos = 3
		} else {
			needNeg = 3
		}
		if proto.Kind == "bolt" {
			needNeg, needPos = 3, 3
		}
	}
	ok := func(q geom.Vec2) bool {
		an := fc.avail(q, rr, -1)
		ap := fc.avail(q, rr, 1)
		return an >= needNeg && ap >= needPos
	}
	tryDepth := func(q geom.Vec2) bool {
		if ok(q) {
			return true
		}
		// pins: allow shallower holes down to 4 mm per side
		if proto.Kind == "dowel" || proto.Kind == "press" || proto.Kind == "filament" {
			an := fc.avail(q, rr, -1) - MinFloor
			ap := fc.avail(q, rr, 1) - MinFloor
			if math.Min(an, ap) >= 4.3 {
				return true
			}
		}
		if relax {
			// forced by the user: accept any spot with 2 mm of hole per
			// side; finalize() reports what is short
			an := fc.avail(q, rr, -1) - MinFloor
			ap := fc.avail(q, rr, 1) - MinFloor
			return math.Min(an, ap) >= 2
		}
		return false
	}
	var chosen []geom.Vec2
	rejected := make([]bool, len(pos))
	// first: farthest from centroid (spreads the pair across the face)
	for len(chosen) < k {
		best, bi := -1.0, -1
		for i, q := range pos {
			if rejected[i] {
				continue
			}
			var score float64
			if len(chosen) == 0 {
				score = q.Sub(p.Centroid).Len()
			} else {
				score = math.Inf(1)
				for _, c := range chosen {
					score = math.Min(score, q.Sub(c).Len())
				}
				if score < minSpacing {
					continue
				}
				// slight preference for deeper (thicker) spots
				score += 0.15 * f.distIn(p.ID, q)
			}
			if score > best {
				best, bi = score, i
			}
		}
		if bi < 0 {
			break
		}
		if tryDepth(pos[bi]) {
			chosen = append(chosen, pos[bi])
		}
		rejected[bi] = true
		// reject neighbours of a failed/accepted pick quickly
		for i, q := range pos {
			if !rejected[i] && q.Sub(pos[bi]).Len() < 0.5 {
				rejected[i] = true
			}
		}
	}
	return chosen
}

// seam builds a seam joint of the given kind, or returns why it cannot.
func (fc *faceCtx) seam(kind string, force bool) (*Seam, string) {
	p := fc.patch
	s := fc.s
	t := p.Thickness
	if need := seamMin(kind, s, force); t < need {
		return nil, fmt.Sprintf("wall %.1f mm; %s needs ≥ %.1f mm", t, strings.ToLower(StyleLabel(kind)), need)
	}
	sm := &Seam{Kind: kind, Fit: "glue", Auto: true, Glue: true, Male: "neg", Center: p.Centroid, Axis: p.Axis, Wall: t}
	switch kind {
	case "tongue":
		sm.Inset = t / 3 // = max(MinWall, t/3) above the recommended wall
		sm.Depth = geom.Clamp(1.5*t, 3, 8)
	case "lap":
		sm.Depth = geom.Clamp(3*t, 5, 12)
	case "dovetail":
		minR := 6.0
		if force {
			minR = 4
		}
		if p.RMax < minR {
			return nil, fmt.Sprintf("largest inscribed Ø%.1f mm; a dovetail needs Ø%.0f mm", 2*p.RMax, 2*minR)
		}
		sm.Width = geom.Clamp(p.RMax*0.8, 4, 14)
		sm.Depth = geom.Clamp(p.RMax*0.6, 3, 8)
		sm.Flank = 15
		sm.Fit = "slip"
		sm.Glue = false
	default:
		sm.Kind = "finger"
		sm.Depth = geom.Clamp(3*t, 4, 8)
		sm.Pitch = geom.Clamp(4*math.Max(t, 2), 6, 14)
	}
	sm.Clear = s.Fits.Get(map[bool]string{true: "seam", false: sm.Fit}[sm.Fit == "glue"])
	if sm.Kind == "finger" {
		if p.Ring && p.RMean > 0 {
			sm.Mode = "polar"
			sm.AngStep = sm.Pitch / p.RMean
		} else {
			sm.Mode = "linear"
		}
	}
	return sm, ""
}

// FinalizeJoint computes world frame, availability and warnings for a joint.
func (fc *faceCtx) finalize(j *Joint) {
	fr := fc.face.fr
	j.resolve(fc.s)
	j.Origin = fr.To3(j.P)
	ca, sa := math.Cos(j.Angle), math.Sin(j.Angle)
	j.X = fr.U.Scale(ca).Add(fr.V.Scale(sa))
	j.Z = fr.N
	j.Y = j.Z.Cross(j.X)
	rr := j.RReq - j.wall(fc.s)
	j.AvailNeg = fc.avail(j.P, rr, -1)
	j.AvailPos = fc.avail(j.P, rr, 1)
	j.Warnings = nil
	if d := fc.face.distIn(fc.patch.ID, j.P); d < j.RReq {
		if d <= 0 {
			j.Warnings = append(j.Warnings, "outside the contact face")
		} else {
			j.Warnings = append(j.Warnings, fmt.Sprintf("too close to the edge (%.1f mm, needs %.1f mm): may break through the surface", d, j.RReq))
		}
	}
	// shrink pin holes to the available depth when needed
	if j.Kind == "dowel" || j.Kind == "press" || j.Kind == "filament" {
		for _, side := range []struct {
			hole  *float64
			avail float64
		}{{&j.HoleNeg, j.AvailNeg}, {&j.HolePos, j.AvailPos}} {
			if *side.hole+MinFloor > side.avail {
				nh := side.avail - MinFloor
				if nh < 3 {
					j.Warnings = append(j.Warnings, fmt.Sprintf("only %.1f mm of material behind the face", side.avail))
					nh = math.Max(nh, 1)
				}
				*side.hole = nh
			}
		}
	} else {
		if j.HoleNeg+MinFloor > j.AvailNeg && !(j.Kind == "insert" && j.Male == "pos") && j.Kind != "bolt" {
			j.Warnings = append(j.Warnings, fmt.Sprintf("neg side has %.1f mm, needs %.1f mm", j.AvailNeg, j.HoleNeg+MinFloor))
		}
		if j.HolePos+MinFloor > j.AvailPos && !(j.Kind == "insert" && j.Male == "neg") && j.Kind != "bolt" {
			j.Warnings = append(j.Warnings, fmt.Sprintf("pos side has %.1f mm, needs %.1f mm", j.AvailPos, j.HolePos+MinFloor))
		}
	}
}

// PinLength returns the separate pin length for dowel-like joints.
func (j *Joint) PinLength() float64 {
	return math.Max(2, j.HoleNeg+j.HolePos-0.6)
}

func sortJoints(js []*Joint) {
	sort.SliceStable(js, func(a, b int) bool {
		if js[a].Patch != js[b].Patch {
			return js[a].Patch < js[b].Patch
		}
		return js[a].ID < js[b].ID
	})
}
