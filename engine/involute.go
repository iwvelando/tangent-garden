package engine

// Involute returns r(t) - (s(t) + offset) T(t). s starts at the domain minimum.
// The derivatives d and dd supply the same relative tangent guard as the
// evolute: acceleration bounds the residual speed at a cusp at the origin.
// Only the first derivative needs to be stable.
func Involute(p, d, dd Vec, s, offset float64) *Vec {
	if stationary(p, d, dd) {
		return nil
	}
	return point(p.Sub(d.Unit().Mul(s + offset)))
}

// unwound is the involute at t, where the input g is at p with tangent d,
// its arc length continued from arc at an earlier sample start by Simpson's
// rule on g's speed, as the sample loop steps from one sample to the next.
// It is undefined where that rule's speeds are not finite. The sample loop,
// with start = t, and refinement share this one compiled function, so a
// refined involute passes exactly through the samples: copies inlined in
// different places can round differently.
//
//go:noinline
func (q Request) unwound(g curveFunc, start, arc, t float64, p, d, dd Vec) *Vec {
	return Involute(p, d, dd, q.arcTo(g, start, arc, t, d), q.Offset)
}

// arcTo is the arc length at t, where g has velocity d, continued from arc
// at an earlier sample start by one Simpson step. It is unwound's, and
// shared by a family's members (see AnchoredInvolutes), as one compiled
// function.
//
//go:noinline
func (q Request) arcTo(g curveFunc, start, arc, t float64, d Vec) float64 {
	if h := t - start; h > 0 {
		lo, hi := q.Curve.Min, q.Curve.Max
		a, _ := derivatives(g, start, lo, hi)
		b, _ := derivatives(g, t-h/2, lo, hi)
		arc += h / 6 * (a.Norm() + 4*b.Norm() + d.Norm())
	}
	return arc
}
