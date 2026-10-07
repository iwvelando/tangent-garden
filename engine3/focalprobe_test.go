package engine3

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// focalProbed computes a surface study with focal sheet sheet's
// diagnostics and checks that the grid's arrays agree in shape.
func focalProbed(t *testing.T, c Request, sheet int) (Result, *SurfaceDiagnostics) {
	t.Helper()
	c.FocalDiagnostics = sheet
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	d := gridded(t, r.Probe)
	if d.Kind != "focal" || d.Sheet != sheet || len(d.Feet) != len(d.U) {
		t.Fatalf("kind %q sheet %d, %d rows of feet for %d rows", d.Kind, d.Sheet, len(d.Feet), len(d.U))
	}
	for row := range d.Feet {
		if len(d.Feet[row]) != len(d.V) {
			t.Fatalf("row %d: %d feet for %d columns", row, len(d.Feet[row]), len(d.V))
		}
	}
	return r, d
}

// The patch's third partial derivatives are the derivatives of its
// second: central differences of those agree to their own error.
func TestPatchThirdDerivatives(t *testing.T) {
	const h = 1e-5
	for _, q := range []SurfaceRequest{
		{Kind: "ellipsoid", A: 1.5, B: 1, C: 0.7},
		{Kind: "torus", A: 2, B: 0.8},
		{Kind: "torus", A: 0.5, B: 0.8},
		{Kind: "cylinder", A: 1.5, B: 1},
		{Kind: "paraboloid", A: 0.8, B: -0.5},
		{Kind: "monkey", A: 0.4},
	} {
		for _, at := range [][2]float64{{0.3, -0.4}, {2.1, 0.9}, {-1.2, 1.3}} {
			u, v := at[0], at[1]
			_, _, _, uuP, uvP, vvP := q.patch(u+h, v)
			_, _, _, uuM, uvM, vvM := q.patch(u-h, v)
			_, _, _, _, uvQ, vvQ := q.patch(u, v+h)
			_, _, _, _, uvR, vvR := q.patch(u, v-h)
			uuu, uuv, uvv, vvv := q.third(u, v)
			for _, c := range []struct {
				name      string
				got, want Vec3
			}{
				{"uuu", uuu, uuP.sub(uuM).mul(1 / (2 * h))},
				{"uuv from uu", uuv, uvP.sub(uvM).mul(1 / (2 * h))},
				{"uvv from uv", uvv, uvQ.sub(uvR).mul(1 / (2 * h))},
				{"uvv from vv", uvv, vvP.sub(vvM).mul(1 / (2 * h))},
				{"vvv", vvv, vvQ.sub(vvR).mul(1 / (2 * h))},
			} {
				if c.got.sub(c.want).norm() > 1e-8*(1+c.want.norm()) {
					t.Fatalf("%s %v at (%g, %g): %s %v, differences give %v", q.Kind, q, u, v, c.name, c.got, c.want)
				}
			}
		}
	}
}

// A surface of revolution's meridian centers trace the meridian's evolute,
// so the focal sheet of the meridian branch is the surface of revolution
// of the evolute. For the spheroid (a cos v, c sin v) the evolute is
// ((a² − c²)/a cos³v, (c² − a²)/c sin³v), and a surface of revolution with
// profile (r, z) and unit normal (−z′, r′)/|γ′| has meridian curvature
// (r′z″ − z′r″)/|γ′|³ and parallel curvature z′/(r|γ′|), whose center lies
// on the axis. The meridian is κ₂ on an oblate spheroid and κ₁ on a
// prolate one; the parallel's sheet is a stretch of the axis, singular
// throughout. The evolute has cusps at the equator, where the sheet has a
// cuspidal edge, and the poles have no normal and so no focal point.
func TestFocalProbeSpheroidIsEvoluteOfRevolution(t *testing.T) {
	for _, s := range []struct {
		a, c            float64
		meridian, along int
	}{{1.2, 0.6, 2, 1}, {0.7, 1.4, 1, 2}} {
		a, c := s.a, s.c
		study := surfaceStudy("ellipsoid", a, a, c, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 24, 24)
		out, p := focalProbed(t, study, s.meridian)
		drawn := out.Surface.Focal[s.meridian-1].Points
		_, patch := probed(t, study)
		equator := 0
		for i, u := range p.U {
			for j, v := range p.V {
				pole := j == 0 || j == len(p.V)-1
				if pole {
					if p.Points[i][j] != nil {
						t.Fatalf("a %g c %g (%d, %d): a focal point at a pole", a, c, i, j)
					}
					continue
				}
				near(t, p.Feet[i][j], patch.Points[i][j], 0)
				near(t, p.Points[i][j], drawn[i][j], 0)
				r := (a*a - c*c) / a * math.Pow(math.Cos(v), 3)
				z := (c*c - a*a) / c * math.Pow(math.Sin(v), 3)
				near(t, p.Points[i][j], Vec3{r * math.Cos(u), r * math.Sin(u), z}, 1e-12)
				if j == len(p.V)/2 {
					if p.Normals[i][j] != nil {
						t.Fatalf("a %g c %g (%d, %d): a normal on the cuspidal edge", a, c, i, j)
					}
					equator++
					continue
				}
				n := p.Normals[i][j]
				if n == nil || p.Curvature[0][i][j] == nil || p.Curvature[1][i][j] == nil {
					t.Fatalf("a %g c %g (%d, %d): normal %v curvatures unknown", a, c, i, j, n)
				}
				// The sheet's normal is the patch's principal direction,
				// across the patch's normal line, which touches the sheet.
				e := patch.Direction[s.meridian-1][i][j]
				if math.Abs(math.Abs(n.dot(*e))-1) > 1e-12 || math.Abs(n.dot(*patch.Normals[i][j])) > 1e-12 {
					t.Fatalf("a %g c %g (%d, %d): normal %v, direction %v", a, c, i, j, n, e)
				}
				k := (a*a - c*c) / a
				l := (c*c - a*a) / c
				dr := -3 * k * math.Pow(math.Cos(v), 2) * math.Sin(v)
				dz := 3 * l * math.Pow(math.Sin(v), 2) * math.Cos(v)
				ddr := -3 * k * (math.Pow(math.Cos(v), 3) - 2*math.Cos(v)*math.Pow(math.Sin(v), 2))
				ddz := 3 * l * (2*math.Sin(v)*math.Pow(math.Cos(v), 2) - math.Pow(math.Sin(v), 3))
				speed := math.Hypot(dr, dz)
				meridian := (dr*ddz - dz*ddr) / math.Pow(speed, 3)
				parallel := dz / (r * speed)
				k1, k2 := *p.Curvature[0][i][j], *p.Curvature[1][i][j]
				scale := math.Max(1, math.Max(math.Abs(meridian), math.Abs(parallel)))
				if math.Abs(k1*k2-meridian*parallel) > 1e-9*scale*scale || math.Abs(math.Abs(k1+k2)-math.Abs(meridian+parallel)) > 1e-9*scale {
					t.Fatalf("a %g c %g (%d, %d): κ %g, %g; want %g, %g up to the normal's sign", a, c, i, j, k1, k2, meridian, parallel)
				}
				// The centers do not depend on the normal's sign: one on the
				// axis, the other the evolute's own center of curvature.
				normal := Vec3{-dz * math.Cos(u) / speed, -dz * math.Sin(u) / speed, dr / speed}
				x := *p.Points[i][j]
				want := []Vec3{x.add(normal.mul(1 / parallel)), x.add(normal.mul(1 / meridian))}
				got := []*Vec3{p.Focal[0][i][j], p.Focal[1][i][j]}
				if d := p.Direction[0][i][j]; d != nil && math.Abs(d.dot(Vec3{-math.Sin(u), math.Cos(u), 0})) < 0.5 {
					got[0], got[1] = got[1], got[0]
				}
				for b := range want {
					if got[b] != nil {
						near(t, got[b], want[b], 1e-9*math.Max(1, want[b].sub(x).norm()))
					}
				}
			}
		}
		if equator != len(p.U) || p.Singular != equator || p.Umbilics != 0 || p.Unknown != 0 {
			t.Fatalf("a %g c %g: equator %d, singular %d umbilics %d unknown %d", a, c, equator, p.Singular, p.Umbilics, p.Unknown)
		}
		// The parallel's sheet is the axis: every point on it is singular.
		_, axis := focalProbed(t, study, s.along)
		regular := 0
		for i := range axis.Points {
			for j := range axis.Points[i] {
				if x := axis.Points[i][j]; x != nil {
					regular++
					if math.Hypot(x.X, x.Y) > 1e-12 || axis.Normals[i][j] != nil {
						t.Fatalf("a %g c %g (%d, %d): axis point %v normal %v", a, c, i, j, x, axis.Normals[i][j])
					}
				}
			}
		}
		if regular != len(p.U)*(len(p.V)-2) || axis.Singular != regular {
			t.Fatalf("a %g c %g: %d axis points, singular %d", a, c, regular, axis.Singular)
		}
	}
}

// An elliptic cylinder (a cos u, b sin u, v) is flat along its rulings, so
// its first sheet lies at infinity and has no point. Its second is the
// cylinder over the ellipse's evolute ((a² − b²)/a cos³u, (b² − a²)/b
// sin³u): flat along the rulings again, with K = 0, and across them as
// curved as the evolute, centered on the evolute's evolute. The evolute's
// cusps, at the ellipse's vertices, are cuspidal edges.
func TestFocalProbeCylinderIsEvoluteCylinder(t *testing.T) {
	const a, b = 1.5, 1.0
	study := surfaceStudy("cylinder", a, b, 0, 0, 2*math.Pi, -1, 1, 36, 12)
	_, far := focalProbed(t, study, 1)
	for i := range far.Points {
		for j := range far.Points[i] {
			if far.Points[i][j] != nil {
				t.Fatalf("(%d, %d): a point on the sheet at infinity", i, j)
			}
		}
	}
	_, p := focalProbed(t, study, 2)
	cusps := 0
	for i, u := range p.U {
		k, l := (a*a-b*b)/a, (b*b-a*a)/b
		cu, su := math.Cos(u), math.Sin(u)
		for j, v := range p.V {
			x := p.Points[i][j]
			near(t, x, Vec3{k * cu * cu * cu, l * su * su * su, v}, 1e-12)
			if i%9 == 0 {
				if p.Normals[i][j] != nil {
					t.Fatalf("(%d, %d): a normal at the evolute's cusp", i, j)
				}
				cusps++
				continue
			}
			dx, dy := -3*k*cu*cu*su, 3*l*su*su*cu
			ddx, ddy := -3*k*(cu*cu*cu-2*cu*su*su), 3*l*(2*su*cu*cu-su*su*su)
			speed := math.Hypot(dx, dy)
			evolute := (dx*ddy - dy*ddx) / math.Pow(speed, 3)
			k1, k2 := p.Curvature[0][i][j], p.Curvature[1][i][j]
			if k1 == nil || k2 == nil {
				t.Fatalf("(%d, %d): curvature unknown", i, j)
			}
			flat, curved := *k1, *k2
			if math.Abs(flat) > math.Abs(curved) {
				flat, curved = curved, flat
			}
			if math.Abs(flat) > 1e-9*math.Abs(curved) || math.Abs(math.Abs(curved)-math.Abs(evolute)) > 1e-9*math.Abs(evolute) {
				t.Fatalf("(%d, %d): κ %g, %g; the evolute's %g", i, j, *k1, *k2, evolute)
			}
			center := Vec3{x.X - dy/speed/evolute, x.Y + dx/speed/evolute, v}
			found := false
			for b := 0; b < 2; b++ {
				if f := p.Focal[b][i][j]; f != nil && f.sub(center).norm() < 1e-9*math.Max(1, 1/math.Abs(evolute)) {
					found = true
				}
			}
			if !found {
				t.Fatalf("(%d, %d): no center at the evolute's own %v: %v, %v", i, j, center, p.Focal[0][i][j], p.Focal[1][i][j])
			}
		}
	}
	if cusps != 4*len(p.V)+len(p.V) || p.Singular != cusps || p.Clipped[0]+p.Clipped[1] != len(p.U)*len(p.V)-cusps {
		t.Fatalf("cusps %d singular %d clipped %v", cusps, p.Singular, p.Clipped)
	}
}

// A torus's focal sheets are its core circle and its axis, and a sphere's
// both its center: curves and points, singular at every point.
func TestFocalProbeDegenerateSheets(t *testing.T) {
	for _, c := range []Request{torusPatch(2, 0.7, 24, 18), sphere(1.5, 24, 12)} {
		for sheet := 1; sheet <= 2; sheet++ {
			_, p := focalProbed(t, c, sheet)
			points := 0
			for i := range p.Points {
				for j := range p.Points[i] {
					if p.Points[i][j] != nil {
						points++
						if p.Normals[i][j] != nil {
							t.Fatalf("%s sheet %d (%d, %d): a normal", c.Surface.Kind, sheet, i, j)
						}
					}
				}
			}
			if points == 0 || p.Singular != points || p.Umbilics != 0 {
				t.Fatalf("%s sheet %d: %d points, singular %d umbilics %d", c.Surface.Kind, sheet, points, p.Singular, p.Umbilics)
			}
		}
	}
}

// focalDifferences describes sheet k of q at (u, v) from central
// differences of its focal points, F = X + n/κ evaluated from the patch's
// first and second derivatives only, with the normal F_u × F_v: an
// approximation independent of the third derivatives and of the patch's
// principal directions. ok is false where the differences straddle a
// singularity.
func focalDifferences(q SurfaceRequest, k int, u, v, h, scale float64) (surfacePoint, bool) {
	at := func(du, dv float64) (Vec3, bool) {
		return q.point(u+du, v+dv, scale).focal(k, math.Inf(1))
	}
	f, ok := at(0, 0)
	fu1, ok1 := at(h, 0)
	fu0, ok2 := at(-h, 0)
	fv1, ok3 := at(0, h)
	fv0, ok4 := at(0, -h)
	f11, ok5 := at(h, h)
	f10, ok6 := at(h, -h)
	f01, ok7 := at(-h, h)
	f00, ok8 := at(-h, -h)
	if !(ok && ok1 && ok2 && ok3 && ok4 && ok5 && ok6 && ok7 && ok8) {
		return surfacePoint{}, false
	}
	fu, fv := fu1.sub(fu0).mul(1/(2*h)), fv1.sub(fv0).mul(1/(2*h))
	fuu := fu1.add(fu0).sub(f.mul(2)).mul(1 / (h * h))
	fvv := fv1.add(fv0).sub(f.mul(2)).mul(1 / (h * h))
	fuv := f11.sub(f10).sub(f01).add(f00).mul(1 / (4 * h * h))
	s := shape(f, fu, fv, fuu, fuv, fvv, false, scale)
	return s, s.Normal
}

// The focal sheet's curvatures come from the patch's third derivatives.
// Differencing the sheet's own points twice, from the patch's second
// derivatives alone, converges on the same K and |H| (the normal's sign is
// free) as h², which Richardson extrapolation removes, and gives the same
// principal directions, away from
// the cuspidal edges where the sheet has no tangent plane. The sheet's
// normal is the patch's principal direction, oriented continuously along
// u.
func TestFocalProbeMatchesDifferences(t *testing.T) {
	for _, c := range []Request{
		surfaceStudy("ellipsoid", 1.5, 1, 0.7, 0.2, 2.9, -1.2, 1.3, 16, 16),
		surfaceStudy("paraboloid", 0.8, -0.5, 0, -1.5, 1.5, -1.3, 1.6, 16, 16),
		surfaceStudy("paraboloid", 1.2, 0.4, 0, -1, 1.4, -1.1, 0.9, 16, 16),
		surfaceStudy("monkey", 0.4, 0, 0, -1, 1, -0.9, 1.1, 16, 16),
		reversed(surfaceStudy("ellipsoid", 1, 1.6, 0.8, -2.8, 0.4, -1.3, 1.1, 16, 16)),
	} {
		q := c.Surface
		_, scale, err := q.positions()
		if err != nil {
			t.Fatal(err)
		}
		for sheet := 1; sheet <= 2; sheet++ {
			_, p := focalProbed(t, c, sheet)
			_, patch := probed(t, c)
			compared := 0
			for i, u := range p.U {
				for j, v := range p.V {
					n := p.Normals[i][j]
					if n == nil {
						continue
					}
					e := patch.Direction[sheet-1][i][j]
					if math.Abs(math.Abs(n.dot(*e))-1) > 1e-12 {
						t.Fatalf("%s sheet %d (%d, %d): normal %v, direction %v", q.Kind, sheet, i, j, n, e)
					}
					// Along u, or along v on the first row.
					prior := p.Normals[0][max(j-1, 0)]
					if i > 0 {
						prior = p.Normals[i-1][j]
					}
					if prior != nil && prior.dot(*n) < 0 {
						t.Fatalf("%s sheet %d (%d, %d): normal reverses", q.Kind, sheet, i, j)
					}
					k1, k2 := p.Curvature[0][i][j], p.Curvature[1][i][j]
					if k1 == nil || k2 == nil {
						t.Fatalf("%s sheet %d (%d, %d): curvature unknown", q.Kind, sheet, i, j)
					}
					fd, ok := focalDifferences(q, sheet-1, u, v, 1e-3, scale)
					half, ok2 := focalDifferences(q, sheet-1, u, v, 5e-4, scale)
					if !ok || !ok2 {
						continue
					}
					big := math.Max(math.Abs(half.Kappa[0]), math.Abs(half.Kappa[1]))
					if big*scale > 50 {
						// Beside a cuspidal edge, where the differences lose
						// their accuracy.
						continue
					}
					// The differences' error falls as h², so Richardson's
					// (4f(h/2) − f(h))/3 leaves the next order.
					gauss := (4*half.Kappa[0]*half.Kappa[1] - fd.Kappa[0]*fd.Kappa[1]) / 3
					mean := (4*math.Abs(half.Kappa[0]+half.Kappa[1]) - math.Abs(fd.Kappa[0]+fd.Kappa[1])) / 3
					tol := 1e-6 * math.Max(big, 1/scale)
					if math.Abs(*k1**k2-gauss) > tol*math.Max(big, 1/scale) || math.Abs(math.Abs(*k1+*k2)-mean) > 2*tol {
						t.Fatalf("%s sheet %d (%d, %d): κ %g, %g; differences K %g, |2H| %g", q.Kind, sheet, i, j, *k1, *k2, gauss, mean)
					}
					fd = half
					if d := p.Direction[0][i][j]; d != nil && math.Abs(fd.Kappa[0]-fd.Kappa[1]) > 1e-2*big {
						if math.Abs(math.Abs(d.dot(fd.Dir[0]))-1) > 1e-4 && math.Abs(math.Abs(d.dot(fd.Dir[1]))-1) > 1e-4 {
							t.Fatalf("%s sheet %d (%d, %d): direction %v, differences %v", q.Kind, sheet, i, j, d, fd.Dir)
						}
					}
					compared++
				}
			}
			if compared < len(p.U)*len(p.V)/2 {
				t.Fatalf("%s sheet %d: only %d samples compared", q.Kind, sheet, compared)
			}
		}
	}
}

// The focal sheet's diagnostics are asked for apart from the patch's and
// the offset's, for sheet 1 or 2 only: refused with either, never given to
// a study that is not a surface patch, and otherwise leaving the study
// byte-identical.
func TestFocalDiagnosticsFlag(t *testing.T) {
	for _, other := range []func(*Request){
		func(c *Request) { c.SurfaceDiagnostics = true },
		func(c *Request) { c.OffsetDiagnostics = true },
	} {
		c := offsetBy(torusPatch(2, 0.7, 24, 24), 0.3)
		c.FocalDiagnostics = 1
		other(&c)
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "focalDiagnostics") {
			t.Fatalf("two probes: %v", err)
		}
	}
	for _, sheet := range []int{-1, 3} {
		c := torusPatch(2, 0.7, 24, 24)
		c.FocalDiagnostics = sheet
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "focalDiagnostics") {
			t.Fatalf("sheet %d: %v", sheet, err)
		}
	}
	mirror := surfaceStudy("paraboloid", 1, 1, 0, 0, 1, 0, 2*math.Pi, 24, 24)
	mirror.Format = "rays"
	mirror.Rays = RaysRequest{Interaction: "reflect", Light: "parallel", Azimuth: 0, Elevation: 90, Length: 1, Receiver: ReceiverRequest{Plane: "none"}}
	for _, c := range []Request{surfaceStudy("ellipsoid", 1.5, 1, 0.7, 0, 2*math.Pi, -1.4, 1.4, 30, 24), offsetBy(torusPatch(2, 0.7, 24, 24), 0.3), mirror, canalled(circle(), 0.5, "1", 4), custom("cos(t)", "sin(t)", "t", 0, 4)} {
		before, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		for sheet := 1; sheet <= 2; sheet++ {
			c.FocalDiagnostics = sheet
			after, err := Compute(c)
			if err != nil {
				t.Fatal(err)
			}
			if (after.Probe != nil) != (c.Format == "surface") {
				t.Fatalf("%s sheet %d: diagnostics %v", c.Format, sheet, after.Probe != nil)
			}
			after.Probe = nil
			x, _ := json.Marshal(before)
			y, _ := json.Marshal(after)
			if !bytes.Equal(x, y) {
				t.Fatalf("%s: the focal sheet's diagnostics changed the study", c.Format)
			}
		}
	}
	// Neither the patch's nor the offset's diagnostics carry a sheet or
	// feet.
	_, p := probed(t, torusPatch(2, 0.7, 24, 24))
	_, o := offsetProbed(t, offsetBy(torusPatch(2, 0.7, 24, 24), 0.3))
	for _, d := range []*SurfaceDiagnostics{p, o} {
		raw, _ := json.Marshal(d)
		if strings.Contains(string(raw), `"sheet"`) || strings.Contains(string(raw), `"feet"`) {
			t.Fatalf("%s diagnostics %s…", d.Kind, raw[:80])
		}
	}
}

func reversed(c Request) Request {
	c.Surface.Reverse = true
	return c
}

// focalFrame's derivatives are those of the sheet's point and normal:
// central differences of the focal point X + n/κ and of the principal
// direction e, both from the patch's second derivatives, agree with them,
// and e stays a unit vector, so its derivatives are perpendicular to it.
func TestFocalFrameDerivatives(t *testing.T) {
	const h = 1e-5
	for _, q := range []SurfaceRequest{
		{Kind: "ellipsoid", A: 1.5, B: 1, C: 0.7},
		{Kind: "ellipsoid", A: 1, B: 1.6, C: 0.8, Reverse: true},
		{Kind: "paraboloid", A: 1.2, B: 0.4},
		{Kind: "monkey", A: 0.4},
	} {
		for _, at := range [][2]float64{{0.4, 0.3}, {2.2, -0.7}, {-0.6, 0.9}} {
			u, v := at[0], at[1]
			s := q.point(u, v, 1)
			for k := 0; k < 2; k++ {
				fu, fv, m, mu, mv := q.focalFrame(u, v, s, k)
				// The direction at a neighbour, signed as e here.
				e := func(du, dv float64) Vec3 {
					d := q.point(u+du, v+dv, 1).Dir[k]
					if d.dot(m) < 0 {
						d = d.mul(-1)
					}
					return d
				}
				f := func(du, dv float64) Vec3 {
					p, _ := q.point(u+du, v+dv, 1).focal(k, math.Inf(1))
					return p
				}
				for _, c := range []struct {
					name      string
					got, want Vec3
				}{
					{"F_u", fu, f(h, 0).sub(f(-h, 0)).mul(1 / (2 * h))},
					{"F_v", fv, f(0, h).sub(f(0, -h)).mul(1 / (2 * h))},
					{"e_u", mu, e(h, 0).sub(e(-h, 0)).mul(1 / (2 * h))},
					{"e_v", mv, e(0, h).sub(e(0, -h)).mul(1 / (2 * h))},
				} {
					if c.got.sub(c.want).norm() > 1e-6*(1+c.want.norm()) {
						t.Fatalf("%s at (%g, %g) branch %d: %s %v, differences %v", q.Kind, u, v, k, c.name, c.got, c.want)
					}
				}
				if math.Abs(m.dot(mu)) > 1e-12 || math.Abs(m.dot(mv)) > 1e-12 || math.Abs(m.dot(fu)) > 1e-9*fu.norm() || math.Abs(m.dot(fv)) > 1e-9*fv.norm() {
					t.Fatalf("%s at (%g, %g) branch %d: e·e′ %g, %g; e·F′ %g, %g", q.Kind, u, v, k, m.dot(mu), m.dot(mv), m.dot(fu), m.dot(fv))
				}
			}
		}
	}
}
