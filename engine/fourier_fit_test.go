package engine

import (
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

func TestFourierCurveOutlineCircle(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		c := Curve{Format: "parametric", X: "20+3*cos(t)", Y: "-8+3*sin(t)", Min: .3, Max: .3 + 2*math.Pi}
		if reverse {
			c.Min, c.Max = c.Max, c.Min
		}
		o, err := FourierCurveOutline(c, "curve")
		if err != nil {
			t.Fatal(err)
		}
		if len(o.Points) > FourierFitMaxPoints || o.Evaluations > FourierOutlineMaxEvaluations || o.Tolerance <= 0 {
			t.Fatalf("unbounded outline: %+v", o)
		}
		first := Vec{20 + 3*math.Cos(c.Min), -8 + 3*math.Sin(c.Min)}
		if o.Points[0].Sub(first).Norm() > 1e-14 || o.Points[len(o.Points)-1] != o.Points[0] {
			t.Fatal("phase origin/closure lost")
		}
		f, err := FitFourier(o.Points, true)
		if err != nil {
			t.Fatal(err)
		}
		r, err := f.Select(2)
		if err != nil {
			t.Fatal(err)
		}
		k := 1.0
		if reverse {
			k = -1
		}
		if r.Terms[1].Frequency != k || math.Abs(r.Terms[1].Radius-3) > 2*o.Tolerance || r.MaxResidual > 2*o.Tolerance {
			t.Fatalf("circle recovery: %+v", r)
		}
		for j, p := range f.samples {
			u := c.Min + k*2*math.Pi*float64(j)/1024
			want := Vec{20 + 3*math.Cos(u), -8 + 3*math.Sin(u)}
			if p.Sub(want).Norm() > 2*o.Tolerance {
				t.Fatalf("arc-length phase/direction sample %d: %v != %v", j, p, want)
			}
		}
	}
}

func TestFourierCurveOutlineFamiliesAndCorners(t *testing.T) {
	cases := []Curve{
		{Format: "polar", R: "2+cos(3*t)", Max: 2 * math.Pi},
		{Format: "roulette", Roulette: Roulette{Roll: "inside", FixedRadius: 5, Radius: 1, Arm: 1.4}, Max: 2 * math.Pi},
		{Format: "lissajous", Lissajous: Lissajous{AmplitudeX: 2, AmplitudeY: 1, FrequencyX: 1, FrequencyY: 2, Phase: math.Pi / 2}, Max: 2 * math.Pi},
		{Format: "fourier", Terms: []Term{{0, 10, .2}, {1, 2, 0}, {-3, .6, .3}}, Max: 2 * math.Pi},
		// A square's corners and repeated returns to the start are continuous.
		{Format: "parametric", X: "abs(cos(t))*cos(t)", Y: "abs(sin(t))*sin(t)", Max: 4 * math.Pi},
	}
	for _, c := range cases {
		t.Run(c.Format, func(t *testing.T) {
			o, err := FourierCurveOutline(c, "curve")
			if err != nil {
				t.Fatal(err)
			}
			if len(o.Points) < 4 || len(o.Points) > 4096 || o.Evaluations > FourierOutlineMaxEvaluations {
				t.Fatalf("outline bounds: %d/%d", len(o.Points), o.Evaluations)
			}
			f, err := FitFourier(o.Points, true)
			if err != nil {
				t.Fatal(err)
			}
			a, _ := f.Select(8)
			b, err := f.Select(16)
			if err != nil || b.RMS > a.RMS+1e-10 || !reflect.DeepEqual(a.Terms, b.Terms[:8]) {
				t.Fatalf("unstable fit: %v", err)
			}
			// Independent dense observations of the original evaluator must lie
			// near the admitted polyline, including self-crossings and corners.
			at, _ := compile(c)
			for j := 0; j < 5003; j++ {
				p := at(c.Min + (c.Max-c.Min)*float64(j)/5003)
				d := math.Inf(1)
				for i := 1; i < len(o.Points); i++ {
					d = math.Min(d, plane.Distance(p, o.Points[i-1], o.Points[i]))
				}
				if d > 2*o.Tolerance {
					t.Fatalf("unresolved source: %g > %g", d, o.Tolerance)
				}
			}
		})
	}
}

func TestFourierCurveOutlineRefusals(t *testing.T) {
	base := Curve{Format: "parametric", X: "cos(t)", Y: "sin(t)", Max: 2 * math.Pi}
	cases := []struct {
		name          string
		c             Curve
		input, reason string
	}{
		{"gap", Curve{Format: "parametric", X: "cos(t)", Y: "sin(t)+0*sqrt(cos(t))", Max: 2 * math.Pi}, "curve", "gap"},
		{"jump", Curve{Format: "parametric", X: "cos(t)", Y: "sin(t)+cos(t-.1)/abs(cos(t-.1))", Max: 2 * math.Pi}, "curve", "discontinuity"},
		{"point", Curve{Format: "parametric", X: "1", Y: "2", Max: 2 * math.Pi}, "curve", "length"},
		{"tiny", Curve{Format: "parametric", X: "1e-9*cos(t)", Y: "1e-9*sin(t)", Max: 2 * math.Pi}, "curve", "length"},
		{"magnitude", Curve{Format: "parametric", X: "100001*cos(t)", Y: "sin(t)", Max: 2 * math.Pi}, "curve", "100000"},
		{"work", Curve{Format: "parametric", X: "cos(999*t)", Y: "sin(999*t)", Max: 2 * math.Pi}, "curve", "4096 outline points"},
		{"derived", base, "evolute", "base"},
	}
	for _, format := range []string{"implicit", "field", "pursuit", "attractor", "cartesian"} {
		c := base
		c.Format = format
		cases = append(cases, struct {
			name          string
			c             Curve
			input, reason string
		}{format, c, "curve", "parametric"})
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := FourierCurveOutline(tc.c, tc.input); err == nil || !strings.Contains(err.Error(), tc.reason) {
				t.Fatalf("want %q refusal, got %v", tc.reason, err)
			}
		})
	}
	// Closure slack is rounding-sized, not an approximation-sized chord.
	for _, delta := range []float64{1e-8, 1e-6} {
		c := base
		c.X = "80000+cos(t)"
		c.Max -= delta
		o, err := FourierCurveOutline(c, "curve")
		if err != nil {
			t.Fatal(err)
		}
		if !o.Open {
			t.Fatal("closed an open translated curve")
		}
	}
}

// An open source is admitted for an explicit close: its ends are reported, not
// joined or snapped, and everything else about admission still applies.
func TestFourierCurveOutlineAdmitsOpenSources(t *testing.T) {
	half := Curve{Format: "parametric", X: "cos(t)", Y: "sin(t)", Max: math.Pi}
	o, err := FourierCurveOutline(half, "curve")
	if err != nil {
		t.Fatal(err)
	}
	if !o.Open {
		t.Fatal("half circle reported as closed")
	}
	first, last := o.Points[0], o.Points[len(o.Points)-1]
	if math.Hypot(first.X-1, first.Y) > 1e-12 || math.Hypot(last.X+1, last.Y) > 1e-12 {
		t.Fatalf("entered endpoints moved: %v %v", first, last)
	}
	for _, p := range o.Points {
		if math.Abs(math.Hypot(p.X, p.Y)-1) > 1e-12 || p.Y < -1e-12 {
			t.Fatalf("added a point off the source: %v", p)
		}
	}
	// Closing is what adds the chord: its diameter joins the half circumference.
	fit, err := FitFourier(o.Points, true)
	if err != nil {
		t.Fatal(err)
	}
	r, err := fit.Select(16)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(r.Length-(math.Pi+2)) > 1e-3 {
		t.Fatalf("closed length %v, want pi+2", r.Length)
	}
	// Descending bounds keep the entered traversal and its open ends.
	back := half
	back.Min, back.Max = math.Pi, 0
	reversed, err := FourierCurveOutline(back, "curve")
	if err != nil || !reversed.Open {
		t.Fatalf("descending open source: open=%v err=%v", reversed.Open, err)
	}
	if p := reversed.Points[0]; math.Hypot(p.X+1, p.Y) > 1e-12 {
		t.Fatalf("descending traversal starts at %v", p)
	}
	// A cusped open arch, as an example opens with, stays admissible.
	cycloid, err := FourierCurveOutline(Curve{Format: "parametric", X: "2*(t-sin(t))", Y: "2*(1+cos(t))", Max: 2 * math.Pi}, "curve")
	if err != nil || !cycloid.Open {
		t.Fatalf("cycloid: open=%v err=%v", cycloid.Open, err)
	}
	// Openness never excuses a gap, a jump or a stationary point, and a closed
	// source still returns its exactly repeated endpoint.
	for name, c := range map[string]Curve{
		"gap":   {Format: "parametric", X: "cos(t)", Y: "sin(t)+0*sqrt(cos(t))", Max: 3},
		"jump":  {Format: "parametric", X: "t", Y: "abs(t-1)/(t-1)", Max: 3},
		"point": {Format: "parametric", X: "1", Y: "2", Max: 3},
	} {
		if _, err := FourierCurveOutline(c, "curve"); err == nil {
			t.Errorf("%s: open source admitted", name)
		}
	}
	closed, err := FourierCurveOutline(Curve{Format: "parametric", X: "cos(t)", Y: "sin(t)", Max: 2 * math.Pi}, "curve")
	if err != nil {
		t.Fatal(err)
	}
	if closed.Open || closed.Points[0] != closed.Points[len(closed.Points)-1] {
		t.Fatalf("closed source: open=%v, ends %v %v", closed.Open, closed.Points[0], closed.Points[len(closed.Points)-1])
	}
}

// Close outline divides its chord at the outline's mean edge, so a correction
// can bend it locally, without changing the polygon or its fit.
func TestCloseFourierOutlineDividesTheClosingSegment(t *testing.T) {
	half, err := FourierCurveOutline(Curve{Format: "parametric", X: "cos(t)", Y: "sin(t)", Max: math.Pi}, "curve")
	if err != nil {
		t.Fatal(err)
	}
	input := append([]Vec(nil), half.Points...)
	closed := CloseFourierOutline(half.Points)
	if !reflect.DeepEqual(half.Points, input) {
		t.Fatal("input mutated")
	}
	n := len(input)
	if !reflect.DeepEqual(closed[:n], input) {
		t.Fatal("outline before the closing segment changed")
	}
	mean := 0.
	for j := 1; j < n; j++ {
		mean += input[j].Sub(input[j-1]).Norm()
	}
	mean /= float64(n - 1)
	if want := int(math.Ceil(2/mean)) - 1; len(closed)-n != want {
		t.Fatalf("%d chord points, want %d for mean edge %v", len(closed)-n, want, mean)
	}
	// Evenly spaced on the straight chord, from the last point toward the first.
	k := len(closed) - n + 1
	for j, p := range closed[n:] {
		x := -1 + 2*float64(j+1)/float64(k)
		if math.Abs(p.X-x) > 1e-12 || math.Abs(p.Y) > 1e-12 {
			t.Fatalf("chord point %d at %v, want x=%v", j, p, x)
		}
	}
	// The same polygon, so the same fit up to rounding.
	before, err := FitFourier(input, true)
	if err != nil {
		t.Fatal(err)
	}
	after, err := FitFourier(closed, true)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := before.Select(16)
	b, _ := after.Select(16)
	if math.Abs(a.Length-b.Length) > 1e-9 || math.Abs(a.RMS-b.RMS) > 1e-9 {
		t.Fatalf("fit changed: %v %v, %v %v", a.Length, b.Length, a.RMS, b.RMS)
	}
	for j := range a.Terms {
		if a.Terms[j].Frequency != b.Terms[j].Frequency || math.Abs(a.Terms[j].Radius-b.Terms[j].Radius) > 1e-9 {
			t.Fatalf("term %d: %v, %v", j, a.Terms[j], b.Terms[j])
		}
	}
	// A narrow correction now bends the chord's middle locally.
	middle := n + (len(closed)-n)/2
	target := Vec{closed[middle].X, 0.5}
	bent, err := CorrectFourierOutline(closed, FourierCorrection{Index: middle, Target: target, Reach: .05})
	if err != nil {
		t.Fatal(err)
	}
	if bent[middle] != target {
		t.Fatalf("selected chord point at %v", bent[middle])
	}
	if bent[0] != closed[0] || bent[n-1] != closed[n-1] {
		t.Fatal("a narrow bend moved the chord's ends")
	}
	if bent[middle+1].Y <= 0 || bent[middle+1].Y >= .5 {
		t.Fatalf("neighbor not carried smoothly: %v", bent[middle+1])
	}
}

func TestCloseFourierOutlineLeavesWhatItCannotDivide(t *testing.T) {
	arc := func(n int) []Vec {
		out := make([]Vec, n)
		for j := range out {
			a := math.Pi * float64(j) / float64(n-1)
			out[j] = Vec{math.Cos(a), math.Sin(a)}
		}
		return out
	}
	// The point budget caps the division rather than refusing it.
	if got := len(CloseFourierOutline(arc(4090))); got != 4096 {
		t.Fatalf("near the cap: %d points", got)
	}
	full := arc(4096)
	if got := CloseFourierOutline(full); !reflect.DeepEqual(got, full) {
		t.Fatal("divided a full outline")
	}
	// A chord no longer than an ordinary edge needs no points.
	square := []Vec{{0, 0}, {1, 0}, {1, 1}, {0, 1}}
	if got := CloseFourierOutline(square); !reflect.DeepEqual(got, square) {
		t.Fatalf("divided an ordinary edge: %v", got)
	}
	repeated := []Vec{{0, 0}, {1, 0}, {1, 1}, {0, 0}}
	if got := CloseFourierOutline(repeated); !reflect.DeepEqual(got, repeated) {
		t.Fatalf("divided a repeated endpoint: %v", got)
	}
	// A pointer held still adds no edges, so it cannot crowd the closing segment.
	u := []Vec{{0, 0}, {1, 0}, {2, 0}, {2, 5}}
	var held []Vec
	for _, p := range u {
		held = append(held, p, p, p, p)
	}
	if a, b := len(CloseFourierOutline(u))-len(u), len(CloseFourierOutline(held))-len(held); a != b {
		t.Fatalf("held points changed the division: %d, %d", a, b)
	}
	// Input FitFourier refuses stays refused and undivided: chord points must not
	// supply the missing distinct points or carry a bad coordinate along.
	for name, input := range map[string][]Vec{
		"one":     {{1, 1}},
		"two":     {{0, 0}, {5, 0}},
		"same":    {{1, 1}, {1, 1}, {1, 1}},
		"doubled": {{0, 0}, {0, 0}, {5, 0}, {5, 0}},
		"nan":     {{0, 0}, {math.NaN(), 0}, {5, 0}, {5, 5}},
		"range":   {{0, 0}, {1, 0}, {1, 1}, {1e6, 1}},
	} {
		got := CloseFourierOutline(input)
		if len(got) != len(input) {
			t.Errorf("%s: divided into %d points", name, len(got))
		}
		if _, err := FitFourier(got, true); err == nil {
			t.Errorf("%s: admitted after closing", name)
		}
	}
	// Back and forth between two points, the rounded mean edge can fall short
	// of the chord; a chord point there would invent the third distinct point.
	for i := 1; i < 400; i++ {
		a, b := Vec{}, Vec{math.Sqrt(float64(i)) / 7, math.Cbrt(float64(i)) / 3}
		input := []Vec{}
		for j := 0; j < 3+i%6; j++ {
			input = append(input, a, b)
		}
		if got := CloseFourierOutline(input); len(got) != len(input) {
			t.Fatalf("two points, case %d: divided into %d points", i, len(got))
		}
	}
}

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

func TestFourierCurveOutlineUniformArcDiamond(t *testing.T) {
	c := Curve{Format: "parametric", X: "abs(cos(t))*cos(t)", Y: "abs(sin(t))*sin(t)", Max: 2 * math.Pi}
	o, err := FourierCurveOutline(c, "curve")
	if err != nil {
		t.Fatal(err)
	}
	f, err := FitFourier(o.Points, true)
	if err != nil {
		t.Fatal(err)
	}
	vertices := []Vec{{1, 0}, {0, 1}, {-1, 0}, {0, -1}, {1, 0}}
	for j, p := range f.samples {
		edge := j / 256
		u := float64(j%256) / 256
		want := vertices[edge].Mul(1 - u).Add(vertices[edge+1].Mul(u))
		if p.Sub(want).Norm() > 1e-12 {
			t.Fatalf("uniform arc sample %d: %v want %v", j, p, want)
		}
	}
	if math.Abs(f.length-4*math.Sqrt2) > 1e-12 {
		t.Fatalf("diamond length %g", f.length)
	}
}

func TestFourierCurveOutlineAuditAliasing(t *testing.T) {
	// Dyadic seed/refinement probes alone can alias these loops into a circle.
	c := Curve{Format: "parametric", X: "cos(t)+.2*sin(8192*t)", Y: "sin(t)", Max: 2 * math.Pi}
	if _, err := FourierCurveOutline(c, "curve"); err == nil {
		t.Fatal("accepted an aliased unresolved outline")
	}
}

func TestFourierCurveOutlineLengthUsesTraversal(t *testing.T) {
	c := Curve{Format: "parametric", X: "5e-8*cos(4*t)", Y: "5e-8*sin(4*t)", Max: 2 * math.Pi}
	o, err := FourierCurveOutline(c, "curve")
	if err != nil {
		t.Fatal(err)
	}
	f, err := FitFourier(o.Points, true)
	if err != nil {
		t.Fatal(err)
	}
	if f.length < 1e-6 {
		t.Fatalf("wrong length %g", f.length)
	}
}

func TestFourierCurveOutlineProbeGap(t *testing.T) {
	// Seed positions are finite, but a quarter probe enters this narrow gap.
	c := Curve{Format: "parametric", X: "cos(t)", Y: "sin(t)+0*sqrt((t-.006)^2-.000001)", Max: 2 * math.Pi}
	if _, err := FourierCurveOutline(c, "curve"); err == nil || !strings.Contains(err.Error(), "gap") {
		t.Fatalf("lost between-seed gap: %v", err)
	}
}

// Probes either side of a jump lie on its chord, so neither refinement's
// deviation test nor the off-grid audit sees one shorter than the chord limit.
func TestFourierCurveOutlineRefusesJumpsDeviationCannotSee(t *testing.T) {
	step := "abs(cos(t-.1))/cos(t-.1)"
	curve := func(k, h float64, reverse bool) Curve {
		c := Curve{
			Format: "parametric",
			X:      fmt.Sprintf("%g*cos(t)", k),
			Y:      fmt.Sprintf("%g*(sin(t)+%g*%s)", k, h, step),
			Max:    2 * math.Pi,
		}
		if reverse {
			c.Min, c.Max = c.Max, c.Min
		}
		return c
	}
	// The diagonal is about 2.83k, so the sampled tolerance is 2.83e-4k and the
	// chord limit 0.088k; each jump is 2h·k. All three lie between those two.
	for _, k := range []float64{1e-3, 1, 1000} {
		for _, h := range []float64{.04, .005, .001} {
			for _, reverse := range []bool{false, true} {
				if _, err := FourierCurveOutline(curve(k, h, reverse), "curve"); err == nil || !strings.Contains(err.Error(), "discontinuity") {
					t.Errorf("k=%g h=%g reverse=%v: joined a jump: %v", k, h, reverse, err)
				}
			}
		}
	}
	// Below the sampled tolerance a step is indistinguishable from the polyline
	// the source is admitted as; the documented approximation covers it.
	if _, err := FourierCurveOutline(curve(1, 1e-4, false), "curve"); err != nil {
		t.Errorf("step within the sampled tolerance: %v", err)
	}
	// Steep continuous sources are not jumps, including motion along a chord,
	// which deviation alone never splits, and a resolved narrow bump.
	for _, c := range []Curve{
		{Format: "parametric", X: "cos(t)", Y: "sin(t)+.04*exp(-((t-1.2345)/.001)^2)", Max: 2 * math.Pi},
		{Format: "parametric", X: "cos(t)^51", Y: "0*t", Max: 2 * math.Pi},
		{Format: "parametric", X: "cos(t)^51", Y: "sin(t)^51", Max: 2 * math.Pi},
		{Format: "parametric", X: "cos(t)+.04*tanh((sin(t)-.3)/.001)", Y: "sin(t)", Max: 2 * math.Pi},
	} {
		if _, err := FourierCurveOutline(c, "curve"); err != nil {
			t.Errorf("refused continuous x=%s y=%s: %v", c.X, c.Y, err)
		}
	}
}

// Each coordinate may be in range while a fitted radius is not; the refusal
// must say so in terms of the outline, which has no term fields to correct.
func TestFourierFitNamesRadiusLimitForOutline(t *testing.T) {
	o, err := FourierCurveOutline(Curve{Format: "parametric", X: "90000+cos(t)", Y: "90000+sin(t)", Max: 2 * math.Pi}, "curve")
	if err != nil {
		t.Fatal(err)
	}
	f, err := FitFourier(o.Points, true)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.Select(8)
	if err == nil || !strings.Contains(err.Error(), "fitted radius") || !strings.Contains(err.Error(), "100000") || strings.Contains(err.Error(), "term 1") {
		t.Fatalf("got %v", err)
	}
}

func TestFourierOutlineCorrection(t *testing.T) {
	// An equal-edge octagon makes the cyclic arc weights independent of the
	// implementation. Moving vertex zero reaches only its two neighbors.
	points := make([]Vec, 9)
	for i := 0; i < 8; i++ {
		a := float64(i) * math.Pi / 4
		points[i] = Vec{math.Cos(a), math.Sin(a)}
	}
	points[8] = points[0]
	before := append([]Vec(nil), points...)
	edit := FourierCorrection{Index: 0, Target: Vec{1.4, -0.2}, Reach: 0.2}
	got, err := CorrectFourierOutline(points, edit)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(points, before) {
		t.Fatal("correction mutated source")
	}
	if len(got) != len(points) || got[0] != edit.Target || got[8] != got[0] {
		t.Fatalf("lost target, count or seam: %v", got)
	}
	weight := (1 + math.Cos(5*math.Pi/8)) / 2
	for i := 1; i < 8; i++ {
		want := points[i]
		if i == 1 || i == 7 {
			want = want.Add(Vec{0.4, -0.2}.Mul(weight))
		}
		if got[i].Sub(want).Norm() > 1e-14 {
			t.Fatalf("point %d: got %v want %v", i, got[i], want)
		}
	}
	// Open storage is still an explicitly closed fit polygon; no repeated
	// endpoint is added, and selecting the repeated endpoint aliases zero.
	open, err := CorrectFourierOutline(points[:8], edit)
	if err != nil || !reflect.DeepEqual(open, got[:8]) {
		t.Fatalf("open storage: %v %v", open, err)
	}
	edit.Index = 8
	seam, err := CorrectFourierOutline(points, edit)
	if err != nil || !reflect.DeepEqual(seam, got) {
		t.Fatal("seam alias differs", err)
	}
	for _, scale := range []float64{1e-4, 1, 1000} {
		mapped := make([]Vec, len(points))
		for i, p := range points {
			mapped[len(points)-1-i] = p.Mul(scale).Add(Vec{20, -7})
		}
		q := FourierCorrection{Index: 0, Target: edit.Target.Mul(scale).Add(Vec{20, -7}), Reach: .2}
		other, err := CorrectFourierOutline(mapped, q)
		if err != nil {
			t.Fatal(err)
		}
		for i, p := range other {
			want := got[len(got)-1-i].Mul(scale).Add(Vec{20, -7})
			if p.Sub(want).Norm() > 1e-10 {
				t.Fatalf("similarity/reversal %g: %v vs %v", scale, p, want)
			}
		}
	}
}

func TestFourierOutlineCorrectionRefusals(t *testing.T) {
	points := []Vec{{0, 0}, {1, 0}, {0, 1}}
	valid := FourierCorrection{Index: 1, Target: Vec{2, 0}, Reach: .1}
	for _, edit := range []FourierCorrection{
		{Index: -1, Target: Vec{2, 0}, Reach: .1},
		{Index: 3, Target: Vec{2, 0}, Reach: .1},
		{Index: 1, Target: Vec{math.NaN(), 0}, Reach: .1},
		{Index: 1, Target: Vec{100001, 0}, Reach: .1},
		{Index: 1, Target: Vec{2, 0}, Reach: 0},
		{Index: 1, Target: Vec{2, 0}, Reach: .3},
	} {
		if _, err := CorrectFourierOutline(points, edit); err == nil {
			t.Fatalf("accepted invalid edit %+v", edit)
		}
	}
	for _, p := range [][]Vec{nil, {{0, 0}, {0, 0}, {0, 0}}, {{0, 0}, {1e-8, 0}, {0, 1e-8}}, {{0, 0}, {math.Inf(1), 0}, {0, 1}}, make([]Vec, 4097)} {
		if _, err := CorrectFourierOutline(p, valid); err == nil {
			t.Fatalf("accepted invalid outline of %d points", len(p))
		}
	}
}

func TestFourierOutlineCorrectionHelpsFlawedDrawing(t *testing.T) {
	// One accidental outward point in a densely drawn circular loop. A local
	// correction must recover the intended round shape without a global fit.
	points := make([]Vec, 128)
	for i := range points {
		a := 2 * math.Pi * float64(i) / 128
		points[i] = Vec{math.Cos(a), math.Sin(a)}
	}
	points[0].X = 1.6
	corrected, err := CorrectFourierOutline(points, FourierCorrection{Index: 0, Target: Vec{1, 0}, Reach: .05})
	if err != nil {
		t.Fatal(err)
	}
	fit := func(p []Vec) FourierFitResult {
		f, err := FitFourier(p, true)
		if err != nil {
			t.Fatal(err)
		}
		r, err := f.Select(8)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	a, b := fit(points), fit(corrected)
	// Observe the actual returned Fourier geometry against the intended unit
	// circle, independently of the fitting residual against its edited target.
	radialError := func(r FourierFitResult) float64 {
		var total float64
		for i := 0; i < 256; i++ {
			u := 2 * math.Pi * float64(i) / 256
			var p Vec
			for _, term := range r.Terms {
				angle := term.Frequency*u + term.Phase
				p = p.Add(Vec{term.Radius * math.Cos(angle), term.Radius * math.Sin(angle)})
			}
			total += math.Pow(p.Norm()-1, 2)
		}
		return math.Sqrt(total / 256)
	}
	if radialError(b) >= radialError(a)*.6 {
		t.Fatalf("correction did not help: %g -> %g", radialError(a), radialError(b))
	}
	if a.RMS == b.RMS || a.Length == b.Length {
		t.Fatal("residual/length did not follow edited target")
	}
}

func TestFourierOutlineCorrectionAtPointCap(t *testing.T) {
	points := make([]Vec, FourierFitMaxPoints)
	for i := range points {
		a := 2 * math.Pi * float64(i) / float64(len(points))
		points[i] = Vec{math.Cos(a), math.Sin(a)}
	}
	for _, reach := range []float64{.05, .1, .2} {
		out, err := CorrectFourierOutline(points, FourierCorrection{Index: 2048, Target: Vec{-1.2, -.1}, Reach: reach})
		if err != nil {
			t.Fatal(err)
		}
		if len(out) != FourierFitMaxPoints || out[0] != points[0] || out[2048] != (Vec{-1.2, -.1}) {
			t.Fatal("lost cap, locality or exact target")
		}
		f, err := FitFourier(out, true)
		if err != nil {
			t.Fatal(err)
		}
		r, err := f.Select(16)
		if err != nil || len(r.Terms) != 16 || r.RMS <= 0 {
			t.Fatalf("invalid corrected fit: %+v %v", r, err)
		}
	}
	// The target is legal, but a neighboring point's weighted displacement
	// would leave the admitted coordinate window. Refuse, never clamp it.
	near := []Vec{{99999, 0}, {100000, 0}, {100000, 1}, {99999, 1}, {0, 1}, {0, 0}}
	if _, err := CorrectFourierOutline(near, FourierCorrection{Index: 0, Target: Vec{100000, 0}, Reach: .2}); err == nil {
		t.Fatal("accepted out-of-range displaced neighbor")
	}
}
