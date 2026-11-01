package engine3

import (
	"errors"
	"fmt"
	"math"
	"testing"
)

// The helicoid–catenoid associated family is checked against formulas
// written out here, independently of the engine's: its points, its shared
// Gauss map, its metric E = G = s²cosh²v, F = 0, and its principal
// curvatures ±1/(s cosh²v), observed in the returned sheets and
// diagnostics.

const helicoidCatenoid = "helicoid-catenoid"

// associateStudy is the family at scale s and associate angle theta over
// [u0, u1] × [v0, v1] on an nu × nv grid.
func associateStudy(s, theta, u0, u1, v0, v1 float64, nu, nv int) Request {
	return surfaceStudy(helicoidCatenoid, s, theta, 0, u0, u1, v0, v1, nu, nv)
}

// associateX is X(u, v) at scale s and angle theta (3D-XplorMath's
// convention): the helicoid at theta = 0 and the catenoid at π/2.
func associateX(s, theta, u, v float64) Vec3 {
	c, a := math.Cos(theta), math.Sin(theta)
	return Vec3{
		s * (c*math.Sinh(v)*math.Sin(u) + a*math.Cosh(v)*math.Cos(u)),
		s * (-c*math.Sinh(v)*math.Cos(u) + a*math.Cosh(v)*math.Sin(u)),
		s * (c*u + a*v),
	}
}

// gaussMap is the unit normal X_u × X_v/|X_u × X_v| shared by every member
// of the family: (cos u, sin u, −sinh v)/cosh v.
func gaussMap(u, v float64) Vec3 {
	return Vec3{math.Cos(u), math.Sin(u), -math.Sinh(v)}.mul(1 / math.Cosh(v))
}

func associateNear(t *testing.T, what string, got, want Vec3, tol float64) {
	t.Helper()
	if d := got.sub(want).norm(); !(d <= tol) {
		t.Fatalf("%s: got %v want %v (off by %g, tolerance %g)", what, got, want, d, tol)
	}
}

// The endpoints are the declared helicoid and catenoid, and an interior
// angle is the declared combination of them, at the returned samples.
func TestAssociateFamilyPoints(t *testing.T) {
	for _, s := range []float64{1, 0.37, 2500} {
		for _, theta := range []float64{0, 0.3, math.Pi / 4, 1.2, math.Pi / 2} {
			q := associateStudy(s, theta, -math.Pi, math.Pi, -1.5, 1.5, 24, 12)
			out := surfaced(t, q)
			each(out.Surface, func(i, j int, p Vec3) {
				u, v := grid(q.Surface, i, j)
				associateNear(t, fmt.Sprintf("s %g θ %g X(%g, %g)", s, theta, u, v), p, associateX(s, theta, u, v), 1e-13*s*math.Cosh(1.5)*8)
			})
		}
	}
	u, v := 0.7, -0.4
	helicoid := Vec3{math.Sinh(v) * math.Sin(u), -math.Sinh(v) * math.Cos(u), u}
	catenoid := Vec3{math.Cosh(v) * math.Cos(u), math.Cosh(v) * math.Sin(u), v}
	q := associateStudy(1, 0, 0, 1, 0, 1, 12, 12).Surface
	x, _, _, _, _, _ := q.patch(u, v)
	associateNear(t, "helicoid", x, helicoid, 1e-15)
	q.B = math.Pi / 2
	x, _, _, _, _, _ = q.patch(u, v)
	associateNear(t, "catenoid", x, catenoid, 1e-15)
}

// The exact derivatives agree with central differences of the points, and
// give the shared conformal metric E = G = s²cosh²v, F = 0 at every angle.
func TestAssociateDerivativesAndMetric(t *testing.T) {
	for _, s := range []float64{1, 0.05, 40} {
		for _, theta := range []float64{0, 0.2, 0.9, math.Pi / 3, math.Pi / 2} {
			q := associateStudy(s, theta, -4*math.Pi, 4*math.Pi, -4, 4, 12, 12).Surface
			for _, at := range [][2]float64{{.3, .4}, {-1.2, 2.1}, {2.9, -.7}, {11, -3.9}} {
				u, v := at[0], at[1]
				x, xu, xv, xuu, xuv, xvv := q.patch(u, v)
				scale := s * math.Cosh(v)
				h := 1e-4
				pu, _, _, _, _, _ := q.patch(u+h, v)
				mu, _, _, _, _, _ := q.patch(u-h, v)
				pv, _, _, _, _, _ := q.patch(u, v+h)
				mv, _, _, _, _, _ := q.patch(u, v-h)
				associateNear(t, "X_u", xu, pu.sub(mu).mul(1/(2*h)), 1e-7*scale+1e-12*s*math.Abs(u)/h)
				associateNear(t, "X_v", xv, pv.sub(mv).mul(1/(2*h)), 1e-7*scale+1e-12*s*math.Abs(u)/h)
				associateNear(t, "X_uu", xuu, pu.add(mu).sub(x.mul(2)).mul(1/(h*h)), 1e-4*scale+1e-12*s*(1+math.Abs(u))/(h*h))
				associateNear(t, "X_vv", xvv, pv.add(mv).sub(x.mul(2)).mul(1/(h*h)), 1e-4*scale+1e-12*s*(1+math.Abs(u))/(h*h))
				_, puv, _, _, _, _ := q.patch(u, v+h)
				_, muv, _, _, _, _ := q.patch(u, v-h)
				associateNear(t, "X_uv", xuv, puv.sub(muv).mul(1/(2*h)), 1e-7*scale)
				E, F, G := xu.dot(xu), xu.dot(xv), xv.dot(xv)
				want := s * s * math.Cosh(v) * math.Cosh(v)
				if math.Abs(E-want) > 1e-13*want || math.Abs(G-want) > 1e-13*want || math.Abs(F) > 1e-13*want {
					t.Fatalf("s %g θ %g (%g, %g): E %g F %g G %g, want E = G = %g, F = 0", s, theta, u, v, E, F, G, want)
				}
				// A harmonic conformal chart: X_uu + X_vv = 0, so H = 0.
				associateNear(t, "Laplacian", xuu.add(xvv), Vec3{}, 1e-13*scale)
				xuuu, xuuv, xuvv, xvvv := q.third(u, v)
				_, _, _, puu, puuv, pvv := q.patch(u+h, v)
				_, _, _, muu, muuv, mvv := q.patch(u-h, v)
				associateNear(t, "X_uuu", xuuu, puu.sub(muu).mul(1/(2*h)), 1e-7*scale)
				associateNear(t, "X_uuv", xuuv, puuv.sub(muuv).mul(1/(2*h)), 1e-7*scale)
				associateNear(t, "X_uvv", xuvv, pvv.sub(mvv).mul(1/(2*h)), 1e-7*scale)
				_, _, _, quu, _, qvv := q.patch(u, v+h)
				_, _, _, nuu, _, nvv := q.patch(u, v-h)
				associateNear(t, "X_uuv'", xuuv, quu.sub(nuu).mul(1/(2*h)), 1e-7*scale)
				associateNear(t, "X_vvv", xvvv, qvv.sub(nvv).mul(1/(2*h)), 1e-7*scale)
			}
		}
	}
}

// Every member shares the Gauss map (cos u, sin u, −sinh v)/cosh v as its
// X_u × X_v normal, and Reverse negates it; no sample is singular, and
// none is an umbilic, since κ₁ = −κ₂ ≠ 0.
func TestAssociateNormalsAndReversal(t *testing.T) {
	for _, theta := range []float64{0, 0.5, math.Pi / 4, 1.4, math.Pi / 2} {
		for _, reverse := range []bool{false, true} {
			q := associateStudy(1.7, theta, -2, 5, -4, 4, 28, 32)
			q.Surface.Reverse = reverse
			out := surfaced(t, q)
			if out.Singular != 0 || out.Umbilics != 0 {
				t.Fatalf("θ %g: %d singular, %d umbilics", theta, out.Singular, out.Umbilics)
			}
			sign := 1.0
			if reverse {
				sign = -1
			}
			each(out.Surface, func(i, j int, p Vec3) {
				u, v := grid(q.Surface, i, j)
				n := out.Surface.Normals[i][j]
				if n == nil {
					t.Fatalf("θ %g: no normal at (%d, %d)", theta, i, j)
				}
				associateNear(t, fmt.Sprintf("θ %g reverse %v n(%g, %g)", theta, reverse, u, v), *n, gaussMap(u, v).mul(sign), 1e-14)
			})
		}
	}
}

// The patch's diagnostics give κ₁ = 1/(s cosh²v) = −κ₂ with either normal,
// so H = 0 and K = −1/(s²cosh⁴v), over edited scales and domains up to the
// extreme admitted |v| = 4 and s = 100000, at grid samples and at points
// between them.
func TestAssociateCurvature(t *testing.T) {
	for _, s := range []float64{1, 1e-3, 3.25, 1e5} {
		for _, theta := range []float64{0, 0.35, 1, math.Pi / 2} {
			for _, reverse := range []bool{false, true} {
				c := associateStudy(s, theta, -4*math.Pi, 4*math.Pi, -4, 4, 40, 16)
				c.Surface.Reverse = reverse
				r, d := probed(t, c)
				if len(r.Surface.Focal) != 0 {
					t.Fatalf("the family has no focal sheets, got %d", len(r.Surface.Focal))
				}
				check := func(what string, d *SurfaceDiagnostics, row, column int, v float64) {
					t.Helper()
					want := 1 / (s * math.Cosh(v) * math.Cosh(v))
					k1, k2 := d.Curvature[0][row][column], d.Curvature[1][row][column]
					closeTo(t, what+" κ₁", k1, want, 1e-12*want)
					closeTo(t, what+" κ₂", k2, -want, 1e-12*want)
					if H := (*k1 + *k2) / 2; math.Abs(H) > 1e-12*want {
						t.Fatalf("%s: H = %g, want 0 (κ = %g)", what, H, want)
					}
					if K := *k1 * *k2; math.Abs(K+want*want) > 1e-11*want*want {
						t.Fatalf("%s: K = %g, want %g", what, K, -want*want)
					}
					// The second fundamental form is s[[−sin θ, cos θ],
					// [cos θ, sin θ]] in the conformal chart, so e₁ lies at
					// π/4 + θ/2 from X_u toward X_v (a quarter turn on with
					// the normal reversed), up to sign.
					e1 := d.Direction[0][row][column]
					if e1 == nil || d.Direction[1][row][column] == nil {
						t.Fatalf("%s: principal directions missing", what)
					}
					u := d.U[row]
					h := 1e-6
					xu := associateX(s, theta, u+h, v).sub(associateX(s, theta, u-h, v))
					xv := associateX(s, theta, u, v+h).sub(associateX(s, theta, u, v-h))
					phi := math.Pi/4 + theta/2
					if reverse {
						phi += math.Pi / 2
					}
					dir := xu.mul(math.Cos(phi) / xu.norm()).add(xv.mul(math.Sin(phi) / xv.norm()))
					if c := math.Abs(e1.dot(dir)); c < 1-1e-8 {
						t.Fatalf("%s: e₁ %v is not along %v (|cos| %g)", what, *e1, dir, c)
					}
				}
				for row := range d.U {
					for column := range d.V {
						check(fmt.Sprintf("s %g θ %g reverse %v (%d, %d)", s, theta, reverse, row, column), d, row, column, d.V[column])
					}
				}
				for _, at := range [][2]float64{{0.123, 0.456}, {-12.4, 3.97}, {7.1, -3.99}} {
					_, p := pointProbed(t, c, at[0], at[1])
					check(fmt.Sprintf("s %g θ %g point (%g, %g)", s, theta, at[0], at[1]), p, 0, 0, at[1])
					sign := 1.0
					if reverse {
						sign = -1
					}
					associateNear(t, "point normal", *p.Normals[0][0], gaussMap(at[0], at[1]).mul(sign), 1e-14)
					associateNear(t, "point", *p.Points[0][0], associateX(s, theta, at[0], at[1]), 1e-13*s*30*4*math.Pi)
				}
			}
		}
	}
}

// pathLength is the length of the polyline through points.
func pathLength(points []*Vec3) float64 {
	total := 0.0
	for k := 1; k < len(points); k++ {
		total += points[k].sub(*points[k-1]).norm()
	}
	return total
}

// Corresponding parameter paths have the same length at every angle: the
// returned u-curve at v = v₀ converges to s·cosh v₀·(u₁ − u₀) and the
// v-curve to s(sinh v₁ − sinh v₀), at second order as the grid doubles,
// while the polylines themselves differ in space.
func TestAssociateCorrespondingLengths(t *testing.T) {
	const s, u0, u1, v0, v1 = 1.3, -math.Pi, 2.5, -1.5, 2
	thetas := []float64{0, 0.4, math.Pi / 4, 1.3, math.Pi / 2}
	alongU := func(out *SurfaceResult, j int) float64 {
		column := make([]*Vec3, len(out.Surface.Points))
		for i := range column {
			column[i] = out.Surface.Points[i][j]
		}
		return pathLength(column)
	}
	exactU := func(v float64) float64 { return s * math.Cosh(v) * (u1 - u0) }
	exactV := s * (math.Sinh(v1) - math.Sinh(v0))
	for _, theta := range thetas {
		var errsU, errsV []float64
		for _, n := range []int{24, 48, 96} {
			q := associateStudy(s, theta, u0, u1, v0, v1, n, n)
			out := surfaced(t, q)
			// v = 0.25, halfway, and u a quarter of the way lie on every
			// grid.
			j := n / 2
			_, v := grid(q.Surface, 0, j)
			errsU = append(errsU, math.Abs(alongU(out, j)-exactU(v)))
			errsV = append(errsV, math.Abs(pathLength(out.Surface.Points[n/4])-exactV))
		}
		// On the helicoid (θ = 0) the v-curves are its straight rulings,
		// whose polylines are exact.
		straight := theta == 0
		for k := 1; k < len(errsU); k++ {
			pairs := [][2]float64{{errsU[k-1], errsU[k]}}
			if !straight {
				pairs = append(pairs, [2]float64{errsV[k-1], errsV[k]})
			} else if errsV[k] > 1e-14*exactV {
				t.Fatalf("the helicoid's ruling is not straight: errors %v", errsV)
			}
			for _, e := range pairs {
				if ratio := e[0] / e[1]; !(ratio > 3.6 && ratio < 4.4) {
					t.Fatalf("θ %g: errors %v (u) %v (v) do not fall at second order", theta, errsU, errsV)
				}
			}
		}
		if errsU[len(errsU)-1] > 3e-4*exactU(0.25) || errsV[len(errsV)-1] > 3e-4*exactV {
			t.Fatalf("θ %g: finest errors %g, %g", theta, errsU[len(errsU)-1], errsV[len(errsV)-1])
		}
	}
	// The same paths at different angles are different curves in space.
	a := surfaced(t, associateStudy(s, 0, u0, u1, v0, v1, 48, 24))
	b := surfaced(t, associateStudy(s, math.Pi/2, u0, u1, v0, v1, 48, 24))
	if d := a.Surface.Points[10][5].sub(*b.Surface.Points[10][5]).norm(); d < 0.1 {
		t.Fatalf("the helicoid and catenoid samples coincide (%g apart)", d)
	}
}

// The patch stays a simply connected rectangle: even where the catenoid's
// ends u = ±π (or a domain longer than a turn) occupy the same place, its
// sheet has every face and no edge joining the last column to the first.
func TestAssociateBoundariesStayOpen(t *testing.T) {
	for _, span := range []float64{math.Pi, 4 * math.Pi} {
		q := associateStudy(1, math.Pi/2, -span, span, -1.5, 1.5, 48, 24)
		out := surfaced(t, q)
		nu, nv := q.Surface.USamples, q.Surface.VSamples
		if len(out.Surface.AlongU) != nu || len(out.Surface.Faces) != nu || len(out.Surface.Points) != nu+1 {
			t.Fatalf("the sheet is not an open %d × %d rectangle", nu, nv)
		}
		faces := 0
		for _, column := range out.Surface.Faces {
			for _, f := range column {
				if f {
					faces++
				}
			}
		}
		if faces != nu*nv {
			t.Fatalf("%d faces, want %d", faces, nu*nv)
		}
		for j := 0; j <= nv; j++ {
			first, last := out.Surface.Points[0][j], out.Surface.Points[nu][j]
			if first == last {
				t.Fatalf("column %d's ends share one point", j)
			}
			if d := first.sub(*last).norm(); d > 1e-12 {
				t.Fatalf("the catenoid's ends should meet in space at v sample %d: %g apart", j, d)
			}
		}
	}
}

// fieldOf is the field a FieldError names, or "".
func fieldOf(err error) string {
	var f *FieldError
	if errors.As(err, &f) {
		return f.Field
	}
	return ""
}

// The family's limits are checked before any hyperbolic function is
// evaluated, and each refusal names its field; the extreme admitted
// values compute finite geometry.
func TestAssociateValidation(t *testing.T) {
	ok := associateStudy(1, 0.5, -math.Pi, math.Pi, -1.5, 1.5, 24, 12)
	for _, c := range []struct {
		field string
		edit  func(q *SurfaceRequest)
	}{
		{"surface.a", func(q *SurfaceRequest) { q.A = 0 }},
		{"surface.a", func(q *SurfaceRequest) { q.A = -1 }},
		{"surface.a", func(q *SurfaceRequest) { q.A = 1e5 * (1 + 1e-15) }},
		{"surface.a", func(q *SurfaceRequest) { q.A = math.NaN() }},
		{"surface.a", func(q *SurfaceRequest) { q.A = math.Inf(1) }},
		{"surface.b", func(q *SurfaceRequest) { q.B = -1e-17 }},
		{"surface.b", func(q *SurfaceRequest) { q.B = math.Nextafter(math.Pi/2, 2) }},
		{"surface.b", func(q *SurfaceRequest) { q.B = math.NaN() }},
		{"surface.uMin", func(q *SurfaceRequest) { q.UMin = math.Nextafter(-4*math.Pi, -20) }},
		{"surface.uMax", func(q *SurfaceRequest) { q.UMax = math.Nextafter(4*math.Pi, 20) }},
		{"surface.vMin", func(q *SurfaceRequest) { q.VMin = -4.0000001 }},
		{"surface.vMax", func(q *SurfaceRequest) { q.VMax = 1e300 }},
		{"surface.vMin", func(q *SurfaceRequest) { q.VMin = math.Inf(-1) }},
		{"surface.uMax", func(q *SurfaceRequest) { q.UMin, q.UMax = 1, 1 }},
		{"surface.vMax", func(q *SurfaceRequest) { q.VMin, q.VMax = 1, 0.5 }},
		{"surface.uSamples", func(q *SurfaceRequest) { q.USamples = 241 }},
		{"surface.vSamples", func(q *SurfaceRequest) { q.USamples, q.VSamples = 240, 61 }},
		{"surface.offset", func(q *SurfaceRequest) { q.Offset = 0.1 }},
		{"surface.edges", func(q *SurfaceRequest) { q.Edges = true }},
		{"surface.ridges", func(q *SurfaceRequest) { q.Ridges = true }},
	} {
		bad := ok
		c.edit(&bad.Surface)
		_, err := Compute(bad)
		if err == nil || fieldOf(err) != c.field {
			t.Fatalf("%+v: got %v (field %q), want a refusal of %s", bad.Surface, err, fieldOf(err), c.field)
		}
	}
	// The extremes: the widest domain, the largest and a tiny scale, both
	// end angles, and the densest grid.
	for _, q := range []Request{
		associateStudy(1e5, 0, -4*math.Pi, 4*math.Pi, -4, 4, 240, 60),
		associateStudy(1e5, math.Pi/2, -4*math.Pi, 4*math.Pi, -4, 4, 60, 240),
		associateStudy(1e-9, math.Pi/2, -4*math.Pi, 4*math.Pi, -4, 4, 12, 12),
	} {
		q.Surface.Reach = 3
		out := surfaced(t, q)
		each(out.Surface, func(i, j int, p Vec3) {
			if !p.valid() || out.Surface.Normals[i][j] == nil || !out.Surface.Normals[i][j].valid() {
				t.Fatalf("sample (%d, %d) is not finite: %v", i, j, p)
			}
		})
		if len(out.Lines) == 0 {
			t.Fatal("no normal lines")
		}
	}
}

// What the family does not offer is refused, not inherited: offset and
// focal diagnostics, and lighting it as a mirror or interface. Geodesic
// threads say they are unavailable, as on any other surface without them.
func TestAssociateUnsupportedCapabilities(t *testing.T) {
	c := associateStudy(1, 0.5, -math.Pi, math.Pi, -1.5, 1.5, 24, 12)
	for _, target := range []string{"offset", "focal1", "focal2"} {
		if _, err := Compute(probedAs(c, target)); err == nil {
			t.Fatalf("%s diagnostics were computed", target)
		}
	}
	lit := c
	lit.Format = "rays"
	lit.Rays = RaysRequest{Interaction: "reflect", N1: 1, N2: 1.5, Light: "parallel", Elevation: 90, Length: 1, Receiver: ReceiverRequest{Plane: "none"}}
	if _, err := Compute(lit); fieldOf(err) != "surface.kind" {
		t.Fatalf("a ray study on the family: %v, want a refusal of surface.kind", err)
	}
	threads := c
	threads.Surface.Geodesics = &GeodesicRequest{U: 0, V: 0, Direction: 0, Spread: 90, Count: 3, Length: 1, Samples: 20, Selected: 1}
	out := surfaced(t, threads)
	if out.Geodesics == nil || out.Geodesics.Unavailable == "" || len(out.Geodesics.Threads) != 0 {
		t.Fatalf("threads on the family: %+v", out.Geodesics)
	}
	if out.Offset != nil || out.Edges != nil || out.Ridges != nil || len(out.Focal) != 0 {
		t.Fatal("the family returned an offset, edges, ridges or focal sheets")
	}
}

// The probe's point between samples carries the u- and v-parameter curves
// through it, sampled where the grid samples the other parameter: the
// corresponding paths that the grid's own curves show at its samples.
func TestAssociateProbeCrossingCurves(t *testing.T) {
	c := probedAs(associateStudy(1.2, 0.7, -2, 2, -1, 1.5, 20, 12), "surface")
	u, v := 0.31, 0.77
	_, d := pointProbed(t, c, u, v)
	if len(d.Crossing) != 2 || len(d.Crossing[0]) != 21 || len(d.Crossing[1]) != 13 {
		t.Fatalf("crossing curves %d, want the u-curve (21) and v-curve (13)", len(d.Crossing))
	}
	q := c.Surface
	for i, p := range d.Crossing[0] {
		associateNear(t, "u-curve", p, associateX(1.2, 0.7, lerp(q.UMin, q.UMax, i, q.USamples), v), 1e-13*10)
	}
	for j, p := range d.Crossing[1] {
		associateNear(t, "v-curve", p, associateX(1.2, 0.7, u, lerp(q.VMin, q.VMax, j, q.VSamples)), 1e-13*10)
	}
	// Other patches carry none, so their probes are unchanged.
	_, e := pointProbed(t, probedAs(coarseEllipsoid(), "surface"), 0.2, 0.3)
	if e.Crossing != nil {
		t.Fatal("an ellipsoid's probe carries crossing curves")
	}
	// Nor does the grid's probe, whose rows and columns are the curves.
	_, g := probed(t, c)
	if g.Crossing != nil {
		t.Fatal("the grid's diagnostics carry crossing curves")
	}
}

// crossingPair solves the family's self-intersection condition at angle
// theta (docs/mathematics.md): the points (u, v) and (u + 2π − 2φ(v), −v)
// coincide where cos θ φ(v) + sin θ v = π cos θ, φ(v) = atan(cot θ tanh v),
// v > 0. It returns that v and φ(v).
func crossingPair(theta float64) (float64, float64) {
	c, s := math.Cos(theta), math.Sin(theta)
	phi := func(v float64) float64 { return math.Atan(c / s * math.Tanh(v)) }
	lo, hi := 0.0, 50.0
	for range 200 {
		m := (lo + hi) / 2
		if c*phi(m)+s*m > math.Pi*c {
			hi = m
		} else {
			lo = m
		}
	}
	return lo, phi(lo)
}

// A member strictly between the helicoid and the catenoid crosses itself
// exactly where the documented condition says: the engine's points at the
// pair coincide, while nearby pairs do not. The presets' domains admit no
// such pair at any angle: the staircase's u span is too short for its v,
// and the ramp's v lies on one side.
func TestAssociateSelfIntersection(t *testing.T) {
	q := associateStudy(1.3, 0, -4*math.Pi, 4*math.Pi, -4, 4, 12, 12).Surface
	for _, theta := range []float64{0.3, 0.8, 1.06, 1.2, 1.5} {
		q.B = theta
		v, phi := crossingPair(theta)
		u := -0.4
		a, _, _, _, _, _ := q.patch(u, v)
		b, _, _, _, _, _ := q.patch(u+2*math.Pi-2*phi, -v)
		if d := a.sub(b).norm(); d > 1e-11*q.A*math.Cosh(v) {
			t.Fatalf("θ %g: the pair at v = %g is %g apart", theta, v, d)
		}
		c, _, _, _, _, _ := q.patch(u+2*math.Pi-2*phi+0.01, -v)
		if d := a.sub(c).norm(); d < 1e-3*q.A {
			t.Fatalf("θ %g: a pair off the condition also coincides (%g apart)", theta, d)
		}
	}
	presets := spatialPresets(t)
	for _, name := range []string{"A staircase becoming a throat", "A spiral ramp opening into a funnel"} {
		p, ok := presets[name]
		if !ok || p.Surface.Kind != helicoidCatenoid {
			t.Fatalf("no family preset %q", name)
		}
		s := p.Surface
		for k := 1; k < 1000; k++ {
			theta := math.Pi / 2 * float64(k) / 1000
			v, phi := crossingPair(theta)
			if v <= math.Min(s.VMax, -s.VMin) && 2*math.Pi-2*phi <= s.UMax-s.UMin {
				t.Fatalf("%s crosses itself at θ = %g (v = %g)", name, theta, v)
			}
		}
	}
	// A whole turn with v ±1.5, as the staircase first opened, crosses
	// from θ ≈ 1.0595.
	cross := func(theta float64) bool {
		v, phi := crossingPair(theta)
		return v <= 1.5 && 2*math.Pi-2*phi <= 2*math.Pi
	}
	if cross(1.05) || !cross(1.07) || !cross(1.5) {
		t.Fatalf("the whole turn's crossing does not begin near θ = 1.0595: %v %v %v", cross(1.05), cross(1.07), cross(1.5))
	}
}
