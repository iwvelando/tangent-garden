package engine

import (
	"encoding/json"
	"math"
	"testing"
)

// Refinement of the involute between samples. Expectations come from
// independent closed forms and quadratures evaluated here.

// circleInvolute is the involute of the unit circle (cos t, sin t) unwound
// from t = 0 with string offset c: r − (t + c)T, T = (−sin t, cos t).
func circleInvolute(c float64) func(float64) Vec {
	return func(t float64) Vec {
		return Vec{math.Cos(t) + (t+c)*math.Sin(t), math.Sin(t) - (t+c)*math.Cos(t)}
	}
}

// Over two turns the involute of a circle unwinds into a spiral whose arms
// grow far apart, and 64 samples draw its outer arm as a polygon.
func TestRefinementOfTheInvoluteOfACircle(t *testing.T) {
	q := request("involute", "cos(t)", "sin(t)", 0, 4*math.Pi)
	q.Samples, q.Offset = 64, 0.5
	uniform := compute(t, q)
	r := compute(t, adaptive(q))
	checkRefined(t, q, r.Adaptive.Derived, r.Derived, circleInvolute(q.Offset))
	// Nothing else in the result changes: the strings keep the samples.
	r.Adaptive = nil
	a, _ := json.Marshal(r)
	b, _ := json.Marshal(uniform)
	if string(a) != string(b) {
		t.Fatal("refinement changed the rest of the result")
	}
}

// ellipseArc is the arc length of the ellipse (a cos u, b sin u) from 0 to
// t, by 20-point Gauss–Legendre quadrature on 64 panels of its speed.
func ellipseArc(t float64) float64 {
	nodes := [10]float64{0.0765265211334973, 0.2277858511416451, 0.3737060887154195, 0.5108670019508271, 0.6360536807265150, 0.7463319064601508, 0.8391169718222188, 0.9122344282513259, 0.9639719272779138, 0.9931285991850949}
	weights := [10]float64{0.1527533871307258, 0.1491729864726037, 0.1420961093183820, 0.1316886384491766, 0.1181945319615184, 0.1019301198172404, 0.0832767415767048, 0.0626720483341091, 0.0406014298003869, 0.0176140071391521}
	speed := func(u float64) float64 { return math.Hypot(ellipseA*math.Sin(u), ellipseB*math.Cos(u)) }
	const panels = 64
	h := t / panels
	s := 0.0
	for k := 0; k < panels; k++ {
		mid := (float64(k) + 0.5) * h
		for i, x := range nodes {
			s += weights[i] * h / 2 * (speed(mid-x*h/2) + speed(mid+x*h/2))
		}
	}
	return s
}

// ellipseInvolute is the involute of the ellipse (a cos t, b sin t) unwound
// from t = 0 with string offset c.
func ellipseInvolute(c float64) func(float64) Vec {
	return func(t float64) Vec {
		tangent := Vec{-ellipseA * math.Sin(t), ellipseB * math.Cos(t)}.Unit()
		return Vec{ellipseA * math.Cos(t), ellipseB * math.Sin(t)}.Sub(tangent.Mul(ellipseArc(t) + c))
	}
}

// On an ellipse the speed varies, so the arc length between samples is
// Simpson's rule, not exact.
func TestRefinementOfTheInvoluteOfAnEllipse(t *testing.T) {
	// The quadrature against the perimeter of the ellipse with semi-axes 2
	// and 1, 4·E(√3/2) for the complete elliptic integral E.
	if p := ellipseArc(2 * math.Pi); math.Abs(p-9.688448220547675) > 1e-12 {
		t.Fatalf("perimeter %.15f", p)
	}
	q := ellipseRequest("involute")
	r := compute(t, adaptive(q))
	checkRefined(t, q, r.Adaptive.Derived, r.Derived, ellipseInvolute(0))
	q.Offset = -3
	r = compute(t, adaptive(q))
	checkRefined(t, q, r.Adaptive.Derived, r.Derived, ellipseInvolute(q.Offset))
	// Between samples the arc length is as accurate as at them: Simpson's
	// rule on the part of an interval, continued from its sample, errs by
	// far less than the samples' own accumulated error.
	exact := ellipseInvolute(q.Offset)
	path := r.Adaptive.Derived
	ts := positions(q, path)
	samples, between := 0.0, 0.0
	for k, p := range path.Points {
		e := p.Sub(exact(ts[k])).Norm()
		if path.At[k] == math.Trunc(path.At[k]) {
			samples = math.Max(samples, e)
		} else {
			between = math.Max(between, e)
		}
	}
	if samples > 1e-5 || between > 2*samples {
		t.Fatalf("error %g at the samples, %g between them", samples, between)
	}
}

// Unwinding a string from a curve's evolute, with the initial length equal
// to the radius of curvature at the domain start, retraces the curve while
// the evolute has no cusp. The evolute of the logarithmic spiral e^{kt}(cos
// t, sin t) is a congruent spiral, and its radius of curvature at t = 0 is
// √(1 + k²): over three turns its involute is the spiral itself, which 64
// samples draw as a polygon.
func TestRefinementOfTheInvoluteOfAnEvolute(t *testing.T) {
	const k = 0.2
	q := inputRequest("involute", "evolute", "exp(0.2*t)*cos(t)", "exp(0.2*t)*sin(t)", 0, 6*math.Pi)
	q.Samples = 64
	q.Offset = math.Sqrt(1 + k*k)
	spiral := func(s float64) Vec { return Vec{math.Cos(s), math.Sin(s)}.Mul(math.Exp(k * s)) }
	r := compute(t, adaptive(q))
	if r.Invalid != 0 {
		t.Fatalf("%d invalid: %v", r.Invalid, r.Warnings)
	}
	checkRefined(t, q, r.Adaptive.Derived, r.Derived, spiral)
}

// Evaluated at each sample, the refined involute returns exactly the
// uniform study's point, or nothing where it has none: past a cusp, where it
// is left open, and after its string stops at an invalid interval.
func TestRefinedInvoluteAgreesWithTheSamples(t *testing.T) {
	circle := request("involute", "cos(t)", "sin(t)", 0, 4*math.Pi)
	circle.Samples, circle.Offset = 64, 0.5
	evolute := inputRequest("involute", "evolute", "2*cos(t)", "sin(t)", 0.1, 6.3)
	evolute.Samples, evolute.Offset = 64, 1
	stops := request("involute", "t", "sqrt(0.5 - t)", -1, 1)
	stops.Samples = 64
	for name, q := range map[string]Request{"circle": circle, "evolute": evolute, "stops": stops} {
		r := compute(t, q)
		f, err := compile(q.Curve)
		if err != nil {
			t.Fatal(err)
		}
		g := inputCurve(q.Input, f, q.Curve.Min, q.Curve.Max, q.Pole, q.Distance)
		at := q.derivedAt(f, g, &r)
		if at == nil {
			t.Fatalf("%s: no evaluator", name)
		}
		step := (q.Curve.Max - q.Curve.Min) / float64(q.Samples-1)
		gaps := 0
		for j, want := range r.Derived {
			got := at(q.Curve.Min + float64(j)*step)
			switch {
			case want != nil && (got == nil || *got != *want):
				t.Fatalf("%s at sample %d: %v, want %v", name, j, got, *want)
			case want == nil && got != nil:
				t.Fatalf("%s at sample %d: %v where the samples have none", name, j, *got)
			case want == nil:
				gaps++
			}
		}
		if name != "circle" && gaps == 0 {
			t.Fatalf("%s: no gaps to compare", name)
		}
	}
}

// The involute is broken wherever the curve it unwinds from is: here at a
// pole between samples, which the samples' arc length steps across.
func TestRefinementBreaksTheInvoluteWhereItsBaseBreaks(t *testing.T) {
	q := request("involute", "t", "1/(t - 0.0131)", -1, 1)
	q.Samples = 64
	r := compute(t, adaptive(q))
	gap := func(p *RefinedPath) int {
		for k, q := range p.Points {
			if q == nil {
				return int(p.At[k])
			}
		}
		return -1
	}
	if r.Derived[31] == nil || r.Derived[32] == nil {
		t.Fatal("the uniform involute is already open at the pole")
	}
	if r.Adaptive.Derived == nil {
		t.Fatal("involute not refined")
	}
	if g := gap(r.Adaptive.Base); g != 31 || gap(r.Adaptive.Derived) != g {
		t.Fatalf("base broken in interval %d, its involute in %d", g, gap(r.Adaptive.Derived))
	}
}

// At a corner between samples the tangent turns at once, and the involute
// jumps by its string times the turn: refinement breaks it there, although
// the samples on either side join it and the curve itself is continuous.
func TestRefinementBreaksTheInvoluteAtACorner(t *testing.T) {
	const corner = 0.007
	q := request("involute", "t", "t^2 + 0.3*abs(t - 0.007)", -1, 1)
	q.Samples = 64
	r := compute(t, adaptive(q))
	for i, p := range r.Derived {
		if p == nil {
			t.Fatalf("uniform involute already open at sample %d", i)
		}
	}
	if b := r.Adaptive.Base; b.Breaks != 0 {
		t.Fatalf("the curve broken %d times", b.Breaks)
	}
	path := r.Adaptive.Derived
	if path == nil || path.Breaks != 1 {
		t.Fatalf("involute not broken once: %+v", path)
	}
	checkUniform(t, path, r.Derived)
	// The tangent is undefined within the stencil's reach of the corner,
	// two spacings of 2·10⁻⁴ either side, and the involute with it.
	reach := 2*2e-4 + 2.0/63/1024
	ts := positions(q, path)
	for k, p := range path.Points {
		x := ts[k]
		if p == nil && math.Abs(x-corner) > reach {
			t.Fatalf("break at %g, far from the corner", x)
		}
		if p != nil && math.Abs(x-corner) < 2e-4 {
			t.Fatalf("involute drawn at %g, on the corner", x)
		}
	}
}

// A gap in the curve a fifth of a sample step wide, between an interval's
// quarter point and midpoint on a gently curving stretch, where neither the
// samples nor that interval's three probes fall in it: refinement's scan
// finds it, and the involute is broken there with its curve.
func TestRefinementFindsANarrowGapBeneathTheInvolute(t *testing.T) {
	h := 2.0 / 64
	gap := -1 + 58.375*h
	q := request("involute", "t", "t^2 + 0*sqrt((t - a)^2 - 0.1^2*0.03125^2)", -1, 1)
	q.Curve.A, q.Samples = gap, 65
	uniform := compute(t, q)
	for i, p := range uniform.Base {
		if p == nil {
			t.Fatalf("a sample at %d falls in the gap", i)
		}
	}
	r := compute(t, adaptive(q))
	base, involute := r.Adaptive.Base, r.Adaptive.Derived
	if base.Breaks != 1 || involute == nil || involute.Breaks != 0 {
		t.Fatalf("base broken %d times, involute %+v", base.Breaks, involute)
	}
	for _, p := range []*RefinedPath{base, involute} {
		open := 0
		for k, v := range p.Points {
			if v == nil {
				open++
				if int(p.At[k]) != 58 {
					t.Fatalf("broken in interval %g", p.At[k])
				}
			}
		}
		if open == 0 {
			t.Fatal("not broken at the gap")
		}
	}
	// The base is drawn up to the gap's edges, to within two finest steps.
	ts := positions(q, base)
	first, last := -1, -1
	for k, p := range base.Points {
		if p == nil {
			if first < 0 {
				first = k
			}
			last = k
		}
	}
	finest := h / 1024
	if a, b := ts[first-1], ts[last+1]; math.Abs(a-(gap-0.1*h)) > 2*finest || math.Abs(b-(gap+0.1*h)) > 2*finest {
		t.Fatalf("the gap drawn from %g to %g, want %g to %g", a, b, gap-0.1*h, gap+0.1*h)
	}
}

// Length units must not decide whether a regular circle can unwind. Check
// actual sampled and refined geometry against the circle's closed form.
func TestInvoluteAtSmallScales(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-35, 0x1p-45} {
		t.Run(num(scale), func(t *testing.T) {
			q := request("involute", num(scale)+"*cos(t)", num(scale)+"*sin(t)", 0, 4*math.Pi)
			q.Samples, q.Lines, q.Offset = 65, 9, .5*scale
			r := compute(t, adaptive(q))
			if r.Invalid != 0 || len(r.Rays) != q.Lines {
				t.Fatalf("invalid=%d, strings=%d, want 0 and %d", r.Invalid, len(r.Rays), q.Lines)
			}
			for j, p := range r.Derived {
				if p == nil {
					t.Fatalf("sample %d has no involute at scale %g", j, scale)
				}
				want := circleInvolute(.5)(sampleT(q, j)).Mul(scale)
				if e := p.Sub(want).Norm() / scale; e > 1e-7 {
					t.Fatalf("sample %d error=%g radii", j, e)
				}
			}
			path := r.Adaptive.Derived
			if path == nil || path.Inserted == 0 {
				t.Fatal("involute not refined")
			}
			for j, p := range path.Points {
				if p == nil {
					t.Fatalf("refined point %d is a gap", j)
				}
				u := q.Curve.Min + path.At[j]*(q.Curve.Max-q.Curve.Min)/float64(q.Samples-1)
				if e := p.Sub(circleInvolute(.5)(u).Mul(scale)).Norm() / scale; e > 1e-7 {
					t.Fatalf("refined point %d error=%g radii", j, e)
				}
			}
			at := .731
			q.Probe = &ProbeQuery{T: &at}
			probed := compute(t, q)
			if probed.Probe == nil || probed.Probe.Derived == nil {
				t.Fatal("between-sample probe has no string end")
			}
		})
	}
}

// A rounded derivative at a cusp must not become an unwinding direction,
// even at the origin, where the point alone supplies no length reference.
func TestInvoluteStationaryAtEveryScale(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-35, 0x1p-45} {
		for _, xy := range [][2]string{{"1-cos(20*t)", "20*t-sin(20*t)"}, {"1", "1"}, {"0", "0"}} {
			q := request("involute", num(scale)+"*("+xy[0]+")", num(scale)+"*("+xy[1]+")", -1, 1)
			q.Samples = 65
			r := compute(t, q)
			if r.Derived[32] != nil {
				t.Fatalf("scale %g, %v: string at stationary point: %v", scale, xy, r.Derived[32])
			}
		}
	}
}

// The guard's 10⁻⁹ is a rounding bound, not a speed requirement. A unit
// circle 1000 units from the origin, traced so slowly that its speed is
// 10⁻⁷ of its distance per unit of t, still unwinds everywhere, a
// hundredfold inside the guard.
func TestSlowlyTracedInvoluteKeepsItsStrings(t *testing.T) {
	const rate, center = 1e-4, 1000.
	q := request("involute", num(center)+"+cos("+num(rate)+"*t)", "sin("+num(rate)+"*t)", 0, 2*math.Pi/rate)
	q.Samples, q.Lines, q.Offset = 65, 9, .5
	r := compute(t, q)
	if r.Invalid != 0 || len(r.Rays) != q.Lines {
		t.Fatalf("invalid=%d, strings=%d, want 0 and %d", r.Invalid, len(r.Rays), q.Lines)
	}
	for j, p := range r.Derived {
		want := circleInvolute(.5)(rate * sampleT(q, j)).Add(Vec{center, 0})
		if p == nil || p.Sub(want).Norm() > 1e-7 {
			t.Fatalf("sample %d: got %v, want %v", j, p, want)
		}
	}
}
