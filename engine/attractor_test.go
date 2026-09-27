package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func attractorRequest(v Attractor) Request {
	q := request("evolute", "", "", 0, 1)
	q.Curve = Curve{Format: "attractor", Attractor: v, Min: 0, Max: 1}
	return q
}

// The reference Clifford study: (a, b, c, d) = (−1.4, 1.6, 1, 0.7) from
// (0.1, 0.1), fewer accumulated iterates than the preset.
func clifford() Attractor {
	return Attractor{Map: "clifford", A: -1.4, B: 1.6, C: 1, D: .7, Start: Vec{.1, .1}, Discard: 1000, Iterates: 100000, Fit: true, Window: square(2), Cells: 200}
}

func attractor(t *testing.T, v Attractor) *AttractorResult {
	t.Helper()
	q := attractorRequest(v)
	r := compute(t, q)
	if r.Attractor == nil {
		t.Fatal("no attractor result")
	}
	if len(r.Base) != 0 || len(r.Derived) != 0 || r.Base == nil || r.Derived == nil {
		t.Fatalf("an attractor has empty base and derived paths, got %d and %d", len(r.Base), len(r.Derived))
	}
	return r.Attractor
}

// Each map written out independently of the engine.
func mapStep(v Attractor, p Vec) Vec {
	switch v.Map {
	case "clifford":
		return Vec{math.Sin(v.A*p.Y) + v.C*math.Cos(v.A*p.X), math.Sin(v.B*p.X) + v.D*math.Cos(v.B*p.Y)}
	case "dejong":
		return Vec{math.Sin(v.A*p.Y) - math.Cos(v.B*p.X), math.Sin(v.C*p.X) - math.Cos(v.D*p.Y)}
	}
	return Vec{1 - v.A*p.X*p.X + p.Y, v.B * p.X}
}

// orbit returns iterates 0 (the start) through n.
func orbit(v Attractor, n int) []Vec {
	out := []Vec{v.Start}
	for range n {
		out = append(out, mapStep(v, out[len(out)-1]))
	}
	return out
}

// binned counts the iterates in each cell of an independently built grid.
func binned(w Window, nx, ny int, points []Vec) ([]uint32, int) {
	counts := make([]uint32, nx*ny)
	outside := 0
	for _, p := range points {
		if p.X < w.XMin || p.X > w.XMax || p.Y < w.YMin || p.Y > w.YMax {
			outside++
			continue
		}
		i := min(nx-1, int((p.X-w.XMin)/(w.XMax-w.XMin)*float64(nx)))
		j := min(ny-1, int((p.Y-w.YMin)/(w.YMax-w.YMin)*float64(ny)))
		counts[j*nx+i]++
	}
	return counts, outside
}

func total(counts []uint32) (sum int, peak uint32) {
	for _, c := range counts {
		sum += int(c)
		peak = max(peak, c)
	}
	return
}

func TestAttractorIterates(t *testing.T) {
	for _, v := range []Attractor{
		clifford(),
		{Map: "dejong", A: 1.4, B: -2.3, C: 2.4, D: -2.1, Start: Vec{.1, .1}, Discard: 100, Iterates: 20000, Fit: true, Window: square(2), Cells: 120},
		{Map: "henon", A: 1.4, B: .3, Start: Vec{0, 0}, Discard: 100, Iterates: 20000, Fit: true, Window: square(2), Cells: 150},
	} {
		t.Run(v.Map, func(t *testing.T) {
			r := attractor(t, v)
			points := orbit(v, v.Discard+v.Iterates)
			kept := points[v.Discard+1:]
			// The fitted window is the accumulated iterates' bounding box.
			w := Window{math.Inf(1), math.Inf(-1), math.Inf(1), math.Inf(-1)}
			for _, p := range kept {
				w = Window{math.Min(w.XMin, p.X), math.Max(w.XMax, p.X), math.Min(w.YMin, p.Y), math.Max(w.YMax, p.Y)}
			}
			if r.Window != w {
				t.Fatalf("window %v, want the iterates' bounds %v", r.Window, w)
			}
			nx, ny := gridShape(w, v.Cells)
			if r.Columns != nx || r.Rows != ny || max(nx, ny) != v.Cells {
				t.Fatalf("grid %d × %d, want %d × %d", r.Columns, r.Rows, nx, ny)
			}
			counts, outside := binned(w, nx, ny, kept)
			if outside != 0 || r.Outside != 0 {
				t.Fatalf("a fitted window holds every iterate, %d outside", r.Outside)
			}
			if len(r.Counts) != len(counts) {
				t.Fatalf("%d counts, want %d", len(r.Counts), len(counts))
			}
			for k := range counts {
				if r.Counts[k] != counts[k] {
					t.Fatalf("cell %d (%d, %d): %d visits, want %d", k, k%nx, k/nx, r.Counts[k], counts[k])
				}
			}
			sum, peak := total(r.Counts)
			if sum != v.Iterates || r.Accumulated != v.Iterates || r.Max != peak || r.Escape != 0 {
				t.Fatalf("sum %d, accumulated %d, max %d (peak %d), escape %d", sum, r.Accumulated, r.Max, peak, r.Escape)
			}
			// The construction is the start and the first iterates, whatever
			// is discarded.
			if len(r.Orbit) != 26 {
				t.Fatalf("%d orbit points, want the start and 25 iterates", len(r.Orbit))
			}
			for k, p := range r.Orbit {
				if p != points[k] {
					t.Fatalf("orbit point %d %v, want %v", k, p, points[k])
				}
			}
		})
	}
}

// Clifford's iterates stay within 1 + |c| by 1 + |d|, whatever the start.
func TestAttractorCliffordBounds(t *testing.T) {
	for _, v := range []Attractor{
		clifford(),
		{Map: "clifford", A: 1.7, B: 1.7, C: .6, D: 1.2, Start: Vec{3, -4}, Iterates: 50000, Fit: true, Window: square(2), Cells: 64},
		{Map: "clifford", A: -1.8, B: -2, C: -.5, D: -.9, Start: Vec{0, 0}, Iterates: 50000, Fit: true, Window: square(2), Cells: 64},
	} {
		w := attractor(t, v).Window
		if w.XMin < -1-math.Abs(v.C) || w.XMax > 1+math.Abs(v.C) || w.YMin < -1-math.Abs(v.D) || w.YMax > 1+math.Abs(v.D) {
			t.Fatalf("%+v: window %v leaves the bounds", v, w)
		}
	}
}

// Hénon's map with a = 0 is linear: x' = 1 + y, y' = bx, exact in binary.
func TestAttractorHenonExact(t *testing.T) {
	v := Attractor{Map: "henon", A: 0, B: .5, Start: Vec{0, 0}, Iterates: 4, Fit: true, Window: square(2), Cells: 4}
	r := attractor(t, v)
	want := []Vec{{0, 0}, {1, 0}, {1, .5}, {1.5, .5}, {1.5, .75}}
	for k, p := range want {
		if r.Orbit[k] != p {
			t.Fatalf("iterate %d %v, want %v", k, r.Orbit[k], p)
		}
	}
	if r.Window != (Window{1, 1.5, 0, .75}) || r.Columns != 3 || r.Rows != 4 {
		t.Fatalf("window %v, grid %d × %d", r.Window, r.Columns, r.Rows)
	}
	// Iterates on the window's upper edges fall in its last cells.
	if want := []uint32{1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1}; !equalCounts(r.Counts, want) {
		t.Fatalf("counts %v, want %v", r.Counts, want)
	}
}

func equalCounts(a, b []uint32) bool {
	if len(a) != len(b) {
		return false
	}
	for k := range a {
		if a[k] != b[k] {
			return false
		}
	}
	return true
}

// An attracting fixed point: every accumulated iterate is at the center of a
// window widened about it.
func TestAttractorFixedPoint(t *testing.T) {
	v := Attractor{Map: "henon", A: .2, B: .3, Start: Vec{0, 0}, Discard: 2000, Iterates: 5000, Fit: true, Window: square(2), Cells: 100}
	r := attractor(t, v)
	x := (-(1 - v.B) + math.Sqrt((1-v.B)*(1-v.B)+4*v.A)) / (2 * v.A)
	w := r.Window
	center := Vec{(w.XMin + w.XMax) / 2, (w.YMin + w.YMax) / 2}
	if center.Sub(Vec{x, v.B * x}).Norm() > 1e-12 {
		t.Fatalf("window about %v, want the fixed point (%v, %v)", center, x, v.B*x)
	}
	for _, side := range []float64{w.XMax - w.XMin, w.YMax - w.YMin} {
		if !(side >= 1e-6 && side < 1e-6*(1+1e-9)) {
			t.Fatalf("a collapsed window widens to 0.000001, got %v", w)
		}
	}
	// The iterates round to neighbouring floats about the window's center,
	// a cell corner, so they may share its four cells.
	visited := 0
	for k, c := range r.Counts {
		if c > 0 {
			visited++
			if i, j := k%100, k/100; i < 49 || i > 50 || j < 49 || j > 50 {
				t.Fatalf("cell (%d, %d) visited, away from the center", i, j)
			}
		}
	}
	if sum, _ := total(r.Counts); sum != 5000 || visited == 0 || r.Columns != 100 || r.Rows != 100 {
		t.Fatalf("sum %d in %d cells, grid %d × %d", sum, visited, r.Columns, r.Rows)
	}
}

// A window narrower than 0.000001 but not collapsed widens too: Hénon's
// linear map with b = 10⁻⁸ spans 10⁻⁸ in each direction.
func TestAttractorNarrowWindow(t *testing.T) {
	v := Attractor{Map: "henon", A: 0, B: 1e-8, Start: Vec{0, 0}, Iterates: 4, Fit: true, Window: square(2), Cells: 10}
	w := attractor(t, v).Window
	for _, side := range []float64{w.XMax - w.XMin, w.YMax - w.YMin} {
		if !(side >= 1e-6 && side < 1e-6*(1+1e-9)) {
			t.Fatalf("window %v, want sides of 0.000001", w)
		}
	}
	if c := (Vec{(w.XMin + w.XMax) / 2, (w.YMin + w.YMax) / 2}); c.Sub(Vec{1 + .5e-8, .5e-8}).Norm() > 1e-15 {
		t.Fatalf("window about %v", c)
	}
}

// Discarding iterates is the same as starting where they end.
func TestAttractorTransient(t *testing.T) {
	v := clifford()
	v.Fit = false
	v.Window = Window{-2, 2, -1.7, 1.7}
	whole := attractor(t, v)
	moved := v
	moved.Start = orbit(v, v.Discard)[v.Discard]
	moved.Discard = 0
	if !equalCounts(attractor(t, moved).Counts, whole.Counts) {
		t.Fatal("discarding iterates differs from starting after them")
	}
	// Fewer accumulated iterates are a prefix of more: no cell has more
	// visits, and the difference is the iterates in between.
	prefix := v
	prefix.Iterates = 37000
	part := attractor(t, prefix)
	sum, _ := total(part.Counts)
	if sum != 37000 || part.Window != whole.Window {
		t.Fatalf("prefix sum %d, window %v", sum, part.Window)
	}
	for k := range whole.Counts {
		if part.Counts[k] > whole.Counts[k] {
			t.Fatalf("cell %d: prefix %d > whole %d", k, part.Counts[k], whole.Counts[k])
		}
	}
	// No iterates: an empty grid over the given window, and no fit.
	none := v
	none.Iterates = 0
	none.Fit = true
	r := attractor(t, none)
	if sum, peak := total(r.Counts); sum != 0 || peak != 0 || r.Accumulated != 0 || r.Window != v.Window {
		t.Fatalf("empty: sum %d max %d accumulated %d window %v", sum, peak, r.Accumulated, r.Window)
	}
}

// Iterates outside an explicit window are counted, not binned.
func TestAttractorWindow(t *testing.T) {
	v := clifford()
	v.Fit = false
	v.Window = Window{-.5, 1.5, -1, .5}
	v.Cells = 97
	r := attractor(t, v)
	kept := orbit(v, v.Discard+v.Iterates)[v.Discard+1:]
	nx, ny := gridShape(v.Window, v.Cells)
	counts, outside := binned(v.Window, nx, ny, kept)
	if r.Window != v.Window || r.Columns != nx || r.Rows != ny || !equalCounts(r.Counts, counts) {
		t.Fatalf("window %v grid %d × %d", r.Window, r.Columns, r.Rows)
	}
	sum, _ := total(r.Counts)
	if r.Outside != outside || outside == 0 || sum+r.Outside != v.Iterates || r.Accumulated != v.Iterates {
		t.Fatalf("outside %d (want %d), sum %d", r.Outside, outside, sum)
	}
}

// An orbit that leaves |x|, |y| ≤ 100000 stops there.
func TestAttractorEscape(t *testing.T) {
	// From (2, 0): x = −4.6, −28.02, about −1098, then about −1.7 million.
	v := Attractor{Map: "henon", A: 1.4, B: .3, Start: Vec{2, 0}, Discard: 1, Iterates: 100, Fit: true, Window: square(3), Cells: 50}
	r := attractor(t, v)
	if r.Escape != 4 || r.Accumulated != 2 || len(r.Orbit) != 4 {
		t.Fatalf("escape %d, accumulated %d, orbit %d", r.Escape, r.Accumulated, len(r.Orbit))
	}
	if sum, _ := total(r.Counts); sum != 2 {
		t.Fatalf("sum %d, want the 2 iterates before the escape", sum)
	}
	points := orbit(v, 3)
	if r.Window != (Window{points[3].X, points[2].X, points[3].Y, points[2].Y}) {
		t.Fatalf("window %v, want the bounds of %v and %v", r.Window, points[2], points[3])
	}
	// y alone can leave: with a = 0 and b = 1000, (1, 0), (1, 1000),
	// (1001, 1000), then y = 1001000.
	by := attractor(t, Attractor{Map: "henon", A: 0, B: 1000, Start: Vec{0, 0}, Iterates: 10, Fit: true, Window: square(3), Cells: 50})
	if by.Escape != 4 || by.Accumulated != 3 {
		t.Fatalf("y escape %d, accumulated %d", by.Escape, by.Accumulated)
	}
	// Escaping while discarding leaves nothing to accumulate, so the given
	// window is kept.
	v.Discard = 10
	r = attractor(t, v)
	if r.Escape != 4 || r.Accumulated != 0 || r.Window != v.Window {
		t.Fatalf("escape %d, accumulated %d, window %v", r.Escape, r.Accumulated, r.Window)
	}
}

func TestAttractorInvalid(t *testing.T) {
	for _, tc := range []struct {
		change func(*Attractor)
		want   string
	}{
		{func(v *Attractor) { v.Map = "lorenz" }, "choose the Clifford, de Jong, or Hénon map"},
		{func(v *Attractor) { v.C = math.NaN() }, "coefficients must be finite and within ±1000"},
		{func(v *Attractor) { v.D = 1001 }, "coefficients must be finite and within ±1000"},
		{func(v *Attractor) { v.Start.X = math.Inf(1) }, "the start must be finite and within ±100000"},
		{func(v *Attractor) { v.Start.Y = -2e5 }, "the start must be finite and within ±100000"},
		{func(v *Attractor) { v.Discard = -1 }, "discard 0–1,000,000 iterates"},
		{func(v *Attractor) { v.Discard = 1000001 }, "discard 0–1,000,000 iterates"},
		{func(v *Attractor) { v.Iterates = -1 }, "accumulate 0–5,000,000 iterates"},
		{func(v *Attractor) { v.Iterates = 5000001 }, "accumulate 0–5,000,000 iterates"},
		{func(v *Attractor) { v.Cells = 3 }, "a density grid needs 4–1024 cells along the window's longer side"},
		{func(v *Attractor) { v.Cells = 1025 }, "a density grid needs 4–1024 cells along the window's longer side"},
		{func(v *Attractor) { v.Window.XMax = v.Window.XMin }, "the window needs x and y ranges"},
		{func(v *Attractor) { v.Window.YMin = -2e5 }, "the window must be finite and within ±100000"},
	} {
		v := clifford()
		v.Fit = false
		tc.change(&v)
		if _, err := Compute(attractorRequest(v)); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%+v: error %v, want %q", v, err, tc.want)
		}
	}
	// A fitted window ignores the given one, which only stands in when
	// nothing is accumulated.
	v := clifford()
	v.Window.XMax = v.Window.XMin
	if _, err := Compute(attractorRequest(v)); err == nil || !strings.Contains(err.Error(), "the window needs") {
		t.Fatalf("a fitted attractor still needs a valid window: %v", err)
	}
}

func TestAttractorResultJSON(t *testing.T) {
	v := Attractor{Map: "henon", A: 0, B: .5, Start: Vec{0, 0}, Iterates: 4, Fit: true, Window: square(2), Cells: 4}
	b, err := json.Marshal(compute(t, attractorRequest(v)))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	a, ok := got["attractor"].(map[string]any)
	if !ok {
		t.Fatalf("no attractor in %s", b)
	}
	for _, key := range []string{"window", "columns", "rows", "counts", "max", "accumulated", "outside", "escape", "orbit"} {
		if _, ok := a[key]; !ok {
			t.Fatalf("attractor lacks %q: %s", key, b)
		}
	}
	if _, ok := got["contours"]; ok {
		t.Fatal("an attractor has no contours")
	}
	if !strings.Contains(string(b), `"counts":[1,0,0,0,0,0,1,0,1,0,0,1]`) {
		t.Fatalf("counts are a plain array: %s", b)
	}
}
