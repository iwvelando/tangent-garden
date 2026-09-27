package engine

// Pedal returns the orthogonal projection of pole onto the tangent line at p.
// Only a regular first derivative is required; zero curvature is valid.
func Pedal(p, derivative, pole Vec) *Vec {
	if !p.Valid() || !derivative.Valid() || !pole.Valid() || derivative.Norm() < 1e-9 {
		return nil
	}
	tangent := derivative.Unit()
	return point(p.Add(tangent.Mul(pole.Sub(p).Dot(tangent))))
}
