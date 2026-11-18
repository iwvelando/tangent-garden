package engine3

import (
	"math"
	"testing"
)

// minimal is the helicoid–catenoid family at scale s and angle θ lit by
// light, admitted by the research flag (issue #397).
func minimal(s, theta, u0, u1, v0, v1 float64, nu, nv int, light RaysRequest) Request {
	light.Research = true
	return mirror("helicoid-catenoid", s, theta, 0, u0, u1, v0, v1, nu, nv, light)
}

// The family is lit only under the research flag; without it the shipped
// refusal under surface.kind stands.
func TestMinimalOpticsGate(t *testing.T) {
	c := minimal(1, .4, -2, 2, -1, 1, 24, 12, parallel(20, -60))
	c.Rays.Research = false
	if _, err := Compute(c); err == nil || fieldOf(err) != "surface.kind" {
		t.Fatalf("without the flag: %v", err)
	}
	c.Rays.Research = true
	if r := rayed(t, c); len(r.Lines) == 0 {
		t.Fatal("no rays under the flag")
	}
	// The flag admits nothing else that refuses optics.
	q := mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 24, 12, parallel(0, -60))
	q.Rays.Research = true
	if _, err := Compute(q); err != nil {
		t.Fatal(err)
	}
}

// On every member, under both lights and both normals, each representative
// ray arrives against the closed-form Gauss map and obeys the law of
// reflection or Snell's law; each caustic point is on its own ray, where
// det(Y_u, Y_v, D) vanishes by independent central differences of the
// outgoing ray, with no twist.
func TestMinimalOpticsResiduals(t *testing.T) {
	checked := 0
	for _, theta := range []float64{0, .3, math.Pi / 4, 1.2, math.Pi / 2} {
		for _, tc := range []struct {
			light   RaysRequest
			reverse bool
			n1, n2  float64
		}{
			{parallel(30, -55), false, 0, 0},
			{parallel(-70, 40), true, 0, 0},
			{lamp(Vec3{.4, -2.5, 1.2}), false, 0, 0},
			{lamp(Vec3{.2, .1, .3}), true, 1, 1.5},
			{parallel(15, -35), false, 1.5, 1},
		} {
			c := minimal(1.3, theta, -2.4, 2.1, -1.3, 1.1, 48, 24, tc.light)
			c.Surface.Reverse = tc.reverse
			c.Rays.Length = 1.7
			refract := tc.n1 > 0
			if refract {
				c = glass(c, tc.n1, tc.n2)
				c.Rays.Research = true
			}
			q, light := c.Surface, c.Rays
			r := rayed(t, c)
			if len(r.Lines) < 4 || r.Singular != 0 {
				t.Fatalf("θ %v: %d rays, %d singular", theta, len(r.Lines), r.Singular)
			}
			normal := func(u, v float64) Vec3 {
				if q.Reverse {
					return gaussMap(u, v).mul(-1)
				}
				return gaussMap(u, v)
			}
			incident := func(x Vec3) Vec3 {
				if light.Light == "point" {
					return x.sub(light.Source).unit()
				}
				return light.direction()
			}
			outgoing := func(u, v float64) (Vec3, Vec3, bool) {
				x, _, _, _, _, _ := q.patch(u, v)
				n, in := normal(u, v), incident(x)
				if !refract {
					return x, in.sub(n.mul(2 * in.dot(n))), true
				}
				d, ok := snell(in, n, tc.n1/tc.n2)
				return x, d, ok
			}
			for _, l := range r.Lines {
				u, v := grid(q, l.I, l.J)
				n, in := normal(u, v), incident(l.Point)
				if in.dot(n) >= 0 {
					t.Fatalf("θ %v: a ray arrives on the unlit side, I·n = %v", theta, in.dot(n))
				}
				d := l.End.sub(l.Point).mul(1 / 1.7)
				_, want, ok := outgoing(u, v)
				if l.Total {
					if ok {
						t.Fatalf("θ %v: (%d, %d) marked total below the critical angle", theta, l.I, l.J)
					}
					continue
				}
				if !ok || d.sub(want).norm() > 1e-12 {
					t.Fatalf("θ %v: (%d, %d) leaves along %+v, want %+v", theta, l.I, l.J, d, want)
				}
				if refract {
					if got := tc.n2 * d.cross(n).norm(); math.Abs(got-tc.n1*in.cross(n).norm()) > 1e-12 {
						t.Fatalf("θ %v: Snell's law n₂ sin θ₂ = %v", theta, got)
					}
				} else if math.Abs(d.dot(n)+in.dot(n)) > 1e-12 || math.Abs(in.cross(n).dot(d)) > 1e-12 {
					t.Fatalf("θ %v: the law of reflection fails", theta)
				}
			}
			for _, part := range r.Caustics {
				each(part.SurfaceSheet, func(i, j int, p Vec3) {
					u, v := grid(q, i, j)
					x, d, _ := outgoing(u, v)
					lambda := p.sub(x).dot(d)
					if p.sub(x.add(d.mul(lambda))).norm() > 1e-9*(1+math.Abs(lambda)) || (lambda > 0) == part.Virtual {
						t.Fatalf("θ %v: (%d, %d) off its ray, λ %v", theta, i, j, lambda)
					}
					h := 1e-5
					y := func(u, v float64) Vec3 { x, d, _ := outgoing(u, v); return x.add(d.mul(lambda)) }
					yu := y(u+h, v).sub(y(u-h, v)).mul(1 / (2 * h))
					yv := y(u, v+h).sub(y(u, v-h)).mul(1 / (2 * h))
					if det := yu.cross(yv).dot(d); math.Abs(det) > 1e-6*(1+yu.norm()*yv.norm()) {
						t.Fatalf("θ %v: (%d, %d) det %v", theta, i, j, det)
					}
					checked++
				})
			}
			for i := 0; i <= q.USamples; i++ {
				for j := 0; j <= q.VSamples; j++ {
					u, v := grid(q, i, j)
					s := q.ray(light, u, v, 1)
					if s.N.sub(normal(u, v)).norm() > 1e-12 {
						t.Fatalf("θ %v: the normal %+v is not the Gauss map", theta, s.N)
					}
					if s.traced() && math.Abs(s.Twist) > 1e-9*(math.Abs(s.Mu[0])+math.Abs(s.Mu[1])+1) {
						t.Fatalf("θ %v: twist %v", theta, s.Twist)
					}
				}
			}
		}
	}
	if checked < 2000 {
		t.Fatalf("%d caustic points", checked)
	}
}

// The catenoid under light along −z is a surface of revolution lit along
// its axis, so the plane of incidence is a meridian, a principal plane, and
// Coddington's equations hold with the closed-form curvatures: the
// meridian's κ = 1/(s cosh²v) bends toward the outward normal, so the
// tangential focus is real at s|sinh v| cosh v/2 along R, and the
// parallel's κ = −1/(s cosh²v) gives a virtual sagittal focus at
// s cosh³v/(2|sinh v|), on the axis. The outward normal is lit below the
// waist, where n tilts up.
func TestMinimalOpticsCatenoidCoddington(t *testing.T) {
	for _, s := range []float64{.01, 1, 40} {
		c := minimal(s, math.Pi/2, -math.Pi, .8*math.Pi, -2.5, 1.5, 60, 40, parallel(0, -90))
		q, light := c.Surface, c.Rays
		r := rayed(t, c)
		lit := 0
		for i := 0; i <= q.USamples; i++ {
			for j := 0; j <= q.VSamples; j++ {
				u, v := grid(q, i, j)
				p := q.ray(light, u, v, 1)
				if p.Lit != (v < -1e-9) {
					t.Fatalf("s %v: (%d, %d) at v %v lit %v", s, i, j, v, p.Lit)
				}
				if !p.Lit {
					continue
				}
				lit++
				tangential := 2 / (s * math.Abs(math.Sinh(v)) * math.Cosh(v))
				sagittal := -2 * math.Abs(math.Sinh(v)) / (s * math.Pow(math.Cosh(v), 3))
				if math.Abs(p.Mu[0]-tangential) > 1e-9*tangential || math.Abs(p.Mu[1]-sagittal) > 1e-9*math.Abs(sagittal) {
					t.Fatalf("s %v: v %v μ %v, want %v, %v", s, v, p.Mu, tangential, sagittal)
				}
				if axis := p.caustic(1); math.Hypot(axis.X, axis.Y) > 1e-9*s {
					t.Fatalf("s %v: the sagittal focus %+v is off the axis", s, axis)
				}
			}
		}
		if lit < 1000 || len(caustic(t, r, 1, false).Points) == 0 || caustic(t, r, 2, true).Shape != "curve" {
			t.Fatalf("s %v: %d lit, branch 2 %s", s, lit, caustic(t, r, 2, true).Shape)
		}
	}
}

// Under light along the axis every member is screw-symmetric: X(u + δ, v)
// is X(u, v) turned by δ about z and raised by s cos θ δ, and the normal
// turns with it, so μ does not depend on u and each caustic point is the
// screwed image of the one at the same v.
func TestMinimalOpticsScrewInvariance(t *testing.T) {
	for _, theta := range []float64{0, .5, 1.1, math.Pi / 2} {
		for _, light := range []RaysRequest{parallel(0, -90), lamp(Vec3{0, 0, 5})} {
			c := minimal(.8, theta, -3, 3, -1.4, 1.4, 60, 28, light)
			q := c.Surface
			if light.Light == "point" {
				// A lamp on the axis keeps the symmetry only with its own
				// height screwed too, so compare at equal heights below it:
				// only the catenoid, whose screw has no rise.
				if theta != math.Pi/2 {
					continue
				}
			}
			q.Reverse = theta < 1
			for j := 0; j <= q.VSamples; j++ {
				_, v := grid(q, 0, j)
				ref := q.ray(c.Rays, 0, v, 1)
				for _, u := range []float64{-2.7, -1, .6, 2.9} {
					p := q.ray(c.Rays, u, v, 1)
					if p.Lit != ref.Lit {
						t.Fatalf("θ %v: v %v lit %v at u %v, %v at 0", theta, v, p.Lit, u, ref.Lit)
					}
					if !p.traced() {
						continue
					}
					cu, su := math.Cos(u), math.Sin(u)
					screw := func(a Vec3) Vec3 {
						return Vec3{cu*a.X - su*a.Y, su*a.X + cu*a.Y, a.Z + q.A*math.Cos(theta)*u}
					}
					for k := range p.Mu {
						if math.Abs(p.Mu[k]-ref.Mu[k]) > 1e-10*(math.Abs(ref.Mu[k])+1) {
							t.Fatalf("θ %v: μ%d %v at u %v, %v at 0", theta, k+1, p.Mu[k], u, ref.Mu[k])
						}
						if math.Abs(ref.Mu[k]) > 1e-3 && p.caustic(k).sub(screw(ref.caustic(k))).norm() > 1e-9*(1+1/math.Abs(ref.Mu[k])) {
							t.Fatalf("θ %v: caustic %d at u %v is not the screwed image", theta, k+1, u)
						}
					}
				}
			}
		}
	}
}

// A half-turn of the stair, u within ±0.45π, lit straight down on the side
// its reversed normal faces, with each ray stopped at its first caustic
// point: at every angle from the helicoid to the catenoid nothing is
// shadowed, undecided or blocked, so the sample-by-sample drawing is
// exactly what first-hit semantics draw. A vertical line meets the full
// helicoid every half turn, so a span below π leaves the stair no step to
// shade another, and as the stair opens the light falls into the throat.
//
// One side of the stair, v in [0, 1.2], meets a vertical line only once a
// turn, so a ramp spanning 1.9π, lit on its upper side, is free of them
// too as it opens into a funnel.
func TestMinimalOpticsHonestStair(t *testing.T) {
	for k := 0; k <= 17; k++ {
		theta := math.Pi / 2 * float64(k%9) / 8
		c := minimal(1, theta, -.45*math.Pi, .45*math.Pi, -1.2, 1.2, 120, 60, parallel(0, -90))
		if k > 8 {
			c = minimal(1, theta, -.95*math.Pi, .95*math.Pi, 0, 1.2, 160, 40, parallel(0, -90))
		}
		c.Surface.Reverse = true
		c.Rays.Length, c.Rays.Stop = 3, true
		plain := rayed(t, c)
		c.Rays.Occlusion = true
		r := rayed(t, c)
		if r.Shadowed != 0 || r.Undecided != 0 || r.Blocked[0]+r.Blocked[1] != 0 || len(r.BlockedLines) != 0 {
			t.Fatalf("θ %v: shadowed %d, undecided %d, blocked %v, %d rays", theta, r.Shadowed, r.Undecided, r.Blocked, len(r.BlockedLines))
		}
		if len(r.Lines) != len(plain.Lines) || len(r.Caustics) != len(plain.Caustics) {
			t.Fatalf("θ %v: %d rays, %d parts against %d, %d", theta, len(r.Lines), len(r.Caustics), len(plain.Lines), len(plain.Caustics))
		}
		for k := range r.Lines {
			if r.Lines[k] != plain.Lines[k] {
				t.Fatalf("θ %v: ray %d differs", theta, k)
			}
		}
		points := 0
		for p := range r.Caustics {
			a, b := r.Caustics[p], plain.Caustics[p]
			for i := range a.Points {
				for j := range a.Points[i] {
					if (a.Points[i][j] == nil) != (b.Points[i][j] == nil) || a.Points[i][j] != nil && *a.Points[i][j] != *b.Points[i][j] {
						t.Fatalf("θ %v: caustic part %d differs at (%d, %d)", theta, p, i, j)
					}
					if a.Points[i][j] != nil {
						points++
					}
				}
			}
			for i := range a.AlongU {
				for j := range a.AlongU[i] {
					if a.AlongU[i][j] != b.AlongU[i][j] {
						t.Fatalf("θ %v: part %d joins (%d, %d) differently", theta, p, i, j)
					}
				}
			}
		}
		if points < 3000 {
			t.Fatalf("θ %v: %d caustic points", theta, points)
		}
	}
}
