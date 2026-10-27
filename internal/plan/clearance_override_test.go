package plan

import (
	"encoding/json"
	"math"
	"testing"
)

// Exercise the wire format, not a test-only setter. Legacy requests keep
// using the fit table; an explicit zero is different from an absent override.
func TestJointClearanceOverride(t *testing.T) {
	s := Settings{Nozzle: 0.4}
	s.Normalize()
	for _, tc := range []struct {
		name, extra string
		want        float64
	}{
		{"legacy", "", .15}, {"individual", `,"clearOverride":0.18`, .18},
		{"zero", `,"clearOverride":0`, 0}, {"negative", `,"clearOverride":-1`, .15},
		{"too large", `,"clearOverride":3`, .15},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var j Joint
			if err := json.Unmarshal([]byte(`{"kind":"dowel","fit":"glue","d":6`+tc.extra+`}`), &j); err != nil {
				t.Fatal(err)
			}
			j.resolve(&s)
			if math.Abs(j.Clear-tc.want) > 1e-8 {
				t.Fatalf("pin clearance: got %v want %v", j.Clear, tc.want)
			}
			if math.Abs(j.RReq-(3+tc.want+s.MinWall)) > 1e-8 {
				t.Fatalf("footprint did not include clearance: %v", j.RReq)
			}
		})
	}
}
