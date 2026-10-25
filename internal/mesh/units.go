package mesh

import "math"

// UnitHint guesses a wrong export unit from the bounding-box size (mm).
func UnitHint(sz [3]float64) string {
	mx := math.Max(sz[0], math.Max(sz[1], sz[2]))
	switch {
	case mx < 1:
		return "The model is under 1 mm: it was probably exported in metres (×1000)."
	case mx < 12:
		return "The model is tiny: it may be in centimetres (×10) or inches (×25.4)."
	case mx > 5000:
		return "The model is over 5 m: it may be in micrometres or 0.1 mm units."
	}
	return ""
}
