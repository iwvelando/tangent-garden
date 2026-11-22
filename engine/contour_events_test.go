package engine

import (
	"math"
	"tangentgarden/engine/expr"
	"testing"
)

// The planar topology events' fields (docs/mathematics.md, Planar
// events), written here as functions, independently of the recipes'
// text, with their critical points and the class of every regular level
// between them derived by hand.
type planarCritical struct {
	x, y, value float64
	// index is the number of negative Hessian eigenvalues, or −1 where the
	// Hessian vanishes.
	index int
}
type planarSide struct {
	below, above float64
	class        string
}
type planarField struct {
	name, f  string
	field    func(x, y float64) float64
	window   Window
	critical []planarCritical
	// The sides, ascending, with the critical levels between them.
	sides  []planarSide
	events []float64
}

var r2 = math.Sqrt2

var planarFields = []planarField{
	{
		name:   "cassini",
		f:      "((x-1)^2+y^2)*((x+1)^2+y^2)",
		field:  func(x, y float64) float64 { return ((x-1)*(x-1) + y*y) * ((x+1)*(x+1) + y*y) },
		window: Window{-2, 2, -1.5, 1.5},
		critical: []planarCritical{
			{-1, 0, 0, 0}, {1, 0, 0, 0}, {0, 0, 1, 1},
		},
		sides:  []planarSide{{0.49, 1, "-()-()"}, {1, 1.69, "-()"}},
		events: []float64{1},
	},
	{
		name: "four-wells",
		f:    "x^4-4*x^2+y^4-4*y^2",
		field: func(x, y float64) float64 {
			g := func(t float64) float64 { return t*t*t*t - 4*t*t }
			return g(x) + g(y)
		},
		window: Window{-2.5, 2.5, -2.5, 2.5},
		critical: []planarCritical{
			{-r2, -r2, -8, 0}, {-r2, r2, -8, 0}, {r2, -r2, -8, 0}, {r2, r2, -8, 0},
			{0, -r2, -4, 1}, {0, r2, -4, 1}, {-r2, 0, -4, 1}, {r2, 0, -4, 1},
			{0, 0, 0, 2},
		},
		sides:  []planarSide{{-7.5, -4, "-()-()-()-()"}, {-4, 0, "-(+())"}, {0, 4, "-()"}},
		events: []float64{-4, 0},
	},
	{
		name: "three-petals",
		f:    "(x^3-3*x*y^2-1)^2+(3*x^2*y-y^3)^2",
		field: func(x, y float64) float64 {
			z := complex(x, y)
			return math.Pow(cmplxAbs(z*z*z-1), 2)
		},
		window: Window{-1.6, 1.6, -1.6, 1.6},
		critical: []planarCritical{
			{1, 0, 0, 0}, {-0.5, math.Sqrt(3) / 2, 0, 0}, {-0.5, -math.Sqrt(3) / 2, 0, 0}, {0, 0, 1, -1},
		},
		sides:  []planarSide{{0.25, 1, "-()-()-()"}, {1, 2.25, "-()"}},
		events: []float64{1},
	},
}

// The gradient and Hessian by central differences of step h.
func planarDerivatives(f func(x, y float64) float64, x, y, h float64) (gx, gy, hxx, hxy, hyy float64) {
	gx = (f(x+h, y) - f(x-h, y)) / (2 * h)
	gy = (f(x, y+h) - f(x, y-h)) / (2 * h)
	hxx = (f(x+h, y) - 2*f(x, y) + f(x-h, y)) / (h * h)
	hyy = (f(x, y+h) - 2*f(x, y) + f(x, y-h)) / (h * h)
	hxy = (f(x+h, y+h) - f(x+h, y-h) - f(x-h, y+h) + f(x-h, y-h)) / (4 * h * h)
	return
}

// Each recipe is its field, and each listed point is critical with the
// stated value and index.
func TestPlanarEventFields(t *testing.T) {
	for _, s := range planarFields {
		f, _, err := expr.ParseFieldUses(s.f, 0)
		if err != nil {
			t.Fatal(err)
		}
		for k := range 200 {
			x := s.window.XMin + (s.window.XMax-s.window.XMin)*math.Mod(float64(k)*0.6180339887, 1)
			y := s.window.YMin + (s.window.YMax-s.window.YMin)*math.Mod(float64(k)*0.7548776662, 1)
			if want, got := s.field(x, y), f(x, y, 0); math.Abs(want-got) > 1e-12*math.Max(1, math.Abs(want)) {
				t.Fatalf("%s at (%g, %g): recipe %g, field %g", s.name, x, y, got, want)
			}
		}
		for _, p := range s.critical {
			if v := s.field(p.x, p.y); math.Abs(v-p.value) > 1e-12 {
				t.Fatalf("%s: F(%g, %g) = %g, want %g", s.name, p.x, p.y, v, p.value)
			}
			gx, gy, hxx, hxy, hyy := planarDerivatives(s.field, p.x, p.y, 1e-4)
			if math.Hypot(gx, gy) > 1e-6 {
				t.Fatalf("%s: ∇F(%g, %g) = (%g, %g)", s.name, p.x, p.y, gx, gy)
			}
			det, trace := hxx*hyy-hxy*hxy, hxx+hyy
			index := map[bool]int{true: 1, false: 0}[det < 0]
			if det > 0 && trace < 0 {
				index = 2
			}
			if p.index < 0 {
				if math.Abs(hxx)+math.Abs(hxy)+math.Abs(hyy) > 1e-5 {
					t.Fatalf("%s: the Hessian at (%g, %g) is (%g, %g, %g), not 0", s.name, p.x, p.y, hxx, hxy, hyy)
				}
			} else if math.Abs(det) < 1 || index != p.index {
				t.Fatalf("%s: (%g, %g) has index %d, det %g, want %d", s.name, p.x, p.y, index, det, p.index)
			}
		}
	}
}

// No other critical point lies in the window: on a fine grid, every cell
// where both components of ∇F change sign is beside a listed point, and
// every listed point is found.
func TestPlanarEventCompleteness(t *testing.T) {
	const n = 640
	for _, s := range planarFields {
		w := s.window
		hx, hy := (w.XMax-w.XMin)/n, (w.YMax-w.YMin)/n
		grad := make([][2]float64, (n+1)*(n+1))
		for j := 0; j <= n; j++ {
			for i := 0; i <= n; i++ {
				gx, gy, _, _, _ := planarDerivatives(s.field, w.XMin+hx*float64(i), w.YMin+hy*float64(j), 1e-6)
				grad[j*(n+1)+i] = [2]float64{gx, gy}
			}
		}
		found := make([]bool, len(s.critical))
		for j := range n {
			for i := range n {
				changes := func(c int) bool {
					lo, hi := math.Inf(1), math.Inf(-1)
					for _, k := range []int{j*(n+1) + i, j*(n+1) + i + 1, (j+1)*(n+1) + i, (j+1)*(n+1) + i + 1} {
						lo, hi = math.Min(lo, grad[k][c]), math.Max(hi, grad[k][c])
					}
					return lo <= 0 && hi >= 0
				}
				if !changes(0) || !changes(1) {
					continue
				}
				x, y := w.XMin+hx*(float64(i)+.5), w.YMin+hy*(float64(j)+.5)
				near := false
				for k, p := range s.critical {
					if math.Abs(p.x-x) <= 2*hx && math.Abs(p.y-y) <= 2*hy {
						near, found[k] = true, true
					}
				}
				if !near {
					t.Fatalf("%s: ∇F may vanish near (%g, %g), which is not listed", s.name, x, y)
				}
			}
		}
		for k, ok := range found {
			if !ok {
				t.Fatalf("%s: critical point %+v not found", s.name, s.critical[k])
			}
		}
	}
}

// classify traces one level with its topology.
func classify(t *testing.T, f string, c float64, w Window, cells int) *ContourResult {
	t.Helper()
	q := implicitRequest(f, c, w, cells)
	q.Topology = true
	return contours(t, q)
}

// Between critical levels the traced curve reads the analysis, on several
// grids, in a window shifted off the story's and in a larger one: a class
// that held only for one grid would be the grid's, not the field's.
func TestPlanarEventClasses(t *testing.T) {
	for _, s := range planarFields {
		w := s.window
		shift := func(dx, dy, grow float64) Window {
			cx, cy := (w.XMin+w.XMax)/2+dx, (w.YMin+w.YMax)/2+dy
			hw, hh := (w.XMax-w.XMin)/2*grow, (w.YMax-w.YMin)/2*grow
			return Window{cx - hw, cx + hw, cy - hh, cy + hh}
		}
		windows := []Window{w, shift(0.0123, -0.0071, 1), shift(-0.031, 0.017, 1.25)}
		for _, side := range s.sides {
			for k := 1; k <= 5; k++ {
				// Five levels across the side, kept a tenth of its width from
				// either end, where narrowing features outgrow these grids.
				c := side.below + (side.above-side.below)*(0.1+0.8*float64(k-1)/4)
				for _, win := range windows {
					for _, cells := range []int{96, 160, 161, 257} {
						top := classify(t, s.f, c, win, cells).Topology
						if top.Class != side.class || top.Open != 0 || top.Rejected != 0 || top.Unclassified {
							t.Fatalf("%s at c = %g, %d cells in %v: %+v, want %s", s.name, c, cells, win, top, side.class)
						}
					}
				}
			}
		}
	}
}

// Close to an event a narrowing feature can be finer than the grid: the
// reading then differs from the analysis until the grid resolves it. The
// analysis, not the trace, says what the curve is.
func TestPlanarEventResolution(t *testing.T) {
	wells := planarFields[1]
	for _, tc := range []struct {
		c              float64
		coarse, fine   int
		misread, class string
	}{
		// The ring's necks, 0.01 above the saddles.
		{-3.99, 40, 96, "-()-()-()-()", "-(+())"},
		// The hollow about the maximum, of radius about 0.016, while a
		// 161-cell grid's cells are 0.031 wide.
		{-0.001, 161, 400, "-()", "-(+())"},
	} {
		if top := classify(t, wells.f, tc.c, wells.window, tc.coarse).Topology; top.Class != tc.misread {
			t.Fatalf("c = %g on %d cells reads %s, want the misreading %s", tc.c, tc.coarse, top.Class, tc.misread)
		}
		if top := classify(t, wells.f, tc.c, wells.window, tc.fine).Topology; top.Class != tc.class {
			t.Fatalf("c = %g on %d cells reads %s, want %s", tc.c, tc.fine, top.Class, tc.class)
		}
	}
}

// At a critical level the curve is singular: it crosses itself or a loop
// is a point. The trace is still a complete, closed picture, with no pole
// claimed, but what it reads depends on the grid, so no class is claimed
// for it. Cassini's saddle lies on a grid point at 160 cells, where the
// two loops are traced touching there, and between grid points at 161,
// where the cell's decider joins them.
func TestPlanarEventCriticalLevels(t *testing.T) {
	for _, s := range planarFields {
		for _, c := range s.events {
			for _, cells := range []int{96, 160, 161, 400} {
				r := classify(t, s.f, c, s.window, cells)
				if top := r.Topology; top.Open != 0 || top.Rejected != 0 || r.Nonfinite != 0 || len(r.Discontinuities) != 0 || len(r.Curve.Contours) == 0 {
					t.Fatalf("%s at its critical level %g on %d cells: %+v", s.name, c, cells, top)
				}
			}
		}
	}
	cassini := planarFields[0]
	node := classify(t, cassini.f, 1, cassini.window, 160)
	if node.Topology.Class != "-()-()" {
		t.Fatalf("on a grid point the saddle reads %s", node.Topology.Class)
	}
	for k, c := range node.Curve.Contours {
		touches := false
		for _, p := range c.Points {
			touches = touches || p == (Vec{0, 0})
		}
		if !touches {
			t.Fatalf("loop %d does not pass through the saddle", k)
		}
	}
	if between := classify(t, cassini.f, 1, cassini.window, 161); between.Topology.Class != "-()" {
		t.Fatalf("between grid points the saddle reads %s", between.Topology.Class)
	}
}

// A window that cuts the curve leaves open contours, which are never nested
// or coded: leaving the window is not a change of topology.
func TestPlanarEventWindowCuts(t *testing.T) {
	cassini := planarFields[0]
	// At c = 1.21 the loop reaches x = ±√2.1 ≈ ±1.449.
	cut := Window{-1.2, 1.2, -1.5, 1.5}
	top := classify(t, cassini.f, 1.21, cut, 160).Topology
	if top.Open != 2 || top.Class != "" || len(top.Loops) != 2 || !top.Loops[0].Open || !top.Loops[1].Open {
		t.Fatalf("cut: %+v", top)
	}
	// Cutting one loop of two leaves the other whole and coded.
	right := Window{-2, 1.2, -1.5, 1.5}
	if top := classify(t, cassini.f, 0.81, right, 160).Topology; top.Open != 1 || top.Class != "-()" {
		t.Fatalf("one loop cut: %+v", top)
	}
}

// The classification's own work is bounded: the four wells' ring, its most
// nested side, at the largest grid.
func TestPlanarEventLargestGrid(t *testing.T) {
	wells := planarFields[1]
	r := classify(t, wells.f, -2, wells.window, maxCells)
	if r.Topology.Class != "-(+())" {
		t.Fatalf("%+v", r.Topology)
	}
}
