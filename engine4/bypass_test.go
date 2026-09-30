package engine4

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
)

func bypassRequest(t *testing.T, mode, obstacle string, height, position float64) Request {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"object": "bypass", "mode": mode, "samples": 32,
		"bypass": map[string]any{"inner": 1., "outer": 2., "extent": .15, "outside": Vec3{3, 0, 0}, "height": height, "position": position, "obstacle": obstacle, "w1": -.5, "w2": 1.25}})
	var q Request
	if err := json.Unmarshal(raw, &q); err != nil {
		t.Fatal(err)
	}
	return q
}
func bypassResult(t *testing.T, q Request) Result {
	t.Helper()
	r, e := Compute(q)
	if e != nil {
		t.Fatal(e)
	}
	return r
}

type observedBypass struct {
	State          string                       `json:"state"`
	Clearance      float64                      `json:"clearance"`
	Current        Vec4                         `json:"current"`
	Position       float64                      `json:"position"`
	Distance       float64                      `json:"distance"`
	ShadowDistance float64                      `json:"shadowDistance"`
	Hits           []struct{ From, To float64 } `json:"hits"`
}

func bypassDiagnostic(t *testing.T, r Result) observedBypass {
	t.Helper()
	raw, _ := json.Marshal(r)
	var out struct {
		Bypass observedBypass `json:"bypass"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out.Bypass
}
func TestBypassCompleteRouteAndClearance(t *testing.T) {
	r := bypassResult(t, bypassRequest(t, "shadow", "embedded", 1.2, .5))
	d := bypassDiagnostic(t, r)
	if d.State != "clear" || math.Abs(d.Clearance-1) > 1e-12 || len(d.Hits) != 0 {
		t.Fatal("whole route clearance", d)
	}
	p := sourcePaths(r, "bypass/route")
	if len(p) != 1 {
		t.Fatal("missing complete route")
	}
	want := []Vec4{{3, 0, 0, 0}, {3, 0, 0, 1.2}, {0, 0, 0, 1.2}, {0, 0, 0, 0}}
	if !reflect.DeepEqual(p[0].FourPoints, want) || !reflect.DeepEqual(p[0].Parameters, []float64{0, 1. / 3, 2. / 3, 1}) {
		t.Fatal("route corners/fractions", p)
	}
}
func TestBypassInvalidMiddleAndBoundary(t *testing.T) {
	for _, height := range []float64{0, .1, .15} {
		d := bypassDiagnostic(t, bypassResult(t, bypassRequest(t, "shadow", "embedded", height, 0)))
		state := "crossing"
		if height == .15 {
			state = "contact"
		}
		if d.State != state || d.Clearance != 0 || len(d.Hits) != 1 {
			t.Fatal("invalid full route reported clear", height, d)
		}
		// Middle leg x=3(2-3s); shell radii 2 and 1 give exact global endpoints.
		if math.Abs(d.Hits[0].From-4./9) > 1e-12 || math.Abs(d.Hits[0].To-5./9) > 1e-12 {
			t.Fatal("segment event endpoints", d)
		}
	}
}
func TestBypassFourDimensionalShellObstructsCanonicalRoutes(t *testing.T) {
	for _, height := range []float64{0, .1, 1.2, 4, 20} {
		d := bypassDiagnostic(t, bypassResult(t, bypassRequest(t, "diagram", "radial", height, 1)))
		if d.State != "crossing" || d.Clearance != 0 || len(d.Hits) == 0 {
			t.Fatal("radial obstruction missed", height, d)
		}
	}
}
func TestBypassRevealAndDistanceAgreeAcrossRepresentations(t *testing.T) {
	for _, position := range []float64{0, 1. / 6, 1. / 3, .5, 2. / 3, 5. / 6, 1} {
		shadow := bypassResult(t, bypassRequest(t, "shadow", "embedded", 1.2, position))
		diagram := bypassResult(t, bypassRequest(t, "diagram", "embedded", 1.2, position))
		a, b := bypassDiagnostic(t, shadow), bypassDiagnostic(t, diagram)
		if !reflect.DeepEqual(a, b) || a.Position != position {
			t.Fatal("linked representations diverged", a, b)
		}
		want := Vec4{}
		if position <= 1./3 {
			want = Vec4{3, 0, 0, 3 * position * 1.2}
		} else if position <= 2./3 {
			want = Vec4{3 * (2 - 3*position), 0, 0, 1.2}
		} else {
			want = Vec4{0, 0, 0, 3 * (1 - position) * 1.2}
		}
		for i := range want {
			if math.Abs(a.Current[i]-want[i]) > 1e-12 {
				t.Fatal("moving point not at declared parameter", a.Current, want)
			}
		}
		for _, r := range []Result{shadow, diagram} {
			traveled := sourcePaths(r, "bypass/traveled")
			if len(traveled) != 1 || traveled[0].Parameters[len(traveled[0].Parameters)-1] != position || traveled[0].FourPoints[len(traveled[0].FourPoints)-1] != a.Current {
				t.Fatal("reveal did not retain exact endpoint", traveled)
			}
		}
		if a.Distance != 1.75 || a.ShadowDistance != 0 {
			t.Fatal("hidden-coordinate distance", a)
		}
	}
}
func TestBypassExistingLiftUnaffected(t *testing.T) {
	r, e := Compute(liftRequest(t, "reference", Vec3{}, 2, .32))
	if e != nil {
		t.Fatal(e)
	}
	if len(sourcePaths(r, "lift/thread/2")) != 2 || r.Lift.VisibleIntervals != 11 {
		t.Fatal("existing lift changed", r.Lift)
	}
}
func TestBypassInvalidFields(t *testing.T) {
	base := bypassRequest(t, "shadow", "embedded", 1.2, 0)
	raw, _ := json.Marshal(base)
	for _, bad := range []struct {
		key   string
		value any
		name  string
	}{{"inner", 0., "Inner"}, {"outer", .5, "Outer"}, {"extent", -1., "Fourth"}, {"height", 21., "Route height"}, {"position", 1.1, "Route position"}, {"outside", []float64{1, 0, 0}, "Outside"}, {"w1", 21., "First comparison"}, {"w2", -21., "Second comparison"}, {"obstacle", "unknown", "obstacle"}} {
		copyRoot := map[string]any{}
		json.Unmarshal(raw, &copyRoot)
		copyRoot["bypass"].(map[string]any)[bad.key] = bad.value
		edited, _ := json.Marshal(copyRoot)
		var q Request
		json.Unmarshal(edited, &q)
		if _, err := Compute(q); err == nil || !strings.Contains(err.Error(), bad.name) {
			t.Fatal("invalid field", bad.key, err)
		}
	}
}

// The obstacles are canonical, so a common rigid motion of route and obstacle
// is tested through the obstacle's own symmetries: those motions move the
// route while leaving the obstacle fixed. K is preserved by rotations of xyz
// and by w ↦ −w; K₄ by every rotation of R⁴. Each moved segment has nonzero
// coordinates on every affected axis, and an independent membership test
// checks every returned interval and every gap between them.
func TestBypassCompleteSegmentsUnderReversalAndObstacleSymmetries(t *testing.T) {
	type fixture struct {
		a, b Vec4
		hits []shellHit
		// A positive-length piece lying exactly on a curved boundary is
		// moved off it by rotation rounding, below the documented
		// resolution; such fixtures use only the exact w reflection.
		exactBoundary bool
	}
	cases := []struct {
		obstacle BypassParameters
		fixtures []fixture
	}{
		{BypassParameters{Inner: 1, Outer: 2, Extent: .15, Obstacle: "embedded"}, []fixture{
			{Vec4{-3, 0, 0, 0}, Vec4{3, 0, 0, 0}, []shellHit{{1. / 6, 1. / 3, true}, {2. / 3, 5. / 6, true}}, false},
			{Vec4{-3, 2, 0, 0}, Vec4{3, 2, 0, 0}, []shellHit{{.5, .5, false}}, false},
			{Vec4{-3, 0, 0, .5}, Vec4{3, 0, 0, .5}, nil, false},
			{Vec4{0, 0, 0, 0}, Vec4{0, 0, 0, 1}, nil, false},
			{Vec4{1.5, 0, 0, -1}, Vec4{1.5, 0, 0, 1}, []shellHit{{.425, .575, true}}, false},
			{Vec4{2, 0, 0, 0}, Vec4{3, 0, 0, 0}, []shellHit{{0, 0, false}}, false},
			// Tangent to the inner sphere: the whole segment passes through
			// the interior, touching the cavity boundary only at t = 1/2.
			{Vec4{-1.5, 1, 0, 0}, Vec4{1.5, 1, 0, 0}, []shellHit{{0, 1, true}}, false},
			// Along the slab face |w| = ε: closed-boundary contact only.
			{Vec4{-3, 0, 0, .15}, Vec4{3, 0, 0, .15}, []shellHit{{1. / 6, 1. / 3, false}, {2. / 3, 5. / 6, false}}, false},
			// Coordinate fibers along the cavity and outer walls touch K
			// along a positive length without entering its interior.
			{Vec4{1, 0, 0, -1}, Vec4{1, 0, 0, 1}, []shellHit{{.425, .575, false}}, true},
			{Vec4{0, 2, 0, -1}, Vec4{0, 2, 0, 1}, []shellHit{{.425, .575, false}}, true},
		}},
		{BypassParameters{Inner: 1, Outer: 2, Obstacle: "radial"}, []fixture{
			{Vec4{0, 0, 0, 3}, Vec4{}, []shellHit{{1. / 3, 2. / 3, true}}, false},
			{Vec4{-1.5, 0, 0, 1}, Vec4{1.5, 0, 0, 1}, []shellHit{{0, 1, true}}, false},
			{Vec4{-3, 0, 0, 2}, Vec4{3, 0, 0, 2}, []shellHit{{.5, .5, false}}, false},
		}},
	}
	for _, c := range cases {
		o := newShellObstacle(c.obstacle)
		radial := c.obstacle.Obstacle == "radial"
		// Independent closed membership, with a resolution far above rounding.
		member := func(v Vec4, slack float64) bool {
			r := math.Hypot(math.Hypot(v[0], v[1]), v[2])
			if radial {
				r = math.Hypot(r, v[3])
				return r >= 1-slack && r <= 2+slack
			}
			return r >= 1-slack && r <= 2+slack && math.Abs(v[3]) <= .15+slack
		}
		motions := []func(Vec4) Vec4{func(v Vec4) Vec4 { return v }}
		xyz := [6]float64{.23, -.47, .31}
		if radial {
			xyz = [6]float64{.23, -.47, .31, .71, -.2, .19}
		}
		motions = append(motions,
			func(v Vec4) Vec4 { return rotate(v, xyz) },
			func(v Vec4) Vec4 { v = rotate(v, xyz); v[3] = -v[3]; return v })
		for _, f := range c.fixtures {
			for _, reversed := range []bool{false, true} {
				for m, move := range motions {
					if f.exactBoundary && m == 1 {
						continue
					}
					if f.exactBoundary && m == 2 {
						move = func(v Vec4) Vec4 { v[3] = -v[3]; return v }
					}
					a, b := move(f.a), move(f.b)
					if reversed {
						a, b = b, a
					}
					count := 0
					hits := shellSegment(a, b, o, &count)
					if len(hits) != len(f.hits) {
						t.Fatal("complete-segment classification", c.obstacle.Obstacle, f, m, reversed, hits)
					}
					for i, h := range hits {
						want := f.hits[i]
						if reversed {
							old := f.hits[len(f.hits)-1-i]
							want = shellHit{1 - old.hi, 1 - old.lo, old.crossing}
						}
						if math.Abs(h.lo-want.lo) > 1e-12 || math.Abs(h.hi-want.hi) > 1e-12 || h.crossing != want.crossing {
							t.Fatal("intersection changed under reversal/symmetry", c.obstacle.Obstacle, f, m, h, want)
						}
					}
					// Every point of a returned hit is a member; every point
					// strictly between hits (away from their ends) is not.
					edges := []float64{0}
					for _, h := range hits {
						for k := 1; k < 16; k++ {
							if tt := h.lo + (h.hi-h.lo)*float64(k)/16; !member(interpolate4(a, b, tt), 1e-9) {
								t.Fatal("returned hit contains a nonmember", f, tt)
							}
						}
						edges = append(edges, h.lo, h.hi)
					}
					edges = append(edges, 1)
					for k := 0; k+1 < len(edges); k += 2 {
						lo, hi := edges[k], edges[k+1]
						for j := 1; j < 16; j++ {
							tt := lo + (hi-lo)*float64(j)/16
							if hi-lo > 1e-6 && member(interpolate4(a, b, tt), -1e-9) {
								t.Fatal("classifier missed a member between hits", f, tt)
							}
						}
					}
				}
			}
		}
	}
}
func TestBypassReturnedIntersectionEndpointsAndBounds(t *testing.T) {
	for _, obstacle := range []string{"embedded", "radial"} {
		for _, height := range []float64{0, .15, 1.2, 20} {
			for _, mode := range []string{"shadow", "diagram"} {
				q := bypassRequest(t, mode, obstacle, height, .37)
				q.Samples = 256
				r := bypassResult(t, q)
				if r.EmittedPoints > 2000 || r.Evaluations > 2500 || len(r.Paths) > 24 {
					t.Fatal("whole-study work bound", r.EmittedPoints, r.Evaluations, len(r.Paths))
				}
				for _, p := range r.Paths {
					for i, v := range p.Points {
						if math.Sqrt(dot(v, v)) > r.Radius+1e-10 {
							t.Fatal("returned geometry outside framing", p.Source, v, r.Radius)
						}
						if p.Role == "collision" {
							four := p.FourPoints[i]
							radius := math.Sqrt(four[0]*four[0] + four[1]*four[1] + four[2]*four[2])
							if obstacle == "radial" {
								radius = math.Sqrt(radius*radius + four[3]*four[3])
							}
							if radius < 1-1e-10 || radius > 2+1e-10 || (obstacle == "embedded" && math.Abs(four[3]) > .15+1e-10) {
								t.Fatal("intersection geometry violates shell membership", four)
							}
						}
					}
				}
			}
		}
	}
}
func TestBypassCircleChordConvergence(t *testing.T) {
	for _, mode := range []string{"shadow", "diagram"} {
		errors := []float64{}
		for _, n := range []int{32, 64, 128} {
			q := bypassRequest(t, mode, "radial", 1.2, 0)
			q.Samples = n
			r := bypassResult(t, q)
			var p Path
			for _, path := range r.Paths {
				if path.Source == "bypass/shell/1/0" || path.Source == "bypass/shell/1" {
					p = path
					break
				}
			}
			if len(p.FourPoints) != n+1 {
				t.Fatal("wrong boundary curve samples")
			}
			v, w := p.FourPoints[0], p.FourPoints[1]
			mid := interpolate4(v, w, .5)
			error := 2 - norm(mid)
			errors = append(errors, error)
			step := 2 * math.Pi / float64(n)
			if mode == "diagram" {
				step /= 2
			}
			if math.Abs(error-2*(1-math.Cos(step/2))) > 1e-12 {
				t.Fatal("actual boundary chord error", error)
			}
		}
		if errors[0]/errors[1] < 3.98 || errors[1]/errors[2] < 3.98 {
			t.Fatal("boundary approximation lost quadratic convergence", errors)
		}
	}
}
func BenchmarkBypassMaximumSamples(b *testing.B) {
	q := Request{Object: "bypass", Mode: "shadow", Samples: 256, Bypass: &BypassParameters{Inner: 1, Outer: 2, Extent: .15, Outside: Vec3{3, 0, 0}, Height: .1, Position: .5, Obstacle: "embedded", W1: -20, W2: 20}}
	for b.Loop() {
		if _, e := Compute(q); e != nil {
			b.Fatal(e)
		}
	}
}

func TestBypassRadialIgnoresEmbeddedExtent(t *testing.T) {
	q := bypassRequest(t, "diagram", "radial", 1.2, 0)
	before := bypassResult(t, q)
	q.Bypass.Extent = math.NaN()
	if !reflect.DeepEqual(before, bypassResult(t, q)) {
		t.Fatal("inactive embedded extent altered radial geometry")
	}
}

func TestBypassValidationAndClearanceExtremes(t *testing.T) {
	for _, bad := range []struct {
		edit  func(*Request)
		field string
	}{
		{func(q *Request) { q.Mode = "section" }, "choose XYZ"},
		{func(q *Request) { q.Bypass = nil }, "parameters"},
		{func(q *Request) { q.Samples = 7 }, "shell samples"},
		{func(q *Request) { q.Samples = 257 }, "shell samples"},
		{func(q *Request) { q.Bypass.Inner = math.NaN() }, "Inner"},
		{func(q *Request) { q.Bypass.Inner = 11 }, "Inner"},
		{func(q *Request) { q.Bypass.Outer = math.Inf(1) }, "Outer"},
		{func(q *Request) { q.Bypass.Outer = 21 }, "Outer"},
		{func(q *Request) { q.Bypass.Extent = math.NaN() }, "Fourth"},
		{func(q *Request) { q.Bypass.Extent = 6 }, "Fourth"},
		{func(q *Request) { q.Bypass.Height = math.NaN() }, "Route height"},
		{func(q *Request) { q.Bypass.Height = -1 }, "Route height"},
		{func(q *Request) { q.Bypass.Position = math.NaN() }, "Route position"},
		{func(q *Request) { q.Bypass.Position = -1 }, "Route position"},
		{func(q *Request) { q.Bypass.Outside[1] = 21 }, "Outside point y"},
		{func(q *Request) { q.Bypass.Outside[2] = math.NaN() }, "Outside point z"},
		{func(q *Request) { q.Bypass.W1 = math.NaN() }, "First comparison"},
		{func(q *Request) { q.Bypass.W2 = math.Inf(-1) }, "Second comparison"},
	} {
		q := bypassRequest(t, "shadow", "embedded", 1.2, .5)
		bad.edit(&q)
		if _, e := Compute(q); e == nil || !strings.Contains(e.Error(), bad.field) {
			t.Fatal(bad.field, e)
		}
	}
	for _, f := range []struct{ outside, inner, height, want float64 }{{3, 1, .16, .01}, {2.01, 1, 1.2, .01}, {3, .05, 1.2, .05}} {
		q := bypassRequest(t, "diagram", "embedded", f.height, 1)
		q.Bypass.Inner = f.inner
		q.Bypass.Outside[0] = f.outside
		r := bypassResult(t, q)
		if math.Abs(r.Bypass.Clearance-f.want) > 1e-12 {
			t.Fatal("distance to full closed obstacle", r.Bypass, f)
		}
	}
	q := bypassRequest(t, "diagram", "embedded", 0, 1)
	q.Bypass.Extent = 0
	if r := bypassResult(t, q); r.Bypass.State != "crossing" {
		t.Fatal("zero-extent shell crossed", r.Bypass)
	}
}
func TestBypassReturnedMarkerProjectionAndFraming(t *testing.T) {
	for _, mode := range []string{"shadow", "diagram"} {
		q := bypassRequest(t, mode, "radial", 20, .7)
		q.Bypass.Outside = Vec3{-20, 20, 20}
		q.Bypass.W1 = -20
		q.Bypass.W2 = 20
		r := bypassResult(t, q)
		if len(r.Markers) != 3 {
			t.Fatal("point identities", r.Markers)
		}
		first, second := r.Markers[1], r.Markers[2]
		dist := norm(Vec4{first.FourPoint[0] - second.FourPoint[0], first.FourPoint[1] - second.FourPoint[1], first.FourPoint[2] - second.FourPoint[2], first.FourPoint[3] - second.FourPoint[3]})
		if dist != r.Bypass.Distance || dist != 40 {
			t.Fatal("actual marker separation", dist, r.Bypass)
		}
		if mode == "shadow" {
			shadow := math.Sqrt(dot(sub(first.Point, second.Point), sub(first.Point, second.Point)))
			if shadow != r.Bypass.ShadowDistance || shadow != 0 {
				t.Fatal("XYZ separation must be measured from the shadow markers", shadow, r.Bypass)
			}
		}
		for _, m := range r.Markers {
			if math.Sqrt(dot(m.Point, m.Point)) > r.Radius+1e-10 {
				t.Fatal("marker outside whole-study framing", m, r.Radius)
			}
			if mode == "shadow" && m.Point != (Vec3{m.FourPoint[0], m.FourPoint[1], m.FourPoint[2]}) {
				t.Fatal("XYZ shadow moved coordinates", m)
			}
			if mode == "diagram" && (m.Point[2] != 0 || math.Abs(m.Point[0]-(math.Sqrt(m.FourPoint[0]*m.FourPoint[0]+m.FourPoint[1]*m.FourPoint[1]+m.FourPoint[2]*m.FourPoint[2])-math.Sqrt(1200)/2)) > 1e-12 || m.Point[1] != m.FourPoint[3]) {
				t.Fatal("diagram coordinate scale", m)
			}
		}
	}
}

func TestBypassRadialSegmentDependsOnFourthCoordinate(t *testing.T) {
	o := newShellObstacle(BypassParameters{Inner: 1, Outer: 2, Obstacle: "radial"})
	count := 0
	hits := shellSegment(Vec4{0, 0, 0, 3}, Vec4{}, o, &count)
	if len(hits) != 1 || !hits[0].crossing || math.Abs(hits[0].lo-1./3) > 1e-12 || math.Abs(hits[0].hi-2./3) > 1e-12 {
		t.Fatal("radial shell must contain fourth-axis interval", hits)
	}
}

func TestBypassBoundaryToleranceRemainsConservative(t *testing.T) {
	tau := 1e-12 + 1e-10*2
	for _, f := range []struct {
		height float64
		state  string
	}{{.15 + 2*tau, "clear"}, {.15 + tau/4, "contact"}, {.15 - tau/4, "crossing"}} {
		q := bypassRequest(t, "shadow", "embedded", f.height, 0)
		r := bypassResult(t, q)
		if r.Bypass.State != f.state {
			t.Fatal("closed boundary resolution", f, r.Bypass)
		}
		if f.state == "clear" && math.Abs(r.Bypass.Clearance-(f.height-.15)) > 1e-15 {
			t.Fatal("clearance beyond contact tolerance", r.Bypass)
		}
	}
}

func TestBypassPairedResultIsOneSynchronizedBoundedSnapshot(t *testing.T) {
	for _, obstacle := range []string{"embedded", "radial"} {
		for _, s := range []float64{0, 1. / 3, .5, 2. / 3, 1} {
			q := bypassRequest(t, "paired", obstacle, 1.2, s)
			q.Samples = 256
			r := bypassResult(t, q)
			raw, e := json.Marshal(r)
			if e != nil {
				t.Fatal(e)
			}
			var observed struct {
				Companion *Result `json:"companion"`
			}
			if e = json.Unmarshal(raw, &observed); e != nil {
				t.Fatal(e)
			}
			d := observed.Companion
			if d == nil || d.Operation != "diagram" {
				t.Fatal("missing coordinate companion", d)
			}
			q.Mode = "shadow"
			shadow := bypassResult(t, q)
			q.Mode = "diagram"
			diagram := bypassResult(t, q)
			if !reflect.DeepEqual(r.Paths, shadow.Paths) || !reflect.DeepEqual(r.Markers, shadow.Markers) || !reflect.DeepEqual(*d, diagram) {
				t.Fatal("paired geometry changed an existing single view")
			}
			if !reflect.DeepEqual(r.Bypass, d.Bypass) || r.Bypass.Position != s {
				t.Fatal("companion sampled a different moment", r.Bypass, d.Bypass)
			}
			if r.EmittedPoints != shadow.EmittedPoints+diagram.EmittedPoints || r.Evaluations != shadow.Evaluations+diagram.Evaluations || r.EmittedPoints > 4000 || r.Evaluations > 5000 {
				t.Fatal("whole paired-study cost", r.EmittedPoints, r.Evaluations)
			}
		}
	}
}

func BenchmarkBypassPairedMaximumSamples(b *testing.B) {
	q := Request{Object: "bypass", Mode: "paired", Samples: 256, Bypass: &BypassParameters{Inner: 1, Outer: 2, Extent: .15, Outside: Vec3{3, 0, 0}, Height: .1, Position: .5, Obstacle: "embedded", W1: -20, W2: 20}}
	for b.Loop() {
		if _, e := Compute(q); e != nil {
			b.Fatal(e)
		}
	}
}

// The XYZ shadow of K₄ is the solid ball |p| ≤ b: every cavity point lifts in w
// into the shell. Only the outer boundary may be drawn; the embedded shell's
// shadow is its own 3D shell, bounded at both radii.
func TestBypassShadowDrawsTheObstacleShadow(t *testing.T) {
	for _, obstacle := range []string{"embedded", "radial"} {
		r := bypassResult(t, bypassRequest(t, "shadow", obstacle, 1.2, .5))
		radii := map[float64]int{}
		for _, p := range r.Paths {
			if p.Role != "shell" {
				continue
			}
			for _, v := range p.FourPoints {
				radius := math.Round(math.Sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])*1e9) / 1e9
				radii[radius]++
				if v[3] != 0 {
					t.Fatal("shadow boundary carries a lifted point", v)
				}
			}
		}
		want := map[float64]bool{1: obstacle == "embedded", 2: true}
		for radius, drawn := range want {
			if (radii[radius] > 0) != drawn {
				t.Fatal("shadow boundary radii", obstacle, radii)
			}
		}
		if len(radii) != 1+map[bool]int{true: 1}[obstacle == "embedded"] {
			t.Fatal("unexpected shadow boundary radius", obstacle, radii)
		}
	}
}

// Clearance is the reported minimum Euclidean distance from the complete route
// to the closed shell K. Measure that distance independently: the distance
// from (p,w) to K is hypot(max(a−|p|, |p|−b, 0), max(|w|−ε, 0)).
func TestBypassClearanceIsTheMeasuredDistanceToK(t *testing.T) {
	for _, f := range []struct {
		inner, outer, extent, height float64
		outside                      Vec3
	}{
		{1, 2, .15, 1.2, Vec3{3, 0, 0}},
		{1, 2, .15, .16, Vec3{1.7, -2.2, 1.1}},
		{.4, 2.5, 0, .3, Vec3{-1, 2, 2}},
		{1.5, 3, .5, 4, Vec3{2.2, 2.2, -.3}},
		{.05, 1, 1, 3, Vec3{-.4, .5, -.9}},
		{1, 2, .15, .15, Vec3{0, -2.5, 1}},
		{1, 2, .15, .05, Vec3{2, 1, -2}},
	} {
		q := bypassRequest(t, "shadow", "embedded", f.height, 0)
		q.Bypass.Inner, q.Bypass.Outer, q.Bypass.Extent, q.Bypass.Outside = f.inner, f.outer, f.extent, f.outside
		r := bypassResult(t, q)
		route := sourcePaths(r, "bypass/route")[0].FourPoints
		measured := math.Inf(1)
		for leg := 0; leg < 3; leg++ {
			for k := 0; k <= 6000; k++ {
				tt := float64(k) / 6000
				v := Vec4{}
				for i := range v {
					v[i] = route[leg][i] + (route[leg+1][i]-route[leg][i])*tt
				}
				rp := math.Hypot(math.Hypot(v[0], v[1]), v[2])
				dr := math.Max(0, math.Max(f.inner-rp, rp-f.outer))
				dw := math.Max(0, math.Abs(v[3])-f.extent)
				measured = math.Min(measured, math.Hypot(dr, dw))
			}
		}
		if math.Abs(measured-r.Bypass.Clearance) > 1e-9 {
			t.Fatal("clearance differs from the measured distance to K", f, measured, r.Bypass)
		}
		if (measured > 1e-9) != (r.Bypass.State == "clear") {
			t.Fatal("route state disagrees with the measured distance", f, measured, r.Bypass.State)
		}
	}
}

// Every continuous path from outside K₄ to the origin meets it, not only the
// canonical route: its 4D radius passes through [a,b]. Deterministic polylines
// with arbitrary intermediate corners check the complete-segment classifier.
func TestBypassFourDimensionalShellObstructsArbitraryPolylines(t *testing.T) {
	o := newShellObstacle(BypassParameters{Inner: 1, Outer: 2, Obstacle: "radial"})
	seed := uint64(0x9e3779b97f4a7c15)
	next := func() float64 {
		seed ^= seed << 13
		seed ^= seed >> 7
		seed ^= seed << 17
		return float64(seed>>11)/float64(1<<53)*10 - 5
	}
	for route := 0; route < 200; route++ {
		start := Vec4{next(), next(), next(), next()}
		for norm(start) <= 2.01 {
			start = Vec4{next(), next(), next(), next()}
		}
		corners := []Vec4{start}
		for i := 0; i < route%4; i++ {
			corners = append(corners, Vec4{next(), next(), next(), next()})
		}
		corners = append(corners, Vec4{})
		met := false
		count := 0
		for i := 0; i+1 < len(corners); i++ {
			for _, h := range shellSegment(corners[i], corners[i+1], o, &count) {
				v := interpolate4(corners[i], corners[i+1], (h.lo+h.hi)/2)
				if r := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2] + v[3]*v[3]); r < 1-1e-9 || r > 2+1e-9 {
					t.Fatal("reported hit is not in K₄", corners, h, r)
				}
				met = true
			}
		}
		if !met {
			t.Fatal("outside-to-origin polyline evaded K₄", corners)
		}
	}
}
