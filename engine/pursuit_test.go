package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func pursuitRequest(p Pursuit, lo, hi float64) Request {
	q := request("offset", "", "", lo, hi)
	q.Curve = Curve{Format: "pursuit", Pursuit: p, Min: lo, Max: hi}
	return q
}

func pursuit(t *testing.T, q Request) *PursuitResult {
	t.Helper()
	r := compute(t, q)
	if r.Pursuit == nil {
		t.Fatal("no pursuit result")
	}
	return r.Pursuit
}

// polygon places n pursuers of speed v counterclockwise on a circle of radius
// r0 about center, the first at angle alpha.
func polygon(n int, center Vec, r0, alpha, v float64) []Pursuer {
	out := make([]Pursuer, n)
	for j := range out {
		a := alpha + 2*math.Pi*float64(j)/float64(n)
		out[j] = Pursuer{X: center.X + r0*math.Cos(a), Y: center.Y + r0*math.Sin(a), Speed: v}
	}
	return out
}

// regular is the exact equal-speed chase from a regular polygon: each pursuer
// moves inward at v sin(π/n) and turns at v cos(π/n) / r, so r(t) = r0 −
// v sin(π/n) t and θ = θ0 + cot(π/n) ln(r0/r), the logarithmic spiral
// r = r0 exp(−tan(π/n)(θ − θ0)).
func regular(n, j int, center Vec, r0, alpha, v, t float64) Vec {
	s := math.Pi / float64(n)
	r := r0 - v*math.Sin(s)*t
	theta := alpha + 2*math.Pi*float64(j)/float64(n) + math.Cos(s)/math.Sin(s)*math.Log(r0/r)
	return center.Add(Vec{math.Cos(theta), math.Sin(theta)}.Mul(r))
}

func TestPursuitRegularPolygon(t *testing.T) {
	center := Vec{.3, -.2}
	for _, n := range []int{2, 3, 4, 7, 16} {
		r0, alpha, v, eps := 1.5, .4, 1.2, 1e-3
		s := math.Sin(math.Pi / float64(n))
		// The gap between neighbors is 2r sin(π/n), so the chase stops when
		// r falls to ε / (2 sin(π/n)).
		capture := (r0 - eps/(2*s)) / (v * s)
		hi := capture * 1.05
		q := pursuitRequest(Pursuit{Pursuers: polygon(n, center, r0, alpha, v), Capture: eps}, 0, hi)
		q.Samples, q.Lines = 2001, 41
		res := pursuit(t, q)
		if res.Capture == nil || math.Abs(res.Capture.Time-capture) > 1e-9 {
			t.Fatalf("n=%d: capture %+v, want time %v", n, res.Capture, capture)
		}
		if c := res.Capture; c.Target != (c.Pursuer+1)%n || res.End != c.Time || res.Exhausted {
			t.Fatalf("n=%d: capture %+v end %v exhausted %v", n, c, res.End, res.Exhausted)
		}
		if len(res.Paths) != n {
			t.Fatalf("n=%d: %d paths", n, len(res.Paths))
		}
		step := hi / float64(q.Samples-1)
		for j, path := range res.Paths {
			for k, p := range path {
				tk := float64(k) * step
				if tk > capture {
					if p != nil {
						t.Fatalf("n=%d pursuer %d: sample %d at t=%v is after the capture", n, j, k, tk)
					}
					continue
				}
				want := regular(n, j, center, r0, alpha, v, tk)
				if p == nil || p.Sub(want).Norm() > 1e-9 {
					t.Fatalf("n=%d pursuer %d t=%v: got %v want %v", n, j, tk, p, want)
				}
			}
		}
		// The connecting polygons stay regular and shrink linearly.
		if len(res.Polygons) == 0 {
			t.Fatalf("n=%d: no polygons", n)
		}
		for _, poly := range res.Polygons {
			tk := float64(poly.SampleIndex) * step
			side := 2 * (r0 - v*s*tk) * s
			for j, p := range poly.Points {
				got := poly.Points[(j+1)%n].Sub(p).Norm()
				if math.Abs(got-side) > 1e-9 {
					t.Fatalf("n=%d t=%v: side %d is %v, want %v", n, tk, j, got, side)
				}
			}
		}
		if last := res.Polygons[len(res.Polygons)-1]; float64(last.SampleIndex)*step > capture {
			t.Fatalf("n=%d: a polygon after the capture", n)
		}
	}
}

// The first pursuer's path is the base curve, so constructions apply to it.
// The evolute of a logarithmic spiral about its pole c is the same spiral,
// scaled: the center of curvature E has E − c ⊥ P − c and |E − c| =
// |P − c| tan(π/n) for r = r0 exp(−tan(π/n)θ).
func TestPursuitEvoluteOfTheSpiral(t *testing.T) {
	center := Vec{-.5, 1}
	n := 7
	q := pursuitRequest(Pursuit{Pursuers: polygon(n, center, 1, 0, 1), Capture: 1e-3}, 0, 2)
	q.Kind = "evolute"
	r := compute(t, q)
	k := math.Tan(math.Pi / float64(n))
	checked := 0
	for j, e := range r.Derived {
		p := r.Base[j]
		if e == nil || p == nil {
			continue
		}
		checked++
		a, b := p.Sub(center), e.Sub(center)
		if math.Abs(a.Dot(b)) > 1e-6*a.Norm()*b.Norm() || math.Abs(b.Norm()-a.Norm()*k) > 1e-6*a.Norm() {
			t.Fatalf("sample %d: P %v E %v", j, p, e)
		}
	}
	if checked < 450 {
		t.Fatalf("only %d evolute samples", checked)
	}
}

func TestPursuitStationaryTarget(t *testing.T) {
	// A pursuer runs straight at a target that stands still.
	eps := .01
	p := Pursuit{Pursuers: []Pursuer{{0, 0, 2}, {3, 4, 0}}, Capture: eps}
	res := pursuit(t, pursuitRequest(p, 1, 5))
	if c := res.Capture; c == nil || c.Pursuer != 0 || c.Target != 1 || math.Abs(c.Time-(1+(5-eps)/2)) > 1e-12 {
		t.Fatalf("capture %+v", res.Capture)
	}
	for k, q := range res.Paths[0] {
		tk := 1 + 4*float64(k)/500
		if tk > res.End {
			break
		}
		closeVec(t, q, Vec{.6, .8}.Mul(2*(tk-1)), 1e-12)
		closeVec(t, res.Paths[1][k], Vec{3, 4}, 0)
	}
}

func TestPursuitMutualChase(t *testing.T) {
	// Two pursuers chase each other along the line between them, closing at
	// the sum of their speeds. Both gaps are equal; the first is reported.
	p := Pursuit{Pursuers: []Pursuer{{-1, 0, 1}, {2, 0, 2}}, Capture: .5}
	res := pursuit(t, pursuitRequest(p, 0, 2))
	if c := res.Capture; c == nil || c.Pursuer != 0 || c.Target != 1 || math.Abs(c.Time-2.5/3) > 1e-12 {
		t.Fatalf("capture %+v", res.Capture)
	}
	f := generated(t, Curve{Format: "pursuit", Pursuit: p})
	if got := f(.5); math.Abs(got.X+.5) > 1e-12 || got.Y != 0 {
		t.Fatalf("f(.5) = %v", got)
	}
	if got := f(.9); got.Valid() {
		t.Fatalf("f(.9) = %v after the capture", got)
	}
}

// A runner passes close by a pursuer that stands still, whose gap dips below
// ε only briefly: a step that straddled the dip would miss the capture.
func TestPursuitCaptureInPassing(t *testing.T) {
	eps, miss := .01, .005
	p := Pursuit{Pursuers: []Pursuer{{0, 0, 0}, {-5, miss, 10}, {1e4, miss, 0}}, Capture: eps}
	res := pursuit(t, pursuitRequest(p, 0, 1))
	want := (5 - math.Sqrt(eps*eps-miss*miss)) / 10
	if c := res.Capture; c == nil || c.Pursuer != 0 || c.Target != 1 || math.Abs(c.Time-want) > 1e-12 {
		t.Fatalf("capture %+v, want time %v", res.Capture, want)
	}
}

// A chase scaled by λ in space is the same chase scaled by λ in time, down to
// the smallest gaps: the error control follows the gaps, not the coordinates.
func TestPursuitScaleInvariance(t *testing.T) {
	base := newChase(unequal, 0, 3, chaseTolerance)
	for _, scale := range []float64{1e-4, 1e3} {
		p := Pursuit{Capture: unequal.Capture * scale}
		for _, q := range unequal.Pursuers {
			p.Pursuers = append(p.Pursuers, Pursuer{q.X * scale, q.Y * scale, q.Speed})
		}
		c := newChase(p, 0, 3*scale, chaseTolerance)
		if math.Abs(c.end/scale-base.end) > 1e-10 {
			t.Fatalf("λ=%g: capture at %v, want %v", scale, c.end/scale, base.end)
		}
		for tk := 0.; tk < base.end; tk += base.end / 40 {
			x, _ := base.at(tk)
			y, _ := c.at(tk * scale)
			for i := range x {
				if d := y[i].Mul(1 / scale).Sub(x[i]).Norm(); d > 1e-10 {
					t.Fatalf("λ=%g t=%v pursuer %d: off by %g", scale, tk, i, d)
				}
			}
		}
	}
}

// unequal is a chase with unequal speeds from an irregular start, where one
// pursuer catches its target long before the others close in.
var unequal = Pursuit{Pursuers: []Pursuer{{1, 0, 1}, {.2, 1.3, 1.6}, {-1.2, .1, .7}, {-.3, -1.1, 1}, {.9, -.9, 1.2}}, Capture: .02}

// Every pursuer heads straight at its target, at its own speed.
func TestPursuitDirections(t *testing.T) {
	c := newChase(unequal, 0, 3, chaseTolerance)
	if c.capture == nil {
		t.Fatal("no capture")
	}
	n := len(unequal.Pursuers)
	const h = 1e-5
	for tk := .01; tk < c.end-2*h; tk += c.end / 37 {
		now, ok := c.at(tk)
		before, ok1 := c.at(tk - h)
		after, ok2 := c.at(tk + h)
		if !ok || !ok1 || !ok2 {
			t.Fatalf("t=%v: missing state", tk)
		}
		for i := range now {
			v := after[i].Sub(before[i]).Mul(1 / (2 * h))
			want := now[(i+1)%n].Sub(now[i]).Unit().Mul(unequal.Pursuers[i].Speed)
			if v.Sub(want).Norm() > 1e-7 {
				t.Fatalf("t=%v pursuer %d: velocity %v want %v", tk, i, v, want)
			}
		}
	}
	// The capture is the moment the closest pair is exactly ε apart.
	end, _ := c.at(c.end)
	cp := c.capture
	if cp.Target != (cp.Pursuer+1)%n || math.Abs(end[cp.Target].Sub(end[cp.Pursuer]).Norm()-unequal.Capture) > 1e-12 {
		t.Fatalf("capture %+v at %v", cp, end)
	}
	for i := range end {
		if end[(i+1)%n].Sub(end[i]).Norm() < unequal.Capture-1e-12 {
			t.Fatalf("pursuer %d is closer than ε at the capture", i)
		}
	}
	if _, ok := c.at(c.end + 1e-9); ok {
		t.Fatal("a state after the capture")
	}
	if _, ok := c.at(-1e-9); ok {
		t.Fatal("a state before the start")
	}
}

// Halving the tolerance converges: the states agree ever more closely.
func TestPursuitStepRefinement(t *testing.T) {
	loose := newChase(unequal, 0, 3, 1e-6)
	mid := newChase(unequal, 0, 3, 1e-9)
	tight := newChase(unequal, 0, 3, 1e-12)
	if math.Abs(loose.end-tight.end) > 1e-4 || math.Abs(mid.end-tight.end) > 1e-7 {
		t.Fatalf("capture times %v %v %v", loose.end, mid.end, tight.end)
	}
	worst := func(a *chase) float64 {
		d := 0.0
		for tk := 0.; tk < tight.end*.999; tk += tight.end / 50 {
			x, _ := a.at(tk)
			y, _ := tight.at(tk)
			for i := range x {
				d = math.Max(d, x[i].Sub(y[i]).Norm())
			}
		}
		return d
	}
	if l, m := worst(loose), worst(mid); m > 1e-7 || m > l/100 {
		t.Fatalf("differences %v then %v", l, m)
	}
	if tight.steps() < mid.steps() || mid.steps() < loose.steps() {
		t.Fatalf("steps %d %d %d", loose.steps(), mid.steps(), tight.steps())
	}
}

func TestPursuitCaptureAtStart(t *testing.T) {
	p := Pursuit{Pursuers: []Pursuer{{0, 0, 1}, {1, 1, 1}, {1, 1.005, 1}}, Capture: .01}
	res := pursuit(t, pursuitRequest(p, -1, 1))
	if c := res.Capture; c == nil || c.Time != -1 || c.Pursuer != 1 || c.Target != 2 || res.End != -1 {
		t.Fatalf("capture %+v end %v", res.Capture, res.End)
	}
	for j, path := range res.Paths {
		closeVec(t, path[0], Vec{p.Pursuers[j].X, p.Pursuers[j].Y}, 0)
		for _, q := range path[1:] {
			if q != nil {
				t.Fatalf("pursuer %d moves after the capture", j)
			}
		}
	}
	if len(res.Polygons) != 1 || res.Polygons[0].SampleIndex != 0 {
		t.Fatalf("polygons %+v", res.Polygons)
	}
}

func TestPursuitNoCapture(t *testing.T) {
	// Nothing moves: no capture, and the chase is known to the domain end.
	still := Pursuit{Pursuers: polygon(3, Vec{}, 1, 0, 0), Capture: .1}
	res := pursuit(t, pursuitRequest(still, 0, 1e4))
	if res.Capture != nil || res.Exhausted || res.End != 1e4 {
		t.Fatalf("%+v", res)
	}
	for _, p := range res.Paths[2] {
		closeVec(t, p, Vec{math.Cos(4 * math.Pi / 3), math.Sin(4 * math.Pi / 3)}, 1e-15)
	}
	// A chase that ends after the domain.
	res = pursuit(t, pursuitRequest(Pursuit{Pursuers: polygon(4, Vec{}, 1, 0, 1), Capture: .1}, 0, 1))
	if res.Capture != nil || res.Exhausted || res.End != 1 || res.Paths[3][500] == nil {
		t.Fatalf("%+v", res)
	}
	// One connecting polygon at each representative sample.
	if len(res.Polygons) != 25 || res.Polygons[24].SampleIndex != 500 {
		t.Fatalf("%d polygons", len(res.Polygons))
	}
}

func TestPursuitStepBudget(t *testing.T) {
	saved := maxChaseSteps
	defer func() { maxChaseSteps = saved }()
	maxChaseSteps = 20
	res := pursuit(t, pursuitRequest(unequal, 0, 3))
	if !res.Exhausted || res.Capture != nil || res.End <= 0 || res.End >= 3 {
		t.Fatalf("%+v", res)
	}
	step := 3.0 / 500
	for k, p := range res.Paths[0] {
		if known := float64(k)*step <= res.End; known != (p != nil) {
			t.Fatalf("sample %d at t=%v: %v with the chase known to %v", k, float64(k)*step, p, res.End)
		}
	}
	r := compute(t, pursuitRequest(unequal, 0, 3))
	if !strings.Contains(strings.Join(r.Warnings, " "), "step") {
		t.Fatalf("warnings %v", r.Warnings)
	}
}

func TestPursuitInvalid(t *testing.T) {
	ok := polygon(3, Vec{}, 1, 0, 1)
	with := func(i int, p Pursuer) []Pursuer {
		out := append([]Pursuer{}, ok...)
		out[i] = p
		return out
	}
	for _, tc := range []struct {
		p    Pursuit
		want string
	}{
		{Pursuit{Pursuers: ok[:1], Capture: .1}, "2–16 pursuers"},
		{Pursuit{Pursuers: polygon(17, Vec{}, 1, 0, 1), Capture: .1}, "2–16 pursuers"},
		{Pursuit{Pursuers: with(1, Pursuer{math.NaN(), 0, 1}), Capture: .1}, "pursuer 2: the coordinates"},
		{Pursuit{Pursuers: with(2, Pursuer{0, 2e5, 1}), Capture: .1}, "pursuer 3: the coordinates"},
		{Pursuit{Pursuers: with(0, Pursuer{0, 0, -1}), Capture: .1}, "pursuer 1: the speed"},
		{Pursuit{Pursuers: with(0, Pursuer{0, 0, math.Inf(1)}), Capture: .1}, "pursuer 1: the speed"},
		{Pursuit{Pursuers: with(0, Pursuer{0, 0, 2e5}), Capture: .1}, "pursuer 1: the speed"},
		{Pursuit{Pursuers: ok, Capture: 0}, "capture distance"},
		{Pursuit{Pursuers: ok, Capture: math.NaN()}, "capture distance"},
		{Pursuit{Pursuers: ok, Capture: 2e5}, "capture distance"},
	} {
		if _, err := Compute(pursuitRequest(tc.p, 0, 1)); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%+v: got %v, want %q", tc.p, err, tc.want)
		}
	}
}

func TestPursuitResultJSON(t *testing.T) {
	r := compute(t, pursuitRequest(Pursuit{Pursuers: polygon(3, Vec{}, 1, 0, 1), Capture: .1}, 0, 1))
	b, _ := json.Marshal(r.Pursuit)
	for _, key := range []string{`"paths":[[`, `"polygons":[{"sampleIndex":0,"points":[{`, `"capture":null`, `"exhausted":false`, `"end":1`} {
		if !strings.Contains(string(b), key) {
			t.Fatalf("%s lacks %s", b, key)
		}
	}
	b, _ = json.Marshal(compute(t, request("evolute", "cos(t)", "sin(t)", 0, 1)))
	if strings.Contains(string(b), "pursuit") {
		t.Fatal("pursuit result on a parametric curve")
	}
}
