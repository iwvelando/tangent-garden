package engine

import (
	"fmt"
	"math"
	"tangentgarden/engine/expr"
)

// LineFamily is a one-parameter family of lines, each through the base point
// r(t). Mode "angle" turns each line to the direction angle Angle(t), in
// radians counterclockwise from +x. Mode "chord" joins r(t) to a second
// endpoint (X(t), Y(t)) on the same parameter, drawn as the segment between
// them unless Extend asks for the full line. Expressions share a and the
// base's domain.
//
// Lines are unoriented, so a direction turning by exactly π is the same line.
// A chord whose endpoints coincide has no direction; it is left as a gap.
type LineFamily struct {
	Mode   string `json:"mode"`
	Angle  string `json:"angle"`
	X      string `json:"x"`
	Y      string `json:"y"`
	Extend bool   `json:"extend"`
}

// lines evaluates a family on the base's domain.
type lines struct {
	unit   curveFunc // the line's unit direction at t
	end    curveFunc // the chord's far endpoint; nil for an angle
	extend bool
	lo, hi float64
}

func newLines(l LineFamily, base curveFunc, a, lo, hi float64) (*lines, error) {
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
		return nil, fmt.Errorf("the lines are given by a direction angle or a second endpoint")
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
