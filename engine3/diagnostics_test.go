package engine3

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"
)

func diagnosed(t *testing.T, c Request) (Result, *DiagnosticsResult) {
	t.Helper()
	c.Diagnostics = true
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Diagnostics == nil {
		t.Fatal("missing diagnostics")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	d := r.Diagnostics
	for _, series := range [][]*Vec3{d.Tangent, d.Normal, d.Binormal, d.Center} {
		if len(series) != len(r.Base) {
			t.Fatalf("series of %d for %d samples", len(series), len(r.Base))
		}
	}
	if len(d.Curvature) != len(r.Base) || len(d.Torsion) != len(r.Base) {
		t.Fatalf("scalar series of %d and %d for %d samples", len(d.Curvature), len(d.Torsion), len(r.Base))
	}
	return r, d
}

// parameter is sample i's t, from the reported domain.
func parameter(d *DiagnosticsResult, i int) float64 {
	n := len(d.Curvature) - 1
	return d.Min + (d.Max-d.Min)*float64(i)/float64(n)
}

// frenet checks the frame's identities wherever it is defined, and that the
// osculating centre lies 1/κ along N.
func frenet(t *testing.T, r Result, d *DiagnosticsResult) (defined int) {
	t.Helper()
	for i := range r.Base {
		if d.Normal[i] == nil {
			if d.Binormal[i] != nil || d.Torsion[i] != nil || d.Center[i] != nil {
				t.Fatalf("sample %d: partial frame", i)
			}
			continue
		}
		defined++
		T, N, B := *d.Tangent[i], *d.Normal[i], *d.Binormal[i]
		for _, v := range []Vec3{T, N, B} {
			if math.Abs(v.norm()-1) > 1e-12 {
				t.Fatalf("sample %d: not unit", i)
			}
		}
		if math.Abs(T.dot(N)) > 1e-12 || T.cross(N).sub(B).norm() > 1e-12 {
			t.Fatalf("sample %d: not right-handed orthonormal", i)
		}
		if d.Curvature[i] == nil || *d.Curvature[i] <= 0 {
			t.Fatalf("sample %d: frame without positive curvature", i)
		}
		if c := d.Center[i]; c != nil {
			want := r.Base[i].add(N.mul(1 / *d.Curvature[i]))
			if c.sub(want).norm() > 1e-9*math.Max(1, want.norm()) {
				t.Fatalf("sample %d: centre %+v, want %+v", i, *c, want)
			}
		}
	}
	return defined
}

func TestHelixCurvatureAndTorsion(t *testing.T) {
	// r(t) = (R cos t, R sin t, ht): κ = R/(R²+h²), τ = h/(R²+h²), and N
	// points horizontally at the axis.
	for _, h := range []float64{0.5, -0.5} {
		R := 2.0
		c := custom("2*cos(t)", "2*sin(t)", "a*t", -2*math.Pi, 2*math.Pi)
		c.Curve.A = h
		r, d := diagnosed(t, c)
		kappa, tau := R/(R*R+h*h), h/(R*R+h*h)
		if frenet(t, r, d) != len(r.Base) || d.Flat != 0 || d.Unknown != 0 || d.Clipped != 0 {
			t.Fatalf("h=%v: flat %d unknown %d clipped %d", h, d.Flat, d.Unknown, d.Clipped)
		}
		for i := range r.Base {
			if math.Abs(*d.Curvature[i]-kappa) > 1e-6 || math.Abs(*d.Torsion[i]-tau) > 1e-5 {
				t.Fatalf("h=%v sample %d: κ %v τ %v, want %v %v", h, i, *d.Curvature[i], *d.Torsion[i], kappa, tau)
			}
			p, N := *r.Base[i], *d.Normal[i]
			axis := Vec3{-p.X, -p.Y, 0}.unit()
			if N.sub(axis).norm() > 1e-6 {
				t.Fatalf("h=%v sample %d: N %+v", h, i, N)
			}
		}
	}
}

func TestTwistedCubicCurvatureAndTorsion(t *testing.T) {
	c := custom("t", "t^2", "t^3", -1.5, 1.5)
	r, d := diagnosed(t, c)
	frenet(t, r, d)
	worstK, worstT := 0.0, 0.0
	for i := range r.Base {
		u := parameter(d, i)
		q := 9*u*u*u*u + 9*u*u + 1
		kappa := 2 * math.Sqrt(q) / math.Pow(1+4*u*u+9*u*u*u*u, 1.5)
		tau := 3 / q
		worstK = math.Max(worstK, math.Abs(*d.Curvature[i]-kappa)/kappa)
		worstT = math.Max(worstT, math.Abs(*d.Torsion[i]-tau)/tau)
	}
	if worstK > 1e-6 || worstT > 1e-4 {
		t.Fatalf("relative errors: κ %.3g, τ %.3g", worstK, worstT)
	}
}

func TestPlanarEllipseDiagnostics(t *testing.T) {
	// (a cos t, b sin t, 0): κ = a/b² at t = 0 and b/a² at t = π/2, τ = 0,
	// and the centres trace the evolute ((a²−b²)/a cos³t, (b²−a²)/b sin³t).
	a, b := 3.0, 1.5
	c := harmonicStudy(0, 2*math.Pi, Vec3{}, HarmonicTerm{Frequency: 1, Cosine: Vec3{a, 0, 0}, Sine: Vec3{0, b, 0}})
	r, d := diagnosed(t, c)
	if frenet(t, r, d) != len(r.Base) {
		t.Fatal("ellipse frame undefined somewhere")
	}
	n := len(r.Base) - 1
	if math.Abs(*d.Curvature[0]-a/(b*b)) > 1e-12 || math.Abs(*d.Curvature[n/4]-b/(a*a)) > 1e-12 {
		t.Fatalf("vertex curvatures %v %v", *d.Curvature[0], *d.Curvature[n/4])
	}
	for i := range r.Base {
		u := parameter(d, i)
		if math.Abs(*d.Torsion[i]) > 1e-9 {
			t.Fatalf("sample %d: τ %v", i, *d.Torsion[i])
		}
		if B := *d.Binormal[i]; B.sub(Vec3{0, 0, 1}).norm() > 1e-12 {
			t.Fatalf("sample %d: B %+v", i, B)
		}
		cu, su := math.Cos(u), math.Sin(u)
		evolute := Vec3{(a*a - b*b) / a * cu * cu * cu, (b*b - a*a) / b * su * su * su, 0}
		if d.Center[i].sub(evolute).norm() > 1e-9 {
			t.Fatalf("sample %d: centre %+v off the evolute %+v", i, *d.Center[i], evolute)
		}
	}
	// A closed curve's last sample repeats its first.
	if *d.Curvature[n] != *d.Curvature[0] || *d.Normal[n] != *d.Normal[0] {
		t.Fatal("closed curve does not repeat its first sample")
	}
}

func TestVortexTrajectoryDiagnostics(t *testing.T) {
	// V = (−y, x, a) from (1, 0, 0) is the helix (cos t, sin t, at).
	c := fieldRequest("-y", "x", "a", []Vec3{{1, 0, 0}}, 0, 6)
	r, d := diagnosed(t, c)
	h := c.Field.A
	kappa, tau := 1/(1+h*h), h/(1+h*h)
	frenet(t, r, d)
	for i := range r.Base {
		if d.Torsion[i] == nil {
			t.Fatalf("sample %d: τ unknown", i)
		}
		if math.Abs(*d.Curvature[i]-kappa) > 1e-6 || math.Abs(*d.Torsion[i]-tau) > 1e-4 {
			t.Fatalf("sample %d: κ %v τ %v, want %v %v", i, *d.Curvature[i], *d.Torsion[i], kappa, tau)
		}
	}
}

func TestKnotDiagnosticsMatchExpressions(t *testing.T) {
	// The analytic knot and the same knot as expressions, whose derivatives
	// are numerical, agree.
	knot := study()
	knot.Construction = "none"
	_, a := diagnosed(t, knot)
	h := "(2.4+0.85*cos(3*t))"
	expressions := custom(h+"*cos(2*t)", h+"*sin(2*t)", "0.85*sin(3*t)", 0, 2*math.Pi)
	expressions.Construction = "none"
	_, b := diagnosed(t, expressions)
	for i := range a.Curvature {
		if math.Abs(*a.Curvature[i]-*b.Curvature[i]) > 1e-6*math.Max(1, *a.Curvature[i]) {
			t.Fatalf("sample %d: κ %v and %v", i, *a.Curvature[i], *b.Curvature[i])
		}
		if math.Abs(*a.Torsion[i]-*b.Torsion[i]) > 1e-4*math.Max(1, math.Abs(*a.Torsion[i])) {
			t.Fatalf("sample %d: τ %v and %v", i, *a.Torsion[i], *b.Torsion[i])
		}
	}
}

func TestDiagnosticsInvariance(t *testing.T) {
	base := custom("cos(t)", "sin(2*t)", "0.4*t", -2, 2)
	_, d := diagnosed(t, base)
	// A rotation about (1, 1, 1)/√3 by 120° permutes the axes: (x, y, z) →
	// (z, x, y). Translate as well; κ and τ must not change and the frame
	// must rotate with the curve.
	moved := custom("0.4*t+5", "cos(t)-3", "sin(2*t)+7", -2, 2)
	_, m := diagnosed(t, moved)
	rotate := func(v Vec3) Vec3 { return Vec3{v.Z, v.X, v.Y} }
	for i := range d.Curvature {
		// Roundoff in the numerical r″ (about 10⁻⁸ after a translation of
		// about 8) is differenced again for r‴, one-sided over steps of about
		// 2·10⁻³ at the ends: an error δj of about 10⁻⁵ that enters τ as
		// δj/|r′ × r″| = δj/(κ|r′|³), with |r′| between 1 and 2.2 here.
		k := *d.Curvature[i]
		if math.Abs(k-*m.Curvature[i]) > 1e-7 || math.Abs(*d.Torsion[i]-*m.Torsion[i])*k > 1e-5 {
			t.Fatalf("sample %d: rigid motion changed κ %v→%v or τ %v→%v", i, *d.Curvature[i], *m.Curvature[i], *d.Torsion[i], *m.Torsion[i])
		}
		if rotate(*d.Normal[i]).sub(*m.Normal[i]).norm() > 1e-6 {
			t.Fatalf("sample %d: normal did not rotate with the curve", i)
		}
	}
	// A regular reparameterization u ↦ s = u³/4 + u, increasing, passes the
	// same points at other parameters: compare with the original curve on a
	// unit domain centred on s, whose middle sample is at s.
	re := custom("cos(t^3/4+t)", "sin(2*(t^3/4+t))", "0.4*(t^3/4+t)", -1.2, 1.2)
	_, p := diagnosed(t, re)
	for i := 0; i < len(p.Curvature); i += 24 {
		u := parameter(p, i)
		s := u*u*u/4 + u
		q := custom("cos(t)", "sin(2*t)", "0.4*t", s-0.5, s+0.5)
		q.Samples = 240
		_, o := diagnosed(t, q)
		mid := len(o.Curvature) / 2
		if math.Abs(*o.Curvature[mid]-*p.Curvature[i]) > 1e-6*math.Max(1, *o.Curvature[mid]) {
			t.Fatalf("sample %d: κ %v after reparameterization, %v before", i, *p.Curvature[i], *o.Curvature[mid])
		}
		if math.Abs(*o.Torsion[mid]-*p.Torsion[i]) > 2e-4*math.Max(1, math.Abs(*o.Torsion[mid])) {
			t.Fatalf("sample %d: τ %v after reparameterization, %v before", i, *p.Torsion[i], *o.Torsion[mid])
		}
	}
}

func TestDiagnosticsAgreeWithFrenetFrames(t *testing.T) {
	c := study()
	c.Construction = "framed"
	c.Frame = frameRequest()
	c.Frame.Kind = "frenet"
	r, d := diagnosed(t, c)
	for _, g := range r.Frame.Frames {
		i := g.SampleIndex
		if d.Normal[i].sub(g.Normal).norm() > 1e-12 || d.Binormal[i].sub(g.Binormal).norm() > 1e-12 || d.Tangent[i].sub(g.Tangent).norm() > 1e-12 {
			t.Fatalf("sample %d: frames disagree", i)
		}
	}
}

func TestStraightLineIsFlat(t *testing.T) {
	c := custom("t", "2*t", "3*t", -1, 1)
	c.Construction = "none"
	r, d := diagnosed(t, c)
	if d.Flat != len(r.Base) || d.Unknown != 0 {
		t.Fatalf("flat %d unknown %d of %d", d.Flat, d.Unknown, len(r.Base))
	}
	want := Vec3{1, 2, 3}.unit()
	for i := range r.Base {
		if d.Curvature[i] == nil || *d.Curvature[i] != 0 {
			t.Fatalf("sample %d: κ %v", i, d.Curvature[i])
		}
		if d.Normal[i] != nil || d.Binormal[i] != nil || d.Torsion[i] != nil || d.Center[i] != nil {
			t.Fatalf("sample %d: frame on a line", i)
		}
		if d.Tangent[i].sub(want).norm() > 1e-9 {
			t.Fatalf("sample %d: T %+v", i, *d.Tangent[i])
		}
	}
}

func TestInflectionIsFlatOnlyThere(t *testing.T) {
	// (t, t³, 0) has κ = 6|t|/(1+9t⁴)^{3/2}: zero at t = 0 alone, τ = 0.
	c := custom("t", "t^3", "0", -1, 1)
	c.Construction = "none"
	r, d := diagnosed(t, c)
	n := len(r.Base) - 1
	if d.Curvature[n/2] == nil || *d.Curvature[n/2] != 0 || d.Normal[n/2] != nil {
		t.Fatalf("inflection: κ %v, N %v", d.Curvature[n/2], d.Normal[n/2])
	}
	if d.Flat < 1 || d.Flat > 3 {
		t.Fatalf("%d flat samples", d.Flat)
	}
	frenet(t, r, d)
	for i := range r.Base {
		if d.Torsion[i] != nil && math.Abs(*d.Torsion[i]) > 1e-6 {
			t.Fatalf("sample %d: τ %v on a plane curve", i, *d.Torsion[i])
		}
		u := parameter(d, i)
		kappa := 6 * math.Abs(u) / math.Pow(1+9*u*u*u*u, 1.5)
		if d.Normal[i] != nil && math.Abs(*d.Curvature[i]-kappa) > 1e-6 {
			t.Fatalf("sample %d: κ %v, want %v", i, *d.Curvature[i], kappa)
		}
	}
	// The normal points to the concave side: −y for t < 0, +y for t > 0.
	if d.Normal[n/4].Y >= 0 || d.Normal[3*n/4].Y <= 0 {
		t.Fatal("normals do not follow the concave side")
	}
}

func TestDistantCentresAreClipped(t *testing.T) {
	// The shallow parabola (t, εt², 0) has κ = 2ε/(1+4ε²t²)^{3/2} ≈ 2ε: its
	// radius of curvature, about 5000, is beyond 100 study radii, so its
	// centre is at infinity, though κ and the frame are defined.
	c := custom("t", "0.0001*t^2", "0", -1, 1)
	c.Construction = "none"
	r, d := diagnosed(t, c)
	if d.Clipped != len(r.Base) || d.Flat != 0 {
		t.Fatalf("%d clipped, %d flat of %d", d.Clipped, d.Flat, len(r.Base))
	}
	for i := range r.Base {
		u := parameter(d, i)
		kappa := 2e-4 / math.Pow(1+4e-8*u*u, 1.5)
		if d.Center[i] != nil || d.Normal[i] == nil || math.Abs(*d.Curvature[i]-kappa) > 1e-9 {
			t.Fatalf("sample %d: centre %v, κ %v", i, d.Center[i], d.Curvature[i])
		}
	}
	// A smaller circle keeps its centre.
	near := custom("3*cos(t)", "3*sin(t)", "0", -1, 1)
	near.Construction = "none"
	_, e := diagnosed(t, near)
	if e.Clipped != 0 || e.Center[0].norm() > 1e-6 {
		t.Fatalf("clipped %d, centre %+v", e.Clipped, e.Center[0])
	}
}

func TestDiagnosticsOffLeaveResultsUnchanged(t *testing.T) {
	involute := involuteStudy("cos(t)", "sin(t)", "0.3*t", 0, 6, 0, 0)
	pursuit := pursuitStudy([]SpatialPursuer{{1, 0, 0, 1}, {0, 1, 0.5, 1}, {-1, 0, 1, 1}}, 0.01, 0, 2)
	surface := surfaceStudy("torus", 2, 0.7, 0, 0, 2*math.Pi, 0, 2*math.Pi, 24, 24)
	for _, c := range []Request{study(), custom("cos(t)", "sin(t)", "t", 0, 4), harmonicStudy(0, 2*math.Pi, Vec3{}, HarmonicTerm{Frequency: 1, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1, 1}}),
		fieldRequest("-y", "x", "a", []Vec3{{1, 0, 0}}, 0, 6), involute, pursuit, surface} {
		before, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if before.Diagnostics != nil {
			t.Fatal("diagnostics without the flag")
		}
		c.Diagnostics = true
		after, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if (after.Diagnostics == nil) != (c.Format == "surface") {
			t.Fatalf("%s: diagnostics %v", c.Format, after.Diagnostics != nil)
		}
		after.Diagnostics = nil
		x, _ := json.Marshal(before)
		y, _ := json.Marshal(after)
		if !bytes.Equal(x, y) {
			t.Fatalf("%s/%s: diagnostics changed the study", c.Format, c.Construction)
		}
	}
}

func TestNumericalJerkConverges(t *testing.T) {
	// r = (cos t, sin t, sin 2t) with exact r and r″: the difference of r″
	// is second order, centrally and one-sided at the domain's ends.
	exact := func(t float64) (Vec3, Vec3, Vec3, bool) {
		return Vec3{math.Cos(t), math.Sin(t), math.Sin(2 * t)},
			Vec3{-math.Sin(t), math.Cos(t), 2 * math.Cos(2*t)},
			Vec3{-math.Cos(t), -math.Sin(t), -4 * math.Sin(2*t)}, true
	}
	jerk := func(t float64) Vec3 { return Vec3{math.Sin(t), -math.Cos(t), -8 * math.Cos(2*t)} }
	lo, hi := 0.0, 3.0
	for _, at := range []float64{1.3, lo, hi} {
		var errors []float64
		for _, h := range []float64{1e-2, 5e-3, 2.5e-3} {
			j, ok := jerkStep(exact, at, lo, hi, h)
			if !ok {
				t.Fatalf("t=%v h=%v: no estimate", at, h)
			}
			errors = append(errors, j.sub(jerk(at)).norm())
		}
		for k := 1; k < len(errors); k++ {
			if ratio := errors[k-1] / errors[k]; ratio < 3.5 || ratio > 4.5 {
				t.Fatalf("t=%v: error ratio %v (errors %v)", at, ratio, errors)
			}
		}
	}
}

func TestClipThresholdIsHundredStudyRadii(t *testing.T) {
	// Arcs over t ∈ [−1, 1] span a study radius of about 1: radius 50 keeps
	// its centre, radius 200 does not.
	for _, tc := range []struct {
		radius  string
		clipped bool
	}{{"50", false}, {"200", true}} {
		c := custom(tc.radius+"*cos(t/"+tc.radius+")", tc.radius+"*sin(t/"+tc.radius+")", "0", -1, 1)
		c.Construction = "none"
		r, d := diagnosed(t, c)
		if r.Bounds.Radius > 1.1 || r.Bounds.Radius < 0.9 {
			t.Fatalf("radius %s: study radius %v", tc.radius, r.Bounds.Radius)
		}
		if (d.Clipped == len(r.Base)) != tc.clipped || (d.Clipped != 0) != tc.clipped {
			t.Fatalf("radius %s: %d of %d clipped", tc.radius, d.Clipped, len(r.Base))
		}
	}
}

func TestUnstableThirdDerivativeIsUnknown(t *testing.T) {
	// z = |t − c|³ has r‴ jumping at c = −0.0015, three quarters of the
	// longer difference step (2·10⁻³) before the sample at t = 0: the two
	// steps disagree there, so τ is unknown, though κ and the frame are not.
	c := custom("t", "t^2", "abs(t+0.0015)^3", -1, 1)
	c.Construction = "none"
	r, d := diagnosed(t, c)
	mid := (len(r.Base) - 1) / 2
	if d.Torsion[mid] != nil || d.Normal[mid] == nil {
		t.Fatalf("τ %v, N %v at the jump", d.Torsion[mid], d.Normal[mid])
	}
	unknown := 0
	for i := range r.Base {
		if d.Normal[i] != nil && d.Torsion[i] == nil {
			unknown++
		}
	}
	if d.Unknown != unknown || unknown < 1 || unknown > 3 {
		t.Fatalf("unknown %d, counted %d", unknown, d.Unknown)
	}
}

func TestHarmonicTorsionMatchesExpressions(t *testing.T) {
	// A non-planar harmonic curve through its analytic r‴ and as
	// expressions with a numerical one.
	c := harmonicStudy(0, 2*math.Pi, Vec3{}, HarmonicTerm{Frequency: 1, Cosine: Vec3{2, 0, 0}, Sine: Vec3{0, 2, 0}},
		HarmonicTerm{Frequency: 3, Cosine: Vec3{0, 0, 0.5}, Sine: Vec3{0.3, 0, 0}})
	c.Construction = "none"
	_, a := diagnosed(t, c)
	e := custom("2*cos(t)+0.3*sin(3*t)", "2*sin(t)", "0.5*cos(3*t)", 0, 2*math.Pi)
	e.Construction = "none"
	_, b := diagnosed(t, e)
	for i := range a.Torsion {
		if math.Abs(*a.Torsion[i]-*b.Torsion[i]) > 1e-4*math.Max(1, math.Abs(*a.Torsion[i])) {
			t.Fatalf("sample %d: τ %v and %v", i, *a.Torsion[i], *b.Torsion[i])
		}
	}
}

func TestClosedCurveCountsItsSeamOnce(t *testing.T) {
	// (sin t, ½ sin 2t, 0) is flat where it crosses itself, at t = 0 and π:
	// the repeated last sample is not counted again.
	c := harmonicStudy(0, 2*math.Pi, Vec3{}, HarmonicTerm{Frequency: 1, Sine: Vec3{1, 0, 0}},
		HarmonicTerm{Frequency: 2, Sine: Vec3{0, 0.5, 0}})
	c.Construction = "none"
	r, d := diagnosed(t, c)
	n := len(r.Base) - 1
	flat := 0
	for i := 0; i < n; i++ {
		if d.Curvature[i] != nil && *d.Curvature[i] == 0 {
			flat++
		}
	}
	if d.Curvature[0] == nil || *d.Curvature[0] != 0 || d.Curvature[n] != d.Curvature[0] {
		t.Fatal("the seam is not flat on both ends")
	}
	if flat < 2 || d.Flat != flat {
		t.Fatalf("flat %d, counted %d", flat, d.Flat)
	}
}
