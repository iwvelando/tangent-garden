package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestSpecificDomainErrors(t *testing.T) {
	for _, tc := range []struct {
		lo, hi  float64
		message string
	}{
		{2 * math.Pi, 2 * math.Pi, "zero width"},
		{2, 1, "greater than"},
		{0, 1e-7, "domain width"},
		{0, 1e5 + 1, "domain width"},
		{1e6 + 1, 1e6 + 2, "within"},
		{math.NaN(), 1, "finite"},
	} {
		_, err := Compute(request("evolute", "cos(t)", "sin(t)", tc.lo, tc.hi))
		if err == nil || !strings.Contains(err.Error(), tc.message) {
			t.Fatalf("%v: %v", tc, err)
		}
	}
}

func TestPolarSourceRotation(t *testing.T) {
	q := request("catacaustic", "cos(t)", "sin(t)", 0, 2*math.Pi)
	q.Source = Source{Kind: "point", Coordinates: "polar", Radius: 1, Theta: 0}
	a := compute(t, q)
	closeVec(t, a.SourcePosition, Vec{1, 0}, 1e-14)
	q.Curve.X, q.Curve.Y = "-sin(t)", "cos(t)"
	q.Source.Theta = math.Pi / 2
	b := compute(t, q)
	closeVec(t, b.SourcePosition, Vec{0, 1}, 1e-14)
	count := 0
	for i, p := range a.Derived {
		if p != nil && b.Derived[i] != nil {
			closeVec(t, b.Derived[i], p.Perp(), 2e-4)
			count++
		}
	}
	if count < 490 {
		t.Fatalf("too few comparable samples: %d", count)
	}
	q.Source.Radius = -1
	if _, err := Compute(q); err == nil {
		t.Fatal("accepted negative source radius")
	}
	q.Source.Radius, q.Source.Theta = 1, math.Inf(1)
	if _, err := Compute(q); err == nil {
		t.Fatal("accepted nonfinite source angle")
	}
}

func TestExpertResolutionLimits(t *testing.T) {
	q := request("evolute", "2*cos(t)", "3*sin(t)", 0, 2*math.Pi)
	q.Samples, q.Lines = 32768, 2048
	r := compute(t, q)
	if len(r.Base) != q.Samples || len(r.Rays) != q.Lines {
		t.Fatal("resolution was truncated")
	}
	for _, i := range []int{0, 8192, 16384, 32767} {
		theta := float64(i) * 2 * math.Pi / float64(q.Samples-1)
		closeVec(t, r.Derived[i], Vec{-2.5 * math.Pow(math.Cos(theta), 3), 5.0 / 3 * math.Pow(math.Sin(theta), 3)}, 1e-4)
	}
	q.Samples++
	if _, err := Compute(q); err == nil {
		t.Fatal("accepted excessive samples")
	}
	q.Samples, q.Lines = 32768, 2049
	if _, err := Compute(q); err == nil {
		t.Fatal("accepted excessive lines")
	}
}

func BenchmarkExpertCatacaustic(b *testing.B) {
	q := request("catacaustic", "cos(t)", "sin(t)", 0, 2*math.Pi)
	q.Source.Position = Vec{0.75, 0}
	q.Samples, q.Lines = 32768, 2048
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}

func request(kind, x, y string, lo, hi float64) Request {
	return Request{Kind: kind, Curve: Curve{Format: "parametric", X: x, Y: y, Min: lo, Max: hi}, Source: Source{Kind: "point", Position: Vec{0, 2}}, NIncident: 1, NTransmitted: 1.5, Samples: 501, Lines: 25}
}
func closeVec(t *testing.T, got *Vec, want Vec, tol float64) {
	t.Helper()
	if got == nil || got.Sub(want).Norm() > tol {
		t.Fatalf("got %v want %v within %g", got, want, tol)
	}
}
func compute(t *testing.T, q Request) Result {
	t.Helper()
	r, e := Compute(q)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = json.Marshal(r); e != nil {
		t.Fatal(e)
	}
	return r
}
func TestEvoluteAnalytic(t *testing.T) {
	for _, tc := range []struct {
		name, x, y string
		lo, hi     float64
		want       func(float64) Vec
	}{
		{"circle", "cos(t)", "sin(t)", 0, 2 * math.Pi, func(float64) Vec { return Vec{0, 0} }},
		{"ellipse", "2*cos(t)", "3*sin(t)", 0, 2 * math.Pi, func(u float64) Vec { return Vec{-2.5 * math.Pow(math.Cos(u), 3), 5.0 / 3 * math.Pow(math.Sin(u), 3)} }},
		{"parabola", "t", "2*t^2/5", -1, 1, func(u float64) Vec { return Vec{-16 * u * u * u / 25, 6*u*u/5 + 1.25} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			q := request("evolute", tc.x, tc.y, tc.lo, tc.hi)
			r := compute(t, q)
			for i, p := range r.Derived {
				u := tc.lo + (tc.hi-tc.lo)*float64(i)/float64(q.Samples-1)
				closeVec(t, p, tc.want(u), 2e-5)
			}
		})
	}
}
func TestCircleInvolute(t *testing.T) {
	q := request("involute", "cos(t)", "sin(t)", 0, 2*math.Pi)
	q.Offset = .7
	r := compute(t, q)
	for i, p := range r.Derived {
		u := 2 * math.Pi * float64(i) / float64(q.Samples-1)
		s := u + .7
		closeVec(t, p, Vec{math.Cos(u) + s*math.Sin(u), math.Sin(u) - s*math.Cos(u)}, 1e-6)
	}
}
func TestInvoluteEvoluteRoundTrip(t *testing.T) {
	q := request("evolute", "cos(t)+t*sin(t)", "sin(t)-t*cos(t)", .1, 6)
	r := compute(t, q)
	for i, p := range r.Derived {
		u := .1 + 5.9*float64(i)/500
		closeVec(t, p, Vec{math.Cos(u), math.Sin(u)}, 2e-5)
	}
}
func TestParabolicMirrorFocus(t *testing.T) {
	q := request("catacaustic", "t", "t^2/4", -3, 3)
	q.Source = Source{Kind: "parallel", Angle: -90}
	r := compute(t, q)
	for _, p := range r.Derived {
		closeVec(t, p, Vec{0, 1}, 2e-5)
	}
}
func TestFlatMirrorVirtualImage(t *testing.T) {
	q := request("catacaustic", "t", "0", -3, 3)
	r := compute(t, q)
	for i, p := range r.Derived {
		closeVec(t, p, Vec{0, -2}, 2e-5)
		if !r.Virtual[i] {
			t.Fatal("expected virtual image")
		}
	}
}
func TestEqualIndices(t *testing.T) {
	q := request("diacaustic", "t", "0", -3, 3)
	q.NIncident = 1
	q.NTransmitted = 1
	r := compute(t, q)
	for _, p := range r.Derived {
		closeVec(t, p, q.Source.Position, 2e-5)
	}
}
func TestOpticalLaws(t *testing.T) {
	n := Vec{0, 1}
	i := Vec{.5, -math.Sqrt(3) / 2}
	r := Reflect(i, n)
	closeVec(t, &r, Vec{.5, math.Sqrt(3) / 2}, 1e-12)
	v, ok := Refract(i, n, 1/1.5)
	if !ok || math.Abs(v.X*1.5-i.X) > 1e-12 || v.Y >= 0 || math.Abs(v.Norm()-1) > 1e-12 {
		t.Fatalf("Snell law failed: %v", v)
	}
	flipped, ok := Refract(i, n.Mul(-1), 1/1.5)
	if !ok {
		t.Fatal("orientation")
	}
	closeVec(t, &flipped, v, 1e-12)
	if _, ok = Refract(Vec{math.Sqrt(3) / 2, -.5}, n, 1.5); ok {
		t.Fatal("expected total internal reflection")
	}
	normal, ok := Refract(Vec{0, -1}, n, 1.5)
	if !ok {
		t.Fatal("normal incidence")
	}
	closeVec(t, &normal, Vec{0, -1}, 1e-12)
}
func TestParallelRaysHaveNoFiniteEnvelope(t *testing.T) {
	q := request("catacaustic", "t", "0", -2, 2)
	q.Source = Source{Kind: "parallel", Angle: -90}
	r := compute(t, q)
	if r.Invalid != q.Samples {
		t.Fatalf("expected no finite envelope: %d", r.Invalid)
	}
}
func TestSingularAndInvalidDomains(t *testing.T) {
	for _, q := range []Request{request("evolute", "t", "0", -1, 1), request("evolute", "1", "1", 0, 1), request("involute", "t", "sqrt(t)", -1, 1), request("evolute", "t", "1/t", -1, 1)} {
		r := compute(t, q)
		if r.Invalid == 0 {
			t.Fatalf("expected omitted samples for %+v", q)
		}
	}
	q := request("evolute", "t", "t^2", 0, 1)
	q.Curve.Max = q.Curve.Min
	if _, e := Compute(q); e == nil {
		t.Fatal("accepted empty domain")
	}
	q = request("diacaustic", "t", "t^2", 0, 1)
	q.NIncident = -1
	if _, e := Compute(q); e == nil {
		t.Fatal("accepted negative index")
	}
	q = request("evolute", "t", "t^2", 0, 1)
	q.Samples = 100000
	if _, e := Compute(q); e == nil {
		t.Fatal("accepted unbounded workload")
	}
}
func TestPolarAndCartesian(t *testing.T) {
	q := request("evolute", "", "", 0, 2*math.Pi)
	q.Curve.Format = "polar"
	q.Curve.R = "2"
	r := compute(t, q)
	for _, p := range r.Derived {
		closeVec(t, p, Vec{}, 1e-5)
	}
	q.Curve = Curve{Format: "cartesian", Y: "x^2", Min: -1, Max: 1}
	r = compute(t, q)
	closeVec(t, r.Derived[250], Vec{0, .5}, 1e-5)
}
func TestInvoluteConvergence(t *testing.T) {
	q := request("involute", "t", "t^2", 0, 3)
	wantS := 3*math.Sqrt(37)/2 + math.Asinh(6)/4
	d := Vec{1, 6}.Unit()
	want := Vec{3, 9}.Sub(d.Mul(wantS))
	q.Samples = 64
	a := compute(t, q)
	q.Samples = 501
	b := compute(t, q)
	ea := a.Derived[63].Sub(want).Norm()
	eb := b.Derived[500].Sub(want).Norm()
	if eb > ea || eb > 1e-7 {
		t.Fatalf("quadrature did not converge: %g -> %g", ea, eb)
	}
}

func TestAnimatedCircleRadiusAndRayIndices(t *testing.T) {
	q := request("involute", "a*cos(t)", "a*sin(t)", 0, 2*math.Pi)
	for _, radius := range []float64{.75, 1, 2} {
		q.Curve.A = radius
		r := compute(t, q)
		for _, i := range []int{0, 100, 250, 500} {
			u := 2 * math.Pi * float64(i) / 500
			closeVec(t, r.Derived[i], Vec{radius * (math.Cos(u) + u*math.Sin(u)), radius * (math.Sin(u) - u*math.Cos(u))}, 1e-6)
		}
		for _, ray := range r.Rays {
			if ray.SampleIndex < 0 || ray.SampleIndex >= q.Samples {
				t.Fatal("invalid ray sample index")
			}
			closeVec(t, &ray.Origin, *r.Base[ray.SampleIndex], 1e-12)
		}
	}
}

func TestRefractionDependsOnIndexRatio(t *testing.T) {
	q := request("diacaustic", "t", "t^2/4", -2, 2)
	a := compute(t, q)
	q.NIncident *= 2
	q.NTransmitted *= 2
	b := compute(t, q)
	for i, p := range a.Derived {
		if p != nil {
			closeVec(t, b.Derived[i], *p, 1e-9)
		}
	}
}
