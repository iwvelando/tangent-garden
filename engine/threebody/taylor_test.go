package threebody

import (
	"math"
	"testing"
)

func TestDoubleDoubleArithmetic(t *testing.T) {
	third := ddFrom(1).Div(ddFrom(3))
	// 3 · (1/3) − 1 is within the format's 2⁻¹⁰⁵ of zero.
	if r := third.Mul(ddFrom(3)).Sub(ddFrom(1)); math.Abs(r.Float()) > 1e-31 {
		t.Errorf("3·(1/3) − 1 = %g", r.Float())
	}
	// 1 + 2⁻⁸⁰ keeps its low part, which a float64 loses.
	tiny := math.Ldexp(1, -80)
	if s := ddFrom(1).Add(ddFrom(tiny)).Sub(ddFrom(1)); s.Float() != tiny {
		t.Errorf("(1 + 2⁻⁸⁰) − 1 = %g", s.Float())
	}
	// √2 squared.
	r2 := ddFrom(2).Sqrt()
	if d := r2.Mul(r2).Sub(ddFrom(2)); math.Abs(d.Float()) > 1e-31 {
		t.Errorf("√2² − 2 = %g", d.Float())
	}
	// 1/7 against its first 30 decimal digits, 0.142857 repeated.
	seventh := ddFrom(1).Div(ddFrom(7))
	want := ddFrom(142857).Div(ddFrom(999999))
	if d := seventh.Sub(want); math.Abs(d.Float()) > 1e-31 {
		t.Errorf("1/7 − 142857/999999 = %g", d.Float())
	}
}

// The power recurrence for s^(−3/2) matches the closed form of a series
// whose coefficients are known: (1 + t)^(−3/2) = Σ binom(−3/2, k) tᵏ.
func TestInverseCubeRecurrence(t *testing.T) {
	s := []f64{1, 1, 0, 0, 0, 0, 0, 0}
	u := make([]f64, len(s))
	for k := range s {
		u[k] = inverseCube(s, u, k)
	}
	c := 1.0
	for k := range u {
		near(t, "binomial coefficient", float64(u[k]), c, 1e-15)
		c *= (-1.5 - float64(k)) / float64(k+1)
	}
}

// In double-double and in float64, the Taylor method reproduces the Kepler
// oracle to float64 rounding over ten periods.
func TestTaylorMatchesKepler(t *testing.T) {
	for _, e := range []float64{0, 0.6, 0.9} {
		k := kepler{m1: 0.7, m2: 0.3, a: 1, e: e, c0: [2]float64{0.25, -0.5}, w: [2]float64{0.05, 0.02}}
		T := k.period()
		var times []float64
		for i := 0; i <= 200; i++ {
			times = append(times, 10*T*float64(i)/200)
		}
		ref, stats := taylorRun(ddFrom, []float64{0.7, 0.3}, k.at(0), times, 1e-28, 30)
		low, _ := taylorRun(func(x float64) f64 { return f64(x) }, []float64{0.7, 0.3}, k.at(0), times, 1e-15, 20)
		worstRef, worstLow := 0.0, 0.0
		oracle := k.refit()
		for i, at := range times {
			want := oracle.at(at)
			worstRef = math.Max(worstRef, maxDiff(floats(ref[i]), want, 0, 8))
			worstLow = math.Max(worstLow, maxDiff(floats(low[i]), want, 0, 8))
		}
		// The oracle itself is a float64 evaluation of Kepler's equation, its
		// mean anomaly growing to 63 radians and its elements rounded: the
		// measured 2.7·10⁻¹³ at e = 0.9 is that limit.
		if worstRef > 5e-13 {
			t.Errorf("e=%g: double-double Taylor differs from Kepler by %.3g", e, worstRef)
		}
		// Measured 2·10⁻¹³, 3.9·10⁻¹¹ and 1.3·10⁻⁸: float64 rounding
		// accumulates near pericenter. The method comparison weighs it.
		if worstLow > 3e-8 {
			t.Errorf("e=%g: float64 Taylor differs from Kepler by %.3g", e, worstLow)
		}
		t.Logf("e=%g: %d reference steps; errors %.3g (dd), %.3g (float64)", e, stats.steps, worstRef, worstLow)
	}
}

// The reference converges: tightening its tolerance and raising its order
// changes a regular orbit by far less than any production error.
func TestReferenceSelfConsistency(t *testing.T) {
	k := kepler{m1: 0.7, m2: 0.3, a: 1, e: 0.9}
	times := []float64{0, 7.3, 31.4, 62.8}
	a, _ := taylorRun(ddFrom, []float64{0.7, 0.3}, k.at(0), times, 1e-24, 26)
	b, _ := taylorRun(ddFrom, []float64{0.7, 0.3}, k.at(0), times, 1e-30, 34)
	for i := range times {
		d := 0.0
		for q := range a[i] {
			d = math.Max(d, math.Abs(a[i][q].Sub(b[i][q]).Float()))
		}
		// Measured 3·10⁻¹⁸; production errors are 10⁻¹¹ or more.
		if d > 1e-16 {
			t.Errorf("t=%g: references differ by %.3g", times[i], d)
		}
	}
}
