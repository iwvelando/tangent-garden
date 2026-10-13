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

// A straight line, (t, 0) for t from 0 to 1 at n intervals, with bump added
// to y where it is defined; nil where bump is not. Refinement inserts nothing
// on the line itself, so whatever it draws in an interval it found there.
func line(n int, bump func(float64) (float64, bool)) ([]*pair, []bool, func(float64) *pair) {
	at := func(t float64) *pair {
		y, ok := bump(t)
		if !ok {
			return nil
		}
		return &pair{t, y}
	}
	ps := make([]*pair, n+1)
	for i := range ps {
		ps[i] = at(float64(i) / float64(n))
	}
	return ps, make([]bool, n+1), at
}

// A spike 1/40 of a sample step wide, centered between an interval's
// quarter point and midpoint: the samples and its three probes see nothing,
// but the scan finds it and refinement draws it to its top. (Steeper, its
// flanks would be jumps at the finest step.)
func TestRefineFindsASpikeBetweenProbes(t *testing.T) {
	n := 64
	h := 1 / float64(n)
	c, w := (10+0.375)*h, h/40
	ps, breaks, at := line(n, func(t float64) (float64, bool) {
		return 0.1 * math.Exp(-((t-c)/w)*((t-c)/w)), true
	})
	for _, u := range []float64{10, 10.25, 10.5, 10.75, 11} {
		if y := at(u * h).y; y > 1e-10 {
			t.Fatalf("a probe at %g sees the spike: %g", u, y)
		}
	}
	tolerance := Epsilon * Radius(ps, coords)
	path, broken := Refine(ps, breaks, at, plane, 0, 1, tolerance, Budget)
	if len(broken) != 0 || path.Unresolved != 0 || path.Exhausted {
		t.Fatalf("%+v, broken %v", path, broken)
	}
	top := 0.0
	for k, p := range path.Points {
		top = math.Max(top, p.y)
		if p.y > tolerance && math.Floor(path.At[k]) != 10 {
			t.Fatalf("a point off the line at %g", path.At[k])
		}
	}
	if top < 0.099 {
		t.Fatalf("the spike drawn to %g", top)
	}
	// Every drawn chord lies within the tolerance of the spike.
	for k := 1; k < len(path.Points); k++ {
		a, b := path.Points[k-1], path.Points[k]
		for j := 1; j < 64; j++ {
			u := (path.At[k-1] + (path.At[k]-path.At[k-1])*float64(j)/64) * h
			if d := plane.Distance(*at(u), *a, *b); d > 1.5*tolerance {
				t.Fatalf("the chord at %g strays by %g", u/h, d)
			}
		}
	}
}

// An undefined window 1/50 of a sample step wide, between an interval's
// midpoint and third quarter point: refinement breaks that interval and
// draws up to the window's edges.
func TestRefineFindsANarrowGapBetweenProbes(t *testing.T) {
	n := 64
	h := 1 / float64(n)
	c, r := (20+0.6)*h, h/100
	ps, breaks, at := line(n, func(t float64) (float64, bool) { return 0, math.Abs(t-c) > r })
	path, broken := Refine(ps, breaks, at, plane, 0, 1, Epsilon*Radius(ps, coords), Budget)
	if len(broken) != 1 || broken[0] != 20 || path.Breaks != 1 {
		t.Fatalf("broken %v, %d breaks", broken, path.Breaks)
	}
	finest := h / (1 << Depth)
	var before, after *pair
	for k, p := range path.Points {
		if p == nil {
			before, after = path.Points[k-1], path.Points[k+1]
			for path.Points[k+1] == nil {
				k++
				after = path.Points[k+1]
			}
			break
		}
	}
	if before == nil || after == nil || math.Abs(before.x-(c-r)) > 2*finest || math.Abs(after.x-(c+r)) > 2*finest {
		t.Fatalf("gap drawn from %v to %v, want %g to %g", before, after, c-r, c+r)
	}
}

// A pole whose residue is too small for the probes either side of it to
// leave the line by a tolerance: the scan finds its flank, and refinement
// breaks the interval there as a jump.
func TestRefineFindsAPoleBetweenProbes(t *testing.T) {
	n := 64
	h := 1 / float64(n)
	c := (10 + 0.4) * h
	ps, breaks, at := line(n, func(t float64) (float64, bool) { return 1e-7 / (t - c), true })
	tolerance := Epsilon * Radius(ps, coords)
	for _, u := range []float64{10.25, 10.5} {
		if y := math.Abs(at(u * h).y); y > tolerance {
			t.Fatalf("a probe at %g sees the pole: %g", u, y)
		}
	}
	path, broken := Refine(ps, breaks, at, plane, 0, 1, tolerance, Budget)
	if len(broken) != 1 || broken[0] != 10 || path.Exhausted {
		t.Fatalf("broken %v, %+v", broken, path)
	}
}

// Scaling a curve by a power of two scales every distance exactly, so the
// scan finds the same features and inserts the same points.
func TestRefineScanIsScaleInvariant(t *testing.T) {
	n := 64
	h := 1 / float64(n)
	paths := []*Path[pair]{}
	for _, scale := range []float64{1, 1024} {
		ps, breaks, at := line(n, func(t float64) (float64, bool) {
			return math.Sin(3*t) + 0.01*math.Exp(-math.Pow((t-30.4*h)/(h/100), 2)), math.Abs(t-40.6*h) > h/100
		})
		big := func(p *pair) *pair {
			if p == nil {
				return nil
			}
			return &pair{scale * p.x, scale * p.y}
		}
		for i := range ps {
			ps[i] = big(ps[i])
		}
		path, _ := Refine(ps, breaks, func(t float64) *pair { return big(at(t)) }, plane, 0, 1, Epsilon*Radius(ps, coords), Budget)
		paths = append(paths, path)
	}
	a, b := paths[0], paths[1]
	if a.Breaks != 1 || a.Inserted == 0 || len(a.At) != len(b.At) || a.Breaks != b.Breaks {
		t.Fatalf("%d and %d points, %d and %d breaks", len(a.At), len(b.At), a.Breaks, b.Breaks)
	}
	for k := range a.At {
		if a.At[k] != b.At[k] {
			t.Fatalf("point %d at %g and %g", k, a.At[k], b.At[k])
		}
	}
}

// Where the three probes of every piece already see the curve, the scan
// finds nothing more: a circle and an aliased coil refine exactly as without
// it.
func TestRefineScanLeavesResolvedCurvesAlone(t *testing.T) {
	ps, _, at := circle(12)
	coil := func(t float64) *pair {
		return &pair{math.Cos(t) + 0.1*math.Cos(233*t), math.Sin(t) + 0.1*math.Sin(233*t)}
	}
	coiled := make([]*pair, 241)
	for i := range coiled {
		coiled[i] = coil(2 * math.Pi * float64(i) / 240)
	}
	for _, c := range []struct {
		ps []*pair
		at func(float64) *pair
	}{{ps, at}, {coiled, coil}} {
		tolerance := Epsilon * Radius(c.ps, coords)
		with, _ := Refine(c.ps, make([]bool, len(c.ps)), c.at, plane, 0, 2*math.Pi, tolerance, Budget)
		without, _ := refine(c.ps, make([]bool, len(c.ps)), c.at, plane, 0, 2*math.Pi, tolerance, Budget, 0, nil)
		if with.Inserted == 0 || len(with.At) != len(without.At) {
			t.Fatalf("%d points with the scan, %d without", len(with.At), len(without.At))
		}
		for k := range with.At {
			if with.At[k] != without.At[k] {
				t.Fatalf("point %d at %g with the scan, %g without", k, with.At[k], without.At[k])
			}
		}
	}
}

// A wave u(1 − u)(1 − 2u) across each sample step u strays from its chords
// 0.995 tolerances at the quarter points and 1.6% more at its crests,
// between them: the three probes already measured it, and the scan inserts
// nothing.
func TestRefineScanLeavesAMeasuredWaveAlone(t *testing.T) {
	n := 64
	amplitude := 0.995 * Epsilon * 0.5 / 0.09375
	ps, breaks, at := line(n, func(t float64) (float64, bool) {
		u := t*float64(n) - math.Floor(t*float64(n))
		return amplitude * u * (1 - u) * (1 - 2*u), true
	})
	tolerance := Epsilon * Radius(ps, coords)
	if math.Abs(tolerance-Epsilon*0.5) > 1e-12 {
		t.Fatalf("tolerance %g", tolerance)
	}
	crest := 0.0
	for j := 0; j <= 1024; j++ {
		crest = math.Max(crest, at(float64(j)/1024/float64(n)).y)
	}
	if crest < 1.01*tolerance {
		t.Fatalf("the crest strays only %g tolerances", crest/tolerance)
	}
	path, _ := Refine(ps, breaks, at, plane, 0, 1, tolerance, Budget)
	if path.Inserted != 0 || path.Breaks != 0 {
		t.Fatalf("%+v", path)
	}
}

// The same wave at half the height, its quarter points 0.5 tolerances from
// their chords, with a spike 1.5 tolerances high between two of them: the
// scan sees nearly four times what they do, and refinement draws it.
func TestRefineFindsASmallSpikeOnAWave(t *testing.T) {
	n := 64
	h := 1 / float64(n)
	tolerance := Epsilon * 0.5
	amplitude := 0.5 * tolerance / 0.09375
	ps, breaks, at := line(n, func(t float64) (float64, bool) {
		u := t*float64(n) - math.Floor(t*float64(n))
		return amplitude*u*(1-u)*(1-2*u) + 1.5*tolerance*math.Exp(-math.Pow((t-10.375*h)/(h/40), 2)), true
	})
	if r := Epsilon * Radius(ps, coords); math.Abs(r-tolerance) > 1e-12 {
		t.Fatalf("tolerance %g", r)
	}
	path, _ := Refine(ps, breaks, at, plane, 0, 1, tolerance, Budget)
	for k := 1; k < len(path.Points); k++ {
		a, b := path.Points[k-1], path.Points[k]
		for j := 1; j < 64; j++ {
			u := (path.At[k-1] + (path.At[k]-path.At[k-1])*float64(j)/64) * h
			if d := plane.Distance(*at(u), *a, *b); d > 1.5*tolerance {
				t.Fatalf("the chord at %g strays by %g tolerances", u/h, d/tolerance)
			}
		}
	}
	if path.Inserted == 0 {
		t.Fatal("nothing drawn")
	}
}

// A bump beside a sample, a fifth of a step wide, which no quarter point
// reaches: the scan finds it at 1/8 of a step and refinement draws it to
// its top. (The scan stops at 1/32 of a step at 128 intervals.)
func TestRefineFindsABumpBesideASample(t *testing.T) {
	n := 128
	ps, breaks, at := line(n, func(t float64) (float64, bool) {
		u := t*float64(n) - 70
		if u < 0.02 || u > 0.2 {
			return 0, true
		}
		s := math.Sin(math.Pi * (u - 0.02) / 0.18)
		return 0.01 * s * s, true
	})
	path, broken := Refine(ps, breaks, at, plane, 0, 1, Epsilon*Radius(ps, coords), Budget)
	top := 0.0
	for _, p := range path.Points {
		top = math.Max(top, p.y)
	}
	if len(broken) != 0 || path.Unresolved != 0 || top < 0.0099 {
		t.Fatalf("broken %v, %d unresolved, drawn to %g", broken, path.Unresolved, top)
	}
}

// A budget that runs out ends the scan with the level that found the
// feature: one point drawn of the spike the first level finds, and nothing
// scanned after.
func TestRefineScanStopsWithTheBudget(t *testing.T) {
	n := 64
	h := 1 / float64(n)
	ps, breaks, at := line(n, func(t float64) (float64, bool) {
		return 0.1 * math.Exp(-math.Pow((t-10.375*h)/(h/40), 2)), true
	})
	calls := 0
	counted := func(t float64) *pair { calls++; return at(t) }
	path, _ := Refine(ps, breaks, counted, plane, 0, 1, Epsilon*Radius(ps, coords), 1)
	if !path.Exhausted || path.Inserted != 1 || path.Unresolved != 1 || calls != 3*n+4*n {
		t.Fatalf("%d evaluations, %+v", calls, path)
	}
}

// On a line with nothing to find, refinement evaluates the curve only at
// each interval's three probes and at most Scan more, spent on whole levels
// of the scan: the finest step at 4 intervals, 1/64 of a step at up to 68,
// 1/32 at up to 146, 1/16 at up to 341, 1/8 at up to 1024, none at 1025.
func TestRefineScanIsBounded(t *testing.T) {
	for _, c := range []struct{ n, scanned int }{{4, 4 * (1024 - 4)}, {64, 64 * (64 - 4)}, {68, 68 * (64 - 4)}, {69, 69 * (32 - 4)}, {146, 146 * (32 - 4)}, {147, 147 * (16 - 4)}, {341, 341 * (16 - 4)}, {342, 342 * 4}, {1024, 1024 * 4}, {1025, 0}} {
		ps, breaks, at := line(c.n, func(float64) (float64, bool) { return 0, true })
		calls := 0
		counted := func(t float64) *pair { calls++; return at(t) }
		path, _ := Refine(ps, breaks, counted, plane, 0, 1, Epsilon*Radius(ps, coords), Budget)
		if path.Inserted != 0 || calls != 3*c.n+c.scanned || c.scanned > Scan {
			t.Fatalf("%d intervals: %d evaluations, want %d", c.n, calls, 3*c.n+c.scanned)
		}
	}
}
