package physical

import (
	"math"
	"testing"
)

// analyze samples a plan at step h and examines its cells for need.
func analyze(t *testing.T, p Plan, comp []int32, need, h float64) CellReport {
	t.Helper()
	g, err := Sample(p, h, need/2+2*h, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	return AnalyzeCells(g, p, comp, need)
}

// A ring's hole is a closed cell whose inscribed diameter is the hole's.
// Passing and failing it on either side of the need, outside the grid's
// allowance, and unresolved inside it.
func TestCellsBoundaryPair(t *testing.T) {
	const need, h = 1.0, 0.1
	// Centered on a node the sample is exact; half a step off in both
	// directions it falls short by up to the allowance, leaving holes
	// just either side of the need unresolved.
	for _, c := range []struct {
		hole, off float64
		want      CellStatus
	}{{1.2, 0.05, CellPass}, {0.8, 0.05, CellFail}, {need + 0.02, 0, CellPass}, {need + 0.02, 0.05, CellUnresolved}, {need - 0.02, 0.05, CellFail}, {need - 0.05, 0, CellUnresolved}} {
		// A ring of half width 1 around a hole of the given diameter.
		p := Plan{Strokes: Circle(complex(c.off, c.off), c.hole/2+1, 1), Outer: 10}
		r := analyze(t, p, []int32{0, 0, 0}, need, h)
		worst := r.Worst()
		if worst.Status != c.want {
			t.Errorf("hole %.2f: %v (sampled diameter %.3f, allowance %.3f)", c.hole, worst.Status, 2*worst.Radius, 2*r.Allowance)
		}
		// The sampled radius is a lower bound within the allowance.
		if worst.Radius > c.hole/2+1e-9 || worst.Radius < c.hole/2-r.Allowance {
			t.Errorf("hole %.2f: sampled radius %.4f", c.hole, worst.Radius)
		}
	}
}

// Separate source pieces must stay the need apart: two rings, separate
// pieces, at gaps either side of it.
func TestCellsSeparationPair(t *testing.T) {
	const need, h = 1.0, 0.1
	for _, c := range []struct {
		gap  float64
		fail bool
	}{{1.3, false}, {0.7, true}, {-0.5, true}} {
		d := 2*(3+1) + c.gap
		strokes := append(Circle(0, 3, 1), Circle(complex(d, 0), 3, 1)...)
		comp := []int32{0, 0, 0, 1, 1, 1}
		r := analyze(t, Plan{Strokes: strokes, Outer: 20}, comp, need, h)
		if got := len(r.Fused) > 0; got != c.fail {
			t.Errorf("gap %.1f: fused %v", c.gap, r.Fused)
		}
		// The same rings as one piece are never "fused".
		r = analyze(t, Plan{Strokes: strokes, Outer: 20}, make([]int32, 6), need, h)
		if len(r.Fused) > 0 {
			t.Errorf("gap %.1f, one piece: fused %v", c.gap, r.Fused)
		}
	}
}

// A narrow channel open at both ends passes as a cell but shows as narrow
// area; a wide one does not.
func TestCellsNarrowChannel(t *testing.T) {
	const need, h = 1.0, 0.1
	for _, c := range []struct {
		gap    float64
		narrow bool
	}{{1.4, false}, {0.6, true}} {
		strokes := []Stroke{
			{A: -8 - 1i, B: 8 - 1i, Straight: true, Half: 1},
			{A: complex(-8, 1+c.gap), B: complex(8, 1+c.gap), Straight: true, Half: 1},
		}
		r := analyze(t, Plan{Strokes: strokes, Outer: 15}, []int32{0, 0}, need, h)
		if r.Worst().Status != CellPass {
			t.Errorf("gap %.1f: cell %v", c.gap, r.Worst())
		}
		// The channel is 16 mm long: narrow area about 16·gap.
		if got := r.NarrowArea > 4; got != c.narrow {
			t.Errorf("gap %.1f: narrow area %.2f mm²", c.gap, r.NarrowArea)
		}
	}
}

// Line width, floor and relief against a profile's minima: exact
// comparisons on either side.
func TestHeightsAndWidthBoundaryPairs(t *testing.T) {
	prof := DefaultProfiles()[0]
	prof.Strut, prof.Floor = 2, 1.2
	for _, c := range []struct {
		line, floor float64
		ok          bool
	}{{2, 1.2, true}, {1.9, 1.2, false}, {2, 1.1, false}} {
		d := Design{Treatment: Raised, Line: c.line, Floor: c.floor, Relief: 1.2}
		items := sizeChecks(d, prof)
		ok := true
		for _, it := range items {
			if it.Required && it.Status != StatusPass {
				ok = false
			}
		}
		if ok != c.ok {
			t.Errorf("line %.1f floor %.1f: %+v", c.line, c.floor, items)
		}
	}
	if math.IsNaN(layers(1.2, prof)) {
		t.Error("layers")
	}
}

// A ring whose band covers its own hole leaves no cell to fail; the
// source's cell inside it has vanished, and that fails.
func TestCellsVanishedSourceCell(t *testing.T) {
	const need, h = 1.0, 0.1
	for _, c := range []struct {
		half     float64
		vanished bool
	}{{0.6, false}, {1.3, true}} {
		p := Plan{Strokes: Circle(0, 1.2, c.half), Outer: 10}
		r := analyze(t, p, []int32{0, 0, 0}, need, h)
		if (r.Vanished == 1) != c.vanished || c.vanished && r.Worst().Status != CellFail {
			t.Errorf("half %.1f: vanished %d, worst %+v", c.half, r.Vanished, r.Worst())
		}
	}
}

// A wedge tip narrower than a step, cut off by sampling, is filled; a
// real cell is not.
func TestCleanFillsSpecksOnly(t *testing.T) {
	// Two bands meeting at a sharp angle leave a wedge whose tip the grid
	// cuts off; the ring's hole is a real cell.
	strokes := append(Circle(complex(-6, 0), 2.5, 0.5),
		Stroke{A: 0, B: complex(9, 0.9), Straight: true, Half: 0.5},
		Stroke{A: 0, B: complex(9, -0.9), Straight: true, Half: 0.5})
	g, err := Sample(Plan{Strokes: strokes, Outer: 12}, 0.2, 2, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := label(g, func(k int) bool { return g.F[k] > 0 }, func(k int) float64 { return g.F[k] }, false)
	g.Clean()
	after, n := label(g, func(k int) bool { return g.F[k] > 0 }, func(k int) float64 { return g.F[k] }, false)
	sizes := make([]int, n+1)
	for _, l := range after {
		sizes[l]++
	}
	for l := 1; l <= n; l++ {
		if sizes[l] <= 3 {
			t.Errorf("a speck of %d nodes remains", sizes[l])
		}
	}
	// The ring's hole survives.
	i, j := g.index(complex(-6, 0) + complex(g.H/2, g.H/2))
	if after[j*g.NX+i] == 0 || before[j*g.NX+i] == 0 {
		t.Error("the ring's hole was filled")
	}
}

// The contour and the cell labels resolve saddles alike, so the pieces
// the solid is built from are the pieces the checks count: bands that
// nearly touch across many grid cells' diagonals, counted both ways.
func TestContourAndLabelsAgreeAtSaddles(t *testing.T) {
	var strokes []Stroke
	// Pairs of disks touching across a diagonal within a fraction of a
	// step, at offsets that land between nodes.
	for k := range 100 {
		x, y := float64(k%10)*2.2-10, float64(k/10)*2.2-10
		off := complex(0.013*float64(k%7), 0.017*float64(k%5))
		gap := 0.004 * float64(k%9)
		a := complex(x, y) + off
		b := a + complex(1, 1)*complex((1.1+gap)/math.Sqrt2, 0)
		strokes = append(strokes, Circle(a, 0.05, 0.5)...)
		strokes = append(strokes, Circle(b, 0.05, 0.5)...)
	}
	g, err := Sample(Plan{Strokes: strokes, Outer: 14}, 0.1, 1, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	saddles := 0
	for j := 0; j < g.NY-1; j++ {
		for i := 0; i < g.NX-1; i++ {
			a, b := g.F[j*g.NX+i] < 0, g.F[j*g.NX+i+1] < 0
			c, d := g.F[(j+1)*g.NX+i+1] < 0, g.F[(j+1)*g.NX+i] < 0
			if a == c && b == d && a != b {
				saddles++
			}
		}
	}
	if saddles == 0 {
		t.Fatal("the fixture has no saddle cells")
	}
	cs, err := g.Contour(DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	polys, _ := Nest(cs.Points, cs.Loops)
	_, inside := label(g, func(k int) bool { return g.F[k] < 0 }, func(k int) float64 { return g.F[k] }, true)
	if len(polys) != inside {
		t.Errorf("%d saddles: the contour makes %d pieces of the plan, the labels %d", saddles, len(polys), inside)
	}
	t.Logf("%d saddle cells, %d pieces", saddles, len(polys))
}
