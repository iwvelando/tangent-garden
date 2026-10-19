package engine3

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// The mirror's and the light's probes between samples: a ray study's
// patch described at any (u, v) of its domain, as a surface study's is,
// and the light leaving it described there by the reflection or refraction
// the grid's samples are traced with.

// lightCell is everything the light probe says at one sample, as JSON: the
// wavefront's cell and the light's own vectors and state there.
func lightCell(t *testing.T, d *SurfaceDiagnostics, r, c int) string {
	t.Helper()
	l := d.Light
	at := map[string]any{
		"wavefront": cell(t, d, r, c),
		"incident":  l.Incident[r][c],
		"surface":   l.Surface[r][c],
		"outgoing":  l.Outgoing[r][c],
		"state":     l.State[r][c],
		"length":    l.Length,
	}
	b, err := json.Marshal(at)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// lightPointProbed is pointProbed for the light: the point carries the
// light's one row and one column too.
func lightPointProbed(t *testing.T, c Request, u, v float64) (Result, *SurfaceDiagnostics) {
	t.Helper()
	c.LightDiagnostics = true
	r, d := pointProbed(t, c, u, v)
	if d.Kind != "wavefront" || d.Light == nil {
		t.Fatalf("the point is not the light's: kind %q", d.Kind)
	}
	l := d.Light
	if len(l.State) != 1 || len(l.State[0]) != 1 || len(l.Incident[0]) != 1 || len(l.Surface[0]) != 1 || len(l.Outgoing[0]) != 1 {
		t.Fatal("the light is not one sample")
	}
	return r, d
}

// alone is the point at (u, v) asked of the study already computed, as
// the page moving the probe asks for it (SurfaceProbeOnly), with
// pointProbed's checks of its shape.
func alone(t *testing.T, c Request, u, v float64) *SurfaceDiagnostics {
	t.Helper()
	c.SurfaceProbe = &SurfaceQuery{U: u, V: v}
	d, err := SurfaceProbeOnly(c)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.U) != 1 || len(d.V) != 1 || d.U[0] != u || d.V[0] != v || len(d.Points) != 1 || len(d.Points[0]) != 1 {
		t.Fatalf("the point is not one sample at (%g, %g): u %v, v %v", u, v, d.U, d.V)
	}
	if (c.LightDiagnostics && c.Format == "rays") != (d.Light != nil) {
		t.Fatalf("the point at (%g, %g) has the wrong target: kind %q", u, v, d.Kind)
	}
	return d
}

// Ray studies that between them reflect and refract, from parallel light
// and a lamp, with chart singularities, unlit samples, total internal
// reflection, a lamp standing on the surface, and a dish so shallow that
// its foci lie about 140 surface radii away, beyond the reach of 100.
func rayPointStudies() map[string]Request {
	return map[string]Request{
		"bowl":     bowl(1.3, 18, 12, parallel(20, -70)),
		"torus":    inside(mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 24, 16, parallel(25, -60))),
		"lamp":     mirror("ellipsoid", 1.5, 1, .7, .2, 2.5, -1.2, .4, 18, 12, lamp(Vec3{1.5, 2.5, 1})),
		"glass":    glass(mirror("monkey", .4, 0, 0, -1, 1, -1, 1, 16, 16, parallel(10, -80)), 1, 1.5),
		"total":    glass(bowl(1, 16, 12, parallel(0, -90)), 1.5, 1),
		"onSource": flat(1, lamp(Vec3{0, 0, 0})),
		"shallow":  mirror("paraboloid", 1./600, 1./600, 0, -1.5, 1.5, -1.5, 1.5, 12, 12, parallel(0, -90)),
	}
}

// At a grid sample the point is the sample: the mirror's point is the
// mirror probe's sample and the light's is the light probe's, every
// quantity to the bit, the light's state included.
func TestRayPointAtASampleIsTheSample(t *testing.T) {
	for name, c := range rayPointStudies() {
		q := c.Surface
		for _, target := range []string{"mirror", "light"} {
			study := c
			if target == "light" {
				study.LightDiagnostics = true
			} else {
				study.SurfaceDiagnostics = true
			}
			r, err := Compute(study)
			if err != nil {
				t.Fatal(err)
			}
			grid := gridded(t, r.Probe)
			for i := 0; i <= q.USamples; i++ {
				for j := 0; j <= q.VSamples; j++ {
					u, v := q.at(i, j)
					// lerp can put an end sample an ulp past the domain
					// (0.4·12/12), where the probe is refused.
					if checkSurfacePoint(q, SurfaceQuery{U: u, V: v}) != nil {
						continue
					}
					// One point through the whole study; the rest through
					// the study kept for the probe alone, which
					// TestRayProbeOnlyIsTheStudysPoint holds to the whole
					// study's, so the study is computed once, not once a
					// sample.
					point := alone(t, study, u, v)
					if i == q.USamples/2 && j == q.VSamples/2 {
						_, point = pointProbed(t, study, u, v)
					}
					got, want := cell(t, point, 0, 0), cell(t, grid, i, j)
					if target == "light" {
						got, want = lightCell(t, point, 0, 0), lightCell(t, grid, i, j)
					}
					if got != want {
						t.Fatalf("%s %s at sample (%d, %d): the point says\n%s\nthe grid says\n%s", name, target, i, j, got, want)
					}
					if point.Along[0] != i || point.Kind != grid.Kind {
						t.Fatalf("%s %s at sample (%d, %d): along %d kind %q, grid kind %q", name, target, i, j, point.Along[0], point.Kind, grid.Kind)
					}
				}
			}
			if name == "shallow" && target == "light" && grid.Clipped != [2]int{169, 169} {
				t.Fatalf("shallow: clipped %v, want every focus beyond reach", grid.Clipped)
			}
		}
	}
}

// Every state the light takes is met at a sample by one of the studies, so
// the test above compares each of them.
func TestRayPointStudiesMeetEveryLightState(t *testing.T) {
	met := map[int]bool{}
	for _, c := range rayPointStudies() {
		c.LightDiagnostics = true
		r, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range r.Probe.Light.State {
			for _, s := range row {
				met[s] = true
			}
		}
	}
	for s := lightTraced; s <= lightSingular; s++ {
		if !met[s] {
			t.Fatalf("no study meets light state %d", s)
		}
	}
}

// A point counts its own state as the grid counts its samples': one
// singular, unlit, totally reflected, at-source or stigmatic sample.
func TestRayPointCountsItsState(t *testing.T) {
	cases := []struct {
		name string
		c    Request
		u, v float64
		want func(d *SurfaceDiagnostics) bool
	}{
		{"pole", bowl(1.3, 18, 12, parallel(0, -90)), 1.1, -math.Pi / 2, func(d *SurfaceDiagnostics) bool { return d.Singular == 1 && d.Light.State[0][0] == lightSingular }},
		{"unlit", inside(mirror("paraboloid", .5, .5, 0, -1.5, 1.5, -1.5, 1.5, 12, 12, parallel(0, -90))), .31, -.47, func(d *SurfaceDiagnostics) bool { return d.Light.Unlit == 1 && d.Light.State[0][0] == lightUnlit }},
		{"total", glass(bowl(1, 16, 12, parallel(0, -90)), 1.5, 1), .3, -.2, func(d *SurfaceDiagnostics) bool { return d.Light.Total == 1 && d.Light.State[0][0] == lightTotal }},
		{"source", flat(1, lamp(Vec3{.2, -.3, 0})), .2, -.3, func(d *SurfaceDiagnostics) bool { return d.Light.AtSource == 1 && d.Light.State[0][0] == lightAtSource }},
		{"stigmatic", mirror("paraboloid", .5, .5, 0, -1.5, 1.5, -1.5, 1.5, 12, 12, parallel(0, -90)), .31, -.47, func(d *SurfaceDiagnostics) bool { return d.Umbilics == 1 && d.Light.State[0][0] == lightTraced }},
	}
	for _, k := range cases {
		_, d := lightPointProbed(t, k.c, k.u, k.v)
		if !k.want(d) {
			t.Fatalf("%s: singular %d, unlit %d, total %d, at source %d, stigmatic %d, state %d", k.name, d.Singular, d.Light.Unlit, d.Light.Total, d.Light.AtSource, d.Umbilics, d.Light.State[0][0])
		}
	}
}

// Between samples, a concave spherical mirror of radius R under light
// straight down reflects at angle of incidence θ with cos θ = −z/R into
// tangential and sagittal foci at μ = 2/(R cos θ) and 2 cos θ/R, the
// tangential direction across the azimuth.
func TestLightPointOnASphericalMirror(t *testing.T) {
	const R = 1.3
	c := bowl(R, 18, 12, parallel(0, -90))
	for _, at := range [][2]float64{{0.123, -1.234}, {2.9, -0.61}, {5.5, -1.47}} {
		_, d := lightPointProbed(t, c, at[0], at[1])
		u, v := at[0], at[1]
		x := Vec3{R * math.Cos(v) * math.Cos(u), R * math.Cos(v) * math.Sin(u), R * math.Sin(v)}
		if !within(*d.Points[0][0], x, 1e-12) {
			t.Fatalf("(%g, %g): point %v, want %v", u, v, *d.Points[0][0], x)
		}
		cos := -x.Z / R
		rr := Vec3{-2 * cos * x.X / R, -2 * cos * x.Y / R, 2*cos*cos - 1}
		if !within(*d.Light.Incident[0][0], Vec3{0, 0, -1}, 1e-15) || !within(*d.Light.Surface[0][0], x.mul(-1/R), 1e-12) || !within(*d.Normals[0][0], rr, 1e-12) || !within(*d.Light.Outgoing[0][0], rr, 1e-12) {
			t.Fatalf("(%g, %g): incident %v, normal %v, ray %v", u, v, *d.Light.Incident[0][0], *d.Light.Surface[0][0], *d.Normals[0][0])
		}
		want := [2]float64{2 / (R * cos), 2 * cos / R}
		for k := 0; k < 2; k++ {
			mu := *d.Curvature[k][0][0]
			if math.Abs(mu-want[k]) > 1e-11*want[k] {
				t.Fatalf("(%g, %g): μ%d = %v, want %v", u, v, k+1, mu, want[k])
			}
			if !within(*d.Focal[k][0][0], x.add(rr.mul(1/want[k])), 1e-10) {
				t.Fatalf("(%g, %g): focus %d %v", u, v, k+1, *d.Focal[k][0][0])
			}
		}
		azimuth := Vec3{-x.Y, x.X, 0}.unit()
		if math.Abs(d.Direction[0][0][0].dot(azimuth)) > 1e-9 || math.Abs(math.Abs(d.Direction[1][0][0].dot(azimuth))-1) > 1e-9 {
			t.Fatalf("(%g, %g): tangential %v, sagittal %v", u, v, *d.Direction[0][0][0], *d.Direction[1][0][0])
		}
		if d.Along[0] != nearest(u, c.Surface.UMin, c.Surface.UMax, c.Surface.USamples) {
			t.Fatalf("(%g, %g): along %d", u, v, d.Along[0])
		}
	}
}

// A paraboloid under axial light focuses every point between samples, as
// at them, stigmatically at its focus.
func TestLightPointOnAParaboloid(t *testing.T) {
	const k = .5
	c := mirror("paraboloid", k, k, 0, -1.5, 1.5, -1.5, 1.5, 12, 12, parallel(0, -90))
	focus := Vec3{0, 0, 1 / (2 * k)}
	for _, at := range [][2]float64{{.31, -.47}, {-1.2, 1.37}, {.01, .02}} {
		_, d := lightPointProbed(t, c, at[0], at[1])
		want := 1 / focus.sub(*d.Points[0][0]).norm()
		for b := 0; b < 2; b++ {
			if math.Abs(*d.Curvature[b][0][0]-want) > 1e-12*want || d.Direction[b][0][0] != nil || !within(*d.Focal[b][0][0], focus, 1e-12) {
				t.Fatalf("(%g, %g): μ%d %v, want %v, focus %v", at[0], at[1], b+1, *d.Curvature[b][0][0], want, d.Focal[b][0][0])
			}
		}
	}
}

// Between samples the mirror's point is the surface study's point of the
// same patch.
func TestMirrorPointIsThePatchPoint(t *testing.T) {
	for name, c := range rayPointStudies() {
		c.SurfaceDiagnostics = true
		q := c.Surface
		u, v := q.UMin+(q.UMax-q.UMin)*0.377, q.VMin+(q.VMax-q.VMin)*0.618
		_, got := pointProbed(t, c, u, v)
		s := c
		s.Format = "surface"
		_, want := pointProbed(t, s, u, v)
		x, _ := json.Marshal(got)
		y, _ := json.Marshal(want)
		if !bytes.Equal(x, y) {
			t.Fatalf("%s: the mirror's point differs from the patch's:\n%s\n%s", name, x, y)
		}
	}
}

// Placing a point changes nothing else in a ray study.
func TestRayPointLeavesTheStudyUnchanged(t *testing.T) {
	for name, c := range rayPointStudies() {
		for _, light := range []bool{false, true} {
			study := c
			study.LightDiagnostics, study.SurfaceDiagnostics = light, !light
			before, err := Compute(study)
			if err != nil {
				t.Fatal(err)
			}
			q := c.Surface
			study.SurfaceProbe = &SurfaceQuery{U: (q.UMin + q.UMax) / 3, V: (q.VMin + q.VMax) / 2}
			after, err := Compute(study)
			if err != nil {
				t.Fatal(err)
			}
			after.SurfaceProbe = nil
			x, _ := json.Marshal(before)
			y, _ := json.Marshal(after)
			if !bytes.Equal(x, y) {
				t.Fatalf("%s (light %v): the point changed the study", name, light)
			}
		}
	}
}

// The point is refused outside the domain, and with both probes asked for.
func TestRayPointRefusals(t *testing.T) {
	c := bowl(1.3, 12, 12, parallel(0, -90))
	for _, light := range []bool{false, true} {
		c.LightDiagnostics = light
		for _, at := range [][2]float64{{-1, -1}, {1, 0}, {math.NaN(), -1}, {1, math.Inf(-1)}} {
			c.SurfaceProbe = &SurfaceQuery{U: at[0], V: at[1]}
			if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "domain") {
				t.Fatalf("(%g, %g) was not refused as outside the domain: %v", at[0], at[1], err)
			}
		}
	}
	c.SurfaceDiagnostics, c.LightDiagnostics = true, true
	c.SurfaceProbe = &SurfaceQuery{U: 1, V: -1}
	if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "not both") {
		t.Fatalf("both probes: %v", err)
	}
}

// The point alone, for a probe moved over a study already drawn, is the
// point the whole study gives, for the mirror and for the light, before
// and after the study changes.
func TestRayProbeOnlyIsTheStudysPoint(t *testing.T) {
	for _, light := range []bool{false, true} {
		for _, elevation := range []float64{-70, -55} {
			c := bowl(1.3, 18, 12, parallel(20, elevation))
			c.LightDiagnostics = light
			c.SurfaceProbe = &SurfaceQuery{U: 2.2, V: -0.9}
			whole, err := Compute(c)
			if err != nil {
				t.Fatal(err)
			}
			for range 2 {
				alone, err := SurfaceProbeOnly(c)
				if err != nil {
					t.Fatal(err)
				}
				x, _ := json.Marshal(whole.SurfaceProbe)
				y, _ := json.Marshal(alone)
				if !bytes.Equal(x, y) {
					t.Fatalf("light %v, elevation %g: the point alone differs:\n%s\n%s", light, elevation, y, x)
				}
			}
		}
	}
}

// A parabolic dish z = a(x² + y²)/2 under parallel light tilted θ from its
// axis, in the plane y = 0, has meridional and sagittal curvatures a cos³φ
// and a cos φ where its normal leans φ, tan φ = ax. Where the normal
// bisects the light and the axis, φ = θ/2 is the angle of incidence, so
// Coddington's tangential and sagittal powers 2κ_m/cos φ and 2κ_s cos φ
// agree at 2a cos²(θ/2): the light leaves along the axis, stigmatic, at
// x* = tan(θ/2)/a. The grids here step over x*, and their nearest
// samples are astigmatic.
func TestLightPointStigmaticOnATiltedDish(t *testing.T) {
	for _, k := range []struct{ a, theta float64 }{{.5, 30}, {.8, 40}, {.3, 12}} {
		c := mirror("paraboloid", k.a, k.a, 0, -1.5, 1.5, -1.5, 1.5, 48, 48, parallel(0, k.theta-90))
		half := k.theta / 2 * math.Pi / 180
		x := math.Tan(half) / k.a
		mu := 2 * k.a * math.Cos(half) * math.Cos(half)
		_, d := lightPointProbed(t, c, x, 0)
		if d.Umbilics != 1 || d.Direction[0][0][0] != nil || !within(*d.Normals[0][0], Vec3{0, 0, 1}, 1e-12) {
			t.Fatalf("a %g, θ %g: not stigmatic along the axis at x* = %g: ray %v", k.a, k.theta, x, *d.Normals[0][0])
		}
		focus := Vec3{x, 0, k.a*x*x/2 + 1/mu}
		for b := 0; b < 2; b++ {
			if math.Abs(*d.Curvature[b][0][0]-mu) > 1e-12 || !within(*d.Focal[b][0][0], focus, 1e-11) {
				t.Fatalf("a %g, θ %g: μ%d %v, want %v; focus %v, want %v", k.a, k.theta, b+1, *d.Curvature[b][0][0], mu, *d.Focal[b][0][0], focus)
			}
		}
		i := nearest(x, -1.5, 1.5, 48)
		if f := (x + 1.5) / 3 * 48; math.Abs(f-math.Round(f)) < .2 {
			t.Fatalf("a %g, θ %g: x* is at row %g, near a sample", k.a, k.theta, f)
		}
		_, s := lightPointProbed(t, c, c.Surface.UMin+3*float64(i)/48, 0)
		if s.Umbilics != 0 || !(*s.Curvature[0][0][0]-*s.Curvature[1][0][0] > 1e-3) {
			t.Fatalf("a %g, θ %g: the nearest row %d is stigmatic too", k.a, k.theta, i)
		}
	}
}
