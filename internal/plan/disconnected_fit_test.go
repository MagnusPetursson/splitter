package plan

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/MagnusPetursson/splitter/internal/geom"
	"github.com/MagnusPetursson/splitter/internal/mesh"
)

func TestSupportCostDisconnectedMandatoryFit(t *testing.T) {
	soup := mesh.Box(geom.Vec3{0, 0, 0}, geom.Vec3{10, 10, 10})
	other := mesh.Box(geom.Vec3{1000, 0, 0}, geom.Vec3{1010, 10, 10})
	soup.Tris = append(soup.Tris, other.Tris...)
	m, _, err := mesh.Repair(soup)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, weightField string
	}{
		{"omitted_default", ""},
		{"zero_legacy", `,"supportWeight":0`},
		{"low", `,"supportWeight":0.1`},
		{"explicit_default", `,"supportWeight":0.5`},
		{"high", `,"supportWeight":0.9`},
		{"maximum", `,"supportWeight":1`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var req Request
			raw := fmt.Sprintf(`{"mode":"auto","settings":{"bed":{"X":180,"Y":180,"Z":180},"upright":true,"maxParts":8,"autoJoints":false%s}}`, tc.weightField)
			if err := json.Unmarshal([]byte(raw), &req); err != nil {
				t.Fatal(err)
			}
			pl, err := NewModel(m).Run(&req, nil)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("fits=%v leaves=%d warnings=%v", pl.Fits, len(pl.Leaves), pl.Warnings)
			if !pl.Fits {
				t.Error("mandatory separation left disconnected cubes outside the bed")
			}
			if len(pl.Leaves) > 8 {
				t.Errorf("exceeded maxParts=8: %d", len(pl.Leaves))
			}
			if len(pl.Leaves) != 2 {
				t.Errorf("want two intact disconnected fitting cubes, got %d leaves", len(pl.Leaves))
			}
			for _, warning := range pl.Warnings {
				if strings.Contains(warning, "part limit") {
					t.Errorf("unexpected part-limit warning: %s", warning)
				}
			}
			for _, leaf := range pl.Leaves {
				if !leaf.Fits || leaf.Empty {
					t.Errorf("leaf %d must be nonempty and fit: %+v", leaf.ID, leaf)
				}
				if size := leaf.Bounds.Size(); size != (geom.Vec3{10, 10, 10}) {
					t.Errorf("leaf %d must retain an intact cube, got size %v", leaf.ID, size)
				}
				if leaf.Down != (geom.Vec3{0, 0, -1}) {
					t.Errorf("leaf %d lost upright orientation: %v", leaf.ID, leaf.Down)
				}
			}
		})
	}
}
