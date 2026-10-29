package engine

import (
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestFourierFitKernelSignedCoefficients(t *testing.T) {
	// Independent Cartesian expansion of 3-2i + 2 exp(i(3t+.4))
	// + .7 exp(i(-5t-.8)); these samples are uniform in t, not arc length.
	samples := make([]Vec, 1024)
	for j := range samples {
		u := 2 * math.Pi * float64(j) / 1024
		samples[j] = Vec{3 + 2*math.Cos(3*u+.4) + .7*math.Cos(-5*u-.8), -2 + 2*math.Sin(3*u+.4) + .7*math.Sin(-5*u-.8)}
	}
	f := fitFourierSamples(samples)
	r, err := f.Select(3)
	if err != nil {
		t.Fatal(err)
	}
	want := []Term{{0, math.Sqrt(13), math.Atan2(-2, 3)}, {3, 2, .4}, {-5, .7, -.8}}
	for j, term := range r.Terms {
		if term.Frequency != want[j].Frequency || math.Abs(term.Radius-want[j].Radius) > 2e-13 || math.Abs(term.Phase-want[j].Phase) > 2e-13 {
			t.Fatalf("term %d: %+v want %+v", j, term, want[j])
		}
	}
	if r.RMS > 1e-12 || r.MaxResidual > 1e-12 {
		t.Fatalf("residuals %+v", r)
	}
	q := fourierRequest(r.Terms, 0, 2*math.Pi)
	q.Samples = 1025
	q.Kind, q.Inversion = "inversion", Inversion{Center: Vec{8, 4}, Radius: 2}
	geometry := compute(t, q)
	for j, p := range samples {
		closeVec(t, geometry.Base[j], p, 2e-12)
		d := p.Sub(q.Inversion.Center)
		closeVec(t, geometry.Derived[j], q.Inversion.Center.Add(d.Mul(4/d.Dot(d))), 2e-12)
	}
	for _, s := range geometry.Harmonic.Positions {
		closeVec(t, geometry.Base[s.SampleIndex], s.Point, 0)
	}
}

func TestFourierFitClosedArcLength(t *testing.T) {
	// A 3-4-5 triangle: the last-to-first edge accounts for 5/12 of
	// the traversal. Extra points/duplicates on an edge cannot weight it.
	points := []Vec{{0, 0}, {3, 0}, {3, 4}}
	f, err := FitFourier(points, true)
	if err != nil {
		t.Fatal(err)
	}
	dense, err := FitFourier([]Vec{{0, 0}, {0, 0}, {.01, 0}, {.03, 0}, {.1, 0}, {2, 0}, {3, 0}, {3, 4}, {0, 0}}, true)
	if err != nil {
		t.Fatal(err)
	}
	for j, p := range f.samples {
		s := 12 * float64(j) / 1024
		var want Vec
		switch {
		case s < 3:
			want = Vec{s, 0}
		case s < 7:
			want = Vec{3, s - 3}
		default:
			want = Vec{3 * (12 - s) / 5, 4 * (12 - s) / 5}
		}
		closeVec(t, &p, want, 2e-14)
		closeVec(t, &dense.samples[j], want, 2e-14)
	}
	previous := FourierFitResult{RMS: math.Inf(1)}
	for n := 2; n <= 16; n++ {
		r, err := f.Select(n)
		if err != nil {
			t.Fatal(err)
		}
		if r.SampleCount != 1024 || math.Abs(r.Length-12) > 1e-13 || r.Terms[0].Frequency != 0 {
			t.Fatalf("metadata %+v", r)
		}
		if n > 2 && !reflect.DeepEqual(previous.Terms, r.Terms[:n-1]) {
			t.Fatal("reranked prefix")
		}
		if r.RMS > previous.RMS+1e-13 {
			t.Fatal("RMS increased")
		}
		var sum, maximum float64
		for j, p := range f.samples {
			e := fourierAt(r.Terms, 2*math.Pi*float64(j)/1024).Sub(p).Norm()
			sum += e * e
			maximum = math.Max(maximum, e)
		}
		if math.Abs(r.RMS-math.Sqrt(sum/1024)) > 1e-13 || math.Abs(r.MaxResidual-maximum) > 1e-13 {
			t.Fatal("wrong sample errors")
		}
		previous = r
	}
	// Callers cannot mutate the cached coefficient order through a reply.
	r, _ := f.Select(8)
	r.Terms[0].Radius = 999
	again, _ := f.Select(8)
	if again.Terms[0].Radius == 999 {
		t.Fatal("aliased terms")
	}
}

func TestFourierFitCircleTraversalAndScale(t *testing.T) {
	for _, sign := range []float64{1, -1} {
		for _, scale := range []float64{1e-4, 1, 1000} {
			points := make([]Vec, 1024)
			for j := range points {
				a := sign*2*math.Pi*float64(j)/1024 + .7
				points[j] = Vec{scale * (3 + 2*math.Cos(a)), scale * (-1 + 2*math.Sin(a))}
			}
			f, err := FitFourier(points, true)
			if err != nil {
				t.Fatal(err)
			}
			r, err := f.Select(2)
			if err != nil {
				t.Fatal(err)
			}
			if r.Terms[1].Frequency != sign || math.Abs(r.Terms[1].Radius-2*scale) > 1e-11*scale || math.Abs(r.Terms[1].Phase-.7) > 1e-12 || r.RMS > 1e-11*scale {
				t.Fatalf("circle %+v", r)
			}
			closeVec(t, &f.samples[0], points[0], 0)
			for j, p := range f.samples {
				closeVec(t, &p, points[j], 1e-11*scale)
			}
			// The fitted evaluator, not the input polygon, supplies a translated
			// circle's ordinary pedal. Its pedal about its center is itself.
			q := fourierRequest(r.Terms, 0, 2*math.Pi)
			q.Kind, q.Pole, q.Samples = "pedal", Vec{3 * scale, -scale}, 1025
			geometry := compute(t, q)
			for j := 0; j < 1024; j += 31 {
				closeVec(t, geometry.Base[j], points[j], 2e-11*scale)
				closeVec(t, geometry.Derived[j], points[j], 1e-8*scale)
			}
		}
	}
}

func TestFourierFitValidationAndBounds(t *testing.T) {
	triangle := []Vec{{0, 0}, {1, 0}, {0, 1}}
	for _, tc := range []struct {
		p      []Vec
		closed bool
		want   string
	}{
		{triangle, false, "Close"}, {nil, true, "three distinct"}, {[]Vec{{0, 0}, {1, 0}, {0, 0}}, true, "three distinct"},
		{[]Vec{{0, 0}, {math.NaN(), 0}, {0, 1}}, true, "finite"}, {[]Vec{{0, 0}, {1, math.Inf(1)}, {0, 1}}, true, "finite"},
		{[]Vec{{0, 0}, {100001, 0}, {0, 1}}, true, "100000"}, {make([]Vec, 4097), true, "4096"},
		{[]Vec{{0, 0}, {1e-20, 0}, {0, 1e-20}}, true, "length"},
	} {
		if _, err := FitFourier(tc.p, tc.closed); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: %v", tc.want, err)
		}
	}
	// Self-crossings, collinear traversal, and the maximum input are valid.
	for _, p := range [][]Vec{{{-1, -1}, {1, 1}, {-1, 1}, {1, -1}}, {{0, 0}, {1, 0}, {2, 0}}, make([]Vec, 4096)} {
		if len(p) == 4096 {
			for j := range p {
				a := 2 * math.Pi * float64(j) / 4096
				p[j] = Vec{math.Cos(a), math.Sin(a)}
			}
		}
		if _, err := FitFourier(p, true); err != nil {
			t.Fatal(err)
		}
	}
	f, _ := FitFourier(triangle, true)
	for _, n := range []int{-1, 0, 1, 17, 100000} {
		if _, err := f.Select(n); err == nil {
			t.Fatalf("accepted %d terms", n)
		}
	}
	// Input coordinates can be valid while the translation's radius exceeds
	// the ordinary Fourier bound. Fitting must not bypass that validation.
	large, err := FitFourier([]Vec{{99999, 99999}, {100000, 99999}, {99999, 100000}}, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = large.Select(8); err == nil || !strings.Contains(err.Error(), "radius") {
		t.Fatalf("accepted unusable translation: %v", err)
	}
	zero := fitFourierSamples(make([]Vec, 1024))
	for _, term := range zero.terms {
		if term.Radius != 0 || term.Phase != 0 {
			t.Fatalf("noncanonical zero %+v", term)
		}
	}
	// All energy outside the permitted band must not yield a motionless fit.
	p := make([]Vec, 1024)
	for j := range p {
		a := 2 * math.Pi * 100 * float64(j) / 1024
		p[j] = Vec{math.Cos(a), math.Sin(a)}
	}
	if _, err := fitFourierSamples(p).Select(16); err == nil {
		t.Fatal("accepted nonmoving fit")
	}
}

func TestFourierFitDeterministicTies(t *testing.T) {
	terms := []Term{{3, 1, 0}, {-2, 1, 0}, {2, 1, 0}, {-1, 1, 0}, {1, 1, 0}}
	rankFourierTerms(terms)
	want := []float64{-1, 1, -2, 2, 3}
	for j, term := range terms {
		if term.Frequency != want[j] {
			t.Fatalf("ties: %+v", terms)
		}
	}
}
