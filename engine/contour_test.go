package engine

import (
	"encoding/json"
	"math"
	"strings"
	"tangentgarden/engine/expr"
	"testing"
)

func implicitRequest(f string, level float64, w Window, cells int) Request {
	q := request("evolute", "", "", 0, 1)
	q.Curve = Curve{Format: "implicit", Implicit: Implicit{F: f, Level: level, Window: w, Cells: cells}, Min: 0, Max: 1}
	return q
}

func contours(t *testing.T, q Request) *ContourResult {
	t.Helper()
	r := compute(t, q)
	if r.Contours == nil {
		t.Fatal("no contour result")
	}
	if len(r.Base) != 0 || len(r.Derived) != 0 || r.Base == nil || r.Derived == nil {
		t.Fatalf("an implicit curve has empty base and derived paths, got %d and %d", len(r.Base), len(r.Derived))
	}
	return r.Contours
}

func square(r float64) Window { return Window{-r, r, -r, r} }

// residual checks every vertex of every contour of a level against F = c,
// and that no chord has zero length.
func residual(t *testing.T, set LevelSet, f func(p Vec) float64, tol float64) {
	t.Helper()
	for i, c := range set.Contours {
		for _, e := range contourChords(c) {
			if e[0] == e[1] {
				t.Fatalf("level %v contour %d repeats %v", set.Level, i, e[0])
			}
		}
		for j, p := range c.Points {
			if d := math.Abs(f(p) - set.Level); !(d <= tol) {
				t.Fatalf("level %v contour %d point %d %v: F − c = %g", set.Level, i, j, p, d)
			}
		}
	}
}

// chords returns every segment of a contour, closing it when closed.
func contourChords(c Contour) [][2]Vec {
	var out [][2]Vec
	for j := 1; j < len(c.Points); j++ {
		out = append(out, [2]Vec{c.Points[j-1], c.Points[j]})
	}
	if c.Closed {
		out = append(out, [2]Vec{c.Points[len(c.Points)-1], c.Points[0]})
	}
	return out
}

// signedArea is positive for a counterclockwise closed contour.
func signedArea(c Contour) float64 {
	s := 0.0
	for _, e := range contourChords(c) {
		s += e[0].Cross(e[1]) / 2
	}
	return s
}

// sagitta is the largest distance of a chord's midpoint from the circle of
// radius r about the origin.
func sagitta(set LevelSet, r float64) float64 {
	worst := 0.0
	for _, c := range set.Contours {
		for _, e := range contourChords(c) {
			worst = math.Max(worst, math.Abs(e[0].Add(e[1]).Mul(.5).Norm()-r))
		}
	}
	return worst
}

func TestContourCircle(t *testing.T) {
	q := implicitRequest("x^2+y^2", 1, square(2), 40)
	q.Lines = 24
	res := contours(t, q)
	if res.Columns != 40 || res.Rows != 40 || res.Window != square(2) {
		t.Fatalf("grid %d×%d over %v", res.Columns, res.Rows, res.Window)
	}
	if len(res.Curve.Contours) != 1 || !res.Curve.Contours[0].Closed || res.Curve.Level != 1 {
		t.Fatalf("want one closed contour at level 1, got %+v", res.Curve)
	}
	residual(t, res.Curve, func(p Vec) float64 { return p.Dot(p) }, 1e-12)
	c := res.Curve.Contours[0]
	// Larger F lies on the left: outward, so the circle runs clockwise.
	// The inscribed polygon falls short of the area by at most about
	// ⅔ · perimeter · sagitta.
	if a := signedArea(c); math.Abs(a+math.Pi) > 1e-3 {
		t.Fatalf("signed area %v, want −π", a)
	}
	// Refinement keeps every chord within a thousandth of a cell.
	if s := sagitta(res.Curve, 1); s > 1e-3*.1 {
		t.Fatalf("sagitta %g", s)
	}
	if len(res.Family) != 0 || len(res.Discontinuities) != 0 || res.Nonfinite != 0 {
		t.Fatalf("unexpected family %v, discontinuities %d, nonfinite %d", res.Family, len(res.Discontinuities), res.Nonfinite)
	}
	// The normals are the gradient at points evenly spaced by arc length.
	if len(res.Normals) != 24 {
		t.Fatalf("%d normals", len(res.Normals))
	}
	for k, n := range res.Normals {
		if d := math.Abs(n.Point.Norm() - 1); d > 1e-12 {
			t.Fatalf("normal %d at %v is off the circle by %g", k, n.Point, d)
		}
		if d := n.Gradient.Sub(n.Point.Mul(2)).Norm(); d > 1e-10 {
			t.Fatalf("normal %d gradient %v, want %v", k, n.Gradient, n.Point.Mul(2))
		}
		if k > 0 {
			prev := res.Normals[k-1].Point
			turn := math.Atan2(prev.Cross(n.Point), prev.Dot(n.Point))
			if math.Abs(turn+2*math.Pi/24) > 1e-4 {
				t.Fatalf("normals %d and %d are %v apart", k-1, k, turn)
			}
		}
	}
	// A decreasing F reverses the direction.
	// (0, −1) is a grid point where F = c with three crossed edges, and
	// the loop starts and ends there.
	q.Curve.Implicit.F, q.Curve.Implicit.Level = "-(x^2+y^2)", -1
	res = contours(t, q)
	residual(t, res.Curve, func(p Vec) float64 { return -p.Dot(p) }, 1e-12)
	if a := signedArea(res.Curve.Contours[0]); math.Abs(a-math.Pi) > 1e-3 {
		t.Fatalf("signed area %v, want π", a)
	}
	if p := res.Curve.Contours[0].Points[0]; p != (Vec{0, -1}) {
		t.Fatalf("the loop starts at %v", p)
	}
}

func TestContourLine(t *testing.T) {
	// 2x − y = .3 is a straight line across the window; larger F lies to
	// the right of increasing y, so the line runs downward.
	q := implicitRequest("2*x-y", .3, Window{-1, 1, -1.5, 1.5}, 20)
	res := contours(t, q)
	// Cells are counted along the longer side, here the height.
	if res.Columns != 13 || res.Rows != 20 {
		t.Fatalf("grid %d×%d", res.Columns, res.Rows)
	}
	if len(res.Curve.Contours) != 1 || res.Curve.Contours[0].Closed {
		t.Fatalf("want one open contour, got %+v", res.Curve.Contours)
	}
	c := res.Curve.Contours[0]
	residual(t, res.Curve, func(p Vec) float64 { return 2*p.X - p.Y }, 1e-14)
	first, last := c.Points[0], c.Points[len(c.Points)-1]
	if math.Abs(first.Y-1.5) > 1e-15 || math.Abs(last.Y+1.5) > 1e-15 {
		t.Fatalf("the line runs from %v to %v, want from the top edge to the bottom edge", first, last)
	}
	// A straight contour needs no refinement: one point per crossed edge.
	if len(c.Points) > 2*(13+20) {
		t.Fatalf("%d points on a straight line", len(c.Points))
	}
}

func TestContourRefinementConvergence(t *testing.T) {
	defer func(d int) { maxRefineDepth = d }(maxRefineDepth)
	q := implicitRequest("x^2+y^2", 1, square(1.5), 8)
	// Without refinement the chords cut inside the circle by O(h²).
	maxRefineDepth = 0
	var s [4]float64
	for k, cells := range []int{8, 16, 32, 64} {
		q.Curve.Implicit.Cells = cells
		s[k] = sagitta(contours(t, q).Curve, 1)
		if k > 0 && !(s[k] < s[k-1]/2) {
			t.Fatalf("%d cells: sagitta %g after %g", cells, s[k], s[k-1])
		}
	}
	if order := math.Log2(s[0]/s[3]) / 3; math.Abs(order-2) > .25 {
		t.Fatalf("convergence order %v, sagittas %v", order, s)
	}
	// Refinement subdivides the chords until they are within tolerance.
	q.Curve.Implicit.Cells = 8
	prev := math.Inf(1)
	for depth := 0; depth <= 6; depth++ {
		maxRefineDepth = depth
		res := contours(t, q)
		residual(t, res.Curve, func(p Vec) float64 { return p.Dot(p) }, 1e-12)
		s := sagitta(res.Curve, 1)
		if depth > 0 && !(s < prev/3) && s > 1e-3*3.0/8 {
			t.Fatalf("depth %d: sagitta %g after %g", depth, s, prev)
		}
		prev = s
	}
	if prev > 1e-3*3.0/8 {
		t.Fatalf("sagitta %g exceeds the tolerance", prev)
	}
}

func cassini(a float64) func(p Vec) float64 {
	return func(p Vec) float64 {
		return ((p.X-a)*(p.X-a) + p.Y*p.Y) * ((p.X+a)*(p.X+a) + p.Y*p.Y)
	}
}

func TestContourCassini(t *testing.T) {
	// ((x−a)² + y²)((x+a)² + y²) = b⁴: two ovals for b < a, one for b > a.
	// With 41 cells the saddle at the origin sits in a cell's center, where
	// the ambiguous cell must be decided; with 40 it is a grid point.
	const f = "((x-a)^2+y^2)*((x+a)^2+y^2)"
	for _, cells := range []int{40, 41} {
		for _, tc := range []struct {
			b     float64
			parts int
		}{{.5, 2}, {.9, 2}, {.99, 2}, {.999, 2}, {1.001, 1}, {1.01, 1}, {1.2, 1}, {1.5, 1}} {
			q := implicitRequest(f, math.Pow(tc.b, 4), Window{-2, 2, -1.5, 1.5}, cells)
			q.Curve.A = 1
			res := contours(t, q)
			set := res.Curve
			if len(set.Contours) != tc.parts {
				t.Fatalf("%d cells, b = %v: %d contours, want %d", cells, tc.b, len(set.Contours), tc.parts)
			}
			residual(t, set, cassini(1), 1e-12*math.Max(1, set.Level))
			for i, c := range set.Contours {
				if !c.Closed {
					t.Fatalf("b = %v: contour %d is open", tc.b, i)
				}
				// F grows outward from the foci, so every oval runs clockwise.
				if signedArea(c) >= 0 {
					t.Fatalf("b = %v: contour %d runs counterclockwise", tc.b, i)
				}
				// Two ovals stay on their own sides: nothing is joined
				// across the saddle.
				if tc.parts == 2 {
					side := math.Copysign(1, c.Points[0].X)
					for _, p := range c.Points {
						if p.X*side <= 0 {
							t.Fatalf("b = %v: oval %d crosses x = 0 at %v", tc.b, i, p)
						}
					}
				}
			}
		}
		// The lemniscate b = a passes through the saddle.
		q := implicitRequest(f, 1, Window{-2, 2, -1.5, 1.5}, cells)
		q.Curve.A = 1
		res := contours(t, q)
		if n := len(res.Curve.Contours); n < 1 || n > 2 {
			t.Fatalf("%d cells: the lemniscate has %d contours", cells, n)
		}
		residual(t, res.Curve, cassini(1), 1e-12)
	}
}

func TestContourSaddle(t *testing.T) {
	// Hyperbolas near a saddle keep their branches apart, whichever side of
	// the saddle value the level is on, whether the saddle is a grid point
	// (20 cells) or inside a cell (21).
	for _, cells := range []int{20, 21} {
		for _, tc := range []struct {
			f     string
			level float64
			side  func(p Vec) float64
		}{
			{"x^2-y^2", 1e-3, func(p Vec) float64 { return p.X }},
			{"x^2-y^2", -1e-3, func(p Vec) float64 { return p.Y }},
			{"x*y", 1e-3, func(p Vec) float64 { return p.X }},
			{"x*y", -1e-3, func(p Vec) float64 { return p.X }},
		} {
			res := contours(t, implicitRequest(tc.f, tc.level, square(1), cells))
			if len(res.Curve.Contours) != 2 {
				t.Fatalf("%s = %v, %d cells: %d contours", tc.f, tc.level, cells, len(res.Curve.Contours))
			}
			for i, c := range res.Curve.Contours {
				if c.Closed {
					t.Fatalf("%s = %v: branch %d is closed", tc.f, tc.level, i)
				}
				s := math.Copysign(1, tc.side(c.Points[0]))
				for _, p := range c.Points {
					if tc.side(p)*s <= 0 {
						t.Fatalf("%s = %v, %d cells: branch %d crosses to the other side at %v", tc.f, tc.level, cells, i, p)
					}
				}
			}
		}
	}
}

func TestContourIsolatedZeros(t *testing.T) {
	// A level that F touches without crossing has no contour, whether the
	// touching point is a grid point (20 cells) or not (21).
	for _, cells := range []int{20, 21} {
		for _, f := range []string{"x^2+y^2", "(x-.3)^2", "-(x^2+y^2)^2"} {
			res := contours(t, implicitRequest(f, 0, square(1), cells))
			if len(res.Curve.Contours) != 0 || len(res.Normals) != 0 {
				t.Fatalf("%s = 0, %d cells: %d contours", f, cells, len(res.Curve.Contours))
			}
		}
		// The isolated zero at the origin is not drawn; the circle is.
		res := contours(t, implicitRequest("(x^2+y^2)*(x^2+y^2-1)", 0, square(1.5), cells))
		if len(res.Curve.Contours) != 1 || !res.Curve.Contours[0].Closed {
			t.Fatalf("%d cells: %+v", cells, res.Curve.Contours)
		}
		for _, p := range res.Curve.Contours[0].Points {
			if d := math.Abs(p.Norm() - 1); d > 1e-12 {
				t.Fatalf("%d cells: %v is off the unit circle", cells, p)
			}
		}
	}
}

func TestContourDiscontinuities(t *testing.T) {
	// 20 × 10 cells over [−2, 2] × [−1, 1]: 11 rows of horizontal edges.
	w := Window{-2, 2, -1, 1}
	// 1/x changes sign across its pole without a zero; so does a jump,
	// placed where bisection never lands on it exactly.
	for _, f := range []string{"1/(x-.0501)", "(x-.0501)/abs(x-.0501)", "x+.001*(x-.0501)/abs(x-.0501)-.0501", "atan(1/(x-.0501))"} {
		res := contours(t, implicitRequest(f, 0, w, 20))
		if len(res.Curve.Contours) != 0 || len(res.Discontinuities) != 11 {
			t.Fatalf("%s: %d contours, %d discontinuities", f, len(res.Curve.Contours), len(res.Discontinuities))
		}
		// Each is located where F jumps, bottom row first.
		for k, p := range res.Discontinuities {
			if math.Abs(p.X-.0501) > 1e-15 || math.Abs(p.Y-(-1+.2*float64(k))) > 1e-15 {
				t.Fatalf("%s: discontinuity %d at %v", f, k, p)
			}
		}
	}
	// tan x has a zero at 0 and poles at ±π/2.
	res := contours(t, implicitRequest("tan(x)", 0, w, 20))
	if len(res.Curve.Contours) != 1 || len(res.Discontinuities) != 22 {
		t.Fatalf("tan: %d contours, %d discontinuities", len(res.Curve.Contours), len(res.Discontinuities))
	}
	for _, p := range res.Discontinuities {
		if math.Abs(math.Abs(p.X)-math.Pi/2) > 1e-15 {
			t.Fatalf("tan: a pole at %v", p)
		}
	}
	for _, p := range res.Curve.Contours[0].Points {
		if math.Abs(p.X) > 1e-15 {
			t.Fatalf("tan: %v is not on x = 0", p)
		}
	}
	// A steep but continuous crossing is a zero, not a discontinuity.
	res = contours(t, implicitRequest("tanh(1000*(x-.05))", 0, w, 20))
	if len(res.Curve.Contours) != 1 || len(res.Discontinuities) != 0 {
		t.Fatalf("tanh: %d contours, %d discontinuities", len(res.Curve.Contours), len(res.Discontinuities))
	}
	// F is infinite on x = 0, a column of grid points: the cells beside it
	// are left out, and the lines x = ±1/√5 are drawn whole.
	res = contours(t, implicitRequest("1/x^2", 5, w, 20))
	if res.Nonfinite != 11 || len(res.Curve.Contours) != 2 {
		t.Fatalf("1/x²: %d nonfinite, %d contours", res.Nonfinite, len(res.Curve.Contours))
	}
	for _, c := range res.Curve.Contours {
		if len(c.Points) < 11 || c.Closed {
			t.Fatalf("1/x²: %+v", c)
		}
		for _, p := range c.Points {
			if math.Abs(math.Abs(p.X)-1/math.Sqrt(5)) > 1e-12 {
				t.Fatalf("1/x²: %v", p)
			}
		}
	}
}

func TestContourNonfinite(t *testing.T) {
	// √(1 − x² − y²) is not a number outside the unit disc. Cells with a
	// corner there are left out, so the level is chosen with its circle,
	// of radius √.51, more than a cell's diagonal inside the disc.
	res := contours(t, implicitRequest("sqrt(1-x^2-y^2)", .7, square(1.5), 30))
	if len(res.Discontinuities) != 0 {
		t.Fatalf("%d discontinuities", len(res.Discontinuities))
	}
	f, _, _ := expr.ParseField("sqrt(1-x^2-y^2)", 0)
	outside := 0
	for j := 0; j <= 30; j++ {
		for i := 0; i <= 30; i++ {
			if !finite(f(-1.5+3*float64(i)/30, -1.5+3*float64(j)/30, 0)) {
				outside++
			}
		}
	}
	if res.Nonfinite != outside {
		t.Fatalf("%d nonfinite grid points, want %d", res.Nonfinite, outside)
	}
	if len(res.Curve.Contours) != 1 || !res.Curve.Contours[0].Closed {
		t.Fatalf("%+v", res.Curve.Contours)
	}
	for _, p := range res.Curve.Contours[0].Points {
		if d := math.Abs(p.Norm() - math.Sqrt(.51)); d > 1e-12 {
			t.Fatalf("%v is off the circle by %g", p, d)
		}
	}
	// A level F never reaches, beside where F is undefined, has nothing
	// to draw and no discontinuity.
	res = contours(t, implicitRequest("sqrt(1-x^2-y^2)", -.1, square(1.5), 30))
	if len(res.Curve.Contours) != 0 || len(res.Discontinuities) != 0 {
		t.Fatalf("%d contours, %d discontinuities", len(res.Curve.Contours), len(res.Discontinuities))
	}
	// Nearer the edge, where some cells touching the circle have a corner
	// outside the disc, the circle is left open around those cells rather
	// than joined across them.
	res = contours(t, implicitRequest("sqrt(1-x^2-y^2)", .5, square(1.5), 30))
	if len(res.Curve.Contours) < 2 {
		t.Fatalf("%d contours", len(res.Curve.Contours))
	}
	for _, c := range res.Curve.Contours {
		if c.Closed {
			t.Fatal("a contour beside the missing cells is closed")
		}
		for _, p := range c.Points {
			if d := math.Abs(p.Norm() - math.Sqrt(.75)); d > 1e-12 {
				t.Fatalf("%v is off the circle by %g", p, d)
			}
		}
		// Each end meets a cell left out, far from the window's edge.
		for _, p := range []Vec{c.Points[0], c.Points[len(c.Points)-1]} {
			if math.Abs(p.X) > 1.4 || math.Abs(p.Y) > 1.4 {
				t.Fatalf("an end %v is on the window's edge", p)
			}
		}
	}
}

func TestContourFamily(t *testing.T) {
	q := implicitRequest("x^2+y^2", 2.5, square(2.5), 50)
	q.Curve.Implicit.Family = Levels{Enabled: true, From: .3, To: 4.1, Count: 5}
	res := contours(t, q)
	if len(res.Family) != 5 || res.Family[0].Level != .3 || res.Family[4].Level != 4.1 {
		t.Fatalf("family %+v", res.Family)
	}
	for k, set := range res.Family {
		if want := .3 + (4.1-.3)*float64(k)/4; math.Abs(set.Level-want) > 1e-15 {
			t.Fatalf("level %d is %v, want %v", k, set.Level, want)
		}
		if len(set.Contours) != 1 || !set.Contours[0].Closed {
			t.Fatalf("level %v: %+v", set.Level, set.Contours)
		}
		residual(t, set, func(p Vec) float64 { return p.Dot(p) }, 1e-12)
	}
	if res.Curve.Level != 2.5 || len(res.Curve.Contours) != 1 {
		t.Fatalf("curve %+v", res.Curve)
	}
	// The normals belong to the curve itself.
	for _, n := range res.Normals {
		if math.Abs(n.Point.Dot(n.Point)-2.5) > 1e-12 {
			t.Fatalf("normal at %v", n.Point)
		}
	}
	// Levels beyond the range F takes in the window have no contours.
	q.Curve.Implicit.Family = Levels{Enabled: true, From: -1, To: 20, Count: 2}
	res = contours(t, q)
	if len(res.Family) != 2 || len(res.Family[0].Contours) != 0 || len(res.Family[1].Contours) != 0 {
		t.Fatalf("family %+v", res.Family)
	}
}

func TestContourScaleInvariance(t *testing.T) {
	for _, s := range []float64{1e-3, 1, 1e3} {
		q := implicitRequest("x^2+y^2", s*s, square(1.5*s), 24)
		res := contours(t, q)
		if len(res.Curve.Contours) != 1 {
			t.Fatalf("scale %v: %d contours", s, len(res.Curve.Contours))
		}
		residual(t, res.Curve, func(p Vec) float64 { return p.Dot(p) }, 1e-12*s*s)
		if g := sagitta(res.Curve, s) / s; g > 1e-3*3.0/24 {
			t.Fatalf("scale %v: relative sagitta %g", s, g)
		}
		if len(res.Normals) != q.Lines {
			t.Fatalf("scale %v: %d normals", s, len(res.Normals))
		}
	}
}

func TestContourBudget(t *testing.T) {
	defer func(c, p int) { maxContourCrossings, maxContourPoints = c, p }(maxContourCrossings, maxContourPoints)
	// Every family level beyond the crossing budget is skipped whole.
	maxContourCrossings = 1000
	q := implicitRequest("x^2+y^2", 1, square(2), 100)
	q.Curve.Implicit.Family = Levels{Enabled: true, From: .5, To: 3.5, Count: 7}
	r := compute(t, q)
	res := r.Contours
	if len(res.Family) >= 7 || len(res.Family) < 1 || len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "skipped") {
		t.Fatalf("%d family levels, warnings %q", len(res.Family), r.Warnings)
	}
	if want := res.Family[len(res.Family)-1].Level; !strings.Contains(r.Warnings[0], "after "+formatLevel(want)) {
		t.Fatalf("warning %q does not name the last level %v", r.Warnings[0], want)
	}
	// A curve beyond the budget is not traced at all, and neither is any
	// family level after it.
	maxContourCrossings = 100
	r = compute(t, q)
	if len(r.Contours.Curve.Contours) != 0 || len(r.Contours.Family) != 0 || len(r.Contours.Normals) != 0 || len(r.Warnings) != 2 ||
		!strings.Contains(r.Warnings[0], "curve was not traced") || !strings.Contains(r.Warnings[1], "Every family level") {
		t.Fatalf("%+v, warnings %q", r.Contours, r.Warnings)
	}
	// Edges bisected without a crossing, at a pole, count too.
	maxContourCrossings = 10
	r = compute(t, implicitRequest("1/(x-.0501)", 0, Window{-2, 2, -1, 1}, 20))
	if len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "curve was not traced") || len(r.Contours.Discontinuities) != 0 {
		t.Fatalf("%+v, warnings %q", r.Contours, r.Warnings)
	}
	// Refinement stops at the point budget.
	maxContourCrossings, maxContourPoints = 65536, 100
	r = compute(t, implicitRequest("x^2+y^2", 1, square(2), 20))
	n := len(r.Contours.Curve.Contours[0].Points)
	if n != 100 || len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "refine") {
		t.Fatalf("%d points, warnings %q", n, r.Warnings)
	}
}

func TestContourInvalid(t *testing.T) {
	ok := implicitRequest("x^2+y^2", 1, square(2), 40)
	for _, tc := range []struct {
		change func(*Implicit)
		want   string
	}{
		{func(v *Implicit) { v.F = "x+z" }, `F(x, y): unknown name "z"`},
		{func(v *Implicit) { v.F = "x+t" }, "F(x, y) cannot use t"},
		{func(v *Implicit) { v.Level = math.NaN() }, "the level must be finite"},
		{func(v *Implicit) { v.Level = math.Inf(1) }, "the level must be finite"},
		{func(v *Implicit) { v.Window.XMin = 3 }, "the window"},
		{func(v *Implicit) { v.Window.YMax = -2 }, "the window"},
		{func(v *Implicit) { v.Window.YMax = math.NaN() }, "the window"},
		{func(v *Implicit) { v.Window.XMax = 2e5 }, "the window"},
		{func(v *Implicit) { v.Window.XMax = -2 + 1e-7 }, "the window"},
		{func(v *Implicit) { v.Cells = 3 }, "4–1024 cells"},
		{func(v *Implicit) { v.Cells = 1025 }, "4–1024 cells"},
		{func(v *Implicit) { v.Family = Levels{Enabled: true, From: 0, To: 1, Count: 1} }, "2–64 levels"},
		{func(v *Implicit) { v.Family = Levels{Enabled: true, From: 0, To: 1, Count: 65} }, "2–64 levels"},
		{func(v *Implicit) { v.Family = Levels{Enabled: true, From: math.NaN(), To: 1, Count: 3} }, "family levels must be finite"},
	} {
		q := ok
		tc.change(&q.Curve.Implicit)
		if _, err := Compute(q); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("want %q, got %v", tc.want, err)
		}
	}
	// A disabled family is not checked.
	q := ok
	q.Curve.Implicit.Family = Levels{Count: 0, From: math.NaN()}
	contours(t, q)
	// The domain bounds play no part.
	q.Curve.Min, q.Curve.Max = 5, 5
	contours(t, q)
}

func TestContourResultJSON(t *testing.T) {
	q := implicitRequest("x^2+y^2", 1, square(2), 8)
	q.Curve.Implicit.Family = Levels{Enabled: true, From: .5, To: 2, Count: 2}
	r := compute(t, q)
	b, _ := json.Marshal(r)
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	c := m["contours"].(map[string]any)
	for _, k := range []string{"window", "columns", "rows", "curve", "family", "normals", "discontinuities", "nonfinite"} {
		if _, ok := c[k]; !ok {
			t.Fatalf("contours has no %q: %s", k, b)
		}
	}
	w := c["window"].(map[string]any)
	for _, k := range []string{"xMin", "xMax", "yMin", "yMax"} {
		if _, ok := w[k]; !ok {
			t.Fatalf("window has no %q", k)
		}
	}
	curve := c["curve"].(map[string]any)
	first := curve["contours"].([]any)[0].(map[string]any)
	if _, ok := first["closed"]; !ok || curve["level"] != 1.0 {
		t.Fatalf("curve %v", curve)
	}
	n := c["normals"].([]any)[0].(map[string]any)
	if _, ok := n["gradient"]; !ok {
		t.Fatalf("normal %v", n)
	}
	if base, ok := m["base"].([]any); !ok || len(base) != 0 {
		t.Fatalf("base %v", m["base"])
	}
	// Empty sets are empty arrays, not null.
	r = compute(t, implicitRequest("x^2+y^2", -1, square(2), 8))
	b, _ = json.Marshal(r.Contours)
	if !strings.Contains(string(b), `"contours":[]`) || !strings.Contains(string(b), `"family":[]`) || !strings.Contains(string(b), `"normals":[]`) || !strings.Contains(string(b), `"discontinuities":[]`) {
		t.Fatalf("%s", b)
	}
	// Other curves have no contour result.
	if r := compute(t, request("evolute", "cos(t)", "sin(t)", 0, 6)); r.Contours != nil {
		t.Fatal("a parametric curve has contours")
	}
}

// TraceLevel traces a field given as a function exactly as an implicit
// curve's expression, and carries its budget from call to call.
func TestTraceLevel(t *testing.T) {
	w := Window{-1.3, 1.7, -1.1, 1.2}
	res := contours(t, implicitRequest("x^2+y^2 - 0.4*x*y", 1, w, 37))
	f, _, err := expr.ParseField("x^2+y^2 - 0.4*x*y", 0)
	if err != nil {
		t.Fatal(err)
	}
	b := &ContourBudget{}
	set, discontinuities, ok := TraceLevel(func(x, y float64) float64 { return f(x, y, 0) }, w, 37, 1, b)
	if !ok || len(discontinuities) != 0 || b.Crossings == 0 || b.Points == 0 || b.Truncated {
		t.Fatalf("ok %v, discontinuities %v, budget %+v", ok, discontinuities, b)
	}
	got, _ := json.Marshal(set)
	want, _ := json.Marshal(res.Curve)
	if string(got) != string(want) {
		t.Fatalf("traced %s, implicit curve %s", got, want)
	}
	// A pole is located and not traced.
	b = &ContourBudget{}
	set, discontinuities, ok = TraceLevel(func(x, y float64) float64 { return 1 / (x - .0501) }, Window{-2, 2, -1, 1}, 20, 0, b)
	if !ok || len(set.Contours) != 0 || len(discontinuities) != 11 {
		t.Fatalf("contours %v, discontinuities %v", set.Contours, discontinuities)
	}
	for _, p := range discontinuities {
		if math.Abs(p.X-.0501) > 1e-12 {
			t.Fatalf("discontinuity at %v", p)
		}
	}
	// Grid points where the field is not finite leave their cells out.
	b = &ContourBudget{}
	set, _, _ = TraceLevel(func(x, y float64) float64 {
		if x < 0 {
			return math.NaN()
		}
		return x*x + y*y
	}, square(2), 40, 1, b)
	for _, c := range set.Contours {
		if c.Closed {
			t.Fatal("a contour beside undefined cells closed")
		}
		for _, p := range c.Points {
			if p.X < 0 {
				t.Fatalf("point %v in the undefined half", p)
			}
		}
	}
	// The budget spent before a call counts against it.
	defer func(c int) { maxContourCrossings = c }(maxContourCrossings)
	maxContourCrossings = 1000
	b = &ContourBudget{Crossings: 990}
	if set, _, ok = TraceLevel(func(x, y float64) float64 { return x*x + y*y }, square(2), 100, 1, b); ok || len(set.Contours) != 0 || b.Crossings != 990 {
		t.Fatalf("ok %v, %d contours, budget %+v", ok, len(set.Contours), b)
	}
}
