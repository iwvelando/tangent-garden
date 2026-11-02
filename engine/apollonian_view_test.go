package engine

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"testing"
)

// View-limited generation (docs/mathematics.md, Apollonian garden, Detail
// for a view). The checks compare a windowed packing against the same
// cutoffs without a window, and compute each gap's dual disk from the
// returned centers and radii rather than from the generator's formula.

func windowed(q GardenRequest, w GardenWindow) GardenRequest {
	q.Window = &w
	return q
}

type identityKey [3]float64

func keyOf(r GardenResult, i int) identityKey {
	return identityKey{r.Curvature[i], r.WeightedX[i], r.WeightedY[i]}
}

func indexByIdentity(r GardenResult) map[identityKey]int {
	m := make(map[identityKey]int, len(r.Curvature))
	for i := range r.Curvature {
		m[keyOf(r, i)] = i
	}
	return m
}

// Whether circle i's disk meets the closed rectangle.
func diskMeets(r GardenResult, i int, w GardenWindow) bool {
	cx := math.Max(w.XMin, math.Min(w.XMax, r.X[i]))
	cy := math.Max(w.YMin, math.Min(w.YMax, r.Y[i]))
	return math.Hypot(r.X[i]-cx, r.Y[i]-cy) <= r.Radius[i]
}

// The point where circles j and k touch, from centers and radii: on the
// line of centers at distance r_j from j's center, toward k for two
// ordinary circles or for an enclosing j, and away from an enclosing k.
func touchPoint(r GardenResult, j, k int) (float64, float64) {
	dx, dy := r.X[k]-r.X[j], r.Y[k]-r.Y[j]
	d := math.Hypot(dx, dy)
	s := r.Radius[j] / d
	if r.Curvature[k] < 0 {
		s = -s
	}
	return r.X[j] + dx*s, r.Y[j] + dy*s
}

// The circle through three points.
func circumcircle(ax, ay, bx, by, cx, cy float64) (x, y, radius float64) {
	d := 2 * (ax*(by-cy) + bx*(cy-ay) + cx*(ay-by))
	a2, b2, c2 := ax*ax+ay*ay, bx*bx+by*by, cx*cx+cy*cy
	x = (a2*(by-cy) + b2*(cy-ay) + c2*(ay-by)) / d
	y = (a2*(cx-bx) + b2*(ax-cx) + c2*(bx-ax)) / d
	return x, y, math.Hypot(ax-x, ay-y)
}

// The dual disk of circle i's gap: through the three contacts of its
// generating triple.
func gapDisk(r GardenResult, i int) (x, y, radius float64) {
	p := r.Parents[i]
	j, k, l := int(p[0]), int(p[1]), int(p[2])
	ax, ay := touchPoint(r, j, k)
	bx, by := touchPoint(r, k, l)
	cx, cy := touchPoint(r, l, j)
	return circumcircle(ax, ay, bx, by, cx, cy)
}

// Each circle lies inside the dual disk of its own gap and of every gap
// that contains it. Circle i's gap lies in the gap filled by the newest of
// its generators, which made it.
func TestGardenGapsLieInTheirDualDisks(t *testing.T) {
	r := mustGarden(t, garden(9, 2e-4, 5000))
	if len(r.Curvature) < 2000 {
		t.Fatalf("only %d circles to check", len(r.Curvature))
	}
	checked := 0
	for i := 4; i < len(r.Curvature); i++ {
		for a := i; r.Generation[a] > 0; {
			x, y, radius := gapDisk(r, a)
			d := math.Hypot(r.X[i]-x, r.Y[i]-y) + r.Radius[i]
			// The seed's lower gap has collinear contacts, so its dual
			// circle is the diameter line; that gap is the lower half disk.
			if math.IsInf(radius, 1) || math.IsNaN(radius) {
				if r.Y[i]+r.Radius[i] > 1e-15 {
					t.Fatalf("circle %d leaves the lower half disk", i)
				}
			} else if d > radius*(1+1e-9)+1e-12 {
				t.Fatalf("circle %d leaves the dual disk of circle %d's gap: %v > %v", i, a, d, radius)
			}
			checked++
			p := r.Parents[a]
			a = int(math.Max(p[0], math.Max(p[1], p[2])))
		}
	}
	if checked < 5*len(r.Curvature) {
		t.Fatalf("only %d containments checked", checked)
	}
}

// The windows a zoomed garden asks for: inside one gap, at the cusp where
// the two large seeds touch, across the enclosing circle's edge, a thin
// strip, and wholly outside the packing.
var gardenWindows = []GardenWindow{
	{XMin: 0.28, XMax: 0.42, YMin: 0.47, YMax: 0.58},
	{XMin: -0.03, XMax: 0.03, YMin: -0.02, YMax: 0.02},
	{XMin: 0.85, XMax: 1.2, YMin: -0.15, YMax: 0.15},
	{XMin: -1, XMax: 1, YMin: -0.701, YMax: -0.7},
	// Just below the diameter, in the seed's lower gap, whose contacts
	// (−1, 0), (0, 0) and (1, 0) are collinear.
	{XMin: -0.3, XMax: 0.3, YMin: -0.05, YMax: -0.01},
	{XMin: 2, XMax: 3, YMin: 2, YMax: 3},
}

// A window keeps every circle of the unwindowed packing that reaches into
// it, adds none of its own, keeps their breadth-first order, and remains a
// valid packing with every generator present.
func TestGardenWindowKeepsEveryVisibleCircle(t *testing.T) {
	q := garden(12, 0.001, 5000)
	full := mustGarden(t, q)
	if full.Stopped != "" {
		t.Fatalf("the reference packing stopped at %q", full.Stopped)
	}
	where := indexByIdentity(full)
	for _, w := range gardenWindows {
		r := mustGarden(t, windowed(q, w))
		checkPacking(t, r)
		last := -1
		for i := range r.Curvature {
			j, ok := where[keyOf(r, i)]
			if !ok {
				t.Fatalf("%+v: circle %v is not in the unwindowed packing", w, keyOf(r, i))
			}
			if j <= last {
				t.Fatalf("%+v: circle %d is out of breadth-first order", w, i)
			}
			last = j
		}
		mine := indexByIdentity(r)
		visible := 0
		for j := range full.Curvature {
			if diskMeets(full, j, w) {
				visible++
				if _, ok := mine[keyOf(full, j)]; !ok {
					t.Fatalf("%+v: visible circle %v is missing", w, keyOf(full, j))
				}
			}
		}
		if r.Stopped != "" || r.Omitted.View == 0 {
			t.Fatalf("%+v: stopped %q, view omitted %d", w, r.Stopped, r.Omitted.View)
		}
		if len(r.Curvature) >= len(full.Curvature) {
			t.Fatalf("%+v: the window kept all %d circles", w, len(r.Curvature))
		}
		t.Logf("%+v: %d visible of %d kept, %d in full; omitted %+v", w, visible, len(r.Curvature), len(full.Curvature), r.Omitted)
	}
}

// Small windows over the whole packing, each a fiftieth of its width, keep
// every circle that reaches them: a gap whose dual disk only grazes a
// window still holds the circles that reach it.
func TestGardenSmallWindowsKeepEveryVisibleCircle(t *testing.T) {
	q := garden(12, 0.001, 5000)
	full := mustGarden(t, q)
	checked := 0
	for i := -25; i < 25; i++ {
		for j := -25; j < 25; j++ {
			w := GardenWindow{XMin: float64(i) / 25, XMax: float64(i+1) / 25, YMin: float64(j) / 25, YMax: float64(j+1) / 25}
			if math.Hypot(math.Max(math.Abs(w.XMin), math.Abs(w.XMax)), math.Max(math.Abs(w.YMin), math.Abs(w.YMax))) > 1.1 {
				continue
			}
			mine := indexByIdentity(mustGarden(t, windowed(q, w)))
			for k := range full.Curvature {
				if diskMeets(full, k, w) {
					checked++
					if _, ok := mine[keyOf(full, k)]; !ok {
						t.Fatalf("%+v: visible circle %v is missing", w, keyOf(full, k))
					}
				}
			}
		}
	}
	if checked < 5000 {
		t.Fatalf("only %d visible circles checked", checked)
	}
}

// With every circle in view, a window changes nothing but its report.
func TestGardenWindowAroundThePackingKeepsItAll(t *testing.T) {
	q := garden(12, 0.002, 5000)
	full := mustGarden(t, q)
	r := mustGarden(t, windowed(q, GardenWindow{XMin: -1.5, XMax: 1.5, YMin: -1.1, YMax: 1.1}))
	if r.Omitted.View != 0 || len(r.Curvature) != len(full.Curvature) {
		t.Fatalf("%d circles, %d gaps out of view; want all %d", len(r.Curvature), r.Omitted.View, len(full.Curvature))
	}
}

// Without a window, results are the bits they were before views existed:
// fingerprints of the result without omitted.view, recorded from the
// generator at 909c9f5.
func TestGardenWithoutAWindowIsUnchanged(t *testing.T) {
	for _, c := range []struct {
		q    GardenRequest
		hash string
	}{
		{garden(12, 0.002, 5000), "57d09a6d08ea42b1452d15a802b907f22c4e819c058a96744ccff9e487494664"},
		{garden(12, 1e-9, 5000), "f52b71227d804a33b916622ad160fb708cb909f6a625be93caed99fb5a9d7554"},
		{garden(7, 0.01, 300), "1961829d5ad726e0ce7e7e9c167d455855cb55895fd6c5c05624df0192989849"},
	} {
		r := mustGarden(t, c.q)
		if r.Omitted.View != 0 {
			t.Fatalf("%+v reports %d gaps out of view", c.q, r.Omitted.View)
		}
		b, _ := json.Marshal(r)
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			t.Fatal(err)
		}
		delete(m["omitted"].(map[string]any), "view")
		b, _ = json.Marshal(m)
		if got := fmt.Sprintf("%x", sha256.Sum256(b)); got != c.hash {
			t.Errorf("%+v: fingerprint %s, want %s", c.q, got, c.hash)
		}
	}
}

// The kept circle and the gaps that hold it survive a window that leaves
// them out, so a selection keeps its generators; nothing else is added,
// and the additions number at most the kept circle's generation.
func TestGardenKeepsTheChosenCircleOutsideTheWindow(t *testing.T) {
	q := windowed(garden(12, 0.001, 5000), GardenWindow{XMin: -0.9, XMax: -0.8, YMin: -0.3, YMax: -0.2})
	plain := mustGarden(t, q)
	// Curvature 23 at (8/23, 12/23), the explained preset's circle, at
	// generation 2; and a smaller one at generation 6 near it.
	full := mustGarden(t, garden(12, 0.001, 5000))
	deep := -1
	for i := range full.Curvature {
		if full.Generation[i] == 6 && full.X[i] > 0.3 && full.Y[i] > 0.4 {
			deep = i
			break
		}
	}
	if deep < 0 {
		t.Fatal("no generation-6 circle near (0.3, 0.4)")
	}
	for _, keep := range []GardenIdentity{
		{Curvature: 23, X: 8, Y: 12},
		{Curvature: int64(full.Curvature[deep]), X: int64(full.WeightedX[deep]), Y: int64(full.WeightedY[deep])},
	} {
		k := keep
		q.Keep = &k
		r := mustGarden(t, q)
		checkPacking(t, r)
		where := indexByIdentity(r)
		i, ok := where[identityKey{float64(k.Curvature), float64(k.X), float64(k.Y)}]
		if !ok {
			t.Fatalf("kept circle %+v is missing", k)
		}
		for _, p := range r.Parents[i] {
			if p < 0 || int(p) >= i {
				t.Fatalf("kept circle %+v lost generator %v", k, p)
			}
		}
		before := indexByIdentity(plain)
		added := 0
		for j := range r.Curvature {
			if _, ok := before[keyOf(r, j)]; !ok {
				added++
			}
		}
		if added == 0 || float64(added) > r.Generation[i] {
			t.Fatalf("keeping %+v (generation %v) added %d circles", k, r.Generation[i], added)
		}
	}
	// A kept circle beyond the radius cutoff is not forced in.
	tiny := GardenIdentity{Curvature: 23, X: 8, Y: 12}
	q.Keep, q.MinRadius = &tiny, 0.05
	r := mustGarden(t, q)
	if _, ok := indexByIdentity(r)[identityKey{23, 8, 12}]; ok {
		t.Fatal("a kept circle below the minimum radius was admitted")
	}
	// Without a window, keep changes nothing.
	q.Window = nil
	a, b := mustGarden(t, garden(12, 0.05, 5000)), mustGarden(t, q)
	if len(a.Curvature) != len(b.Curvature) {
		t.Fatalf("keep without a window changed %d circles to %d", len(a.Curvature), len(b.Curvature))
	}
}

// A view zoomed far into the cusp where the two large seeds touch needs
// more generations than depth 12 allows, and says so; a tight circle limit
// stops a deep view and says so.
func TestGardenDeepViewsReportTheirLimits(t *testing.T) {
	cusp := windowed(garden(12, 2e-5, 5000), GardenWindow{XMin: -0.014, XMax: 0.014, YMin: -0.011, YMax: 0.011})
	r := mustGarden(t, cusp)
	if r.Omitted.Depth == 0 || r.Stopped != "" {
		t.Fatalf("cusp: omitted %+v, stopped %q; want depth to bind", r.Omitted, r.Stopped)
	}
	checkPacking(t, r)
	inGap := windowed(garden(12, 1e-6, 200), gardenWindows[0])
	s := mustGarden(t, inGap)
	if s.Stopped != "count" || len(s.Curvature) != 200 || s.Pending == 0 {
		t.Fatalf("limited: stopped %q with %d circles, %d pending", s.Stopped, len(s.Curvature), s.Pending)
	}
	if s.Processed > 3*len(s.Curvature)+4 {
		t.Fatalf("examined %d gaps for %d circles", s.Processed, len(s.Curvature))
	}
	// The deepest supported view stays within the work limit.
	deepest := windowed(garden(GardenMaxDepth, 5e-324, GardenMaxCircles), GardenWindow{XMin: 0.3, XMax: 0.3286, YMin: 0.47, YMax: 0.4917})
	d := mustGarden(t, deepest)
	if d.Processed > GardenMaxConfigurations || len(d.Curvature) > GardenMaxCircles {
		t.Fatalf("deepest: processed %d, %d circles", d.Processed, len(d.Curvature))
	}
}

func TestGardenWindowIsDeterministic(t *testing.T) {
	q := windowed(garden(12, 1e-4, 5000), gardenWindows[0])
	k := GardenIdentity{Curvature: 23, X: 8, Y: 12}
	q.Keep = &k
	a, b := mustGarden(t, q), mustGarden(t, q)
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	if string(ja) != string(jb) || len(a.Curvature) < 100 {
		t.Fatal("repeated windowed requests differ")
	}
}

func TestGardenRefusesInvalidWindows(t *testing.T) {
	base := garden(12, 0.002, 5000)
	ok := GardenWindow{XMin: -0.5, XMax: 0.5, YMin: -0.4, YMax: 0.4}
	for _, c := range []struct {
		w     GardenWindow
		field string
	}{
		{GardenWindow{XMin: math.NaN(), XMax: 0.5, YMin: -0.4, YMax: 0.4}, "window.xMin"},
		{GardenWindow{XMin: -0.5, XMax: math.Inf(1), YMin: -0.4, YMax: 0.4}, "window.xMax"},
		{GardenWindow{XMin: -0.5, XMax: 0.5, YMin: math.Inf(-1), YMax: 0.4}, "window.yMin"},
		{GardenWindow{XMin: -0.5, XMax: 0.5, YMin: -0.4, YMax: math.NaN()}, "window.yMax"},
		{GardenWindow{XMin: 0.5, XMax: 0.5, YMin: -0.4, YMax: 0.4}, "window.xMax"},
		{GardenWindow{XMin: -0.5, XMax: 0.5, YMin: 0.4, YMax: -0.4}, "window.yMax"},
		{GardenWindow{XMin: -1001, XMax: 0.5, YMin: -0.4, YMax: 0.4}, "window.xMin"},
		{GardenWindow{XMin: -0.5, XMax: 0.5, YMin: -0.4, YMax: 1001}, "window.yMax"},
	} {
		_, err := ComputeGarden(windowed(base, c.w))
		var named *FieldError
		if !errors.As(err, &named) || named.Field != c.field {
			t.Errorf("%+v: got %v, want an error naming %s", c.w, err, c.field)
		}
	}
	if _, err := ComputeGarden(windowed(base, ok)); err != nil {
		t.Errorf("a valid window was refused: %v", err)
	}
	edge := GardenWindow{XMin: -1000, XMax: 1000, YMin: -1000, YMax: 1000}
	if _, err := ComputeGarden(windowed(base, edge)); err != nil {
		t.Errorf("a window at its bounds was refused: %v", err)
	}
}

// The view is tested before the radius: a gap outside the view counts as
// outside it even when its circle is also too small. Far from the packing,
// at minimum radius 0.2, the seed's three upper gaps (radii 1/15, 1/6, 1/6)
// and the lower circle's three gaps all lie outside the view; the lower
// gap, whose dual circle is a line, is filled by the radius-1/3 circle.
func TestGardenViewTakesPrecedenceInReports(t *testing.T) {
	r := mustGarden(t, windowed(garden(12, 0.2, 5000), GardenWindow{XMin: 2, XMax: 3, YMin: 2, YMax: 3}))
	if len(r.Curvature) != 5 || r.Curvature[4] != 3 || r.WeightedY[4] != -2 {
		t.Fatalf("want the seeds and the lower circle, got curvatures %v", r.Curvature)
	}
	if r.Omitted != (GardenOmitted{View: 6}) {
		t.Fatalf("omitted %+v, want 6 gaps outside the view", r.Omitted)
	}
}
