package engine

import (
	"math"
	"sort"
	"tangentgarden/engine/refine"
)

// Refinement between samples: points inserted between a drawn curve's
// uniform samples wherever the chord joining them strays from the curve
// (engine/refine, shared with the spatial engine). The uniform samples stay
// the study's identity: its construction lines, framing, reveal and every
// other construction keep them.

// RefinedPath is a drawn curve with its refinement (see refine.Path):
// points in parameter order, each at its position in sample steps, with a
// null at every break.
type RefinedPath struct {
	Points     []*Vec    `json:"points"`
	At         []float64 `json:"at"`
	Tolerance  float64   `json:"tolerance"`
	Inserted   int       `json:"inserted"`
	Breaks     int       `json:"breaks"`
	Unresolved int       `json:"unresolved"`
	Exhausted  bool      `json:"exhausted"`
}

// AdaptiveResult holds the refined curves a study draws: the base curve, the
// derived input a construction acts on, and the derived curve where it is
// defined pointwise from its input's position and stencil derivatives (a
// pedal, contrapedal or orthotomic curve, the evolute, an offset or each
// member of an offset stack, or an inversion's image). A path that is not
// drawn, or cannot be evaluated between samples, is absent: the involute
// and rolling curves are built along the curve, and caustics and envelopes
// as envelopes of a family, so they keep their uniform samples.
type AdaptiveResult struct {
	Base    *RefinedPath `json:"base,omitempty"`
	Input   *RefinedPath `json:"input,omitempty"`
	Derived *RefinedPath `json:"derived,omitempty"`
	// Family holds an offset stack's members, refined each on its own, in
	// the order of the result's family.
	Family []*RefinedPath `json:"family,omitempty"`
}

// refines reports whether a curve format can be evaluated between samples:
// not an integrated chase or trajectory, whose solver already takes
// adaptive steps, nor a level set or iterated map, which have no parameter.
func refines(format string) bool {
	switch format {
	case "", "parametric", "cartesian", "polar", "roulette", "lissajous", "fourier":
		return true
	}
	return false
}

// plane measures points for refinement.
var plane = refine.Metric[Vec]{
	Distance: func(p, a, b Vec) float64 {
		d := b.Sub(a)
		s := 0.0
		if l := d.Dot(d); l > 0 {
			s = math.Max(0, math.Min(1, p.Sub(a).Dot(d)/l))
		}
		return p.Sub(a.Add(d.Mul(s))).Norm()
	},
	Length: func(a, b Vec) float64 { return b.Sub(a).Norm() },
}

// refinePath refines points, broken after each interval in broken, with the
// curve evaluated by at (see refine.Refine), at refine.Epsilon of the
// path's own robust radius. It returns the intervals refinement broke.
func refinePath(points []*Vec, broken map[int]bool, at func(float64) *Vec, lo, hi float64) (*RefinedPath, []int) {
	breaks := make([]bool, len(points))
	for i := range broken {
		breaks[i+1] = true
	}
	tolerance := refine.Epsilon * refine.Radius(points, func(p Vec) []float64 { return []float64{p.X, p.Y} })
	path, found := refine.Refine(points, breaks, at, plane, lo, hi, tolerance, refine.Budget)
	return &RefinedPath{
		Points:     path.Points,
		At:         path.At,
		Tolerance:  path.Tolerance,
		Inserted:   path.Inserted,
		Breaks:     path.Breaks,
		Unresolved: path.Unresolved,
		Exhausted:  path.Exhausted,
	}, found
}

// adapt refines a computed study's drawn curves: the base from f, a derived
// input from g, and a derived curve defined pointwise from g. Intervals
// broken on a curve stay broken on the curves built on it. An inversion's
// image is refined in place of the uniform passage test, whose breaks it
// replaces.
func (q Request) adapt(out *Result, f, g curveFunc) {
	lo, hi := q.Curve.Min, q.Curve.Max
	position := func(c curveFunc) func(float64) *Vec {
		return func(t float64) *Vec { return point(c(t)) }
	}
	broken := map[int]bool{}
	note := func(intervals []int) {
		for _, i := range intervals {
			broken[i] = true
		}
	}
	a := &AdaptiveResult{}
	var found []int
	a.Base, found = refinePath(out.Base, nil, position(f), lo, hi)
	note(found)
	if out.Input != nil {
		a.Input, found = refinePath(out.Input, broken, position(g), lo, hi)
		note(found)
	}
	if derived := q.derivedAt(f, g); derived != nil {
		if out.Inversion != nil {
			// The passage test's breaks give way to refinement's.
			out.Inversion.Breaks = []int{}
		}
		a.Derived, found = refinePath(out.Derived, broken, derived, lo, hi)
		note(found)
	}
	// Each member of a stack is broken where its input is, not where
	// another member is: one member's fold is not a break in its neighbors.
	for _, member := range out.Family {
		if at := q.memberAt(f, g, member); at != nil {
			path, _ := refinePath(member.Points, broken, at, lo, hi)
			a.Family = append(a.Family, path)
		}
	}
	if out.Inversion != nil {
		for i := range broken {
			out.Inversion.Breaks = append(out.Inversion.Breaks, i+1)
		}
		sort.Ints(out.Inversion.Breaks)
	}
	out.Adaptive = a
}

// derivedAt evaluates a study's derived curve at any t from the base f and
// the input g, or is nil when that curve is not defined pointwise.
func (q Request) derivedAt(f, g curveFunc) func(float64) *Vec {
	lo, hi := q.Curve.Min, q.Curve.Max
	switch {
	case usesPole(q.Kind):
		project := map[string]func(p, d, pole Vec) *Vec{"pedal": Pedal, "contrapedal": Contrapedal, "orthotomic": Orthotomic}[q.Kind]
		return func(t float64) *Vec {
			p := g(t)
			d, _ := derivatives(g, t, lo, hi)
			return project(p, d, q.Pole)
		}
	case q.Kind == "evolute":
		return q.along(f, g, func(p, d, dd Vec) *Vec { return Evolute(p, d, dd) })
	case q.Kind == "offset" && !q.Stack.Enabled:
		return q.along(f, g, func(p, d, _ Vec) *Vec { return Offset(p, d, q.Distance) })
	case q.Kind == "inversion":
		return func(t float64) *Vec { return Invert(g(t), q.Inversion.Center, q.Inversion.Radius) }
	}
	return nil
}

// memberAt evaluates a member of an offset stack at any t, or is nil for a
// family that is not a stack (a circle envelope's branches).
func (q Request) memberAt(f, g curveFunc, member Path) func(float64) *Vec {
	if q.Kind != "offset" || !q.Stack.Enabled {
		return nil
	}
	return q.along(f, g, func(p, d, _ Vec) *Vec { return Offset(p, d, member.Distance) })
}

// along evaluates a construction built from its input's position and
// stencil derivatives at any t, undefined wherever a sample there would be:
// where the base or the input is undefined, or the derivatives either
// needs are ill-conditioned, each checked as at the samples.
func (q Request) along(f, g curveFunc, construct func(p, d, dd Vec) *Vec) func(float64) *Vec {
	lo, hi := q.Curve.Min, q.Curve.Max
	base := baseStencil(lo, hi)
	return func(t float64) *Vec {
		p := f(t)
		d, dd := base.derivatives(f, t)
		if !p.Valid() || !base.conditioned(f, t, d, dd, derivativeOrder(q)) {
			return nil
		}
		if composed(q.Input) {
			p = g(t)
			d, dd = base.derivatives(g, t)
			if !p.Valid() || !inputStencil(lo, hi).conditioned(g, t, d, dd, constructionOrder(q.Kind)) {
				return nil
			}
		}
		return construct(p, d, dd)
	}
}
