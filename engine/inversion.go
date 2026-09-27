package engine

import (
	"fmt"
	"math"
)

// Inversion is inversion in the circle of radius Radius about Center. Of
// names the curve inverted: "curve" for the base itself, or a derived curve
// ("evolute", "pedal", "contrapedal", "orthotomic", "offset") evaluated from
// the base with the request's own pole and offset distance.
type Inversion struct {
	Center Vec     `json:"center"`
	Radius float64 `json:"radius"`
	Of     string  `json:"of"`
}

// InversionResult is the circle of inversion and, for a derived curve, that
// curve, indexed like the base. The image is open before each sample in
// Breaks, where it runs off to infinity between two finite samples.
type InversionResult struct {
	Center Vec     `json:"center"`
	Radius float64 `json:"radius"`
	Source []*Vec  `json:"source,omitempty"`
	Breaks []int   `json:"breaks"`
}

// Invert returns O + R²(p − O)/|p − O|². The center has no finite image.
// Inversion reverses orientation; it is not a holomorphic Möbius map.
func Invert(p, center Vec, radius float64) *Vec {
	d := p.Sub(center)
	return point(center.Add(d.Mul(radius * radius / d.Dot(d))))
}

// order is the number of derivatives the inverted curve needs: none for the
// base itself, which may have cusps.
func (v Inversion) order() int {
	switch v.Of {
	case "curve":
		return 0
	case "evolute":
		return 2
	}
	return 1
}

func (v Inversion) validate(pole Vec) error {
	if !v.Center.Valid() {
		return fmt.Errorf("center of inversion coordinates must be finite numbers")
	}
	if !finite(v.Radius) || v.Radius <= 0 || v.Radius > 1e5 {
		return fmt.Errorf("inversion radius must be positive and at most 100000")
	}
	switch v.Of {
	case "curve", "evolute", "offset":
	case "pedal", "contrapedal", "orthotomic":
		if !pole.Valid() {
			return fmt.Errorf("pole coordinates must be finite numbers")
		}
	default:
		return fmt.Errorf("invert the curve, its evolute, pedal, contrapedal, orthotomic, or offset")
	}
	return nil
}

// inverter evaluates the inverted curve at any t, not only at samples, so the
// image can be checked between them.
type inverter struct {
	Inversion
	f        curveFunc
	lo, hi   float64
	pole     Vec
	distance float64
}

// at is the inverted curve's point for the base point p and its derivatives.
func (v *inverter) at(p, dp, ddp Vec) *Vec {
	switch v.Of {
	case "curve":
		return point(p)
	case "evolute":
		return Evolute(p, dp, ddp)
	case "pedal":
		return Pedal(p, dp, v.pole)
	case "contrapedal":
		return Contrapedal(p, dp, v.pole)
	case "orthotomic":
		return Orthotomic(p, dp, v.pole)
	}
	return Offset(p, dp, v.distance)
}

func (v *inverter) source(t float64) *Vec {
	if v.Of == "curve" {
		return point(v.f(t))
	}
	dp, ddp := derivatives(v.f, t, v.lo, v.hi)
	return v.at(v.f(t), dp, ddp)
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
		m := v.source(tm)
		if m == nil || m.Sub(o).Norm() < limit {
			return true
		}
		return walk(t0, tm, a, *m, false) || walk(tm, t1, *m, b, false)
	}
	return walk(t0, t1, a, b, true)
}
