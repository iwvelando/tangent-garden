package engine

import (
	"encoding/json"
	"math"
	"tangentgarden/engine/refine"
	"testing"
)

// Refinement of catacaustics and diacaustics between samples. Expectations
// come from independent closed forms evaluated here.

// Light parallel to the x axis, reflected in the unit circle, gathers on a
// nephroid. The ray reflected at (cos θ, sin θ) runs along
// (−cos 2θ, −sin 2θ) and touches the caustic cos θ / 2 along it, so the
// caustic is real (ahead of the mirror) where cos θ > 0 and virtual where
// cos θ < 0. It meets the mirror at θ = ±π/2 and has cusps at θ = 0 and π.
func nephroid(s float64) Vec {
	return Vec{(3*math.Cos(s) - math.Cos(3*s)) / 4, (3*math.Sin(s) - math.Sin(3*s)) / 4}
}

func nephroidRequest() Request {
	q := request("catacaustic", "cos(t)", "sin(t)", 0, 2*math.Pi)
	q.Source = Source{Kind: "parallel", Angle: 0}
	q.Samples = 64
	return q
}

// The cusp at θ = π falls between samples, which blunt it.
func TestRefinementOfTheNephroid(t *testing.T) {
	q := nephroidRequest()
	uniform := compute(t, q)
	r := compute(t, adaptive(q))
	checkRefined(t, q, r.Adaptive.Derived, r.Derived, nephroid)
	// Nothing else in the result changes: the rays and the samples' own
	// virtual flags keep the samples.
	r.Adaptive = nil
	a, _ := json.Marshal(r)
	b, _ := json.Marshal(uniform)
	if string(a) != string(b) {
		t.Fatal("refinement changed the rest of the result")
	}
}

// Every refined point carries whether it is virtual, and the change from
// real to virtual where the caustic meets the mirror is localized to the
// finest step, so the real and virtual parts are drawn to meet.
func TestRefinementMarksVirtualCausticPoints(t *testing.T) {
	q := nephroidRequest()
	r := compute(t, adaptive(q))
	path := r.Adaptive.Derived
	if len(path.Virtual) != len(path.Points) {
		t.Fatalf("%d virtual flags for %d points", len(path.Virtual), len(path.Points))
	}
	ts := positions(q, path)
	changes := 0
	for k, p := range path.Points {
		if p == nil {
			t.Fatalf("break at t = %g", ts[k])
		}
		if c := math.Cos(ts[k]); math.Abs(c) > 1e-9 && path.Virtual[k] != (c < 0) {
			t.Fatalf("point %d at t = %g: virtual %v", k, ts[k], path.Virtual[k])
		}
		if u := path.At[k]; u == math.Trunc(u) && path.Virtual[k] != r.Virtual[int(u)] {
			t.Fatalf("sample %d: virtual %v, the samples say %v", int(u), path.Virtual[k], r.Virtual[int(u)])
		}
		if k > 0 && path.Virtual[k] != path.Virtual[k-1] {
			changes++
			if w := path.At[k] - path.At[k-1]; w > math.Ldexp(1, -refine.Depth) {
				t.Fatalf("virtual from t = %g to %g: not localized (%g steps)", ts[k-1], ts[k], w)
			}
			if mid := (ts[k] + ts[k-1]) / 2; math.Abs(math.Cos(mid)) > 1e-3 {
				t.Fatalf("virtual changes at t = %g, away from ±π/2", mid)
			}
		}
	}
	if changes != 2 {
		t.Fatalf("virtual changes %d times, want 2", changes)
	}
}

// Under parallel light from above, the caustic of a wavy mirror runs off to
// infinity at the inflection, between samples, where the reflected rays
// turn parallel. Refinement breaks it there.
func TestRefinementBreaksACausticAtAnInflection(t *testing.T) {
	q := request("catacaustic", "t", "0.3*sin(t)", -1.0037, 2.5)
	q.Source = Source{Kind: "parallel", Angle: -90}
	q.Samples = 64
	r := compute(t, adaptive(q))
	for i, p := range r.Derived {
		if p == nil {
			t.Fatalf("uniform caustic already open at sample %d", i)
		}
	}
	path := r.Adaptive.Derived
	if path == nil || path.Breaks != 1 {
		t.Fatalf("caustic not broken once: %+v", path)
	}
	checkUniform(t, path, r.Derived)
	for k, p := range path.Points {
		if p == nil {
			if x := param(q, path.At[k]); math.Abs(x) > 3.5/63 {
				t.Fatalf("break at %g, far from the inflection", x)
			}
		}
	}
}

// A change from real to virtual through infinity, or across a stretch
// where the caustic is undefined, is a break, never joined: here a caustic
// at x = 1/(u − c) on the x axis, real for u < c, between two samples that
// refinement left joined.
func TestVirtualChangesThroughAPoleOrAGapAreBreaks(t *testing.T) {
	for _, c := range []float64{0.3, -1} {
		at := func(u float64) (*Vec, bool) {
			if c < 0 {
				// Undefined from 0.4 to 0.6 instead.
				if u > 0.4 && u < 0.6 {
					return nil, false
				}
				return &Vec{u, 0}, u >= 0.6
			}
			x := 1 / (u - c)
			return &Vec{x, 0}, x > 0
		}
		a, _ := at(0)
		b, _ := at(1)
		path := &RefinedPath{Points: []*Vec{a, b}, At: []float64{0, 1}, Tolerance: 1e-3}
		markVirtual(path, []bool{false, true}, at)
		if path.Breaks != 1 {
			t.Fatalf("c = %g: %d breaks, want 1", c, path.Breaks)
		}
		gaps := 0
		for k, p := range path.Points {
			if k > 0 && path.At[k] <= path.At[k-1] {
				t.Fatalf("c = %g: positions not increasing at %d", c, k)
			}
			if p == nil {
				gaps++
				continue
			}
			if _, v := at(path.At[k]); v != path.Virtual[k] {
				t.Fatalf("c = %g: point %d marked virtual %v", c, k, path.Virtual[k])
			}
		}
		if gaps != 1 {
			t.Fatalf("c = %g: %d gaps, want 1", c, gaps)
		}
	}
	// An interval refinement already broke is counted once.
	at := func(u float64) (*Vec, bool) { return &Vec{1 / (u - 0.7), 0}, u > 0.7 }
	start, _ := at(0)
	mid, _ := at(0.4)
	end, _ := at(1)
	path := &RefinedPath{Points: []*Vec{start, nil, mid, end}, At: []float64{0, 0.2, 0.4, 1}, Tolerance: 1e-3, Breaks: 1}
	markVirtual(path, []bool{false, true}, at)
	if path.Breaks != 1 {
		t.Fatalf("an interval already broken counted again: %d breaks", path.Breaks)
	}
}

// Parallel light refracted at a unit circle into a denser medium. Where a
// ray grazes the circle it crosses to the other side of the normal, and the
// refracted rays jump: the caustic is broken there, not drawn to the rim.
// Elsewhere each point lies along the ray refracted at (cos θ, sin θ), at
// angle θₜ to the normal with n₁ sin θᵢ = n₂ sin θₜ, a distance along it
// given by Coddington's tangential equation for light from infinity,
// n₂ cos² θₜ / s′ = (n₂ cos θₜ − n₁ cos θᵢ) / R.
func TestRefinementBreaksADiacausticAtGrazingIncidence(t *testing.T) {
	q := request("diacaustic", "cos(t)", "sin(t)", 0, 2*math.Pi)
	q.Source = Source{Kind: "parallel", Angle: 0}
	q.NIncident, q.NTransmitted, q.Samples = 1, 1.333, 300
	r := compute(t, adaptive(q))
	path := r.Adaptive.Derived
	checkUniform(t, path, r.Derived)
	if path.Breaks != 2 || path.Unresolved != 0 {
		t.Fatalf("breaks %d, unresolved %d; want a break at each grazing ray", path.Breaks, path.Unresolved)
	}
	ts := positions(q, path)
	for k, c := range path.Points {
		if c == nil {
			if g := math.Abs(math.Cos(ts[k])); g > 0.05 {
				t.Fatalf("break at t = %g, away from grazing incidence", ts[k])
			}
			continue
		}
		p := Vec{math.Cos(ts[k]), math.Sin(ts[k])}
		cosI := math.Abs(p.X)
		sinT := q.NIncident / q.NTransmitted * math.Sqrt(1-cosI*cosI)
		cosT := math.Sqrt(1 - sinT*sinT)
		along := q.NTransmitted * cosT * cosT / math.Abs(q.NTransmitted*cosT-q.NIncident*cosI)
		ray := c.Sub(p)
		if math.Abs(ray.Norm()-along) > 1e-6 || math.Abs(math.Abs(ray.Cross(p))/ray.Norm()-sinT) > 1e-6 {
			t.Fatalf("point %d at t = %g is %v: %g along a ray at sin %g to the normal, want %g at sin %g", k, ts[k], *c, ray.Norm(), math.Abs(ray.Cross(p))/ray.Norm(), along, sinT)
		}
	}
}

// Between samples a caustic is undefined wherever a sample would be, and
// virtual wherever a sample would be: evaluated at each sample, it returns
// exactly the uniform study's point and flag, including beyond total
// internal reflection and on a derived input.
func TestRefinedCausticsAgreeWithTheSamples(t *testing.T) {
	point := request("catacaustic", "cos(t)", "sin(t)", 0, 2*math.Pi)
	point.Source.Position, point.Samples = Vec{0.4, 0.2}, 64
	parallel := ellipseRequest("catacaustic")
	parallel.Source = Source{Kind: "parallel", Angle: 30}
	tir := request("diacaustic", "t", "0", -3, 3)
	tir.NIncident, tir.NTransmitted, tir.Samples = 1.5, 1, 65
	refracted := ellipseRequest("diacaustic")
	refracted.Source.Position = Vec{0.3, 0.1}
	input := parallel
	input.Input, input.Distance = "offset", 0.3
	cases := map[string]Request{
		"point source":                   point,
		"parallel light":                 parallel,
		"total internal reflection":      tir,
		"refraction from inside":         refracted,
		"catacaustic of an offset input": input,
	}
	gaps := map[string]int{}
	for name, q := range cases {
		r := compute(t, q)
		f, err := compile(q.Curve)
		if err != nil {
			t.Fatal(err)
		}
		g := inputCurve(q.Input, f, q.Curve.Min, q.Curve.Max, q.Pole, q.Distance)
		at, c := q.derivedAt(f, g), q.causticAt(f, g)
		if at == nil || c == nil {
			t.Fatalf("%s: no evaluator", name)
		}
		step := (q.Curve.Max - q.Curve.Min) / float64(q.Samples-1)
		for j, want := range r.Derived {
			s := q.Curve.Min + float64(j)*step
			got, virtual := c.at(s)
			if p := at(s); (p == nil) != (got == nil) || p != nil && *p != *got {
				t.Fatalf("%s at sample %d: evaluators disagree, %v and %v", name, j, p, got)
			}
			switch {
			case want != nil && (got == nil || *got != *want):
				t.Fatalf("%s at sample %d: %v, want %v", name, j, got, *want)
			case want == nil && got != nil:
				t.Fatalf("%s at sample %d: %v where the samples have none", name, j, *got)
			case want == nil:
				gaps[name]++
			case virtual != r.Virtual[j]:
				t.Fatalf("%s at sample %d: virtual %v, want %v", name, j, virtual, r.Virtual[j])
			}
		}
	}
	if gaps["total internal reflection"] == 0 {
		t.Fatalf("no total internal reflection among the samples: %v", gaps)
	}
}
