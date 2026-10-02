package engine3

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
)

func composed(t *testing.T, c Request) Result {
	t.Helper()
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Composition == nil {
		t.Fatal("missing composition")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	if r.Projection != nil || r.Inversion != nil {
		t.Fatal("composition is not a projection construction")
	}
	return r
}

// unitCircle is the unit circle in the xy-plane written as expressions, so
// its derivatives are numerical.
func unitCircle(samples int) Request {
	c := custom("cos(t)", "sin(t)", "0", 0, 2*math.Pi)
	c.Samples = samples
	return c
}

// The tangent-foot curve of the unit circle from P = (−1, 0, 0), a point on
// it, is the cardioid H(t) = (cos t − sin²t, sin t (1 + cos t), 0), with
// speed 2|cos(t/2)|: it stops at the cusp t = π, where it meets P.
func cardioid(t float64) Vec3 {
	return Vec3{math.Cos(t) - math.Sin(t)*math.Sin(t), math.Sin(t) * (1 + math.Cos(t)), 0}
}

func TestComposedInputIsTheProjection(t *testing.T) {
	c := unitCircle(481)
	c.Construction = "involute"
	c.Input = "tangent-foot"
	c.Pole = Vec3{-1, 0, 0}
	c.Involute = InvoluteRequest{Anchor: 0, Offset: 1.5}
	r := composed(t, c)
	q := r.Composition
	if q.Input != "tangent-foot" || q.Pole != c.Pole || len(q.Curve) != c.Samples+1 || len(q.Breaks) != c.Samples+1 || len(q.Constructions) != c.Lines {
		t.Fatalf("composition shape %+v", q)
	}
	for i, p := range r.Base {
		u := 2 * math.Pi * float64(i) / float64(c.Samples)
		near(t, q.Curve[i], Vec3{math.Cos(u), math.Sin(u), 0}, 1e-12)
		if p == nil {
			t.Fatalf("input sample %d missing", i)
		}
		near(t, p, cardioid(u), 1e-9)
	}
	for _, b := range q.Breaks {
		if b {
			t.Fatal("the base circle is unbroken")
		}
	}
	for _, s := range q.Constructions {
		near(t, s.Contact, q.Curve[s.SampleIndex], 0)
		near(t, s.Image, r.Base[s.SampleIndex], 0)
		near(t, s.Foot, s.Image, 1e-12)
	}
}

// The input curve's own cusp breaks every construction on it, though the
// base continues: arc length stops there, and no face spans it.
func TestComposedCuspBreaksTheConstruction(t *testing.T) {
	c := unitCircle(481) // t = π lies inside interval 240
	c.Input = "tangent-foot"
	c.Pole = Vec3{-1, 0, 0}
	c.Involute = InvoluteRequest{Anchor: 0, Offset: 1.5}
	for _, construction := range []string{"involute", "developable", "framed"} {
		c.Construction = construction
		c.Frame = frameRequest()
		r := composed(t, c)
		if r.Composition.Cusps != 1 || !r.Breaks[241] {
			t.Fatalf("%s: %d cusps, break %v", construction, r.Composition.Cusps, r.Breaks[241])
		}
		for i, b := range r.Breaks {
			if b && i != 241 {
				t.Fatalf("%s: unexpected break at %d", construction, i)
			}
		}
		switch construction {
		case "involute":
			if r.Involute.Unreached != 241 {
				t.Fatalf("unreached %d", r.Involute.Unreached)
			}
		case "developable", "framed":
			for _, v := range r.Mesh {
				if v.SampleIndex == 241 && construction == "developable" {
					t.Fatal("a face spans the cusp")
				}
			}
			if r.Omitted < 1 && construction == "developable" {
				t.Fatal("no face omitted at the cusp")
			}
		}
	}
}

// An involute of the cardioid unwinds its arc length s(t) = 4 sin(t/2) from
// t₀ = 0: each string lies along the cardioid's tangent with length |c − s|,
// and the involute crosses its strings at right angles.
func TestComposedInvoluteUnwindsTheInputCurve(t *testing.T) {
	c := unitCircle(481)
	c.Construction = "involute"
	c.Input = "tangent-foot"
	c.Pole = Vec3{-1, 0, 0}
	c.Involute = InvoluteRequest{Anchor: 0, Offset: 1.5}
	r := composed(t, c)
	m := r.Involute.Members[0].Points
	for i := 1; i < 239; i++ {
		u := 2 * math.Pi * float64(i) / float64(c.Samples)
		g := cardioid(u)
		tangent := Vec3{-math.Sin(u) - math.Sin(2*u), math.Cos(u) + math.Cos(2*u), 0}.unit()
		d := m[i].sub(g)
		length := 1.5 - 4*math.Sin(u/2)
		if math.Abs(d.norm()-math.Abs(length)) > 1e-7 || d.cross(tangent).norm() > 1e-8 {
			t.Fatalf("string %d: %+v", i, d)
		}
		// Away from the involute's own cusp, where the string vanishes.
		chord := m[i+1].sub(*m[i-1])
		if math.Abs(length) > 0.1 && math.Abs(chord.unit().dot(tangent)) > 2e-3 {
			t.Fatalf("involute not orthogonal to its string at %d", i)
		}
	}
	if m[300] != nil {
		t.Fatal("arc length crossed the cusp")
	}
}

// The tangent-foot curve of the helix (a cos t, a sin t, bt) from the origin
// is H = r − (b²t/w²) W with W = (−a sin t, a cos t, b), w² = a² + b²; its
// tangent developable rules H along H′.
func TestComposedHelixDevelopable(t *testing.T) {
	a, b := 2.0, 0.5
	c := custom("2*cos(t)", "2*sin(t)", "t/2", -2*math.Pi, 2*math.Pi)
	c.Construction = "developable"
	c.Input = "tangent-foot"
	c.Pole = Vec3{}
	r := composed(t, c)
	w2 := a*a + b*b
	for i := 0; i <= c.Samples; i += 7 {
		u := c.Curve.Min + (c.Curve.Max-c.Curve.Min)*float64(i)/float64(c.Samples)
		s, k := math.Sin(u), math.Cos(u)
		W := Vec3{-a * s, a * k, b}
		h := Vec3{a * k, a * s, b * u}.sub(W.mul(b * b * u / w2))
		dh := W.sub(W.mul(b * b / w2)).sub(Vec3{-a * k, -a * s, 0}.mul(b * b * u / w2))
		if r.Base[i] == nil {
			t.Fatalf("missing sample %d", i)
		}
		near(t, r.Base[i], h, 1e-8)
		near(t, r.Plus[i], h.add(dh.unit().mul(c.Length)), 1e-6)
	}
	if r.Invalid != 0 || r.Composition.Cusps != 0 {
		t.Fatalf("invalid %d cusps %d", r.Invalid, r.Composition.Cusps)
	}
}

// The orthotomic is the tangent-foot curve scaled by 2 about the pole, with
// the same tangent, so constructions on it scale with it when their world
// lengths double too.
func TestOrthotomicInputIsTheScaledTangentFoot(t *testing.T) {
	c := study()
	c.Pole = Vec3{0.4, -0.3, 0.9}
	c.Involute = InvoluteRequest{Anchor: 1, Family: InvoluteFamily{Enabled: true, From: -2, To: 3, Count: 4}}
	scaled := func(p *Vec3) Vec3 { return p.mul(2).sub(c.Pole) }
	for _, construction := range []string{"developable", "involute"} {
		c.Construction = construction
		foot, ortho := c, c
		foot.Input, ortho.Input = "tangent-foot", "orthotomic"
		ortho.Length = 2 * c.Length
		ortho.Involute.Family.From, ortho.Involute.Family.To = -4, 6
		f, o := composed(t, foot), composed(t, ortho)
		for i := range f.Base {
			if (f.Base[i] == nil) != (o.Base[i] == nil) || f.Breaks[i] != o.Breaks[i] {
				t.Fatalf("%s: samples or breaks differ at %d", construction, i)
			}
			if f.Base[i] == nil {
				continue
			}
			near(t, o.Base[i], scaled(f.Base[i]), 1e-12)
			if construction == "developable" {
				near(t, o.Plus[i], scaled(f.Plus[i]), 1e-9)
				near(t, o.Minus[i], scaled(f.Minus[i]), 1e-9)
				continue
			}
			for m := range f.Involute.Members {
				if p := f.Involute.Members[m].Points[i]; p != nil {
					near(t, o.Involute.Members[m].Points[i], scaled(p), 1e-8)
				}
			}
		}
		near(t, o.Composition.Constructions[3].Foot, f.Composition.Constructions[3].Foot, 0)
	}
}

// A circle's tangent-foot curve from its center is the circle itself, and
// its orthotomic is the circle doubled, so a tube around them is a torus.
func TestTubeAroundOrthotomicOfCircleIsTorus(t *testing.T) {
	for _, input := range []string{"tangent-foot", "orthotomic"} {
		c := canalled(circle(), 0.5, "1", 6)
		c.Input = input
		r := composed(t, c)
		core := 2.0
		if input == "orthotomic" {
			core = 4
		}
		torus := func(p Vec3) float64 { return math.Pow(math.Hypot(p.X, p.Y)-core, 2) + p.Z*p.Z - 0.25 }
		if !r.Canal.Closed || r.Omitted != 0 || len(r.Mesh) == 0 {
			t.Fatalf("%s: canal %+v omitted %d", input, r.Canal, r.Omitted)
		}
		for _, v := range r.Mesh {
			if math.Abs(torus(v.Position)) > 1e-7 {
				t.Fatalf("%s: vertex %+v off the torus", input, v.Position)
			}
		}
		if math.Abs(r.Bounds.Radius-math.Hypot(core+0.5, 0)) > 0.05 {
			t.Fatalf("%s: bounds %+v", input, r.Bounds)
		}
	}
}

// Translating the base and the pole together translates everything.
func TestComposedRigidMotion(t *testing.T) {
	c := custom("2*cos(t)", "sin(2*t)", "0.7*sin(3*t)", 0, 2*math.Pi)
	c.Construction = "involute"
	c.Input = "orthotomic"
	c.Pole = Vec3{0.3, 0.2, -0.4}
	c.Involute = InvoluteRequest{Anchor: 1, Offset: 0.5}
	moved := custom("2*cos(t)+1", "sin(2*t)-2", "0.7*sin(3*t)+0.5", 0, 2*math.Pi)
	moved.Construction, moved.Input, moved.Involute = c.Construction, c.Input, c.Involute
	shift := Vec3{1, -2, 0.5}
	moved.Pole = c.Pole.add(shift)
	a, b := composed(t, c), composed(t, moved)
	if !reflect.DeepEqual(a.Breaks, b.Breaks) {
		t.Fatal("breaks changed under translation")
	}
	for i, p := range a.Involute.Members[0].Points {
		if (p == nil) != (b.Involute.Members[0].Points[i] == nil) {
			t.Fatalf("reach changed at %d", i)
		}
		if p != nil {
			near(t, b.Involute.Members[0].Points[i], p.add(shift), 1e-7)
		}
	}
}

// The base input, and constructions that do not take an input, leave every
// result exactly as it was.
func TestBaseInputChangesNothing(t *testing.T) {
	for _, construction := range []string{"developable", "involute", "framed", "ruled", "canal", "tangent-foot", "orthotomic", "inversion", "none"} {
		c := study()
		c.Construction = construction
		c.Pole = Vec3{0.4, -0.3, 0.9}
		c.Involute = InvoluteRequest{Anchor: 1, Offset: 1}
		c.Frame = frameRequest()
		c.Ruled = RuledRequest{Partner: "chord", Rate: 1, Shift: 1}
		c.Canal = CanalRequest{Radius: 0.2, Profile: "1", Meridians: 4}
		c.Inversion = InversionRequest{Center: Vec3{}, Radius: 2, Input: "base"}
		want, err := Compute(c)
		if err != nil {
			t.Fatal(construction, err)
		}
		inputs := []string{"base"}
		if construction == "tangent-foot" || construction == "orthotomic" || construction == "inversion" || construction == "none" {
			inputs = append(inputs, "tangent-foot", "orthotomic")
		}
		for _, input := range inputs {
			c.Input = input
			got, err := Compute(c)
			if err != nil {
				t.Fatal(construction, input, err)
			}
			if got.Composition != nil || !reflect.DeepEqual(got, want) {
				t.Fatalf("%s with input %s changed the result", construction, input)
			}
		}
	}
}

// Every curve construction that takes an input builds on the input curve:
// its rulings, strands, circles or partner start there, not on the base.
func TestEveryConstructionActsOnTheInput(t *testing.T) {
	c := study()
	c.Input = "tangent-foot"
	c.Pole = Vec3{0.4, -0.3, 0.9}
	c.Frame = frameRequest()
	c.Ruled = RuledRequest{Partner: "chord", Rate: 1, Shift: 1}
	c.Canal = CanalRequest{Radius: 0.2, Profile: "1", Meridians: 4}
	foot := func(i int) Vec3 {
		r, v, _ := knot(c, 2*math.Pi*float64(i)/float64(c.Samples))
		return project("tangent-foot", c.Pole, r, v.unit())
	}
	for _, construction := range []string{"developable", "framed", "ruled", "canal"} {
		c.Construction = construction
		r := composed(t, c)
		for i, p := range r.Base {
			near(t, p, foot(i), 1e-12)
			near(t, r.Composition.Curve[i], func() Vec3 { b, _, _ := knot(c, 2*math.Pi*float64(i)/float64(c.Samples)); return b }(), 1e-12)
		}
		switch construction {
		case "developable":
			for _, l := range r.Rulings {
				near(t, l.From.add(l.To).mul(0.5), r.Base[l.SampleIndex], 1e-9)
			}
		case "ruled":
			for _, l := range r.Rulings {
				near(t, l.From, r.Base[l.SampleIndex], 1e-9)
			}
		case "framed":
			for _, g := range r.Frame.Frames {
				near(t, g.Point, r.Base[g.SampleIndex], 0)
			}
		case "canal":
			for _, g := range r.Canal.Circles {
				if g.Real && g.Center.sub(*r.Base[g.SampleIndex]).norm() > 0.2 {
					t.Fatalf("circle %d is not around the input", g.SampleIndex)
				}
			}
		}
	}
}

// The probe describes the input curve: its tangent is the developable's
// ruling direction, numerically, with no analytic knot formula involved.
func TestComposedDiagnosticsDescribeTheInput(t *testing.T) {
	c := study()
	c.Construction = "developable"
	c.Input = "orthotomic"
	c.Pole = Vec3{0.4, -0.3, 0.9}
	c.Diagnostics = true
	r := composed(t, c)
	d := r.Diagnostics
	defined := 0
	for i, tangent := range d.Tangent {
		if tangent == nil || r.Plus[i] == nil {
			continue
		}
		near(t, tangent, r.Plus[i].sub(*r.Base[i]).mul(1/c.Length), 1e-9)
		if k := d.Curvature[i]; k != nil && *k > 0 {
			defined++
			// The centre lies in the normal direction at distance 1/κ.
			if d.Center[i] != nil {
				near(t, d.Center[i], r.Base[i].add(d.Normal[i].mul(1 / *k)), 1e-9)
			}
		}
	}
	if defined < c.Samples/2 {
		t.Fatalf("only %d curvatures", defined)
	}
}

func TestCompositionValidation(t *testing.T) {
	c := study()
	c.Construction = "involute"
	c.Involute = InvoluteRequest{Anchor: 1, Offset: 1}
	c.Input = "evolute"
	if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "input curve") {
		t.Fatalf("unknown input: %v", err)
	}
	c.Input = "orthotomic"
	c.Pole = Vec3{math.NaN(), 0, 0}
	if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "pole") {
		t.Fatalf("invalid pole: %v", err)
	}
	c.Pole = Vec3{2e5, 0, 0}
	if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "pole") {
		t.Fatalf("distant pole: %v", err)
	}
	// A pole on every tangent of a line collapses its tangent-foot curve to
	// a point: no regular sample remains for the construction.
	l := custom("t", "0", "0", -1, 1)
	l.Construction = "developable"
	l.Input = "tangent-foot"
	l.Pole = Vec3{0, 1, 0}
	if _, err := Compute(l); err == nil || !strings.Contains(err.Error(), "input curve") {
		t.Fatalf("collapsed input: %v", err)
	}
}

// A cusp is counted where the construction would otherwise be joined
// across it: not at an open domain's end, and once where a closed curve's
// ends meet.
func TestCuspsAtTheEndsOfTheDomain(t *testing.T) {
	open := custom("cos(t)", "sin(t)", "0.35*sin(2*t)", -math.Pi, math.Pi)
	closed := harmonicStudy(-math.Pi, math.Pi, Vec3{}, HarmonicTerm{1, Vec3{1, 0, 0}, Vec3{0, 1, 0}}, HarmonicTerm{2, Vec3{}, Vec3{0, 0, 0.35}})
	for _, c := range []Request{open, closed} {
		c.Construction = "involute"
		c.Input = "tangent-foot"
		c.Pole = Vec3{-1, 0, 0}
		c.Involute = InvoluteRequest{Anchor: 0, Family: InvoluteFamily{Enabled: true, From: -4, To: 4, Count: 3}}
		c.Samples = 1200
		r := composed(t, c)
		want := 0
		if c.Format == "harmonic" {
			want = 1
		}
		if r.Composition.Cusps != want {
			t.Fatalf("%s: %d cusps, want %d", c.Format, r.Composition.Cusps, want)
		}
		// Arc length still reaches from the anchor to both ends.
		if r.Involute.Unreached != 0 {
			t.Fatalf("%s: %d unreached", c.Format, r.Involute.Unreached)
		}
	}
	// Moving the pole off the curve removes the cusp.
	closed.Construction, closed.Input, closed.Pole = "developable", "tangent-foot", Vec3{-1.2, 0, 0}
	if r := composed(t, closed); r.Composition.Cusps != 0 {
		t.Fatalf("%d cusps off the curve", r.Composition.Cusps)
	}
}

// The helix's tangent-foot curve H = r − f t W, with f = b²/w² and
// W = r′(t), has H′ = (1 − f)W − f t W′, H″ = (1 − 2f)W′ − f t W″ and
// H‴ = (1 − 3f)W″ − f t W‴: its curvature and torsion follow, and the
// probe of the numerically differentiated input must match them.
func TestComposedCurvatureAndTorsionConverge(t *testing.T) {
	a, b := 2.0, 0.5
	f := b * b / (a*a + b*b)
	c := custom("2*cos(t)", "2*sin(t)", "t/2", -2*math.Pi, 2*math.Pi)
	c.Construction, c.Input, c.Pole, c.Diagnostics = "developable", "tangent-foot", Vec3{}, true
	r := composed(t, c)
	d := r.Diagnostics
	if d.Unknown != 0 {
		t.Fatalf("%d unknown", d.Unknown)
	}
	for i := 0; i <= c.Samples; i++ {
		u := c.Curve.Min + (c.Curve.Max-c.Curve.Min)*float64(i)/float64(c.Samples)
		s, k := math.Sin(u), math.Cos(u)
		w := []Vec3{{-a * s, a * k, b}, {-a * k, -a * s, 0}, {a * s, -a * k, 0}, {a * k, a * s, 0}}
		d1 := w[0].mul(1 - f).sub(w[1].mul(f * u))
		d2 := w[1].mul(1 - 2*f).sub(w[2].mul(f * u))
		d3 := w[2].mul(1 - 3*f).sub(w[3].mul(f * u))
		n := d1.cross(d2)
		kappa, tau := n.norm()/math.Pow(d1.norm(), 3), n.dot(d3)/n.dot(n)
		if math.Abs(*d.Curvature[i]-kappa) > 1e-6*kappa || math.Abs(*d.Torsion[i]-tau) > 1e-3*math.Abs(tau)+1e-6 {
			t.Fatalf("sample %d: κ %g want %g, τ %g want %g", i, *d.Curvature[i], kappa, *d.Torsion[i], tau)
		}
	}
}

// On a knot's orthotomic, torsion is the binormal's turning rate along the
// input curve's own samples (dB/ds = −τN), not the knot's.
func TestComposedKnotTorsionIsTheInputCurves(t *testing.T) {
	c := study()
	c.Construction, c.Input, c.Pole, c.Diagnostics, c.Samples = "involute", "orthotomic", Vec3{0.4, -0.3, 0.9}, true, 2400
	c.Involute = InvoluteRequest{Anchor: 1, Offset: 1}
	r := composed(t, c)
	d := r.Diagnostics
	checked := 0
	for i := 1; i < c.Samples; i++ {
		if d.Torsion[i] == nil || d.Binormal[i-1] == nil || d.Binormal[i+1] == nil || r.Breaks[i] || r.Breaks[i+1] {
			continue
		}
		ds := r.Base[i+1].sub(*r.Base[i]).norm() + r.Base[i].sub(*r.Base[i-1]).norm()
		turning := -d.Binormal[i+1].sub(*d.Binormal[i-1]).dot(*d.Normal[i]) / ds
		// Third derivatives are differenced at a fixed step, so sharp bends
		// carry an error of a few percent; the knot's own τ is far off.
		if math.Abs(turning-*d.Torsion[i]) > 0.1*math.Abs(*d.Torsion[i])+0.01 {
			t.Fatalf("sample %d: τ %g, binormal turns at %g", i, *d.Torsion[i], turning)
		}
		checked++
	}
	if checked < c.Samples/2 {
		t.Fatalf("only %d samples checked", checked)
	}
}

// Every break in the base breaks the input curve too: poles of the base
// between samples, and a cusp of the base where its tangent turns back.
func TestBaseBreaksBreakTheInput(t *testing.T) {
	asymptotes := custom("tan(t)", "t", "sin(t)", -2, 2)
	asymptotes.Samples = 481
	for _, base := range []Request{asymptotes, custom("t^2", "t^3", "0", -1, 1.0005)} {
		base.Construction, base.Input, base.Pole = "involute", "tangent-foot", Vec3{0.5, 0.5, 0.3}
		base.Involute = InvoluteRequest{Anchor: 0.5, Offset: 0}
		r := composed(t, base)
		broken := 0
		for i, b := range r.Composition.Breaks {
			if b {
				broken++
				if !r.Breaks[i] {
					t.Fatalf("%s: base break %d joined in the input", base.Curve.Y, i)
				}
			}
		}
		// Near an asymptote the base straightens (κ → 0), so its foot may
		// stop there too; a cusp of the base is the base's, not the input's.
		if broken == 0 || base.Curve.X == "t^2" && r.Composition.Cusps != 0 {
			t.Fatalf("%s: %d base breaks, %d cusps", base.Curve.Y, broken, r.Composition.Cusps)
		}
	}
}

// The base curve and the pole frame the study as their own families, and
// the representative constructions are evenly spread to the last sample;
// a closed base repeats its first sample exactly.
func TestCompositionFramesAndSpreads(t *testing.T) {
	// A circle seen from far above its center is its own tangent-foot
	// curve, so only the pole's own family reaches it.
	c := circle()
	c.Lines = 24
	c.Construction, c.Input, c.Pole = "developable", "tangent-foot", Vec3{0, 0, 40}
	r := composed(t, c)
	if r.Composition.Curve[c.Samples] != r.Composition.Curve[0] {
		t.Fatal("closed base does not repeat its first sample")
	}
	if r.Bounds.Center.sub(c.Pole).norm() > r.Bounds.Radius*(1+1e-12) {
		t.Fatalf("pole outside bounds %+v", r.Bounds)
	}
	for _, p := range r.Composition.Curve {
		if p.sub(r.Bounds.Center).norm() > r.Bounds.Radius*(1+1e-12) {
			t.Fatalf("base point %+v outside bounds", *p)
		}
	}
	for j, s := range r.Composition.Constructions {
		if s.SampleIndex != j*c.Samples/(c.Lines-1) {
			t.Fatalf("construction %d at sample %d", j, s.SampleIndex)
		}
	}
}

// The base beneath an input curve is broken exactly where the same study
// built on the base is. With 241 samples, 1/(t + 0.00415) has its pole a
// quarter of the way into interval 121, where both samples and the
// midpoint are regular and the tangent keeps its direction: only the chord
// guard finds it.
func TestCompositionBaseBreaksMatchThePlainStudy(t *testing.T) {
	for _, q := range []struct {
		x       string
		samples int
	}{{"1/t", 481}, {"1/(t-0.00317)", 481}, {"tan(t)", 481}, {"1/(t+0.00415)", 241}} {
		x := q.x
		c := custom(x, "t", "sin(t)", -2, 2)
		c.Samples = q.samples
		plain, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if q.samples == 241 && (!plain.Breaks[121] || plain.Invalid != 0) {
			t.Fatalf("the pole inside interval 121 was not found by its chord")
		}
		c.Input, c.Pole = "orthotomic", Vec3{0.5, 0.5, 0.3}
		r := composed(t, c)
		if !reflect.DeepEqual(r.Composition.Breaks, plain.Breaks) {
			t.Fatalf("%s: base breaks differ from the plain study's", x)
		}
		for i, p := range plain.Base {
			if (p == nil) != (r.Composition.Curve[i] == nil) || p != nil && *p != *r.Composition.Curve[i] {
				t.Fatalf("%s: base sample %d differs", x, i)
			}
		}
	}
}
