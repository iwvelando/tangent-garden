package engine3

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"tangentgarden/engine/refine"
)

// The source bounds mirror planar fitting (engine.FourierCurveOutline). A spatial
// term has no planar sign: frequency k holds both turning directions in one
// ellipse. The band reaches half the samples' Nyquist limit, so a finite sum the
// outline can resolve comes back whole and no frequency below 768 aliases into it.
const (
	HarmonicFitSamples        = 1024
	HarmonicFitMaxPoints      = 4096
	HarmonicFitMaxEvaluations = 32768
	harmonicFitBand           = 256
	harmonicFitSweep          = 8192
	harmonicFitBisections     = 16
	// A coefficient component this far below the curve's size, or within a few
	// units of rounding of its largest coordinate, is rounding, and would
	// otherwise show as a term that moves, or a plane the source never left.
	harmonicFitNoise      = 1e-13
	harmonicFitCoordinate = 8 * 0x1p-52
)

// A fit's mathematical parameter, always 2πj/1024 at sample j: its sample j
// lies at j/1024 of the closed outline's length, or of the source's domain.
const (
	HarmonicFitArcLength = "arc-length"
	HarmonicFitSource    = "source"
)

const harmonicFitDiscontinuity = "source has a discontinuity or detail too fine to resolve; no discontinuity was joined"

// HarmonicOutline is a transient closed approximation of a source, in its own
// coordinates and traversal, from the first point back to it. Tolerance is the
// sampled chord deviation, not a certified continuous bound. Open marks a
// source whose ends are apart: its outline runs from the first point to the
// last, or, closed explicitly, on along a straight segment from the source's
// last point, at index Closing, back to the first.
type HarmonicOutline struct {
	Points           []Vec3  `json:"points"`
	Tolerance        float64 `json:"tolerance"`
	ClosureTolerance float64 `json:"closureTolerance"`
	Evaluations      int     `json:"evaluations"`
	Length           float64 `json:"length"`
	Extent           float64 `json:"extent"`
	Open             bool    `json:"open,omitempty"`
	Closing          int     `json:"closing,omitempty"`
}

// HarmonicOpenError refuses an open source that was not explicitly closed. It
// comes only after every source check, with the admitted outline, so the
// source can be shown as it is and closed by CloseHarmonicSource.
type HarmonicOpenError struct{ Outline HarmonicOutline }

func (e *HarmonicOpenError) Error() string {
	return "source is open: its ends are apart; Close outline joins them with a straight segment"
}

// HarmonicFit retains one source's closed outline, its 1024 samples and its
// ranked projection. Selection never reorders the projection.
type HarmonicFit struct {
	parameter string
	outline   HarmonicOutline
	samples   []Vec3
	center    Vec3
	terms     []HarmonicTerm // Ranked and nonzero.
	scale     float64
	joined    float64 // The closing segment's length, if any.
}

// HarmonicEllipse is what one term actually traces about its joint: a turning
// vector on an ellipse in the plane of A and B, with semi-axes Major ≥ Minor
// and the unit normal A × B, or zero for a segment. It is a circle only when
// the axes agree, and the planes of different terms need not agree.
type HarmonicEllipse struct {
	Major  float64 `json:"major"`
	Minor  float64 `json:"minor"`
	Normal Vec3    `json:"normal"`
}

// HarmonicFitResult is one prefix of the ranking. RMS and MaxResidual compare
// the fit at 2πj/1024 with sample j, in model units, so MaxResidual also bounds
// how far any sampled fit point is from the source and any sample from the fit.
// ContinuousBound, for an arc-length fit, is a proved bound on the distance from
// the fit to the outline polygon at every matching parameter, not to the
// analytic source; zero means no such bound applies.
type HarmonicFitResult struct {
	Curve           HarmonicCurve     `json:"curve"`
	Bounds          Bounds            `json:"bounds"`
	Ellipses        []HarmonicEllipse `json:"ellipses"`
	Parameter       string            `json:"parameter"`
	Available       int               `json:"available"`
	RMS             float64           `json:"rms"`
	MaxResidual     float64           `json:"maxResidual"`
	ContinuousBound float64           `json:"continuousBound,omitempty"`
	Length          float64           `json:"length"`
	Extent          float64           `json:"extent"`
	Tolerance       float64           `json:"tolerance"`
	Evaluations     int               `json:"evaluations"`
	Joined          float64           `json:"joined,omitempty"`
}

// FitHarmonicSource fits one direct closed base curve: a torus knot, an
// expression curve or a harmonic study. It uses only positions, so corners and
// cusps are admitted; it never joins a gap or closes an open path, refusing
// one with HarmonicOpenError.
func FitHarmonicSource(c Request, parameter string) (*HarmonicFit, error) {
	return fitHarmonicSource(c, parameter, false)
}

// CloseHarmonicSource fits a source as FitHarmonicSource does, except that an
// open one is closed explicitly by the straight segment from its last point to
// its first. A source whose ends meet gains nothing and fits identically.
func CloseHarmonicSource(c Request, parameter string) (*HarmonicFit, error) {
	return fitHarmonicSource(c, parameter, true)
}

func fitHarmonicSource(c Request, parameter string, close bool) (*HarmonicFit, error) {
	if parameter != HarmonicFitArcLength && parameter != HarmonicFitSource {
		return nil, fmt.Errorf("choose arc-length or source parameterization")
	}
	switch c.Format {
	case "", "torus", "parametric", "harmonic":
	default:
		return nil, fmt.Errorf("use a torus knot, expression or harmonic curve; this source is unavailable")
	}
	if c.Input != "" && c.Input != "base" {
		return nil, fmt.Errorf("build on the base curve, not a derived input")
	}
	base, lo, hi, _, err := compile(c, nil)
	if err != nil {
		return nil, err
	}
	at := c.position(base)
	outline, eval, failure, err := harmonicOutline(at, lo, hi)
	if err != nil {
		return nil, err
	}
	// The segment takes the source's mean pace over its domain, so either
	// sampling gives it its share of the closed length, and none of its
	// samples is an evaluation.
	share, joined := 0.0, 0.0
	if outline.Open {
		if !close {
			return nil, &HarmonicOpenError{Outline: outline}
		}
		end, start := outline.Points[len(outline.Points)-1], outline.Points[0]
		joined = start.sub(end).norm()
		share = joined / outline.Length
		outline.Closing = len(outline.Points) - 1
		outline.Points = append(outline.Points, start)
		outline.Length += joined
	}
	var samples []Vec3
	if parameter == HarmonicFitArcLength {
		samples = arcLengthSamples(outline.Points, outline.Length)
	} else {
		samples = make([]Vec3, HarmonicFitSamples)
		end, start := outline.Points[outline.Closing], outline.Points[0]
		for j := range samples {
			u := (1 + share) * float64(j) / HarmonicFitSamples
			if u > 1 {
				samples[j] = end.add(start.sub(end).mul((u - 1) / share))
				continue
			}
			p := eval(lo + (hi-lo)*u)
			if *failure != nil {
				return nil, *failure
			}
			samples[j] = *p
			outline.Evaluations++
		}
	}
	f, err := fitHarmonicSamples(samples, parameter, outline)
	if err != nil {
		return nil, err
	}
	f.joined = joined
	return f, nil
}

// harmonicOutline samples a source by the planar procedure, on the same
// bounds: seeds, endpoint closure, refinement, a continuity sweep for what a
// chord cannot see, and an off-grid audit.
func harmonicOutline(at func(float64) Vec3, lo, hi float64) (HarmonicOutline, func(float64) *Vec3, *error, error) {
	out := HarmonicOutline{}
	failure := new(error)
	eval := func(t float64) *Vec3 {
		if *failure != nil {
			return nil
		}
		if out.Evaluations == HarmonicFitMaxEvaluations {
			*failure = fmt.Errorf("source approximation could not be resolved within 32768 evaluations")
			return nil
		}
		out.Evaluations++
		p := at(t)
		if !p.valid() {
			*failure = fmt.Errorf("source contains a gap or nonfinite interval; choose a continuous curve")
			return nil
		}
		if math.Abs(p.X) > 1e5 || math.Abs(p.Y) > 1e5 || math.Abs(p.Z) > 1e5 {
			*failure = fmt.Errorf("source coordinates must be within ±100000")
			return nil
		}
		return &p
	}
	stop := func(err error) (HarmonicOutline, func(float64) *Vec3, *error, error) {
		return out, eval, failure, err
	}
	param := func(u float64) float64 { return lo*(1-u) + hi*u }
	const intervals = 256
	points := make([]*Vec3, intervals+1)
	var low, high Vec3
	magnitude := 0.0
	for j := range points {
		p := eval(param(float64(j) / intervals))
		if *failure != nil {
			return stop(*failure)
		}
		points[j] = p
		if j == 0 {
			low, high = *p, *p
		}
		low = Vec3{math.Min(low.X, p.X), math.Min(low.Y, p.Y), math.Min(low.Z, p.Z)}
		high = Vec3{math.Max(high.X, p.X), math.Max(high.Y, p.Y), math.Max(high.Z, p.Z)}
		magnitude = math.Max(magnitude, math.Max(math.Abs(p.X), math.Max(math.Abs(p.Y), math.Abs(p.Z))))
	}
	extent := high.sub(low).norm()
	if extent == 0 {
		return stop(fmt.Errorf("source has zero or near-zero length; use a curve at least 0.000001 long"))
	}
	h := (hi - lo) * 1e-6
	pa, pb := eval(lo+h), eval(hi-h)
	if *failure != nil {
		return stop(*failure)
	}
	speed := math.Max(pa.sub(*points[0]).norm(), pb.sub(*points[intervals]).norm()) / h
	out.ClosureTolerance = 32 * 0x1p-52 * (math.Max(extent, magnitude) + speed*math.Max(math.Abs(lo), math.Max(math.Abs(hi), hi-lo)))
	if out.ClosureTolerance > 1e-6*extent {
		return stop(fmt.Errorf("source precision cannot resolve endpoint closure at this coordinate or parameter scale"))
	}
	// An open source is admitted like a closed one, leaving room for the
	// point an explicit close adds; joining is the caller's decision.
	out.Open = points[0].sub(*points[intervals]).norm() > out.ClosureTolerance
	room := HarmonicFitMaxPoints - len(points)
	if out.Open {
		room--
	}
	out.Extent = extent
	out.Tolerance = 1e-4 * extent
	path, _ := refine.RefineFocused(points, make([]bool, len(points)), eval, space, lo, hi, out.Tolerance, room, refine.Focus[Vec3]{
		Tolerance: out.Tolerance / 2, Chord: extent / 32,
		Meets: func([]*Vec3, float64) bool { return true },
	})
	if *failure != nil {
		return stop(*failure)
	}
	if path.Exhausted {
		return stop(fmt.Errorf("source approximation could not be resolved within 4096 outline points; simplify the curve or shorten its domain"))
	}
	if path.Unresolved > 0 || path.Breaks > 0 {
		return stop(fmt.Errorf(harmonicFitDiscontinuity))
	}
	length := 0.0
	for j := 1; j < len(path.Points); j++ {
		a, b := path.Points[j-1], path.Points[j]
		if a == nil || b == nil {
			return stop(fmt.Errorf("source contains a gap; no discontinuity was joined"))
		}
		length += b.sub(*a).norm()
	}
	if length < 1e-6 {
		return stop(fmt.Errorf("source has zero or near-zero length; use a curve at least 0.000001 long"))
	}
	// Probes either side of a jump lie on its chord, so deviation from a chord
	// cannot see one: see engine.FourierCurveOutline.
	long := math.Max(out.Tolerance, 2*length/harmonicFitSweep)
	previous := points[0]
	for j := 1; j <= harmonicFitSweep; j++ {
		a0, b0 := param(float64(j-1)/harmonicFitSweep), param(float64(j)/harmonicFitSweep)
		next := eval(b0)
		if *failure != nil {
			return stop(*failure)
		}
		a, b := previous, next
		step := b.sub(*a).norm()
		for level := 0; step > long && b.sub(*a).norm() > step/2; level++ {
			if level == harmonicFitBisections {
				return stop(fmt.Errorf(harmonicFitDiscontinuity))
			}
			mid := (a0 + b0) / 2
			m := eval(mid)
			if *failure != nil {
				return stop(*failure)
			}
			if m.sub(*a).norm() >= b.sub(*m).norm() {
				b0, b = mid, m
			} else {
				a0, a = mid, m
			}
		}
		previous = next
	}
	edge := 0
	for j := 0; j < 1021; j++ {
		u := (float64(j) + .3819660112501051) / 1021
		for edge+1 < len(path.At)-1 && path.At[edge+1] < u*intervals {
			edge++
		}
		p := eval(param(u))
		if *failure != nil {
			return stop(*failure)
		}
		if segmentDistance(*p, *path.Points[edge], *path.Points[edge+1]) > out.Tolerance {
			return stop(fmt.Errorf("source approximation could not be resolved by the off-grid sampling audit"))
		}
	}
	out.Points = make([]Vec3, len(path.Points))
	for j, p := range path.Points {
		out.Points[j] = *p
	}
	// Only rounding-sized endpoint disagreement reaches here closed.
	if !out.Open {
		out.Points[len(out.Points)-1] = out.Points[0]
	}
	out.Length = 0
	for j := 1; j < len(out.Points); j++ {
		out.Length += out.Points[j].sub(out.Points[j-1]).norm()
	}
	return out, eval, failure, nil
}

// arcLengthSamples divides a closed polygon, whose last point is its first,
// into 1024 equal lengths from its first point.
func arcLengthSamples(path []Vec3, total float64) []Vec3 {
	samples := make([]Vec3, HarmonicFitSamples)
	edge, walked := 0, 0.0
	for j := range samples {
		s := total * float64(j) / HarmonicFitSamples
		for edge < len(path)-2 {
			step := path[edge+1].sub(path[edge]).norm()
			if walked+step > s {
				break
			}
			walked += step
			edge++
		}
		step := path[edge+1].sub(path[edge]).norm()
		u := 0.0
		if step > 0 {
			u = (s - walked) / step
		}
		samples[j] = path[edge].add(path[edge+1].sub(path[edge]).mul(u))
	}
	return samples
}

// fitHarmonicSamples projects equally parameter-spaced samples onto real
// vector terms. The modes are orthogonal on this grid, so each coefficient is
// independent of which others are kept. Subtracting the first sample protects
// a small curve far from the origin; its translation returns only in c₀.
func fitHarmonicSamples(samples []Vec3, parameter string, outline HarmonicOutline) (*HarmonicFit, error) {
	f := &HarmonicFit{parameter: parameter, outline: outline, samples: samples}
	origin := samples[0]
	var mean Vec3
	magnitude := 0.0
	for _, p := range samples {
		q := p.sub(origin)
		f.scale = math.Max(f.scale, q.norm())
		mean = mean.add(q)
		magnitude = math.Max(magnitude, math.Max(math.Abs(p.X), math.Max(math.Abs(p.Y), math.Abs(p.Z))))
	}
	n := float64(len(samples))
	floor := math.Max(harmonicFitNoise*f.scale, harmonicFitCoordinate*magnitude)
	f.center = origin.add(mean.mul(1 / n))
	f.center = Vec3{harmonicFitShorten(f.center.X, floor), harmonicFitShorten(f.center.Y, floor), harmonicFitShorten(f.center.Z, floor)}
	if !harmonicFitBounded(f.center) {
		return nil, fmt.Errorf("the fitted center exceeds 100000; move the source nearer the origin")
	}
	clean := func(v Vec3) Vec3 {
		return Vec3{harmonicFitShorten(v.X, floor), harmonicFitShorten(v.Y, floor), harmonicFitShorten(v.Z, floor)}
	}
	for k := 1; k <= harmonicFitBand; k++ {
		var a, b Vec3
		for j, p := range samples {
			s, c := math.Sincos(2 * math.Pi * float64(k) * float64(j) / n)
			q := p.sub(origin)
			a = a.add(q.mul(c))
			b = b.add(q.mul(s))
		}
		term := HarmonicTerm{Frequency: float64(k), Cosine: clean(a.mul(2 / n)), Sine: clean(b.mul(2 / n))}
		if term.moves() {
			f.terms = append(f.terms, term)
		}
	}
	rankHarmonicTerms(f.terms)
	if len(f.terms) == 0 {
		return nil, fmt.Errorf("the source has no usable moving term within frequency 256")
	}
	return f, nil
}

// rankHarmonicTerms orders terms by energy, |A|² + |B|², which an orthogonal
// change of coordinates, a uniform scale, a translation, a start shift and a
// reversal all leave in order. Energies equal to within 1e-12 of the largest
// are ties, won by the smaller frequency, so rounding on either side of a true
// tie does not reorder them between processors.
func rankHarmonicTerms(terms []HarmonicTerm) {
	reach := func(t HarmonicTerm) float64 { return math.Sqrt(t.Cosine.dot(t.Cosine) + t.Sine.dot(t.Sine)) }
	largest := 0.0
	for _, t := range terms {
		largest = math.Max(largest, reach(t))
	}
	band := func(t HarmonicTerm) float64 { return math.Round(reach(t) / (largest * 1e-12)) }
	sort.SliceStable(terms, func(i, j int) bool {
		a, b := band(terms[i]), band(terms[j])
		if a != b {
			return a > b
		}
		return terms[i].Frequency < terms[j].Frequency
	})
}

// harmonicFitShorten removes the rounding tail from a generated coefficient:
// the value with the fewest significant digits within budget of it, or zero.
// Only rounding is within budget, so a fitted value keeps its real digits and
// an exact 0.75 does not arrive as 0.7499999999999999 in an editable field.
func harmonicFitShorten(v, budget float64) float64 {
	if math.Abs(v) <= budget {
		return 0
	}
	for digits := 1; digits < 17; digits++ {
		short, err := strconv.ParseFloat(strconv.FormatFloat(v, 'e', digits-1, 64), 64)
		if err == nil && math.Abs(short-v) <= budget {
			return short
		}
	}
	return v
}

func harmonicFitBounded(v Vec3) bool {
	return math.Abs(v.X) <= 1e5 && math.Abs(v.Y) <= 1e5 && math.Abs(v.Z) <= 1e5
}

// Available is how many terms the source offers within the eight-term budget.
func (f *HarmonicFit) Available() int { return min(len(f.terms), maxHarmonicTerms) }

// Outline is the source's closed polygon, for a transient comparison.
func (f *HarmonicFit) Outline() HarmonicOutline { return f.outline }

// Bounds holds the outline and every joint of the chain, which are the points of
// every prefix's curve, on a parameter grid fine enough for frequency 64 to
// within the frame's margin. Choosing terms or playing never needs a new frame.
func (f *HarmonicFit) Bounds() Bounds {
	radius := 0.0
	for _, p := range f.outline.Points {
		radius = math.Max(radius, p.sub(f.center).norm())
	}
	terms := f.terms[:f.Available()]
	for j := 0; j < HarmonicFitSamples; j++ {
		w := 2 * math.Pi * float64(j) / HarmonicFitSamples
		joint := Vec3{}
		for _, term := range terms {
			joint = joint.add(term.at(w))
			radius = math.Max(radius, joint.norm())
		}
	}
	return Bounds{Center: f.center, Radius: radius}
}

// Select returns the first count ranked terms as an ordinary closed study on
// 0..2π, and the fit's error. A count beyond what the source offers returns
// what it offers: the rest are zero, and a study has no use for them.
func (f *HarmonicFit) Select(count int) (HarmonicFitResult, error) {
	if count < 1 || count > maxHarmonicTerms {
		return HarmonicFitResult{}, fmt.Errorf("choose 1–8 terms")
	}
	count = min(count, len(f.terms))
	terms := append([]HarmonicTerm(nil), f.terms[:count]...)
	curve := HarmonicCurve{Center: f.center, Terms: terms, Min: 0, Max: 2 * math.Pi}
	if err := curve.validate(); err != nil {
		return HarmonicFitResult{}, fmt.Errorf("a fitted vector exceeds 100000; move the source nearer the origin or make it smaller")
	}
	r := HarmonicFitResult{
		Curve: curve, Bounds: f.Bounds(), Parameter: f.parameter, Available: f.Available(),
		Length: f.outline.Length, Extent: f.outline.Extent, Tolerance: f.outline.Tolerance,
		Evaluations: f.outline.Evaluations, Joined: f.joined,
	}
	n := len(f.samples)
	sum, reach := 0.0, 0.0
	for j, p := range f.samples {
		at := curve.Center
		w := 2 * math.Pi * float64(j) / float64(n)
		for _, term := range terms {
			at = at.add(term.at(w))
		}
		e := at.sub(p).norm()
		sum += e * e
		r.MaxResidual = math.Max(r.MaxResidual, e)
	}
	r.RMS = math.Sqrt(sum / float64(n))
	for _, term := range terms {
		reach += math.Abs(term.Frequency) * (term.Cosine.norm() + term.Sine.norm())
		r.Ellipses = append(r.Ellipses, harmonicEllipse(term))
	}
	if f.parameter == HarmonicFitArcLength {
		// Between neighboring samples the fit moves at most |Δt| Σ|ω|(|A|+|B|)
		// and the unit-speed polygon at most its arc length: half a step each.
		r.ContinuousBound = r.MaxResidual + math.Pi/float64(n)*reach + f.outline.Length/(2*float64(n))
	}
	return r, nil
}

// harmonicEllipse takes the semi-axes from the Gram matrix of A and B, whose
// eigenvalues are the squared semi-axes of A cos θ + B sin θ.
func harmonicEllipse(t HarmonicTerm) HarmonicEllipse {
	aa, bb, ab := t.Cosine.dot(t.Cosine), t.Sine.dot(t.Sine), t.Cosine.dot(t.Sine)
	mean, gap := (aa+bb)/2, math.Hypot((aa-bb)/2, ab)
	e := HarmonicEllipse{Major: math.Sqrt(mean + gap)}
	// The smaller eigenvalue from the determinant: subtracting the two large
	// ones loses a thin ellipse to rounding.
	if e.Major > 0 {
		e.Minor = math.Sqrt(math.Max(0, (aa*bb-ab*ab)/(mean+gap)))
	}
	if n := t.Cosine.cross(t.Sine); n.norm() > 1e-12*(aa+bb) {
		e.Normal = n.mul(1 / n.norm())
	}
	return e
}
