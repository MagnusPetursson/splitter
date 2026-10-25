package mesh

import (
	"archive/zip"
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"path"
	"strconv"
	"strings"

	"github.com/MagnusPetursson/splitter/internal/geom"
)

// Soup is an unindexed triangle list as read from a file (STL is a soup;
// OBJ/3MF are indexed but we normalise everything through the welder).
type Soup struct {
	Tris [][3]geom.Vec3
}

// Load parses a model file, detecting format by name and content.
func Load(name string, data []byte) (*Soup, string, error) {
	lower := strings.ToLower(name)
	switch {
	case strings.HasSuffix(lower, ".3mf"):
		s, err := read3MF(data)
		return s, "3mf", err
	case strings.HasSuffix(lower, ".obj"):
		s, err := readOBJ(data)
		return s, "obj", err
	case strings.HasSuffix(lower, ".stl"):
		return readSTL(data)
	}
	// sniff
	if len(data) > 4 && data[0] == 'P' && data[1] == 'K' {
		s, err := read3MF(data)
		return s, "3mf", err
	}
	if bytes.Contains(data[:min(len(data), 4096)], []byte("\nv ")) {
		s, err := readOBJ(data)
		return s, "obj", err
	}
	return readSTL(data)
}

func readSTL(data []byte) (*Soup, string, error) {
	if len(data) >= 84 {
		n := binary.LittleEndian.Uint32(data[80:84])
		if int64(84)+int64(n)*50 == int64(len(data)) {
			s, err := readBinarySTL(data, int(n))
			return s, "stl-binary", err
		}
	}
	head := strings.TrimSpace(string(data[:min(len(data), 512)]))
	if strings.HasPrefix(strings.ToLower(head), "solid") {
		s, err := readASCIISTL(data)
		if err == nil && len(s.Tris) > 0 {
			return s, "stl-ascii", nil
		}
	}
	if len(data) >= 84 {
		// Some writers pad binary files; accept if the declared count fits.
		n := binary.LittleEndian.Uint32(data[80:84])
		if int64(84)+int64(n)*50 <= int64(len(data)) && n > 0 {
			s, err := readBinarySTL(data, int(n))
			return s, "stl-binary", err
		}
	}
	return nil, "", fmt.Errorf("not a valid STL file")
}

func readBinarySTL(data []byte, n int) (*Soup, error) {
	s := &Soup{Tris: make([][3]geom.Vec3, 0, n)}
	o := 84
	for i := 0; i < n; i++ {
		var t [3]geom.Vec3
		for k := 0; k < 3; k++ {
			for j := 0; j < 3; j++ {
				off := o + 12 + k*12 + j*4
				t[k][j] = float64(math.Float32frombits(binary.LittleEndian.Uint32(data[off:])))
			}
		}
		o += 50
		if finite(t) {
			s.Tris = append(s.Tris, t)
		}
	}
	return s, nil
}

func finite(t [3]geom.Vec3) bool {
	for _, p := range t {
		for _, x := range p {
			if math.IsNaN(x) || math.IsInf(x, 0) {
				return false
			}
		}
	}
	return true
}

func readASCIISTL(data []byte) (*Soup, error) {
	s := &Soup{}
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	var cur []geom.Vec3
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 4 && strings.EqualFold(f[0], "vertex") {
			var p geom.Vec3
			for j := 0; j < 3; j++ {
				v, err := strconv.ParseFloat(f[j+1], 64)
				if err != nil {
					return nil, fmt.Errorf("ascii stl: %v", err)
				}
				p[j] = v
			}
			cur = append(cur, p)
		} else if len(f) >= 1 && strings.EqualFold(f[0], "endloop") {
			for i := 1; i+1 < len(cur); i++ {
				t := [3]geom.Vec3{cur[0], cur[i], cur[i+1]}
				if finite(t) {
					s.Tris = append(s.Tris, t)
				}
			}
			cur = cur[:0]
		}
	}
	return s, sc.Err()
}

func readOBJ(data []byte) (*Soup, error) {
	s := &Soup{}
	var verts []geom.Vec3
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 1<<20), 1<<22)
	line := 0
	for sc.Scan() {
		line++
		t := strings.TrimSpace(sc.Text())
		if strings.HasPrefix(t, "v ") || strings.HasPrefix(t, "v\t") {
			f := strings.Fields(t)
			if len(f) < 4 {
				return nil, fmt.Errorf("obj line %d: bad vertex", line)
			}
			var p geom.Vec3
			for j := 0; j < 3; j++ {
				v, err := strconv.ParseFloat(f[j+1], 64)
				if err != nil {
					return nil, fmt.Errorf("obj line %d: %v", line, err)
				}
				p[j] = v
			}
			verts = append(verts, p)
		} else if strings.HasPrefix(t, "f ") || strings.HasPrefix(t, "f\t") {
			f := strings.Fields(t)[1:]
			idx := make([]int, 0, len(f))
			for _, tok := range f {
				a := tok
				if i := strings.IndexByte(tok, '/'); i >= 0 {
					a = tok[:i]
				}
				v, err := strconv.Atoi(a)
				if err != nil {
					return nil, fmt.Errorf("obj line %d: bad face index %q", line, tok)
				}
				if v < 0 {
					v = len(verts) + v
				} else {
					v--
				}
				if v < 0 || v >= len(verts) {
					return nil, fmt.Errorf("obj line %d: face index out of range", line)
				}
				idx = append(idx, v)
			}
			for i := 1; i+1 < len(idx); i++ {
				s.Tris = append(s.Tris, [3]geom.Vec3{verts[idx[0]], verts[idx[i]], verts[idx[i+1]]})
			}
		}
	}
	return s, sc.Err()
}

// --- 3MF (core spec subset: meshes, components, build item transforms) ---

type x3mfModel struct {
	Unit      string     `xml:"unit,attr"`
	Resources x3mfRes    `xml:"resources"`
	Build     []x3mfItem `xml:"build>item"`
}
type x3mfRes struct {
	Objects []x3mfObject `xml:"object"`
}
type x3mfObject struct {
	ID         string          `xml:"id,attr"`
	Mesh       *x3mfMesh       `xml:"mesh"`
	Components []x3mfComponent `xml:"components>component"`
}
type x3mfMesh struct {
	Vertices  []x3mfVertex `xml:"vertices>vertex"`
	Triangles []x3mfTri    `xml:"triangles>triangle"`
}
type x3mfVertex struct {
	X, Y, Z float64
}
type x3mfTri struct {
	V1 int `xml:"v1,attr"`
	V2 int `xml:"v2,attr"`
	V3 int `xml:"v3,attr"`
}
type x3mfComponent struct {
	ObjectID  string `xml:"objectid,attr"`
	Transform string `xml:"transform,attr"`
	Path      string `xml:"http://schemas.microsoft.com/3dmanufacturing/production/2015/06 path,attr"`
}
type x3mfItem struct {
	ObjectID  string `xml:"objectid,attr"`
	Transform string `xml:"transform,attr"`
	Path      string `xml:"http://schemas.microsoft.com/3dmanufacturing/production/2015/06 path,attr"`
}

// The vertex attrs are x,y,z; encoding/xml can't map three attrs from one tag
// spec, so decode manually.
func (v *x3mfVertex) UnmarshalXML(d *xml.Decoder, start xml.StartElement) error {
	for _, a := range start.Attr {
		f, err := strconv.ParseFloat(a.Value, 64)
		if err != nil {
			return err
		}
		switch a.Name.Local {
		case "x":
			v.X = f
		case "y":
			v.Y = f
		case "z":
			v.Z = f
		}
	}
	return d.Skip()
}

type affine struct {
	r geom.Mat3
	t geom.Vec3
}

func identityAffine() affine { return affine{r: geom.Identity()} }

func parseTransform(s string) (affine, error) {
	if strings.TrimSpace(s) == "" {
		return identityAffine(), nil
	}
	f := strings.Fields(s)
	if len(f) != 12 {
		return affine{}, fmt.Errorf("3mf: bad transform %q", s)
	}
	v := make([]float64, 12)
	for i := range f {
		x, err := strconv.ParseFloat(f[i], 64)
		if err != nil {
			return affine{}, err
		}
		v[i] = x
	}
	// 3MF matrices are row-vector form: p' = p * M (4x3)
	var a affine
	for i := 0; i < 3; i++ {
		for j := 0; j < 3; j++ {
			a.r[j][i] = v[i*3+j]
		}
	}
	a.t = geom.Vec3{v[9], v[10], v[11]}
	return a, nil
}

func (a affine) apply(p geom.Vec3) geom.Vec3 { return a.r.Apply(p).Add(a.t) }
func (a affine) then(b affine) affine { // b after a
	return affine{r: b.r.Mul(a.r), t: b.r.Apply(a.t).Add(b.t)}
}

func read3MF(data []byte) (*Soup, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("3mf: %v", err)
	}
	models := map[string]*x3mfModel{}
	var root string
	for _, f := range zr.File {
		name := "/" + strings.TrimPrefix(f.Name, "/")
		if !strings.HasSuffix(strings.ToLower(name), ".model") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		b, err := io.ReadAll(io.LimitReader(rc, 2<<30))
		rc.Close()
		if err != nil {
			return nil, err
		}
		var m x3mfModel
		if err := xml.Unmarshal(b, &m); err != nil {
			return nil, fmt.Errorf("3mf %s: %v", name, err)
		}
		models[name] = &m
		if strings.EqualFold(path.Base(name), "3dmodel.model") && strings.HasPrefix(strings.ToLower(name), "/3d/") && root == "" {
			root = name
		}
	}
	if root == "" {
		return nil, fmt.Errorf("3mf: no 3D/3dmodel.model")
	}
	s := &Soup{}
	var emit func(file, id string, tr affine, depth int) error
	emit = func(file, id string, tr affine, depth int) error {
		if depth > 16 {
			return fmt.Errorf("3mf: component nesting too deep")
		}
		m := models[file]
		if m == nil {
			return fmt.Errorf("3mf: missing part %s", file)
		}
		scale := unitScale(models[root].Unit)
		for _, o := range m.Resources.Objects {
			if o.ID != id {
				continue
			}
			if o.Mesh != nil {
				vs := o.Mesh.Vertices
				for _, t := range o.Mesh.Triangles {
					if t.V1 >= len(vs) || t.V2 >= len(vs) || t.V3 >= len(vs) || t.V1 < 0 || t.V2 < 0 || t.V3 < 0 {
						return fmt.Errorf("3mf: triangle index out of range")
					}
					var tri [3]geom.Vec3
					for k, vi := range []int{t.V1, t.V2, t.V3} {
						p := geom.Vec3{vs[vi].X, vs[vi].Y, vs[vi].Z}
						tri[k] = tr.apply(p).Scale(scale)
					}
					s.Tris = append(s.Tris, tri)
				}
			}
			for _, c := range o.Components {
				ct, err := parseTransform(c.Transform)
				if err != nil {
					return err
				}
				f := file
				if c.Path != "" {
					f = c.Path
				}
				if err := emit(f, c.ObjectID, ct.then(tr), depth+1); err != nil {
					return err
				}
			}
			return nil
		}
		return fmt.Errorf("3mf: object %s not found", id)
	}
	items := models[root].Build
	if len(items) == 0 {
		for _, o := range models[root].Resources.Objects {
			items = append(items, x3mfItem{ObjectID: o.ID})
		}
	}
	for _, it := range items {
		tr, err := parseTransform(it.Transform)
		if err != nil {
			return nil, err
		}
		f := root
		if it.Path != "" {
			f = it.Path
		}
		if err := emit(f, it.ObjectID, tr, 0); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func unitScale(u string) float64 {
	switch strings.ToLower(u) {
	case "micron":
		return 0.001
	case "centimeter":
		return 10
	case "meter":
		return 1000
	case "inch":
		return 25.4
	case "foot":
		return 304.8
	}
	return 1
}
