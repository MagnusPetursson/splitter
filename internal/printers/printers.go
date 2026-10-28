package printers

// Printer is a build-volume preset. Volumes are the manufacturer's published
// build volume (X × Y × Z, mm); see Source.
type Printer struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Maker  string  `json:"maker"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Z      float64 `json:"z"`
	Nozzle float64 `json:"nozzle"`
	Source string  `json:"source"`
	Note   string  `json:"note,omitempty"`
}

// All lists the presets. Sources were checked 2026-10-25.
var All = []Printer{
	{ID: "prusa-mini", Name: "Prusa MINI / MINI+", Maker: "Prusa", X: 180, Y: 180, Z: 180, Nozzle: 0.4, Source: "https://www.prusa3d.com/product/original-prusa-mini-semi-assembled-3d-printer-4/"},
	{ID: "prusa-mk4s", Name: "Prusa MK4 / MK4S", Maker: "Prusa", X: 250, Y: 210, Z: 220, Nozzle: 0.4, Source: "https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer-5/"},
	{ID: "prusa-core-one", Name: "Prusa CORE One / One+", Maker: "Prusa", X: 250, Y: 220, Z: 270, Nozzle: 0.4, Source: "https://www.prusa3d.com/product/prusa-core-one/"},
	{ID: "prusa-xl", Name: "Prusa XL", Maker: "Prusa", X: 360, Y: 360, Z: 360, Nozzle: 0.4, Source: "https://www.prusa3d.com/product/original-prusa-xl-assembled-single-toolhead-3d-printer/"},
	{ID: "bambu-a1-mini", Name: "Bambu Lab A1 mini", Maker: "Bambu Lab", X: 180, Y: 180, Z: 180, Nozzle: 0.4, Source: "https://bambulab.com/en/a1-mini/specs"},
	{ID: "bambu-a1", Name: "Bambu Lab A1", Maker: "Bambu Lab", X: 256, Y: 256, Z: 256, Nozzle: 0.4, Source: "https://bambulab.com/en/a1/specs"},
	{ID: "bambu-p1s", Name: "Bambu Lab P1S", Maker: "Bambu Lab", X: 256, Y: 256, Z: 256, Nozzle: 0.4, Source: "https://bambulab.com/en/p1/specs"},
	{ID: "bambu-x1c", Name: "Bambu Lab X1 Carbon", Maker: "Bambu Lab", X: 256, Y: 256, Z: 256, Nozzle: 0.4, Source: "https://bambulab.com/en/x1/specs"},
	{ID: "bambu-h2d", Name: "Bambu Lab H2D (single nozzle)", Maker: "Bambu Lab", X: 325, Y: 320, Z: 325, Nozzle: 0.4, Source: "https://bambulab.com/en/h2d/specs", Note: "both nozzles: 300 × 320 × 325"},
	{ID: "ender3-v3", Name: "Creality Ender-3 V3", Maker: "Creality", X: 220, Y: 220, Z: 250, Nozzle: 0.4, Source: "https://www.creality.com/products/creality-ender-3-v3"},
	{ID: "creality-k1", Name: "Creality K1 / K1C", Maker: "Creality", X: 220, Y: 220, Z: 250, Nozzle: 0.4, Source: "https://www.creality.com/products/creality-k1-3d-printer"},
	{ID: "voron-24-250", Name: "Voron 2.4 (250)", Maker: "Voron", X: 250, Y: 250, Z: 250, Nozzle: 0.4, Source: "https://vorondesign.com/voron2.4"},
	{ID: "voron-24-300", Name: "Voron 2.4 (300)", Maker: "Voron", X: 300, Y: 300, Z: 300, Nozzle: 0.4, Source: "https://vorondesign.com/voron2.4"},
	{ID: "voron-24-350", Name: "Voron 2.4 (350)", Maker: "Voron", X: 350, Y: 350, Z: 350, Nozzle: 0.4, Source: "https://vorondesign.com/voron2.4"},
}

func ByID(id string) (Printer, bool) {
	for _, p := range All {
		if p.ID == id {
			return p, true
		}
	}
	return Printer{}, false
}
