package engine

import (
	"math"
	"slices"
)

// Rational images outside this disk are deliberately omitted. The fixed
// image-plane fence bounds coordinates before SVG fitting/clipping; it is
// independent of the source exclusion and of either manual camera.
const LoomImageLimit = 1e8

// Power images outside this disk are omitted. A polynomial has no pole, so
// this fence only keeps arithmetic finite: squares of retained coordinates
// stay far below float64 overflow, and every admitted analytic family
// (|z| ≤ √2·10⁶, so |z⁶| < 10³⁷) lies strictly inside it.
const LoomPowerImageLimit = 1e100

// The exponential's declared source window is the closed rectangle
// |Re z| ≤ ln 10⁸, |Im z| ≤ 8π. Since |exp z| = e^Re z, its images (and its
// derivative, which is the map itself) lie in the annulus 10⁻⁸ ≤ |w| ≤ 10⁸,
// the rational maps' fence; the imaginary bound admits eight periods, so the
// window bounds every analytic member's pilot work. Points beyond it are
// clipped in the source, before evaluation.
const LoomExpRealLimit = 8 * math.Ln10
const LoomExpImagLimit = 8 * math.Pi

// Pilot samples of the exponential are at most this far apart in the
// source, an eighth of a period, so no turn of an image can alias between
// them. A chord spanning more than a quarter period is never accepted.
const loomExpPilotStep = math.Pi / 4

// Subdividing one pilot interval never takes more pieces than a chord
// across the whole window needs, so an interval reaching far outside it
// costs no more than one inside it.
var loomExpPilotPieces = math.Ceil(2 * math.Hypot(LoomExpRealLimit, LoomExpImagLimit) / loomExpPilotStep)

func (q LoomRequest) validateMap() error {
	switch q.Map {
	case "square":
		return nil
	case "exp":
		// No parameter, pole, exclusion or critical point.
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
		return fieldErr("map", "choose squaring, a power zⁿ, the exponential, Möbius or z + λ/z")
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
	case "exp":
		// The source window already bounds the image.
		return math.Inf(1)
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
	case "exp":
		if !inExpWindow(p) {
			return nil
		}
		return loomExp(p)
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

func inExpWindow(p Vec) bool {
	return math.Abs(p.X) <= LoomExpRealLimit && math.Abs(p.Y) <= LoomExpImagLimit
}

// loomExp is e^x (cos y, sin y), without the window: an exact crossing of
// the closed window is drawn even when rounding puts its source just outside.
func loomExp(p Vec) *Vec {
	r := math.Exp(p.X)
	return point(Vec{r * math.Cos(p.Y), r * math.Sin(p.Y)})
}

// translates lists the exponential's other source points z + 2πik, k ≠ 0,
// inside its window: every one has the same image as z.
func (q LoomRequest) translates(p Vec) []Vec {
	if q.Map != "exp" || !inExpWindow(p) {
		return nil
	}
	var out []Vec
	lo := int(math.Ceil((-LoomExpImagLimit - p.Y) / (2 * math.Pi)))
	hi := int(math.Floor((LoomExpImagLimit - p.Y) / (2 * math.Pi)))
	for k := lo; k <= hi; k++ {
		if y := p.Y + 2*math.Pi*float64(k); k != 0 && math.Abs(y) <= LoomExpImagLimit {
			out = append(out, Vec{p.X, y})
		}
	}
	return out
}

// windowCuts are the parameters where an analytic member crosses the
// exponential's window, inserted as pilot samples so that the boundary is
// drawn exactly and an arc narrower than the pilot spacing is not missed.
// Selected curves use one-sided bisection instead.
func (q LoomRequest) windowCuts(id int) []float64 {
	if q.Map != "exp" || q.Source.Kind == "curve" {
		return nil
	}
	X, Y := LoomExpRealLimit, LoomExpImagLimit
	s := q.Source
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
		// A vertical line x = c crosses y = ±Y; a horizontal one x = ±X.
		if vertical && math.Abs(fixed) <= X {
			return []float64{-Y, Y}
		}
		if !vertical && math.Abs(fixed) <= Y {
			return []float64{-X, X}
		}
		return nil
	}
	center, radius, phase := Vec{}, s.Radius*float64(id+1)/float64(s.Count), 0.0
	if s.Kind == "rosette" {
		radius = s.Radius
		phase = 2 * math.Pi * float64(id) / float64(s.Count)
		center = Vec{radius * math.Cos(phase), radius * math.Sin(phase)}
	}
	// The point at angle φ = θ + phase is center + radius·e^{iφ}.
	var out []float64
	wrap := func(phi float64) {
		t := math.Mod(phi-phase, 2*math.Pi)
		if t < 0 {
			t += 2 * math.Pi
		}
		out = append(out, t)
	}
	for _, edge := range []float64{-X, X} {
		if c := (edge - center.X) / radius; math.Abs(c) <= 1 {
			wrap(math.Acos(c))
			wrap(-math.Acos(c))
		}
	}
	for _, edge := range []float64{-Y, Y} {
		if v := (edge - center.Y) / radius; math.Abs(v) <= 1 {
			wrap(math.Asin(v))
			wrap(math.Pi - math.Asin(v))
		}
	}
	slices.Sort(out)
	return slices.Compact(out)
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
	if q.Map == "exp" {
		// Probes a whole period apart agree in the image; a chord whose
		// source, with its measured deviation, spans more than a quarter
		// period must subdivide even when its image probes lie along it.
		deviation := 0.0
		for _, n := range probes {
			deviation = math.Max(deviation, plane.Distance(*n.p, a, b))
		}
		return b.Sub(a).Norm()+2*deviation <= 2*loomExpPilotStep
	}
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
