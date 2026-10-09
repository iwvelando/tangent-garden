package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// mirror is a surface patch lit by light, with six parameter curves each
// way and rays of length 1.
func mirror(kind string, a, b, c, u0, u1, v0, v1 float64, nu, nv int, light RaysRequest) Request {
	q := surfaceStudy(kind, a, b, c, u0, u1, v0, v1, nu, nv)
	q.Format, q.Rays = "rays", light
	return q
}

func parallel(azimuth, elevation float64) RaysRequest {
	return RaysRequest{Interaction: "reflect", Light: "parallel", Azimuth: azimuth, Elevation: elevation, Length: 1, Receiver: ReceiverRequest{Plane: "none"}}
}

func lamp(s Vec3) RaysRequest {
	return RaysRequest{Interaction: "reflect", Light: "point", Source: s, Length: 1, Receiver: ReceiverRequest{Plane: "none"}}
}

// bowl is the lower half of a sphere of radius r with its inward normal, a
// concave mirror facing up, stopping short of the equator.
func bowl(r float64, nu, nv int, light RaysRequest) Request {
	q := mirror("ellipsoid", r, r, r, 0, 2*math.Pi, -math.Pi/2, -.05, nu, nv, light)
	q.Surface.Reverse = true
	return q
}

// inside reverses the normal, to reflect on a closed surface's inside.
func inside(c Request) Request {
	c.Surface.Reverse = true
	return c
}

func rayed(t *testing.T, c Request) *RaysResult {
	t.Helper()
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if out.Rays == nil || out.Surface != nil {
		t.Fatal("no ray result")
	}
	if _, err := json.Marshal(out); err != nil {
		t.Fatal(err)
	}
	if len(out.Base) != 0 || len(corners(out.Mesh)) != 0 || len(out.Rulings) != 0 {
		t.Fatalf("a ray study has no base curve: %d samples, %d vertices", len(out.Base), len(corners(out.Mesh)))
	}
	return out.Rays
}

// caustic returns branch k's real or virtual part.
func caustic(t *testing.T, r *RaysResult, branch int, virtual bool) CausticSheet {
	t.Helper()
	for _, s := range r.Caustics {
		if s.Branch == branch && s.Virtual == virtual {
			return s
		}
	}
	t.Fatalf("no caustic part %d, virtual %v", branch, virtual)
	return CausticSheet{}
}

func count(s SurfaceSheet) int {
	n := 0
	each(s, func(int, int, Vec3) { n++ })
	return n
}

// distanceToLine is the distance from p to the line through a along unit d.
func distanceToLine(p, a, d Vec3) float64 {
	w := p.sub(a)
	return w.sub(d.mul(w.dot(d))).norm()
}

// Parallel light travels at azimuth α and elevation β, in degrees, and is
// exact at multiples of a right angle.
func TestRaysDirection(t *testing.T) {
	for _, tc := range []struct {
		azimuth, elevation float64
		want               Vec3
	}{
		{0, -90, Vec3{0, 0, -1}},
		{90, 0, Vec3{0, 1, 0}},
		{-180, 0, Vec3{-1, 0, 0}},
		{450, 90, Vec3{0, 0, 1}},
		{-90, 0, Vec3{0, -1, 0}},
		{720, 0, Vec3{1, 0, 0}},
	} {
		if got := (RaysRequest{Azimuth: tc.azimuth, Elevation: tc.elevation}).direction(); got != tc.want {
			t.Fatalf("α %v, β %v: %+v", tc.azimuth, tc.elevation, got)
		}
	}
	d := RaysRequest{Azimuth: 30, Elevation: 45}.direction()
	want := Vec3{math.Cos(math.Pi/4) * math.Cos(math.Pi/6), math.Cos(math.Pi/4) * math.Sin(math.Pi/6), math.Sin(math.Pi / 4)}
	if d.sub(want).norm() > 1e-15 {
		t.Fatalf("%+v", d)
	}
}

// Every representative ray obeys the law of reflection: the reflected ray is
// a unit vector in the plane of the incident ray and the normal, making the
// same angle with the normal on its other side.
func TestReflectionLaw(t *testing.T) {
	for _, c := range []Request{
		mirror("ellipsoid", 1.5, 1, .7, .2, 2.5, -1.2, .4, 36, 24, lamp(Vec3{1.5, 2.5, 1})),
		mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 48, 24, parallel(25, -60)),
		mirror("monkey", .4, 0, 0, -1, 1, -1, 1, 24, 24, parallel(10, -80)),
	} {
		c.Rays.Length = 1.7
		r := rayed(t, c)
		if len(r.Lines) < 10 {
			t.Fatalf("%s: %d rays", c.Surface.Kind, len(r.Lines))
		}
		for _, l := range r.Lines {
			u, v := grid(c.Surface, l.I, l.J)
			s := c.Surface.point(u, v, 1)
			in := l.Point.sub(l.Start).unit()
			if c.Rays.Light == "parallel" {
				if in.sub(c.Rays.direction()).norm() > 1e-12 || math.Abs(l.Point.sub(l.Start).norm()-1.7) > 1e-12 {
					t.Fatalf("incident %+v", in)
				}
			} else if l.Start != c.Rays.Source {
				t.Fatalf("a point source's rays start at it: %+v", l.Start)
			}
			out := l.End.sub(l.Point).mul(1 / 1.7)
			if math.Abs(out.norm()-1) > 1e-12 {
				t.Fatalf("|R| = %v", out.norm())
			}
			if in.dot(s.N) >= 0 {
				t.Fatalf("a ray arrives at the lit side, against n: I·n = %v", in.dot(s.N))
			}
			if math.Abs(out.dot(s.N)+in.dot(s.N)) > 1e-12 || math.Abs(in.cross(s.N).dot(out)) > 1e-12 {
				t.Fatalf("R·n = %v, I·n = %v, coplanarity %v", out.dot(s.N), in.dot(s.N), in.cross(s.N).dot(out))
			}
			if l.Back.sub(l.Point).add(out.mul(1.7)).norm() > 1e-12 {
				t.Fatalf("the virtual extension runs back along R: %+v", l.Back)
			}
		}
	}
}

// Parallel light along a paraboloid's axis reflects through its focus, at
// 1/(2k) above the vertex, so both caustic branches collapse to that real
// point and every sample is stigmatic. Seen from behind the mirror, no
// sample is lit.
func TestParaboloidFocus(t *testing.T) {
	k := .5
	c := mirror("paraboloid", k, k, 0, -1.5, 1.5, -1.5, 1.5, 24, 24, parallel(0, -90))
	r := rayed(t, c)
	focus := Vec3{0, 0, 1 / (2 * k)}
	if r.Stigmatic != 25*25 || r.Unlit != 0 || r.Singular != 0 {
		t.Fatalf("stigmatic %d, unlit %d, singular %d", r.Stigmatic, r.Unlit, r.Singular)
	}
	for branch := 1; branch <= 2; branch++ {
		real := caustic(t, r, branch, false)
		if real.Shape != "point" || caustic(t, r, branch, true).Shape != "none" {
			t.Fatalf("branch %d: real %s, virtual %s", branch, real.Shape, caustic(t, r, branch, true).Shape)
		}
		each(real.SurfaceSheet, func(i, j int, p Vec3) {
			if p.sub(focus).norm() > 1e-12 {
				t.Fatalf("(%d, %d): %+v", i, j, p)
			}
			if real.Normals[i][j] != nil {
				t.Fatal("a stigmatic caustic point has no normal")
			}
		})
		if count(real.SurfaceSheet) != 25*25 {
			t.Fatalf("branch %d has %d points", branch, count(real.SurfaceSheet))
		}
	}
	for _, l := range r.Lines {
		if d := distanceToLine(focus, l.Point, l.End.sub(l.Point).unit()); d > 1e-12 {
			t.Fatalf("ray (%d, %d) misses the focus by %v", l.I, l.J, d)
		}
		if l.Virtual {
			t.Fatalf("ray (%d, %d) has no virtual caustic point", l.I, l.J)
		}
	}
	c.Surface.Reverse = true
	r = rayed(t, c)
	if r.Unlit != 25*25 || len(r.Lines) != 0 || r.Stigmatic != 0 {
		t.Fatalf("unlit %d, %d rays", r.Unlit, len(r.Lines))
	}
	for _, s := range r.Caustics {
		if s.Shape != "none" {
			t.Fatalf("branch %d virtual %v is %s", s.Branch, s.Virtual, s.Shape)
		}
	}
}

// Light from one focus of a prolate spheroid, seen from inside, reflects
// through the other.
func TestSpheroidFoci(t *testing.T) {
	a, cz := 1.0, 2.0
	f := math.Sqrt(cz*cz - a*a)
	c := mirror("ellipsoid", a, a, cz, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 36, 36, lamp(Vec3{0, 0, f}))
	c.Surface.Reverse = true
	r := rayed(t, c)
	// Both poles are chart singularities, 37 samples each.
	if r.Singular != 74 || r.Unlit != 0 || r.Stigmatic != 37*35 {
		t.Fatalf("singular %d, unlit %d, stigmatic %d", r.Singular, r.Unlit, r.Stigmatic)
	}
	for branch := 1; branch <= 2; branch++ {
		real := caustic(t, r, branch, false)
		if real.Shape != "point" {
			t.Fatalf("branch %d is %s", branch, real.Shape)
		}
		each(real.SurfaceSheet, func(i, j int, p Vec3) {
			if p.sub(Vec3{0, 0, -f}).norm() > 1e-12 {
				t.Fatalf("(%d, %d): %+v", i, j, p)
			}
		})
	}
	// Outward, the same light is behind the mirror everywhere.
	c.Surface.Reverse = false
	if r := rayed(t, c); r.Unlit != 37*35 || len(r.Lines) != 0 {
		t.Fatalf("unlit %d", r.Unlit)
	}
}

// A concave spherical mirror under parallel light has Coddington's focal
// distances: the tangential focus at R cos θ/2 along the reflected ray and
// the sagittal focus at R/(2 cos θ), on the axis, θ the angle of incidence.
// The tangential branch is a surface, the sagittal one the axis, a curve.
func TestSphericalMirrorCoddington(t *testing.T) {
	R := 1.3
	c := bowl(R, 36, 24, parallel(0, -90))
	r := rayed(t, c)
	tangential, sagittal := caustic(t, r, 1, false), caustic(t, r, 2, false)
	if tangential.Shape != "surface" || sagittal.Shape != "curve" {
		t.Fatalf("tangential %s, sagittal %s", tangential.Shape, sagittal.Shape)
	}
	if caustic(t, r, 1, true).Shape != "none" || caustic(t, r, 2, true).Shape != "none" {
		t.Fatal("a concave mirror under parallel light has no virtual caustic")
	}
	// The pole is a chart singularity; everything else is lit.
	if r.Singular != 37 || r.Unlit != 0 || r.Stigmatic != 0 {
		t.Fatalf("singular %d, unlit %d, stigmatic %d", r.Singular, r.Unlit, r.Stigmatic)
	}
	checked := 0
	for i := 0; i <= 36; i++ {
		for j := 1; j <= 24; j++ {
			u, v := grid(c.Surface, i, j)
			x, _, _, _, _, _ := c.Surface.patch(u, v)
			cos := -x.Z / R
			rr := Vec3{-2 * cos * x.X / R, -2 * cos * x.Y / R, 2*cos*cos - 1}
			want := [2]Vec3{x.add(rr.mul(R * cos / 2)), x.add(rr.mul(R / (2 * cos)))}
			for k, s := range []CausticSheet{tangential, sagittal} {
				p := s.Points[i][j]
				if p == nil || p.sub(want[k]).norm() > 1e-12*R {
					t.Fatalf("branch %d at (%d, %d): %+v, want %+v", k+1, i, j, p, want[k])
				}
				if n := s.Normals[i][j]; n == nil || math.Abs(n.norm()-1) > 1e-12 || math.Abs(n.dot(rr)) > 1e-12 {
					t.Fatalf("branch %d at (%d, %d): normal %+v", k+1, i, j, n)
				}
			}
			if math.Hypot(sagittal.Points[i][j].X, sagittal.Points[i][j].Y) > 1e-12 {
				t.Fatalf("the sagittal focus lies on the axis: %+v", sagittal.Points[i][j])
			}
			checked++
		}
	}
	if checked != 37*24 {
		t.Fatal(checked)
	}
	// The same light on the sphere's convex outside has a virtual caustic
	// and no real one, inside the sphere while θ is below 60°. The pole is
	// singular.
	c = mirror("ellipsoid", R, R, R, 0, 2*math.Pi, .6, math.Pi/2, 36, 24, parallel(0, -90))
	r = rayed(t, c)
	for branch := 1; branch <= 2; branch++ {
		if caustic(t, r, branch, false).Shape != "none" {
			t.Fatalf("a convex mirror under parallel light has no real caustic")
		}
		virtual := caustic(t, r, branch, true)
		if count(virtual.SurfaceSheet) != 37*24 {
			t.Fatalf("branch %d has %d virtual points", branch, count(virtual.SurfaceSheet))
		}
		each(virtual.SurfaceSheet, func(i, j int, p Vec3) {
			if p.norm() >= R {
				t.Fatalf("a virtual focus lies inside the sphere: %+v", p)
			}
		})
	}
}

// The tangential caustic of the bowl, in each meridian plane, is the
// nephroid (R/4)(3 cos θ − cos 3θ, 3 sin θ − sin 3θ), whose arc from θ₀ to θ₁
// has length 3R(cos θ₀ − cos θ₁)/2. The polygon along a sampled meridian
// converges to it at second order.
func TestCausticConverges(t *testing.T) {
	R := 1.0
	theta0, theta1 := .2, math.Pi/2-.05
	length := func(n int) float64 {
		c := bowl(R, 12, n, parallel(0, -90))
		c.Surface.VMin = theta0 - math.Pi/2
		s := caustic(t, rayed(t, c), 1, false)
		total := 0.0
		for j := 0; j < n; j++ {
			if !s.AlongV[3][j] {
				t.Fatalf("the meridian is broken at %d", j)
			}
			total += s.Points[3][j+1].sub(*s.Points[3][j]).norm()
		}
		return total
	}
	want := 1.5 * R * (math.Cos(theta0) - math.Cos(theta1))
	previous := 0.0
	for k, n := range []int{24, 48, 96, 192} {
		e := math.Abs(length(n) - want)
		if k > 0 {
			if ratio := previous / e; ratio < 3.8 || ratio > 4.2 {
				t.Fatalf("n = %d: error %v, ratio %v", n, e, ratio)
			}
		}
		previous = e
	}
	if previous > 1e-4 {
		t.Fatal(previous)
	}
}

// A plane mirror images a point source: both branches collapse to the
// virtual image behind it. Under parallel light every caustic point is at
// infinity. A sample at the source has no incident direction.
func TestPlaneMirror(t *testing.T) {
	s := Vec3{.2, -.1, 1.5}
	c := mirror("paraboloid", 0, 0, 0, -1, 1, -1, 1, 24, 24, lamp(s))
	r := rayed(t, c)
	image := Vec3{s.X, s.Y, -s.Z}
	if r.Stigmatic != 25*25 || r.Source == nil || *r.Source != s {
		t.Fatalf("stigmatic %d, source %+v", r.Stigmatic, r.Source)
	}
	for branch := 1; branch <= 2; branch++ {
		v := caustic(t, r, branch, true)
		if v.Shape != "point" || caustic(t, r, branch, false).Shape != "none" {
			t.Fatalf("branch %d: virtual %s", branch, v.Shape)
		}
		each(v.SurfaceSheet, func(i, j int, p Vec3) {
			if p.sub(image).norm() > 1e-12 {
				t.Fatalf("%+v", p)
			}
		})
	}
	for _, l := range r.Lines {
		if d := distanceToLine(image, l.Point, l.Back.sub(l.Point).unit()); d > 1e-12 {
			t.Fatalf("the virtual extension misses the image by %v", d)
		}
		if !l.Virtual {
			t.Fatalf("ray (%d, %d) has a virtual caustic point", l.I, l.J)
		}
	}
	c.Rays = parallel(30, -50)
	r = rayed(t, c)
	for _, l := range r.Lines {
		if l.Virtual {
			t.Fatal("a caustic point at infinity is not virtual")
		}
	}
	if r.Clipped[0] != 25*25 || r.Clipped[1] != 25*25 || r.Stigmatic != 25*25 || r.Source != nil {
		t.Fatalf("clipped %v, stigmatic %d", r.Clipped, r.Stigmatic)
	}
	for _, p := range r.Caustics {
		if p.Shape != "none" {
			t.Fatal(p.Shape)
		}
	}
	// The source on the mirror, at its centre sample; its light grazes the
	// rest of the plane.
	c.Rays = lamp(Vec3{})
	r = rayed(t, c)
	if r.AtSource != 1 || r.Unlit != 25*25-1 {
		t.Fatalf("at source %d, unlit %d", r.AtSource, r.Unlit)
	}
	if caustic(t, r, 1, true).Points[12][12] != nil {
		t.Fatal("the sample at the source has no caustic point")
	}
}

// Each caustic point solves det(Y_u, Y_v, R) = 0 for the ray family Y = X +
// λR, with Y's derivatives taken by central differences independent of the
// study's exact ones, and its normal is perpendicular to R and to the
// caustic's own tangents. The reflected rays form a normal congruence: the
// wavefront's shape operator has no twist.
func TestCausticResiduals(t *testing.T) {
	for _, c := range []Request{
		mirror("ellipsoid", 1.5, 1, .7, .2, 2.5, -1.2, .4, 36, 24, lamp(Vec3{.3, .2, 2})),
		mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 48, 24, parallel(25, -60)),
		mirror("paraboloid", .5, .5, 0, -1.5, 1.5, -1.5, 1.5, 24, 24, parallel(0, -70)),
		inside(mirror("cylinder", 1.4, .8, 0, 0, 2*math.Pi, -1, 1, 36, 12, lamp(Vec3{.3, -.2, .5}))),
		mirror("monkey", .4, 0, 0, -1, 1, -1, 1, 24, 24, parallel(10, -80)),
	} {
		// Reflection does not depend on the normal's sign.
		q, light := c.Surface, c.Rays
		reflected := func(u, v float64) (Vec3, Vec3) {
			x, xu, xv, _, _, _ := q.patch(u, v)
			n := xu.cross(xv).unit()
			in := light.direction()
			if light.Light == "point" {
				in = x.sub(light.Source).unit()
			}
			return x, in.sub(n.mul(2 * in.dot(n)))
		}
		r := rayed(t, c)
		checked := 0
		for _, part := range r.Caustics {
			each(part.SurfaceSheet, func(i, j int, p Vec3) {
				u, v := grid(q, i, j)
				x, d := reflected(u, v)
				lambda := p.sub(x).dot(d)
				if p.sub(x.add(d.mul(lambda))).norm() > 1e-9*(1+math.Abs(lambda)) || (lambda > 0) == part.Virtual {
					t.Fatalf("%s: (%d, %d) is off its ray, λ = %v, virtual %v", q.Kind, i, j, lambda, part.Virtual)
				}
				h := 1e-5
				y := func(u, v float64) Vec3 { x, d := reflected(u, v); return x.add(d.mul(lambda)) }
				yu := y(u+h, v).sub(y(u-h, v)).mul(1 / (2 * h))
				yv := y(u, v+h).sub(y(u, v-h)).mul(1 / (2 * h))
				if det := yu.cross(yv).dot(d); math.Abs(det) > 1e-6*(1+yu.norm()*yv.norm()) {
					t.Fatalf("%s: (%d, %d) det = %v, |Y_u| %v, |Y_v| %v", q.Kind, i, j, det, yu.norm(), yv.norm())
				}
				if n := part.Normals[i][j]; n != nil {
					if math.Abs(n.norm()-1) > 1e-12 || math.Abs(n.dot(d)) > 1e-12 {
						t.Fatalf("%s: normal %+v against R %+v", q.Kind, n, d)
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
				if s.Lit && math.Abs(s.Twist) > 1e-9*(math.Abs(s.Mu[0])+math.Abs(s.Mu[1])+1) {
					t.Fatalf("%s: (%d, %d) twist %v, μ %v", q.Kind, i, j, s.Twist, s.Mu)
				}
			}
		}
	}
}

// Branches are ordered μ₁ ≥ μ₂, μ the reflected wavefront's principal
// curvature, positive when the rays converge. On the saddle z = (x² − y²)/2
// under axial light, the rays from each row y pass through (0, 2y, ½ − y²),
// and those from each column x appear to leave (2x, 0, x² − ½): the first
// branch converges to one parabola and the second diverges from another,
// both curves. On a torus's upper half the
// first branch changes sign where the surface's curvature along its
// parallels does, and its real and virtual parts are separate sheets, never
// joined through infinity.
func TestCausticBranches(t *testing.T) {
	saddle := mirror("paraboloid", 1, -1, 0, -.6, .6, -.6, .6, 24, 24, parallel(0, -90))
	r := rayed(t, saddle)
	if caustic(t, r, 1, false).Shape != "curve" || caustic(t, r, 1, true).Shape != "none" ||
		caustic(t, r, 2, false).Shape != "none" || caustic(t, r, 2, true).Shape != "curve" {
		t.Fatalf("%s %s %s %s", caustic(t, r, 1, false).Shape, caustic(t, r, 1, true).Shape, caustic(t, r, 2, false).Shape, caustic(t, r, 2, true).Shape)
	}
	for k, want := range []func(x, y float64) Vec3{
		func(x, y float64) Vec3 { return Vec3{0, 2 * y, .5 - y*y} },
		func(x, y float64) Vec3 { return Vec3{2 * x, 0, x*x - .5} },
	} {
		part := caustic(t, r, k+1, k == 1)
		if count(part.SurfaceSheet) != 25*25 {
			t.Fatalf("branch %d has %d points", k+1, count(part.SurfaceSheet))
		}
		each(part.SurfaceSheet, func(i, j int, p Vec3) {
			if w := want(grid(saddle.Surface, i, j)); p.sub(w).norm() > 1e-12 {
				t.Fatalf("branch %d at (%d, %d): %+v, want %+v", k+1, i, j, p, w)
			}
		})
	}
	q := mirror("torus", 2, .8, 0, 0, 2*math.Pi, .05, math.Pi-.05, 36, 24, parallel(0, -90))
	r = rayed(t, q)
	real, virtual := caustic(t, r, 1, false), caustic(t, r, 1, true)
	if count(real.SurfaceSheet) == 0 || count(virtual.SurfaceSheet) == 0 || caustic(t, r, 2, false).Shape != "none" {
		t.Fatalf("%d real, %d virtual; second branch real %s", count(real.SurfaceSheet), count(virtual.SurfaceSheet), caustic(t, r, 2, false).Shape)
	}
	each(real.SurfaceSheet, func(i, j int, p Vec3) {
		if virtual.Points[i][j] != nil {
			t.Fatalf("(%d, %d) is both real and virtual", i, j)
		}
		u, v := grid(q.Surface, i, j)
		if s := q.Surface.ray(q.Rays, u, v, 1); s.Mu[0] <= 0 || s.Mu[0] < s.Mu[1] {
			t.Fatalf("(%d, %d): μ %v", i, j, s.Mu)
		}
	})
	// A ray is virtual where either of its caustic points is.
	_, scale, _ := q.Surface.positions()
	virtuals := 0
	for _, l := range r.Lines {
		u, v := grid(q.Surface, l.I, l.J)
		s := q.Surface.ray(q.Rays, u, v, scale)
		want := false
		for k := range s.Mu {
			want = want || s.Mu[k] < 0 && s.finite(k, focalReach*scale)
		}
		if l.Virtual != want {
			t.Fatalf("ray (%d, %d) virtual %v, μ %v", l.I, l.J, l.Virtual, s.Mu)
		}
		if l.Virtual {
			virtuals++
		}
	}
	if virtuals == 0 {
		t.Fatal("no virtual rays")
	}
	// A monkey saddle's flat umbilic at the centre is stigmatic, with the
	// caustic at infinity there.
	r = rayed(t, mirror("monkey", .5, 0, 0, -1, 1, -1, 1, 36, 36, parallel(0, -90)))
	if r.Stigmatic != 1 || r.Clipped[0] == 0 || r.Clipped[1] == 0 {
		t.Fatalf("stigmatic %d, clipped %v", r.Stigmatic, r.Clipped)
	}
}

// Light grazing the mirror or arriving behind it is unlit, and the caustic
// is never joined across the terminator between lit and unlit samples.
func TestRaysTerminator(t *testing.T) {
	c := mirror("ellipsoid", 1, 1, 1, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 36, 24, parallel(0, -90))
	c.Surface.Reverse = true
	r := rayed(t, c)
	// Inward normals face up on the lower half; the equator (j = 12) grazes.
	if r.Singular != 74 || r.Unlit != 37*12 {
		t.Fatalf("singular %d, unlit %d", r.Singular, r.Unlit)
	}
	for _, part := range r.Caustics {
		each(part.SurfaceSheet, func(i, j int, p Vec3) {
			if j >= 12 {
				t.Fatalf("an unlit sample (%d, %d) has a caustic point", i, j)
			}
		})
		for i := range part.AlongV {
			if part.AlongV[i][11] {
				t.Fatal("joined across the terminator")
			}
		}
	}
	for _, l := range r.Lines {
		if l.J >= 12 {
			t.Fatalf("a ray at unlit (%d, %d)", l.I, l.J)
		}
	}
}

// Light grazing the mirror is unlit even where rounding puts it a hair on
// the lit side: on a cylinder under horizontal light along x, cos u at u =
// 3π/2 rounds to −1.8·10⁻¹⁶.
func TestRaysGrazing(t *testing.T) {
	c := mirror("cylinder", 1, 1, 0, 0, 2*math.Pi, -1, 1, 12, 12, parallel(0, 0))
	if u, _ := grid(c.Surface, 9, 0); math.Cos(u) >= 0 {
		t.Fatal("the grazing sample should round onto the lit side")
	}
	// Lit where cos u < 0: columns 4 to 8.
	if r := rayed(t, c); r.Unlit != 8*13 {
		t.Fatalf("unlit %d", r.Unlit)
	}
}

// A caustic sheet is not joined across its cuspidal edge, where the sheet
// folds back on itself. Under oblique light a concave sphere's tangential
// caustic has a cusp on the meridian of the chief ray, the ray through the
// centre, which meets this bowl at u = 0, v = −π/3, halfway between samples
// 8 and 9.
func TestCausticCusp(t *testing.T) {
	c := bowl(1, 12, 24, parallel(0, -60))
	c.Surface.VMax = -math.Pi/2 + 24*math.Pi/51
	s := caustic(t, rayed(t, c), 1, false)
	if s.Points[0][8] == nil || s.Points[0][9] == nil || s.AlongV[0][8] {
		t.Fatal("the tangential caustic is joined across its cusp")
	}
	for _, j := range []int{4, 12} {
		if !s.AlongV[0][j] {
			t.Fatalf("the caustic is broken away from its cusp, at %d", j)
		}
	}
}

// Rays stand where the parameter curves cross, none at length 0; the
// bounds hold the mirror, its rays and the source, and each caustic part is
// framed on its own.
func TestRaysLinesAndBounds(t *testing.T) {
	c := mirror("paraboloid", .5, .5, 0, -1, 1, -1, 1, 24, 24, lamp(Vec3{0, 0, 3}))
	c.Surface.Curves = 5
	r := rayed(t, c)
	if len(r.UCurves) != 5 || len(r.VCurves) != 5 || len(r.Lines) != 25 {
		t.Fatalf("%v %v %d", r.UCurves, r.VCurves, len(r.Lines))
	}
	out, _ := Compute(c)
	held := []Vec3{c.Rays.Source}
	for _, l := range r.Lines {
		held = append(held, l.Start, l.Point, l.End, l.Back)
	}
	each(r.Surface, func(_, _ int, p Vec3) { held = append(held, p) })
	for _, p := range held {
		if p.sub(out.Bounds.Center).norm() > out.Bounds.Radius*(1+1e-12) {
			t.Fatalf("%+v lies outside %+v", p, out.Bounds)
		}
	}
	c.Rays.Length = 0
	if r := rayed(t, c); len(r.Lines) != 0 {
		t.Fatal(len(r.Lines))
	}
	if len(r.Caustics) != 4 {
		t.Fatal(len(r.Caustics))
	}
	for k, want := range []struct {
		branch  int
		virtual bool
	}{{1, false}, {1, true}, {2, false}, {2, true}} {
		if r.Caustics[k].Branch != want.branch || r.Caustics[k].Virtual != want.virtual {
			t.Fatalf("part %d: %d %v", k, r.Caustics[k].Branch, r.Caustics[k].Virtual)
		}
	}
}

func TestRaysValidation(t *testing.T) {
	ok := func() Request {
		return mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 36, 24, parallel(10, -45))
	}
	for _, tc := range []struct {
		change func(*Request)
		want   string
	}{
		{func(c *Request) { c.Surface.Kind = "klein" }, "unknown surface"},
		{func(c *Request) { c.Surface.USamples = 11 }, "samples"},
		{func(c *Request) { c.Surface.Curves = 49 }, "parameter curves"},
		{func(c *Request) { c.Rays.Light = "laser" }, "light"},
		{func(c *Request) { c.Rays.Azimuth = math.NaN() }, "azimuth"},
		{func(c *Request) { c.Rays.Elevation = 1e6 }, "elevation"},
		{func(c *Request) { c.Rays.Light, c.Rays.Source = "point", Vec3{0, math.Inf(1), 0} }, "source"},
		{func(c *Request) { c.Rays.Light, c.Rays.Source = "point", Vec3{2e5, 0, 0} }, "source"},
		{func(c *Request) { c.Rays.Length = -1 }, "ray length"},
		{func(c *Request) { c.Rays.Length = math.Inf(1) }, "ray length"},
	} {
		c := ok()
		tc.change(&c)
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("want %q, got %v", tc.want, err)
		}
	}
	// Neither the curve's fields nor the surface study's offset and normal
	// reach are read, and a parallel light's source is ignored.
	c := ok()
	c.Samples, c.Lines, c.Construction = 0, 0, "involute"
	c.Surface.Offset, c.Surface.Reach = math.NaN(), math.Inf(1)
	c.Rays.Source = Vec3{math.NaN(), 0, 0}
	if _, err := Compute(c); err != nil {
		t.Fatal(err)
	}
	c.Surface.USamples, c.Surface.VSamples = 240, 60
	if _, err := Compute(c); err != nil {
		t.Fatal(err)
	}
}

func TestRaysJSON(t *testing.T) {
	var c Request
	if err := json.Unmarshal([]byte(`{"format":"rays","surface":{"kind":"paraboloid","a":0.5,"b":0.5,"uMin":-1,"uMax":1,"vMin":-1,"vMax":1,"uSamples":12,"vSamples":12,"curves":3},"rays":{"interaction":"reflect","n1":1,"n2":1.5,"light":"point","azimuth":10,"elevation":-20,"source":{"x":0,"y":0,"z":2},"length":1.5,"receiver":{"plane":"none"}}}`), &c); err != nil {
		t.Fatal(err)
	}
	if want := (RaysRequest{"reflect", 1, 1.5, "point", 10, -20, Vec3{0, 0, 2}, 1.5, ReceiverRequest{Plane: "none"}}); c.Rays != want {
		t.Fatalf("%+v", c.Rays)
	}
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(out)
	for _, key := range []string{`"rays":{"surface":{"points":`, `"caustics":[{"points":`, `"branch":1,"virtual":false,"shape":`, `"lines":[{"i":0,"j":0,"start":`, `"point":`, `"end":`, `"back":`, `"virtual":`, `"uCurves":`, `"vCurves":`, `"source":{"x":0,"y":0,"z":2}`, `"singular":`, `"unlit":`, `"atSource":`, `"stigmatic":`, `"total":`, `"clipped":[`, `"receiver":null`} {
		if !strings.Contains(string(b), key) {
			t.Fatalf("missing %s", key)
		}
	}
	if strings.Contains(string(b), `"surface":{"surface"`) {
		t.Fatal("a ray study has no surface result")
	}
}
