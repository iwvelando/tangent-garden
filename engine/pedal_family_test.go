package engine

import (
	"fmt"
	"math"
	"testing"
)

func TestContrapedalAndOrthotomicAnalytic(t *testing.T) {
	for _, tc := range []struct {
		name, kind, x, y string
		lo, hi           float64
		pole             Vec
		want             func(float64) Vec
	}{
		{"contrapedal central circle collapses", "contrapedal", "cos(t)", "sin(t)", 0, 2 * math.Pi, Vec{}, func(float64) Vec { return Vec{} }},
		{"contrapedal circle with offset pole", "contrapedal", "cos(t)", "sin(t)", 0, 2 * math.Pi, Vec{1.5, 0}, func(u float64) Vec {
			return Vec{math.Cos(u), math.Sin(u)}.Mul(1.5 * math.Cos(u))
		}},
		{"contrapedal line is its parallel through the pole", "contrapedal", "t", "2*t+1", -3, 3, Vec{2, 0}, func(u float64) Vec { return Vec{2 + u, 2 * u} }},
		{"orthotomic central circle", "orthotomic", "cos(t)", "sin(t)", 0, 2 * math.Pi, Vec{}, func(u float64) Vec { return Vec{2 * math.Cos(u), 2 * math.Sin(u)} }},
		{"orthotomic circle is a doubled cardioid", "orthotomic", "cos(t)", "sin(t)", 0, 2 * math.Pi, Vec{1, 0}, func(u float64) Vec {
			return Vec{1 + 2*math.Cos(u) - 2*math.Cos(u)*math.Cos(u), 2 * math.Sin(u) * (1 - math.Cos(u))}
		}},
		{"orthotomic parabola from focus is the directrix", "orthotomic", "t", "t^2", -2, 2, Vec{0, .25}, func(u float64) Vec { return Vec{u, -.25} }},
		{"orthotomic ellipse from a focus is a circle about the other", "orthotomic", "2*cos(t)", "sqrt(3)*sin(t)", 0, 2 * math.Pi, Vec{1, 0}, func(u float64) Vec {
			other := Vec{-1, 0}
			return other.Add(Vec{2 * math.Cos(u), math.Sqrt(3) * math.Sin(u)}.Sub(other).Unit().Mul(4))
		}},
		{"orthotomic line is one reflected point", "orthotomic", "t", "2*t+1", -3, 3, Vec{2, 0}, func(float64) Vec { return Vec{-2, 2} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			q := request(tc.kind, tc.x, tc.y, tc.lo, tc.hi)
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

func TestPedalFamilyGeometricInvariants(t *testing.T) {
	kinds := map[string]Result{}
	for _, kind := range []string{"pedal", "contrapedal", "orthotomic"} {
		q := request(kind, "2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi)
		q.Pole = Vec{1.65, .3}
		kinds[kind] = compute(t, q)
	}
	pole := Vec{1.65, .3}
	for i, r := range kinds["pedal"].Base {
		u := 2 * math.Pi * float64(i) / float64(len(kinds["pedal"].Base)-1)
		tangent := Vec{-2 * math.Sin(u), 1.1 * math.Cos(u)}.Unit()
		h, k, q := kinds["pedal"].Derived[i], kinds["contrapedal"].Derived[i], kinds["orthotomic"].Derived[i]
		if h == nil || k == nil || q == nil {
			t.Fatalf("missing construction at %d", i)
		}
		// K lies on the normal and P-K is parallel to the tangent.
		if math.Abs(k.Sub(*r).Dot(tangent)) > 1e-7 || math.Abs(pole.Sub(*k).Cross(tangent)) > 1e-7 {
			t.Fatalf("contrapedal projection failed at %d: %v", i, k)
		}
		// r, H, P, and K are the corners of a rectangle.
		closeVec(t, h, r.Add(pole).Sub(*k), 1e-7)
		// Reflection across the tangent: same distance from r, perpendicular
		// displacement, and equal distance to the tangent line on both sides.
		if math.Abs(q.Sub(*r).Norm()-pole.Sub(*r).Norm()) > 1e-7 || math.Abs(q.Sub(pole).Dot(tangent)) > 1e-7 {
			t.Fatalf("orthotomic reflection failed at %d: %v", i, q)
		}
		if math.Abs(q.Sub(*r).Cross(tangent)+pole.Sub(*r).Cross(tangent)) > 1e-7 {
			t.Fatalf("orthotomic is not on the opposite side of the tangent at %d", i)
		}
	}
	// Rotation, translation, and orientation reversal commute with each construction.
	for kind, a := range kinds {
		q := request(kind, "1.1*sin(t)+4", "2*cos(t)-3", 0, 2*math.Pi)
		q.Pole = Vec{4 - .3, 1.65 - 3}
		b := compute(t, q)
		for i := range b.Derived {
			closeVec(t, b.Derived[i], a.Derived[len(a.Derived)-1-i].Perp().Add(Vec{4, -3}), 1e-7)
		}
	}
	// Regular nonlinear reparameterization leaves the loci unchanged.
	for _, kind := range []string{"contrapedal", "orthotomic"} {
		q := request(kind, "cos(t+t^2)", "sin(t+t^2)", 0, 1)
		q.Pole = Vec{1, 0}
		for i, p := range compute(t, q).Derived {
			u := float64(i) / float64(q.Samples-1)
			u += u * u
			want := Vec{math.Cos(u), math.Sin(u)}.Mul(math.Cos(u))
			if kind == "orthotomic" {
				want = Vec{1 + 2*math.Cos(u) - 2*math.Cos(u)*math.Cos(u), 2 * math.Sin(u) * (1 - math.Cos(u))}
			}
			closeVec(t, p, want, 1e-7)
		}
	}
}

// The normals of a curve are the tangents of its evolute, so the contrapedal
// equals the pedal of the evolute wherever the evolute is regular.
func TestContrapedalIsPedalOfEvolute(t *testing.T) {
	pole := Vec{.7, -.4}
	q := request("contrapedal", "t", "t^2", -1, 1)
	q.Pole = pole
	k := compute(t, q)
	q = request("pedal", "-4*t^3", "1/2+3*t^2", -1, 1)
	q.Pole = pole
	h := compute(t, q)
	if k.Invalid != 0 || h.Derived[250] != nil {
		t.Fatalf("contrapedal should be regular while the evolute cusp is a gap: %d, %v", k.Invalid, h.Derived[250])
	}
	for i := range k.Derived {
		if i < 240 || i > 260 {
			closeVec(t, k.Derived[i], *h.Derived[i], 1e-6)
		}
	}
}

func TestPedalFamilyInvalidAndDegenerateSamples(t *testing.T) {
	for _, kind := range []string{"contrapedal", "orthotomic"} {
		for _, pole := range []Vec{{math.NaN(), 0}, {0, math.Inf(-1)}} {
			q := request(kind, "t", "t^2", -1, 1)
			q.Pole = pole
			if _, err := Compute(q); err == nil {
				t.Fatalf("%s accepted nonfinite pole", kind)
			}
		}
		for _, tc := range [][2]string{{"1", "1"}, {"t^2", "t^3"}, {"t", "1/t"}} {
			r := compute(t, request(kind, tc[0], tc[1], -1, 1))
			if r.Derived[250] != nil || r.Invalid == 0 {
				t.Fatalf("%s missing stationary/discontinuous gap for %v", kind, tc)
			}
		}
		// Only a first derivative is required.
		q := request(kind, "t", "abs(t)^1.5", -1, 1)
		q.Pole = Vec{2, 3}
		r := compute(t, q)
		if r.Invalid != 0 {
			t.Fatalf("%s incorrectly requires second derivative stability", kind)
		}
		want := map[string]Vec{"contrapedal": {0, 3}, "orthotomic": {2, -3}}[kind]
		closeVec(t, r.Derived[250], want, 1e-7)
		// A pole on the curve is valid, unlike a coincident optical source.
		q = request(kind, "cos(t)", "sin(t)", 0, 2*math.Pi)
		q.Pole = Vec{1, 0}
		closeVec(t, compute(t, q).Derived[0], Vec{1, 0}, 1e-7)
	}
}

// A circle with its pole on the rim has a cardioid pedal. The normal
// projection and reflection follow from the same rectangle, independently
// of the curve's length units. Exercise every returned drawing path.
func TestTinyPedalFamily(t *testing.T) {
	for _, kind := range []string{"pedal", "contrapedal", "orthotomic"} {
		for _, scale := range []float64{1, 0x1p-35, 0x1p-40, 0x1p-100} {
			for _, off := range []float64{0, 5} {
				for _, adaptive := range []bool{false, true} {
					t.Run(kind+num(scale)+num(off)+fmt.Sprint(adaptive), func(t *testing.T) {
						q := request(kind, num(scale)+"*(cos(t)+"+num(off)+")", num(scale)+"*sin(t)", 0, 2*math.Pi)
						q.Samples, q.Lines, q.Adaptive = 65, 8, adaptive
						q.Pole = Vec{scale * (1 + off), 0}
						at := .731
						q.Probe = &ProbeQuery{T: &at}
						r := compute(t, q)
						if r.Invalid != 0 || len(r.Rays) != q.Lines {
							t.Fatalf("regular circle: invalid %d, lines %d, want 0 and %d", r.Invalid, len(r.Rays), q.Lines)
						}
						check := func(u float64, p *Vec) {
							t.Helper()
							c, s := math.Cos(u), math.Sin(u)
							want := Vec{1 + c - c*c, s * (1 - c)}
							if kind == "contrapedal" {
								want = Vec{c * c, s * c}
							}
							if kind == "orthotomic" {
								want = want.Mul(2).Sub(Vec{1, 0})
							}
							want.X += off
							if p == nil {
								t.Fatalf("missing projection at t=%g", u)
							}
							closeVec(t, point(p.Mul(1/scale)), want, 2e-7)
						}
						for i, p := range r.Derived {
							check(sampleT(q, i), p)
						}
						for _, ray := range r.Rays {
							check(sampleT(q, ray.SampleIndex), ray.Target)
						}
						check(at, r.Probe.Derived)
						probe, err := ProbeOnly(q)
						if err != nil {
							t.Fatal(err)
						}
						check(at, probe.Derived)
						if adaptive {
							path := r.Adaptive.Derived
							if path == nil || path.Inserted == 0 || path.Breaks != 0 {
								t.Fatalf("missing continuous refinement: %+v", path)
							}
							for i, p := range path.Points {
								u := q.Curve.Min + path.At[i]*(q.Curve.Max-q.Curve.Min)/float64(q.Samples-1)
								check(u, p)
							}
						}
					})
				}
			}
		}
	}
}

// A pedal used as another construction's input must obey the same guard.
func TestTinyPedalFamilyAsInput(t *testing.T) {
	for _, kind := range []string{"pedal", "contrapedal", "orthotomic"} {
		for _, scale := range []float64{1, 0x1p-40, 0x1p-100} {
			q := request("inversion", num(scale)+"*cos(t)", num(scale)+"*sin(t)", .2, 2.8)
			q.Input, q.Pole, q.Adaptive = kind, Vec{scale, 0}, true
			q.Samples, q.Lines = 65, 8
			q.Inversion.Radius = scale
			at := .731
			q.Probe = &ProbeQuery{T: &at}
			r := compute(t, q)
			if r.Invalid != 0 {
				t.Fatalf("%s at scale %g: %d invalid", kind, scale, r.Invalid)
			}
			for i, p := range r.Input {
				u := sampleT(q, i)
				c, s := math.Cos(u), math.Sin(u)
				want := Vec{1 + c - c*c, s * (1 - c)}
				if kind == "contrapedal" {
					want = Vec{c * c, s * c}
				}
				if kind == "orthotomic" {
					want = want.Mul(2).Sub(Vec{1, 0})
				}
				if p == nil {
					t.Fatalf("%s at scale %g: missing input %d", kind, scale, i)
				}
				closeVec(t, point(p.Mul(1/scale)), want, 2e-7)
			}
			// Inversion's own singularity at the origin is outside this assertion.
			if r.Probe.Input == nil {
				t.Fatalf("%s: missing probe input", kind)
			}
		}
	}
}

func TestTinyPedalFamilyKeepsGaps(t *testing.T) {
	for _, kind := range []string{"pedal", "contrapedal", "orthotomic"} {
		for _, scale := range []float64{1, 0x1p-40, 0x1p-100} {
			for _, off := range []float64{0, 5} {
				for _, xy := range [][2]string{{"0", "0"}, {"t^2", "t^3"}, {"t", "1/t"}} {
					q := request(kind, num(scale)+"*("+xy[0]+"+"+num(off)+")", num(scale)+"*("+xy[1]+")", -1, 1)
					q.Samples, q.Lines, q.Adaptive = 65, 8, true
					q.Pole = Vec{scale * (off + 1), scale}
					at := 0.0
					q.Probe = &ProbeQuery{T: &at}
					r := compute(t, q)
					if r.Invalid == 0 || r.Derived[q.Samples/2] != nil || r.Probe.Derived != nil {
						t.Fatalf("%s %v at scale %g off %g: no stationary/pole gap", kind, xy, scale, off)
					}
					if xy[0] == "0" {
						for _, p := range r.Derived {
							if p != nil {
								t.Fatal("constant curve acquired a projection")
							}
						}
					}
				}
			}
		}
	}
}
