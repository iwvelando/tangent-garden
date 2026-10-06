package engine3

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// offsetProbed computes a surface study with its offset's diagnostics and
// checks that the grid's arrays agree in shape.
func offsetProbed(t *testing.T, c Request) (Result, *SurfaceDiagnostics) {
	t.Helper()
	c.OffsetDiagnostics = true
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	d := gridded(t, r.Probe)
	if d.Kind != "offset" || len(d.Folds) != len(d.U) {
		t.Fatalf("kind %q, %d rows of folds for %d rows", d.Kind, len(d.Folds), len(d.U))
	}
	for row := range d.Folds {
		if len(d.Folds[row]) != len(d.V) {
			t.Fatalf("row %d: %d folds for %d columns", row, len(d.Folds[row]), len(d.V))
		}
	}
	return r, d
}

func offsetBy(c Request, d float64) Request {
	c.Surface.Offset = d
	return c
}

// The offset of a torus by d along its outward normal is the torus of the
// same R with tube radius r + d, at the same (u, v). Its meridian curvature
// is −1/(r + d) and its parallel curvature −cos v/(R + (r + d) cos v), both
// from the offset torus itself. Branches keep the patch's numbers: the
// parallel is the patch's κ₁ and the meridian its κ₂, so past the core
// circle (r + d < 0) the offset has folded and κ₁ < κ₂ there.
func TestOffsetProbeTorusIsTorus(t *testing.T) {
	const R, r = 2.0, 0.8
	for _, d := range []float64{0.5, -0.3, -1.2} {
		c := offsetBy(torusPatch(R, r, 36, 24), d)
		out, p := offsetProbed(t, c)
		if p.Distance != d || len(p.U) != 37 || len(p.V) != 25 || p.Singular != 0 || p.Umbilics != 0 || p.Unknown != 0 {
			t.Fatalf("d %g: distance %g, %d × %d, singular %d umbilics %d unknown %d", d, p.Distance, len(p.U), len(p.V), p.Singular, p.Umbilics, p.Unknown)
		}
		tube := r + d
		folded := 0
		for i, u := range p.U {
			for j, v := range p.V {
				x, n := p.Points[i][j], p.Normals[i][j]
				if x == nil || n == nil {
					t.Fatalf("d %g (%d, %d): no point or normal", d, i, j)
				}
				want := Vec3{(R + tube*math.Cos(v)) * math.Cos(u), (R + tube*math.Cos(v)) * math.Sin(u), tube * math.Sin(v)}
				near(t, x, want, 1e-12)
				// The patch's outward normal, shared by its offset.
				near(t, n, Vec3{math.Cos(u) * math.Cos(v), math.Sin(u) * math.Cos(v), math.Sin(v)}, 1e-12)
				closeTo(t, "parallel", p.Curvature[0][i][j], -math.Cos(v)/(R+tube*math.Cos(v)), 1e-9)
				closeTo(t, "meridian", p.Curvature[1][i][j], -1/tube, 1e-9)
				// The meridian's center is the core circle, the patch's own.
				near(t, p.Focal[1][i][j], Vec3{R * math.Cos(u), R * math.Sin(u), 0}, 1e-9)
				if want := tube < 0; p.Folds[i][j] != want {
					t.Fatalf("d %g (%d, %d): folded %v", d, i, j, p.Folds[i][j])
				}
				if p.Folds[i][j] {
					folded++
				}
			}
		}
		if folded != out.Surface.Folded {
			t.Fatalf("d %g: %d folds, the offset sheet counts %d", d, folded, out.Surface.Folded)
		}
	}
	// Reversed, the normal points into the tube and the curvatures change
	// sign, so the meridian, 1/r, is the patch's κ₁. Offset by 1.2 along it
	// the tube radius is r − 1.2 < 0: folded through κ₁ alone, with the
	// meridian 1/(r − d) and the parallel cos v/(R + (r − d) cos v).
	c := offsetBy(torusPatch(R, r, 36, 24), 1.2)
	c.Surface.Reverse = true
	_, p := offsetProbed(t, c)
	for i, u := range p.U {
		for j, v := range p.V {
			tube := r - 1.2
			near(t, p.Points[i][j], Vec3{(R + tube*math.Cos(v)) * math.Cos(u), (R + tube*math.Cos(v)) * math.Sin(u), tube * math.Sin(v)}, 1e-12)
			closeTo(t, "meridian", p.Curvature[0][i][j], 1/tube, 1e-9)
			closeTo(t, "parallel", p.Curvature[1][i][j], math.Cos(v)/(R+tube*math.Cos(v)), 1e-9)
			if !p.Folds[i][j] {
				t.Fatalf("reversed (%d, %d): not folded", i, j)
			}
		}
	}
}

// Parallel surfaces share their normals, principal directions and centers
// of curvature: the offset's points are the drawn offset sheet's, its
// directions the patch's, and each branch's center the patch's focal point
// of the same number, so its focal sheet's. Its K and H follow from the
// offset's own curvatures.
func TestOffsetProbeSharesCenters(t *testing.T) {
	for _, c := range []Request{
		offsetBy(surfaceStudy("ellipsoid", 1.5, 1, 0.7, 0, 2*math.Pi, -1.4, 1.4, 30, 24), -0.45),
		offsetBy(surfaceStudy("ellipsoid", 1.5, 1, 0.7, 0, 2*math.Pi, -1.4, 1.4, 30, 24), 0.6),
		offsetBy(surfaceStudy("paraboloid", 0.8, -0.5, 0, -1.5, 1.5, -1.5, 1.5, 24, 24), 0.9),
		offsetBy(surfaceStudy("monkey", 0.4, 0, 0, -1, 1, -1, 1, 20, 20), -0.3),
	} {
		c.Surface.Reverse = c.Surface.Offset > 0.5
		out, o := offsetProbed(t, c)
		_, p := probed(t, c)
		sheet := out.Surface.Offset.Points
		for i := range o.Points {
			for j := range o.Points[i] {
				if (o.Points[i][j] == nil) != (sheet[i][j] == nil) {
					t.Fatalf("%s (%d, %d): point %v, sheet %v", c.Surface.Kind, i, j, o.Points[i][j], sheet[i][j])
				}
				if o.Points[i][j] == nil || o.Normals[i][j] == nil {
					continue
				}
				near(t, o.Points[i][j], sheet[i][j], 0)
				near(t, o.Normals[i][j], p.Normals[i][j], 0)
				x := *p.Points[i][j]
				for k := 0; k < 2; k++ {
					a, b := o.Direction[k][i][j], p.Direction[k][i][j]
					if (a == nil) != (b == nil) || a != nil && a.sub(*b).norm() > 0 {
						t.Fatalf("%s (%d, %d) branch %d: direction %v vs %v", c.Surface.Kind, i, j, k, a, b)
					}
					kappa, base := o.Curvature[k][i][j], p.Curvature[k][i][j]
					if kappa == nil || base == nil {
						t.Fatalf("%s (%d, %d) branch %d: curvature unknown", c.Surface.Kind, i, j, k)
					}
					// The center lies on the shared normal at 1/κ from the
					// offset point, d + 1/κ from the patch's.
					radius := c.Surface.Offset + 1 / *kappa
					if math.Abs(radius - 1 / *base) > 1e-9*math.Max(1, math.Abs(radius)) {
						t.Fatalf("%s (%d, %d) branch %d: center at %g from the patch, its own at %g", c.Surface.Kind, i, j, k, radius, 1 / *base)
					}
					f, g := o.Focal[k][i][j], out.Surface.Focal[k].Points[i][j]
					if f != nil && g != nil {
						near(t, f, g, 1e-9*math.Max(1, g.sub(x).norm()))
					}
				}
			}
		}
		if o.Umbilics != p.Umbilics {
			t.Fatalf("%s: umbilics %d, patch %d", c.Surface.Kind, o.Umbilics, p.Umbilics)
		}
	}
}

// A sphere of radius ρ offset inward by ρ collapses to its center: every
// regular sample is singular, with the point but no normal or curvature.
// Offset by less, it is a sphere of radius ρ + d with κ = −1/(ρ + d), an
// umbilic everywhere, centered where the patch's centers are.
func TestOffsetProbeSphereCollapsesAtItsCenter(t *testing.T) {
	_, p := offsetProbed(t, offsetBy(sphere(1.5, 24, 12), -1.5))
	regular := 25*13 - 2*25
	if p.Singular != 2*25+regular || p.Umbilics != 0 {
		t.Fatalf("singular %d umbilics %d", p.Singular, p.Umbilics)
	}
	for i := range p.Points {
		for j := range p.Points[i] {
			if p.Normals[i][j] != nil || p.Curvature[0][i][j] != nil || p.Focal[0][i][j] != nil {
				t.Fatalf("(%d, %d): normal or curvature on the collapsed sphere", i, j)
			}
		}
	}
	_, p = offsetProbed(t, offsetBy(sphere(1.5, 24, 12), 0.5))
	if p.Umbilics != regular || p.Singular != 2*25 {
		t.Fatalf("umbilics %d singular %d", p.Umbilics, p.Singular)
	}
	// The poles have no normal, so the offset has no point there.
	for _, i := range []int{0, len(p.V) - 1} {
		for row := range p.Points {
			if p.Points[row][i] != nil {
				t.Fatalf("(%d, %d): an offset point at a pole", row, i)
			}
		}
	}
	eachProbed(p, func(row, k int, x, n Vec3, kappa [2]*float64) {
		if math.Abs(x.norm()-2) > 1e-12 {
			t.Fatalf("(%d, %d) at radius %g", row, k, x.norm())
		}
		for b := 0; b < 2; b++ {
			closeTo(t, "κ", kappa[b], -0.5, 1e-12)
			near(t, p.Focal[b][row][k], Vec3{}, 1e-12)
			if p.Direction[b][row][k] != nil {
				t.Fatalf("(%d, %d) umbilic with a direction", row, k)
			}
		}
	})
}

// A cylinder of radius ρ offset inward by d < ρ is the cylinder of radius
// ρ − d, flat along its rulings (κ₁ = 0, that center at infinity, clipped)
// and κ₂ = −1/(ρ − d) around. Offset inward by ρ it reaches its axis, its focal
// line, and the offset is singular there: a cuspidal edge of zero width.
func TestOffsetProbeCylinderReachesItsAxis(t *testing.T) {
	_, p := offsetProbed(t, offsetBy(surfaceStudy("cylinder", 1.2, 1.2, 0, 0, 2*math.Pi, -1, 1, 36, 12), -0.8))
	if p.Clipped[0] != 37*13 || p.Clipped[1] != 0 || p.Singular != 0 {
		t.Fatalf("clipped %v singular %d, %d × %d", p.Clipped, p.Singular, len(p.U), len(p.V))
	}
	eachProbed(p, func(row, k int, x, n Vec3, kappa [2]*float64) {
		if math.Abs(math.Hypot(x.X, x.Y)-0.4) > 1e-12 {
			t.Fatalf("(%d, %d) at radius %g", row, k, math.Hypot(x.X, x.Y))
		}
		closeTo(t, "along", kappa[0], 0, 1e-12)
		closeTo(t, "around", kappa[1], -1/0.4, 1e-9)
		near(t, p.Focal[1][row][k], Vec3{0, 0, x.Z}, 1e-9)
	})
	_, p = offsetProbed(t, offsetBy(surfaceStudy("cylinder", 1.2, 1.2, 0, 0, 2*math.Pi, -1, 1, 36, 12), -1.2))
	if p.Singular != 37*13 {
		t.Fatalf("singular %d on the axis", p.Singular)
	}
}

// The offset's diagnostics are asked for apart from the patch's: never for
// a study without an offset or that is not a surface patch, refused with
// the patch's, and otherwise leaving the study byte-identical.
func TestOffsetDiagnosticsFlag(t *testing.T) {
	both := offsetBy(torusPatch(2, 0.7, 24, 24), 0.3)
	both.SurfaceDiagnostics, both.OffsetDiagnostics = true, true
	if _, err := Compute(both); err == nil || !strings.Contains(err.Error(), "offsetDiagnostics") {
		t.Fatalf("both probes: %v", err)
	}
	mirror := surfaceStudy("paraboloid", 1, 1, 0, 0, 1, 0, 2*math.Pi, 24, 24)
	mirror.Format = "rays"
	mirror.Surface.Offset = 0.4
	mirror.Rays = RaysRequest{Interaction: "reflect", Light: "parallel", Azimuth: 0, Elevation: 90, Length: 1, Receiver: ReceiverRequest{Plane: "none"}}
	for _, c := range []Request{torusPatch(2, 0.7, 24, 24), offsetBy(torusPatch(2, 0.7, 24, 24), 0.3), offsetBy(sphere(1.5, 24, 12), -1.5), mirror, canalled(circle(), 0.5, "1", 4), custom("cos(t)", "sin(t)", "t", 0, 4)} {
		before, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		c.OffsetDiagnostics = true
		after, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		want := c.Format == "surface" && c.Surface.Offset != 0
		if (after.Probe != nil) != want {
			t.Fatalf("%s offset %g: diagnostics %v", c.Format, c.Surface.Offset, after.Probe != nil)
		}
		after.Probe = nil
		x, _ := json.Marshal(before)
		y, _ := json.Marshal(after)
		if !bytes.Equal(x, y) {
			t.Fatalf("%s: the offset's diagnostics changed the study", c.Format)
		}
	}
	// The patch's own diagnostics carry neither a distance nor folds.
	_, p := probed(t, offsetBy(torusPatch(2, 0.7, 24, 24), -1))
	raw, _ := json.Marshal(p)
	if p.Kind != "patch" || strings.Contains(string(raw), `"distance"`) || strings.Contains(string(raw), `"folds"`) {
		t.Fatalf("patch diagnostics %s…", raw[:80])
	}
}
