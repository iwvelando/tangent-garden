package engine3

import (
	"fmt"
	"math"
	"tangentgarden/engine/closure"
)

// HarmonicTerm is one generating vector A cos(ωt) + B sin(ωt): it turns
// around an ellipse spanned by A and B (a segment when they are parallel),
// from A at t = 0 towards B, at frequency ω radians per unit t. A zero
// frequency makes it the fixed translation A.
type HarmonicTerm struct {
	Frequency float64 `json:"frequency"`
	Cosine    Vec3    `json:"cosine"`
	Sine      Vec3    `json:"sine"`
}

// HarmonicCurve is r(t) = c₀ + Σ[A_k cos(ω_k t) + B_k sin(ω_k t)] on the
// domain [Min, Max]. The domain is mathematical input: a curve is closed only
// when the domain spans whole periods, never forced closed.
type HarmonicCurve struct {
	Center Vec3           `json:"center"`
	Terms  []HarmonicTerm `json:"terms"`
	Min    float64        `json:"min"`
	Max    float64        `json:"max"`
}

// HarmonicPosition is the chain of generating vectors at base sample
// SampleIndex: Joints[k] is where term k's vector starts (Joints[0] = c₀),
// and the last vector ends at Point. A zero term starts and ends at one joint.
type HarmonicPosition struct {
	SampleIndex int    `json:"sampleIndex"`
	Joints      []Vec3 `json:"joints"`
	Point       Vec3   `json:"point"`
}

// HarmonicResult echoes the terms in their input order, which is their
// identity: terms are neither reordered nor dropped, even when zero. Period is
// the smallest t-span after which the curve repeats, or 0 when it never does;
// Whole is set when every moving frequency is a whole number; Closed is set
// when the domain spans a whole number of periods, so the last sample is the
// first. Positions are at the representative samples.
type HarmonicResult struct {
	Center    Vec3               `json:"center"`
	Terms     []HarmonicTerm     `json:"terms"`
	Period    float64            `json:"period"`
	Whole     bool               `json:"whole"`
	Closed    bool               `json:"closed"`
	Positions []HarmonicPosition `json:"positions"`
}

const (
	maxHarmonicTerms     = 8
	maxHarmonicFrequency = 1000
)

func (t HarmonicTerm) moves() bool {
	return t.Frequency != 0 && (t.Cosine != Vec3{} || t.Sine != Vec3{})
}

func (t HarmonicTerm) at(u float64) Vec3 {
	w := t.Frequency * u
	return t.Cosine.mul(math.Cos(w)).add(t.Sine.mul(math.Sin(w)))
}

func (h HarmonicCurve) validate() error {
	bounded := func(v Vec3) bool {
		return v.valid() && math.Max(math.Abs(v.X), math.Max(math.Abs(v.Y), math.Abs(v.Z))) <= 1e5
	}
	if len(h.Terms) < 1 || len(h.Terms) > maxHarmonicTerms {
		return fmt.Errorf("a spatial harmonic curve has 1–8 terms")
	}
	if !bounded(h.Center) {
		return fmt.Errorf("the center c₀ coordinates must be finite and within ±100000")
	}
	moving := false
	for k, term := range h.Terms {
		switch {
		case !finite(term.Frequency) || math.Abs(term.Frequency) > maxHarmonicFrequency:
			return fmt.Errorf("term %d: the frequency must be finite and within ±1000", k+1)
		case !bounded(term.Cosine):
			return fmt.Errorf("term %d: A coordinates must be finite and within ±100000", k+1)
		case !bounded(term.Sine):
			return fmt.Errorf("term %d: B coordinates must be finite and within ±100000", k+1)
		}
		moving = moving || term.moves()
	}
	if !moving {
		return fmt.Errorf("nothing turns: every term has zero frequency or zero vectors A and B, so the curve is a single point")
	}
	return nil
}

// closure reports the period of the moving terms and whether the domain
// spans a whole number of them.
func (h HarmonicCurve) closure() (period float64, whole, closed bool) {
	var frequencies []float64
	for _, term := range h.Terms {
		if term.moves() {
			frequencies = append(frequencies, term.Frequency)
		}
	}
	period, whole, _ = closure.Period(frequencies)
	if period == 0 {
		return 0, false, false
	}
	m := (h.Max - h.Min) / period
	return period, whole, math.Round(m) >= 1 && math.Abs(m-math.Round(m)) <= 1e-9*m
}

// evaluate gives r, r′, r″ analytically; each term contributes
// ω(−A sin ωt + B cos ωt) and −ω²(A cos ωt + B sin ωt).
func (h HarmonicCurve) evaluate(u float64) (Vec3, Vec3, Vec3, bool) {
	r, v, a := h.Center, Vec3{}, Vec3{}
	for _, term := range h.Terms {
		w := term.Frequency
		c, s := math.Cos(w*u), math.Sin(w*u)
		r = r.add(term.Cosine.mul(c)).add(term.Sine.mul(s))
		v = v.add(term.Sine.mul(w * c).sub(term.Cosine.mul(w * s)))
		a = a.sub(term.Cosine.mul(w * w * c).add(term.Sine.mul(w * w * s)))
	}
	return r, v, a, true
}

// curvatureScale bounds |r″|, the scale of the developable's normal guard.
func (h HarmonicCurve) curvatureScale() float64 {
	scale := 0.0
	for _, term := range h.Terms {
		scale += term.Frequency * term.Frequency * (term.Cosine.norm() + term.Sine.norm())
	}
	return scale
}

// harmonicGeometry returns the vector chains at the representative samples
// and, for framing, each term's joints and the axis extents of its ellipse
// around them, one family per term so that a small term's locus cannot trim
// a large one's. A closed curve's last position is its first.
func harmonicGeometry(c Request, lo, hi float64) (*HarmonicResult, [][]*Vec3) {
	h := c.Harmonic
	n := c.Samples
	out := &HarmonicResult{Center: h.Center, Terms: h.Terms, Positions: make([]HarmonicPosition, 0, c.Lines)}
	out.Period, out.Whole, out.Closed = h.closure()
	families := make([][]*Vec3, 2*len(h.Terms))
	for line := 0; line < c.Lines; line++ {
		i := line * n / (c.Lines - 1)
		u := lo*(1-float64(i)/float64(n)) + hi*float64(i)/float64(n)
		if out.Closed && i == n {
			u = lo
		}
		s := HarmonicPosition{SampleIndex: i, Joints: make([]Vec3, len(h.Terms)), Point: h.Center}
		for k, term := range h.Terms {
			s.Joints[k] = s.Point
			s.Point = s.Point.add(term.at(u))
			families[2*k] = append(families[2*k], &s.Joints[k])
			reach := Vec3{math.Hypot(term.Cosine.X, term.Sine.X), math.Hypot(term.Cosine.Y, term.Sine.Y), math.Hypot(term.Cosine.Z, term.Sine.Z)}
			for _, d := range []Vec3{{reach.X, 0, 0}, {0, reach.Y, 0}, {0, 0, reach.Z}} {
				low, high := s.Joints[k].sub(d), s.Joints[k].add(d)
				families[2*k+1] = append(families[2*k+1], &low, &high)
			}
		}
		out.Positions = append(out.Positions, s)
	}
	return out, families
}
