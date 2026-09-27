package engine

import (
	"fmt"
	"math"
)

// RollingCircle is a circle of radius Radius rolling without slipping along
// the base curve, tangent to it on the Side of travel ("left" or "right"),
// with a tracing point at distance Arm from its center. At the domain start
// the arm points at the contact, turned counterclockwise by Phase radians.
type RollingCircle struct {
	Side   string  `json:"side"`
	Radius float64 `json:"radius"`
	Arm    float64 `json:"arm"`
	Phase  float64 `json:"phase"`
}

func (c RollingCircle) validate() error {
	if c.Side != "left" && c.Side != "right" {
		return fmt.Errorf("the rolling circle rolls on the left or right side of the curve")
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
func (c RollingCircle) at(p, d Vec, s float64) Rolling {
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
