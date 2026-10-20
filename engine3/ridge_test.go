package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// withRidges asks for the patch's ridges and its focal sheets' cuspidal
// edges.
func withRidges(c Request) Request {
	c.Surface.Ridges = true
	return c
}

// An elliptic cylinder (a cos u, b sin u, v) bends only around its
// sections, with curvature κ(u) = ab/(a² sin² u + b² cos² u)^{3/2}, which
// is stationary along the section at its four vertices, u = 0, π/2, π and
// 3π/2. Its curved focal sheet is the section's evolute swept along z, and
// it folds back along the lines over the evolute's cusps,
// (±(a² − b²)/a, 0) and (0, ±(a² − b²)/b). The other sheet is at infinity
// and has no edge. The domain starts off a vertex, so that no ridge runs
// along a grid line.
func TestEllipticCylinderRidgesStandOverItsEvolutesCusps(t *testing.T) {
	const a, b = 1.5, 1.0
	c := withRidges(surfaceStudy("cylinder", a, b, 0, 0.1, 0.1+2*math.Pi, -0.5, 0.5, 96, 12))
	s := surfaced(t, c)
	if s.Ridges == nil || len(*s.Ridges) != 4 {
		t.Fatalf("ridges %v, want 4", s.Ridges)
	}
	cusps := map[[2]float64]bool{}
	for k, e := range *s.Ridges {
		if e.Branch != 2 || e.Closed {
			t.Fatalf("ridge %d: branch %d closed %v, want an open ridge of branch 2", k, e.Branch, e.Closed)
		}
		if len(e.Points) != 13 || len(e.Feet) != 13 || len(e.I) != 13 || len(e.J) != 13 {
			t.Fatalf("ridge %d has %d points, %d feet, %d i and %d j, want one on each of the 13 rows", k, len(e.Points), len(e.Feet), len(e.I), len(e.J))
		}
		u, _ := params(c.Surface, e)
		first := e.Points[0]
		for m, p := range e.Points {
			if math.Hypot(p.X-first.X, p.Y-first.Y) > 1e-12 {
				t.Fatalf("ridge %d leaves its line: %v against %v", k, p, first)
			}
			foot := e.Feet[m]
			if math.Abs(foot.X-a*math.Cos(u[m])) > 1e-12 || math.Abs(foot.Y-b*math.Sin(u[m])) > 1e-12 || foot.Z != p.Z {
				t.Fatalf("ridge %d's foot %v is not the cylinder's point at u = %v under %v", k, foot, u[m], p)
			}
		}
		// At a vertex: u a multiple of π/2, and the point the cusp there.
		quarter := math.Round(u[0] / (math.Pi / 2))
		if math.Abs(u[0]-quarter*math.Pi/2) > 1e-9 {
			t.Fatalf("ridge %d at u = %v, not at a vertex", k, u[0])
		}
		want := map[int][2]float64{0: {(a*a - b*b) / a, 0}, 1: {0, -(a*a - b*b) / b}, 2: {-(a*a - b*b) / a, 0}, 3: {0, (a*a - b*b) / b}}[int(quarter)%4]
		if math.Hypot(first.X-want[0], first.Y-want[1]) > 1e-9 {
			t.Fatalf("ridge %d's edge at %v, not the cusp %v", k, first, want)
		}
		cusps[want] = true
	}
	if len(cusps) != 4 {
		t.Fatalf("edges over cusps %v, want all four", cusps)
	}
}

// A spheroid (a cos v cos u, a cos v sin u, c sin v), a = 1.5, c = 0.7,
// has its meridian curvature stationary along the meridian at the equator
// (and the poles, where the chart has no normal), so its ridge there is
// the whole equator, and the meridians' sheet of centers, the evolute's
// spindle, folds along a circle of radius (a² − c²)/a about the axis. The
// parallels' sheet is a stretch of the axis, not a surface, and has none.
// An odd number of columns keeps the equator off the grid.
func TestSpheroidRidgeIsItsEquator(t *testing.T) {
	const a, c = 1.5, 0.7
	s := surfaced(t, withRidges(surfaceStudy("ellipsoid", a, a, c, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 72, 61)))
	if s.Ridges == nil || len(*s.Ridges) != 1 {
		t.Fatalf("ridges %v, want the equator alone", s.Ridges)
	}
	e := (*s.Ridges)[0]
	if !e.Closed || e.Branch != 2 || len(e.Points) != 72 || len(e.Feet) != 72 {
		t.Fatalf("closed %v, branch %d, %d points and %d feet; want the whole equator, branch 2, once on each of 72 meridians", e.Closed, e.Branch, len(e.Points), len(e.Feet))
	}
	for m, p := range e.Points {
		if math.Abs(p.Z) > 1e-9 || math.Abs(math.Hypot(p.X, p.Y)-(a*a-c*c)/a) > 1e-9 {
			t.Fatalf("edge point %d at %v, not on the circle of radius %v", m, p, (a*a-c*c)/a)
		}
		f := e.Feet[m]
		if math.Abs(f.Z) > 1e-9 || math.Abs(math.Hypot(f.X, f.Y)-a) > 1e-9 {
			t.Fatalf("foot %d at %v, not on the equator", m, f)
		}
	}
}

// A three-axis ellipsoid's ridges are its three principal sections, in its
// planes of symmetry, where the curvature across the plane is stationary
// along its own line of curvature by symmetry. Each ridge point's foot
// lies in one of the planes, and its point on the focal sheet is the
// foot's center of curvature X + n/κ for that branch's κ, found here from
// the ellipsoid's implicit form; the center lies in the plane too. The
// section z = 0 holds no umbilic, so its ridge is one closed curve, of
// branch 2: with the outward normal both curvatures are negative, and the
// one across the plane, |κ| from a/c² to b/c², is the larger. With the grid on the planes, as in the whole ellipsoid's own
// grid, the ridges run along grid lines, and with it shifted they cross
// cells; either way they are found. The section y = 0 holds the four
// umbilics, (±a√((a² − b²)/(a² − c²)), 0, ±c√((b² − c²)/(a² − c²))), where
// its ridge passes from one branch to the other, and the poles split the
// sections through them: branch 1 has the halves of x = 0 and the arcs of
// y = 0 between umbilics round the ends of the long axis, branch 2 the
// arcs of y = 0 from each umbilic to the pole and the equator. Every open
// ridge stops beside a pole or within a cell of an umbilic.
func TestEllipsoidRidgesAreItsPrincipalSections(t *testing.T) {
	const a, b, c = 1.5, 1.0, 0.7
	for _, shift := range []float64{0, 0.05} {
		study := withRidges(surfaceStudy("ellipsoid", a, b, c, shift, shift+2*math.Pi, -math.Pi/2, math.Pi/2, 96, 96))
		q := study.Surface
		s := surfaced(t, study)
		if s.Ridges == nil || len(*s.Ridges) < 3 {
			t.Fatalf("shift %v: ridges %v", shift, s.Ridges)
		}
		equator, branches := 0, [2]int{}
		dv := math.Pi / 96
		umbilic := Vec3{a * math.Sqrt((a*a-b*b)/(a*a-c*c)), 0, c * math.Sqrt((b*b-c*c)/(a*a-c*c))}
		for k, e := range *s.Ridges {
			branches[e.Branch-1]++
			if len(e.Points) < 2 || len(e.Feet) != len(e.Points) {
				t.Fatalf("shift %v: ridge %d has %d points and %d feet", shift, k, len(e.Points), len(e.Feet))
			}
			us, vs := params(q, e)
			for m, p := range e.Points {
				x, n := ellipsoidNormal(a, b, c, us[m], vs[m])
				if x.sub(e.Feet[m]).norm() > 1e-12 {
					t.Fatalf("shift %v: ridge %d foot %v is not the point of its parameters %v", shift, k, e.Feet[m], x)
				}
				plane := math.Min(math.Abs(x.X), math.Min(math.Abs(x.Y), math.Abs(x.Z)))
				if plane > 1e-9 {
					t.Fatalf("shift %v: ridge %d foot %d at %v lies in no plane of symmetry", shift, k, m, x)
				}
				// 1 − dκ at d = 1 is 1 − κ.
				kappa := 1 - ellipsoidSingularity(a, b, c, us[m], vs[m], 1)[e.Branch-1]
				if want := x.add(n.mul(1 / kappa)); want.sub(p).norm() > 1e-9 {
					t.Fatalf("shift %v: ridge %d point %d at %v, not its foot's center of curvature %v", shift, k, m, p, want)
				}
			}
			if !e.Closed {
				for _, m := range []int{0, len(e.Feet) - 1} {
					f := e.Feet[m]
					pole := math.Abs(f.Z) > c*math.Cos(1.01*dv)
					near := Vec3{math.Abs(f.X), 0, math.Abs(f.Z)}.sub(umbilic).norm() < 2*a*math.Pi/96
					if !pole && !near {
						t.Fatalf("shift %v: ridge %d stops at %v, beside neither a pole nor an umbilic", shift, k, f)
					}
				}
			}
			if e.Closed && math.Abs(e.Feet[0].Z) < 1e-9 && math.Abs(e.Feet[len(e.Feet)/2].Z) < 1e-9 {
				equator++
				if e.Branch != 2 || len(e.Points) < 96 {
					t.Fatalf("shift %v: the equator's ridge is branch %d with %d points, want branch 2 round all 96 meridians", shift, e.Branch, len(e.Points))
				}
			}
		}
		if branches != [2]int{4, 5} {
			t.Fatalf("shift %v: %v ridges on branches 1 and 2, want 4 and 5", shift, branches)
		}
		if equator != 1 {
			t.Fatalf("shift %v: %d closed ridges on the equator, want 1", shift, equator)
		}
	}
}

// Ridges are opt-in: without them the result carries none and encodes as
// before, with no "ridges" key, and an offset's edges carry no feet. A
// sphere, umbilic everywhere, has none: an empty list.
func TestRidgesAreOptIn(t *testing.T) {
	c := withEdges(surfaceStudy("ellipsoid", 1.5, 1, 0.7, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 48, 48), -0.6)
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if out.Surface.Ridges != nil {
		t.Fatalf("%d ridges unasked", len(*out.Surface.Ridges))
	}
	encoded, _ := json.Marshal(out.Surface)
	if strings.Contains(string(encoded), `"ridges"`) || strings.Contains(string(encoded), `"feet"`) {
		t.Fatal("the result encodes ridges or feet unasked")
	}
	s := surfaced(t, withRidges(sphere(1, 36, 24)))
	if s.Ridges == nil || len(*s.Ridges) != 0 {
		t.Fatalf("a sphere has ridges %v, want an empty list", s.Ridges)
	}
	encoded, _ = json.Marshal(s)
	if !strings.Contains(string(encoded), `"ridges":[]`) {
		t.Fatal("a sphere encodes no empty list of ridges")
	}
}

// The extremality dκ(e), differentiated exactly, matches κ differenced
// along e on the patch, and changes sign with e.
func TestExtremalityIsKappaDifferencedAlongItsDirection(t *testing.T) {
	q := surfaceStudy("ellipsoid", 1.5, 1, 0.7, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 48, 48).Surface
	for _, at := range [][2]float64{{0.4, 0.3}, {2.1, -0.8}, {4, 1.1}} {
		u, v := at[0], at[1]
		s := q.point(u, v, 1)
		for k := range 2 {
			// e = X_u w¹ + X_v w².
			_, xu, xv, _, _, _ := q.patch(u, v)
			g := [2][2]float64{{xu.dot(xu), xu.dot(xv)}, {xu.dot(xv), xv.dot(xv)}}
			det := g[0][0]*g[1][1] - g[0][1]*g[0][1]
			eu, ev := xu.dot(s.Dir[k]), xv.dot(s.Dir[k])
			w := [2]float64{(g[1][1]*eu - g[0][1]*ev) / det, (g[0][0]*ev - g[0][1]*eu) / det}
			const h = 1e-5
			plus := q.point(u+h*w[0], v+h*w[1], 1).Kappa[k]
			minus := q.point(u-h*w[0], v-h*w[1], 1).Kappa[k]
			want := (plus - minus) / (2 * h)
			got := q.extremality(u, v, s, k)
			if math.Abs(got-want) > 1e-6*(1+math.Abs(want)) {
				t.Fatalf("at (%v, %v) branch %d: dκ(e) = %v, differenced %v", u, v, k+1, got, want)
			}
			s.Dir[k] = s.Dir[k].mul(-1)
			if flipped := q.extremality(u, v, s, k); flipped != -got {
				t.Fatalf("at (%v, %v) branch %d: dκ(−e) = %v, not −%v", u, v, k+1, flipped, got)
			}
			s.Dir[k] = s.Dir[k].mul(-1)
		}
	}
}

// Every ridge point is a root of the extremality: κ differenced along its
// own direction on the patch, independently of the exact derivative the
// ridges are traced by, vanishes there against its size elsewhere. This
// holds where orienting e could go wrong, as round the monkey saddle's
// umbilic, where three ridges meet, and on a paraboloid whose ridge passes
// from one branch to the other at its umbilics, including with an umbilic
// exactly on a sample, (±√1.5, 0) for z = (x² + 0.4y²)/2, where the
// principal directions are arbitrary.
func TestRidgePointsAreRootsOfTheExtremality(t *testing.T) {
	s15 := math.Sqrt(1.5)
	for _, c := range []Request{
		surfaceStudy("paraboloid", 1, 0.4, 0, -2*s15, 2*s15, -1.5, 1.5, 96, 96),
		surfaceStudy("monkey", 0.4, 0, 0, -1.2, 1.2, -1.2, 1.2, 96, 96),
		surfaceStudy("paraboloid", 1, 0.4, 0, -1.5, 1.5, -1.5, 1.5, 96, 96),
		surfaceStudy("paraboloid", 1, -0.5, 0, -1.5, 1.5, -1.5, 1.5, 61, 61),
		surfaceStudy("ellipsoid", 1.5, 1, 0.7, 0.05, 0.05+2*math.Pi, -math.Pi/2, math.Pi/2, 96, 96),
	} {
		q := c.Surface
		s := surfaced(t, withRidges(c))
		if len(*s.Ridges) == 0 {
			t.Fatalf("%s: no ridges", q.Kind)
		}
		// dκ(e) differenced on the patch, per unit length along e.
		differenced := func(u, v float64, k int) float64 {
			p := q.point(u, v, 1)
			_, xu, xv, _, _, _ := q.patch(u, v)
			g := [2][2]float64{{xu.dot(xu), xu.dot(xv)}, {xu.dot(xv), xv.dot(xv)}}
			det := g[0][0]*g[1][1] - g[0][1]*g[0][1]
			eu, ev := xu.dot(p.Dir[k]), xv.dot(p.Dir[k])
			w := [2]float64{(g[1][1]*eu - g[0][1]*ev) / det, (g[0][0]*ev - g[0][1]*eu) / det}
			const h = 1e-5
			return (q.point(u+h*w[0], v+h*w[1], 1).Kappa[k] - q.point(u-h*w[0], v-h*w[1], 1).Kappa[k]) / (2 * h)
		}
		// The size of dκ(e) on the grid, away from umbilics.
		size := 0.0
		for i := 0; i <= q.USamples; i += 4 {
			for j := 0; j <= q.VSamples; j += 4 {
				u, v := q.at(i, j)
				if p := q.point(u, v, 1); p.Normal && !p.Umbilic {
					for k := range 2 {
						size = math.Max(size, math.Abs(differenced(u, v, k)))
					}
				}
			}
		}
		for n, e := range *s.Ridges {
			us, vs := params(q, e)
			for m := range e.Points {
				if d := differenced(us[m], vs[m], e.Branch-1); math.Abs(d) > 1e-6*size {
					t.Fatalf("%s %v: ridge %d point %d at (%v, %v): dκ%d(e) differenced is %v, against %v elsewhere", q.Kind, q.A, n, m, us[m], vs[m], e.Branch, d, size)
				}
			}
		}
	}
}

// A cell with an umbilic corner, where the principal directions are
// arbitrary, is left out: with the paraboloid z = (x² + 0.4y²)/2's
// umbilics (±√1.5, 0) on samples, no ridge point lies on a grid edge from
// either, and each ridge that reaches one stops within a cell of it.
func TestRidgesStopBesideAnUmbilicSample(t *testing.T) {
	s15 := math.Sqrt(1.5)
	c := surfaceStudy("paraboloid", 1, 0.4, 0, -2*s15, 2*s15, -1.5, 1.5, 96, 96)
	s := surfaced(t, withRidges(c))
	if s.Umbilics != 2 {
		t.Fatalf("%d umbilic samples, want 2", s.Umbilics)
	}
	stops := 0
	for k, e := range *s.Ridges {
		for m := range e.I {
			for _, umbilic := range [][2]float64{{24, 48}, {72, 48}} {
				di, dj := math.Abs(e.I[m]-umbilic[0]), math.Abs(e.J[m]-umbilic[1])
				if di < 1 && dj == 0 || dj < 1 && di == 0 {
					t.Fatalf("ridge %d point %d at (%v, %v) lies on a grid edge from the umbilic %v", k, m, e.I[m], e.J[m], umbilic)
				}
				if (m == 0 || m == len(e.I)-1) && di <= 1 && dj <= 1 {
					stops++
				}
			}
		}
	}
	// The x-axis ridge passes from κ₂ to κ₁ at each umbilic: four ends.
	if stops != 4 {
		t.Fatalf("%d ridge ends beside the umbilics, want 4", stops)
	}
}
