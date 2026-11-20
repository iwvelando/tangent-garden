package engine4

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// Neighborhood sampling of Base sphere and fibers (docs/tesseracts.md,
// "Neighborhoods"): k fibers at the centers of k equal cells of the stretch
// [c − wT/2, c + wT/2] of a path's period T, centered on the moving point's
// parameter c. Expected parameters and points come from the documented
// formulas and the path formulas written out in the other test files,
// never from the engine's descriptors.

func withNeighborhood(q Request, width float64, nearby int) Request {
	q.Weave.Sampling, q.Weave.Width, q.Weave.Nearby = "neighborhood", &width, &nearby
	return q
}

// reduced is t reduced into [0, T).
func reduced(t, period float64) float64 {
	t -= period * math.Floor(t/period)
	if t >= period {
		t -= period
	}
	return t
}

// The documented cell centers around c.
func expectedNearParameters(c, width, period float64, k int) []float64 {
	out := make([]float64, k)
	for i := range out {
		out[i] = reduced(c+width*period*(float64(i)-float64(k-1)/2)/float64(k), period)
	}
	return out
}

// periodicGap is the distance between two parameters on a circle of
// length T.
func periodicGap(a, b, period float64) float64 {
	d := math.Abs(a - b)
	return math.Min(d, period-d)
}

func snapped(p Vec3) Vec3 {
	if math.Hypot(p[0], p[1]) <= 2e-12 {
		return Vec3{0, 0, math.Copysign(1, p[2])}
	}
	return p
}

type neighborhoodCase struct {
	name   string
	q      Request
	period float64
	at     func(float64) Vec3
}

func neighborhoodCases() []neighborhoodCase {
	flower := pairedRequest(math.Pi/4, 20, 7)
	petals := 5
	flower.Weave.Path, flower.Weave.Amplitude, flower.Weave.Petals = "flower", math.Pi/8, &petals
	starPolygon := newExpectedPolygon(star)
	quad := newExpectedPolygon(southQuad)
	return []neighborhoodCase{
		{"latitude", pairedRequest(.6, 12, 5), 2 * math.Pi, func(t float64) Vec3 { return expectedBasePoint(.6, t) }},
		{"flower", flower, 2 * math.Pi, func(t float64) Vec3 {
			return expectedBasePoint(math.Pi/4+math.Pi/8*math.Cos(5*t), t)
		}},
		{"great circle", greatCircleRequest(2*math.Pi/3, 16, 3), 2 * math.Pi, func(t float64) Vec3 {
			return greatCirclePoint(2*math.Pi/3, t)
		}},
		{"lissajous", lissajousRequest(2, 1, 32, 9), 2 * math.Pi, func(t float64) Vec3 {
			return lissajousPoint(2, 1, t)
		}},
		{"star", polygonRequest(star, 30, 4), starPolygon.length, starPolygon.at},
		{"south quad", polygonRequest(southQuad, 9, 2), quad.length, quad.at},
	}
}

// checkNeighborhood checks every neighborhood marker, fiber and the arc of
// a returned study against the path at the documented parameters, after any
// rotation is undone.
func checkNeighborhood(t *testing.T, name string, r Result, angles [6]float64, width float64, k int, period float64, at func(float64) Vec3) {
	t.Helper()
	c := r.Weave.Correspondence
	h := c.Neighborhood
	if h == nil {
		t.Fatalf("%s: no neighborhood diagnostics", name)
	}
	if h.Width != width || h.Fibers != k || len(h.Parameters) != k {
		t.Fatalf("%s: neighborhood %+v", name, h)
	}
	if math.Abs(h.From-(c.Parameter-width*period/2)) > 1e-15*period || math.Abs(h.To-(c.Parameter+width*period/2)) > 1e-15*period {
		t.Fatalf("%s: stretch [%v, %v] around %v", name, h.From, h.To, c.Parameter)
	}
	want := expectedNearParameters(c.Parameter, width, period, k)
	for i, s := range h.Parameters {
		if s < 0 || s >= period || periodicGap(s, want[i], period) > 2e-15*period {
			t.Fatalf("%s: parameter %d is %v, want %v", name, i, s, want[i])
		}
	}
	at = func(f func(float64) Vec3) func(float64) Vec3 { return func(s float64) Vec3 { return snapped(f(s)) } }(at)
	center := -1
	if k%2 == 1 {
		center = (k - 1) / 2
	}
	drawn := map[int]bool{}
	for i := range h.Parameters {
		drawn[i] = i != center && (h.Aliases == nil || h.Aliases[i] == i)
	}
	// Markers: the whole path's samples, the neighborhood's and the moving
	// point, each on the path.
	samples, nearMarkers := 0, 0
	for _, m := range r.Companion.Markers {
		var i int
		switch {
		case m.Role == "sample":
			samples++
			continue
		case m.Role == "near":
			if _, err := fmt.Sscanf(m.ID, "weave/near/%d/base", &i); err != nil || !drawn[i] {
				t.Fatalf("%s: unexpected neighborhood marker %s", name, m.ID)
			}
			nearMarkers++
			if dist3(m.Point, at(h.Parameters[i])) > 3e-15 {
				t.Fatalf("%s: %s is off the path at %v", name, m.ID, h.Parameters[i])
			}
		}
		if math.Abs(norm4(m.FourPoint)-1) > 1e-15 || dist3(hopfMap(m.FourPoint), m.Point) > 3e-15 {
			t.Fatalf("%s: marker %s is not over its fiber", name, m.ID)
		}
	}
	if samples == 0 {
		t.Fatalf("%s: the whole path's sample markers are missing", name)
	}
	count := 0
	for _, d := range drawn {
		if d {
			count++
		}
	}
	if nearMarkers != count {
		t.Fatalf("%s: %d neighborhood markers, want %d", name, nearMarkers, count)
	}
	// Space: the neighborhood fibers and the moving fiber, drawn once.
	moving, nearFibers := 0, 0
	for _, p := range r.Paths {
		if p.Guide {
			continue
		}
		base := c.Base
		switch p.Role {
		case "near":
			var i int
			if _, err := fmt.Sscanf(p.Source, "weave/near/%d", &i); err != nil || !drawn[i] {
				t.Fatalf("%s: unexpected neighborhood fiber %s", name, p.Source)
			}
			base = at(h.Parameters[i])
			nearFibers++
		case "moving", "collapsed":
			moving++
		case "fiber":
			if p.Source != fmt.Sprintf("weave/latitude/0/fiber/%d", c.MovingSample) {
				t.Fatalf("%s: whole-path fiber %s drawn in a neighborhood", name, p.Source)
			}
			moving++
		default:
			t.Fatalf("%s: unexpected role %s", name, p.Role)
		}
		for _, v := range p.FourPoints {
			v = undoRotation(v, angles)
			if math.Abs(norm4(v)-1) > 1e-15 || dist3(hopfMap(v), base) > 4e-15 {
				t.Fatalf("%s: %s leaves its fiber", name, p.Source)
			}
		}
	}
	if moving != 1 || nearFibers != count {
		t.Fatalf("%s: %d moving and %d neighborhood fibers, want 1 and %d", name, moving, nearFibers, count)
	}
	// The arc runs from c − wT/2 to c + wT/2 on the path, in increasing
	// unwrapped parameter.
	arcs := weavePaths(*r.Companion, "neighborhood")
	if len(arcs) != 1 || arcs[0].Source != "weave/near/arc" {
		t.Fatalf("%s: %d neighborhood arcs", name, len(arcs))
	}
	arc := arcs[0]
	if arc.Parameters[0] != h.From || arc.Parameters[len(arc.Parameters)-1] != h.To || len(arc.Points) != len(arc.Parameters) {
		t.Fatalf("%s: arc parameters [%v … %v], want [%v, %v]", name, arc.Parameters[0], arc.Parameters[len(arc.Parameters)-1], h.From, h.To)
	}
	curve := map[Vec3]bool{}
	for _, p := range weavePaths(*r.Companion, "base-curve")[0].Points {
		curve[p] = true
	}
	for i, s := range arc.Parameters {
		if i > 0 && s <= arc.Parameters[i-1] {
			t.Fatalf("%s: arc parameters not increasing at %d", name, i)
		}
		if dist3(arc.Points[i], at(reduced(s, period))) > 4e-15 {
			t.Fatalf("%s: arc point %d is off the path at %v", name, i, s)
		}
		// Between its ends the arc is the base curve's own points.
		if 0 < i && i < len(arc.Points)-1 && !curve[arc.Points[i]] {
			t.Fatalf("%s: arc point %d is not a base-curve point", name, i)
		}
	}
}

func TestNeighborhoodReturnedGeometry(t *testing.T) {
	for _, nc := range neighborhoodCases() {
		for _, s := range []struct {
			width float64
			k     int
			trace float64
		}{{.125, 17, 0}, {.3, 8, 0}, {.05, 21, .137}, {1, 9, -.21}, {.5, 1, .4}, {.2, 32, .0001}} {
			q := withNeighborhood(nc.q, s.width, s.k)
			q.Weave.Trace = s.trace
			q.Angles = [6]float64{.3, .2, .1, 1.7, .5, 2.3}
			r := weaveCompute(t, q)
			name := fmt.Sprintf("%s w=%v k=%d trace=%v", nc.name, s.width, s.k, s.trace)
			checkNeighborhood(t, name, r, q.Angles, s.width, s.k, nc.period, nc.at)
			// On a sample, at rest or traced, the moving fiber is that
			// sample's own; between samples it is the moving fiber, with its
			// own base point.
			c := r.Weave.Correspondence
			if s.trace == 0 && c.MovingSample != nc.q.Weave.Selected {
				t.Fatalf("%s: at rest the moving point is sample %d", name, c.MovingSample)
			}
			own := fmt.Sprintf("weave/latitude/0/fiber/%d", c.MovingSample)
			if c.MovingSample >= 0 && (pathBySource(r, own) == nil || pathBySource(r, "weave/moving") != nil ||
				markerByID(*r.Companion, "weave/moving/base") != nil) {
				t.Fatalf("%s: the moving fiber on a sample is not %s", name, own)
			}
			if c.MovingSample < 0 && (pathBySource(r, "weave/moving") == nil || markerByID(*r.Companion, "weave/moving/base") == nil) {
				t.Fatalf("%s: no moving fiber between samples", name)
			}
		}
	}
}

// With w = k/n and an odd k, the cells are the whole path's own spacing,
// so the neighborhood fibers are the whole path's fibers j − (k−1)/2 …
// j + (k−1)/2, wrapped across the seam, as sets of S³.
func TestNeighborhoodMatchesWholePathSamples(t *testing.T) {
	for _, nc := range neighborhoodCases() {
		n := nc.q.Curves
		for _, k := range []int{3, 5} {
			for _, j := range []int{0, 1, n - 1} {
				whole := nc.q
				whole.Weave = new(WeaveParameters)
				*whole.Weave = *nc.q.Weave
				whole.Weave.Selected = j
				q := withNeighborhood(whole, float64(k)/float64(n), k)
				name := fmt.Sprintf("%s k=%d j=%d", nc.name, k, j)
				local, full := weaveCompute(t, q), weaveCompute(t, whole)
				fibers := map[string]Path{}
				for _, p := range full.Paths {
					fibers[p.Source] = p
				}
				markers := map[string]Marker{}
				for _, m := range full.Companion.Markers {
					markers[m.ID] = m
				}
				for i := 0; i < k; i++ {
					if i == (k-1)/2 {
						continue
					}
					sample := ((j-(k-1)/2+i)%n + n) % n
					if a := local.Weave.Correspondence.Neighborhood.Aliases; a != nil && a[i] != i {
						continue
					}
					want, ok := fibers[fmt.Sprintf("weave/latitude/0/fiber/%d", sample)]
					got := pathBySource(local, fmt.Sprintf("weave/near/%d", i))
					if !ok || got == nil {
						continue // a pole sample drawn by its alias
					}
					a, b := want.FourPoints[0], want.FourPoints[len(want.FourPoints)/3]
					for _, v := range got.FourPoints {
						if planeResidual(v, a, b) > 2e-14 {
							t.Fatalf("%s: near/%d is not whole-path fiber %d", name, i, sample)
						}
					}
					m := markerByID(*local.Companion, fmt.Sprintf("weave/near/%d/base", i))
					if m == nil || dist3(m.Point, markers[fmt.Sprintf("weave/latitude/0/base/%d", sample)].Point) > 4e-15 {
						t.Fatalf("%s: near/%d's point is not sample %d's", name, i, sample)
					}
				}
			}
		}
	}
}

func pathBySource(r Result, source string) *Path {
	for i := range r.Paths {
		if r.Paths[i].Source == source {
			return &r.Paths[i]
		}
	}
	return nil
}

func markerByID(r Result, id string) *Marker {
	for i := range r.Markers {
		if r.Markers[i].ID == id {
			return &r.Markers[i]
		}
	}
	return nil
}

// nearGeometry is a result's neighborhood fibers and markers by ID, and the
// neighborhood arc, without the selection-dependent diagnostics.
func nearGeometry(r Result) (map[string]Path, map[string]Marker) {
	paths, markers := map[string]Path{}, map[string]Marker{}
	for _, p := range r.Paths {
		if p.Role == "near" {
			paths[p.Source] = p
		}
	}
	for _, p := range r.Companion.Paths {
		if p.Role == "neighborhood" {
			paths[p.Source] = p
		}
	}
	for _, m := range r.Companion.Markers {
		if m.Role == "near" {
			markers[m.ID] = m
		}
	}
	return paths, markers
}

// The neighborhood keeps its center on the moving point: a trace of s
// sample steps is, bit for bit, the rest neighborhood of the selection s
// samples on, forward and in reverse, and a whole turn is the rest study.
func TestNeighborhoodTraceStepsAndLoops(t *testing.T) {
	for _, nc := range neighborhoodCases() {
		n := nc.q.Curves
		for _, k := range []int{6, 7} {
			rest := withNeighborhood(nc.q, .2, k)
			rest.Angles = [6]float64{.1, .4, .2, .9, .3, 1.1}
			restResult := weaveCompute(t, rest)
			for _, turns := range []float64{1, -1, 2} {
				q := rest
				q.Weave = new(WeaveParameters)
				*q.Weave = *rest.Weave
				q.Weave.Trace = turns
				if r := weaveCompute(t, q); !reflect.DeepEqual(r, restResult) {
					t.Fatalf("%s k=%d: %v turns does not return the rest study", nc.name, k, turns)
				}
			}
			for _, steps := range []int{1, 3, -1, -2} {
				name := fmt.Sprintf("%s k=%d steps=%d", nc.name, k, steps)
				traced := rest
				traced.Weave = new(WeaveParameters)
				*traced.Weave = *rest.Weave
				traced.Weave.Trace = float64(steps) / float64(n)
				next := rest
				next.Weave = new(WeaveParameters)
				*next.Weave = *rest.Weave
				next.Weave.Selected = ((rest.Weave.Selected+steps)%n + n) % n
				a, b := weaveCompute(t, traced), weaveCompute(t, next)
				pa, ma := nearGeometry(a)
				pb, mb := nearGeometry(b)
				if !reflect.DeepEqual(pa, pb) || !reflect.DeepEqual(ma, mb) ||
					!reflect.DeepEqual(a.Weave.Correspondence.Neighborhood, b.Weave.Correspondence.Neighborhood) {
					t.Fatalf("%s: the traced neighborhood is not the next selection's", name)
				}
				if a.Weave.Correspondence.MovingSample != b.Weave.Correspondence.MovingSample ||
					a.Weave.Correspondence.Parameter != b.Weave.Correspondence.Parameter {
					t.Fatalf("%s: moving sample %d at %v, want %d at %v", name, a.Weave.Correspondence.MovingSample,
						a.Weave.Correspondence.Parameter, b.Weave.Correspondence.MovingSample, b.Weave.Correspondence.Parameter)
				}
			}
		}
	}
}

// A neighborhood around sample 0 wraps across the seam t = 0 ≡ T: its
// parameters are reduced into [0, T), while the arc's parameters run on
// through zero and its points stay continuous.
func TestNeighborhoodWrapsAcrossTheSeam(t *testing.T) {
	for _, nc := range neighborhoodCases() {
		q := nc.q
		q.Weave = new(WeaveParameters)
		*q.Weave = *nc.q.Weave
		q.Weave.Selected = 0
		q = withNeighborhood(q, .4, 9)
		r := weaveCompute(t, q)
		h := r.Weave.Correspondence.Neighborhood
		if h.From >= 0 || h.To <= 0 {
			t.Fatalf("%s: stretch [%v, %v] does not cross the seam", nc.name, h.From, h.To)
		}
		for i, s := range h.Parameters[:4] {
			if s <= nc.period/2 {
				t.Fatalf("%s: parameter %d = %v did not wrap", nc.name, i, s)
			}
		}
		arc := weavePaths(*r.Companion, "neighborhood")[0]
		crossed := false
		for i := 1; i < len(arc.Points); i++ {
			step := arc.Parameters[i] - arc.Parameters[i-1]
			// Chords are no longer than their arc: the polygon and great
			// circle have unit speed, the latitude at most 1, the
			// Lissajous curve √5, and this flower √(1 + (5π/4)²) < 4.1.
			if dist3(arc.Points[i], arc.Points[i-1]) > 4.1*step+1e-15 {
				t.Fatalf("%s: the arc jumps between %d and %d", nc.name, i-1, i)
			}
			crossed = crossed || arc.Parameters[i-1] < 0 && arc.Parameters[i] >= 0
		}
		if !crossed {
			t.Fatalf("%s: the arc does not run through zero", nc.name)
		}
		checkNeighborhood(t, nc.name+" seam", r, q.Angles, .4, 9, nc.period, nc.at)
	}
}

// A polygon neighborhood continues around a corner in arc length: its cells
// keep the spacing wT/k across the corner, and the arc passes through the
// exact vertex.
func TestNeighborhoodTurnsPolygonCorners(t *testing.T) {
	e := newExpectedPolygon(southQuad)
	q := withNeighborhood(polygonRequest(southQuad, 9, 0), .5, 12)
	r := weaveCompute(t, q)
	h := r.Weave.Correspondence.Neighborhood
	for i := 1; i < len(h.Parameters); i++ {
		if d := periodicGap(h.Parameters[i], h.Parameters[i-1], e.length); math.Abs(d-.5*e.length/12) > 1e-14 {
			t.Fatalf("cells %d and %d are %v apart, want %v", i-1, i, d, .5*e.length/12)
		}
	}
	arc := weavePaths(*r.Companion, "neighborhood")[0]
	inside := 0
	for k, corner := range e.corners {
		for _, s := range []float64{corner, corner - e.length, corner + e.length} {
			if s <= h.From || s >= h.To {
				continue
			}
			inside++
			found := false
			for i, p := range arc.Parameters {
				if p == s || math.Abs(p-s) <= 1e-12 && arc.Points[i] == vertexPoint(southQuad[k]) {
					found = arc.Points[i] == vertexPoint(southQuad[k])
				}
			}
			if !found {
				t.Fatalf("the arc misses vertex %d at %v", k+1, s)
			}
		}
	}
	if inside < 2 {
		t.Fatalf("only %d corners inside the neighborhood", inside)
	}
	checkNeighborhood(t, "south quad corners", r, q.Angles, .5, 12, e.length, e.at)
}

// Exact repeated poles among the moving point and the neighborhood share
// one fiber, the first in that order; the whole path's selection is kept.
func TestNeighborhoodPoleMerges(t *testing.T) {
	// m = (1, 2) is at the north pole at t = 0 and π. The moving point at
	// the south pole t = π/2 (sample 1 of 4) puts both cells of w = 1, k = 2
	// on the north pole: the second shares the first's fiber.
	q := withNeighborhood(lissajousRequest(1, 2, 4, 1), 1, 2)
	r := weaveCompute(t, q)
	c := r.Weave.Correspondence
	if c.Selected != 1 || c.Base != (Vec3{0, 0, -1}) || !reflect.DeepEqual(c.Neighborhood.Aliases, []int{0, 0}) {
		t.Fatalf("north-pole cells: %+v %+v", c, c.Neighborhood)
	}
	if len(weavePaths(r, "near")) != 1 || pathBySource(r, "weave/near/0") == nil {
		t.Fatalf("north-pole cells draw %d fibers", len(weavePaths(r, "near")))
	}
	checkNeighborhood(t, "north-pole cells", r, q.Angles, 1, 2, 2*math.Pi, func(s float64) Vec3 { return lissajousPoint(1, 2, s) })
	// m = (1, 4) is at the north pole every quarter turn: with the moving
	// point there, both cells share the moving fiber.
	q = withNeighborhood(lissajousRequest(1, 4, 4, 0), 1, 2)
	r = weaveCompute(t, q)
	c = r.Weave.Correspondence
	if c.Selected != 0 || !reflect.DeepEqual(c.Neighborhood.Aliases, []int{-1, -1}) || len(weavePaths(r, "near")) != 0 {
		t.Fatalf("cells on the moving pole: %+v %+v", c, c.Neighborhood)
	}
	checkNeighborhood(t, "moving-pole cells", r, q.Angles, 1, 2, 2*math.Pi, func(s float64) Vec3 { return lissajousPoint(1, 4, s) })
	// The path's own repeated poles still share one point: m = (1, 2) at
	// eight points draws six, as under the whole path.
	q = withNeighborhood(lissajousRequest(1, 2, 8, 4), .2, 5)
	r = weaveCompute(t, q)
	samples := 0
	for _, m := range r.Companion.Markers {
		if m.Role == "sample" {
			samples++
		}
	}
	if samples != 6 || !reflect.DeepEqual(r.Weave.Correspondence.Aliases, []int{0, 1, 2, 3, 0, 5, 2, 7}) {
		t.Fatalf("%d sample points, aliases %v", samples, r.Weave.Correspondence.Aliases)
	}
	// Coincidences away from the poles are kept: Viviani's curve crosses
	// itself at (0, 1, 0), at t = π/2 and 3π/2.
	q = withNeighborhood(lissajousRequest(1, 1, 4, 0), 1, 2)
	r = weaveCompute(t, q)
	if r.Weave.Correspondence.Neighborhood.Aliases != nil || len(weavePaths(r, "near")) != 2 {
		t.Fatalf("Viviani's crossing was merged: %+v", r.Weave.Correspondence.Neighborhood)
	}
}

// A collapsed latitude is one pole: every cell shares its one circle.
func TestNeighborhoodCollapsedLatitude(t *testing.T) {
	for _, alpha := range []float64{0, math.Pi / 2} {
		q := withNeighborhood(pairedRequest(alpha, 12, 4), .3, 5)
		r := weaveCompute(t, q)
		c := r.Weave.Correspondence
		if c.Selected != 4 || !c.Coincident || len(r.Paths) != 4 || r.Paths[0].Role != "collapsed" ||
			len(r.Companion.Markers) != 1 || !reflect.DeepEqual(c.Neighborhood.Aliases, []int{-1, -1, -1, -1, -1}) {
			t.Fatalf("α=%v: %+v %+v, %d paths, %d markers", alpha, c, c.Neighborhood, len(r.Paths), len(r.Companion.Markers))
		}
		if len(weavePaths(*r.Companion, "neighborhood")) != 0 {
			t.Fatalf("α=%v: a collapsed latitude draws a neighborhood arc", alpha)
		}
	}
}

// A very small width is admitted: its cells may coincide in floating point
// but keep their own fibers and identities. At the seam, a cell just
// before t = 0 rounds to T and is reduced to 0, never reported as T.
func TestNeighborhoodTinyWidth(t *testing.T) {
	seam := withNeighborhood(greatCircleRequest(.7, 8, 0), 1e-300, 4)
	for _, s := range weaveCompute(t, seam).Weave.Correspondence.Neighborhood.Parameters {
		if s < 0 || s > 1e-299 {
			t.Fatalf("a seam cell at %v, want just at or after 0", s)
		}
	}
	q := withNeighborhood(greatCircleRequest(.7, 8, 3), 1e-300, 4)
	r := weaveCompute(t, q)
	h := r.Weave.Correspondence.Neighborhood
	for _, s := range h.Parameters {
		if s != r.Weave.Correspondence.Parameter {
			t.Fatalf("parameters %v around %v", h.Parameters, r.Weave.Correspondence.Parameter)
		}
	}
	if len(weavePaths(r, "near")) != 4 || h.Aliases != nil {
		t.Fatalf("%d neighborhood fibers, aliases %v", len(weavePaths(r, "near")), h.Aliases)
	}
}

// With w = 1 the cells are an even sampling of the whole path, with no
// repeated endpoint, and the arc is the whole closed path.
func TestNeighborhoodWholeWidth(t *testing.T) {
	q := withNeighborhood(greatCircleRequest(.7, 8, 3), 1, 6)
	r := weaveCompute(t, q)
	h := r.Weave.Correspondence.Neighborhood
	ps := append([]float64{}, h.Parameters...)
	sort.Float64s(ps)
	for i := range ps {
		next := ps[(i+1)%len(ps)]
		if d := periodicGap(next, ps[i], 2*math.Pi); math.Abs(d-2*math.Pi/6) > 1e-14 {
			t.Fatalf("cells %v are not even", ps)
		}
	}
	arc := weavePaths(*r.Companion, "neighborhood")[0]
	if !closedPath(arc) || math.Abs(h.To-h.From-2*math.Pi) > 1e-15 {
		t.Fatalf("the whole-width arc is not the closed path")
	}
}

func TestNeighborhoodValidationAndInactiveFields(t *testing.T) {
	cases := []struct {
		name, field string
		change      func(*Request)
	}{
		{"sampling", "weave.sampling", func(q *Request) { q.Weave.Sampling = "local" }},
		{"zero width", "weave.width", func(q *Request) { w := 0.; q.Weave.Width = &w }},
		{"negative width", "weave.width", func(q *Request) { w := -.1; q.Weave.Width = &w }},
		{"wider than the path", "weave.width", func(q *Request) { w := 1.0000001; q.Weave.Width = &w }},
		{"nonfinite width", "weave.width", func(q *Request) { w := math.NaN(); q.Weave.Width = &w }},
		{"infinite width", "weave.width", func(q *Request) { w := math.Inf(1); q.Weave.Width = &w }},
		{"no fibers", "weave.nearby", func(q *Request) { k := 0; q.Weave.Nearby = &k }},
		{"too many fibers", "weave.nearby", func(q *Request) { k := 33; q.Weave.Nearby = &k }},
	}
	// The path's count names its points, which the neighborhood centers on.
	q := withNeighborhood(lissajousRequest(2, 1, 33, 3), .2, 9)
	if _, err := Compute(q); err == nil || err.(*FieldError).Field != "curves" || !strings.Contains(err.Error(), "points on the Lissajous curve") {
		t.Errorf("count error %v", err)
	}
	for _, c := range cases {
		q := withNeighborhood(lissajousRequest(2, 1, 12, 3), .2, 9)
		c.change(&q)
		_, err := Compute(q)
		fe, ok := err.(*FieldError)
		if !ok || fe.Field != c.field {
			t.Errorf("%s: error %v, want field %s", c.name, err, c.field)
		}
	}
	// Under the whole path the neighborhood fields are neither checked nor
	// reported, and the result keeps its bytes.
	plain := lissajousRequest(2, 1, 12, 3)
	want, _ := json.Marshal(weaveCompute(t, plain))
	for _, sampling := range []string{"", "path"} {
		q := withNeighborhood(lissajousRequest(2, 1, 12, 3), -4, 99)
		q.Weave.Sampling = sampling
		got, _ := json.Marshal(weaveCompute(t, q))
		if string(got) != string(want) || strings.Contains(string(got), "neighborhood") {
			t.Fatalf("sampling %q changes the whole-path result", sampling)
		}
	}
	// Absent fields take the documented defaults.
	q = lissajousRequest(2, 1, 12, 3)
	q.Weave.Sampling = "neighborhood"
	h := weaveCompute(t, q).Weave.Correspondence.Neighborhood
	if h.Width != .125 || h.Fibers != 17 {
		t.Fatalf("defaults %+v", h)
	}
}

// Distinct complete neighborhood fibers link once, like the whole path's.
func TestNeighborhoodCompleteFibersLinkOnce(t *testing.T) {
	q := withNeighborhood(lissajousRequest(2, 1, 16, 5), .25, 6)
	q.Samples, q.Clip, q.Weave.Trace = 192, 12, .01
	r := weaveCompute(t, q)
	var loops [][]Vec3
	for _, p := range r.Paths {
		if (p.Role == "near" || p.Role == "moving") && closedPath(p) {
			loops = append(loops, p.Points)
		}
	}
	if len(loops) < 5 {
		t.Fatalf("only %d complete fibers", len(loops))
	}
	for i := range loops {
		for j := i + 1; j < len(loops); j++ {
			if l := polygonLinking(loops[i], loops[j]); math.Abs(math.Abs(l)-1) > 1e-6 {
				t.Fatalf("fibers %d and %d link %v times", i, j, l)
			}
		}
	}
}

// The largest admitted neighborhood, k = n = 32 at 256 arc samples on a
// 12-vertex polygon whose every corner is inserted, stays within its
// counted bound, which is well inside the ceiling.
func TestNeighborhoodLargestStudyWithinBudget(t *testing.T) {
	vs := make([]PolygonVertex, 12)
	for i := range vs {
		vs[i] = PolygonVertex{U: 2 * math.Pi * (float64(i) + .37) / 12, V: .5 + .2*math.Cos(float64(i))}
	}
	q := withNeighborhood(polygonRequest(vs, 32, 7), .9, 32)
	q.Samples, q.Weave.Trace = 256, .013
	bound := neighborhoodPoints(32, 32, 256, 256, 11)
	if bound != 10658 || bound > maxPoints {
		t.Fatalf("bound %d", bound)
	}
	r := weaveCompute(t, q)
	if len(weavePaths(*r.Companion, "base-curve")[0].Points) != 256+1+11 {
		t.Fatalf("the study does not insert every corner")
	}
	// The result's counts include its companion's.
	if r.EmittedPoints > bound || r.Evaluations != r.EmittedPoints {
		t.Fatalf("%d points, %d evaluations, bound %d", r.EmittedPoints, r.Evaluations, bound)
	}
}

func BenchmarkNeighborhoodLargest(b *testing.B) {
	vs := make([]PolygonVertex, 12)
	for i := range vs {
		vs[i] = PolygonVertex{U: 2 * math.Pi * (float64(i) + .37) / 12, V: .5 + .2*math.Cos(float64(i))}
	}
	q := withNeighborhood(polygonRequest(vs, 32, 7), .9, 32)
	q.Samples, q.Weave.Trace = 256, .013
	for i := 0; i < b.N; i++ {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}
