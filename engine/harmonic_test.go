package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func lissajousRequest(l Lissajous, lo, hi float64) Request {
	q := request("offset", "", "", lo, hi)
	q.Curve = Curve{Format: "lissajous", Lissajous: l, Min: lo, Max: hi}
	return q
}

func fourierRequest(terms []Term, lo, hi float64) Request {
	q := request("offset", "", "", lo, hi)
	q.Curve = Curve{Format: "fourier", Terms: terms, Min: lo, Max: hi}
	return q
}

func generated(t *testing.T, c Curve) curveFunc {
	t.Helper()
	c.Min, c.Max = 0, 1
	f, err := compile(c)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func harmonic(t *testing.T, q Request) *HarmonicResult {
	t.Helper()
	r := compute(t, q)
	if r.Harmonic == nil {
		t.Fatal("no harmonic result")
	}
	return r.Harmonic
}

// Parameters spread over several periods, including negative ones.
var harmonicTs = []float64{-7.3, -2, -.4, 0, .31, 1, 2.5, 4.4, 9.9, 31}

func TestLissajousKnownCases(t *testing.T) {
	for _, tc := range []struct {
		name     string
		l        Lissajous
		residual func(p Vec) float64
	}{
		// Equal frequencies a quarter turn apart trace a circle; in phase, a
		// segment of slope B/A.
		{"circle", Lissajous{2, 2, 1, 1, math.Pi / 2}, func(p Vec) float64 { return p.Norm() - 2 }},
		{"ellipse", Lissajous{3, 1, 1, 1, math.Pi / 2}, func(p Vec) float64 { return p.X*p.X/9 + p.Y*p.Y - 1 }},
		{"segment", Lissajous{2, 3, 1, 1, 0}, func(p Vec) float64 { return 3*p.X - 2*p.Y }},
		{"opposed segment", Lissajous{2, 3, 1, 1, math.Pi}, func(p Vec) float64 { return 3*p.X + 2*p.Y }},
		// x = cos t, y = sin 2t = 2 sin t cos t: the lemniscate of Gerono.
		{"Gerono", Lissajous{1, 1, 1, 2, math.Pi / 2}, func(p Vec) float64 { return p.Y*p.Y - 4*p.X*p.X*(1-p.X*p.X) }},
		// x = cos 2t = 1 − 2 sin²t, y = sin t: a parabolic arc.
		{"parabola", Lissajous{1, 1, 2, 1, math.Pi / 2}, func(p Vec) float64 { return p.X - 1 + 2*p.Y*p.Y }},
		// x = sin 3t = 3 sin t − 4 sin³t with y = sin t: a cubic graph.
		{"Chebyshev", Lissajous{1, 1, 3, 1, 0}, func(p Vec) float64 { return p.X - 3*p.Y + 4*p.Y*p.Y*p.Y }},
	} {
		f := generated(t, Curve{Format: "lissajous", Lissajous: tc.l})
		for _, u := range harmonicTs {
			p := f(u)
			if e := tc.residual(p); math.Abs(e) > 1e-12 {
				t.Fatalf("%s at t=%g: %v has residual %g", tc.name, u, p, e)
			}
			// The definition itself: x = A sin(mt+φ), y = B sin(nt).
			closeVec(t, &p, Vec{tc.l.AmplitudeX * math.Sin(tc.l.FrequencyX*u+tc.l.Phase), tc.l.AmplitudeY * math.Sin(tc.l.FrequencyY*u)}, 0)
		}
	}
}

// A Lissajous figure is a four-term Fourier curve: sin θ = (e^{i(θ−π/2)} +
// e^{−i(θ−π/2)})/2, and i·sin ψ = (e^{iψ} + e^{i(π−ψ)})/2.
func TestLissajousIsAFourierCurve(t *testing.T) {
	l := Lissajous{1.3, .7, 3, -2.5, .4}
	f := generated(t, Curve{Format: "lissajous", Lissajous: l})
	g := generated(t, Curve{Format: "fourier", Terms: []Term{
		{l.FrequencyX, l.AmplitudeX / 2, l.Phase - math.Pi/2},
		{-l.FrequencyX, l.AmplitudeX / 2, math.Pi/2 - l.Phase},
		{l.FrequencyY, l.AmplitudeY / 2, 0},
		{-l.FrequencyY, l.AmplitudeY / 2, math.Pi},
	}})
	for _, u := range harmonicTs {
		p := f(u)
		closeVec(t, &p, g(u), 1e-13)
	}
}

func TestFourierSingleTermIsACircle(t *testing.T) {
	for _, term := range []Term{{1, 1, 0}, {3, .5, 1}, {-2, 2, -.3}, {.37, 4, 2}} {
		f := generated(t, Curve{Format: "fourier", Terms: []Term{term}})
		for _, u := range harmonicTs {
			p := f(u)
			a := term.Frequency*u + term.Phase
			closeVec(t, &p, Vec{term.Radius * math.Cos(a), term.Radius * math.Sin(a)}, 1e-12)
		}
		// One turn has signed area πr², negative for a negative frequency,
		// which turns clockwise; the evolute is the circle's center.
		period := 2 * math.Pi / math.Abs(term.Frequency)
		q := fourierRequest([]Term{term}, 0, period)
		q.Kind, q.Samples = "evolute", 2001
		r := compute(t, q)
		area := 0.0
		for j := 1; j < len(r.Base); j++ {
			area += r.Base[j-1].Cross(*r.Base[j]) / 2
		}
		want := math.Copysign(math.Pi*term.Radius*term.Radius, term.Frequency)
		if math.Abs(area-want) > 1e-4*math.Abs(want) {
			t.Fatalf("%+v: signed area %g, want %g", term, area, want)
		}
		for _, p := range r.Derived {
			closeVec(t, p, Vec{}, 1e-6*term.Radius)
		}
		h := r.Harmonic
		if math.Abs(h.Period-period) > 1e-12*period || h.Constant || h.Whole != (term.Frequency == math.Trunc(term.Frequency)) {
			t.Fatalf("%+v: %+v", term, h)
		}
	}
}

// Terms of zero radius leave the curve and its period alone, whatever their
// frequency; a zero-frequency term translates the curve.
func TestFourierZeroTerms(t *testing.T) {
	terms := []Term{{1, 1, 0}, {-4, .4, .5}}
	with := append(append([]Term{}, terms...), Term{math.Sqrt2, 0, 1}, Term{0, .3, math.Pi / 2})
	f := generated(t, Curve{Format: "fourier", Terms: terms})
	g := generated(t, Curve{Format: "fourier", Terms: with})
	for _, u := range harmonicTs {
		p := g(u)
		closeVec(t, &p, f(u).Add(Vec{0, .3}), 1e-13)
	}
	a := harmonic(t, fourierRequest(terms, 0, 1))
	b := harmonic(t, fourierRequest(with, 0, 1))
	if a.Period != 2*math.Pi || b.Period != a.Period || !b.Whole || b.Constant {
		t.Fatalf("zero terms changed closure: %+v %+v", a, b)
	}
	// Nothing turns: the curve is a single point, with no period.
	for _, still := range [][]Term{
		{{0, 1, 0}, {5, 0, 1}},
		{{math.Pi, 0, 0}},
	} {
		h := harmonic(t, fourierRequest(still, 0, 1))
		if !h.Constant || h.Period != 0 || h.Whole {
			t.Fatalf("%+v: %+v", still, h)
		}
	}
	if h := harmonic(t, lissajousRequest(Lissajous{1, 1, 0, 0, 1}, 0, 1)); !h.Constant || h.Period != 0 {
		t.Fatalf("still Lissajous: %+v", h)
	}
	// A still coordinate leaves the other moving: a segment on the x-axis.
	if h := harmonic(t, lissajousRequest(Lissajous{1, 1, 2, 0, 1}, 0, 1)); h.Constant || h.Period != math.Pi || !h.Whole {
		t.Fatalf("half-still Lissajous: %+v", h)
	}
	if h := harmonic(t, lissajousRequest(Lissajous{1, 0, 2, math.Sqrt2, 1}, 0, 1)); h.Period != math.Pi {
		t.Fatalf("zero amplitude kept its frequency: %+v", h)
	}
	if h := harmonic(t, lissajousRequest(Lissajous{0, 1, math.Sqrt2, 2, 1}, 0, 1)); h.Period != math.Pi {
		t.Fatalf("zero amplitude kept its frequency: %+v", h)
	}
}

// The period is the smallest shift that repeats the curve. Whole-number
// frequencies close exactly on 2π/gcd; commensurate real frequencies close
// on their common period; other ratios are never forced closed.
func TestHarmonicPeriod(t *testing.T) {
	fourier := func(freqs ...float64) Curve {
		c := Curve{Format: "fourier"}
		for k, f := range freqs {
			c.Terms = append(c.Terms, Term{f, 1 / float64(k+1), float64(k) * .7})
		}
		return c
	}
	for _, tc := range []struct {
		name   string
		c      Curve
		period float64
		whole  bool
	}{
		{"star", fourier(1, -4, 6), 2 * math.Pi, true},
		{"common factor", fourier(2, -4, 6), math.Pi, true},
		{"coprime", fourier(3, 2), 2 * math.Pi, true},
		{"sevenths", fourier(1, 3.0/7), 14 * math.Pi, false},
		{"halves", fourier(1, 999.5), 4 * math.Pi, false},
		{"thirds", fourier(-2.0/3, 4.0/3), 3 * math.Pi, false},
		{"irrational multiples", fourier(math.Sqrt2, -3*math.Sqrt2), 2 * math.Pi / math.Sqrt2, false},
		{"incommensurate", fourier(1, math.Sqrt2), 0, false},
		{"too long to trace", fourier(1, 1.0/1009), 0, false},
		{"near miss", fourier(1, 2+1e-9), 0, false},
		{"slower than the widest domain", fourier(1e-5), 0, false},
		{"thirty-firsts and thirty-sevenths", fourier(1, 1.0/31, 1.0/37), 0, false},
		{"fifths and sevenths", fourier(1, 1.0/5, 1.0/7), 70 * math.Pi, false},
		{"3:2 figure", Curve{Format: "lissajous", Lissajous: Lissajous{1, 1, 3, 2, math.Pi / 2}}, 2 * math.Pi, true},
		{"slow x", Curve{Format: "lissajous", Lissajous: Lissajous{1, 1, 1.5, 1, 0}}, 4 * math.Pi, false},
		{"opposed", Curve{Format: "lissajous", Lissajous: Lissajous{1, 1, -4, 6, 0}}, math.Pi, true},
		{"irrational Lissajous", Curve{Format: "lissajous", Lissajous: Lissajous{1, 1, math.Sqrt2, 1, 0}}, 0, false},
	} {
		c := tc.c
		c.Min, c.Max = 0, 1
		q := request("offset", "", "", 0, 1)
		q.Curve = c
		h := harmonic(t, q)
		if math.Abs(h.Period-tc.period) > 1e-12*tc.period || h.Whole != tc.whole || h.Constant {
			t.Fatalf("%s: period %v whole %v constant %v, want %v %v", tc.name, h.Period, h.Whole, h.Constant, tc.period, tc.whole)
		}
		if tc.period == 0 {
			continue
		}
		f := generated(t, c)
		repeats := func(shift float64) bool {
			for _, u := range harmonicTs {
				if f(u+shift).Sub(f(u)).Norm() > 1e-9 {
					return false
				}
			}
			return true
		}
		if !repeats(h.Period) {
			t.Fatalf("%s does not repeat after %g", tc.name, h.Period)
		}
		for k := 2; k <= 12; k++ {
			if repeats(h.Period / float64(k)) {
				t.Fatalf("%s already repeats after %g/%d", tc.name, h.Period, k)
			}
		}
	}
}

// The engine differentiates generated curves numerically; on harmonics that
// agrees with the analytic derivatives z′ = Σ i k r e^{iθ}, z″ = −Σ k² r e^{iθ}.
func TestHarmonicDerivatives(t *testing.T) {
	terms := []Term{{1, 1, .2}, {-4, .45, 1}, {6, .2, -.5}, {-9, .1, 2}}
	f := generated(t, Curve{Format: "fourier", Terms: terms})
	lo, hi := 0.0, 2*math.Pi
	for _, u := range []float64{0, .3, 1.7, 3, 5.9, hi} {
		var d, dd Vec
		for _, k := range terms {
			a := k.Frequency*u + k.Phase
			e := Vec{math.Cos(a), math.Sin(a)}
			d = d.Add(e.Perp().Mul(k.Frequency * k.Radius))
			dd = dd.Add(e.Mul(-k.Frequency * k.Frequency * k.Radius))
		}
		gd, gdd := derivatives(f, u, lo, hi)
		if gd.Sub(d).Norm() > 1e-9*d.Norm() || gdd.Sub(dd).Norm() > 1e-5*dd.Norm() {
			t.Fatalf("t=%g: derivatives %v %v, want %v %v", u, gd, gdd, d, dd)
		}
	}
	l := Lissajous{1.5, .8, 3, 2, .6}
	g := generated(t, Curve{Format: "lissajous", Lissajous: l})
	for _, u := range []float64{0, 1, 2.2, 6} {
		d := Vec{l.AmplitudeX * l.FrequencyX * math.Cos(l.FrequencyX*u+l.Phase), l.AmplitudeY * l.FrequencyY * math.Cos(l.FrequencyY*u)}
		dd := Vec{-l.AmplitudeX * l.FrequencyX * l.FrequencyX * math.Sin(l.FrequencyX*u+l.Phase), -l.AmplitudeY * l.FrequencyY * l.FrequencyY * math.Sin(l.FrequencyY*u)}
		gd, gdd := derivatives(g, u, lo, hi)
		if gd.Sub(d).Norm() > 1e-9*d.Norm() || gdd.Sub(dd).Norm() > 1e-5*dd.Norm() {
			t.Fatalf("Lissajous t=%g: derivatives %v %v, want %v %v", u, gd, gdd, d, dd)
		}
	}
	// So the evolute of a sum of circles matches the analytic one.
	q := fourierRequest(terms[:2], lo, hi)
	q.Kind, q.Samples = "evolute", 1500
	r := compute(t, q)
	for j := 0; j < q.Samples; j += 37 {
		u := sampleT(q, j)
		var p, d, dd Vec
		for _, k := range terms[:2] {
			a := k.Frequency*u + k.Phase
			e := Vec{math.Cos(a), math.Sin(a)}
			p = p.Add(e.Mul(k.Radius))
			d = d.Add(e.Perp().Mul(k.Frequency * k.Radius))
			dd = dd.Add(e.Mul(-k.Frequency * k.Frequency * k.Radius))
		}
		want := Evolute(p, d, dd)
		if want == nil {
			continue
		}
		closeVec(t, r.Derived[j], *want, 1e-5)
	}
}

// Each representative sample shows its rotating vectors: for a Fourier curve
// a chain of circles, one per term in the order given, each centered where
// the previous vector ends; for a Lissajous figure a point turning on each
// guide circle, level with the traced point in the coordinate it projects.
func TestHarmonicConstructionGeometry(t *testing.T) {
	terms := []Term{{1, 1, .2}, {-4, .45, 1}, {0, .3, 0}, {6, 0, 0}}
	q := fourierRequest(terms, 0, 2*math.Pi)
	r := compute(t, q)
	h := r.Harmonic
	if len(h.Guides) != 0 || len(h.Radii) != 4 || h.Radii[1] != .45 || h.Radii[3] != 0 {
		t.Fatalf("fourier geometry %+v %+v", h.Guides, h.Radii)
	}
	if len(h.Positions) != q.Lines || h.Positions[0].SampleIndex != 0 || h.Positions[q.Lines-1].SampleIndex != q.Samples-1 {
		t.Fatalf("positions %d", len(h.Positions))
	}
	for k, s := range h.Positions {
		if k > 0 && s.SampleIndex <= h.Positions[k-1].SampleIndex {
			t.Fatal("positions out of order")
		}
		u := sampleT(q, s.SampleIndex)
		if len(s.Joints) != 4 || s.Joints[0] != (Vec{}) {
			t.Fatalf("joints %v", s.Joints)
		}
		for i, term := range terms {
			end := s.Point
			if i < 3 {
				end = s.Joints[i+1]
			}
			a := term.Frequency*u + term.Phase
			arm := end.Sub(s.Joints[i])
			closeVec(t, &arm, Vec{math.Cos(a), math.Sin(a)}.Mul(term.Radius), 1e-12)
		}
		closeVec(t, r.Base[s.SampleIndex], s.Point, 0)
	}
	l := Lissajous{2, 1, 3, 2, math.Pi / 2}
	q = lissajousRequest(l, 0, 2*math.Pi)
	q.Lines = 30
	r = compute(t, q)
	h = r.Harmonic
	// The x guide sits above the figure and the y guide to its right, a
	// quarter of the larger amplitude clear of it.
	if len(h.Guides) != 2 || len(h.Radii) != 0 ||
		h.Guides[0] != (Circle{Center: Vec{0, 1 + .5 + 2}, Radius: 2}) ||
		h.Guides[1] != (Circle{Center: Vec{2 + .5 + 1, 0}, Radius: 1}) {
		t.Fatalf("guides %+v radii %v", h.Guides, h.Radii)
	}
	if len(h.Positions) != 30 {
		t.Fatalf("positions %d", len(h.Positions))
	}
	for _, s := range h.Positions {
		u := sampleT(q, s.SampleIndex)
		x, y := s.Joints[0], s.Joints[1]
		// Each point turns counterclockwise at its own frequency, the x
		// guide's from straight down and the y guide's from the right.
		a, b := l.FrequencyX*u+l.Phase-math.Pi/2, l.FrequencyY*u
		closeVec(t, &x, h.Guides[0].Center.Add(Vec{math.Cos(a), math.Sin(a)}.Mul(2)), 1e-12)
		closeVec(t, &y, h.Guides[1].Center.Add(Vec{math.Cos(b), math.Sin(b)}), 1e-12)
		if len(s.Joints) != 2 || math.Abs(x.X-s.Point.X) > 1e-12 || math.Abs(y.Y-s.Point.Y) > 1e-12 {
			t.Fatalf("projections %v to %v", s.Joints, s.Point)
		}
		closeVec(t, r.Base[s.SampleIndex], s.Point, 0)
	}
	// Positions persist where the construction is undefined: the evolute of
	// a Lissajous figure fails at its inflections and turning points.
	q.Kind = "evolute"
	if r = compute(t, q); len(r.Harmonic.Positions) != 30 {
		t.Fatalf("evolute positions %d", len(r.Harmonic.Positions))
	}
	// The deltoid 2e^{it} + e^{−2it} has cusps at t = 0, 2π/3, 4π/3, and 2π,
	// where its evolute is undefined; its circles are still shown there.
	q = fourierRequest([]Term{{1, 2, 0}, {-2, 1, 0}}, 0, 2*math.Pi)
	q.Kind, q.Samples, q.Lines = "evolute", 601, 4
	if r = compute(t, q); len(r.Harmonic.Positions) != 4 || len(r.Rays) != 0 || r.Derived[200] != nil {
		t.Fatalf("cusp positions %d rays %d", len(r.Harmonic.Positions), len(r.Rays))
	}
	// Other formats carry no harmonic block.
	b, _ := json.Marshal(compute(t, request("evolute", "cos(t)", "sin(t)", 0, 1)))
	if strings.Contains(string(b), "harmonic") {
		t.Fatalf("non-harmonic result mentions harmonics: %.200s", b)
	}
}

// Harmonic curves compose with every construction, like any other curve.
func TestHarmonicConstructions(t *testing.T) {
	// The inverse of a circle through the center of inversion is a line.
	q := fourierRequest([]Term{{0, 1, 0}, {1, 1, math.Pi}}, 0, 2*math.Pi)
	q.Kind, q.Inversion = "inversion", Inversion{Center: Vec{}, Radius: 2}
	// Rounding leaves the samples at t = 0 and 2π a hair off the center, with
	// images far out along the line.
	for _, p := range compute(t, q).Derived {
		if p != nil && math.Abs(p.X-2) > 1e-9*math.Max(1, p.Norm()) {
			t.Fatalf("image %v off the line x = 2", p)
		}
	}
	// The pedal of a centered circle about its center is itself.
	q = lissajousRequest(Lissajous{1.5, 1.5, 1, 1, math.Pi / 2}, 0, 2*math.Pi)
	q.Kind = "pedal"
	r := compute(t, q)
	for j, p := range r.Derived {
		closeVec(t, p, *r.Base[j], 1e-9)
	}
}

func TestHarmonicInvalid(t *testing.T) {
	good := Lissajous{1, 1, 3, 2, 0}
	for _, tc := range []struct {
		l    Lissajous
		want string
	}{
		{Lissajous{-1, 1, 3, 2, 0}, "amplitudes"},
		{Lissajous{1, 1e5 + 1, 3, 2, 0}, "amplitudes"},
		{Lissajous{math.NaN(), 1, 3, 2, 0}, "amplitudes"},
		{Lissajous{1, 1, 1001, 2, 0}, "frequencies"},
		{Lissajous{1, 1, 3, math.Inf(-1), 0}, "frequencies"},
		{Lissajous{1, 1, 3, 2, 1e6 + 1}, "phase"},
		{Lissajous{1, 1, 3, 2, math.NaN()}, "phase"},
	} {
		if _, err := Compute(lissajousRequest(tc.l, 0, 1)); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("accepted %+v: %v", tc.l, err)
		}
	}
	for _, tc := range []struct {
		terms []Term
		want  string
	}{
		{nil, "1–16 terms"},
		{make([]Term, 17), "1–16 terms"},
		{[]Term{{1, 1, 0}, {1, -1, 0}}, "term 2: the radius"},
		{[]Term{{1, math.Inf(1), 0}}, "term 1: the radius"},
		{[]Term{{1, 1e5 + 1, 0}}, "term 1: the radius"},
		{[]Term{{-1000.5, 1, 0}}, "term 1: the frequency"},
		{[]Term{{math.NaN(), 1, 0}}, "term 1: the frequency"},
		{[]Term{{1, 1, 0}, {2, 1, 0}, {3, 1, -1e6 - 1}}, "term 3: the phase"},
	} {
		if _, err := Compute(fourierRequest(tc.terms, 0, 1)); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("accepted %+v: %v", tc.terms, err)
		}
	}
	// Generators still check the domain.
	if _, err := Compute(lissajousRequest(good, 1, 0)); err == nil || !strings.Contains(err.Error(), "greater than") {
		t.Fatalf("Lissajous skipped domain checks: %v", err)
	}
	// Sixteen terms at the frequency bounds are accepted.
	terms := make([]Term, 16)
	for k := range terms {
		terms[k] = Term{1000 * float64(1-2*(k%2)), 1, 1e6}
	}
	if _, err := Compute(fourierRequest(terms, 0, 1)); err != nil {
		t.Fatal(err)
	}
}

func TestHarmonicResultJSON(t *testing.T) {
	var decoded Request
	if err := json.Unmarshal([]byte(`{"curve":{"format":"fourier","terms":[{"frequency":-3,"radius":0.5,"phase":0.25}],"lissajous":{"amplitudeX":1,"amplitudeY":2,"frequencyX":3,"frequencyY":4,"phase":0.5}}}`), &decoded); err != nil ||
		len(decoded.Curve.Terms) != 1 || decoded.Curve.Terms[0] != (Term{-3, .5, .25}) ||
		decoded.Curve.Lissajous != (Lissajous{1, 2, 3, 4, .5}) {
		t.Fatalf("harmonic JSON fields: %+v %v", decoded.Curve, err)
	}
	q := fourierRequest([]Term{{1, 1, 0}}, 0, 1)
	q.Lines = 2
	b, _ := json.Marshal(compute(t, q).Harmonic)
	for _, key := range []string{`"period":`, `"whole":true`, `"constant":false`, `"guides":[]`, `"radii":[1]`, `"positions":[{"sampleIndex":0,"joints":[{"x":0,"y":0}],"point":{"x":1,"y":0}}`} {
		if !strings.Contains(string(b), key) {
			t.Fatalf("missing %s in %s", key, b)
		}
	}
	b, _ = json.Marshal(compute(t, lissajousRequest(Lissajous{1, 1, 1, 1, 0}, 0, 1)).Harmonic)
	if !strings.Contains(string(b), `"radii":[]`) {
		t.Fatalf("Lissajous radii: %s", b)
	}
}
