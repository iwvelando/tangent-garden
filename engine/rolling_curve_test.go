package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"
)

func curveRequest(x, y string, lo, hi float64, side string, m MovingCurve, point Vec) Request {
	return rollingRequest(x, y, lo, hi, Roller{Side: side, Shape: "curve", Curve: m, Point: point})
}

// A circle entered as a rolling curve reproduces the rolling circle: with
// ρ(cos u, sin u) starting at u₀, the point ℓ(cos(u₀+ψ), sin(u₀+ψ)) is the
// circle's arm at phase ψ. The base is long enough that the closed circle
// wraps around several times, on both sides.
func TestRollingCurveReducesToRollingCircle(t *testing.T) {
	for _, tc := range []struct {
		x, y   string
		side   string
		rho    float64
		start  float64
		arm    float64
		phase  float64
		lo, hi float64
	}{
		{"5*cos(t)", "5*sin(t)", "left", 2, 0, 3, .4, 0, 4 * math.Pi},
		{"3*cos(t)", "3*sin(t)", "right", 1.3, 1, .7, -1, 0, 4 * math.Pi},
		{"2*cos(t)", "1.2*sin(t)", "left", .45, 2.5, .8, .3, -2, 3},
		{"t", "sin(t)", "right", .3, 5, .5, 2, -2, 3},
	} {
		want := compute(t, rollingRequest(tc.x, tc.y, tc.lo, tc.hi, Roller{Side: tc.side, Radius: tc.rho, Arm: tc.arm, Phase: tc.phase}))
		m := MovingCurve{X: fmt.Sprintf("%v*cos(t)", tc.rho), Y: fmt.Sprintf("%v*sin(t)", tc.rho), Min: 0, Max: 2 * math.Pi, Start: tc.start}
		q := curveRequest(tc.x, tc.y, tc.lo, tc.hi, tc.side, m, Vec{tc.arm * math.Cos(tc.start+tc.phase), tc.arm * math.Sin(tc.start+tc.phase)})
		r := compute(t, q)
		if r.Invalid != 0 || len(r.Warnings) != 0 {
			t.Fatalf("%s: %d invalid, %v", tc.x, r.Invalid, r.Warnings)
		}
		if !r.Moving.Closed {
			t.Fatalf("%s: circle not detected as closed", tc.x)
		}
		for j := range r.Derived {
			closeVec(t, r.Derived[j], *want.Derived[j], 1e-9)
		}
		if len(r.Moving.Positions) != q.Lines || len(r.Rolling) != 0 {
			t.Fatalf("%d placements, %d circles", len(r.Moving.Positions), len(r.Rolling))
		}
		for k, s := range r.Moving.Positions {
			c := want.Rolling[k]
			closeVec(t, &s.Contact, c.Contact, 0)
			closeVec(t, &s.Point, c.Point, 1e-9)
			// The body origin is the circle's center.
			closeVec(t, &s.Origin, c.Center, 1e-9)
		}
	}
}

// A parabola rolling on a line: its focus traces a catenary, y = f cosh(x/f)
// for focal distance f, with the vertex's first contact at the origin. The
// catenary's normal meets the line at the contact, which has rolled s.
func TestRollingCurveCatenary(t *testing.T) {
	for _, f := range []float64{1, .6} {
		m := MovingCurve{X: "t", Y: fmt.Sprintf("t^2/(4*%v)", f), Min: -6, Max: 6, Start: 0}
		q := curveRequest("t", "0", 0, 3, "left", m, Vec{0, f})
		q.Samples = 2001
		r := compute(t, q)
		if r.Invalid != 0 || r.Moving.Closed {
			t.Fatalf("%d invalid, closed %v", r.Invalid, r.Moving.Closed)
		}
		for j, p := range r.Derived {
			if e := math.Abs(p.Y - f*math.Cosh(p.X/f)); e > 1e-10 {
				t.Fatalf("f=%g: focus %v off the catenary by %g", f, p, e)
			}
			if e := math.Abs(p.X + p.Y*math.Sinh(p.X/f) - sampleT(q, j)); e > 1e-10 {
				t.Fatalf("f=%g: normal at %v misses the contact by %g", f, p, e)
			}
		}
	}
}

// Two congruent ellipses rolling on each other from matching vertices stay
// mirror images across the common tangent, so by the reflective property the
// moving focus stays at 2a from the fixed ellipse's far focus: it traces a
// circle. Arc-length matching converges at fourth order.
func TestRollingCurveEllipseOnEllipse(t *testing.T) {
	a, b := 2.0, 1.2
	c := math.Sqrt(a*a - b*b)
	worst := func(samples int, start float64) float64 {
		m := MovingCurve{X: fmt.Sprintf("%v*cos(t)", a), Y: fmt.Sprintf("%v*sin(t)", b), Min: start, Max: start + 2*math.Pi}
		q := curveRequest(m.X, m.Y, 0, 4*math.Pi, "right", m, Vec{c, 0})
		q.Samples = samples
		r := compute(t, q)
		if r.Invalid != 0 || len(r.Warnings) != 0 || !r.Moving.Closed {
			t.Fatalf("%d invalid, %v, closed %v", r.Invalid, r.Warnings, r.Moving.Closed)
		}
		e := 0.0
		for _, p := range r.Derived {
			e = math.Max(e, math.Abs(p.Sub(Vec{-c, 0}).Norm()-2*a))
		}
		return e
	}
	// The domain may start anywhere on a closed curve: here it also starts
	// away from the vertex, and the contact wraps past the domain start.
	for _, start := range []float64{0, -1} {
		coarse, fine, finest := worst(250, start), worst(1000, start), worst(8001, start)
		t.Logf("start %g: %g %g %g", start, coarse, fine, finest)
		if fine > coarse/50 || finest > 1e-10 {
			t.Fatalf("start %g: focus off the circle by %g, %g, %g", start, coarse, fine, finest)
		}
	}
}

// The contact is the instantaneous center of rotation: the trace moves at
// right angles to the segment from the contact, the construction line.
// The moving curve touches the base there, tangent to it, on the chosen side.
func TestRollingCurveWithoutSlipping(t *testing.T) {
	flower := [2]string{"(1+0.18*cos(5*t))*cos(t)", "(1+0.18*cos(5*t))*sin(t)"}
	for _, side := range []string{"left", "right"} {
		for _, point := range []Vec{{.1, .05}, {-.2, .3}} {
			m := MovingCurve{X: "0.15*cos(t)+0.02*cos(2*t)", Y: "0.08*sin(t)", Min: 0, Max: 2 * math.Pi, Start: .5}
			q := curveRequest(flower[0], flower[1], 0, 2*math.Pi, side, m, point)
			q.Samples = 8001
			r := compute(t, q)
			if r.Invalid != 0 || len(r.Warnings) != 0 {
				t.Fatalf("%s: %d invalid %v", side, r.Invalid, r.Warnings)
			}
			for j := 2; j < q.Samples-2; j += 7 {
				arm := r.Derived[j].Sub(*r.Base[j])
				d := r.Derived
				v := d[j+1].Sub(*d[j-1]).Mul(8).Sub(d[j+2].Sub(*d[j-2]))
				if e := math.Abs(v.Dot(arm)) / (v.Norm() * arm.Norm()); e > 1e-4 {
					t.Fatalf("%s %v at %d: trace not normal to contact arm, cosine %g", side, point, j, e)
				}
			}
			f := mustCompile(t, q.Curve)
			for _, s := range r.Moving.Positions {
				p := *r.Base[s.SampleIndex]
				closeVec(t, &s.Contact, p, 0)
				dp, _ := derivatives(f, sampleT(q, s.SampleIndex), q.Curve.Min, q.Curve.Max)
				// The placed moving curve passes through the contact, tangent
				// to the base, and bulges toward the chosen side.
				gap, bulge := math.Inf(1), 0.0
				for _, v := range r.Moving.Path {
					w := place(s, *v)
					gap = math.Min(gap, w.Sub(p).Norm())
					bulge += w.Sub(p).Dot(dp.Perp().Unit())
				}
				if gap > 1e-3 {
					t.Fatalf("moving curve %g from the contact", gap)
				}
				if want := map[string]float64{"left": 1, "right": -1}[side]; bulge*want <= 0 {
					t.Fatalf("moving curve on the wrong side for %s", side)
				}
				// The tracing point is the body point carried rigidly.
				closeVec(t, &s.Point, place(s, point), 1e-12)
			}
		}
	}
}

// place carries a point of the moving curve's own frame to the drawing.
func place(s Placement, v Vec) Vec {
	sin, cos := math.Sincos(s.Angle)
	return s.Origin.Add(Vec{cos*v.X - sin*v.Y, sin*v.X + cos*v.Y})
}

// The moving curve's own frame is arbitrary: rotating and translating its
// definition with the tracing point, or reparameterizing it, leaves the trace
// unchanged.
func TestRollingCurveFrameIndependence(t *testing.T) {
	m := MovingCurve{X: "0.5*cos(t)", Y: "0.3*sin(t)+0.1*cos(2*t)", Min: 0, Max: 2 * math.Pi, Start: 1}
	point := Vec{.2, .1}
	q := curveRequest("2*cos(t)", "1.2*sin(t)", 0, 5, "right", m, point)
	q.Samples = 4001
	want := compute(t, q)
	b := .8
	cb, sb := math.Cos(b), math.Sin(b)
	moved := MovingCurve{
		X:   fmt.Sprintf("3+%v*0.5*cos(t)-%v*(0.3*sin(t)+0.1*cos(2*t))", cb, sb),
		Y:   fmt.Sprintf("-1+%v*0.5*cos(t)+%v*(0.3*sin(t)+0.1*cos(2*t))", sb, cb),
		Min: 0, Max: 2 * math.Pi, Start: 1,
	}
	// Doubling the parameter's speed halves the domain and start.
	fast := MovingCurve{X: "0.5*cos(2*t)", Y: "0.3*sin(2*t)+0.1*cos(4*t)", Min: 0, Max: math.Pi, Start: .5}
	for name, v := range map[string]Request{
		"rigid":          curveRequest(q.Curve.X, q.Curve.Y, 0, 5, "right", moved, Vec{3 + cb*point.X - sb*point.Y, -1 + sb*point.X + cb*point.Y}),
		"reparameterize": curveRequest(q.Curve.X, q.Curve.Y, 0, 5, "right", fast, point),
	} {
		v.Samples = q.Samples
		r := compute(t, v)
		for j := range r.Derived {
			if r.Derived[j].Sub(*want.Derived[j]).Norm() > 1e-9 {
				t.Fatalf("%s: %v, want %v", name, r.Derived[j], want.Derived[j])
			}
		}
	}
}

// The contact stops explicitly where the moving curve runs out: at the end of
// an open curve's domain, or at a cusp or invalid point on it.
func TestRollingCurveStops(t *testing.T) {
	for _, tc := range []struct {
		name    string
		m       MovingCurve
		side    string
		stop    float64 // base arc length where the contact stops
		early   float64 // how far short of it the last sample may be
		warning string
	}{
		// The parabola (t, t²/4) from its vertex: arc length to t = 2 is
		// √2 + asinh(1).
		{"domain end", MovingCurve{X: "t", Y: "t^2/4", Min: -1, Max: 2, Start: 0}, "left", math.Sqrt2 + math.Asinh(1), .01, "end of the rolling curve's domain"},
		{"domain start", MovingCurve{X: "t", Y: "t^2/4", Min: -2, Max: 1, Start: 0}, "right", math.Sqrt2 + math.Asinh(1), .01, "end of the rolling curve's domain"},
		// The astroid's cusp at u = π/2, arc length 1.5·sin²(π/2) − 1.5·sin²(0.3)
		// from u = 0.3.
		{"cusp", MovingCurve{X: "cos(t)^3", Y: "sin(t)^3", Min: 0, Max: 3, Start: .3}, "left", 1.5 * (1 - math.Pow(math.Sin(.3), 2)), .01, "cusp, corner, or invalid point"},
		// A quarter circle to the vertical tangent at t = 1, beyond which the
		// curve is undefined. Samples just before it are already unstable.
		{"invalid", MovingCurve{X: "t", Y: "sqrt(1-t^2)", Min: -.5, Max: 2, Start: 0}, "left", math.Pi / 2, .2, "cusp, corner, or invalid point"},
	} {
		q := curveRequest("t", "0", 0, 3, tc.side, tc.m, Vec{0, .5})
		r := compute(t, q)
		for j, p := range r.Derived {
			s := sampleT(q, j)
			if s < tc.stop-tc.early && p == nil || s > tc.stop+.01 && p != nil {
				t.Fatalf("%s at s=%g: %v", tc.name, s, p)
			}
		}
		if !strings.Contains(strings.Join(r.Warnings, " "), tc.warning) {
			t.Fatalf("%s: warnings %v", tc.name, r.Warnings)
		}
		for _, s := range r.Moving.Positions {
			if sampleT(q, s.SampleIndex) > tc.stop+.01 {
				t.Fatalf("%s: placement after the stop at %d", tc.name, s.SampleIndex)
			}
		}
	}
	// A cusp on the base stops a rolling curve too, naming the curve.
	q := curveRequest("cos(t)^3", "sin(t)^3", .3, 2, "left", MovingCurve{X: "0.1*cos(t)", Y: "0.1*sin(t)", Max: 2 * math.Pi}, Vec{})
	if w := strings.Join(compute(t, q).Warnings, " "); !strings.Contains(w, "the rolling curve cannot roll past it") {
		t.Fatalf("warnings %v", w)
	}
}

func TestRollingCurveResult(t *testing.T) {
	m := MovingCurve{X: "0.5*cos(t)", Y: "0.3*sin(t)", Min: 0, Max: 2 * math.Pi}
	q := curveRequest("2*cos(t)", "1.2*sin(t)", 0, 6, "right", m, Vec{.4, 0})
	r := compute(t, q)
	if len(r.Moving.Positions) != q.Lines || len(r.Rays) != q.Lines || len(r.Moving.Path) != q.Samples {
		t.Fatalf("%d placements, %d rays, %d path points", len(r.Moving.Positions), len(r.Rays), len(r.Moving.Path))
	}
	// The path is the moving curve in its own frame over its domain.
	closeVec(t, r.Moving.Path[0], Vec{.5, 0}, 1e-15)
	closeVec(t, r.Moving.Path[q.Samples-1], Vec{.5, 0}, 1e-12)
	for k, s := range r.Moving.Positions {
		ray := r.Rays[k]
		if ray.SampleIndex != s.SampleIndex {
			t.Fatalf("placement %d: %+v ray %+v", k, s, ray)
		}
		closeVec(t, &ray.Origin, s.Contact, 0)
		closeVec(t, ray.Target, s.Point, 0)
		closeVec(t, r.Derived[s.SampleIndex], s.Point, 0)
	}
	b, _ := json.Marshal(r)
	if !strings.Contains(string(b), `"moving":{"path":[{"x":0.5,"y":0},`) || !strings.Contains(string(b), `"positions":[{"sampleIndex":0,"origin":`) {
		t.Fatalf("JSON %s", b)
	}
	// A rolling circle, and every other construction, has no moving curve,
	// even with curve settings present.
	for _, other := range []Request{
		rollingRequest("2*cos(t)", "1.2*sin(t)", 0, 6, Roller{Side: "left", Radius: .3, Curve: m}),
		offsetRequest("2*cos(t)", "1.2*sin(t)", 0, 6, .2),
	} {
		other.Rolling.Curve = MovingCurve{X: "?"}
		if o := compute(t, other); o.Moving != nil {
			t.Fatalf("%s moving %v", other.Kind, o.Moving)
		}
	}
	// The moving curve's expressions share the shape parameter a.
	withA := curveRequest("2*cos(t)", "1.2*sin(t)", 0, 6, "right", MovingCurve{X: "a*cos(t)", Y: "0.3*sin(t)", Max: 2 * math.Pi}, Vec{.4, 0})
	withA.Curve.A = .5
	for j, p := range compute(t, withA).Derived {
		closeVec(t, p, *r.Derived[j], 0)
	}
}

func TestRollingCurveInvalid(t *testing.T) {
	ok := Roller{Side: "left", Shape: "curve", Curve: MovingCurve{X: "cos(t)", Y: "sin(t)", Min: 0, Max: 1, Start: .5}}
	for _, tc := range []struct {
		change func(*Roller)
		want   string
	}{
		{func(c *Roller) { c.Shape = "square" }, "circle or a curve"},
		{func(c *Roller) { c.Side = "up" }, "left or right"},
		{func(c *Roller) { c.Curve.X = "cos(" }, "rolling curve x"},
		{func(c *Roller) { c.Curve.Y = "s" }, "rolling curve y"},
		{func(c *Roller) { c.Curve.Max = 0 }, "rolling curve domain"},
		{func(c *Roller) { c.Curve.Min = math.NaN() }, "rolling curve domain"},
		{func(c *Roller) { c.Curve.Start = 1.5 }, "contact starts"},
		{func(c *Roller) { c.Curve.Start = math.Inf(-1) }, "contact starts"},
		{func(c *Roller) { c.Point.X = math.NaN() }, "tracing point"},
		{func(c *Roller) { c.Point.Y = 2e5 }, "tracing point"},
	} {
		c := ok
		tc.change(&c)
		_, err := Compute(rollingRequest("cos(t)", "sin(t)", 0, 1, c))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%+v: %v", c, err)
		}
	}
	// A curve ignores the circle's settings; the start may sit on either end.
	for _, start := range []float64{0, 1} {
		c := ok
		c.Radius, c.Curve.Start, c.Point = -1, start, Vec{-1e5, 1e5}
		if _, err := Compute(rollingRequest("cos(t)", "sin(t)", 0, 1, c)); err != nil {
			t.Fatal(err)
		}
	}
}
