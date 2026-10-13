package engine

import (
	"encoding/json"
	"math"
	"testing"
)

// Refinement to the view: with a view, the pieces of each refined curve
// that meet it are refined to a tolerance of the view's own size.
// Expectations come from closed forms evaluated here.

func focused(q Request, v View) Request {
	q.Adaptive = true
	q.View = &v
	return q
}

// halfDiagonal is half the diagonal of a view.
func halfDiagonal(v View) float64 { return math.Hypot(v.X1-v.X0, v.Y1-v.Y0) / 2 }

// chordsInView measures a refined path's chords against the exact curve at
// 32 parameters inside each: the largest error of the chords that meet the
// view, by their end points' box or by the curve between them, the largest
// of all chords, and the longest chord meeting the view.
func chordsInView(points []*Vec, ts []float64, exact func(float64) Vec, v View) (inView, all, longest float64) {
	inside := func(p Vec) bool { return p.X >= v.X0 && p.X <= v.X1 && p.Y >= v.Y0 && p.Y <= v.Y1 }
	for k := 1; k < len(points); k++ {
		a, b := points[k-1], points[k]
		if a == nil || b == nil {
			continue
		}
		meets := math.Min(a.X, b.X) <= v.X1 && math.Max(a.X, b.X) >= v.X0 &&
			math.Min(a.Y, b.Y) <= v.Y1 && math.Max(a.Y, b.Y) >= v.Y0
		worst := 0.0
		for j := 1; j < 32; j++ {
			p := exact(ts[k-1] + (ts[k]-ts[k-1])*float64(j)/32)
			worst = math.Max(worst, distanceToSegment(p, *a, *b))
			meets = meets || inside(p)
		}
		all = math.Max(all, worst)
		if meets {
			inView = math.Max(inView, worst)
			longest = math.Max(longest, b.Sub(*a).Norm())
		}
	}
	return inView, all, longest
}

// A small view on the aliased coil, about 1/16 of the study's tolerance:
// the chords there follow the coil to the view's tolerance, and the rest to
// the study's.
func TestViewRefinesWhatItShows(t *testing.T) {
	q := coilRequest()
	v := View{X0: 0.95, Y0: -0.04, X1: 1.05, Y1: 0.04}
	r := compute(t, focused(q, v))
	path := r.Adaptive.Base
	checkUniform(t, path, r.Base)
	want := 2e-4 * halfDiagonal(v)
	if math.Abs(path.View-want) > 1e-12 {
		t.Fatalf("view tolerance %g, want %g", path.View, want)
	}
	if path.View > path.Tolerance/10 {
		t.Fatalf("view tolerance %g is not well below the study's %g", path.View, path.Tolerance)
	}
	if path.Exhausted || path.Unresolved != 0 || path.Breaks != 0 {
		t.Fatalf("exhausted %v, unresolved %d, breaks %d", path.Exhausted, path.Unresolved, path.Breaks)
	}
	inView, all, longest := chordsInView(path.Points, positions(q, path), coil(1), v)
	if inView > 1.5*path.View {
		t.Fatalf("chord error in view %g exceeds %g", inView, path.View)
	}
	if all > 1.5*path.Tolerance {
		t.Fatalf("chord error %g exceeds the study's tolerance %g", all, path.Tolerance)
	}
	if longest > halfDiagonal(v)/4 {
		t.Fatalf("a chord in view is %g long, over a quarter of the half diagonal %g", longest, halfDiagonal(v))
	}
	// So is the margin of half the view's width and height on each side,
	// which a wider panel or a short pan shows.
	margin := View{X0: 0.9, Y0: -0.08, X1: 1.1, Y1: 0.08}
	if e, _, _ := chordsInView(path.Points, positions(q, path), coil(1), margin); e > 1.5*path.View {
		t.Fatalf("chord error in the view's margin %g exceeds %g", e, path.View)
	}
	// Without the view, the chords there stray far beyond its tolerance.
	plain := compute(t, adaptive(q))
	if plain.Adaptive.Base.View != 0 {
		t.Fatal("refined to a view without one")
	}
	if e, _, _ := chordsInView(plain.Adaptive.Base.Points, positions(q, plain.Adaptive.Base), coil(1), v); e < 3*path.View {
		t.Fatalf("the study's refinement already follows the view: error %g", e)
	}
	// Nothing else in the result changes.
	r.Adaptive, plain.Adaptive = nil, nil
	a, _ := json.Marshal(r)
	b, _ := json.Marshal(plain)
	if string(a) != string(b) {
		t.Fatal("the view changed the rest of the result")
	}
}

// A straight line has no chord to refine, but in view its chords are cut
// shorter than a quarter of the view's half diagonal, so a drawing that
// breaks a chord crossing much of the page never breaks the line. The view
// lies between two samples, beyond its margin from both, and meets only
// what the curve does between them.
func TestViewShortensLongChords(t *testing.T) {
	q := request("evolute", "t", "0.5*t", -1, 1)
	q.Samples = 64
	plain := compute(t, adaptive(q)).Adaptive.Base
	if plain.Inserted != 0 {
		t.Fatalf("a straight line refined with %d points", plain.Inserted)
	}
	// Samples 31 and 32 lie at t = ∓1/63; the view is 0.002 wide about
	// t = 0.003.
	v := View{X0: 0.002, Y0: 0.0005, X1: 0.004, Y1: 0.0025}
	r := compute(t, focused(q, v))
	path := r.Adaptive.Base
	checkUniform(t, path, r.Base)
	exact := func(t float64) Vec { return Vec{t, 0.5 * t} }
	inView, _, longest := chordsInView(path.Points, positions(q, path), exact, v)
	if longest == 0 || longest > halfDiagonal(v)/4 || inView > 1e-12 {
		t.Fatalf("the longest chord in view is %g, over a quarter of the half diagonal %g, or strays %g", longest, halfDiagonal(v), inView)
	}
	if path.Breaks != 0 || path.Unresolved != 0 {
		t.Fatalf("breaks %d, unresolved %d", path.Breaks, path.Unresolved)
	}
}

// What the study's tolerance leaves out, a view finer than it shows. A
// ripple of amplitude 10⁻⁴, half the study's tolerance, with every sample
// on its axis: a view on one of its troughs meets the probes there and
// none of the samples, so a piece is judged by its probes as well as its
// ends. And a bump of height 1.5 × 10⁻⁴ narrower than a quarter interval,
// between an interval's quarter point and its midpoint, which only the
// scan's probes meet: in a view whose tolerance is below it, but whose
// chords may still span a sample step, the scan looks for it at the
// view's tolerance.
func TestViewSeesBelowTheStudysTolerance(t *testing.T) {
	for _, c := range []struct {
		name, y   string
		amplitude float64
		exact     func(float64) float64
		view      View
	}{
		{"ripple", "1e-4*sin(63*pi*t)", 1e-4, func(t float64) float64 { return 1e-4 * math.Sin(63*math.Pi*t) },
			// A trough at t = 0.27778, between samples 40 and 41.
			View{X0: 0.27578, Y0: -1.1e-4, X1: 0.27978, Y1: -0.9e-4}},
		{"bump", "0.5*t + 1.5e-4*exp(-((t - 0.2817)/0.0008)^2)", 1.5e-4, func(t float64) float64 {
			return 0.5*t + 1.5e-4*math.Exp(-math.Pow((t-0.2817)/0.0008, 2))
		}, View{X0: 0.0817, Y0: -0.08, X1: 0.4817, Y1: 0.36}},
	} {
		q := request("evolute", "t", c.y, -1, 1)
		q.Samples = 64
		exact := func(t float64) Vec { return Vec{t, c.exact(t)} }
		plain := compute(t, adaptive(q)).Adaptive.Base
		if e, _, _ := chordsInView(plain.Points, positions(q, plain), exact, c.view); e < c.amplitude/2 || c.amplitude > plain.Tolerance {
			t.Fatalf("%s: the study's refinement already follows it: error %g, tolerance %g", c.name, e, plain.Tolerance)
		}
		r := compute(t, focused(q, c.view))
		path := r.Adaptive.Base
		checkUniform(t, path, r.Base)
		if e, _, _ := chordsInView(path.Points, positions(q, path), exact, c.view); e > 1.5*path.View {
			t.Fatalf("%s: chord error in view %g exceeds %g", c.name, e, path.View)
		}
	}
}

// A view no finer than the study's tolerance changes nothing at all.
func TestCoarseViewChangesNothing(t *testing.T) {
	q := coilRequest()
	for _, v := range []View{
		{X0: -10, Y0: -10, X1: 10, Y1: 10},
		{X0: -1.1, Y0: -1.1, X1: 1.1, Y1: 1.1},
	} {
		a, _ := json.Marshal(compute(t, focused(q, v)))
		b, _ := json.Marshal(compute(t, adaptive(q)))
		if string(a) != string(b) {
			t.Fatalf("view %v changed the study", v)
		}
	}
}

// A view without refinement, or on a format that is not refined, changes
// nothing either.
func TestViewWithoutRefinementChangesNothing(t *testing.T) {
	v := View{X0: 0.95, Y0: -0.04, X1: 1.05, Y1: 0.04}
	q := coilRequest()
	withView := q
	withView.View = &v
	a, _ := json.Marshal(compute(t, withView))
	b, _ := json.Marshal(compute(t, q))
	if string(a) != string(b) {
		t.Fatal("a view changed an unrefined study")
	}
}

// A curve too long for the budget: the unit circle traced 300 times in
// 20,000 samples, whose chords each stray about five tolerances from it.
// The study's tolerance asks for more points than the budget holds, but the
// budget goes first to what the view shows.
func TestViewTakesTheBudgetFirst(t *testing.T) {
	q := request("evolute", "cos(t)", "sin(t)", 0, 600*math.Pi)
	q.Samples = 20000
	exact := func(t float64) Vec { return Vec{math.Cos(t), math.Sin(t)} }
	plain := compute(t, adaptive(q)).Adaptive.Base
	if !plain.Exhausted {
		t.Fatal("the study's refinement fits in the budget; the test needs a longer curve")
	}
	v := View{X0: 0.98, Y0: -0.1, X1: 1.02, Y1: 0.1}
	r := compute(t, focused(q, v))
	path := r.Adaptive.Base
	checkUniform(t, path, r.Base)
	if !path.Exhausted || path.View == 0 {
		t.Fatalf("exhausted %v, view tolerance %g", path.Exhausted, path.View)
	}
	inView, _, longest := chordsInView(path.Points, positions(q, path), exact, v)
	if inView > 1.5*path.View || longest > halfDiagonal(v)/4 {
		t.Fatalf("chord error in view %g exceeds %g, or a chord is %g long", inView, path.View, longest)
	}
	if e, _, _ := chordsInView(plain.Points, positions(q, plain), exact, v); e < 3*path.View {
		t.Fatalf("the study's refinement already follows the view: error %g", e)
	}
}

// A derived curve is refined to the view too: an ellipse's evolute,
// ((a² − b²)/a cos³ t, (b² − a²)/b sin³ t), about its cusp at (1.5, 0).
func TestViewRefinesADerivedCurve(t *testing.T) {
	q := request("evolute", "2*cos(t)", "sin(t)", 0, 2*math.Pi)
	q.Samples = 200
	v := View{X0: 1.3, Y0: -0.06, X1: 1.6, Y1: 0.06}
	r := compute(t, focused(q, v))
	path := r.Adaptive.Derived
	checkUniform(t, path, r.Derived)
	if path.View == 0 || path.View > path.Tolerance/5 {
		t.Fatalf("view tolerance %g, study's %g", path.View, path.Tolerance)
	}
	exact := func(t float64) Vec {
		c, s := math.Cos(t), math.Sin(t)
		return Vec{1.5 * c * c * c, -3 * s * s * s}
	}
	inView, all, _ := chordsInView(path.Points, positions(q, path), exact, v)
	if inView > 1.5*path.View || all > 1.5*path.Tolerance {
		t.Fatalf("chord error %g in view (tolerance %g), %g in all (%g)", inView, path.View, all, path.Tolerance)
	}
}

// Breaks do not depend on the view: a pole between samples is broken once,
// with a view beside it or not, and the pedal curve built on it stays
// broken there. A tiny view on the branch beside the pole, where the curve
// runs so fast that its chords there are long even at the finest step,
// refines it without breaking it.
func TestViewKeepsTheBreaks(t *testing.T) {
	q := request("pedal", "t", "1/(t - 0.0131)", -1, 1)
	q.Samples, q.Pole = 64, Vec{0.5, 0.5}
	plain := compute(t, adaptive(q))
	for _, v := range []View{
		{X0: 0.15, Y0: 5, X1: 0.2, Y1: 6},
		{X0: 0.0141, Y0: 995, X1: 0.01411, Y1: 1001},
	} {
		r := compute(t, focused(q, v))
		if r.Adaptive.Base.View == 0 {
			t.Fatalf("view %v is no finer than the study", v)
		}
		sameBreaks(t, r.Adaptive, plain.Adaptive)
	}
}

func sameBreaks(t *testing.T, r, plain *AdaptiveResult) {
	t.Helper()
	gaps := func(p *RefinedPath) (out []int) {
		for k, q := range p.Points {
			if q == nil {
				out = append(out, int(p.At[k]))
			}
		}
		return out
	}
	for _, pair := range [][2]*RefinedPath{{r.Base, plain.Base}, {r.Derived, plain.Derived}} {
		a, b := gaps(pair[0]), gaps(pair[1])
		if len(a) != len(b) || pair[0].Breaks != pair[1].Breaks {
			t.Fatalf("breaks %v with the view, %v without", a, b)
		}
		for k := range a {
			if a[k] != b[k] {
				t.Fatalf("breaks %v with the view, %v without", a, b)
			}
		}
	}
}

func TestViewMustBeAFiniteRectangle(t *testing.T) {
	for _, v := range []View{
		{X0: 0, Y0: 0, X1: 0, Y1: 1},
		{X0: 0, Y0: 1, X1: 1, Y1: 0},
		{X0: math.Inf(-1), Y0: 0, X1: 1, Y1: 1},
		{X0: 0, Y0: 0, X1: 1, Y1: math.NaN()},
	} {
		if _, err := Compute(focused(coilRequest(), v)); err == nil {
			t.Fatalf("view %v accepted", v)
		}
	}
}

// A view can give the half diagonal its tolerance is a fraction of: a
// rectangle covering several views, as a camera path's piece does, is
// refined as finely as the smallest of them.
func TestViewRadiusSetsTheTolerance(t *testing.T) {
	q := coilRequest()
	v := View{X0: 0.9, Y0: -0.1, X1: 1.1, Y1: 0.1, Radius: 0.01}
	r := compute(t, focused(q, v))
	path := r.Adaptive.Base
	if math.Abs(path.View-2e-4*0.01) > 1e-15 {
		t.Fatalf("view tolerance %g, want %g", path.View, 2e-4*0.01)
	}
	inView, _, longest := chordsInView(path.Points, positions(q, path), coil(1), v)
	if inView > 1.5*path.View || longest > 0.01/4 {
		t.Fatalf("chord error in view %g exceeds %g, or a chord is %g long", inView, path.View, longest)
	}
	// Without it, the rectangle's own half diagonal.
	v.Radius = 0
	if own := compute(t, focused(q, v)).Adaptive.Base.View; math.Abs(own-2e-4*halfDiagonal(v)) > 1e-15 {
		t.Fatalf("view tolerance %g, want the rectangle's own", own)
	}
	for _, bad := range []float64{-1, math.NaN(), math.Inf(1)} {
		v.Radius = bad
		if _, err := Compute(focused(q, v)); err == nil {
			t.Fatalf("radius %g accepted", bad)
		}
	}
}
