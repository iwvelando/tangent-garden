package physical

import (
	"fmt"
	"math"
	"strconv"
)

// Status is a check's outcome. A required check that fails or is
// unresolved keeps a solid from being presented as validated; a warning
// never does.
type Status string

const (
	StatusPass       Status = "pass"
	StatusFail       Status = "fail"
	StatusUnresolved Status = "unresolved"
	StatusWarn       Status = "warn"
)

// Evidence says what a check's value rests on: exact arithmetic on the
// design, a conservative guarantee from the construction, a sample of the
// final geometry with a stated allowance, or a measurement of the mesh.
type Evidence string

const (
	Exact        Evidence = "exact"
	Conservative Evidence = "conservative"
	Sampled      Evidence = "sampled"
	Measured     Evidence = "measured"
)

// CheckItem is one check of a prepared solid.
type CheckItem struct {
	// Hint says what to change when the check does not pass.
	Hint     string   `json:"hint,omitempty"`
	ID       string   `json:"id"`
	Label    string   `json:"label"`
	Required bool     `json:"required"`
	Status   Status   `json:"status"`
	Evidence Evidence `json:"evidence"`
	Value    float64  `json:"value"`
	Limit    float64  `json:"limit"`
	Detail   string   `json:"detail"`
}

// The treatments.
const (
	Raised   = "raised"
	Recessed = "recessed"
)

// Design is the physical form asked of a plan: raised lines on a floor,
// or grooves cut into a slab. Line is the width of a raised line or a
// groove, and of the frame. Floor is the plaque's floor under the raised
// lines, or the material left under a groove. Relief is the lines' height
// above the floor, or the grooves' depth.
type Design struct {
	Treatment string  `json:"treatment"`
	Line      float64 `json:"line"`
	Floor     float64 `json:"floor"`
	Relief    float64 `json:"relief"`
	// Simplify removes material thinner than the wall and fills gaps
	// narrower than the gap minimum (Grid.Simplify), reported, before
	// the solid is built.
	Simplify bool `json:"simplify,omitempty"`
	// FaceDown turns the solid over for printing with its decorated face
	// on the bed (Mesh.TurnOver).
	FaceDown bool `json:"faceDown,omitempty"`
}

// Openwork is a design with no floor: raised, the lines alone; recessed,
// grooves cut through, leaving the webs.
func (d Design) Openwork() bool { return d.Floor == 0 }

// WallNeed and GapNeed are the least material width and gap the profile
// admits.
func WallNeed(p Profile) float64 { return math.Max(p.Wall, p.XYDetail) }
func GapNeed(p Profile) float64  { return math.Max(p.Gap, p.XYGap) }

// Levels are the design's two top heights.
func (d Design) Levels() Levels {
	if d.Treatment == Recessed {
		return Levels{Plan: d.Floor, Rest: d.Floor + d.Relief}
	}
	return Levels{Plan: d.Floor + d.Relief, Rest: d.Floor}
}

// LineNeed is the least line or groove width the profile admits, and
// CellNeed the least gap between raised lines or web between grooves.
func (d Design) LineNeed(p Profile) float64 {
	if d.Treatment == Recessed {
		return math.Max(p.Gap, p.XYGap)
	}
	return math.Max(p.Strut, p.XYDetail)
}

func (d Design) CellNeed(p Profile) float64 {
	if d.Treatment == Recessed {
		return math.Max(p.Wall, p.XYDetail)
	}
	return math.Max(p.Gap, p.XYGap)
}

// layers is how many layers a height spans: the first layer, then whole
// layers.
func layers(h float64, p Profile) float64 {
	return 1 + (h-p.FirstLayer)/p.LayerHeight
}

// sliced is the height a slicer reaching h by whole layers prints, to the
// nearest layer boundary.
func sliced(h float64, p Profile) float64 {
	n := math.Max(1, math.Round(layers(h, p)))
	return p.FirstLayer + (n-1)*p.LayerHeight
}

func pass(ok bool) Status {
	if ok {
		return StatusPass
	}
	return StatusFail
}

// sizeChecks compares the design's widths and heights with the profile:
// exact comparisons of the numbers asked, and the layer counts they
// slice to. The line's width holds everywhere by construction: every
// point of the plan lies in a disk of the line's width inside it.
func sizeChecks(d Design, p Profile) []CheckItem {
	var out []CheckItem
	lineNeed := d.LineNeed(p)
	what := "Raised line width"
	if d.Treatment == Recessed {
		what = "Groove width"
	}
	out = append(out, CheckItem{ID: "line", Label: what, Required: true, Status: pass(d.Line >= lineNeed), Evidence: Conservative,
		Value: d.Line, Limit: lineNeed, Detail: "every point of the plan lies in a disk of this width inside it",
		Hint: "Widen the lines to the profile's minimum."})
	floorWhat := "Floor under the lines"
	if d.Treatment == Recessed {
		floorWhat = "Floor under the grooves"
	}
	if d.Openwork() {
		out = append(out, CheckItem{ID: "floor", Label: "Openwork: no floor", Required: true, Status: StatusPass, Evidence: Exact,
			Detail: "nothing joins the pieces but the lace itself"})
	} else {
		out = append(out, CheckItem{ID: "floor", Label: floorWhat, Required: true, Status: pass(d.Floor >= p.Floor), Evidence: Exact,
			Value: d.Floor, Limit: p.Floor, Hint: fmt.Sprintf("Raise the floor to %s mm or more, or set it to 0 for openwork.", strconv.FormatFloat(p.Floor, 'f', -1, 64))})
	}
	reliefWhat := "Relief height"
	if d.Treatment == Recessed {
		reliefWhat = "Groove depth"
	}
	out = append(out, CheckItem{ID: "relief", Label: reliefWhat, Required: true, Status: pass(d.Relief >= p.ZDetail), Evidence: Exact,
		Value: d.Relief, Limit: p.ZDetail, Hint: "Raise it to at least the profile's Z detail."})
	lv := d.Levels()
	for _, h := range []struct {
		id, label string
		v         float64
	}{{"layers-low", "Lower top in layers", math.Min(lv.Plan, lv.Rest)}, {"layers-high", "Upper top in layers", math.Max(lv.Plan, lv.Rest)}} {
		if h.v == 0 {
			continue
		}
		n := layers(h.v, p)
		st := StatusPass
		detail := fmt.Sprintf("%.4g layers", n)
		if math.Abs(n-math.Round(n)) > 1e-6 {
			st = StatusWarn
			detail = fmt.Sprintf("%.4g layers: a slicer prints about %.4g mm", n, sliced(h.v, p))
		}
		out = append(out, CheckItem{ID: h.id, Label: h.label, Status: st, Evidence: Exact, Value: h.v, Limit: sliced(h.v, p), Detail: detail})
	}
	return out
}
