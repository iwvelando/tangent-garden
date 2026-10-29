package engine

import (
	"fmt"
	"math"
	"sort"
)

const FourierFitMaxPoints = 4096
const fourierFitSamples = 1024

// FourierFit retains only one closed, uniformly arc-length sampled outline
// and its ranked projection. Selection never changes that vector-chain order.
type FourierFit struct {
	samples []Vec
	terms   []Term
	length  float64
	scale   float64
}

type FourierFitResult struct {
	Terms       []Term  `json:"terms"`
	RMS         float64 `json:"rms"`
	MaxResidual float64 `json:"maxResidual"`
	SampleCount int     `json:"sampleCount"`
	Length      float64 `json:"length"`
}

// FitFourier closes a bounded polyline only with the caller's explicit consent.
// It preserves the first point and traversal, including the straight closing
// edge, and removes consecutive duplicates before arc-length resampling.
func FitFourier(points []Vec, closed bool) (*FourierFit, error) {
	if !closed {
		return nil, fmt.Errorf("Close the outline before fitting")
	}
	if len(points) > FourierFitMaxPoints {
		return nil, fmt.Errorf("an outline accepts at most 4096 points")
	}
	for _, p := range points {
		if !p.Valid() {
			return nil, fmt.Errorf("outline coordinates must be finite")
		}
		if math.Abs(p.X) > 1e5 || math.Abs(p.Y) > 1e5 {
			return nil, fmt.Errorf("outline coordinates must be within ±100000")
		}
	}
	clean := make([]Vec, 0, len(points))
	// Only three distinct points are required; avoid a quadratic uniqueness
	// scan or a second input-sized map for a heavily duplicated stroke.
	distinct := make([]Vec, 0, 3)
	for _, p := range points {
		if len(clean) == 0 || p != clean[len(clean)-1] {
			clean = append(clean, p)
		}
		if len(distinct) < 3 {
			seen := false
			for _, q := range distinct {
				seen = seen || p == q
			}
			if !seen {
				distinct = append(distinct, p)
			}
		}
	}
	if len(distinct) < 3 {
		return nil, fmt.Errorf("an outline needs at least three distinct points")
	}
	if clean[len(clean)-1] == clean[0] {
		clean = clean[:len(clean)-1]
	}
	lengths := make([]float64, len(clean)+1)
	for j, p := range clean {
		lengths[j+1] = lengths[j] + clean[(j+1)%len(clean)].Sub(p).Norm()
	}
	total := lengths[len(clean)]
	if total < 1e-6 {
		return nil, fmt.Errorf("outline total length must be at least 0.000001")
	}
	samples := make([]Vec, fourierFitSamples)
	edge := 0
	for j := range samples {
		s := total * float64(j) / fourierFitSamples
		for edge < len(clean)-1 && lengths[edge+1] <= s {
			edge++
		}
		a, b := clean[edge], clean[(edge+1)%len(clean)]
		u := (s - lengths[edge]) / (lengths[edge+1] - lengths[edge])
		samples[j] = a.Add(b.Sub(a).Mul(u))
	}
	f := fitFourierSamples(samples)
	f.length = total
	return f, nil
}

// fitFourierSamples projects equally parameter-spaced data. Subtracting the
// first point before accumulation protects small outlines far from the origin;
// translation is restored only to c_0. The public path supplies 1024 samples.
func fitFourierSamples(samples []Vec) *FourierFit {
	f := &FourierFit{samples: samples}
	origin := samples[0]
	for _, p := range samples {
		f.scale = math.Max(f.scale, p.Sub(origin).Norm())
	}
	var dc Term
	for k := -64; k <= 64; k++ {
		var re, im float64
		for j, p := range samples {
			a := -2 * math.Pi * float64(k) * float64(j) / float64(len(samples))
			s, c := math.Sincos(a)
			q := p.Sub(origin)
			re += q.X*c - q.Y*s
			im += q.X*s + q.Y*c
		}
		re /= float64(len(samples))
		im /= float64(len(samples))
		if k == 0 {
			re += origin.X
			im += origin.Y
		}
		term := Term{Frequency: float64(k), Radius: math.Hypot(re, im)}
		if term.Radius != 0 {
			term.Phase = math.Atan2(im, re)
		}
		if k == 0 {
			dc = term
		} else {
			f.terms = append(f.terms, term)
		}
	}
	rankFourierTerms(f.terms)
	f.terms = append([]Term{dc}, f.terms...)
	return f
}

func rankFourierTerms(terms []Term) {
	sort.Slice(terms, func(i, j int) bool {
		a, b := terms[i], terms[j]
		if a.Radius != b.Radius {
			return a.Radius > b.Radius
		}
		if math.Abs(a.Frequency) != math.Abs(b.Frequency) {
			return math.Abs(a.Frequency) < math.Abs(b.Frequency)
		}
		return a.Frequency < b.Frequency
	})
}

// Select includes translation in the 2–16 term budget. Errors describe only
// the declared samples, never the deviation between them or a smooth intent.
func (f *FourierFit) Select(count int) (FourierFitResult, error) {
	if count < 2 || count > maxTerms {
		return FourierFitResult{}, fmt.Errorf("choose 2–16 total terms, including translation")
	}
	terms := append([]Term(nil), f.terms[:count]...)
	if err := validateTerms(terms); err != nil {
		return FourierFitResult{}, err
	}
	if terms[1].Radius <= 1e-12*f.scale {
		return FourierFitResult{}, fmt.Errorf("the fitted outline has no usable moving term within frequencies ±64")
	}
	r := FourierFitResult{Terms: terms, SampleCount: len(f.samples), Length: f.length}
	var sum float64
	for j, p := range f.samples {
		e := fourierAt(terms, 2*math.Pi*float64(j)/float64(len(f.samples))).Sub(p).Norm()
		sum += e * e
		r.MaxResidual = math.Max(r.MaxResidual, e)
	}
	r.RMS = math.Sqrt(sum / float64(len(f.samples)))
	return r, nil
}
