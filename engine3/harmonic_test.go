package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func harmonicStudy(lo, hi float64, center Vec3, terms ...HarmonicTerm) Request {
	return Request{Format: "harmonic", Construction: "developable", Length: 1, Samples: 480, Lines: 24,
		Harmonic: HarmonicCurve{Center: center, Terms: terms, Min: lo, Max: hi}}
}

func harmonic(t *testing.T, c Request) Result {
	t.Helper()
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Harmonic == nil {
		t.Fatal("missing harmonic result")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	return r
}

// sampleT is the engine's parameter at sample i.
func sampleT(c Request, i int) float64 {
	n := float64(c.Samples)
	return c.Harmonic.Min*(1-float64(i)/n) + c.Harmonic.Max*float64(i)/n
}

func TestHarmonicSingleTermEllipse(t *testing.T) {
	// Perpendicular generating vectors of lengths √5 and 1 about a moved center.
	a, b, center := Vec3{2, 0, 1}, Vec3{0, 1, 0}, Vec3{1, -1, 2}
	c := harmonicStudy(0, 2*math.Pi, center, HarmonicTerm{Frequency: 1, Cosine: a, Sine: b})
	r := harmonic(t, c)
	normal := a.cross(b)
	for i, p := range r.Base {
		u := p.sub(center)
		x, y := u.dot(a)/a.dot(a), u.dot(b)/b.dot(b)
		if math.Abs(x*x+y*y-1) > 1e-12 || math.Abs(u.dot(normal)) > 1e-12 {
			t.Fatalf("sample %d off the ellipse: %+v", i, *p)
		}
		near(t, p, center.add(a.mul(math.Cos(sampleT(c, i)))).add(b.mul(math.Sin(sampleT(c, i)))), 1e-12)
	}
	h := r.Harmonic
	if h.Period != 2*math.Pi || !h.Whole || !h.Closed || r.Base[len(r.Base)-1] != r.Base[0] {
		t.Fatalf("closure %+v", h)
	}
	if len(h.Terms) != 1 || h.Terms[0].Cosine != a || h.Center != center {
		t.Fatalf("echo %+v", h)
	}
	if len(h.Positions) != c.Lines {
		t.Fatalf("%d positions", len(h.Positions))
	}
	for _, s := range h.Positions {
		if len(s.Joints) != 1 || s.Joints[0] != center || s.Point != *r.Base[s.SampleIndex] {
			t.Fatalf("position %+v", s)
		}
	}
	// A plane ellipse has no inflection, so the whole developable is meshed.
	if r.Omitted != 0 || len(r.Mesh) == 0 {
		t.Fatalf("omitted %d", r.Omitted)
	}
}

func TestHarmonicAnalyticDerivatives(t *testing.T) {
	c := harmonicStudy(-1, 3, Vec3{0.3, 0, -1},
		HarmonicTerm{Frequency: 1, Cosine: Vec3{2, 0, 0}, Sine: Vec3{0, 2, 0.5}},
		HarmonicTerm{Frequency: -3, Cosine: Vec3{0, 0.4, 0.7}, Sine: Vec3{0.2, 0, 0}},
		HarmonicTerm{Frequency: math.Sqrt2, Cosine: Vec3{0, 0, 0.3}, Sine: Vec3{0.1, 0.1, 0}},
		HarmonicTerm{Frequency: 0, Cosine: Vec3{1, 1, 1}, Sine: Vec3{9, 9, 9}})
	evaluate, lo, hi, closed, err := compile(c, nil)
	if err != nil || lo != -1 || hi != 3 || closed {
		t.Fatal(lo, hi, closed, err)
	}
	for _, u := range []float64{-1, 0, 0.37, 1.9, 3} {
		r, v, a, ok := evaluate(u)
		h := 1e-5
		left, _, _, _ := evaluate(u - h)
		right, _, _, _ := evaluate(u + h)
		if !ok {
			t.Fatal("analytic sample refused")
		}
		near(t, v, right.sub(left).mul(1/(2*h)), 1e-8)
		near(t, a, right.add(left).sub(r.mul(2)).mul(1/(h*h)), 5e-5)
	}
	// A zero-frequency term is the fixed translation A: sin(0) = 0.
	r, _, _, _ := evaluate(0)
	near(t, r, Vec3{0.3 + 2 + 1, 0.4 + 1, -1 + 0.7 + 0.3 + 1}, 1e-12)
}

func TestHarmonicPlanarReduction(t *testing.T) {
	// A planar Fourier term ρe^{i(kt+φ)} has A = ρ(cos φ, sin φ) and
	// B = ρ(−sin φ, cos φ): the complex sum and the vector sum agree.
	type term struct{ k, rho, phi float64 }
	planar := []term{{1, 2, 0.3}, {-2, 0.8, 1}, {5, 0.25, -2}}
	var terms []HarmonicTerm
	for _, p := range planar {
		terms = append(terms, HarmonicTerm{p.k, Vec3{p.rho * math.Cos(p.phi), p.rho * math.Sin(p.phi), 0}, Vec3{-p.rho * math.Sin(p.phi), p.rho * math.Cos(p.phi), 0}})
	}
	c := harmonicStudy(0, 2*math.Pi, Vec3{}, terms...)
	r := harmonic(t, c)
	for i, p := range r.Base {
		if p == nil {
			continue
		}
		var x, y float64
		for _, q := range planar {
			x += q.rho * math.Cos(q.k*sampleT(c, i)+q.phi)
			y += q.rho * math.Sin(q.k*sampleT(c, i)+q.phi)
		}
		near(t, p, Vec3{x, y, 0}, 1e-12)
	}
	for _, s := range r.Harmonic.Positions {
		for _, j := range s.Joints {
			if j.Z != 0 {
				t.Fatal("planar joint left its plane")
			}
		}
	}
	if !r.Harmonic.Closed || r.Harmonic.Period != 2*math.Pi {
		t.Fatalf("%+v", r.Harmonic)
	}
}

func TestHarmonicClosure(t *testing.T) {
	x, y := Vec3{1, 0, 0}, Vec3{0, 1, 0.5}
	zero := HarmonicTerm{Frequency: math.Sqrt2}
	for _, tc := range []struct {
		name          string
		frequencies   []float64
		lo, hi        float64
		period        float64
		whole, closed bool
		extra         []HarmonicTerm
	}{
		{"coprime whole numbers", []float64{1, 3}, 0, 2 * math.Pi, 2 * math.Pi, true, true, nil},
		{"one period of even numbers", []float64{2, -4}, 1, 1 + math.Pi, math.Pi, true, true, nil},
		{"two periods", []float64{2, -4}, 0, 2 * math.Pi, math.Pi, true, true, nil},
		{"part of a period", []float64{2, -4}, 0, 1.5 * math.Pi, math.Pi, true, false, nil},
		{"commensurate irrationals", []float64{math.Sqrt2, 3 * math.Sqrt2}, 0, 2 * math.Pi / math.Sqrt2, 2 * math.Pi / math.Sqrt2, false, true, nil},
		{"rational frequencies", []float64{0.5, 1.5}, 0, 4 * math.Pi, 4 * math.Pi, false, true, nil},
		{"incommensurate frequencies are left open", []float64{1, math.Sqrt2}, 0, 20 * math.Pi, 0, false, false, nil},
		{"a zero term does not change the period", []float64{1, 3}, 0, 2 * math.Pi, 2 * math.Pi, true, true, []HarmonicTerm{zero}},
	} {
		// Radii fall faster than frequencies rise, so the curve never stops.
		var terms []HarmonicTerm
		for k, f := range tc.frequencies {
			w := 1 / float64((k+1)*(k+1))
			terms = append(terms, HarmonicTerm{Frequency: f, Cosine: x.mul(w), Sine: y.mul(w)})
		}
		c := harmonicStudy(tc.lo, tc.hi, Vec3{}, append(terms, tc.extra...)...)
		r := harmonic(t, c)
		h := r.Harmonic
		if math.Abs(h.Period-tc.period) > 1e-12*tc.period || h.Whole != tc.whole || h.Closed != tc.closed {
			t.Errorf("%s: period %g whole %v closed %v", tc.name, h.Period, h.Whole, h.Closed)
		}
		first, last := r.Base[0], r.Base[len(r.Base)-1]
		if tc.closed != (first == last) {
			t.Errorf("%s: seam shared %v", tc.name, first == last)
		}
		if !tc.closed && last.sub(*first).norm() < 1e-3 {
			t.Errorf("%s: an open arc was forced closed", tc.name)
		}
	}
}

func TestHarmonicZeroTermsKeepTheirIdentity(t *testing.T) {
	one := HarmonicTerm{Frequency: 2, Cosine: Vec3{2, 0, 0}, Sine: Vec3{0, 2, 0}}
	two := HarmonicTerm{Frequency: -3, Cosine: Vec3{0, 0, 0.6}, Sine: Vec3{0.6, 0, 0}}
	zero := HarmonicTerm{Frequency: 7}
	with := harmonic(t, harmonicStudy(0, 2*math.Pi, Vec3{}, one, zero, two))
	without := harmonic(t, harmonicStudy(0, 2*math.Pi, Vec3{}, one, two))
	for i := range with.Base {
		if *with.Base[i] != *without.Base[i] {
			t.Fatalf("sample %d moved", i)
		}
	}
	if len(with.Harmonic.Terms) != 3 || with.Harmonic.Terms[1] != zero {
		t.Fatalf("terms %+v", with.Harmonic.Terms)
	}
	for k, s := range with.Harmonic.Positions {
		// The zero vector starts and ends at the same joint.
		if len(s.Joints) != 3 || s.Joints[1] != s.Joints[2] || s.Joints[1] != without.Harmonic.Positions[k].Joints[1] {
			t.Fatalf("position %+v", s)
		}
	}
}

func TestHarmonicTranslatedStudy(t *testing.T) {
	terms := []HarmonicTerm{
		{Frequency: 2, Cosine: Vec3{2, 0, 0}, Sine: Vec3{0, 2, 0}},
		{Frequency: -3, Cosine: Vec3{0, 0, 0.6}, Sine: Vec3{0.6, 0, 0.1}},
	}
	d := Vec3{3, -7, 11}
	a := harmonic(t, harmonicStudy(0, 2*math.Pi, Vec3{}, terms...))
	b := harmonic(t, harmonicStudy(0, 2*math.Pi, d, terms...))
	for i := range a.Base {
		near(t, b.Base[i], a.Base[i].add(d), 1e-12)
		if b.Breaks[i] != a.Breaks[i] {
			t.Fatal("breaks changed")
		}
	}
	for k, s := range a.Harmonic.Positions {
		for j := range s.Joints {
			near(t, b.Harmonic.Positions[k].Joints[j], s.Joints[j].add(d), 1e-12)
		}
	}
	near(t, b.Bounds.Center, a.Bounds.Center.add(d), 1e-12)
	if math.Abs(b.Bounds.Radius-a.Bounds.Radius) > 1e-12 || len(a.Mesh) != len(b.Mesh) {
		t.Fatal("translation changed the study")
	}
}

func TestHarmonicBoundsHoldGeneratingGeometry(t *testing.T) {
	// A large slow vector nearly cancelled by an opposite one leaves a small
	// curve; its generating vectors and ellipses reach far beyond it.
	big := HarmonicTerm{Frequency: 1, Cosine: Vec3{5, 0, 0}, Sine: Vec3{0, 5, 0}}
	back := HarmonicTerm{Frequency: 1, Cosine: Vec3{-4.8, 0, 0}, Sine: Vec3{0, -4.8, 0}}
	wobble := HarmonicTerm{Frequency: 5, Cosine: Vec3{0, 0, 0.1}, Sine: Vec3{0.05, 0, 0}}
	r := harmonic(t, harmonicStudy(0, 2*math.Pi, Vec3{}, big, back, wobble))
	for _, s := range r.Harmonic.Positions {
		for k, j := range s.Joints {
			if j.sub(r.Bounds.Center).norm() > r.Bounds.Radius+1e-9 {
				t.Fatalf("joint %d outside bounds", k)
			}
		}
	}
	if r.Bounds.Radius < 5*(1-1e-3) {
		t.Fatalf("radius %g does not hold the largest ellipse", r.Bounds.Radius)
	}
}

func TestHarmonicWithEveryConstruction(t *testing.T) {
	terms := []HarmonicTerm{
		{Frequency: 2, Cosine: Vec3{2, 0, 0}, Sine: Vec3{0, 2, 0}},
		{Frequency: -3, Cosine: Vec3{0, 0, 0.6}, Sine: Vec3{0.6, 0, 0}},
	}
	for _, construction := range []string{"developable", "involute", "tangent-foot", "orthotomic", "inversion"} {
		c := harmonicStudy(0, 2*math.Pi, Vec3{}, terms...)
		c.Construction = construction
		c.Pole = Vec3{0, 0, 3}
		c.Involute = InvoluteRequest{Anchor: 1, Offset: 1}
		c.Inversion = InversionRequest{Center: Vec3{0, 0, 3}, Radius: 2, Input: "base"}
		r := harmonic(t, c)
		if len(r.Harmonic.Positions) != c.Lines {
			t.Fatalf("%s: %d positions", construction, len(r.Harmonic.Positions))
		}
	}
	// Torus and parametric curves report no harmonic geometry.
	if r, err := Compute(study()); err != nil || r.Harmonic != nil {
		t.Fatal("torus reported harmonic geometry")
	}
}

func TestHarmonicValidation(t *testing.T) {
	good := HarmonicTerm{Frequency: 1, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1, 0}}
	many := make([]HarmonicTerm, 9)
	for k := range many {
		many[k] = good
	}
	for _, tc := range []struct {
		c    Request
		want string
	}{
		{harmonicStudy(0, 1, Vec3{}), "1–8 terms"},
		{harmonicStudy(0, 1, Vec3{}, many...), "1–8 terms"},
		{harmonicStudy(0, 1, Vec3{}, HarmonicTerm{Frequency: 1001, Cosine: Vec3{1, 0, 0}}), "term 1: the frequency"},
		{harmonicStudy(0, 1, Vec3{}, good, HarmonicTerm{Frequency: math.NaN(), Cosine: Vec3{1, 0, 0}}), "term 2: the frequency"},
		{harmonicStudy(0, 1, Vec3{}, HarmonicTerm{Frequency: 1, Cosine: Vec3{1e5 + 1, 0, 0}}), "term 1: A coordinates"},
		{harmonicStudy(0, 1, Vec3{}, HarmonicTerm{Frequency: 1, Sine: Vec3{0, math.Inf(1), 0}}), "term 1: B coordinates"},
		{harmonicStudy(0, 1, Vec3{0, 0, -2e5}, good), "center c₀"},
		{harmonicStudy(1, 1, Vec3{}, good), "domain"},
		{harmonicStudy(0, 2e5, Vec3{}, good), "domain"},
		{harmonicStudy(0, 1, Vec3{}, HarmonicTerm{Frequency: 0, Cosine: Vec3{1, 0, 0}}, HarmonicTerm{Frequency: 3}), "nothing turns"},
	} {
		if _, err := Compute(tc.c); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("want %q, got %v", tc.want, err)
		}
	}
}

// The curve probe draws the chain of generating vectors at its own sample,
// so with diagnostics the harmonic result carries the chain at every sample,
// and without them nothing changes.
func TestHarmonicChainsAtEverySampleForTheProbe(t *testing.T) {
	terms := []HarmonicTerm{
		{Frequency: 1, Cosine: Vec3{2, 0, 0}, Sine: Vec3{0, 2, 0.5}},
		{Frequency: 0, Cosine: Vec3{0.5, 0, 0}},
		{Frequency: -3, Cosine: Vec3{0, 0.4, 0.7}, Sine: Vec3{0.2, 0, 0}},
		{Frequency: 5, Cosine: Vec3{0, 0, 0.3}, Sine: Vec3{0.1, 0.1, 0}},
	}
	center := Vec3{0.3, -1, 2}
	for _, domain := range [][2]float64{{0, 2 * math.Pi}, {-1, 2}} {
		c := harmonicStudy(domain[0], domain[1], center, terms...)
		plain := harmonic(t, c)
		if plain.Harmonic.Chains != nil {
			t.Fatal("chains without diagnostics")
		}
		before, _ := json.Marshal(plain)
		if strings.Contains(string(before), `"chains"`) {
			t.Fatal("chains in a study without the probe")
		}
		c.Diagnostics = true
		r := harmonic(t, c)
		h := r.Harmonic
		if len(h.Chains) != c.Samples+1 {
			t.Fatalf("%d chains", len(h.Chains))
		}
		for i, s := range h.Chains {
			u := sampleT(c, i)
			if h.Closed && i == c.Samples {
				u = domain[0]
			}
			if s.SampleIndex != i || len(s.Joints) != len(terms) || s.Joints[0] != center {
				t.Fatalf("chain %d: %+v", i, s)
			}
			for k, term := range terms {
				end := s.Point
				if k+1 < len(terms) {
					end = s.Joints[k+1]
				}
				w := term.Frequency * u
				near(t, &end, s.Joints[k].add(term.Cosine.mul(math.Cos(w))).add(term.Sine.mul(math.Sin(w))), 1e-12)
			}
			near(t, &s.Point, *r.Base[i], 1e-12)
		}
		// The representative positions are the chains at their samples.
		for _, p := range h.Positions {
			got, _ := json.Marshal(h.Chains[p.SampleIndex])
			want, _ := json.Marshal(p)
			if string(got) != string(want) {
				t.Fatalf("position %d: %s, chain %s", p.SampleIndex, want, got)
			}
		}
		if h.Closed != (domain[0] == 0) {
			t.Fatalf("closed %v", h.Closed)
		}
		// A closed curve's last chain is its first, exactly, as its last
		// sample is.
		first, _ := json.Marshal(h.Chains[0].Joints)
		final, _ := json.Marshal(h.Chains[c.Samples].Joints)
		if h.Closed != (string(first) == string(final)) {
			t.Fatalf("closed %v, first %s, last %s", h.Closed, first, final)
		}
		// Everything else is the study without the probe.
		r.Diagnostics, h.Chains = nil, nil
		after, _ := json.Marshal(r)
		if string(after) != string(before) {
			t.Fatal("the probe changed the study")
		}
	}
}
