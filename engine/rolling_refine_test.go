package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"testing"
)

// Refinement of rolling circles and rolling curves between samples.
// Expectations come from independent closed forms and invariants evaluated
// here.

// trochoid is the trace of a circle of radius rho rolling on the
// counterclockwise circle of radius big, with arm ell at phase psi: outside
// (an epitrochoid) on its right, inside (a hypotrochoid) on its left. The
// center is at (R ± ρ)(cos t, sin t), and the arm turns from the contact
// direction by ψ ± Rt/ρ.
func trochoid(big, rho, ell, psi float64, outside bool) func(float64) Vec {
	return func(t float64) Vec {
		if outside {
			a := math.Pi + psi + (big+rho)*t/rho
			return Vec{math.Cos(t), math.Sin(t)}.Mul(big + rho).Add(Vec{math.Cos(a), math.Sin(a)}.Mul(ell))
		}
		a := t + psi - big*t/rho
		return Vec{math.Cos(t), math.Sin(t)}.Mul(big - rho).Add(Vec{math.Cos(a), math.Sin(a)}.Mul(ell))
	}
}

// Rolled around a circle, the arm sweeps loops far tighter than the
// samples' spacing along the base, which they draw as a jagged star.
func TestRefinementOfTrochoids(t *testing.T) {
	for _, tc := range []struct {
		side          string
		rho, ell, psi float64
		outside       bool
	}{
		{"right", 1, 1.8, .3, true},
		{"left", .75, 1.2, -.4, false},
	} {
		q := rollingRequest("3*cos(t)", "3*sin(t)", 0, 2*math.Pi, Roller{Side: tc.side, Radius: tc.rho, Arm: tc.ell, Phase: tc.psi})
		q.Samples = 64
		uniform := compute(t, q)
		r := compute(t, adaptive(q))
		checkRefined(t, q, r.Adaptive.Derived, r.Derived, trochoid(3, tc.rho, tc.ell, tc.psi, tc.outside))
		// Nothing else in the result changes: the circles and arms keep the
		// samples.
		r.Adaptive = nil
		a, _ := json.Marshal(r)
		b, _ := json.Marshal(uniform)
		if string(a) != string(b) {
			t.Fatalf("%s: refinement changed the rest of the result", tc.side)
		}
	}
}

// On (t², 0) the base runs into a cusp at t = 0 and back along the same
// line. The circle, below the line on the left of the first leftward
// travel, rolls in and back out: its signed arc length is 1 − t² on both
// sides, so the trace depends on x = t² alone. The cusp lies between
// samples, where refinement continues the samples' split Simpson step.
func TestRefinementRollsThroughACusp(t *testing.T) {
	const rho, ell, psi = .05, .08, .3
	exact := func(t float64) Vec {
		x := t * t
		a := psi - (1-x)/rho
		return Vec{x - ell*math.Sin(a), -rho + ell*math.Cos(a)}
	}
	q := rollingRequest("t^2", "0", -1, 1.15, Roller{Side: "left", Radius: rho, Arm: ell, Phase: psi})
	q.Samples = 64
	r := compute(t, adaptive(q))
	if r.Invalid != 0 || !warned(r, "rolls back out of 1 cusp") {
		t.Fatalf("%d invalid, %v", r.Invalid, r.Warnings)
	}
	checkRefined(t, q, r.Adaptive.Derived, r.Derived, exact)
}

// Two congruent ellipses rolled on each other from matching vertices stay
// mirror images across their common tangent, so the moving focus stays 2a
// from the fixed ellipse's far focus: it runs round a circle, which 128
// samples over four laps draw as a polygon.
func TestRefinementOfARollingCurve(t *testing.T) {
	a, b := 2.0, 1.2
	c := math.Sqrt(a*a - b*b)
	m := MovingCurve{X: fmt.Sprintf("%v*cos(t)", a), Y: fmt.Sprintf("%v*sin(t)", b), Min: 0, Max: 2 * math.Pi}
	q := curveRequest(m.X, m.Y, 0, 8*math.Pi, "right", m, Vec{c, 0})
	q.Samples = 128
	uniform := compute(t, q)
	r := compute(t, adaptive(q))
	path := r.Adaptive.Derived
	if path == nil || path.Inserted == 0 || path.Exhausted || path.Unresolved != 0 || path.Breaks != 0 {
		t.Fatalf("not refined cleanly: %+v", path)
	}
	checkUniform(t, path, r.Derived)
	focus := Vec{-c, 0}
	// The deepest a chord's midpoint falls inside the circle.
	sag := func(points []*Vec) float64 {
		worst := 0.0
		for k := 1; k < len(points); k++ {
			if points[k-1] != nil && points[k] != nil {
				mid := points[k-1].Add(*points[k]).Mul(.5)
				worst = math.Max(worst, 2*a-mid.Sub(focus).Norm())
			}
		}
		return worst
	}
	if s := sag(uniform.Derived); s < 4*path.Tolerance {
		t.Fatalf("the uniform samples already follow the circle: sag %g", s)
	}
	for k, p := range path.Points {
		if p != nil && math.Abs(p.Sub(focus).Norm()-2*a) > path.Tolerance/2 {
			t.Fatalf("point %d at %v is off the circle by %g", k, *p, p.Sub(focus).Norm()-2*a)
		}
	}
	if s := sag(path.Points); s > 1.5*path.Tolerance {
		t.Fatalf("refined sag %g exceeds %g", s, path.Tolerance)
	}
	r.Adaptive = nil
	x, _ := json.Marshal(r)
	y, _ := json.Marshal(uniform)
	if string(x) != string(y) {
		t.Fatal("refinement changed the rest of the result")
	}
}

// Evaluated at each sample, the refined trace returns exactly the uniform
// study's point, or nothing where it has none: through cusps, on a derived
// input, for a rolling curve, and after an open rolling curve runs out.
func TestRefinedRollingAgreesWithTheSamples(t *testing.T) {
	astroid := rollingRequest("cos(t)^3", "sin(t)^3", .3, .3+2*math.Pi, Roller{Side: "right", Radius: .1, Arm: .07})
	offset := rollingRequest("2*cos(t)", "sin(t)", 0, 6, Roller{Side: "left", Radius: .3, Arm: .5, Phase: 1})
	offset.Input, offset.Distance = "offset", -.2
	curve := curveRequest("2*cos(t)", "1.2*sin(t)", 0, 6, "right", MovingCurve{X: "0.5*cos(t)", Y: "0.3*sin(t)", Min: 0, Max: 2 * math.Pi}, Vec{.4, 0})
	runsOut := curveRequest("t^2", "0", -1, 1.2, "left", MovingCurve{X: "t", Y: "0", Min: 0, Max: 5, Start: .2}, Vec{1, .1})
	for name, q := range map[string]Request{"astroid": astroid, "offset": offset, "curve": curve, "runs out": runsOut} {
		q.Samples = 64
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
		if name == "runs out" && gaps == 0 {
			t.Fatalf("%s: no gaps to compare", name)
		}
	}
}

// The trace is broken wherever the curve it rolls on is: here at a pole
// between samples, which the samples' arc length steps across.
func TestRefinementBreaksARollingCircleWhereItsBaseBreaks(t *testing.T) {
	q := rollingRequest("t", "1/(t - 0.0131)", -1, 1, Roller{Side: "left", Radius: .05, Arm: .04})
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
		t.Fatal("the uniform trace is already open at the pole")
	}
	if r.Adaptive.Derived == nil {
		t.Fatal("trace not refined")
	}
	if g := gap(r.Adaptive.Base); g != 31 || gap(r.Adaptive.Derived) != g {
		t.Fatalf("base broken in interval %d, its trace in %d", g, gap(r.Adaptive.Derived))
	}
}

// A regular base has a tangent at every length scale. On a circle the
// trace is an analytic trochoid, whether the rolling body is a circle or
// the same circle entered as a curve. This checks both placement paths,
// representative bodies, and the points inserted between samples.
func TestRollingSmallScaleTrochoids(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-40, 0x1p-100, 0x1p10} {
		for _, side := range []string{"left", "right"} {
			for _, shape := range []string{"circle", "curve"} {
				t.Run(fmt.Sprintf("%g/%s/%s", scale, side, shape), func(t *testing.T) {
					q := rollingRequest(num(3*scale)+"*cos(t)", num(3*scale)+"*sin(t)", 0, 2*math.Pi, Roller{Side: side, Radius: scale / 2, Arm: scale * .8, Phase: .3})
					if shape == "curve" {
						q.Rolling.Shape = "curve"
						q.Rolling.Curve = MovingCurve{X: num(scale/2) + "*cos(t)", Y: num(scale/2) + "*sin(t)", Max: 2 * math.Pi}
						q.Rolling.Point = Vec{scale * .8 * math.Cos(.3), scale * .8 * math.Sin(.3)}
					}
					q.Samples, q.Adaptive = 129, true
					r := compute(t, q)
					if r.Invalid != 0 || len(r.Warnings) != 0 {
						t.Fatalf("%d invalid, %v", r.Invalid, r.Warnings)
					}
					exact := trochoid(3*scale, scale/2, scale*.8, .3, side == "right")
					for j, p := range r.Derived {
						closeVec(t, p, exact(sampleT(q, j)), 2e-8*scale)
					}
					if shape == "circle" && len(r.Rolling) != q.Lines || shape == "curve" && len(r.Moving.Positions) != q.Lines {
						t.Fatal("missing representative placements")
					}
					checkRefined(t, q, r.Adaptive.Derived, r.Derived, exact)
				})
			}
		}
	}
}

// Reversing the heading and signed arc length must survive scaling too.
// An exact stationary sample has no placement; a cusp between samples
// still rolls back continuously, with only one cusp counted.
func TestRollingSmallScaleCusps(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-40, 0x1p-100, 0x1p10} {
		for _, end := range []float64{1, 1.15} {
			for _, shape := range []string{"circle", "curve"} {
				t.Run(fmt.Sprintf("%g/end=%g/%s", scale, end, shape), func(t *testing.T) {
					q := rollingRequest(num(scale)+"*t^2", "0", -1, end, Roller{Side: "left", Radius: scale * .05, Arm: scale * .08, Phase: .3})
					if shape == "curve" {
						q.Rolling.Shape = "curve"
						q.Rolling.Curve = MovingCurve{X: num(scale*.05) + "*cos(t)", Y: num(scale*.05) + "*sin(t)", Max: 2 * math.Pi}
						q.Rolling.Point = Vec{scale * .08 * math.Cos(.3), scale * .08 * math.Sin(.3)}
					}
					q.Samples, q.Adaptive = 129, true
					r := compute(t, q)
					if !warned(r, "rolls back out of 1 cusp") {
						t.Fatalf("warnings: %v", r.Warnings)
					}
					wantInvalid := 0
					if end == 1 {
						wantInvalid = 1
						if r.Derived[64] != nil {
							t.Fatal("stationary point placed")
						}
					}
					if r.Invalid != wantInvalid {
						t.Fatalf("invalid %d, want %d", r.Invalid, wantInvalid)
					}
					exact := func(u float64) Vec {
						x := u * u
						a := .3 - (1-x)/.05
						return Vec{scale * (x - .08*math.Sin(a)), scale * (-.05 + .08*math.Cos(a))}
					}
					for j, p := range r.Derived {
						if p != nil {
							closeVec(t, p, exact(sampleT(q, j)), 2e-8*scale)
						}
					}
					path := r.Adaptive.Derived
					if path == nil || path.Inserted == 0 {
						t.Fatal("missing refinement")
					}
					for j, p := range path.Points {
						if p != nil {
							closeVec(t, p, exact(param(q, path.At[j])), 2e-8*scale)
						}
					}
				})
			}
		}
	}
}

func TestRollingConstantBaseHasNoHeading(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-100} {
		for _, xy := range [][2]string{{"0", "0"}, {num(scale), num(-scale)}} {
			q := rollingRequest(xy[0], xy[1], 0, 1, Roller{Side: "left", Radius: scale, Arm: scale})
			q.Samples, q.Adaptive = 65, true
			r := compute(t, q)
			if r.Invalid != q.Samples || len(r.Rolling) != 0 {
				t.Fatalf("constant %v: %d invalid, %d circles", xy, r.Invalid, len(r.Rolling))
			}
			for _, p := range r.Derived {
				if p != nil {
					t.Fatal("constant base placed a body")
				}
			}
		}
	}
}
