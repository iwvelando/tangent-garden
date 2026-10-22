package engine

import "math"

// Evolute is the center of curvature. Zero curvature has no finite center,
// and neither has a stationary point.
func Evolute(p, d, dd Vec) *Vec {
	cross := d.Cross(dd)
	if stationary(p, d, dd) || flatCurvature(d, dd) {
		return nil
	}
	return point(p.Add(d.Perp().Mul(d.Dot(d) / cross)))
}

// evolute is Evolute where the stencil resolves the curvature, given the
// second derivative half at half the spacing. It keeps rounding on a
// straight stretch from becoming a distant center, using the same flat
// classification as the probe.
func evolute(p, d, dd, half Vec) *Vec {
	if unresolved(d, dd, half) {
		return nil
	}
	return Evolute(p, d, dd)
}

// unresolved reports bending within ten times the disagreement of the
// second derivatives dd and half, at the stencil's spacing and half of it,
// or below the evolute's flat guard.
func unresolved(d, dd, half Vec) bool {
	return math.Abs(d.Cross(dd))/d.Norm() <= 10*half.Sub(dd).Norm() || flatCurvature(d, dd)
}

// stationary reports a point p of a curve with stencil derivatives d and dd
// that has no tangent: its speed is below 10⁻⁹ of its distance from the
// origin, which bounds the speed's rounding, plus its acceleration, which a
// cusp at the origin keeps (both per unit of the parameter). Neither
// changes with the curve's units.
func stationary(p, d, dd Vec) bool {
	return !(d.Norm() >= 1e-9*(p.Norm()+dd.Norm()))
}

// flatCurvature compares the normal acceleration with the derivative scale.
// Both derivatives scale with the curve's length units; a fixed unit floor
// would classify every sufficiently small circle as flat. Keeping the
// speed in the reference also rejects rounding in a straight line's r″.
func flatCurvature(d, dd Vec) bool {
	return math.Abs(d.Cross(dd)) < 1e-10*d.Norm()*math.Max(dd.Norm(), d.Norm())
}
