package plan

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
)

// Use the real request JSON so missing supportWeight handling fails on the
// behaviour, not on a new Go symbol that has not yet been implemented.
func supportRequest(t *testing.T, weight float64) *Request {
	t.Helper()
	req := &Request{}
	raw, _ := json.Marshal(map[string]any{"mode": "auto", "settings": map[string]any{
		"bed": map[string]float64{"X": 180, "Y": 180, "Z": 180}, "supportWeight": weight,
		"maxParts": 8, "autoJoints": false,
	}})
	if err := json.Unmarshal(raw, req); err != nil {
		t.Fatal(err)
	}
	return req
}

func supportTotalJSON(t *testing.T, pl *Plan) float64 {
	t.Helper()
	b, err := json.Marshal(pl)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Leaves []struct {
			Support *float64 `json:"supportVolume"`
		}
	}
	if err = json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	total := 0.0
	for _, l := range doc.Leaves {
		if l.Support == nil {
			t.Fatal("plan omits per-part supportVolume estimate")
		}
		total += *l.Support
	}
	return total
}

func TestSupportCostFittingShellCanSplit(t *testing.T) {
	md := shellModel(t, 160, 140, 100, 3)
	old, err := md.Run(supportRequest(t, 0), nil)
	if err != nil {
		t.Fatal(err)
	}
	next, err := md.Run(supportRequest(t, 1), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(old.Leaves) != 1 {
		t.Fatalf("zero weight must keep fitting shell intact, got %d parts", len(old.Leaves))
	}
	if len(next.Leaves) <= 1 {
		t.Fatal("support-aware planner left a roofed hollow shell in one support-heavy piece")
	}
	if !next.Fits {
		t.Fatal("support cuts must still fit")
	}
	before, after := supportTotalJSON(t, old), supportTotalJSON(t, next)
	if before <= 0 || after >= before*0.6 {
		t.Fatalf("shell support proxy did not fall meaningfully: %g -> %g", before, after)
	}
	t.Logf("shell %d -> %d parts; proxy %.0f -> %.0f mm³", len(old.Leaves), len(next.Leaves), before, after)
}

func TestSupportCostCubeStaysWhole(t *testing.T) {
	md := boxModel(t, geom.Vec3{}, geom.Vec3{100, 100, 100})
	for _, w := range []float64{0, 0.5, 1} {
		pl, err := md.Run(supportRequest(t, w), nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(pl.Leaves) != 1 || !pl.Fits {
			t.Fatalf("weight %g needlessly split support-free cube", w)
		}
		if v := supportTotalJSON(t, pl); v != 0 {
			t.Fatalf("cube on its face has support proxy %g, want 0", v)
		}
	}
}

func TestSupportCostBracketNoGratuitousCuts(t *testing.T) {
	b, err := os.ReadFile("../../web/samples/bracket_320mm.stl")
	if err != nil {
		t.Fatal(err)
	}
	soup, _, err := mesh.Load("bracket.stl", b)
	if err != nil {
		t.Fatal(err)
	}
	m, _, err := mesh.Repair(soup)
	if err != nil {
		t.Fatal(err)
	}
	m.Scale(0.4)
	md := NewModel(m)
	for _, w := range []float64{0, 0.5, 1} {
		pl, err := md.Run(supportRequest(t, w), nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(pl.Leaves) != 1 || !pl.Fits {
			t.Fatalf("weight %g needlessly split small bracket: %d parts", w, len(pl.Leaves))
		}
		v := supportTotalJSON(t, pl)
		if v < 0 || v > 20000 {
			t.Fatalf("bracket should lie on its side with little support; got %g mm³", v)
		}
	}
}
