package engine3

import (
	"encoding/json"
	"errors"
	"math"
	"sync"
)

// The curve probe between samples: the curve a construction acts on
// described at any parameter of its domain, not only at a sample, with the
// construction's points there. The per-sample diagnostics and this share
// one description (describe), and each construction is evaluated by the
// function refinement evaluates it with, so a probe at a sample reads what
// the sample's diagnostics do, and its construction lies within rounding of
// the sample's.

// ProbeQuery places the probe: at the parameter T, or where the drawn arc
// length from the first sample is Share of the whole. Exactly one is set.
// The notebook makes it from the probe's place; it is never typed, so it is
// refused rather than named as a field when malformed.
type ProbeQuery struct {
	T     *float64 `json:"t,omitempty"`
	Share *float64 `json:"share,omitempty"`
}

// ProbePoint describes the curve the construction acts on (the base, or its
// derived input) at the parameter T as DiagnosticsResult does at a sample:
// its point, Frenet frame, curvature, torsion and osculating centre, each
// null where the sample would be, and the drawn arc length to it, the
// length at the last sample at or before T continued over the rest of the
// way by Simpson's rule on the speed at its ends and midpoint. On a closed
// curve the end of the domain is described as its start, as its last
// sample repeats its first, at the whole length.
//
// The construction's points at T are those the probe highlights, as the
// result holds them at a sample, each absent where the construction has no
// point there: the tangent developable's ruling or the framed ribbon's
// cross-line from Minus to Plus, the ruled surface's partner at Plus, a
// tangent projection's Foot and Image, the inversion's Source and Image,
// and the involute construction's Members, indexed like its members (null
// where unreached). Chain is a harmonic curve's chain of generating
// vectors at T, whose SampleIndex is the sample at or before T.
type ProbePoint struct {
	T         float64           `json:"t"`
	Point     *Vec3             `json:"point"`
	Tangent   *Vec3             `json:"tangent"`
	Normal    *Vec3             `json:"normal"`
	Binormal  *Vec3             `json:"binormal"`
	Center    *Vec3             `json:"center"`
	Curvature *float64          `json:"curvature"`
	Torsion   *float64          `json:"torsion"`
	Length    *float64          `json:"length"`
	Minus     *Vec3             `json:"minus,omitempty"`
	Plus      *Vec3             `json:"plus,omitempty"`
	Foot      *Vec3             `json:"foot,omitempty"`
	Source    *Vec3             `json:"source,omitempty"`
	Image     *Vec3             `json:"image,omitempty"`
	Members   []*Vec3           `json:"members,omitempty"`
	Chain     *HarmonicPosition `json:"chain,omitempty"`
}

// errProbe refuses a probe on a study it cannot evaluate at any parameter.
var errProbe = errors.New("the probe stands between samples only on a curve evaluated at any parameter: a torus knot, harmonic or custom curve, not a trajectory, a pursuit or a surface")

// probedAnywhere reports whether a study's curve is evaluated at any
// parameter: not integrated step by step, and not a surface.
func (c Request) probedAnywhere() bool {
	switch c.Format {
	case "", "torus", "harmonic", "parametric":
		return true
	}
	return false
}

// checkProbe refuses a malformed probe query on the domain [lo, hi].
func checkProbe(at ProbeQuery, lo, hi float64) error {
	switch {
	case (at.T == nil) == (at.Share == nil):
		return errors.New("the probe needs either a parameter or a share of the length")
	case at.T != nil && !(*at.T >= lo && *at.T <= hi):
		return errors.New("the probe's parameter lies outside the domain")
	case at.Share != nil && !(*at.Share >= 0 && *at.Share <= 1):
		return errors.New("the probe's share of the length lies outside 0 to 1")
	}
	return nil
}

// probing holds what a computed study needs to place its probe: the curve
// the construction acts on and its r‴, the domain and its samples, and the
// construction's points at a parameter (nil where nothing is highlighted),
// given the curve's point and unit tangent there.
type probing struct {
	c         Request
	evaluate  evaluation
	third     func(float64, Vec3) (Vec3, bool)
	lo, hi    float64
	closed    bool
	construct func(t float64, r, tangent Vec3, at *ProbePoint)
}

// knot is sample i's parameter, as the sampling loop places it.
func (p *probing) knot(i int) float64 {
	n := float64(p.c.Samples)
	return p.lo*(1-float64(i)/n) + p.hi*float64(i)/n
}

// sampleBefore is the last sample at or before t.
func (p *probing) sampleBefore(t float64) int {
	n := p.c.Samples
	j := max(0, min(n, int(math.Floor((t-p.lo)/(p.hi-p.lo)*float64(n)))))
	for j > 0 && p.knot(j) > t {
		j--
	}
	for j < n && p.knot(j+1) <= t {
		j++
	}
	return j
}

// probe describes the study at its query, with its diagnostics d and its
// framing radius, beyond 100 of which a centre is at infinity.
func (p *probing) probe(q ProbeQuery, d *DiagnosticsResult, radius float64) *ProbePoint {
	var t float64
	if q.T != nil {
		t = *q.T
	} else {
		t = p.lengthShare(d, *q.Share)
	}
	at := &ProbePoint{T: t}
	n := p.c.Samples
	j := p.sampleBefore(t)
	if p.c.Format == "harmonic" {
		chain := p.c.Harmonic.chain(t)
		chain.SampleIndex = j
		at.Chain = &chain
	}
	// Where the curve is described: the end of the domain is the last
	// sample, which the sampling loop's rounding can leave short of it by
	// an ulp, and a closed curve's end is its start.
	s, k := t, j
	if j == n {
		s = p.knot(n)
		if p.closed {
			s, k = p.lo, 0
		}
	}
	// At a sample, r‴ is found where the diagnostics find it.
	jerkAt := s
	if s == p.knot(k) {
		jerkAt = p.lo + (p.hi-p.lo)*float64(k)/float64(n)
	}
	r, v, a, ok := p.evaluate(s)
	if !ok || !r.valid() || !v.valid() || v.norm() < 1e-9 {
		return at
	}
	binormal, defined := p.c.binormal(v, a, p.lo, p.hi)
	e := describe(p.third, jerkAt, r, v, a, binormal, defined)
	at.Point = &r
	at.Tangent, at.Normal, at.Binormal, at.Center = e.tangent, e.normal, e.binormal, e.center
	at.Curvature, at.Torsion = e.curvature, e.torsion
	if at.Center != nil && 1 / *at.Curvature > 100*radius {
		at.Center = nil
	}
	at.Length = p.lengthTo(d, t)
	if p.construct != nil {
		p.construct(t, r, v.unit(), at)
	}
	return at
}

// lengthTo is the drawn arc length to t: the length at the last sample at
// or before t, continued by Simpson's rule over the rest of the way, as
// the diagnostics step from one sample to the next. It is null where that
// sample is not drawn.
func (p *probing) lengthTo(d *DiagnosticsResult, t float64) *float64 {
	j := p.sampleBefore(t)
	if d.Length[j] == nil {
		return nil
	}
	s := *d.Length[j]
	if tj := p.knot(j); t > tj && j < p.c.Samples {
		speed := func(u float64) float64 {
			_, v, _, ok := p.evaluate(u)
			if !ok || !v.valid() {
				return math.NaN()
			}
			return v.norm()
		}
		if inc := (t - tj) / 6 * (speed(tj) + 4*speed((tj+t)/2) + speed(t)); finite(inc) {
			s += inc
		}
	}
	return &s
}

// lengthShare is the parameter where the drawn arc length is share of the
// whole: a sample where a sample's length is exactly that, and otherwise
// the root, by bisection, of the length within the drawn interval that
// passes it. With no drawn length it is the domain's start.
func (p *probing) lengthShare(d *DiagnosticsResult, share float64) float64 {
	total := 0.0
	for _, s := range d.Length {
		if s != nil && *s > total {
			total = *s
		}
	}
	if !(total > 0) {
		return p.lo
	}
	goal := share * total
	for j, s := range d.Length {
		if s == nil || *s < goal {
			continue
		}
		if *s == goal || j == 0 {
			return p.knot(j)
		}
		// The length rises only over an interval drawn at both ends.
		a, b := p.knot(j-1), p.knot(j)
		for k := 0; k < 200 && a < b; k++ {
			m := (a + b) / 2
			if m <= a || m >= b {
				break
			}
			if l := p.lengthTo(d, m); l != nil && *l < goal {
				a = m
			} else {
				b = m
			}
		}
		// The nearer end of the last bracket.
		la, lb := p.lengthTo(d, a), p.lengthTo(d, b)
		if la != nil && lb != nil && math.Abs(*la-goal) < math.Abs(*lb-goal) {
			return a
		}
		return b
	}
	return p.hi
}

// pointAt keeps a construction's point where it is finite.
func pointAt(v Vec3) *Vec3 {
	if !v.valid() {
		return nil
	}
	return &v
}

// ProbeOnly returns only the study's curve probe, for a probe moved over a
// study already drawn. It keeps the last study it computed, with its
// diagnostics; a request for the same study is answered from it, so moving
// the probe evaluates one point, not the whole study again.
func ProbeOnly(c Request) (*ProbePoint, error) {
	if c.Probe == nil {
		return nil, errors.New("no probe was asked for")
	}
	at := c.Probe
	// The probe reads neither surface's nor the light's diagnostics.
	c.Probe, c.Diagnostics, c.SurfaceDiagnostics, c.LightDiagnostics = nil, true, false, false
	key, err := json.Marshal(c)
	if err != nil {
		// A study JSON cannot carry, such as one with a non-finite field,
		// is computed as asked, and refused there.
		c.Probe = at
		r, err := Compute(c)
		return r.CurveProbe, err
	}
	probeStudy.Lock()
	defer probeStudy.Unlock()
	if probeStudy.key != string(key) {
		c.Probe = at
		r, err := Compute(c)
		if err != nil {
			return nil, err
		}
		probeStudy.key, probeStudy.out = string(key), &r
		return r.CurveProbe, nil
	}
	out := probeStudy.out
	p := out.probing
	if err := checkProbe(*at, p.lo, p.hi); err != nil {
		return nil, err
	}
	return p.probe(*at, out.Diagnostics, out.Bounds.Radius), nil
}

// probeStudy is the study ProbeOnly last computed, by its request.
var probeStudy struct {
	sync.Mutex
	key string
	out *Result
}

// highlight sets the construction's points at a parameter, on a study
// asked for the probe.
func (p *probing) highlight(construct func(t float64, r, tangent Vec3, at *ProbePoint)) {
	if p != nil {
		p.construct = construct
	}
}
