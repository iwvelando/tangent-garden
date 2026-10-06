package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// The curve probe between samples: the curve a construction acts on, and
// the construction, described at any parameter of the domain, against
// closed forms evaluated here, and at a sample exactly as the per-sample
// diagnostics and the study's own arrays describe it.

func curveProbe(t *testing.T, c Request, at ProbeQuery) (Result, *ProbePoint) {
	t.Helper()
	c.Diagnostics = true
	c.Probe = &at
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.CurveProbe == nil {
		t.Fatal("no probe")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	return r, r.CurveProbe
}

func probeAt(t *testing.T, c Request, s float64) *ProbePoint {
	t.Helper()
	_, p := curveProbe(t, c, ProbeQuery{T: &s})
	if p.T != s {
		t.Fatalf("probe at t = %g, asked %g", p.T, s)
	}
	return p
}

// probeOnlyAt is ProbeOnly's probe at t.
func probeOnlyAt(t *testing.T, c Request, s float64) *ProbePoint {
	t.Helper()
	c.Probe = &ProbeQuery{T: &s}
	p, err := ProbeOnly(c)
	if err != nil {
		t.Fatal(err)
	}
	if p.T != s {
		t.Fatalf("probe at t = %g, asked %g", p.T, s)
	}
	return p
}

// knotAt is sample i's parameter as the sampling loop places it.
func knotAt(c Request, lo, hi float64, i int) float64 {
	n := float64(c.Samples)
	return lo*(1-float64(i)/n) + hi*float64(i)/n
}

// Parameters strictly between samples, away from the ends.
func betweenSamples(c Request, lo, hi float64) []float64 {
	var ts []float64
	for _, u := range []float64{0.0137, 0.2291, 0.4003, 0.5555, 0.7771, 0.9419} {
		j := float64(c.Samples) * u
		if j == math.Floor(j) {
			panic("a test parameter fell on a sample")
		}
		ts = append(ts, lo+u*(hi-lo))
	}
	return ts
}

func sameVec(t *testing.T, what string, a, b *Vec3) {
	t.Helper()
	if (a == nil) != (b == nil) || (a != nil && *a != *b) {
		t.Fatalf("%s: %v, want %v", what, a, b)
	}
}

func sameNumber(t *testing.T, what string, a, b *float64) {
	t.Helper()
	if (a == nil) != (b == nil) || (a != nil && *a != *b) {
		t.Fatalf("%s: %v, want %v", what, deref(a), deref(b))
	}
}

func deref(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

func closeVec3(t *testing.T, what string, got *Vec3, want Vec3, tol float64) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s: missing, want %+v", what, want)
	}
	if got.sub(want).norm() > tol {
		t.Fatalf("%s: %+v, want %+v (tolerance %g)", what, *got, want, tol)
	}
}

func closeNumber(t *testing.T, what string, got *float64, want, tol float64) {
	t.Helper()
	if got == nil || math.Abs(*got-want) > tol {
		t.Fatalf("%s: %v, want %g (tolerance %g)", what, deref(got), want, tol)
	}
}

func TestCurveProbeIsAbsentUnlessAsked(t *testing.T) {
	c := study()
	c.Diagnostics = true
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.CurveProbe != nil {
		t.Fatal("a probe nobody asked for")
	}
	b, _ := json.Marshal(r)
	if strings.Contains(string(b), `"probe"`) {
		t.Fatal("the result names a probe nobody asked for")
	}
}

// probeStudies are a study of each construction the probe highlights, on
// each kind of curve it describes.
func probeStudies() map[string]Request {
	helix := helixStudy()
	tangentFoot := helixStudy()
	tangentFoot.Construction, tangentFoot.Pole = "tangent-foot", Vec3{0.4, -0.3, 1.1}
	orthotomic := tangentFoot
	orthotomic.Construction = "orthotomic"
	inversion := inversionStudy("2*cos(t)", "2*sin(t)", "t/2", -2*math.Pi, 2*math.Pi, Vec3{0.3, -0.2, 0.5}, 1.7)
	inversion.Inversion.Input, inversion.Pole = "orthotomic", Vec3{0.2, 0.1, -0.3}
	involutes := involuteStudy("2*cos(t)", "2*sin(t)", "t/2", -2*math.Pi, 2*math.Pi, 0.7, 1.3)
	involutes.Involute.Family = InvoluteFamily{Enabled: true, From: -1, To: 2, Count: 3}
	framed := ribbon(study(), "rotation-minimizing", Vec3{0, 0, 1}, 0.4, 1, 0.3)
	frenetRibbon := ribbon(helixStudy(), "frenet", Vec3{0, 0, 1}, 0.4, 0, 0.3)
	threadedRing := threaded(ring(0), "cos(t)", "sin(t)", "1 + 0.3*sin(2*t)", 1, 0.5)
	chorded := chords(study(), 1, 1.1)
	canalTube := canalled(study(), 0.3, "1", 6)
	harmonic := harmonicStudy(0, 2*math.Pi, Vec3{0.1, 0, 0}, HarmonicTerm{1, Vec3{2, 0, 0}, Vec3{0, 2, 0}}, HarmonicTerm{3, Vec3{0, 0, 0.5}, Vec3{0.3, 0, 0}})
	harmonic.Construction = "developable"
	footInput := study()
	footInput.Input, footInput.Pole = "tangent-foot", Vec3{0.3, 0.2, 0.1}
	involuteInput := unwound(helixStudy(), 0.7, 1.3)
	involuteInput.Construction = "developable"
	none := helixStudy()
	none.Construction = "none"
	return map[string]Request{
		"knot developable":   study(),
		"helix developable":  helix,
		"tangent-foot":       tangentFoot,
		"orthotomic":         orthotomic,
		"inversion":          inversion,
		"involutes":          involutes,
		"framed":             framed,
		"frenet ribbon":      frenetRibbon,
		"ruled thread":       threadedRing,
		"ruled chord":        chorded,
		"canal":              canalTube,
		"harmonic":           harmonic,
		"tangent-foot input": footInput,
		"involute input":     involuteInput,
		"none":               none,
	}
}

// Asking for the probe changes nothing else in the result.
func TestCurveProbeLeavesTheStudyUnchanged(t *testing.T) {
	for name, c := range probeStudies() {
		c.Diagnostics = true
		plain, err := Compute(c)
		if err != nil {
			t.Fatal(name, err)
		}
		want, _ := json.Marshal(plain)
		r, _ := curveProbe(t, c, ProbeQuery{T: ptr(0.5*plain.Diagnostics.Min + 0.5*plain.Diagnostics.Max + 0.0123)})
		r.CurveProbe = nil
		got, _ := json.Marshal(r)
		if string(got) != string(want) {
			t.Fatalf("%s: the probe changed the result", name)
		}
	}
}

func ptr(v float64) *float64 { return &v }

// The probe asks for the diagnostics it reads, so a study asked for the
// probe alone returns them as a study asked for both does.
func TestCurveProbeBringsItsDiagnostics(t *testing.T) {
	c := study()
	c.Probe = &ProbeQuery{T: ptr(1)}
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Diagnostics == nil || r.CurveProbe == nil {
		t.Fatal("the probe came without its diagnostics")
	}
}

// At a sample, the probe is exactly the sample's diagnostics, and its
// construction the study's own points there.
func TestCurveProbeAtASampleIsTheSample(t *testing.T) {
	for name, c := range probeStudies() {
		plain, d := diagnosed(t, c)
		n := c.Samples
		for _, j := range []int{0, 1, 17, n / 3, n / 2, n - 1, n} {
			// From the study ProbeOnly keeps, which computes each study
			// once; TestProbeOnlyMatchesAFreshComputation holds it to a
			// fresh computation.
			p := probeOnlyAt(t, c, knotAt(c, d.Min, d.Max, j))
			what := func(s string) string { return name + " " + s + " at sample " + itoa(j) }
			sameVec(t, what("point"), p.Point, plain.Base[j])
			sameVec(t, what("tangent"), p.Tangent, d.Tangent[j])
			sameVec(t, what("normal"), p.Normal, d.Normal[j])
			sameVec(t, what("binormal"), p.Binormal, d.Binormal[j])
			sameVec(t, what("centre"), p.Center, d.Center[j])
			sameNumber(t, what("curvature"), p.Curvature, d.Curvature[j])
			sameNumber(t, what("torsion"), p.Torsion, d.Torsion[j])
			sameNumber(t, what("length"), p.Length, d.Length[j])
			// The construction's evaluator, not the sample loop's copy:
			// within rounding of its points.
			tol := 1e-12 * math.Max(1, plain.Bounds.Radius)
			agree := func(s string, got, want *Vec3) {
				t.Helper()
				if want == nil {
					if got != nil {
						t.Fatalf("%s: %+v where the study has none", what(s), *got)
					}
					return
				}
				closeVec3(t, what(s), got, *want, tol)
			}
			switch c.Construction {
			case "", "developable":
				agree("minus", p.Minus, plain.Minus[j])
				agree("plus", p.Plus, plain.Plus[j])
			case "framed":
				agree("minus", p.Minus, plain.Minus[j])
				agree("plus", p.Plus, plain.Plus[j])
			case "ruled":
				agree("partner", p.Plus, plain.Plus[j])
			case "tangent-foot", "orthotomic":
				agree("foot", p.Foot, plain.Projection.Feet[j])
				agree("image", p.Image, plain.Projection.Points[j])
			case "inversion":
				agree("source", p.Source, plain.Inversion.Source[j])
				agree("image", p.Image, plain.Inversion.Points[j])
			case "involute":
				if len(p.Members) != len(plain.Involute.Members) {
					t.Fatalf("%s: %d members, want %d", what("members"), len(p.Members), len(plain.Involute.Members))
				}
				for k, m := range plain.Involute.Members {
					agree("member "+itoa(k), p.Members[k], m.Points[j])
				}
			default:
				if p.Minus != nil || p.Plus != nil || p.Foot != nil || p.Image != nil || p.Source != nil || p.Members != nil {
					t.Fatalf("%s: a construction where none is highlighted", what("construction"))
				}
			}
			if c.Format == "harmonic" {
				want := plain.Harmonic.Chains[j]
				if p.Chain == nil || len(p.Chain.Joints) != len(want.Joints) {
					t.Fatalf("%s: %+v, want %+v", what("chain"), p.Chain, want)
				}
				for k := range want.Joints {
					agree("joint "+itoa(k), &p.Chain.Joints[k], &want.Joints[k])
				}
				agree("chain point", &p.Chain.Point, &want.Point)
			} else if p.Chain != nil {
				t.Fatalf("%s: a chain on a curve without one", what("chain"))
			}
		}
	}
}

func itoa(i int) string {
	b, _ := json.Marshal(i)
	return string(b)
}

// A helix (a cos t, a sin t, bt) between samples: κ = a/w², τ = b/w², with
// w² = a² + b², N points at the axis, B = T × N, the centre lies 1/κ along
// N, and the arc length from the domain's start is w(t − t₀).
func TestCurveProbeBetweenSamplesOfAHelix(t *testing.T) {
	c := helixStudy()
	c.Samples = 240
	lo, hi := c.Curve.Min, c.Curve.Max
	w2 := helixW * helixW
	for _, s := range betweenSamples(c, lo, hi) {
		p := probeAt(t, c, s)
		r, T := helixAt(s)
		N := Vec3{-math.Cos(s), -math.Sin(s), 0}
		closeVec3(t, "point", p.Point, r, 1e-12)
		closeVec3(t, "tangent", p.Tangent, T, 1e-9)
		closeVec3(t, "normal", p.Normal, N, 1e-6)
		closeVec3(t, "binormal", p.Binormal, T.cross(N), 1e-6)
		closeNumber(t, "curvature", p.Curvature, helixA/w2, 1e-7)
		closeNumber(t, "torsion", p.Torsion, helixB/w2, 1e-5)
		closeVec3(t, "centre", p.Center, r.add(N.mul(w2/helixA)), 1e-5)
		closeNumber(t, "length", p.Length, helixW*(s-lo), 1e-8)
	}
}

// A torus knot is evaluated analytically: between samples its frame and
// curvature agree with the test's own derivatives to rounding, and its arc
// length with an independent Gauss–Legendre quadrature.
func TestCurveProbeBetweenSamplesOfAKnot(t *testing.T) {
	c := study()
	c.Samples = 240
	for _, s := range betweenSamples(c, 0, 2*math.Pi) {
		p := probeAt(t, c, s)
		v := trefoilVelocity(c, s)
		h := 1e-5
		a := trefoilVelocity(c, s+h).sub(trefoilVelocity(c, s-h)).mul(1 / (2 * h))
		closeVec3(t, "point", p.Point, trefoilAt(c, s), 1e-12)
		closeVec3(t, "tangent", p.Tangent, v.unit(), 1e-12)
		kappa := v.cross(a).norm() / math.Pow(v.norm(), 3)
		closeNumber(t, "curvature", p.Curvature, kappa, 1e-8*kappa)
		closeVec3(t, "binormal", p.Binormal, v.cross(a).unit(), 1e-8)
		closeNumber(t, "length", p.Length, trefoilArc(c, 0, s), 1e-8*trefoilArc(c, 0, 2*math.Pi))
	}
}

// Every construction the probe highlights, between samples of the helix,
// against its closed form at that t.
func TestCurveProbeConstructionsBetweenSamples(t *testing.T) {
	w2 := helixW * helixW
	frame := func(s float64) (r, T, N, B Vec3) {
		r, T = helixAt(s)
		N = Vec3{-math.Cos(s), -math.Sin(s), 0}
		return r, T, N, T.cross(N)
	}
	studies := probeStudies()
	for _, name := range []string{"helix developable", "tangent-foot", "orthotomic", "inversion", "involutes", "frenet ribbon"} {
		c := studies[name]
		c.Samples = 240
		lo, hi := c.Curve.Min, c.Curve.Max
		for _, s := range betweenSamples(c, lo, hi) {
			p := probeAt(t, c, s)
			r, T, N, B := frame(s)
			foot := r.add(T.mul(c.Pole.sub(r).dot(T)))
			switch name {
			case "helix developable":
				closeVec3(t, name+" minus", p.Minus, r.sub(T.mul(c.Length)), 1e-9)
				closeVec3(t, name+" plus", p.Plus, r.add(T.mul(c.Length)), 1e-9)
			case "tangent-foot":
				closeVec3(t, name+" foot", p.Foot, foot, 1e-8)
				closeVec3(t, name+" image", p.Image, foot, 1e-8)
			case "orthotomic":
				closeVec3(t, name+" foot", p.Foot, foot, 1e-8)
				closeVec3(t, name+" image", p.Image, foot.mul(2).sub(c.Pole), 1e-8)
			case "inversion":
				q := c.Inversion
				source := r.add(T.mul(c.Pole.sub(r).dot(T))).mul(2).sub(c.Pole)
				d := source.sub(q.Center)
				closeVec3(t, name+" source", p.Source, source, 1e-8)
				closeVec3(t, name+" image", p.Image, q.Center.add(d.mul(q.Radius*q.Radius/d.dot(d))), 1e-7)
			case "involutes":
				for k, offset := range []float64{-1, 0.5, 2} {
					closeVec3(t, name+" member "+itoa(k), p.Members[k], helixInvolute(s, c.Involute.Anchor, offset), 1e-8)
				}
			case "frenet ribbon":
				// The Frenet frame's U is N and its V is B; untwisted, the
				// cross-line runs along N cos θ₀ + B sin θ₀.
				d := N.mul(math.Cos(c.Frame.Angle)).add(B.mul(math.Sin(c.Frame.Angle))).mul(c.Frame.Width)
				closeVec3(t, name+" minus", p.Minus, r.sub(d), 1e-6)
				closeVec3(t, name+" plus", p.Plus, r.add(d), 1e-6)
			}
		}
	}
	_ = w2
	// A ruled surface's partner is the thread at φ(t) = rate·t + shift.
	c := studies["ruled thread"]
	c.Samples = 240
	for _, s := range betweenSamples(c, 0, 2*math.Pi) {
		p := probeAt(t, c, s)
		u := s + 0.5
		closeVec3(t, "ruled partner", p.Plus, Vec3{math.Cos(u), math.Sin(u), 1 + 0.3*math.Sin(2*u)}, 1e-12)
		closeVec3(t, "ruled point", p.Point, Vec3{math.Cos(s), math.Sin(s), 0}, 1e-12)
	}
	// A harmonic curve's chain: each joint the sum of the terms before it.
	c = studies["harmonic"]
	c.Samples = 240
	for _, s := range betweenSamples(c, 0, 2*math.Pi) {
		p := probeAt(t, c, s)
		first := Vec3{2 * math.Cos(s), 2 * math.Sin(s), 0}
		second := Vec3{0.3 * math.Sin(3*s), 0, 0.5 * math.Cos(3*s)}
		if p.Chain == nil || len(p.Chain.Joints) != 2 {
			t.Fatalf("chain %+v", p.Chain)
		}
		closeVec3(t, "first joint", &p.Chain.Joints[0], Vec3{0.1, 0, 0}, 1e-15)
		closeVec3(t, "second joint", &p.Chain.Joints[1], Vec3{0.1, 0, 0}.add(first), 1e-12)
		closeVec3(t, "chain point", &p.Chain.Point, Vec3{0.1, 0, 0}.add(first).add(second), 1e-12)
		closeVec3(t, "point", p.Point, p.Chain.Point, 1e-12)
	}
}

// The involute input of a helix is an involute of a circle of radius a,
// in a horizontal plane: its string runs horizontally (a/w)(c − s) long,
// which is its radius of curvature, and it has no torsion.
func TestCurveProbeOnTheInvoluteInput(t *testing.T) {
	anchor, offset := 0.7, 1.3
	c := unwound(helixStudy(), anchor, offset)
	c.Construction = "developable"
	c.Samples = 240
	for _, s := range betweenSamples(c, c.Curve.Min, c.Curve.Max) {
		p := probeAt(t, c, s)
		closeVec3(t, "point", p.Point, helixInvolute(s, anchor, offset), 1e-8)
		string := helixA / helixW * math.Abs(offset-helixW*(s-anchor))
		if string < 0.3 {
			continue // near the cusp, where the input's curvature blows up
		}
		closeNumber(t, "curvature", p.Curvature, 1/string, 1e-4/string)
		closeNumber(t, "torsion", p.Torsion, 0, 1e-3)
		if math.Abs(p.Binormal.Z) < 1-1e-6 {
			t.Fatalf("binormal %+v is not vertical", *p.Binormal)
		}
	}
}

// A share of the drawn length is placed where the arc length is that share
// of the whole: on a helix, at that share of the domain.
func TestCurveProbeAtAShareOfTheLength(t *testing.T) {
	c := helixStudy()
	c.Samples = 240
	lo, hi := c.Curve.Min, c.Curve.Max
	for _, share := range []float64{0, 0.0001, 0.25, 0.37, 0.5, 0.9999, 1} {
		_, p := curveProbe(t, c, ProbeQuery{Share: ptr(share)})
		if math.Abs(p.T-(lo+share*(hi-lo))) > 1e-9 {
			t.Fatalf("share %g at t = %.15g, want %.15g", share, p.T, lo+share*(hi-lo))
		}
		closeNumber(t, "length", p.Length, share*helixW*(hi-lo), 1e-8)
	}
}

// A closed curve's last sample repeats its first: the probe at the end of
// the domain describes the first sample, at the whole length.
func TestCurveProbeAtTheEndOfAClosedCurve(t *testing.T) {
	c := study()
	_, d := diagnosed(t, c)
	p := probeAt(t, c, 2*math.Pi)
	sameVec(t, "tangent", p.Tangent, d.Tangent[0])
	sameNumber(t, "curvature", p.Curvature, d.Curvature[0])
	sameNumber(t, "torsion", p.Torsion, d.Torsion[0])
	sameNumber(t, "length", p.Length, d.Length[c.Samples])
}

// Where the curve is straight, κ is 0 and the frame's normal, binormal,
// torsion and centre are undefined; where it is undefined, nothing is.
func TestCurveProbeWhereFlatOrUndefined(t *testing.T) {
	line := custom("t", "2*t", "1 - t", -1, 1)
	line.Samples = 240
	p := probeAt(t, line, 0.1234)
	if p.Curvature == nil || *p.Curvature != 0 || p.Normal != nil || p.Binormal != nil || p.Torsion != nil || p.Center != nil {
		t.Fatalf("a line's frame: %+v", p)
	}
	closeVec3(t, "tangent", p.Tangent, Vec3{1, 2, -1}.unit(), 1e-12)
	root := custom("t", "sqrt(t)", "0", -1, 1)
	root.Samples = 240
	p = probeAt(t, root, -0.5123)
	if p.Point != nil || p.Tangent != nil || p.Curvature != nil || p.Length != nil {
		t.Fatalf("an undefined point: %+v", p)
	}
}

// A centre of curvature beyond 100 study radii is at infinity, as the
// diagnostics put it.
func TestCurveProbeClipsAFarCentre(t *testing.T) {
	c := custom("t", "1e-4*t^2", "0", -1, 1)
	c.Samples = 240
	p := probeAt(t, c, 0.0123)
	if p.Curvature == nil || *p.Curvature <= 0 || p.Normal == nil || p.Center != nil {
		t.Fatalf("a far centre: κ %v, centre %v", deref(p.Curvature), p.Center)
	}
}

func TestCurveProbeRefusals(t *testing.T) {
	c := helixStudy()
	for _, q := range []ProbeQuery{{}, {T: ptr(0), Share: ptr(0.5)}, {T: ptr(100)}, {T: ptr(math.NaN())}, {Share: ptr(-0.1)}, {Share: ptr(1.5)}} {
		q := q
		c.Probe = &q
		if _, err := Compute(c); err == nil {
			t.Fatalf("accepted %+v", q)
		}
	}
	integrated := []Request{
		fieldRequest("-y", "x", "0.1", []Vec3{{1, 0, 0}}, 0, 6),
		pursuitStudy([]SpatialPursuer{{X: 1, Speed: 1}, {Y: 1, Speed: 1}, {Z: 1, Speed: 1}}, 0.01, 0, 1),
		sphere(1, 24, 24),
	}
	for _, c := range integrated {
		c.Probe = &ProbeQuery{T: ptr(0.5)}
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "probe") {
			t.Fatalf("%s: a probe between samples: %v", c.Format, err)
		}
	}
}

// ProbeOnly answers from the study it last computed, as a fresh
// computation would, and computes a new study when it changes.
func TestProbeOnlyMatchesAFreshComputation(t *testing.T) {
	studies := probeStudies()
	for _, name := range []string{"knot developable", "involutes", "framed", "harmonic", "involute input", "knot developable"} {
		c := studies[name]
		c.Adaptive = true
		for _, s := range []float64{0.123, 0.5, 0.987} {
			lo, hi := 0.0, 2*math.Pi
			if c.Format == "parametric" {
				lo, hi = c.Curve.Min, c.Curve.Max
			}
			q := ProbeQuery{T: ptr(lo + s*(hi-lo))}
			_, want := curveProbe(t, c, q)
			c.Probe = &q
			got, err := ProbeOnly(c)
			if err != nil {
				t.Fatal(name, err)
			}
			a, _ := json.Marshal(got)
			b, _ := json.Marshal(want)
			if string(a) != string(b) {
				t.Fatalf("%s at %g: probe only %s, fresh %s", name, s, a, b)
			}
		}
	}
	// Refused over the study it keeps, as over a fresh one.
	c := helixStudy()
	c.Probe = &ProbeQuery{T: ptr(1)}
	if _, err := ProbeOnly(c); err != nil {
		t.Fatal(err)
	}
	for _, q := range []ProbeQuery{{T: ptr(100)}, {Share: ptr(2)}, {}} {
		c.Probe = &q
		if _, err := ProbeOnly(c); err == nil {
			t.Fatalf("ProbeOnly accepted %+v over the study it keeps", q)
		}
	}
	c.Probe = nil
	if _, err := ProbeOnly(c); err == nil {
		t.Fatal("ProbeOnly without a probe")
	}
}

// A rotation-minimizing frame is transported along the samples, so its
// twisted cross-line has no closed form: between a coarse study's samples
// the probe's cross-line converges on a study ten times as dense, at its own
// samples there.
func TestCurveProbeFramedBetweenSamplesConverges(t *testing.T) {
	coarse := probeStudies()["framed"]
	coarse.Samples = 240
	dense := coarse
	dense.Samples = 2400
	r, _ := diagnosed(t, dense)
	worst := 0.0
	for _, k := range []int{3, 457, 1205, 1999, 2391} {
		s := knotAt(dense, 0, 2*math.Pi, k)
		p := probeAt(t, coarse, s)
		for _, pair := range [][2]*Vec3{{p.Minus, r.Minus[k]}, {p.Plus, r.Plus[k]}} {
			if pair[0] == nil {
				t.Fatalf("no cross-line at t = %g", s)
			}
			worst = math.Max(worst, pair[0].sub(*pair[1]).norm())
		}
	}
	if worst > 1e-5 {
		t.Fatalf("the cross-line between samples is %g from the dense study's", worst)
	}
}
