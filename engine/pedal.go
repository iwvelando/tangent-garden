package engine

// Pedal returns the orthogonal projection of pole onto the tangent line at p.
// Only a regular first derivative is required; zero curvature is valid.
func Pedal(p, derivative, pole Vec) *Vec {
	if !p.Valid() || !derivative.Valid() || !pole.Valid() || derivative.Norm() == 0 || stationary(p, derivative, Vec{}) {
		return nil
	}
	tangent := derivative.Unit()
	return point(p.Add(tangent.Mul(pole.Sub(p).Dot(tangent))))
}

// Contrapedal returns the orthogonal projection of pole onto the normal line
// at p. With the pedal foot H, the points p, H, pole, and K form a rectangle.
func Contrapedal(p, derivative, pole Vec) *Vec {
	h := Pedal(p, derivative, pole)
	if h == nil {
		return nil
	}
	return point(p.Add(pole).Sub(*h))
}

// Orthotomic returns the reflection of pole across the tangent line at p,
// 2H-P for the pedal foot H.
func Orthotomic(p, derivative, pole Vec) *Vec {
	h := Pedal(p, derivative, pole)
	if h == nil {
		return nil
	}
	return point(h.Mul(2).Sub(pole))
}

// usesPole reports whether a construction projects a geometric pole onto the
// tangent or normal. The pole is independent of optical sources.
func usesPole(kind string) bool {
	return kind == "pedal" || kind == "contrapedal" || kind == "orthotomic"
}

// polePoint uses the local acceleration to reject a cusp's rounded velocity,
// even at the origin. Only the first derivative needs to be stable: a C¹
// curve can have a tangent without a resolved second derivative.
func polePoint(kind string, p, d, dd, pole Vec) *Vec {
	if stationary(p, d, dd) {
		return nil
	}
	switch kind {
	case "contrapedal":
		return Contrapedal(p, d, pole)
	case "orthotomic":
		return Orthotomic(p, d, pole)
	}
	return Pedal(p, d, pole)
}
