package engine4

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

// The great circle and spherical Lissajous base paths of Base sphere and
// fibers (docs/tesseracts.md, "Great circles and spherical Lissajous
// curves"). Expected points come from the documented formulas, written out
// here independently of the engine's path descriptors.

func greatCirclePoint(beta, t float64) Vec3 {
	return Vec3{math.Cos(t), math.Cos(beta) * math.Sin(t), math.Sin(beta) * math.Sin(t)}
}

func lissajousPoint(m1, m2 int, t float64) Vec3 {
	a, p := float64(m1)*t, float64(m2)*t
	return Vec3{math.Sin(p) * math.Cos(a), math.Sin(p) * math.Sin(a), math.Cos(p)}
}

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func greatCircleRequest(beta float64, n, selected int) Request {
	q := pairedRequest(math.Pi/4, n, selected)
	q.Weave.Path, q.Weave.Tilt = "great-circle", beta
	return q
}

func lissajousRequest(m1, m2, n, selected int) Request {
	q := pairedRequest(math.Pi/4, n, selected)
	q.Weave.Path, q.Weave.Azimuthal, q.Weave.Polar = "lissajous", &m1, &m2
	return q
}

// checkPathGeometry checks every returned base point, marker and unrotated
// fiber point of a paired study against the path formula at its own sample
// parameter Tj/n, and the moving point at its reported parameter.
func checkPathGeometry(t *testing.T, name string, r Result, angles [6]float64, n int, period float64, want func(float64) Vec3) {
	t.Helper()
	c := r.Weave.Correspondence
	if c.Parameter < 0 || c.Parameter >= period {
		t.Fatalf("%s: parameter %v outside [0, %v)", name, c.Parameter, period)
	}
	at := func(s float64) Vec3 {
		p := want(s)
		// The documented pole snap: horizontal distance within 2·10⁻¹².
		if math.Hypot(p[0], p[1]) <= 2e-12 {
			return Vec3{0, 0, math.Copysign(1, p[2])}
		}
		return p
	}
	if dist3(c.Base, at(c.Parameter)) > 3e-15 {
		t.Fatalf("%s: moving point %v is not on the path at %v", name, c.Base, c.Parameter)
	}
	curves := weavePaths(*r.Companion, "base-curve")
	if len(curves) != 1 || !closedPath(curves[0]) {
		t.Fatalf("%s: missing or open base curve", name)
	}
	ps := curves[0].Parameters
	if ps[0] != 0 || math.Abs(ps[len(ps)-1]-period) > 1e-15*period {
		t.Fatalf("%s: base curve spans [%v, %v], want one period %v", name, ps[0], ps[len(ps)-1], period)
	}
	for i, p := range curves[0].Points {
		if math.Abs(math.Sqrt(dot(p, p))-1) > 1e-15 || dist3(p, at(ps[i])) > 4e-15 {
			t.Fatalf("%s: base point %d off S² or the path", name, i)
		}
	}
	sampleOf := func(id, prefix string) float64 {
		var j int
		if _, err := fmt.Sscanf(id, prefix+"%d", &j); err != nil {
			t.Fatalf("%s: %s: %v", name, id, err)
		}
		return period * float64(j) / float64(n)
	}
	for _, m := range r.Companion.Markers {
		s := c.Parameter
		if m.Role == "sample" {
			s = sampleOf(m.ID, "weave/latitude/0/base/")
		}
		if dist3(m.Point, at(s)) > 3e-15 || math.Abs(norm4(m.FourPoint)-1) > 1e-15 || dist3(hopfMap(m.FourPoint), m.Point) > 3e-15 {
			t.Fatalf("%s: marker %s off the path or its fiber", name, m.ID)
		}
	}
	for _, p := range r.Paths {
		if p.Guide {
			continue
		}
		want := c.Base
		if p.Role == "fiber" {
			want = at(sampleOf(p.Source, "weave/latitude/0/fiber/"))
		}
		for _, v := range p.FourPoints {
			v = undoRotation(v, angles)
			if math.Abs(norm4(v)-1) > 1e-15 || dist3(hopfMap(v), want) > 4e-15 {
				t.Fatalf("%s: %s leaves its fiber", name, p.Source)
			}
		}
	}
}

func TestGreatCircleReturnedGeometry(t *testing.T) {
	for _, beta := range []float64{0, math.Pi / 5, math.Pi / 2, 2 * math.Pi / 3, math.Pi} {
		for _, trace := range []float64{0, .137, -.137, .25 - 1e-10, .25 + 1e-10} {
			q := greatCircleRequest(beta, 13, 3)
			q.Weave.Trace = trace
			q.Angles = [6]float64{.3, .2, .1, 1.7, .5, 2.3}
			r := weaveCompute(t, q)
			c := r.Weave.Correspondence
			if c.Path != "great-circle" || c.Period != 2*math.Pi || r.Sections[0].Kind != "great-circle" || r.Sections[0].Dimension != 1 {
				t.Fatalf("β=%v: provenance %+v %+v", beta, c, r.Sections[0])
			}
			checkPathGeometry(t, fmt.Sprintf("β=%v trace=%v", beta, trace), r, q.Angles, 13, 2*math.Pi,
				func(s float64) Vec3 { return greatCirclePoint(beta, s) })
			// A great circle has unit speed: its base curve uses the arc
			// samples, as the latitude does.
			if got := len(weavePaths(*r.Companion, "base-curve")[0].Points); got != q.Samples+1 {
				t.Fatalf("β=%v: %d base points, want %d", beta, got, q.Samples+1)
			}
		}
	}
}

// β = π/2 is a meridian through both poles: the poles snap exactly, their
// fibers are the xy and zw circles, and a chart change never joins or
// breaks a circle.
func TestGreatCirclePolesAndChartSeam(t *testing.T) {
	q := greatCircleRequest(math.Pi/2, 8, 2)
	r := weaveCompute(t, q)
	markers := map[string]Marker{}
	for _, m := range r.Companion.Markers {
		markers[m.ID] = m
	}
	if p := markers["weave/latitude/0/base/2"].Point; p != (Vec3{0, 0, 1}) {
		t.Fatalf("t = π/2 must be the exact north pole, got %v", p)
	}
	if p := markers["weave/latitude/0/base/6"].Point; p != (Vec3{0, 0, -1}) {
		t.Fatalf("t = 3π/2 must be the exact south pole, got %v", p)
	}
	if r.Weave.Sources != 8 || r.Weave.Correspondence.Aliases != nil {
		t.Fatalf("a great circle visits each pole once: %+v", r.Weave)
	}
	for _, tc := range []struct {
		j    int
		a, b Vec4
	}{{2, Vec4{1, 0, 0, 0}, Vec4{0, 1, 0, 0}}, {6, Vec4{0, 0, 1, 0}, Vec4{0, 0, 0, 1}}} {
		for _, p := range weavePaths(r, "fiber") {
			if p.Source != fmt.Sprintf("weave/latitude/0/fiber/%d", tc.j) {
				continue
			}
			for _, v := range p.FourPoints {
				if planeResidual(v, tc.a, tc.b) > 1e-15 {
					t.Fatalf("pole fiber %d is not its coordinate circle", tc.j)
				}
			}
		}
	}
	// p_z changes sign at t = 0 and t = π: the moving fiber on either side
	// of the seam spans the circle of the other chart's representative.
	for _, trace := range []float64{-1e-9, 1e-9, .5 - 1e-9, .5 + 1e-9} {
		q := greatCircleRequest(math.Pi/3, 8, 0)
		q.Weave.Trace = trace
		q.Angles = [6]float64{.3, .2, .1, 1.7, .5, 2.3}
		q.Clip = 2
		r := weaveCompute(t, q)
		c := r.Weave.Correspondence
		moving := weavePaths(r, "moving")
		if len(moving) != 1 {
			t.Fatalf("trace %v: missing moving fiber", trace)
		}
		other := hopfChart(c.Base, c.Chart != "north")
		a := rotate(other, q.Angles)
		b := rotate(Vec4{-other[1], other[0], -other[3], other[2]}, q.Angles)
		for _, v := range moving[0].FourPoints {
			if planeResidual(v, a, b) > 2e-15 {
				t.Fatalf("trace %v: chart seam changed the circle set", trace)
			}
		}
		if r.Weave.RetainedArcs == 0 {
			t.Fatal("fixture must exercise clipping")
		}
		checkClippedEnds(t, r, q.Clip)
	}
}

// checkClippedEnds requires finite points within the window and every open
// arc to end on the analytic window sphere |P| = C.
func checkClippedEnds(t *testing.T, r Result, clip float64) {
	t.Helper()
	for _, p := range r.Paths {
		if p.Guide {
			continue
		}
		for _, v := range p.Points {
			if !finite(v[0]) || !finite(v[1]) || !finite(v[2]) || math.Sqrt(dot(v, v)) > clip+1e-11 {
				t.Fatalf("%s: nonfinite point or stray join past the window", p.Source)
			}
		}
		if !closedPath(p) && len(p.Points) > 1 && p.Points[0] != p.Points[1] {
			for _, v := range []Vec3{p.Points[0], p.Points[len(p.Points)-1]} {
				if math.Abs(math.Sqrt(dot(v, v))-clip) > 1e-11 {
					t.Fatalf("%s: arc ends away from the analytic window", p.Source)
				}
			}
		}
	}
}

// At β = 0 the great circle is the equator, the latitude α = π/4, with the
// same parameter origin: the same fibers as sets and the same clipping.
func TestGreatCircleEquatorIsTheCliffordLatitude(t *testing.T) {
	q := greatCircleRequest(0, 12, 5)
	q.Angles = [6]float64{.3, .2, .1, 1.7, .5, 2.3}
	q.Clip = 2.5
	q.Weave.Trace = .137
	great := weaveCompute(t, q)
	old := pairedRequest(math.Pi/4, 12, 5)
	old.Angles, old.Clip, old.Weave.Trace = q.Angles, q.Clip, q.Weave.Trace
	latitude := weaveCompute(t, old)
	g, l := *great.Weave, *latitude.Weave
	g.Correspondence, l.Correspondence = nil, nil
	if g != l {
		t.Fatalf("equator classification differs: %+v vs %+v", g, l)
	}
	if dist3(great.Weave.Correspondence.Base, latitude.Weave.Correspondence.Base) > 1e-15 {
		t.Fatal("equator moving point differs from the latitude's")
	}
	byID := map[string]Path{}
	for _, p := range latitude.Paths {
		byID[p.Source] = p
	}
	for _, p := range great.Paths {
		o, ok := byID[p.Source]
		if !ok || len(p.FourPoints) != len(o.FourPoints) {
			t.Fatalf("%s: missing or differently clipped against the latitude", p.Source)
		}
		if p.Guide {
			continue
		}
		// The fiber through an unrotated point v is the circle of v and iv.
		a := undoRotation(o.FourPoints[0], q.Angles)
		b := Vec4{-a[1], a[0], -a[3], a[2]}
		for _, v := range p.FourPoints {
			if planeResidual(undoRotation(v, q.Angles), a, b) > 1e-14 {
				t.Fatalf("%s: not the latitude's fiber", p.Source)
			}
		}
	}
}

func TestSphericalLissajousReturnedGeometry(t *testing.T) {
	for _, m := range [][2]int{{1, 1}, {3, 2}, {2, 5}, {8, 7}, {2, 4}, {6, 3}, {8, 8}} {
		g := gcd(m[0], m[1])
		period := 2 * math.Pi / float64(g)
		for _, trace := range []float64{0, .137, -.137, .3 + 1e-10} {
			q := lissajousRequest(m[0], m[1], 13, 4)
			q.Weave.Trace = trace
			q.Angles = [6]float64{.3, .2, .1, 1.7, .5, 2.3}
			r := weaveCompute(t, q)
			c := r.Weave.Correspondence
			if c.Path != "lissajous" || c.Period != period || r.Sections[0].Kind != "lissajous" {
				t.Fatalf("m=%v: provenance %+v %+v", m, c, r.Sections[0])
			}
			name := fmt.Sprintf("m=%v trace=%v", m, trace)
			checkPathGeometry(t, name, r, q.Angles, 13, period, func(s float64) Vec3 { return lissajousPoint(m[0], m[1], s) })
			base := weavePaths(*r.Companion, "base-curve")[0]
			if want := max(q.Samples, 16*(m[0]+m[1])/g); len(base.Points) != want+1 {
				t.Fatalf("%s: %d base points, want %d", name, len(base.Points), want+1)
			}
		}
		// The period closes the formula exactly and is the least such
		// parameter: no proper fraction T/k returns every point.
		for k := 2; k <= 16; k++ {
			returns := true
			for s := .1; s < 6; s += .37 {
				if dist3(lissajousPoint(m[0], m[1], s+period/float64(k)), lissajousPoint(m[0], m[1], s)) > 1e-12 {
					returns = false
				}
			}
			if returns {
				t.Fatalf("m=%v: T/%d already closes the curve", m, k)
			}
		}
		for s := .1; s < 6; s += .37 {
			// Arguments reach about 100, where rounding is about 10⁻¹⁴.
			if dist3(lissajousPoint(m[0], m[1], s+period), lissajousPoint(m[0], m[1], s)) > 1e-12 {
				t.Fatalf("m=%v: T does not close the curve", m)
			}
		}
	}
	// A pair with a common factor traces the reduced pair's curve once.
	a, b := weaveCompute(t, lissajousRequest(2, 4, 12, 0)), weaveCompute(t, lissajousRequest(1, 2, 12, 0))
	for i := range a.Companion.Markers {
		if dist3(a.Companion.Markers[i].Point, b.Companion.Markers[i].Point) > 1e-15 {
			t.Fatal("(2, 4) must sample the (1, 2) curve at the same points")
		}
	}
}

// Every pole passage of a Lissajous curve visits the same pole: repeated
// exact poles share one fiber and keep the entered selection. A non-pole
// self-crossing (Viviani's curve at (0, 1, 0)) keeps both samples.
func TestSphericalLissajousPolesAndCrossings(t *testing.T) {
	// m = (1, 2), n = 8: t_j = πj/4, so cos 2t = 1 at j = 0, 4 and −1 at
	// j = 2, 6.
	q := lissajousRequest(1, 2, 8, 4)
	r := weaveCompute(t, q)
	c := r.Weave.Correspondence
	if want := []int{0, 1, 2, 3, 0, 5, 2, 7}; !reflect.DeepEqual(c.Aliases, want) {
		t.Fatalf("aliases %v, want %v", c.Aliases, want)
	}
	if r.Weave.Sources != 6 || len(r.Companion.Markers) != 6 {
		t.Fatalf("repeated pole fibers drawn twice: %+v", r.Weave)
	}
	if c.Selected != 4 || c.MovingSample != 0 || !c.Coincident || c.Base != (Vec3{0, 0, 1}) {
		t.Fatalf("lost the selected pole's provenance: %+v", c)
	}
	for _, trace := range []float64{.25, -.25, .125} {
		q.Weave.Trace = trace
		r = weaveCompute(t, q)
		if r.Weave.Sources != 6 || r.Weave.Correspondence.MovingSample < 0 {
			t.Fatalf("trace %v onto a sample duplicated a fiber: %+v", trace, r.Weave)
		}
	}
	q.Weave.Trace = 1e-4
	if r = weaveCompute(t, q); r.Weave.Sources != 7 || r.Weave.Correspondence.MovingSample != -1 {
		t.Fatal("near-pole moving fiber was lost")
	}
	// Viviani's curve, n = 4: t = π/2 and 3π/2 both reach (0, 1, 0).
	r = weaveCompute(t, lissajousRequest(1, 1, 4, 3))
	if r.Weave.Sources != 4 || r.Weave.Correspondence.Aliases != nil || r.Weave.Correspondence.Selected != 3 {
		t.Fatalf("a self-crossing must not merge samples: %+v %+v", r.Weave, r.Weave.Correspondence)
	}
	var crossing []Vec3
	for _, m := range r.Companion.Markers {
		if m.ID == "weave/latitude/0/base/1" || m.ID == "weave/latitude/0/base/3" {
			crossing = append(crossing, m.Point)
		}
	}
	if len(crossing) != 2 || dist3(crossing[0], Vec3{0, 1, 0}) > 1e-15 || dist3(crossing[1], Vec3{0, 1, 0}) > 1e-15 {
		t.Fatalf("Viviani crossing samples: %v", crossing)
	}
	// The preset's m = (2, 1) with 32 fibers crosses itself at
	// (0, ±√2/2, ±√2/2): samples 4 and 28, and 12 and 20, coincide there and
	// both stay drawn.
	r = weaveCompute(t, lissajousRequest(2, 1, 32, 0))
	if r.Weave.Sources != 32 || r.Weave.Correspondence.Aliases != nil {
		t.Fatalf("m = (2, 1) merged its self-crossings: %+v %+v", r.Weave, r.Weave.Correspondence)
	}
	at := map[string]Vec3{}
	for _, m := range r.Companion.Markers {
		at[m.ID] = m.Point
	}
	h := math.Sqrt2 / 2
	for _, pair := range []struct {
		i, j int
		want Vec3
	}{{4, 28, Vec3{0, h, h}}, {12, 20, Vec3{0, -h, -h}}} {
		a, b := at[fmt.Sprintf("weave/latitude/0/base/%d", pair.i)], at[fmt.Sprintf("weave/latitude/0/base/%d", pair.j)]
		if dist3(a, pair.want) > 1e-15 || dist3(b, pair.want) > 1e-15 {
			t.Fatalf("samples %d and %d: %v %v, want %v", pair.i, pair.j, a, b, pair.want)
		}
	}
}

// The path descriptors' derivatives, against central differences of the
// documented formulas, with the exact speeds and orientation.
func TestSpherePathDerivatives(t *testing.T) {
	type tc struct {
		name  string
		w     WeaveParameters
		point func(float64) Vec3
		speed func(float64) float64
	}
	m1, m2 := 3, 2
	cases := []tc{
		{"great circle", WeaveParameters{Path: "great-circle", Tilt: 1.1},
			func(s float64) Vec3 { return greatCirclePoint(1.1, s) }, func(float64) float64 { return 1 }},
		{"lissajous", WeaveParameters{Path: "lissajous", Azimuthal: &m1, Polar: &m2},
			func(s float64) Vec3 { return lissajousPoint(3, 2, s) },
			func(s float64) float64 { return math.Sqrt(4 + 9*math.Pow(math.Sin(2*s), 2)) }},
		{"latitude", WeaveParameters{Alpha: .6},
			func(s float64) Vec3 { return expectedBasePoint(.6, s) }, func(float64) float64 { return math.Sin(1.2) }},
		{"flower", WeaveParameters{Path: "flower", Alpha: math.Pi / 4, Amplitude: math.Pi / 8},
			func(s float64) Vec3 { return expectedBasePoint(math.Pi/4+math.Pi/8*math.Cos(5*s), s) }, nil},
	}
	for _, c := range cases {
		p := newSpherePath(c.w, 64)
		for s := .05; s < p.period; s += .29 {
			h := 1e-6
			a, b := c.point(s+h), c.point(s-h)
			fd := Vec3{(a[0] - b[0]) / (2 * h), (a[1] - b[1]) / (2 * h), (a[2] - b[2]) / (2 * h)}
			d := p.derivative(s)
			if dist3(d, fd) > 1e-8 {
				t.Fatalf("%s at %v: derivative %v, central difference %v", c.name, s, d, fd)
			}
			if math.Abs(dot(d, p.point(s))) > 1e-14 {
				t.Fatalf("%s: derivative leaves the tangent plane", c.name)
			}
			if c.speed != nil && math.Abs(math.Sqrt(dot(d, d))-c.speed(s)) > 1e-14 {
				t.Fatalf("%s at %v: speed %v, want %v", c.name, s, math.Sqrt(dot(d, d)), c.speed(s))
			}
		}
	}
	// Increasing t runs counterclockwise about the normal (0, −sin β, cos β).
	p := newSpherePath(WeaveParameters{Path: "great-circle", Tilt: 1.1}, 64)
	n := Vec3{0, -math.Sin(1.1), math.Cos(1.1)}
	for s := 0.; s < 2*math.Pi; s += .5 {
		if math.Abs(dot(cross(p.point(s), p.derivative(s)), n)-1) > 1e-15 {
			t.Fatal("great circle orientation")
		}
	}
}

func TestSpherePathPeriodicTraceAndLinking(t *testing.T) {
	for _, q := range []Request{greatCircleRequest(1.1, 12, 7), lissajousRequest(3, 2, 12, 7)} {
		q.Angles = [6]float64{.3, .2, .1, 1.7, .5, 2.3}
		q.Clip = 2
		at := func(trace float64) Result { q.Weave.Trace = trace; return weaveCompute(t, q) }
		if !reflect.DeepEqual(at(0), at(1)) || !reflect.DeepEqual(at(0), at(-1)) || !reflect.DeepEqual(at(.125), at(-.875)) {
			t.Fatalf("%s: whole turns or reversed traversal changed the presentation", q.Weave.Path)
		}
		q.Weave.Selected = 0
		if r := at(.25); r.Weave.Correspondence.MovingSample != 3 || len(weavePaths(r, "moving")) != 0 {
			t.Fatalf("%s: trace must reuse the frozen sample's fiber", q.Weave.Path)
		}
	}
	// Distinct complete fibers link once, by the independent polygon formula.
	for _, q := range []Request{greatCircleRequest(1.1, 7, 1), lissajousRequest(3, 2, 7, 1)} {
		q.Samples, q.Clip, q.Weave.Trace = 128, 12, .061
		r := weaveCompute(t, q)
		var complete []Path
		for _, p := range r.Paths {
			if !p.Guide && closedPath(p) {
				complete = append(complete, p)
			}
		}
		if len(complete) < 5 {
			t.Fatalf("%s: fixture has only %d complete fibers", q.Weave.Path, len(complete))
		}
		for i, a := range complete {
			for _, b := range complete[i+1:] {
				if lk := polygonLinking(a.Points, b.Points); math.Abs(math.Abs(lk)-1) > 1e-6 {
					t.Fatalf("%s: %s %s link %v", q.Weave.Path, a.Source, b.Source, lk)
				}
			}
		}
	}
}

func TestSpherePathValidationAndInactiveFields(t *testing.T) {
	nine, zero := 9, 0
	for _, tc := range []struct {
		q     Request
		field string
	}{
		{greatCircleRequest(-.01, 12, 0), "weave.tilt"},
		{greatCircleRequest(math.Pi+.01, 12, 0), "weave.tilt"},
		{greatCircleRequest(math.NaN(), 12, 0), "weave.tilt"},
		{lissajousRequest(0, 2, 12, 0), "weave.azimuthal"},
		{lissajousRequest(9, 2, 12, 0), "weave.azimuthal"},
		{lissajousRequest(3, 0, 12, 0), "weave.polar"},
		{lissajousRequest(3, 9, 12, 0), "weave.polar"},
		{greatCircleRequest(1, 33, 0), "curves"},
		{lissajousRequest(3, 2, 12, 12), "weave.selected"},
	} {
		_, err := Compute(tc.q)
		if fe, ok := err.(*FieldError); !ok || fe.Field != tc.field {
			t.Errorf("%+v: %v, want %s", *tc.q.Weave, err, tc.field)
		}
	}
	_, err := Compute(greatCircleRequest(1, 0, 0))
	if fe, ok := err.(*FieldError); !ok || fe.Message != "use 1–32 fibers on the great circle" {
		t.Errorf("great circle fiber count: %v", err)
	}
	q := lissajousRequest(3, 2, 0, 0)
	if _, err := Compute(q); err == nil || err.(*FieldError).Message != "use 1–32 fibers on the Lissajous curve" {
		t.Errorf("Lissajous fiber count: %v", err)
	}
	q = pairedRequest(.6, 12, 0)
	q.Weave.Path = "arbitrary"
	if _, err := Compute(q); err == nil || err.(*FieldError).Message != "Base path must be Latitude, Spherical flower, Great circle or Spherical Lissajous" {
		t.Errorf("unknown path: %v", err)
	}
	// Rounding at the tilt's ends is accepted.
	weaveCompute(t, greatCircleRequest(math.Pi+1e-13, 12, 0))
	weaveCompute(t, greatCircleRequest(-1e-13, 12, 0))
	// Inactive fields: each path validates only its own.
	g := greatCircleRequest(1, 12, 0)
	g.Weave.Alpha, g.Weave.AlphaFrom, g.Weave.AlphaTo, g.Weave.Amplitude = math.NaN(), math.NaN(), math.Inf(1), math.NaN()
	g.Weave.Petals, g.Weave.Azimuthal, g.Weave.Polar = &zero, &nine, &zero
	clean := weaveCompute(t, greatCircleRequest(1, 12, 0))
	if !reflect.DeepEqual(weaveCompute(t, g), clean) {
		t.Fatal("inactive fields changed the great circle")
	}
	l := lissajousRequest(3, 2, 12, 0)
	l.Weave.Alpha, l.Weave.Tilt, l.Weave.Petals = math.NaN(), math.NaN(), &nine
	weaveCompute(t, l)
	for _, path := range []string{"", "latitude", "flower"} {
		q := pairedRequest(.6, 12, 0)
		q.Weave.Path = path
		old := weaveCompute(t, q)
		q.Weave.Tilt, q.Weave.Azimuthal, q.Weave.Polar = math.NaN(), &nine, &zero
		if !reflect.DeepEqual(weaveCompute(t, q), old) {
			t.Fatalf("path %q: new-path fields changed the study", path)
		}
	}
	// Absent frequencies take the documented defaults.
	l = lissajousRequest(defaultAzimuthal, defaultPolar, 12, 3)
	explicit := weaveCompute(t, l)
	l.Weave.Azimuthal, l.Weave.Polar = nil, nil
	if !reflect.DeepEqual(weaveCompute(t, l), explicit) {
		t.Fatal("absent frequencies must use the defaults")
	}
}

func TestSpherePathLargestStudyWithinBudget(t *testing.T) {
	for _, samples := range []int{8, 256} {
		q := lissajousRequest(8, 7, 32, 7)
		q.Samples = samples
		q.Weave.Trace = .0137
		r := weaveCompute(t, q)
		base := max(samples, 240)
		if got := len(weavePaths(*r.Companion, "base-curve")[0].Points); got != base+1 {
			t.Fatalf("N=%d: %d base points, want %d", samples, got, base+1)
		}
		bound := pairedWeavePoints(32, samples) + base - samples
		if r.Weave.Sources != 33 || r.Evaluations != r.EmittedPoints || r.EmittedPoints > bound || bound > 10346 {
			t.Fatalf("N=%d: %+v, points/evaluations %d/%d, bound %d", samples, r.Weave, r.EmittedPoints, r.Evaluations, bound)
		}
	}
}

// The pole snap is 2·10⁻¹² in horizontal distance, no wider: just outside
// it the moving point keeps its own fiber, just inside it is the pole and
// so the sample there.
func TestSpherePathPoleSnapDistance(t *testing.T) {
	for _, tc := range []struct {
		trace float64 // turns past sample 1, t = π/2: 2π·trace from the pole
		snaps bool
	}{{1e-10, false}, {1e-12, false}, {1e-13, true}} {
		q := greatCircleRequest(math.Pi/2, 4, 1)
		q.Weave.Trace = tc.trace
		c := weaveCompute(t, q).Weave.Correspondence
		if (c.Base == Vec3{0, 0, 1}) != tc.snaps || (c.MovingSample == 1) != tc.snaps {
			t.Fatalf("trace %v: %+v, want snapped %v", tc.trace, c, tc.snaps)
		}
	}
}

// The latitude and flower keep their results' bytes: no period field.
func TestEarlierPathsOmitThePeriod(t *testing.T) {
	for _, q := range []Request{pairedRequest(.6, 12, 0), flowerRequest(t, math.Pi/4, math.Pi/8, 5, 12, 0)} {
		r := weaveCompute(t, q)
		data, _ := json.Marshal(r)
		if strings.Contains(string(data), `"period"`) {
			t.Fatalf("%q reports a period", q.Weave.Path)
		}
	}
	data, _ := json.Marshal(weaveCompute(t, greatCircleRequest(1, 12, 0)))
	if !strings.Contains(string(data), `"period":6.283185307179586`) {
		t.Fatal("the great circle must report its period")
	}
}

// The longest admitted base curve: m = (8, 7), 32 fibers, 256 arc samples.
func BenchmarkSpherePathLargest(b *testing.B) {
	q := lissajousRequest(8, 7, 32, 7)
	q.Samples, q.Clip, q.Weave.Trace = 256, 12, .0137
	b.ReportAllocs()
	for b.Loop() {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}
