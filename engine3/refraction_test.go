package engine3

import (
	"math"
	"strings"
	"testing"
)

// glass makes a ray study refract from index n1, on the normal's side, into
// index n2.
func glass(c Request, n1, n2 float64) Request {
	c.Rays.Interaction, c.Rays.N1, c.Rays.N2 = "refract", n1, n2
	return c
}

// flat is the plane z = 0 over [−h, h]², with its normal +z, on a 24 × 24
// grid.
func flat(h float64, light RaysRequest) Request {
	return mirror("paraboloid", 0, 0, 0, -h, h, -h, h, 24, 24, light)
}

// snell refracts unit I at unit n, which faces the incident side, by its
// tangential part: T = t − √(1 − |t|²) n with t = η(I − (I·n)n).
func snell(in, n Vec3, eta float64) (Vec3, bool) {
	t := in.sub(n.mul(in.dot(n))).mul(eta)
	k := 1 - t.dot(t)
	if k <= 0 {
		return Vec3{}, false
	}
	return t.sub(n.mul(math.Sqrt(k))), true
}

// Every representative ray obeys Snell's law: the transmitted ray is a unit
// vector in the plane of the incident ray and the normal, continuing
// through the interface, with n₁ sin θ₁ = n₂ sin θ₂. Beyond the critical
// angle the light is totally reflected, and its ray is drawn reflected.
func TestRefractionLaw(t *testing.T) {
	for _, tc := range []struct {
		c      Request
		n1, n2 float64
	}{
		{mirror("ellipsoid", 1.5, 1, .7, .2, 2.5, -1.2, .4, 36, 24, lamp(Vec3{1.5, 2.5, 1})), 1, 1.5},
		{mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 48, 24, parallel(25, -60)), 1.1, 1},
		{inside(mirror("ellipsoid", 1, 1, 1, 0, 2*math.Pi, -1.4, 1.4, 36, 24, lamp(Vec3{.3, .6, .3}))), 1.5, 1},
	} {
		c := glass(tc.c, tc.n1, tc.n2)
		c.Rays.Length = 1.7
		q := c.Surface
		r := rayed(t, c)
		transmitted, total := 0, 0
		for _, l := range r.Lines {
			u, v := grid(q, l.I, l.J)
			x, xu, xv, _, _, _ := q.patch(u, v)
			n := xu.cross(xv).unit()
			if q.Reverse {
				n = n.mul(-1)
			}
			in := c.Rays.direction()
			if c.Rays.Light == "point" {
				in = x.sub(c.Rays.Source).unit()
			}
			if l.Point != x || l.Start != x.sub(in.mul(1.7)) && l.Start != c.Rays.Source {
				t.Fatalf("%s: ray (%d, %d) starts at %+v", q.Kind, l.I, l.J, l.Start)
			}
			d := l.End.sub(l.Point).mul(1 / 1.7)
			sin1 := in.cross(n).norm()
			if l.Total {
				total++
				if tc.n1*sin1 < tc.n2-1e-9 || l.Virtual || l.Back != l.Point {
					t.Fatalf("%s: (%d, %d) is totally reflected at sin θ₁ = %v", q.Kind, l.I, l.J, sin1)
				}
				if want := in.sub(n.mul(2 * in.dot(n))); d.sub(want).norm() > 1e-12 {
					t.Fatalf("%s: a totally reflected ray runs %+v, want %+v", q.Kind, d, want)
				}
				continue
			}
			transmitted++
			if math.Abs(d.norm()-1) > 1e-12 || math.Abs(d.dot(in.cross(n))) > 1e-12 || d.dot(n) >= 0 {
				t.Fatalf("%s: (%d, %d) transmits %+v", q.Kind, l.I, l.J, d)
			}
			if got := tc.n2 * d.cross(n).norm(); math.Abs(got-tc.n1*sin1) > 1e-12 {
				t.Fatalf("%s: n₂ sin θ₂ = %v, n₁ sin θ₁ = %v", q.Kind, got, tc.n1*sin1)
			}
			if want, ok := snell(in, n, tc.n1/tc.n2); !ok || d.sub(want).norm() > 1e-12 {
				t.Fatalf("%s: T = %+v, want %+v", q.Kind, d, want)
			}
			if l.Back.sub(l.Point.sub(d.mul(1.7))).norm() > 1e-12 {
				t.Fatalf("%s: the virtual extension runs back along T", q.Kind)
			}
		}
		if transmitted < 10 || tc.n1 > tc.n2 && total == 0 {
			t.Fatalf("%s: %d transmitted, %d totally reflected", q.Kind, transmitted, total)
		}
	}
}

// Through a plane, from a point source at height h, the transmitted rays
// appear to leave two virtual caustics (Coddington's equations with no
// power): at slant distance s and angles θ₁, θ₂ from the normal, μ_s =
// −n₁/(n₂ s) and μ_t = −n₁ cos²θ₁/(n₂ s cos²θ₂). The sagittal one lies on
// the normal through the source, and the two meet at its foot. Parallel
// light passes a plane unfocused.
func TestPlaneInterfaceCoddington(t *testing.T) {
	source := Vec3{.25, -.5, 1}
	for _, tc := range []struct{ n1, n2 float64 }{{1, 1.5}, {1.5, 1}, {1, 1.33}} {
		c := glass(flat(1, lamp(source)), tc.n1, tc.n2)
		r := rayed(t, c)
		if caustic(t, r, 1, false).Shape != "none" || caustic(t, r, 2, false).Shape != "none" {
			t.Fatal("a plane has no real caustic of a point source")
		}
		if r.Stigmatic != 1 {
			t.Fatalf("n %v/%v: stigmatic %d", tc.n1, tc.n2, r.Stigmatic)
		}
		checked := 0
		for i := 0; i <= 24; i++ {
			for j := 0; j <= 24; j++ {
				u, v := grid(c.Surface, i, j)
				x := Vec3{u, v, 0}
				s := x.sub(source).norm()
				sin1 := math.Hypot(u-source.X, v-source.Y) / s
				sin2 := sin1 * tc.n1 / tc.n2
				if sin2 >= 1-1e-9 {
					continue
				}
				cos1, cos2 := source.Z/s, math.Sqrt(1-sin2*sin2)
				mu := [2]float64{-tc.n1 * cos1 * cos1 / (tc.n2 * s * cos2 * cos2), -tc.n1 / (tc.n2 * s)}
				if tc.n1 > tc.n2 {
					mu[0], mu[1] = mu[1], mu[0]
				}
				p := c.Surface.ray(c.Rays, u, v, 1)
				if !p.Lit || p.Total || math.Abs(p.Mu[0]-mu[0]) > 1e-12*(1+math.Abs(mu[0])) || math.Abs(p.Mu[1]-mu[1]) > 1e-12*(1+math.Abs(mu[1])) {
					t.Fatalf("n %v/%v at (%d, %d): μ %v, want %v", tc.n1, tc.n2, i, j, p.Mu, mu)
				}
				sagittal := 1
				if tc.n1 > tc.n2 {
					sagittal = 0
				}
				if i == 15 && j == 6 {
					continue
				}
				f := caustic(t, r, sagittal+1, true).Points[i][j]
				if f == nil || math.Hypot(f.X-source.X, f.Y-source.Y) > 1e-12 {
					t.Fatalf("n %v/%v: the sagittal caustic %+v is off the normal through the source", tc.n1, tc.n2, f)
				}
				checked++
			}
		}
		if checked < 250 {
			t.Fatal(checked)
		}
	}
	c := glass(flat(1, parallel(20, -50)), 1, 1.5)
	r := rayed(t, c)
	if r.Clipped[0] != 625 || r.Clipped[1] != 625 || r.Stigmatic != 625 {
		t.Fatalf("clipped %v, stigmatic %d", r.Clipped, r.Stigmatic)
	}
}

// A refracting sphere of radius R under axial parallel light, from n₁
// outside into n₂: with P = (n₂ cos θ₂ − n₁ cos θ₁)/R, Coddington's
// equations give μ_s = P/n₂ and μ_t = P/(n₂ cos²θ₂), both real, the
// sagittal focus on the axis. At the vertex both are the paraxial focus
// n₂R/(n₂ − n₁).
func TestRefractingSphereCoddington(t *testing.T) {
	R, n1, n2 := 1.3, 1.0, 1.5
	c := glass(mirror("ellipsoid", R, R, R, 0, 2*math.Pi, .05, math.Pi/2, 36, 24, parallel(0, -90)), n1, n2)
	r := rayed(t, c)
	tangential, sagittal := caustic(t, r, 1, false), caustic(t, r, 2, false)
	if tangential.Shape != "surface" || sagittal.Shape != "curve" || caustic(t, r, 1, true).Shape != "none" {
		t.Fatalf("tangential %s, sagittal %s", tangential.Shape, sagittal.Shape)
	}
	if r.Singular != 37 || r.Unlit != 0 || r.Total != 0 {
		t.Fatalf("singular %d, unlit %d, total %d", r.Singular, r.Unlit, r.Total)
	}
	for i := 0; i <= 36; i++ {
		for j := 0; j < 24; j++ {
			u, v := grid(c.Surface, i, j)
			x, _, _, _, _, _ := c.Surface.patch(u, v)
			n := x.mul(1 / R)
			cos1 := n.Z
			sin2 := math.Sqrt(1-cos1*cos1) * n1 / n2
			cos2 := math.Sqrt(1 - sin2*sin2)
			P := (n2*cos2 - n1*cos1) / R
			d, _ := snell(Vec3{0, 0, -1}, n, n1/n2)
			want := [2]Vec3{x.add(d.mul(n2 * cos2 * cos2 / P)), x.add(d.mul(n2 / P))}
			for k, s := range []CausticSheet{tangential, sagittal} {
				if p := s.Points[i][j]; p == nil || p.sub(want[k]).norm() > 1e-12*R {
					t.Fatalf("branch %d at (%d, %d): %+v, want %+v", k+1, i, j, p, want[k])
				}
			}
			if f := sagittal.Points[i][j]; math.Hypot(f.X, f.Y) > 1e-12 {
				t.Fatalf("the sagittal focus lies on the axis: %+v", f)
			}
		}
	}
	vertex := c.Surface.ray(c.Rays, 0, math.Pi/2-1e-7, R)
	if f := n2 * R / (n2 - n1); math.Abs(1/vertex.Mu[0]-f) > 1e-6 || math.Abs(1/vertex.Mu[1]-f) > 1e-6 {
		t.Fatalf("paraxial focus %v, 1/μ %v", f, [2]float64{1 / vertex.Mu[0], 1 / vertex.Mu[1]})
	}
}

// An ellipsoid of revolution with eccentricity n₁/n₂ refracts light
// parallel to its axis exactly through its far focus: both caustics are
// that point, and every transmitted ray is stigmatic.
func TestCartesianEllipsoid(t *testing.T) {
	C, n := 1.5, 1.5
	A := C * math.Sqrt(1-1/(n*n))
	c := glass(mirror("ellipsoid", A, A, C, 0, 2*math.Pi, .05, math.Pi/2, 36, 24, parallel(0, -90)), 1, n)
	r := rayed(t, c)
	focus := Vec3{0, 0, -C / n}
	lit := 37*25 - r.Singular
	if r.Stigmatic != lit || r.Singular != 37 {
		t.Fatalf("stigmatic %d of %d, singular %d", r.Stigmatic, lit, r.Singular)
	}
	for branch := 1; branch <= 2; branch++ {
		s := caustic(t, r, branch, false)
		if s.Shape != "point" || count(s.SurfaceSheet) != lit {
			t.Fatalf("branch %d: %s, %d points", branch, s.Shape, count(s.SurfaceSheet))
		}
		each(s.SurfaceSheet, func(i, j int, p Vec3) {
			if p.sub(focus).norm() > 1e-12 {
				t.Fatalf("(%d, %d): %+v", i, j, p)
			}
		})
	}
	for _, l := range r.Lines {
		if distanceToLine(focus, l.Point, l.End.sub(l.Point).unit()) > 1e-12 {
			t.Fatalf("ray (%d, %d) misses the focus", l.I, l.J)
		}
	}
}

// Light leaving glass through a plane, from a lamp at depth h below it, is
// totally reflected wherever sin θ₁ ≥ n₂/n₁: outside Snell's window, a
// disc of radius h tan θ_c. Those samples have no transmitted ray and no
// caustic, and the caustics are never joined across the window's edge.
func TestTotalInternalReflection(t *testing.T) {
	c := glass(inside(flat(1.5, lamp(Vec3{0, 0, -1}))), 1.5, 1)
	r := rayed(t, c)
	radius := math.Tan(math.Asin(1 / 1.5))
	want := 0
	for i := 0; i <= 24; i++ {
		for j := 0; j <= 24; j++ {
			u, v := grid(c.Surface, i, j)
			if math.Hypot(u, v) >= radius {
				want++
			}
		}
	}
	if r.Total != want || r.Unlit != 0 || want < 100 || want > 500 {
		t.Fatalf("totally reflected %d, want %d; unlit %d", r.Total, want, r.Unlit)
	}
	for _, part := range r.Caustics {
		if part.Shape != "none" && !part.Virtual {
			t.Fatalf("branch %d has a real part", part.Branch)
		}
		each(part.SurfaceSheet, func(i, j int, p Vec3) {
			u, v := grid(c.Surface, i, j)
			if math.Hypot(u, v) >= radius {
				t.Fatalf("(%d, %d) is beyond the critical angle and has a caustic point", i, j)
			}
		})
		for i := range part.AlongU {
			for j := range part.AlongU[i] {
				u0, v0 := grid(c.Surface, i, j)
				u1, v1 := grid(c.Surface, i+1, j)
				if part.AlongU[i][j] && (math.Hypot(u0, v0) >= radius || math.Hypot(u1, v1) >= radius) {
					t.Fatal("a caustic is joined across the critical angle")
				}
			}
		}
	}
	total := 0
	for _, l := range r.Lines {
		if l.Total {
			total++
		}
	}
	if total == 0 || total == len(r.Lines) {
		t.Fatalf("%d of %d rays totally reflected", total, len(r.Lines))
	}
}

// With equal indices nothing bends: a point source's transmitted rays
// appear to leave the source itself, a virtual point, and parallel light
// stays parallel.
func TestRefractionIdentity(t *testing.T) {
	source := Vec3{.3, .2, 2}
	c := glass(mirror("paraboloid", .5, .5, 0, -1, 1, -1, 1, 24, 24, lamp(source)), 1.4, 1.4)
	r := rayed(t, c)
	if r.Stigmatic != 625 {
		t.Fatal(r.Stigmatic)
	}
	for branch := 1; branch <= 2; branch++ {
		s := caustic(t, r, branch, true)
		if s.Shape != "point" {
			t.Fatalf("branch %d: %s", branch, s.Shape)
		}
		each(s.SurfaceSheet, func(i, j int, p Vec3) {
			if p.sub(source).norm() > 1e-12 {
				t.Fatalf("(%d, %d): %+v", i, j, p)
			}
		})
	}
	c = glass(mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 48, 24, parallel(25, -60)), 1.4, 1.4)
	if r := rayed(t, c); r.Clipped[0] != r.Clipped[1] || r.Clipped[0] != 49*25-r.Unlit {
		t.Fatalf("clipped %v, unlit %d", r.Clipped, r.Unlit)
	}
}

// Every refracted caustic point lies on its transmitted ray, where
// det(Y_u, Y_v, T) = 0 by independent central differences, with its normal
// across T and the caustic's tangents; W stays symmetric.
func TestRefractedCausticResiduals(t *testing.T) {
	for _, tc := range []struct {
		c      Request
		n1, n2 float64
	}{
		{mirror("ellipsoid", 1.5, 1, .7, .2, 2.5, -1.2, .4, 36, 24, lamp(Vec3{.3, .2, 2})), 1, 1.5},
		{mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 48, 24, parallel(25, -60)), 1, 1.33},
		{mirror("paraboloid", .5, -.3, 0, -1.5, 1.5, -1.5, 1.5, 24, 24, parallel(0, -70)), 1.5, 1},
		{inside(mirror("cylinder", 1.4, .8, 0, 0, 2*math.Pi, -1, 1, 36, 12, lamp(Vec3{.3, -.2, .5}))), 1.6, 1},
		{mirror("monkey", .4, 0, 0, -1, 1, -1, 1, 24, 24, parallel(10, -80)), 1, 2.4},
	} {
		c := glass(tc.c, tc.n1, tc.n2)
		q, light := c.Surface, c.Rays
		transmitted := func(u, v float64) (Vec3, Vec3) {
			x, xu, xv, _, _, _ := q.patch(u, v)
			n := xu.cross(xv).unit()
			in := light.direction()
			if light.Light == "point" {
				in = x.sub(light.Source).unit()
			}
			if in.dot(n) > 0 {
				n = n.mul(-1)
			}
			d, _ := snell(in, n, tc.n1/tc.n2)
			return x, d
		}
		r := rayed(t, c)
		checked := 0
		for _, part := range r.Caustics {
			each(part.SurfaceSheet, func(i, j int, p Vec3) {
				u, v := grid(q, i, j)
				x, d := transmitted(u, v)
				lambda := p.sub(x).dot(d)
				if p.sub(x.add(d.mul(lambda))).norm() > 1e-9*(1+math.Abs(lambda)) || (lambda > 0) == part.Virtual {
					t.Fatalf("%s: (%d, %d) is off its ray, λ = %v, virtual %v", q.Kind, i, j, lambda, part.Virtual)
				}
				h := 1e-5
				y := func(u, v float64) Vec3 { x, d := transmitted(u, v); return x.add(d.mul(lambda)) }
				yu := y(u+h, v).sub(y(u-h, v)).mul(1 / (2 * h))
				yv := y(u, v+h).sub(y(u, v-h)).mul(1 / (2 * h))
				if det := yu.cross(yv).dot(d); math.Abs(det) > 1e-6*(1+yu.norm()*yv.norm()) {
					t.Fatalf("%s: (%d, %d) det = %v", q.Kind, i, j, det)
				}
				if n := part.Normals[i][j]; n != nil {
					if math.Abs(n.norm()-1) > 1e-12 || math.Abs(n.dot(d)) > 1e-12 {
						t.Fatalf("%s: normal %+v against T %+v", q.Kind, n, d)
					}
					k := part.Branch - 1
					cu := q.ray(light, u+h, v, 1).caustic(k).sub(q.ray(light, u-h, v, 1).caustic(k)).mul(1 / (2 * h))
					cv := q.ray(light, u, v+h, 1).caustic(k).sub(q.ray(light, u, v-h, 1).caustic(k)).mul(1 / (2 * h))
					if math.Abs(cu.dot(*n)) > 1e-5*(1+cu.norm()) || math.Abs(cv.dot(*n)) > 1e-5*(1+cv.norm()) {
						t.Fatalf("%s: the caustic's tangents %v, %v against its normal", q.Kind, cu.dot(*n), cv.dot(*n))
					}
				}
				checked++
			})
		}
		if checked < 100 {
			t.Fatalf("%s: %d caustic points", q.Kind, checked)
		}
		for i := 0; i <= q.USamples; i++ {
			for j := 0; j <= q.VSamples; j++ {
				s := q.ray(light, lerp(q.UMin, q.UMax, i, q.USamples), lerp(q.VMin, q.VMax, j, q.VSamples), 1)
				if s.Lit && !s.Total && math.Abs(s.Twist) > 1e-9*(math.Abs(s.Mu[0])+math.Abs(s.Mu[1])+1) {
					t.Fatalf("%s: (%d, %d) twist %v, μ %v", q.Kind, i, j, s.Twist, s.Mu)
				}
			}
		}
	}
}

func TestRefractionValidation(t *testing.T) {
	ok := func() Request {
		return glass(mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 36, 24, parallel(10, -45)), 1, 1.5)
	}
	for _, tc := range []struct {
		change func(*Request)
		want   string
	}{
		{func(c *Request) { c.Rays.Interaction = "absorb" }, "interaction"},
		{func(c *Request) { c.Rays.Interaction = "" }, "interaction"},
		{func(c *Request) { c.Rays.N1 = 0 }, "refractive indices"},
		{func(c *Request) { c.Rays.N2 = -1.5 }, "refractive indices"},
		{func(c *Request) { c.Rays.N2 = math.NaN() }, "refractive indices"},
		{func(c *Request) { c.Rays.N1 = 101 }, "refractive indices"},
	} {
		c := ok()
		tc.change(&c)
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("want %q, got %v", tc.want, err)
		}
	}
	// A mirror reads no indices.
	c := ok()
	c.Rays.Interaction, c.Rays.N1, c.Rays.N2 = "reflect", math.NaN(), 0
	if _, err := Compute(c); err != nil {
		t.Fatal(err)
	}
}
