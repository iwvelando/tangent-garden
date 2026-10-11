package engine

import "math"

// Evolute is the center of curvature. Zero curvature has no finite center,
// and neither has a stationary point.
func Evolute(p, d, dd Vec) *Vec {
	cross := d.Cross(dd)
	if stationary(p, d, dd) || math.Abs(cross) < 1e-10*d.Norm()*math.Max(dd.Norm(), 1) {
		return nil
	}
	return point(p.Add(d.Perp().Mul(d.Dot(d) / cross)))
}

// stationary reports a point p of a curve with stencil derivatives d and dd
// that has no tangent: its speed is below 10⁻⁹ of its distance from the
// origin, which bounds the speed's rounding, plus its acceleration, which a
// cusp at the origin keeps (both per unit of the parameter). Neither
// changes with the curve's units.
func stationary(p, d, dd Vec) bool {
	return !(d.Norm() >= 1e-9*(p.Norm()+dd.Norm()))
}
