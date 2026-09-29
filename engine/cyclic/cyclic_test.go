package cyclic

import (
	"math"
	"testing"
)

// The chase is the same in any dimension: two pursuers on a line close at
// the sum of their speeds, and embedding them in more dimensions changes
// nothing.
func TestRunAnyDimension(t *testing.T) {
	want := (3 - .5) / 3
	for dim := 1; dim <= 4; dim++ {
		start := make([]float64, 2*dim)
		start[0], start[dim] = -1, 2
		c := Run(start, dim, []float64{1, 2}, .5, 0, 2, 1e-12, 40000)
		if c.Capture == nil || c.Capture.Pursuer != 0 || c.Capture.Target != 1 || math.Abs(c.Capture.Time-want) > 1e-12 || c.End != c.Capture.Time || c.Complete {
			t.Fatalf("dim %d: capture %+v end %v", dim, c.Capture, c.End)
		}
		y, ok := c.State(.5)
		if !ok || math.Abs(y[0]+.5) > 1e-12 || math.Abs(y[dim]-1) > 1e-12 {
			t.Fatalf("dim %d: state %v", dim, y)
		}
		for k := 1; k < dim; k++ {
			if y[k] != 0 || y[dim+k] != 0 {
				t.Fatalf("dim %d: left the line: %v", dim, y)
			}
		}
	}
}

// Nobody moves: the chase runs to the end, complete.
func TestRunStill(t *testing.T) {
	c := Run([]float64{0, 0, 1, 0, 0, 1}, 2, []float64{0, 0, 0}, .1, 0, 5, 1e-12, 40000)
	if c.Capture != nil || c.Exhausted || !c.Complete || c.End != 5 {
		t.Fatalf("%+v", c)
	}
}

// A budget that runs out is reported with the time reached.
func TestRunBudget(t *testing.T) {
	c := Run([]float64{1, 0, 0, 1, -1, 0}, 2, []float64{1, 1, 1}, 1e-3, 0, 5, 1e-12, 5)
	if !c.Exhausted || c.Capture != nil || c.Complete || c.End <= 0 || c.End >= 5 {
		t.Fatalf("%+v", c)
	}
}

// The smallest gap, the lowest index among equals, and a nonfinite gap.
func TestGap(t *testing.T) {
	if g, i := Gap([]float64{0, 0, 3, 0, 3, 4}, 2); g != 3 || i != 0 {
		t.Fatalf("gap %v at %d", g, i)
	}
	if g, i := Gap([]float64{0, 2, 4}, 1); g != 2 || i != 0 {
		t.Fatalf("gap %v at %d", g, i)
	}
	if g, i := Gap([]float64{0, 1, math.NaN()}, 1); !math.IsNaN(g) || i != 1 {
		t.Fatalf("gap %v at %d", g, i)
	}
	// Planar gaps round exactly as math.Hypot, and a zero third coordinate
	// changes nothing.
	for _, p := range [][2]float64{{.1, .7}, {1e-8, 3}, {-2.5, 1.0 / 3}} {
		if g, _ := Gap([]float64{0, 0, p[0], p[1]}, 2); g != math.Hypot(p[0], p[1]) {
			t.Fatalf("planar gap %v", g)
		}
		if g, _ := Gap([]float64{0, 0, 0, p[0], p[1], 0}, 3); g != math.Hypot(p[0], p[1]) {
			t.Fatalf("spatial gap %v", g)
		}
	}
	// A nonfinite state gives a nonfinite velocity.
	c := &Chase{Dim: 1, Speeds: []float64{1, 1}}
	out := make([]float64, 2)
	c.Velocity(0, []float64{1, 1}, out)
	if !math.IsNaN(out[0]) {
		t.Fatalf("velocity on the target %v", out)
	}
}
