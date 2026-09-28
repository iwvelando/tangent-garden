package engine

import (
	"fmt"
	"math"
)

// Roller is a shape rolling without slipping along the base curve, tangent to
// it on the Side of travel ("left" or "right"). The Shape is a circle (the
// default) or a curve.
//
// A circle has radius Radius and a tracing point at distance Arm from its
// center. At the domain start the arm points at the contact, turned
// counterclockwise by Phase radians.
//
// A curve is defined in its own frame by Curve, and carries the tracing
// point Point, given in that frame; see MovingCurve.
type Roller struct {
	Side   string      `json:"side"`
	Shape  string      `json:"shape,omitempty"`
	Radius float64     `json:"radius"`
	Arm    float64     `json:"arm"`
	Phase  float64     `json:"phase"`
	Curve  MovingCurve `json:"curve"`
	Point  Vec         `json:"point"`
}

func (c Roller) curve() bool { return c.Shape == "curve" }

func (c Roller) validate() error {
	if c.Shape != "" && c.Shape != "circle" && !c.curve() {
		return fmt.Errorf("the rolling shape is a circle or a curve")
	}
	if c.Side != "left" && c.Side != "right" {
		if c.curve() {
			return fmt.Errorf("the rolling curve rolls on the left or right side of the curve")
		}
		return fmt.Errorf("the rolling circle rolls on the left or right side of the curve")
	}
	if c.curve() {
		if !c.Point.Valid() || math.Abs(c.Point.X) > 1e5 || math.Abs(c.Point.Y) > 1e5 {
			return fmt.Errorf("the rolling curve's tracing point must have finite coordinates within ±100000")
		}
		return nil
	}
	if !finite(c.Radius) || c.Radius <= 0 || c.Radius > 1e5 {
		return fmt.Errorf("the rolling circle radius ρ must be positive, finite, and at most 100000")
	}
	if !finite(c.Arm) || c.Arm < 0 || c.Arm > 1e5 {
		return fmt.Errorf("the rolling circle's tracing distance ℓ must be finite and within 0–100000")
	}
	if !finite(c.Phase) || math.Abs(c.Phase) > 1e6 {
		return fmt.Errorf("the rolling circle phase ψ must be finite and within ±1000000 radians")
	}
	return nil
}

// at places the circle at base point p with derivative d after rolling an
// arc length s from the domain start. With σ = +1 on the left and −1 on the
// right, the center is p + σρN. No slipping turns the circle by −σs/ρ
// relative to the contact direction −σN, so the arm is that direction
// rotated by ψ − σs/ρ. The tangent's own turning is carried by N itself.
func (c Roller) at(p, d Vec, s float64) Rolling {
	sigma := 1.0
	if c.Side == "right" {
		sigma = -1
	}
	n := d.Perp().Unit()
	center := p.Add(n.Mul(sigma * c.Radius))
	toContact := n.Mul(-sigma)
	sin, cos := math.Sincos(c.Phase - sigma*s/c.Radius)
	arm := toContact.Mul(cos).Add(toContact.Perp().Mul(sin))
	return Rolling{Center: center, Radius: c.Radius, Contact: p, Point: center.Add(arm.Mul(c.Arm))}
}

// stationary is the speed below which a curve has no tangent to roll along.
const stillSpeed = 1e-9

// travel is a rolling shape's progress along g. At a cusp the direction of
// travel reverses; the shape stays on its side of the curve and rolls back
// out, turning the other way. So it is placed with the heading, the tangent
// with its reversals undone, and the signed arc length, which runs backward
// after an odd number of cusps: the circle's center, turn, and tracing point
// stay continuous through each cusp.
type travel struct {
	g       curveFunc
	lo, hi  float64
	heading Vec     // the last tangent with a direction, as travelled
	at      float64 // where it was taken
	known   bool
	orient  float64 // +1, or −1 after an odd number of cusps
	arc     float64 // signed arc length from the domain start
	cusps   int
}

func newTravel(g curveFunc, lo, hi float64) *travel {
	return &travel{g: g, lo: lo, hi: hi, orient: 1}
}

// note records a tangent d at t, locating a cusp by bisection when it
// points against the heading. It returns the cusp, or NaN.
func (v *travel) note(t float64, d Vec) float64 {
	if !(d.Norm() > stillSpeed) {
		return math.NaN()
	}
	cusp := math.NaN()
	if v.known && v.heading.Dot(d) < 0 {
		u0, u1 := v.at, t
		for i := 0; i < 200; i++ {
			m := u0 + (u1-u0)/2
			if m <= u0 || m >= u1 {
				break
			}
			if dm, _ := derivatives(v.g, m, v.lo, v.hi); dm.Dot(v.heading) > 0 {
				u0 = m
			} else {
				u1 = m
			}
		}
		cusp = u0 + (u1-u0)/2
	}
	v.heading, v.at, v.known = d, t, true
	return cusp
}

// step advances from t−h to t, where g′ is a, b (at t − h/2), and d. Simpson
// arc length is split at each cusp between them, and its sign turned there.
// It reports whether the arc length stays finite.
func (v *travel) step(t, h float64, a, b, d Vec) bool {
	ts := [3]float64{t - h, t - h/2, t}
	var cuts []float64
	for k, w := range [3]Vec{a, b, d} {
		if c := v.note(ts[k], w); !math.IsNaN(c) {
			cuts = append(cuts, c)
		}
	}
	if len(cuts) == 0 {
		inc := h / 6 * (a.Norm() + 4*b.Norm() + d.Norm())
		v.arc += v.orient * inc
		return finite(inc)
	}
	x := ts[0]
	piece := func(c float64) bool {
		// A cusp located from a heading before this step lies at its start.
		c = math.Max(x, math.Min(c, t))
		sa, _ := derivatives(v.g, x, v.lo, v.hi)
		sb, _ := derivatives(v.g, x+(c-x)/2, v.lo, v.hi)
		sc, _ := derivatives(v.g, c, v.lo, v.hi)
		inc := (c - x) / 6 * (sa.Norm() + 4*sb.Norm() + sc.Norm())
		v.arc += v.orient * inc
		x = c
		return finite(inc)
	}
	for _, c := range cuts {
		if !piece(c) {
			return false
		}
		v.orient, v.cusps = -v.orient, v.cusps+1
	}
	return piece(t)
}
