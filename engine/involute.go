package engine

// Involute returns r(t) - (s(t) + offset) T(t). s starts at the domain minimum.
func Involute(p, d Vec, s, offset float64) *Vec {
	if d.Norm() < 1e-9 {
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
func (q Request) unwound(g curveFunc, start, arc, t float64, p, d Vec) *Vec {
	if h := t - start; h > 0 {
		lo, hi := q.Curve.Min, q.Curve.Max
		a, _ := derivatives(g, start, lo, hi)
		b, _ := derivatives(g, t-h/2, lo, hi)
		arc += h / 6 * (a.Norm() + 4*b.Norm() + d.Norm())
	}
	return Involute(p, d, arc, q.Offset)
}
