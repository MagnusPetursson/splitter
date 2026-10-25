// Package bundle builds the export package (oriented STLs, packed plate
// 3MFs, assembly sheet, zip) entirely in memory, so the same code runs in
// the server and in the browser (WebAssembly).
package bundle

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"time"

	"github.com/MagnusPetursson/splitter/internal/export"
	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
	"github.com/MagnusPetursson/splitter/internal/plan"
)

// ExportPart describes one uploaded mesh.
type ExportPart struct {
	Label string  `json:"label"`
	Leaf  int     `json:"leaf"`
	Kind  string  `json:"kind"` // part | pin | coupon
	Count int     `json:"count"`
	File  string  `json:"file"`
	D     float64 `json:"d,omitempty"`
	Len   float64 `json:"len,omitempty"`
}

// ExportResult is returned to the client.
type ExportResult struct {
	ID       string       `json:"id"`
	Zip      string       `json:"zip"`
	Files    []string     `json:"files"`
	Plates   int          `json:"plates"`
	Parts    []PartReport `json:"parts"`
	Warnings []string     `json:"warnings"`
	Sheet    string       `json:"sheet"`
}

// PartReport is the export-time verification of one part.
type PartReport struct {
	Label     string     `json:"label"`
	Kind      string     `json:"kind"`
	Count     int        `json:"count"`
	Tris      int        `json:"tris"`
	Closed    bool       `json:"closed"`
	VolumeCM3 float64    `json:"volumeCm3"`
	Size      [3]float64 `json:"size"`
	Fits      bool       `json:"fits"`
	Plate     []int      `json:"plate"`
	Down      string     `json:"down"`
}

// SafeName replaces characters that are unsafe in file names.
var SafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// Build orients, packs and writes every export file. meshes is keyed by
// ExportPart.File. The returned map holds relative paths → bytes, including
// the zip of everything.
func Build(name string, pl *plan.Plan, parts []ExportPart, meshes map[string]*mesh.Mesh, bed plan.Bed, snapshot []byte) (*ExportResult, map[string][]byte, error) {
	if bed.X <= 0 {
		bed = pl.Usable
	}
	if bed.X <= 0 {
		bed = plan.Bed{X: 170, Y: 170, Z: 170}
	}
	margin := pl.Settings.Margin
	out := map[string][]byte{}
	res := &ExportResult{}
	leafBy := map[int]*plan.LeafInfo{}
	for _, l := range pl.Leaves {
		leafBy[l.ID] = l
	}
	var items []*export.Item
	var assembled []export.Object
	reports := map[string]*PartReport{}
	var order []string
	for _, p := range parts {
		m := meshes[p.File]
		st := m.EdgeStats()
		closed := st.Boundary == 0 && st.NonManifold == 0 && st.Misoriented == 0
		var printed *mesh.Mesh
		var size geom.Vec3
		down := "as built"
		switch p.Kind {
		case "part":
			l := leafBy[p.Leaf]
			if l == nil {
				return nil, nil, fmt.Errorf("part %s refers to unknown leaf %d", p.Label, p.Leaf)
			}
			r := plan.PrintTransform(l.Down, l.Angle)
			printed, size = export.Orient(m, r)
			down = l.PrintFace
			assembled = append(assembled, export.Object{Name: p.Label, Mesh: m})
		default:
			printed, size = export.Orient(m, geom.Identity())
		}
		fits := size[0] <= bed.X+0.05 && size[1] <= bed.Y+0.05 && size[2] <= bed.Z+0.05
		if !fits && size[1] <= bed.X+0.05 && size[0] <= bed.Y+0.05 && size[2] <= bed.Z+0.05 {
			fits = true // packer rotates 90°
		}
		count := max(1, p.Count)
		rep := &PartReport{Label: p.Label, Kind: p.Kind, Count: count, Tris: len(m.F), Closed: closed, VolumeCM3: math.Round(m.Volume()/10) / 100,
			Size: [3]float64{round1(size[0]), round1(size[1]), round1(size[2])}, Fits: fits, Down: down}
		reports[p.Label] = rep
		order = append(order, p.Label)
		if !closed {
			res.Warnings = append(res.Warnings, fmt.Sprintf("%s: mesh is not closed (%d open, %d non-manifold edges)", p.Label, st.Boundary, st.NonManifold))
		}
		if !fits {
			res.Warnings = append(res.Warnings, fmt.Sprintf("%s: %.0f×%.0f×%.0f mm does not fit %.0f×%.0f×%.0f", p.Label, size[0], size[1], size[2], bed.X, bed.Y, bed.Z))
		}
		var sb bytes.Buffer
		if err := printed.WriteBinarySTL(&sb, p.Label); err != nil {
			return nil, nil, err
		}
		out["parts/"+SafeName.ReplaceAllString(p.Label, "_")+".stl"] = sb.Bytes()
		for k := 0; k < count; k++ {
			lbl := p.Label
			if count > 1 {
				lbl = fmt.Sprintf("%s #%d", p.Label, k+1)
			}
			items = append(items, &export.Item{Name: lbl, Mesh: printed, W: size[0], H: size[1], Height: size[2], Part: p.Label})
		}
	}
	places := export.Pack(items, bed.X, bed.Y, 6)
	plates := map[int][]export.Object{}
	nPlates := 0
	for _, pc := range places {
		pm := export.Placed(pc, margin)
		plates[pc.Plate] = append(plates[pc.Plate], export.Object{Name: pc.Item.Name, Mesh: pm})
		if pc.Plate+1 > nPlates {
			nPlates = pc.Plate + 1
		}
		rep := reports[pc.Item.Part]
		rep.Plate = append(rep.Plate, pc.Plate+1)
	}
	res.Plates = nPlates
	var all []export.Object
	for k := 0; k < nPlates; k++ {
		var pb bytes.Buffer
		if err := export.Write3MF(&pb, plates[k], fmt.Sprintf("%s plate %d", name, k+1)); err != nil {
			return nil, nil, err
		}
		out[fmt.Sprintf("plates/plate_%02d.3mf", k+1)] = pb.Bytes()
		// all_parts.3mf: plates side by side along X
		for _, o := range plates[k] {
			c := o.Mesh.Clone()
			c.Transform(geom.Identity(), geom.Vec3{float64(k) * (bed.X + 2*margin + 30), 0, 0})
			all = append(all, export.Object{Name: fmt.Sprintf("plate %d · %s", k+1, o.Name), Mesh: c})
		}
	}
	{
		var ab bytes.Buffer
		if err := export.Write3MF(&ab, all, name+" all plates"); err != nil {
			return nil, nil, err
		}
		out["all_parts.3mf"] = ab.Bytes()
	}
	if len(assembled) > 0 {
		var ab bytes.Buffer
		if err := export.Write3MF(&ab, assembled, name+" assembled"); err != nil {
			return nil, nil, err
		}
		out["assembled_preview.3mf"] = ab.Bytes()
	}
	for _, l := range order {
		res.Parts = append(res.Parts, *reports[l])
	}
	// sheet + metadata
	sheet := renderSheet(name, pl, res, bed, snapshot)
	out["assembly.html"] = []byte(sheet)
	pj, _ := json.MarshalIndent(pl, "", " ")
	out["plan.json"] = pj
	rj, _ := json.MarshalIndent(res, "", " ")
	out["report.json"] = rj
	// zip
	zipName := name + "_split.zip"
	var files []string
	for f := range out {
		files = append(files, f)
	}
	sort.Strings(files)
	var zb bytes.Buffer
	zw := zip.NewWriter(&zb)
	now := time.Now()
	for _, rel := range files {
		hdr := &zip.FileHeader{Name: name + "/" + rel, Method: zip.Deflate, Modified: now}
		wz, err := zw.CreateHeader(hdr)
		if err != nil {
			return nil, nil, err
		}
		wz.Write(out[rel])
	}
	if err := zw.Close(); err != nil {
		return nil, nil, err
	}
	out[zipName] = zb.Bytes()
	res.Zip = zipName
	res.Files = append(files, zipName)
	res.Sheet = "assembly.html"
	return res, out, nil
}

func round1(x float64) float64 { return math.Round(x*10) / 10 }

func dataURI(png []byte) string {
	if len(png) == 0 {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
}
