package engine3

import (
	"math"
	"reflect"
	"testing"
)

// refinedPartner computes a ruled study uniformly and refined, checks the
// refined partner thread against the uniform thread and its breaks, and
// returns both studies.
func refinedPartner(t *testing.T, c Request) (Result, Result, *RefinedPath) {
	t.Helper()
	uniform := ruled(t, c)
	r := refinedStudy(t, c)
	path := r.Adaptive.Partner
	if path == nil {
		t.Fatal("the partner thread is not refined")
	}
	checkPath(t, path, uniform.Plus, uniform.Ruled.Breaks)
	return uniform, r, path
}

// A unit ring at z = −1 joined to a ring of radius 3 at z = 1 run thirty
// times as fast: the thread b(30t + δ) = 3(cos(30t + δ), sin(30t + δ)) + e_z
// turns once every eight samples. Refined, every point lies on the ring and
// every chord within tolerance of it, the tolerance follows the thread's own
// size, the study is otherwise unchanged, and the surface still closes.
func TestRefinedPartnerThreadOnARing(t *testing.T) {
	delta := 0.7
	c := threaded(ring(-1), "3*cos(t)", "3*sin(t)", "1", 30, delta)
	c.Samples = 240
	uniform, r, path := refinedPartner(t, c)
	refined := r.Adaptive
	r.Adaptive = nil
	if !reflect.DeepEqual(r, uniform) {
		t.Fatal("refining the partner thread changed the study")
	}
	if refined.Base == nil || !r.Ruled.Closed {
		t.Fatalf("base refined %v, closed %v", refined.Base != nil, r.Ruled.Closed)
	}
	if path.Tolerance < 2*refined.Base.Tolerance {
		t.Fatalf("tolerance %g for a thread three times the base's size, base %g", path.Tolerance, refined.Base.Tolerance)
	}
	curve := func(u float64) Vec3 { return Vec3{3 * math.Cos(30*u+delta), 3 * math.Sin(30*u+delta), 1} }
	for j, p := range path.Points {
		near(t, p, curve(2*math.Pi*path.At[j]/float64(c.Samples)), 1e-9)
	}
	coarse := chordError(r.Plus, uniformAt(c.Samples), curve, 0, 2*math.Pi, c.Samples)
	fine := chordError(path.Points, path.At, curve, 0, 2*math.Pi, c.Samples)
	if coarse < 4*path.Tolerance || fine > 1.5*path.Tolerance || path.Unresolved != 0 || path.Breaks != 0 || path.Inserted == 0 {
		t.Fatalf("uniform error %g, refined %g, tolerance %g, %+v", coarse, fine, path.Tolerance, *path)
	}
}

// Chords of the (2, 3) torus knot to the point five times as far round:
// the partner is the knot itself at 5t + δ, wrapped round its period, and
// every refined point lies on the knot there.
func TestRefinedChordPartnerWraps(t *testing.T) {
	c := chords(study(), 5, 0.4)
	c.Samples = 240
	_, r, path := refinedPartner(t, c)
	if !r.Ruled.Closed || path.Inserted == 0 || path.Unresolved != 0 || path.Breaks != 0 {
		t.Fatalf("closed %v, %+v", r.Ruled.Closed, *path)
	}
	for j, p := range path.Points {
		u := 2 * math.Pi * path.At[j] / float64(c.Samples)
		want, _, _ := knot(c, 5*u+0.4)
		near(t, p, want, 1e-9)
	}
	curve := func(u float64) Vec3 { p, _, _ := knot(c, 5*u+0.4); return p }
	if fine := chordError(path.Points, path.At, curve, 0, 2*math.Pi, c.Samples); fine > 1.5*path.Tolerance {
		t.Fatalf("refined error %g, tolerance %g", fine, path.Tolerance)
	}
}

// On an open helix, chords to the point at 2t run off the domain halfway:
// nothing is refined beyond the last chord, and the thread is not
// continued past where the samples stop.
func TestRefinedChordPartnerStopsAtTheDomain(t *testing.T) {
	c := chords(custom("2*cos(t)", "2*sin(t)", "t/3", 0, 4*math.Pi), 2, 0.05)
	c.Samples = 240
	uniform, _, path := refinedPartner(t, c)
	if uniform.Ruled.Outside == 0 {
		t.Fatal("the chords never leave the domain")
	}
	last := 0.0
	for j, p := range path.Points {
		if p != nil {
			last = path.At[j]
		}
	}
	// φ(t) = 2t + 0.05 reaches 4π at t = 2π − 0.025, inside interval 119.
	if last > 120 || last < 119 || path.Inserted == 0 {
		t.Fatalf("last refined point at %g, %+v", last, *path)
	}
}

// A thread undefined on a window narrower than a quarter interval, between
// a sample and the interval's midpoint, passes the uniform study's tests;
// refinement finds it, and no face is drawn across it.
func TestRefinedPartnerBreaksTheSurface(t *testing.T) {
	c := threaded(custom("t", "0", "0", 0, 2), "t", "1", "1+0*sqrt((t-1.00104)^2-0.00000009)", 1, 0)
	uniform, r, path := refinedPartner(t, c)
	crack := 241
	if uniform.Ruled.Breaks[crack] || uniform.Omitted != 0 {
		t.Fatalf("the uniform study already breaks: omitted %d", uniform.Omitted)
	}
	if path.Breaks != 1 || !r.Ruled.Breaks[crack] || r.Breaks[crack] || r.Omitted != 1 {
		t.Fatalf("%+v; partner break %v, base break %v, omitted %d", *path, r.Ruled.Breaks[crack], r.Breaks[crack], r.Omitted)
	}
	for _, v := range corners(r.Mesh) {
		if v.SampleIndex == crack {
			t.Fatalf("face across the gap at %+v", v.Position)
		}
	}
	if len(corners(r.Mesh)) != len(corners(uniform.Mesh))-ruledStrips*6 {
		t.Fatalf("%d vertices, uniform %d", len(corners(r.Mesh)), len(corners(uniform.Mesh)))
	}
}

// A pole of the thread that the base does not share breaks the partner's
// samples; refinement inserts nothing across it, and the surface stays
// broken there and only there.
func TestRefinedPartnerKeepsItsPole(t *testing.T) {
	c := threaded(custom("t", "0", "0", 0, 2), "t", "1/(t-1.0021)", "1", 1, 0)
	uniform, r, path := refinedPartner(t, c)
	if !uniform.Ruled.Breaks[241] || uniform.Breaks[241] {
		t.Fatal("the uniform partner does not break at its pole alone")
	}
	if path.Breaks != 0 || !reflect.DeepEqual(r.Ruled.Breaks, uniform.Ruled.Breaks) || r.Omitted != uniform.Omitted {
		t.Fatalf("%d breaks found; omitted %d, uniform %d", path.Breaks, r.Omitted, uniform.Omitted)
	}
}

// Without refinement no partner path is computed.
func TestPartnerUnrefinedUnlessAsked(t *testing.T) {
	if r := ruled(t, threaded(ring(-1), "cos(t)", "sin(t)", "1", 30, 0)); r.Adaptive != nil {
		t.Fatal("refined without asking")
	}
}
