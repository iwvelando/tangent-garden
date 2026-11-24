package engine

import (
	"errors"
	"math"
	"math/cmplx"
	"reflect"
	"strconv"
	"testing"
)

// Detail for a view (docs/mathematics.md, Hyperbolic lace, Detail for a
// view). The expectations come from the unlimited breadth-first patch,
// generated without a window, and from the definition of a tile in view
// written out here: its circumscribed hyperbolic circle, radius R about its
// returned center, is a Euclidean disk that meets the window, and whose
// radius is at least the minimum radius.

// unlimited is the whole breadth-first patch to a depth, with no tile or
// candidate ceiling, placed under an isometry.
func unlimited(t *testing.T, id string, depth int, iso LaceIsometry) LaceResult {
	t.Helper()
	q := tiling(id, depth, 1<<30, 0.3)
	r, err := generateLace(q, laceLimits{depth, 1 << 30, lacePolicy}).result(iso)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// addressKey is a tile's address, the sides crossed from the center.
func addressKey(r LaceResult, i int) string {
	s := ""
	for t := i; t > 0; t = int(r.Parent[t]) {
		s = strconv.Itoa(int(r.Via[t])) + "." + s
	}
	return s
}

// viewDisk is the Euclidean disk of the hyperbolic circle of radius R
// about c: with τ = tanh(R/2), center c(1 − τ²)/(1 − |c|²τ²) and radius
// (1 − |c|²)τ/(1 − |c|²τ²).
func viewDisk(c complex128, R float64) (complex128, float64) {
	tau := math.Tanh(R / 2)
	c2 := real(c)*real(c) + imag(c)*imag(c)
	den := 1 - c2*tau*tau
	return c * complex((1-tau*tau)/den, 0), (1 - c2) * tau / den
}

func laceInView(r LaceResult, i int, w LaceWindow, minRadius float64) bool {
	c, rho := viewDisk(cz(r.Center[i]), r.Circumradius)
	if rho < minRadius {
		return false
	}
	dx := math.Max(w.XMin-real(c), math.Max(0, real(c)-w.XMax))
	dy := math.Max(w.YMin-imag(c), math.Max(0, imag(c)-w.YMax))
	return math.Hypot(dx, dy) <= rho
}

// pageWindow is the window a 1000 × 760 page shows at a zoom, centered on
// a model point, the rim drawn at 350 page units at 1×; the minimum
// radius is a number of page units at that zoom.
func lacePageWindow(center complex128, zoom, pageUnits float64) (LaceWindow, float64) {
	k := 350 * zoom
	return LaceWindow{
		XMin: real(center) - 500/k, XMax: real(center) + 500/k,
		YMin: imag(center) - 380/k, YMax: imag(center) + 380/k,
	}, pageUnits / k
}

func laceWindowed(q LaceRequest, w LaceWindow, minRadius float64) LaceRequest {
	q.Window, q.MinRadius = &w, minRadius
	return q
}

// The windowed patch holds every tile of the unlimited patch in view, with
// the same address, depth, orientation and transformation to the last
// bit, and holds no tile the unlimited patch lacks within its depth. Views
// at the rim at several zooms and directions, around the center, beyond
// the disk, and under an isometry. The unlimited patches reach depth 9
// ({7,3}, {5,4}), 10 ({4,5}) and 14 ({3,7}); a windowed tile deeper than
// that is checked by the address of its parent only.
func TestLaceWindowMatchesUnlimitedPatch(t *testing.T) {
	depths := map[string]int{"7,3": 9, "5,4": 9, "4,5": 10, "3,7": 14}
	for _, id := range researchTilings {
		t.Run(id, func(t *testing.T) {
			D := depths[id]
			type view struct {
				name string
				c    complex128
				zoom float64
				iso  LaceIsometry
			}
			views := []view{
				{"whole disk", 0, 1, LaceIsometry{}},
				{"centered 3×", 0, 3, LaceIsometry{}},
				{"beyond the rim", 1.3 + 0.2i, 6, LaceIsometry{}},
				{"moved, at the rim", cmplx.Rect(0.97, -2.4), 5, LaceIsometry{Offset: 0.6, Direction: 0.7, Rotation: 0.4}},
				{"moved, centered", 0.2i, 2, LaceIsometry{Offset: 0.8, Direction: -1.9, Rotation: 0}},
			}
			for k := range 6 {
				for _, zoom := range []float64{2, 5, 12} {
					theta := 2*math.Pi*float64(k)/6 + 0.37*zoom
					views = append(views, view{"rim " + strconv.Itoa(k) + " " + strconv.FormatFloat(zoom, 'g', -1, 64), cmplx.Rect(0.96, theta), zoom, LaceIsometry{}})
				}
			}
			full := map[LaceIsometry]LaceResult{}
			for _, v := range views {
				ref, ok := full[v.iso]
				if !ok {
					ref = unlimited(t, id, D, v.iso)
					full[v.iso] = ref
				}
				byAddress := map[string]int{}
				for i := range ref.Center {
					byAddress[addressKey(ref, i)] = i
				}
				w, least := lacePageWindow(v.c, v.zoom, viewUnits[id])
				q := laceWindowed(tiling(id, 3, 1000, 0.3), w, least)
				// Without the tile and candidate limits, which a view at 1×
				// or under an offset can reach: the tile budget is the
				// page's policy (TestLaceDetailBudget).
				iso := v.iso
				q.Isometry = &iso
				q.MaxTiles = 1 << 30
				r, err := generateLace(q, laceLimits{3, 1 << 30, lacePolicy}).result(iso)
				if err != nil {
					t.Fatal(err)
				}
				checkLaceShape(t, r)
				if r.Stopped != "" || r.Omitted.Precision != 0 {
					t.Fatalf("%s: stopped %q, %d left out for precision", v.name, r.Stopped, r.Omitted.Precision)
				}
				got := map[string]int{}
				seen := 0
				for i := range r.Center {
					a := addressKey(r, i)
					got[a] = i
					j, ok := byAddress[a]
					if !ok {
						if int(r.Depth[i]) <= D {
							t.Errorf("%s: tile %s at depth %v is not in the unlimited patch", v.name, a, r.Depth[i])
						}
						continue
					}
					seen++
					if r.Depth[i] != ref.Depth[j] || r.Reversed[i] != ref.Reversed[j] ||
						r.Transform[i] != ref.Transform[j] || r.Center[i] != ref.Center[j] {
						t.Errorf("%s: tile %s differs from the unlimited patch's", v.name, a)
					}
				}
				missing := 0
				for j := range ref.Center {
					if laceInView(ref, j, w, least) {
						if _, ok := got[addressKey(ref, j)]; !ok {
							missing++
						}
					}
				}
				if missing > 0 {
					t.Errorf("%s: %d tiles in view are missing", v.name, missing)
				}
				if seen == 0 {
					t.Errorf("%s: nothing compared", v.name)
				}
			}
		})
	}
}

// The page units of a tile's least drawn radius in the views below:
// {3,7}'s triangles are smaller for their circumradius, so it draws at
// least 3 to keep a deep view within the tile limit.
var viewUnits = map[string]float64{"7,3": 2, "5,4": 2, "4,5": 2, "3,7": 3}

// Deep views at the zoom limit: the window's tiles reach far beyond the
// depth bound, are regular to the budget, their edges and strokes are
// geodesics on circles orthogonal to the rim within 10⁻¹¹ (observed
// 1.1·10⁻¹²), and nothing is left out for precision.
func TestLaceWindowAtTheZoomLimit(t *testing.T) {
	eachTiling(t, func(t *testing.T, p, q int) {
		for _, c := range []complex128{cmplx.Rect(0.9999, 0.3), cmplx.Rect(0.99995, 2.2), cmplx.Rect(1, -1.1)} {
			w, least := lacePageWindow(c, 100, viewUnits[laceID])
			r := mustLace(t, laceWindowed(lace(5, 1000, 0.3), w, least))
			if r.Stopped != "" || r.Omitted.Precision != 0 {
				t.Fatalf("stopped %q with %d pending, %d left out for precision", r.Stopped, r.Pending, r.Omitted.Precision)
			}
			deepest, viewed := 0.0, 0
			for i := range r.Center {
				deepest = math.Max(deepest, r.Depth[i])
				if laceInView(r, i, w, least) {
					viewed++
				}
				for k := range p {
					if d := math.Abs(dist(corner(r, i, k), corner(r, i, k+1)) - r.SideLength); d > laceBudget {
						t.Fatalf("tile %d side %d is %v off", i, k, d)
					}
				}
			}
			if deepest <= float64(top()) || viewed < 100 {
				t.Errorf("at %v: %d tiles in view, deepest %v", c, viewed, deepest)
			}
			checkGeodesicsWithin(t, r, 1e-11)
		}
	})
}

// A windowed patch depends only on its request: the same after any other
// views, and from a source as from a request.
func TestLaceWindowIsPathIndependent(t *testing.T) {
	w, least := lacePageWindow(cmplx.Rect(0.98, 1), 8, 2)
	q := laceWindowed(lace(5, 1000, 0.3), w, least)
	first := mustLace(t, q)
	for _, z := range []float64{2, 30, 100} {
		ow, ol := lacePageWindow(cmplx.Rect(0.99, -2), z, 2)
		mustLace(t, laceWindowed(lace(5, 1000, 0.3), ow, ol))
	}
	if again := mustLace(t, q); !reflect.DeepEqual(again, first) {
		t.Error("the view's patch changed after other views")
	}
	src, err := NewLaceSource(q)
	if err != nil {
		t.Fatal(err)
	}
	if r, _ := src.result(LaceIsometry{}); !reflect.DeepEqual(r, first) {
		t.Error("the source's patch differs from the request's")
	}
}

// Every tile is kept with its address path, each parent preceding its
// child one ring in. The window's tile limit stops the patch, and the
// candidate limit the search, each reported as for any patch; the tile
// limit bounds only the cutoffs' part.
func TestLaceWindowCeilings(t *testing.T) {
	w, least := lacePageWindow(0, 1.2, 0.5)
	q := laceWindowed(lace(5, 300, 0.3), w, least)
	r, err := generateLace(q, laceLimits{5, 1 << 30, lacePolicy}).result(LaceIsometry{})
	if err != nil {
		t.Fatal(err)
	}
	if r.Stopped != "count" || r.Pending == 0 || len(r.Center) != LaceMaxViewTiles {
		t.Errorf("tile limit: stopped %q, %d pending, %d tiles", r.Stopped, r.Pending, len(r.Center))
	}
	for i := 1; i < len(r.Center); i++ {
		if j := int(r.Parent[i]); j >= i || r.Depth[j] != r.Depth[i]-1 {
			t.Fatalf("tile %d's parent %d", i, j)
		}
	}
	src := generateLace(laceWindowed(lace(5, 1000, 0.3), w, least), laceLimits{5, 500, lacePolicy})
	if src.topology.Stopped != "candidates" || src.topology.Processed != 500 {
		t.Errorf("candidate limit: stopped %q after %d", src.topology.Stopped, src.topology.Processed)
	}
}

// Left-out candidates are counted once each: outside the view, below the
// minimum radius, or (never at these limits) for precision; depth leaves
// nothing out under a window.
func TestLaceWindowOmissions(t *testing.T) {
	w, least := lacePageWindow(cmplx.Rect(0.97, 0.5), 4, 2)
	r := mustLace(t, laceWindowed(lace(2, 1000, 0.3), w, least))
	if r.Omitted.View == 0 || r.Omitted.Radius == 0 || r.Omitted.Depth != 0 {
		t.Errorf("omitted %+v", r.Omitted)
	}
	// Without a window nothing is counted under view or radius.
	if b := mustLace(t, lace(5, 1000, 0.3)); b.Omitted.View != 0 || b.Omitted.Radius != 0 {
		t.Errorf("unwindowed omitted %+v", b.Omitted)
	}
}

// A frozen windowed patch moves along a motion, its ends the static
// drawing; a frame for another window, minimum radius or static isometry
// is refused, since under a window those decide the tiles.
func TestLaceWindowFrames(t *testing.T) {
	w, least := lacePageWindow(cmplx.Rect(0.95, 2), 4, 2)
	q := laceWindowed(lace(5, 1000, 0.3), w, least)
	q.Isometry = &LaceIsometry{Offset: 0.3, Direction: 1, Rotation: 0}
	m := LaceMotion{Offset: 0.6, Orbits: 1}
	src, err := NewLaceSource(q)
	if err != nil {
		t.Fatal(err)
	}
	static := mustLace(t, q)
	f, err := src.Frame(LaceFrameRequest{Lace: q, Motion: m, Progress: 1})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(f.Vertex, static.Vertex) || !reflect.DeepEqual(f.ArcStart, static.ArcStart) {
		t.Error("the frame at the end is not the static drawing")
	}
	if f, err := src.Frame(LaceFrameRequest{Lace: q, Motion: m, Progress: 0.5}); err != nil || len(f.Center) != len(static.Center) {
		t.Errorf("halfway: %v", err)
	}
	other := []LaceRequest{q, q, q}
	w2 := w
	w2.XMax += 0.01
	other[0].Window = &w2
	other[1].MinRadius *= 2
	other[2].Isometry = &LaceIsometry{Offset: 0.31, Direction: 1}
	for i, o := range other {
		if _, err := src.Frame(LaceFrameRequest{Lace: o, Motion: m, Progress: 0.5}); err == nil {
			t.Errorf("case %d: a frozen window drew another view's frame", i)
		}
	}
	// Without a window the static isometry is not generation: one frozen
	// patch serves every start.
	plain := lace(5, 1000, 0.3)
	ps, _ := NewLaceSource(plain)
	plain.Isometry = &LaceIsometry{Offset: 0.4}
	if _, err := ps.Frame(LaceFrameRequest{Lace: plain, Motion: m, Progress: 0.5}); err != nil {
		t.Errorf("unwindowed source refused another start: %v", err)
	}
}

// A tile's address path keeps close to the straight line to it: on
// unlimited patches, every tile on it lies within the tiling's gallery
// reach of the ray from the center through the tile's center, and no
// farther from the center than the tile. The window's search relies on
// both, with headroom over the most measured here.
func TestLaceAddressPathsHugTheirLine(t *testing.T) {
	depths := map[string]int{"7,3": 8, "5,4": 8, "4,5": 9, "3,7": 13}
	for _, id := range researchTilings {
		r := unlimited(t, id, depths[id], LaceIsometry{})
		reach := laceTilings[id].gallery
		worst := 0.0
		for i := 1; i < len(r.Center); i++ {
			c := cz(r.Center[i])
			theta := cmplx.Phase(c)
			for j := int(r.Parent[i]); j > 0; j = int(r.Parent[j]) {
				y := cz(r.Center[j])
				w := y * cmplx.Rect(1, -theta)
				d := dist(y, 0)
				if real(w) > 0 {
					d = math.Asinh(2 * math.Abs(imag(w)) / (1 - real(y)*real(y) - imag(y)*imag(y)))
				}
				worst = math.Max(worst, d)
				if dist(y, 0) > dist(c, 0)+1e-9 {
					t.Fatalf("%s: tile %d's path passes farther out, at tile %d", id, i, j)
				}
			}
		}
		if worst > reach-0.2 {
			t.Errorf("%s: a path strays %v from its line, within 0.2 of the reach %v", id, worst, reach)
		}
	}
}

func TestLaceWindowRefusals(t *testing.T) {
	good := LaceWindow{XMin: -0.5, XMax: 0.5, YMin: -0.4, YMax: 0.4}
	with := func(f func(w *LaceWindow), minRadius float64) LaceRequest {
		w := good
		f(&w)
		return laceWindowed(lace(3, 100, 0.3), w, minRadius)
	}
	none := func(*LaceWindow) {}
	for _, c := range []struct {
		field string
		q     LaceRequest
	}{
		{"window.xMin", with(func(w *LaceWindow) { w.XMin = math.NaN() }, 0.01)},
		{"window.xMax", with(func(w *LaceWindow) { w.XMax = math.Inf(1) }, 0.01)},
		{"window.yMin", with(func(w *LaceWindow) { w.YMin = -1001 }, 0.01)},
		{"window.yMax", with(func(w *LaceWindow) { w.YMax = 1001 }, 0.01)},
		{"window.xMax", with(func(w *LaceWindow) { w.XMax = w.XMin }, 0.01)},
		{"window.yMax", with(func(w *LaceWindow) { w.YMax = w.YMin - 1 }, 0.01)},
		{"minRadius", with(none, math.Nextafter(LaceMinRadius, 0))},
		{"minRadius", with(none, 1.01)},
		{"minRadius", with(none, math.NaN())},
		{"minRadius", LaceRequest{Tiling: laceID, Depth: 3, MaxTiles: 100, MinRadius: 0.01}},
	} {
		_, err := ComputeLace(c.q)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Errorf("%+v: got %v, want a %s error", c.q, err, c.field)
		}
	}
	for _, q := range []LaceRequest{with(none, LaceMinRadius), with(none, 1)} {
		if _, err := ComputeLace(q); err != nil {
			t.Errorf("%+v refused: %v", q, err)
		}
	}
}

// A window keeps the patch the cutoffs make wherever it meets the window,
// so zooming in never loses a tile drawn at 1×: every tile of the
// unwindowed patch whose circle meets the window is in the windowed one,
// with the same address and transformation; and the windowed patch holds
// tiles beyond that patch.
func TestLaceWindowKeepsThePatch(t *testing.T) {
	eachTiling(t, func(t *testing.T, p, _ int) {
		base := tiling(laceID, deepest[laceID], 1000, 0.3)
		plain := mustLace(t, base)
		for _, c := range []struct {
			at   complex128
			zoom float64
		}{{0, 1.5}, {cmplx.Rect(0.9, 0.4), 3}, {cmplx.Rect(0.99, -2), 12}} {
			w, least := lacePageWindow(c.at, c.zoom, viewUnits[laceID])
			r := mustLace(t, laceWindowed(base, w, least))
			got := map[string]int{}
			for i := range r.Center {
				got[addressKey(r, i)] = i
			}
			kept, beyond := 0, 0
			had := map[string]bool{}
			for j := range plain.Center {
				had[addressKey(plain, j)] = true
				if !laceInView(plain, j, w, 0) {
					continue
				}
				kept++
				i, ok := got[addressKey(plain, j)]
				if !ok || r.Transform[i] != plain.Transform[j] {
					t.Fatalf("zoom %v at %v: the patch's tile %s is lost", c.zoom, c.at, addressKey(plain, j))
				}
			}
			for a := range got {
				if !had[a] {
					beyond++
				}
			}
			if kept == 0 || beyond == 0 {
				t.Errorf("zoom %v at %v: %d of the patch's tiles in the window, %d beyond it", c.zoom, c.at, kept, beyond)
			}
		}
	})
}

// The page's zoom detail asks for tiles drawn at least these page units
// in radius at each level (web/lace/tilings.ts, detailRadius), with
// windows the view snapped out to quarter-view cells plus one. A sweep of
// views at every level found the most tiles in windows covering the whole
// disk at 1.4× and 2×; those stay within both limits without stopping,
// from the opening cutoffs and the densest, as does a deep view at the
// rim in a window 2.5 views wide.
func TestLaceDetailBudget(t *testing.T) {
	units := map[string]float64{"7,3": 3, "5,4": 3, "4,5": 3, "3,7": 4}
	opening := map[string]int{"7,3": 5, "5,4": 5, "4,5": 6, "3,7": 10}
	for _, id := range researchTilings {
		for _, depth := range []int{opening[id], deepest[id]} {
			for _, c := range []struct {
				name   string
				w      LaceWindow
				factor float64
			}{
				{"whole disk at 1.4×", LaceWindow{XMin: -1.2, XMax: 1.2, YMin: -1.2, YMax: 1.2}, math.Sqrt2},
				{"whole disk at 2×", LaceWindow{XMin: -1.2, XMax: 1.2, YMin: -1.2, YMax: 1.2}, 2},
				{"rim at 90×", LaceWindow{XMin: 0.6 - 0.04, XMax: 0.6 + 0.04, YMin: 0.8 - 0.03, YMax: 0.8 + 0.03}, math.Pow(2, 6.5)},
			} {
				r := mustLace(t, laceWindowed(tiling(id, depth, 1000, 0.3), c.w, units[id]/(350*c.factor)))
				if r.Stopped != "" || len(r.Center) > 1700 || r.Processed > 8000 {
					t.Errorf("%s depth %d, %s: %d tiles, %d candidates, stopped %q", id, depth, c.name, len(r.Center), r.Processed, r.Stopped)
				}
			}
		}
	}
}

// The precision policy binds a window's search as it binds any patch:
// under a raised floor, candidates too near the rim are counted as left
// out for precision, and no tile with a corner below the floor is kept.
func TestLaceWindowPrecisionCutoff(t *testing.T) {
	w, least := lacePageWindow(cmplx.Rect(0.999, 0.4), 30, 3)
	floor := 1e-3
	src := generateLace(laceWindowed(lace(5, 1000, 0.3), w, least), laceLimits{5, LaceMaxCandidates, lacePrecision{floor: floor, agreement: 1e-9}})
	r, err := src.result(LaceIsometry{})
	if err != nil {
		t.Fatal(err)
	}
	if r.Omitted.Precision == 0 {
		t.Error("a raised floor left nothing out for precision")
	}
	for _, v := range r.Vertex {
		if z := cz(v); 1-real(z)*real(z)-imag(z)*imag(z) < floor {
			t.Fatalf("a corner at %v lies below the floor", z)
		}
	}
}
