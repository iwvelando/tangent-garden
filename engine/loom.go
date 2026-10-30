package engine

import (
	"cmp"
	"math"
	"slices"
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

// A node is one evaluation of a member at source parameter t: p and w are
// nil where the source is undefined or its square is not finite. A missing
// node was never evaluated because the evaluation budget ran out.
type loomNode struct {
	t       float64
	p, w    *Vec
	missing bool
}

// A segment of one member awaits judgment at its depth; mid, when set, is
// its midpoint already evaluated as a quarter probe of its parent.
type loomSegment struct {
	member int
	a, b   loomNode
	mid    *loomNode
	depth  int
}

// A settled segment is drawn as its chord (reason "") or broken.
type loomSettled struct {
	a, b   loomNode
	reason string
}

// computeLoom refines every member level by level: each pass judges every
// pending segment of every member at one depth before any is bisected
// further, so a budget that runs out leaves the remaining error spread across
// members and intervals rather than an undrawn tail. Where the budget does
// not bind, the result is the same as judging the segments in any order.
// Undefined stretches follow the shared refiner (engine/refine): a segment
// undefined at both ends is a gap without evaluation, and one undefined at
// one end is bisected toward that end only, its midpoint alone evaluated.
// Reaching the depth limit there is a settled break, not exhaustion.
func computeLoom(q LoomRequest, limits loomLimits) (LoomResult, error) {
	cs, err := q.sources()
	if err != nil {
		return LoomResult{}, err
	}
	r := LoomResult{Members: make([]LoomMember, 0, len(cs))}
	// One global budget includes pilot samples, probes and the marker.
	r.Marker = loomMarker(cs[q.Selected], q.Selected, q.Parameter)
	r.Evaluations = 1
	eval := func(c loomCurve, t float64) loomNode {
		n := loomNode{t: t}
		if r.Evaluations >= limits.evaluations {
			r.Exhausted = true
			n.missing = true
			return n
		}
		r.Evaluations++
		n.p = point(c.at(t))
		if n.p != nil {
			n.w = loomSquare(*n.p)
		}
		return n
	}
	sourceTolerance := make([]float64, len(cs))
	imageTolerance := make([]float64, len(cs))
	first := make([]loomNode, len(cs))
	settled := make([][]loomSettled, len(cs))
	var pending []loomSegment
	// Delivered entries, two per node, if every pending segment ended as a
	// gap and every settled chord as its end point: an upper bound on the
	// result, so bisection stops before the delivered-point ceiling.
	reserved := 0
	for id, c := range cs {
		pilot := make([]loomNode, q.Samples)
		src, img := make([]*Vec, q.Samples), make([]*Vec, q.Samples)
		for i := range pilot {
			pilot[i] = eval(c, c.min+(c.max-c.min)*float64(i)/float64(q.Samples-1))
			src[i], img[i] = pilot[i].p, pilot[i].w
		}
		sourceTolerance[id] = q.Tolerance * studyRadius(src)
		imageTolerance[id] = q.Tolerance * studyRadius(img)
		first[id] = pilot[0]
		reserved += 2
		for i := 1; i < len(pilot); i++ {
			pending = append(pending, loomSegment{member: id, a: pilot[i-1], b: pilot[i]})
			reserved += 4
		}
	}
	settle := func(s loomSegment, reason string) {
		if reason == "" {
			reserved -= 2
		}
		settled[s.member] = append(settled[s.member], loomSettled{s.a, s.b, reason})
	}
	// afford reports whether bisecting a segment fits the budget; otherwise
	// it settles the segment as exhausted.
	afford := func(s loomSegment, evaluations int) bool {
		if r.Evaluations+evaluations > limits.evaluations || reserved+4 > limits.points {
			r.Exhausted = true
			settle(s, "exhausted")
			return false
		}
		return true
	}
	// A chord is judged only between nodes defined in both panes.
	defined := func(n loomNode) bool { return n.p != nil && n.w != nil }
	for len(pending) > 0 {
		var next []loomSegment
		for _, s := range pending {
			c := cs[s.member]
			mid := (s.a.t + s.b.t) / 2
			split := s.depth < limits.depth && mid > s.a.t && mid < s.b.t
			switch {
			case s.a.missing || s.b.missing:
				settle(s, "exhausted")
			case !defined(s.a) && !defined(s.b):
				settle(s, "invalid")
			case !defined(s.a) || !defined(s.b):
				// Localize where the source stops, toward the undefined end.
				if !split {
					settle(s, "invalid")
					continue
				}
				m := s.mid
				if m == nil {
					if !afford(s, 1) {
						continue
					}
					n := eval(c, mid)
					m = &n
				} else if !afford(s, 0) {
					continue
				}
				reserved += 4
				next = append(next, loomSegment{s.member, s.a, *m, nil, s.depth + 1}, loomSegment{s.member, *m, s.b, nil, s.depth + 1})
			default:
				need := 3
				if s.mid != nil {
					need = 2
				}
				if r.Evaluations+need > limits.evaluations {
					r.Exhausted = true
					settle(s, "exhausted")
					continue
				}
				probes := [3]loomNode{eval(c, (s.a.t+mid)/2), {}, eval(c, (mid+s.b.t)/2)}
				if s.mid != nil {
					probes[1] = *s.mid
				} else {
					probes[1] = eval(c, mid)
				}
				valid, accept := true, true
				for _, n := range probes {
					valid = valid && defined(n)
				}
				if valid {
					for _, n := range probes {
						accept = accept && plane.Distance(*n.w, *s.a.w, *s.b.w) <= imageTolerance[s.member] && plane.Distance(*n.p, *s.a.p, *s.b.p) <= sourceTolerance[s.member]
					}
				}
				switch {
				case valid && accept:
					settle(s, "")
				case !split && !valid:
					settle(s, "invalid")
				case !split:
					settle(s, "unresolved")
				case afford(s, 0):
					reserved += 4
					next = append(next, loomSegment{s.member, s.a, probes[1], &probes[0], s.depth + 1}, loomSegment{s.member, probes[1], s.b, &probes[2], s.depth + 1})
				}
			}
		}
		pending = next
	}
	for id, c := range cs {
		m := LoomMember{ID: id, Name: c.name, Min: c.min, Max: c.max, Intervals: []LoomInterval{}}
		gap := false
		emit := func(n loomNode) {
			if r.Points+2 > limits.points {
				r.Exhausted = true
				return
			}
			// Consecutive break entries carry nothing more than one.
			empty := n.p == nil && n.w == nil
			if empty && gap {
				return
			}
			gap = empty
			m.At = append(m.At, n.t)
			m.Source = append(m.Source, n.p)
			m.Image = append(m.Image, n.w)
			m.Critical = append(m.Critical, n.p != nil && n.p.X == 0 && n.p.Y == 0)
			r.Points += 2
		}
		segments := settled[id]
		slices.SortFunc(segments, func(x, y loomSettled) int { return cmp.Compare(x.a.t, y.a.t) })
		emit(first[id])
		for _, s := range segments {
			if s.reason == "" {
				emit(s.b)
				continue
			}
			if k := len(m.Intervals) - 1; k >= 0 && m.Intervals[k].Reason == s.reason && m.Intervals[k].To == s.a.t {
				m.Intervals[k].To = s.b.t
			} else {
				m.Intervals = append(m.Intervals, LoomInterval{s.a.t, s.b.t, s.reason})
			}
			emit(loomNode{t: (s.a.t + s.b.t) / 2})
			if s.b.p != nil || s.b.w != nil {
				emit(s.b)
			}
		}
		r.NumericEntries += 6*len(m.At) + 2*len(m.Intervals) + 3
		r.Members = append(r.Members, m)
	}
	r.NumericEntries += 12
	return r, nil
}
