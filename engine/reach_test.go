package engine

import (
	"encoding/json"
	"math"
	"testing"
)

// Framing by refined points: with AdaptiveFrame, each refined curve reports
// its reach, the points between samples that lie outside the box of their
// interval's two samples, refined to the study's own tolerance whatever the
// view. Expectations come from closed forms evaluated here.

// A needle between samples: y = exp(−((t − 0.01)/0.002)²) over [−1, 1]
// sampled every 0.02, so its peak of 1 lies midway between the samples at 0
// and 0.02, where the curve is below 10⁻¹⁰.
const needleX, needleY = "t", "exp(-((t-0.01)/0.002)^2)"

func needleRequest() Request {
	q := request("offset", needleX, needleY, -1, 1)
	q.Samples = 101
	q.Distance = 0.05
	return q
}

func framed(q Request) Request {
	q.Adaptive = true
	q.AdaptiveFrame = true
	return q
}

// outsideItsInterval is the points between samples of a refined path that
// lie outside the box of their interval's two samples, and their positions.
func outsideItsInterval(path *RefinedPath) ([]Vec, []float64) {
	samples := map[int]*Vec{}
	for k, u := range path.At {
		if u == math.Trunc(u) {
			samples[int(u)] = path.Points[k]
		}
	}
	var out []Vec
	var at []float64
	for k, p := range path.Points {
		u := path.At[k]
		if p == nil || u == math.Trunc(u) {
			continue
		}
		a, b := samples[int(math.Floor(u))], samples[int(math.Ceil(u))]
		if p.X < math.Min(a.X, b.X) || p.X > math.Max(a.X, b.X) || p.Y < math.Min(a.Y, b.Y) || p.Y > math.Max(a.Y, b.Y) {
			out, at = append(out, *p), append(at, u)
		}
	}
	return out, at
}

func highest(points []Vec) float64 {
	top := math.Inf(-1)
	for _, p := range points {
		top = math.Max(top, p.Y)
	}
	return top
}

func TestReachIsWhatRefinementAddsToTheExtent(t *testing.T) {
	q := needleRequest()
	r := compute(t, framed(q))
	base := r.Adaptive.Base
	top := math.Inf(-1)
	for _, p := range r.Base {
		if p != nil {
			top = math.Max(top, p.Y)
		}
	}
	if top > 1e-6 {
		t.Fatalf("a sample sees the needle: %g", top)
	}
	want, wantAt := outsideItsInterval(base)
	if len(want) == 0 || len(base.Reach) != len(want) || len(base.ReachAt) != len(want) {
		t.Fatalf("reach has %d points at %d positions, want the %d outside their intervals", len(base.Reach), len(base.ReachAt), len(want))
	}
	for k := range want {
		if base.Reach[k] != want[k] || base.ReachAt[k] != wantAt[k] {
			t.Fatalf("reach point %d is %v at %g, want %v at %g", k, base.Reach[k], base.ReachAt[k], want[k], wantAt[k])
		}
	}
	// On a coarsely sampled ellipse, the points between samples lie within
	// their interval's box except about its four vertices, and only those
	// reach beyond the samples.
	q64 := request("evolute", "2*cos(t)", "3*sin(t)", 0, 2*math.Pi)
	q64.Samples = 66
	ellipse := compute(t, framed(q64)).Adaptive.Base
	if outside, _ := outsideItsInterval(ellipse); len(ellipse.Reach) != len(outside) || len(outside) == 0 || 4*len(outside) > ellipse.Inserted {
		t.Fatalf("ellipse reach has %d points, want the %d of %d outside their intervals", len(ellipse.Reach), len(outside), ellipse.Inserted)
	}
	// The needle's peak, 1, to the study's tolerance.
	if h := highest(base.Reach); math.Abs(h-1) > 1.5*base.Tolerance {
		t.Fatalf("reach peaks at %g, want 1 within %g", h, 1.5*base.Tolerance)
	}
	// The offset's swallowtail over the needle is reached as well: its
	// points rise at least to the needle's peak less the distance.
	derived := r.Adaptive.Derived
	if outside, _ := outsideItsInterval(derived); len(derived.Reach) == 0 || len(derived.Reach) != len(outside) {
		t.Fatalf("derived reach has %d points, want %d", len(derived.Reach), len(outside))
	}
	if h := highest(derived.Reach); h < 1-q.Distance-1.5*derived.Tolerance {
		t.Fatalf("derived reach peaks at %g, below %g", h, 1-q.Distance)
	}
}

func TestReachIsOnlyAskedFor(t *testing.T) {
	q := needleRequest()
	plain := compute(t, adaptive(q))
	for _, path := range []*RefinedPath{plain.Adaptive.Base, plain.Adaptive.Derived} {
		if path.Reach != nil || path.ReachAt != nil {
			t.Fatal("reach without being asked")
		}
	}
	// It changes nothing else in the result, with or without a view.
	for _, v := range []*View{nil, {X0: -0.01, Y0: 0.9, X1: 0.03, Y1: 1.1}} {
		q.View = v
		without := compute(t, adaptive(q))
		with := compute(t, framed(q))
		for _, path := range []*RefinedPath{with.Adaptive.Base, with.Adaptive.Derived} {
			path.Reach, path.ReachAt = nil, nil
		}
		a, _ := json.Marshal(with)
		b, _ := json.Marshal(without)
		if string(a) != string(b) {
			t.Fatalf("reach changed the rest of the result with view %v", v)
		}
	}
	// A curve without refinement has none.
	if r := compute(t, func() Request { q := needleRequest(); q.AdaptiveFrame = true; return q }()); r.Adaptive != nil {
		t.Fatal("refined without being asked")
	}
}

// Zooming never moves the framing: under any view, each curve's reach is
// the study's own, though the curves drawn are refined to the view.
func TestReachDoesNotDependOnTheView(t *testing.T) {
	q := needleRequest()
	study := compute(t, framed(q))
	if len(study.Adaptive.Base.Reach) == 0 || len(study.Adaptive.Derived.Reach) == 0 {
		t.Fatal("the study reaches nothing")
	}
	reached := func(a *AdaptiveResult) string {
		s, _ := json.Marshal([]any{a.Base.Reach, a.Base.ReachAt, a.Derived.Reach, a.Derived.ReachAt})
		return string(s)
	}
	want := reached(study.Adaptive)
	for _, v := range []View{
		{X0: -0.002, Y0: 0.98, X1: 0.022, Y1: 1.02},
		{X0: 0.5, Y0: -0.01, X1: 0.6, Y1: 0.01},
		{X0: -0.05, Y0: -0.1, X1: 0.05, Y1: 1.1, Radius: 0.001},
	} {
		q.View = &v
		r := compute(t, framed(q))
		if r.Adaptive.Base.View == 0 {
			t.Fatalf("view %v refined nothing more finely", v)
		}
		if len(r.Adaptive.Base.Points) == len(study.Adaptive.Base.Points) {
			t.Fatalf("view %v drew the study's own refinement", v)
		}
		if reached(r.Adaptive) != want {
			t.Fatalf("view %v moved the reach", v)
		}
	}
}

// An offset stack's members and an inversion's image reach as well, and an
// inversion's breaks are the same with reach as without.
func TestReachOfFamiliesAndImages(t *testing.T) {
	q := needleRequest()
	q.Stack = Stack{Enabled: true, From: 0.01, To: 0.04, Count: 4}
	r := compute(t, framed(q))
	if len(r.Adaptive.Family) != 4 {
		t.Fatalf("%d refined members", len(r.Adaptive.Family))
	}
	for i, m := range r.Adaptive.Family {
		if outside, _ := outsideItsInterval(m); len(m.Reach) == 0 || len(m.Reach) != len(outside) {
			t.Fatalf("member %d reach has %d points, want %d", i, len(m.Reach), len(outside))
		}
	}
	inv := request("inversion", "t", "0.02", -1, 1)
	inv.Samples = 500
	inv.Inversion = Inversion{Center: Vec{0, 0}, Radius: 1}
	inv.View = &View{X0: -1, Y0: 20, X1: 1, Y1: 30}
	without := compute(t, adaptive(inv))
	with := compute(t, framed(inv))
	if a, b := with.Inversion.Breaks, without.Inversion.Breaks; len(a) != len(b) {
		t.Fatalf("breaks %v with reach, %v without", a, b)
	}
	if len(with.Adaptive.Derived.Reach) == 0 {
		t.Fatal("the image's peak between samples is not reached")
	}
}
