package engine3

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"
)

// probed computes a study with surface diagnostics and checks that the
// grid's arrays agree in shape.
func probed(t *testing.T, c Request) (Result, *SurfaceDiagnostics) {
	t.Helper()
	c.SurfaceDiagnostics = true
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	d := r.Probe
	if d == nil {
		t.Fatal("no surface diagnostics")
	}
	rows, columns := len(d.U), len(d.V)
	if rows < 2 || columns < 2 || len(d.Along) != rows || len(d.Points) != rows || len(d.Normals) != rows {
		t.Fatalf("%d rows, %d columns, along %d, points %d", rows, columns, len(d.Along), len(d.Points))
	}
	for r := 0; r < rows; r++ {
		lengths := []int{len(d.Points[r]), len(d.Normals[r])}
		for k := 0; k < 2; k++ {
			lengths = append(lengths, len(d.Curvature[k][r]), len(d.Direction[k][r]), len(d.Focal[k][r]))
		}
		for _, l := range lengths {
			if l != columns {
				t.Fatalf("row %d lengths %v, want %d", r, lengths, columns)
			}
		}
	}
	return r, d
}

// each visits every sample with a normal, with its curvatures (nil where
// unknown).
func eachProbed(d *SurfaceDiagnostics, f func(r, k int, x, n Vec3, kappa [2]*float64)) {
	for r := range d.Points {
		for k := range d.Points[r] {
			if d.Points[r][k] == nil || d.Normals[r][k] == nil {
				continue
			}
			f(r, k, *d.Points[r][k], *d.Normals[r][k], [2]*float64{d.Curvature[0][r][k], d.Curvature[1][r][k]})
		}
	}
}

func closeTo(t *testing.T, what string, got *float64, want, tol float64) {
	t.Helper()
	if got == nil || math.Abs(*got-want) > tol {
		if got == nil {
			t.Fatalf("%s: unknown, want %g", what, want)
		}
		t.Fatalf("%s: got %.12g want %.12g", what, *got, want)
	}
}

// A tube of radius r around a circle of radius R is a torus. With the
// outward normal, the curvature around each contact circle (the tube's
// cross-section) is −1/r, with its focal point on the core circle, and the
// curvature across it is −cos v/(R + r cos v), where cos v = (ρ − R)/r and ρ
// is the distance from the axis. The torus patch gives the same, numbered
// κ₁ ≥ κ₂.
func TestTubeProbeIsTorus(t *testing.T) {
	const R, r = 2.0, 0.5
	across := func(x Vec3) float64 {
		cos := (math.Hypot(x.X, x.Y) - R) / r
		return -cos / (R + r*cos)
	}
	out, d := probed(t, canalled(circle(), r, "1", 4))
	if d.Kind != "canal" || !d.Periodic || len(d.V) != canalSegments || len(d.U) != 481 || d.Singular != 0 || d.Umbilics != 0 || d.Unknown != 0 || d.Clipped[0] != 0 {
		t.Fatalf("summary kind %s periodic %v rows %d columns %d singular %d umbilics %d unknown %d clipped %v", d.Kind, d.Periodic, len(d.U), len(d.V), d.Singular, d.Umbilics, d.Unknown, d.Clipped)
	}
	for k, v := range d.V {
		if math.Abs(v-2*math.Pi*float64(k)/canalSegments) > 1e-15 {
			t.Fatalf("column %d at %g", k, v)
		}
	}
	reach := focalReach * out.Bounds.Radius
	clipped := 0
	eachProbed(d, func(row, k int, x, n Vec3, kappa [2]*float64) {
		i := d.Along[row]
		core := *out.Base[i]
		if math.Abs(d.U[row]-2*math.Pi*float64(i)/480) > 1e-12 {
			t.Fatalf("row %d: u %g for sample %d", row, d.U[row], i)
		}
		near(t, n, x.sub(core).mul(1/r), 1e-12)
		closeTo(t, "around", kappa[0], -1/r, 1e-9)
		want := across(x)
		closeTo(t, "across", kappa[1], want, 1e-6)
		near(t, d.Focal[0][row][k], core, 1e-9)
		azimuth := Vec3{-x.Y, x.X, 0}.unit()
		if e := d.Direction[0][row][k]; math.Abs(e.dot(azimuth)) > 1e-9 || math.Abs(e.dot(n)) > 1e-12 || math.Abs(e.norm()-1) > 1e-12 {
			t.Fatalf("(%d, %d) circle direction %+v", row, k, *e)
		}
		if e := d.Direction[1][row][k]; math.Abs(math.Abs(e.dot(azimuth))-1) > 1e-9 {
			t.Fatalf("(%d, %d) across direction %+v", row, k, *e)
		}
		if f := d.Focal[1][row][k]; f == nil {
			if math.Abs(want)*reach > 1+1e-6 {
				t.Fatalf("(%d, %d) focal point clipped at κ %g", row, k, want)
			}
			if row < len(d.U)-1 {
				clipped++
			}
		} else {
			near(t, f, x.add(n.mul(1/want)), 1e-6*math.Max(1, f.norm()))
		}
	})
	if d.Clipped[1] != clipped {
		t.Fatalf("clipped %d, counted %d", d.Clipped[1], clipped)
	}
	// The closed tube's last row repeats its first.
	for k := range d.V {
		near(t, d.Points[len(d.U)-1][k], d.Points[0][k], 1e-9)
	}

	_, p := probed(t, torusPatch(R, r, 36, 24))
	if p.Kind != "patch" || p.Periodic || len(p.U) != 37 || len(p.V) != 25 || p.Singular != 0 || p.Umbilics != 0 {
		t.Fatalf("patch summary %+v", p)
	}
	eachProbed(p, func(row, k int, x, n Vec3, kappa [2]*float64) {
		if p.Along[row] != row {
			t.Fatalf("row %d along %d", row, p.Along[row])
		}
		closeTo(t, "κ₁", kappa[0], across(x), 1e-12)
		closeTo(t, "κ₂", kappa[1], -1/r, 1e-12)
		if math.Abs(p.Direction[0][row][k].dot(*p.Direction[1][row][k])) > 1e-12 {
			t.Fatalf("(%d, %d) directions not orthogonal", row, k)
		}
	})
}

// The patch's focal points are its focal sheets' points, clipped alike.
func TestPatchProbeAgreesWithFocalSheets(t *testing.T) {
	for _, c := range []Request{torusPatch(2, 0.8, 30, 24), surfaceStudy("ellipsoid", 1.5, 1, 0.7, 0, 2*math.Pi, -1.4, 1.4, 30, 24), surfaceStudy("cylinder", 1.2, 1.2, 0, 0, 2*math.Pi, -1, 1, 36, 12)} {
		out, d := probed(t, c)
		q := out.Surface
		for k := 0; k < 2; k++ {
			if d.Clipped[k] != q.Focal[k].Clipped {
				t.Fatalf("%s branch %d: clipped %d, sheet %d", c.Surface.Kind, k, d.Clipped[k], q.Focal[k].Clipped)
			}
			for i := range d.Points {
				for j := range d.Points[i] {
					a, b := d.Focal[k][i][j], q.Focal[k].Points[i][j]
					if (a == nil) != (b == nil) || a != nil && a.sub(*b).norm() > 0 {
						t.Fatalf("%s branch %d (%d, %d): %v vs %v", c.Surface.Kind, k, i, j, a, b)
					}
				}
			}
		}
		if d.Umbilics != q.Umbilics || d.Singular != q.Singular {
			t.Fatalf("%s: umbilics %d/%d singular %d/%d", c.Surface.Kind, d.Umbilics, q.Umbilics, d.Singular, q.Singular)
		}
	}
}

// Every point of a sphere is an umbilic: no principal directions, both
// curvatures −1/R with the outward normal, and both focal points at the
// centre. Reversing the normal reverses the curvatures, not the centre.
// The poles are chart singularities, with no normal.
func TestSphereProbeUmbilics(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		c := sphere(1.5, 24, 12)
		c.Surface.Reverse = reverse
		_, d := probed(t, c)
		sign := -1.0
		if reverse {
			sign = 1
		}
		points := 0
		eachProbed(d, func(row, k int, x, n Vec3, kappa [2]*float64) {
			points++
			near(t, n, x.mul(-sign/1.5), 1e-12)
			for b := 0; b < 2; b++ {
				closeTo(t, "κ", kappa[b], sign/1.5, 1e-12)
				if d.Direction[b][row][k] != nil {
					t.Fatalf("(%d, %d) umbilic with a direction", row, k)
				}
				near(t, d.Focal[b][row][k], Vec3{}, 1e-12)
			}
		})
		if d.Umbilics != points || d.Singular != 2*25 || points != 25*13-d.Singular {
			t.Fatalf("umbilics %d, singular %d, points %d", d.Umbilics, d.Singular, points)
		}
	}
}

// On a straight spine the canal is a surface of revolution. Its meridian
// through the contact point is the plane curve γ(t) = (t − RR′, R√(1 − R′²))
// in axial and radial coordinates, whose curvature against the sphere's
// outward normal ν = ((x − t)/R, ρ/R) is the principal curvature across the
// contact circle. This is the preset "Beads that lose their envelope",
// whose spheres have no envelope where |R′| > 1.
func TestBeadsProbeIsSurfaceOfRevolution(t *testing.T) {
	c := canalled(custom("t", "0", "0", -2*math.Pi, 2*math.Pi), 0.7, "1+0.8*sin(2*t)", 0)
	R := func(t float64) float64 { return 0.7 * (1 + 0.8*math.Sin(2*t)) }
	slope := func(t float64) float64 { return 1.12 * math.Cos(2*t) }
	profile := func(t float64) [2]float64 {
		return [2]float64{t - R(t)*slope(t), R(t) * math.Sqrt(1-slope(t)*slope(t))}
	}
	out, d := probed(t, c)
	missing, checked := 0, 0
	for row := range d.U {
		s := d.U[row]
		i := d.Along[row]
		if f := float64(i) / float64(c.Samples); s != -2*math.Pi*(1-f)+2*math.Pi*f {
			t.Fatalf("row %d: t %g for sample %d", row, s, i)
		}
		for k := range d.V {
			x := d.Points[row][k]
			if math.Abs(slope(s)) > 1 {
				if x != nil {
					t.Fatalf("t = %g: a point without a real circle", s)
				}
				missing++
				continue
			}
			if x == nil || d.Normals[row][k] == nil {
				t.Fatalf("t = %g: no point", s)
			}
			g := profile(s)
			if math.Abs(x.X-g[0]) > 1e-9 || math.Abs(math.Hypot(x.Y, x.Z)-g[1]) > 1e-9 {
				t.Fatalf("t = %g: point %+v off the profile %v", s, *x, g)
			}
			closeTo(t, "around", d.Curvature[0][row][k], -1/R(s), 1e-9)
			near(t, d.Focal[0][row][k], out.Base[i], 1e-9)
			// The profile's derivatives, from R′ = 1.12 cos 2t, R″ = −2.24 sin 2t
			// and R‴ = −4.48 cos 2t.
			r1, r2, r3 := slope(s), -2.24*math.Sin(2*s), -4.48*math.Cos(2*s)
			sigma := math.Sqrt(1 - r1*r1)
			sigma1 := -r1 * r2 / sigma
			sigma2 := -(r2*r2+r1*r3)/sigma + r1*r2*sigma1/(sigma*sigma)
			d1 := [2]float64{1 - r1*r1 - R(s)*r2, r1*sigma + R(s)*sigma1}
			d2 := [2]float64{-3*r1*r2 - R(s)*r3, r2*sigma + 2*r1*sigma1 + R(s)*sigma2}
			speed := math.Hypot(d1[0], d1[1])
			if speed < 1e-3 {
				continue
			}
			tau := [2]float64{d1[0] / speed, d1[1] / speed}
			along := d2[0]*tau[0] + d2[1]*tau[1]
			nu := [2]float64{(g[0] - s) / R(s), g[1] / R(s)}
			want := ((d2[0]-along*tau[0])*nu[0] + (d2[1]-along*tau[1])*nu[1]) / (speed * speed)
			closeTo(t, "across", d.Curvature[1][row][k], want, 1e-7*math.Max(1, math.Abs(want)))
			// Across the circle is along the meridian plane.
			radial := Vec3{0, x.Y, x.Z}.unit()
			if e := d.Direction[1][row][k]; math.Abs(e.dot(Vec3{0, -radial.Z, radial.Y})) > 1e-9 {
				t.Fatalf("t = %g: across direction %+v leaves the meridian plane", s, *e)
			}
			checked++
		}
	}
	if missing == 0 || checked < 1000 {
		t.Fatalf("%d missing, %d checked", missing, checked)
	}
}

// Along a line with R = t/2 the canal is a cone, straight across every
// contact circle: that curvature is 0 and its focal point at infinity.
// With R = t every circle collapses to the apex, a singular point.
func TestCanalProbeConeAndCollapse(t *testing.T) {
	_, d := probed(t, canalled(custom("0", "0", "t", 0.5, 3), 1, "t/2", 4))
	points := 0
	eachProbed(d, func(row, k int, x, n Vec3, kappa [2]*float64) {
		points++
		closeTo(t, "around", kappa[0], -2/d.U[row], 1e-9)
		closeTo(t, "across", kappa[1], 0, 1e-7)
		if d.Focal[1][row][k] != nil {
			t.Fatalf("(%d, %d) cone generator with a finite centre", row, k)
		}
		// The generator runs from the apex through the point.
		if e := d.Direction[1][row][k]; math.Abs(math.Abs(e.dot(x.unit()))-1) > 1e-9 {
			t.Fatalf("(%d, %d) across direction %+v", row, k, *e)
		}
	})
	if points != 481*canalSegments || d.Clipped[1] != points || d.Clipped[0] != 0 || d.Singular != 0 {
		t.Fatalf("points %d clipped %v singular %d", points, d.Clipped, d.Singular)
	}
	_, d = probed(t, canalled(custom("0", "0", "t", 0.5, 3), 1, "t", 4))
	if d.Singular != 481*canalSegments {
		t.Fatalf("singular %d", d.Singular)
	}
	for row := range d.Points {
		for k := range d.Points[row] {
			if p := d.Points[row][k]; p == nil || p.norm() > 1e-9 || d.Normals[row][k] != nil || d.Curvature[0][row][k] != nil || d.Curvature[1][row][k] != nil {
				t.Fatalf("(%d, %d) collapsed circle: point %v normal %v", row, k, p, d.Normals[row][k])
			}
		}
	}
}

// A tube whose radius equals its core circle's is a horn torus: at the
// inner equator, where e = N, the surface has a cuspidal edge (1 − Rκ_e = 0)
// and no normal. Where R″ is unstable, the curvature across the circle is
// unknown, but the circle's own curvature and both directions are not.
func TestCanalProbeCuspAndUnknown(t *testing.T) {
	_, d := probed(t, canalled(circle(), 2, "1", 0))
	cusps := 0
	for row := range d.Points {
		for k := range d.Points[row] {
			x := *d.Points[row][k]
			inner := math.Hypot(x.X, x.Y) < 1e-6
			if inner != (d.Normals[row][k] == nil) {
				t.Fatalf("(%d, %d) at %+v: normal %v", row, k, x, d.Normals[row][k])
			}
			if inner && d.counted(row) {
				cusps++
			}
		}
	}
	if cusps != 480 || d.Singular != cusps {
		t.Fatalf("%d cusps, singular %d", cusps, d.Singular)
	}
	_, d = probed(t, canalled(custom("t", "0", "0", -1, 1), 0.3, "1+0.1*abs(t)^1.5", 0))
	if d.Unknown != canalSegments || d.Singular != 0 {
		t.Fatalf("unknown %d singular %d", d.Unknown, d.Singular)
	}
	for row, i := range d.Along {
		for k := range d.V {
			known := d.Curvature[1][row][k] != nil
			if known == (i == 240) || d.Curvature[0][row][k] == nil || d.Direction[0][row][k] == nil || d.Direction[1][row][k] == nil {
				t.Fatalf("sample %d column %d: across known %v", i, k, known)
			}
			if !known && d.Focal[1][row][k] != nil {
				t.Fatalf("sample %d: a focal point without a curvature", i)
			}
		}
	}
}

// helixCanal is a canal of varying radius around a helix, with meridians
// every quarter turn.
func helixCanal(samples int) Request {
	c := canalled(custom("cos(t)", "sin(t)", "t/2", 0, 4*math.Pi), 0.3, "1+0.5*sin(3*t)", 4)
	c.Samples = samples
	return c
}

// At every regular sample, n is the unit sphere normal (X − c)/R, the two
// directions are orthonormal and tangent, the contact circle's direction is
// T × n, and its focal point is the sphere's centre.
func TestCanalProbeFrame(t *testing.T) {
	out, d := probed(t, helixCanal(480))
	if d.Singular != 0 || d.Unknown != 0 || d.Umbilics != 0 {
		t.Fatalf("singular %d unknown %d umbilics %d", d.Singular, d.Unknown, d.Umbilics)
	}
	eachProbed(d, func(row, k int, x, n Vec3, kappa [2]*float64) {
		s := d.U[row]
		center := Vec3{math.Cos(s), math.Sin(s), s / 2}
		radius := 0.3 * (1 + 0.5*math.Sin(3*s))
		tangent := Vec3{-math.Sin(s), math.Cos(s), 0.5}.unit()
		near(t, n, x.sub(center).mul(1/radius), 1e-9)
		near(t, d.Focal[0][row][k], center, 1e-9)
		near(t, out.Base[d.Along[row]], center, 1e-12)
		closeTo(t, "around", kappa[0], -1/radius, 1e-9)
		e0, e1 := *d.Direction[0][row][k], *d.Direction[1][row][k]
		near(t, e0, tangent.cross(n).unit(), 1e-9)
		for _, dot := range []float64{e0.dot(e1), e0.dot(n), e1.dot(n), e0.norm() - 1, e1.norm() - 1} {
			if math.Abs(dot) > 1e-9 {
				t.Fatalf("(%d, %d) frame %+v %+v %+v", row, k, e0, e1, n)
			}
		}
		if f := d.Focal[1][row][k]; f != nil {
			near(t, f, x.add(n.mul(1 / *kappa[1])), 1e-9*math.Max(1, f.norm()))
		}
	})
}

// The drawn meridians are curves on the surface. Their normal curvature,
// from second differences of their points, obeys Euler's formula
// κₙ = κ₀cos²α + κ₁sin²α, with α the angle from the contact circle, so it
// estimates κ₁ independently. The estimate's error against the probe falls
// fourfold as the samples double.
func TestCanalProbeConvergesToMeridians(t *testing.T) {
	deviation := func(samples int) float64 {
		out, d := probed(t, helixCanal(samples))
		h := 4 * math.Pi / float64(samples)
		worst := 0.0
		for row, i := range d.Along {
			if i == 0 || i == samples {
				continue
			}
			s := d.U[row]
			center := Vec3{math.Cos(s), math.Sin(s), s / 2}
			radius := 0.3 * (1 + 0.5*math.Sin(3*s))
			tangent := Vec3{-math.Sin(s), math.Cos(s), 0.5}.unit()
			for m, meridian := range out.Canal.Meridians {
				k := m * canalSegments / len(out.Canal.Meridians)
				a, p, b := *meridian[i-1], *meridian[i], *meridian[i+1]
				near(t, d.Points[row][k], p, 1e-9)
				d1 := b.sub(a).mul(1 / (2 * h))
				d2 := b.sub(p.mul(2)).add(a).mul(1 / (h * h))
				n := p.sub(center).mul(1 / radius)
				normal := d2.dot(n) / d1.dot(d1)
				circle := tangent.cross(n).unit()
				cos := d1.unit().dot(circle)
				estimate := (normal + cos*cos/radius) / (1 - cos*cos)
				worst = math.Max(worst, math.Abs(estimate-*d.Curvature[1][row][k]))
			}
		}
		return worst
	}
	a, b, c := deviation(480), deviation(960), deviation(1920)
	if !(b < a/3.5 && c < b/3.5 && c < 1e-3) {
		t.Fatalf("deviations %g, %g, %g", a, b, c)
	}
}

// Without the flag, no study carries surface diagnostics, and with it the
// study is otherwise byte-identical. Only patches and canals have them.
func TestSurfaceDiagnosticsOffLeaveResultsUnchanged(t *testing.T) {
	mirror := surfaceStudy("paraboloid", 1, 1, 0, 0, 1, 0, 2*math.Pi, 24, 24)
	mirror.Format = "rays"
	mirror.Rays = RaysRequest{Interaction: "reflect", Light: "parallel", Azimuth: 0, Elevation: 90, Length: 1, Receiver: ReceiverRequest{Plane: "none"}}
	for _, c := range []Request{canalled(circle(), 0.5, "1", 4), helixCanal(480), torusPatch(2, 0.7, 24, 24), custom("cos(t)", "sin(t)", "t", 0, 4), canalled(custom("t", "0", "0", -2*math.Pi, 2*math.Pi), 0.7, "1+0.8*sin(2*t)", 0), mirror} {
		for _, curve := range []bool{false, true} {
			c.Diagnostics = curve
			before, err := Compute(c)
			if err != nil {
				t.Fatal(err)
			}
			if before.Probe != nil {
				t.Fatal("surface diagnostics without the flag")
			}
			c.SurfaceDiagnostics = true
			after, err := Compute(c)
			if err != nil {
				t.Fatal(err)
			}
			want := c.Format == "surface" || c.Construction == "canal" && c.Format != "surface" && c.Format != "rays"
			if (after.Probe != nil) != want {
				t.Fatalf("%s/%s: surface diagnostics %v", c.Format, c.Construction, after.Probe != nil)
			}
			after.Probe = nil
			x, _ := json.Marshal(before)
			y, _ := json.Marshal(after)
			if !bytes.Equal(x, y) {
				t.Fatalf("%s/%s: surface diagnostics changed the study", c.Format, c.Construction)
			}
			c.SurfaceDiagnostics = false
		}
	}
}

// A canal keeps at most canalRings + 1 rows, evenly spaced from the first
// sample to the last.
func TestCanalProbeRowsAreBounded(t *testing.T) {
	for _, samples := range []int{480, 2000, 2400} {
		_, d := probed(t, helixCanal(samples))
		last := len(d.Along) - 1
		if len(d.U) > canalRings+1 || d.Along[0] != 0 || d.Along[last] != samples {
			t.Fatalf("%d samples: %d rows from %d to %d", samples, len(d.U), d.Along[0], d.Along[last])
		}
		stride := d.Along[1]
		for r := 1; r < last; r++ {
			if d.Along[r]-d.Along[r-1] != stride {
				t.Fatalf("%d samples: rows %v not evenly spaced", samples, d.Along[r-1:r+1])
			}
		}
		if gap := samples - d.Along[last-1]; gap < 1 || gap > stride {
			t.Fatalf("%d samples: last gap %d", samples, gap)
		}
	}
}

// The probe does not depend on how fast the spine is traced. Along
// x = t + 0.4 sin t, whose speed varies, the spheres of radius
// R̂(x) = 0.5(1 + 0.3 sin x) envelop the surface of revolution with that
// radius as a function of the axial position x, so the curvature across
// each circle is that of the meridian γ(x) = (x − R̂R̂′, R̂√(1 − R̂′²)).
func TestCanalProbeIgnoresSpineSpeed(t *testing.T) {
	c := canalled(custom("t+0.4*sin(t)", "0", "0", -3, 3), 0.5, "1+0.3*sin(t+0.4*sin(t))", 0)
	_, d := probed(t, c)
	R := func(x float64) float64 { return 0.5 * (1 + 0.3*math.Sin(x)) }
	checked := 0
	eachProbed(d, func(row, k int, p, n Vec3, kappa [2]*float64) {
		x := d.U[row] + 0.4*math.Sin(d.U[row])
		r, r1, r2, r3 := R(x), 0.15*math.Cos(x), -0.15*math.Sin(x), -0.15*math.Cos(x)
		sigma := math.Sqrt(1 - r1*r1)
		sigma1 := -r1 * r2 / sigma
		sigma2 := -(r2*r2+r1*r3)/sigma + r1*r2*sigma1/(sigma*sigma)
		g := [2]float64{x - r*r1, r * sigma}
		d1 := [2]float64{1 - r1*r1 - r*r2, r1*sigma + r*sigma1}
		d2 := [2]float64{-3*r1*r2 - r*r3, r2*sigma + 2*r1*sigma1 + r*sigma2}
		speed := math.Hypot(d1[0], d1[1])
		tau := [2]float64{d1[0] / speed, d1[1] / speed}
		along := d2[0]*tau[0] + d2[1]*tau[1]
		nu := [2]float64{(g[0] - x) / r, g[1] / r}
		want := ((d2[0]-along*tau[0])*nu[0] + (d2[1]-along*tau[1])*nu[1]) / (speed * speed)
		if math.Abs(p.X-g[0]) > 1e-9 || math.Abs(math.Hypot(p.Y, p.Z)-g[1]) > 1e-9 {
			t.Fatalf("x = %g: point %+v off the profile %v", x, p, g)
		}
		closeTo(t, "around", kappa[0], -1/r, 1e-9)
		closeTo(t, "across", kappa[1], want, 1e-7)
		checked++
	})
	if checked != len(d.U)*canalSegments {
		t.Fatalf("checked %d", checked)
	}
}

// A focal point is at infinity exactly where 1/|κ| exceeds 100 study
// radii. A nearly cylindrical canal has curvatures across its circles on
// both sides of that threshold.
func TestCanalProbeClipThreshold(t *testing.T) {
	out, d := probed(t, canalled(custom("t", "0", "0", 0, 2*math.Pi), 0.5, "1+0.02*sin(t)", 0))
	reach := focalReach * out.Bounds.Radius
	finite, clipped := 0, 0
	eachProbed(d, func(row, k int, x, n Vec3, kappa [2]*float64) {
		far := !(math.Abs(*kappa[1])*reach > 1)
		if far != (d.Focal[1][row][k] == nil) {
			t.Fatalf("(%d, %d): κ %g with reach %g, focal %v", row, k, *kappa[1], reach, d.Focal[1][row][k])
		}
		if far {
			clipped++
		} else if 1/math.Abs(*kappa[1]) > 10*out.Bounds.Radius {
			finite++
		}
	})
	if finite == 0 || clipped == 0 || d.Clipped[1] != clipped {
		t.Fatalf("%d finite beyond 10 radii, %d clipped, counted %v", finite, clipped, d.Clipped)
	}
}
