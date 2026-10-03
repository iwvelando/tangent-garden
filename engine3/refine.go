package engine3

import (
	"container/heap"
	"math"
	"sort"
	"tangentgarden/engine/expr"
)

// Adaptive refinement of a drawn curve: points inserted between its uniform
// samples wherever the chord joining them strays from the curve. The
// uniform samples stay the study's identity (its surfaces, construction
// lines, reveal and probe); refinement only adds drawn points between them.
const (
	// Each uniform interval is bisected at most refineDepth times, so no
	// inserted point is closer than 1/1024 of a sample step to another.
	refineDepth = 10
	// At most refineBudget points are inserted into one path.
	refineBudget = 16384
	// The tolerance is this fraction of the radius fitted to the path's
	// own uniform samples.
	refineEpsilon = 2e-4
	// A chord still longer than this many tolerances at the finest step
	// cannot belong to a continuous curve there: a jump through a pole.
	refineJump = 50
)

// RefinedPath is a drawn curve with its refinement. Points and At run in
// parameter order: At is each point's position in sample steps, whole at the
// uniform samples (which are all present, unchanged) and fractional between
// them. A null point is a break: a uniform sample without a point, an
// interval the uniform study breaks, or one refinement found (Breaks counts
// the uniform intervals it broke). A segment still farther than Tolerance
// from the curve at the finest step, or when the budget ran out
// (Exhausted), is counted in Unresolved.
type RefinedPath struct {
	Points     []*Vec3   `json:"points"`
	At         []float64 `json:"at"`
	Tolerance  float64   `json:"tolerance"`
	Inserted   int       `json:"inserted"`
	Breaks     int       `json:"breaks"`
	Unresolved int       `json:"unresolved"`
	Exhausted  bool      `json:"exhausted"`
}

// AdaptiveResult holds the refined curves a study draws: the curve its
// construction is built on (Base), the base curve beneath a derived input
// (Parent), a tangent projection, and an inversion image. A path that is
// not drawn, or cannot be evaluated between samples, is absent: integrated
// trajectories and pursuits, and an involute (input or construction), whose
// arc length is measured on the uniform grid.
type AdaptiveResult struct {
	Base       *RefinedPath `json:"base,omitempty"`
	Parent     *RefinedPath `json:"parent,omitempty"`
	Projection *RefinedPath `json:"projection,omitempty"`
	Image      *RefinedPath `json:"image,omitempty"`
}

// segment is a piece [a, b] of one uniform interval (positions in sample
// steps) with its end points (nil where undefined) and three probes at its
// quarter points; score is the largest distance of a probe from the chord,
// infinite when a probe is undefined.
type segment struct {
	a, b   float64
	pa, pb *Vec3
	probes [3]*Vec3
	depth  int
	score  float64
}

type segments []*segment

func (s segments) Len() int { return len(s) }
func (s segments) Less(i, j int) bool {
	if s[i].score != s[j].score {
		return s[i].score > s[j].score
	}
	return s[i].a < s[j].a
}
func (s segments) Swap(i, j int) { s[i], s[j] = s[j], s[i] }
func (s *segments) Push(x any)   { *s = append(*s, x.(*segment)) }
func (s *segments) Pop() any {
	old := *s
	x := old[len(old)-1]
	*s = old[:len(old)-1]
	return x
}

// refinePath refines a path sampled uniformly at n+1 parameters from lo to
// hi, with breaks[i+1] marking a broken interval i, evaluating the curve
// with at. Segments are bisected worst first, so a budget that runs out
// leaves the error evenly spread. A segment with an undefined probe is
// bisected to localize where the curve stops; one with an undefined end is
// bisected only toward that end, after every segment above tolerance. It
// returns the intervals refinement broke, in order.
func refinePath(points []*Vec3, breaks []bool, at func(float64) Vec3, lo, hi, tolerance float64, budget int) (*RefinedPath, []int) {
	n := len(points) - 1
	param := func(u float64) float64 { return lo*(1-u/float64(n)) + hi*u/float64(n) }
	eval := func(u float64) *Vec3 {
		if p := at(param(u)); p.valid() {
			return &p
		}
		return nil
	}
	score := func(s *segment) {
		switch {
		case s.pa == nil || s.pb == nil:
			// Only localizing remains: after every segment above
			// tolerance.
			s.score = 2 * tolerance
		case s.probes[0] == nil || s.probes[1] == nil || s.probes[2] == nil:
			s.score = math.Inf(1)
		default:
			s.score = 0
			for _, p := range s.probes {
				s.score = math.Max(s.score, segmentDistance(*p, *s.pa, *s.pb))
			}
		}
	}
	newSegment := func(a, b float64, pa, pb, middle *Vec3, depth int) *segment {
		w := b - a
		s := &segment{a: a, b: b, pa: pa, pb: pb, depth: depth}
		s.probes = [3]*Vec3{eval(a + w/4), middle, eval(a + 3*w/4)}
		if middle == nil && depth == 0 {
			s.probes[1] = eval(a + w/2)
		}
		score(s)
		return s
	}
	queue := segments{}
	for i := 0; i < n; i++ {
		if points[i] != nil && points[i+1] != nil && !breaks[i+1] {
			queue = append(queue, newSegment(float64(i), float64(i+1), points[i], points[i+1], nil, 0))
		}
	}
	heap.Init(&queue)
	type vertex struct {
		u float64
		p *Vec3
	}
	var inserted []vertex
	brokenAt := map[int]bool{}
	path := &RefinedPath{Tolerance: tolerance}
	for queue.Len() > 0 {
		s := heap.Pop(&queue).(*segment)
		if s.score <= tolerance {
			break
		}
		interval := int(math.Floor(s.a))
		if s.depth == refineDepth {
			switch {
			case s.pa == nil || s.pb == nil:
				// Localized to the finest step: the break stands.
			case s.score == math.Inf(1) || s.pb.sub(*s.pa).norm() > refineJump*tolerance:
				inserted = append(inserted, vertex{(s.a + s.b) / 2, nil})
				brokenAt[interval] = true
			default:
				path.Unresolved++
			}
			continue
		}
		if path.Inserted == budget {
			path.Exhausted = true
			if s.pa != nil && s.pb != nil {
				path.Unresolved++
			}
			for _, rest := range queue {
				if rest.score > tolerance && rest.pa != nil && rest.pb != nil {
					path.Unresolved++
				}
			}
			break
		}
		m := (s.a + s.b) / 2
		pm := s.probes[1]
		inserted = append(inserted, vertex{m, pm})
		if pm != nil {
			path.Inserted++
		} else {
			brokenAt[interval] = true
		}
		// A child toward an undefined end is only localizing, so it needs
		// no probes of its own.
		for _, child := range []*segment{
			newSegment(s.a, m, s.pa, pm, s.probes[0], s.depth+1),
			newSegment(m, s.b, pm, s.pb, s.probes[2], s.depth+1),
		} {
			if child.pa == nil && child.pb == nil {
				continue
			}
			heap.Push(&queue, child)
		}
	}
	sort.Slice(inserted, func(i, j int) bool { return inserted[i].u < inserted[j].u })
	k := 0
	for i := 0; i <= n; i++ {
		path.Points = append(path.Points, points[i])
		path.At = append(path.At, float64(i))
		if i == n {
			break
		}
		if points[i] == nil || points[i+1] == nil || breaks[i+1] {
			// The uniform study's break, kept in the drawn path.
			path.Points = append(path.Points, nil)
			path.At = append(path.At, float64(i)+0.5)
			continue
		}
		for ; k < len(inserted) && inserted[k].u < float64(i+1); k++ {
			path.Points = append(path.Points, inserted[k].p)
			path.At = append(path.At, inserted[k].u)
		}
	}
	var broken []int
	for i := 0; i < n; i++ {
		if brokenAt[i] {
			broken = append(broken, i)
		}
	}
	path.Breaks = len(broken)
	return path, broken
}

// segmentDistance is the distance from p to the segment ab.
func segmentDistance(p, a, b Vec3) float64 {
	d := b.sub(a)
	s := 0.0
	if l := d.dot(d); l > 0 {
		s = math.Max(0, math.Min(1, p.sub(a).dot(d)/l))
	}
	return p.sub(a.add(d.mul(s))).norm()
}

// refines reports whether the study asked for refinement and draws a curve
// that can be evaluated between samples: a torus knot, harmonic or custom
// curve, not an integrated trajectory or pursuit.
func (c Request) refines() bool {
	switch c.Format {
	case "", "torus", "harmonic", "parametric":
		return c.Adaptive
	}
	return false
}

// baseOnly is the study with its construction acting on the base curve.
func (c Request) baseOnly() Request {
	c.Input = "base"
	return c
}

// position evaluates the curve the construction acts on at t, from the base
// curve's evaluator: only its position for an expression, and its tangent
// for a projected input. An undefined point is nonfinite.
func (c Request) position(base evaluation) func(float64) Vec3 {
	undefined := Vec3{math.NaN(), 0, 0}
	if c.projected() {
		return func(t float64) Vec3 {
			r, v, _, ok := base(t)
			if !ok || !r.valid() || !v.valid() || v.norm() < 1e-9 {
				return undefined
			}
			return project(c.Input, c.Pole, r, v.unit())
		}
	}
	if c.Format == "parametric" {
		// compile has already parsed these expressions without error.
		var e [3]func(float64) float64
		for k, s := range []string{c.Curve.X, c.Curve.Y, c.Curve.Z} {
			parsed, _ := expr.ParseWithParameter(s, c.Curve.A)
			e[k] = parsed
		}
		return func(t float64) Vec3 { return Vec3{e[0](t), e[1](t), e[2](t)} }
	}
	return func(t float64) Vec3 {
		r, _, _, ok := base(t)
		if !ok {
			return undefined
		}
		return r
	}
}

// pathTolerance is refineEpsilon of the radius fitted to a path's uniform
// samples.
func pathTolerance(points []*Vec3) float64 { return refineEpsilon * fit(points).Radius }
