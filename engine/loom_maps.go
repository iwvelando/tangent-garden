package engine

import (
	"math"
	"math/cmplx"
	"slices"
)

// Rational images outside this disk are deliberately omitted. The fixed
// image-plane fence bounds coordinates before SVG fitting/clipping; it is
// independent of the source exclusion and of either manual camera.
const LoomImageLimit = 1e8

// Power images outside this disk are omitted. A polynomial has no pole, so
// this fence only keeps arithmetic finite: squares of retained coordinates
// stay far below float64 overflow, and every admitted analytic family
// (|z| ≤ 2·10⁶, so |z⁶| < 10³⁸) lies strictly inside it.
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
		// No pole, exclusion or critical point.
		if s := q.Wrap; s != nil && !(*s >= 0 && *s <= 1) {
			return fieldErr("wrap", "eᶻ map parameter s must be 0–1")
		}
		return nil
	case "power", "exp-power":
		// Categorical configuration: no pole or exclusion.
		if q.Degree < 2 || q.Degree > 6 {
			return fieldErr("degree", "power degree must be a whole number 2–6")
		}
		if s := q.Wrap; q.Map == "exp-power" && s != nil && !(*s >= 0 && *s <= 1) {
			return fieldErr("wrap", "exp(zⁿ) map parameter s must be 0–1")
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
	case "fractional":
		if err := q.Coefficients.validate(); err != nil {
			return err
		}
		if !finite(q.MapParameter) || math.Abs(q.MapParameter) > 1 {
			return fieldErr("mapParameter", "Möbius flow s must be −1–1")
		}
	default:
		return fieldErr("map", "choose squaring, a power zⁿ, the exponential, exp(zⁿ), a Möbius map or z + λ/z")
	}
	if !finite(q.ExclusionRadius) || q.ExclusionRadius < 1e-6 || q.ExclusionRadius > 1e6 {
		return fieldErr("exclusionRadius", "pole exclusion radius must be 0.000001–1000000 source units")
	}
	return nil
}

func (q LoomRequest) pole() *Vec {
	if q.Map == "fractional" {
		return q.mobius().pole
	}
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
	case "exp", "exp-power":
		// The power's fence, binding only near s = 0, where the scaled window
		// no longer bounds the image; at s = 1 the window keeps every image
		// within 10⁸. Under the exponential's family only a selected curve
		// reaches it: grids and circles lie within |z| ≤ 2·10⁶, whose images
		// stay below 1.1·10¹³.
		return LoomPowerImageLimit
	}
	return LoomImageLimit
}

// periodic is where the exponential's period acts on source point p: s·z
// under the exponential's family F_s(z), and s·zⁿ under the composite's
// family G_s(zⁿ), which is nil where the power overflows. Every other map
// has no period, and so no aliasing guard; at s = 0 every distance there is
// zero, and at s = 1 the point is p itself.
func (q LoomRequest) periodic(p Vec) *Vec {
	switch q.Map {
	case "exp":
		s := q.wrap()
		return &Vec{s * p.X, s * p.Y}
	case "exp-power":
		u := loomPower(p, q.Degree)
		if u == nil {
			return nil
		}
		s := q.wrap()
		return &Vec{s * u.X, s * u.Y}
	}
	return nil
}

// wrap is the exponential's or the composite's map parameter s, 1 when
// absent.
func (q LoomRequest) wrap() float64 {
	if q.Wrap == nil {
		return 1
	}
	return *q.Wrap
}

// intermediate is the composite's first stage zⁿ at p, its provenance,
// unscaled by s; nil for every other map.
func (q LoomRequest) intermediate(p Vec) *Vec {
	if q.Map != "exp-power" {
		return nil
	}
	return loomPower(p, q.Degree)
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
		// F_s(z) = G_s(z): the source lies in the frame's domain exactly when
		// s·z lies in the window. The ends are evaluated explicitly: the
		// exponential at s = 1 and the identity at s = 0, where only the
		// power's fence (imageLimit) applies.
		s := q.wrap()
		if s == 0 {
			return point(p)
		}
		if !inExpWindow(Vec{s * p.X, s * p.Y}) {
			return nil
		}
		if s == 1 {
			return loomExp(p)
		}
		return loomWrap(p, s)
	case "exp-power":
		// G_s applied to the power map's own value: the source lies in the
		// frame's domain exactly when s·zⁿ lies in the window. The ends are
		// evaluated explicitly: the composite exp(zⁿ) at s = 1 and the power
		// map at s = 0, where the power's fence (imageLimit) applies.
		u := loomPower(p, q.Degree)
		s := q.wrap()
		if u == nil || s == 0 {
			return u
		}
		if !inExpWindow(Vec{s * u.X, s * u.Y}) {
			return nil
		}
		if s == 1 {
			return loomExp(*u)
		}
		return loomWrap(*u, s)
	case "fractional":
		f := q.mobius()
		if f.identity {
			return point(p)
		}
		if f.pole != nil && p.Sub(*f.pole).Norm() <= q.ExclusionRadius {
			return nil
		}
		z := complex(p.X, p.Y)
		w := (f.a*z + f.b) / (f.c*z + f.d)
		return point(Vec{real(w), imag(w)})
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

// loomWrap is G_s(u) = s + (e^{su} − 1)/s for 0 < s < 1, with v = su in the
// exponential's window. e^v − 1 is formed without cancellation, as
// (expm1(x) cos y − 2 sin²(y/2), eˣ sin y) for v = x + iy, so its error stays
// a few roundings of |e^v − 1| however small v is, and dividing by a small s
// loses nothing more. G_s′(u) = e^{su} never vanishes, G_s(0) = s exactly,
// G_s → u as s → 0 and G_1(u) = eᵘ. Where v is so small that the product s·u
// may be subnormal, and so inexact, G_s(u) = s + u(1 + v/2 + …) is s + u to
// working precision.
func loomWrap(u Vec, s float64) *Vec {
	v := Vec{s * u.X, s * u.Y}
	if math.Abs(v.X) < 0x1p-1000 && math.Abs(v.Y) < 0x1p-1000 {
		return point(Vec{s + u.X, u.Y})
	}
	sin, cos := math.Sincos(v.Y)
	half := math.Sin(v.Y / 2)
	return point(Vec{s + (math.Expm1(v.X)*cos-2*half*half)/s, math.Exp(v.X) * sin / s})
}

func inExpWindow(p Vec) bool {
	return math.Abs(p.X) <= LoomExpRealLimit && math.Abs(p.Y) <= LoomExpImagLimit
}

// windowDistance is the distance from u to the exponential's closed window,
// zero inside it.
func windowDistance(u Vec) float64 {
	return math.Hypot(max(0, math.Abs(u.X)-LoomExpRealLimit), max(0, math.Abs(u.Y)-LoomExpImagLimit))
}

// mayEnter reports whether the segment of an analytic member from a to b,
// clipped by the composite's frame G_s(zⁿ) at both ends, may still pass
// through its domain, so that it must be bisected rather than settled as a
// gap. A grid line or circle has known speed |z′| and a bound M on |z| over
// the segment, so the scaled intermediate s·zⁿ moves at most
// L = s n Mⁿ⁻¹ |z′| per unit parameter. Any
// point of the window is at least each end's distance from that end's
// intermediate, so the segment certainly stays outside when those distances
// sum to more than L times its length. Selected curves have no such bound
// and use the ordinary finite checks.
func (q LoomRequest) mayEnter(id int, c loomCurve, a, b loomNode) bool {
	s := q.Source
	// At s = 0 the window admits every finite power; only the power's fence,
	// which no family reaches, can clip.
	if q.Map != "exp-power" || q.wrap() == 0 || c.reference || s.Kind == "curve" || a.p == nil || b.p == nil || a.reason != "clipped" || b.reason != "clipped" {
		return false
	}
	ua, ub := q.periodic(*a.p), q.periodic(*b.p)
	if ua == nil || ub == nil {
		// Unreachable for families, which lie far inside the power's range.
		return false
	}
	length := b.t - a.t
	// |z| is largest at an end of the segment: it is convex along a line,
	// constant on a concentric circle, and 2r|cos(θ/2)| on a rotated circle,
	// which falls to zero at θ = π and rises again.
	speed, bound := 1.0, max(a.p.Norm(), b.p.Norm())
	switch s.Kind {
	case "concentric":
		speed = s.Radius * float64(id+1) / float64(s.Count)
		bound = speed
	case "rosette":
		speed = s.Radius
	}
	n := float64(q.Degree)
	// The window bounds s·zⁿ, which moves s times as fast.
	reach := n * math.Pow(bound, n-1) * speed * length * q.wrap()
	// Allow for the rounding of the computed points and their powers.
	return windowDistance(*ua)+windowDistance(*ub)-1e-12*(ua.Norm()+ub.Norm()) <= reach*(1+1e-12)
}

// loomExp is e^x (cos y, sin y), without the window: an exact crossing of
// the closed window is drawn even when rounding puts its source just outside.
func loomExp(p Vec) *Vec {
	r := math.Exp(p.X)
	return point(Vec{r * math.Cos(p.Y), r * math.Sin(p.Y)})
}

// edge is the exponential frame's image at an exact crossing of its scaled
// window (windowCuts), evaluated without the window, which rounding may put
// the source just outside: eᶻ itself at s = 1, otherwise F_s. No fence is
// needed: a grid or circle, within |z| ≤ 2·10⁶, reaches the scaled edge
// ln 10⁸/s only for s above 10⁻⁵, where |F_s| ≤ s + (10⁸ + 1)/s < 10¹⁴.
func (q LoomRequest) edge(p Vec) *Vec {
	if s := q.wrap(); s != 1 {
		return loomWrap(p, s)
	}
	return loomExp(p)
}

// translates lists the other source points in the map's domain with the same
// image as p, which the exponential's period creates. Under the exponential's
// frame F_s they are its translates z + 2πik/s, k ≠ 0, with s·z in the
// window and within the fence, at most eight; none at s = 0. Under the
// composite's frame G_s(zⁿ) they are every z′ with z′ⁿ = zⁿ + 2πik/s and
// s·z′ⁿ in the window: first the turns z e^{2πij/n}, j = 1 … n − 1, then,
// for each k ≠ 0 in order, the n-th roots of zⁿ + 2πik/s within the power's
// fence, at most 9n − 1 points in all. At s = 0 only the turns remain.
func (q LoomRequest) translates(p Vec) []Vec {
	u := q.periodic(p)
	if u == nil || !inExpWindow(*u) || q.image(p) == nil {
		return nil
	}
	var out []Vec
	n := 1
	if q.Map == "exp-power" {
		n = q.Degree
		// Zero is its own turns.
		if p.X != 0 || p.Y != 0 {
			for j := 1; j < n; j++ {
				s, c := math.Sincos(2 * math.Pi * float64(j) / float64(n))
				out = append(out, Vec{p.X*c - p.Y*s, p.X*s + p.Y*c})
			}
		}
	}
	s := q.wrap()
	if s == 0 {
		return out
	}
	lo := int(math.Ceil((-LoomExpImagLimit - u.Y) / (2 * math.Pi)))
	hi := int(math.Floor((LoomExpImagLimit - u.Y) / (2 * math.Pi)))
	for k := lo; k <= hi; k++ {
		y := u.Y + 2*math.Pi*float64(k)
		if k == 0 || math.Abs(y) > LoomExpImagLimit {
			continue
		}
		if n == 1 {
			// At s = 1 this is p + 2πik, u being p itself.
			z := Vec{p.X, p.Y + 2*math.Pi*float64(k)/s}
			if z.Norm() <= LoomPowerImageLimit {
				out = append(out, z)
			}
			continue
		}
		// The root's target is zⁿ + 2πik/s; at s = 1 it is the window
		// point itself, as computed.
		v := complex(u.X, y)
		if s != 1 {
			z := loomPower(p, n)
			v = complex(z.X, z.Y+2*math.Pi*float64(k)/s)
			if cmplx.Abs(v) > LoomPowerImageLimit {
				continue
			}
		}
		if v == 0 {
			// The n-fold root of zero is one point.
			out = append(out, Vec{})
			continue
		}
		r, phase := math.Pow(cmplx.Abs(v), 1/float64(n)), cmplx.Phase(v)
		for j := 0; j < n; j++ {
			s, c := math.Sincos((phase + 2*math.Pi*float64(j)) / float64(n))
			out = append(out, Vec{r * c, r * s})
		}
	}
	return out
}

// windowCuts are the parameters where an analytic member crosses the
// exponential frame's window, scaled by 1/s, inserted as pilot samples so
// that the boundary is drawn exactly and an arc narrower than the pilot
// spacing is not missed. Selected curves use one-sided bisection instead. At
// s = 0 nothing is clipped; where the scaled edges overflow, their infinite
// crossings lie outside every member's interval.
func (q LoomRequest) windowCuts(id int) []float64 {
	if q.Map != "exp" || q.Source.Kind == "curve" || q.wrap() == 0 {
		return nil
	}
	X, Y := LoomExpRealLimit, LoomExpImagLimit
	if s := q.wrap(); s != 1 {
		X, Y = X/s, Y/s
	}
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
	// The point at angle φ = θ + phase is center + radius·e^{iφ}. A circle
	// also meets the lines through the edges beyond the window's corners;
	// only crossings on the closed edges themselves are kept, allowing the
	// rounding of the crossing's other coordinate.
	var out []float64
	slack := 1e-15 * (radius + math.Abs(center.X) + math.Abs(center.Y))
	wrap := func(phi, along, limit float64) {
		if math.Abs(along) > limit+slack {
			return
		}
		t := math.Mod(phi-phase, 2*math.Pi)
		if t < 0 {
			t += 2 * math.Pi
		}
		out = append(out, t)
	}
	for _, edge := range []float64{-X, X} {
		if c := (edge - center.X) / radius; math.Abs(c) <= 1 {
			for _, phi := range []float64{math.Acos(c), -math.Acos(c)} {
				wrap(phi, center.Y+radius*math.Sin(phi), Y)
			}
		}
	}
	for _, edge := range []float64{-Y, Y} {
		if v := (edge - center.Y) / radius; math.Abs(v) <= 1 {
			for _, phi := range []float64{math.Asin(v), math.Pi - math.Asin(v)} {
				wrap(phi, center.X+radius*math.Cos(phi), X)
			}
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
	if q.Map == "exp" || q.Map == "exp-power" {
		// Probes a whole period apart agree in the image; a chord whose
		// periodic points (the source under the exponential, s·zⁿ under the
		// composite's frame), with their measured deviation, span more than a
		// quarter period must subdivide even when its image probes lie along
		// it. Every node here is drawn, so its periodic point is finite.
		pa, pb := q.periodic(a), q.periodic(b)
		deviation := 0.0
		for _, n := range probes {
			deviation = math.Max(deviation, plane.Distance(*q.periodic(*n.p), *pa, *pb))
		}
		return pb.Sub(*pa).Norm()+2*deviation <= 2*loomExpPilotStep
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
	// (zⁿ)′ = n zⁿ⁻¹ vanishes only at zero, a finite drawable point. The
	// composite's frame has derivative n zⁿ⁻¹ e^{s zⁿ}, which inherits that
	// zero alone, since the exponential never vanishes.
	if q.Map == "square" || q.Map == "power" || q.Map == "exp-power" {
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

// A general Möbius map's coefficients are refused beyond this conditioning
// ratio, (|a|² + |b|² + |c|² + |d|²)/(2|ad − bc|).
const LoomMobiusConditioning = 1e6

func (c *LoomCoefficients) components() [4]complex128 {
	return [4]complex128{complex(c.A.X, c.A.Y), complex(c.B.X, c.B.Y), complex(c.C.X, c.C.Y), complex(c.D.X, c.D.Y)}
}

// normalized divides the coefficients by the power of two at their largest
// component, which is exact and leaves the map unchanged; zero stays zero.
func (c *LoomCoefficients) normalized() [4]complex128 {
	m := c.components()
	largest := 0.0
	for _, v := range m {
		largest = max(largest, math.Abs(real(v)), math.Abs(imag(v)))
	}
	if largest == 0 {
		return m
	}
	_, e := math.Frexp(largest)
	for i, v := range m {
		m[i] = complex(math.Ldexp(real(v), -e), math.Ldexp(imag(v), -e))
	}
	return m
}

func (c *LoomCoefficients) validate() error {
	if c == nil {
		return fieldErr("coefficients", "enter the coefficients a, b, c and d")
	}
	for _, f := range []struct {
		path, name string
		v          float64
	}{{"a.x", "Re a", c.A.X}, {"a.y", "Im a", c.A.Y}, {"b.x", "Re b", c.B.X}, {"b.y", "Im b", c.B.Y}, {"c.x", "Re c", c.C.X}, {"c.y", "Im c", c.C.Y}, {"d.x", "Re d", c.D.X}, {"d.y", "Im d", c.D.Y}} {
		if !finite(f.v) || math.Abs(f.v) > 1e6 {
			return fieldErr("coefficients."+f.path, "%s must be within ±1000000", f.name)
		}
	}
	m := c.normalized()
	size := 0.0
	for _, v := range m {
		size += real(v)*real(v) + imag(v)*imag(v)
	}
	// Also refuses all zero (0/0) and ad − bc = 0, a constant map.
	if size == 0 || !(size <= 2*LoomMobiusConditioning*cmplx.Abs(m[0]*m[3]-m[1]*m[2])) {
		return fieldErr("coefficients", "the coefficients are too nearly degenerate: |ad − bc| must be at least (|a|² + |b|² + |c|² + |d|²)/2000000")
	}
	return nil
}

// loomMobius is one frame Mˢ of the general Möbius map's flow.
type loomMobius struct {
	a, b, c, d complex128
	identity   bool
	pole       *Vec
}

// mobius returns the frame prepared for this request, or prepares it.
func (q LoomRequest) mobius() *loomMobius {
	if q.flow != nil {
		return q.flow
	}
	return q.Coefficients.flow(q.MapParameter)
}

// positive chooses between N and −N, which are one map, by the sign of the
// first nonzero value: Re tr N > 0 puts the flow on the principal branch.
// A trace with zero real part lies on its cut, where a turn by π either
// way reaches the map; the rest of N then picks the way, so the choice
// depends on the map alone, not on how its coefficients were scaled.
func positive(values ...complex128) bool {
	for _, v := range values {
		for _, x := range []float64{real(v), imag(v)} {
			if x != 0 {
				return x > 0
			}
		}
	}
	return true
}

// flow is Mˢ for validated coefficients and −1 ≤ s ≤ 1: exactly the
// identity at s = 0 and for a scalar matrix, the normalized entered map at
// s = 1, and otherwise exp(s log N) for N = M/√(ad − bc), with the sign of
// N chosen so that Re tr N ≥ 0 (positive). With cosh μ = tr N / 2 (the
// principal acosh, so |Im μ| ≤ π/2),
//
//	Nˢ = cosh(sμ) I + (sinh(sμ)/sinh μ)(N − cosh μ I).
//
// The flow keeps the fixed points, keeps c = 0 (an affine map stays
// affine), reaches the inverse at s = −1 and never worsens conditioning.
func (c *LoomCoefficients) flow(s float64) *loomMobius {
	m := c.normalized()
	f := &loomMobius{a: m[0], b: m[1], c: m[2], d: m[3]}
	if s == 0 || m[1] == 0 && m[2] == 0 && m[0] == m[3] {
		f.identity = true
		return f
	}
	if s != 1 {
		r := cmplx.Sqrt(m[0]*m[3] - m[1]*m[2])
		a, b, cc, d := m[0]/r, m[1]/r, m[2]/r, m[3]/r
		tau := (a + d) / 2
		if !positive(tau, (a-d)/2, b, cc) {
			a, b, cc, d, tau = -a, -b, -cc, -d, -tau
		}
		// Both coefficients below are even in μ, so the sign acosh gives a
		// zero trace (±iπ/2) does not matter.
		mu := cmplx.Acosh(tau)
		sc := complex(s, 0)
		ratio := sc * (1 + (sc*sc-1)*mu*mu/6)
		if cmplx.Abs(mu) > 1e-4 {
			ratio = cmplx.Sinh(sc*mu) / cmplx.Sinh(mu)
		}
		ch, half := cmplx.Cosh(sc*mu), (a-d)/2
		f.a, f.b, f.c, f.d = ch+ratio*half, ratio*b, ratio*cc, ch-ratio*half
	}
	if f.c != 0 {
		p := -f.d / f.c
		f.pole = point(Vec{real(p), imag(p)})
	}
	return f
}
