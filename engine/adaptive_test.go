package engine

import (
	"encoding/json"
	"math"
	"testing"
)

// Refinement between samples in the planar engine (engine/refine, shared
// with the spatial engine). Expectations come from independent closed
// forms evaluated here, never from the engine's evaluators.

func adaptive(q Request) Request {
	q.Adaptive = true
	return q
}

// param is the parameter of a refined point at position u in sample steps.
func param(q Request, u float64) float64 {
	return q.Curve.Min + u*(q.Curve.Max-q.Curve.Min)/float64(q.Samples-1)
}

// chordError is the largest distance of the exact curve from any chord of a
// path between consecutive drawn points, measured at 32 parameters inside
// each chord; positions are the points' parameters.
func chordError(points []*Vec, ts []float64, exact func(float64) Vec) float64 {
	worst := 0.0
	for k := 1; k < len(points); k++ {
		a, b := points[k-1], points[k]
		if a == nil || b == nil {
			continue
		}
		for j := 1; j < 32; j++ {
			p := exact(ts[k-1] + (ts[k]-ts[k-1])*float64(j)/32)
			worst = math.Max(worst, distanceToSegment(p, *a, *b))
		}
	}
	return worst
}

func distanceToSegment(p, a, b Vec) float64 {
	d := b.Sub(a)
	s := 0.0
	if l := d.Dot(d); l > 0 {
		s = math.Max(0, math.Min(1, p.Sub(a).Dot(d)/l))
	}
	return p.Sub(a.Add(d.Mul(s))).Norm()
}

// checkUniform asserts that a refined path keeps every uniform sample, in
// order, at its whole position.
func checkUniform(t *testing.T, path *RefinedPath, uniform []*Vec) {
	t.Helper()
	if len(path.Points) != len(path.At) {
		t.Fatalf("%d points at %d positions", len(path.Points), len(path.At))
	}
	next := 0
	for k, u := range path.At {
		if k > 0 && u <= path.At[k-1] {
			t.Fatalf("positions not increasing at %d: %g after %g", k, u, path.At[k-1])
		}
		if u == float64(next) {
			if (path.Points[k] == nil) != (uniform[next] == nil) || path.Points[k] != nil && *path.Points[k] != *uniform[next] {
				t.Fatalf("sample %d changed: %v, want %v", next, path.Points[k], uniform[next])
			}
			next++
		}
	}
	if next != len(uniform) {
		t.Fatalf("%d of %d uniform samples kept", next, len(uniform))
	}
}

// A coil of frequency 233 on a unit circle, sampled 240 times over a turn:
// each step advances the coil by almost a whole turn, so the samples alias
// it into a slow, smooth false wave.
const coilX, coilY = "cos(t) + 0.03*cos(233*t)", "sin(t) + 0.03*sin(233*t)"

func coil(scale float64) func(float64) Vec {
	return func(t float64) Vec {
		return Vec{math.Cos(t) + 0.03*math.Cos(233*t), math.Sin(t) + 0.03*math.Sin(233*t)}.Mul(scale)
	}
}

func coilRequest() Request {
	q := request("evolute", coilX, coilY, 0, 2*math.Pi)
	q.Samples = 240
	return q
}

func positions(q Request, path *RefinedPath) []float64 {
	ts := make([]float64, len(path.At))
	for k, u := range path.At {
		ts[k] = param(q, u)
	}
	return ts
}

func TestRefinementResolvesAnAliasedCoil(t *testing.T) {
	q := coilRequest()
	uniform := compute(t, q)
	if uniform.Adaptive != nil {
		t.Fatal("refined without being asked")
	}
	r := compute(t, adaptive(q))
	path := r.Adaptive.Base
	checkUniform(t, path, r.Base)
	if path.Inserted == 0 || path.Exhausted || path.Unresolved != 0 || path.Breaks != 0 {
		t.Fatalf("inserted %d, exhausted %v, unresolved %d, breaks %d", path.Inserted, path.Exhausted, path.Unresolved, path.Breaks)
	}
	// The robust radius of the samples, from the center of their box, is
	// between 1 and 1.1.
	if path.Tolerance < 2e-4 || path.Tolerance > 2.2e-4 {
		t.Fatalf("tolerance %g, want 2e-4 of the radius", path.Tolerance)
	}
	steps := make([]float64, len(r.Base))
	for i := range steps {
		steps[i] = param(q, float64(i))
	}
	if e := chordError(r.Base, steps, coil(1)); e < 100*path.Tolerance {
		t.Fatalf("the uniform samples already follow the coil: error %g", e)
	}
	// Three probes per piece can understate a chord's error a little.
	if e := chordError(path.Points, positions(q, path), coil(1)); e > 1.5*path.Tolerance {
		t.Fatalf("refined chord error %g exceeds %g", e, path.Tolerance)
	}
	// Nothing else in the result changes.
	r.Adaptive = nil
	a, _ := json.Marshal(r)
	b, _ := json.Marshal(uniform)
	if string(a) != string(b) {
		t.Fatal("refinement changed the rest of the result")
	}
}

func TestRefinementIsScaleInvariant(t *testing.T) {
	q := coilRequest()
	big := q
	big.Curve.X, big.Curve.Y = "1024*("+coilX+")", "1024*("+coilY+")"
	a, b := compute(t, adaptive(q)).Adaptive.Base, compute(t, adaptive(big)).Adaptive.Base
	if len(a.At) != len(b.At) {
		t.Fatalf("%d points against %d at 1024 times the size", len(a.At), len(b.At))
	}
	for k := range a.At {
		if a.At[k] != b.At[k] {
			t.Fatalf("point %d at %g against %g", k, a.At[k], b.At[k])
		}
	}
	if math.Abs(b.Tolerance/a.Tolerance-1024) > 1e-9*1024 {
		t.Fatalf("tolerance %g against %g", b.Tolerance, a.Tolerance)
	}
}

// Integrated curves and level sets cannot be evaluated between samples, so
// they are never refined.
func TestRefinementLeavesIntegratedAndUnparametrizedCurves(t *testing.T) {
	for format, q := range map[string]Request{
		"pursuit":   pursuitRequest(Pursuit{Pursuers: polygon(4, Vec{}, 1, 0, 1), Capture: 1e-3}, 0, 2),
		"field":     fieldRequest("-y", "x", []Seed{{1, 0}}, 10, 0, 2*math.Pi),
		"implicit":  implicitRequest("x^2+y^2", 1, square(2), 40),
		"attractor": attractorRequest(clifford()),
	} {
		r, err := Compute(adaptive(q))
		if err != nil {
			t.Fatalf("%s: %v", format, err)
		}
		if r.Adaptive != nil {
			t.Fatalf("%s was refined", format)
		}
	}
}

// A curve undefined on an interval narrower than a sample step, which every
// uniform sample misses: refinement breaks it there, with its edges drawn to
// within the finest step.
func TestRefinementBreaksAtAGapBetweenSamples(t *testing.T) {
	// Samples fall at ±1/63 either side of the gap.
	const c, d = 0, 0.004
	q := request("evolute", "t", "sqrt(t^2 - 0.004^2)", -1, 1)
	q.Samples = 64
	q.Kind = "pedal"
	q.Pole = Vec{0, -1}
	r := compute(t, adaptive(q))
	for i, p := range r.Base {
		if p == nil {
			t.Fatalf("uniform sample %d already falls in the gap", i)
		}
	}
	path := r.Adaptive.Base
	checkUniform(t, path, r.Base)
	if path.Breaks != 1 {
		t.Fatalf("%d breaks, want 1", path.Breaks)
	}
	step := 2.0 / 63
	finest := step / 1024
	var left, right float64 = math.Inf(-1), math.Inf(1)
	gap := false
	for k, p := range path.Points {
		x := param(q, path.At[k])
		if p == nil {
			gap = true
			continue
		}
		if !gap {
			left = x
		} else if x < right {
			right = x
		}
	}
	if math.Abs(left-(c-d)) > 2*finest || math.Abs(right-(c+d)) > 2*finest {
		t.Fatalf("gap drawn from %g to %g, want %g to %g", left, right, c-d, c+d)
	}
	// The pedal curve built on it breaks in the same interval.
	if r.Adaptive.Derived == nil {
		t.Fatal("pedal curve not refined")
	}
	interval := func(p *RefinedPath) int {
		for k, q := range p.Points {
			if q == nil {
				return int(p.At[k])
			}
		}
		return -1
	}
	if interval(path) < 0 || interval(r.Adaptive.Derived) != interval(path) {
		t.Fatalf("pedal breaks in interval %d, base in %d", interval(r.Adaptive.Derived), interval(path))
	}
}

// A pole between samples: the uniform samples on either side are finite,
// but the curve runs off to infinity between them.
func TestRefinementBreaksAtAPoleBetweenSamples(t *testing.T) {
	q := request("pedal", "t", "1/(t - 0.0131)", -1, 1)
	q.Samples, q.Pole = 64, Vec{0.5, 0.5}
	r := compute(t, adaptive(q))
	path := r.Adaptive.Base
	checkUniform(t, path, r.Base)
	if path.Breaks != 1 {
		t.Fatalf("%d breaks, want 1", path.Breaks)
	}
	gap := -1
	for k, p := range path.Points {
		if p == nil {
			gap = int(path.At[k])
			if x := param(q, path.At[k]); math.Abs(x-0.0131) > 2.0/63 {
				t.Fatalf("break at %g, far from the pole", x)
			}
		}
	}
	// The pedal curve passes continuously below the asymptote, but it is
	// built on a curve broken there, and stays broken in that interval.
	derived := r.Adaptive.Derived
	for k, p := range derived.Points {
		if p == nil && int(derived.At[k]) == gap {
			return
		}
	}
	t.Fatal("the pedal curve is joined across the base's pole")
}

// A derived input built on a curve broken between samples stays broken
// there: the pedal of the hyperbola, as the input of its evolute, passes
// continuously below the asymptote.
func TestRefinementBreaksADerivedInputWhereItsBaseBreaks(t *testing.T) {
	q := request("evolute", "t", "1/(t - 0.0131)", -1, 1)
	q.Samples, q.Pole, q.Input = 64, Vec{0.5, 0.5}, "pedal"
	r := compute(t, adaptive(q))
	gap := func(p *RefinedPath) int {
		for k, q := range p.Points {
			if q == nil {
				return int(p.At[k])
			}
		}
		return -1
	}
	if g := gap(r.Adaptive.Base); g < 0 || gap(r.Adaptive.Input) != g {
		t.Fatalf("base broken in interval %d, its pedal input in %d", g, gap(r.Adaptive.Input))
	}
}

// The line y = δ inverted in the unit circle is the circle through the
// center with center (0, 1/(2δ)): a near miss of the center throws out a
// loop that the uniform samples draw as a jagged polygon.
func TestRefinementDrawsAnInversionNearMissAsItsCircle(t *testing.T) {
	const delta = 0.02
	q := inversionRequest("t", "0.02", -3, 3, Vec{}, 1)
	q.Samples = 64
	uniform := compute(t, q)
	r := compute(t, adaptive(q))
	path := r.Adaptive.Derived
	if path == nil {
		t.Fatal("no refined image")
	}
	checkUniform(t, path, uniform.Derived)
	if path.Breaks != 0 || path.Exhausted || len(r.Inversion.Breaks) != 0 {
		t.Fatalf("near miss broken: %d refined breaks, inversion breaks %v", path.Breaks, r.Inversion.Breaks)
	}
	center, rho := Vec{0, 1 / (2 * delta)}, 1/(2*delta)
	exact := func(x float64) Vec {
		p := Vec{x, delta}
		return p.Mul(1 / p.Dot(p))
	}
	for _, p := range path.Points {
		if p == nil {
			t.Fatal("gap in the near miss's image")
		}
		if math.Abs(p.Sub(center).Norm()-rho) > 1e-9*rho {
			t.Fatalf("image point %v off the circle", *p)
		}
	}
	steps := make([]float64, len(uniform.Derived))
	for i := range steps {
		steps[i] = param(q, float64(i))
	}
	if e := chordError(uniform.Derived, steps, exact); e < 100*path.Tolerance {
		t.Fatalf("the uniform image is already round: error %g", e)
	}
	if e := chordError(path.Points, positions(q, path), exact); e > 1.5*path.Tolerance {
		t.Fatalf("refined image error %g exceeds %g", e, path.Tolerance)
	}
}

// A line through the center leaves through infinity: refinement keeps that
// break, however finely it looks, and decides it in place of the uniform
// passage test.
func TestRefinementKeepsAPassageThroughTheCenter(t *testing.T) {
	q := inversionRequest("t", "0", -3, 3.01, Vec{}, 1)
	q.Samples = 64
	r := compute(t, adaptive(q))
	path := r.Adaptive.Derived
	if path.Breaks != 1 || len(r.Inversion.Breaks) != 1 {
		t.Fatalf("%d refined breaks, inversion breaks %v; want one passage", path.Breaks, r.Inversion.Breaks)
	}
	gap := -1
	for k, p := range path.Points {
		if p == nil {
			gap = int(path.At[k])
		}
	}
	// Inversion breaks name the sample after the open interval.
	if gap+1 != r.Inversion.Breaks[0] {
		t.Fatalf("refined gap in interval %d, inversion breaks %v", gap, r.Inversion.Breaks)
	}
	if x := param(q, float64(gap)); x > 0 || param(q, float64(gap+1)) < 0 {
		t.Fatalf("passage drawn in [%g, %g], away from the center", x, param(q, float64(gap+1)))
	}
}

// The pedal curve is refined from the input's position and tangent: its
// points are the feet of the perpendiculars from the pole to the coil's
// exact tangents, within the finite-difference tangent's accuracy, which is
// well inside the tolerance.
func TestRefinementOfThePedalCurve(t *testing.T) {
	// Three turns of a circle with a fivefold wave, sampled 64 times. The
	// wave is shallow enough to keep the curve convex (its curvature's
	// numerator 1 + a²k³ + a(k + k²)cos((k − 1)t) stays positive), so its
	// pedal curve has no cusps to hide between probes.
	q := request("pedal", "cos(t) + 0.03*cos(5*t)", "sin(t) + 0.03*sin(5*t)", 0, 6*math.Pi)
	q.Samples, q.Pole = 64, Vec{0.2, -0.1}
	wave := func(s float64) (Vec, Vec) {
		return Vec{math.Cos(s) + 0.03*math.Cos(5*s), math.Sin(s) + 0.03*math.Sin(5*s)},
			Vec{-math.Sin(s) - 0.15*math.Sin(5*s), math.Cos(s) + 0.15*math.Cos(5*s)}
	}
	pedal := func(s float64) Vec {
		p, d := wave(s)
		d = d.Unit()
		return p.Add(d.Mul(q.Pole.Sub(p).Dot(d)))
	}
	r := compute(t, adaptive(q))
	path := r.Adaptive.Derived
	if path == nil || path.Inserted == 0 || path.Exhausted || path.Unresolved != 0 {
		t.Fatalf("pedal curve not refined: %+v", path)
	}
	checkUniform(t, path, r.Derived)
	steps := make([]float64, len(r.Derived))
	for i := range steps {
		steps[i] = param(q, float64(i))
	}
	if e := chordError(r.Derived, steps, pedal); e < 10*path.Tolerance {
		t.Fatalf("the uniform pedal curve already follows it: error %g", e)
	}
	ts := positions(q, path)
	for k, p := range path.Points {
		if p != nil && p.Sub(pedal(ts[k])).Norm() > path.Tolerance/2 {
			t.Fatalf("pedal point %d at t = %g is %v, want %v", k, ts[k], *p, pedal(ts[k]))
		}
	}
	if e := chordError(path.Points, ts, pedal); e > 1.5*path.Tolerance {
		t.Fatalf("refined pedal error %g exceeds %g", e, path.Tolerance)
	}
}

// A construction on a derived input refines the input as drawn: an offset
// of the coil, whose points lie at the distance along its exact normals.
func TestRefinementOfADerivedInput(t *testing.T) {
	q := coilRequest()
	q.Input, q.Distance = "offset", 0.01
	q.Kind, q.Pole = "pedal", Vec{0.2, -0.1}
	r := compute(t, adaptive(q))
	path := r.Adaptive.Input
	if path == nil || path.Inserted == 0 {
		t.Fatal("derived input not refined")
	}
	checkUniform(t, path, r.Input)
	offset := func(s float64) Vec {
		d := Vec{-math.Sin(s) - 0.03*233*math.Sin(233*s), math.Cos(s) + 0.03*233*math.Cos(233*s)}.Unit()
		return coil(1)(s).Add(d.Perp().Mul(q.Distance))
	}
	ts := positions(q, path)
	for k, p := range path.Points {
		if p != nil && p.Sub(offset(ts[k])).Norm() > path.Tolerance/2 {
			t.Fatalf("input point %d at t = %g is %v, want %v", k, ts[k], *p, offset(ts[k]))
		}
	}
	// The pedal curve built on it projects the pole onto the offset's own
	// tangent lines, parallel to the coil's. Their direction is a finite
	// difference of the offset, itself built from finite differences, good
	// to about 10⁻³ on this coil: a tenth of the offset distance, the
	// shift of a foot on the coil's own tangent.
	pedal := r.Adaptive.Derived
	if pedal == nil || pedal.Inserted == 0 {
		t.Fatal("pedal of the derived input not refined")
	}
	ts = positions(q, pedal)
	for k, p := range pedal.Points {
		if p == nil {
			continue
		}
		s := ts[k]
		d := Vec{-math.Sin(s) - 0.03*233*math.Sin(233*s), math.Cos(s) + 0.03*233*math.Cos(233*s)}.Unit()
		o := offset(s)
		if want := o.Add(d.Mul(q.Pole.Sub(o).Dot(d))); p.Sub(want).Norm() > q.Distance/4 {
			t.Fatalf("pedal point %d at t = %g is %v, want %v", k, s, *p, want)
		}
	}
	// The base beneath is refined too, on the base itself.
	base := r.Adaptive.Base
	if base == nil || base.Inserted == 0 {
		t.Fatal("the base under a derived input is not refined")
	}
	ts = positions(q, base)
	for k, p := range base.Points {
		if p != nil && p.Sub(coil(1)(ts[k])).Norm() > 1e-12 {
			t.Fatalf("base point %d at t = %g is %v, off the coil", k, ts[k], *p)
		}
	}
}

// A pedal curve built on a derived input projects the pole onto the input's
// own tangents: on an ellipse's evolute, whose tangent is the ellipse's
// normal, the pole's foot on the normal line through the center of
// curvature.
func TestRefinementOfAPedalOnADerivedInput(t *testing.T) {
	const a, b = 2.0, 1.0
	q := request("pedal", "2*cos(t)", "sin(t)", 0, 2*math.Pi)
	q.Input, q.Samples, q.Pole = "evolute", 64, Vec{0.3, 0.2}
	foot := func(s float64) Vec {
		// The evolute ((a²−b²)/a cos³ s, (b²−a²)/b sin³ s) and the
		// ellipse's normal direction (b cos s, a sin s).
		e := Vec{(a*a - b*b) / a * math.Pow(math.Cos(s), 3), (b*b - a*a) / b * math.Pow(math.Sin(s), 3)}
		n := Vec{b * math.Cos(s), a * math.Sin(s)}.Unit()
		return e.Add(n.Mul(q.Pole.Sub(e).Dot(n)))
	}
	r := compute(t, adaptive(q))
	path := r.Adaptive.Derived
	if path == nil || path.Inserted == 0 {
		t.Fatal("pedal on the evolute not refined")
	}
	checkUniform(t, path, r.Derived)
	// Away from the evolute's four cusps, where a finite-difference tangent
	// is unreliable, at a sample or between them.
	ts := positions(q, path)
	checked := 0
	for k, p := range path.Points {
		if p == nil || math.Abs(math.Sin(2*ts[k])) < 0.1 {
			continue
		}
		checked++
		if p.Sub(foot(ts[k])).Norm() > 1e-5 {
			t.Fatalf("pedal point %d at t = %g is %v, want %v", k, ts[k], *p, foot(ts[k]))
		}
	}
	if checked < len(path.Points)/2 {
		t.Fatalf("only %d of %d points checked", checked, len(path.Points))
	}
}

// An inversion acts on its input: the offset of the line y = 0 by 0.02 is
// the line y = 0.02, whose image is the near miss's circle, while the line
// itself runs through the center.
func TestRefinementInvertsADerivedInput(t *testing.T) {
	q := inversionRequest("t", "0", -3, 3, Vec{}, 1)
	q.Samples, q.Input, q.Distance = 64, "offset", 0.02
	r := compute(t, adaptive(q))
	path := r.Adaptive.Derived
	if path == nil || path.Breaks != 0 || len(r.Inversion.Breaks) != 0 {
		t.Fatalf("image of the offset line broken: %+v, %v", path, r.Inversion.Breaks)
	}
	for _, p := range path.Points {
		if p == nil || math.Abs(p.Sub(Vec{0, 25}).Norm()-25) > 1e-9*25 {
			t.Fatalf("image point %v off the circle", p)
		}
	}
}

// A curve built on a derived input stays broken where the input breaks:
// the evolute of a cubic runs off to infinity at its inflection, between
// samples, while its pedal curve, the pole's foot on the cubic's normal
// line, passes continuously. The inflection lies off every probe, where the
// evolute would be undefined and the pedal curve would break on its own.
func TestRefinementBreaksAConstructionWhereItsInputBreaks(t *testing.T) {
	q := request("pedal", "t", "(t - 0.0037)^3", -1, 1)
	q.Samples, q.Pole, q.Input = 64, Vec{0.5, 0.5}, "evolute"
	r := compute(t, adaptive(q))
	gap := func(p *RefinedPath) int {
		for k, q := range p.Points {
			if q == nil {
				return int(p.At[k])
			}
		}
		return -1
	}
	if b := gap(r.Adaptive.Base); b >= 0 {
		t.Fatalf("the cubic itself broken in interval %d", b)
	}
	if g := gap(r.Adaptive.Input); g < 0 || gap(r.Adaptive.Derived) != g {
		t.Fatalf("evolute broken in interval %d, its pedal curve in %d", g, gap(r.Adaptive.Derived))
	}
}

// The ellipse (a cos t, b sin t) and its exact constructions, from closed
// forms: the evolute ((a²−b²)/a cos³ t, (b²−a²)/b sin³ t), and the point at
// distance d along the left unit normal (−b cos t, −a sin t)/|r′|.
const ellipseA, ellipseB = 2.0, 1.0

func ellipseEvolute(s float64) Vec {
	a, b := ellipseA, ellipseB
	return Vec{(a*a - b*b) / a * math.Pow(math.Cos(s), 3), (b*b - a*a) / b * math.Pow(math.Sin(s), 3)}
}

func ellipseOffset(d float64) func(float64) Vec {
	return func(s float64) Vec {
		a, b := ellipseA, ellipseB
		n := Vec{-b * math.Cos(s), -a * math.Sin(s)}.Unit()
		return Vec{a * math.Cos(s), b * math.Sin(s)}.Add(n.Mul(d))
	}
}

func ellipseRequest(kind string) Request {
	q := request(kind, "2*cos(t)", "sin(t)", 0, 2*math.Pi)
	q.Samples = 64
	return q
}

// checkRefined asserts that a refined construction keeps its uniform
// samples, puts every point on the exact curve, and follows it to within the
// tolerance where the uniform samples do not.
func checkRefined(t *testing.T, q Request, path *RefinedPath, uniform []*Vec, exact func(float64) Vec) {
	t.Helper()
	if path == nil || path.Inserted == 0 || path.Exhausted || path.Unresolved != 0 || path.Breaks != 0 {
		t.Fatalf("not refined cleanly: %+v", path)
	}
	checkUniform(t, path, uniform)
	steps := make([]float64, len(uniform))
	for i := range steps {
		steps[i] = param(q, float64(i))
	}
	if e := chordError(uniform, steps, exact); e < 4*path.Tolerance {
		t.Fatalf("the uniform samples already follow it: error %g", e)
	}
	ts := positions(q, path)
	for k, p := range path.Points {
		if p != nil && p.Sub(exact(ts[k])).Norm() > path.Tolerance/2 {
			t.Fatalf("point %d at t = %g is %v, want %v", k, ts[k], *p, exact(ts[k]))
		}
	}
	if e := chordError(path.Points, ts, exact); e > 1.5*path.Tolerance {
		t.Fatalf("refined chord error %g exceeds %g", e, path.Tolerance)
	}
}

// The evolute of an ellipse, an astroid stretched along its axes, has four
// cusps at the ellipse's vertices, which the uniform samples blunt.
func TestRefinementOfTheEvolute(t *testing.T) {
	q := ellipseRequest("evolute")
	uniform := compute(t, q)
	r := compute(t, adaptive(q))
	checkRefined(t, q, r.Adaptive.Derived, r.Derived, ellipseEvolute)
	// Nothing else in the result changes: the construction lines keep the
	// samples.
	r.Adaptive = nil
	a, _ := json.Marshal(r)
	b, _ := json.Marshal(uniform)
	if string(a) != string(b) {
		t.Fatal("refinement changed the rest of the result")
	}
}

// An offset of the ellipse farther inward than its smallest radius of
// curvature, b²/a = 0.5, crosses its evolute and folds into a swallowtail at
// each end of the major axis: two cusps and a crossing, which the uniform
// samples cut short.
func TestRefinementOfAnOffsetPastItsEvolute(t *testing.T) {
	q := ellipseRequest("offset")
	q.Distance = 0.9
	r := compute(t, adaptive(q))
	checkRefined(t, q, r.Adaptive.Derived, r.Derived, ellipseOffset(q.Distance))
}

// Every member of an offset stack is refined on its own.
func TestRefinementOfAnOffsetStack(t *testing.T) {
	q := ellipseRequest("offset")
	q.Stack = Stack{Enabled: true, From: 0.3, To: 1.2, Count: 4}
	r := compute(t, adaptive(q))
	if r.Adaptive.Derived != nil {
		t.Fatal("a stack has no single derived curve to refine")
	}
	if len(r.Adaptive.Family) != len(r.Family) {
		t.Fatalf("%d refined members, want %d", len(r.Adaptive.Family), len(r.Family))
	}
	for k, member := range r.Family {
		if k == 0 {
			// Inside every radius of curvature the offset is as smooth
			// as the ellipse, and refinement adds little; it must still
			// lie on the exact offset.
			path := r.Adaptive.Family[k]
			checkUniform(t, path, member.Points)
			ts := positions(q, path)
			if e := chordError(path.Points, ts, ellipseOffset(member.Distance)); e > 1.5*path.Tolerance {
				t.Fatalf("member %d: refined chord error %g exceeds %g", k, e, path.Tolerance)
			}
			continue
		}
		checkRefined(t, q, r.Adaptive.Family[k], member.Points, ellipseOffset(member.Distance))
	}
}

// The evolute of a cubic runs off to infinity at its inflection, between
// samples, where the uniform samples join it straight across.
func TestRefinementBreaksTheEvoluteAtAnInflection(t *testing.T) {
	q := request("evolute", "t", "(t - 0.0037)^3", -1, 1)
	q.Samples = 64
	r := compute(t, adaptive(q))
	for i, p := range r.Derived {
		if p == nil {
			t.Fatalf("uniform evolute already open at sample %d", i)
		}
	}
	path := r.Adaptive.Derived
	if path == nil || path.Breaks != 1 {
		t.Fatalf("evolute not broken once: %+v", path)
	}
	checkUniform(t, path, r.Derived)
	for k, p := range path.Points {
		if p == nil {
			if x := param(q, path.At[k]); math.Abs(x-0.0037) > 2.0/63 {
				t.Fatalf("break at %g, far from the inflection", x)
			}
		}
	}
}

// An offset and each stack member stay broken where the base breaks
// between samples, at a pole.
func TestRefinementBreaksAnOffsetWhereItsBaseBreaks(t *testing.T) {
	gap := func(p *RefinedPath) int {
		for k, q := range p.Points {
			if q == nil {
				return int(p.At[k])
			}
		}
		return -1
	}
	// Built on the hyperbola's pedal curve, which passes continuously below
	// the asymptote, the offsets are continuous there too: only the base's
	// break opens them.
	q := request("offset", "t", "1/(t - 0.0131)", -1, 1)
	q.Samples, q.Distance, q.Input, q.Pole = 64, 0.05, "pedal", Vec{0.5, 0.5}
	r := compute(t, adaptive(q))
	g := gap(r.Adaptive.Base)
	if g < 0 || gap(r.Adaptive.Input) != g || gap(r.Adaptive.Derived) != g {
		t.Fatalf("base broken in interval %d, its pedal input in %d, its offset in %d", g, gap(r.Adaptive.Input), gap(r.Adaptive.Derived))
	}
	q.Stack = Stack{Enabled: true, From: -0.05, To: 0.05, Count: 3}
	r = compute(t, adaptive(q))
	for k, member := range r.Adaptive.Family {
		if gap(member) != g {
			t.Fatalf("stack member %d broken in interval %d, base in %d", k, gap(member), g)
		}
	}
}

// Between samples the evolute and offsets are undefined wherever a sample
// would be: evaluated at each sample, they return exactly the uniform
// study's point, or nothing where it has none. The exception is an offset
// just past a reversal of its input's tangent, which the uniform study opens
// over the whole interval before it and the evaluator leaves to
// refinement's jump test.
func TestRefinedConstructionsAgreeWithTheSamples(t *testing.T) {
	// A parabola whose second derivative steps from 2 to 3 at c, a quarter
	// of the stencil's spacing past the sample at 0: the curve is smooth
	// enough to offset there, but its curvature is not to be trusted.
	kink := request("evolute", "t", "t^2 + 0.5*(t - 0.00005)*abs(t - 0.00005)", -1, 1)
	kink.Samples = 65
	evolute := ellipseRequest("evolute")
	cases := map[string]Request{
		"evolute":           evolute,
		"evolute at a kink": kink,
	}
	for name, q := range map[string]Request{"offset": ellipseRequest("offset"), "offset at a kink": kink} {
		q.Kind, q.Distance = "offset", 0.3
		cases[name] = q
	}
	for name, input := range map[string]string{"offset": "offset", "evolute": "evolute"} {
		q := evolute
		q.Input, q.Distance = input, 0.3
		if input == "evolute" {
			q.Kind = "offset"
		}
		cases[name+" input"] = q
	}
	stacked := ellipseRequest("offset")
	stacked.Input, stacked.Stack = "evolute", Stack{Enabled: true, From: -0.4, To: 0.4, Count: 3}
	cases["stack on the evolute"] = stacked
	gaps := map[string]int{}
	for name, q := range cases {
		r := compute(t, q)
		f, err := compile(q.Curve)
		if err != nil {
			t.Fatal(err)
		}
		g := inputCurve(q.Input, f, q.Curve.Min, q.Curve.Max, q.Pole, q.Distance)
		curves := map[float64][]*Vec{q.Distance: r.Derived}
		ats := map[float64]func(float64) *Vec{q.Distance: q.derivedAt(f, g)}
		for _, member := range r.Family {
			curves[member.Distance] = member.Points
			ats[member.Distance] = q.memberAt(f, g, member)
		}
		step := (q.Curve.Max - q.Curve.Min) / float64(q.Samples-1)
		for distance, points := range curves {
			at := ats[distance]
			if at == nil {
				t.Fatalf("%s: no evaluator", name)
			}
			for j, want := range points {
				s := q.Curve.Min + float64(j)*step
				got := at(s)
				switch {
				case want != nil && (got == nil || *got != *want):
					t.Fatalf("%s at sample %d: %v, want %v", name, j, got, *want)
				case want == nil && got != nil:
					// Only past a cusp of the ellipse's evolute, at a
					// multiple of π/2 within the step before, which the
					// uniform study opens. At the cusp itself the input's
					// tangent is made of rounding, and neither has a point.
					cusp := math.Ceil((s-step)/(math.Pi/2)) * math.Pi / 2
					if q.Kind != "offset" || q.Input != "evolute" || cusp >= s {
						t.Fatalf("%s at sample %d: %v where the samples have none", name, j, *got)
					}
				case want == nil:
					gaps[name]++
				}
			}
		}
	}
	// The kink's curvature is ill-conditioned at the sample beside it, so
	// its evolute has a gap there, while its offset does not.
	if gaps["evolute at a kink"] == 0 || gaps["offset at a kink"] != 0 {
		t.Fatalf("gaps: %v", gaps)
	}
}
