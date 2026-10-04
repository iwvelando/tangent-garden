package engine3

import (
	"math"
	"testing"
)

// The diagnostics' cumulative arc length: Length[i] is the length of the
// drawn curve from its first sample to sample i, null where the curve is
// not drawn, with nothing added across a break.

func TestHelixArcLengthIsExact(t *testing.T) {
	// r(t) = (R cos t, R sin t, ht) has constant speed √(R²+h²), so its
	// length from lo is √(R²+h²)(t − lo), and Simpson's rule is exact.
	R, h := 2.0, 0.5
	c := custom("2*cos(t)", "2*sin(t)", "a*t", -2*math.Pi, 2*math.Pi)
	c.Curve.A = h
	r, d := diagnosed(t, c)
	if len(d.Length) != len(r.Base) {
		t.Fatalf("length series of %d for %d samples", len(d.Length), len(r.Base))
	}
	speed := math.Hypot(R, h)
	for i := range r.Base {
		want := speed * (parameter(d, i) - d.Min)
		if d.Length[i] == nil || math.Abs(*d.Length[i]-want) > 1e-9*math.Max(1, want) {
			t.Fatalf("sample %d: length %v, want %v", i, d.Length[i], want)
		}
	}
}

// spiralLength is the length of (cos t, sin t, t²/2) from 0 to u: its speed
// is √(1+t²), whose integral is (u√(1+u²) + asinh u)/2.
func spiralLength(u float64) float64 {
	return (u*math.Sqrt(1+u*u) + math.Asinh(u)) / 2
}

func TestArcLengthConvergesAtFourthOrder(t *testing.T) {
	// Simpson's rule on each interval has error O(h⁴) overall: doubling the
	// samples divides the worst error by about 16.
	worst := func(samples int) float64 {
		c := custom("cos(t)", "sin(t)", "t^2/2", 0, 3)
		c.Samples = samples
		r, d := diagnosed(t, c)
		e := 0.0
		for i := range r.Base {
			e = math.Max(e, math.Abs(*d.Length[i]-spiralLength(parameter(d, i))))
		}
		return e
	}
	coarse, fine := worst(240), worst(480)
	if coarse > 1e-6 || fine > coarse/12 {
		t.Fatalf("errors %.3g at 240 samples, %.3g at 480", coarse, fine)
	}
}

func TestArcLengthIgnoresReparameterization(t *testing.T) {
	// u ↦ s = u³/4 + u is increasing, so the reparameterized curve has the
	// same length over the corresponding domains, and at corresponding
	// samples of a fine grid.
	plain := custom("cos(t)", "sin(2*t)", "0.4*t", -1.2*1.2*1.2/4-1.2, 1.2*1.2*1.2/4+1.2)
	plain.Samples = 2000
	re := custom("cos(t^3/4+t)", "sin(2*(t^3/4+t))", "0.4*(t^3/4+t)", -1.2, 1.2)
	re.Samples = 2000
	_, p := diagnosed(t, plain)
	_, q := diagnosed(t, re)
	n := len(p.Length) - 1
	if a, b := *p.Length[n], *q.Length[n]; math.Abs(a-b) > 1e-6*a {
		t.Fatalf("total length %v, %v after reparameterization", a, b)
	}
}

func TestArcLengthAddsNothingAcrossBreaks(t *testing.T) {
	// (t, 1/t, 0) on [−1, 1] is undefined at its middle sample: the length
	// is null there and does not grow between the samples either side.
	c := custom("t", "1/t", "0", -1, 1)
	c.Construction = "none"
	r, d := diagnosed(t, c)
	n := len(r.Base) - 1
	mid := n / 2
	if r.Base[mid] != nil || d.Length[mid] != nil {
		t.Fatalf("middle sample drawn %v, length %v", r.Base[mid] != nil, d.Length[mid])
	}
	if *d.Length[mid+1] != *d.Length[mid-1] {
		t.Fatalf("length grew across the pole: %v → %v", *d.Length[mid-1], *d.Length[mid+1])
	}
	// (t², t³, 0) has a cusp at t = 0, between samples here: its tangent
	// reverses there without an undefined sample.
	j := custom("t^2", "t^3", "0", -1, 1.003)
	j.Construction = "none"
	r, d = diagnosed(t, j)
	broken := 0
	for i := 0; i+1 < len(r.Base); i++ {
		if d.Length[i] == nil || d.Length[i+1] == nil {
			continue
		}
		step := *d.Length[i+1] - *d.Length[i]
		if step < 0 {
			t.Fatalf("length fell from sample %d to %d", i, i+1)
		}
		if r.Breaks[i+1] {
			broken++
			if step != 0 {
				t.Fatalf("length grew %v across the break after sample %d", step, i)
			}
		}
	}
	if broken == 0 {
		t.Fatal("the cusp did not break")
	}
}

func TestClosedCurveLengthEndsAtItsPerimeter(t *testing.T) {
	// A circle of radius 2: the seam's repeated sample stands at the end of
	// the loop, 4π, not back at 0.
	c := custom("2*cos(t)", "2*sin(t)", "0", 0, 2*math.Pi)
	c.Construction = "none"
	r, d := diagnosed(t, c)
	n := len(r.Base) - 1
	if *d.Length[0] != 0 || math.Abs(*d.Length[n]-4*math.Pi) > 1e-9 {
		t.Fatalf("length from %v to %v, want 0 to 4π", *d.Length[0], *d.Length[n])
	}
}
