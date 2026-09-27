package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func stackRequest(x, y string, lo, hi, from, to float64, count int) Request {
	q := request("offset", x, y, lo, hi)
	q.Stack = Stack{Enabled: true, From: from, To: to, Count: count}
	return q
}

// A stack of offsets of a counterclockwise circle is a set of concentric
// circles; members are ordered from the first distance to the last.
func TestOffsetStackConcentricCircles(t *testing.T) {
	q := stackRequest("2*cos(t)", "2*sin(t)", 0, 2*math.Pi, -1, 1, 5)
	r := compute(t, q)
	if len(r.Derived) != 0 || len(r.Family) != 5 || r.Invalid != 0 {
		t.Fatalf("derived %d, family %d, invalid %d", len(r.Derived), len(r.Family), r.Invalid)
	}
	for k, path := range r.Family {
		d := -1 + .5*float64(k)
		if path.Distance != d || len(path.Points) != q.Samples {
			t.Fatalf("member %d: distance %g, %d points", k, path.Distance, len(path.Points))
		}
		for j, p := range path.Points {
			u := sampleT(q, j)
			closeVec(t, p, Vec{(2 - d) * math.Cos(u), (2 - d) * math.Sin(u)}, 1e-7)
		}
	}
	// Each normal segment spans the whole stack at its sample.
	if len(r.Rays) != q.Lines {
		t.Fatalf("rays %d", len(r.Rays))
	}
	for _, ray := range r.Rays {
		closeVec(t, &ray.Origin, *r.Family[0].Points[ray.SampleIndex], 1e-12)
		closeVec(t, ray.Target, *r.Family[4].Points[ray.SampleIndex], 1e-12)
	}
	if len(r.Circles) != 0 {
		t.Fatalf("circles drawn without being requested: %d", len(r.Circles))
	}
}

// Every member is exactly the single offset at its distance, and the
// endpoints of the reference study d = 0.105k, k = -9…8, are exact.
func TestOffsetStackMatchesSingleOffsets(t *testing.T) {
	x, y := "(1+0.18*cos(5*t))*cos(t)", "(1+0.18*cos(5*t))*sin(t)"
	r := compute(t, stackRequest(x, y, 0, 2*math.Pi, -.945, .84, 18))
	if r.Family[0].Distance != -.945 || r.Family[17].Distance != .84 {
		t.Fatalf("endpoints %g %g", r.Family[0].Distance, r.Family[17].Distance)
	}
	for k, path := range r.Family {
		if math.Abs(path.Distance-.105*float64(k-9)) > 1e-15 {
			t.Fatalf("member %d distance %g", k, path.Distance)
		}
		single := compute(t, offsetRequest(x, y, 0, 2*math.Pi, path.Distance))
		for j, p := range path.Points {
			if *p != *single.Derived[j] {
				t.Fatalf("member %d sample %d: %v != %v", k, j, p, single.Derived[j])
			}
		}
	}
	// A descending stack keeps the requested order.
	down := compute(t, stackRequest(x, y, 0, 2*math.Pi, .84, -.945, 18))
	if down.Family[0].Distance != .84 || down.Family[17].Distance != -.945 {
		t.Fatalf("descending endpoints %g %g", down.Family[0].Distance, down.Family[17].Distance)
	}
	// Segments always reach back to the base curve, even for a one-sided stack.
	inward := compute(t, stackRequest(x, y, 0, 2*math.Pi, .1, .2, 2))
	for _, ray := range inward.Rays {
		closeVec(t, &ray.Origin, *inward.Base[ray.SampleIndex], 1e-12)
		closeVec(t, ray.Target, *inward.Family[1].Points[ray.SampleIndex], 1e-12)
	}
}

// By Steiner's formula each member of a stack on a closed convex curve,
// within the least radius of curvature, has length L - 2πd.
func TestOffsetStackSteinerLengths(t *testing.T) {
	q := stackRequest("2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi, -.5, .5, 11)
	q.Samples = 8001
	r := compute(t, q)
	base := polylineLength(r.Base)
	for _, path := range r.Family {
		if e := math.Abs(polylineLength(path.Points) - base + 2*math.Pi*path.Distance); e > 1e-5 {
			t.Fatalf("d=%g Steiner error %g", path.Distance, e)
		}
	}
}

// The offsets ±R are the envelope of radius-R circles centered on the curve:
// each circle passes through both offset points at its sample, and no circle
// crosses either offset when R is below the least radius of curvature.
func TestOffsetGeneratingCirclesEnvelope(t *testing.T) {
	const R = .5 // The ellipse's least radius of curvature is 1.1²/2 = 0.605.
	q := stackRequest("2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi, -R, R, 2)
	q.Circles = true
	q.Samples = 4000
	r := compute(t, q)
	if len(r.Circles) != q.Lines {
		t.Fatalf("circles %d, want %d", len(r.Circles), q.Lines)
	}
	for i, c := range r.Circles {
		if c.SampleIndex != r.Rays[i].SampleIndex || c.Radius != R {
			t.Fatalf("circle %d: %+v", i, c)
		}
		closeVec(t, &c.Center, *r.Base[c.SampleIndex], 1e-12)
		for _, path := range r.Family {
			if e := math.Abs(path.Points[c.SampleIndex].Sub(c.Center).Norm() - R); e > 1e-9 {
				t.Fatalf("circle %d misses the d=%g offset by %g", i, path.Distance, e)
			}
			for _, p := range path.Points {
				if p.Sub(c.Center).Norm() < R-1e-6 {
					t.Fatalf("circle %d crosses the d=%g offset at %v", i, path.Distance, p)
				}
			}
		}
	}
	// The circle radius is the stack's largest distance from the curve.
	q = stackRequest("2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi, -.2, .7, 4)
	q.Circles = true
	if c := compute(t, q).Circles; len(c) == 0 || c[0].Radius != .7 {
		t.Fatalf("stack circle radius: %+v", c)
	}
	// A single offset uses |d|, and d = 0 draws no zero-radius circles.
	for _, d := range []float64{-.3, 0} {
		single := offsetRequest("2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi, d)
		single.Circles = true
		c := compute(t, single).Circles
		if d == 0 && len(c) != 0 || d != 0 && (len(c) != single.Lines || c[0].Radius != .3) {
			t.Fatalf("single d=%g circles: %d", d, len(c))
		}
	}
	// Other constructions have no generating circles.
	evolute := request("evolute", "2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi)
	evolute.Circles = true
	evolute.Stack = Stack{Enabled: true, From: -1, To: 1, Count: 3}
	if r := compute(t, evolute); len(r.Circles) != 0 || len(r.Family) != 0 || len(r.Derived) != evolute.Samples {
		t.Fatalf("stack or circles leaked into an evolute: %d %d", len(r.Circles), len(r.Family))
	}
}

func TestOffsetStackInvalidAndDegenerate(t *testing.T) {
	for _, tc := range []struct {
		from, to float64
		count    int
		samples  int
		want     string
	}{
		{-1, 1, 1, 1000, "2–64"},
		{-1, 1, 65, 1000, "2–64"},
		{-1, 1, 64, 2049, "131,072"},
		{math.NaN(), 1, 4, 1000, "within ±100000"},
		{-1, math.Inf(-1), 4, 1000, "within ±100000"},
		{-1e5 - 1, 1, 4, 1000, "within ±100000"},
	} {
		q := stackRequest("t", "t^2", -1, 1, tc.from, tc.to, tc.count)
		q.Samples = tc.samples
		if _, err := Compute(q); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("accepted %+v: %v", tc, err)
		}
	}
	// 64 × 2048 is within the point budget.
	q := stackRequest("t", "t^2", -1, 1, -1, 1, 64)
	q.Samples = 2048
	if len(compute(t, q).Family) != 64 {
		t.Fatal("rejected a stack within the point budget")
	}
	// A disabled stack is ignored entirely, including its fields.
	q = offsetRequest("t", "t^2", -1, 1, .25)
	q.Stack = Stack{From: math.NaN(), Count: 0}
	if r := compute(t, q); len(r.Family) != 0 || len(r.Derived) != q.Samples {
		t.Fatalf("disabled stack changed the result: %d", len(r.Family))
	}
	// A stationary point is a gap in every member, counted once.
	r := compute(t, stackRequest("t^3", "t^2", -1, 1, -.5, .5, 3))
	if r.Invalid != 1 {
		t.Fatalf("invalid %d", r.Invalid)
	}
	for _, path := range r.Family {
		if path.Points[250] != nil || path.Points[249] == nil {
			t.Fatalf("d=%g: missing or extra gap at the stationary point", path.Distance)
		}
	}
	var decoded Request
	if err := json.Unmarshal([]byte(`{"stack":{"enabled":true,"from":-1,"to":2,"count":7},"circles":true}`), &decoded); err != nil || decoded.Stack != (Stack{true, -1, 2, 7}) || !decoded.Circles {
		t.Fatalf("stack JSON fields: %+v %v", decoded, err)
	}
	b, _ := json.Marshal(compute(t, offsetRequest("t", "t^2", -1, 1, .25)))
	if !strings.Contains(string(b), `"family":[]`) || !strings.Contains(string(b), `"circles":[]`) {
		t.Fatalf("result must always carry family and circles arrays: %.200s", b)
	}
}
