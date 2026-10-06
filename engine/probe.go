package engine

import (
	"encoding/json"
	"errors"
	"math"
	"sync"
)

// The probe between samples: the base curve described at any parameter of
// its domain, not only at a sample, with the point its construction gives
// there. The per-sample diagnostics and this share one description
// (describe), and the construction is evaluated by the function refinement
// evaluates it with (derivedAt), so a probe at a sample reads exactly what
// the sample's diagnostics do.

// ProbeQuery places the probe: at the parameter T, or where the drawn arc
// length from the first sample is Share of the whole. Exactly one is set.
// The notebook makes it from the probe's place; it is never typed, so it
// is refused rather than named as a field when malformed.
type ProbeQuery struct {
	T     *float64 `json:"t,omitempty"`
	Share *float64 `json:"share,omitempty"`
}

// ProbePoint describes the base curve at the parameter T as Diagnostics does
// at a sample: its point, unit tangent and left normal, signed curvature
// (0 where flat, null where unknown) and center of curvature (null where
// flat, unknown or beyond 100 study radii), and the drawn arc length to it,
// the length at the last drawn sample at or before T continued over the
// rest of the way by Simpson's rule on the speed at its ends and midpoint.
// Each is null where the base is not drawn at T. Input is the construction's
// derived input there, when it acts on one, and Derived its point, where
// the construction is defined pointwise (not a family of paths).
type ProbePoint struct {
	T         float64  `json:"t"`
	Point     *Vec     `json:"point"`
	Tangent   *Vec     `json:"tangent"`
	Normal    *Vec     `json:"normal"`
	Curvature *float64 `json:"curvature"`
	Center    *Vec     `json:"center"`
	Length    *float64 `json:"length"`
	Input     *Vec     `json:"input,omitempty"`
	Derived   *Vec     `json:"derived"`
}

// errProbe refuses a probe on a curve it cannot evaluate at any parameter.
var errProbe = errors.New("the probe stands between samples only on a curve evaluated at any parameter: not a chase, a trajectory, a level set or an iterated map")

// checkProbe refuses a malformed probe query, once the domain is valid.
func (q Request) checkProbe() error {
	if q.Probe == nil {
		return nil
	}
	at := q.Probe
	switch {
	case (at.T == nil) == (at.Share == nil):
		return errors.New("the probe needs either a parameter or a share of the length")
	case at.T != nil && !(*at.T >= q.Curve.Min && *at.T <= q.Curve.Max):
		return errors.New("the probe's parameter lies outside the domain")
	case at.Share != nil && !(*at.Share >= 0 && *at.Share <= 1):
		return errors.New("the probe's share of the length lies outside 0 to 1")
	}
	return nil
}

// probe describes the computed study out at its probe query, from the base
// f and the construction's input g.
func (q Request) probe(f, g curveFunc, out *Result) *ProbePoint {
	lo, hi := q.Curve.Min, q.Curve.Max
	d := out.Diagnostics
	if d == nil {
		d = diagnose(f, out.Base, lo, hi)
	}
	var t float64
	if q.Probe.T != nil {
		t = *q.Probe.T
	} else {
		t = q.lengthShare(f, d, *q.Probe.Share)
	}
	at := &ProbePoint{T: t}
	p := f(t)
	v, a := derivatives(f, t, lo, hi)
	if !p.Valid() || !baseStencil(lo, hi).conditioned(f, t, v, a, derivativeOrder(q)) {
		return at
	}
	at.Point = point(p)
	e := describe(f, t, p, v, a, lo, hi, d.radius)
	at.Tangent, at.Normal, at.Curvature, at.Center = e.tangent, e.normal, e.curvature, e.center
	at.Length = q.lengthTo(f, d, t)
	if composed(q.Input) {
		at.Input = point(g(t))
	}
	if derived := q.derivedAt(f, g, out); derived != nil {
		at.Derived = derived(t)
	}
	return at
}

// lengthTo is the drawn arc length to t: the length at the last sample at
// or before t, continued by Simpson's rule over the rest of the way, as
// the diagnostics step from one sample to the next. It is null where that
// sample is not drawn.
func (q Request) lengthTo(f curveFunc, d *Diagnostics, t float64) *float64 {
	lo, hi := q.Curve.Min, q.Curve.Max
	j := q.sampleBefore(t)
	if d.Length[j] == nil {
		return nil
	}
	s := *d.Length[j]
	if tj := lo + float64(j)*((hi-lo)/float64(q.Samples-1)); t > tj {
		speed := func(t float64) float64 {
			v, _ := derivatives(f, t, lo, hi)
			return v.Norm()
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
func (q Request) lengthShare(f curveFunc, d *Diagnostics, share float64) float64 {
	lo, hi := q.Curve.Min, q.Curve.Max
	step := (hi - lo) / float64(q.Samples-1)
	total := 0.0
	for _, s := range d.Length {
		if s != nil && *s > total {
			total = *s
		}
	}
	if !(total > 0) {
		return lo
	}
	goal := share * total
	for j, s := range d.Length {
		if s == nil || *s < goal {
			continue
		}
		if *s == goal || j == 0 {
			return lo + float64(j)*step
		}
		// The length rises only over an interval drawn at both ends.
		a, b := lo+float64(j-1)*step, lo+float64(j)*step
		for k := 0; k < 200 && a < b; k++ {
			m := (a + b) / 2
			if m <= a || m >= b {
				break
			}
			if l := q.lengthTo(f, d, m); l != nil && *l < goal {
				a = m
			} else {
				b = m
			}
		}
		// The nearer end of the last bracket.
		la, lb := q.lengthTo(f, d, a), q.lengthTo(f, d, b)
		if la != nil && lb != nil && math.Abs(*la-goal) < math.Abs(*lb-goal) {
			return a
		}
		return b
	}
	return hi
}

// ProbeOnly returns only the study's probe, for a probe moved over a study
// already drawn. It keeps the last study it computed, with its
// diagnostics but without refinement between samples, which the probe
// never reads; a request for the same study is answered from it, so moving
// the probe evaluates one point, not the whole study again.
func ProbeOnly(q Request) (*ProbePoint, error) {
	if q.Probe == nil {
		return nil, errors.New("no probe was asked for")
	}
	at := q.Probe
	q.Probe, q.Adaptive, q.Diagnostics = nil, false, true
	key, err := json.Marshal(q)
	if err != nil {
		// A study JSON cannot carry, such as one with a non-finite field,
		// is computed as asked, and refused there.
		q.Probe = at
		r, err := Compute(q)
		return r.Probe, err
	}
	probeStudy.Lock()
	defer probeStudy.Unlock()
	if probeStudy.key != string(key) {
		q.Probe = at
		r, err := Compute(q)
		if err != nil {
			return nil, err
		}
		q.Probe = nil
		probeStudy.key, probeStudy.q, probeStudy.out = string(key), q, &r
		return r.Probe, nil
	}
	q = probeStudy.q
	q.Probe = at
	if err := q.checkProbe(); err != nil {
		return nil, err
	}
	out := probeStudy.out
	return q.probe(out.curve, out.input, out), nil
}

// probeStudy is the study ProbeOnly last computed, by its request.
var probeStudy struct {
	sync.Mutex
	key string
	q   Request
	out *Result
}
