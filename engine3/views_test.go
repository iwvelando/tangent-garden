package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// A flight's piece: several views, the frames of a stretch of a camera
// flight, each refining what it shows to its own scale. Expectations come
// from each view's geometry, as in view_test.go.

func flown(c Request, views ...View) Request {
	c.Adaptive = true
	c.Views = views
	return c
}

// Two orthographic windows on a trefoil, a narrow one looking down −z and
// a ten times wider one looking along −y: the chords each shows follow the
// knot to its own tolerance, and the wide window's are not refined to the
// narrow one's.
func TestViewsRefineEachToItsOwnScale(t *testing.T) {
	c := study()
	c.Samples = 240
	c.Construction = "none"
	curve := func(u float64) Vec3 { return trefoilAt(c, u) }
	narrow := orthographic(curve(1), 0.03, 0.02)
	wide := View{Center: curve(4), Right: Vec3{1, 0, 0}, Up: Vec3{0, 0, 1}, Width: 0.3, Height: 0.2}
	r := refinedStudy(t, flown(c, narrow, wide))
	path := r.Adaptive.Base
	checkPath(t, path, r.Base, r.Breaks)
	if path.Exhausted || path.Unresolved != 0 || path.Breaks != 0 {
		t.Fatalf("exhausted %v, unresolved %d, breaks %d", path.Exhausted, path.Unresolved, path.Breaks)
	}
	ts := parameters(path, 0, 2*math.Pi, c.Samples)
	for name, v := range map[string]View{"narrow": narrow, "wide": wide} {
		r0 := math.Hypot(v.Width, v.Height)
		inView, _, longest, shown := viewChords(path.Points, ts, curve, v, 2e-4*r0, r0/4)
		if inView > 1.5 || longest > 1 || shown < 8 {
			t.Fatalf("%s: %d chords in view stray %g of its tolerances and reach %g of its chord limit", name, shown, inView, longest)
		}
	}
	// The finest tolerance used is the narrow window's.
	if want := 2e-4 * math.Hypot(narrow.Width, narrow.Height); math.Abs(path.View-want) > 1e-15 {
		t.Fatalf("finest view tolerance %g, want %g", path.View, want)
	}
	// In the wide window, far from the narrow one, chords keep the wide
	// window's own, coarser, tolerance.
	alone := wide
	alone.Width, alone.Height = 0.05, 0.05
	narrowTolerance := 2e-4 * math.Hypot(narrow.Width, narrow.Height)
	if e, _, _, shown := viewChords(path.Points, ts, curve, alone, narrowTolerance, math.Inf(1)); shown == 0 || e < 3 {
		t.Fatalf("the wide window's chords stray only %g of the narrow one's tolerance (%d shown)", e, shown)
	}
	// So in either order.
	reversed := refinedStudy(t, flown(c, wide, narrow)).Adaptive.Base
	if a, b := reversed.Points, path.Points; len(a) != len(b) || reversed.View != path.View {
		t.Fatalf("reversed, %d points refined to %g; in order, %d to %g", len(a), reversed.View, len(b), path.View)
	}
	// Each view alone refines no more finely in its own window.
	for name, v := range map[string]View{"narrow": narrow, "wide": wide} {
		one := refinedStudy(t, viewed(c, v)).Adaptive.Base
		r0 := math.Hypot(v.Width, v.Height)
		got, _, _, _ := viewChords(path.Points, ts, curve, v, 2e-4*r0, r0/4)
		if one.Inserted > path.Inserted || !(got <= 1.5) {
			t.Fatalf("%s: alone it inserts %d, with both %d", name, one.Inserted, path.Inserted)
		}
	}
	if !sameStudy(t, r, refinedStudy(t, c)) {
		t.Fatal("the views changed the rest of the result")
	}
}

// Two perspectives looking down a thin helix toward −z from eyes 12 units
// apart: each chord is refined to the finer of the two views' tolerances
// at its depth from each eye, so the turns just ahead of the far eye,
// small in the near view, are refined as finely as the near eye's own.
func TestViewsTakeEachEyesDepth(t *testing.T) {
	c := custom("0.05*sin(30*t)", "0.05*cos(30*t)", "t-20", 0, 20)
	c.Construction = "none"
	c.Samples = 2400
	curve := func(u float64) Vec3 { return Vec3{0.05 * math.Sin(30*u), 0.05 * math.Cos(30*u), u - 20} }
	near := View{Center: Vec3{}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: 0.1, Height: 0.1, Distance: 1, Near: 0.01}
	far := near
	far.Center = Vec3{0, 0, -12}
	r := refinedStudy(t, flown(c, near, far))
	path := r.Adaptive.Base
	checkPath(t, path, r.Base, r.Breaks)
	r0 := math.Hypot(near.Width, near.Height)
	tolerance := 2e-4 * r0
	ts := parameters(path, 0, 20, c.Samples)
	for name, v := range map[string]View{"near": near, "far": far} {
		inView, _, longest, shown := viewChords(path.Points, ts, curve, v, tolerance, r0/4)
		if inView > 1.5 || longest > 1 || shown < 500 {
			t.Fatalf("%s: %d chords stray %g view tolerances at their depth and reach %g of the chord limit", name, shown, inView, longest)
		}
	}
	// Half a unit ahead of the far view's plane, 1.5 units from its eye
	// (at z = −11) and 13.5 from the near one's, chords follow the curve
	// to the far view's tolerance there; the near view alone leaves them
	// well beyond it.
	ahead := func(path *RefinedPath) float64 {
		ts := parameters(path, 0, 20, c.Samples)
		worst := 0.0
		for k := 1; k < len(path.Points); k++ {
			if ts[k-1] < 7.4 || ts[k] > 7.6 {
				continue
			}
			for j := 1; j < 32; j++ {
				p := curve(ts[k-1] + (ts[k]-ts[k-1])*float64(j)/32)
				worst = math.Max(worst, distanceToSegment(p, *path.Points[k-1], *path.Points[k]))
			}
		}
		return worst / (1.5 * tolerance)
	}
	both, one := ahead(path), ahead(refinedStudy(t, viewed(c, near)).Adaptive.Base)
	if both > 1.5 || one < 2 {
		t.Fatalf("near the far eye, chords stray %g of its tolerance with both views and %g with the near one alone", both, one)
	}
}

// A piece of one view is that view, to the byte, orthographic or in
// perspective.
func TestViewsOfOneAreTheView(t *testing.T) {
	trefoil := study()
	trefoil.Construction = "none"
	helix := custom("0.05*sin(30*t)", "0.05*cos(30*t)", "t-20", 0, 20)
	helix.Construction = "none"
	for name, c := range map[string]struct {
		study Request
		view  View
	}{
		"orthographic": {trefoil, orthographic(trefoilAt(trefoil, 1), 0.03, 0.02)},
		"perspective":  {helix, View{Center: Vec3{}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: 0.1, Height: 0.1, Distance: 1, Near: 0.01}},
	} {
		want, _ := json.Marshal(refinedStudy(t, viewed(c.study, c.view)))
		got, _ := json.Marshal(refinedStudy(t, flown(c.study, c.view)))
		if string(got) != string(want) {
			t.Fatalf("%s: a piece of one view differs from the view", name)
		}
	}
}

// A study is refined to one view or to a piece's views, never both; a
// piece has at most maxViews, each a frame of the page.
func TestViewsRefuseWhatIsNotAPiece(t *testing.T) {
	good := orthographic(Vec3{}, 0.1, 0.1)
	many := make([]View, maxViews+1)
	for k := range many {
		many[k] = good
	}
	if _, err := Compute(flown(study(), many[:maxViews]...)); err != nil {
		t.Fatal(err)
	}
	both := flown(study(), good)
	both.View = &good
	bad := good
	bad.Width = 0
	for name, c := range map[string]Request{
		"both":    both,
		"many":    flown(study(), many...),
		"invalid": flown(study(), good, bad),
	} {
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "view") {
			t.Fatalf("%s: %v", name, err)
		}
	}
}

// A piece's own tests of a piece of curve, on boxes placed by hand: two
// orthographic pages about the origin and about (1, 0, 0), the second
// twice as large, 0.2 and 0.4 wide with their margins. A box meets the
// piece when it, grown, meets either margin, and is scaled to the finest
// view it meets, grown alike: the second's, twice the first's.
func TestViewsPlacePieces(t *testing.T) {
	f := viewsFocus([]View{orthographic(Vec3{}, 0.1, 0.1), orthographic(Vec3{X: 1}, 0.2, 0.2)})
	box := func(points ...Vec3) []*Vec3 {
		out := make([]*Vec3, len(points))
		for k := range points {
			out[k] = &points[k]
		}
		return out
	}
	// 0.01 beyond the second view's margin, far from the first.
	beyond := box(Vec3{1.41, 0, 5}, Vec3{1.45, 0.01, -5})
	if f.Meets(beyond, 0.009) || !f.Meets(beyond, 0.011) {
		t.Fatal("a box 0.01 beyond the second view's margin, grown by 0.009 and 0.011")
	}
	if got := f.Scale(beyond, 0.011); got != 2 {
		t.Fatalf("grown into the second view, scale %g, want 2", got)
	}
	// In both, the first's.
	if got := f.Scale(box(Vec3{0.1, 0, 0}, Vec3{0.65, 0, 0}), 0); got != 1 {
		t.Fatalf("in both views, scale %g, want 1", got)
	}
}

// Wheels within wheels, the flight's preset, is a smooth closed curve that
// never stops: four circles whose speeds, 3, 6, 12 and 24, never cancel.
// It is sampled finely enough that no turn between samples is taken for a
// cusp, so it is drawn unbroken, uniformly and refined.
func TestWheelsWithinWheelsRunUnbroken(t *testing.T) {
	c, ok := spatialPresets(t)["Wheels within wheels"]
	if !ok {
		t.Fatal("no preset Wheels within wheels")
	}
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	for i, broken := range r.Breaks {
		if broken {
			t.Fatalf("broken before sample %d", i)
		}
	}
	for _, p := range r.Adaptive.Base.Points {
		if p == nil {
			t.Fatal("the refined curve is broken")
		}
	}
	// Its slowest point, found finely, still moves.
	slowest := math.Inf(1)
	for i := 0; i < 1_000_000; i++ {
		u := 2 * math.Pi * float64(i) / 1_000_000
		var v Vec3
		for _, term := range c.Harmonic.Terms {
			w := term.Frequency
			v = v.add(term.Cosine.mul(-w * math.Sin(w*u))).add(term.Sine.mul(w * math.Cos(w*u)))
		}
		slowest = math.Min(slowest, v.norm())
	}
	if slowest < 1 {
		t.Fatalf("the curve slows to %g", slowest)
	}
}
