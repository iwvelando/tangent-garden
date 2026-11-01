package engine4

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

// The base-sphere correspondence: a latitude on S², its sampled Hopf fibers
// and one moving fiber (docs/tesseracts.md, "Base sphere and fibers").

func pairedRequest(alpha float64, fibers, selected int) Request {
	return Request{Object: "weave", Mode: "paired", Curves: fibers, Samples: 64, Clip: 12,
		Weave: &WeaveParameters{Family: "fibers", Alpha: alpha, AlphaFrom: alpha, AlphaTo: alpha, Selected: selected}}
}

// The latitude's base point at phase δ, from docs/tesseracts.md, written
// out independently of the engine.
func expectedBasePoint(alpha, delta float64) Vec3 {
	return Vec3{math.Sin(2*alpha) * math.Cos(delta), math.Sin(2*alpha) * math.Sin(delta), math.Cos(2 * alpha)}
}

func dist3(a, b Vec3) float64 { d := sub(a, b); return math.Sqrt(dot(d, d)) }

// planeResidual is the distance of v from the plane through the origin
// spanned by the great circle through a, b (orthonormalized here).
func planeResidual(v, a, b Vec4) float64 {
	d4 := func(x, y Vec4) float64 { return x[0]*y[0] + x[1]*y[1] + x[2]*y[2] + x[3]*y[3] }
	na := norm4(a)
	for i := range a {
		a[i] /= na
	}
	k := d4(b, a)
	for i := range b {
		b[i] -= k * a[i]
	}
	nb := norm4(b)
	for i := range b {
		b[i] /= nb
	}
	ca, cb := d4(v, a), d4(v, b)
	var r Vec4
	for i := range r {
		r[i] = v[i] - ca*a[i] - cb*b[i]
	}
	return norm4(r)
}

// Exact linking number of two closed polygons: the sum of signed solid
// angles subtended by every pair of segments (Klenin and Langowski 2000),
// divided by 4π. For disjoint closed polygons it is an integer up to
// rounding, so it needs no convergence in the sample count. asin near ±1
// limits that rounding to about 10⁻⁹, so tests allow 10⁻⁶.
func polygonLinking(a, b []Vec3) float64 {
	unit := func(v Vec3) Vec3 { l := math.Sqrt(dot(v, v)); return Vec3{v[0] / l, v[1] / l, v[2] / l} }
	clamp := func(x float64) float64 { return math.Max(-1, math.Min(1, x)) }
	sum := 0.
	for i := 0; i+1 < len(a); i++ {
		r1, r2 := a[i], a[i+1]
		for j := 0; j+1 < len(b); j++ {
			r3, r4 := b[j], b[j+1]
			r13, r14, r23, r24 := sub(r3, r1), sub(r4, r1), sub(r3, r2), sub(r4, r2)
			n1, n2 := unit(cross(r13, r14)), unit(cross(r14, r24))
			n3, n4 := unit(cross(r24, r23)), unit(cross(r23, r13))
			omega := math.Asin(clamp(dot(n1, n2))) + math.Asin(clamp(dot(n2, n3))) +
				math.Asin(clamp(dot(n3, n4))) + math.Asin(clamp(dot(n4, n1)))
			if dot(cross(sub(r4, r3), sub(r2, r1)), r13) < 0 {
				omega = -omega
			}
			sum += omega
		}
	}
	return sum / (4 * math.Pi)
}

func TestHopfFiberChartsMapToTheirBasePoint(t *testing.T) {
	points := []Vec3{{0, 0, 1}, {0, 0, -1}, {1, 0, 0}, {0, -1, 0}}
	for _, z := range []float64{1 - 1e-15, 1 - 1e-9, .9, .5, 1e-300, 0, -1e-300, -.3, -.99, -1 + 1e-12, -1 + 1e-15} {
		for _, d := range []float64{0, .3, math.Pi / 2, 2.9, -math.Pi, 4.4} {
			r := math.Sqrt((1 - z) * (1 + z))
			points = append(points, Vec3{r * math.Cos(d), r * math.Sin(d), z})
		}
	}
	for _, p := range points {
		q, chart := hopfFiber(p)
		if math.Abs(norm4(q)-1) > 4e-16 {
			t.Fatalf("p %v: |q| = %.17g", p, norm4(q))
		}
		if d := dist3(hopfMap(q), p); d > 1e-15 {
			t.Fatalf("p %v (%s chart): H(q) = %v, off by %.3g", p, chart, hopfMap(q), d)
		}
		// The chosen chart keeps its real coordinate at least 1/√2.
		real := q[0]
		if chart == "south" {
			real = q[2]
		}
		if (chart == "north") != (p[2] >= 0) || real < math.Sqrt(.5)-1e-15 {
			t.Fatalf("p %v: chart %s with real coordinate %v", p, chart, real)
		}
		// Every point of the fiber maps to p too.
		for _, s := range []float64{.4, 2, 5} {
			c, sn := math.Cos(s), math.Sin(s)
			v := Vec4{c*q[0] - sn*q[1], sn*q[0] + c*q[1], c*q[2] - sn*q[3], sn*q[2] + c*q[3]}
			if d := dist3(hopfMap(v), p); d > 2e-15 {
				t.Fatalf("p %v: e^{is}q maps %.3g away", p, d)
			}
		}
	}
}

// Away from both poles each chart is defined, and the two representatives
// are the same fiber with t shifted by arg(x + iy): q_S = e^{iδ} q_N.
func TestHopfChartOverlapIsOneFiber(t *testing.T) {
	for _, z := range []float64{.8, .2, 0, -1e-9, -.4, -.8} {
		for _, d := range []float64{0, 1, 2.5, -2, 3.1} {
			r := math.Sqrt((1 - z) * (1 + z))
			p := Vec3{r * math.Cos(d), r * math.Sin(d), z}
			n, s := hopfChart(p, true), hopfChart(p, false)
			if math.Abs(norm4(n)-1) > 4e-16 || math.Abs(norm4(s)-1) > 4e-16 {
				t.Fatalf("p %v: representatives |q_N| %v, |q_S| %v", p, norm4(n), norm4(s))
			}
			c, sn := math.Cos(d), math.Sin(d)
			shifted := Vec4{c*n[0] - sn*n[1], sn*n[0] + c*n[1], c*n[2] - sn*n[3], sn*n[2] + c*n[3]}
			for i := range s {
				if math.Abs(shifted[i]-s[i]) > 4e-16 {
					t.Fatalf("p %v: e^{iδ}q_N = %v, q_S = %v", p, shifted, s)
				}
			}
			in := Vec4{-n[1], n[0], -n[3], n[2]}
			if planeResidual(s, n, in) > 4e-16 {
				t.Fatalf("p %v: the south representative leaves the north fiber", p)
			}
		}
	}
}

// Returned unrotated fiber points lie on S³ and map to their own base
// samples; the moving fiber maps to the moving point.
func TestPairedWeaveFibersMapToTheirBasePoints(t *testing.T) {
	for _, alpha := range []float64{.05, .3, .72, math.Pi / 4, 1.1, 1.5} {
		for _, trace := range []float64{0, .37, -.81} {
			q := pairedRequest(alpha, 12, 3)
			q.Weave.Trace = trace
			r := weaveCompute(t, q)
			c := r.Weave.Correspondence
			if r.Operation != "paired" || r.Companion == nil || c == nil || c.Fibers != 12 || c.Selected != 3 {
				t.Fatalf("α %v: operation %q, companion %v, correspondence %+v", alpha, r.Operation, r.Companion != nil, c)
			}
			f := trace - math.Floor(trace)
			moving := 2 * math.Pi * (3./12 + f)
			if math.Abs(math.Remainder(c.Parameter-moving, 2*math.Pi)) > 1e-14 || c.Parameter < 0 || c.Parameter >= 2*math.Pi {
				t.Fatalf("α %v trace %v: parameter %v, want %v", alpha, trace, c.Parameter, moving)
			}
			if dist3(c.Base, expectedBasePoint(alpha, moving)) > 1e-15 {
				t.Fatalf("α %v: moving base %v", alpha, c.Base)
			}
			seen := 0
			for _, p := range r.Paths {
				if p.Guide {
					continue
				}
				var want Vec3
				switch {
				case p.Role == "moving" && p.Source == "weave/moving":
					want = expectedBasePoint(alpha, moving)
				case p.Role == "fiber" && strings.HasPrefix(p.Source, "weave/latitude/0/fiber/"):
					var j int
					fmt.Sscanf(p.Source, "weave/latitude/0/fiber/%d", &j)
					want = expectedBasePoint(alpha, 2*math.Pi*float64(j)/12)
				default:
					t.Fatalf("unexpected path %s (%s)", p.Source, p.Role)
				}
				seen++
				for i, v := range p.FourPoints {
					if math.Abs(norm4(v)-1) > 1e-15 || dist3(hopfMap(v), want) > 2e-15 {
						t.Fatalf("α %v %s point %d: |q| %.17g, H(q) %v, want %v", alpha, p.Source, i, norm4(v), hopfMap(v), want)
					}
				}
			}
			want := 13
			if f == 0 {
				want = 12 // the moving fiber is the selected sample's
			}
			if seen != want {
				t.Fatalf("α %v trace %v: %d fibers, want %d", alpha, trace, seen, want)
			}
			if (f == 0) != (c.MovingSample == 3) || (f != 0 && c.MovingSample != -1) {
				t.Fatalf("trace %v: moving sample %d", trace, c.MovingSample)
			}
			// The base pane: the latitude, its samples, the moving point and
			// the globe guides, all on S²; markers carry the representative.
			b := r.Companion
			if b.Operation != "base" || b.Object != "weave" {
				t.Fatalf("companion %q %q", b.Object, b.Operation)
			}
			// The base pane draws the same selection and moving point.
			if b.Weave == nil || !reflect.DeepEqual(b.Weave.Correspondence, c) {
				t.Fatalf("companion correspondence %+v, want %+v", b.Weave, c)
			}
			curves := weavePaths(*b, "base-curve")
			if len(curves) != 1 || !closedPath(curves[0]) || len(curves[0].Points) != 65 || curves[0].SectionID != "weave/latitude/0" {
				t.Fatalf("α %v: base curve %+v", alpha, curves)
			}
			for i, v := range curves[0].Points {
				if dist3(v, expectedBasePoint(alpha, curves[0].Parameters[i])) > 1e-15 {
					t.Fatalf("base curve point %d off its latitude", i)
				}
			}
			samples := 0
			for _, m := range b.Markers {
				var want Vec3
				switch m.Role {
				case "sample":
					var j int
					fmt.Sscanf(m.ID, "weave/latitude/0/base/%d", &j)
					want = expectedBasePoint(alpha, 2*math.Pi*float64(j)/12)
					samples++
				case "moving":
					if m.ID != "weave/moving/base" || f == 0 {
						t.Fatalf("moving marker %s at trace %v", m.ID, trace)
					}
					want = expectedBasePoint(alpha, moving)
				default:
					t.Fatalf("marker %s role %s", m.ID, m.Role)
				}
				if dist3(m.Point, want) > 1e-15 || math.Abs(norm4(m.FourPoint)-1) > 1e-15 || dist3(hopfMap(m.FourPoint), want) > 2e-15 {
					t.Fatalf("marker %s: %v, representative %v", m.ID, m.Point, m.FourPoint)
				}
			}
			if samples != 12 || len(b.Markers) != want {
				t.Fatalf("%d samples, %d markers", samples, len(b.Markers))
			}
			for _, g := range weavePaths(*b, "globe") {
				for _, v := range g.Points {
					if math.Abs(math.Sqrt(dot(v, v))-1) > 1e-15 || !g.Guide {
						t.Fatalf("globe guide %s off S²", g.Source)
					}
				}
			}
		}
	}
}

// The paired bouquet's fibers and the ordinary weave's fibers at the same
// latitude are the same circles, with the same window classification, even
// where the chart gives the fiber another t origin.
func TestPairedWeaveMatchesTheOrdinaryLatitude(t *testing.T) {
	for _, alpha := range []float64{.2, .72, math.Pi / 4, 1.3} {
		for _, angles := range [][6]float64{{}, {0, .35, .2, 0, .4, .25}, {.3, .2, .1, 1.7, .5, 2.3}} {
			for _, clip := range []float64{2, 5, 12} {
				q := pairedRequest(alpha, 9, 0)
				q.Angles, q.Clip, q.Samples = angles, clip, 48
				o := weaveRequest("fibers", 1, 9, alpha, 0)
				o.Angles, o.Clip, o.Samples = angles, clip, 48
				pr, or := weaveCompute(t, q), weaveCompute(t, o)
				pw, ow := *pr.Weave, *or.Weave
				pw.Correspondence = nil
				if pw != ow || pr.Clipped != or.Clipped {
					t.Fatalf("α %v %v C %v: diagnostics %+v, ordinary %+v", alpha, angles, clip, pw, ow)
				}
				pf, of := weavePaths(pr, "fiber"), weavePaths(or, "fiber")
				if len(pf) != len(of) {
					t.Fatalf("%d paired fibers, %d ordinary", len(pf), len(of))
				}
				for i := range pf {
					a, b := pf[i], of[i]
					if a.Source != b.Source || closedPath(a) != closedPath(b) || a.SectionID != b.SectionID {
						t.Fatalf("%s / %s differ in identity or closure", a.Source, b.Source)
					}
					// The same great circle in 4D...
					for _, v := range a.FourPoints {
						if planeResidual(v, b.FourPoints[0], b.FourPoints[len(b.FourPoints)/3]) > 1e-14 {
							t.Fatalf("α %v %s: a paired point leaves the ordinary fiber's plane", alpha, a.Source)
						}
					}
					// ...retained between the same window crossings.
					if !closedPath(a) {
						if dist3(a.Points[0], b.Points[0]) > 1e-9*clip || dist3(a.Points[len(a.Points)-1], b.Points[len(b.Points)-1]) > 1e-9*clip {
							t.Fatalf("α %v %s: arc ends %v…%v, ordinary %v…%v", alpha, a.Source, a.Points[0], a.Points[len(a.Points)-1], b.Points[0], b.Points[len(b.Points)-1])
						}
					}
				}
			}
		}
	}
}

// Complete, disjoint projected fibers in safe views link once, with one
// orientation: the samples' fibers with each other and with the moving one.
func TestPairedWeaveCompleteFibersLinkOnce(t *testing.T) {
	for _, angles := range [][6]float64{{}, {.3, .1, 0, .2, 0, .4}, {0, .35, .2, 0, .4, .25}} {
		q := pairedRequest(.72, 5, 1)
		q.Angles, q.Samples, q.Weave.Trace = angles, 48, .1
		r := weaveCompute(t, q)
		if r.Weave.CompleteCircles != r.Weave.Sources || r.Weave.Sources != 6 {
			t.Fatalf("%v: fixture needs six complete circles, %+v", angles, r.Weave)
		}
		closed := []Path{}
		for _, p := range r.Paths {
			if !p.Guide {
				if !closedPath(p) {
					t.Fatalf("%s is not closed", p.Source)
				}
				closed = append(closed, p)
			}
		}
		sign := 0.
		for i := range closed {
			for j := i + 1; j < len(closed); j++ {
				lk := polygonLinking(closed[i].Points, closed[j].Points)
				if math.Abs(math.Abs(lk)-1) > 1e-6 {
					t.Fatalf("%v: %s and %s: Lk = %v", angles, closed[i].Source, closed[j].Source, lk)
				}
				if sign == 0 {
					sign = math.Copysign(1, lk)
				} else if math.Copysign(1, lk) != sign {
					t.Fatalf("%v: %s and %s link with the other orientation", angles, closed[i].Source, closed[j].Source)
				}
			}
		}
	}
	// The exact polygon formula agrees that unlinked circles do not link.
	q := weaveRequest("tori", 1, 2, math.Pi/4, 0)
	q.Samples = 48
	v := weavePaths(weaveCompute(t, q), "fixed-v")
	if lk := polygonLinking(v[0].Points, v[1].Points); math.Abs(lk) > 1e-6 {
		t.Fatalf("parallel torus circles: Lk = %v", lk)
	}
}

// As the moving point reaches a sample, its fiber is that sample's exactly,
// and a whole turn returns the drawing bit for bit.
func TestPairedWeaveTraceIsCoherentWithTheBouquet(t *testing.T) {
	q := pairedRequest(.6, 4, 0)
	q.Angles = [6]float64{0, .35, .2, 0, .4, .25}
	q.Clip = 3
	q.Weave.Trace = .25
	r := weaveCompute(t, q)
	var moving, sample Path
	for _, p := range r.Paths {
		if p.Source == "weave/moving" {
			moving = p
		}
		if p.Source == "weave/latitude/0/fiber/1" {
			sample = p
		}
	}
	if len(moving.Points) == 0 || len(moving.Points) != len(sample.Points) {
		t.Fatal("missing moving or sample fiber")
	}
	for i := range moving.Points {
		if moving.Points[i] != sample.Points[i] {
			t.Fatalf("point %d: moving %v, sample %v", i, moving.Points[i], sample.Points[i])
		}
	}
	at := func(trace float64) string {
		q := pairedRequest(.6, 7, 2)
		q.Angles = [6]float64{.3, .2, .1, 1.7, .5, 2.3}
		q.Weave.Trace = trace
		b, err := json.Marshal(weaveCompute(t, q))
		if err != nil {
			t.Fatal(err)
		}
		return string(b)
	}
	if at(0) != at(1) || at(0) != at(-3) || at(.25) != at(1.25) || at(.25) != at(-.75) {
		t.Fatal("whole turns of the moving point must return the same result")
	}
	if at(0) == at(.5) {
		t.Fatal("half a turn must move the point")
	}
}

// At a collapsed latitude every fiber is one circle and every sample one
// point: each is drawn once, and the selection is kept.
func TestPairedWeaveCollapsedLatitudeKeepsSelection(t *testing.T) {
	for _, alpha := range []float64{0, 1e-13, math.Pi/2 - 1e-13, math.Pi / 2} {
		q := pairedRequest(alpha, 8, 5)
		q.Weave.Trace = .3
		r := weaveCompute(t, q)
		c := r.Weave.Correspondence
		if !c.Coincident || c.Selected != 5 || c.MovingSample != 5 || r.Weave.Collapsed != 1 || r.Sections[0].Kind != "circle" {
			t.Fatalf("α %v: correspondence %+v, diagnostics %+v", alpha, c, r.Weave)
		}
		pole := Vec3{0, 0, 1}
		if alpha > 1 {
			pole = Vec3{0, 0, -1}
		}
		if c.Base != pole {
			t.Fatalf("α %v: base %v", alpha, c.Base)
		}
		fibers := []Path{}
		for _, p := range r.Paths {
			if !p.Guide {
				fibers = append(fibers, p)
			}
		}
		if len(fibers) != 1 || fibers[0].Source != "weave/latitude/0/core" || fibers[0].Role != "collapsed" {
			t.Fatalf("α %v: %d fibers, first %s", alpha, len(fibers), fibers[0].Source)
		}
		for _, v := range fibers[0].FourPoints {
			if dist3(hopfMap(v), pole) > 1e-15 {
				t.Fatalf("α %v: core point maps to %v", alpha, hopfMap(v))
			}
		}
		b := r.Companion
		if len(b.Markers) != 1 || b.Markers[0].ID != "weave/latitude/0/base/core" || b.Markers[0].Point != pole || len(weavePaths(*b, "base-curve")) != 0 {
			t.Fatalf("α %v: base markers %+v", alpha, b.Markers)
		}
	}
}

func TestPairedWeaveValidation(t *testing.T) {
	cases := []struct {
		name, field string
		change      func(*Request)
	}{
		{"too few fibers", "curves", func(q *Request) { q.Curves = 0 }},
		{"too many fibers", "curves", func(q *Request) { q.Curves = 33 }},
		{"negative selection", "weave.selected", func(q *Request) { q.Weave.Selected = -1 }},
		{"selection past the fibers", "weave.selected", func(q *Request) { q.Weave.Selected = 12 }},
		{"latitude", "weave.alpha", func(q *Request) { q.Weave.Alpha = 1.6 }},
		{"latitude end", "weave.alphaTo", func(q *Request) { q.Weave.AlphaTo = -.1 }},
		{"samples", "samples", func(q *Request) { q.Samples = 257 }},
		{"window", "clip", func(q *Request) { q.Clip = 1 }},
		{"angle", "angles.2", func(q *Request) { q.Angles[2] = math.NaN() }},
	}
	for _, c := range cases {
		q := pairedRequest(.7, 12, 3)
		c.change(&q)
		_, err := Compute(q)
		fe, ok := err.(*FieldError)
		if !ok || fe.Field != c.field {
			t.Errorf("%s: error %v, want field %s", c.name, err, c.field)
		}
	}
	// Playback alone sets the trace: its error is about the study.
	for _, trace := range []float64{math.Inf(1), math.NaN(), 2e6} {
		q := pairedRequest(.7, 12, 3)
		q.Weave.Trace = trace
		if _, err := Compute(q); err == nil || !strings.Contains(err.Error(), "traced point") {
			t.Errorf("trace %v: %v", trace, err)
		} else if _, named := err.(*FieldError); named {
			t.Errorf("trace %v names a field", trace)
		}
	}
	// One latitude: the latitude count, spread and family do not apply.
	q := pairedRequest(.7, 32, 31)
	q.Count, q.Weave.Spread, q.Weave.Family = 0, -5, "tori"
	r := weaveCompute(t, q)
	if r.Weave.Family != "fibers" || len(r.Sections) != 1 || r.Weave.Sources != 32 {
		t.Fatalf("diagnostics %+v, %d sections", r.Weave, len(r.Sections))
	}
}

// Points are decided from the counts before evaluation. The largest
// admitted correspondence, 32 fibers and 256 arc samples with every circle
// complete, emits exactly the counted points, well inside the ceiling.
func TestPairedWeaveLargestStudyWithinBudget(t *testing.T) {
	q := pairedRequest(.72, 32, 7)
	q.Samples, q.Weave.Trace = 256, .01
	if n := pairedWeavePoints(32, 256); n != 33*258+3*257+257+3*257+33 || n > maxPoints {
		t.Fatalf("budget %d", n)
	}
	r := weaveCompute(t, q)
	want := 33*257 + 3*257 + 257 + 3*257 + 33
	if r.Weave.CompleteCircles != 33 || r.EmittedPoints != want || r.Evaluations != want || r.Companion.EmittedPoints != 257+3*257+33 {
		t.Fatalf("%d points, %d evaluations, companion %d, %+v", r.EmittedPoints, r.Evaluations, r.Companion.EmittedPoints, r.Weave)
	}
}

func BenchmarkPairedWeaveLargest(b *testing.B) {
	q := pairedRequest(.72, 32, 7)
	q.Samples, q.Weave.Trace = 256, .01
	for i := 0; i < b.N; i++ {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}

// Go's ordinary JSON request path also proves omitted flower fields keep
// their old meaning. Unknown fields are deliberately ignored by the old
// engine, so these regressions fail behaviorally before the extension.
func flowerRequest(t *testing.T, alpha, amplitude float64, petals, n, selected int) Request {
	t.Helper()
	q := pairedRequest(alpha, n, selected)
	data, _ := json.Marshal(q)
	var raw map[string]any
	json.Unmarshal(data, &raw)
	w := raw["weave"].(map[string]any)
	w["path"], w["amplitude"], w["petals"] = "flower", amplitude, petals
	data, _ = json.Marshal(raw)
	if err := json.Unmarshal(data, &q); err != nil {
		t.Fatal(err)
	}
	return q
}

func TestHopfFlowerReturnedGeometry(t *testing.T) {
	for _, k := range []int{1, 5, 8} {
		for _, trace := range []float64{0, .137, -.137, .25 - 1e-10, .25 + 1e-10} {
			q := flowerRequest(t, math.Pi/4, math.Pi/8, k, 13, 3)
			q.Weave.Trace = trace
			r := weaveCompute(t, q)
			c := r.Weave.Correspondence
			wantAt := func(t float64) Vec3 { return expectedBasePoint(math.Pi/4+math.Pi/8*math.Cos(float64(k)*t), t) }
			if dist3(c.Base, wantAt(c.Parameter)) > 2e-15 {
				t.Fatalf("k=%d trace=%v: moving point %v is not on the flower", k, trace, c.Base)
			}
			curves := weavePaths(*r.Companion, "base-curve")
			if len(curves) != 1 || !closedPath(curves[0]) || len(curves[0].Points) < 16*k+1 {
				t.Fatalf("k=%d: missing or undersampled flower", k)
			}
			for i, p := range curves[0].Points {
				if math.Abs(math.Sqrt(dot(p, p))-1) > 1e-15 || dist3(p, wantAt(curves[0].Parameters[i])) > 3e-15 {
					t.Fatalf("k=%d base point %d off S² or flower", k, i)
				}
			}
			for _, m := range r.Companion.Markers {
				parameter := c.Parameter
				if m.Role == "sample" {
					var j int
					if _, err := fmt.Sscanf(m.ID, "weave/latitude/0/base/%d", &j); err != nil {
						t.Fatal(err)
					}
					parameter = 2 * math.Pi * float64(j) / 13
				}
				if dist3(m.Point, wantAt(parameter)) > 2e-15 || dist3(hopfMap(m.FourPoint), m.Point) > 2e-15 {
					t.Fatalf("marker %s off flower/fiber", m.ID)
				}
			}
			for _, p := range r.Paths {
				if p.Guide {
					continue
				}
				want := c.Base
				if p.Role == "fiber" {
					var j int
					fmt.Sscanf(p.Source, "weave/latitude/0/fiber/%d", &j)
					want = wantAt(2 * math.Pi * float64(j) / 13)
				}
				for _, v := range p.FourPoints {
					if math.Abs(norm4(v)-1) > 1e-15 || dist3(hopfMap(v), want) > 3e-15 {
						t.Fatalf("k=%d %s leaves its fiber", k, p.Source)
					}
				}
			}
		}
	}
}

func TestHopfFlowerZeroAmplitudeAndPeriodicTrace(t *testing.T) {
	for _, alpha := range []float64{0, .6, math.Pi / 2} {
		q := flowerRequest(t, alpha, 0, 5, 8, 3)
		q.Weave.Trace = .137
		r := weaveCompute(t, q)
		old := pairedRequest(alpha, 8, 3)
		old.Weave.Trace = .137
		latitude := weaveCompute(t, old)
		// Compare the whole returned geometry, identities and clipping;
		// flower-only provenance may extend its diagnostics.
		r.Weave.Correspondence = latitude.Weave.Correspondence
		r.Companion.Weave.Correspondence = latitude.Companion.Weave.Correspondence
		if !reflect.DeepEqual(r, latitude) {
			t.Fatalf("A=0 α=%v changed the latitude", alpha)
		}
	}
	q := flowerRequest(t, math.Pi/4, math.Pi/8, 5, 12, 7)
	q.Angles = [6]float64{.3, .2, .1, 1.7, .5, 2.3}
	q.Clip = 2
	at := func(trace float64) Result { q.Weave.Trace = trace; return weaveCompute(t, q) }
	if !reflect.DeepEqual(at(0), at(1)) || !reflect.DeepEqual(at(0), at(-1)) || !reflect.DeepEqual(at(.125), at(-.875)) {
		t.Fatal("flower endpoint/reversed traversal changed presentation")
	}
	q.Weave.Selected = 0
	q.Weave.Trace = .25
	r := weaveCompute(t, q)
	if r.Weave.Correspondence.MovingSample != 3 || len(weavePaths(r, "moving")) != 0 {
		t.Fatal("trace must reuse the frozen sample's fiber")
	}
}

func TestHopfFlowerPoleTouches(t *testing.T) {
	q := flowerRequest(t, math.Pi/4, math.Pi/4, 8, 32, 16)
	r := weaveCompute(t, q)
	// Eight north and eight south samples share two circles; the other
	// sixteen samples stay distinct. The base curve is still present.
	if r.Weave.Sources != 18 || len(r.Companion.Markers) != 18 || len(weavePaths(*r.Companion, "base-curve")) != 1 {
		t.Fatalf("coincident pole fibers drawn repeatedly: %+v, markers %d", r.Weave, len(r.Companion.Markers))
	}
	c := r.Weave.Correspondence
	if !c.Coincident || c.Selected != 16 || c.Base != (Vec3{0, 0, -1}) {
		t.Fatalf("lost selected pole provenance: %+v", c)
	}
	for _, trace := range []float64{0, .0625, -.0625, .03125} {
		q.Weave.Trace = trace
		r = weaveCompute(t, q)
		if r.Weave.Sources != 18 || r.Weave.Correspondence.MovingSample < 0 {
			t.Fatalf("pole/sample trace duplicates a fiber: %+v", r.Weave)
		}
	}
	// Near a pole is finite; it must not be treated as an arbitrary chart
	// discontinuity or be joined to another fiber.
	q.Weave.Trace = 1e-4
	r = weaveCompute(t, q)
	if r.Weave.Sources != 19 || r.Weave.Correspondence.MovingSample != -1 {
		t.Fatal("near-pole moving fiber was lost")
	}
}

// A pole touch entered as two constant expressions can round one ulp past
// the boundary (pi/15 + 13·pi/30 does, through the scalar parser). It is
// the same exact touch and reaches the pole through the 10⁻¹² snap; only a
// range genuinely beyond that snap is refused.
func TestHopfFlowerRoundedPoleTouches(t *testing.T) {
	tenth := .1 // at run time, 0.1 + 0.2 rounds above 0.3
	for _, tc := range []struct {
		name             string
		alpha, amplitude float64
		sample           int
		pole             Vec3
	}{
		// t = 0 reaches α₀ + A, the south pole.
		{"south", math.Pi / 3, math.Pi / 6, 0, Vec3{0, 0, -1}},
		// t = π/5 reaches α₀ − A, the north pole, with five petals.
		{"north", .3, tenth + .2, 1, Vec3{0, 0, 1}},
	} {
		if d := tc.alpha + tc.amplitude - math.Pi/2; tc.name == "south" && d <= 0 {
			t.Fatalf("fixture does not round past π/2: %g", d)
		}
		if d := tc.alpha - tc.amplitude; tc.name == "north" && d >= 0 {
			t.Fatalf("fixture does not round below 0: %g", d)
		}
		q := flowerRequest(t, tc.alpha, tc.amplitude, 5, 10, tc.sample)
		r, err := Compute(q)
		if err != nil {
			t.Fatalf("%s pole touch refused: %v", tc.name, err)
		}
		if c := r.Weave.Correspondence; c.Base != tc.pole || c.Selected != tc.sample {
			t.Fatalf("%s touch did not reach the pole: %+v", tc.name, c)
		}
	}
	// Each case crosses a single bound.
	for _, e := range []float64{1e-10, 1e-6} {
		for _, tc := range []struct {
			alpha, amplitude float64
			field            string
		}{
			{.1, .1 + e, "weave.amplitude"},             // below 0 only
			{math.Pi/2 - .1, .1 + e, "weave.amplitude"}, // above π/2 only
			{-e, 0, "weave.alpha"}, {math.Pi/2 + e, 0, "weave.alpha"},
		} {
			_, err := Compute(flowerRequest(t, tc.alpha, tc.amplitude, 5, 10, 0))
			if fe, ok := err.(*FieldError); !ok || fe.Field != tc.field {
				t.Fatalf("α=%v A=%v beyond the snap: %v, want %s", tc.alpha, tc.amplitude, err, tc.field)
			}
		}
	}
}

func TestHopfFlowerValidation(t *testing.T) {
	for _, tc := range []struct {
		key   string
		value any
		field string
	}{
		{"path", "arbitrary", "weave.path"}, {"amplitude", -.01, "weave.amplitude"}, {"amplitude", math.Pi/4 + .001, "weave.amplitude"},
		{"alpha", -.01, "weave.alpha"}, {"alpha", math.Pi/2 + .01, "weave.alpha"}, {"alpha", .1, "weave.amplitude"},
		{"alpha", 1.4, "weave.amplitude"},
		{"petals", 0, "weave.petals"}, {"petals", 9, "weave.petals"},
	} {
		q := flowerRequest(t, math.Pi/4, math.Pi/8, 5, 12, 0)
		b, _ := json.Marshal(q)
		var raw map[string]any
		json.Unmarshal(b, &raw)
		raw["weave"].(map[string]any)[tc.key] = tc.value
		b, _ = json.Marshal(raw)
		json.Unmarshal(b, &q)
		_, err := Compute(q)
		fe, ok := err.(*FieldError)
		if !ok || fe.Field != tc.field {
			t.Errorf("%s=%v: %v, want %s", tc.key, tc.value, err, tc.field)
		}
	}
}

func TestHopfFlowerDistinctCompleteFibersLinkOnce(t *testing.T) {
	q := flowerRequest(t, math.Pi/4, math.Pi/8, 5, 7, 1)
	q.Samples = 128
	q.Weave.Trace = .137
	r := weaveCompute(t, q)
	if r.Weave.CompleteCircles != 8 || r.Clipped != 0 {
		t.Fatalf("fixture must have 8 distinct complete fibers: %+v", r.Weave)
	}
	var paths []Path
	for _, p := range r.Paths {
		if !p.Guide {
			paths = append(paths, p)
		}
	}
	for i, a := range paths {
		for _, b := range paths[i+1:] {
			if !closedPath(a) || !closedPath(b) {
				t.Fatal("clipped fixture")
			}
			if lk := polygonLinking(a.Points, b.Points); math.Abs(math.Abs(lk)-1) > 1e-6 {
				t.Fatalf("%s %s: linking %v", a.Source, b.Source, lk)
			}
		}
	}
}

func TestHopfFlowerChartSeamAndClipping(t *testing.T) {
	for _, dt := range []float64{-1e-9, 1e-9} {
		// α crosses π/4 at t=π/10; approach the seam from both charts.
		q := flowerRequest(t, math.Pi/4, math.Pi/8, 5, 13, 0)
		q.Weave.Trace = .05 + dt
		q.Angles = [6]float64{.3, .2, .1, 1.7, .5, 2.3}
		q.Clip = 2
		r := weaveCompute(t, q)
		c := r.Weave.Correspondence
		if (c.Chart == "north") != (dt > 0) {
			t.Fatalf("seam chart: %+v", c)
		}
		if r.Weave.RetainedArcs == 0 {
			t.Fatal("fixture must exercise clipping")
		}
		moving := weavePaths(r, "moving")
		if len(moving) != 1 {
			t.Fatal("missing moving fiber at seam")
		}
		// The opposite overlapping chart spans the same returned, rotated
		// fiber. A gauge change cannot join it to another sample's circle.
		other := hopfChart(c.Base, c.Chart != "north")
		a := rotate(other, q.Angles)
		b := rotate(Vec4{-other[1], other[0], -other[3], other[2]}, q.Angles)
		for _, v := range moving[0].FourPoints {
			if planeResidual(v, a, b) > 2e-15 {
				t.Fatal("chart seam changed the circle set")
			}
		}
		for _, p := range r.Paths {
			if p.Guide {
				continue
			}
			for _, v := range p.Points {
				if !finite(v[0]) || !finite(v[1]) || !finite(v[2]) || math.Sqrt(dot(v, v)) > q.Clip+1e-11 {
					t.Fatal("nonfinite point or stray join past window")
				}
			}
			if !closedPath(p) {
				for _, v := range []Vec3{p.Points[0], p.Points[len(p.Points)-1]} {
					if math.Abs(math.Sqrt(dot(v, v))-q.Clip) > 1e-11 {
						t.Fatal("arc ends away from analytic window")
					}
				}
			}
		}
	}
}

func TestHopfFlowerSamplingBudgetsAndInactiveFields(t *testing.T) {
	defaults := flowerRequest(t, math.Pi/4, math.Pi/8, 5, 12, 3)
	explicit := weaveCompute(t, defaults)
	defaults.Weave.Petals = nil
	if !reflect.DeepEqual(weaveCompute(t, defaults), explicit) {
		t.Fatal("absent petal count must retain the authored five-petal path")
	}
	for _, samples := range []int{8, 256} {
		q := flowerRequest(t, math.Pi/4, math.Pi/8, 8, 32, 7)
		q.Samples = samples
		q.Weave.Trace = .0137
		r := weaveCompute(t, q)
		base := max(samples, 128)
		want := 33*(samples+1) + 6*(samples+1) + base + 1 + 33
		if r.Weave.Sources != 33 || r.EmittedPoints != want || r.Evaluations != want || r.EmittedPoints > maxPoints {
			t.Fatalf("N=%d: %+v, points/evaluations %d/%d want %d", samples, r.Weave, r.EmittedPoints, r.Evaluations, want)
		}
	}
	// Flower controls and incomplete latitude sweep endpoints belong only
	// to their own active paths. Neither may refuse an unrelated study.
	q := flowerRequest(t, math.Pi/4, math.Pi/8, 5, 12, 0)
	q.Weave.AlphaFrom, q.Weave.AlphaTo = math.NaN(), math.Inf(1)
	weaveCompute(t, q)
	q = pairedRequest(.6, 12, 0)
	q.Weave.Amplitude = math.NaN()
	q.Weave.Petals = new(int)
	r := weaveCompute(t, q)
	old := weaveCompute(t, pairedRequest(.6, 12, 0))
	if !reflect.DeepEqual(r, old) {
		t.Fatal("inactive flower fields changed the latitude")
	}
	q.Weave.Path = "latitude"
	if !reflect.DeepEqual(weaveCompute(t, q), old) {
		t.Fatal("explicit latitude path changed an older study")
	}
}
