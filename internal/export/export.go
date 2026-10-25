// Package export writes print-ready packages: per-part STL, 3MF plates,
// an assembled 3MF and a printable assembly sheet.
package export

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"

	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
)

// Object is a mesh with a name for 3MF output.
type Object struct {
	Name string
	Mesh *mesh.Mesh
}

// Write3MF writes a core-spec 3MF with every object as its own build item.
// Geometry is already in final (bed) coordinates.
func Write3MF(w io.Writer, objs []Object, title string) error {
	zw := zip.NewWriter(w)
	add := func(name, body string) error {
		f, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
		if err != nil {
			return err
		}
		_, err = io.WriteString(f, body)
		return err
	}
	if err := add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`); err != nil {
		return err
	}
	if err := add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`); err != nil {
		return err
	}
	f, err := zw.CreateHeader(&zip.FileHeader{Name: "3D/3dmodel.model", Method: zip.Deflate})
	if err != nil {
		return err
	}
	bw := &bytes.Buffer{}
	fmt.Fprintf(bw, `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">%s</metadata>
<metadata name="Application">print-splitter</metadata>
<resources>
`, xmlEsc(title))
	for i, o := range objs {
		fmt.Fprintf(bw, `<object id="%d" type="model" name="%s"><mesh><vertices>`, i+1, xmlEsc(o.Name))
		for _, v := range o.Mesh.V {
			fmt.Fprintf(bw, `<vertex x="%s" y="%s" z="%s"/>`, ff(v[0]), ff(v[1]), ff(v[2]))
		}
		bw.WriteString(`</vertices><triangles>`)
		for _, t := range o.Mesh.F {
			fmt.Fprintf(bw, `<triangle v1="%d" v2="%d" v3="%d"/>`, t[0], t[1], t[2])
		}
		bw.WriteString("</triangles></mesh></object>\n")
		if bw.Len() > 1<<20 {
			if _, err := f.Write(bw.Bytes()); err != nil {
				return err
			}
			bw.Reset()
		}
	}
	bw.WriteString("</resources>\n<build>\n")
	for i := range objs {
		fmt.Fprintf(bw, `<item objectid="%d"/>`+"\n", i+1)
	}
	bw.WriteString("</build>\n</model>\n")
	if _, err := f.Write(bw.Bytes()); err != nil {
		return err
	}
	return zw.Close()
}

func ff(x float64) string {
	s := fmt.Sprintf("%.4f", x)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	if s == "-0" || s == "" {
		return "0"
	}
	return s
}

func xmlEsc(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		case '&':
			b.WriteString("&amp;")
		case '"':
			b.WriteString("&quot;")
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Item is something to place on a plate.
type Item struct {
	Name   string
	Mesh   *mesh.Mesh // in print orientation, min corner at the origin
	W, H   float64    // footprint
	Height float64
	Part   string
}

// Placement is an item placed on a plate.
type Placement struct {
	Item  *Item
	Plate int
	X, Y  float64
	Rot   bool // rotated 90° about Z
}

// Pack places items on as few plates as possible using a skyline/shelf
// heuristic (largest first, both orientations tried).
func Pack(items []*Item, bedX, bedY, gap float64) []Placement {
	sorted := append([]*Item{}, items...)
	sort.SliceStable(sorted, func(a, b int) bool {
		return sorted[a].W*sorted[a].H > sorted[b].W*sorted[b].H
	})
	type shelf struct{ y, h, x float64 }
	type plate struct{ shelves []shelf }
	var plates []*plate
	var out []Placement
	place := func(it *Item) bool {
		for pi, p := range plates {
			for _, rot := range []bool{false, true} {
				w, h := it.W, it.H
				if rot {
					w, h = h, w
				}
				if w > bedX+1e-6 || h > bedY+1e-6 {
					continue
				}
				for si := range p.shelves {
					s := &p.shelves[si]
					if s.x+w <= bedX+1e-6 && h <= s.h+1e-6 {
						out = append(out, Placement{it, pi, s.x, s.y, rot})
						s.x += w + gap
						return true
					}
				}
				top := 0.0
				if n := len(p.shelves); n > 0 {
					top = p.shelves[n-1].y + p.shelves[n-1].h + gap
				}
				if top+h <= bedY+1e-6 {
					p.shelves = append(p.shelves, shelf{y: top, h: h, x: w + gap})
					out = append(out, Placement{it, pi, 0, top, rot})
					return true
				}
			}
		}
		return false
	}
	for _, it := range sorted {
		if place(it) {
			continue
		}
		plates = append(plates, &plate{})
		if !place(it) {
			// does not fit even on an empty plate: put it alone anyway
			out = append(out, Placement{it, len(plates) - 1, 0, 0, false})
		}
	}
	return out
}

// Placed returns the item mesh positioned on the bed (offset by margin).
func Placed(p Placement, margin float64) *mesh.Mesh {
	m := p.Item.Mesh.Clone()
	if p.Rot {
		// rotate 90° about Z then shift back into the positive quadrant
		r := geom.RotateZ(math.Pi / 2)
		m.Transform(r, geom.Vec3{p.Item.H, 0, 0})
	}
	m.Transform(geom.Identity(), geom.Vec3{p.X + margin, p.Y + margin, 0})
	return m
}

// Orient moves a mesh into print orientation with its min corner at the origin.
func Orient(m *mesh.Mesh, r geom.Mat3) (*mesh.Mesh, geom.Vec3) {
	o := m.Clone()
	o.Transform(r, geom.Vec3{})
	b := o.Bounds()
	o.Transform(geom.Identity(), b.Min.Scale(-1))
	return o, b.Size()
}
