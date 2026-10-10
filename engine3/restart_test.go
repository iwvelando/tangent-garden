package engine3

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
)

// tanSpeed is the speed of (tan t, cos t, sin t), √(sec⁴t + 1).
func tanSpeed(t float64) float64 {
	s := 1 / math.Cos(t)
	return math.Sqrt(s*s*s*s + 1)
}

// tanArc is the arc length of (tan t, cos t, sin t) from a to b by
// composite Simpson's rule on a fine grid, independent of the engine.
func tanArc(a, b float64) float64 {
	const steps = 20000
	h := (b - a) / steps
	sum := tanSpeed(a) + tanSpeed(b)
	for k := 1; k < steps; k++ {
		sum += map[bool]float64{true: 4, false: 2}[k%2 == 1] * tanSpeed(a+float64(k)*h)
	}
	return sum * h / 3
}

// tanInvolute is r + (c − s)T on (tan t, cos t, sin t), with s measured
// from the anchor t₀.
func tanInvolute(u, anchor, c float64) Vec3 {
	r := Vec3{math.Tan(u), math.Cos(u), math.Sin(u)}
	sec := 1 / math.Cos(u)
	T := Vec3{sec * sec, -math.Sin(u), math.Cos(u)}.unit()
	return r.add(T.mul(c - tanArc(anchor, u)))
}

// checkRestarted compares the points of (tan t, cos t, sin t)'s involute
// past each asymptote with the involute anchored at that stretch's own
// restart, away from the asymptotes where the samples' arc length is
// coarse; it returns how many it checked.
func checkRestarted(t *testing.T, c Request, points []*Vec3, restarts []float64, offset float64) int {
	t.Helper()
	if len(restarts) != 2 || !(restarts[0] < -math.Pi/2) || !(restarts[1] > math.Pi/2) {
		t.Fatalf("restarts %v, want one beyond each asymptote", restarts)
	}
	checked := 0
	for i, p := range points {
		u := at(c, i)
		if math.Abs(u) < math.Pi/2+0.2 {
			continue
		}
		if p == nil {
			t.Fatalf("sample %d at t = %g unreached after a restart", i, u)
		}
		anchor := restarts[0]
		if u > 0 {
			anchor = restarts[1]
		}
		near(t, p, tanInvolute(u, anchor, offset), 1e-7)
		checked++
	}
	return checked
}

// With restart, arc length starts again past each break of the base, from
// an anchor of that stretch's own, so no regular sample is unreached and
// every member point past an asymptote is the involute anchored there.
// The anchor's own stretch is unchanged, and so is a study without it.
func TestInvoluteRestartsAfterABreak(t *testing.T) {
	const anchor, offset = 0.5, 0.3
	c := involuteStudy("tan(t)", "cos(t)", "sin(t)", -2, 2, anchor, offset)
	c.Samples = 481
	plain := involute(t, c)
	if plain.Involute.Unreached == 0 || plain.Involute.Restarts != nil {
		t.Fatalf("without restart: %d unreached, restarts %v", plain.Involute.Unreached, plain.Involute.Restarts)
	}
	encoded, _ := json.Marshal(plain.Involute)
	if strings.Contains(string(encoded), "restarts") {
		t.Fatal("a study without restart reports restarts")
	}
	c.Involute.Restart = true
	r := involute(t, c)
	if r.Involute.Unreached != 0 {
		t.Fatalf("%d unreached after restarting", r.Involute.Unreached)
	}
	points := r.Involute.Members[0].Points
	if checked := checkRestarted(t, c, points, r.Involute.Restarts, offset); checked < 40 {
		t.Fatalf("only %d samples checked", checked)
	}
	for i, p := range plain.Involute.Members[0].Points {
		if p != nil && !reflect.DeepEqual(p, points[i]) {
			t.Fatalf("sample %d on the anchor's stretch changed", i)
		}
	}
	// A string at every representative sample now, not only where the
	// anchor's arc length reached.
	if len(r.Involute.Strings) <= len(plain.Involute.Strings) {
		t.Fatalf("%d strings with restart, %d without", len(r.Involute.Strings), len(plain.Involute.Strings))
	}
}

// Reached samples on either side of a break are valid filament endpoints,
// even though the interval between them has no filament point.
func TestRestartedInvoluteProbeMatchesBreakEndpoints(t *testing.T) {
	// At 497 samples the first knot after the cusp normalizes just below
	// its integer index, so interval selection must allow for rounding.
	for _, samples := range []int{480, 481, 497} {
		c := involuteStudy("t^2", "t^3", "0", -1, 1.0005, 0.5, 0.3)
		c.Samples, c.Involute.Restart = samples, true
		c.Involute.Family = InvoluteFamily{Enabled: true, From: -0.2, To: 0.3, Count: 3}
		r := involute(t, c)
		var endpoints []int
		breaks := 0
		for i := 1; i <= samples; i++ {
			if r.Breaks[i] {
				endpoints = append(endpoints, i-1, i)
				breaks++
			}
		}
		if breaks == 0 {
			t.Fatal("the cusp should break the curve")
		}
		endpoints = append(endpoints, 0, samples)
		for _, i := range endpoints {
			u := knotAt(c, c.Curve.Min, c.Curve.Max, i)
			_, p := curveProbe(t, c, ProbeQuery{T: &u})
			if len(p.Members) != len(r.Involute.Members) {
				t.Fatalf("%d samples, endpoint %d: missing probe members", samples, i)
			}
			for m, member := range r.Involute.Members {
				if member.Points[i] == nil {
					t.Fatalf("%d samples, endpoint %d: expected a reached sample", samples, i)
				}
				sameVec(t, "filament at a reached endpoint", p.Members[m], member.Points[i])
			}
		}
	}
}

// Between samples a restarted member is never carried across the break
// between two stretches, whose arc lengths are measured from different
// anchors: the probe has no filament point there, while it has one on
// either side.
func TestRestartedInvoluteIsNotCarriedAcrossItsBreak(t *testing.T) {
	// The semicubical parabola (t², t³) turns back at t = 0, between
	// samples, where the curve is defined but the base breaks.
	cusp := involuteStudy("t^2", "t^3", "0", -1, 1.0005, 0.5, 0.3)
	cusp.Involute.Restart = true
	hc := 2.0005 / float64(cusp.Samples)
	k := int(math.Floor(1 / hc))
	r, p := curveProbe(t, cusp, ProbeQuery{T: ptr(at(cusp, k) + 0.3*hc)})
	members := r.Involute.Members[0].Points
	if !r.Breaks[k+1] || members[k] == nil || members[k+1] == nil {
		t.Fatal("the cusp should break the curve between two reached samples")
	}
	if len(p.Members) != 1 || p.Members[0] != nil {
		t.Fatalf("a filament point across the break: %+v", p.Members)
	}
	for _, u := range []float64{at(cusp, k-3) + 0.4*hc, at(cusp, k+4) + 0.4*hc} {
		if _, q := curveProbe(t, cusp, ProbeQuery{T: &u}); len(q.Members) != 1 || q.Members[0] == nil {
			t.Fatalf("no filament point at %g", u)
		}
	}
	c := involuteStudy("tan(t)", "cos(t)", "sin(t)", -2, 2, 0.5, 0.3)
	c.Samples, c.Involute.Restart = 481, true
	h := 4.0 / float64(c.Samples)
	// Refinement continues each stretch on its own and draws nothing
	// across the break.
	refined := refinedStudy(t, c)
	path := refined.Adaptive.Involute[0]
	checkPath(t, path, refined.Involute.Members[0].Points, refined.Breaks)
	past := 0
	for k, q := range path.Points {
		if q != nil && path.At[k] != math.Trunc(path.At[k]) && math.Abs(at(c, 0)+path.At[k]*h) > math.Pi/2 {
			past++
		}
	}
	if past == 0 {
		t.Fatal("no refinement past the asymptotes")
	}
}

// The involute input restarts the same way: the base past each asymptote
// is unwound from an anchor of its own, and each stretch's string runs out
// once, so there are three cusps rather than one and nothing unreached.
func TestInvoluteInputRestartsAfterABreak(t *testing.T) {
	const anchor, offset = 0.5, 0.3
	c := unwound(custom("tan(t)", "cos(t)", "sin(t)", -2, 2), anchor, offset)
	c.Samples, c.Construction = 481, "developable"
	plain := composed(t, c)
	if plain.Composition.Restarts != nil {
		t.Fatal("restarts without restart")
	}
	c.Unwinding.Restart = true
	r := composed(t, c)
	if r.Composition.Unreached != 0 || r.Composition.Cusps != 3 {
		t.Fatalf("%d unreached, %d cusps", r.Composition.Unreached, r.Composition.Cusps)
	}
	anchors := r.Composition.Restarts
	if len(anchors) != 2 || !(anchors[0] < -math.Pi/2) || !(anchors[1] > math.Pi/2) {
		t.Fatalf("restarts %v, want one beyond each asymptote", anchors)
	}
	checked := 0
	for i, p := range r.Base {
		u := at(c, i)
		if math.Abs(u) < math.Pi/2+0.2 {
			if plain.Base[i] != nil && !reflect.DeepEqual(p, plain.Base[i]) {
				t.Fatalf("sample %d on the anchor's stretch changed", i)
			}
			continue
		}
		from := anchors[0]
		if u > 0 {
			from = anchors[1]
		}
		// The input stops only at its cusp, where the string runs out.
		if p == nil {
			if math.Abs(tanArc(from, u)-offset) > 0.1 {
				t.Fatalf("sample %d at t = %g missing", i, u)
			}
			continue
		}
		near(t, p, tanInvolute(u, from, offset), 1e-7)
		checked++
	}
	if checked < 40 {
		t.Fatalf("only %d samples checked", checked)
	}
	// The semicubical parabola's other side, past its cusp at t = 0, is
	// unwound too.
	cusp := unwound(custom("t^2", "t^3", "0", -1, 1.0005), 0.5, 0.3)
	cusp.Construction, cusp.Unwinding.Restart = "developable", true
	q := composed(t, cusp)
	if q.Composition.Unreached != 0 || len(q.Composition.Restarts) != 1 || !(q.Composition.Restarts[0] < 0) {
		t.Fatalf("%d unreached, restarts %v", q.Composition.Unreached, q.Composition.Restarts)
	}
}
