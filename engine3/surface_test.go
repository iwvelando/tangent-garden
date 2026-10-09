package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// surfaceStudy is a surface patch on a u × v grid with six parameter curves
// each way and no offset or normal lines.
func surfaceStudy(kind string, a, b, c, u0, u1, v0, v1 float64, nu, nv int) Request {
	return Request{Format: "surface", Surface: SurfaceRequest{
		Kind: kind, A: a, B: b, C: c,
		UMin: u0, UMax: u1, VMin: v0, VMax: v1,
		USamples: nu, VSamples: nv, Curves: 6,
	}}
}

func sphere(r float64, nu, nv int) Request {
	return surfaceStudy("ellipsoid", r, r, r, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, nu, nv)
}

func torusPatch(R, r float64, nu, nv int) Request {
	return surfaceStudy("torus", R, r, 0, 0, 2*math.Pi, 0, 2*math.Pi, nu, nv)
}

func surfaced(t *testing.T, c Request) *SurfaceResult {
	t.Helper()
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if out.Surface == nil {
		t.Fatal("no surface result")
	}
	if _, err := json.Marshal(out); err != nil {
		t.Fatal(err)
	}
	if len(out.Base) != 0 || len(corners(out.Mesh)) != 0 || len(out.Rulings) != 0 {
		t.Fatalf("a surface study has no base curve: %d samples, %d vertices", len(out.Base), len(corners(out.Mesh)))
	}
	return out.Surface
}

// grid returns the parameters of sample (i, j).
func grid(q SurfaceRequest, i, j int) (float64, float64) {
	return lerp(q.UMin, q.UMax, i, q.USamples), lerp(q.VMin, q.VMax, j, q.VSamples)
}

// each visits every sample of a sheet that has a point.
func each(s SurfaceSheet, f func(i, j int, p Vec3)) {
	for i, column := range s.Points {
		for j, p := range column {
			if p != nil {
				f(i, j, *p)
			}
		}
	}
}

// area sums the two triangles of every face.
func area(s SurfaceSheet) float64 {
	total := 0.0
	for i, column := range s.Faces {
		for j, face := range column {
			if face {
				a, b, c, d := *s.Points[i][j], *s.Points[i+1][j], *s.Points[i+1][j+1], *s.Points[i][j+1]
				total += b.sub(a).cross(c.sub(a)).norm()/2 + c.sub(a).cross(d.sub(a)).norm()/2
			}
		}
	}
	return total
}

// The patches' first and second derivatives are exact: they agree with
// central differences of the positions.
func TestSurfacePatchDerivatives(t *testing.T) {
	for _, c := range []Request{
		surfaceStudy("ellipsoid", 1.5, 1, .7, 0, 1, 0, 1, 12, 12),
		surfaceStudy("torus", 2, .8, 0, 0, 1, 0, 1, 12, 12),
		surfaceStudy("torus", .4, 1, 0, 0, 1, 0, 1, 12, 12),
		surfaceStudy("cylinder", 1.3, .6, 0, 0, 1, 0, 1, 12, 12),
		surfaceStudy("paraboloid", .8, -1.4, 0, 0, 1, 0, 1, 12, 12),
		surfaceStudy("monkey", .6, 0, 0, 0, 1, 0, 1, 12, 12),
	} {
		q := c.Surface
		for _, at := range [][2]float64{{.3, .4}, {-1.2, 2.1}, {2.9, -.7}} {
			u, v := at[0], at[1]
			x, xu, xv, xuu, xuv, xvv := q.patch(u, v)
			h := 1e-4
			pu, _, _, _, _, _ := q.patch(u+h, v)
			mu, _, _, _, _, _ := q.patch(u-h, v)
			pv, _, _, _, _, _ := q.patch(u, v+h)
			mv, _, _, _, _, _ := q.patch(u, v-h)
			near(t, xu, pu.sub(mu).mul(1/(2*h)), 1e-7)
			near(t, xv, pv.sub(mv).mul(1/(2*h)), 1e-7)
			near(t, xuu, pu.add(mu).sub(x.mul(2)).mul(1/(h*h)), 1e-5)
			near(t, xvv, pv.add(mv).sub(x.mul(2)).mul(1/(h*h)), 1e-5)
			_, puv, _, _, _, _ := q.patch(u, v+h)
			_, muv, _, _, _, _ := q.patch(u, v-h)
			near(t, xuv, puv.sub(muv).mul(1/(2*h)), 1e-7)
		}
	}
}

// A sphere's outward normal gives κ = −1/R everywhere under A = −dn: every
// sample is an umbilic, both focal sheets collapse to the centre, and the
// offset is the sphere of radius R + d. The poles are chart singularities.
func TestSphereCurvatureFocusAndOffset(t *testing.T) {
	c := sphere(1.5, 48, 24)
	c.Surface.Offset = .4
	q := surfaced(t, c)
	if q.Singular != 2*49 || q.Umbilics != 49*23 || q.Folded != 0 {
		t.Fatalf("singular %d umbilics %d folded %d", q.Singular, q.Umbilics, q.Folded)
	}
	for j := 0; j <= 24; j++ {
		for i := 0; i <= 48; i++ {
			u, v := grid(c.Surface, i, j)
			p := c.Surface.point(u, v, 1.5)
			if j == 0 || j == 24 {
				if p.Normal || q.Surface.Normals[i][j] != nil || q.Offset.Points[i][j] != nil {
					t.Fatalf("pole sample (%d, %d) has a normal", i, j)
				}
				continue
			}
			if !p.Normal || !p.Umbilic || math.Abs(p.Kappa[0]+1/1.5) > 1e-12 || math.Abs(p.Kappa[1]+1/1.5) > 1e-12 {
				t.Fatalf("(%d, %d): %+v", i, j, p)
			}
			x := *q.Surface.Points[i][j]
			near(t, *q.Surface.Normals[i][j], x.mul(1/1.5), 1e-12)
			near(t, *q.Offset.Points[i][j], x.mul(1.9/1.5), 1e-12)
			for k := range q.Focal {
				near(t, *q.Focal[k].Points[i][j], Vec3{}, 1e-12)
			}
		}
	}
	for k, f := range q.Focal {
		if f.Shape != "point" || f.Clipped != 0 || area(f.SurfaceSheet) != 0 {
			t.Fatalf("focal sheet %d: %s, clipped %d", k+1, f.Shape, f.Clipped)
		}
	}
	// Faces touching a pole keep the surface closed there; the offset has
	// no point at the poles, so its faces stop a row short.
	for i := 0; i < 48; i++ {
		if !q.Surface.Faces[i][0] || !q.Surface.Faces[i][23] || q.Offset.Faces[i][0] || q.Offset.Faces[i][23] || !q.Offset.Faces[i][1] {
			t.Fatalf("faces beside the poles at column %d", i)
		}
	}
}

// Reversing the normal negates κ and swaps the branches; with the offset
// distance and normal reach reversed too, the offset, the normal lines and
// the focal set are unchanged.
func TestSurfaceNormalReversal(t *testing.T) {
	for _, c := range []Request{
		surfaceStudy("ellipsoid", 1.5, 1, .7, 0, 2*math.Pi, -1.4, 1.4, 36, 24),
		torusPatch(2, .8, 36, 24),
		surfaceStudy("paraboloid", .8, -1.4, 0, -1, 1, -1, 1, 24, 24),
	} {
		c.Surface.Offset, c.Surface.Reach = .3, .5
		q := surfaced(t, c)
		c.Surface.Reverse, c.Surface.Offset, c.Surface.Reach = true, -.3, -.5
		r := surfaced(t, c)
		if r.Singular != q.Singular || r.Umbilics != q.Umbilics || r.Folded != q.Folded {
			t.Fatalf("%s: counts changed", c.Surface.Kind)
		}
		each(q.Surface, func(i, j int, p Vec3) {
			near(t, *r.Surface.Normals[i][j], q.Surface.Normals[i][j].mul(-1), 1e-15)
			near(t, *r.Offset.Points[i][j], *q.Offset.Points[i][j], 1e-12)
			u, v := grid(c.Surface, i, j)
			a, b := c.Surface.point(u, v, 1), c.Surface
			b.Reverse = false
			o := b.point(u, v, 1)
			if math.Abs(a.Kappa[0]+o.Kappa[1]) > 1e-12 || math.Abs(a.Kappa[1]+o.Kappa[0]) > 1e-12 {
				t.Fatalf("κ %v reversed %v", o.Kappa, a.Kappa)
			}
		})
		for k := range q.Focal {
			f, g := q.Focal[k], r.Focal[1-k]
			if f.Shape != g.Shape || f.Clipped != g.Clipped {
				t.Fatalf("%s: branch %d %s/%d, reversed %s/%d", c.Surface.Kind, k+1, f.Shape, f.Clipped, g.Shape, g.Clipped)
			}
			each(f.SurfaceSheet, func(i, j int, p Vec3) {
				near(t, *g.Points[i][j], p, 1e-12)
			})
		}
		for k, line := range q.Lines {
			near(t, r.Lines[k].End, line.End, 1e-12)
		}
	}
}

// On a torus the meridian curvature is −1/r and the parallel curvature
// −cos v/(R + r cos v): the second is the larger, so branch 1 is the axis,
// reached through infinity at the top and bottom circles, and branch 2 the
// core circle. Both collapse to curves.
func TestTorusFocalCurves(t *testing.T) {
	c := torusPatch(2, .8, 36, 30)
	q := surfaced(t, c)
	if q.Singular != 0 || q.Umbilics != 0 {
		t.Fatalf("singular %d umbilics %d", q.Singular, q.Umbilics)
	}
	axis, core := q.Focal[0], q.Focal[1]
	if axis.Shape != "curve" || core.Shape != "curve" || core.Clipped != 0 {
		t.Fatalf("shapes %s %s, clipped %d", axis.Shape, core.Shape, core.Clipped)
	}
	for j := 0; j <= 30; j++ {
		for i := 0; i <= 36; i++ {
			u, v := grid(c.Surface, i, j)
			p := c.Surface.point(u, v, 1)
			if math.Abs(p.Kappa[0]+math.Cos(v)/(2+.8*math.Cos(v))) > 1e-12 || math.Abs(p.Kappa[1]+1/.8) > 1e-12 {
				t.Fatalf("(%d, %d) κ %v", i, j, p.Kappa)
			}
			// e₁ runs along the parallel and e₂ along the meridian.
			if math.Abs(p.Dir[0].dot(Vec3{-math.Sin(u), math.Cos(u), 0})) < 1-1e-12 || math.Abs(p.Dir[1].Z-math.Cos(v)) > 1e-12 && math.Abs(p.Dir[1].Z+math.Cos(v)) > 1e-12 {
				t.Fatalf("(%d, %d) directions %v", i, j, p.Dir)
			}
			near(t, *core.Points[i][j], Vec3{2 * math.Cos(u), 2 * math.Sin(u), 0}, 1e-12)
			if f := axis.Points[i][j]; f != nil {
				near(t, *f, Vec3{0, 0, -2 * math.Tan(v)}, 1e-9*math.Max(1, math.Abs(f.Z)))
			}
		}
	}
	// Never joined through infinity: no axis edge spans a top or bottom
	// circle, where cos v changes sign; every other joined edge does not.
	for i := 0; i <= 36; i++ {
		for j := 0; j < 30; j++ {
			_, v0 := grid(c.Surface, i, j)
			_, v1 := grid(c.Surface, i, j+1)
			through := math.Cos(v0)*math.Cos(v1) <= 0
			finite := axis.Points[i][j] != nil && axis.Points[i][j+1] != nil
			if axis.AlongV[i][j] != (finite && !through) {
				t.Fatalf("axis edge (%d, %d)–(%d, %d) joined %v", i, j, i, j+1, axis.AlongV[i][j])
			}
		}
	}
	// A collapsed branch has no faces; its parameter curves draw it.
	for _, f := range q.Focal {
		for _, column := range f.Faces {
			for _, face := range column {
				if face {
					t.Fatal("a collapsed focal branch has a face")
				}
			}
		}
	}
}

// A circular cylinder's focal set is its axis, with the ruling direction's
// branch at infinity. An elliptic cylinder's is the evolute of its
// ellipse, (ax)^⅔ + (by)^⅔ = (a² − b²)^⅔, swept along the axis: a surface.
func TestCylinderFocalSets(t *testing.T) {
	q := surfaced(t, surfaceStudy("cylinder", 1.2, 1.2, 0, 0, 2*math.Pi, -1, 1, 36, 12))
	if q.Focal[0].Shape != "none" || q.Focal[0].Clipped != 37*13 || q.Focal[1].Shape != "curve" {
		t.Fatalf("circular cylinder: %s/%d, %s", q.Focal[0].Shape, q.Focal[0].Clipped, q.Focal[1].Shape)
	}
	each(q.Focal[1].SurfaceSheet, func(i, j int, p Vec3) {
		if math.Hypot(p.X, p.Y) > 1e-12 {
			t.Fatalf("(%d, %d) off the axis: %v", i, j, p)
		}
	})
	a, b := 1.5, .9
	c := surfaceStudy("cylinder", a, b, 0, 0, 2*math.Pi, -1, 1, 72, 12)
	q = surfaced(t, c)
	if q.Focal[1].Shape != "surface" || q.Focal[1].Clipped != 0 {
		t.Fatalf("elliptic cylinder: %s/%d", q.Focal[1].Shape, q.Focal[1].Clipped)
	}
	each(q.Focal[1].SurfaceSheet, func(i, j int, p Vec3) {
		cube := func(x float64) float64 { return math.Cbrt(x * x) }
		if math.Abs(cube(a*p.X)+cube(b*p.Y)-cube(a*a-b*b)) > 1e-12 {
			t.Fatalf("(%d, %d) off the evolute: %v", i, j, p)
		}
		_, v := grid(c.Surface, i, j)
		if math.Abs(p.Z-v) > 1e-12 {
			t.Fatalf("(%d, %d) height %v", i, j, p.Z)
		}
	})
}

// At the vertex of z = (k₁x² + k₂y²)/2 the principal curvatures are k₁ and
// k₂ along the axes, and the focal points sit at heights 1/k₁ and 1/k₂.
func TestParaboloidVertex(t *testing.T) {
	c := surfaceStudy("paraboloid", -1.4, .8, 0, -1, 1, -1, 1, 12, 12)
	p := c.Surface.point(0, 0, 1)
	if math.Abs(p.Kappa[0]-.8) > 1e-15 || math.Abs(p.Kappa[1]+1.4) > 1e-15 || p.Umbilic {
		t.Fatalf("κ %v", p.Kappa)
	}
	near(t, p.Dir[0], Vec3{0, 1, 0}, 1e-15)
	if math.Abs(p.Dir[1].X) != 1 {
		t.Fatalf("e₂ %v", p.Dir[1])
	}
	q := surfaced(t, c)
	near(t, *q.Focal[0].Points[6][6], Vec3{0, 0, 1 / .8}, 1e-15)
	near(t, *q.Focal[1].Points[6][6], Vec3{0, 0, -1 / 1.4}, 1e-15)
	if q.Focal[0].Shape != "surface" || q.Focal[1].Shape != "surface" {
		t.Fatalf("shapes %s %s", q.Focal[0].Shape, q.Focal[1].Shape)
	}
	// A plane has no focal points at all.
	flat := surfaced(t, surfaceStudy("paraboloid", 0, 0, 0, -1, 1, -1, 1, 12, 12))
	if flat.Focal[0].Shape != "none" || flat.Focal[1].Shape != "none" || flat.Umbilics != 13*13 {
		t.Fatalf("plane: %s %s umbilics %d", flat.Focal[0].Shape, flat.Focal[1].Shape, flat.Umbilics)
	}
}

// Where the principal curvatures are defined, the principal directions are
// orthonormal and tangent, and they satisfy the Weingarten equation dn(eᵢ)
// = −κᵢeᵢ; a focal sheet's tangent plane is spanned by n and the other
// principal direction, so it is perpendicular to its own.
func TestPrincipalDirections(t *testing.T) {
	for _, c := range []Request{
		surfaceStudy("ellipsoid", 1.5, 1, .7, 0, 1, 0, 1, 12, 12),
		surfaceStudy("torus", 2, .8, 0, 0, 1, 0, 1, 12, 12),
		surfaceStudy("cylinder", 1.3, .6, 0, 0, 1, 0, 1, 12, 12),
		surfaceStudy("paraboloid", .8, -1.4, 0, 0, 1, 0, 1, 12, 12),
		surfaceStudy("monkey", .6, 0, 0, 0, 1, 0, 1, 12, 12),
	} {
		for _, reverse := range []bool{false, true} {
			q := c.Surface
			q.Reverse = reverse
			for _, at := range [][2]float64{{.3, .4}, {-.6, .9}, {2.9, -.7}} {
				u, v := at[0], at[1]
				p := q.point(u, v, 1)
				if !p.Normal || p.Umbilic {
					t.Fatalf("%s at %v: %+v", q.Kind, at, p)
				}
				_, xu, xv, _, _, _ := q.patch(u, v)
				e1, e2 := p.Dir[0], p.Dir[1]
				for _, d := range []float64{e1.dot(e2), e1.dot(p.N), e2.dot(p.N), e1.norm() - 1, e2.norm() - 1} {
					if math.Abs(d) > 1e-12 {
						t.Fatalf("%s at %v: frame %v %v %v", q.Kind, at, e1, e2, p.N)
					}
				}
				// Write eᵢ = αX_u + βX_v and differentiate n along it.
				h := 1e-5
				dn := func(e Vec3) Vec3 {
					g := xu.dot(xu)*xv.dot(xv) - xu.dot(xv)*xu.dot(xv)
					alpha := (e.dot(xu)*xv.dot(xv) - e.dot(xv)*xu.dot(xv)) / g
					beta := (e.dot(xv)*xu.dot(xu) - e.dot(xu)*xu.dot(xv)) / g
					at := func(du, dv float64) Vec3 { return q.point(u+du, v+dv, 1).N }
					nu := at(h, 0).sub(at(-h, 0)).mul(1 / (2 * h))
					nv := at(0, h).sub(at(0, -h)).mul(1 / (2 * h))
					return nu.mul(alpha).add(nv.mul(beta))
				}
				near(t, dn(e1), e1.mul(-p.Kappa[0]), 1e-7)
				near(t, dn(e2), e2.mul(-p.Kappa[1]), 1e-7)
				for k, e := range []Vec3{e1, e2} {
					focal := func(du, dv float64) Vec3 {
						s := q.point(u+du, v+dv, 1)
						return s.X.add(s.N.mul(1 / s.Kappa[k]))
					}
					fu := focal(h, 0).sub(focal(-h, 0)).mul(1 / (2 * h))
					fv := focal(0, h).sub(focal(0, -h)).mul(1 / (2 * h))
					if math.Abs(fu.dot(e)) > 1e-6*(1+fu.norm()) || math.Abs(fv.dot(e)) > 1e-6*(1+fv.norm()) {
						t.Fatalf("%s at %v: focal sheet %d not perpendicular to e%d", q.Kind, at, k+1, k+1)
					}
				}
			}
		}
	}
}

// Gauss–Bonnet: the total curvature of an ellipsoid is 4π, and the
// midpoint sum over the grid converges to it at second order.
func TestEllipsoidTotalCurvature(t *testing.T) {
	q := surfaceStudy("ellipsoid", 1.5, 1, .7, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 12, 12).Surface
	errors := []float64{}
	for _, n := range []int{16, 32, 64} {
		sum := 0.0
		du, dv := 2*math.Pi/float64(2*n), math.Pi/float64(n)
		for i := 0; i < 2*n; i++ {
			for j := 0; j < n; j++ {
				p := q.point(du*(float64(i)+.5), -math.Pi/2+dv*(float64(j)+.5), 1.5)
				sum += p.Kappa[0] * p.Kappa[1] * p.Area * du * dv
			}
		}
		errors = append(errors, math.Abs(sum-4*math.Pi))
	}
	if errors[2] > 1e-3 || errors[1]/errors[2] < 3.5 || errors[0]/errors[1] < 3.5 {
		t.Fatalf("errors %v", errors)
	}
}

// Steiner's formula: an offset of a torus by d inside the tube is the torus
// with minor radius r + d, of area 4π²R(r + d). Its faces converge to that
// area at second order under refinement in both directions.
func TestTorusOffsetAreaConverges(t *testing.T) {
	want := 4 * math.Pi * math.Pi * 2 * (.8 - .3)
	errors := []float64{}
	for _, n := range []int{12, 24, 48} {
		c := torusPatch(2, .8, 2*n, n)
		c.Surface.Offset = -.3
		q := surfaced(t, c)
		if q.Folded != 0 {
			t.Fatalf("folded %d", q.Folded)
		}
		errors = append(errors, math.Abs(area(*q.Offset)-want))
	}
	if errors[1]/errors[2] < 3.5 || errors[0]/errors[1] < 3.5 {
		t.Fatalf("errors %v", errors)
	}
}

// Past the core circle the offset of a torus turns inside out: its samples
// are folded wherever (1 − dκ₁)(1 − dκ₂) < 0, and it is drawn, not trimmed.
func TestOffsetFolds(t *testing.T) {
	c := torusPatch(2, .8, 36, 24)
	c.Surface.Offset = -1.2
	q := surfaced(t, c)
	if q.Folded != 37*25 {
		t.Fatalf("folded %d", q.Folded)
	}
	// Near the outer equator it is beyond the axis's focal points as well,
	// where 1 − dκ₁ < 0 too, and it is no longer folded there.
	c.Surface.Offset = -3
	q = surfaced(t, c)
	folded := 0
	for i := 0; i <= 36; i++ {
		for j := 0; j <= 24; j++ {
			u, v := grid(c.Surface, i, j)
			p := c.Surface.point(u, v, 1)
			if (1+3*p.Kappa[0])*(1+3*p.Kappa[1]) < 0 {
				folded++
			}
		}
	}
	if q.Folded != folded || folded == 0 || folded == 37*25 || area(*q.Offset) == 0 {
		t.Fatalf("folded %d, want %d", q.Folded, folded)
	}
}

// A monkey saddle's centre is a flat umbilic: both focal points are at
// infinity there, and no focal edge is joined across it. Along its axis
// line κ₁ touches zero without changing sign, so only the midpoint check
// can break the edge that passes over the centre between samples.
func TestMonkeySaddleFlatUmbilic(t *testing.T) {
	q := surfaced(t, surfaceStudy("monkey", .5, 0, 0, -1, 1, -1, 1, 12, 12))
	if q.Umbilics != 1 || q.Focal[0].Points[6][6] != nil || q.Focal[1].Points[6][6] != nil {
		t.Fatalf("umbilics %d, focal points at the centre %v %v", q.Umbilics, q.Focal[0].Points[6][6], q.Focal[1].Points[6][6])
	}
	c := surfaceStudy("monkey", .5, 0, 0, -1, 1, -1, 1, 13, 12)
	q = surfaced(t, c)
	f := q.Focal[0]
	if f.Points[6][6] == nil || f.Points[7][6] == nil {
		t.Fatal("the samples beside the centre have no focal point")
	}
	u0, _ := grid(c.Surface, 6, 6)
	u1, _ := grid(c.Surface, 7, 6)
	a, b := c.Surface.point(u0, 0, 1), c.Surface.point(u1, 0, 1)
	if a.Kappa[0] <= 0 || b.Kappa[0] <= 0 {
		t.Fatalf("κ₁ %v %v", a.Kappa[0], b.Kappa[0])
	}
	if f.AlongU[6][6] {
		t.Fatal("focal edge joined across the flat centre")
	}
	if !f.AlongU[5][6] || !f.AlongU[7][6] {
		t.Fatal("the neighbouring focal edges are broken")
	}
}

// A focal edge is joined only when the branch cannot have passed through
// infinity between its ends.
func TestFocalContinuity(t *testing.T) {
	up, mid, down := Vec3{0, 0, 2}, Vec3{0, 0, 1}, Vec3{0, 0, -1}
	for _, tc := range []struct {
		k0, k1 float64
		p0, p1 Vec3
		middle *Vec3
		want   bool
	}{
		{.5, 2, up, Vec3{0, 0, .5}, &Vec3{0, 0, 1}, true},
		// κ grows, then falls through zero: the midpoint lies between the
		// ends, but the sign has changed.
		{.5, -1, up, down, &mid, false},
		{.5, 2, up, Vec3{0, 0, .5}, nil, false},
		// A curved edge joins; touching zero between samples sends the
		// midpoint beyond both ends.
		{.5, .5, up, Vec3{1, 0, 2}, &Vec3{.5, 0, 2.3}, true},
		{.5, .5, up, Vec3{1, 0, 2}, &Vec3{.5, 0, 40}, false},
		{.5, .5, up, Vec3{0, 0, 3}, &Vec3{0, 0, 40}, false},
		// A collapsed edge joins despite rounding.
		{.5, .5, up, up, &Vec3{0, 0, 2 + 1e-16}, true},
	} {
		if got := continues(tc.k0, tc.k1, tc.p0, tc.p1, tc.middle, 1); got != tc.want {
			t.Fatalf("%+v: got %v", tc, got)
		}
	}
}

// A spindle torus (R < r) passes through its axis, where the chart is
// singular; the samples there have no normal, no offset and no focal point.
func TestSpindleTorusSingularities(t *testing.T) {
	// cos v = −R/r = −½ at v = 2π/3 and 4π/3, both on a grid of 24.
	c := torusPatch(.5, 1, 24, 24)
	c.Surface.Offset = .2
	q := surfaced(t, c)
	if q.Singular != 2*25 {
		t.Fatalf("singular %d", q.Singular)
	}
	for i := 0; i <= 24; i++ {
		for _, j := range []int{8, 16} {
			if q.Surface.Normals[i][j] != nil || q.Offset.Points[i][j] != nil || q.Focal[0].Points[i][j] != nil || q.Focal[1].Points[i][j] != nil {
				t.Fatalf("singular sample (%d, %d) has a normal", i, j)
			}
		}
	}
}

// Normal lines stand at the crossings of the representative parameter
// curves, reaching ℓ along the normal: inwards on a torus with ℓ = −r, each
// ends on the core circle.
func TestNormalLinesAndParameterCurves(t *testing.T) {
	c := torusPatch(2, .8, 36, 24)
	c.Surface.Curves, c.Surface.Reach = 7, -.8
	q := surfaced(t, c)
	if len(q.UCurves) != 7 || len(q.VCurves) != 7 || q.UCurves[6] != 24 || q.VCurves[6] != 36 || q.VCurves[1] != 6 || q.UCurves[1] != 4 {
		t.Fatalf("curves %v %v", q.UCurves, q.VCurves)
	}
	if len(q.Lines) != 49 {
		t.Fatalf("%d normal lines", len(q.Lines))
	}
	for _, line := range q.Lines {
		near(t, line.Point, *q.Surface.Points[line.I][line.J], 0)
		u, _ := grid(c.Surface, line.I, line.J)
		near(t, line.End, Vec3{2 * math.Cos(u), 2 * math.Sin(u), 0}, 1e-12)
	}
	// More curves than samples repeat nothing.
	c = surfaceStudy("paraboloid", 1, 1, 0, -1, 1, -1, 1, 12, 12)
	c.Surface.Curves = 48
	if q = surfaced(t, c); len(q.UCurves) != 13 || len(q.VCurves) != 13 || len(q.Lines) != 0 {
		t.Fatalf("curves %v, %d lines", q.UCurves, len(q.Lines))
	}
	// No offset leaves no offset sheet.
	if q.Offset != nil {
		t.Fatal("offset sheet without an offset")
	}
}

// Edges and faces: a closed torus is joined everywhere, and its bounds hold
// the surface, the normal lines, and the focal axis within its fences.
func TestSurfaceSheetsAndBounds(t *testing.T) {
	c := torusPatch(2, .8, 36, 24)
	c.Surface.Reach, c.Surface.Curves = 1, 7
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	s := out.Surface.Surface
	if len(s.Points) != 37 || len(s.Points[0]) != 25 || len(s.AlongU) != 36 || len(s.AlongU[0]) != 25 || len(s.AlongV) != 37 || len(s.AlongV[0]) != 24 || len(s.Faces) != 36 || len(s.Faces[0]) != 24 {
		t.Fatal("sheet sizes")
	}
	for i := range s.Faces {
		for j := range s.Faces[i] {
			if !s.Faces[i][j] || !s.AlongU[i][j] || !s.AlongV[i][j] {
				t.Fatalf("cell (%d, %d) not joined", i, j)
			}
		}
	}
	near(t, out.Bounds.Center, Vec3{}, 1e-9)
	if out.Bounds.Radius < 3.8-1e-9 || out.Bounds.Radius > 8 || out.Radius != out.Bounds.Radius {
		t.Fatalf("bounds %+v", out.Bounds)
	}
}

func TestSurfaceValidation(t *testing.T) {
	ok := func() Request {
		c := torusPatch(2, .8, 36, 24)
		c.Surface.Reach, c.Surface.Offset = .5, .2
		return c
	}
	for _, tc := range []struct {
		change func(*SurfaceRequest)
		want   string
	}{
		{func(q *SurfaceRequest) { q.Kind = "klein" }, "unknown surface"},
		{func(q *SurfaceRequest) { q.Kind, q.A = "ellipsoid", 0 }, "semi-axes"},
		{func(q *SurfaceRequest) { q.Kind, q.A, q.C = "ellipsoid", 1, math.Inf(1) }, "semi-axes"},
		{func(q *SurfaceRequest) { q.B = 0 }, "minor radius"},
		{func(q *SurfaceRequest) { q.A = -1 }, "major radius"},
		{func(q *SurfaceRequest) { q.Kind, q.B = "cylinder", -1 }, "semi-axes"},
		{func(q *SurfaceRequest) { q.Kind, q.A = "paraboloid", math.NaN() }, "curvatures"},
		{func(q *SurfaceRequest) { q.Kind, q.A = "monkey", 2e5 }, "height"},
		{func(q *SurfaceRequest) { q.Kind, q.A, q.UMin, q.UMax = "monkey", 1e5, -5e4, 5e4 }, "no finite point"},
		{func(q *SurfaceRequest) { q.UMax = q.UMin }, "u domain"},
		{func(q *SurfaceRequest) { q.VMin = math.NaN() }, "v domain"},
		{func(q *SurfaceRequest) { q.USamples = 11 }, "samples"},
		{func(q *SurfaceRequest) { q.USamples, q.VSamples = 240, 61 }, "samples"},
		{func(q *SurfaceRequest) { q.Curves = 1 }, "parameter curves"},
		{func(q *SurfaceRequest) { q.Curves = 49 }, "parameter curves"},
		{func(q *SurfaceRequest) { q.Offset = math.Inf(-1) }, "offset"},
		{func(q *SurfaceRequest) { q.Reach = math.NaN() }, "normal reach"},
		{func(q *SurfaceRequest) { q.Reach = -2e5 }, "normal reach"},
	} {
		c := ok()
		tc.change(&c.Surface)
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("want %q, got %v", tc.want, err)
		}
	}
	// The curve's own fields are not validated for a surface.
	c := ok()
	c.Samples, c.Lines, c.Length, c.Construction = 0, 0, -1, "involute"
	if _, err := Compute(c); err != nil {
		t.Fatal(err)
	}
	// The largest grid is accepted.
	c.Surface.USamples, c.Surface.VSamples = 240, 60
	if _, err := Compute(c); err != nil {
		t.Fatal(err)
	}
}

func TestSurfaceJSON(t *testing.T) {
	var c Request
	if err := json.Unmarshal([]byte(`{"format":"surface","surface":{"kind":"ellipsoid","a":1,"b":2,"c":3,"uMin":0,"uMax":1,"vMin":-1,"vMax":1,"uSamples":12,"vSamples":14,"curves":5,"reverse":true,"offset":-0.5,"reach":0.25}}`), &c); err != nil {
		t.Fatal(err)
	}
	want := SurfaceRequest{"ellipsoid", 1, 2, 3, 0, 1, -1, 1, 12, 14, 5, true, -.5, .25}
	if c.Surface != want {
		t.Fatalf("%+v", c.Surface)
	}
	c.Surface.Offset = 0
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(out)
	for _, key := range []string{`"surface":{"surface":{"points":`, `"alongU":`, `"alongV":`, `"faces":`, `"offset":null`, `"focal":[{"points":`, `"shape":`, `"clipped":`, `"lines":[{"i":0,"j":0,"point":`, `"uCurves":`, `"vCurves":`, `"singular":`, `"umbilics":`, `"folded":`} {
		if !strings.Contains(string(b), key) {
			t.Fatalf("missing %s", key)
		}
	}
}
