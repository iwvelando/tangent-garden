package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// The surface probe between samples on a surface built on a curve: a
// canal, tangent developable, framed ribbon or ruled surface described at
// any t of the curve's domain and any v across it (the turn around a
// canal's contact circle from θ₀, or u along the ruling), not only at a
// grid sample.

// curveSurfaces are the surfaces built on a curve that the probe describes,
// open and closed, analytic and differenced, with every kind of frame.
func curveSurfaces() map[string]Request {
	profiled := canalled(study(), 0.3, "1 + 0.4*sin(3*t)", 4)
	twisted := canalled(helixStudy(), 0.4, "1 + 0.2*t", 0)
	twisted.Frame.Twist, twisted.Frame.Angle = 1.5, 0.3
	distributed := canalled(study(), 0.25, "1", 0)
	distributed.Frame.Closure = "distribute"
	return map[string]Request{
		"knot developable":   study(),
		"helix developable":  helixStudy(),
		"knot canal":         profiled,
		"helix canal":        twisted,
		"distributed canal":  distributed,
		"torus":              canalled(circle(), 0.5, "1", 6),
		"rmf ribbon":         ribbon(study(), "rotation-minimizing", Vec3{0, 0, 1}, 0.4, 1, 0.3),
		"frenet ribbon":      ribbon(helixStudy(), "frenet", Vec3{0, 0, 1}, 0.4, 0, 0.3),
		"chords":             chords(study(), 1, 1.1),
		"threaded ring":      threaded(ring(0), "cos(t)", "sin(t)", "1 + 0.3*sin(2*t)", 1, 0.5),
		"thread at rate two": threaded(ring(-1), "cos(t/2)", "sin(t/2)", "1", 2, 2.6),
	}
}

// At a grid sample the point is the sample: the grid and the point share
// one description, so every quantity agrees to the bit, on every row and
// column, a closed surface's last row included.
func TestCurveSurfacePointAtASampleIsTheSample(t *testing.T) {
	for name, c := range curveSurfaces() {
		c.SurfaceDiagnostics = true
		r, err := Compute(c)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		grid := gridded(t, r.Probe)
		rows := []int{0, 1, len(grid.U) / 3, len(grid.U) / 2, len(grid.U) - 2, len(grid.U) - 1}
		for _, row := range rows {
			for column := range grid.V {
				// The study places its point as Compute does; one is placed
				// through Compute itself.
				point, err := r.surfacePoint(c, SurfaceQuery{U: grid.U[row], V: grid.V[column]})
				if row == len(grid.U)/2 && column == 1 {
					_, point = pointProbed(t, c, grid.U[row], grid.V[column])
				}
				if err != nil {
					t.Fatal(err)
				}
				if got, want := cell(t, point, 0, 0), cell(t, grid, row, column); got != want {
					t.Fatalf("%s at row %d column %d: the point says\n%s\nthe grid says\n%s", name, row, column, got, want)
				}
				if point.Along[0] != grid.Along[row] || point.Kind != grid.Kind || point.Periodic != grid.Periodic {
					t.Fatalf("%s at row %d column %d: along %d kind %q periodic %v, grid along %d kind %q periodic %v",
						name, row, column, point.Along[0], point.Kind, point.Periodic, grid.Along[row], grid.Kind, grid.Periodic)
				}
			}
		}
	}
}

// Between samples, the point lies on the surface the samples draw: its
// point continues the grid's, and converges on it as it nears a sample.
func TestCurveSurfacePointConvergesOnTheSamples(t *testing.T) {
	for name, c := range curveSurfaces() {
		c.SurfaceDiagnostics = true
		r, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		grid := r.Probe
		row, column := len(grid.U)/2, len(grid.V)/3
		want := grid.Points[row][column]
		if want == nil || grid.Normals[row][column] == nil {
			t.Fatalf("%s: no regular sample at row %d column %d", name, row, column)
		}
		step := (grid.U[row+1] - grid.U[row])
		previous := math.Inf(1)
		for _, f := range []float64{0.3, 0.03, 0.003} {
			_, point := pointProbed(t, c, grid.U[row]+f*step, grid.V[column])
			p := point.Points[0][0]
			if p == nil || point.Normals[0][0] == nil {
				t.Fatalf("%s at %g of a step: no regular point", name, f)
			}
			gap := p.sub(*want).norm()
			if !(gap < previous) || gap > 10*f*step*(1+r.Bounds.Radius) {
				t.Fatalf("%s at %g of a step: %g from the sample, after %g", name, f, gap, previous)
			}
			previous = gap
			if n := point.Normals[0][0].dot(*grid.Normals[row][column]); !(n > 0.9) {
				t.Fatalf("%s at %g of a step: the normal turns from the sample's, n·n = %g", name, f, n)
			}
			// So do its curvatures, near a sample.
			for b := 0; b < 2; b++ {
				got, want := point.Curvature[b][0][0], grid.Curvature[b][row][column]
				if (got == nil) != (want == nil) {
					t.Fatalf("%s at %g of a step: branch %d known %v beside a sample known %v", name, f, b, got != nil, want != nil)
				}
				if f == 0.003 && want != nil && math.Abs(*got-*want) > 0.05*(math.Abs(*want)+1/r.Bounds.Radius) {
					t.Fatalf("%s at %g of a step: branch %d κ = %g beside the sample's %g", name, f, b, *got, *want)
				}
			}
		}
	}
}

// A tube of radius r about the circle of radius 2 is a torus. At a point
// a distance ρ from its axis, the curvature around the tube is −1/r and
// the Gaussian curvature is K = (ρ − 2)/(r²ρ), whatever the frame.
func TestCurveSurfacePointOnATorus(t *testing.T) {
	const r = 0.5
	c := canalled(circle(), r, "1", 0)
	c.SurfaceDiagnostics = true
	for _, at := range [][2]float64{{0.0123, 0.1}, {1.7171, 2.2}, {3.3, 4.71}, {6.2, 5.9}} {
		_, d := pointProbed(t, c, at[0], at[1])
		x := *d.Points[0][0]
		rho := math.Hypot(x.X, x.Y)
		if e := math.Abs(math.Pow(rho-2, 2) + x.Z*x.Z - r*r); e > 1e-12 {
			t.Fatalf("at %v: %v lies %g off the torus", at, x, e)
		}
		closeTo(t, "κ around", d.Curvature[0][0][0], -1/r, 1e-12)
		k := *d.Curvature[0][0][0] * *d.Curvature[1][0][0]
		if want := (rho - 2) / (r * r * rho); math.Abs(k-want) > 1e-9 {
			t.Fatalf("at %v: K = %g, want %g", at, k, want)
		}
		if d.Kind != "canal" || !d.Periodic {
			t.Fatalf("kind %q periodic %v", d.Kind, d.Periodic)
		}
	}
}

// The hyperboloid x² + y² − z²/c² = 1 is ruled by the lines
// (cos t − s sin t, sin t + s cos t, cs), here from s = −0.6 to s = 1.4,
// so its throat, s = 0, lies at u = 0.3 along each ruling, between the
// grid's columns. Its Gaussian curvature is
// K = −1/(c²(x² + y² + z²/c⁴)²): −1/c² on the throat, where |K| is
// greatest along the ruling.
func TestCurveSurfacePointOnAHyperboloidsThroat(t *testing.T) {
	const c2 = 1.25 * 1.25
	lower := custom("cos(t) + 0.6*sin(t)", "sin(t) - 0.6*cos(t)", "-0.75", 0, 2*math.Pi)
	c := threaded(lower, "cos(t) - 1.4*sin(t)", "sin(t) + 1.4*cos(t)", "1.75", 1, 0)
	c.SurfaceDiagnostics = true
	gauss := func(x Vec3) float64 {
		s := x.X*x.X + x.Y*x.Y + x.Z*x.Z/(c2*c2)
		return -1 / (c2 * s * s)
	}
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if k := probeColumn(r.Probe, 0.3); math.Abs(r.Probe.V[k]-0.3) < 1e-3 {
		t.Fatalf("the grid has a column at u = %g, on the throat", r.Probe.V[k])
	}
	for _, s := range []float64{0.01, 1.234, 4.4} {
		_, d := pointProbed(t, c, s, 0.3)
		x := *d.Points[0][0]
		if e := math.Abs(x.X*x.X + x.Y*x.Y - x.Z*x.Z/c2 - 1); e > 1e-9 || math.Abs(x.Z) > 1e-12 {
			t.Fatalf("at t = %g: %v is not on the throat (%g off the hyperboloid)", s, x, e)
		}
		k := *d.Curvature[0][0][0] * *d.Curvature[1][0][0]
		if math.Abs(k+1/c2) > 1e-6 || math.Abs(k-gauss(x)) > 1e-6 {
			t.Fatalf("at t = %g: K = %.9g on the throat, want %g", s, k, -1/c2)
		}
		for _, u := range []float64{0.29, 0.31} {
			_, beside := pointProbed(t, c, s, u)
			kb := *beside.Curvature[0][0][0] * *beside.Curvature[1][0][0]
			if !(math.Abs(kb) < math.Abs(k)) || math.Abs(kb-gauss(*beside.Points[0][0])) > 1e-6 {
				t.Fatalf("at t = %g, u = %g: K = %g beside the throat's %g, want %g", s, u, kb, k, gauss(*beside.Points[0][0]))
			}
		}
	}
}

// The tangent developable of a helix of radius a and pitch b has κ = 0
// along each ruling and |κ| = b/(a|u|) across it, at any u, between the
// grid's columns ±L·k/12 too; at u = 0, its edge of regression, it is
// singular.
func TestCurveSurfacePointOnAHelixDevelopable(t *testing.T) {
	const a, b = 2.0, 1.0 / 3
	c := custom("2*cos(t)", "2*sin(t)", "t/3", -2*math.Pi, 2*math.Pi)
	c.SurfaceDiagnostics = true
	for _, at := range [][2]float64{{0.1234, 0.37}, {-3.3, -0.11}, {5.01, 0.9}} {
		_, d := pointProbed(t, c, at[0], at[1])
		closeTo(t, "κ along the ruling", d.Curvature[0][0][0], 0, 1e-9)
		got := d.Curvature[1][0][0]
		if got == nil {
			t.Fatalf("at %v: κ across is unknown", at)
		}
		relative(t, "|κ| across", &[]float64{math.Abs(*got)}[0], b/(a*math.Abs(at[1])), differenced)
	}
	_, edge := pointProbed(t, c, 0.5, 0)
	if edge.Points[0][0] == nil || edge.Normals[0][0] != nil || edge.Singular != 1 {
		t.Fatalf("the edge of regression is not singular: %+v", edge)
	}
}

// Where the curve straightens momentarily, between samples, the tangent
// developable's whole ruling is singular, as on the grid: (t, t³, t⁴) near
// t = 0, which no sample of [−1, 1.1] lands on.
func TestCurveSurfacePointSingularAtAnInflection(t *testing.T) {
	c := custom("t", "t^3", "t^4", -1, 1.1)
	c.SurfaceDiagnostics = true
	for _, s := range []float64{0, 1e-8, -1e-8} {
		_, d := pointProbed(t, c, s, 0.5*c.Length)
		if d.Points[0][0] == nil || d.Normals[0][0] != nil || d.Singular != 1 || d.Unknown != 0 {
			t.Fatalf("at t = %g: point %v normal %v, singular %d unknown %d", s, d.Points[0][0], d.Normals[0][0], d.Singular, d.Unknown)
		}
	}
}

// A Frenet ribbon along a helix's principal normal is the helicoid
// ((a − u) cos t, (a − u) sin t, bt), with κ = ±b/(b² + ρ²), ρ = a − u.
func TestCurveSurfacePointOnAHelicoid(t *testing.T) {
	const a, b = 2.0, 1.0 / 3
	c := ribbon(custom("2*cos(t)", "2*sin(t)", "t/3", 0, 8), "frenet", Vec3{}, 0, 0, 0.8)
	c.SurfaceDiagnostics = true
	for _, at := range [][2]float64{{0.913, 0.123}, {4.44, -0.7}, {7.1, 0.51}} {
		_, d := pointProbed(t, c, at[0], at[1])
		s, rho := at[0], a-at[1]
		near(t, *d.Points[0][0], Vec3{rho * math.Cos(s), rho * math.Sin(s), b * s}, differenced)
		want := b / (b*b + rho*rho)
		relative(t, "κ₁", d.Curvature[0][0][0], want, differenced)
		relative(t, "κ₂", d.Curvature[1][0][0], -want, differenced)
	}
}

// The point is refused outside the curve's domain and across it, and on
// a study without a surface the probe can stand between samples on: a
// curve integrated step by step, a construction that is not a surface, or
// a ribbon without a width.
func TestCurveSurfacePointRefusals(t *testing.T) {
	outside := map[string][][2]float64{
		"torus":             {{-0.1, 0}, {7, 0}, {1, -0.1}, {1, 6.3}, {math.NaN(), 0}},
		"knot developable":  {{1, study().Length + 0.01}, {1, -study().Length - 0.01}},
		"rmf ribbon":        {{1, 0.31}, {1, -0.31}},
		"threaded ring":     {{1, -0.01}, {1, 1.01}, {1, math.Inf(1)}},
		"helix developable": {{-7, 0.5}},
	}
	studies := curveSurfaces()
	for name, points := range outside {
		c := studies[name]
		for _, at := range points {
			c.SurfaceProbe = &SurfaceQuery{U: at[0], V: at[1]}
			if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "outside") {
				t.Fatalf("%s at %v was not refused as outside: %v", name, at, err)
			}
		}
	}
	narrow := ribbon(study(), "rotation-minimizing", Vec3{0, 0, 1}, 0, 0, 0)
	refused := map[string]Request{"narrow ribbon": narrow}
	for name, c := range probeStudies() {
		switch c.Construction {
		case "", "developable", "canal", "framed", "ruled":
			continue
		}
		refused[name] = c
	}
	refused["field canal"] = canalled(fieldRequest("-y", "x", "0.2", []Vec3{{1, 0, 0}}, 0, 6), 0.3, "1", 0)
	for name, c := range refused {
		c.SurfaceProbe = &SurfaceQuery{U: 0.5, V: 0}
		if _, err := Compute(c); err == nil {
			t.Fatalf("%s took a surface point", name)
		}
		if _, err := SurfaceProbeOnly(c); err == nil {
			t.Fatalf("%s took a surface point alone", name)
		}
	}
}

// The point alone, for a probe moved over a study already drawn, is the
// point the whole study gives, before and after the study changes.
func TestCurveSurfaceProbeOnlyIsTheStudysPoint(t *testing.T) {
	for _, name := range []string{"knot canal", "rmf ribbon", "chords", "knot developable"} {
		for _, scale := range []float64{1, 1.5} {
			c := curveSurfaces()[name]
			c.Samples = int(float64(c.Samples) * scale)
			for _, at := range [][2]float64{{0.4, 0.2}, {1.3, 0.25}, {0.4, 0.2}} {
				_, want := pointProbed(t, c, at[0], at[1])
				c.SurfaceProbe = &SurfaceQuery{U: at[0], V: at[1]}
				got, err := SurfaceProbeOnly(c)
				if err != nil {
					t.Fatal(err)
				}
				a, _ := json.Marshal(want)
				b, _ := json.Marshal(got)
				if string(a) != string(b) {
					t.Fatalf("%s at %v: the probe alone gives\n%s\nthe study gives\n%s", name, at, b, a)
				}
			}
		}
	}
}

// The point carries what the probe draws through it, which the grid draws
// from its own row: a canal's contact circle, closed, through the point and
// on the sphere about the curve's point, or the straight ruling from end to
// end through the point. The grid carries none.
func TestCurveSurfacePointCarriesItsCircleOrRuling(t *testing.T) {
	for name, c := range curveSurfaces() {
		c.SurfaceDiagnostics = true
		r, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if r.Probe.Through != nil {
			t.Fatalf("%s: the grid carries a line through a point", name)
		}
		grid := r.Probe
		middle := len(grid.U) / 2
		at := SurfaceQuery{U: (grid.U[middle] + grid.U[middle+1]) / 2, V: (grid.V[5] + grid.V[6]) / 2}
		_, d := pointProbed(t, c, at.U, at.V)
		if d.Points[0][0] == nil || d.Normals[0][0] == nil || d.Curvature[0][0][0] == nil {
			t.Fatalf("%s at %+v: no regular point: %+v", name, at, d)
		}
		x, line := *d.Points[0][0], d.Through
		if d.Kind == "canal" {
			if len(line) != 2*canalSegments+1 || line[0].sub(line[len(line)-1]).norm() > 1e-12 {
				t.Fatalf("%s: the contact circle has %d points and does not close", name, len(line))
			}
			// Every point lies as far from the curve's point as X does, and
			// the circle passes through X.
			centre := x.sub(d.Normals[0][0].mul(-1 / *d.Curvature[0][0][0]))
			closest := math.Inf(1)
			for _, p := range line {
				if e := math.Abs(p.sub(centre).norm() - x.sub(centre).norm()); e > 1e-9 {
					t.Fatalf("%s: a circle point lies %g off the sphere", name, e)
				}
				closest = math.Min(closest, p.sub(x).norm())
			}
			if step := line[0].sub(line[1]).norm(); closest > step {
				t.Fatalf("%s: the circle passes %g from the point, beyond a step %g", name, closest, step)
			}
			continue
		}
		if len(line) != 2 {
			t.Fatalf("%s: the ruling has %d ends", name, len(line))
		}
		ruling := line[1].sub(line[0])
		if off := x.sub(line[0]).cross(ruling.unit()).norm(); off > 1e-9*ruling.norm() {
			t.Fatalf("%s: the point lies %g off its ruling", name, off)
		}
		// Its ends are the surface's points at the first and last columns.
		for e, v := range []float64{grid.V[0], grid.V[len(grid.V)-1]} {
			end, err := r.surfacePoint(c, SurfaceQuery{U: at.U, V: v})
			if err != nil {
				t.Fatal(err)
			}
			if end.Points[0][0] == nil || end.Points[0][0].sub(line[e]).norm() > 1e-12*(1+r.Bounds.Radius) {
				t.Fatalf("%s: end %d of the ruling is %v, not the surface's %v", name, e, line[e], end.Points[0][0])
			}
		}
	}
}

// The example "Round a hyperboloid's throat" stands on the throat of
// x² + z² − y²/c² = 1, c = 1.25, at u = 0.3: round the throat κ = −1, along
// the meridian's vertex 1/c² = 0.64, so K = −0.64, at every t, and the
// surface closes.
func TestHyperboloidThroatExample(t *testing.T) {
	c := spatialPresets(t)["Round a hyperboloid's throat"]
	c.SurfaceDiagnostics = true
	for _, s := range []float64{math.Pi / 4, 2.2, 5.9} {
		_, d := pointProbed(t, c, s, 0.3)
		x := *d.Points[0][0]
		if math.Abs(x.Y) > 1e-12 || math.Abs(x.X*x.X+x.Z*x.Z-1) > 1e-12 {
			t.Fatalf("at t = %g: %v is not on the throat", s, x)
		}
		closeTo(t, "κ₁", d.Curvature[0][0][0], 0.64, 1e-6)
		closeTo(t, "κ₂", d.Curvature[1][0][0], -1, 1e-6)
	}
	// It closes, so the probe's glide round the throat loops.
	_, start := pointProbed(t, c, 0, 0.3)
	_, end := pointProbed(t, c, 2*math.Pi, 0.3)
	if a, b := cell(t, start, 0, 0), cell(t, end, 0, 0); a != b {
		t.Fatalf("the glide ends at\n%s\nnot where it starts\n%s", b, a)
	}
}

// A closed surface's grid repeats its first row as its last, and its point
// at the end of the domain is its point at the start, so that a probe run
// once round it ends where it began.
func TestClosedCurveSurfaceEndsReadAlike(t *testing.T) {
	closed := 0
	for name, c := range curveSurfaces() {
		c.SurfaceDiagnostics = true
		r, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		grid := r.Probe
		if !grid.closed {
			continue
		}
		closed++
		last := len(grid.U) - 1
		for k := range grid.V {
			if a, b := cell(t, grid, 0, k), cell(t, grid, last, k); a != b {
				t.Fatalf("%s column %d: the last row says\n%s\nthe first\n%s", name, k, b, a)
			}
			// Placed on the study as Compute places them; one pair through
			// Compute itself.
			start, err := r.surfacePoint(c, SurfaceQuery{U: grid.U[0], V: grid.V[k]})
			if err != nil {
				t.Fatal(err)
			}
			end, err := r.surfacePoint(c, SurfaceQuery{U: grid.U[last], V: grid.V[k]})
			if err != nil {
				t.Fatal(err)
			}
			if k == 1 {
				_, start = pointProbed(t, c, grid.U[0], grid.V[k])
				_, end = pointProbed(t, c, grid.U[last], grid.V[k])
			}
			if a, b := cell(t, start, 0, 0), cell(t, end, 0, 0); a != b {
				t.Fatalf("%s column %d: the end says\n%s\nthe start\n%s", name, k, b, a)
			}
		}
	}
	if closed < 4 {
		t.Fatalf("only %d closed surfaces", closed)
	}
}
