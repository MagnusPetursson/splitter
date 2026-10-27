package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
)

func TestRotateQuarterTurn(t *testing.T) {
	s := New(Config{})
	m, _ := mesh.Weld(mesh.Box(geom.Vec3{0, 0, 0}, geom.Vec3{30, 20, 10}), 1e-6)
	md := &model{ID: "m1", Scale: 2, Rot: geom.Mat3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}, base: m}
	md.applyScale(2)
	s.models["m1"] = md
	h := s.Handler()
	post := func(body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/models/m1/rotate", strings.NewReader(body)))
		return w
	}
	// 90° about Z: width and depth swap, scale is kept
	w := post(`{"rot":[0,-1,0,1,0,0,0,0,1]}`)
	if w.Code != 200 {
		t.Fatalf("rotate: %d %s", w.Code, w.Body)
	}
	var info struct {
		Size  [3]float64 `json:"size"`
		Scale float64    `json:"scale"`
	}
	json.Unmarshal(w.Body.Bytes(), &info)
	if info.Size != [3]float64{40, 60, 20} || info.Scale != 2 {
		t.Fatalf("after rotate size %v scale %v", info.Size, info.Scale)
	}
	if !md.cur.Closed() || md.cur.Volume() <= 0 {
		t.Fatalf("rotation broke winding: closed %v volume %v", md.cur.Closed(), md.cur.Volume())
	}
	for _, bad := range []string{`{"rot":[0,1,0,1,0,0,0,0,1]}`, `{"rot":[1,0,0]}`, `nope`} {
		if w := post(bad); w.Code != 400 {
			t.Fatalf("%s accepted: %d", bad, w.Code)
		}
	}
}
