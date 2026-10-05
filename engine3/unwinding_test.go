package engine3

import (
	"math"
	"reflect"
	"strings"
	"testing"
)

// unwound builds c's construction on the involute of its base with anchor
// t₀ and string length c.
func unwound(c Request, anchor, offset float64) Request {
	c.Input = "involute"
	c.Unwinding = UnwindingRequest{Anchor: anchor, Offset: offset}
	return c
}

// The helix (a cos t, a sin t, bt) with a = 2, b = 1/2 has speed
// w = √(a² + b²), so s = w(t − t₀). Its involute I = r + (c − s)T lies in
// the plane z = bt₀ + bc/w: an involute of the circle of radius a.
const helixA, helixB = 2.0, 0.5

var helixW = math.Hypot(helixA, helixB)

func helixStudy() Request {
	c := custom("2*cos(t)", "2*sin(t)", "t/2", -2*math.Pi, 2*math.Pi)
	c.Samples = 480
	return c
}

func helixAt(u float64) (Vec3, Vec3) {
	r := Vec3{helixA * math.Cos(u), helixA * math.Sin(u), helixB * u}
	return r, Vec3{-helixA * math.Sin(u), helixA * math.Cos(u), helixB}.mul(1 / helixW)
}

func helixInvolute(u, anchor, offset float64) Vec3 {
	r, tangent := helixAt(u)
	return r.add(tangent.mul(offset - helixW*(u-anchor)))
}

func at(c Request, i int) float64 {
	return c.Curve.Min + (c.Curve.Max-c.Curve.Min)*float64(i)/float64(c.Samples)
}

func TestInvoluteInputIsTheHelixInvolute(t *testing.T) {
	anchor, offset := 0.7, 1.3
	c := unwound(helixStudy(), anchor, offset)
	c.Construction = "developable"
	r := composed(t, c)
	q := r.Composition
	if q.Input != "involute" || q.Cusps != 1 || q.Unreached != 0 || len(q.Constructions) != c.Lines {
		t.Fatalf("composition %+v", q)
	}
	plane := helixB*anchor + helixB*offset/helixW
	for i, p := range r.Base {
		u := at(c, i)
		base, _ := helixAt(u)
		near(t, q.Curve[i], base, 1e-12)
		if p == nil {
			t.Fatalf("input sample %d missing", i)
		}
		near(t, p, helixInvolute(u, anchor, offset), 1e-9)
		if math.Abs(p.Z-plane) > 1e-9 {
			t.Fatalf("sample %d left the plane z = %g: %g", i, plane, p.Z)
		}
		// The tangent developable of the involute is ruled along the
		// helix's principal normal, which points at its axis.
		string := q.Curve[i].sub(*p)
		if string.norm() < 0.05 {
			continue
		}
		ruling := r.Plus[i].sub(*p).unit()
		if ruling.cross(Vec3{math.Cos(u), math.Sin(u), 0}).norm() > 1e-6 {
			t.Fatalf("ruling %d is not along the base's principal normal: %+v", i, ruling)
		}
		// The base lies in the involute's normal plane.
		if math.Abs(string.dot(ruling)) > 1e-7*string.norm() {
			t.Fatalf("base point %d is off the involute's normal plane", i)
		}
	}
	// Each representative string leaves the base at its contact point and
	// reaches the involute.
	for _, s := range q.Constructions {
		near(t, s.Contact, q.Curve[s.SampleIndex], 0)
		near(t, s.Foot, s.Contact, 0)
		near(t, s.Image, r.Base[s.SampleIndex], 0)
	}
}

// The helix's involute is an involute of a circle of radius a, whose
// radius of curvature is the string's horizontal length a|c − s|/w; it is
// planar, so its torsion vanishes.
func TestInvoluteInputCurvatureIsTheUnwoundCircles(t *testing.T) {
	anchor, offset := 0.7, 1.3
	c := unwound(helixStudy(), anchor, offset)
	c.Construction, c.Diagnostics = "developable", true
	r := composed(t, c)
	d := r.Diagnostics
	checked := 0
	for i := range r.Base {
		length := offset - helixW*(at(c, i)-anchor)
		if math.Abs(length) < 0.2 {
			continue
		}
		kappa := helixW / (helixA * math.Abs(length))
		if d.Curvature[i] == nil || math.Abs(*d.Curvature[i]-kappa) > 1e-5*kappa {
			t.Fatalf("sample %d: κ %v, want %g", i, d.Curvature[i], kappa)
		}
		if d.Torsion[i] != nil && math.Abs(*d.Torsion[i]) > 1e-3*kappa {
			t.Fatalf("sample %d: τ %g on a planar curve", i, *d.Torsion[i])
		}
		checked++
	}
	if checked < c.Samples*9/10 {
		t.Fatalf("only %d samples checked", checked)
	}
}

// On a knot, with closed-form derivatives, the involute's strings lie
// along the knot's tangents, its tangents along the knot's principal
// normals, and the knot in its normal planes. A closed knot's involute is
// open: it ends a whole length L of string away, I(2π) − I(0) = −L T(0).
func TestInvoluteInputOnAKnot(t *testing.T) {
	plain := study()
	plain.Diagnostics = true
	want, err := Compute(plain)
	if err != nil {
		t.Fatal(err)
	}
	c := unwound(study(), 1, 2)
	c.Construction = "developable"
	r := composed(t, c)
	n := c.Samples
	checked := 0
	for i, p := range r.Base {
		if p == nil || r.Plus[i] == nil {
			continue
		}
		string := r.Composition.Curve[i].sub(*p)
		if string.cross(*want.Diagnostics.Tangent[i]).norm() > 1e-9*(1+string.norm()) {
			t.Fatalf("string %d is not along the knot's tangent", i)
		}
		if string.norm() < 0.05 {
			continue
		}
		ruling := r.Plus[i].sub(*p).unit()
		if ruling.cross(*want.Diagnostics.Normal[i]).norm() > 1e-6 {
			t.Fatalf("ruling %d is not along the knot's principal normal", i)
		}
		if math.Abs(string.dot(ruling)) > 1e-7*string.norm() {
			t.Fatalf("knot point %d is off the involute's normal plane", i)
		}
		checked++
	}
	if checked < n*9/10 {
		t.Fatalf("only %d samples checked", checked)
	}
	if r.Composition.Curve[n] != r.Composition.Curve[0] {
		t.Fatal("the closed knot does not repeat its first sample")
	}
	length := 0.0
	const steps = 20000
	for k := 0; k < steps; k++ {
		_, v0, _ := knot(c, 2*math.Pi*float64(k)/steps)
		_, v1, _ := knot(c, 2*math.Pi*(float64(k)+0.5)/steps)
		_, v2, _ := knot(c, 2*math.Pi*float64(k+1)/steps)
		length += 2 * math.Pi / steps / 6 * (v0.norm() + 4*v1.norm() + v2.norm())
	}
	_, v, _ := knot(c, 0)
	near(t, r.Base[n].sub(*r.Base[0]), v.unit().mul(-length), 1e-8)
}

// On the knot's involute, torsion is the involute's own binormal turning
// rate along its samples (dB/ds = −τN), which needs I″ whole, not just its
// part across the tangent.
func TestInvoluteInputTorsionIsItsBinormalsTurning(t *testing.T) {
	c := unwound(study(), 1, 2)
	c.Construction, c.Diagnostics, c.Samples = "developable", true, 2400
	r := composed(t, c)
	d := r.Diagnostics
	checked := 0
	for i := 1; i < c.Samples; i++ {
		if d.Torsion[i] == nil || d.Binormal[i-1] == nil || d.Binormal[i+1] == nil || r.Breaks[i] || r.Breaks[i+1] {
			continue
		}
		ds := r.Base[i+1].sub(*r.Base[i]).norm() + r.Base[i].sub(*r.Base[i-1]).norm()
		turning := -d.Binormal[i+1].sub(*d.Binormal[i-1]).dot(*d.Normal[i]) / ds
		if math.Abs(turning-*d.Torsion[i]) > 0.05*math.Abs(*d.Torsion[i])+0.01 {
			t.Fatalf("sample %d: τ %g, binormal turns at %g", i, *d.Torsion[i], turning)
		}
		checked++
	}
	if checked < c.Samples/2 {
		t.Fatalf("only %d samples checked", checked)
	}
}

// Where the base is straight the involute stands still, I′ = (c − s)κ|r′|N
// = 0: the cubic (t, t³) has its inflection on sample 120, which has no
// involute point however small the differenced r″ there.
func TestInvoluteInputStandsStillWhereTheBaseIsStraight(t *testing.T) {
	c := unwound(custom("t", "t^3", "0", -1, 1), 0.5, 0.3)
	c.Samples, c.Construction = 240, "developable"
	r := composed(t, c)
	if r.Base[120] != nil || r.Base[119] == nil || r.Base[121] == nil {
		t.Fatalf("samples around the inflection: %v %v %v", r.Base[119], r.Base[120], r.Base[121])
	}
	if r.Composition.Cusps != 2 {
		t.Fatalf("%d cusps; want the string's end and the inflection", r.Composition.Cusps)
	}
}

// The involute's evaluator writes I′ and I″ from the base's derivatives,
// not by differencing I: they must match central differences of the
// positions it returns, on an expression knot and an analytic one.
func TestInvoluteInputDerivativesMatchItsPositions(t *testing.T) {
	for _, c := range []Request{
		unwound(custom("2*cos(t)", "sin(2*t)", "0.7*sin(3*t)", 0, 2*math.Pi), 1, 0.5),
		unwound(study(), 1, 2),
	} {
		base, lo, hi, closed, err := compile(c, nil)
		if err != nil {
			t.Fatal(err)
		}
		curve, _, breaks := baseSamples(c, base, lo, hi, c.Samples, closed)
		evaluate, _, _, err := c.Unwinding.evaluation(base, lo, hi, curve, breaks)
		if err != nil {
			t.Fatal(err)
		}
		const h = 1e-3
		checked := 0
		for k := 1; k < 40; k++ {
			u := lo + (hi-lo)*float64(k)/40
			p, v, a, ok := evaluate(u)
			pm, _, _, okm := evaluate(u - h)
			pp, _, _, okp := evaluate(u + h)
			if !ok || !okm || !okp || !a.valid() || v.norm() < 0.1 {
				continue
			}
			dv := pp.sub(pm).mul(1 / (2 * h))
			da := pp.sub(p.mul(2)).add(pm).mul(1 / (h * h))
			if dv.sub(v).norm() > 1e-4*(1+v.norm()) || da.sub(a).norm() > 1e-3*(1+a.norm()) {
				t.Fatalf("%s at t = %g: I′ %+v ≈ %+v, I″ %+v ≈ %+v", c.Format, u, v, dv, a, da)
			}
			checked++
		}
		if checked < 30 {
			t.Fatalf("%s: only %d parameters checked", c.Format, checked)
		}
	}
}

// Arc length is integrated at each point, not along the sample grid: the
// parabola (t, t²/2) has s = F(t) − F(t₀), F(t) = (t√(1 + t²) + asinh t)/2,
// matched at a coarse grid with the anchor between samples, and under a
// regular reparameterization.
func TestInvoluteInputArcLengthIsExact(t *testing.T) {
	F := func(t float64) float64 { return (t*math.Sqrt(1+t*t) + math.Asinh(t)) / 2 }
	anchor, offset := -0.4, 0.5
	for _, c := range []Request{
		unwound(custom("t", "t^2/2", "0", -1.5, 1.5), anchor, offset),
		unwound(custom("2*t", "2*t^2", "0", -0.75, 0.75), anchor/2, offset),
	} {
		c.Samples, c.Construction = 240, "developable"
		r := composed(t, c)
		missing := 0
		for i, p := range r.Base {
			u := -1.5 + 3*float64(i)/float64(c.Samples)
			if p == nil {
				missing++
				continue
			}
			tangent := Vec3{1, u, 0}.mul(1 / math.Sqrt(1+u*u))
			near(t, p, Vec3{u, u * u / 2, 0}.add(tangent.mul(offset-F(u)+F(anchor))), 1e-9)
		}
		if missing > 1 || r.Composition.Cusps != 1 {
			t.Fatalf("%s: %d missing, %d cusps", c.Curve.X, missing, r.Composition.Cusps)
		}
	}
}

// Arc length never accumulates across a break: beyond the asymptotes of
// (tan t, cos t, sin t) at ±π/2 the involute is unreached, which is not a
// cusp; the one cusp is where s = c.
func TestInvoluteInputStopsAtBreaks(t *testing.T) {
	c := unwound(custom("tan(t)", "cos(t)", "sin(t)", -2, 2), 0.5, 0.3)
	c.Samples, c.Construction = 481, "developable"
	r := composed(t, c)
	beyond := 0
	for i, p := range r.Composition.Curve {
		if u := at(c, i); p != nil && math.Abs(u) > math.Pi/2 {
			beyond++
			if r.Base[i] != nil {
				t.Fatalf("sample %d beyond an asymptote was reached", i)
			}
		}
	}
	if beyond == 0 || r.Composition.Unreached != beyond || r.Composition.Cusps != 1 {
		t.Fatalf("%d beyond, %d unreached, %d cusps", beyond, r.Composition.Unreached, r.Composition.Cusps)
	}
	// The semicubical parabola (t², t³) turns back at t = 0, where its speed
	// vanishes but stays finite: the quadrature could integrate across, but
	// the base's break stops it.
	cusp := unwound(custom("t^2", "t^3", "0", -1, 1.0005), 0.5, 0.3)
	cusp.Construction = "developable"
	q := composed(t, cusp)
	before := 0
	for i, p := range q.Composition.Curve {
		if p != nil && at(cusp, i) < 0 {
			before++
			if q.Base[i] != nil {
				t.Fatalf("sample %d before the base's cusp was reached", i)
			}
		}
	}
	if before == 0 || q.Composition.Unreached != before {
		t.Fatalf("%d before the cusp, %d unreached", before, q.Composition.Unreached)
	}
}

func TestInvoluteInputRigidMotion(t *testing.T) {
	c := unwound(custom("2*cos(t)", "sin(2*t)", "0.7*sin(3*t)", 0, 2*math.Pi), 1, 0.5)
	moved := c
	moved.Curve.X, moved.Curve.Y, moved.Curve.Z = "2*cos(t)+1", "sin(2*t)-2", "0.7*sin(3*t)+0.5"
	shift := Vec3{1, -2, 0.5}
	for _, construction := range []string{"developable", "involute"} {
		c.Construction, moved.Construction = construction, construction
		c.Involute = InvoluteRequest{Anchor: 2, Offset: 0.4}
		moved.Involute = c.Involute
		a, b := composed(t, c), composed(t, moved)
		if !reflect.DeepEqual(a.Breaks, b.Breaks) {
			t.Fatalf("%s: breaks changed under translation", construction)
		}
		for i, p := range a.Base {
			if (p == nil) != (b.Base[i] == nil) {
				t.Fatalf("%s: reach changed at %d", construction, i)
			}
			if p != nil {
				near(t, b.Base[i], p.add(shift), 1e-8)
			}
		}
	}
}

// The involute of the helix's involute unwinds the circle involute in its
// plane, along its own arc length s₂ = (a/w)∫(c − s) dt from a second
// anchor: each string runs along the input's tangent, the base's inward
// principal normal (−cos t, −sin t, 0), while c − s > 0.
func TestInvoluteOfAnInvolute(t *testing.T) {
	anchor, offset, anchor2, offset2 := 0.7, 1.3, 0.0, 0.5
	c := unwound(helixStudy(), anchor, offset)
	c.Construction = "involute"
	c.Involute = InvoluteRequest{Anchor: anchor2, Offset: offset2}
	r := composed(t, c)
	m := r.Involute.Members[0].Points
	checked := 0
	for i, p := range m {
		u := at(c, i)
		if u > anchor+offset/helixW-0.05 {
			continue
		}
		if p == nil {
			t.Fatalf("sample %d unreached", i)
		}
		s2 := helixA / helixW * (offset*(u-anchor2) - helixW*((u-anchor)*(u-anchor)-(anchor2-anchor)*(anchor2-anchor))/2)
		want := helixInvolute(u, anchor, offset).add(Vec3{-math.Cos(u), -math.Sin(u), 0}.mul(offset2 - s2))
		near(t, p, want, 1e-6)
		checked++
	}
	if checked < c.Samples/2 {
		t.Fatalf("only %d samples checked", checked)
	}
}

// Every construction that takes an input acts on the involute, and the
// pole, which the involute does not use, neither frames the study nor is
// validated.
func TestEveryConstructionActsOnTheInvolute(t *testing.T) {
	anchor, offset := 0.7, 1.3
	c := unwound(helixStudy(), anchor, offset)
	c.Pole = Vec3{0, 0, 1000}
	c.Frame = frameRequest()
	c.Ruled = RuledRequest{Partner: "chord", Rate: 1, Shift: 1}
	c.Canal = CanalRequest{Radius: 0.2, Profile: "1", Meridians: 4}
	c.Involute = InvoluteRequest{Anchor: 0, Offset: 0.5}
	for _, construction := range []string{"developable", "involute", "framed", "ruled", "canal"} {
		c.Construction = construction
		if construction == "canal" {
			c.Frame = FrameRequest{Kind: "rotation-minimizing", Reference: Vec3{0, 0, 1}, Closure: "seam"}
		}
		r := composed(t, c)
		for i, p := range r.Base {
			if p != nil {
				near(t, p, helixInvolute(at(c, i), anchor, offset), 1e-9)
			}
		}
		if r.Bounds.Radius > 100 {
			t.Fatalf("%s: the pole framed the study: %+v", construction, r.Bounds)
		}
	}
	// Far from the origin, the study frames itself alone.
	far := unwound(custom("2*cos(t)+50", "2*sin(t)", "t/2", -2*math.Pi, 2*math.Pi), anchor, offset)
	far.Construction = "developable"
	if r := composed(t, far); r.Bounds.Center.X < 40 || r.Bounds.Radius > 20 {
		t.Fatalf("the origin framed a distant study: %+v", r.Bounds)
	}
	// Nor is the pole validated.
	c.Pole = Vec3{math.NaN(), 0, 2e5}
	composed(t, c)
}

// Unwinding is read only for the involute input.
func TestUnwindingIgnoredForOtherInputs(t *testing.T) {
	for _, input := range []string{"base", "tangent-foot"} {
		c := study()
		c.Construction, c.Input, c.Pole = "developable", input, Vec3{0.4, -0.3, 0.9}
		want, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		c.Unwinding = UnwindingRequest{Anchor: math.NaN(), Offset: 1e9}
		got, err := Compute(c)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: unwinding changed the result (%v)", input, err)
		}
	}
}

func TestInvoluteInputValidation(t *testing.T) {
	c := unwound(helixStudy(), 0.7, 1.3)
	c.Construction = "developable"
	for _, q := range []struct {
		anchor, offset float64
		message        string
	}{
		{7, 1, "input's anchor"},
		{math.NaN(), 1, "input's anchor"},
		{0, math.Inf(1), "input's string length"},
		{0, 2e5, "input's string length"},
	} {
		c.Unwinding = UnwindingRequest{Anchor: q.anchor, Offset: q.offset}
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), q.message) {
			t.Fatalf("%+v: %v", q, err)
		}
	}
	// An anchor beyond an asymptote's break cannot reach the samples.
	broken := unwound(custom("tan(t)", "cos(t)", "sin(t)", -2, 2), math.Pi/2, 0.3)
	broken.Samples, broken.Construction = 481, "developable"
	if _, err := Compute(broken); err == nil || !strings.Contains(err.Error(), "input's anchor") {
		t.Fatalf("anchor on a break: %v", err)
	}
	// A line's involute is a point: there is nothing to build on. Its
	// differenced r″ is roundoff, which would otherwise pass for curvature
	// in a direction of its own, worse the longer the string.
	for _, offset := range []float64{0.5, 1000} {
		line := unwound(custom("pi*t", "e*t+1", "t/3", -1, 1), 0.1, offset)
		line.Construction = "developable"
		if _, err := Compute(line); err == nil || !strings.Contains(err.Error(), "straight") {
			t.Fatalf("straight base, c = %g: %v", offset, err)
		}
	}
}
