package engine4

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

// The geodesic polygon base path of Base sphere and fibers
// (docs/tesseracts.md, "Geodesic polygons"). Expected points come from the
// vertex chart and spherical linear interpolation, written out here
// independently of the engine's side axes.

func vertexPoint(v PolygonVertex) Vec3 {
	p := Vec3{math.Cos(v.V) * math.Cos(v.U), math.Cos(v.V) * math.Sin(v.U), math.Sin(v.V)}
	if math.Hypot(p[0], p[1]) <= 2e-12 {
		return Vec3{0, 0, math.Copysign(1, p[2])}
	}
	return p
}

// expectedPolygon is the documented path: arc length t from vertex 1, the
// corners' arc lengths, the perimeter, and the side holding each t.
type expectedPolygon struct {
	ps      []Vec3
	corners []float64 // corners[i] is the arc length at vertex i
	length  float64
}

func newExpectedPolygon(vs []PolygonVertex) expectedPolygon {
	e := expectedPolygon{}
	for _, v := range vs {
		e.ps = append(e.ps, vertexPoint(v))
	}
	for i, p := range e.ps {
		e.corners = append(e.corners, e.length)
		e.length += math.Acos(math.Max(-1, math.Min(1, dot(p, e.ps[(i+1)%len(e.ps)]))))
	}
	return e
}

// side holds t; a vertex, within 10⁻¹² of its corner, begins its departing
// side.
func (e expectedPolygon) side(t float64) int {
	for i, c := range append(e.corners, e.length) {
		if math.Abs(t-c) <= 1e-12 {
			return i % len(e.ps)
		}
	}
	i := 0
	for i+1 < len(e.corners) && t >= e.corners[i+1] {
		i++
	}
	return i
}

// at is slerp along side i, (sin(θ − σ) a + sin σ b) / sin θ, with the
// documented snaps: a parameter within 10⁻¹² of a corner is the vertex, and
// a point within 2·10⁻¹² of a pole is the pole.
func (e expectedPolygon) at(t float64) Vec3 {
	for i, c := range append(e.corners, e.length) {
		if math.Abs(t-c) <= 1e-12 {
			return e.ps[i%len(e.ps)]
		}
	}
	i := e.side(t)
	a, b := e.ps[i], e.ps[(i+1)%len(e.ps)]
	theta := math.Acos(math.Max(-1, math.Min(1, dot(a, b))))
	s := t - e.corners[i]
	ka, kb := math.Sin(theta-s)/math.Sin(theta), math.Sin(s)/math.Sin(theta)
	p := Vec3{ka*a[0] + kb*b[0], ka*a[1] + kb*b[1], ka*a[2] + kb*b[2]}
	if math.Hypot(p[0], p[1]) <= 2e-12 {
		return Vec3{0, 0, math.Copysign(1, p[2])}
	}
	return p
}

// normal is the unit normal of side i's great circle.
func (e expectedPolygon) normal(i int) Vec3 {
	n := cross(e.ps[i], e.ps[(i+1)%len(e.ps)])
	l := math.Sqrt(dot(n, n))
	return Vec3{n[0] / l, n[1] / l, n[2] / l}
}

func polygonRequest(vs []PolygonVertex, n, selected int) Request {
	q := pairedRequest(math.Pi/4, n, selected)
	q.Weave.Path, q.Weave.Vertices = "polygon", vs
	return q
}

var (
	octantTriangle = []PolygonVertex{{0, 0}, {math.Pi / 2, 0}, {0, math.Pi / 2}}
	// A skew quadrilateral with a vertex at the south pole.
	southQuad = []PolygonVertex{{.3, .4}, {1.9, .1}, {2.5, -math.Pi / 2}, {-.6, -.2}}
	// A self-crossing star {5/2} on the latitude v = π/6.
	star = []PolygonVertex{{0, math.Pi / 6}, {4 * math.Pi / 5, math.Pi / 6}, {8 * math.Pi / 5, math.Pi / 6},
		{12 * math.Pi / 5, math.Pi / 6}, {16 * math.Pi / 5, math.Pi / 6}}
	// Nonadjacent opposite vertices: (1, 0, 0), (0, 1, 0), (−1, 0, 0), (0, 0, 1).
	antipodalQuad = []PolygonVertex{{0, 0}, {math.Pi / 2, 0}, {math.Pi, 0}, {0, math.Pi / 2}}
	// Two octant triangles meeting at the north pole, which is vertices 1
	// and 4: a nonadjacent coincidence.
	bowtie = []PolygonVertex{{.7, math.Pi / 2}, {0, 0}, {math.Pi / 2, 0}, {2, math.Pi / 2}, {math.Pi, 0}, {3 * math.Pi / 2, 0}}
)

func TestGeodesicPolygonReturnedGeometry(t *testing.T) {
	for name, vs := range map[string][]PolygonVertex{"octant": octantTriangle, "south quad": southQuad,
		"star": star, "antipodal quad": antipodalQuad, "bowtie": bowtie} {
		e := newExpectedPolygon(vs)
		for _, trace := range []float64{0, .137, -.137, .5 - 1e-10, .5 + 1e-10} {
			q := polygonRequest(vs, 13, 3)
			q.Weave.Trace = trace
			q.Angles = [6]float64{.3, .2, .1, 1.7, .5, 2.3}
			r := weaveCompute(t, q)
			c := r.Weave.Correspondence
			label := fmt.Sprintf("%s trace=%v", name, trace)
			if c.Path != "polygon" || math.Abs(c.Period-e.length) > 1e-14 || c.Sides != len(vs) ||
				r.Sections[0].Kind != "polygon" || r.Sections[0].Dimension != 1 {
				t.Fatalf("%s: provenance %+v %+v", label, c, r.Sections[0])
			}
			if c.Side == nil || *c.Side != e.side(c.Parameter) {
				t.Fatalf("%s: moving point on side %v, want %d", label, c.Side, e.side(c.Parameter))
			}
			checkPathGeometry(t, label, r, q.Angles, 13, c.Period, e.at)
			// Every base point lies on its side's great circle, and every
			// unrotated fiber over a side lies on that side's great
			// Clifford torus, H(q)·ν = 0.
			curve := weavePaths(*r.Companion, "base-curve")[0]
			for k, p := range curve.Points {
				i := e.side(curve.Parameters[k])
				if math.Abs(dot(p, e.normal(i))) > 2e-15 && (k == 0 || math.Abs(dot(p, e.normal((i+len(vs)-1)%len(vs)))) > 2e-15) {
					t.Fatalf("%s: base point %d leaves side %d's great circle", label, k, i)
				}
			}
			for _, p := range r.Paths {
				var j int
				if _, err := fmt.Sscanf(p.Source, "weave/latitude/0/fiber/%d", &j); err != nil {
					continue
				}
				s := c.Period * float64(j) / 13
				nu := e.normal(e.side(s))
				for _, v := range p.FourPoints {
					if math.Abs(dot(hopfMap(undoRotation(v, q.Angles)), nu)) > 4e-15 {
						t.Fatalf("%s: %s leaves its side's torus", label, p.Source)
					}
				}
			}
		}
	}
}

// Fiber samples are uniform in arc length: neighbors on one side are L/n
// apart on the sphere.
func TestGeodesicPolygonSamplesAreUniformInArcLength(t *testing.T) {
	for _, vs := range [][]PolygonVertex{southQuad, star} {
		e := newExpectedPolygon(vs)
		const n = 29
		r := weaveCompute(t, polygonRequest(vs, n, 0))
		at := map[int]Vec3{}
		for _, m := range r.Companion.Markers {
			var j int
			if _, err := fmt.Sscanf(m.ID, "weave/latitude/0/base/%d", &j); err == nil {
				at[j] = m.Point
			}
		}
		step := e.length / n
		for j := 0; j+1 < n; j++ {
			if e.side(step*float64(j)) != e.side(step*float64(j+1)) {
				continue
			}
			if d := math.Acos(math.Min(1, dot(at[j], at[j+1]))); math.Abs(d-step) > 1e-12 {
				t.Fatalf("samples %d and %d are %v apart, want %v", j, j+1, d, step)
			}
		}
	}
}

// The base curve has N uniform segments with each corner inserted unless a
// uniform point is within 10⁻¹² of it; either way the corner is the exact
// vertex, and the curve closes exactly.
func TestGeodesicPolygonBaseCurveCorners(t *testing.T) {
	for _, tc := range []struct {
		samples, points int
	}{{64, 67}, {60, 61}} {
		q := polygonRequest(octantTriangle, 12, 0)
		q.Samples = tc.samples
		curve := weavePaths(*weaveCompute(t, q).Companion, "base-curve")[0]
		if len(curve.Points) != tc.points || !closedPath(curve) {
			t.Fatalf("N=%d: %d base points, want %d", tc.samples, len(curve.Points), tc.points)
		}
		e := newExpectedPolygon(octantTriangle)
		for k, p := range e.ps {
			found := false
			for i, x := range curve.Points {
				if x == p && math.Abs(curve.Parameters[i]-e.corners[k]) <= 1e-12 {
					found = true
				}
			}
			if !found {
				t.Fatalf("N=%d: vertex %d (%v) is not an exact base point", tc.samples, k+1, p)
			}
		}
		for i := 1; i < len(curve.Parameters); i++ {
			if d := curve.Parameters[i] - curve.Parameters[i-1]; d <= 0 || d > e.length/float64(tc.samples)+1e-15 {
				t.Fatalf("N=%d: base step %d is %v", tc.samples, i, d)
			}
		}
	}
	// An equilateral polygon with a multiple of its sides as samples puts
	// a fiber sample exactly on every vertex.
	r := weaveCompute(t, polygonRequest(octantTriangle, 24, 0))
	want := map[string]Vec3{}
	for k, j := range []string{"0", "8", "16"} {
		want[j] = vertexPoint(octantTriangle[k])
	}
	for _, m := range r.Companion.Markers {
		for j, p := range want {
			if m.ID == "weave/latitude/0/base/"+j && m.Point != p {
				t.Fatalf("sample %s is %v, want the vertex %v", j, m.Point, p)
			}
		}
	}
}

// Tracing crosses each corner continuously at unit speed; its side changes
// only there, and a vertex begins its departing side.
func TestGeodesicPolygonTraceAcrossCorners(t *testing.T) {
	e := newExpectedPolygon(southQuad)
	q := polygonRequest(southQuad, 7, 0)
	var last *CorrespondenceDiagnostics
	const steps = 4000
	for k := 0; k <= steps; k++ {
		q.Weave.Trace = float64(k) / steps * (1 - 1e-9)
		c := weaveCompute(t, q).Weave.Correspondence
		if last != nil {
			dt := c.Parameter - last.Parameter
			if d := dist3(c.Base, last.Base); d > dt*(1+1e-9)+1e-15 {
				t.Fatalf("step %d: the point jumped %v over Δt = %v", k, d, dt)
			}
			if *c.Side != *last.Side && e.side(c.Parameter) == e.side(last.Parameter) {
				t.Fatalf("step %d: side changed from %d to %d away from a corner", k, *last.Side, *c.Side)
			}
		}
		last = c
	}
	for i, s := range e.corners {
		q.Weave.Trace = s / e.length
		c := weaveCompute(t, q).Weave.Correspondence
		if math.Abs(c.Parameter-s) <= 1e-12 && (c.Base != e.ps[i] || *c.Side != i) {
			t.Fatalf("at vertex %d: %+v side %d", i+1, c.Base, *c.Side)
		}
	}
}

func TestGeodesicPolygonDerivative(t *testing.T) {
	e := newExpectedPolygon(southQuad)
	p := newSpherePath(WeaveParameters{Path: "polygon", Vertices: southQuad}, 64)
	if math.Abs(p.period-e.length) > 1e-14 || len(p.corners) != 3 {
		t.Fatalf("period %v corners %v", p.period, p.corners)
	}
	for s := .05; s < p.period; s += .23 {
		h := 1e-6
		if e.side(s-h) != e.side(s+h) {
			continue
		}
		a, b := e.at(s+h), e.at(s-h)
		fd := Vec3{(a[0] - b[0]) / (2 * h), (a[1] - b[1]) / (2 * h), (a[2] - b[2]) / (2 * h)}
		d := p.derivative(s)
		if dist3(d, fd) > 1e-8 || math.Abs(math.Sqrt(dot(d, d))-1) > 1e-15 || math.Abs(dot(d, p.point(s))) > 1e-15 {
			t.Fatalf("at %v: derivative %v, central difference %v", s, d, fd)
		}
		// Increasing t follows the vertex order: counterclockwise about
		// its side's normal p_i × p_{i+1}.
		if math.Abs(dot(cross(p.point(s), d), e.normal(e.side(s)))-1) > 1e-14 {
			t.Fatalf("at %v: orientation", s)
		}
	}
	// At a corner the derivative is the departing side's tangent.
	for i, s := range e.corners {
		d := p.derivative(s)
		next := e.ps[(i+1)%len(e.ps)]
		if dot(d, next) <= 0 || math.Abs(dot(d, e.normal(i))) > 1e-15 || math.Abs(dot(d, e.ps[i])) > 1e-15 {
			t.Fatalf("vertex %d: derivative %v does not depart along side %d", i+1, d, i+1)
		}
	}
}

func TestGeodesicPolygonPeriodicTraceAndLinking(t *testing.T) {
	q := polygonRequest(star, 12, 7)
	q.Angles = [6]float64{.3, .2, .1, 1.7, .5, 2.3}
	q.Clip = 2
	at := func(trace float64) Result { q.Weave.Trace = trace; return weaveCompute(t, q) }
	if !reflect.DeepEqual(at(0), at(1)) || !reflect.DeepEqual(at(0), at(-1)) || !reflect.DeepEqual(at(.125), at(-.875)) {
		t.Fatal("whole turns or reversed traversal changed the presentation")
	}
	q.Weave.Selected = 0
	if r := at(.25); r.Weave.Correspondence.MovingSample != 3 || len(weavePaths(r, "moving")) != 0 {
		t.Fatal("trace must reuse the frozen sample's fiber")
	}
	q = polygonRequest(southQuad, 7, 1)
	q.Samples, q.Clip, q.Weave.Trace = 128, 12, .061
	r := weaveCompute(t, q)
	var complete []Path
	for _, p := range r.Paths {
		if !p.Guide && closedPath(p) {
			complete = append(complete, p)
		}
	}
	if len(complete) < 5 {
		t.Fatalf("fixture has only %d complete fibers", len(complete))
	}
	for i, a := range complete {
		for _, b := range complete[i+1:] {
			if lk := polygonLinking(a.Points, b.Points); math.Abs(math.Abs(lk)-1) > 1e-6 {
				t.Fatalf("%s %s link %v", a.Source, b.Source, lk)
			}
		}
	}
}

// The bowtie's vertices 1 and 4 are both the north pole: with 12 samples,
// samples 0 and 6 land there and share one drawn fiber, the xy circle,
// keeping the entered selection.
func TestGeodesicPolygonPoleVertexAliases(t *testing.T) {
	q := polygonRequest(bowtie, 12, 6)
	r := weaveCompute(t, q)
	c := r.Weave.Correspondence
	if len(c.Aliases) != 12 || c.Aliases[6] != 0 || c.Selected != 6 || c.MovingSample != 0 || !c.Coincident {
		t.Fatalf("aliases %v selected %d moving %d coincident %v", c.Aliases, c.Selected, c.MovingSample, c.Coincident)
	}
	if c.Base != (Vec3{0, 0, 1}) {
		t.Fatalf("pole vertex %v is not exact", c.Base)
	}
	if got := len(weavePaths(r, "fiber")); got != 11 {
		t.Fatalf("%d fibers drawn, want 11", got)
	}
	for _, p := range r.Paths {
		if p.Source == "weave/latitude/0/fiber/6" {
			t.Fatal("the repeated pole's fiber is drawn twice")
		}
	}
}

func TestGeodesicPolygonValidation(t *testing.T) {
	with := func(vs []PolygonVertex, change func([]PolygonVertex) []PolygonVertex) []PolygonVertex {
		return change(append([]PolygonVertex(nil), vs...))
	}
	set := func(k int, v PolygonVertex) func([]PolygonVertex) []PolygonVertex {
		return func(vs []PolygonVertex) []PolygonVertex { vs[k] = v; return vs }
	}
	thirteen := make([]PolygonVertex, 13)
	for k := range thirteen {
		thirteen[k] = PolygonVertex{2 * math.Pi * float64(k) / 13, .2}
	}
	for _, tc := range []struct {
		vs      []PolygonVertex
		field   string
		message string
	}{
		{nil, "weave.vertices", "a polygon has 3–12 vertices"},
		{octantTriangle[:2], "weave.vertices", "a polygon has 3–12 vertices"},
		{thirteen, "weave.vertices", "a polygon has 3–12 vertices"},
		{with(octantTriangle, set(1, PolygonVertex{math.NaN(), 0})), "weave.vertices.1.u", "vertex 2: u must be finite and within ±100000"},
		{with(octantTriangle, set(1, PolygonVertex{100001, 0})), "weave.vertices.1.u", "vertex 2: u must be finite and within ±100000"},
		{with(octantTriangle, set(2, PolygonVertex{0, math.Pi/2 + 1e-9})), "weave.vertices.2.v", "vertex 3: v is a latitude, within ±π/2"},
		{with(octantTriangle, set(0, PolygonVertex{0, math.Inf(-1)})), "weave.vertices.0.v", "vertex 1: v is a latitude, within ±π/2"},
		// Adjacent coincident or opposite vertices name the later one; the
		// closing side names vertex 1.
		{with(octantTriangle, set(2, PolygonVertex{math.Pi/2 + 5e-7, 0})), "weave.vertices.2.u",
			"vertices 2 and 3 coincide, so the side between them has no direction"},
		{with(octantTriangle, set(2, PolygonVertex{3 * math.Pi / 2, 0})), "weave.vertices.2.u",
			"vertices 2 and 3 lie opposite, so no single shortest arc joins them"},
		{with(octantTriangle, set(2, PolygonVertex{1e-7, 0})), "weave.vertices.0.u",
			"vertices 3 and 1 coincide, so the side between them has no direction"},
		{with(octantTriangle, set(2, PolygonVertex{math.Pi, 0})), "weave.vertices.0.u",
			"vertices 3 and 1 lie opposite, so no single shortest arc joins them"},
	} {
		_, err := Compute(polygonRequest(tc.vs, 12, 0))
		if fe, ok := err.(*FieldError); !ok || fe.Field != tc.field || fe.Message != tc.message {
			t.Errorf("%v: %v, want %s: %s", tc.vs, err, tc.field, tc.message)
		}
	}
	// Admitted: sides just inside the limits, nonadjacent coincidences and
	// opposites, pole vertices, rounding of ±π/2 and long longitudes.
	for _, vs := range [][]PolygonVertex{
		with(octantTriangle, set(2, PolygonVertex{math.Pi/2 + 2e-6, 0})),
		with(octantTriangle, set(2, PolygonVertex{3*math.Pi/2 - 2e-6, 0})),
		antipodalQuad, bowtie, southQuad,
		{{100000, math.Pi / 2}, {-100000, 0}, {1, -math.Pi / 2}, {2, 0}},
	} {
		weaveCompute(t, polygonRequest(vs, 12, 0))
	}
	q := polygonRequest(octantTriangle, 33, 0)
	if _, err := Compute(q); err == nil || err.(*FieldError).Message != "use 1–32 fibers on the polygon" {
		t.Errorf("polygon fiber count: %v", err)
	}
	q = pairedRequest(.6, 12, 0)
	q.Weave.Path = "arbitrary"
	if _, err := Compute(q); err == nil || err.(*FieldError).Message != "Base path must be Latitude, Spherical flower, Great circle, Spherical Lissajous or Geodesic polygon" {
		t.Errorf("unknown path: %v", err)
	}
	// Inactive fields: the polygon reads only its vertices, and no other
	// path reads them.
	nine, zero := 9, 0
	p := polygonRequest(southQuad, 12, 0)
	clean := weaveCompute(t, p)
	p.Weave.Alpha, p.Weave.AlphaFrom, p.Weave.Amplitude, p.Weave.Tilt = math.NaN(), math.Inf(1), math.NaN(), math.NaN()
	p.Weave.Petals, p.Weave.Azimuthal, p.Weave.Polar = &zero, &nine, &zero
	if !reflect.DeepEqual(weaveCompute(t, p), clean) {
		t.Fatal("inactive fields changed the polygon")
	}
	for _, path := range []string{"", "latitude", "flower", "great-circle", "lissajous"} {
		q := pairedRequest(.6, 12, 0)
		q.Weave.Path = path
		old := weaveCompute(t, q)
		q.Weave.Vertices = []PolygonVertex{{math.NaN(), 9}}
		if !reflect.DeepEqual(weaveCompute(t, q), old) {
			t.Fatalf("path %q: vertices changed the study", path)
		}
	}
}

// Twelve vertices whose corners all need inserting, at the largest counts.
func TestGeodesicPolygonLargestStudyWithinBudget(t *testing.T) {
	vs := make([]PolygonVertex, 12)
	for k := range vs {
		vs[k] = PolygonVertex{2*math.Pi*float64(k)/12 + .01*float64(k*k), .3 * math.Sin(float64(k))}
	}
	for _, samples := range []int{8, 256} {
		q := polygonRequest(vs, 32, 7)
		q.Samples = samples
		q.Weave.Trace = .0137
		r := weaveCompute(t, q)
		if got := len(weavePaths(*r.Companion, "base-curve")[0].Points); got != samples+12 {
			t.Fatalf("N=%d: %d base points, want %d", samples, got, samples+12)
		}
		bound := pairedWeavePoints(32, samples) + 11
		if r.Weave.Sources != 33 || r.Evaluations != r.EmittedPoints || r.EmittedPoints > bound || bound > 10357 {
			t.Fatalf("N=%d: %+v, points/evaluations %d/%d, bound %d", samples, r.Weave, r.EmittedPoints, r.Evaluations, bound)
		}
	}
}

// Only the polygon reports its side, so other paths keep their bytes.
func TestEarlierPathsOmitTheSide(t *testing.T) {
	for _, q := range []Request{pairedRequest(.6, 12, 0), greatCircleRequest(1, 12, 0), lissajousRequest(3, 2, 12, 0)} {
		data, _ := json.Marshal(weaveCompute(t, q))
		if strings.Contains(string(data), `"side"`) || strings.Contains(string(data), `"sides"`) {
			t.Fatalf("%q reports a side", q.Weave.Path)
		}
	}
	data, _ := json.Marshal(weaveCompute(t, polygonRequest(octantTriangle, 12, 0)))
	if !strings.Contains(string(data), `"side":0`) || !strings.Contains(string(data), `"sides":3`) {
		t.Fatal("the polygon must report its side and sides")
	}
}

// Each corner is inserted where it falls, unless an equal step is within
// 10⁻¹² of it, on either side.
func TestBaseCurveParametersInsertCorners(t *testing.T) {
	got := baseCurveParameters(2*math.Pi, 4, []float64{math.Pi/2 - 5e-13, 2, math.Pi + 5e-13, 5})
	want := []float64{0, math.Pi / 2, 2, math.Pi, 3 * math.Pi / 2, 5, 2 * math.Pi}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parameters %v, want %v", got, want)
	}
	got = baseCurveParameters(2*math.Pi, 4, []float64{math.Pi/2 - 2e-12})
	if len(got) != 6 || got[1] != math.Pi/2-2e-12 {
		t.Fatalf("a corner 2·10⁻¹² from a step is inserted: %v", got)
	}
}

// A parameter within 10⁻¹² of a corner is the exact vertex, beginning the
// departing side; 10⁻¹¹ away it is a point of the arriving side. A side's
// point within 2·10⁻¹² of a pole is the exact pole.
func TestGeodesicPolygonCornerAndPoleSnapDistance(t *testing.T) {
	e := newExpectedPolygon(southQuad)
	q := polygonRequest(southQuad, 7, 0)
	for _, tc := range []struct {
		offset float64
		snaps  bool
	}{{-5e-13, true}, {-1e-11, false}} {
		q.Weave.Trace = (e.corners[1] + tc.offset) / e.length
		c := weaveCompute(t, q).Weave.Correspondence
		if (c.Base == e.ps[1]) != tc.snaps || (*c.Side == 1) != tc.snaps {
			t.Fatalf("offset %v: base %v side %d, want snapped %v", tc.offset, c.Base, *c.Side, tc.snaps)
		}
	}
	// The first side runs over the north pole at its middle, t = π/6.
	over := []PolygonVertex{{0, math.Pi / 3}, {math.Pi, math.Pi / 3}, {math.Pi / 2, -math.Pi / 4}}
	e = newExpectedPolygon(over)
	q = polygonRequest(over, 7, 0)
	q.Weave.Trace = math.Pi / 6 / e.length
	if c := weaveCompute(t, q).Weave.Correspondence; c.Base != (Vec3{0, 0, 1}) {
		t.Fatalf("the side's pole is %v, not exact", c.Base)
	}
}

// The largest admitted polygon study: twelve vertices, each corner
// inserted, 32 fibers and 256 arc samples.
func BenchmarkGeodesicPolygonLargest(b *testing.B) {
	vs := make([]PolygonVertex, 12)
	for k := range vs {
		vs[k] = PolygonVertex{2*math.Pi*float64(k)/12 + .01*float64(k*k), .3 * math.Sin(float64(k))}
	}
	q := polygonRequest(vs, 32, 7)
	q.Samples, q.Clip, q.Weave.Trace = 256, 12, .0137
	b.ReportAllocs()
	for b.Loop() {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}
