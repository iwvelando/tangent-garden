package engine3

import (
	"math"
	"tangentgarden/engine/expr"
	"tangentgarden/engine/refine"
)

// Adaptive refinement of a drawn curve: points inserted between its uniform
// samples wherever the chord joining them strays from the curve
// (engine/refine, shared with the planar engine). The uniform samples stay
// the study's identity (its surfaces, construction lines, reveal and probe);
// refinement only adds drawn points between them.
const (
	refineDepth   = refine.Depth
	refineBudget  = refine.Budget
	refineEpsilon = refine.Epsilon
)

// RefinedPath is a drawn curve with its refinement. Points and At run in
// parameter order: At is each point's position in sample steps, whole at the
// uniform samples (which are all present, unchanged) and fractional between
// them. A null point is a break: a uniform sample without a point, an
// interval the uniform study breaks, or one refinement found (Breaks counts
// the uniform intervals it broke). A segment still farther than Tolerance
// from the curve at the finest step, or when the budget ran out
// (Exhausted), is counted in Unresolved. View is the finest tolerance a
// piece the view shows was refined to, when it was finer than Tolerance
// (see View).
type RefinedPath struct {
	Points     []*Vec3   `json:"points"`
	At         []float64 `json:"at"`
	Tolerance  float64   `json:"tolerance"`
	Inserted   int       `json:"inserted"`
	Breaks     int       `json:"breaks"`
	Unresolved int       `json:"unresolved"`
	Exhausted  bool      `json:"exhausted"`
	View       float64   `json:"view,omitempty"`
}

// AdaptiveResult holds the refined curves a study draws: the curve its
// construction is built on (Base), the base curve beneath a derived input
// (Parent), a tangent projection, an inversion image, the involute
// construction's members, the framed construction's offset strands, the
// ruled construction's partner thread and the canal's meridians. An involute input is evaluated by
// its own quadrature, and a member's arc length is carried on from the
// sample before. A path that is not drawn, or cannot be evaluated between
// samples, is absent: integrated trajectories and pursuits.
type AdaptiveResult struct {
	Base       *RefinedPath `json:"base,omitempty"`
	Parent     *RefinedPath `json:"parent,omitempty"`
	Projection *RefinedPath `json:"projection,omitempty"`
	Image      *RefinedPath `json:"image,omitempty"`
	// Involute holds the involute construction's members, indexed like
	// its result's members.
	Involute []*RefinedPath `json:"involute,omitempty"`
	// Strands holds the framed construction's offset strands, indexed like
	// its frame's strands.
	Strands []*RefinedPath `json:"strands,omitempty"`
	// Partner is the ruled construction's partner thread, b(φ(t)).
	Partner *RefinedPath `json:"partner,omitempty"`
	// Meridians holds the canal's meridians, indexed like its result's
	// meridians.
	Meridians []*RefinedPath `json:"meridians,omitempty"`
	// Minus and Plus are a developable's or framed ribbon's edges, refined
	// when its surface is.
	Minus *RefinedPath `json:"minus,omitempty"`
	Plus  *RefinedPath `json:"plus,omitempty"`
	// Columns counts the positions between samples added to the surface,
	// when it is refined too; Capped is set when the budget left a level
	// of them out.
	Columns int  `json:"columns,omitempty"`
	Capped  bool `json:"capped,omitempty"`
}

// space measures points for refinement.
var space = refine.Metric[Vec3]{
	Distance: segmentDistance,
	Length:   func(a, b Vec3) float64 { return b.sub(a).norm() },
}

// refinePath refines a path sampled uniformly at n+1 parameters from lo to
// hi, with breaks[i+1] marking a broken interval i, evaluating the curve
// with at, whose undefined points are nonfinite (see refine.Refine). It
// returns the intervals refinement broke, in order.
func refinePath(points []*Vec3, breaks []bool, at func(float64) Vec3, lo, hi, tolerance float64, budget int) (*RefinedPath, []int) {
	return refineViewed(points, breaks, at, lo, hi, tolerance, budget, nil)
}

// refine refines a path of the study (see refinePath) at refineEpsilon of
// its own robust radius, within the budget, and to the study's view, when
// it has one.
func (c Request) refine(points []*Vec3, breaks []bool, at func(float64) Vec3, lo, hi float64) (*RefinedPath, []int) {
	return refineViewed(points, breaks, at, lo, hi, pathTolerance(points), refineBudget, c.View)
}

// refineViewed is refinePath refined to a view as well, when there is one.
func refineViewed(points []*Vec3, breaks []bool, at func(float64) Vec3, lo, hi, tolerance float64, budget int, view *View) (*RefinedPath, []int) {
	evaluate := func(t float64) *Vec3 {
		if p := at(t); p.valid() {
			return &p
		}
		return nil
	}
	var path *refine.Path[Vec3]
	var broken []int
	if view == nil {
		path, broken = refine.Refine(points, breaks, evaluate, space, lo, hi, tolerance, budget)
	} else {
		path, broken = refine.RefineFocused(points, breaks, evaluate, space, lo, hi, tolerance, budget, view.focus())
	}
	return &RefinedPath{
		View:       path.Finest,
		Points:     path.Points,
		At:         path.At,
		Tolerance:  path.Tolerance,
		Inserted:   path.Inserted,
		Breaks:     path.Breaks,
		Unresolved: path.Unresolved,
		Exhausted:  path.Exhausted,
	}, broken
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
