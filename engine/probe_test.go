package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// The probe between samples: the base curve and its construction described
// at any parameter, against closed forms evaluated here, and at a sample
// exactly as the per-sample diagnostics describe it.

func probed(t *testing.T, q Request, at ProbeQuery) (Result, *ProbePoint) {
	t.Helper()
	q.Probe = &at
	r := compute(t, q)
	if r.Probe == nil {
		t.Fatal("no probe")
	}
	return r, r.Probe
}

func probeAtT(t *testing.T, q Request, s float64) *ProbePoint {
	t.Helper()
	_, p := probed(t, q, ProbeQuery{T: &s})
	if p.T != s {
		t.Fatalf("probe at t = %g, asked %g", p.T, s)
	}
	return p
}

// Parameters strictly between samples, away from the ends.
func between(q Request) []float64 {
	var ts []float64
	for _, u := range []float64{0.0137, 0.2291, 0.4003, 0.5555, 0.7771, 0.9419} {
		t := q.Curve.Min + u*(q.Curve.Max-q.Curve.Min)
		j := float64(q.Samples-1) * u
		if j == math.Floor(j) {
			panic("a test parameter fell on a sample")
		}
		ts = append(ts, t)
	}
	return ts
}

func TestProbeIsAbsentUnlessAsked(t *testing.T) {
	q := request("evolute", "cos(t)", "sin(t)", 0, 1)
	if compute(t, q).Probe != nil {
		t.Fatal("a probe nobody asked for")
	}
}

// Asking for the probe changes nothing else in the result.
func TestProbeLeavesTheStudyUnchanged(t *testing.T) {
	for _, q := range []Request{
		request("evolute", "2*cos(t)", "sin(t)", 0, 2*math.Pi),
		request("involute", "cos(t)", "sin(t)", 0, 2*math.Pi),
		rollingRequest("cos(t)", "sin(t)", 0, 2*math.Pi, Roller{Side: "left", Radius: 0.2, Arm: 0.2}),
	} {
		for _, diagnostics := range []bool{false, true} {
			q.Diagnostics = diagnostics
			plain, err := json.Marshal(compute(t, q))
			if err != nil {
				t.Fatal(err)
			}
			s := 1.234
			r, _ := probed(t, q, ProbeQuery{T: &s})
			r.Probe = nil
			with, _ := json.Marshal(r)
			if string(with) != string(plain) {
				t.Fatalf("%s (diagnostics %v): the probe changed the result", q.Kind, diagnostics)
			}
		}
	}
}

// At a sample, the probe is exactly the sample's diagnostics, and its
// construction the sample's own points.
func TestProbeAtASampleIsTheSample(t *testing.T) {
	clover := request("pedal", "", "", 0, 2*math.Pi)
	clover.Curve.Format, clover.Curve.R = "polar", "1 + 0.6*cos(3*t)"
	clover.Samples = 1200
	evoluteInput := request("pedal", "2*cos(t)", "sin(t)", 0, 2*math.Pi)
	evoluteInput.Input, evoluteInput.Pole = "evolute", Vec{0.3, 0.1}
	for _, q := range []Request{
		request("evolute", "2*cos(t)", "sin(t)", 0, 2*math.Pi),
		clover,
		evoluteInput,
		request("involute", "cos(t)", "sin(t)", 0, 2*math.Pi),
		request("catacaustic", "cos(t)", "sin(t)", 0, 2*math.Pi),
		rollingRequest("cos(t)", "sin(t)", 0, 2*math.Pi, Roller{Side: "left", Radius: 0.2, Arm: 0.2}),
		request("pedal", "t", "t^3", -1, 1),
	} {
		d := diagnosed(t, q)
		r := compute(t, q)
		for _, j := range []int{0, 1, 17, q.Samples / 3, q.Samples / 2, q.Samples - 2, q.Samples - 1} {
			// As the sample loop places it.
			p := probeAtT(t, q, q.Curve.Min+float64(j)*((q.Curve.Max-q.Curve.Min)/float64(q.Samples-1)))
			same := func(name string, a, b *Vec) {
				if (a == nil) != (b == nil) || (a != nil && *a != *b) {
					t.Fatalf("%s %s at sample %d: %v, sample's %v", q.Kind, name, j, a, b)
				}
			}
			same("point", p.Point, r.Base[j])
			same("tangent", p.Tangent, d.Tangent[j])
			same("normal", p.Normal, d.Normal[j])
			same("center", p.Center, d.Center[j])
			for name, pair := range map[string][2]*float64{"curvature": {p.Curvature, d.Curvature[j]}, "length": {p.Length, d.Length[j]}} {
				if (pair[0] == nil) != (pair[1] == nil) || (pair[0] != nil && *pair[0] != *pair[1]) {
					t.Fatalf("%s %s at sample %d: %v, sample's %v", q.Kind, name, j, deref(pair[0]), deref(pair[1]))
				}
			}
			if r.Input != nil {
				same("input", p.Input, r.Input[j])
			}
			if want := r.Derived[j]; want != nil {
				// The construction's evaluator, not the sample loop's copy:
				// within rounding of its point.
				closeVec(t, p.Derived, *want, 1e-12*math.Max(1, want.Norm()))
			}
		}
	}
}

// An ellipse (a cos t, b sin t) between samples: its curvature, frame, and
// center of curvature on the evolute, which is also the evolute's point.
func TestProbeBetweenSamplesOfAnEllipse(t *testing.T) {
	const a, b = 2.0, 1.0
	q := request("evolute", "2*cos(t)", "sin(t)", 0, 2*math.Pi)
	q.Samples = 64
	for _, s := range between(q) {
		p := probeAtT(t, q, s)
		sn, cs := math.Sin(s), math.Cos(s)
		closeVec(t, p.Point, Vec{a * cs, b * sn}, 1e-12)
		kappa := a * b / math.Pow(a*a*sn*sn+b*b*cs*cs, 1.5)
		if p.Curvature == nil || math.Abs(*p.Curvature-kappa) > 1e-7*kappa {
			t.Fatalf("κ at t = %g is %v, want %g", s, p.Curvature, kappa)
		}
		T := Vec{-a * sn, b * cs}.Unit()
		closeVec(t, p.Tangent, T, 1e-9)
		closeVec(t, p.Normal, T.Perp(), 1e-9)
		center := Vec{(a*a - b*b) / a * cs * cs * cs, (b*b - a*a) / b * sn * sn * sn}
		closeVec(t, p.Center, center, 1e-6)
		closeVec(t, p.Derived, center, 1e-6)
		if p.Input != nil {
			t.Fatalf("an input %v for a construction on the base", p.Input)
		}
	}
}

// Arc length between samples continues the sample's own by Simpson's rule:
// exact on a circle, and against an independent quadrature on an ellipse,
// no farther from it than the samples are.
func TestProbeArcLengthBetweenSamples(t *testing.T) {
	q := request("evolute", "3*cos(t)", "3*sin(t)", 0, 2*math.Pi)
	q.Samples = 64
	for _, s := range between(q) {
		if p := probeAtT(t, q, s); p.Length == nil || math.Abs(*p.Length-3*s) > 1e-9 {
			t.Fatalf("length at t = %g is %v, want %g", s, p.Length, 3*s)
		}
	}
	e := request("evolute", "2*cos(t)", "sin(t)", 0, 2*math.Pi)
	e.Samples = 200
	exact := func(s float64) float64 {
		// Gauss–Legendre, five points on each of 2000 panels.
		nodes := []float64{0, -0.5384693101056831, 0.5384693101056831, -0.9061798459386640, 0.9061798459386640}
		weights := []float64{0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891}
		sum, m := 0.0, 2000
		for k := 0; k < m; k++ {
			a, h := s*float64(k)/float64(m), s/float64(m)
			for i, x := range nodes {
				u := a + h/2*(1+x)
				sum += h / 2 * weights[i] * math.Hypot(2*math.Sin(u), math.Cos(u))
			}
		}
		return sum
	}
	d := diagnosed(t, e)
	worst := 0.0
	for j, l := range d.Length {
		worst = math.Max(worst, math.Abs(*l-exact(sampleT(e, j))))
	}
	for _, s := range between(e) {
		p := probeAtT(t, e, s)
		if p.Length == nil || math.Abs(*p.Length-exact(s)) > worst+1e-12 {
			t.Fatalf("length at t = %g is %v, want %g within the samples' %g", s, p.Length, exact(s), worst)
		}
	}
}

// Constructions between samples, against their closed forms: the involute
// of a circle, the pedal of a circle from its center (the circle itself),
// and an evolute's pedal through a derived input.
func TestProbeConstructionsBetweenSamples(t *testing.T) {
	inv := request("involute", "cos(t)", "sin(t)", 0, 2*math.Pi)
	inv.Samples = 64
	for _, s := range between(inv) {
		p := probeAtT(t, inv, s)
		closeVec(t, p.Derived, Vec{math.Cos(s) + s*math.Sin(s), math.Sin(s) - s*math.Cos(s)}, 1e-9)
	}
	ped := request("pedal", "cos(t)", "sin(t)", 0, 2*math.Pi)
	ped.Pole, ped.Samples = Vec{}, 64
	for _, s := range between(ped) {
		closeVec(t, probeAtT(t, ped, s).Derived, Vec{math.Cos(s), math.Sin(s)}, 1e-9)
	}
	// The pedal of an ellipse's evolute from the center: the evolute's
	// point is E, its tangent along E′, and the foot the projection of the
	// pole on that line.
	q := request("pedal", "2*cos(t)", "sin(t)", 0, 2*math.Pi)
	q.Input, q.Pole, q.Samples = "evolute", Vec{}, 64
	for _, s := range between(q) {
		sn, cs := math.Sin(s), math.Cos(s)
		E := Vec{1.5 * cs * cs * cs, -3 * sn * sn * sn}
		dE := Vec{-4.5 * cs * cs * sn, -9 * sn * sn * cs}.Unit()
		p := probeAtT(t, q, s)
		closeVec(t, p.Input, E, 1e-6)
		closeVec(t, p.Derived, E.Sub(dE.Mul(E.Dot(dE))), 1e-5)
	}
}

// A share of the drawn length places the probe where the arc length from
// the first sample is that share of the whole: on a circle at that share of
// the domain, and on a wave where the readout's length says so.
func TestProbeAtAShareOfTheLength(t *testing.T) {
	q := request("evolute", "3*cos(t)", "3*sin(t)", 0, 2*math.Pi)
	q.Samples = 64
	for _, share := range []float64{0, 0.137, 0.5, 0.861, 1} {
		_, p := probed(t, q, ProbeQuery{Share: &share})
		if math.Abs(p.T-share*2*math.Pi) > 1e-9 {
			t.Fatalf("share %g at t = %g, want %g", share, p.T, share*2*math.Pi)
		}
	}
	w := request("evolute", "t", "sin(3*t)", 0, 10)
	d := diagnosed(t, w)
	total := *d.Length[len(d.Length)-1]
	for _, share := range []float64{0.2, 0.4321, 0.97} {
		_, p := probed(t, w, ProbeQuery{Share: &share})
		if p.Length == nil || math.Abs(*p.Length-share*total) > 1e-9*total {
			t.Fatalf("share %g: length %v of %g", share, p.Length, total)
		}
		// The length there is the one a probe at that t reads.
		if again := probeAtT(t, w, p.T); *again.Length != *p.Length {
			t.Fatalf("share %g: %g at t = %g, %g asked there", share, *p.Length, p.T, *again.Length)
		}
	}
}

// Across a gap between samples there is nothing to describe; beside it the
// length continues from the drawn sample before.
func TestProbeInAGap(t *testing.T) {
	q := request("evolute", "t", "sqrt(t^2 - 0.25)", -1, 1)
	q.Samples = 65
	p := probeAtT(t, q, 0.1)
	if p.Point != nil || p.Tangent != nil || p.Curvature != nil || p.Length != nil || p.Derived != nil {
		t.Fatalf("a probe in the gap: %+v", p)
	}
	r := compute(t, q)
	j := 0
	for r.Base[j+1] != nil {
		j++
	}
	// Past the last drawn sample before the gap, toward it.
	s := sampleT(q, j) + 0.3*(sampleT(q, j+1)-sampleT(q, j))
	if p := probeAtT(t, q, s); p.Point != nil && p.Length == nil {
		t.Fatalf("no length at t = %g beside the gap", s)
	}
}

// The probe query is the notebook's own, never typed: it is refused, not
// named as a field, when malformed, and on a curve it cannot evaluate at
// any parameter.
func TestProbeRefusals(t *testing.T) {
	inside, outside, share, wide := 0.5, 7.0, 0.5, 1.5
	nan := math.NaN()
	study := func() Request { return request("evolute", "cos(t)", "sin(t)", 0, 2*math.Pi) }
	chase := pursuitRequest(Pursuit{Pursuers: []Pursuer{{1, 0, 1}, {0, 1, 1}, {-1, 0, 1}}, Capture: 0.01}, 0, 10)
	flow := fieldRequest("-y", "x", []Seed{{1, 0}, {2, 0}}, 10, 0, 6)
	for name, c := range map[string]struct {
		q  Request
		at ProbeQuery
	}{
		"nothing":       {study(), ProbeQuery{}},
		"both":          {study(), ProbeQuery{T: &inside, Share: &share}},
		"outside":       {study(), ProbeQuery{T: &outside}},
		"not a number":  {study(), ProbeQuery{T: &nan}},
		"share above 1": {study(), ProbeQuery{Share: &wide}},
		"chase":         {chase, ProbeQuery{T: &inside}},
		"trajectory":    {flow, ProbeQuery{T: &inside}},
		"level set":     {implicitRequest("x^2+y^2", 1, square(2), 40), ProbeQuery{T: &inside}},
		"iterated map":  {attractorRequest(clifford()), ProbeQuery{T: &inside}},
	} {
		c.q.Probe = &c.at
		_, err := Compute(c.q)
		if err == nil || !strings.Contains(err.Error(), "probe") {
			t.Fatalf("%s: %v", name, err)
		}
	}
}

// ProbeOnly returns the probe a full computation would.
func TestProbeOnly(t *testing.T) {
	q := request("involute", "cos(t)", "sin(t)", 0, 2*math.Pi)
	s := 2.5
	_, want := probed(t, q, ProbeQuery{T: &s})
	q.Probe = &ProbeQuery{T: &s}
	got, err := ProbeOnly(q)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(got)
	b, _ := json.Marshal(want)
	if string(a) != string(b) {
		t.Fatalf("%s, want %s", a, b)
	}
	q.Probe = nil
	if _, err := ProbeOnly(q); err == nil {
		t.Fatal("ProbeOnly without a probe")
	}
}

func deref(x *float64) any {
	if x == nil {
		return nil
	}
	return *x
}

// Between samples the probe applies the samples' guards: no point where the
// construction's derivatives are ill-conditioned (the evolute needs r″,
// which |t|^1.5 lacks at 0), and no center beyond 100 study radii (beside
// the cubic's inflection, where κ ≈ 6t).
func TestProbeBetweenSamplesKeepsTheGuards(t *testing.T) {
	q := request("evolute", "t", "abs(t)^1.5", -1, 1)
	if p := probeAtT(t, q, 1e-5); p.Point != nil || p.Curvature != nil {
		t.Fatalf("a point where r″ is ill-conditioned: %+v", p)
	}
	if p := probeAtT(t, q, 0.5001); p.Point == nil || p.Curvature == nil {
		t.Fatalf("no point at t = 0.5001: %+v", p)
	}
	c := request("pedal", "t", "t^3", -1, 1)
	c.Samples = 4001
	p := probeAtT(t, c, 1e-4)
	if p.Curvature == nil || math.Abs(*p.Curvature-6e-4) > 1e-6 || p.Center != nil {
		t.Fatalf("κ %v, center %v beside the inflection", deref(p.Curvature), p.Center)
	}
	if p := probeAtT(t, c, 0.4001); p.Center == nil {
		t.Fatal("no center at t = 0.4001")
	}
}

// ProbeOnly leaves out refinement, which the probe never reads: the probe is
// the one a refined study's full computation gives, for every construction
// refinement evaluates.
func TestProbeOnlySkipsRefinement(t *testing.T) {
	inversion := request("inversion", "t", "0.02", -3, 3)
	inversion.Inversion = Inversion{Radius: 1}
	for _, q := range []Request{
		request("catacaustic", "cos(t)", "sin(t)", 0, 2*math.Pi),
		request("involute", "2*cos(t)", "sin(t)", 0, 2*math.Pi),
		rollingRequest("cos(t)", "sin(t)", 0, 2*math.Pi, Roller{Side: "left", Radius: 0.2, Arm: 0.2}),
		inversion,
	} {
		q.Adaptive, q.Samples = true, 64
		for _, s := range between(q) {
			_, want := probed(t, q, ProbeQuery{T: &s})
			q.Probe = &ProbeQuery{T: &s}
			got, err := ProbeOnly(q)
			if err != nil {
				t.Fatal(err)
			}
			a, _ := json.Marshal(got)
			b, _ := json.Marshal(want)
			if string(a) != string(b) {
				t.Fatalf("%s at t = %g: %s, refined study's %s", q.Kind, s, a, b)
			}
		}
	}
}

// ProbeOnly answers from the last study it computed only while the study is
// the same: switching studies and back, every answer is a fresh
// computation's, and a malformed query on the kept study is still refused.
func TestProbeOnlyFollowsTheStudy(t *testing.T) {
	a := request("involute", "cos(t)", "sin(t)", 0, 2*math.Pi)
	b := a
	b.Offset = 0.5
	c := a
	c.Curve.Max = math.Pi
	for _, q := range []Request{a, b, a, c, a, a} {
		for _, s := range []float64{0.3, 1.7, 2.9} {
			_, want := probed(t, q, ProbeQuery{T: &s})
			q.Probe = &ProbeQuery{T: &s}
			got, err := ProbeOnly(q)
			if err != nil {
				t.Fatal(err)
			}
			x, _ := json.Marshal(got)
			y, _ := json.Marshal(want)
			if string(x) != string(y) {
				t.Fatalf("offset %g, max %g, t = %g: %s, want %s", q.Offset, q.Curve.Max, s, x, y)
			}
		}
	}
	outside := 7.0
	a.Probe = &ProbeQuery{T: &outside}
	if _, err := ProbeOnly(a); err == nil {
		t.Fatal("a parameter outside the kept study's domain")
	}
}
