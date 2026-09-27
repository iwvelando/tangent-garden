package engine

import (
	"math"
	"testing"
)

func TestPedalAnalytic(t *testing.T) {
	for _, tc := range []struct {
		name, x, y string
		lo, hi     float64
		pole       Vec
		want       func(float64) Vec
	}{
		{"central circle", "cos(t)", "sin(t)", 0, 2 * math.Pi, Vec{}, func(u float64) Vec { return Vec{math.Cos(u), math.Sin(u)} }},
		{"cardioid", "cos(t)", "sin(t)", 0, 2 * math.Pi, Vec{1, 0}, func(u float64) Vec {
			return Vec{1 + math.Cos(u) - math.Cos(u)*math.Cos(u), math.Sin(u) * (1 - math.Cos(u))}
		}},
		{"parabola", "t", "t^2", -2, 2, Vec{}, func(u float64) Vec { return Vec{2 * u * u * u / (1 + 4*u*u), -u * u / (1 + 4*u*u)} }},
		{"line", "t", "2*t+1", -3, 3, Vec{2, 0}, func(float64) Vec { return Vec{0, 1} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			q := request("pedal", tc.x, tc.y, tc.lo, tc.hi)
			q.Pole = tc.pole
			r := compute(t, q)
			if r.Invalid != 0 || len(r.Rays) != q.Lines {
				t.Fatalf("incomplete regular construction: %d invalid, %d lines", r.Invalid, len(r.Rays))
			}
			for i, p := range r.Derived {
				u := tc.lo + (tc.hi-tc.lo)*float64(i)/float64(q.Samples-1)
				closeVec(t, p, tc.want(u), 1e-7)
			}
			for _, ray := range r.Rays {
				closeVec(t, ray.Target, *r.Derived[ray.SampleIndex], 1e-12)
				closeVec(t, &ray.Origin, *r.Base[ray.SampleIndex], 1e-12)
			}
		})
	}
}

func TestPedalGeometricInvariants(t *testing.T) {
	q := request("pedal", "2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi)
	q.Pole = Vec{1.65, .3}
	a := compute(t, q)
	for i, h := range a.Derived {
		u := 2 * math.Pi * float64(i) / float64(q.Samples-1)
		tangent := Vec{-2 * math.Sin(u), 1.1 * math.Cos(u)}.Unit()
		if h == nil || math.Abs(h.Sub(*a.Base[i]).Cross(tangent)) > 1e-7 || math.Abs(q.Pole.Sub(*h).Dot(tangent)) > 1e-7 {
			t.Fatalf("projection invariants failed at %d: %v", i, h)
		}
	}
	// Rotate by 90 degrees, translate, and reverse the parameter orientation.
	q.Curve.X, q.Curve.Y = "1.1*sin(t)+4", "2*cos(t)-3"
	q.Pole = Vec{4 - .3, 1.65 - 3}
	b := compute(t, q)
	for i := range b.Derived {
		want := a.Derived[len(a.Derived)-1-i].Perp().Add(Vec{4, -3})
		closeVec(t, b.Derived[i], want, 1e-7)
	}
	// Regular nonlinear reparameterization must leave the same projected loci.
	q = request("pedal", "cos(t+t^2)", "sin(t+t^2)", 0, 1)
	for i, p := range compute(t, q).Derived {
		u := float64(i) / float64(q.Samples-1)
		closeVec(t, p, Vec{math.Cos(u + u*u), math.Sin(u + u*u)}, 1e-7)
	}
}

func TestPedalInvalidAndDegenerateSamples(t *testing.T) {
	for _, pole := range []Vec{{math.NaN(), 0}, {0, math.Inf(1)}} {
		q := request("pedal", "t", "t^2", -1, 1)
		q.Pole = pole
		if _, err := Compute(q); err == nil {
			t.Fatal("accepted nonfinite pole")
		}
	}
	for _, tc := range [][2]string{{"1", "1"}, {"t^2", "t^3"}, {"t", "1/t"}} {
		q := request("pedal", tc[0], tc[1], -1, 1)
		r := compute(t, q)
		if r.Derived[250] != nil || r.Invalid == 0 {
			t.Fatalf("missing stationary/discontinuous gap for %v", tc)
		}
	}
	// A C1 curve need not have stable second derivatives to have a pedal.
	q := request("pedal", "t", "abs(t)^1.5", -1, 1)
	q.Pole = Vec{2, 3}
	r := compute(t, q)
	closeVec(t, r.Derived[250], Vec{2, 0}, 1e-7)
	if r.Invalid != 0 {
		t.Fatal("pedal incorrectly requires second derivative stability")
	}
	q.Curve = Curve{Format: "polar", R: "2", Min: 0, Max: 2 * math.Pi}
	q.Pole = Vec{}
	closeVec(t, compute(t, q).Derived[0], Vec{2, 0}, 1e-7)
	q.Curve = Curve{Format: "cartesian", Y: "x^2", Min: -1, Max: 1}
	closeVec(t, compute(t, q).Derived[250], Vec{}, 1e-7)
}
