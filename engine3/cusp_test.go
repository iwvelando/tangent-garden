package engine3

import (
	"math"
	"tangentgarden/engine/expr"
	"testing"
)

func TestExpressionTranslationKeepsPositionsAndOrdinaryStencil(t *testing.T) {
	for _, shift := range []float64{0, 3, 5000} {
		c := custom(affine("t^2", 1, shift), affine("t^3", 1, -0.6*shift), number(0.8*shift), -1, 1)
		evaluate, lo, hi, _, err := compile(c, nil)
		if err != nil {
			t.Fatal(err)
		}
		var entered [3]expr.Expr
		for i, s := range []string{c.Curve.X, c.Curve.Y, c.Curve.Z} {
			entered[i], err = expr.ParseWithParameter(s, c.Curve.A)
			if err != nil {
				t.Fatal(err)
			}
		}
		position := func(t float64) Vec3 { return Vec3{entered[0](t), entered[1](t), entered[2](t)} }
		original := sampled(position, lo, hi, hi-lo, sized(extent(position, lo, hi), hi-lo, absolute))
		for _, at := range []float64{-1, -0.1234, 0, 1e-8, 0.1357, 1} {
			r, v, a, ok := evaluate(at)
			if r != position(at) || !ok || !v.valid() || !a.valid() {
				t.Fatalf("shift %g at %g: position %v, stable %v", shift, at, r, ok)
			}
			if shift < 5000 {
				_, oldV, oldA, oldOK := original(at)
				if v != oldV || a != oldA || ok != oldOK {
					t.Fatalf("ordinary stencil changed at shift %g, t %g", shift, at)
				}
			} else {
				near(t, &v, Vec3{2 * at, 3 * at * at, 0}, 1e-11)
				near(t, &a, Vec3{2, 6 * at, 0}, 1e-7)
			}
		}
	}
}

// The tangent projection of (t²,t³,0) from (.5,.5,.3) is regular at
// the base cusp. Its first two derivatives there are (.75,.75,0) and
// (-2.25,2.25,0), so its curvature is sqrt(8).
func TestTranslatedProjectionCurvatureAtBaseCusp(t *testing.T) {
	for _, input := range []string{"tangent-foot", "orthotomic"} {
		c := custom("t^2", "t^3", "0", -1, 1)
		c.Construction, c.Input, c.Pole, c.Length = "developable", input, Vec3{0.5, 0.5, 0.3}, 0.2
		c.Diagnostics = true
		want := math.Sqrt(8)
		if input == "orthotomic" {
			want /= 2
		}
		for _, shift := range []Vec3{{}, {5000, -3000, 4000}, {90000, -70000, 80000}} {
			_, moved, _ := similar(c, similarity{"moved", 1, shift})
			r := composed(t, moved)
			if r.Composition.Crossed != 1 || r.Breaks[240] || r.Breaks[241] {
				t.Fatalf("%s at %v: projection does not cross the base cusp", input, shift)
			}
			k := r.Diagnostics.Curvature[240]
			if k == nil {
				t.Errorf("%s at %v: missing curvature", input, shift)
			} else if math.Abs(*k-want) > 2e-6 {
				t.Errorf("%s at %v: curvature %.12g, want %.12g", input, shift, *k, want)
			}
		}
	}
}

// Ordinary studies, including a translation inside a nonlinear operation,
// retain the original projection stencil, with exactly the same positions,
// derivatives and stability decisions.
func TestOrdinaryProjectionStencilUnchanged(t *testing.T) {
	for _, xyz := range [][3]string{
		{"t^2", "t^3", "0"},
		{"3+t^2", "-2+t^3", "1"},
		{"sin(t+5000)", "cos(t+5000)", "t"},
	} {
		c := custom(xyz[0], xyz[1], xyz[2], -1, 1)
		c.Input, c.Pole = "tangent-foot", Vec3{0.5, 0.5, 0.3}
		base, lo, hi, _, err := compile(c, nil)
		if err != nil {
			t.Fatal(err)
		}
		u := base.units(lo, hi, absolute)
		want := composedEvaluation(c.Input, c.Pole, base, lo, hi, u)
		got := c.projectedEvaluation(base, lo, hi, u)
		for _, at := range []float64{-1, -0.1234, 0, 1e-8, 0.1357, 1} {
			p, v, a, ok := got(at)
			q, w, b, valid := want(at)
			// NaN accelerations stand for an unknown second derivative.
			if p != q || v != w || a.valid() != b.valid() || a.valid() && a != b || ok != valid {
				t.Fatalf("%v at %g: ordinary projection stencil changed", xyz, at)
			}
		}
	}
}

// A circle projected from a point on it is a cardioid with curvature
// 3/(4|cos(t/2)|). Translation must preserve its regular bending and its
// own cusp, where a construction must still stop.
func TestTranslatedProjectedCircleKeepsCurvatureAndCusp(t *testing.T) {
	c := unitCircle(480)
	c.Construction, c.Input, c.Pole, c.Length = "developable", "tangent-foot", Vec3{-1, 0, 0}, 0.2
	c.Diagnostics = true
	_, moved, _ := similar(c, similarity{"far", 1, Vec3{90000, -70000, 80000}})
	r := composed(t, moved)
	if r.Base[240] != nil || !r.Breaks[240] || !r.Breaks[241] || r.Composition.Cusps != 1 {
		t.Fatal("the input's own cusp is no longer broken")
	}
	for _, i := range []int{0, 60, 120, 180, 300, 360, 420, 480} {
		parameter := 2 * math.Pi * float64(i) / 480
		want := 3 / (4 * math.Abs(math.Cos(parameter/2)))
		k := r.Diagnostics.Curvature[i]
		if k == nil {
			t.Errorf("sample %d has no curvature", i)
		} else if math.Abs(*k-want) > 2e-6 {
			t.Errorf("sample %d: curvature %.12g, want %.12g", i, *k, want)
		}
	}
}

// The deltoid r = (2cos t + cos 2t, 2sin t − sin 2t) lifted by
// z = cos(3t)/2 keeps its three cusps: at t = 0, 2π/3 and 4π/3 its
// velocity (−2sin t − 2sin 2t, 2cos t − 2cos 2t, −1.5 sin 3t) vanishes
// and its acceleration (−2cos t − 4cos 2t, −2sin t + 4sin 2t, −4.5 cos 3t)
// does not. Written as expressions on [−1, 2π − 1], each cusp falls
// inside an interval and is differenced numerically.
func liftedDeltoid() Request {
	c := custom("2*cos(t)+cos(2*t)", "2*sin(t)-sin(2*t)", "0.5*cos(3*t)", -1, 2*math.Pi-1)
	c.Samples = 480
	return c
}

// deltoidCusp is the lifted deltoid's point and the direction of its
// acceleration at a cusp t₀, along which the tangent line lies there.
func deltoidCusp(t0 float64) (Vec3, Vec3) {
	r := Vec3{2*math.Cos(t0) + math.Cos(2*t0), 2*math.Sin(t0) - math.Sin(2*t0), 0.5 * math.Cos(3*t0)}
	a := Vec3{-2*math.Cos(t0) - 4*math.Cos(2*t0), -2*math.Sin(t0) + 4*math.Sin(2*t0), -4.5 * math.Cos(3*t0)}
	return r, a.unit()
}

// Across a cusp of the base the tangent line is continuous, so both
// projections join there, through the foot on the limiting line along
// r″(t₀), while the base itself stays broken.
func TestProjectionCrossesBaseCusps(t *testing.T) {
	for _, kind := range []string{"tangent-foot", "orthotomic"} {
		c := liftedDeltoid()
		c.Construction, c.Pole = kind, Vec3{0.4, -0.3, 1.1}
		r := projected(t, c)
		q := r.Projection
		if q.Crossed != 3 || len(q.Breaks) != c.Samples+1 {
			t.Fatalf("%s: crossed %d cusps, %d breaks", kind, q.Crossed, len(q.Breaks))
		}
		step := 2 * math.Pi / float64(c.Samples)
		for k := 0; k < 3; k++ {
			t0 := 2 * math.Pi * float64(k) / 3
			i := int((t0 + 1) / step)
			if !r.Breaks[i+1] {
				t.Fatalf("%s: the base is joined across its cusp at %g", kind, t0)
			}
			if q.Breaks[i+1] || q.Points[i] == nil || q.Points[i+1] == nil {
				t.Fatalf("%s: the projection is broken at the cusp %g", kind, t0)
			}
			at, line := deltoidCusp(t0)
			limit := project(kind, c.Pole, at, line)
			// The chord between the samples beside t₀ passes within its sag
			// of the limit, about step²|H″|/8.
			if d := segmentDistance(limit, *q.Points[i], *q.Points[i+1]); d > 2e-3 {
				t.Fatalf("%s: the joined chord misses the limit at %g by %g", kind, t0, d)
			}
		}
		for i, b := range q.Breaks {
			if b {
				t.Fatalf("%s: the projection is broken at %d", kind, i)
			}
		}
	}
}

// A cusp on a sample: the base has no tangent there and keeps its gap,
// while the projection takes the foot on the limiting line, along
// r″(0) = (2, 0, 0) for the semicubical parabola (t², t³, 0).
func TestProjectionAtACuspSample(t *testing.T) {
	c := custom("t^2", "t^3", "0", -1, 1)
	c.Construction, c.Pole = "tangent-foot", Vec3{0.5, 0.5, 0.3}
	r := projected(t, c)
	q := r.Projection
	if r.Base[240] != nil || q.Crossed != 1 || len(q.Breaks) != c.Samples+1 || q.Breaks[240] || q.Breaks[241] {
		t.Fatalf("base %v, crossed %d, breaks %v", r.Base[240], q.Crossed, q.Breaks)
	}
	near(t, q.Points[240], Vec3{0.5, 0, 0}, 1e-9)
	near(t, q.Feet[240], Vec3{0.5, 0, 0}, 1e-9)
	c.Construction = "orthotomic"
	near(t, projected(t, c).Projection.Points[240], Vec3{0.5, -0.5, -0.3}, 1e-9)
}

// The lifted deltoid as a closed harmonic curve has exact derivatives and
// its cusps on samples 0 (which is also sample n), 160 and 320.
func TestProjectionCrossesHarmonicCusps(t *testing.T) {
	c := harmonicStudy(0, 2*math.Pi, Vec3{},
		HarmonicTerm{1, Vec3{2, 0, 0}, Vec3{0, 2, 0}},
		HarmonicTerm{2, Vec3{1, 0, 0}, Vec3{0, -1, 0}},
		HarmonicTerm{3, Vec3{0, 0, 0.5}, Vec3{}})
	c.Construction, c.Pole = "tangent-foot", Vec3{0.4, -0.3, 1.1}
	r := projected(t, c)
	q := r.Projection
	if q.Crossed != 3 {
		t.Fatalf("crossed %d cusps", q.Crossed)
	}
	for _, i := range []int{0, 160, 320} {
		t0 := 2 * math.Pi * float64(i) / 480
		at, line := deltoidCusp(t0)
		near(t, q.Points[i], project("tangent-foot", c.Pole, at, line), 1e-9)
	}
	for i, b := range q.Breaks {
		if b {
			t.Fatalf("the projection is broken at %d", i)
		}
	}
}

// Where the tangent reverses without a simple zero of the velocity, the
// line does not continue and the projection stays broken: a regular turn
// too tight for the samples, whose line sweeps half a turn between them,
// and a corner.
func TestProjectionKeepsOtherReversalsBroken(t *testing.T) {
	for _, x := range [][3]string{{"t^2", "t^3", "1e-6*t"}, {"abs(t)", "0.3*t", "0"}} {
		c := custom(x[0], x[1], x[2], -1, 1.0005)
		c.Construction, c.Pole = "tangent-foot", Vec3{0.5, 0.5, 0.3}
		r := projected(t, c)
		if r.Projection.Crossed != 0 || r.Projection.Breaks != nil || !r.Breaks[240] {
			t.Fatalf("%s: crossed %d, break %v", x[0], r.Projection.Crossed, r.Breaks[240])
		}
	}
}

// A cusp is crossed only where the samples resolve it: a line that turns
// too far between them, as where r′ = t(cos 150t, sin 150t, 0) turns by
// 35° across the cusp's interval, and a jump of the position inside it,
// where the velocity at both ends and the middle still looks like a
// cusp's, stay broken.
func TestUnresolvedCuspsStayBroken(t *testing.T) {
	for _, x := range [][2]string{
		{"cos(150*t)/22500+t*sin(150*t)/150", "sin(150*t)/22500-t*cos(150*t)/150"},
		{"t^2+0.01*(t+0.003)/abs(t+0.003)", "t^3"},
	} {
		c := custom(x[0], x[1], "0", -1, 1.0005)
		c.Construction, c.Pole = "tangent-foot", Vec3{0.5, 0.5, 0.3}
		r := projected(t, c)
		// The cusp at t = 0 lies in interval 239, from −0.0041 to 0.0001.
		if !r.Breaks[240] || r.Projection.Crossed != 0 || r.Projection.Breaks != nil {
			t.Fatalf("%s: break %v, crossed %d", x[0], r.Breaks[240], r.Projection.Crossed)
		}
	}
}

// r = (1 − cos t, sin(10t)/10 − sin t, 0) has r′(0) = 0, r″(0) = (1, 0, 0)
// and r‴(0) = (0, −99, 0), so with exact derivatives and the cusp at the
// middle of its interval its line turns by about 37° to either end, while
// its chord, −33h³ for a half-step h, stays within the bound 0.5h² since
// the turns on the two sides cancel: the line's turn alone refuses it.
func TestACuspTurningTooFarStaysBroken(t *testing.T) {
	s := 2 * math.Pi / 240
	c := harmonicStudy(-math.Pi-s/2, math.Pi-s/2, Vec3{1, 0, 0},
		HarmonicTerm{1, Vec3{-1, 0, 0}, Vec3{0, -1, 0}},
		HarmonicTerm{10, Vec3{}, Vec3{0, 0.1, 0}})
	c.Samples = 240
	c.Construction, c.Pole = "tangent-foot", Vec3{0.5, 0.5, 0.3}
	r := projected(t, c)
	if !r.Breaks[121] || r.Projection.Crossed != 0 || r.Projection.Breaks != nil {
		t.Fatalf("break %v, crossed %d", r.Breaks[121], r.Projection.Crossed)
	}
}

// Refined between samples, the projection runs through the cusp unbroken
// and passes the limit foot.
func TestRefinedProjectionCrossesBaseCusps(t *testing.T) {
	c := liftedDeltoid()
	c.Construction, c.Pole, c.Adaptive = "tangent-foot", Vec3{0.4, -0.3, 1.1}, true
	r := projected(t, c)
	path := r.Adaptive.Projection
	if r.Projection.Crossed != 3 || path.Breaks != 0 {
		t.Fatalf("crossed %d, %d refined breaks", r.Projection.Crossed, path.Breaks)
	}
	for _, p := range path.Points {
		if p == nil {
			t.Fatal("the refined projection is broken")
		}
	}
	for k := 0; k < 3; k++ {
		at, line := deltoidCusp(2 * math.Pi * float64(k) / 3)
		limit := project("tangent-foot", c.Pole, at, line)
		best := math.Inf(1)
		for j := 1; j < len(path.Points); j++ {
			best = math.Min(best, segmentDistance(limit, *path.Points[j-1], *path.Points[j]))
		}
		if best > path.Tolerance {
			t.Fatalf("the refined projection misses the limit by %g, tolerance %g", best, path.Tolerance)
		}
	}
}

// Built on the base's tangent-foot curve, a construction crosses the base's
// cusp too: the input curve is whole there, while the base beneath keeps
// its break and the cusp is not the input's own.
func TestComposedInputCrossesABaseCusp(t *testing.T) {
	for _, hi := range []float64{1, 1.0005} {
		c := custom("t^2", "t^3", "0", -1, hi)
		c.Construction, c.Input, c.Pole, c.Length = "developable", "tangent-foot", Vec3{0.5, 0.5, 0.3}, 0.2
		r := composed(t, c)
		q := r.Composition
		if q.Crossed != 1 || q.Cusps != 0 || !q.Breaks[240] && !q.Breaks[241] {
			t.Fatalf("hi %g: crossed %d, cusps %d", hi, q.Crossed, q.Cusps)
		}
		for i, b := range r.Breaks {
			if b {
				t.Fatalf("hi %g: the input is broken at %d", hi, i)
			}
		}
		if hi == 1 {
			near(t, r.Base[240], Vec3{0.5, 0, 0}, 1e-9)
		}
		// The input's own inflection, near t = 0.59, flips its sheet; at
		// the base's cusp the sheet runs on.
		faces := map[int]bool{}
		for _, v := range corners(r.Mesh) {
			faces[v.SampleIndex] = true
		}
		if !faces[240] || !faces[241] {
			t.Fatalf("hi %g: no face across the cusp", hi)
		}
	}
}

// A tube on the lifted deltoid's orthotomic is whole: it runs on through
// all three of the base's cusps.
func TestTubeOnOrthotomicCrossesCusps(t *testing.T) {
	c := canaled(liftedDeltoid(), 0.15, "1", 12)
	c.Input, c.Pole = "orthotomic", Vec3{0.4, -0.3, 1.1}
	r := composed(t, c)
	if r.Composition.Crossed != 3 || r.Composition.Cusps != 0 {
		t.Fatalf("crossed %d, cusps %d", r.Composition.Crossed, r.Composition.Cusps)
	}
	for i, b := range r.Breaks {
		if b {
			t.Fatalf("the tube is broken at %d", i)
		}
	}
}

// Moving an expression curve and its pole thousands of diameters must not
// break a regular construction on its tangent projection at a base cusp.
func TestTranslatedExpressionProjectionCrossesCusps(t *testing.T) {
	for _, input := range []string{"tangent-foot", "orthotomic"} {
		for _, hi := range []float64{1, 1.0005} {
			c := custom("t^2", "t^3", "0", -1, hi)
			c.Construction, c.Input, c.Pole, c.Length = "developable", input, Vec3{0.5, 0.5, 0.3}, 0.2
			want := composed(t, c)
			// This existing, untranslated construction already has one
			// continuous crossing, including when the cusp is on a sample.
			if want.Composition.Crossed != 1 {
				t.Fatal("untranslated cusp was not crossed")
			}
			_, moved, _ := similar(c, similarities[3])
			got := composed(t, moved)
			if hi == 1 {
				if got.Base[240] == nil {
					t.Fatalf("%s: gap at the translated cusp", input)
				}
				// r(0) is the cusp, with tangent line along x. Its foot is
				// (.5, 0, 0), or its half-turn image (.5, -.5, -.3).
				limit := Vec3{0.5, 0, 0}
				if input == "orthotomic" {
					limit = Vec3{0.5, -0.5, -0.3}
				}
				near(t, got.Base[240], similarities[3].point(limit), 2e-7)
			}
			if got.Composition.Crossed != 1 {
				t.Errorf("%s, end %g: crossed %d cusps, want 1", input, hi, got.Composition.Crossed)
			}
			for i := range want.Base {
				if got.Breaks[i] != want.Breaks[i] || (got.Base[i] == nil) != (want.Base[i] == nil) {
					t.Errorf("%s, end %g: sample %d changed gap or break", input, hi, i)
				}
				if got.Base[i] != nil && want.Base[i] != nil {
					near(t, got.Base[i], similarities[3].point(*want.Base[i]), 2e-7)
				}
			}
			faces := map[int]bool{}
			for _, v := range corners(got.Mesh) {
				faces[v.SampleIndex] = true
			}
			if !faces[240] || !faces[241] {
				t.Errorf("%s, end %g: missing faces across the base cusp", input, hi)
			}
		}
	}
}

func TestTranslatedExpressionTubeCrossesCusps(t *testing.T) {
	c := canaled(liftedDeltoid(), 0.15, "1", 12)
	c.Input, c.Pole, c.Adaptive = "orthotomic", Vec3{0.4, -0.3, 1.1}, true
	want := composed(t, c)
	_, moved, _ := similar(c, similarities[3])
	got := composed(t, moved)
	if got.Composition.Crossed != 3 || got.Composition.Cusps != want.Composition.Cusps {
		t.Fatalf("crossed %d, own cusps %d; want 3, %d", got.Composition.Crossed, got.Composition.Cusps, want.Composition.Cusps)
	}
	for i := range want.Base {
		if got.Breaks[i] != want.Breaks[i] || got.Base[i] == nil {
			t.Errorf("sample %d changed gap or break", i)
		}
		near(t, got.Base[i], similarities[3].point(*want.Base[i]), 2e-7)
	}
	if got.Adaptive.Base.Breaks != 0 || got.Adaptive.Base.Exhausted {
		t.Fatalf("refined input: %d breaks, exhausted %v", got.Adaptive.Base.Breaks, got.Adaptive.Base.Exhausted)
	}
	for _, p := range got.Adaptive.Base.Points {
		if p == nil {
			t.Fatal("gap in the refined input")
		}
	}
}

func TestTranslatedExpressionKeepsNonCuspsBroken(t *testing.T) {
	for _, xyz := range [][3]string{
		{"t^2", "t^3", "1e-6*t"},
		{"abs(t)", "0.3*t", "0"},
		{"t^2+0.01*(t+0.003)/abs(t+0.003)", "t^3", "0"},
		{"1/t", "t^3", "0"},
	} {
		c := custom(xyz[0], xyz[1], xyz[2], -1, 1.0005)
		c.Construction, c.Pole = "tangent-foot", Vec3{0.5, 0.5, 0.3}
		_, moved, _ := similar(c, similarities[3])
		r := projected(t, moved)
		if r.Projection.Crossed != 0 || r.Projection.Breaks != nil || !r.Breaks[240] {
			t.Errorf("%v: crossed %d, break %v", xyz, r.Projection.Crossed, r.Breaks[240])
		}
	}
}

// invertedDeltoid inverts a projection of the lifted deltoid in a sphere
// whose center the projection misses.
func invertedDeltoid(kind string) Request {
	c := liftedDeltoid()
	c.Construction, c.Pole = "inversion", Vec3{0.4, -0.3, 1.1}
	c.Inversion = InversionRequest{Center: Vec3{0.3, 0.2, -0.8}, Radius: 1.5, Input: kind}
	return c
}

// Inversion is continuous wherever its center is not, so the inverted
// projection runs on through the base's cusps as the projection does,
// through the image of the foot on the limiting line along r″(t₀), while
// the base stays broken.
func TestInvertedProjectionCrossesBaseCusps(t *testing.T) {
	for _, kind := range []string{"tangent-foot", "orthotomic"} {
		c := invertedDeltoid(kind)
		r := inverted(t, c)
		q := r.Inversion
		if q.Crossed != 3 || q.Crossings != 0 || q.Invalid != 0 {
			t.Fatalf("%s: crossed %d cusps, %d passages, %d invalid", kind, q.Crossed, q.Crossings, q.Invalid)
		}
		step := 2 * math.Pi / float64(c.Samples)
		for k := 0; k < 3; k++ {
			t0 := 2 * math.Pi * float64(k) / 3
			i := int((t0 + 1) / step)
			if !r.Breaks[i+1] {
				t.Fatalf("%s: the base is joined across its cusp at %g", kind, t0)
			}
			if q.Breaks[i+1] || q.Points[i] == nil || q.Points[i+1] == nil {
				t.Fatalf("%s: the image is broken at the cusp %g", kind, t0)
			}
			at, line := deltoidCusp(t0)
			limit := invert(c.Inversion.Center, c.Inversion.Radius, project(kind, c.Pole, at, line))
			// The image's chord between the samples beside t₀ passes within
			// its sag of the limit, as the projection's does, enlarged by
			// R²/|p − O|², under 2 at these cusps.
			if d := segmentDistance(limit, *q.Points[i], *q.Points[i+1]); d > 4e-3 {
				t.Fatalf("%s: the joined chord misses the limit at %g by %g", kind, t0, d)
			}
		}
		for i, b := range q.Breaks {
			if b {
				t.Fatalf("%s: the image is broken at %d", kind, i)
			}
		}
	}
}

// The inverted base has no tangent line to continue: it stays broken at
// every cusp, with nothing crossed. Joined there, its image would turn
// back as the base does, and pass for a passage through the center.
func TestInvertedBaseKeepsItsCuspsBroken(t *testing.T) {
	c := invertedDeltoid("base")
	q := inverted(t, c).Inversion
	if q.Crossed != 0 || q.Crossings != 0 || len(breaks(q.Breaks)) != 3 {
		t.Fatalf("crossed %d, %d passages, breaks %v", q.Crossed, q.Crossings, breaks(q.Breaks))
	}
}

// A cusp on a sample: the source there is the foot on the limiting line,
// (0.5, 0, 0) for the semicubical parabola (t², t³, 0), and its image is
// that foot's.
func TestInvertedProjectionAtACuspSample(t *testing.T) {
	c := custom("t^2", "t^3", "0", -1, 1)
	c.Construction, c.Pole = "inversion", Vec3{0.5, 0.5, 0.3}
	c.Inversion = InversionRequest{Center: Vec3{0, 1, 1}, Radius: 2, Input: "tangent-foot"}
	r := inverted(t, c)
	q := r.Inversion
	if r.Base[240] != nil || q.Crossed != 1 || q.Breaks[240] || q.Breaks[241] {
		t.Fatalf("base %v, crossed %d, breaks %v", r.Base[240], q.Crossed, breaks(q.Breaks))
	}
	near(t, q.Source[240], Vec3{0.5, 0, 0}, 1e-9)
	near(t, q.Points[240], invert(c.Inversion.Center, 2, Vec3{0.5, 0, 0}), 1e-9)
	// With the center on that foot, the cusp's image is undefined: counted
	// as invalid, and nothing is crossed.
	c.Inversion.Center = Vec3{0.5, 0, 0}
	q = inverted(t, c).Inversion
	if q.Points[240] != nil || q.Source[240] == nil || q.Invalid != 1 || q.Crossed != 0 || !q.Breaks[240] || !q.Breaks[241] {
		t.Fatalf("center on the limit foot: invalid %d, crossed %d, breaks %v", q.Invalid, q.Crossed, breaks(q.Breaks))
	}
}

// A center on the projection at a cusp sends the image through infinity
// there: the passage test breaks the crossed interval, counted as a
// passage, and the other two cusps are still crossed.
func TestAPassageAtACrossedCuspBreaks(t *testing.T) {
	c := invertedDeltoid("tangent-foot")
	at, line := deltoidCusp(0)
	c.Inversion.Center = project("tangent-foot", c.Pole, at, line)
	r := inverted(t, c)
	q := r.Inversion
	i := int(1 / (2 * math.Pi / float64(c.Samples)))
	if q.Crossed != 2 || q.Crossings != 1 || !q.Breaks[i+1] || len(breaks(q.Breaks)) != 1 {
		t.Fatalf("crossed %d, %d passages, breaks %v", q.Crossed, q.Crossings, breaks(q.Breaks))
	}
}

// Refined between samples, the inverted projection runs on through the
// cusps unbroken and passes each limit image.
func TestRefinedInvertedProjectionCrossesBaseCusps(t *testing.T) {
	c := invertedDeltoid("orthotomic")
	c.Adaptive = true
	r := inverted(t, c)
	q, path := r.Inversion, r.Adaptive.Image
	if q.Crossed != 3 || q.Crossings != 0 || path.Breaks != 0 {
		t.Fatalf("crossed %d, %d passages, %d refined breaks", q.Crossed, q.Crossings, path.Breaks)
	}
	for k := 0; k < 3; k++ {
		at, line := deltoidCusp(2 * math.Pi * float64(k) / 3)
		limit := invert(c.Inversion.Center, c.Inversion.Radius, project("orthotomic", c.Pole, at, line))
		best := math.Inf(1)
		for j := 1; j < len(path.Points); j++ {
			best = math.Min(best, segmentDistance(limit, *path.Points[j-1], *path.Points[j]))
		}
		if best > path.Tolerance {
			t.Fatalf("the refined image misses the limit by %g, tolerance %g", best, path.Tolerance)
		}
	}
}

// A center 0.0055 from the foot at one cusp: the image swings out in a
// loop about R²/d ≈ 400 across there, which the even samples' midpoint
// test passes over, joining the cusp. Refined, it is decided between
// samples instead, as a passage, and the cusp is no longer counted.
func TestRefinementDecidesANearPassageAtACrossedCusp(t *testing.T) {
	c := invertedDeltoid("tangent-foot")
	at, line := deltoidCusp(0)
	c.Inversion.Center = project("tangent-foot", c.Pole, at, line).add(Vec3{0, 0, 0.0055})
	if q := inverted(t, c).Inversion; q.Crossed != 3 || q.Crossings != 0 {
		t.Fatalf("crossed %d, %d passages", q.Crossed, q.Crossings)
	}
	c.Adaptive = true
	r := inverted(t, c)
	if q := r.Inversion; q.Crossed != 2 || q.Crossings != 1 || r.Adaptive.Image.Breaks != 1 {
		t.Fatalf("refined: crossed %d, %d passages, %d refined breaks", q.Crossed, q.Crossings, r.Adaptive.Image.Breaks)
	}
}

// With 479 intervals on [−π, π], the lifted deltoid's cusp at t = 0 is
// the middle of an interval, where the passage test looks and where
// refinement first divides it. As a harmonic curve its velocity there is
// exactly zero, so both take the source on the line along r″, and the
// image stays whole through all three cusps.
func TestInversionAtACuspMidInterval(t *testing.T) {
	for _, adaptive := range []bool{false, true} {
		c := harmonicStudy(-math.Pi, math.Pi, Vec3{},
			HarmonicTerm{1, Vec3{2, 0, 0}, Vec3{0, 2, 0}},
			HarmonicTerm{2, Vec3{1, 0, 0}, Vec3{0, -1, 0}},
			HarmonicTerm{3, Vec3{0, 0, 0.5}, Vec3{}})
		c.Construction, c.Pole, c.Samples, c.Adaptive = "inversion", Vec3{0.4, -0.3, 1.1}, 479, adaptive
		c.Inversion = InversionRequest{Center: Vec3{0.3, 0.2, -0.8}, Radius: 1.5, Input: "tangent-foot"}
		r := inverted(t, c)
		if q := r.Inversion; q.Crossed != 3 || q.Crossings != 0 || adaptive && r.Adaptive.Image.Breaks != 0 {
			t.Fatalf("adaptive %v: crossed %d, %d passages", adaptive, q.Crossed, q.Crossings)
		}
	}
}
