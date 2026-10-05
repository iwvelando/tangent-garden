package engine3

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
)

// The test's own torus knot, written independently of knot().
func trefoilAt(c Request, t float64) Vec3 {
	p, q := float64(c.P), float64(c.Q)
	h := c.Radius + c.Tube*math.Cos(q*t)
	return Vec3{h * math.Cos(p*t), h * math.Sin(p*t), c.Tube * math.Sin(q*t)}
}

func refinedStudy(t *testing.T, c Request) Result {
	t.Helper()
	c.Adaptive = true
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Adaptive == nil {
		t.Fatal("missing adaptive result")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	return r
}

// segmentDistance is the distance from p to the segment ab.
func distanceToSegment(p, a, b Vec3) float64 {
	d := b.sub(a)
	s := 0.0
	if l := d.dot(d); l > 0 {
		s = math.Max(0, math.Min(1, p.sub(a).dot(d)/l))
	}
	return p.sub(a.add(d.mul(s))).norm()
}

// chordError measures the largest distance between the true curve and the
// drawn chord joining consecutive drawn points, from 64 points of the curve
// on each chord's parameter span.
func chordError(points []*Vec3, at []float64, curve func(float64) Vec3, lo, hi float64, n int) float64 {
	worst := 0.0
	for k := 1; k < len(points); k++ {
		if points[k-1] == nil || points[k] == nil {
			continue
		}
		for j := 1; j < 64; j++ {
			u := at[k-1] + (at[k]-at[k-1])*float64(j)/64
			p := curve(lo + (hi-lo)*u/float64(n))
			worst = math.Max(worst, distanceToSegment(p, *points[k-1], *points[k]))
		}
	}
	return worst
}

func uniformAt(n int) []float64 {
	at := make([]float64, n+1)
	for i := range at {
		at[i] = float64(i)
	}
	return at
}

// checkPath asserts the refined path's shape: every uniform sample in place
// at its whole position, positions strictly increasing, and nothing inserted
// in an interval the uniform study breaks or leaves a gap at.
func checkPath(t *testing.T, path *RefinedPath, uniform []*Vec3, breaks []bool) {
	t.Helper()
	if len(path.Points) != len(path.At) {
		t.Fatal("points and positions differ in length")
	}
	n := len(uniform) - 1
	next := 0
	for k, u := range path.At {
		if k > 0 && !(u > path.At[k-1]) {
			t.Fatalf("positions not increasing at %d: %g after %g", k, u, path.At[k-1])
		}
		if u == math.Trunc(u) {
			i := int(u)
			if i != next {
				t.Fatalf("sample %d missing before position %g", next, u)
			}
			next++
			if (uniform[i] == nil) != (path.Points[k] == nil) || uniform[i] != nil && *uniform[i] != *path.Points[k] {
				t.Fatalf("sample %d moved", i)
			}
			continue
		}
		i := int(math.Floor(u))
		if uniform[i] == nil || uniform[i+1] == nil || breaks[i+1] {
			if path.Points[k] != nil {
				t.Fatalf("point inserted in broken interval %d", i)
			}
		}
	}
	if next != n+1 {
		t.Fatalf("%d of %d samples present", next, n+1)
	}
}

func TestUniformStudyHasNoRefinement(t *testing.T) {
	r, err := Compute(study())
	if err != nil {
		t.Fatal(err)
	}
	if r.Adaptive != nil {
		t.Fatal("refinement without being asked for")
	}
}

func TestRefinementKeepsTheUniformStudy(t *testing.T) {
	c := study()
	c.Samples = 240
	uniform, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	r := refinedStudy(t, c)
	refined := r.Adaptive
	r.Adaptive = nil
	if !reflect.DeepEqual(r, uniform) {
		t.Fatal("refining a smooth knot changed its study")
	}
	checkPath(t, refined.Base, uniform.Base, uniform.Breaks)
	if refined.Base.Inserted == 0 || refined.Base.Breaks != 0 || refined.Base.Exhausted || refined.Base.Unresolved != 0 {
		t.Fatalf("smooth knot: %+v", *refined.Base)
	}
	if refined.Parent != nil || refined.Projection != nil || refined.Image != nil {
		t.Fatal("paths refined that the study does not draw")
	}
}

func TestRefinedChordsFollowTheCurve(t *testing.T) {
	c := study()
	c.Samples = 240
	c.Construction = "none"
	r := refinedStudy(t, c)
	path := r.Adaptive.Base
	curve := func(u float64) Vec3 { return trefoilAt(c, u) }
	// The tolerance is a small fraction of the curve's own radius.
	if path.Tolerance <= 0 || path.Tolerance > 1e-3*r.Bounds.Radius {
		t.Fatalf("tolerance %g against radius %g", path.Tolerance, r.Bounds.Radius)
	}
	coarse := chordError(r.Base, uniformAt(c.Samples), curve, 0, 2*math.Pi, c.Samples)
	fine := chordError(path.Points, path.At, curve, 0, 2*math.Pi, c.Samples)
	if coarse < 2*path.Tolerance {
		t.Fatalf("uniform error %g is already within %g; the test needs a coarser study", coarse, path.Tolerance)
	}
	if fine > 1.5*path.Tolerance {
		t.Fatalf("refined error %g exceeds tolerance %g", fine, path.Tolerance)
	}
}

// refinePath on its own: halving the tolerance must keep the measured
// error under it, so the error converges with the tolerance.
func TestRefinementConvergesWithTolerance(t *testing.T) {
	c := study()
	n := 60
	curve := func(u float64) Vec3 { return trefoilAt(c, u) }
	uniform := make([]*Vec3, n+1)
	for i := range uniform {
		p := curve(2 * math.Pi * float64(i) / float64(n))
		uniform[i] = &p
	}
	breaks := make([]bool, n+1)
	previous := math.Inf(1)
	for _, tol := range []float64{1e-2, 1e-3, 1e-4, 1e-5} {
		path, broken := refinePath(uniform, breaks, curve, 0, 2*math.Pi, tol, refineBudget)
		checkPath(t, path, uniform, breaks)
		if len(broken) != 0 || path.Exhausted || path.Unresolved != 0 {
			t.Fatalf("tolerance %g: %+v", tol, path)
		}
		e := chordError(path.Points, path.At, curve, 0, 2*math.Pi, n)
		if e > 1.5*tol || e >= previous {
			t.Fatalf("tolerance %g: error %g (previous %g)", tol, e, previous)
		}
		previous = e
	}
}

// A coil of frequency 61 at 240 samples a period: the uniform samples alias
// it into a slower false wave, while the refined path follows it.
func TestRefinementResolvesAnAliasedHarmonic(t *testing.T) {
	c := harmonicStudy(0, 2*math.Pi, Vec3{},
		HarmonicTerm{Frequency: 1, Cosine: Vec3{3, 0, 0}, Sine: Vec3{0, 3, 0}},
		HarmonicTerm{Frequency: 61, Cosine: Vec3{0, 0, 0.3}, Sine: Vec3{0.3, 0, 0}})
	c.Samples = 240
	c.Construction = "none"
	curve := func(u float64) Vec3 {
		return Vec3{3*math.Cos(u) + 0.3*math.Sin(61*u), 3 * math.Sin(u), 0.3 * math.Cos(61*u)}
	}
	r := refinedStudy(t, c)
	path := r.Adaptive.Base
	checkPath(t, path, r.Base, r.Breaks)
	if path.Exhausted || path.Breaks != 0 {
		t.Fatalf("coil: %+v", path.Exhausted)
	}
	if e := chordError(path.Points, path.At, curve, 0, 2*math.Pi, c.Samples); e > 1.5*path.Tolerance {
		t.Fatalf("refined error %g against %g", e, path.Tolerance)
	}
	if e := chordError(r.Base, uniformAt(c.Samples), curve, 0, 2*math.Pi, c.Samples); e < 0.05 {
		t.Fatalf("uniform error %g: the coil is not aliased", e)
	}
}

// A bump narrower than the sample spacing, centered between samples: the
// uniform path barely rises, the refined one reaches its top.
func TestRefinementFindsANarrowBump(t *testing.T) {
	n := 240
	h := 2 * math.Pi / float64(n)
	top := -math.Pi + 100.3*h
	c := custom("cos(t)", "sin(t)", "exp(-((t-a)/0.004)^2)", -math.Pi, math.Pi)
	c.Curve.A = top
	c.Samples = n
	c.Construction = "none"
	r := refinedStudy(t, c)
	height := func(points []*Vec3) float64 {
		z := 0.0
		for _, p := range points {
			if p != nil {
				z = math.Max(z, p.Z)
			}
		}
		return z
	}
	if height(r.Base) > 0.1 {
		t.Fatalf("uniform samples already see the bump: %g", height(r.Base))
	}
	if z := height(r.Adaptive.Base.Points); z < 0.999 {
		t.Fatalf("refined path rises only to %g", z)
	}
}

// z is undefined on a gap of width 0.01 centered on a quarter point: no
// sample or interval midpoint falls in it, so the uniform study joins across
// it. Refinement finds it, breaks that interval, and draws up to its edges.
func TestRefinementBreaksAtAGapBetweenSamples(t *testing.T) {
	n := 240
	h := 2 * math.Pi / float64(n)
	i := 130
	gap := -math.Pi + (float64(i)+0.25)*h
	c := custom("t", "0.3*sin(t)", "0.2+0*sqrt((t-a)^2-0.000025)", -math.Pi, math.Pi)
	c.Curve.A = gap
	c.Samples = n
	uniform, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if uniform.Breaks[i+1] {
		t.Fatal("the uniform study already breaks at the gap")
	}
	r := refinedStudy(t, c)
	path := r.Adaptive.Base
	checkPath(t, path, uniform.Base, uniform.Breaks)
	if path.Breaks != 1 || !r.Breaks[i+1] || len(breaks(r.Breaks)) != len(breaks(uniform.Breaks))+1 {
		t.Fatalf("gap: %d refined breaks, %v", path.Breaks, breaks(r.Breaks))
	}
	if r.Omitted != uniform.Omitted+1 {
		t.Fatalf("the developable still joins across the gap: %d omitted", r.Omitted)
	}
	// The drawn ends beside the gap are at its edges, to within the finest
	// refinement step.
	step := h / float64(int(1)<<refineDepth)
	first, last := -1, -1
	for k, p := range path.Points {
		if p == nil && int(math.Floor(path.At[k])) == i {
			if first < 0 {
				first = k
			}
			last = k
		}
	}
	if first < 0 {
		t.Fatal("no break drawn in the gap's interval")
	}
	for k := first; k <= last; k++ {
		if path.Points[k] != nil {
			t.Fatal("a point drawn inside the gap")
		}
	}
	before, after := path.Points[first-1], path.Points[last+1]
	if before == nil || after == nil {
		t.Fatal("the gap's break is not between drawn points")
	}
	if math.Abs(before.X-(gap-0.005)) > 2*step || math.Abs(after.X-(gap+0.005)) > 2*step {
		t.Fatalf("gap edges drawn at %g and %g, want %g and %g", before.X, after.X, gap-0.005, gap+0.005)
	}
}

// The line (t, δ, 0) inverts in the unit sphere at the origin to the circle
// through the origin with center (0, 1/(2δ), 0). Passing close to the center
// it throws out a large loop that the uniform samples cut with long chords;
// refinement draws the whole circle joined, within tolerance.
func TestRefinementJoinsAnInversionNearMiss(t *testing.T) {
	delta := 0.01
	c := inversionStudy("t", "0.01", "0", -3, 3, Vec3{}, 1)
	c.Samples = 240
	rho := 1 / (2 * delta)
	sagitta := func(a, b *Vec3) float64 {
		l := b.sub(*a).norm()
		return rho - math.Sqrt(math.Max(0, rho*rho-l*l/4))
	}
	uniform := inverted(t, c).Inversion
	coarse := 0.0
	for k := 1; k < len(uniform.Points); k++ {
		if !uniform.Breaks[k] {
			coarse = math.Max(coarse, sagitta(uniform.Points[k-1], uniform.Points[k]))
		}
	}
	if coarse < 1 {
		t.Fatalf("the uniform image is already round: sagitta %g", coarse)
	}
	r := refinedStudy(t, c)
	q, path := r.Inversion, r.Adaptive.Image
	if q.Crossings != 0 || path.Breaks != 0 || path.Exhausted || len(breaks(q.Breaks)) != 0 {
		t.Fatalf("near miss: %d crossings, %d refined breaks", q.Crossings, path.Breaks)
	}
	checkPath(t, path, q.Points, q.Breaks)
	center := Vec3{0, rho, 0}
	far := 0.0
	for k, p := range path.Points {
		if p == nil {
			t.Fatal("gap in the near miss's image")
		}
		if math.Abs(p.sub(center).norm()-rho) > 1e-9*rho {
			t.Fatalf("image point %+v off the circle", *p)
		}
		far = math.Max(far, p.norm())
		if k > 0 {
			if e := sagitta(path.Points[k-1], p); e > 1.5*path.Tolerance {
				t.Fatalf("chord sagitta %g exceeds %g", e, path.Tolerance)
			}
		}
	}
	if far < 2*rho*(1-1e-6) {
		t.Fatalf("the loop reaches %g of %g", far, 2*rho)
	}
	// Every refined image point is the inverse of the line at its position.
	for k, p := range path.Points {
		x := -3 + 6*path.At[k]/float64(c.Samples)
		d := x*x + delta*delta
		near(t, p, Vec3{x / d, delta / d, 0}, 1e-9*(1+p.norm()))
	}
}

// A line through the center leaves through infinity: refinement keeps that
// break, however finely it looks.
func TestRefinementKeepsAPassageThroughTheCenter(t *testing.T) {
	c := inversionStudy("t", "0", "0", -3, 3.01, Vec3{}, 1)
	c.Samples = 240
	r := refinedStudy(t, c)
	if r.Inversion.Crossings != 1 || r.Adaptive.Image.Breaks != 1 {
		t.Fatalf("passage: %d crossings, %d refined breaks", r.Inversion.Crossings, r.Adaptive.Image.Breaks)
	}
}

func TestRefinementBudgetIsBoundedAndReported(t *testing.T) {
	c := harmonicStudy(0, 2*math.Pi, Vec3{},
		HarmonicTerm{Frequency: 1, Cosine: Vec3{3, 0, 0}, Sine: Vec3{0, 3, 0}},
		HarmonicTerm{Frequency: 997, Cosine: Vec3{0, 0, 1}, Sine: Vec3{1, 0, 0}})
	c.Samples = 240
	c.Construction = "none"
	r := refinedStudy(t, c)
	path := r.Adaptive.Base
	if !path.Exhausted || path.Inserted != refineBudget || path.Unresolved == 0 {
		t.Fatalf("budget: inserted %d, exhausted %v, unresolved %d", path.Inserted, path.Exhausted, path.Unresolved)
	}
	inserted := 0
	for _, u := range path.At {
		if u != math.Trunc(u) {
			inserted++
		}
	}
	if inserted != path.Inserted {
		t.Fatalf("%d points inserted, %d reported", inserted, path.Inserted)
	}
	again := refinedStudy(t, c)
	if !reflect.DeepEqual(again.Adaptive, r.Adaptive) {
		t.Fatal("refinement is not deterministic")
	}
}

// A half circle in two quarter arcs, each straying 1 − cos 45° ≈ 0.29 from
// its chord and 1 − cos 22.5° ≈ 0.08 once halved: with tolerance 0.1 one
// bisection each resolves them, so a budget of one leaves exactly one piece
// unresolved.
func TestRefinementCountsWhatTheBudgetLeaves(t *testing.T) {
	arc := func(u float64) Vec3 { return Vec3{math.Cos(u), math.Sin(u), 0} }
	uniform := []*Vec3{}
	for i := 0; i <= 2; i++ {
		p := arc(math.Pi * float64(i) / 2)
		uniform = append(uniform, &p)
	}
	breaks := make([]bool, 3)
	whole, _ := refinePath(uniform, breaks, arc, 0, math.Pi, 0.1, 2)
	if whole.Inserted != 2 || whole.Exhausted || whole.Unresolved != 0 {
		t.Fatalf("budget of two: %+v", *whole)
	}
	short, _ := refinePath(uniform, breaks, arc, 0, math.Pi, 0.1, 1)
	if short.Inserted != 1 || !short.Exhausted || short.Unresolved != 1 {
		t.Fatalf("budget of one: inserted %d, exhausted %v, unresolved %d", short.Inserted, short.Exhausted, short.Unresolved)
	}
}

// Scaling a curve by a power of two scales every distance exactly, so it must
// insert the same points.
func TestRefinementIsScaleInvariant(t *testing.T) {
	small := custom("cos(t)+0.3*cos(7*t)", "sin(t)-0.3*sin(7*t)", "0.4*sin(3*t)", 0, 2*math.Pi)
	large := custom("1024*(cos(t)+0.3*cos(7*t))", "1024*(sin(t)-0.3*sin(7*t))", "1024*(0.4*sin(3*t))", 0, 2*math.Pi)
	for _, c := range []*Request{&small, &large} {
		c.Samples = 240
		c.Construction = "none"
	}
	a, b := refinedStudy(t, small).Adaptive.Base, refinedStudy(t, large).Adaptive.Base
	if !reflect.DeepEqual(a.At, b.At) || a.Inserted == 0 {
		t.Fatalf("inserted %d and %d points at different positions", a.Inserted, b.Inserted)
	}
}

func TestRefinedProjectionIsTheProjectionOfTheCurve(t *testing.T) {
	c := study()
	c.Samples = 240
	c.Construction = "orthotomic"
	c.Pole = Vec3{0.4, -0.3, 1.1}
	r := refinedStudy(t, c)
	path := r.Adaptive.Projection
	if path == nil || r.Adaptive.Base == nil {
		t.Fatal("projection not refined")
	}
	checkPath(t, path, r.Projection.Points, r.Breaks)
	tangent := func(u float64) Vec3 {
		e := 1e-6
		return trefoilAt(c, u+e).sub(trefoilAt(c, u-e)).unit()
	}
	image := func(u float64) Vec3 {
		x, d := trefoilAt(c, u), tangent(u)
		h := x.add(d.mul(c.Pole.sub(x).dot(d)))
		return h.mul(2).sub(c.Pole)
	}
	if path.Inserted == 0 {
		t.Fatal("nothing inserted")
	}
	for k, p := range path.Points {
		near(t, p, image(2*math.Pi*path.At[k]/float64(c.Samples)), 1e-7)
	}
	if e := chordError(path.Points, path.At, image, 0, 2*math.Pi, c.Samples); e > 1.5*path.Tolerance {
		t.Fatalf("refined orthotomic error %g against %g", e, path.Tolerance)
	}
}

func TestRefinementOfDerivedInputs(t *testing.T) {
	c := study()
	c.Samples = 240
	c.Input = "tangent-foot"
	c.Pole = Vec3{0.4, -0.3, 1.1}
	r := refinedStudy(t, c)
	if r.Adaptive.Base == nil || r.Adaptive.Parent == nil {
		t.Fatal("a projected input and its base are both drawn and both refined")
	}
	checkPath(t, r.Adaptive.Parent, r.Composition.Curve, r.Composition.Breaks)
	checkPath(t, r.Adaptive.Base, r.Base, r.Breaks)
	// The parent's inserted points lie on the base knot, not on its input.
	if r.Adaptive.Parent.Inserted == 0 {
		t.Fatal("base under a derived input not refined")
	}
	for k, p := range r.Adaptive.Parent.Points {
		near(t, p, trefoilAt(c, 2*math.Pi*r.Adaptive.Parent.At[k]/float64(c.Samples)), 1e-12)
	}
	// An involute input is refined by its own evaluator, with its base.
	c.Input = "involute"
	c.Unwinding = UnwindingRequest{Anchor: 0.3, Offset: 1}
	r = refinedStudy(t, c)
	if r.Adaptive.Base == nil || r.Adaptive.Parent == nil {
		t.Fatal("an involute input and its base are both drawn and both refined")
	}
	checkPath(t, r.Adaptive.Base, r.Base, r.Breaks)
}

func TestRefinementSkipsIntegratedAndSurfaceStudies(t *testing.T) {
	c := fieldRequest("-y", "x", "0.2", []Vec3{{1, 0, 0}}, 0, 6)
	c.Adaptive = true
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Adaptive != nil {
		t.Fatal("an integrated trajectory is refined")
	}
}
