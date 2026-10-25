//go:build js && wasm

// Command splitter-wasm is the in-browser build of the planner: mesh repair,
// cut planning, joint placement and export packaging, compiled to
// WebAssembly. It runs inside a Web Worker (web/js/gowork.js); nothing is
// uploaded anywhere.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"syscall/js"

	"github.com/MagnusPetursson/splitter/internal/bundle"
	"github.com/MagnusPetursson/splitter/internal/mesh"
	"github.com/MagnusPetursson/splitter/internal/plan"
	"github.com/MagnusPetursson/splitter/internal/printers"
)

type state struct {
	name, format string
	bytes        int
	repair       *mesh.RepairReport
	scale        float64
	base, cur    *mesh.Mesh
	md           *plan.Model
	unitHint     string
}

var cur *state

func progress(msg string) {
	js.Global().Call("postMessage", map[string]any{"type": "goprogress", "message": msg})
}

func jsonOf(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return errJSON(err)
	}
	return string(b)
}

func errJSON(err error) string {
	b, _ := json.Marshal(map[string]string{"error": err.Error()})
	return string(b)
}

func bytesOf(v js.Value) []byte {
	b := make([]byte, v.Get("length").Int())
	js.CopyBytesToGo(b, v)
	return b
}

func toJS(b []byte) js.Value {
	a := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(a, b)
	return a
}

func (s *state) applyScale(f float64) {
	s.scale = f
	c := s.base.Clone()
	if f != 1 {
		c.Scale(f)
	}
	s.cur = c
	s.md = plan.NewModel(c)
}

func (s *state) info() map[string]any {
	b := s.cur.Bounds()
	return map[string]any{"id": "local", "name": s.name, "format": s.format, "bytes": s.bytes, "repair": s.repair, "scale": s.scale,
		"bounds": [2][3]float64{b.Min, b.Max}, "size": b.Size(), "tris": len(s.cur.F), "volume": s.cur.Volume(), "unitHint": s.unitHint}
}

// guard turns panics into {"error": ...} results.
func guard(fn func(args []js.Value) any) js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) (out any) {
		defer func() {
			if r := recover(); r != nil {
				out = errJSON(fmt.Errorf("internal error: %v", r))
			}
		}()
		return fn(args)
	})
}

func main() {
	api := map[string]any{
		"printers": guard(func(a []js.Value) any {
			return jsonOf(map[string]any{"printers": printers.All, "fits": plan.DefaultFits(0.4), "fits06": plan.DefaultFits(0.6)})
		}),
		"kinds": guard(func(a []js.Value) any {
			return jsonOf(map[string]any{"point": plan.Kinds, "seam": plan.SeamKinds})
		}),
		// load(name, Uint8Array) → model info JSON
		"load": guard(func(a []js.Value) any {
			name := filepath.Base(a[0].String())
			data := bytesOf(a[1])
			progress(fmt.Sprintf("parsing %s (%.1f MB)", name, float64(len(data))/1e6))
			soup, format, err := mesh.Load(name, data)
			if err != nil {
				return errJSON(err)
			}
			progress(fmt.Sprintf("repairing %d triangles", len(soup.Tris)))
			m, rep, err := mesh.Repair(soup)
			if err != nil {
				return errJSON(err)
			}
			if !rep.Closed {
				return errJSON(fmt.Errorf("the mesh could not be made watertight (%s)", strings.Join(rep.Notes, "; ")))
			}
			s := &state{name: name, format: format, bytes: len(data), repair: rep, base: m}
			progress("indexing the mesh")
			s.applyScale(1)
			b := s.cur.Bounds()
			s.unitHint = mesh.UnitHint(b.Size())
			cur = s
			return jsonOf(s.info())
		}),
		// mesh() → Uint8Array (PSM1 binary of the current, scaled mesh)
		"mesh": guard(func(a []js.Value) any {
			if cur == nil {
				return js.Null()
			}
			var buf bytes.Buffer
			cur.cur.EncodeBinary(&buf)
			return toJS(buf.Bytes())
		}),
		"scale": guard(func(a []js.Value) any {
			f := a[0].Float()
			if cur == nil || !(f > 0 && f <= 10000) {
				return errJSON(fmt.Errorf("bad scale"))
			}
			cur.applyScale(f)
			return jsonOf(cur.info())
		}),
		// plan(requestJSON) → plan JSON
		"plan": guard(func(a []js.Value) any {
			if cur == nil {
				return errJSON(fmt.Errorf("no model loaded"))
			}
			var req plan.Request
			if err := json.Unmarshal([]byte(a[0].String()), &req); err != nil {
				return errJSON(fmt.Errorf("bad plan request: %v", err))
			}
			p, err := cur.md.Run(&req, progress)
			if err != nil {
				return errJSON(err)
			}
			return jsonOf(p)
		}),
		// export(base, planJSON, partsJSON, bedJSON, [Uint8Array...], snapshot|null)
		// → {result: JSON, files: {path: Uint8Array}}
		"export": guard(func(a []js.Value) any {
			var pl plan.Plan
			if s := a[1].String(); s != "" {
				if err := json.Unmarshal([]byte(s), &pl); err != nil {
					return map[string]any{"result": errJSON(fmt.Errorf("bad plan: %v", err))}
				}
			}
			var parts []bundle.ExportPart
			if err := json.Unmarshal([]byte(a[2].String()), &parts); err != nil || len(parts) == 0 {
				return map[string]any{"result": errJSON(fmt.Errorf("no parts"))}
			}
			var bed plan.Bed
			if s := a[3].String(); s != "" {
				json.Unmarshal([]byte(s), &bed)
			}
			meshes := map[string]*mesh.Mesh{}
			for i := 0; i < a[4].Length(); i++ {
				mm, err := mesh.DecodeBinary(bytesOf(a[4].Index(i)))
				if err != nil {
					return map[string]any{"result": errJSON(fmt.Errorf("mesh %d: %v", i, err))}
				}
				meshes[fmt.Sprintf("m%d", i)] = mm
			}
			var snap []byte
			if !a[5].IsNull() && !a[5].IsUndefined() {
				snap = bytesOf(a[5])
			}
			name := bundle.SafeName.ReplaceAllString(strings.TrimSuffix(a[0].String(), filepath.Ext(a[0].String())), "_")
			if name == "" {
				name = "model"
			}
			progress("packing plates and writing 3MF/STL")
			res, files, err := bundle.Build(name, &pl, parts, meshes, bed, snap)
			if err != nil {
				return map[string]any{"result": errJSON(err)}
			}
			res.ID = "local"
			fo := js.Global().Get("Object").New()
			for k, b := range files {
				fo.Set(k, toJS(b))
			}
			return map[string]any{"result": jsonOf(res), "files": fo}
		}),
	}
	js.Global().Set("splitter", js.ValueOf(api))
	js.Global().Call("postMessage", map[string]any{"type": "goready"})
	select {}
}
