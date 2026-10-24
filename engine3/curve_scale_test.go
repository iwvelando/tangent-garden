package engine3

import (
	"fmt"
	"math"
	"tangentgarden/engine/cyclic"
	"tangentgarden/engine/expr"
	"testing"
)

// A regular curve must not inherit the absolute fallback merely because
// its frequency aliases the points used to estimate its scale.
func TestAliasedScaleSurvivesSimilarity(t *testing.T) {
	h := unitCircle(960)
	h.Format = "harmonic"
	h.Harmonic = HarmonicCurve{Min: 0, Max: 2 * math.Pi, Terms: []HarmonicTerm{
		{Frequency: 64, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1, 0}},
	}}
	for name, c := range map[string]Request{
		"harmonic":   h,
		"expression": custom("cos(64*t)", "sin(64*t)", "0", 0, 2*math.Pi),
	} {
		t.Run(name, func(t *testing.T) {
			want, err := Compute(c)
			if err != nil || want.Invalid != 0 {
				t.Fatalf("regular circle: invalid %d, error %v", want.Invalid, err)
			}
			_, tiny, _ := similar(c, similarities[1])
			got, err := Compute(tiny)
			if err != nil {
				t.Fatal(err)
			}
			if got.Invalid != 0 {
				t.Fatalf("scaled regular circle loses %d of %d samples", got.Invalid, len(got.Base))
			}
			if len(got.Base) != len(want.Base) {
				t.Fatal("scaling changes the sample count")
			}
			for i, p := range got.Base {
				angle := 64 * (2 * math.Pi * float64(i) / float64(c.Samples))
				expected := Vec3{math.Cos(angle), math.Sin(angle), 0}.mul(similarities[1].scale)
				if p == nil || p.sub(expected).norm() > 1e-13*similarities[1].scale {
					t.Fatalf("scaled point %d does not lie on the prescribed circle", i)
				}
				if got.Breaks[i] != want.Breaks[i] {
					t.Fatalf("scaled break %d differs", i)
				}
			}
		})
	}
}

func TestSimilarityCaptureTieRequiresBothActualGaps(t *testing.T) {
	q := spatialPresets(t)["Four pursuers on a tetrahedron"]
	want := chased(t, q).Pursuit
	_, copy, _ := similar(q, similarities[3])
	got := chased(t, copy).Pursuit
	// Choose another adjacent pair in the symmetric chase, regardless of
	// which pair this platform's rounding selected.
	alternate := *got
	pair := *got.Capture
	pair.Pursuer = (want.Capture.Pursuer + 1) % len(want.Final)
	pair.Target = (pair.Pursuer + 1) % len(want.Final)
	alternate.Capture = &pair
	if !captureTie(want, &alternate, q.Pursuit.Capture, 1) {
		t.Fatal("simultaneous adjacent captures are rejected")
	}
	pair.Target = pair.Pursuer
	if captureTie(want, &alternate, q.Pursuit.Capture, 1) {
		t.Fatal("a non-adjacent capture is accepted")
	}
	pair.Target = (pair.Pursuer + 1) % len(want.Final)
	alternate.Final = append([]Vec3{}, got.Final...)
	alternate.Final[pair.Pursuer].Z += 0.1 * q.Pursuit.Capture
	if captureTie(want, &alternate, q.Pursuit.Capture, 1) {
		t.Fatal("a pair away from the capture distance is accepted")
	}
	unique := chased(t, pursuitStudy(unequal3, .02, 0, 3)).Pursuit
	wrong := *unique
	i := (unique.Capture.Pursuer + 1) % len(unique.Final)
	wrong.Capture = &cyclic.Capture{Time: unique.Capture.Time, Pursuer: i, Target: (i + 1) % len(unique.Final)}
	if captureTie(unique, &wrong, .02, 1) {
		t.Fatal("a unique capture's identity is ignored")
	}
}

// The enormous rounded value of tan at a pole must not set the units of
// every regular branch when scaling brings that value below the coordinate
// guard. The known poles remain gaps at each scale.
func TestPoleExtentSurvivesSimilarity(t *testing.T) {
	c := custom("tan(t)", "0", "0", -math.Pi, math.Pi)
	c.Samples = 480
	want := scaleCurveResult(t, c)
	if want.Base[120] != nil || want.Base[360] != nil {
		t.Fatal("the poles are drawn in the reference study")
	}
	for _, m := range append(append([]similarity{}, similarities...), extremes...) {
		t.Run(m.name, func(t *testing.T) {
			_, copy, _ := similar(c, m)
			got := scaleCurveResult(t, copy)
			for i, p := range want.Base {
				if (p == nil) != (got.Base[i] == nil) || want.Breaks[i] != got.Breaks[i] {
					t.Fatalf("sample %d changes its gap or break under scaling", i)
				}
			}
		})
	}
}

func scaleCurveResult(t *testing.T, c Request) Result {
	t.Helper()
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// A translated helix has the same Frenet frame, curvature and torsion,
// including when its radius is small beside its coordinates. Its returned
// mesh must retain every regular tangent strip.
func TestFarExpressionHelixRetainsCurvature(t *testing.T) {
	for _, radius := range []float64{1, 1.0 / 1024} {
		for _, rate := range []float64{1, 0.1} {
			t.Run(fmt.Sprintf("radius=%g/rate=%g", radius, rate), func(t *testing.T) {
				c := custom(fmt.Sprintf("5000+%.17g*cos(%.17g*t)", radius, rate), fmt.Sprintf("-3000+%.17g*sin(%.17g*t)", radius, rate), fmt.Sprintf("4000+%.17g*t/2", radius*rate), 0, 2*math.Pi)
				c.Samples = 240
				c.Length = radius
				c.Diagnostics = true
				r := scaleCurveResult(t, c)
				if r.Invalid != 0 || r.Omitted != 0 {
					t.Fatalf("regular helix loses samples or strips: invalid=%d omitted=%d", r.Invalid, r.Omitted)
				}
				if len(r.Mesh.Triangles) != 12*c.Samples {
					t.Fatalf("tangent strip triangle indices: %d, want %d", len(r.Mesh.Triangles), 12*c.Samples)
				}
				check := func(at float64, k, tau *float64, normal, center *Vec3) {
					t.Helper()
					closeNumber(t, "curvature", k, 0.8/radius, 2e-4/radius)
					closeNumber(t, "torsion", tau, 0.4/radius, 0.01/radius)
					closeVec3(t, "normal", normal, Vec3{-math.Cos(rate * at), -math.Sin(rate * at), 0}, 2e-4)
					want := Vec3{5000 - 0.25*radius*math.Cos(rate*at), -3000 - 0.25*radius*math.Sin(rate*at), 4000 + radius*rate*at/2}
					closeVec3(t, "center", center, want, 5e-4*radius)
				}
				for i := range r.Base {
					check(2*math.Pi*float64(i)/float64(c.Samples), r.Diagnostics.Curvature[i], r.Diagnostics.Torsion[i], r.Diagnostics.Normal[i], r.Diagnostics.Center[i])
				}
				for _, at := range []float64{0.0317, 1.2345, 6.25} {
					p := probeOnlyAt(t, c, at)
					check(at, p.Curvature, p.Torsion, p.Normal, p.Center)
				}
			})
		}
	}
}

// A corner the stencil straddles makes the half-step velocity disagree, so
// the tangent surface breaks on both sides of it. A far copy whose
// derivatives are taken before its translation must break in the same
// intervals: the moving expression's stability decides, as the original's
// does near the origin.
func TestFarExpressionCornerBreaksAsNearOrigin(t *testing.T) {
	result := func(shift string) Result {
		c := custom(shift+"(cos(t)+abs(t-0.0001))/1024", "sin(t)/1024", "t/2048", -1, 1)
		c.Length = 1.0 / 1024
		return scaleCurveResult(t, c)
	}
	near, far := result(""), result("5000+")
	count := 0
	for i := range near.Breaks {
		if near.Breaks[i] != far.Breaks[i] {
			t.Fatalf("break %d: near %v, far %v", i, near.Breaks[i], far.Breaks[i])
		}
		if near.Breaks[i] {
			count++
		}
	}
	if count != 2 || far.Omitted != near.Omitted {
		t.Fatalf("corner breaks %d intervals, omitted near %d, far %d", count, near.Omitted, far.Omitted)
	}
}

func TestFarLocalSamplerKeepsSingularitiesAndPositions(t *testing.T) {
	for name, c := range map[string]Request{
		"rounded sums": custom("8192+(cos(t)-3192)", "-3000+sin(t)", "4000+t/2", -1, 1),
		"line":         custom("5000+t/1024", "-3000+2*t/1024", "4000-3*t/1024", -1, 1),
		"cusp":         custom("5000+t^2/1024", "-3000+t^3/1024", "4000", -1, 1),
		"pole":         custom("5000+1/(1024*t)", "-3000+t/1024", "4000", -1, 1),
	} {
		t.Run(name, func(t *testing.T) {
			c.Diagnostics = true
			r := scaleCurveResult(t, c)
			for i, p := range r.Base {
				if p == nil {
					continue
				}
				at := c.Curve.Min + (c.Curve.Max-c.Curve.Min)*float64(i)/float64(c.Samples)
				var want Vec3
				for j, s := range []string{c.Curve.X, c.Curve.Y, c.Curve.Z} {
					f, _ := expr.ParseWithParameter(s, c.Curve.A)
					switch j {
					case 0:
						want.X = f(at)
					case 1:
						want.Y = f(at)
					case 2:
						want.Z = f(at)
					}
				}
				if *p != want {
					t.Fatalf("world position %d changed: %+v != %+v", i, *p, want)
				}
				if name == "line" && (r.Diagnostics.Curvature[i] == nil || *r.Diagnostics.Curvature[i] != 0 || r.Diagnostics.Center[i] != nil) {
					t.Fatalf("line has invented bending at %d", i)
				}
			}
			if (name == "cusp" || name == "pole") && r.Base[c.Samples/2] != nil {
				t.Fatal("singularity acquired a tangent")
			}
			if name == "line" && len(r.Mesh.Triangles) != 0 {
				t.Fatal("line acquired a surface")
			}
		})
	}
}

// A curve whose motion is entirely lost in its entered arithmetic has no
// measurable extent. Separating constants must not invent tangents for it.
func TestFarUnresolvedExpressionStaysStationary(t *testing.T) {
	c := custom("5000+(1e20+cos(t)-1e20)", "-3000", "4000", 0, 2*math.Pi)
	if r, err := Compute(c); err == nil {
		t.Fatalf("unresolved curve acquired %d samples", len(r.Base)-r.Invalid)
	}
}

// The same far helix with its x and y written as square roots of perfect
// squares, so no outer constant separates: the rationalized radicals must
// keep its curvature, torsion and frame as the outer translation does.
func TestFarRadicalHelixRetainsCurvature(t *testing.T) {
	radius := 1.0 / 1024
	x := fmt.Sprintf("sqrt(25000000+%.17g*cos(t)+%.17g*cos(t)^2)", 10000*radius, radius*radius)
	y := fmt.Sprintf("-sqrt(9000000-%.17g*sin(t)+%.17g*sin(t)^2)", 6000*radius, radius*radius)
	c := custom(x, y, fmt.Sprintf("4000+%.17g*t/2", radius), 0, 2*math.Pi)
	c.Samples = 240
	c.Length = radius
	c.Diagnostics = true
	r := scaleCurveResult(t, c)
	if r.Invalid != 0 || r.Omitted != 0 {
		t.Fatalf("regular helix loses samples or strips: invalid=%d omitted=%d", r.Invalid, r.Omitted)
	}
	check := func(at float64, k, tau *float64, normal, center *Vec3) {
		t.Helper()
		closeNumber(t, "curvature", k, 0.8/radius, 2e-4/radius)
		closeNumber(t, "torsion", tau, 0.4/radius, 0.01/radius)
		closeVec3(t, "normal", normal, Vec3{-math.Cos(at), -math.Sin(at), 0}, 2e-4)
		want := Vec3{5000 - 0.25*radius*math.Cos(at), -3000 - 0.25*radius*math.Sin(at), 4000 + radius*at/2}
		closeVec3(t, "center", center, want, 5e-4*radius)
	}
	for i := range r.Base {
		check(2*math.Pi*float64(i)/float64(c.Samples), r.Diagnostics.Curvature[i], r.Diagnostics.Torsion[i], r.Diagnostics.Normal[i], r.Diagnostics.Center[i])
	}
	for _, at := range []float64{0.0317, 1.2345, 6.25} {
		p := probeOnlyAt(t, c, at)
		check(at, p.Curvature, p.Torsion, p.Normal, p.Center)
	}
}
