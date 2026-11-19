package engine3

import (
	"fmt"
	"math"
	"slices"
	"sort"
	"strings"
	"testing"
)

// minimal is the helicoid–catenoid family at scale s and angle θ lit by
// light.
func minimal(s, theta, u0, u1, v0, v1 float64, nu, nv int, light RaysRequest) Request {
	return mirror("helicoid-catenoid", s, theta, 0, u0, u1, v0, v1, nu, nv, light)
}

// The family is offered as a mirror or interface on every admitted shape,
// domain and grid, under both lights, reflecting or refracting, with the
// shared options: the extremes of s, θ, u, v and the 14,400-cell cap.
func TestMinimalOpticsAdmitted(t *testing.T) {
	if !surfaceKinds["helicoid-catenoid"].optics {
		t.Fatal("the family does not offer optics")
	}
	for _, c := range []Request{
		minimal(1, .4, -2, 2, -1, 1, 24, 12, parallel(20, -60)),
		minimal(1e5, 0, -4*math.Pi, 4*math.Pi, -4, 4, 160, 90, parallel(0, -90)),
		minimal(1e-3, math.Pi/2, -.1, .1, 3.9, 4, 12, 12, lamp(Vec3{0, 0, -5e-2})),
		glass(minimal(1, 1.2, -math.Pi, math.Pi, -1.5, 1.5, 60, 30, parallel(30, -60)), 1, 1.5),
	} {
		c.Rays.Stop, c.Rays.Edges = true, true
		a := math.Min(c.Surface.A, 1e4)
		c.Rays.Receiver = ReceiverRequest{Plane: "z", At: -3 * a, Size: 8 * a, Bins: 32}
		if r := rayed(t, c); len(r.Lines) == 0 || r.Receiver == nil {
			t.Fatalf("θ %v s %v: %d rays, receiver %t", c.Surface.B, c.Surface.A, len(r.Lines), r.Receiver != nil)
		}
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
// screwed image of the one at the same v, reflected or refracted.
func TestMinimalOpticsScrewInvariance(t *testing.T) {
	for _, theta := range []float64{0, .5, 1.1, math.Pi / 2} {
		for _, light := range []RaysRequest{parallel(0, -90), lamp(Vec3{0, 0, 5}), glass(Request{Rays: parallel(0, -90)}, 1, 1.5).Rays, glass(Request{Rays: parallel(0, -90)}, 1.5, 1).Rays} {
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
			traced := 0
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
					traced++
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
			if traced < 12 {
				t.Fatalf("θ %v %s: %d traced", theta, light.Interaction, traced)
			}
		}
	}
}

// Every ray preset of the family is honest: at 17 evenly spaced angles over
// the family's whole range, which holds every frame of a θ motion (each
// such preset animates only θ, within [0, π/2]: see
// tests/spatial-minimal-optics.spec.ts), the first-hit oracle finds no lit
// sample, and no midpoint of a grid edge, in shadow or undecided, and no
// drawn caustic point or representative ray beyond where its outgoing
// light meets the patch again. So the sample-by-sample drawing is what
// first-hit semantics would draw. testdata/presets.json holds the presets.
func TestMinimalOpticsPresetsShadowFree(t *testing.T) {
	names := []string{}
	for name, c := range spatialPresets(t) {
		if c.Format == "rays" && c.Surface.Kind == "helicoid-catenoid" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	if !slices.Contains(names, "A half-turn mirror opening into a throat") {
		t.Fatalf("family ray presets %q lack the signature", names)
	}
	// The check fails where it should: on "A staircase becoming a
	// throat"'s longer patch lit from above, where the steps shade one
	// another; on the throat's inside under slanting light, where the far
	// wall blocks the caustic; and on the half turn with its rays running
	// on past their caustics, through the stair.
	presets := spatialPresets(t)
	long := presets["A half-turn mirror opening into a throat"]
	long.Surface.UMin, long.Surface.UMax = -.85*math.Pi, .85*math.Pi
	throat := minimal(1, math.Pi/2, -math.Pi, .9*math.Pi, -1.3, 1.6, 60, 40, parallel(0, -60))
	throat.Surface.Reverse, throat.Rays.Length = true, 4
	through := presets["A half-turn mirror opening into a throat"]
	through.Rays.Stop, through.Rays.Length = false, 8
	for _, tc := range []struct {
		c    Request
		want string
	}{{long, "in shadow"}, {throat, "beyond its block"}, {through, "past its block"}} {
		if reason := firstHitDifference(t, tc.c); !strings.Contains(reason, tc.want) {
			t.Fatalf("control: %q, want %q", reason, tc.want)
		}
	}
	for _, name := range names {
		for k := 0; k <= 16; k++ {
			c := presets[name]
			c.Surface.B = math.Pi / 2 * float64(k) / 16
			if reason := firstHitDifference(t, c); reason != "" {
				t.Errorf("%s at θ = %v: %s", name, c.Surface.B, reason)
				break
			}
		}
	}
}

// firstHitDifference says how the study's drawing would differ under
// first-hit semantics, or is empty when it would not.
func firstHitDifference(t *testing.T, c Request) string {
	t.Helper()
	q := c.Surface
	r := rayed(t, c)
	_, scale, err := q.positions()
	if err != nil {
		t.Fatal(err)
	}
	o, _ := newOccluder(q, c.Rays, scale)
	reach := focalReach * scale
	check := func(u, v float64, what string) string {
		p := q.ray(c.Rays, u, v, scale)
		s := o.apply(p, u, v)
		switch {
		case s.shadowed:
			return what + " is in shadow"
		case s.undecided:
			return what + " is undecided"
		}
		for k := range p.Mu {
			if p.traced() && p.finite(k, reach) && !s.reached(p, k) {
				return fmt.Sprintf("%s's caustic %d lies beyond its block at %v", what, k+1, s.block)
			}
		}
		return ""
	}
	for i := 0; i <= q.USamples; i++ {
		for j := 0; j <= q.VSamples; j++ {
			u, v := grid(q, i, j)
			if reason := check(u, v, fmt.Sprintf("sample (%d, %d)", i, j)); reason != "" {
				return reason
			}
			if i < q.USamples {
				u1, _ := grid(q, i+1, j)
				if reason := check((u+u1)/2, v, fmt.Sprintf("the midpoint after (%d, %d) along u", i, j)); reason != "" {
					return reason
				}
			}
			if j < q.VSamples {
				_, v1 := grid(q, i, j+1)
				if reason := check(u, (v+v1)/2, fmt.Sprintf("the midpoint after (%d, %d) along v", i, j)); reason != "" {
					return reason
				}
			}
		}
	}
	for _, l := range r.Lines {
		u, v := grid(q, l.I, l.J)
		p := q.ray(c.Rays, u, v, scale)
		if s := o.apply(p, u, v); s.blocked && l.End.sub(l.Point).norm() >= s.block {
			return fmt.Sprintf("the ray from (%d, %d) runs %v, past its block at %v", l.I, l.J, l.End.sub(l.Point).norm(), s.block)
		}
	}
	return ""
}

// axialMu is μ₁ ≥ μ₂ of the light the family reflects from a beam down
// its axis: R depends on the Gauss map alone, the same at every angle, and
// det(X_u + R_u/μ, X_v + R_v/μ, R) = 0 reduces to
// s sinh v cosh³v μ² + 2 sin θ μ − 4 tanh v/s = 0, so μ = (−sin θ ±
// √(sin²θ + sinh²2v))/(s sinh v cosh³v) (docs/mathematics.md, Spatial
// minimal surfaces), on either side. A beam up the axis reflects along −R,
// the same lines, so with −μ.
func axialMu(s, theta, v float64, up bool) [2]float64 {
	d := s * math.Sinh(v) * math.Pow(math.Cosh(v), 3)
	if up {
		d = -d
	}
	r := math.Hypot(math.Sin(theta), math.Sinh(2*v))
	a, b := (-math.Sin(theta)+r)/d, (-math.Sin(theta)-r)/d
	return [2]float64{math.Max(a, b), math.Min(a, b)}
}

// Under light along the axis every lit sample's μ is the closed form, at
// every angle, scale, normal and direction, and no caustic has a cuspidal
// edge: the fold μ² R·C_w has one sign wherever v ≠ 0 below the catenoid
// (the mathematics guide proves it), and at θ = π/2 the branch that would
// fold has collapsed onto the axis, a curve with no edges. The half turn
// of "A half-turn mirror opening into a throat" is checked at 17 angles.
func TestMinimalOpticsAxialCaustics(t *testing.T) {
	for _, s := range []float64{.5, 3} {
		for _, light := range []RaysRequest{parallel(0, -90), parallel(40, 90)} {
			for _, reverse := range []bool{false, true} {
				for k := 0; k <= 16; k++ {
					theta := math.Pi / 2 * float64(k) / 16
					c := withCausticEdges(minimal(s, theta, -.45*math.Pi, .45*math.Pi, -1.2, 1.2, 120, 60, light))
					c.Surface.Reverse = reverse
					q := c.Surface
					r := rayed(t, c)
					if r.Edges == nil || len(*r.Edges) != 0 {
						t.Fatalf("s %v θ %v: %d cuspidal edges", s, theta, len(*r.Edges))
					}
					traced := 0
					for i := 0; i <= q.USamples; i++ {
						for j := 0; j <= q.VSamples; j++ {
							u, v := grid(q, i, j)
							p := q.ray(c.Rays, u, v, 1)
							if !p.traced() {
								continue
							}
							traced++
							want := axialMu(s, theta, v, light.Elevation > 0)
							for b := range 2 {
								if math.Abs(p.Mu[b]-want[b]) > 1e-10*(math.Abs(want[0])+math.Abs(want[1])) {
									t.Fatalf("s %v θ %v v %v: μ %v, want %v", s, theta, v, p.Mu, want)
								}
							}
						}
					}
					if traced < 3000 {
						t.Fatalf("s %v θ %v: %d traced", s, theta, traced)
					}
					if k == 16 {
						// At the catenoid one branch's foci all lie on the
						// axis: a curve, with no edges. The other is a
						// surface.
						shapes := map[bool]string{}
						for _, part := range r.Caustics {
							each(part.SurfaceSheet, func(_, _ int, p Vec3) {
								shapes[math.Hypot(p.X, p.Y) < 1e-9*s] = part.Shape
							})
						}
						if shapes[true] != "curve" || shapes[false] != "surface" {
							t.Fatalf("s %v: at the catenoid the axis branch is a %q, the other a %q", s, shapes[true], shapes[false])
						}
					}
				}
			}
		}
	}
}

// Under slanting light, reflected and refracted, the family's caustics do
// fold, and every point of every edge is a root of the fold on its own
// caustic, by independent differences.
func TestMinimalOpticsCuspidalEdges(t *testing.T) {
	for _, c := range []Request{
		minimal(1, .7, -.45*math.Pi, .45*math.Pi, -1.2, 1.2, 120, 60, parallel(30, -60)),
		glass(minimal(1, 1.2, -.45*math.Pi, .45*math.Pi, -1.2, 0, 120, 60, parallel(180, -60)), 1, 1.5),
	} {
		checkEdgeFolds(t, c)
	}
}

// A receiver over the half turn under light down the axis accounts for
// every unit of flux, and the flux emitted is the lit patch's area
// projected across the beam: |(X_u × X_v)·z| = s² sinh v cosh v at every
// angle (the family shares its Gauss map and metric), so s² Δu sinh²(1.2)/2
// for the lit half v in (0, 1.2], whatever θ.
func TestMinimalOpticsReceiver(t *testing.T) {
	for _, theta := range []float64{0, .7, math.Pi / 2} {
		for _, rc := range [][2]float64{{-3, 6}, {2.5, 8}} {
			c := minimal(1, theta, -.45*math.Pi, .45*math.Pi, -1.2, 1.2, 120, 60, parallel(0, -90))
			c.Surface.Reverse = true
			c = receive(c, "z", rc[0], 0, 0, rc[1], 64)
			g := received(t, c)
			accounted(t, g)
			want := .9 * math.Pi * math.Pow(math.Sinh(1.2), 2) / 2
			// Rays leave downward below v = atanh(1/√2), where R_z =
			// 2 tanh²v − 1 changes sign, so the lower plane gets most.
			if math.Abs(g.Emitted-want) > 1e-3*want || !(g.Received > .01*g.Emitted) {
				t.Fatalf("θ %v plane z = %v: emitted %v, want %v; received %v", theta, rc[0], g.Emitted, want, g.Received)
			}
		}
	}
}

// The light probe on the family: over the grid, each traced sample is the
// outgoing wavefront's own probe, its foci the caustics' points; between
// samples, under light down the axis on the reversed side, the normal is
// the reversed Gauss map, the ray the reflection, and μ the closed form at
// that v, at every angle.
func TestMinimalOpticsLightProbe(t *testing.T) {
	for _, c := range rayPointStudies() {
		if c.Surface.Kind == "helicoid-catenoid" {
			d, r := probeLight(t, c)
			checkWavefront(t, d, r)
		}
	}
	for _, theta := range []float64{0, .7, math.Pi / 2} {
		c := minimal(1.5, theta, -.45*math.Pi, .45*math.Pi, -1.2, 1.2, 24, 12, parallel(0, -90))
		c.Surface.Reverse = true
		for _, at := range [][2]float64{{.123, .456}, {-1.3, 1.17}, {.9, .031}} {
			_, d := lightPointProbed(t, c, at[0], at[1])
			u, v := at[0], at[1]
			n := gaussMap(u, v).mul(-1)
			rr := Vec3{0, 0, -1}.sub(n.mul(2 * -n.Z))
			if !within(*d.Light.Surface[0][0], n, 1e-12) || !within(*d.Light.Outgoing[0][0], rr, 1e-12) {
				t.Fatalf("θ %v (%g, %g): normal %v, ray %v", theta, u, v, *d.Light.Surface[0][0], *d.Light.Outgoing[0][0])
			}
			want := axialMu(1.5, theta, v, false)
			for k := range 2 {
				mu := *d.Curvature[k][0][0]
				if math.Abs(mu-want[k]) > 1e-10*(math.Abs(want[0])+math.Abs(want[1])) {
					t.Fatalf("θ %v (%g, %g): μ%d %v, want %v", theta, u, v, k+1, mu, want[k])
				}
				if f := d.Focal[k][0][0]; f != nil && !within(*f, d.Points[0][0].add(rr.mul(1/mu)), 1e-9*(1+f.norm())) {
					t.Fatalf("θ %v (%g, %g): focus %d off the ray", theta, u, v, k+1)
				}
			}
		}
	}
}
