// Package server is the HTTP API + embedded UI.
package server

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/MagnusPetursson/splitter/internal/mesh"
	"github.com/MagnusPetursson/splitter/internal/plan"
	"github.com/MagnusPetursson/splitter/internal/printers"
)

// Config for the server.
type Config struct {
	Addr      string
	DataDir   string
	MaxUpload int64
	TTL       time.Duration
	Web       fs.FS
	Version   string
}

// Server state.
type Server struct {
	cfg    Config
	mu     sync.Mutex
	models map[string]*model
	jobs   map[string]*job
	sem    chan struct{}
}

type model struct {
	ID       string             `json:"id"`
	Name     string             `json:"name"`
	Format   string             `json:"format"`
	Bytes    int64              `json:"bytes"`
	Repair   *mesh.RepairReport `json:"repair"`
	Scale    float64            `json:"scale"`
	Bounds   [2][3]float64      `json:"bounds"`
	Size     [3]float64         `json:"size"`
	Tris     int                `json:"tris"`
	Volume   float64            `json:"volume"`
	UnitHint string             `json:"unitHint,omitempty"`
	Created  time.Time          `json:"created"`
	mu       sync.Mutex
	base     *mesh.Mesh // repaired, unscaled
	cur      *mesh.Mesh // scaled
	md       *plan.Model
	touched  time.Time
}

type job struct {
	ID       string    `json:"id"`
	Kind     string    `json:"kind"`
	State    string    `json:"state"` // queued | running | done | error
	Message  string    `json:"message"`
	Progress []string  `json:"progress"`
	Error    string    `json:"error,omitempty"`
	Result   any       `json:"result,omitempty"`
	Started  time.Time `json:"started"`
	Finished time.Time `json:"finished,omitempty"`
	mu       sync.Mutex
}

func New(cfg Config) *Server {
	if cfg.MaxUpload <= 0 {
		cfg.MaxUpload = 300 << 20
	}
	if cfg.TTL <= 0 {
		cfg.TTL = 6 * time.Hour
	}
	os.MkdirAll(filepath.Join(cfg.DataDir, "exports"), 0o755)
	s := &Server{cfg: cfg, models: map[string]*model{}, jobs: map[string]*job{}, sem: make(chan struct{}, 2)}
	go s.janitor()
	return s
}

func newID() string {
	b := make([]byte, 9)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// Handler returns the HTTP handler. All routes are relative so the app works
// at / and behind a prefix-stripping reverse proxy (e.g. /splitter/).
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "version": s.cfg.Version, "models": len(s.models)})
	})
	mux.HandleFunc("GET /api/printers", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"printers": printers.All, "fits": plan.DefaultFits(0.4), "fits06": plan.DefaultFits(0.6)})
	})
	mux.HandleFunc("GET /api/kinds", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"point": plan.Kinds, "seam": plan.SeamKinds})
	})
	mux.HandleFunc("POST /api/models", s.handleUpload)
	mux.HandleFunc("GET /api/models/{id}", s.handleModel)
	mux.HandleFunc("GET /api/models/{id}/mesh", s.handleMesh)
	mux.HandleFunc("POST /api/models/{id}/scale", s.handleScale)
	mux.HandleFunc("POST /api/models/{id}/plan", s.handlePlan)
	mux.HandleFunc("POST /api/models/{id}/export", s.handleExport)
	mux.HandleFunc("POST /api/coupon/export", s.handleCouponExport)
	mux.HandleFunc("GET /api/jobs/{id}", s.handleJob)
	mux.HandleFunc("GET /api/exports/{id}/{file...}", s.handleExportFile)
	static := http.FileServerFS(s.cfg.Web)
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			// mark the page so the UI uses this server's API instead of the
			// in-browser WebAssembly planner
			idx, err := fs.ReadFile(s.cfg.Web, "index.html")
			if err != nil {
				httpErr(w, 500, "no UI")
				return
			}
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write([]byte(strings.Replace(string(idx), "<head>", `<head><meta name="splitter-backend" content="server">`, 1)))
			return
		} else {
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		if strings.HasSuffix(r.URL.Path, ".wasm") {
			w.Header().Set("Content-Type", "application/wasm")
		}
		static.ServeHTTP(w, r)
	})
	return logMW(securityMW(mux))
}

func securityMW(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		h.ServeHTTP(w, r)
	})
}

func logMW(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t := time.Now()
		h.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/api/jobs/") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(t).Round(time.Millisecond))
		}
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func httpErr(w http.ResponseWriter, code int, msg string, args ...any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf(msg, args...)})
}

func (s *Server) getModel(id string) *model {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := s.models[id]
	if m != nil {
		m.touched = time.Now()
	}
	return m
}

func (s *Server) startJob(kind string, fn func(j *job) (any, error)) *job {
	j := &job{ID: newID(), Kind: kind, State: "queued", Started: time.Now()}
	s.mu.Lock()
	s.jobs[j.ID] = j
	s.mu.Unlock()
	go func() {
		s.sem <- struct{}{}
		defer func() { <-s.sem }()
		j.set("running", "started")
		defer func() {
			if r := recover(); r != nil {
				log.Printf("job %s panic: %v", j.ID, r)
				j.mu.Lock()
				j.State, j.Error, j.Finished = "error", fmt.Sprintf("internal error: %v", r), time.Now()
				j.mu.Unlock()
			}
		}()
		res, err := fn(j)
		j.mu.Lock()
		defer j.mu.Unlock()
		j.Finished = time.Now()
		if err != nil {
			j.State, j.Error = "error", err.Error()
			return
		}
		j.State, j.Result = "done", res
	}()
	return j
}

func (j *job) set(state, msg string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if state != "" {
		j.State = state
	}
	j.Message = msg
	j.Progress = append(j.Progress, msg)
}

func (s *Server) handleJob(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	j := s.jobs[r.PathValue("id")]
	s.mu.Unlock()
	if j == nil {
		httpErr(w, 404, "no such job")
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	out := map[string]any{"id": j.ID, "kind": j.Kind, "state": j.State, "message": j.Message, "error": j.Error, "elapsed": time.Since(j.Started).Seconds()}
	if j.State == "done" {
		out["result"] = j.Result
	}
	writeJSON(w, out)
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUpload+1<<20)
	f, hdr, err := r.FormFile("file")
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			httpErr(w, 413, "file too large (limit %d MB)", s.cfg.MaxUpload>>20)
			return
		}
		httpErr(w, 400, "no file: %v", err)
		return
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		httpErr(w, 413, "upload failed: %v", err)
		return
	}
	if r.MultipartForm != nil {
		r.MultipartForm.RemoveAll()
	}
	name := filepath.Base(hdr.Filename)
	j := s.startJob("load", func(j *job) (any, error) {
		j.set("", fmt.Sprintf("parsing %s (%.1f MB)", name, float64(len(data))/1e6))
		soup, format, err := mesh.Load(name, data)
		if err != nil {
			return nil, err
		}
		j.set("", fmt.Sprintf("repairing %d triangles", len(soup.Tris)))
		m, rep, err := mesh.Repair(soup)
		if err != nil {
			return nil, err
		}
		if !rep.Closed {
			return nil, fmt.Errorf("the mesh could not be made watertight (%s)", strings.Join(rep.Notes, "; "))
		}
		md := &model{ID: newID(), Name: name, Format: format, Bytes: int64(len(data)), Repair: rep, Scale: 1, Created: time.Now(), base: m, touched: time.Now()}
		md.applyScale(1)
		md.UnitHint = mesh.UnitHint(md.Size)
		s.mu.Lock()
		s.models[md.ID] = md
		s.mu.Unlock()
		return md.info(), nil
	})
	writeJSON(w, map[string]string{"job": j.ID})
}

func (m *model) applyScale(f float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Scale = f
	c := m.base.Clone()
	if f != 1 {
		c.Scale(f)
	}
	m.cur = c
	m.md = plan.NewModel(c)
	b := c.Bounds()
	m.Bounds = [2][3]float64{b.Min, b.Max}
	m.Size = b.Size()
	m.Tris = len(c.F)
	m.Volume = c.Volume()
}

func (m *model) info() map[string]any {
	return map[string]any{"id": m.ID, "name": m.Name, "format": m.Format, "bytes": m.Bytes, "repair": m.Repair, "scale": m.Scale,
		"bounds": m.Bounds, "size": m.Size, "tris": m.Tris, "volume": m.Volume, "unitHint": m.UnitHint}
}

func (s *Server) handleModel(w http.ResponseWriter, r *http.Request) {
	m := s.getModel(r.PathValue("id"))
	if m == nil {
		httpErr(w, 404, "model expired or unknown; upload it again")
		return
	}
	writeJSON(w, m.info())
}

func (s *Server) handleMesh(w http.ResponseWriter, r *http.Request) {
	m := s.getModel(r.PathValue("id"))
	if m == nil {
		httpErr(w, 404, "model expired or unknown")
		return
	}
	m.mu.Lock()
	cur := m.cur
	m.mu.Unlock()
	var buf bytes.Buffer
	cur.EncodeBinary(&buf)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", fmt.Sprint(buf.Len()))
	w.Write(buf.Bytes())
}

func (s *Server) handleScale(w http.ResponseWriter, r *http.Request) {
	m := s.getModel(r.PathValue("id"))
	if m == nil {
		httpErr(w, 404, "model expired or unknown")
		return
	}
	var req struct {
		Scale float64 `json:"scale"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil || req.Scale <= 0 || req.Scale > 10000 || math.IsNaN(req.Scale) {
		httpErr(w, 400, "bad scale")
		return
	}
	m.applyScale(req.Scale)
	writeJSON(w, m.info())
}

func (s *Server) handlePlan(w http.ResponseWriter, r *http.Request) {
	m := s.getModel(r.PathValue("id"))
	if m == nil {
		httpErr(w, 404, "model expired or unknown; upload it again")
		return
	}
	var req plan.Request
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<20)).Decode(&req); err != nil {
		httpErr(w, 400, "bad plan request: %v", err)
		return
	}
	j := s.startJob("plan", func(j *job) (any, error) {
		m.mu.Lock()
		defer m.mu.Unlock()
		return m.md.Run(&req, func(msg string) { j.set("", msg) })
	})
	writeJSON(w, map[string]string{"job": j.ID})
}

func (s *Server) janitor() {
	for {
		time.Sleep(10 * time.Minute)
		s.sweep()
	}
}

func (s *Server) sweep() {
	now := time.Now()
	s.mu.Lock()
	for id, m := range s.models {
		if now.Sub(m.touched) > s.cfg.TTL {
			delete(s.models, id)
		}
	}
	for id, j := range s.jobs {
		if !j.Finished.IsZero() && now.Sub(j.Finished) > time.Hour {
			delete(s.jobs, id)
		}
	}
	s.mu.Unlock()
	dir := filepath.Join(s.cfg.DataDir, "exports")
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		info, err := e.Info()
		if err == nil && now.Sub(info.ModTime()) > s.cfg.TTL {
			os.RemoveAll(filepath.Join(dir, e.Name()))
		}
	}
}

// ListenAndServe runs the server.
func (s *Server) ListenAndServe() error {
	srv := &http.Server{Addr: s.cfg.Addr, Handler: s.Handler(), ReadHeaderTimeout: 20 * time.Second}
	log.Printf("print-splitter %s listening on %s (data %s)", s.cfg.Version, s.cfg.Addr, s.cfg.DataDir)
	return srv.ListenAndServe()
}
