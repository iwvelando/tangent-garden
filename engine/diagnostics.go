package engine

import (
	"math"
	"tangentgarden/engine/refine"
)

// Diagnostics describes the base curve at every sample for the probe,
// indexed like Base; sample i is at t = Min + (Max − Min)·i/(n − 1). With r′
// and r″ the parameter derivatives, the signed curvature is
// κ = (r′ × r″)/|r′|³, positive where the curve turns left
// (counterclockwise), the unit tangent T = r′/|r′|, the normal N its left
// perpendicular, and the center of curvature r + N/κ, a point of the
// evolute.
//
// A sample the base leaves out has no diagnostics. Curvature is null where
// r″ is ill-conditioned (two stencil spacings disagree), counted by Unknown,
// and 0 where the acceleration across the tangent, (r′ × r″)/|r′|, is within
// ten times that disagreement, numerical noise on a straight stretch, or
// below the evolute's own guard, counted by Flat; neither has a center. A center whose radius of curvature exceeds 100
// study radii is null, at infinity, counted by Clipped.
//
// Length is the arc length of the drawn curve from its first sample to each
// sample, by Simpson's rule on every interval from the speeds at its ends and
// midpoint. It is null where the curve is not drawn, and an interval beside
// an undefined sample adds nothing, so it measures only the drawn pieces.
type Diagnostics struct {
	Min       float64    `json:"min"`
	Max       float64    `json:"max"`
	Curvature []*float64 `json:"curvature"`
	Tangent   []*Vec     `json:"tangent"`
	Normal    []*Vec     `json:"normal"`
	Center    []*Vec     `json:"center"`
	Length    []*float64 `json:"length"`
	Flat      int        `json:"flat"`
	Unknown   int        `json:"unknown"`
	Clipped   int        `json:"clipped"`
	// radius is the study radius a center is clipped beyond 100 of.
	radius float64
}

// diagnose describes the base f at the drawn samples of base, from lo to hi.
func diagnose(f curveFunc, base []*Vec, lo, hi float64) *Diagnostics {
	n := len(base)
	step := (hi - lo) / float64(n-1)
	d := &Diagnostics{Min: lo, Max: hi, Curvature: make([]*float64, n), Tangent: make([]*Vec, n),
		Normal: make([]*Vec, n), Center: make([]*Vec, n), Length: make([]*float64, n),
		radius: refine.Radius(base, func(p Vec) []float64 { return []float64{p.X, p.Y} })}
	speed := func(t float64) float64 {
		v, _ := derivatives(f, t, lo, hi)
		return v.Norm()
	}
	length := 0.0
	for i, p := range base {
		if p == nil {
			continue
		}
		t := lo + float64(i)*step
		v, a := derivatives(f, t, lo, hi)
		if i > 0 && base[i-1] != nil {
			if inc := step / 6 * (speed(t-step) + 4*speed(t-step/2) + v.Norm()); finite(inc) {
				length += inc
			}
		}
		s := length
		d.Length[i] = &s
		if !(v.Norm() >= 1e-9) || !v.Valid() {
			continue
		}
		tangent := v.Unit()
		normal := tangent.Perp()
		d.Tangent[i], d.Normal[i] = &tangent, &normal
		if !stable(f, t, lo, hi, v, a) {
			d.Unknown++
			continue
		}
		// Flat where the acceleration across the tangent is within the
		// stencil's own resolution of r″, measured by the disagreement of two
		// spacings, or below the evolute's guard.
		cross := v.Cross(a)
		_, half := derivativesAtStep(f, t, lo, hi, baseStencil(lo, hi).h/2)
		if math.Abs(cross)/v.Norm() <= 10*half.Sub(a).Norm() || math.Abs(cross) < 1e-10*v.Norm()*math.Max(a.Norm(), 1) {
			zero := 0.0
			d.Curvature[i] = &zero
			d.Flat++
			continue
		}
		kappa := cross / (v.Norm() * v.Norm() * v.Norm())
		d.Curvature[i] = &kappa
		if math.Abs(1/kappa) > 100*d.radius {
			d.Clipped++
			continue
		}
		center := p.Add(normal.Mul(1 / kappa))
		d.Center[i] = &center
	}
	return d
}
