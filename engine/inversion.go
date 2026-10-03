package engine

import (
	"math"
)

// Inversion is inversion in the circle of radius Radius about Center. The
// curve inverted is the request's input.
type Inversion struct {
	Center Vec     `json:"center"`
	Radius float64 `json:"radius"`
}

// InversionResult is the circle of inversion. The image is open before each
// sample in Breaks, where it runs off to infinity between two finite samples.
type InversionResult struct {
	Center Vec     `json:"center"`
	Radius float64 `json:"radius"`
	Breaks []int   `json:"breaks"`
}

// Invert returns O + R²(p − O)/|p − O|². The center has no finite image.
// Inversion reverses orientation; it is not a holomorphic Möbius map.
func Invert(p, center Vec, radius float64) *Vec {
	d := p.Sub(center)
	return point(center.Add(d.Mul(radius * radius / d.Dot(d))))
}

func (v Inversion) validate() error {
	if !v.Center.Valid() {
		return fieldErr(coordinate("center", v.Center, finite), "center of inversion coordinates must be finite numbers")
	}
	if !finite(v.Radius) || v.Radius <= 0 || v.Radius > 1e5 {
		return fieldErr("radius", "inversion radius must be positive and at most 100000")
	}
	return nil
}

// inverter checks the image between samples of the inverted curve g, which
// it evaluates at any t.
type inverter struct {
	Inversion
	g curveFunc
}

// Bisection evaluations allowed per sample interval; an interval that needs
// more is left open rather than joined unchecked.
const inversionBudget = 512

// open reports whether the image must be left open between parameters t0 and
// t1, whose source points a and b are finite and off the center.
//
// The interval is bisected until each piece subtends a small angle at O, and
// so stays well away from it. The image is open where the source meets O or
// becomes undefined, or approaches O to less than half the nearer endpoint's
// distance: its image would reach more than twice as far as either sample's.
// A piece that cannot be resolved down to floating-point resolution crosses
// O or infinity; it is open only inside the circle, near O. Outside, the
// source runs off to infinity and its image passes continuously through O.
func (v *inverter) open(t0, t1 float64, a, b Vec) bool {
	o := v.Center
	limit := math.Min(a.Sub(o).Norm(), b.Sub(o).Norm()) / 2
	budget := inversionBudget
	var walk func(t0, t1 float64, a, b Vec, first bool) bool
	walk = func(t0, t1 float64, a, b Vec, first bool) bool {
		da, db := a.Sub(o), b.Sub(o)
		if !first && math.Abs(math.Atan2(da.Cross(db), da.Dot(db))) <= 0.25 {
			return false
		}
		tm := t0 + (t1-t0)/2
		if tm <= t0 || tm >= t1 {
			return da.Norm()*db.Norm() < v.Radius*v.Radius
		}
		if budget--; budget < 0 {
			return true
		}
		m := point(v.g(tm))
		if m == nil || m.Sub(o).Norm() < limit {
			return true
		}
		return walk(t0, tm, a, *m, false) || walk(tm, t1, *m, b, false)
	}
	return walk(t0, t1, a, b, true)
}
