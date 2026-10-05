package engine

import (
	"encoding/json"
	"math"
	"tangentgarden/engine/refine"
	"testing"
)

// Refinement of line, chord and circle envelopes between samples.
// Expectations come from independent closed forms evaluated here.

// A ladder of unit length slides with its foot (cos t, 0) on the floor and
// its top (0, sin t) on the wall. Every position touches the astroid
// (cos³ t, sin³ t), at λ = sin² t along it from the foot, so always on the
// ladder. The astroid's cusps at t = π/2 and π fall between samples.
func astroid(s float64) Vec {
	return Vec{math.Pow(math.Cos(s), 3), math.Pow(math.Sin(s), 3)}
}

func ladderRequest(mode string) Request {
	family := EnvelopeFamily{Mode: "chord", X: "0", Y: "sin(t)"}
	if mode == "angle" {
		// The ladder's own direction, (−cos t, sin t).
		family = EnvelopeFamily{Mode: "angle", Angle: "pi - t"}
	}
	q := linesRequest("cos(t)", "0", 0, 2*math.Pi, family)
	q.Samples = 64
	return q
}

func TestRefinementOfALineEnvelope(t *testing.T) {
	for _, mode := range []string{"chord", "angle"} {
		q := ladderRequest(mode)
		uniform := compute(t, q)
		r := compute(t, adaptive(q))
		checkRefined(t, q, r.Adaptive.Derived, r.Derived, astroid)
		for k, v := range r.Adaptive.Derived.Virtual {
			if v {
				t.Fatalf("%s: point %d virtual, but the astroid touches every ladder", mode, k)
			}
		}
		// Nothing else in the result changes: the lines keep the samples.
		r.Adaptive = nil
		a, _ := json.Marshal(r)
		b, _ := json.Marshal(uniform)
		if string(a) != string(b) {
			t.Fatalf("%s: refinement changed the rest of the result", mode)
		}
	}
}

// Chords of length 2 along the inward normals of the ellipse
// (2 cos t, sin t) envelope its evolute, whose point on each chord is the
// center of curvature, ρ = w³/2 along it for w = √(cos² t + 4 sin² t).
// Where ρ > 2 the point lies beyond the chord and is virtual.
func ellipseNormalChords() Request {
	q := linesRequest("2*cos(t)", "sin(t)", 0, 2*math.Pi, chords(
		"2*cos(t) - 2*cos(t)/sqrt(cos(t)^2 + 4*sin(t)^2)",
		"sin(t) - 4*sin(t)/sqrt(cos(t)^2 + 4*sin(t)^2)",
	))
	q.Samples = 64
	return q
}

func normalChordVirtual(s float64) (bool, float64) {
	w := math.Sqrt(math.Pow(math.Cos(s), 2) + 4*math.Pow(math.Sin(s), 2))
	rho := w * w * w / 2
	return rho > 2, rho - 2
}

// Every refined point of a chord envelope says whether it is virtual, and
// each change between the solid and dashed parts is localized to the finest
// step.
func TestRefinementMarksVirtualChordPoints(t *testing.T) {
	q := ellipseNormalChords()
	r := compute(t, adaptive(q))
	path := r.Adaptive.Derived
	checkRefined(t, q, path, r.Derived, ellipseEvolute)
	if len(path.Virtual) != len(path.Points) {
		t.Fatalf("%d virtual flags for %d points", len(path.Virtual), len(path.Points))
	}
	ts := positions(q, path)
	changes := 0
	for k := range path.Points {
		if want, margin := normalChordVirtual(ts[k]); math.Abs(margin) > 1e-6 && path.Virtual[k] != want {
			t.Fatalf("point %d at t = %g: virtual %v", k, ts[k], path.Virtual[k])
		}
		if u := path.At[k]; u == math.Trunc(u) && path.Virtual[k] != r.Virtual[int(u)] {
			t.Fatalf("sample %d: virtual %v, the samples say %v", int(u), path.Virtual[k], r.Virtual[int(u)])
		}
		if k > 0 && path.Virtual[k] != path.Virtual[k-1] {
			changes++
			if w := path.At[k] - path.At[k-1]; w > math.Ldexp(1, -refine.Depth) {
				t.Fatalf("virtual from t = %g to %g: not localized (%g steps)", ts[k-1], ts[k], w)
			}
			if _, margin := normalChordVirtual((ts[k] + ts[k-1]) / 2); math.Abs(margin) > 1e-3 {
				t.Fatalf("virtual changes at t = %g, where ρ − 2 = %g", (ts[k]+ts[k-1])/2, margin)
			}
		}
	}
	if changes != 4 {
		t.Fatalf("virtual changes %d times, want 4", changes)
	}
}

// Lines through (t, 0) at the direction angle θ = π/4 + (t − c)² turn
// parallel where θ′ = 0, at c between samples: the touching point
// λ = sin θ/θ′ along each line runs off to infinity, ahead on one side and
// behind on the other. The samples join the two across the view;
// refinement breaks the envelope there once.
func TestRefinementBreaksALineEnvelopeAtAPole(t *testing.T) {
	q := linesRequest("t", "0", -1, 1, EnvelopeFamily{Mode: "angle", Angle: "pi/4 + (t - 0.0131)^2"})
	q.Samples = 64
	r := compute(t, adaptive(q))
	for i, p := range r.Derived {
		if p == nil {
			t.Fatalf("uniform envelope already open at sample %d", i)
		}
	}
	path := r.Adaptive.Derived
	if path == nil || path.Breaks != 1 {
		t.Fatalf("envelope not broken once: %+v", path)
	}
	checkUniform(t, path, r.Derived)
	for k, p := range path.Points {
		if p == nil {
			if x := param(q, path.At[k]); math.Abs(x-0.0131) > 2.0/63 {
				t.Fatalf("break at %g, far from the pole", x)
			}
		}
	}
}

// ringPoints are the touching points of the circle of radius R centered at
// c, from the analytic derivatives dc and dR: q = R(−kT ± √(1 − k²) JT)
// with k = R′/|c′|, left of travel first.
func ringPoints(c, dc Vec, R, dR float64) (Vec, Vec) {
	v := dc.Norm()
	T := dc.Mul(1 / v)
	k := dR / v
	along, across := T.Mul(-R*k), T.Perp().Mul(R*math.Sqrt(1-k*k))
	return c.Add(along).Add(across), c.Add(along).Sub(across)
}

// Circles of constant radius 0.9 on the ellipse envelope its offsets ±0.9.
// The inner one, farther inward than the smallest radius of curvature, folds
// into two swallowtails that the samples cut short.
func TestRefinementOfACircleEnvelope(t *testing.T) {
	q := circlesRequest("2*cos(t)", "sin(t)", 0, 2*math.Pi, "0.9")
	q.Samples = 64
	uniform := compute(t, q)
	r := compute(t, adaptive(q))
	if r.Adaptive.Derived != nil || len(r.Adaptive.Family) != 2 {
		t.Fatalf("want two refined branches and no single derived curve: %+v", r.Adaptive)
	}
	checkRefined(t, q, r.Adaptive.Family[0], r.Family[0].Points, ellipseOffset(0.9))
	right := r.Adaptive.Family[1]
	checkUniform(t, right, r.Family[1].Points)
	if e := chordError(right.Points, positions(q, right), ellipseOffset(-0.9)); e > 1.5*right.Tolerance {
		t.Fatalf("right branch: refined chord error %g exceeds %g", e, right.Tolerance)
	}
	r.Adaptive = nil
	a, _ := json.Marshal(r)
	b, _ := json.Marshal(uniform)
	if string(a) != string(b) {
		t.Fatal("refinement changed the rest of the result")
	}
}

// Circles of a varying radius: every refined point of each branch is the
// touching point the analytic derivatives give, and each branch follows
// its closed form to within the tolerance.
func TestRefinementOfCirclesOfVaryingRadius(t *testing.T) {
	q := circlesRequest("2*cos(t)", "sin(t)", 0, 2*math.Pi, "0.5+0.3*sin(3*t)")
	q.Samples = 64
	r := compute(t, adaptive(q))
	if len(r.Adaptive.Family) != 2 {
		t.Fatalf("%d refined branches, want 2", len(r.Adaptive.Family))
	}
	for side, path := range r.Adaptive.Family {
		exact := func(s float64) Vec {
			c, dc := Vec{2 * math.Cos(s), math.Sin(s)}, Vec{-2 * math.Sin(s), math.Cos(s)}
			left, right := ringPoints(c, dc, 0.5+0.3*math.Sin(3*s), 0.9*math.Cos(3*s))
			return [2]Vec{left, right}[side]
		}
		checkUniform(t, path, r.Family[side].Points)
		if path.Inserted == 0 || path.Breaks != 0 || path.Unresolved != 0 {
			t.Fatalf("branch %d not refined cleanly: %+v", side, path)
		}
		ts := positions(q, path)
		for k, p := range path.Points {
			if p != nil && p.Sub(exact(ts[k])).Norm() > path.Tolerance/2 {
				t.Fatalf("branch %d point %d at t = %g is %v, want %v", side, k, ts[k], *p, exact(ts[k]))
			}
		}
		if e := chordError(path.Points, ts, exact); e > 1.5*path.Tolerance {
			t.Fatalf("branch %d: refined chord error %g exceeds %g", side, e, path.Tolerance)
		}
	}
}

// Envelopes stay broken where their input breaks between samples: here
// lines and circles on the pedal curve of a hyperbola, which passes
// continuously below its asymptote while the hyperbola has a pole.
func TestRefinementBreaksAnEnvelopeWhereItsBaseBreaks(t *testing.T) {
	gap := func(p *RefinedPath) int {
		for k, q := range p.Points {
			if q == nil {
				return int(p.At[k])
			}
		}
		return -1
	}
	for _, family := range []EnvelopeFamily{{Mode: "angle", Angle: "t"}, {Mode: "circle", Radius: "0.05"}} {
		q := linesRequest("t", "1/(t - 0.0131)", -1, 1, family)
		q.Samples, q.Input, q.Pole = 64, "pedal", Vec{0.5, 0.5}
		r := compute(t, adaptive(q))
		g := gap(r.Adaptive.Base)
		if g < 0 || gap(r.Adaptive.Input) != g {
			t.Fatalf("%s: base broken in interval %d, its pedal input in %d", family.Mode, g, gap(r.Adaptive.Input))
		}
		paths := r.Adaptive.Family
		if family.Mode != "circle" {
			paths = []*RefinedPath{r.Adaptive.Derived}
		}
		if len(paths) == 0 {
			t.Fatalf("%s: envelope not refined", family.Mode)
		}
		for k, path := range paths {
			if path == nil || gap(path) != g {
				t.Fatalf("%s: envelope path %d broken elsewhere than the base, in %d", family.Mode, k, g)
			}
		}
	}
}

// Between samples an envelope is undefined wherever a sample would be, and
// virtual wherever a sample would be: evaluated at each sample, each path
// returns exactly the uniform study's point and flag, including where
// chords' endpoints coincide, where circles nest, have no radius or stand
// still, and on a derived input.
func TestRefinedEnvelopesAgreeWithTheSamples(t *testing.T) {
	// Chords from angle t to 4t on the unit circle, whose endpoints
	// coincide at multiples of 2π/3, which are samples.
	coincident := linesRequest("cos(t)", "sin(t)", 0, 2*math.Pi, chords("cos(4*t)", "sin(4*t)"))
	coincident.Samples = 64
	extended := ellipseNormalChords()
	extended.Envelope.Extend = true
	swelling := circlesRequest("t", "0", -2*math.Pi, 2*math.Pi, "1.6+1.2*sin(t)")
	swelling.Samples = 64
	// Circles centered on (t³, 0) stand still at t = 0, and have no
	// radius for t ≤ −0.5.
	still := circlesRequest("t^3", "0", -1, 1, "t + 0.5 + 0.1*cos(9*t)")
	still.Samples = 65
	// A corner of the curve a quarter of the stencil's spacing past the
	// sample at 0, where its tangent fails the half-step check and the
	// sample has no envelope.
	cornerLines := linesRequest("t", "abs(t - 0.00005)", -1, 1, EnvelopeFamily{Mode: "angle", Angle: "t"})
	cornerLines.Samples = 65
	cornerCircles := circlesRequest("t", "abs(t - 0.00005)", -1, 1, "0.3+0.1*t")
	cornerCircles.Samples = 65
	input := ellipseNormalChords()
	input.Envelope, input.Input, input.Distance = EnvelopeFamily{Mode: "angle", Angle: "2*t"}, "offset", 0.3
	ringsInput := input
	ringsInput.Envelope = EnvelopeFamily{Mode: "circle", Radius: "0.2+0.1*cos(2*t)"}
	cases := map[string]Request{
		"ladder chords":          ladderRequest("chord"),
		"ladder lines":           ladderRequest("angle"),
		"virtual chords":         ellipseNormalChords(),
		"extended chords":        extended,
		"coincident chords":      coincident,
		"nested circles":         swelling,
		"stationary circles":     still,
		"lines at a corner":      cornerLines,
		"circles at a corner":    cornerCircles,
		"lines on an offset":     input,
		"circles on an offset":   ringsInput,
		"circles of one radius":  circlesRequest("2*cos(t)", "sin(t)", 0, 2*math.Pi, "0.9"),
		"circles of many radii":  circlesRequest("2*cos(t)", "sin(t)", 0, 2*math.Pi, "0.5+0.3*sin(3*t)"),
		"lines through a pole":   linesRequest("t", "0", -1, 1, EnvelopeFamily{Mode: "angle", Angle: "pi/4 + (t - 0.0131)^2"}),
		"lines parallel at once": linesRequest("t", "0", -1, 1, EnvelopeFamily{Mode: "angle", Angle: "1"}),
	}
	gaps := map[string]int{}
	virtuals := map[string]int{}
	for name, q := range cases {
		if q.Samples > 65 {
			q.Samples = 64
		}
		r := compute(t, q)
		f, err := compile(q.Curve)
		if err != nil {
			t.Fatal(err)
		}
		g := inputCurve(q.Input, f, q.Curve.Min, q.Curve.Max, q.Pole, q.Distance)
		type evaluated struct {
			points  []*Vec
			virtual []bool
			at      func(float64) (*Vec, bool)
		}
		var paths []evaluated
		if q.Envelope.Mode == "circle" {
			for _, member := range r.Family {
				at := q.memberAt(f, g, &r, member)
				if at == nil {
					t.Fatalf("%s: no evaluator for the %s branch", name, member.Branch)
				}
				paths = append(paths, evaluated{member.Points, nil, func(s float64) (*Vec, bool) { return at(s), false }})
			}
		} else {
			at, marked := q.derivedAt(f, g, &r), q.virtualAt(f, g, &r)
			if at == nil || marked == nil {
				t.Fatalf("%s: no evaluator", name)
			}
			paths = append(paths, evaluated{r.Derived, r.Virtual, func(s float64) (*Vec, bool) {
				p, v := marked(s)
				if o := at(s); (o == nil) != (p == nil) || o != nil && *o != *p {
					t.Fatalf("%s at %g: evaluators disagree, %v and %v", name, s, o, p)
				}
				return p, v
			}})
		}
		if len(paths) == 0 {
			t.Fatalf("%s: no paths", name)
		}
		step := (q.Curve.Max - q.Curve.Min) / float64(q.Samples-1)
		for _, path := range paths {
			for j, want := range path.points {
				got, virtual := path.at(q.Curve.Min + float64(j)*step)
				switch {
				case want != nil && (got == nil || *got != *want):
					t.Fatalf("%s at sample %d: %v, want %v", name, j, got, *want)
				case want == nil && got != nil:
					t.Fatalf("%s at sample %d: %v where the samples have none", name, j, *got)
				case want == nil:
					gaps[name]++
				case path.virtual != nil && virtual != path.virtual[j]:
					t.Fatalf("%s at sample %d: virtual %v, want %v", name, j, virtual, path.virtual[j])
				case virtual:
					virtuals[name]++
				}
			}
		}
	}
	for _, name := range []string{"coincident chords", "nested circles", "stationary circles", "lines parallel at once", "lines at a corner", "circles at a corner"} {
		if gaps[name] == 0 {
			t.Fatalf("%s: no gaps to compare: %v", name, gaps)
		}
	}
	if virtuals["virtual chords"] == 0 || virtuals["extended chords"] != 0 {
		t.Fatalf("virtual samples: %v", virtuals)
	}
}
