package engine

import "math"

// Evolute is the center of curvature. Zero curvature has no finite center.
func Evolute(p, d, dd Vec) *Vec {
	cross := d.Cross(dd)
	if d.Norm() < 1e-9 || math.Abs(cross) < 1e-10*d.Norm()*math.Max(dd.Norm(), 1) {
		return nil
	}
	return point(p.Add(d.Perp().Mul(d.Dot(d) / cross)))
}
