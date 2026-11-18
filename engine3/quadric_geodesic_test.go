package engine3

import (
	"errors"
	"math"
	"testing"
)

// Geodesic threads on ellipsoids and paraboloids, checked against routes
// and conserved quantities written out here rather than read from the
// engine: great circles at equal axes, Joachimsthal's integral, Clairaut's
// relation on surfaces of revolution, the principal sections, the umbilic
// fan's reconvergence, a plane's straight lines, a parabolic cylinder's
// unrolled lines and a saddle's rulings, all observed in the returned
// points and tangents.

// ellipsoid is the study of the ellipsoid of semi-axes a, b and c over its
// whole chart.
func ellipsoid(a, b, c float64) Request {
	return surfaceStudy("ellipsoid", a, b, c, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 24, 24)
}

// paraboloid is the study of z = (k₁u² + k₂v²)/2 over [u0, u1] × [v0, v1].
func paraboloid(k1, k2, u0, u1, v0, v1 float64) Request {
	return surfaceStudy("paraboloid", k1, k2, 0, u0, u1, v0, v1, 24, 24)
}

// ellipsePerimeter is the perimeter of the ellipse of semi-axes a and b, by
// the trapezoid rule over a whole period, which converges geometrically
// for a smooth periodic integrand.
func ellipsePerimeter(a, b float64) float64 {
	const n = 4096
	sum := 0.0
	for k := 0; k < n; k++ {
		x := 2 * math.Pi * float64(k) / n
		sum += math.Hypot(a*math.Sin(x), b*math.Cos(x))
	}
	return sum * 2 * math.Pi / n
}

// joachimsthal is (X·W²X)(T·WT), W = diag(1/a², 1/b², 1/c²): the product
// of the squared reciprocals of the distance from the center to the
// tangent plane and of the semi-diameter along T, constant along every
// geodesic of the ellipsoid.
func joachimsthal(a, b, c float64, x, tg Vec3) float64 {
	w := Vec3{1 / (a * a), 1 / (b * b), 1 / (c * c)}
	return (x.X*x.X*w.X*w.X + x.Y*x.Y*w.Y*w.Y + x.Z*x.Z*w.Z*w.Z) *
		(tg.X*tg.X*w.X + tg.Y*tg.Y*w.Y + tg.Z*tg.Z*w.Z)
}

// onEllipsoid checks every sample lies on the ellipsoid with a unit
// tangent in its tangent plane, and that Joachimsthal's integral keeps its
// first value, each to tol.
func onEllipsoid(t *testing.T, what string, a, b, c float64, th GeodesicThread, tol float64) {
	t.Helper()
	j0 := joachimsthal(a, b, c, th.Points[0], th.Tangents[0])
	for k, p := range th.Points {
		tg := th.Tangents[k]
		f := p.X*p.X/(a*a) + p.Y*p.Y/(b*b) + p.Z*p.Z/(c*c)
		n := Vec3{p.X / (a * a), p.Y / (b * b), p.Z / (c * c)}
		if math.Abs(f-1) > tol || math.Abs(tg.norm()-1) > tol || math.Abs(tg.dot(n))/n.norm() > tol {
			t.Fatalf("%s: sample %d: F − 1 = %.3g, |T| − 1 = %.3g, T·n = %.3g", what, k, f-1, tg.norm()-1, tg.dot(n)/n.norm())
		}
		if j := joachimsthal(a, b, c, p, tg); math.Abs(j-j0) > tol*j0 {
			t.Fatalf("%s: sample %d: Joachimsthal's integral %.15g drifts from %.15g", what, k, j, j0)
		}
	}
}

// An ellipsoid with unequal axes carries threads over its whole surface.
// At equal axes the same integration draws the exact great circles.
func TestEllipsoidGeodesicsAtEqualAxes(t *testing.T) {
	const r = 1.3
	for _, at := range []struct{ u, v, beta float64 }{{0.3, 0.2, 35}, {2, -1.1, 120}, {4, math.Pi / 2, 10}} {
		q := launch(sphere(r, 24, 24), at.u, at.v, at.beta, 0, 1, 9, 300)
		g := *q.Surface.Geodesics
		exact := sphereThread(r, g, at.beta)
		th := q.Surface.ellipsoidThread(g, at.beta, maxGeodesicSteps)
		if th.Reason != "end" || len(th.Points) != len(exact.Points) {
			t.Fatalf("%+v: %s with %d points", at, th.Reason, len(th.Points))
		}
		for k := range th.Points {
			nearVec(t, "point", th.Points[k], exact.Points[k], 1e-9*r)
			nearVec(t, "tangent", th.Tangents[k], exact.Tangents[k], 1e-9)
		}
	}
	// A sphere still takes its exact path; unequal axes are integrated.
	if g := threads(t, launch(sphere(r, 24, 24), 0, 0, 0, 0, 1, 1, 10)); g.Surface != "sphere" || g.Steps != 0 {
		t.Fatalf("a sphere: %q in %d steps", g.Surface, g.Steps)
	}
	g := threads(t, launch(ellipsoid(1.4, 1, 0.7), 0, 0, 30, 60, 4, 20, 400))
	if g.Surface != "ellipsoid" || g.Unavailable != "" || len(g.Threads) != 4 || g.Steps == 0 {
		t.Fatalf("an ellipsoid: %q (%s) with %d threads in %d steps", g.Surface, g.Unavailable, len(g.Threads), g.Steps)
	}
	for _, th := range g.Threads {
		if th.Reason != "end" || th.Reached != 20 || len(th.Points) != 401 {
			t.Fatalf("thread at %g: %s at %g with %d points", th.Direction, th.Reason, th.Reached, len(th.Points))
		}
	}
}

// Every ellipsoid thread stays on the surface at unit speed and keeps
// Joachimsthal's integral; on a spheroid it also keeps Clairaut's (X × T)·ẑ.
func TestEllipsoidGeodesicInvariants(t *testing.T) {
	for _, s := range []struct{ a, b, c float64 }{{1.4, 1, 0.7}, {0.6, 1.9, 1.1}, {1, 1, 0.4}, {0.5, 0.5, 2}} {
		for _, at := range []struct{ u, v, beta float64 }{{0.3, 0.2, 35}, {2, -1.4, 120}, {4, math.Pi / 2, -60}, {1, 0.9, 89}} {
			what := "ellipsoid"
			th := threads(t, launch(ellipsoid(s.a, s.b, s.c), at.u, at.v, at.beta, 0, 1, 80, 2000)).Threads[0]
			if th.Reason != "end" {
				t.Fatalf("%+v %+v: %s at %g", s, at, th.Reason, th.Reached)
			}
			onEllipsoid(t, what, s.a, s.b, s.c, th, 1e-8)
			if s.a == s.b {
				c0 := th.Points[0].cross(th.Tangents[0]).Z
				for k, p := range th.Points {
					if c := p.cross(th.Tangents[k]).Z; math.Abs(c-c0) > 1e-8*s.a {
						t.Fatalf("%+v %+v: sample %d: Clairaut's constant %.12g drifts from %.12g", s, at, k, c, c0)
					}
				}
			}
		}
	}
}

// The three principal sections are geodesics: a thread launched along one
// stays in its plane, over the poles where the section passes them, and
// returns after the perimeter of its ellipse.
func TestEllipsoidPrincipalSections(t *testing.T) {
	const a, b, c = 1.5, 1.1, 0.6
	for _, s := range []struct {
		name     string
		u, beta  float64
		p, q     float64
		inPlane  func(Vec3) float64
		overPole bool
	}{
		{"equator", 0.4, 0, a, b, func(x Vec3) float64 { return x.Z }, false},
		{"xz", 0, 90, a, c, func(x Vec3) float64 { return x.Y }, true},
		{"yz", math.Pi / 2, 90, b, c, func(x Vec3) float64 { return x.X }, true},
	} {
		L := ellipsePerimeter(s.p, s.q)
		th := threads(t, launch(ellipsoid(a, b, c), s.u, 0, s.beta, 0, 1, L, 1000)).Threads[0]
		if th.Reason != "end" || !th.Closes {
			t.Fatalf("%s: %s, returns %+v after the perimeter %g", s.name, th.Reason, th.Return, L)
		}
		top := 0.0
		for k, p := range th.Points {
			if d := math.Abs(s.inPlane(p)); d > 1e-9 {
				t.Fatalf("%s: sample %d leaves the plane by %.3g", s.name, k, d)
			}
			top = math.Max(top, p.Z)
		}
		if s.overPole && math.Abs(top-c) > 1e-6 {
			t.Fatalf("%s: rises to %g, not over the pole %g", s.name, top, c)
		}
		onEllipsoid(t, s.name, a, b, c, th, 1e-9)
		// Short of the perimeter it has not returned.
		short := threads(t, launch(ellipsoid(a, b, c), s.u, 0, s.beta, 0, 1, 0.999*L, 1000)).Threads[0]
		if short.Closes {
			t.Fatalf("%s: returns at 0.999 of its perimeter", s.name)
		}
	}
}

// Every geodesic from an umbilic of a three-axis ellipsoid passes through
// the opposite umbilic, all after the same length: half the perimeter of
// the principal ellipse through them. With a² − b² = b² − c² the umbilics
// lie at latitude π/4 on the meridian u = 0.
func TestEllipsoidUmbilicFan(t *testing.T) {
	a, b, c := math.Sqrt(7), 2.0, 1.0
	half := ellipsePerimeter(a, c) / 2
	umbilic := Vec3{a * math.Sqrt((a*a-b*b)/(a*a-c*c)), 0, c * math.Sqrt((b*b-c*c)/(a*a-c*c))}
	g := threads(t, launch(ellipsoid(a, b, c), 0, math.Pi/4, 0, 360, 24, half, 600))
	for _, th := range g.Threads {
		nearVec(t, "start", th.Points[0], umbilic, 1e-12)
		nearVec(t, "the opposite umbilic", th.End, umbilic.mul(-1), 1e-8)
		onEllipsoid(t, "umbilic fan", a, b, c, th, 1e-9)
		// Midway it is still far from either umbilic, except along the
		// principal section.
		mid := th.Points[300]
		if math.Abs(mid.Y) > 1e-6 && (mid.sub(umbilic).norm() < 0.5 || mid.add(umbilic).norm() < 0.5) {
			t.Fatalf("thread at %g is near an umbilic halfway", th.Direction)
		}
	}
}

// A launch at a pole runs along meridian u₀'s limiting directions: from
// the north pole with u₀ = 0, β = 0 heads along +y (the yz section) and
// β = 90° along −x (the xz section), each over the south pole.
func TestEllipsoidPoleLaunch(t *testing.T) {
	const a, b, c = 1.5, 1.1, 0.6
	for _, s := range []struct {
		beta float64
		dir  Vec3
		p    float64
	}{{0, Vec3{0, 1, 0}, b}, {90, Vec3{-1, 0, 0}, a}, {-90, Vec3{1, 0, 0}, a}} {
		L := ellipsePerimeter(s.p, c)
		th := threads(t, launch(ellipsoid(a, b, c), 0, math.Pi/2, s.beta, 0, 1, L, 1000)).Threads[0]
		nearVec(t, "the pole", th.Points[0], Vec3{0, 0, c}, 1e-15)
		nearVec(t, "the first direction", th.Tangents[0], s.dir, 1e-15)
		nearVec(t, "the south pole", th.Points[500], Vec3{0, 0, -c}, 1e-8)
		if !th.Closes {
			t.Fatalf("β = %g: returns %+v", s.beta, th.Return)
		}
	}
	var fe *FieldError
	if _, err := Compute(launch(ellipsoid(a, b, c), 0, 1.6, 0, 0, 1, 1, 10)); !errors.As(err, &fe) || fe.Field != "surface.geodesics.v" {
		t.Fatalf("a latitude beyond the pole: %v", err)
	}
}

// Tightening the tolerance makes a long winding thread's end converge,
// with more steps.
func TestEllipsoidGeodesicConvergence(t *testing.T) {
	defer func(saved float64) { geodesicTolerance = saved }(geodesicTolerance)
	study := launch(ellipsoid(1.4, 1, 0.5), 0.2, 0.3, 50, 0, 1, 60, 600)
	geodesicTolerance = 1e-14
	ref := threads(t, study).Threads[0]
	last, steps := math.Inf(1), 0
	for _, tol := range []float64{1e-6, 1e-8, 1e-10, 1e-12} {
		geodesicTolerance = tol
		th := threads(t, study).Threads[0]
		e := math.Max(th.End.sub(ref.End).norm(), th.EndTangent.sub(ref.EndTangent).norm())
		t.Logf("tolerance %g: %d steps, end error %.3g", tol, th.Steps, e)
		if !(e < last/20) || th.Steps <= steps {
			t.Fatalf("tolerance %g: end error %.3g after %d steps does not improve on %.3g after %d", tol, e, th.Steps, last, steps)
		}
		last, steps = e, th.Steps
	}
	if last > 1e-9 {
		t.Fatalf("the finest tolerance leaves an end error of %.3g", last)
	}
}

// The shortest semi-axis must be at least 1% of the longest; a flatter or
// thinner ellipsoid reports its threads unavailable. At the bound the
// threads stay on the surface, and keep Joachimsthal's integral to 10⁻⁶
// (measured about 10⁻⁷ over 6 units, where the rim bends 10⁴ times more
// sharply than the ellipsoid's size). An arrow is carried along a thread
// on any ellipsoid.
func TestEllipsoidGeodesicLimits(t *testing.T) {
	for _, s := range [][3]float64{{1, 1, 0.0099}, {100, 0.99, 50}, {0.0099, 1, 1}} {
		g := threads(t, launch(ellipsoid(s[0], s[1], s[2]), 0, 0, 30, 0, 1, 5, 100))
		if g.Unavailable == "" || len(g.Threads) != 0 {
			t.Fatalf("%v: should be unavailable", s)
		}
	}
	for _, s := range [][3]float64{{1, 1, 0.01}, {1, 0.01, 0.01}} {
		g := threads(t, launch(ellipsoid(s[0], s[1], s[2]), 0.3, 0.2, 40, 360, 8, 6, 600))
		if g.Unavailable != "" {
			t.Fatalf("%v: %s", s, g.Unavailable)
		}
		t.Logf("%v: a fan of 8 threads, 6 long, in %d steps", s, g.Steps)
		for _, th := range g.Threads {
			if th.Reason != "end" {
				t.Fatalf("%v: thread at %g: %s at %g", s, th.Direction, th.Reason, th.Reached)
			}
			onEllipsoid(t, "at the bound", s[0], s[1], s[2], th, 1e-6)
		}
	}
	// An arrow is carried along the thread (see route_transport_test.go).
	g := threads(t, carry(launch(ellipsoid(1.4, 1, 0.7), 0, 0, 30, 0, 1, 5, 100), "thread", 90, 4))
	if g.Transport == nil || g.Transport.Unavailable != "" || len(g.Threads) != 1 || len(g.Threads[0].Points) != 101 || len(g.Transport.Samples.Points) != 101 {
		t.Fatal("the arrow should be carried along the thread")
	}
}

// A paraboloid's threads run within its patch: on a plane they are
// straight lines, leaving where the line meets the edge.
func TestPlaneGeodesicsAreStraight(t *testing.T) {
	for _, at := range []struct{ u, v, beta float64 }{{0, 0, 30}, {0.4, -0.7, 200}, {-1, 0.2, 0}, {0.3, 1, -45}} {
		const L = 10.0
		g := threads(t, launch(paraboloid(0, 0, -1, 2, -1, 1), at.u, at.v, at.beta, 0, 1, L, 500))
		if g.Surface != "paraboloid" {
			t.Fatalf("%+v: %q (%s)", at, g.Surface, g.Unavailable)
		}
		th := g.Threads[0]
		b := at.beta * math.Pi / 180
		dir := Vec3{math.Cos(b), math.Sin(b), 0}
		// The first edge the line heads out through.
		exit, edge := math.Inf(1), ""
		for _, e := range []struct {
			name      string
			s, toward float64
		}{
			{"uMin", (-1 - at.u) / dir.X, -dir.X}, {"uMax", (2 - at.u) / dir.X, dir.X},
			{"vMin", (-1 - at.v) / dir.Y, -dir.Y}, {"vMax", (1 - at.v) / dir.Y, dir.Y},
		} {
			if e.toward > 1e-12 && e.s >= 0 && e.s < exit {
				exit, edge = e.s, e.name
			}
		}
		if th.Reason != "edge" || th.Edge != edge || math.Abs(th.Reached-exit) > 1e-12 {
			t.Fatalf("%+v: %s on %q at %g, want %s at %g", at, th.Reason, th.Edge, th.Reached, edge, exit)
		}
		samplesThrough(t, "plane", th, g.Step)
		for k, p := range th.Points {
			s := float64(k) * g.Step
			nearVec(t, "point", p, Vec3{at.u, at.v, 0}.add(dir.mul(s)), 1e-12)
			nearVec(t, "tangent", th.Tangents[k], dir, 1e-12)
		}
		nearVec(t, "exit", th.End, Vec3{at.u, at.v, 0}.add(dir.mul(exit)), 1e-12)
	}
}

// A parabolic cylinder z = ku²/2 is flat: unrolled by the arc length of
// its profile, σ(u) = (u√(1 + k²u²) + asinh(ku)/k)/2, against v, each
// thread is a straight line.
func TestParabolicCylinderGeodesicsUnroll(t *testing.T) {
	const k = 1.7
	sigma := func(u float64) float64 { return (u*math.Sqrt(1+k*k*u*u) + math.Asinh(k*u)/k) / 2 }
	for _, at := range []struct{ u, v, beta float64 }{{-1, 0, 20}, {0.5, -1.5, 80}, {1.2, 1, -150}} {
		g := threads(t, launch(paraboloid(k, 0, -1.5, 1.5, -2, 2), at.u, at.v, at.beta, 0, 1, 12, 1200))
		th := g.Threads[0]
		if th.Reason != "edge" {
			t.Fatalf("%+v: %s at %g", at, th.Reason, th.Reached)
		}
		b := at.beta * math.Pi / 180
		for i, p := range th.Points {
			s := float64(i) * g.Step
			if math.Abs(sigma(p.X)-sigma(at.u)-s*math.Cos(b)) > 1e-9 || math.Abs(p.Y-at.v-s*math.Sin(b)) > 1e-9 || math.Abs(p.Z-k*p.X*p.X/2) > 1e-12 {
				t.Fatalf("%+v: sample %d at s = %g unrolls to (%g, %g), want (%g, %g)", at, i, s, sigma(p.X)-sigma(at.u), p.Y-at.v, s*math.Cos(b), s*math.Sin(b))
			}
		}
	}
}

// The saddle z = (u² − v²)/2 holds two families of straight lines,
// u ∓ v = const; a thread launched along one stays on it, a straight line
// in space, while its neighbors bend away. Off the rulings, the threads
// stay unit and tangent.
func TestSaddleRulingsAreGeodesics(t *testing.T) {
	for _, at := range []struct{ u, v float64 }{{0, 0}, {0.3, -0.2}, {-0.5, 0.4}} {
		for _, sign := range []float64{1, -1} {
			// Along (1, sign, u₀ − sign v₀)/norm, the ruling through the start.
			dir := Vec3{1, sign, at.u - sign*at.v}
			dir = dir.mul(1 / dir.norm())
			// β from unit X_u = (1, 0, u)/|·| toward the perpendicular on
			// X_v's side.
			xu := Vec3{1, 0, at.u}
			eu := xu.mul(1 / xu.norm())
			xv := Vec3{0, 1, -at.v}
			side := xv.sub(eu.mul(xv.dot(eu)))
			side = side.mul(1 / side.norm())
			beta := math.Atan2(dir.dot(side), dir.dot(eu)) * 180 / math.Pi
			g := threads(t, launch(paraboloid(1, -1, -1, 1, -1, 1), at.u, at.v, beta, 0, 1, 5, 500))
			th := g.Threads[0]
			if th.Reason != "edge" {
				t.Fatalf("%+v: %s", at, th.Reason)
			}
			start := Vec3{at.u, at.v, (at.u*at.u - at.v*at.v) / 2}
			for k, p := range th.Points {
				nearVec(t, "a ruling's point", p, start.add(dir.mul(float64(k)*g.Step)), 1e-10)
			}
			nearVec(t, "a ruling's end", th.End, start.add(dir.mul(th.Reached)), 1e-10)
			// A neighbor 5° away leaves the ruling.
			near := threads(t, launch(paraboloid(1, -1, -1, 1, -1, 1), at.u, at.v, beta+5, 0, 1, 5, 500)).Threads[0]
			last := near.Points[len(near.Points)-1]
			off := last.sub(start)
			off = off.sub(dir.mul(off.dot(dir)))
			if off.norm() < 1e-3 {
				t.Fatalf("%+v: a neighbor stays on the ruling", at)
			}
		}
	}
}

// On a paraboloid of revolution z = k(u² + v²)/2, Clairaut's (X × T)·ẑ is
// constant along every thread; a meridian (through the axis) stays in its
// plane, even where the patch is steep. Off the axes of symmetry, every
// thread stays on the surface at unit speed.
func TestParaboloidGeodesicInvariants(t *testing.T) {
	for _, k := range []float64{0.8, -2.5} {
		for _, at := range []struct{ u, v, beta float64 }{{0.6, 0.1, 100}, {-0.4, 0.7, 10}, {0.9, -0.9, 200}} {
			th := threads(t, launch(paraboloid(k, k, -3, 3, -3, 3), at.u, at.v, at.beta, 0, 1, 40, 2000)).Threads[0]
			c0 := th.Points[0].cross(th.Tangents[0]).Z
			for i, p := range th.Points {
				if c := p.cross(th.Tangents[i]).Z; math.Abs(c-c0) > 1e-9 {
					t.Fatalf("k = %g %+v: sample %d: Clairaut's constant %.12g drifts from %.12g", k, at, i, c, c0)
				}
			}
		}
	}
	// Steep patches: slopes reach about 10⁴ and 10⁵ at the edges. The diagonal
	// meridian u = v of the paraboloid of revolution keeps to its plane and
	// leaves at the arc length ∫√(2 + 4k²t²) dt of its profile.
	for _, k := range []float64{1e4, 1e5} {
		profile := func(t float64) float64 {
			m := 2 * k * t
			return (t*math.Sqrt(2+m*m) + 2*math.Asinh(m/math.Sqrt2)/(2*k)) / 2
		}
		g := threads(t, launch(paraboloid(k, k, -1, 0.5, -2, 2), 0, 0, 45, 0, 1, 1e5, 4000))
		th := g.Threads[0]
		want := profile(0.5)
		if th.Reason != "edge" || th.Edge != "uMax" || math.Abs(th.Reached-want) > 1e-9*want {
			t.Fatalf("k = %g: %s on %q at %.12g, want uMax at %.12g", k, th.Reason, th.Edge, th.Reached, want)
		}
		for i, p := range th.Points {
			tg := th.Tangents[i]
			n := Vec3{-k * p.X, -k * p.Y, 1}
			if math.Abs(p.X-p.Y) > 1e-12 || math.Abs(tg.norm()-1) > 1e-9 || math.Abs(tg.dot(n))/n.norm() > 1e-9 {
				t.Fatalf("k = %g: sample %d at (%g, %g), |T| − 1 = %.3g, T·n = %.3g", k, i, p.X, p.Y, tg.norm()-1, tg.dot(n)/n.norm())
			}
		}
		// An oblique thread on the steep patch stays unit and tangent.
		oblique := threads(t, launch(paraboloid(k, -k/3, -1, 1, -1, 1), 0.2, 0.1, 70, 0, 1, 1e5, 4000)).Threads[0]
		for i, p := range oblique.Points {
			tg := oblique.Tangents[i]
			n := Vec3{-k * p.X, k / 3 * p.Y, 1}
			if math.Abs(p.Z-(k*p.X*p.X-k/3*p.Y*p.Y)/2) > 1e-12*k || math.Abs(tg.norm()-1) > 1e-9 || math.Abs(tg.dot(n))/n.norm() > 1e-9 {
				t.Fatalf("k = %g oblique: sample %d: |T| − 1 = %.3g, T·n = %.3g", k, i, tg.norm()-1, tg.dot(n)/n.norm())
			}
		}
	}
}

// A paraboloid thread starts within the patch; an arrow is carried along
// it to the edge.
func TestParaboloidGeodesicLimits(t *testing.T) {
	var fe *FieldError
	if _, err := Compute(launch(paraboloid(1, -1, -1, 1, -1, 1), 1.2, 0, 0, 0, 1, 1, 10)); !errors.As(err, &fe) || fe.Field != "surface.geodesics.u" {
		t.Fatalf("a start beyond the patch: %v", err)
	}
	// An arrow is carried along the thread to the edge (see
	// route_transport_test.go).
	g := threads(t, carry(launch(paraboloid(1, -1, -1, 1, -1, 1), 0, 0, 30, 0, 1, 5, 100), "thread", 90, 4))
	if tr := g.Transport; tr == nil || tr.Unavailable != "" || len(g.Threads) != 1 || tr.Reason != "edge" || tr.Edge != g.Threads[0].Edge {
		t.Fatalf("the arrow should be carried along the thread to its edge: %+v", tr)
	}
}
