package engine

import (
	"fmt"
	"math"
	"tangentgarden/engine/expr"
)

// EnvelopeFamily is a one-parameter family of lines or circles. Lines pass
// through the base point r(t); circles are centered on it. Mode "angle" turns each line to the direction angle Angle(t), in
// radians counterclockwise from +x. Mode "chord" joins r(t) to a second
// endpoint (X(t), Y(t)) on the same parameter, drawn as the segment between
// them unless Extend asks for the full line. Mode "circle" gives each circle
// the radius Radius(t). Expressions share a and the base's domain.
//
// Lines are unoriented, so a direction turning by exactly π is the same line.
// A chord whose endpoints coincide has no direction; it is left as a gap.
type EnvelopeFamily struct {
	Mode   string `json:"mode"`
	Angle  string `json:"angle"`
	X      string `json:"x"`
	Y      string `json:"y"`
	Extend bool   `json:"extend"`
	Radius string `json:"radius"`
}

// lines evaluates a family on the base's domain.
type lines struct {
	unit   curveFunc // the line's unit direction at t
	end    curveFunc // the chord's far endpoint; nil for an angle
	extend bool
	lo, hi float64
}

func newLines(l EnvelopeFamily, base curveFunc, a, lo, hi float64) (*lines, error) {
	out := &lines{extend: l.Extend, lo: lo, hi: hi}
	switch l.Mode {
	case "angle":
		theta, err := expr.ParseWithParameter(l.Angle, a)
		if err != nil {
			return nil, fmt.Errorf("direction angle: %w", err)
		}
		out.unit = func(t float64) Vec {
			sin, cos := math.Sincos(theta(t))
			return Vec{cos, sin}
		}
	case "chord":
		end, err := compile(Curve{Format: "parametric", X: l.X, Y: l.Y, Min: lo, Max: hi, A: a})
		if err != nil {
			return nil, fmt.Errorf("second endpoint %w", err)
		}
		out.end = end
		out.unit = func(t float64) Vec {
			p, q := base(t), end(t)
			if coincide(p, q) {
				return Vec{math.NaN(), math.NaN()}
			}
			return q.Sub(p).Unit()
		}
	default:
		return nil, fmt.Errorf("the family is lines at a direction angle, chords to a second endpoint, or circles of a radius")
	}
	return out, nil
}

// coincide reports endpoints too close for the chord to have a direction.
func coincide(p, q Vec) bool {
	return q.Sub(p).Norm() <= 1e-9*(1+p.Norm()+q.Norm())
}

// familyLine is one member of the family, with the envelope's point on it.
type familyLine struct {
	ok         bool // the line is defined
	coincident bool // a chord's endpoints coincide
	direction  Vec
	end        *Vec
	target     *Vec
	virtual    bool
}

// at is the line through p, where the base has derivative dp, at t. The
// envelope's point solves det(r′ + λu′, u) = 0 on r + λu. Neighbouring
// directions are aligned with this one before differentiating, so the
// line's own orientation never matters. A chord's point is virtual when it
// lies beyond the segment and the chord is not extended.
func (l *lines) at(t float64, p, dp Vec) familyLine {
	var out familyLine
	if l.end != nil {
		q := l.end(t)
		if !q.Valid() {
			return out
		}
		if coincide(p, q) {
			out.coincident = true
			return out
		}
		out.end = &q
	}
	u := l.unit(t)
	if !u.Valid() {
		return out
	}
	out.ok, out.direction = true, u
	aligned := func(s float64) Vec {
		v := l.unit(s)
		if v.Dot(u) < 0 {
			v = v.Mul(-1)
		}
		return v
	}
	du, _ := derivatives(aligned, t, l.lo, l.hi)
	if !stableTangent(aligned, t, l.lo, l.hi, du) {
		return out
	}
	target, s := Envelope(p, dp, u, du)
	out.target = target
	if target != nil && out.end != nil && !l.extend {
		length := out.end.Sub(p).Norm()
		slack := 1e-9 * (1 + length)
		out.virtual = s < -slack || s > length+slack
	}
	return out
}

// rings evaluates a family of circles centered on the base, of radius R(t).
type rings struct {
	radius curveFunc // R(t) as the x coordinate, to share the differentiator
	lo, hi float64
}

func newRings(l EnvelopeFamily, a, lo, hi float64) (*rings, error) {
	radius, err := expr.ParseWithParameter(l.Radius, a)
	if err != nil {
		return nil, fmt.Errorf("circle radius: %w", err)
	}
	return &rings{radius: func(t float64) Vec { return Vec{radius(t), 0} }, lo: lo, hi: hi}, nil
}

// ring is one circle of the family, with its touching points.
type ring struct {
	ok          bool    // the circle is defined: a positive radius
	radius      float64 //
	left, right *Vec    // touching points to the left and right of travel
	stationary  bool    // the center does not move
	nested      bool    // |R′| > |c′|: no real envelope point
}

// merge is the tolerance within which |R′| = |c′| merges the two branches,
// rather than leaving no real point, relative to 1.
const merge = 1e-9

// at is the circle centered at c, where the base has derivative dc, at t.
// Its envelope points X = c + q solve |q|² = R² and q·c′ = −RR′: with
// v = |c′|, T = c′/v, and k = R′/v, q = R(−kT ± √(1−k²) JT). There are two
// real points while |k| < 1, one where |k| = 1, and none beyond. A stationary
// center leaves the system degenerate, so it has no envelope point.
func (g *rings) at(t float64, c, dc Vec) ring {
	R := g.radius(t).X
	if !finite(R) || R <= 0 {
		return ring{}
	}
	out := ring{ok: true, radius: R}
	v := dc.Norm()
	if v < 1e-9 {
		out.stationary = true
		return out
	}
	dR, _ := derivatives(g.radius, t, g.lo, g.hi)
	if !stableTangent(g.radius, t, g.lo, g.hi, dR) {
		return out
	}
	k := dR.X / v
	h := 1 - k*k
	if h < -merge {
		out.nested = true
		return out
	}
	T := dc.Mul(1 / v)
	along, across := T.Mul(-R*k), T.Perp().Mul(R*math.Sqrt(math.Max(0, h)))
	out.left, out.right = point(c.Add(along).Add(across)), point(c.Add(along).Sub(across))
	return out
}

// paths are the envelope's two branches, indexed like the base samples.
func (g *rings) paths(samples int) []Path {
	return []Path{
		{Branch: "left", Points: make([]*Vec, samples)},
		{Branch: "right", Points: make([]*Vec, samples)},
	}
}
