package engine3

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// probeLight computes a ray study with the light probe on and returns its
// diagnostics with the ray result.
func probeLight(t *testing.T, c Request) (*SurfaceDiagnostics, *RaysResult) {
	t.Helper()
	c.LightDiagnostics = true
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	d := out.Probe
	if d == nil || d.Kind != "wavefront" || d.Light == nil {
		t.Fatalf("no wavefront diagnostics: %+v", d)
	}
	if _, err := json.Marshal(out); err != nil {
		t.Fatal(err)
	}
	rows, columns := c.Surface.USamples+1, c.Surface.VSamples+1
	if len(d.Points) != rows || len(d.Points[0]) != columns || len(d.U) != rows || len(d.V) != columns || len(d.Light.State) != rows || len(d.Light.State[0]) != columns {
		t.Fatalf("grid %d × %d, want %d × %d", len(d.Points), len(d.Points[0]), rows, columns)
	}
	for i := range d.U {
		u, _ := grid(c.Surface, i, 0)
		if d.U[i] != u || d.Along[i] != i {
			t.Fatalf("row %d at u %v, want %v", i, d.U[i], u)
		}
	}
	return d, out.Rays
}

func within(a, b Vec3, tol float64) bool { return a.sub(b).norm() <= tol }

// Every traced sample of the light probe is the outgoing wavefront's own
// surface probe: its normal is the ray, its principal directions are unit
// vectors normal to the ray and to each other (where not stigmatic), and
// each focus lies on the ray at 1/μ. The foci are exactly the caustic
// sheets' points, and the probe's clipped counts are the caustics'.
func checkWavefront(t *testing.T, d *SurfaceDiagnostics, r *RaysResult) {
	t.Helper()
	traced := 0
	for i := range d.Points {
		for j := range d.Points[i] {
			state := d.Light.State[i][j]
			n := d.Normals[i][j]
			if (state == lightTraced) != (n != nil) {
				t.Fatalf("(%d, %d): state %d with ray %v", i, j, state, n)
			}
			if n == nil {
				for k := 0; k < 2; k++ {
					if d.Curvature[k][i][j] != nil || d.Focal[k][i][j] != nil || d.Direction[k][i][j] != nil {
						t.Fatalf("(%d, %d): curvature without a ray", i, j)
					}
				}
				continue
			}
			traced++
			x := *d.Points[i][j]
			if math.Abs(n.norm()-1) > 1e-12 {
				t.Fatalf("(%d, %d): |R| = %v", i, j, n.norm())
			}
			if o := d.Light.Outgoing[i][j]; o == nil || *o != *n {
				t.Fatalf("(%d, %d): outgoing %v, ray %v", i, j, o, n)
			}
			e0, e1 := d.Direction[0][i][j], d.Direction[1][i][j]
			if (e0 == nil) != (e1 == nil) {
				t.Fatal("one principal direction")
			}
			if e0 != nil {
				for _, e := range []*Vec3{e0, e1} {
					if math.Abs(e.norm()-1) > 1e-12 || math.Abs(e.dot(*n)) > 1e-12 {
						t.Fatalf("(%d, %d): direction %+v against ray %+v", i, j, e, n)
					}
				}
				if math.Abs(e0.dot(*e1)) > 1e-12 {
					t.Fatalf("(%d, %d): directions not orthogonal", i, j)
				}
			}
			for k := 0; k < 2; k++ {
				mu := d.Curvature[k][i][j]
				if mu == nil {
					t.Fatalf("(%d, %d): μ%d unknown", i, j, k+1)
				}
				var sheet *Vec3
				for _, s := range r.Caustics {
					if s.Branch == k+1 && s.Points[i][j] != nil {
						sheet = s.Points[i][j]
					}
				}
				f := d.Focal[k][i][j]
				if (f == nil) != (sheet == nil) || f != nil && *f != *sheet {
					t.Fatalf("(%d, %d) branch %d: focus %v, caustic %v", i, j, k+1, f, sheet)
				}
				if f != nil && !within(*f, x.add(n.mul(1 / *mu)), 1e-12*(1+f.norm())) {
					t.Fatalf("(%d, %d) branch %d: focus off the ray", i, j, k+1)
				}
			}
			if *d.Curvature[0][i][j] < *d.Curvature[1][i][j] {
				t.Fatalf("(%d, %d): μ₁ < μ₂", i, j)
			}
		}
	}
	if d.Clipped != [2]int{r.Clipped[0], r.Clipped[1]} {
		t.Fatalf("clipped %v, caustics %v", d.Clipped, r.Clipped)
	}
	if d.Umbilics != r.Stigmatic || d.Light.Unlit != r.Unlit || d.Light.Total != r.Total || d.Light.AtSource != r.AtSource || d.Singular != r.Singular {
		t.Fatalf("stigmatic %d/%d, unlit %d/%d, total %d/%d, at source %d/%d, singular %d/%d", d.Umbilics, r.Stigmatic, d.Light.Unlit, r.Unlit, d.Light.Total, r.Total, d.Light.AtSource, r.AtSource, d.Singular, r.Singular)
	}
	if traced == 0 {
		t.Fatal("nothing traced")
	}
}

// A concave spherical mirror under parallel light: the incident ray is the
// light, the surface normal points to the centre, the outgoing ray is the
// reflection, and the wavefront's curvatures are Coddington's, μ_t =
// 2/(R cos θ) across the meridian and μ_s = 2 cos θ/R. The tangential
// direction lies in the meridian plane and the sagittal one across it. The
// pole is a chart singularity: a point, with no ray.
func TestLightProbeSphericalMirror(t *testing.T) {
	R := 1.3
	c := bowl(R, 36, 24, parallel(0, -90))
	d, r := probeLight(t, c)
	checkWavefront(t, d, r)
	if d.Singular != 37 || d.Light.Length != 1 {
		t.Fatalf("singular %d, length %v", d.Singular, d.Light.Length)
	}
	for i := 0; i <= 36; i++ {
		for j := 0; j <= 24; j++ {
			u, v := grid(c.Surface, i, j)
			x, _, _, _, _, _ := c.Surface.patch(u, v)
			if p := d.Points[i][j]; p == nil || *p != x {
				t.Fatalf("(%d, %d): point %v, want %v", i, j, p, x)
			}
			if j == 0 {
				if d.Light.State[i][j] != lightSingular || d.Light.Incident[i][j] != nil || d.Light.Surface[i][j] != nil {
					t.Fatalf("(%d, %d): the pole is singular", i, j)
				}
				continue
			}
			cos := -x.Z / R
			rr := Vec3{-2 * cos * x.X / R, -2 * cos * x.Y / R, 2*cos*cos - 1}
			if !within(*d.Light.Incident[i][j], Vec3{0, 0, -1}, 1e-15) || !within(*d.Light.Surface[i][j], x.mul(-1/R), 1e-12) {
				t.Fatalf("(%d, %d): incident %v, normal %v", i, j, d.Light.Incident[i][j], d.Light.Surface[i][j])
			}
			if !within(*d.Normals[i][j], rr, 1e-12) {
				t.Fatalf("(%d, %d): ray %v, want %v", i, j, d.Normals[i][j], rr)
			}
			want := [2]float64{2 / (R * cos), 2 * cos / R}
			for k := 0; k < 2; k++ {
				if mu := *d.Curvature[k][i][j]; math.Abs(mu-want[k]) > 1e-11*want[k] {
					t.Fatalf("(%d, %d): μ%d = %v, want %v", i, j, k+1, mu, want[k])
				}
			}
			azimuth := Vec3{-x.Y, x.X, 0}.unit()
			if math.Abs(d.Direction[0][i][j].dot(azimuth)) > 1e-9 || math.Abs(math.Abs(d.Direction[1][i][j].dot(azimuth))-1) > 1e-9 {
				t.Fatalf("(%d, %d): tangential %v, sagittal %v", i, j, d.Direction[0][i][j], d.Direction[1][i][j])
			}
		}
	}
}

// A paraboloid under axial light is stigmatic everywhere: equal curvatures
// 1/|F − X|, no principal directions, both foci at the focus. Lit from
// behind, every sample is unlit: it has an incident ray and a normal, but
// nothing leaves it.
func TestLightProbeParaboloid(t *testing.T) {
	k := .5
	c := mirror("paraboloid", k, k, 0, -1.5, 1.5, -1.5, 1.5, 24, 24, parallel(0, -90))
	d, r := probeLight(t, c)
	checkWavefront(t, d, r)
	focus := Vec3{0, 0, 1 / (2 * k)}
	if d.Umbilics != 625 {
		t.Fatalf("stigmatic %d", d.Umbilics)
	}
	for i := range d.Points {
		for j := range d.Points[i] {
			want := 1 / focus.sub(*d.Points[i][j]).norm()
			for b := 0; b < 2; b++ {
				if math.Abs(*d.Curvature[b][i][j]-want) > 1e-12*want || d.Direction[b][i][j] != nil || !within(*d.Focal[b][i][j], focus, 1e-12) {
					t.Fatalf("(%d, %d): μ%d %v, want %v", i, j, b+1, *d.Curvature[b][i][j], want)
				}
			}
		}
	}
	c.Surface.Reverse = true
	d, r = probeLight(t, c)
	if d.Light.Unlit != 625 || r.Unlit != 625 {
		t.Fatalf("unlit %d", d.Light.Unlit)
	}
	for i := range d.Points {
		for j := range d.Points[i] {
			if d.Light.State[i][j] != lightUnlit || d.Light.Incident[i][j] == nil || d.Light.Surface[i][j] == nil || d.Light.Outgoing[i][j] != nil || d.Normals[i][j] != nil {
				t.Fatalf("(%d, %d): unlit sample", i, j)
			}
		}
	}
}

// A plane mirror images a point source stigmatically, behind the mirror:
// μ = −1/|X − S| and both foci at the mirror image. With the source on the
// mirror, that sample is at the source, with neither incident nor outgoing
// ray, and the light grazes every other sample.
func TestLightProbePlaneMirror(t *testing.T) {
	s := Vec3{.2, -.1, 1.5}
	c := mirror("paraboloid", 0, 0, 0, -1, 1, -1, 1, 24, 24, lamp(s))
	d, r := probeLight(t, c)
	checkWavefront(t, d, r)
	image := Vec3{s.X, s.Y, -s.Z}
	for i := range d.Points {
		for j := range d.Points[i] {
			x := *d.Points[i][j]
			want := -1 / x.sub(s).norm()
			for b := 0; b < 2; b++ {
				if math.Abs(*d.Curvature[b][i][j]-want) > 1e-12*-want || !within(*d.Focal[b][i][j], image, 1e-12) {
					t.Fatalf("(%d, %d): μ %v, focus %v", i, j, *d.Curvature[b][i][j], d.Focal[b][i][j])
				}
			}
			if !within(*d.Light.Incident[i][j], x.sub(s).unit(), 1e-15) {
				t.Fatalf("(%d, %d): incident %v", i, j, d.Light.Incident[i][j])
			}
		}
	}
	c.Rays = lamp(Vec3{})
	d, _ = probeLight(t, c)
	if d.Light.AtSource != 1 || d.Light.Unlit != 624 || d.Light.State[12][12] != lightAtSource {
		t.Fatalf("at source %d, unlit %d", d.Light.AtSource, d.Light.Unlit)
	}
	if d.Light.Incident[12][12] != nil || d.Light.Outgoing[12][12] != nil || d.Light.Surface[12][12] == nil {
		t.Fatal("the sample at the source has only its normal")
	}
}

// Through a plane interface from a point source, the transmitted wavefront
// has the plane's closed-form curvatures (see TestPlaneInterfaceCoddington),
// and the probe's own rays obey Snell's law: n₁ sin θ₁ = n₂ sin θ₂, with θ
// measured from the returned incident ray, normal and outgoing ray.
func TestLightProbePlaneInterface(t *testing.T) {
	source := Vec3{.25, -.5, 1}
	for _, tc := range []struct{ n1, n2 float64 }{{1, 1.5}, {1.5, 1}} {
		c := glass(flat(1, lamp(source)), tc.n1, tc.n2)
		d, r := probeLight(t, c)
		checkWavefront(t, d, r)
		checked := 0
		for i := range d.Points {
			for j := range d.Points[i] {
				if d.Normals[i][j] == nil {
					continue
				}
				x := *d.Points[i][j]
				in, n, out := *d.Light.Incident[i][j], *d.Light.Surface[i][j], *d.Normals[i][j]
				sin1, sin2 := in.cross(n).norm(), out.cross(n).norm()
				if math.Abs(tc.n1*sin1-tc.n2*sin2) > 1e-12 || out.dot(n) > 0 {
					t.Fatalf("(%d, %d): n₁ sin θ₁ %v, n₂ sin θ₂ %v", i, j, tc.n1*sin1, tc.n2*sin2)
				}
				s := x.sub(source).norm()
				cos1, cos2 := source.Z/s, math.Sqrt(1-sin2*sin2)
				mu := [2]float64{-tc.n1 * cos1 * cos1 / (tc.n2 * s * cos2 * cos2), -tc.n1 / (tc.n2 * s)}
				if mu[0] < mu[1] {
					mu[0], mu[1] = mu[1], mu[0]
				}
				for b := 0; b < 2; b++ {
					if math.Abs(*d.Curvature[b][i][j]-mu[b]) > 1e-12*(1+math.Abs(mu[b])) {
						t.Fatalf("(%d, %d): μ%d %v, want %v", i, j, b+1, *d.Curvature[b][i][j], mu[b])
					}
				}
				checked++
			}
		}
		if checked < 250 {
			t.Fatal(checked)
		}
	}
}

// Beyond the critical angle nothing is transmitted: the sample has its
// incident ray and normal, its outgoing ray is the total reflection, and
// it has no wavefront.
func TestLightProbeTotalReflection(t *testing.T) {
	c := glass(inside(flat(1.5, lamp(Vec3{0, 0, -1}))), 1.5, 1)
	d, r := probeLight(t, c)
	checkWavefront(t, d, r)
	radius := math.Tan(math.Asin(1 / 1.5))
	total := 0
	for i := range d.Points {
		for j := range d.Points[i] {
			u, v := grid(c.Surface, i, j)
			beyond := math.Hypot(u, v) >= radius
			if beyond != (d.Light.State[i][j] == lightTotal) {
				t.Fatalf("(%d, %d): state %d", i, j, d.Light.State[i][j])
			}
			if !beyond {
				continue
			}
			total++
			in, n, o := *d.Light.Incident[i][j], *d.Light.Surface[i][j], d.Light.Outgoing[i][j]
			if o == nil || !within(*o, in.sub(n.mul(2*in.dot(n))), 1e-15) || d.Normals[i][j] != nil {
				t.Fatalf("(%d, %d): totally reflected %v", i, j, o)
			}
		}
	}
	if total != d.Light.Total || total < 100 {
		t.Fatalf("total %d, counted %d", total, d.Light.Total)
	}
}

// On an oblique torus and a lamp in an ellipsoid, where real, virtual and
// clipped foci mix, the probe still matches the caustics everywhere.
func TestLightProbeMatchesCaustics(t *testing.T) {
	for _, c := range []Request{
		inside(mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 48, 24, parallel(25, -60))),
		mirror("ellipsoid", 1.5, 1, .7, .2, 2.5, -1.2, .4, 36, 24, lamp(Vec3{1.5, 2.5, 1})),
		glass(mirror("monkey", .4, 0, 0, -1, 1, -1, 1, 24, 24, parallel(10, -80)), 1, 1.5),
	} {
		d, r := probeLight(t, c)
		checkWavefront(t, d, r)
		real, virtual := 0, 0
		for i := range d.Points {
			for j := range d.Points[i] {
				for b := 0; b < 2; b++ {
					if d.Focal[b][i][j] == nil {
						continue
					}
					if *d.Curvature[b][i][j] > 0 {
						real++
					} else {
						virtual++
					}
				}
			}
		}
		if c.Surface.Kind == "torus" && (real == 0 || virtual == 0) {
			t.Fatalf("torus: %d real, %d virtual foci", real, virtual)
		}
	}
}

// The mirror target is the surface study's own probe of the same patch.
func TestMirrorProbeIsThePatchProbe(t *testing.T) {
	for _, c := range []Request{
		inside(mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 48, 24, parallel(25, -60))),
		glass(bowl(1.3, 36, 24, parallel(0, -90)), 1, 1.5),
	} {
		c.SurfaceDiagnostics = true
		out, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if out.Probe == nil || out.Probe.Kind != "patch" || out.Probe.Light != nil {
			t.Fatalf("mirror probe %+v", out.Probe)
		}
		s := c
		s.Format = "surface"
		want, err := Compute(s)
		if err != nil {
			t.Fatal(err)
		}
		x, _ := json.Marshal(out.Probe)
		y, _ := json.Marshal(want.Probe)
		if !bytes.Equal(x, y) {
			t.Fatal("the mirror probe differs from the patch probe")
		}
	}
}

// The two probes are one at a time; neither changes the study, and other
// studies ignore the light probe.
func TestLightProbeFlags(t *testing.T) {
	c := bowl(1.3, 12, 12, parallel(0, -90))
	c.SurfaceDiagnostics, c.LightDiagnostics = true, true
	if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "surfaceDiagnostics") || !strings.Contains(err.Error(), "lightDiagnostics") {
		t.Fatalf("both probes: %v", err)
	}
	c.SurfaceDiagnostics, c.LightDiagnostics = false, false
	before, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if before.Probe != nil {
		t.Fatal("a probe without the flag")
	}
	x, _ := json.Marshal(before)
	for _, flag := range []string{"surface", "light"} {
		c.SurfaceDiagnostics, c.LightDiagnostics = flag == "surface", flag == "light"
		after, err := Compute(c)
		if err != nil || after.Probe == nil {
			t.Fatalf("%s: %v", flag, err)
		}
		after.Probe = nil
		if y, _ := json.Marshal(after); !bytes.Equal(x, y) {
			t.Fatalf("the %s probe changed the study", flag)
		}
	}
	for _, s := range []Request{torusPatch(2, .7, 12, 12), study()} {
		s.LightDiagnostics = true
		out, err := Compute(s)
		if err != nil || out.Probe != nil {
			t.Fatalf("%s: light probe %v, %v", s.Format, out.Probe, err)
		}
	}
}
