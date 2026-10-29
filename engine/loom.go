package engine

import (
	"math"
	"strconv"
)

// LoomSource is a frozen direct curve or an analytic family. Member IDs are
// source order, never deduplicated by image position. Input must be curve.
type LoomSource struct {
	Kind   string  `json:"kind"`
	Count  int     `json:"count"`
	XCount int     `json:"xCount"`
	YCount int     `json:"yCount"`
	XMin   float64 `json:"xMin"`
	XMax   float64 `json:"xMax"`
	YMin   float64 `json:"yMin"`
	YMax   float64 `json:"yMax"`
	Radius float64 `json:"radius"`
	Input  string  `json:"input"`
	Curve  Curve   `json:"curve"`
}
type LoomRequest struct {
	Map     string     `json:"map"`
	Source  LoomSource `json:"source"`
	Samples int        `json:"samples"`
	// Fraction of each member's robust image/source radius, in that pane's units.
	Tolerance float64 `json:"tolerance"`
	Selected  int     `json:"selected"`
	Parameter float64 `json:"parameter"`
}
type LoomInterval struct {
	From   float64 `json:"from"`
	To     float64 `json:"to"`
	Reason string  `json:"reason"`
}
type LoomMember struct {
	ID        int            `json:"id"`
	Name      string         `json:"name"`
	Min       float64        `json:"min"`
	Max       float64        `json:"max"`
	At        []float64      `json:"at"`
	Source    []*Vec         `json:"source"`
	Image     []*Vec         `json:"image"`
	Critical  []bool         `json:"critical"`
	Intervals []LoomInterval `json:"intervals"`
}
type LoomMarker struct {
	Member    int     `json:"member"`
	Parameter float64 `json:"parameter"`
	Source    *Vec    `json:"source"`
	Image     *Vec    `json:"image"`
	Critical  bool    `json:"critical"`
}
type LoomResult struct {
	Members        []LoomMember `json:"members"`
	Marker         LoomMarker   `json:"marker"`
	Points         int          `json:"points"`
	Evaluations    int          `json:"evaluations"`
	NumericEntries int          `json:"numericEntries"`
	Exhausted      bool         `json:"exhausted"`
}

const LoomMaxPoints = 500000
const LoomMaxEvaluations = 1000000
const LoomMaxNumericEntries = 4000000
const LoomMaxDepth = 16

type loomLimits struct{ points, evaluations, depth int }
type loomCurve struct {
	name     string
	min, max float64
	at       curveFunc
}

func (q LoomRequest) sources() ([]loomCurve, error) {
	if q.Map != "square" {
		return nil, fieldErr("map", "choose the squaring map")
	}
	if q.Samples < 4 || q.Samples > 1024 {
		return nil, fieldErr("samples", "samples must be 4–1024")
	}
	if !finite(q.Tolerance) || q.Tolerance < 1e-6 || q.Tolerance > .05 {
		return nil, fieldErr("tolerance", "refinement tolerance must be 0.000001–0.05")
	}
	s := q.Source
	if s.Kind == "curve" && s.Input != "curve" {
		return nil, fieldErr("source.input", "the loom accepts direct curves only; derived inputs are unsupported")
	}
	var out []loomCurve
	switch s.Kind {
	case "curve":
		switch s.Curve.Format {
		case "parametric", "cartesian", "polar", "roulette", "lissajous", "fourier":
		default:
			return nil, fieldErr("source.curve.format", "the loom accepts parametric, Cartesian, polar, roulette, Lissajous or Fourier sources only")
		}
		f, err := compile(s.Curve)
		if err != nil {
			return nil, within("source.curve", err)
		}
		out = append(out, loomCurve{"Selected curve", s.Curve.Min, s.Curve.Max, f})
	case "grid":
		if s.XCount < 1 || s.XCount > 32 {
			return nil, fieldErr("source.xCount", "vertical lines must be 1–32")
		}
		if s.YCount < 1 || s.YCount > 32 {
			return nil, fieldErr("source.yCount", "horizontal lines must be 1–32")
		}
		for _, b := range []struct {
			path string
			v    float64
		}{{"xMin", s.XMin}, {"xMax", s.XMax}, {"yMin", s.YMin}, {"yMax", s.YMax}} {
			if !finite(b.v) || math.Abs(b.v) > 1e6 {
				return nil, fieldErr("source."+b.path, "grid extent must be finite and within ±1000000")
			}
		}
		if s.XMax-s.XMin < 1e-6 || s.XMax-s.XMin > 1e5 {
			return nil, fieldErr("source.xMax", "horizontal grid span must be 0.000001–100000")
		}
		if s.YMax-s.YMin < 1e-6 || s.YMax-s.YMin > 1e5 {
			return nil, fieldErr("source.yMax", "vertical grid span must be 0.000001–100000")
		}
		position := func(a, b float64, i, n int) float64 {
			if n == 1 {
				return a/2 + b/2
			}
			return a + (b-a)*float64(i)/float64(n-1)
		}
		for i := 0; i < s.XCount; i++ {
			x := position(s.XMin, s.XMax, i, s.XCount)
			out = append(out, loomCurve{"Vertical " + strconv.Itoa(i+1), s.YMin, s.YMax, func(t float64) Vec { return Vec{x, t} }})
		}
		for i := 0; i < s.YCount; i++ {
			y := position(s.YMin, s.YMax, i, s.YCount)
			out = append(out, loomCurve{"Horizontal " + strconv.Itoa(i+1), s.XMin, s.XMax, func(t float64) Vec { return Vec{t, y} }})
		}
	case "concentric", "rosette":
		if s.Count < 1 || s.Count > 32 {
			return nil, fieldErr("source.count", "circle count must be 1–32")
		}
		if !finite(s.Radius) || s.Radius <= 0 || s.Radius > 1e6 {
			return nil, fieldErr("source.radius", "circle radius must be positive and at most 1000000")
		}
		for i := 0; i < s.Count; i++ {
			radius := s.Radius * float64(i+1) / float64(s.Count)
			alpha := 2 * math.Pi * float64(i) / float64(s.Count)
			out = append(out, loomCurve{"Circle " + strconv.Itoa(i+1), 0, 2 * math.Pi, func(t float64) Vec {
				if s.Kind == "concentric" {
					return Vec{radius * math.Cos(t), radius * math.Sin(t)}
				}
				// All rotated circles have radius r and center r exp(i alpha).
				// Exact critical/closing points avoid a spurious near-zero diagnostic.
				if t == math.Pi {
					return Vec{}
				}
				x, y := s.Radius*(1+math.Cos(t)), s.Radius*math.Sin(t)
				if t == 2*math.Pi {
					x, y = 2*s.Radius, 0
				}
				return Vec{x*math.Cos(alpha) - y*math.Sin(alpha), x*math.Sin(alpha) + y*math.Cos(alpha)}
			}})
		}
	default:
		return nil, fieldErr("source.kind", "choose a grid, concentric circles, rotated circles or a selected curve")
	}
	if q.Selected < 0 || q.Selected >= len(out) {
		return nil, fieldErr("selected", "select a source member in the family")
	}
	m := out[q.Selected]
	if !finite(q.Parameter) || q.Parameter < m.min || q.Parameter > m.max {
		return nil, fieldErr("parameter", "source parameter must be inside the selected member interval")
	}
	return out, nil
}
func loomSquare(p Vec) *Vec { return point(Vec{p.X*p.X - p.Y*p.Y, 2 * p.X * p.Y}) }
func loomMarker(c loomCurve, id int, t float64) LoomMarker {
	p := point(c.at(t))
	m := LoomMarker{Member: id, Parameter: t, Source: p}
	if p != nil {
		m.Image = loomSquare(*p)
		m.Critical = p.X == 0 && p.Y == 0
	}
	return m
}

// LoomPoint evaluates absolute source time. Live seek, playback and export all
// call this entry point; no polyline interpolation or arc-length claim.
func LoomPoint(q LoomRequest) (LoomMarker, error) {
	cs, err := q.sources()
	if err != nil {
		return LoomMarker{}, err
	}
	return loomMarker(cs[q.Selected], q.Selected, q.Parameter), nil
}
func ComputeLoom(q LoomRequest) (LoomResult, error) {
	return computeLoom(q, loomLimits{LoomMaxPoints, LoomMaxEvaluations, LoomMaxDepth})
}

type loomNode struct {
	t    float64
	p, w *Vec
}

func computeLoom(q LoomRequest, limits loomLimits) (LoomResult, error) {
	cs, err := q.sources()
	if err != nil {
		return LoomResult{}, err
	}
	r := LoomResult{Members: make([]LoomMember, 0, len(cs))}
	// One global budget includes pilot samples, quarter probes and the marker.
	r.Marker = loomMarker(cs[q.Selected], q.Selected, q.Parameter)
	r.Evaluations = 1
	for id, c := range cs {
		m := LoomMember{ID: id, Name: c.name, Min: c.min, Max: c.max, Intervals: []LoomInterval{}}
		eval := func(t float64) loomNode {
			n := loomNode{t: t}
			if r.Evaluations >= limits.evaluations {
				r.Exhausted = true
				return n
			}
			r.Evaluations++
			n.p = point(c.at(t))
			if n.p != nil {
				n.w = loomSquare(*n.p)
			}
			return n
		}
		appendNode := func(n loomNode) bool {
			if r.Points+2 > limits.points {
				r.Exhausted = true
				return false
			}
			m.At = append(m.At, n.t)
			m.Source = append(m.Source, n.p)
			m.Image = append(m.Image, n.w)
			m.Critical = append(m.Critical, n.p != nil && n.p.X == 0 && n.p.Y == 0)
			r.Points += 2
			return true
		}
		pilot := make([]loomNode, q.Samples)
		src, img := make([]*Vec, q.Samples), make([]*Vec, q.Samples)
		for i := range pilot {
			t := c.min + (c.max-c.min)*float64(i)/float64(q.Samples-1)
			pilot[i] = eval(t)
			src[i], img[i] = pilot[i].p, pilot[i].w
		}
		sourceTolerance := q.Tolerance * studyRadius(src)
		imageTolerance := q.Tolerance * studyRadius(img)
		appendNode(pilot[0])
		var refine func(loomNode, loomNode, int)
		refine = func(a, b loomNode, depth int) {
			if r.Points+4 > limits.points {
				r.Exhausted = true
				m.Intervals = append(m.Intervals, LoomInterval{a.t, b.t, "exhausted"})
				return
			}
			mid := (a.t + b.t) / 2
			probes := [3]loomNode{eval((a.t + mid) / 2), eval(mid), eval((mid + b.t) / 2)}
			valid := a.p != nil && a.w != nil && b.p != nil && b.w != nil
			for _, n := range probes {
				valid = valid && n.p != nil && n.w != nil
			}
			accept := valid
			if valid {
				for _, n := range probes {
					accept = accept && plane.Distance(*n.w, *a.w, *b.w) <= imageTolerance && plane.Distance(*n.p, *a.p, *b.p) <= sourceTolerance
				}
			}
			if accept {
				appendNode(b)
				return
			}
			if depth < limits.depth && r.Evaluations < limits.evaluations && mid > a.t && mid < b.t {
				refine(a, probes[1], depth+1)
				refine(probes[1], b, depth+1)
				return
			}
			reason := "unresolved"
			if !valid {
				reason = "invalid"
			}
			if r.Evaluations >= limits.evaluations || depth == limits.depth {
				r.Exhausted = true
				if valid {
					reason = "exhausted"
				}
			}
			m.Intervals = append(m.Intervals, LoomInterval{a.t, b.t, reason})
			appendNode(loomNode{t: mid})
			appendNode(b)
		}
		for i := 1; i < len(pilot); i++ {
			if r.Points+4 > limits.points || r.Evaluations >= limits.evaluations {
				r.Exhausted = true
				m.Intervals = append(m.Intervals, LoomInterval{pilot[i-1].t, c.max, "exhausted"})
				break
			}
			refine(pilot[i-1], pilot[i], 0)
		}
		r.NumericEntries += 6*len(m.At) + 2*len(m.Intervals) + 3
		r.Members = append(r.Members, m)
	}
	r.NumericEntries += 12
	return r, nil
}
