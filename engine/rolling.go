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
