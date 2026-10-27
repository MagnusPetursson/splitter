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
	"runtime"
	"runtime/debug"
	"strings"
	"syscall/js"
	"time"

	"github.com/MagnusPetursson/splitter/internal/bundle"
	"github.com/MagnusPetursson/splitter/internal/geom"
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
	// orig is the repaired full-detail mesh when the planner works on a
	// simplified copy (base); nil otherwise or when it was too large to
	// keep. simp reports the simplification.
	orig *mesh.Mesh
	simp *mesh.SimplifyReport
	// rot is the cumulative quarter-turn applied to base (and orig).
	rot geom.Mat3
}

var cur *state

// loadOptions arrive as JSON from the page.
type loadOptions struct {
	// Simplify: "auto" (above Threshold triangles) or "off".
	Simplify  string  `json:"simplify"`
	Threshold int     `json:"threshold"`
	Target    int     `json:"target"`
	MaxError  float64 `json:"maxError"` // mm
	// KeepOriginal: keep the full-detail mesh (for exports cut from the
	// original) when it has at most this many triangles.
	KeepOriginal int `json:"keepOriginal"`
}

func progress(msg string) {
	js.Global().Call("postMessage", map[string]any{"type": "goprogress", "message": msg})
}

// lastStep rate-limits structured progress to ~10 messages a second.
var lastStep, lastGC time.Time

// collect forces a garbage collection now and then. On WebAssembly the Go
// runtime has one thread, and while a call from JavaScript runs the
// collector's background workers never get scheduled: concurrent GC cycles
// do not finish and the heap grows until the call returns (measured: 1.8 GB
// of wasm memory to plan a 226k-triangle model, ~10× the live heap). A
// blocking runtime.GC() completes a cycle from inside the call.
func collect() {
	if time.Since(lastGC) < 750*time.Millisecond {
		return
	}
	runtime.GC()
	lastGC = time.Now()
}

// step posts structured progress: stage, done of total.
func step(stage string, done, total int, msg string) {
	collect()
	if done != 0 && done != total && time.Since(lastStep) < 100*time.Millisecond {
		return
	}
	lastStep = time.Now()
	m := map[string]any{"type": "goprogress", "stage": stage, "done": done, "total": total}
	if msg != "" {
		m["message"] = msg
	}
	js.Global().Call("postMessage", m)
}

// memMB reports the Go heap obtained from the browser (wasm linear memory
// never shrinks, so this is the high-water mark that matters).
func memMB() float64 {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return float64(ms.Sys) / (1 << 20)
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

// rotate turns the model (and the kept full-detail original) by a validated
// quarter-turn rotation, keeping the current scale.
func (s *state) rotate(r geom.Mat3) {
	s.base.Transform(r, geom.Vec3{})
	if s.orig != nil {
		s.orig.Transform(r, geom.Vec3{})
	}
	s.rot = r.Mul(s.rot)
	s.applyScale(s.scale)
}

func (s *state) info() map[string]any {
	b := s.cur.Bounds()
	m := map[string]any{"id": "local", "name": s.name, "format": s.format, "bytes": s.bytes, "repair": s.repair, "scale": s.scale,
		"bounds": [2][3]float64{b.Min, b.Max}, "size": b.Size(), "tris": len(s.cur.F), "volume": s.cur.Volume(), "unitHint": s.unitHint,
		"memMB": memMB(), "rot": s.rot}
	if s.simp != nil {
		m["simplified"] = s.simp
		m["originalKept"] = s.orig != nil
	}
	return m
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
	// Wasm memory never shrinks: keep the heap goal tight so peaks stay
	// low. The soft limit makes the collector work harder before growing
	// past ~2 GB (32-bit WebAssembly tops out at 4 GB).
	debug.SetGCPercent(50)
	debug.SetMemoryLimit(2 << 30)
	mesh.Checkpoint = func() { runtime.GC(); lastGC = time.Now() }
	api := map[string]any{
		"printers": guard(func(a []js.Value) any {
			return jsonOf(map[string]any{"printers": printers.All, "fits": plan.DefaultFits(0.4), "fits06": plan.DefaultFits(0.6)})
		}),
		"kinds": guard(func(a []js.Value) any {
			return jsonOf(map[string]any{"point": plan.Kinds, "seam": plan.SeamKinds})
		}),
		// load(name, Uint8Array, optionsJSON) → model info JSON
		"load": guard(func(a []js.Value) any {
			name := filepath.Base(a[0].String())
			opt := loadOptions{Simplify: "auto", Threshold: 600000, Target: 400000, MaxError: 0.05, KeepOriginal: 2500000}
			if len(a) > 2 && a[2].Type() == js.TypeString && a[2].String() != "" {
				if err := json.Unmarshal([]byte(a[2].String()), &opt); err != nil {
					return errJSON(fmt.Errorf("bad load options: %v", err))
				}
			}
			cur = nil
			runtime.GC()
			data := bytesOf(a[1])
			step("parse", 0, 1, fmt.Sprintf("parsing %s (%.1f MB)", name, float64(len(data))/1e6))
			soup, format, err := mesh.Load(name, data)
			nbytes := len(data)
			data = nil
			if err != nil {
				return errJSON(err)
			}
			step("repair", 0, 1, fmt.Sprintf("repairing %d triangles", len(soup.Tris)))
			m, rep, err := mesh.Repair(soup)
			soup = nil
			runtime.GC()
			if err != nil {
				return errJSON(err)
			}
			if !rep.Closed {
				b, _ := json.Marshal(map[string]any{"error": rep.Explain(), "kind": "watertight", "repair": rep})
				return string(b)
			}
			s := &state{name: name, format: format, bytes: nbytes, repair: rep, base: m, rot: geom.Mat3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}}
			if opt.Simplify != "off" && opt.Threshold > 0 && len(m.F) > opt.Threshold && opt.Target < len(m.F) {
				t0 := time.Now()
				step("simplify", 0, len(m.F)-opt.Target, fmt.Sprintf("simplifying %d triangles", len(m.F)))
				sm, srep, err := mesh.Simplify(m, mesh.SimplifyOptions{TargetTris: opt.Target, MaxError: opt.MaxError,
					Progress: func(d, t int) { step("simplify", d, t, "") }})
				if err == nil {
					step("measure", 0, 1, "measuring the deviation from the original")
					srep.MaxDev, srep.MeanDev, srep.RMSDev, srep.Samples = mesh.Deviation(m, sm, 100000)
					srep.Seconds = time.Since(t0).Seconds()
					s.simp = srep
					s.base = sm
					if len(m.F) <= opt.KeepOriginal {
						s.orig = m
					}
				} else {
					// keep the full mesh; the page shows why
					progress("simplification failed, planning on the full mesh: " + err.Error())
					s.simp = &mesh.SimplifyReport{InputTris: len(m.F), OutputTris: len(m.F), Failed: err.Error()}
				}
				m = nil
				runtime.GC()
			}
			step("index", 0, 1, "indexing the mesh")
			s.applyScale(1)
			b := s.cur.Bounds()
			s.unitHint = mesh.UnitHint(b.Size())
			cur = s
			return jsonOf(s.info())
		}),
		// fullMesh() → Uint8Array (PSM1 of the full-detail original, scaled)
		// or null when the planner works on the original anyway
		"fullMesh": guard(func(a []js.Value) any {
			if cur == nil || cur.orig == nil {
				return js.Null()
			}
			m := cur.orig
			if cur.scale != 1 {
				m = m.Clone()
				m.Scale(cur.scale)
			}
			var buf bytes.Buffer
			m.EncodeBinary(&buf)
			return toJS(buf.Bytes())
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
		// rotate([9]float64) → info; a quarter-turn (signed permutation, det +1)
		"rotate": guard(func(a []js.Value) any {
			if cur == nil || len(a) == 0 {
				return errJSON(fmt.Errorf("no model"))
			}
			var v []float64
			if err := json.Unmarshal([]byte(a[0].String()), &v); err != nil {
				return errJSON(err)
			}
			r, err := geom.QuarterTurn(v)
			if err != nil {
				return errJSON(err)
			}
			cur.rotate(r)
			return jsonOf(cur.info())
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
			cur.md.Step = func(stage string, done, total int) { step(stage, done, total, "") }
			t0 := time.Now()
			p, err := cur.md.Run(&req, func(msg string) { step("plan", 0, 0, msg) })
			cur.md.Step = nil
			if err != nil {
				return errJSON(err)
			}
			if p.Timing == nil {
				p.Timing = map[string]float64{}
			}
			p.Timing["wall"] = time.Since(t0).Seconds()
			p.Timing["memMB"] = memMB()
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
