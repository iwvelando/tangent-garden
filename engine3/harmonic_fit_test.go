package engine3

import (
	"fmt"
	"math"
	"strings"
	"testing"

	"tangentgarden/engine"
)

// torusStudy is a torus knot source with the engine's own field names.
func torusStudy(p, q int, radius, tube float64) Request {
	return Request{Format: "torus", P: p, Q: q, Radius: radius, Tube: tube}
}

func expressionStudy(x, y, z string, lo, hi float64) Request {
	return Request{Format: "parametric", Curve: Curve{X: x, Y: y, Z: z, Min: lo, Max: hi}}
}

func fitted(t *testing.T, c Request, parameter string) *HarmonicFit {
	t.Helper()
	f, err := FitHarmonicSource(c, parameter)
	if err != nil {
		t.Fatalf("fit: %v", err)
	}
	return f
}

func selected(t *testing.T, f *HarmonicFit, count int) HarmonicFitResult {
	t.Helper()
	r, err := f.Select(count)
	if err != nil {
		t.Fatalf("select %d: %v", count, err)
	}
	return r
}

func fitNear(a, b Vec3, tolerance float64) bool { return a.sub(b).norm() <= tolerance }

// termAt finds a selected frequency.
func termAt(r HarmonicFitResult, k float64) (HarmonicTerm, bool) {
	for _, term := range r.Curve.Terms {
		if term.Frequency == k {
			return term, true
		}
	}
	return HarmonicTerm{}, false
}

// Expanding (R + r cos qt)(cos pt, sin pt) by the product formulas gives the
// coefficients by hand: R at p, r/2 at p+q and |p−q|, and r at q on z, with
// the p−q term turning backward when q exceeds p.
func TestHarmonicFitRecoversTorusKnotInItsOwnParameter(t *testing.T) {
	const R, r = 2.0, 0.75
	f := fitted(t, torusStudy(2, 3, R, r), HarmonicFitSource)
	got := selected(t, f, 8)
	want := map[float64]HarmonicTerm{
		2: {Cosine: Vec3{R, 0, 0}, Sine: Vec3{0, R, 0}},
		3: {Sine: Vec3{0, 0, r}},
		5: {Cosine: Vec3{r / 2, 0, 0}, Sine: Vec3{0, r / 2, 0}},
		1: {Cosine: Vec3{r / 2, 0, 0}, Sine: Vec3{0, -r / 2, 0}},
	}
	if len(got.Curve.Terms) != len(want) {
		t.Fatalf("selected %d terms, want the knot's %d: %+v", len(got.Curve.Terms), len(want), got.Curve.Terms)
	}
	for k, term := range want {
		g, ok := termAt(got, k)
		if !ok {
			t.Fatalf("frequency %g is missing from %+v", k, got.Curve.Terms)
		}
		if !fitNear(g.Cosine, term.Cosine, 1e-12) || !fitNear(g.Sine, term.Sine, 1e-12) {
			t.Errorf("frequency %g = %+v, want %+v", k, g, term)
		}
	}
	if got.RMS > 1e-12 || got.MaxResidual > 1e-12 {
		t.Errorf("an exact source left rms %g, max %g", got.RMS, got.MaxResidual)
	}
	// An exact source reads exactly in an editable field, with no rounding tail.
	if g, _ := termAt(got, 3); g.Sine != (Vec3{0, 0, r}) || g.Cosine != (Vec3{}) {
		t.Errorf("recovered %+v, want exactly %g on z", g, r)
	}
	// Largest energy first; the two equal terms take the smaller frequency.
	order := []float64{2, 3, 1, 5}
	for i, k := range order {
		if got.Curve.Terms[i].Frequency != k {
			t.Fatalf("order %v, want %v", got.Curve.Terms, order)
		}
	}
}

// A harmonic study over whole periods with fractional frequencies comes back
// as the same geometry on 0..2π: the domain's period becomes frequency 1.
func TestHarmonicFitRecoversAHarmonicStudyOverWholePeriods(t *testing.T) {
	a, b := Vec3{1.5, 0, 0.5}, Vec3{0, 1, 0}
	c, d := Vec3{0, 0.25, 0}, Vec3{0.25, 0, -0.125}
	center := Vec3{3, -1, 2}
	study := Request{Format: "harmonic", Harmonic: HarmonicCurve{
		Center: center, Min: 0, Max: 6 * math.Pi,
		Terms: []HarmonicTerm{{Frequency: 1.0 / 3, Cosine: a, Sine: b}, {Frequency: 2.0 / 3, Cosine: c, Sine: d}},
	}}
	got := selected(t, fitted(t, study, HarmonicFitSource), 8)
	if len(got.Curve.Terms) != 2 {
		t.Fatalf("terms %+v, want two", got.Curve.Terms)
	}
	if !fitNear(got.Curve.Center, center, 1e-12) {
		t.Errorf("center %+v, want %+v", got.Curve.Center, center)
	}
	first, second := got.Curve.Terms[0], got.Curve.Terms[1]
	if first.Frequency != 1 || second.Frequency != 2 {
		t.Fatalf("frequencies %g, %g, want 1, 2", first.Frequency, second.Frequency)
	}
	if !fitNear(first.Cosine, a, 1e-12) || !fitNear(first.Sine, b, 1e-12) || !fitNear(second.Cosine, c, 1e-12) || !fitNear(second.Sine, d, 1e-12) {
		t.Errorf("coefficients %+v", got.Curve.Terms)
	}
}

// A finite sum comes back whole up to frequency 256, half the samples' Nyquist
// limit, so nothing the outline can resolve aliases into the band unnoticed.
func TestHarmonicFitBandRecoversAFineTerm(t *testing.T) {
	fine := HarmonicTerm{Frequency: 100, Cosine: Vec3{0, 0.01, 0}, Sine: Vec3{0, 0, 0.01}}
	study := Request{Format: "harmonic", Harmonic: HarmonicCurve{Min: 0, Max: 2 * math.Pi, Terms: []HarmonicTerm{
		{Frequency: 1, Cosine: Vec3{3, 0, 0}, Sine: Vec3{0, 3, 0}},
		fine,
	}}}
	f := fitted(t, study, HarmonicFitSource)
	got := selected(t, f, 8)
	if f.Available() != 2 || got.RMS > 1e-12 {
		t.Fatalf("available %d, rms %g", f.Available(), got.RMS)
	}
	if g, ok := termAt(got, 100); !ok || !fitNear(g.Cosine, fine.Cosine, 1e-12) || !fitNear(g.Sine, fine.Sine, 1e-12) {
		t.Errorf("fine term %+v", got.Curve.Terms)
	}
}

// Arc length forgets how the source was traversed in time: a circle driven at
// varying speed is one term by arc length and many by its own parameter.
func TestHarmonicFitArcLengthForgetsTheSourceSpeed(t *testing.T) {
	study := expressionStudy("2*cos(t+0.8*sin(t))", "2*sin(t+0.8*sin(t))", "0", 0, 2*math.Pi)
	arc := selected(t, fitted(t, study, HarmonicFitArcLength), 1)
	first := arc.Curve.Terms[0]
	if first.Frequency != 1 || !fitNear(first.Cosine, Vec3{2, 0, 0}, 2e-3) || !fitNear(first.Sine, Vec3{0, 2, 0}, 2e-3) {
		t.Errorf("arc-length term %+v, want the circle of radius 2", first)
	}
	if arc.RMS > 1e-3 {
		t.Errorf("arc-length rms %g", arc.RMS)
	}
	own := selected(t, fitted(t, study, HarmonicFitSource), 1)
	if own.RMS < 0.5 {
		t.Errorf("source-parameter rms %g; one term should not capture the varying speed", own.RMS)
	}
	// Reparameterizing a knot leaves its arc-length fit in place.
	plain := expressionStudy("sin(t)+2*sin(2*t)", "cos(t)-2*cos(2*t)", "-sin(3*t)", 0, 2*math.Pi)
	warped := expressionStudy("sin(t+0.3*sin(t))+2*sin(2*(t+0.3*sin(t)))", "cos(t+0.3*sin(t))-2*cos(2*(t+0.3*sin(t)))", "-sin(3*(t+0.3*sin(t)))", 0, 2*math.Pi)
	p, q := selected(t, fitted(t, plain, HarmonicFitArcLength), 8), selected(t, fitted(t, warped, HarmonicFitArcLength), 8)
	for i := range p.Curve.Terms {
		if p.Curve.Terms[i].Frequency != q.Curve.Terms[i].Frequency || !fitNear(p.Curve.Terms[i].Cosine, q.Curve.Terms[i].Cosine, 5e-3) || !fitNear(p.Curve.Terms[i].Sine, q.Curve.Terms[i].Sine, 5e-3) {
			t.Errorf("term %d moved under reparameterization: %+v, %+v", i, p.Curve.Terms[i], q.Curve.Terms[i])
		}
	}
}

// Traversing backward from the same start keeps A and negates B exactly, for
// either parameter: cos is even and sin is odd in t, whatever the rank.
func TestHarmonicFitDirectionReversalNegatesSines(t *testing.T) {
	forward := expressionStudy("sin(t)+2*sin(2*t)", "cos(t)-2*cos(2*t)", "-sin(3*t)", 0, 2*math.Pi)
	backward := expressionStudy("sin(-t)+2*sin(-2*t)", "cos(-t)-2*cos(-2*t)", "-sin(-3*t)", 0, 2*math.Pi)
	for _, parameter := range []string{HarmonicFitArcLength, HarmonicFitSource} {
		p, q := selected(t, fitted(t, forward, parameter), 8), selected(t, fitted(t, backward, parameter), 8)
		if len(p.Curve.Terms) != len(q.Curve.Terms) {
			t.Fatalf("%s: term counts %d, %d", parameter, len(p.Curve.Terms), len(q.Curve.Terms))
		}
		for i := range p.Curve.Terms {
			a, b := p.Curve.Terms[i], q.Curve.Terms[i]
			if a.Frequency != b.Frequency || !fitNear(a.Cosine, b.Cosine, 1e-9) || !fitNear(a.Sine, b.Sine.mul(-1), 1e-9) {
				t.Errorf("%s term %d: %+v, reversed %+v", parameter, i, a, b)
			}
		}
	}
}

// An orthogonal change of coordinates, a uniform scale and a translation
// carry every coefficient with them and leave the ranking alone.
func TestHarmonicFitFollowsRigidMotionAndScale(t *testing.T) {
	base := expressionStudy("(2+0.75*cos(3*t))*cos(2*t)", "(2+0.75*cos(3*t))*sin(2*t)", "0.75*sin(3*t)", 0, 2*math.Pi)
	// (x, y, z) → 3·(y, −x, z) + (7, −5, 11): a quarter turn about z, by hand.
	moved := expressionStudy("7+3*(2+0.75*cos(3*t))*sin(2*t)", "-5-3*(2+0.75*cos(3*t))*cos(2*t)", "11+3*0.75*sin(3*t)", 0, 2*math.Pi)
	turn := func(v Vec3) Vec3 { return Vec3{3 * v.Y, -3 * v.X, 3 * v.Z} }
	for _, parameter := range []string{HarmonicFitArcLength, HarmonicFitSource} {
		p, q := selected(t, fitted(t, base, parameter), 8), selected(t, fitted(t, moved, parameter), 8)
		if !fitNear(q.Curve.Center, turn(p.Curve.Center).add(Vec3{7, -5, 11}), 1e-8) {
			t.Errorf("%s center %+v from %+v", parameter, q.Curve.Center, p.Curve.Center)
		}
		for i := range p.Curve.Terms {
			a, b := p.Curve.Terms[i], q.Curve.Terms[i]
			if a.Frequency != b.Frequency || !fitNear(b.Cosine, turn(a.Cosine), 1e-8) || !fitNear(b.Sine, turn(a.Sine), 1e-8) {
				t.Errorf("%s term %d: %+v moved to %+v", parameter, i, a, b)
			}
		}
		if math.Abs(q.RMS-3*p.RMS) > 1e-8 || math.Abs(q.MaxResidual-3*p.MaxResidual) > 1e-8 {
			t.Errorf("%s residuals %g, %g from %g, %g", parameter, q.RMS, q.MaxResidual, p.RMS, p.MaxResidual)
		}
	}
}

// A later start point turns each term's phase by kφ, keeping each ellipse and
// so the ranking; the term's own start moves round it.
func TestHarmonicFitStartShiftTurnsEachTermsPhase(t *testing.T) {
	phi := 2 * math.Pi / 8 // 128 samples, which lands on the sampling grid.
	source := func(shift string) Request {
		at := func(k string) string { return k + "*(t+" + shift + ")" }
		return expressionStudy("sin("+at("1")+")+2*sin("+at("2")+")", "cos("+at("1")+")-2*cos("+at("2")+")", "-sin("+at("3")+")", 0, 2*math.Pi)
	}
	p, q := selected(t, fitted(t, source("0"), HarmonicFitSource), 8), selected(t, fitted(t, source("pi/4"), HarmonicFitSource), 8)
	for i := range p.Curve.Terms {
		a, b := p.Curve.Terms[i], q.Curve.Terms[i]
		if a.Frequency != b.Frequency {
			t.Fatalf("ranking changed at %d: %g, %g", i, a.Frequency, b.Frequency)
		}
		c, s := math.Cos(a.Frequency*phi), math.Sin(a.Frequency*phi)
		cosine := a.Cosine.mul(c).add(a.Sine.mul(s))
		sine := a.Sine.mul(c).sub(a.Cosine.mul(s))
		if !fitNear(b.Cosine, cosine, 1e-11) || !fitNear(b.Sine, sine, 1e-11) {
			t.Errorf("term %d: %+v, want cosine %+v, sine %+v", i, b, cosine, sine)
		}
	}
}

// With z = 0 the fit must agree with the separately implemented planar
// projection, where one real term splits into signed complex coefficients:
// A = c₊ + c₋ and B = i(c₊ − c₋). This is why neither budget nor term count
// transfers between the notebooks: an ellipse is two planar terms, one here.
func TestHarmonicFitAgreesWithThePlanarProjection(t *testing.T) {
	study := expressionStudy("3*cos(t)+0.5*cos(3*t)+0.25*sin(2*t)", "2*sin(t)-0.25*sin(3*t)+0.25*cos(2*t)", "0", 0, 2*math.Pi)
	got := fitted(t, study, HarmonicFitArcLength)
	points := make([]engine.Vec, 0, len(got.outline.Points))
	for _, p := range got.outline.Points {
		points = append(points, engine.Vec{X: p.X, Y: p.Y})
	}
	planar, err := engine.FitFourier(points, true)
	if err != nil {
		t.Fatal(err)
	}
	reply, err := planar.Select(16)
	if err != nil {
		t.Fatal(err)
	}
	type complexPair struct{ re, im float64 }
	signed := map[int]complexPair{}
	for _, term := range reply.Terms {
		s, c := math.Sincos(term.Phase)
		signed[int(term.Frequency)] = complexPair{term.Radius * c, term.Radius * s}
	}
	result := selected(t, got, 8)
	compared := 0
	for _, term := range result.Curve.Terms {
		k := int(term.Frequency)
		// Planar selection keeps sixteen signed terms, so a small partner can
		// be missing from it; only complete pairs are comparable.
		plus, hasPlus := signed[k]
		minus, hasMinus := signed[-k]
		if !hasPlus || !hasMinus {
			continue
		}
		compared++
		a := Vec3{plus.re + minus.re, plus.im + minus.im, 0}
		b := Vec3{-(plus.im - minus.im), plus.re - minus.re, 0}
		if !fitNear(term.Cosine, a, 1e-9) || !fitNear(term.Sine, b, 1e-9) {
			t.Errorf("frequency %d: %+v, planar A %+v, B %+v", k, term, a, b)
		}
		if term.Cosine.Z != 0 || term.Sine.Z != 0 {
			t.Errorf("frequency %d left the plane: %+v", k, term)
		}
	}
	if compared < 3 {
		t.Errorf("compared only %d complete pairs", compared)
	}
	if s, c := signed[0], result.Curve.Center; math.Abs(s.re-c.X) > 1e-9 || math.Abs(s.im-c.Y) > 1e-9 || c.Z != 0 {
		t.Errorf("center %+v, planar translation %+v", c, s)
	}
}

// Coefficients are orthogonal on the sample grid, so the sample error is the
// discarded energy (Parseval), adding a term never raises it, and a prefix of
// the ranking never reorders.
func TestHarmonicFitPrefixAndParseval(t *testing.T) {
	for _, parameter := range []string{HarmonicFitArcLength, HarmonicFitSource} {
		f := fitted(t, expressionStudy("cos(t)+exp(cos(3*t))/3", "sin(t)+exp(sin(5*t))/4", "exp(cos(2*t))/2", 0, 2*math.Pi), parameter)
		var last HarmonicFitResult
		var chain []HarmonicTerm
		for count := 1; count <= f.Available(); count++ {
			r := selected(t, f, count)
			if len(r.Curve.Terms) != count {
				t.Fatalf("%s count %d returned %d terms", parameter, count, len(r.Curve.Terms))
			}
			for i, term := range chain {
				if r.Curve.Terms[i] != term {
					t.Fatalf("%s count %d changed term %d", parameter, count, i)
				}
			}
			chain = r.Curve.Terms
			if count > 1 && r.RMS > last.RMS*(1+1e-12) {
				t.Errorf("%s: rms rose from %g to %g at %d", parameter, last.RMS, r.RMS, count)
			}
			if r.MaxResidual < r.RMS {
				t.Errorf("%s: max %g below rms %g", parameter, r.MaxResidual, r.RMS)
			}
			last = r
		}
		// Each term contributes half its energy to a sample mean.
		a, b := selected(t, f, 1), selected(t, f, 2)
		term := b.Curve.Terms[1]
		energy := (term.Cosine.dot(term.Cosine) + term.Sine.dot(term.Sine)) / 2
		if drop := a.RMS*a.RMS - b.RMS*b.RMS; math.Abs(drop-energy) > 1e-10 {
			t.Errorf("%s: squared rms fell %g for a term of %g", parameter, drop, energy)
		}
	}
}

// The semi-axes are measured on the returned ellipse's own sampled points.
func TestHarmonicFitReportsEachEllipsesGeometry(t *testing.T) {
	study := Request{Format: "harmonic", Harmonic: HarmonicCurve{Min: 0, Max: 2 * math.Pi, Terms: []HarmonicTerm{
		{Frequency: 1, Cosine: Vec3{3, 0, 0}, Sine: Vec3{0, 0, 3}},
		{Frequency: 2, Cosine: Vec3{1, 1, 0}, Sine: Vec3{1, 1, 0}},
		{Frequency: 3, Cosine: Vec3{0.5, 0, 0}, Sine: Vec3{0.25, 0.25, 0}},
	}}}
	got := selected(t, fitted(t, study, HarmonicFitSource), 3)
	for i, term := range got.Curve.Terms {
		e := got.Ellipses[i]
		high, low := 0.0, math.Inf(1)
		for j := 0; j < 20000; j++ {
			n := term.at(float64(j) * 2 * math.Pi / 20000 / term.Frequency).norm()
			high, low = math.Max(high, n), math.Min(low, n)
		}
		if math.Abs(e.Major-high) > 1e-6 || math.Abs(e.Minor-low) > 1e-6 {
			t.Errorf("term %d: axes %g, %g; sampled %g, %g", i, e.Major, e.Minor, high, low)
		}
	}
	if e := got.Ellipses[0]; e.Major != e.Minor {
		// A circle in its own plane: A ⟂ B with equal lengths.
		if math.Abs(e.Major-e.Minor) > 1e-12 {
			t.Errorf("circle axes %g, %g", e.Major, e.Minor)
		}
	}
	if e := got.Ellipses[1]; e.Minor > 1e-12 {
		t.Errorf("a segment has minor axis %g", e.Minor)
	}
}

// One frame holds the outline and every prefix's chain at every parameter.
func TestHarmonicFitBoundsHoldEveryPrefix(t *testing.T) {
	for _, parameter := range []string{HarmonicFitArcLength, HarmonicFitSource} {
		f := fitted(t, torusStudy(2, 3, 2, 0.75), parameter)
		frame := f.Bounds()
		inside := func(p Vec3, what string) {
			t.Helper()
			if p.sub(frame.Center).norm() > frame.Radius*1.001 {
				t.Errorf("%s %s: %+v outside %+v", parameter, what, p, frame)
			}
		}
		for _, p := range f.outline.Points {
			inside(p, "outline")
		}
		for count := 1; count <= f.Available(); count++ {
			r := selected(t, f, count)
			if r.Bounds != frame {
				t.Errorf("%s count %d moved the frame: %+v", parameter, count, r.Bounds)
			}
			for j := 0; j < 400; j++ {
				chain := r.Curve.chain(2 * math.Pi * float64(j) / 400)
				inside(chain.Point, "point")
				for _, joint := range chain.Joints {
					inside(joint, "joint")
				}
			}
		}
	}
}

// The closing point of a whole study is its first, and it renders as an
// ordinary closed harmonic curve through the shared evaluator.
func TestHarmonicFitReturnsAnOrdinaryClosedStudy(t *testing.T) {
	f := fitted(t, torusStudy(2, 3, 2, 0.75), HarmonicFitArcLength)
	got := selected(t, f, 8)
	if got.Curve.Min != 0 || got.Curve.Max != 2*math.Pi {
		t.Fatalf("domain %g..%g", got.Curve.Min, got.Curve.Max)
	}
	r := harmonic(t, Request{Format: "harmonic", Construction: "none", Length: 1, Samples: 1024, Lines: 24, Harmonic: got.Curve})
	if !r.Harmonic.Closed || r.Harmonic.Period == 0 {
		t.Errorf("not closed: %+v", r.Harmonic)
	}
	if len(r.Harmonic.Terms) != len(got.Curve.Terms) {
		t.Errorf("terms were dropped: %d of %d", len(r.Harmonic.Terms), len(got.Curve.Terms))
	}
}

// The bound holds against the sampled polyline at a much finer parameter,
// which is what it claims, and it is not vacuous.
func TestHarmonicFitBetweenSampleBound(t *testing.T) {
	for _, source := range []Request{
		torusStudy(2, 3, 2, 0.75),
		expressionStudy("cos(t)", "sin(t)", "abs(sin(3*t))", 0, 2*math.Pi),
	} {
		f := fitted(t, source, HarmonicFitArcLength)
		for _, count := range []int{1, 4, 8} {
			r := selected(t, f, count)
			path := f.outline.Points
			lengths := make([]float64, len(path))
			for j := 1; j < len(path); j++ {
				lengths[j] = lengths[j-1] + path[j].sub(path[j-1]).norm()
			}
			total := lengths[len(path)-1]
			worst, edge := 0.0, 0
			const dense = 65536
			for j := 0; j < dense; j++ {
				s := total * float64(j) / dense
				for edge+1 < len(path)-1 && lengths[edge+1] <= s {
					edge++
				}
				u := (s - lengths[edge]) / (lengths[edge+1] - lengths[edge])
				on := path[edge].add(path[edge+1].sub(path[edge]).mul(u))
				p, _, _, _ := r.Curve.evaluate(2 * math.Pi * float64(j) / dense)
				worst = math.Max(worst, p.sub(on).norm())
			}
			if worst > r.ContinuousBound {
				t.Errorf("count %d: dense error %g over the bound %g", count, worst, r.ContinuousBound)
			}
			if r.ContinuousBound > worst+0.15*total {
				t.Errorf("count %d: bound %g is vacuous beside %g", count, r.ContinuousBound, worst)
			}
		}
	}
}

func TestHarmonicFitNearDegenerateCurves(t *testing.T) {
	// A segment traversed back and forth is closed and has no area: one term
	// whose ellipse has collapsed, not a refusal.
	line := selected(t, fitted(t, expressionStudy("cos(t)", "0", "0", 0, 2*math.Pi), HarmonicFitSource), 1)
	if term := line.Curve.Terms[0]; term.Frequency != 1 || !fitNear(term.Cosine, Vec3{1, 0, 0}, 1e-12) || term.Sine != (Vec3{}) {
		t.Errorf("segment term %+v", term)
	}
	if line.RMS > 1e-12 {
		t.Errorf("segment rms %g", line.RMS)
	}
	// A real but tiny excursion from a plane survives; rounding does not.
	thin := fitted(t, expressionStudy("cos(t)", "sin(t)", "1e-9*sin(2*t)", 0, 2*math.Pi), HarmonicFitSource)
	got := selected(t, thin, 2)
	if term, ok := termAt(got, 2); !ok || math.Abs(term.Sine.Z-1e-9) > 1e-14 {
		t.Errorf("thin excursion %+v", got.Curve.Terms)
	}
	flat := selected(t, fitted(t, expressionStudy("cos(t)", "sin(t)", "5", 0, 2*math.Pi), HarmonicFitSource), 1)
	if term := flat.Curve.Terms[0]; term.Cosine.Z != 0 || term.Sine.Z != 0 || flat.Curve.Center.Z != 5 {
		t.Errorf("planar source acquired z noise: %+v, center %+v", term, flat.Curve.Center)
	}
	// A small curve far from the origin keeps its shape, with the translation
	// held apart in the center.
	far := selected(t, fitted(t, expressionStudy("10000+1e-3*cos(t)", "1e-3*sin(t)", "-10000+1e-3*sin(2*t)", 0, 2*math.Pi), HarmonicFitSource), 8)
	if len(far.Curve.Terms) != 2 {
		t.Errorf("far curve terms %+v", far.Curve.Terms)
	}
	if far.RMS > 1e-11 {
		t.Errorf("far curve rms %g", far.RMS)
	}
	if !fitNear(far.Curve.Center, Vec3{10000, 0, -10000}, 1e-10) {
		t.Errorf("far center %+v", far.Curve.Center)
	}
	// A source with fewer terms than the budget offers exactly those.
	if f := fitted(t, expressionStudy("cos(t)", "sin(t)", "0", 0, 2*math.Pi), HarmonicFitSource); f.Available() != 1 {
		t.Errorf("a circle offers %d terms", f.Available())
	}
	// Equal energies rank the same on either side of rounding: the smaller
	// frequency first, whichever the DFT rounded larger.
	tie := selected(t, fitted(t, expressionStudy("cos(t)+cos(2*t)+cos(3*t)", "sin(t)+sin(2*t)+sin(3*t)", "0", 0, 2*math.Pi), HarmonicFitSource), 3)
	for i, term := range tie.Curve.Terms {
		if term.Frequency != float64(i+1) {
			t.Errorf("tie order %+v", tie.Curve.Terms)
			break
		}
	}
}

func TestHarmonicFitRefusals(t *testing.T) {
	cases := []struct {
		name  string
		study Request
		want  string
	}{
		{"open arc", expressionStudy("cos(t)", "sin(t)", "t/4", 0, 6*math.Pi), "open"},
		{"open harmonic", Request{Format: "harmonic", Harmonic: HarmonicCurve{Min: 0, Max: 3, Terms: []HarmonicTerm{{Frequency: 1, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1, 0}}}}}, "open"},
		{"pole", expressionStudy("cos(t)", "sin(t)", "1/sin(t+0.3)", 0, 2*math.Pi), "100000"},
		{"gap", expressionStudy("cos(t)", "sin(t)", "sqrt(sin(t+0.3))", 0, 2*math.Pi), "gap"},
		{"jump", expressionStudy("cos(t)", "sin(t)", "sin(t+0.3)/abs(sin(t+0.3))", 0, 2*math.Pi), "discontinuity"},
		{"stationary", expressionStudy("1", "2", "3", 0, 2*math.Pi), "zero"},
		{"coordinates", expressionStudy("200000*cos(t)", "sin(t)", "0", 0, 2*math.Pi), "100000"},
		{"field", Request{Format: "field"}, "torus knot"},
		{"pursuit", Request{Format: "pursuit"}, "torus knot"},
		{"surface", Request{Format: "surface"}, "torus knot"},
		{"derived input", func() Request { c := torusStudy(2, 3, 2, 0.75); c.Input = "tangent-foot"; return c }(), "base"},
		{"coil input", func() Request { c := torusStudy(2, 3, 2, 0.75); c.Input = "coil"; return c }(), "base"},
		{"tiny", expressionStudy("1e-9*cos(t)", "1e-9*sin(t)", "0", 0, 2*math.Pi), "zero"},
		{"probe gap", expressionStudy("cos(t)", "sin(t)", "0*sqrt((t-.006)^2-.000001)", 0, 2*math.Pi), "gap"},
		{"evaluation cap", expressionStudy("cos(t)", "sin(t)", "tanh(sin(255*t)/3e-5)/30", 0, 2*math.Pi), "32768"},
		{"fine coil", expressionStudy("sin(t)+2*sin(2*t)+0.1*cos(233*t)", "cos(t)-2*cos(2*t)+0.1*sin(233*t)", "-sin(3*t)", 0, 2*math.Pi), "4096 outline points"},
	}
	for _, q := range cases {
		for _, parameter := range []string{HarmonicFitArcLength, HarmonicFitSource} {
			_, err := FitHarmonicSource(q.study, parameter)
			if err == nil {
				t.Errorf("%s (%s): accepted", q.name, parameter)
				continue
			}
			if !strings.Contains(err.Error(), q.want) {
				t.Errorf("%s (%s): %q does not name %q", q.name, parameter, err, q.want)
			}
		}
	}
	if _, err := FitHarmonicSource(torusStudy(2, 3, 2, 0.75), "time"); err == nil {
		t.Errorf("an unknown parameterization was accepted")
	}
	f := fitted(t, torusStudy(2, 3, 2, 0.75), HarmonicFitSource)
	for _, count := range []int{0, -1, 9} {
		if _, err := f.Select(count); err == nil || !strings.Contains(err.Error(), "1–8") {
			t.Errorf("count %d: %v", count, err)
		}
	}
}

// Probes either side of a jump lie on its chord, so deviation alone cannot see
// one, in any direction and at any scale. Only the continuity sweep can.
func TestHarmonicFitRefusesJumpsDeviationCannotSee(t *testing.T) {
	const step = "abs(cos(t-.1))/cos(t-.1)"
	for _, k := range []float64{1e-3, 1, 1000} {
		for _, h := range []float64{.04, .005} {
			// The jump is along y, and then along z, of size 2hk.
			lift := fmt.Sprintf("%g*%g*%s", k, h, step)
			for _, c := range []Request{
				expressionStudy(fmt.Sprintf("%g*cos(t)", k), fmt.Sprintf("%g*sin(t)+%s", k, lift), "0", 0, 2*math.Pi),
				expressionStudy(fmt.Sprintf("%g*cos(t)", k), fmt.Sprintf("%g*sin(t)", k), lift, 0, 2*math.Pi),
			} {
				if _, err := FitHarmonicSource(c, HarmonicFitSource); err == nil || !strings.Contains(err.Error(), "discontinuity") {
					t.Errorf("k=%g h=%g %+v: joined a jump: %v", k, h, c.Curve, err)
				}
			}
		}
	}
	// Steep continuous sources are not jumps, including motion along a chord,
	// which deviation alone never splits, and a resolved narrow bump.
	for _, c := range []Request{
		expressionStudy("cos(t)", "sin(t)", ".04*exp(-((t-1.2345)/.001)^2)", 0, 2*math.Pi),
		expressionStudy("cos(t)^51", "0*t", "0", 0, 2*math.Pi),
		expressionStudy("cos(t)^51", "sin(t)^51", "0", 0, 2*math.Pi),
		expressionStudy("cos(t)", "sin(t)", ".04*tanh((sin(t)-.3)/.001)", 0, 2*math.Pi),
	} {
		if _, err := FitHarmonicSource(c, HarmonicFitSource); err != nil {
			t.Errorf("refused continuous %+v: %v", c.Curve, err)
		}
	}
}

// Dyadic seed and refinement probes alone can alias these loops into a circle,
// so that only the off-grid audit sees them.
func TestHarmonicFitAuditRefusesAliasedLoops(t *testing.T) {
	for _, c := range []Request{
		expressionStudy("cos(t)+.2*sin(8192*t)", "sin(t)", "0", 0, 2*math.Pi),
		expressionStudy("cos(t)", "sin(t)", ".2*sin(8192*t)", 0, 2*math.Pi),
	} {
		if _, err := FitHarmonicSource(c, HarmonicFitArcLength); err == nil {
			t.Errorf("accepted an aliased loop %+v", c.Curve)
		}
	}
}

// Energies a rounding apart are a tie, so the order cannot follow the processor.
func TestHarmonicFitRankTreatsRoundingAsATie(t *testing.T) {
	terms := []HarmonicTerm{
		{Frequency: 2, Cosine: Vec3{1 + 1e-14, 0, 0}},
		{Frequency: 1, Sine: Vec3{0, 1, 0}},
		{Frequency: 3, Cosine: Vec3{0, 0, 2}},
		{Frequency: 4, Cosine: Vec3{0, 1 + 1e-9, 0}},
	}
	rankHarmonicTerms(terms)
	for i, want := range []float64{3, 4, 1, 2} {
		if terms[i].Frequency != want {
			t.Fatalf("order %+v, want frequencies 3, 4, 1, 2", terms)
		}
	}
}

// A very thin ellipse keeps its minor axis, which a difference of the Gram
// matrix's nearly equal terms would lose.
func TestHarmonicFitEllipseKeepsAThinMinorAxis(t *testing.T) {
	e := harmonicEllipse(HarmonicTerm{Frequency: 1, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1e-9, 0}})
	if math.Abs(e.Major-1) > 1e-15 || math.Abs(e.Minor-1e-9) > 1e-20 {
		t.Errorf("axes %g, %g", e.Major, e.Minor)
	}
}

// The bound is exactly the stated sum, each of whose parts the proof needs.
func TestHarmonicFitBoundIsItsStatedSum(t *testing.T) {
	f := fitted(t, torusStudy(2, 3, 2, 0.75), HarmonicFitArcLength)
	r := selected(t, f, 3)
	motion := 0.0
	for _, term := range r.Curve.Terms {
		motion += term.Frequency * (term.Cosine.norm() + term.Sine.norm())
	}
	want := r.MaxResidual + math.Pi/1024*motion + r.Length/2048
	if math.Abs(r.ContinuousBound-want) > 1e-12 {
		t.Errorf("bound %g, want %g", r.ContinuousBound, want)
	}
	if own := selected(t, fitted(t, torusStudy(2, 3, 2, 0.75), HarmonicFitSource), 3); own.ContinuousBound != 0 {
		t.Errorf("the source parameter claims a bound of %g", own.ContinuousBound)
	}
}

// Every evaluation counts, including the source parameter's own samples.
func TestHarmonicFitCountsEveryEvaluation(t *testing.T) {
	arc := fitted(t, torusStudy(2, 3, 2, 0.75), HarmonicFitArcLength).outline.Evaluations
	own := fitted(t, torusStudy(2, 3, 2, 0.75), HarmonicFitSource).outline.Evaluations
	if own != arc+HarmonicFitSamples {
		t.Errorf("source parameter counted %d, arc length %d", own, arc)
	}
}

func TestHarmonicFitWorkIsBounded(t *testing.T) {
	for _, source := range []Request{
		torusStudy(8, 9, 2, 0.75),
		expressionStudy("cos(t)+exp(cos(9*t))/4", "sin(t)+exp(sin(7*t))/4", "exp(cos(5*t))/4", 0, 2*math.Pi),
	} {
		for _, parameter := range []string{HarmonicFitArcLength, HarmonicFitSource} {
			f := fitted(t, source, parameter)
			if f.outline.Evaluations > HarmonicFitMaxEvaluations {
				t.Errorf("%d evaluations", f.outline.Evaluations)
			}
			if len(f.outline.Points) > HarmonicFitMaxPoints {
				t.Errorf("%d points", len(f.outline.Points))
			}
			if len(f.samples) != HarmonicFitSamples {
				t.Errorf("%d samples", len(f.samples))
			}
		}
	}
}
