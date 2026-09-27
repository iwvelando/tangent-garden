package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func circlesRequest(x, y string, lo, hi float64, radius string) Request {
	return linesRequest(x, y, lo, hi, EnvelopeFamily{Mode: "circle", Radius: radius})
}

// branches returns the left and right envelope branches of a circle family.
func branches(t *testing.T, r Result) ([]*Vec, []*Vec) {
	t.Helper()
	if len(r.Family) != 2 || r.Family[0].Branch != "left" || r.Family[1].Branch != "right" || len(r.Derived) != 0 {
		t.Fatalf("want left and right branches in place of one derived curve, got %d paths, %d derived", len(r.Family), len(r.Derived))
	}
	return r.Family[0].Points, r.Family[1].Points
}

func warned(r Result, text string) bool {
	return strings.Contains(strings.Join(r.Warnings, " "), text)
}

// Every touching point solves both envelope equations, |q| = R and
// q·c′ = −RR′ with q = X − c, against analytic derivatives, on the side of
// travel its branch names. Reversing the direction of travel swaps the sides.
func TestCircleEnvelopeEquations(t *testing.T) {
	for _, reversed := range []bool{false, true} {
		sign := 1.0
		x, y, radius := "2*cos(t)", "sin(t)", "0.5+0.3*sin(3*t)"
		if reversed {
			sign = -1
			x, y, radius = "2*cos(-t)", "sin(-t)", "0.5+0.3*sin(-3*t)"
		}
		q := circlesRequest(x, y, 0, 2*math.Pi, radius)
		r := compute(t, q)
		left, right := branches(t, r)
		if r.Invalid != 0 || len(r.Warnings) != 0 {
			t.Fatalf("%d invalid: %v", r.Invalid, r.Warnings)
		}
		for j := range r.Base {
			u := sign * sampleT(q, j)
			c := Vec{2 * math.Cos(u), math.Sin(u)}
			dc := Vec{-2 * math.Sin(u), math.Cos(u)}.Mul(sign)
			R, dR := 0.5+0.3*math.Sin(3*u), sign*0.9*math.Cos(3*u)
			for side, e := range [][]*Vec{left, right} {
				p := e[j]
				if p == nil {
					t.Fatalf("reversed=%v: no touching point at %d", reversed, j)
				}
				d := p.Sub(c)
				if math.Abs(d.Norm()-R) > 1e-12 {
					t.Fatalf("reversed=%v: |q| = %g, R = %g at %d", reversed, d.Norm(), R, j)
				}
				if math.Abs(d.Dot(dc)+R*dR) > 1e-7 {
					t.Fatalf("reversed=%v: q·c′ = %g, −RR′ = %g at %d", reversed, d.Dot(dc), -R*dR, j)
				}
				// Left of travel is +det(c′, q).
				if (dc.Cross(d) > 0) != (side == 0) {
					t.Fatalf("reversed=%v: branch %d on the wrong side at %d", reversed, side, j)
				}
			}
		}
		if len(r.Circles) != q.Lines {
			t.Fatalf("%d circles, want %d", len(r.Circles), q.Lines)
		}
		for _, c := range r.Circles {
			u := sign * sampleT(q, c.SampleIndex)
			closeVec(t, &c.Center, *r.Base[c.SampleIndex], 0)
			if math.Abs(c.Radius-(0.5+0.3*math.Sin(3*u))) > 1e-12 {
				t.Fatalf("circle %d radius %g", c.SampleIndex, c.Radius)
			}
		}
		// Each circle's two radii run from its center to its touching points.
		if len(r.Rays) != 2*q.Lines {
			t.Fatalf("%d radii, want %d", len(r.Rays), 2*q.Lines)
		}
		for k, ray := range r.Rays {
			j := ray.SampleIndex
			closeVec(t, &ray.Origin, *r.Base[j], 0)
			closeVec(t, ray.Target, *[][]*Vec{left, right}[k%2][j], 0)
		}
	}
}

// A constant radius gives the offsets ±R, the same points as the offset
// construction, and every branch stays tangent to its circle. R stays below
// the ellipse's least radius of curvature, 1/2, so neither offset has cusps.
func TestCircleEnvelopeConstantRadius(t *testing.T) {
	q := circlesRequest("2*cos(t)", "sin(t)", 0, 2*math.Pi, "0.3")
	q.Samples = 2001
	r := compute(t, q)
	left, right := branches(t, r)
	for side, d := range []float64{0.3, -0.3} {
		o := request("offset", "2*cos(t)", "sin(t)", 0, 2*math.Pi)
		o.Samples, o.Distance = q.Samples, d
		want := compute(t, o).Derived
		got := [][]*Vec{left, right}[side]
		for j := range want {
			closeVec(t, got[j], *want[j], 1e-9)
		}
		// The branch's tangent is perpendicular to the radius at the touching
		// point: the envelope touches the circle there.
		for j := 1; j+1 < len(got); j++ {
			tangent := got[j+1].Sub(*got[j-1])
			radius := got[j].Sub(*r.Base[j])
			if math.Abs(tangent.Unit().Dot(radius.Unit())) > 1e-4 {
				t.Fatalf("offset %g crosses its circle at %d", d, j)
			}
			if j > 40 {
				break
			}
		}
	}
}

// Circles centered on the parabola 4y = x² through its focus touch the
// directrix y = −1 on the right, and all pass through the focus, the left
// branch collapsed to a point.
func TestCircleEnvelopeFocusAndDirectrix(t *testing.T) {
	q := circlesRequest("t", "t^2/4", -3, 3, "t^2/4+1")
	r := compute(t, q)
	left, right := branches(t, r)
	for j := range r.Base {
		closeVec(t, left[j], Vec{0, 1}, 1e-8)
		closeVec(t, right[j], Vec{sampleT(q, j), -1}, 1e-8)
	}
}

// Circles centered on the axis with radius t²/2 + 1/2 have a real envelope
// only while |R′| = |t| ≤ 1 = |c′|; the branches merge at t = ±1 and vanish
// beyond, where each circle nests inside its neighbours.
func TestCircleEnvelopeBranchesMergeAndVanish(t *testing.T) {
	q := circlesRequest("t", "0", -2, 2, "t^2/2+1/2")
	r := compute(t, q)
	left, right := branches(t, r)
	nested := 0
	for j := range r.Base {
		u := sampleT(q, j)
		R := u*u/2 + .5
		if math.Abs(u) > 1+1e-9 {
			nested++
			if left[j] != nil || right[j] != nil {
				t.Fatalf("real envelope at t = %g, where |R′| > |c′|", u)
			}
			continue
		}
		// Near a merge the separation R√(1−k²) turns a rounding error ε in
		// the derivative into about R√ε.
		h := R * math.Sqrt(math.Max(0, 1-u*u))
		closeVec(t, left[j], Vec{u - R*u, h}, 1e-8+1e-6*R)
		closeVec(t, right[j], Vec{u - R*u, -h}, 1e-8+1e-6*R)
	}
	for _, j := range []int{125, 375} {
		if u := sampleT(q, j); math.Abs(math.Abs(u)-1) > 1e-12 {
			t.Fatalf("sample %d is t = %g, not ±1", j, u)
		}
		closeVec(t, left[j], *right[j], 1e-5)
	}
	if nested != 250 || r.Invalid != nested || !warned(r, "no real envelope") {
		t.Fatalf("%d nested, %d invalid, warnings %v", nested, r.Invalid, r.Warnings)
	}
	// The circles are drawn, touching an envelope or not.
	if len(r.Circles) != q.Lines {
		t.Fatalf("%d circles drawn, want %d", len(r.Circles), q.Lines)
	}
	// Radius t on the axis: |R′| = |c′| everywhere, and every circle passes
	// through the origin, where both branches meet.
	q = circlesRequest("t", "0", .5, 2, "t")
	left, right = branches(t, compute(t, q))
	for j := range left {
		closeVec(t, left[j], Vec{}, 1e-5)
		closeVec(t, right[j], Vec{}, 1e-5)
	}
}

func TestCircleEnvelopeDegenerate(t *testing.T) {
	// A stationary center has no envelope point, whether the circles grow
	// concentrically or repeat; the circles themselves are still drawn.
	for _, radius := range []string{"1+t", "1"} {
		q := circlesRequest("1", "2", 0, 1, radius)
		r := compute(t, q)
		left, right := branches(t, r)
		for j := range left {
			if left[j] != nil || right[j] != nil {
				t.Fatalf("R=%s: envelope point %v at a stationary center", radius, left[j])
			}
		}
		if r.Invalid != q.Samples || !warned(r, "center is stationary") || len(r.Circles) != q.Lines || len(r.Rays) != 0 {
			t.Fatalf("R=%s: %d invalid, %d circles, %d radii, %v", radius, r.Invalid, len(r.Circles), len(r.Rays), r.Warnings)
		}
	}
	// Circles need a positive, defined radius; elsewhere they are gaps.
	for _, radius := range []string{"t", "sqrt(t)", "0.1/t"} {
		q := circlesRequest("cos(t)", "sin(t)", -1, 1, radius)
		r := compute(t, q)
		left, _ := branches(t, r)
		if left[100] != nil || left[400] == nil {
			t.Fatalf("R=%s: point %v where the radius is negative, none at %v", radius, left[100], left[400])
		}
		for _, c := range r.Circles {
			// Sample 250 is t = 2e-17 in floating point, not quite 0.
			if c.SampleIndex < 250 || !(c.Radius > 0) {
				t.Fatalf("R=%s: circle of radius %g drawn at %d", radius, c.Radius, c.SampleIndex)
			}
		}
		if !warned(r, "radius is not positive") {
			t.Fatalf("R=%s: no radius warning in %v", radius, r.Warnings)
		}
	}
}

// A zero radius is a point, not a circle; a radius that kinks inside a
// sample's derivative stencil has no reliable R′ there.
func TestCircleEnvelopeRadiusEdges(t *testing.T) {
	r := compute(t, circlesRequest("cos(t)", "sin(t)", 0, 1, "0"))
	if len(r.Circles) != 0 || len(r.Rays) != 0 || r.Invalid != 501 || !warned(r, "radius is not positive") {
		t.Fatalf("zero radius: %d circles, %d invalid, %v", len(r.Circles), r.Invalid, r.Warnings)
	}
	q := circlesRequest("t", "0", -1, 1, "1+abs(t-0.2001)/2")
	r = compute(t, q)
	left, right := branches(t, r)
	if left[300] != nil || right[300] != nil || left[290] == nil || left[310] == nil {
		t.Fatalf("kink: %v at the kink, %v and %v beside it", left[300], left[290], left[310])
	}
}

func TestCircleEnvelopeResult(t *testing.T) {
	b, err := json.Marshal(compute(t, circlesRequest("cos(t)", "sin(t)", 0, 1, "0.5")))
	if err != nil || !strings.Contains(string(b), `"branch":"left"`) || !strings.Contains(string(b), `"branch":"right"`) || strings.Contains(string(b), `"second"`) {
		t.Fatalf("circle JSON: %.300s", b)
	}
	// Offset stacks carry no branch names.
	q := offsetRequest("cos(t)", "sin(t)", 0, 1, 0)
	q.Stack = Stack{Enabled: true, From: -1, To: 1, Count: 3}
	b, _ = json.Marshal(compute(t, q))
	if strings.Contains(string(b), `"branch"`) {
		t.Fatal("offset stack members carry branch names")
	}
	// The radius is ignored by line families.
	q = linesRequest("cos(t)", "sin(t)", 0, 1, EnvelopeFamily{Mode: "angle", Angle: "t", Radius: "s"})
	if r := compute(t, q); len(r.Family) != 0 || len(r.Circles) != 0 {
		t.Fatal("a line family returned circles")
	}
}

func TestCircleEnvelopeInvalid(t *testing.T) {
	for _, radius := range []string{"s", "", "(t"} {
		_, err := Compute(circlesRequest("cos(t)", "sin(t)", 0, 1, radius))
		if err == nil || !strings.Contains(err.Error(), "circle radius:") {
			t.Fatalf("R=%q: got %v", radius, err)
		}
	}
}
