package engine3

import (
	"math"
	"reflect"
	"testing"
)

// The test's own trefoil velocity, written independently of knot().
func trefoilVelocity(c Request, t float64) Vec3 {
	p, q := float64(c.P), float64(c.Q)
	h := c.Radius + c.Tube*math.Cos(q*t)
	dh := -c.Tube * q * math.Sin(q*t)
	return Vec3{dh*math.Cos(p*t) - p*h*math.Sin(p*t), dh*math.Sin(p*t) + p*h*math.Cos(p*t), c.Tube * q * math.Cos(q*t)}
}

// trefoilArc is the trefoil's arc length from a to b by 16-point
// Gauss–Legendre quadrature on 64 pieces, independent of the engine's
// Simpson steps.
func trefoilArc(c Request, a, b float64) float64 {
	nodes := [8]float64{0.0950125098376374, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.7554044083550030, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499}
	weights := [8]float64{0.1894506104550685, 0.1826034150449236, 0.1691565193950025, 0.1495959888165767, 0.1246289712555339, 0.0951585116824928, 0.0622535239386479, 0.0271524594117541}
	sum := 0.0
	for k := range 64 {
		lo, hi := a+(b-a)*float64(k)/64, a+(b-a)*float64(k+1)/64
		middle, half := (lo+hi)/2, (hi-lo)/2
		for j, x := range nodes {
			for _, side := range []float64{-1, 1} {
				sum += weights[j] * half * trefoilVelocity(c, middle+side*half*x).norm()
			}
		}
	}
	return sum
}

// The quadrature itself: a circle's arc length is its radius times the
// angle, and the trefoil's quarter periods add up to the whole.
func TestTrefoilArcQuadrature(t *testing.T) {
	c := study()
	c.Tube = 0
	if got := trefoilArc(c, 0.3, 1.7); math.Abs(got-c.Radius*float64(c.P)*1.4) > 1e-12 {
		t.Fatalf("circle arc %g", got)
	}
	c = study()
	whole := trefoilArc(c, 0, 2*math.Pi)
	parts := 0.0
	for k := range 4 {
		parts += trefoilArc(c, float64(k)*math.Pi/2, float64(k+1)*math.Pi/2)
	}
	if math.Abs(whole-parts) > 1e-10*whole {
		t.Fatalf("whole %g, parts %g", whole, parts)
	}
}

func trefoilInvolute(c Request, u, anchor, offset float64) Vec3 {
	s := trefoilArc(c, anchor, u)
	return trefoilAt(c, u).add(trefoilVelocity(c, u).unit().mul(offset - s))
}

// A helix's involute is an unwound circle in closed form (helixInvolute),
// and its arc length is linear, so every refined point lies on it however
// long the string. The anchor falls between samples.
func TestRefinedHelixInvoluteFamily(t *testing.T) {
	c := helixStudy()
	c.Samples = 240
	c.Construction = "involute"
	anchor := 0.7
	c.Involute = InvoluteRequest{Anchor: anchor, Family: InvoluteFamily{Enabled: true, From: -4, To: 6, Count: 3}}
	uniform := involute(t, c)
	r := refinedStudy(t, c)
	paths := r.Adaptive.Involute
	if len(paths) != 3 {
		t.Fatalf("%d refined members, want 3", len(paths))
	}
	refined := r.Adaptive
	r.Adaptive = nil
	if !reflect.DeepEqual(r, uniform) {
		t.Fatal("refining a helix's involutes changed the study")
	}
	inserted := 0
	for m, path := range paths {
		member := r.Involute.Members[m]
		checkPath(t, path, member.Points, r.Breaks)
		for k, p := range path.Points {
			u := c.Curve.Min + (c.Curve.Max-c.Curve.Min)*path.At[k]/float64(c.Samples)
			near(t, p, helixInvolute(u, anchor, member.Offset), 1e-8)
		}
		curve := func(u float64) Vec3 { return helixInvolute(u, anchor, member.Offset) }
		coarse := chordError(member.Points, uniformAt(c.Samples), curve, c.Curve.Min, c.Curve.Max, c.Samples)
		fine := chordError(path.Points, path.At, curve, c.Curve.Min, c.Curve.Max, c.Samples)
		if coarse < path.Tolerance {
			t.Fatalf("member %d: uniform error %g is already within %g", m, coarse, path.Tolerance)
		}
		if fine > 1.5*path.Tolerance || path.Unresolved != 0 || path.Breaks != 0 {
			t.Fatalf("member %d: refined error %g against tolerance %g, %+v", m, fine, path.Tolerance, *path)
		}
		inserted += path.Inserted
	}
	if refined.Base == nil || inserted == 0 {
		t.Fatal("the helix and its involutes are both refined")
	}
}

// A trefoil's involute against an independent arc length: points between
// samples lie no farther from the true involute than the samples do, and
// the refined chords follow it through the cusp where the string runs out.
func TestRefinedTrefoilInvolute(t *testing.T) {
	c := study()
	c.Samples = 240
	c.Construction = "involute"
	anchor, offset := 1.03, 3.5
	c.Involute = InvoluteRequest{Anchor: anchor, Offset: offset}
	r := refinedStudy(t, c)
	member := r.Involute.Members[0]
	path := r.Adaptive.Involute[0]
	checkPath(t, path, member.Points, r.Breaks)
	at := func(u float64) float64 { return 2 * math.Pi * u / float64(c.Samples) }
	sampled := 0.0
	for i, p := range member.Points {
		sampled = math.Max(sampled, p.sub(trefoilInvolute(c, at(float64(i)), anchor, offset)).norm())
	}
	between := 0.0
	for k, p := range path.Points {
		if path.At[k] != math.Trunc(path.At[k]) {
			between = math.Max(between, p.sub(trefoilInvolute(c, at(path.At[k]), anchor, offset)).norm())
		}
	}
	if path.Inserted == 0 || between > 2*sampled+1e-12 || sampled > 1e-6 {
		t.Fatalf("%d inserted; between samples %g from the involute, samples %g", path.Inserted, between, sampled)
	}
	curve := func(u float64) Vec3 { return trefoilInvolute(c, u, anchor, offset) }
	coarse := chordError(member.Points, uniformAt(c.Samples), curve, 0, 2*math.Pi, c.Samples)
	fine := chordError(path.Points, path.At, curve, 0, 2*math.Pi, c.Samples)
	if coarse < 2*path.Tolerance || fine > 1.5*path.Tolerance {
		t.Fatalf("uniform error %g, refined %g, tolerance %g", coarse, fine, path.Tolerance)
	}
}

// Members are refined only where their arc length reaches: nothing past a
// break of the base, and each member broken where the base is.
func TestRefinedInvoluteStopsWhereItsArcLengthDoes(t *testing.T) {
	c := involuteStudy("t", "1/(t-1.5)", "0.1*t^2", -2, 3, -1, 0.5)
	c.Samples = 240
	uniform := involute(t, c)
	if uniform.Involute.Unreached == 0 {
		t.Fatal("the pole should leave samples unreached")
	}
	r := refinedStudy(t, c)
	path := r.Adaptive.Involute[0]
	member := r.Involute.Members[0]
	checkPath(t, path, member.Points, r.Breaks)
	for k, p := range path.Points {
		i := int(math.Floor(path.At[k]))
		if p != nil && member.Points[i] == nil {
			t.Fatalf("point drawn at %g, past the arc length's stop", path.At[k])
		}
	}
	if path.Inserted == 0 {
		t.Fatal("the reached stretch is not refined")
	}
}

// The involute input is evaluated between samples by its own evaluator:
// refined, it lies on the helix's involute, and the base beneath it is
// refined too.
func TestRefinedInvoluteInput(t *testing.T) {
	anchor, offset := 0.7, 1.3
	c := unwound(helixStudy(), anchor, offset)
	c.Samples = 240
	c.Construction = "developable"
	uniform := composed(t, c)
	r := refinedStudy(t, c)
	refined := r.Adaptive
	r.Adaptive = nil
	if !reflect.DeepEqual(r, uniform) {
		t.Fatal("refining a helix's involute input changed the study")
	}
	if refined.Base == nil || refined.Parent == nil || refined.Base.Inserted == 0 {
		t.Fatalf("involute input not refined: %+v", refined)
	}
	checkPath(t, refined.Base, r.Base, r.Breaks)
	for k, p := range refined.Base.Points {
		if p == nil {
			continue // the cusp where the string runs out
		}
		near(t, p, helixInvolute(at(c, 0)+(c.Curve.Max-c.Curve.Min)*refined.Base.At[k]/float64(c.Samples), anchor, offset), 1e-8)
	}
	curve := func(u float64) Vec3 { return helixInvolute(u, anchor, offset) }
	fine := chordError(refined.Base.Points, refined.Base.At, curve, c.Curve.Min, c.Curve.Max, c.Samples)
	if fine > 1.5*refined.Base.Tolerance {
		t.Fatalf("refined error %g against tolerance %g", fine, refined.Base.Tolerance)
	}
}

// An involute of an involute: both the input and the construction's
// filament are refined. The helix's involute I₁ (string c₁ from t₁) runs
// at speed a|c₁ − w(u − t₁)|/w along −(cos u, sin u, 0) before its cusp,
// so its own involute from t₂ with string c₂ is
// I₁ + (c₂ − S)(−cos u, −sin u, 0), with S = (a/w)[g(u) − g(t₂)] and
// g(v) = c₁v − w(v − t₁)²/2.
func TestRefinedInvoluteOfAnInvolute(t *testing.T) {
	t1, c1, t2, c2 := 0.7, 1.3, 0.2, 0.5
	c := unwound(helixStudy(), t1, c1)
	c.Samples = 240
	c.Construction = "involute"
	c.Involute = InvoluteRequest{Anchor: t2, Offset: c2}
	r := refinedStudy(t, c)
	if r.Adaptive.Base == nil || len(r.Adaptive.Involute) != 1 {
		t.Fatal("involute of an involute not refined")
	}
	g := func(v float64) float64 { return c1*v - helixW*(v-t1)*(v-t1)/2 }
	want := func(u float64) Vec3 {
		s := helixA / helixW * (g(u) - g(t2))
		return helixInvolute(u, t1, c1).add(Vec3{-math.Cos(u), -math.Sin(u), 0}.mul(c2 - s))
	}
	member := r.Involute.Members[0]
	path := r.Adaptive.Involute[0]
	checkPath(t, path, member.Points, r.Breaks)
	position := func(u float64) float64 { return c.Curve.Min + (c.Curve.Max-c.Curve.Min)*u/float64(c.Samples) }
	sampled, between := 0.0, 0.0
	for i, p := range member.Points {
		if p != nil {
			sampled = math.Max(sampled, p.sub(want(position(float64(i)))).norm())
		}
	}
	for k, p := range path.Points {
		if p != nil && path.At[k] != math.Trunc(path.At[k]) {
			between = math.Max(between, p.sub(want(position(path.At[k]))).norm())
		}
	}
	if path.Inserted == 0 || sampled > 1e-5 || between > 2*sampled+1e-9 {
		t.Fatalf("%d inserted; between samples %g from the closed form, samples %g", path.Inserted, between, sampled)
	}
}

// The involute input's position alone, which refinement evaluates, is the
// point the sample loop draws, bit for bit, and undefined exactly where the
// samples are: on an expression knot and an analytic one, and past a pole.
func TestInvoluteInputPositionIsTheSamples(t *testing.T) {
	for _, c := range []Request{
		unwound(custom("2*cos(t)", "sin(2*t)", "0.7*sin(3*t)", 0, 2*math.Pi), 1, 0.5),
		unwound(study(), 1, 2),
		unwound(custom("t", "1/(t-1.5)", "0.1*t^2", -2, 3), -1, 0.5),
	} {
		c.Construction = "developable"
		r := composed(t, c)
		base, lo, hi, closed, err := compile(c, nil)
		if err != nil {
			t.Fatal(err)
		}
		curve, _, breaks := baseSamples(c, base, lo, hi, c.Samples, closed)
		_, position, _, _, err := c.Unwinding.evaluation(base, lo, hi, curve, breaks)
		if err != nil {
			t.Fatal(err)
		}
		missing := 0
		for i, p := range r.Base {
			n := float64(c.Samples)
			q := position(lo*(1-float64(i)/n) + hi*float64(i)/n)
			if p == nil {
				missing++
				if q.valid() {
					t.Fatalf("%s: position at missing sample %d", c.Format, i)
				}
				continue
			}
			if q != *p {
				t.Fatalf("%s: sample %d at %+v, position %+v", c.Format, i, *p, q)
			}
		}
		if c.Format == "parametric" && c.Curve.Max == 3 && missing == 0 {
			t.Fatal("the pole should leave samples unreached")
		}
	}
}
