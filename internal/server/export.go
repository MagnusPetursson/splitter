package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/MagnusPetursson/splitter/internal/bundle"
	"github.com/MagnusPetursson/splitter/internal/mesh"
	"github.com/MagnusPetursson/splitter/internal/plan"
)

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	m := s.getModel(r.PathValue("id"))
	if m == nil {
		httpErr(w, 404, "model expired or unknown; upload it again")
		return
	}
	s.doExport(w, r, strings.TrimSuffix(m.Name, filepath.Ext(m.Name)))
}

func (s *Server) handleCouponExport(w http.ResponseWriter, r *http.Request) {
	s.doExport(w, r, "joint-coupon")
}

func (s *Server) doExport(w http.ResponseWriter, r *http.Request, base string) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<30)
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		httpErr(w, 400, "bad export upload: %v", err)
		return
	}
	defer r.MultipartForm.RemoveAll()
	var pl plan.Plan
	if v := r.FormValue("plan"); v != "" {
		if err := json.Unmarshal([]byte(v), &pl); err != nil {
			httpErr(w, 400, "bad plan: %v", err)
			return
		}
	}
	var parts []bundle.ExportPart
	if err := json.Unmarshal([]byte(r.FormValue("parts")), &parts); err != nil || len(parts) == 0 {
		httpErr(w, 400, "no parts")
		return
	}
	var bed plan.Bed
	if v := r.FormValue("bed"); v != "" {
		json.Unmarshal([]byte(v), &bed)
	}
	meshes := map[string]*mesh.Mesh{}
	for _, p := range parts {
		f, _, err := r.FormFile(p.File)
		if err != nil {
			httpErr(w, 400, "missing mesh %s", p.File)
			return
		}
		b, _ := io.ReadAll(f)
		f.Close()
		mm, err := mesh.DecodeBinary(b)
		if err != nil {
			httpErr(w, 400, "%s: %v", p.Label, err)
			return
		}
		meshes[p.File] = mm
	}
	var snapshot []byte
	if f, _, err := r.FormFile("snapshot"); err == nil {
		snapshot, _ = io.ReadAll(io.LimitReader(f, 8<<20))
		f.Close()
	}
	name := bundle.SafeName.ReplaceAllString(base, "_")
	if name == "" {
		name = "model"
	}
	res, files, err := bundle.Build(name, &pl, parts, meshes, bed, snapshot)
	if err == nil {
		res.ID = newID()
		err = writeFiles(filepath.Join(s.cfg.DataDir, "exports", res.ID), files)
	}
	if err != nil {
		httpErr(w, 500, "export failed: %v", err)
		return
	}
	writeJSON(w, res)
}

func writeFiles(dir string, files map[string][]byte) error {
	for rel, b := range files {
		fn := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(fn), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(fn, b, 0o644); err != nil {
			os.RemoveAll(dir)
			return err
		}
	}
	return nil
}

func (s *Server) handleExportFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !regexp.MustCompile(`^[0-9a-f]{18}$`).MatchString(id) {
		httpErr(w, 404, "not found")
		return
	}
	rel := filepath.Clean("/" + r.PathValue("file"))
	fn := filepath.Join(s.cfg.DataDir, "exports", id, rel)
	if !strings.HasPrefix(fn, filepath.Join(s.cfg.DataDir, "exports", id)+string(os.PathSeparator)) {
		httpErr(w, 404, "not found")
		return
	}
	if strings.HasSuffix(fn, ".3mf") {
		w.Header().Set("Content-Type", "model/3mf")
	}
	if strings.HasSuffix(fn, ".stl") {
		w.Header().Set("Content-Type", "model/stl")
	}
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(fn)))
	}
	http.ServeFile(w, r, fn)
}
