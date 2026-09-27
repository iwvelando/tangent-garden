package engine

// Offset returns the point at signed distance d along the left unit normal,
// positive d toward the left of travel. Only a regular first derivative is
// required: where 1-dκ = 0 the offset has a cusp on the evolute, which is a
// valid point even though the offset's own speed vanishes there.
func Offset(p, derivative Vec, d float64) *Vec {
	if !p.Valid() || !derivative.Valid() || !finite(d) || derivative.Norm() < 1e-9 {
		return nil
	}
	return point(p.Add(derivative.Perp().Unit().Mul(d)))
}
