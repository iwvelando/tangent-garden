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

var plane = Metric[pair]{
	Distance: func(p, a, b pair) float64 {
		dx, dy := b.x-a.x, b.y-a.y
		s := 0.0
		if l := dx*dx + dy*dy; l > 0 {
			s = math.Max(0, math.Min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/l))
		}
		return math.Hypot(p.x-a.x-s*dx, p.y-a.y-s*dy)
	},
	Length: func(a, b pair) float64 { return math.Hypot(b.x-a.x, b.y-a.y) },
}

// A unit circle sampled at n+1 points, its evaluator, and no breaks.
func circle(n int) ([]*pair, []bool, func(float64) *pair) {
	at := func(t float64) *pair { return &pair{math.Cos(t), math.Sin(t)} }
	ps := make([]*pair, n+1)
	for i := range ps {
		ps[i] = at(2 * math.Pi * float64(i) / float64(n))
	}
	return ps, make([]bool, n+1), at
}

// Every chord of a refined circle lies within the tolerance (its sagitta,
// 1 − cos(θ/2) for a chord subtending θ), and the samples are kept.
func TestRefineBringsEveryChordWithinTolerance(t *testing.T) {
	ps, breaks, at := circle(12)
	path, broken := Refine(ps, breaks, at, plane, 0, 2*math.Pi, 1e-4, Budget)
	if len(broken) != 0 || path.Unresolved != 0 || path.Exhausted || path.Inserted == 0 {
		t.Fatalf("%+v, broken %v", path, broken)
	}
	for k := 1; k < len(path.Points); k++ {
		a, b := path.Points[k-1], path.Points[k]
		if sag := 1 - math.Cos(math.Atan2(a.x*b.y-a.y*b.x, a.x*b.x+a.y*b.y)/2); sag > 1.01e-4 {
			t.Fatalf("chord %d strays by %g", k, sag)
		}
		if path.At[k] == math.Trunc(path.At[k]) && *b != *ps[int(path.At[k])] {
			t.Fatalf("sample %g changed", path.At[k])
		}
	}
}

// A budget of one point inserts exactly one, the worst piece's midpoint,
// and counts every piece still above the tolerance as unresolved.
func TestRefineCountsWhatABudgetLeaves(t *testing.T) {
	ps, breaks, at := circle(12)
	path, _ := Refine(ps, breaks, at, plane, 0, 2*math.Pi, 1e-4, 1)
	if !path.Exhausted || path.Inserted != 1 || path.Unresolved != 13 {
		t.Fatalf("inserted %d, unresolved %d, exhausted %v", path.Inserted, path.Unresolved, path.Exhausted)
	}
}

// An evaluator undefined on a short arc between samples breaks that one
// interval, its edges localized to the finest step; a uniform break and an
// undefined sample are kept as nulls.
func TestRefineLocalizesAGapAndKeepsBreaks(t *testing.T) {
	ps, breaks, at := circle(12)
	gap := func(t float64) *pair {
		if t > 0.25 && t < 0.26 {
			return nil
		}
		return at(t)
	}
	breaks[6] = true
	ps[9] = nil
	path, broken := Refine(ps, breaks, gap, plane, 0, 2*math.Pi, 1e-4, Budget)
	if len(broken) != 1 || broken[0] != 0 || path.Breaks != 1 {
		t.Fatalf("broken %v, %d breaks", broken, path.Breaks)
	}
	// Runs of nulls: the gap, the uniform break, and sample 9 with the
	// intervals beside it.
	step := 2 * math.Pi / 12 / 1024
	var runs [][2]int
	for k := 0; k < len(path.Points); k++ {
		if path.Points[k] != nil {
			continue
		}
		start := k
		for k+1 < len(path.Points) && path.Points[k+1] == nil {
			k++
		}
		runs = append(runs, [2]int{start, k})
	}
	if len(runs) != 3 {
		t.Fatalf("%d runs of nulls, want 3", len(runs))
	}
	// The points either side of the gap lie within a finest step of it.
	a, b := path.At[runs[0][0]-1]*2*math.Pi/12, path.At[runs[0][1]+1]*2*math.Pi/12
	if math.Abs(a-0.25) > 2*step || math.Abs(b-0.26) > 2*step {
		t.Fatalf("gap drawn from %g to %g", a, b)
	}
	if path.At[runs[1][0]] != 5.5 || path.At[runs[2][0]] != 8.5 || path.At[runs[2][1]] != 9.5 {
		t.Fatalf("breaks at %v", runs)
	}
}

// A jump through a pole: a chord still longer than Jump tolerances at the
// finest step breaks the interval.
func TestRefineBreaksAJump(t *testing.T) {
	f := func(t float64) *pair { return &pair{t, 1 / (t - 0.3)} }
	ps := make([]*pair, 5)
	for i := range ps {
		ps[i] = f(float64(i) / 4)
	}
	_, broken := Refine(ps, make([]bool, 5), f, plane, 0, 1, 1e-3, Budget)
	if len(broken) != 1 || broken[0] != 1 {
		t.Fatalf("broken %v, want interval 1", broken)
	}
}
