package engine

import "math"

// Rational images outside this disk are deliberately omitted. The fixed
// image-plane fence bounds coordinates before SVG fitting/clipping; it is
// independent of the source exclusion and of either manual camera.
const LoomImageLimit = 1e8

// Power images outside this disk are omitted. A polynomial has no pole, so
// this fence only keeps arithmetic finite: squares of retained coordinates
// stay far below float64 overflow, and every admitted analytic family
// (|z| ≤ √2·10⁶, so |z⁶| < 10³⁷) lies strictly inside it.
const LoomPowerImageLimit = 1e100

func (q LoomRequest) validateMap() error {
	switch q.Map {
	case "square":
		return nil
	case "power":
		// Categorical configuration: no parameter, pole or exclusion.
		if q.Degree < 2 || q.Degree > 6 {
			return fieldErr("degree", "power degree must be a whole number 2–6")
		}
		return nil
	case "mobius":
		if !finite(q.MapParameter) || math.Abs(q.MapParameter) > .9 {
			return fieldErr("mapParameter", "Möbius parameter must be −0.9–0.9")
		}
	case "joukowski":
		if !finite(q.MapParameter) || q.MapParameter < 0 || q.MapParameter > 1 {
			return fieldErr("mapParameter", "rational parameter must be 0–1")
		}
	default:
		return fieldErr("map", "choose squaring, a power zⁿ, Möbius or z + λ/z")
	}
	if !finite(q.ExclusionRadius) || q.ExclusionRadius < 1e-6 || q.ExclusionRadius > 1e6 {
		return fieldErr("exclusionRadius", "pole exclusion radius must be 0.000001–1000000 source units")
	}
	return nil
}

func (q LoomRequest) pole() *Vec {
	if q.MapParameter == 0 {
		return nil
	}
	// Squaring and powers have no pole, whatever rational settings remain.
	switch q.Map {
	case "mobius":
		// Avoid even forming 1/b when a tiny b puts the pole outside all
		// representable source coordinates. The identity limit stays finite.
		return point(Vec{1 / q.MapParameter, 0})
	case "joukowski":
		return &Vec{}
	}
	return nil
}

// imageLimit is the map's image fence; squaring keeps its unfenced output.
func (q LoomRequest) imageLimit() float64 {
	switch q.Map {
	case "square":
		return math.Inf(1)
	case "power":
		return LoomPowerImageLimit
	}
	return LoomImageLimit
}

func (q LoomRequest) image(p Vec) *Vec {
	w := q.mapImage(p)
	if w != nil && w.Norm() > q.imageLimit() {
		return nil
	}
	return w
}

// loomPower evaluates z^n, 2 ≤ n ≤ 6, by repeated complex multiplication.
// Degree two is exactly squaring's arithmetic. A source whose modulus
// already puts z^n well beyond the fence returns nil before multiplying, so
// no intermediate overflows; the fence itself is applied by image.
func loomPower(p Vec, n int) *Vec {
	if p.Norm() > 2*math.Pow(LoomPowerImageLimit, 1/float64(n)) {
		return nil
	}
	w := *loomSquare(p)
	for k := 2; k < n; k++ {
		w = Vec{w.X*p.X - w.Y*p.Y, w.X*p.Y + w.Y*p.X}
	}
	return point(w)
}

func (q LoomRequest) mapImage(p Vec) *Vec {
	switch q.Map {
	case "square":
		return loomSquare(p)
	case "power":
		// Never the rational identity limit: MapParameter is ignored here.
		return loomPower(p, q.Degree)
	}
	if q.MapParameter == 0 {
		return point(p)
	}
	if pole := q.pole(); pole != nil && p.Sub(*pole).Norm() <= q.ExclusionRadius {
		return nil
	}
	switch q.Map {
	case "mobius":
		b := q.MapParameter
		x, y := 1-b*p.X, -b*p.Y
		d := x*x + y*y
		return point(Vec{((p.X-b)*x + p.Y*y) / d, (p.Y*x - (p.X-b)*y) / d})
	case "joukowski":
		d := p.Dot(p)
		return point(Vec{p.X + q.MapParameter*p.X/d, p.Y - q.MapParameter*p.Y/d})
	}
	return nil
}

func (q LoomRequest) domain(p Vec) string {
	if pole := q.pole(); pole != nil && p.Sub(*pole).Norm() <= q.ExclusionRadius {
		return "excluded"
	}
	return ""
}

// Analytic families expose their crossings before image refinement. A
// tangency contributes one cut; a disk covering the whole member needs none.
// Selected expression curves use the bounded adaptive checks instead.
func (q LoomRequest) poleCuts(id int) []float64 {
	pole := q.pole()
	if pole == nil || q.Source.Kind == "curve" {
		return nil
	}
	s, r := q.Source, q.ExclusionRadius
	if s.Kind == "grid" {
		vertical := id < s.XCount
		n, a, b, index := s.XCount, s.XMin, s.XMax, id
		if !vertical {
			n, a, b, index = s.YCount, s.YMin, s.YMax, id-s.XCount
		}
		fixed := a/2 + b/2
		if n > 1 {
			fixed = a + (b-a)*float64(index)/float64(n-1)
		}
		d, center := fixed-pole.X, pole.Y
		if !vertical {
			d, center = fixed-pole.Y, pole.X
		}
		d = math.Abs(d)
		if d > r {
			return nil
		}
		h := math.Sqrt((r - d) * (r + d))
		return []float64{center - h, center + h}
	}
	center, radius, phase := Vec{}, s.Radius*float64(id+1)/float64(s.Count), 0.0
	if s.Kind == "rosette" {
		radius = s.Radius
		phase = 2 * math.Pi * float64(id) / float64(s.Count)
		center = Vec{radius * math.Cos(phase), radius * math.Sin(phase)}
	}
	delta := pole.Sub(center)
	d := delta.Norm()
	if d == 0 || d > radius+r || d < math.Abs(radius-r) {
		return nil
	}
	// Triangle half-angle, factored at both tangencies. Unlike acos of a
	// value rounded to 1, it retains a small disk on a large source circle.
	difference := math.Abs(radius - d)
	angle := 2 * math.Atan2(
		math.Sqrt(math.Max(0, (r-difference)*(r+difference))),
		math.Sqrt(math.Max(0, (radius+d-r)*(radius+d+r))),
	)
	base := math.Atan2(delta.Y, delta.X) - phase
	wrap := func(t float64) float64 {
		t = math.Mod(t, 2*math.Pi)
		if t < 0 {
			t += 2 * math.Pi
		}
		return t
	}
	return []float64{wrap(base - angle), wrap(base + angle)}
}

// Finite probes cannot certify an arbitrary expression. They require source
// chords and their measured deviation to clear the excluded disk. A chord
// passing through it must subdivide even when its image probes are collinear.
func (q LoomRequest) domainSafe(a, b Vec, probes [3]loomNode) bool {
	pole := q.pole()
	if pole == nil {
		return true
	}
	deviation := 0.0
	for _, n := range probes {
		if n.p == nil {
			return false
		}
		deviation = math.Max(deviation, plane.Distance(*n.p, a, b))
	}
	return plane.Distance(*pole, a, b) > q.ExclusionRadius+4*deviation
}

func (q LoomRequest) critical(p Vec) bool {
	// (zⁿ)′ = n zⁿ⁻¹ vanishes only at zero, a finite drawable point.
	if q.Map == "square" || q.Map == "power" {
		return p.X == 0 && p.Y == 0
	}
	if q.Map == "joukowski" && q.MapParameter > 0 {
		// J′ = 1 − λ/z² vanishes where z² = λ. Sources reach ±√λ through
		// trigonometry, such as sin π on a circle of radius √λ, so accept
		// z² within a few roundings of λ rather than only exact equality.
		u, v := p.X*p.X-p.Y*p.Y-q.MapParameter, 2*p.X*p.Y
		return math.Hypot(u, v) <= 8*0x1p-52*(p.Dot(p)+q.MapParameter)
	}
	return false
}
