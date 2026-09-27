package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func offsetRequest(x, y string, lo, hi, d float64) Request {
	q := request("offset", x, y, lo, hi)
	q.Distance = d
	return q
}

func sampleT(q Request, j int) float64 {
	return q.Curve.Min + float64(j)*(q.Curve.Max-q.Curve.Min)/float64(q.Samples-1)
}

func polylineLength(points []*Vec) float64 {
	length := 0.0
	for i := 1; i < len(points); i++ {
		length += points[i].Sub(*points[i-1]).Norm()
	}
	return length
}

// Positive distances move toward the left normal: inward on a counterclockwise
// circle and outward on a clockwise one.
func TestOffsetAnalytic(t *testing.T) {
	for _, tc := range []struct {
		name, x, y string
		d          float64
		want       func(float64) Vec
	}{
		{"inward", "2*cos(t)", "2*sin(t)", .5, func(u float64) Vec { return Vec{1.5 * math.Cos(u), 1.5 * math.Sin(u)} }},
		{"outward", "2*cos(t)", "2*sin(t)", -1, func(u float64) Vec { return Vec{3 * math.Cos(u), 3 * math.Sin(u)} }},
		{"clockwise", "2*cos(t)", "-2*sin(t)", .5, func(u float64) Vec { return Vec{2.5 * math.Cos(u), -2.5 * math.Sin(u)} }},
		// d equal to the radius collapses the circle to its center, a
		// legitimate point offset rather than a failed sample.
		{"collapse", "2*cos(t)", "2*sin(t)", 2, func(float64) Vec { return Vec{} }},
		{"through center", "2*cos(t)", "2*sin(t)", 3, func(u float64) Vec { return Vec{-math.Cos(u), -math.Sin(u)} }},
		{"zero", "2*cos(t)", "2*sin(t)", 0, func(u float64) Vec { return Vec{2 * math.Cos(u), 2 * math.Sin(u)} }},
	} {
		q := offsetRequest(tc.x, tc.y, 0, 2*math.Pi, tc.d)
		r := compute(t, q)
		if r.Invalid != 0 || len(r.Rays) != q.Lines {
			t.Fatalf("%s: invalid %d, rays %d", tc.name, r.Invalid, len(r.Rays))
		}
		for j, p := range r.Derived {
			closeVec(t, p, tc.want(sampleT(q, j)), 1e-7)
		}
		for _, ray := range r.Rays {
			if math.Abs(ray.Target.Sub(ray.Origin).Norm()-math.Abs(tc.d)) > 1e-7 {
				t.Fatalf("%s: construction segment is not |d| long: %v", tc.name, ray)
			}
		}
	}
	// A line offsets to the parallel line |d| away on its left.
	q := offsetRequest("t", "2*t+1", -2, 2, math.Sqrt(5))
	for j, p := range compute(t, q).Derived {
		u := sampleT(q, j)
		closeVec(t, p, Vec{u - 2, 2*u + 2}, 1e-7)
	}
}

func TestOffsetGeometricInvariants(t *testing.T) {
	const d = .35
	a := compute(t, offsetRequest("2*cos(t)+0.3*cos(3*t)", "1.1*sin(t)", 0, 2*math.Pi, d))
	// Reversing orientation flips the normal, so -d reproduces the same points.
	b := compute(t, offsetRequest("2*cos(-t)+0.3*cos(-3*t)", "1.1*sin(-t)", -2*math.Pi, 0, -d))
	// A rotation by 90° plus translation carries offsets with the curve.
	c := compute(t, offsetRequest("-1.1*sin(t)+4", "2*cos(t)+0.3*cos(3*t)-3", 0, 2*math.Pi, d))
	// Regular reparameterization changes only which points are sampled.
	e := compute(t, offsetRequest("2*cos(t^2)+0.3*cos(3*t^2)", "1.1*sin(t^2)", 0, math.Sqrt(2*math.Pi), d))
	n := len(a.Derived)
	for i, p := range a.Derived {
		closeVec(t, b.Derived[n-1-i], *p, 1e-7)
		closeVec(t, c.Derived[i], p.Perp().Add(Vec{4, -3}), 1e-7)
		if math.Abs(p.Sub(*a.Base[i]).Norm()-d) > 1e-7 {
			t.Fatalf("offset is not at distance %g: %v from %v", d, p, a.Base[i])
		}
	}
	// Compare reparameterized samples against direct evaluation at t².
	for j := 1; j < n-1; j += 37 {
		u := math.Pow(sampleT(offsetRequest("", "", 0, math.Sqrt(2*math.Pi), d), j), 2)
		p := Vec{2*math.Cos(u) + .3*math.Cos(3*u), 1.1 * math.Sin(u)}
		dp := Vec{-2*math.Sin(u) - .9*math.Sin(3*u), 1.1 * math.Cos(u)}
		closeVec(t, e.Derived[j], p.Add(dp.Perp().Unit().Mul(d)), 1e-6)
	}
}

// Steiner's formula: an offset of a closed convex curve by distance -d (outward
// for counterclockwise travel) changes length by 2πd, while an inward offset
// smaller than the least radius of curvature shortens it by the same amount.
func TestOffsetSteinerLengthConverges(t *testing.T) {
	previous := math.Inf(1)
	for _, samples := range []int{501, 2001, 8001} {
		worst := 0.0
		for _, d := range []float64{-.3, .3} {
			q := offsetRequest("2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi, d)
			q.Samples = samples
			r := compute(t, q)
			change := polylineLength(r.Derived) - polylineLength(r.Base)
			worst = math.Max(worst, math.Abs(change+2*math.Pi*d))
		}
		if worst > previous/3 {
			t.Fatalf("Steiner error did not converge at %d samples: %g after %g", samples, worst, previous)
		}
		previous = worst
	}
	if previous > 1e-5 {
		t.Fatalf("Steiner error %g", previous)
	}
}

// On the parabola (t, t²) the curvature is 2/(1+4t²)^(3/2), at most 2 at the
// vertex. An offset toward the focus stays regular for d < 1/2; beyond it,
// 1-dκ changes sign at two cusps, which lie on the evolute and must be kept.
func TestOffsetCuspOnsetOnEvolute(t *testing.T) {
	turns := func(d float64) (int, Result) {
		q := offsetRequest("t", "t^2", -1, 1, d)
		q.Samples = 2001
		r := compute(t, q)
		if r.Invalid != 0 {
			t.Fatalf("d=%g discarded %d valid offset samples", d, r.Invalid)
		}
		count, last := 0, 0.0
		for j := 1; j < len(r.Derived); j++ {
			// Forward motion along the base tangent (1, 2t) is 1-dκ times the base speed.
			s := r.Derived[j].Sub(*r.Derived[j-1]).Dot(r.Base[j].Sub(*r.Base[j-1]))
			if last != 0 && s*last < 0 {
				count++
			}
			if s != 0 {
				last = s
			}
		}
		return count, r
	}
	for _, d := range []float64{.2, .45} {
		if n, _ := turns(d); n != 0 {
			t.Fatalf("d=%g below 1/2 should have no cusps, found %d", d, n)
		}
	}
	for _, d := range []float64{.55, 1} {
		if n, _ := turns(d); n != 2 {
			t.Fatalf("d=%g above 1/2 should have two cusps, found %d", d, n)
		}
	}
	// With d=1 the cusps sit where κ=1, at t=±sqrt((2^(2/3)-1)/4).
	tc := math.Sqrt((math.Cbrt(4) - 1) / 4)
	for _, u := range []float64{-tc, tc} {
		p, dp, ddp := Vec{u, u * u}, Vec{1, 2 * u}, Vec{0, 2}
		closeVec(t, Offset(p, dp, 1), *Evolute(p, dp, ddp), 1e-12)
	}
	_, r := turns(1)
	j := int(math.Round((tc + 1) / 2 * 2000))
	closeVec(t, r.Derived[j], Vec{-4 * tc * tc * tc, .5 + 3*tc*tc}, 2e-3)
}

func TestOffsetInvalidAndDegenerateSamples(t *testing.T) {
	for _, d := range []float64{math.NaN(), math.Inf(1), 1e5 + 1, -1e5 - 1} {
		if _, err := Compute(offsetRequest("t", "t^2", -1, 1, d)); err == nil || !strings.Contains(err.Error(), "offset distance") {
			t.Fatalf("accepted distance %g: %v", d, err)
		}
	}
	// The involute string offset and offset distance are independent fields.
	q := offsetRequest("t", "t^2", -1, 1, 1)
	q.Offset = 7
	if p := compute(t, q).Derived[250]; p == nil || p.Sub(Vec{0, 1}).Norm() > 1e-9 {
		t.Fatalf("involute offset leaked into the normal offset: %v", p)
	}
	for _, tc := range [][2]string{{"1", "1"}, {"t^2", "t^3"}, {"t", "1/t"}} {
		r := compute(t, offsetRequest(tc[0], tc[1], -1, 1, .5))
		if r.Derived[250] != nil || r.Invalid == 0 {
			t.Fatalf("missing stationary/discontinuous gap for %v", tc)
		}
	}
	// Only a first derivative is required.
	r := compute(t, offsetRequest("t", "abs(t)^1.5", -1, 1, 2))
	if r.Invalid != 0 {
		t.Fatalf("offset incorrectly requires second derivative stability: %d", r.Invalid)
	}
	closeVec(t, r.Derived[250], Vec{0, 2}, 1e-7)
	var decoded Request
	if err := json.Unmarshal([]byte(`{"kind":"offset","distance":0.25}`), &decoded); err != nil || decoded.Distance != .25 {
		t.Fatalf("distance JSON field: %v %v", decoded, err)
	}
}
