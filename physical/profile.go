package physical

import (
	"fmt"
	"math"
	"strconv"
)

// grouped writes a limit or count as the interface shows numbers, whole
// numbers' thousands grouped: 2,000; 434,034.
func grouped(v float64) string {
	s := strconv.FormatFloat(v, 'f', -1, 64)
	if v != math.Trunc(v) || math.Abs(v) < 1000 {
		return s
	}
	sign := ""
	if s[0] == '-' {
		sign, s = "-", s[1:]
	}
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return sign + s
}

// ProfileVersion is the profile schema's version. A profile with any
// other version is refused.
const ProfileVersion = 1

// Profile describes one printer and process setup and the minima asked
// of an object, keeping apart quantities with different meanings:
//
//   - the machine: its usable build envelope;
//   - the process: installed nozzle, extrusion width, layer and first
//     layer heights;
//   - calibrated limits: the narrowest feature and gap this setup is
//     trusted to reproduce, and the least height step. The defaults are
//     uncalibrated estimates (Calibrated false), not measurements;
//   - requested minima of the object: wall (recessed webs and the frame),
//     strut (raised lines), floor and gap.
//
// A required minimum is the larger of the requested and the calibrated
// value. A positioning or sensor resolution is never a printable width.
type Profile struct {
	Version int    `json:"version"`
	ID      string `json:"id"`
	Name    string `json:"name"`

	Envelope [3]float64 `json:"envelope"`

	Nozzle         float64 `json:"nozzle"`
	ExtrusionWidth float64 `json:"extrusionWidth"`
	LayerHeight    float64 `json:"layerHeight"`
	FirstLayer     float64 `json:"firstLayer"`

	XYDetail   float64 `json:"xyDetail"`
	XYGap      float64 `json:"xyGap"`
	ZDetail    float64 `json:"zDetail"`
	Calibrated bool    `json:"calibrated"`

	Wall  float64 `json:"wall"`
	Strut float64 `json:"strut"`
	Floor float64 `json:"floor"`
	Gap   float64 `json:"gap"`

	Sources []Source `json:"sources"`
}

// Source records where a default came from.
type Source struct {
	Fields   string `json:"fields"`
	Value    string `json:"value"`
	Document string `json:"document"`
	Revision string `json:"revision"`
}

// The upstream revisions the defaults were read from (#543, read
// 2026-11-26).
const (
	bambuStudioCommit = "bambulab/BambuStudio@23a33758933e712c6041e1f8f135f7d6b50004aa"
	prusaSettings     = "prusa3d/PrusaSlicer-settings-prusa-fff@058c542282d5a512dcc73fc8be9288fc253ddcfd, PrusaResearch/2.5.16.ini"
)

// DefaultProfiles are the research defaults for the Bambu Lab X1-Carbon
// and the Original Prusa i3 MK3S+, each with a 0.4 mm nozzle, the
// slicer's default process, and 2 mm walls and struts. Every value is
// editable.
func DefaultProfiles() []Profile {
	return []Profile{
		{
			Version: ProfileVersion, ID: "bambu-x1c-0.4", Name: "Bambu Lab X1-Carbon, 0.4 mm nozzle, 0.20 mm Standard",
			Envelope: [3]float64{256, 256, 250},
			Nozzle:   0.4, ExtrusionWidth: 0.42, LayerHeight: 0.2, FirstLayer: 0.2,
			XYDetail: 0.84, XYGap: 0.4, ZDetail: 0.2,
			Wall: 2, Strut: 2, Floor: 1.2, Gap: 1,
			Sources: []Source{
				{"envelope x, y", "256 × 256 mm", "Bambu Lab X1-Carbon Technical Specifications (build volume 256 × 256 × 256 mm³)", "manufacturer PDF"},
				{"envelope z", "250 mm", "Bambu Studio machine profile fdm_machine_common printable_height, inherited by Bambu Lab X1 Carbon 0.4 nozzle (printable_area 256×256, bed_exclude_area 18×28 at the origin)", bambuStudioCommit},
				{"nozzle", "0.4 mm", "Technical Specifications (included nozzle); machine profile nozzle_diameter", "manufacturer PDF; " + bambuStudioCommit},
				{"extrusion width, layer, first layer", "0.42, 0.2, 0.2 mm", "process 0.20mm Standard @BBL X1C → fdm_process_single_0.20 → fdm_process_common: outer_wall_line_width, layer_height, initial_layer_print_height", bambuStudioCommit},
				{"positioning", "not published", "Technical Specifications list tool-head speed 500 mm/s and acceleration 20 m/s², and a Micro Lidar without a resolution; no positioning precision", "manufacturer PDF"},
				{"xyDetail, xyGap, zDetail", "0.84, 0.4, 0.2 mm", "uncalibrated estimates: two extrusion widths, the nozzle, one layer", "#543 research default"},
			},
		},
		{
			Version: ProfileVersion, ID: "prusa-mk3s-0.4", Name: "Original Prusa i3 MK3S+, 0.4 mm nozzle, 0.15 mm QUALITY",
			Envelope: [3]float64{250, 210, 210},
			Nozzle:   0.4, ExtrusionWidth: 0.45, LayerHeight: 0.15, FirstLayer: 0.2,
			XYDetail: 0.9, XYGap: 0.4, ZDetail: 0.15,
			Wall: 2, Strut: 2, Floor: 1.2, Gap: 1,
			Sources: []Source{
				{"envelope", "250 × 210 × 210 mm", "PrusaSlicer printer Original Prusa i3 MK3S & MK3S+: bed_shape 0x0,250x0,250x210,0x210 and max_print_height 210", prusaSettings},
				{"nozzle, layer, first layer, extrusion width", "0.4, 0.15, 0.2, 0.45 mm", "default_print_profile 0.15mm QUALITY @MK3, resolved through its inherits: layer_height, first_layer_height, external_perimeter_extrusion_width", prusaSettings},
				{"walls", "1 perimeter 0.45 mm; 2 perimeters 0.9 mm", "Prusa Knowledge Base, Modeling with 3D printing in mind: walls under one perimeter are not printable; between one and two perimeters not printable", "help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135"},
				{"positioning", "accurate to at least 0.2 mm", "Prusa Knowledge Base, Modeling with 3D printing in mind (tolerances)", "help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135"},
				{"xyDetail, xyGap, zDetail", "0.9, 0.4, 0.15 mm", "uncalibrated estimates: two perimeters, the nozzle, one layer", "#543 research default"},
			},
		},
	}
}

// Validate refuses a profile that is not version 1, holds a nonpositive
// or nonfinite length, or carries more text than a link or package
// should, naming the field in the workshop's words.
func (p Profile) Validate() error {
	if p.Version != ProfileVersion {
		return &FieldError{"profile.version", fmt.Sprintf("Printer profile version %d is not supported; this version of Tangent Garden reads version %d.", p.Version, ProfileVersion)}
	}
	if len(p.ID) > 64 {
		return &FieldError{"profile.id", "Printer profile identifier must be at most 64 bytes."}
	}
	if len(p.Name) > 120 {
		return &FieldError{"profile.name", "Printer profile name must be at most 120 bytes."}
	}
	if len(p.Sources) > 8 {
		return &FieldError{"profile.sources", "Printer profile must cite at most 8 sources."}
	}
	for _, s := range p.Sources {
		if len(s.Fields)+len(s.Value)+len(s.Document)+len(s.Revision) > 1000 {
			return &FieldError{"profile.sources", "Each printer profile source must be at most 1,000 bytes."}
		}
	}
	for _, f := range []struct {
		field, label string
		v, hi        float64
	}{
		{"envelope.0", "Bed width", p.Envelope[0], 2000}, {"envelope.1", "Bed depth", p.Envelope[1], 2000}, {"envelope.2", "Build height", p.Envelope[2], 2000},
		{"nozzle", "Nozzle", p.Nozzle, 5}, {"extrusionWidth", "Extrusion width", p.ExtrusionWidth, 5},
		{"layerHeight", "Layer height", p.LayerHeight, 2}, {"firstLayer", "First layer", p.FirstLayer, 2},
		{"xyDetail", "Finest wall", p.XYDetail, 50}, {"xyGap", "Finest gap", p.XYGap, 50}, {"zDetail", "Finest height step", p.ZDetail, 20},
		{"wall", "Minimum wall", p.Wall, 50}, {"strut", "Minimum raised line", p.Strut, 50},
		{"floor", "Minimum floor", p.Floor, 50}, {"gap", "Minimum gap", p.Gap, 50},
	} {
		if !(f.v > 0) || f.v > f.hi {
			return &FieldError{"profile." + f.field, fmt.Sprintf("%s must be above 0 and at most %s mm.", f.label, grouped(f.hi))}
		}
	}
	return nil
}

// FieldError is a refusal of one request field.
type FieldError struct{ Field, Message string }

func (e *FieldError) Error() string { return e.Message }
