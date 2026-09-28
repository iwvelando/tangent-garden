package engine

import (
	"fmt"
	"math"
	"tangentgarden/engine/closure"
)

// Lissajous is x = A sin(mt + φ), y = B sin(nt): each coordinate is the
// projection of a point turning uniformly on a circle of its amplitude.
type Lissajous struct {
	AmplitudeX float64 `json:"amplitudeX"`
	AmplitudeY float64 `json:"amplitudeY"`
	FrequencyX float64 `json:"frequencyX"`
	FrequencyY float64 `json:"frequencyY"`
	Phase      float64 `json:"phase"`
}

// Term is one rotating vector of a Fourier curve z(t) = Σ r e^{i(kt + φ)}:
// radius r turning at frequency k radians per unit t, counterclockwise for
// positive k, from angle φ at t = 0.
type Term struct {
	Frequency float64 `json:"frequency"`
	Radius    float64 `json:"radius"`
	Phase     float64 `json:"phase"`
}

// Epicycles is the rotating geometry at base sample SampleIndex. For a
// Fourier curve, Joints[k] is the center of term k's circle, where the
// vectors before it end, and the last vector ends at Point. For a Lissajous
// figure, Joints are the points turning on the x and y guides, which project
// onto Point.
type Epicycles struct {
	SampleIndex int   `json:"sampleIndex"`
	Joints      []Vec `json:"joints"`
	Point       Vec   `json:"point"`
}

// HarmonicResult describes a harmonic curve's closure and its rotating
// geometry. Period is the smallest t-span after which the curve repeats
// exactly, or 0 when it never does: when its frequencies are not in a
// whole-number ratio with small terms, or when nothing turns (Constant).
// Whole is set when every frequency that moves the curve is a whole number,
// so the curve closes over any t-span of 2π. Guides are a Lissajous figure's
// fixed circles; Radii are a Fourier curve's term radii, in the order of
// Joints.
type HarmonicResult struct {
	Period    float64     `json:"period"`
	Whole     bool        `json:"whole"`
	Constant  bool        `json:"constant"`
	Guides    []Circle    `json:"guides"`
	Radii     []float64   `json:"radii"`
	Positions []Epicycles `json:"positions"`
}

const (
	maxTerms     = 16
	maxFrequency = 1000
)

func (l Lissajous) validate() error {
	amplitude := func(x float64) bool { return finite(x) && x >= 0 && x <= 1e5 }
	frequency := func(x float64) bool { return finite(x) && math.Abs(x) <= maxFrequency }
	switch {
	case !amplitude(l.AmplitudeX) || !amplitude(l.AmplitudeY):
		return fmt.Errorf("Lissajous amplitudes A and B must be finite and within 0–100000")
	case !frequency(l.FrequencyX) || !frequency(l.FrequencyY):
		return fmt.Errorf("Lissajous frequencies m and n must be finite and within ±1000")
	case !finite(l.Phase) || math.Abs(l.Phase) > 1e6:
		return fmt.Errorf("the Lissajous phase φ must be finite and within ±1000000 radians")
	}
	return nil
}

func validateTerms(terms []Term) error {
	if len(terms) < 1 || len(terms) > maxTerms {
		return fmt.Errorf("a Fourier curve has 1–16 terms")
	}
	for k, term := range terms {
		switch {
		case !finite(term.Radius) || term.Radius < 0 || term.Radius > 1e5:
			return fmt.Errorf("term %d: the radius must be finite and within 0–100000", k+1)
		case !finite(term.Frequency) || math.Abs(term.Frequency) > maxFrequency:
			return fmt.Errorf("term %d: the frequency must be finite and within ±1000", k+1)
		case !finite(term.Phase) || math.Abs(term.Phase) > 1e6:
			return fmt.Errorf("term %d: the phase must be finite and within ±1000000 radians", k+1)
		}
	}
	return nil
}

func (l Lissajous) at(t float64) Vec {
	return Vec{l.AmplitudeX * math.Sin(l.FrequencyX*t+l.Phase), l.AmplitudeY * math.Sin(l.FrequencyY*t)}
}

// guides places the x guide above the figure and the y guide to its right,
// a quarter of the larger amplitude clear of it.
func (l Lissajous) guides() []Circle {
	a, b := l.AmplitudeX, l.AmplitudeY
	gap := math.Max(a, b) / 4
	return []Circle{{Center: Vec{0, b + gap + a}, Radius: a}, {Center: Vec{a + gap + b, 0}, Radius: b}}
}

// state turns each guide's point counterclockwise: the x guide's from
// straight down at angle mt + φ − π/2, whose x is A sin(mt + φ), and the y
// guide's from the right at angle nt, whose y is B sin(nt).
func (l Lissajous) state(t float64) Epicycles {
	g := l.guides()
	a, b := l.FrequencyX*t+l.Phase-math.Pi/2, l.FrequencyY*t
	return Epicycles{
		Joints: []Vec{
			g[0].Center.Add(Vec{math.Cos(a), math.Sin(a)}.Mul(g[0].Radius)),
			g[1].Center.Add(Vec{math.Cos(b), math.Sin(b)}.Mul(g[1].Radius)),
		},
		Point: l.at(t),
	}
}

func fourierAt(terms []Term, t float64) Vec {
	var p Vec
	for _, term := range terms {
		a := term.Frequency*t + term.Phase
		p = p.Add(Vec{math.Cos(a), math.Sin(a)}.Mul(term.Radius))
	}
	return p
}

// fourierState chains the vectors in the order given, from the origin.
func fourierState(terms []Term, t float64) Epicycles {
	s := Epicycles{Joints: make([]Vec, len(terms))}
	for k, term := range terms {
		s.Joints[k] = s.Point
		a := term.Frequency*t + term.Phase
		s.Point = s.Point.Add(Vec{math.Cos(a), math.Sin(a)}.Mul(term.Radius))
	}
	return s
}

// harmonics are the frequencies that move a harmonic curve: those of terms
// or coordinates with a nonzero radius or amplitude.
func harmonics(c Curve) []float64 {
	var out []float64
	if c.Format == "lissajous" {
		if c.Lissajous.AmplitudeX != 0 {
			out = append(out, c.Lissajous.FrequencyX)
		}
		if c.Lissajous.AmplitudeY != 0 {
			out = append(out, c.Lissajous.FrequencyY)
		}
		return out
	}
	for _, term := range c.Terms {
		if term.Radius != 0 {
			out = append(out, term.Frequency)
		}
	}
	return out
}

// harmonicResult summarizes a validated harmonic curve, and returns the
// rotating geometry at parameter t.
func harmonicResult(c Curve) (*HarmonicResult, func(t float64) Epicycles) {
	out := &HarmonicResult{Guides: []Circle{}, Radii: []float64{}, Positions: []Epicycles{}}
	out.Period, out.Whole, out.Constant = closure.Period(harmonics(c))
	if c.Format == "lissajous" {
		out.Guides = c.Lissajous.guides()
		return out, c.Lissajous.state
	}
	for _, term := range c.Terms {
		out.Radii = append(out.Radii, term.Radius)
	}
	terms := c.Terms
	return out, func(t float64) Epicycles { return fourierState(terms, t) }
}
