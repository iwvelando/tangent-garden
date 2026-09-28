package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"
)

func fieldRequest(u, v string, seeds []Seed, escape, lo, hi float64) Request {
	q := request("offset", "", "", lo, hi)
	q.Curve = Curve{Format: "field", Field: VectorField{X: u, Y: v, Seeds: seeds, Escape: escape}, Min: lo, Max: hi}
	return q
}

func flow(t *testing.T, q Request) *FieldResult {
	t.Helper()
	r := compute(t, q)
	if r.Field == nil {
		t.Fatal("no field result")
	}
	return r.Field
}

// sampled checks every path against its exact solution wherever that is
// before the trajectory's end, and that later samples are gaps.
func sampled(t *testing.T, q Request, res *FieldResult, exact func(i int, t float64) Vec, tol float64) {
	t.Helper()
	step := (q.Curve.Max - q.Curve.Min) / float64(q.Samples-1)
	for i, path := range res.Paths {
		for j, p := range path {
			tj := q.Curve.Min + float64(j)*step
			if tj > res.Ends[i].Time {
				if p != nil {
					t.Fatalf("seed %d sample %d at t=%v is past the end %v", i, j, tj, res.Ends[i].Time)
				}
				continue
			}
			if p == nil {
				t.Fatalf("seed %d sample %d at t=%v is a gap before the end %v", i, j, tj, res.Ends[i].Time)
			}
			if d := p.Sub(exact(i, tj)).Norm(); d > tol {
				t.Fatalf("seed %d at t=%v: %v, want %v (off by %g)", i, tj, *p, exact(i, tj), d)
			}
		}
	}
}

func TestFieldRotation(t *testing.T) {
	// ẋ = −y, ẏ = x turns every point about the origin at unit angular
	// speed; the origin itself is a fixed point.
	seeds := []Seed{{1, 0}, {0, 2}, {-.5, .25}, {0, 0}}
	lo, hi := .5, .5+4*math.Pi
	q := fieldRequest("-y", "x", seeds, 10, lo, hi)
	q.Samples, q.Lines = 1201, 25
	res := flow(t, q)
	exact := func(i int, t float64) Vec {
		s := seeds[i]
		c, n := math.Cos(t-lo), math.Sin(t-lo)
		return Vec{s.X*c - s.Y*n, s.X*n + s.Y*c}
	}
	sampled(t, q, res, exact, 1e-9)
	for i, e := range res.Ends {
		if e.Reason != "end" || e.Time != hi {
			t.Fatalf("seed %d ends %+v", i, e)
		}
	}
	// The last sample may land a rounding error past the domain end, but
	// the trajectory is not known beyond it.
	f, _, _ := VectorField{X: "-y", Y: "x"}.system(0)
	whole := newTrajectory(f, seeds[0], lo, hi, 10, fieldTolerance)
	if _, ok := whole.at(hi + 1e-14); !ok {
		t.Fatal("no position a rounding error past the end")
	}
	if _, ok := whole.at(hi + 1e-6); ok {
		t.Fatal("a position past the end")
	}
	r := compute(t, q)
	for j, p := range r.Base {
		if p == nil || *p != *res.Paths[0][j] {
			t.Fatalf("base sample %d %v is not the first trajectory", j, p)
		}
	}
	// A field without t has one direction field, on a square lattice of at
	// most 21 × 21 points spanning every trajectory.
	g := res.Grid
	if res.Timed || len(g.Points) == 0 || len(g.Points) > 21*21 || !(g.Spacing > 0) {
		t.Fatalf("grid %d points, spacing %v, timed %v", len(g.Points), g.Spacing, res.Timed)
	}
	lo0, hi0 := Vec{math.Inf(1), math.Inf(1)}, Vec{math.Inf(-1), math.Inf(-1)}
	for _, d := range g.Points {
		if d.Velocity.Sub(Vec{-d.Point.Y, d.Point.X}).Norm() > 1e-15 || d.Velocity.Norm() == 0 {
			t.Fatalf("direction %+v", d)
		}
		k := d.Point.Sub(g.Points[0].Point).Mul(1 / g.Spacing)
		if math.Abs(k.X-math.Round(k.X)) > 1e-9 || math.Abs(k.Y-math.Round(k.Y)) > 1e-9 {
			t.Fatalf("%v is off the lattice", d.Point)
		}
		lo0 = Vec{math.Min(lo0.X, d.Point.X), math.Min(lo0.Y, d.Point.Y)}
		hi0 = Vec{math.Max(hi0.X, d.Point.X), math.Max(hi0.Y, d.Point.Y)}
	}
	// The paths are circles of radius up to 2 about the origin; the lattice
	// reaches past them by a tenth of the 4-wide box on each side, to within
	// half a spacing.
	for _, v := range []float64{-lo0.X, -lo0.Y, hi0.X, hi0.Y} {
		if math.Abs(v-2.4) > g.Spacing/2+1e-9 {
			t.Fatalf("grid %v–%v does not reach 2.4 around the circles", lo0, hi0)
		}
	}
	// A representative arrow per seed per line, carrying the field there.
	if len(res.Arrows) != q.Lines*len(seeds) {
		t.Fatalf("%d arrows", len(res.Arrows))
	}
	for _, a := range res.Arrows {
		if a.Point != *res.Paths[a.Seed][a.SampleIndex] || a.Velocity.Sub(Vec{-a.Point.Y, a.Point.X}).Norm() > 1e-15 {
			t.Fatalf("arrow %+v", a)
		}
	}
}

func TestFieldEvoluteOfACircle(t *testing.T) {
	// A trajectory is a curve like any other: the rotation's circle of radius
	// 2 about (1, −1) has its evolute at that center.
	q := fieldRequest("-(y+1)", "x-1", []Seed{{3, -1}}, 10, 0, 2*math.Pi)
	q.Kind, q.Samples = "evolute", 400
	r := compute(t, q)
	for j, p := range r.Derived {
		if p == nil || p.Sub(Vec{1, -1}).Norm() > 1e-5 {
			t.Fatalf("evolute sample %d at %v", j, p)
		}
	}
}

func TestFieldTimeDependent(t *testing.T) {
	// ẋ = cos t, ẏ = a sin(3t): x = x₀ + sin t − sin t₀, y = y₀ − a(cos 3t
	// − cos 3t₀)/3. The stages must see their own times, and the domain need
	// not start at 0.
	seeds := []Seed{{0, 0}, {1, -1}}
	lo, hi := 1.0, 9.0
	q := fieldRequest("cos(t)", "a*sin(3*t)", seeds, 100, lo, hi)
	q.Curve.A = .5
	res := flow(t, q)
	sampled(t, q, res, func(i int, t float64) Vec {
		return Vec{seeds[i].X + math.Sin(t) - math.Sin(lo), seeds[i].Y - .5*(math.Cos(3*t)-math.Cos(3*lo))/3}
	}, 1e-9)
	// Its directions change with time, so there is no one direction field.
	if !res.Timed || len(res.Grid.Points) != 0 {
		t.Fatalf("timed %v, %d grid points", res.Timed, len(res.Grid.Points))
	}
}

func TestFieldEscape(t *testing.T) {
	// A straight flow at speed √1.25 from the origin leaves the circle of
	// radius 2 at t = 2/√1.25; a seed outside the circle has no trajectory.
	seeds := []Seed{{0, 0}, {-1, 0}, {3, 0}}
	q := fieldRequest("1", ".5", seeds, 2, 0, 5)
	q.Samples = 501
	res := flow(t, q)
	speed := math.Sqrt(1.25)
	if e := res.Ends[0]; e.Reason != "escape" || math.Abs(e.Time-2/speed) > 1e-12 {
		t.Fatalf("first seed ends %+v, want escape at %v", e, 2/speed)
	}
	// From (−1, 0): |(−1 + s, s/2)| = 2 at 1.25s² − 2s − 3 = 0.
	if e, want := res.Ends[1], (2+math.Sqrt(4+15))/2.5; e.Reason != "escape" || math.Abs(e.Time-want) > 1e-12 {
		t.Fatalf("second seed ends %+v, want escape at %v", e, want)
	}
	if e := res.Ends[2]; e.Reason != "escape" || e.Time != 0 {
		t.Fatalf("outside seed ends %+v", e)
	}
	inside := &FieldResult{Paths: res.Paths[:2], Ends: res.Ends[:2]}
	sampled(t, q, inside, func(i int, t float64) Vec { return Vec{seeds[i].X + t, seeds[i].Y + t/2} }, 1e-12)
	for _, p := range res.Paths[2] {
		if p != nil {
			t.Fatal("a seed outside the escape circle has a trajectory")
		}
	}
	// Exponential growth from (1, 0) reaches radius e at t = 1.
	q = fieldRequest("x", "y", []Seed{{1, 0}}, math.E, 0, 3)
	if e := flow(t, q).Ends[0]; e.Reason != "escape" || math.Abs(e.Time-1) > 1e-10 {
		t.Fatalf("exponential escape %+v", e)
	}
	// The parabola (t − ½, 5t − 5t²) leaves the unit circle and is back
	// inside at t = 1. Being exact for the method, it would take one step
	// without the cap on step length, and its escape would go unseen.
	res = flow(t, fieldRequest("1", "5-10*t", []Seed{{-.5, 0}}, 1, 0, 1))
	in, out := 0.0, .5
	for k := 0; k < 100; k++ {
		if m := (in + out) / 2; math.Hypot(m-.5, 5*m-5*m*m) > 1 {
			out = m
		} else {
			in = m
		}
	}
	if e := res.Ends[0]; e.Reason != "escape" || math.Abs(e.Time-in) > 1e-12 {
		t.Fatalf("parabola ends %+v, want escape at %v", e, in)
	}
	// A seed on the circle, flowing inward, stays.
	q = fieldRequest("-x", "-y", []Seed{{2, 0}}, 2, 0, 3)
	if e := flow(t, q).Ends[0]; e.Reason != "end" {
		t.Fatalf("inward seed on the circle ends %+v", e)
	}
}

func TestFieldSingularity(t *testing.T) {
	// ẋ = −1/x from x = 1: x = √(1 − 2t), which reaches the pole at t = 1/2
	// with unbounded speed.
	q := fieldRequest("-1/x", "0", []Seed{{1, 0}}, 10, 0, 1)
	q.Samples = 1001
	res := flow(t, q)
	e := res.Ends[0]
	if e.Reason != "singular" || math.Abs(e.Time-.5) > 1e-6 {
		t.Fatalf("ends %+v, want singular at 0.5", e)
	}
	// Near the pole a time error δ is a position error √(2δ), so compare
	// away from it.
	for j, p := range res.Paths[0] {
		tj := float64(j) / 1000
		if (p == nil) != (tj > e.Time) {
			t.Fatalf("sample %d at t=%v: %v", j, tj, p)
		}
		if tj < .49 && p.Sub(Vec{math.Sqrt(1 - 2*tj), 0}).Norm() > 1e-8 {
			t.Fatalf("sample %d at t=%v: %v", j, tj, p)
		}
	}
	// The field is not finite at the seed itself.
	q = fieldRequest("1/x", "1", []Seed{{0, 1}, {1, 1}}, 10, 0, 1)
	res = flow(t, q)
	if e := res.Ends[0]; e.Reason != "singular" || e.Time != 0 {
		t.Fatalf("singular seed ends %+v", e)
	}
	if e := res.Ends[1]; e.Reason != "end" {
		t.Fatalf("a singular seed stopped another: %+v", e)
	}
	for _, a := range res.Arrows {
		if a.Seed == 0 && a.SampleIndex > 0 {
			t.Fatalf("arrow %+v past a singular start", a)
		}
	}
}

// spin turns each circle about the origin at angular speed 1 + r².
const spinX, spinY = "-y*(1+x^2+y^2)", "x*(1+x^2+y^2)"

func spinAt(s Seed, t float64) Vec {
	r2 := s.X*s.X + s.Y*s.Y
	c, n := math.Cos((1+r2)*t), math.Sin((1+r2)*t)
	return Vec{s.X*c - s.Y*n, s.X*n + s.Y*c}
}

func TestFieldStepRefinement(t *testing.T) {
	f, _, err := VectorField{X: spinX, Y: spinY, Escape: 10}.system(0)
	if err != nil {
		t.Fatal(err)
	}
	seed := Seed{1.2, -.3}
	worst := func(tol float64) (float64, int) {
		r := newTrajectory(f, seed, 0, 20, 10, tol)
		d := 0.0
		for tk := 0.; tk <= 20; tk += .1 {
			p, ok := r.at(tk)
			if !ok {
				t.Fatalf("tolerance %g: no position at %v", tol, tk)
			}
			d = math.Max(d, p.Sub(spinAt(seed, tk)).Norm())
		}
		return d, r.steps()
	}
	l, ls := worst(1e-6)
	m, ms := worst(1e-9)
	s, ss := worst(1e-12)
	if !(s < m/50 && m < l/50 && s < 1e-9) {
		t.Fatalf("errors %g, %g, %g", l, m, s)
	}
	if !(ls < ms && ms < ss) {
		t.Fatalf("steps %d %d %d", ls, ms, ss)
	}
	// The default tolerance holds over some fifty turns.
	q := fieldRequest(spinX, spinY, []Seed{seed}, 10, 0, 20)
	sampled(t, q, flow(t, q), func(_ int, t float64) Vec { return spinAt(seed, t) }, 1e-7)
}

func TestFieldScaleInvariance(t *testing.T) {
	// Scaling lengths by λ scales a linear flow's trajectories and escape,
	// even as a spiral sink shrinks one a millionfold.
	seeds := []Seed{{1, .5}, {-.2, .1}}
	const u, v = "x-2*y", "x+.3*y"
	base := flow(t, fieldRequest(u, v, seeds, 30, 0, 3))
	sink := flow(t, fieldRequest("-.5*x-2*y", "2*x-.5*y", seeds, 30, 0, 28))
	for _, l := range []float64{1e-4, 1e3} {
		scaled := []Seed{{seeds[0].X * l, seeds[0].Y * l}, {seeds[1].X * l, seeds[1].Y * l}}
		res := flow(t, fieldRequest(u, v, scaled, 30*l, 0, 3))
		for i, path := range flow(t, fieldRequest("-.5*x-2*y", "2*x-.5*y", scaled, 30*l, 0, 28)).Paths {
			for j, p := range sink.Paths[i] {
				if d := path[j].Mul(1 / l).Sub(*p).Norm(); d > 1e-9*p.Norm() {
					t.Fatalf("λ=%g sink %d sample %d: %v vs %v", l, i, j, *p, path[j].Mul(1/l))
				}
			}
		}
		for i := range seeds {
			if a, b := base.Ends[i], res.Ends[i]; a.Reason != b.Reason || math.Abs(a.Time-b.Time) > 1e-9 {
				t.Fatalf("λ=%g seed %d ends %+v and %+v", l, i, a, b)
			}
			for j, p := range base.Paths[i] {
				q := res.Paths[i][j]
				if (p == nil) != (q == nil) || p != nil && q.Mul(1/l).Sub(*p).Norm() > 1e-9*p.Norm()+1e-12 {
					t.Fatalf("λ=%g seed %d sample %d: %v vs %v", l, i, j, p, q)
				}
			}
		}
	}
}

func TestFieldStepBudget(t *testing.T) {
	saved := maxFieldSteps
	defer func() { maxFieldSteps = saved }()
	maxFieldSteps = 20
	r := compute(t, fieldRequest(spinX, spinY, []Seed{{1, 0}, {0, 0}}, 10, 0, 50))
	e := r.Field.Ends[0]
	if e.Reason != "exhausted" || !(e.Time > 0 && e.Time < 50) {
		t.Fatalf("ends %+v", e)
	}
	// A fixed point needs no error control, only a few growing steps.
	if e := r.Field.Ends[1]; e.Reason != "end" {
		t.Fatalf("fixed point ends %+v", e)
	}
	f, _, _ := VectorField{X: spinX, Y: spinY}.system(0)
	if s := newTrajectory(f, Seed{1, 0}, 0, 50, 10, fieldTolerance).steps(); s > 20 {
		t.Fatalf("%d steps", s)
	}
	r = compute(t, fieldRequest(spinX, spinY, []Seed{{0, 0}, {1, 0}}, 10, 0, 50))
	if want := fmt.Sprintf("Trajectory 2 ran out of integration steps at t = %.6g;", r.Field.Ends[1].Time); !strings.Contains(strings.Join(r.Warnings, " "), want) {
		t.Fatalf("warnings %v, want %q", r.Warnings, want)
	}
	r = compute(t, fieldRequest(spinX, spinY, []Seed{{1, 0}, {0, 0}, {0, 2}}, 10, 0, 50))
	if !strings.Contains(strings.Join(r.Warnings, " "), "Trajectories 1, 3 ran out of integration steps;") {
		t.Fatalf("warnings %v", r.Warnings)
	}
}

func TestFieldInvalid(t *testing.T) {
	ok := []Seed{{0, 0}}
	many := make([]Seed, 17)
	for _, tc := range []struct {
		u, v   string
		seeds  []Seed
		escape float64
		want   string
	}{
		{"x", "y", nil, 1, "1–16 seeds"},
		{"x", "y", many, 1, "1–16 seeds"},
		{"x", "y", []Seed{{0, 0}, {math.NaN(), 0}}, 1, "seed 2: the coordinates"},
		{"x", "y", []Seed{{0, -2e5}}, 1, "seed 1: the coordinates"},
		{"x", "y", ok, 0, "escape radius"},
		{"x", "y", ok, math.Inf(1), "escape radius"},
		{"x", "y", ok, 2e5, "escape radius"},
		{"x+", "y", ok, 1, "dx/dt:"},
		{"x", "z", ok, 1, "dy/dt:"},
	} {
		if _, err := Compute(fieldRequest(tc.u, tc.v, tc.seeds, tc.escape, 0, 1)); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%+v: got %v, want %q", tc, err, tc.want)
		}
	}
}

func TestFieldResultJSON(t *testing.T) {
	r := compute(t, fieldRequest("-y", "x", []Seed{{1, 0}}, 2, 0, 1))
	b, _ := json.Marshal(r.Field)
	for _, key := range []string{`"paths":[[`, `"arrows":[{"sampleIndex":0,"seed":0,"point":{"x":1,"y":0},"velocity":{"x":`, `"ends":[{"time":1,"reason":"end"}]`, `"grid":{"spacing":`, `"points":[{"point":{`, `"timed":false`} {
		if !strings.Contains(string(b), key) {
			t.Fatalf("%s lacks %s", b, key)
		}
	}
	b, _ = json.Marshal(compute(t, request("evolute", "cos(t)", "sin(t)", 0, 1)))
	if strings.Contains(string(b), `"field"`) {
		t.Fatal("field result on a parametric curve")
	}
}

func TestFieldGridEdges(t *testing.T) {
	// A lone fixed point has a unit square of directions around it, without
	// the point itself, where the field is zero.
	g := flow(t, fieldRequest("-y", "x", []Seed{{0, 0}}, 1, 0, 1)).Grid
	if len(g.Points) != 21*21-1 || math.Abs(g.Spacing-1.0/20) > 1e-15 {
		t.Fatalf("%d points, spacing %v", len(g.Points), g.Spacing)
	}
	// A field that is not finite on part of the lattice skips it.
	g = flow(t, fieldRequest("1/x", "0", []Seed{{1, 0}}, 10, 0, 1)).Grid
	for _, d := range g.Points {
		if d.Point.X == 0 {
			t.Fatalf("direction %+v at the pole", d)
		}
	}
	// With no trajectory there is nothing to span.
	if g := flow(t, fieldRequest("-y", "x", []Seed{{5, 0}}, 1, 0, 1)).Grid; len(g.Points) != 0 {
		t.Fatalf("%d points without a trajectory", len(g.Points))
	}
}
