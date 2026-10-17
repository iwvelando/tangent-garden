package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// The surface probe between samples: a patch, its offset and its focal
// sheets described at any (u, v) of the domain, not only at a grid sample.

// pointProbed computes a surface study described at (u, v), with the
// diagnostics flags already set on c, and checks the point's shape: one
// row and one column at exactly the asked parameters.
func pointProbed(t *testing.T, c Request, u, v float64) (Result, *SurfaceDiagnostics) {
	t.Helper()
	c.SurfaceProbe = &SurfaceQuery{U: u, V: v}
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	d := r.SurfaceProbe
	if d == nil {
		t.Fatal("no surface probe")
	}
	if len(d.U) != 1 || len(d.V) != 1 || d.U[0] != u || d.V[0] != v || len(d.Along) != 1 || len(d.Points) != 1 || len(d.Points[0]) != 1 {
		t.Fatalf("the point is not one sample at (%g, %g): u %v, v %v, along %v", u, v, d.U, d.V, d.Along)
	}
	for k := 0; k < 2; k++ {
		if len(d.Curvature[k]) != 1 || len(d.Curvature[k][0]) != 1 || len(d.Direction[k][0]) != 1 || len(d.Focal[k][0]) != 1 {
			t.Fatalf("branch %d is not one sample", k)
		}
	}
	return r, d
}

// cell is everything a surface probe says at one sample, as JSON.
func cell(t *testing.T, d *SurfaceDiagnostics, r, c int) string {
	t.Helper()
	at := map[string]any{"point": d.Points[r][c], "normal": d.Normals[r][c]}
	for k := 0; k < 2; k++ {
		at["curvature"+itoa(k)] = d.Curvature[k][r][c]
		at["direction"+itoa(k)] = d.Direction[k][r][c]
		at["focal"+itoa(k)] = d.Focal[k][r][c]
	}
	if d.Feet != nil {
		at["foot"] = d.Feet[r][c]
	}
	if d.Folds != nil {
		at["folded"] = d.Folds[r][c]
	}
	if d.UnknownPlane != nil {
		at["unknownPlane"] = d.UnknownPlane[r][c]
	}
	b, err := json.Marshal(at)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// probedAs sets the diagnostics flag for a target: "surface", "offset",
// "focal1" or "focal2".
func probedAs(c Request, target string) Request {
	switch target {
	case "surface":
		c.SurfaceDiagnostics = true
	case "offset":
		c.OffsetDiagnostics = true
	case "focal1":
		c.FocalDiagnostics = 1
	case "focal2":
		c.FocalDiagnostics = 2
	}
	return c
}

var surfaceTargets = []string{"surface", "offset", "focal1", "focal2"}

// A triaxial ellipsoid with an offset, on a coarse grid that steps over
// its umbilics.
func coarseEllipsoid() Request {
	c := surfaceStudy("ellipsoid", 3, 2, 1, -math.Pi, math.Pi, -math.Pi/2, math.Pi/2, 24, 24)
	c.Surface.Offset = 0.4
	return c
}

// At a grid sample the point is the sample: the grid and the point share
// one description, so every quantity agrees to the bit, the focal sheet's
// orientation included.
func TestSurfacePointAtASampleIsTheSample(t *testing.T) {
	studies := map[string]Request{
		"ellipsoid": coarseEllipsoid(),
		"torus":     torusPatch(2, 0.8, 30, 18),
		"saddle":    surfaceStudy("monkey", 0.4, 0, 0, -1, 1, -1, 1, 16, 20),
	}
	studies["torus"] = func(c Request) Request { c.Surface.Offset = -1; return c }(studies["torus"])
	studies["saddle"] = func(c Request) Request { c.Surface.Offset = 0.2; return c }(studies["saddle"])
	for name, c := range studies {
		for _, target := range surfaceTargets {
			study := probedAs(c, target)
			r, err := Compute(study)
			if err != nil {
				t.Fatal(err)
			}
			grid := gridded(t, r.Probe)
			q := c.Surface
			for _, at := range [][2]int{{0, 0}, {q.USamples, q.VSamples}, {3, 7}, {q.USamples / 2, q.VSamples / 2}, {q.USamples - 1, 1}} {
				u, v := q.at(at[0], at[1])
				_, point := pointProbed(t, study, u, v)
				if got, want := cell(t, point, 0, 0), cell(t, grid, at[0], at[1]); got != want {
					t.Fatalf("%s %s at sample %v: the point says\n%s\nthe grid says\n%s", name, target, at, got, want)
				}
				if point.Along[0] != at[0] || point.Kind != grid.Kind || point.Sheet != grid.Sheet || point.Distance != grid.Distance {
					t.Fatalf("%s %s at sample %v: along %d kind %q sheet %d distance %g, grid kind %q sheet %d distance %g",
						name, target, at, point.Along[0], point.Kind, point.Sheet, point.Distance, grid.Kind, grid.Sheet, grid.Distance)
				}
			}
		}
	}
}

// Between samples, a sphere with its outward normal has κ = −1/R in every
// direction at every point: an umbilic, without directions, both centers
// at its center.
func TestSurfacePointOnASphere(t *testing.T) {
	const R = 1.7
	c := probedAs(sphere(R, 12, 12), "surface")
	for _, at := range [][2]float64{{0.123, 0.456}, {2.9, -1.1}, {5.5, 1.4}} {
		_, d := pointProbed(t, c, at[0], at[1])
		closeVec3(t, "point", d.Points[0][0], Vec3{R * math.Cos(at[1]) * math.Cos(at[0]), R * math.Cos(at[1]) * math.Sin(at[0]), R * math.Sin(at[1])}, 1e-12)
		for k := 0; k < 2; k++ {
			closeNumber(t, "κ", d.Curvature[k][0][0], -1/R, 1e-12)
			closeVec3(t, "center", d.Focal[k][0][0], Vec3{}, 1e-12)
			if d.Direction[k][0][0] != nil {
				t.Fatalf("a direction at an umbilic: %v", *d.Direction[k][0][0])
			}
		}
		if d.Umbilics != 1 || d.Singular != 0 || d.Unknown != 0 {
			t.Fatalf("umbilics %d singular %d unknown %d", d.Umbilics, d.Singular, d.Unknown)
		}
	}
}

// Between samples of a triaxial ellipsoid x²/a² + y²/b² + z²/c² = 1, the
// Gaussian curvature is 1/(a²b²c²(x²/a⁴ + y²/b⁴ + z²/c⁴)²), the normal is
// along the gradient, and each center is X + n/κ.
func TestSurfacePointOnAnEllipsoid(t *testing.T) {
	const a, b, cc = 3.0, 2.0, 1.0
	c := probedAs(coarseEllipsoid(), "surface")
	for _, at := range [][2]float64{{0.31, 0.27}, {-2.2, -0.9}, {1.01, 1.2}} {
		u, v := at[0], at[1]
		_, d := pointProbed(t, c, u, v)
		x := Vec3{a * math.Cos(v) * math.Cos(u), b * math.Cos(v) * math.Sin(u), cc * math.Sin(v)}
		closeVec3(t, "point", d.Points[0][0], x, 1e-12)
		g := Vec3{x.X / (a * a), x.Y / (b * b), x.Z / (cc * cc)}
		n := d.Normals[0][0]
		if n == nil || math.Abs(math.Abs(n.dot(g.unit()))-1) > 1e-12 {
			t.Fatalf("at (%g, %g) the normal %v is not along the gradient %v", u, v, n, g.unit())
		}
		s := x.X*x.X/(a*a*a*a) + x.Y*x.Y/(b*b*b*b) + x.Z*x.Z/(cc*cc*cc*cc)
		K := 1 / (a * a * b * b * cc * cc * s * s)
		k1, k2 := *d.Curvature[0][0][0], *d.Curvature[1][0][0]
		if math.Abs(k1*k2-K) > 1e-12*K {
			t.Fatalf("at (%g, %g) K = %g, want %g", u, v, k1*k2, K)
		}
		for k := 0; k < 2; k++ {
			kappa := *d.Curvature[k][0][0]
			closeVec3(t, "center", d.Focal[k][0][0], x.add(n.mul(1/kappa)), 1e-12)
		}
		if *d.Direction[0][0][0] == (Vec3{}) || math.Abs(d.Direction[0][0][0].dot(*n)) > 1e-12 {
			t.Fatalf("the first direction %v is not tangent", d.Direction[0][0][0])
		}
	}
}

// A triaxial ellipsoid's umbilics lie at y = 0 where sin v =
// √((b² − c²)/(a² − c²)), which a 24 × 24 grid steps over: the grid has
// none, and the point there is one, with equal curvatures.
func TestSurfacePointFindsAnUmbilicTheGridMisses(t *testing.T) {
	c := probedAs(coarseEllipsoid(), "surface")
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Probe.Umbilics != 0 {
		t.Fatalf("the grid lands on %d umbilics", r.Probe.Umbilics)
	}
	v := math.Asin(math.Sqrt((4.0 - 1) / (9 - 1)))
	_, d := pointProbed(t, c, 0, v)
	if d.Umbilics != 1 || d.Direction[0][0][0] != nil {
		t.Fatalf("no umbilic at (0, %g): umbilics %d, direction %v", v, d.Umbilics, d.Direction[0][0][0])
	}
	closeNumber(t, "κ₂ at the umbilic", d.Curvature[1][0][0], *d.Curvature[0][0][0], 1e-12)
	// A little away, the curvatures part.
	_, near := pointProbed(t, c, 0, v+0.05)
	if near.Umbilics != 0 || *near.Curvature[0][0][0]-*near.Curvature[1][0][0] < 1e-3 {
		t.Fatalf("near the umbilic: umbilics %d, κ %g and %g", near.Umbilics, *near.Curvature[0][0][0], *near.Curvature[1][0][0])
	}
}

// Between samples, the offset by d stands at X + d·n with curvatures
// κᵢ/(1 − dκᵢ) and the patch's own centers; a focal sheet stands at
// X + n/κᵢ, its foot X, its normal the patch's principal direction eᵢ.
func TestSurfacePointOffsetAndFocalSheets(t *testing.T) {
	c := coarseEllipsoid()
	dist := c.Surface.Offset
	for _, at := range [][2]float64{{0.31, 0.27}, {-2.2, -0.9}, {2.5, 0.6}} {
		u, v := at[0], at[1]
		_, patch := pointProbed(t, probedAs(c, "surface"), u, v)
		x, n := *patch.Points[0][0], *patch.Normals[0][0]
		_, offset := pointProbed(t, probedAs(c, "offset"), u, v)
		closeVec3(t, "offset point", offset.Points[0][0], x.add(n.mul(dist)), 1e-12)
		if offset.Distance != dist {
			t.Fatalf("offset distance %g", offset.Distance)
		}
		for k := 0; k < 2; k++ {
			kappa := *patch.Curvature[k][0][0]
			closeNumber(t, "offset κ", offset.Curvature[k][0][0], kappa/(1-dist*kappa), 1e-12)
			closeVec3(t, "offset center", offset.Focal[k][0][0], *patch.Focal[k][0][0], 1e-12)
		}
		for sheet := 1; sheet <= 2; sheet++ {
			k := sheet - 1
			_, focal := pointProbed(t, probedAs(c, "focal"+itoa(sheet)), u, v)
			if focal.Sheet != sheet {
				t.Fatalf("sheet %d", focal.Sheet)
			}
			sameVec(t, "focal point", focal.Points[0][0], patch.Focal[k][0][0])
			sameVec(t, "foot", focal.Feet[0][0], patch.Points[0][0])
			m := focal.Normals[0][0]
			if m == nil || math.Abs(math.Abs(m.dot(*patch.Direction[k][0][0]))-1) > 1e-12 {
				t.Fatalf("sheet %d's normal %v is not the principal direction %v", sheet, m, patch.Direction[k][0][0])
			}
		}
	}
}

// A focal sheet's normal between samples is oriented as the nearest grid
// sample's, so that it does not flip as the probe passes between them.
func TestSurfacePointFocalNormalFollowsTheGrid(t *testing.T) {
	c := coarseEllipsoid()
	for sheet := 1; sheet <= 2; sheet++ {
		study := probedAs(c, "focal"+itoa(sheet))
		r, err := Compute(study)
		if err != nil {
			t.Fatal(err)
		}
		grid := r.Probe
		q := c.Surface
		for _, at := range [][2]int{{2, 5}, {9, 14}, {17, 20}} {
			u0, v0 := q.at(at[0], at[1])
			u1, v1 := q.at(at[0]+1, at[1]+1)
			// A little nearer the sample than its neighbor.
			u, v := u0+0.3*(u1-u0), v0+0.3*(v1-v0)
			_, d := pointProbed(t, study, u, v)
			m, near := d.Normals[0][0], grid.Normals[at[0]][at[1]]
			if m == nil || near == nil {
				continue
			}
			if m.dot(*near) <= 0 {
				t.Fatalf("sheet %d near sample %v: the point's normal %v turns from the sample's %v", sheet, at, *m, *near)
			}
		}
	}
}

// Asking for the point changes nothing else in the result, and a study
// asks for it only when it names it.
func TestSurfacePointLeavesTheStudyUnchanged(t *testing.T) {
	for _, target := range surfaceTargets {
		c := probedAs(coarseEllipsoid(), target)
		plain, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if plain.SurfaceProbe != nil {
			t.Fatal("a point no one asked for")
		}
		with, _ := pointProbed(t, c, 0.4, 0.2)
		with.SurfaceProbe = nil
		a, _ := json.Marshal(plain)
		b, _ := json.Marshal(with)
		if string(a) != string(b) {
			t.Fatalf("%s: asking for the point changed the study", target)
		}
	}
}

// Without a target's diagnostics, the point describes the surface, and
// brings the surface's diagnostics with it.
func TestSurfacePointBringsTheSurfaceDiagnostics(t *testing.T) {
	r, d := pointProbed(t, coarseEllipsoid(), 0.4, 0.2)
	if r.Probe == nil || r.Probe.Kind != "patch" || d.Kind != "patch" {
		t.Fatalf("grid %v, point kind %q", r.Probe, d.Kind)
	}
}

// The point is refused outside the domain, for a curve study without a
// surface, and where it is not finite.
func TestSurfacePointRefusals(t *testing.T) {
	c := coarseEllipsoid()
	for _, at := range [][2]float64{{-4, 0}, {0, 2}, {math.NaN(), 0}, {0, math.Inf(1)}} {
		c.SurfaceProbe = &SurfaceQuery{U: at[0], V: at[1]}
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "domain") {
			t.Fatalf("(%g, %g) was not refused as outside the domain: %v", at[0], at[1], err)
		}
	}
	for name, study := range probeStudies() {
		switch study.Construction {
		case "", "developable", "canal", "framed", "ruled":
			// A surface built on the curve (see curvesurfacepoint_test.go).
			continue
		}
		study.SurfaceProbe = &SurfaceQuery{}
		if _, err := Compute(study); err == nil || !strings.Contains(err.Error(), "patch") {
			t.Fatalf("%s: a curve study without a surface took a surface point: %v", name, err)
		}
	}
	if _, err := SurfaceProbeOnly(Request{Format: "torus", Construction: "none", SurfaceProbe: &SurfaceQuery{}}); err == nil {
		t.Fatal("a bare torus knot took a surface point")
	}
	if _, err := SurfaceProbeOnly(Request{Format: "surface"}); err == nil {
		t.Fatal("no point was asked for, yet one was given")
	}
}

// The point alone, for a probe moved over a study already drawn, is the
// point the whole study gives, before and after the study changes.
func TestSurfaceProbeOnlyIsTheStudysPoint(t *testing.T) {
	for _, target := range surfaceTargets {
		for _, scale := range []float64{1, 1.5} {
			c := probedAs(coarseEllipsoid(), target)
			c.Surface.A *= scale
			for _, at := range [][2]float64{{0.4, 0.2}, {-1.3, 0.9}, {0.4, 0.2}} {
				_, want := pointProbed(t, c, at[0], at[1])
				c.SurfaceProbe = &SurfaceQuery{U: at[0], V: at[1]}
				got, err := SurfaceProbeOnly(c)
				if err != nil {
					t.Fatal(err)
				}
				a, _ := json.Marshal(want)
				b, _ := json.Marshal(got)
				if string(a) != string(b) {
					t.Fatalf("%s at %v: the probe alone gives\n%s\nthe study gives\n%s", target, at, b, a)
				}
			}
		}
	}
}

// The point alone judges its centers against the patch's own size, as the
// whole study does, not against the drawing's bounds, which a far offset
// widens: a center 1000 away on a patch about 1.4 across is at infinity.
func TestSurfaceProbeOnlyJudgesCentersByThePatch(t *testing.T) {
	c := probedAs(surfaceStudy("paraboloid", 1e-3, 0.5, 0, -1, 1, -1, 1, 20, 20), "surface")
	c.Surface.Offset = 50
	r, want := pointProbed(t, c, 0.013, -0.027)
	if r.Bounds.Radius < 20 {
		t.Fatalf("the offset leaves the bounds at %g", r.Bounds.Radius)
	}
	if want.Focal[1][0][0] != nil || want.Clipped[1] != 1 {
		t.Fatalf("the far center is drawn: %v, clipped %v", want.Focal[1][0][0], want.Clipped)
	}
	for k := 0; k < 2; k++ {
		c.SurfaceProbe = &SurfaceQuery{U: 0.013, V: -0.027}
		got, err := SurfaceProbeOnly(c)
		if err != nil {
			t.Fatal(err)
		}
		a, _ := json.Marshal(want)
		b, _ := json.Marshal(got)
		if string(a) != string(b) {
			t.Fatalf("call %d: the probe alone gives\n%s\nthe study gives\n%s", k, b, a)
		}
	}
}
