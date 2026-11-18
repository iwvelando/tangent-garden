package engine3

import (
	"encoding/json"
	"fmt"
	"math"
	"testing"
)

// The helicoid–catenoid family's offsets, focal sheets, cuspidal edges and
// ridges, checked against closed forms written out here: with the forward
// normal N = (cos u, sin u, −sinh v)/cosh v (see gaussMap), κ₁ = 1/(s
// cosh²v) = −κ₂, so the offset X + dN folds where |d| > s cosh²v, its
// cuspidal edges are the u-lines v = ±acosh √(|d|/s), and the focal sheets
// are X ± s cosh²v N. κ is stationary along its line of curvature only at
// v = 0, the ridge, whose centers lie on the helices of radius s(1 ± sin θ)
// rising s cos θ per radian of u.

// constructed is the family at scale s and angle theta over [u0, u1] ×
// [v0, v1] with its focal sheets.
func constructed(s, theta, u0, u1, v0, v1 float64, nu, nv int) Request {
	c := associateStudy(s, theta, u0, u1, v0, v1, nu, nv)
	c.Surface.Focal = true
	return c
}

// focalX is the center of curvature of branch k (0 or 1) at (u, v) with the
// forward normal: X + n/κ with κ₁ = 1/(s cosh²v) = −κ₂.
func focalX(s, theta, u, v float64, k int) Vec3 {
	r := s * math.Cosh(v) * math.Cosh(v)
	if k == 1 {
		r = -r
	}
	return associateX(s, theta, u, v).add(gaussMap(u, v).mul(r))
}

// edgeV is where the offset d folds: v = acosh √(|d|/s), for |d| > s.
func edgeV(s, d float64) float64 { return math.Acosh(math.Sqrt(math.Abs(d) / s)) }

// spanOf returns the smallest and largest of xs.
func spanOf(xs []float64) (float64, float64) {
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, x := range xs {
		lo, hi = math.Min(lo, x), math.Max(hi, x)
	}
	return lo, hi
}

// pointProbedAs describes target ("surface", "offset", "focal1" or
// "focal2") at the one point (u, v).
func pointProbedAs(t *testing.T, c Request, target string, u, v float64) (Result, *SurfaceDiagnostics) {
	t.Helper()
	return pointProbed(t, probedAs(c, target), u, v)
}

func jsonOf(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// The family computes its focal sheets only when the study asks for them:
// without them its result has no focal sheet, its ridges and focal
// diagnostics are refused, and asking for them changes nothing but the
// sheets and the bounds. Its offset, edges and offset diagnostics need no
// such request. Other kinds always have their focal sheets and ignore it.
func TestAssociateFocalSheetsOnRequest(t *testing.T) {
	off := associateStudy(1, 0.6, -2.5, 2.5, -1.2, 1.2, 40, 24)
	out := surfaced(t, off)
	if len(out.Focal) != 0 || out.Ridges != nil {
		t.Fatalf("focal sheets without a request: %d sheets, ridges %v", len(out.Focal), out.Ridges)
	}
	ridged := withRidges(off)
	if _, err := Compute(ridged); fieldOf(err) != "surface.ridges" {
		t.Fatalf("ridges without focal sheets: %v, want a refusal of surface.ridges", err)
	}
	for _, target := range []string{"focal1", "focal2"} {
		if _, err := Compute(probedAs(off, target)); err == nil {
			t.Fatalf("%s diagnostics without focal sheets were computed", target)
		}
	}
	offset := withEdges(off, 2)
	if r, err := Compute(probedAs(offset, "offset")); err != nil || r.Probe == nil {
		t.Fatalf("offset diagnostics on the family: %v", err)
	}
	if o := surfaced(t, offset); o.Offset == nil || o.Edges == nil || len(*o.Edges) != 2 || len(o.Focal) != 0 {
		t.Fatalf("the family's offset: offset %v, edges %v, %d focal sheets", o.Offset != nil, o.Edges, len(o.Focal))
	}

	on := off
	on.Surface.Focal = true
	with := surfaced(t, on)
	if len(with.Focal) != 2 {
		t.Fatalf("%d focal sheets on request, want 2", len(with.Focal))
	}
	if jsonOf(t, with.Surface) != jsonOf(t, out.Surface) || jsonOf(t, with.Lines) != jsonOf(t, out.Lines) {
		t.Fatal("asking for focal sheets changed the patch")
	}
	for _, target := range []string{"focal1", "focal2"} {
		if _, err := Compute(probedAs(on, target)); err != nil {
			t.Fatalf("%s diagnostics with focal sheets: %v", target, err)
		}
	}
	if _, err := Compute(withRidges(on)); err != nil {
		t.Fatalf("ridges with focal sheets: %v", err)
	}

	for _, c := range []Request{sphere(1.3, 24, 12), torusPatch(2, 0.7, 24, 12)} {
		asked := c
		asked.Surface.Focal = true
		a, b := Compute(c)
		x, y := Compute(asked)
		if b != nil || y != nil || jsonOf(t, a) != jsonOf(t, x) || len(a.Surface.Focal) != 2 {
			t.Fatalf("%s: focal ignored? %v %v", c.Surface.Kind, b, y)
		}
	}
}

// The offset is X + dN at every sample, with the patch's normal, for
// either sign of d, at both end angles and between, at scales far apart.
// It has folded exactly where |d| > s cosh²v. Reversing the normal with
// −d leaves it, its folds and its edges unchanged and swaps the focal
// sheets' numbers.
func TestAssociateOffsetIsXPlusDN(t *testing.T) {
	for _, s := range []float64{1, 1e-3, 2500} {
		for _, theta := range []float64{0, 0.7, math.Pi / 2} {
			for _, d := range []float64{2.3 * s, -3.1 * s, 0.4 * s} {
				c := withEdges(constructed(s, theta, -2.6, 2.6, -1.3, 1.25, 52, 30), d)
				out := surfaced(t, c)
				folded := 0
				each(*out.Offset, func(i, j int, p Vec3) {
					u, v := grid(c.Surface, i, j)
					what := fmt.Sprintf("s %g θ %g d %g (%d, %d)", s, theta, d, i, j)
					associateNear(t, what, p, associateX(s, theta, u, v).add(gaussMap(u, v).mul(d)), 1e-13*s*12)
					associateNear(t, what+" normal", *out.Offset.Normals[i][j], gaussMap(u, v), 1e-14)
					if math.Abs(d) > s*math.Cosh(v)*math.Cosh(v) {
						folded++
					}
				})
				if folded != out.Folded {
					t.Fatalf("s %g θ %g d %g: %d samples folded, want %d", s, theta, d, out.Folded, folded)
				}
				if (folded == 0) != (math.Abs(d) <= s) {
					t.Fatalf("s %g θ %g d %g: fixture folds %d samples", s, theta, d, folded)
				}

				back := reversed(c)
				back.Surface.Offset = -d
				rev := surfaced(t, back)
				if jsonOf(t, rev.Offset.Points) != jsonOf(t, out.Offset.Points) || rev.Folded != out.Folded {
					t.Fatalf("s %g θ %g d %g: reversing n with d moved the offset", s, theta, d)
				}
				if len(*rev.Edges) != len(*out.Edges) {
					t.Fatalf("s %g θ %g d %g: %d edges reversed, %d forward", s, theta, d, len(*rev.Edges), len(*out.Edges))
				}
				for k, e := range *out.Edges {
					if r := (*rev.Edges)[k]; r.Branch != 3-e.Branch || jsonOf(t, r.Points) != jsonOf(t, e.Points) {
						t.Fatalf("s %g θ %g d %g: edge %d reversed is branch %d, forward %d", s, theta, d, k, r.Branch, e.Branch)
					}
				}
				for k := range 2 {
					if jsonOf(t, rev.Focal[k].Points) != jsonOf(t, out.Focal[1-k].Points) {
						t.Fatalf("s %g θ %g: reversed focal sheet %d is not forward sheet %d", s, theta, k+1, 2-k)
					}
				}
			}
		}
	}
}

// The offset's tangents are (I − dA) dX: central differences of the
// returned offset along u and v converge at second order on X_u + dN_u and
// X_v + dN_v, from the closed forms, and the offset's normal is the
// patch's.
func TestAssociateOffsetTangents(t *testing.T) {
	const s, theta, d = 1.4, 0.9, 2.1
	tangent := func(u, v float64) (Vec3, Vec3) {
		c, a := math.Cos(theta), math.Sin(theta)
		cu, su, ch, sh := math.Cos(u), math.Sin(u), math.Cosh(v), math.Sinh(v)
		xu := Vec3{s * (c*sh*cu - a*ch*su), s * (c*sh*su + a*ch*cu), s * c}
		xv := Vec3{s * (c*ch*su + a*sh*cu), s * (-c*ch*cu + a*sh*su), s * a}
		nu := Vec3{-su / ch, cu / ch, 0}
		nv := Vec3{-cu * sh / (ch * ch), -su * sh / (ch * ch), -1 / (ch * ch)}
		return xu.add(nu.mul(d)), xv.add(nv.mul(d))
	}
	errorAt := func(n int) float64 {
		c := constructed(s, theta, -1, 1, -1, 1, n, n)
		c.Surface.Offset = d
		out := surfaced(t, c)
		h := 2.0 / float64(n)
		worst := 0.0
		for _, i := range []int{n / 4, n / 2, 3 * n / 4} {
			for _, j := range []int{n / 4, n / 2, 3 * n / 4} {
				p := out.Offset.Points
				du := p[i+1][j].sub(*p[i-1][j]).mul(1 / (2 * h))
				dv := p[i][j+1].sub(*p[i][j-1]).mul(1 / (2 * h))
				u, v := grid(c.Surface, i, j)
				wu, wv := tangent(u, v)
				worst = math.Max(worst, math.Max(du.sub(wu).norm(), dv.sub(wv).norm()))
				if n := gaussMap(u, v); math.Abs(wu.dot(n)) > 1e-14 || math.Abs(wv.dot(n)) > 1e-14 {
					t.Fatalf("the closed-form offset tangent leaves the tangent plane at (%g, %g)", u, v)
				}
			}
		}
		return worst
	}
	coarse, fine := errorAt(24), errorAt(48)
	if ratio := coarse / fine; !(ratio > 3.6 && ratio < 4.4) || !(fine < 1e-2) {
		t.Fatalf("offset tangent error %g then %g (ratio %g), want second order", coarse, fine, ratio)
	}
}

// The offset's own curvatures are κᵢ/(1 − dκᵢ): 1/(s cosh²v − d) and
// −1/(s cosh²v + d), with the patch's principal directions, at the grid's
// samples and between them; it folds and is singular exactly as the
// closed form says.
func TestAssociateOffsetProbeCurvatures(t *testing.T) {
	const s, theta, d = 0.8, 0.45, 1.7
	c := constructed(s, theta, -2, 2, -1.1, 1.3, 32, 24)
	c.Surface.Offset = d
	_, probe := offsetProbed(t, c)
	check := func(what string, p *SurfaceDiagnostics, row, column int, v float64) {
		t.Helper()
		r := s * math.Cosh(v) * math.Cosh(v)
		want := [2]float64{1 / (r - d), -1 / (r + d)}
		if fold := d > r; p.Folds[row][column] != fold {
			t.Fatalf("%s: folded %v, want %v", what, p.Folds[row][column], fold)
		}
		for k := range 2 {
			got := p.Curvature[k][row][column]
			if got == nil {
				t.Fatalf("%s: κ%d missing", what, k+1)
			}
			if math.Abs(*got-want[k]) > 1e-10*math.Abs(want[k]) {
				t.Fatalf("%s: κ%d = %g, want %g", what, k+1, *got, want[k])
			}
		}
	}
	for row := range probe.U {
		for column := range probe.V {
			check(fmt.Sprintf("(%d, %d)", row, column), probe, row, column, probe.V[column])
		}
	}
	for _, at := range [][2]float64{{0.31, 0.2}, {-1.7, 1.21}, {1.9, -0.95}} {
		_, p := pointProbedAs(t, c, "offset", at[0], at[1])
		check(fmt.Sprintf("point (%g, %g)", at[0], at[1]), p, 0, 0, at[1])
		associateNear(t, "point", *p.Points[0][0], associateX(s, theta, at[0], at[1]).add(gaussMap(at[0], at[1]).mul(d)), 1e-13*s*10)
	}
}

// The offset's cuspidal edges are the u-lines v = ±acosh √(|d|/s), on
// branch 1 for d > 0 and branch 2 for d < 0: two open edges across the
// whole patch, each point within 10⁻⁹ of its line and at X + dN, keeping
// their (u, v) at every angle. An offset within s has none, and one exactly
// s from the waist, which it only touches, neither folds nor has an edge,
// even with the waist on a sample row; one just beyond it has both. An edge
// landing on a sample row is still one edge each side.
func TestAssociateOffsetEdgesLieOnTheirVLines(t *testing.T) {
	type place struct{ i, j []float64 }
	for _, s := range []float64{1, 0.37, 2500} {
		for _, d := range []float64{2 * s, -3.1 * s} {
			var first []place
			for _, theta := range []float64{0, 0.7, 1.3, math.Pi / 2} {
				c := withEdges(constructed(s, theta, -2.6, 2.6, -1.3, 1.25, 52, 30), d)
				out := surfaced(t, c)
				what := fmt.Sprintf("s %g θ %g d %g", s, theta, d)
				if len(*out.Edges) != 2 {
					t.Fatalf("%s: %d edges, want 2", what, len(*out.Edges))
				}
				vc, branch := edgeV(s, d), 1
				if d < 0 {
					branch = 2
				}
				places := []place{}
				signs := map[bool]bool{}
				for k, e := range *out.Edges {
					if e.Branch != branch || e.Closed {
						t.Fatalf("%s: edge %d branch %d closed %v", what, k, e.Branch, e.Closed)
					}
					if lo, hi := spanOf(e.I); lo != 0 || hi != 52 {
						t.Fatalf("%s: edge %d spans i %g–%g, not the whole patch", what, k, lo, hi)
					}
					us, vs := params(c.Surface, e)
					for m := range e.Points {
						if math.Abs(math.Abs(vs[m])-vc) > 1e-9 {
							t.Fatalf("%s: edge %d point %d at v = %v, not ±%v", what, k, m, vs[m], vc)
						}
						associateNear(t, what, e.Points[m], associateX(s, theta, us[m], vs[m]).add(gaussMap(us[m], vs[m]).mul(d)), 1e-9*s*20)
					}
					signs[vs[0] > 0] = true
					places = append(places, place{e.I, e.J})
				}
				if len(signs) != 2 {
					t.Fatalf("%s: both edges on one side of the waist", what)
				}
				if first == nil {
					first = places
				} else if jsonOf(t, first) != jsonOf(t, places) {
					t.Fatalf("%s: the edges moved in (u, v) as θ changed", what)
				}
			}
		}
		for _, d := range []float64{0.6 * s, s, -s, 1.000001 * s, -1.000001 * s} {
			for _, theta := range []float64{0, 0.7, math.Pi / 2} {
				// v = 0 is a sample row, where an offset of exactly s
				// touches the focal sheet.
				out := surfaced(t, withEdges(constructed(s, theta, -2.6, 2.6, -1.2, 1.2, 52, 48), d))
				what := fmt.Sprintf("s %g θ %g d %g", s, theta, d)
				if math.Abs(d) <= s {
					if out.Folded != 0 || len(*out.Edges) != 0 {
						t.Fatalf("%s: %d folded, %d edges, want none", what, out.Folded, len(*out.Edges))
					}
					// The offset probe agrees: nothing folded, and the
					// waist singular exactly where it touches.
					_, p := offsetProbed(t, withEdges(constructed(s, theta, -2.6, 2.6, -1.2, 1.2, 52, 48), d))
					for i := range p.Folds {
						for j, fold := range p.Folds[i] {
							if fold {
								t.Fatalf("%s: the probe folds at (%d, %d)", what, i, j)
							}
						}
					}
					if want := map[bool]int{true: 53, false: 0}[math.Abs(d) == s]; p.Singular != want {
						t.Fatalf("%s: the probe has %d singular samples, want %d", what, p.Singular, want)
					}
					continue
				}
				// Only the waist's row lies within v_c ≈ 0.001.
				if out.Folded != 53 || len(*out.Edges) != 2 {
					t.Fatalf("%s: %d folded, %d edges, want the waist's 53 and 2", what, out.Folded, len(*out.Edges))
				}
				for k, e := range *out.Edges {
					_, vs := params(constructed(s, theta, -2.6, 2.6, -1.2, 1.2, 52, 48).Surface, e)
					for _, v := range vs {
						if math.Abs(math.Abs(v)-edgeV(s, d)) > 1e-9 {
							t.Fatalf("%s: edge %d at v %v, want ±%v", what, k, v, edgeV(s, d))
						}
					}
				}
			}
		}
	}
	// d = s cosh²v at a sample row: the edges land on rows 6 and 42.
	const s = 1.3
	c := constructed(s, 0.4, -2, 2, -1.2, 1.2, 40, 48)
	_, row := grid(c.Surface, 0, 42)
	d := s * math.Cosh(row) * math.Cosh(row)
	out := surfaced(t, withEdges(c, d))
	if len(*out.Edges) != 2 {
		t.Fatalf("edges on a row: %d, want 2", len(*out.Edges))
	}
	for k, e := range *out.Edges {
		_, vs := params(c.Surface, e)
		if lo, hi := spanOf(e.I); lo != 0 || hi != 40 {
			t.Fatalf("edge %d on a row spans i %g–%g", k, lo, hi)
		}
		for _, v := range vs {
			if math.Abs(math.Abs(v)-row) > 1e-9 {
				t.Fatalf("edge %d on a row at v = %v, want ±%v", k, v, row)
			}
		}
	}
}

// The focal sheets are X ± s cosh²v N, each normal to its own principal
// direction, surfaces at every angle below π/2. At π/2 the second is the
// stretch of the axis (0, 0, s(v + sinh v cosh v)), a curve, and the first
// the surface of revolution of the catenary's evolute (2s cosh v, s(v −
// sinh v cosh v)). Just below π/2 the second is still a thin surface
// beside the axis.
func TestAssociateFocalSheetsClosedForm(t *testing.T) {
	for _, s := range []float64{1, 0.02, 900} {
		for _, theta := range []float64{0, 0.5, 1.2, math.Pi/2 - 1e-6, math.Pi / 2} {
			for _, reverse := range []bool{false, true} {
				c := constructed(s, theta, -2.4, 2.4, -1.3, 1.25, 36, 30)
				c.Surface.Reverse = reverse
				out := surfaced(t, c)
				what := fmt.Sprintf("s %g θ %g reverse %v", s, theta, reverse)
				for k, f := range out.Focal {
					// Reversal swaps the numbers, not the geometry.
					branch := k
					if reverse {
						branch = 1 - k
					}
					count := 0
					each(f.SurfaceSheet, func(i, j int, p Vec3) {
						count++
						u, v := grid(c.Surface, i, j)
						associateNear(t, fmt.Sprintf("%s sheet %d (%d, %d)", what, k+1, i, j), p, focalX(s, theta, u, v, branch), 1e-12*s*20)
						if m := f.Normals[i][j]; m != nil && math.Abs(m.dot(gaussMap(u, v))) > 1e-12 {
							t.Fatalf("%s sheet %d: normal %v not tangent to the patch", what, k+1, *m)
						}
					})
					if count != 37*31 || f.Clipped != 0 {
						t.Fatalf("%s sheet %d: %d points, %d clipped", what, k+1, count, f.Clipped)
					}
					shape := "surface"
					if theta == math.Pi/2 && branch == 1 {
						shape = "curve"
					}
					if f.Shape != shape {
						t.Fatalf("%s sheet %d is a %s, want a %s", what, k+1, f.Shape, shape)
					}
				}
				if theta != math.Pi/2 {
					continue
				}
				axis, evolute := out.Focal[1], out.Focal[0]
				if reverse {
					axis, evolute = evolute, axis
				}
				each(axis.SurfaceSheet, func(i, j int, p Vec3) {
					_, v := grid(c.Surface, i, j)
					associateNear(t, what+" axis", p, Vec3{0, 0, s * (v + math.Sinh(v)*math.Cosh(v))}, 1e-12*s*20)
				})
				each(evolute.SurfaceSheet, func(i, j int, p Vec3) {
					_, v := grid(c.Surface, i, j)
					if r := math.Hypot(p.X, p.Y); math.Abs(r-2*s*math.Cosh(v)) > 1e-12*s*20 || math.Abs(p.Z-s*(v-math.Sinh(v)*math.Cosh(v))) > 1e-12*s*20 {
						t.Fatalf("%s: evolute point %v at v %g", what, p, v)
					}
				})
			}
		}
	}
}

// Over the ridge v = 0 each focal sheet folds back in a cuspidal edge, along
// its own principal direction e₁ (sheet 1) or e₂ (sheet 2). Below π/2 that
// direction lies at an angle to the grid, so the grid's curves cross the
// edge without turning back and the sheet is drawn joined, creased along
// it. On the catenoid e₁ is the meridian: sheet 1's v-curves, the
// evolute's meridians, turn back at its cusp, so the grid edge across the
// waist between two rows is left unjoined, a gap round the cusp circle,
// while one that ends on a row at the cusp is joined to it.
func TestAssociateFocalSheetsFoldAtTheWaist(t *testing.T) {
	joinedExcept := func(what string, f FocalSheet, gap int) {
		t.Helper()
		for i := range f.AlongV {
			for j, joined := range f.AlongV[i] {
				if joined == (j == gap) {
					t.Fatalf("%s: v edge (%d, %d) joined %v", what, i, j, joined)
				}
			}
		}
	}
	cusp := int(math.Floor(1.17 / (2.37 / 48)))
	for _, theta := range []float64{0, 0.8, math.Pi / 2} {
		between := surfaced(t, constructed(1, theta, -2, 2, -1.17, 1.2, 24, 48))
		on := surfaced(t, constructed(1, theta, -2, 2, -1.2, 1.2, 24, 48))
		for k := range 2 {
			if theta == math.Pi/2 && k == 1 {
				continue // the axis, a curve
			}
			gap := -1
			if theta == math.Pi/2 {
				gap = cusp
			}
			joinedExcept(fmt.Sprintf("θ %g sheet %d between rows", theta, k+1), between.Focal[k], gap)
			joinedExcept(fmt.Sprintf("θ %g sheet %d on a row", theta, k+1), on.Focal[k], -1)
		}
	}
}

// focalByDifferences returns the Gaussian and mean curvature of focal sheet
// k at (u, v) from central differences of its closed form, with its own
// normal F_u × F_v, by the first and second fundamental forms.
func focalByDifferences(s, theta, u, v float64, k int, h float64) (float64, float64) {
	f := func(du, dv float64) Vec3 { return focalX(s, theta, u+du, v+dv, k) }
	fu := f(h, 0).sub(f(-h, 0)).mul(1 / (2 * h))
	fv := f(0, h).sub(f(0, -h)).mul(1 / (2 * h))
	fuu := f(h, 0).add(f(-h, 0)).sub(f(0, 0).mul(2)).mul(1 / (h * h))
	fvv := f(0, h).add(f(0, -h)).sub(f(0, 0).mul(2)).mul(1 / (h * h))
	fuv := f(h, h).sub(f(h, -h)).sub(f(-h, h)).add(f(-h, -h)).mul(1 / (4 * h * h))
	n := fu.cross(fv)
	n = n.mul(1 / n.norm())
	E, F, G := fu.dot(fu), fu.dot(fv), fv.dot(fv)
	L, M, N := fuu.dot(n), fuv.dot(n), fvv.dot(n)
	det := E*G - F*F
	return (L*N - M*M) / det, (E*N - 2*F*M + G*L) / (2 * det)
}

// The focal probe's curvatures, from the patch's third derivatives, agree
// with differences of the sheets' closed forms, Richardson-extrapolated
// (K exactly, H up to the normal's sign), away from the ridge. On the
// ridge row each sheet has no tangent plane, so its samples are singular.
func TestAssociateFocalProbeMatchesClosedForm(t *testing.T) {
	const s = 1.2
	for _, theta := range []float64{0, 0.6, 1.3} {
		for sheet := 1; sheet <= 2; sheet++ {
			c := constructed(s, theta, -2, 2, -1.2, 1.2, 16, 24)
			_, d := focalProbed(t, c, sheet)
			for row := range d.U {
				for column, v := range d.V {
					what := fmt.Sprintf("θ %g sheet %d (%d, %d)", theta, sheet, row, column)
					if column == 12 {
						if d.Normals[row][column] != nil || d.Curvature[0][row][column] != nil {
							t.Fatalf("%s: the ridge sample has a tangent plane", what)
						}
						continue
					}
					if math.Abs(v) < 0.2 {
						continue
					}
					K1, H1 := focalByDifferences(s, theta, d.U[row], v, sheet-1, 1e-3)
					K2, H2 := focalByDifferences(s, theta, d.U[row], v, sheet-1, 5e-4)
					K, H := (4*K2-K1)/3, (4*H2-H1)/3
					k1, k2 := d.Curvature[0][row][column], d.Curvature[1][row][column]
					if k1 == nil || k2 == nil {
						t.Fatalf("%s: curvatures missing", what)
					}
					scale := math.Abs(*k1) + math.Abs(*k2)
					if math.Abs(*k1**k2-K) > 1e-6*scale*scale {
						t.Fatalf("%s: K = %g, differences give %g", what, *k1**k2, K)
					}
					if math.Abs(math.Abs((*k1+*k2)/2)-math.Abs(H)) > 1e-6*scale {
						t.Fatalf("%s: |H| = %g, differences give %g", what, math.Abs((*k1+*k2)/2), math.Abs(H))
					}
				}
			}
		}
	}
}

// The ridge is the waist v = 0 on both branches below π/2 and on the first
// at π/2, where the second sheet is the axis: one open ridge a branch,
// across the whole patch, whether v = 0 is a sample row or lies between
// rows. Each point is its foot's center, on the helix of radius s(1 ± sin
// θ) at height s u cos θ. A patch on one side of the waist has none. Just
// below π/2 the second sheet is nearly the axis and its ridge value nearly
// flat, yet its ridge stays on the waist.
func TestAssociateRidgesAlongTheWaist(t *testing.T) {
	for _, s := range []float64{1, 0.05, 3000} {
		for _, v0 := range []float64{-1.2, -1.17} {
			for _, theta := range []float64{0, 0.4, 1.2, math.Pi/2 - 1e-6, math.Pi / 2} {
				for _, reverse := range []bool{false, true} {
					c := withRidges(constructed(s, theta, -2.7, 2.7, v0, 1.2, 60, 48))
					c.Surface.Reverse = reverse
					out := surfaced(t, c)
					what := fmt.Sprintf("s %g v₀ %g θ %g reverse %v", s, v0, theta, reverse)
					want := 2
					if theta == math.Pi/2 {
						want = 1
					}
					if len(*out.Ridges) != want {
						t.Fatalf("%s: %d ridges, want %d", what, len(*out.Ridges), want)
					}
					branches := map[int]bool{}
					for k, e := range *out.Ridges {
						branches[e.Branch] = true
						if e.Closed {
							t.Fatalf("%s: ridge %d is closed", what, k)
						}
						if lo, hi := spanOf(e.I); lo != 0 || hi != 60 {
							t.Fatalf("%s: ridge %d spans i %g–%g, not the whole patch", what, k, lo, hi)
						}
						branch := e.Branch - 1
						if reverse {
							branch = 1 - branch
						}
						sign := 1.0
						if branch == 1 {
							sign = -1
						}
						// The traced value runs through zero at a slope
						// sin φ or |cos φ| in v, φ = θ/2 + π/4, so a root
						// to 10⁻¹⁵ of it is that close in v.
						phi, slope := theta/2+math.Pi/4, 0.0
						if branch == 0 {
							slope = math.Sin(phi)
						} else {
							slope = math.Abs(math.Cos(phi))
						}
						us, vs := params(c.Surface, e)
						for m := range e.Points {
							if math.Abs(vs[m]) > 1e-10/slope {
								t.Fatalf("%s: ridge %d point %d at v = %v, off the waist", what, k, m, vs[m])
							}
							u := us[m]
							r := s * (math.Sin(theta) + sign)
							associateNear(t, what+" ridge point", e.Points[m], Vec3{r * math.Cos(u), r * math.Sin(u), s * u * math.Cos(theta)}, 1e-9*s*10)
							associateNear(t, what+" ridge foot", e.Feet[m], associateX(s, theta, u, vs[m]), 1e-9*s*10)
						}
					}
					if len(branches) != want {
						t.Fatalf("%s: ridges on branches %v", what, branches)
					}
				}
			}
		}
	}
	for _, theta := range []float64{0, 0.9} {
		if out := surfaced(t, withRidges(constructed(1, theta, -2, 2, 0.1, 1.5, 30, 20))); len(*out.Ridges) != 0 {
			t.Fatalf("θ %g: %d ridges on one side of the waist", theta, len(*out.Ridges))
		}
	}
}

// On the catenoid an offset beyond its waist's radius crosses itself: the
// meridian's offset (s cosh v + d/cosh v, s v − d tanh v) returns to z = 0
// at v* > 0 with s v* = d tanh v*, so the points at (u, ±v*) coincide. The
// engine draws it as it is: its points meet there and not beside it, and
// nothing is joined across the crossing.
func TestAssociateOffsetCrossesItself(t *testing.T) {
	const s, d = 1.1, 2.6
	star := mustRoot(t, func(v float64) float64 { return s*(0.2+v*2.8) - d*math.Tanh(0.2+v*2.8) })*2.8 + 0.2
	c := constructed(s, math.Pi/2, -2, 2, -3, 3, 16, 24)
	c.Surface.Offset = d
	for _, u := range []float64{-1.3, 0.4, 1.9} {
		_, a := pointProbedAs(t, c, "offset", u, star)
		_, b := pointProbedAs(t, c, "offset", u, -star)
		if gap := a.Points[0][0].sub(*b.Points[0][0]).norm(); gap > 1e-12 {
			t.Fatalf("u %g: the offset at ±v* = %g is %g apart", u, star, gap)
		}
		_, a = pointProbedAs(t, c, "offset", u, star+0.05)
		_, b = pointProbedAs(t, c, "offset", u, -star-0.05)
		if gap := a.Points[0][0].sub(*b.Points[0][0]).norm(); gap < 1e-3 {
			t.Fatalf("u %g: the offset meets itself beside v*", u)
		}
	}
	out := surfaced(t, c)
	for i := range out.Offset.AlongV {
		for j, joined := range out.Offset.AlongV[i] {
			if !joined {
				t.Fatalf("offset edge (%d, %d) unjoined", i, j)
			}
		}
	}
}
