package engine

// Involute returns r(t) - (s(t) + offset) T(t). s starts at the domain minimum.
func Involute(p, d Vec, s, offset float64) *Vec {
	if d.Norm() < 1e-9 {
		return nil
	}
	return point(p.Sub(d.Unit().Mul(s + offset)))
}
