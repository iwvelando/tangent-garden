package engine3

import (
	"math"
	"reflect"
	"strings"
	"testing"
)

// stranded builds c's construction on the offset strand r + dD of its base,
// D at angle θ₀ in the base's rotation-minimizing frame, twisted N turns.
func stranded(c Request, offset, angle, twist float64) Request {
	c.Input = "strand"
	c.Strand = StrandRequest{Offset: offset, Angle: angle, Twist: twist}
	return c
}

// unitRing is the unit circle as an analytic harmonic curve.
func unitRing() Request {
	return harmonicStudy(0, 2*math.Pi, Vec3{}, HarmonicTerm{Frequency: 1, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1, 0}})
}

// The unit circle is planar, so its transported normal is the axis e_z and
// T × e_z is the outward radius: the strand at angle θ₀ twisted N turns is
// the coil g(u) = (1 + d sin θ)(cos u, sin u, 0) + d cos θ e_z with
// θ = θ₀ + Nu, a torus curve about the circle. Its derivatives are written
// here from that closed form.
func ringCoil(u, d, angle, twist float64) (Vec3, Vec3, Vec3) {
	theta := angle + twist*u
	s, c := math.Sin(theta), math.Cos(theta)
	radial, around := Vec3{math.Cos(u), math.Sin(u), 0}, Vec3{-math.Sin(u), math.Cos(u), 0}
	h, dh, ddh := 1+d*s, d*twist*c, -d*twist*twist*s
	z, dz, ddz := d*c, -d*twist*s, -d*twist*twist*c
	return radial.mul(h).add(Vec3{0, 0, z}),
		around.mul(h).add(radial.mul(dh)).add(Vec3{0, 0, dz}),
		radial.mul(ddh - h).add(around.mul(2 * dh)).add(Vec3{0, 0, ddz})
}

func strandEvaluation(t *testing.T, c Request) (evaluation, func(float64) Vec3, bool, float64, float64) {
	t.Helper()
	base, lo, hi, closed, err := compile(c, nil)
	if err != nil {
		t.Fatal(err)
	}
	curve, tangents, breaks := baseSamples(c, base, lo, hi, c.Samples, closed)
	evaluate, position, closes, err := c.Strand.evaluation(base, lo, hi, curve, tangents, breaks, closed)
	if err != nil {
		t.Fatal(err)
	}
	return evaluate, position, closes, lo, hi
}

func TestStrandInputIsTheRingCoil(t *testing.T) {
	d, angle, twist := 0.3, 0.4, 5.0
	c := stranded(unitRing(), d, angle, twist)
	c.Construction = "developable"
	r := composed(t, c)
	q := r.Composition
	if q.Input != "strand" || q.Cusps != 0 || q.Unreached != 0 || len(q.Constructions) != c.Lines || q.Pole != (Vec3{}) {
		t.Fatalf("composition %+v", q)
	}
	for i, p := range r.Base {
		u := 2 * math.Pi * float64(i) / float64(c.Samples)
		want, _, _ := ringCoil(u, d, angle, twist)
		near(t, p, want, 1e-12)
	}
	// A whole number of turns closes the strand, so the surface joins its
	// ends: no interval is broken.
	for i, broken := range r.Breaks {
		if broken {
			t.Fatalf("interval %d broken on a closed coil", i-1)
		}
	}
	// Each connector is the offset arm from the base point to the strand.
	for _, s := range q.Constructions {
		near(t, s.Contact, q.Curve[s.SampleIndex], 0)
		near(t, s.Foot, s.Contact, 0)
		near(t, s.Image, r.Base[s.SampleIndex], 0)
		if math.Abs(s.Image.sub(s.Contact).norm()-d) > 1e-12 {
			t.Fatalf("arm %d is not d long", s.SampleIndex)
		}
	}
	// Between samples, with its derivatives written from the base's own.
	evaluate, position, closes, _, _ := strandEvaluation(t, c)
	if !closes {
		t.Fatal("a whole number of turns should close the strand")
	}
	for k := 0; k < 97; k++ {
		u := 2 * math.Pi * (float64(k) + 0.37) / 97
		g, v, a, ok := evaluate(u)
		wg, wv, wa := ringCoil(u, d, angle, twist)
		if !ok {
			t.Fatalf("t = %g undefined", u)
		}
		near(t, g, wg, 1e-9)
		near(t, position(u), g, 0)
		near(t, v, wv, 1e-8)
		near(t, a, wa, 1e-5)
	}
}

// A fractional twist leaves the strand open: it ends turned away from where
// it began, and the construction treats the domain as open.
func TestStrandInputOpensWithAFractionalTwist(t *testing.T) {
	d, angle, twist := 0.3, 0.4, 2.5
	c := stranded(unitRing(), d, angle, twist)
	c.Construction = "developable"
	r := composed(t, c)
	n := c.Samples
	end, _, _ := ringCoil(2*math.Pi, d, angle, twist)
	near(t, r.Base[n], end, 1e-12)
	if r.Base[n].sub(*r.Base[0]).norm() < d {
		t.Fatal("the open strand returned to its start")
	}
	if _, _, closes, _, _ := strandEvaluation(t, c); closes {
		t.Fatal("a half turn closed the strand")
	}
}

// At the samples the strand input is the framed construction's own strand
// with the same distance, angle and twist, the reference e_z and the
// correction distributed: on a closed knot whose transported frame does not
// return, on an open stretch of it, across the asymptotes of a curve whose
// arc length is not carried across a break, across a cusp between samples,
// and on a closed loop whose four cusps break it, so no correction applies.
func TestStrandInputIsTheFramedStrand(t *testing.T) {
	open := custom("(2.4+0.85*cos(3*t))*cos(2*t)", "(2.4+0.85*cos(3*t))*sin(2*t)", "0.85*sin(3*t)", 0, 4)
	asymptotes := custom("tan(t)", "cos(t)", "sin(t)", -2, 2)
	asymptotes.Samples = 481
	cusp := custom("t^2", "t^3", "t^4", -1, 1.0005)
	astroid := harmonicStudy(0.1, 0.1+2*math.Pi, Vec3{},
		HarmonicTerm{Frequency: 1, Cosine: Vec3{0.75, 0, 0}, Sine: Vec3{0, 0.75, 0}},
		HarmonicTerm{Frequency: 3, Cosine: Vec3{0.25, 0, 0}, Sine: Vec3{0, -0.25, 0}},
		HarmonicTerm{Frequency: 2, Cosine: Vec3{0, 0, 0.3}, Sine: Vec3{}})
	for _, c := range []Request{study(), open, asymptotes, cusp, astroid} {
		d, angle, twist := 0.4, -0.7, 3.0
		plain := c
		plain.Construction = "framed"
		plain.Frame = FrameRequest{Kind: "rotation-minimizing", Reference: Vec3{0, 0, 1}, Angle: angle, Twist: twist, Offset: d, Strands: 1, Closure: "distribute"}
		want := framed(t, plain)
		if (c.Format == "") != (want.Frame.Correction != 0) || c.Format == "harmonic" && want.Frame.Pieces != 5 {
			t.Fatalf("%s: %d pieces, correction %g", c.Format, want.Frame.Pieces, want.Frame.Correction)
		}
		s := stranded(c, d, angle, twist)
		s.Construction = "developable"
		r := composed(t, s)
		for i, p := range r.Base {
			if (p == nil) != (want.Frame.Strands[0][i] == nil) {
				t.Fatalf("%s: sample %d: %v, framed %v", c.Format, i, p, want.Frame.Strands[0][i])
			}
			if p != nil {
				near(t, p, want.Frame.Strands[0][i], 1e-12)
			}
		}
	}
}

// The evaluator writes g′ and g″ from the base's derivatives and the
// frame's transport law, not by differencing g: they must match central
// differences of the positions it returns, on an expression knot, an
// analytic knot and an open curve, between samples and across them.
func TestStrandInputDerivativesMatchItsPositions(t *testing.T) {
	for _, c := range []Request{
		stranded(custom("2*cos(t)", "sin(2*t)", "0.7*sin(3*t)", 0, 2*math.Pi), 0.3, 1, 4),
		stranded(study(), 0.5, 0.2, -2.5),
		stranded(custom("t", "t^2/2", "t^3/6", -1.5, 1.5), 0.2, 0, 3),
	} {
		evaluate, _, _, lo, hi := strandEvaluation(t, c)
		const h = 1e-4
		checked := 0
		for k := 1; k < 53; k++ {
			u := lo + (hi-lo)*float64(k)/53
			p, v, a, ok := evaluate(u)
			pm, _, _, okm := evaluate(u - h)
			pp, _, _, okp := evaluate(u + h)
			if !ok || !okm || !okp || !a.valid() {
				continue
			}
			dv := pp.sub(pm).mul(1 / (2 * h))
			da := pp.sub(p.mul(2)).add(pm).mul(1 / (h * h))
			if dv.sub(v).norm() > 1e-5*(1+v.norm()) || da.sub(a).norm() > 1e-3*(1+a.norm()) {
				t.Fatalf("%s at t = %g: g′ %+v ≈ %+v, g″ %+v ≈ %+v", c.Curve.X, u, v, dv, a, da)
			}
			checked++
		}
		if checked < 45 {
			t.Fatalf("%s: only %d parameters checked", c.Curve.X, checked)
		}
	}
}

// Untwisted, the strand inside an ellipse is its parallel curve at distance
// d, which has four cusps where d crosses the radius of curvature
// (b²/a ≤ ρ ≤ a²/b); twisted, it coils around the ellipse and is regular
// everywhere, since g′ always has a component dωσ along T × D.
func TestStrandInputCuspsOnlyUntwisted(t *testing.T) {
	ellipse := custom("2*cos(t)", "sin(t)", "0", 0, 2*math.Pi)
	ellipse.Samples = 960
	inward := stranded(ellipse, 1, -math.Pi/2, 0)
	inward.Construction = "developable"
	if r := composed(t, inward); r.Composition.Cusps != 4 {
		t.Fatalf("%d cusps on the ellipse's parallel curve", r.Composition.Cusps)
	}
	coiled := stranded(ellipse, 1, -math.Pi/2, 6)
	coiled.Construction = "developable"
	r := composed(t, coiled)
	if r.Composition.Cusps != 0 {
		t.Fatalf("%d cusps on a coiled strand", r.Composition.Cusps)
	}
	for i, p := range r.Base {
		if p == nil {
			t.Fatalf("coiled strand sample %d missing", i)
		}
	}
}

// The strand breaks wherever the base does and its frame starts again from
// e_z after each break: every regular sample has a strand point, none is
// unreached, and the first sample of each stretch, untwisted at θ₀ = 0, is
// offset along e_z projected onto the normal plane.
func TestStrandInputRestartsAfterBreaks(t *testing.T) {
	c := stranded(custom("tan(t)", "cos(t)", "sin(t)", -2, 2), 0.25, 0, 0)
	c.Samples, c.Construction = 481, "developable"
	r := composed(t, c)
	q := r.Composition
	if q.Unreached != 0 {
		t.Fatalf("%d unreached", q.Unreached)
	}
	starts := 0
	for i, p := range q.Curve {
		if (p == nil) != (r.Base[i] == nil) {
			t.Fatalf("sample %d: base %v, strand %v", i, p, r.Base[i])
		}
		if p == nil || i > 0 && q.Curve[i-1] != nil && !q.Breaks[i] {
			continue
		}
		u := at(c, i)
		tangent := Vec3{1 / (math.Cos(u) * math.Cos(u)), -math.Sin(u), math.Cos(u)}.unit()
		up := Vec3{0, 0, 1}
		want := p.add(up.sub(tangent.mul(tangent.dot(up))).unit().mul(0.25))
		near(t, r.Base[i], want, 1e-6)
		starts++
	}
	if starts != 3 {
		t.Fatalf("%d stretches started", starts)
	}
	for i, broken := range q.Breaks {
		if broken && !r.Breaks[i] {
			t.Fatalf("base break %d does not break the strand", i)
		}
	}
}

// Every construction that takes an input acts on the strand, and the pole,
// which the strand does not use, neither frames the study nor is validated.
func TestEveryConstructionActsOnTheStrand(t *testing.T) {
	d, angle, twist := 0.3, 0.4, 5.0
	c := stranded(unitRing(), d, angle, twist)
	c.Pole = Vec3{0, 0, 1000}
	c.Frame = frameRequest()
	c.Ruled = RuledRequest{Partner: "chord", Rate: 1, Shift: 1}
	c.Canal = CanalRequest{Radius: 0.05, Profile: "1", Meridians: 4}
	c.Involute = InvoluteRequest{Anchor: 0, Offset: 0.5}
	for _, construction := range []string{"developable", "involute", "framed", "ruled", "canal"} {
		c.Construction = construction
		if construction == "canal" {
			c.Frame = FrameRequest{Kind: "rotation-minimizing", Reference: Vec3{0, 0, 1}, Closure: "distribute"}
		}
		r := composed(t, c)
		for i, p := range r.Base {
			want, _, _ := ringCoil(2*math.Pi*float64(i)/float64(c.Samples), d, angle, twist)
			near(t, p, want, 1e-12)
		}
		if r.Bounds.Radius > 100 {
			t.Fatalf("%s: the pole framed the study: %+v", construction, r.Bounds)
		}
		// A tube around the closed coil closes on itself.
		if construction == "canal" && (!r.Canal.Closed || r.Canal.Gap != 0) {
			t.Fatalf("tube around a closed strand: %+v", r.Canal)
		}
	}
	c.Pole = Vec3{math.NaN(), 0, 2e5}
	composed(t, c)
}

// Translating the base translates the strand: its frame starts from a
// direction, e_z, not a point.
func TestStrandInputTranslation(t *testing.T) {
	c := stranded(custom("2*cos(t)", "sin(2*t)", "0.7*sin(3*t)", 0, 2*math.Pi), 0.3, 1, 4)
	moved := c
	moved.Curve.X, moved.Curve.Y, moved.Curve.Z = "2*cos(t)+1", "sin(2*t)-2", "0.7*sin(3*t)+0.5"
	shift := Vec3{1, -2, 0.5}
	c.Construction, moved.Construction = "developable", "developable"
	a, b := composed(t, c), composed(t, moved)
	for i, p := range a.Base {
		near(t, b.Base[i], p.add(shift), 1e-8)
	}
}

// Refined between samples, a strand coiled forty times round 240 samples
// lies on its closed form, every chord within tolerance where the uniform
// chords stray, and the study is otherwise unchanged.
func TestRefinedStrandInput(t *testing.T) {
	d, angle, twist := 0.3, 0.4, 40.0
	c := stranded(unitRing(), d, angle, twist)
	c.Samples, c.Construction = 240, "developable"
	uniform := composed(t, c)
	r := refinedStudy(t, c)
	refined := r.Adaptive
	r.Adaptive = nil
	if !reflect.DeepEqual(r, uniform) {
		t.Fatal("refining the strand input changed the study")
	}
	if refined.Base == nil || refined.Parent == nil || refined.Base.Inserted == 0 {
		t.Fatalf("strand input not refined: %+v", refined)
	}
	path := refined.Base
	checkPath(t, path, r.Base, r.Breaks)
	curve := func(u float64) Vec3 { g, _, _ := ringCoil(u, d, angle, twist); return g }
	for k, p := range path.Points {
		near(t, p, curve(2*math.Pi*path.At[k]/float64(c.Samples)), 1e-9)
	}
	coarse := chordError(r.Base, uniformAt(c.Samples), curve, 0, 2*math.Pi, c.Samples)
	fine := chordError(path.Points, path.At, curve, 0, 2*math.Pi, c.Samples)
	if coarse < 4*path.Tolerance || fine > 1.5*path.Tolerance || path.Unresolved != 0 || path.Breaks != 0 {
		t.Fatalf("uniform error %g, refined %g, tolerance %g", coarse, fine, path.Tolerance)
	}
}

// The strand's settings are read only for the strand input.
func TestStrandIgnoredForOtherInputs(t *testing.T) {
	for _, input := range []string{"base", "tangent-foot", "involute"} {
		c := study()
		c.Construction, c.Input, c.Pole = "developable", input, Vec3{0.4, -0.3, 0.9}
		c.Unwinding = UnwindingRequest{Anchor: 1, Offset: 2}
		want, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		c.Strand = StrandRequest{Offset: math.NaN(), Angle: 1e9, Twist: -1e9}
		got, err := Compute(c)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: the strand changed the result (%v)", input, err)
		}
	}
}

func TestStrandInputValidation(t *testing.T) {
	c := stranded(unitRing(), 0.3, 0.4, 5)
	c.Construction = "developable"
	for _, q := range []struct {
		strand  StrandRequest
		message string
	}{
		{StrandRequest{Offset: -0.1}, "strand's distance"},
		{StrandRequest{Offset: math.NaN()}, "strand's distance"},
		{StrandRequest{Offset: 2e5}, "strand's distance"},
		{StrandRequest{Offset: 1, Angle: math.Inf(1)}, "strand's angle"},
		{StrandRequest{Offset: 1, Angle: 1001}, "strand's angle"},
		{StrandRequest{Offset: 1, Twist: 101}, "strand's twist"},
		{StrandRequest{Offset: 1, Twist: math.NaN()}, "strand's twist"},
	} {
		c.Strand = q.strand
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), q.message) {
			t.Fatalf("%+v: %v", q.strand, err)
		}
	}
	// A strand that stands still has nothing to build on: inside the unit
	// circle at its radius, untwisted, every point is the center.
	c.Strand = StrandRequest{Offset: 1, Angle: -math.Pi / 2}
	if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "strand") {
		t.Fatalf("collapsed strand: %v", err)
	}
}
