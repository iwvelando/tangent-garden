package refine

import (
	"math"
	"testing"
)

type pair struct{ x, y float64 }

func coords(p pair) []float64 { return []float64{p.x, p.y} }

func points(ps ...pair) []*pair {
	out := make([]*pair, len(ps))
	for i := range ps {
		out[i] = &ps[i]
	}
	return out
}

// The radius is measured from the center of the robust box: an isolated
// tail beyond the outer fences is left out, as near an asymptote.
func TestRadiusLeavesOutIsolatedTails(t *testing.T) {
	var ring []pair
	for k := 0; k < 64; k++ {
		a := 2 * math.Pi * float64(k) / 64
		ring = append(ring, pair{3 + 2*math.Cos(a), -1 + 2*math.Sin(a)})
	}
	if r := Radius(points(ring...), coords); math.Abs(r-2) > 1e-12 {
		t.Fatalf("ring radius %g, want 2", r)
	}
	tail := append(append([]pair(nil), ring...), pair{3, 1e6})
	if r := Radius(append(points(tail...), nil), coords); math.Abs(r-2) > 1e-12 {
		t.Fatalf("radius with a far tail %g, want 2", r)
	}
	// Fewer than eight points keep every point.
	if r := Radius(points(pair{0, 0}, pair{0, 2}, pair{0, 100}), coords); r != 50 {
		t.Fatalf("radius of three points %g, want 50", r)
	}
	if r := Radius([]*pair{nil}, coords); r != 1 {
		t.Fatalf("radius without points %g, want 1", r)
	}
	if r := Radius(points(pair{5, 5}), coords); r != 1e-4 {
		t.Fatalf("radius of one point %g, want the floor 1e-4", r)
	}
}
