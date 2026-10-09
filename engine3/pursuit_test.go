package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"tangentgarden/engine"
	"testing"
)

func pursuitStudy(pursuers []SpatialPursuer, eps, lo, hi float64) Request {
	return Request{
		Format: "pursuit", Construction: "none",
		Pursuit: PursuitRequest{Pursuers: pursuers, Capture: eps, Min: lo, Max: hi},
		Samples: 480, Lines: 24, Length: 1,
	}
}

func chased(t *testing.T, c Request) Result {
	t.Helper()
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if out.Pursuit == nil {
		t.Fatal("no pursuit result")
	}
	return out
}

func chaseTime(c Request, i int) float64 {
	n := float64(c.Samples)
	return c.Pursuit.Min*(1-float64(i)/n) + c.Pursuit.Max*float64(i)/n
}

// unequal3 is a chase with unequal speeds from a start that no plane holds.
var unequal3 = []SpatialPursuer{{1, 0, .2, 1}, {.2, 1.3, -.4, 1.6}, {-1.2, .1, .5, .7}, {-.3, -1.1, -.3, 1}, {.9, -.9, .1, 1.2}}

// A rigid motion: a rotation about an oblique axis, then a translation.
type motion struct{ u, v, w, shift Vec3 }

func (m motion) apply(p Vec3) Vec3 {
	return m.u.mul(p.X).add(m.v.mul(p.Y)).add(m.w.mul(p.Z)).add(m.shift)
}

// tilt maps the xy-plane onto the plane through shift with normal w.
var tilt = func() motion {
	w := Vec3{1, -2, 2}.unit()
	u := Vec3{2, 1, 0}.unit()
	return motion{u, w.cross(u), w, Vec3{.4, -.3, 1.1}}
}()

// Embedded in z = 0, a spatial chase is the planar chase: the same capture
// and, to rounding in the sample times, the same paths.
func TestSpatialPursuitPlanarReduction(t *testing.T) {
	flat := []engine.Pursuer{{X: 1, Y: 0, Speed: 1}, {X: .2, Y: 1.3, Speed: 1.6}, {X: -1.2, Y: .1, Speed: .7}, {X: -.3, Y: -1.1, Speed: 1}, {X: .9, Y: -.9, Speed: 1.2}}
	var spatial []SpatialPursuer
	for _, p := range flat {
		spatial = append(spatial, SpatialPursuer{p.X, p.Y, 0, p.Speed})
	}
	c := pursuitStudy(spatial, .02, 0, 3)
	out := chased(t, c)
	q := engine.Request{Kind: "offset", Offset: .1, NIncident: 1, NTransmitted: 1.5, Curve: engine.Curve{Format: "pursuit", Pursuit: engine.Pursuit{Pursuers: flat, Capture: .02}, Min: 0, Max: 3}, Samples: c.Samples + 1, Lines: c.Lines}
	want, err := engine.Compute(q)
	if err != nil {
		t.Fatal(err)
	}
	got, w := out.Pursuit, want.Pursuit
	if got.Capture == nil || *got.Capture != *w.Capture || got.End != w.End || got.Exhausted {
		t.Fatalf("capture %+v at %v, want %+v at %v", got.Capture, got.End, w.Capture, w.End)
	}
	for k, path := range got.Paths {
		for i, p := range path {
			if (p == nil) != (w.Paths[k][i] == nil) {
				t.Fatalf("pursuer %d sample %d: %v vs %v", k+1, i, p, w.Paths[k][i])
			}
			if p != nil {
				near(t, *p, Vec3{w.Paths[k][i].X, w.Paths[k][i].Y, 0}, 1e-12)
			}
		}
	}
	// The spatial representative samples round down, as for rulings, where
	// the planar ones round to nearest; each polygon joins the paths.
	if len(got.Polygons) < 5 {
		t.Fatalf("%d polygons", len(got.Polygons))
	}
	for _, poly := range got.Polygons {
		for j, p := range poly.Points {
			w := w.Paths[j][poly.SampleIndex]
			near(t, p, Vec3{w.X, w.Y, 0}, 1e-12)
		}
	}
}

// Equal speeds from a regular polygon in a tilted plane: every path is the
// planar logarithmic spiral r = r0 exp(−tan(π/n)(θ − θ0)), carried into the
// plane, and neighbours close to ε when r = ε / (2 sin(π/n)).
func TestSpatialPursuitTiltedPolygon(t *testing.T) {
	for _, n := range []int{2, 3, 7} {
		r0, v, eps := 1.5, 1.2, 1e-3
		s := math.Sin(math.Pi / float64(n))
		capture := (r0 - eps/(2*s)) / (v * s)
		ps := make([]SpatialPursuer, n)
		for j := range ps {
			a := .4 + 2*math.Pi*float64(j)/float64(n)
			p := tilt.apply(Vec3{r0 * math.Cos(a), r0 * math.Sin(a), 0})
			ps[j] = SpatialPursuer{p.X, p.Y, p.Z, v}
		}
		c := pursuitStudy(ps, eps, 0, capture*1.05)
		c.Samples = 2000
		out := chased(t, c)
		q := out.Pursuit
		if q.Capture == nil || math.Abs(q.Capture.Time-capture) > 1e-9 || q.End != q.Capture.Time || q.Capture.Target != (q.Capture.Pursuer+1)%n {
			t.Fatalf("n=%d: capture %+v, want time %v", n, q.Capture, capture)
		}
		for j, path := range q.Paths {
			for i, p := range path {
				tk := chaseTime(c, i)
				if tk > q.End {
					if p != nil {
						t.Fatalf("n=%d pursuer %d: sample at t=%v after the capture", n, j+1, tk)
					}
					continue
				}
				r := r0 - v*s*tk
				theta := .4 + 2*math.Pi*float64(j)/float64(n) + math.Cos(math.Pi/float64(n))/s*math.Log(r0/r)
				if p == nil {
					t.Fatalf("n=%d pursuer %d: no sample at t=%v", n, j+1, tk)
				}
				near(t, *p, tilt.apply(Vec3{r * math.Cos(theta), r * math.Sin(theta), 0}), 1e-9)
			}
		}
		// Every pursuer is exactly ε from its neighbour at the capture.
		for j, p := range q.Final {
			if d := q.Final[(j+1)%n].sub(p).norm(); math.Abs(d-eps) > 1e-12 {
				t.Fatalf("n=%d: final gap %d is %v", n, j+1, d)
			}
		}
		// The polygons stay regular and shrink linearly, and none is later
		// than the capture.
		for _, poly := range q.Polygons {
			tk := chaseTime(c, poly.SampleIndex)
			if tk > q.End {
				t.Fatalf("n=%d: a polygon after the capture", n)
			}
			side := 2 * (r0 - v*s*tk) * s
			for j, p := range poly.Points {
				if got := poly.Points[(j+1)%n].sub(p).norm(); math.Abs(got-side) > 1e-9 {
					t.Fatalf("n=%d t=%v: side %d is %v, want %v", n, tk, j+1, got, side)
				}
			}
		}
		if len(q.Polygons) == 0 || q.Polygons[0].SampleIndex != 0 {
			t.Fatalf("n=%d: polygons %v", n, q.Polygons)
		}
	}
}

// Four equal-speed pursuers from a regular tetrahedron, (±1, 0, h) and
// (0, ±1, −h) with h = 1/√2, taken in turn, are carried each to the next by
// the rotoreflection S(x, y, z) = (−y, x, −z), and the chase keeps that
// symmetry. For pursuer 1 at cylindrical (ρ, θ, z), with d the gap,
// ρ′ = −vρ/d, θ′ = v/d and z′ = −2vz/d, so z = hρ² and θ = ln(1/ρ): a
// logarithmic spiral climbing down a paraboloid, with d = √(2ρ² + 4h²ρ⁴) =
// √2 ρ √(1 + ρ²). Time is t = (F(1) − F(ρ))/v with
// F(ρ) = (ρ√(1 + ρ²) + asinh ρ)/√2.
func TestSpatialPursuitTetrahedron(t *testing.T) {
	h, v, eps := 1/math.Sqrt2, 1.3, 1e-3
	S := func(p Vec3) Vec3 { return Vec3{-p.Y, p.X, -p.Z} }
	F := func(rho float64) float64 { return (rho*math.Sqrt(1+rho*rho) + math.Asinh(rho)) / math.Sqrt2 }
	radius := func(tk float64) float64 {
		lo, hi := 0.0, 1.0
		for k := 0; k < 200; k++ {
			mid := (lo + hi) / 2
			if (F(1)-F(mid))/v > tk {
				lo = mid
			} else {
				hi = mid
			}
		}
		return (lo + hi) / 2
	}
	end := math.Sqrt((math.Sqrt(1+2*eps*eps) - 1) / 2)
	capture := (F(1) - F(end)) / v
	ps := []SpatialPursuer{{1, 0, h, v}, {0, 1, -h, v}, {-1, 0, h, v}, {0, -1, -h, v}}
	c := pursuitStudy(ps, eps, 0, capture*1.1)
	c.Samples = 1200
	out := chased(t, c)
	q := out.Pursuit
	if q.Capture == nil || math.Abs(q.Capture.Time-capture) > 1e-9 {
		t.Fatalf("capture %+v, want time %v", q.Capture, capture)
	}
	checked := 0
	for i, p := range q.Paths[0] {
		if p == nil {
			continue
		}
		rho := radius(chaseTime(c, i))
		theta := math.Log(1 / rho)
		want := Vec3{rho * math.Cos(theta), rho * math.Sin(theta), h * rho * rho}
		near(t, *p, want, 1e-9)
		for k := 1; k < 4; k++ {
			want = S(want)
			near(t, *q.Paths[k][i], want, 1e-9)
		}
		checked++
	}
	if checked < 1000 {
		t.Fatalf("checked %d samples", checked)
	}
}

// Two pursuers chase each other along a skew line, closing at the sum of
// their speeds; both gaps are equal and the first is reported.
func TestSpatialPursuitMutualChase(t *testing.T) {
	a, b := Vec3{-1, .5, 2}, Vec3{1, -1.5, 3}
	u := b.sub(a).unit()
	out := chased(t, pursuitStudy([]SpatialPursuer{{a.X, a.Y, a.Z, 1}, {b.X, b.Y, b.Z, 2}}, .5, 0, 2))
	q := out.Pursuit
	want := (b.sub(a).norm() - .5) / 3
	if q.Capture == nil || q.Capture.Pursuer != 0 || q.Capture.Target != 1 || math.Abs(q.Capture.Time-want) > 1e-12 {
		t.Fatalf("capture %+v, want time %v", q.Capture, want)
	}
	for i, p := range q.Paths[0] {
		tk := chaseTime(pursuitStudy(nil, 0, 0, 2), i)
		if p != nil {
			near(t, *p, a.add(u.mul(tk)), 1e-12)
			near(t, *q.Paths[1][i], b.sub(u.mul(2*tk)), 1e-12)
		}
	}
	near(t, q.Final[0], a.add(u.mul(want)), 1e-11)
}

// A pursuer runs straight at a target that stands still.
func TestSpatialPursuitStationaryTarget(t *testing.T) {
	a, b := Vec3{0, 0, 0}, Vec3{3, -4, 12}
	out := chased(t, pursuitStudy([]SpatialPursuer{{a.X, a.Y, a.Z, 2}, {b.X, b.Y, b.Z, 0}}, .1, 0, 10))
	q := out.Pursuit
	if q.Capture == nil || math.Abs(q.Capture.Time-(13-.1)/2) > 1e-12 {
		t.Fatalf("capture %+v", q.Capture)
	}
	for _, p := range q.Paths[1] {
		if p != nil && *p != b {
			t.Fatalf("the still target moved to %v", p)
		}
	}
}

// A runner passes close by a pursuer that stands still and chases it, on a
// line offset in both y and z. The gap dips below ε only briefly: a step
// that straddled the dip would miss the capture.
func TestSpatialPursuitCaptureInPassing(t *testing.T) {
	eps, miss := .01, .005
	ps := []SpatialPursuer{{0, 0, 0, 0}, {-5, .6 * miss, .8 * miss, 10}, {1e4, .6 * miss, .8 * miss, 0}}
	out := chased(t, pursuitStudy(ps, eps, 0, 1))
	want := (5 - math.Sqrt(eps*eps-miss*miss)) / 10
	if c := out.Pursuit.Capture; c == nil || c.Pursuer != 0 || c.Target != 1 || math.Abs(c.Time-want) > 1e-12 {
		t.Fatalf("capture %+v, want time %v", c, want)
	}
}

// A rigid motion (here a reflection too) of the starts moves every path the
// same way and keeps the capture.
func TestSpatialPursuitRigidMotion(t *testing.T) {
	a := chased(t, pursuitStudy(unequal3, .02, 0, 3))
	flip := motion{tilt.u, tilt.v, tilt.w.mul(-1), tilt.shift}
	var moved []SpatialPursuer
	for _, p := range unequal3 {
		q := flip.apply(Vec3{p.X, p.Y, p.Z})
		moved = append(moved, SpatialPursuer{q.X, q.Y, q.Z, p.Speed})
	}
	b := chased(t, pursuitStudy(moved, .02, 0, 3))
	if a.Pursuit.Capture == nil || *a.Pursuit.Capture != *b.Pursuit.Capture && math.Abs(a.Pursuit.End-b.Pursuit.End) > 1e-10 {
		t.Fatalf("captures %+v and %+v", a.Pursuit.Capture, b.Pursuit.Capture)
	}
	if math.Abs(a.Pursuit.End-b.Pursuit.End) > 1e-10 {
		t.Fatalf("ends %v and %v", a.Pursuit.End, b.Pursuit.End)
	}
	for k, path := range a.Pursuit.Paths {
		for i, p := range path {
			if p != nil && b.Pursuit.Paths[k][i] != nil {
				near(t, *b.Pursuit.Paths[k][i], flip.apply(*p), 1e-9)
			}
		}
	}
}

// A chase scaled by λ in space is the same chase scaled by λ in time.
func TestSpatialPursuitScale(t *testing.T) {
	base := chased(t, pursuitStudy(unequal3, .02, 0, 3)).Pursuit
	for _, scale := range []float64{1e-3, 1e3} {
		var ps []SpatialPursuer
		for _, p := range unequal3 {
			ps = append(ps, SpatialPursuer{p.X * scale, p.Y * scale, p.Z * scale, p.Speed})
		}
		q := chased(t, pursuitStudy(ps, .02*scale, 0, 3*scale)).Pursuit
		if math.Abs(q.End/scale-base.End) > 1e-10 {
			t.Fatalf("λ=%g: end %v, want %v", scale, q.End/scale, base.End)
		}
		for k, path := range base.Paths {
			for i, p := range path {
				if p != nil && q.Paths[k][i] != nil {
					near(t, q.Paths[k][i].mul(1/scale), *p, 1e-10)
				}
			}
		}
	}
}

// Every pursuer heads straight at its target at its own speed, and the base
// evaluator's velocity and acceleration agree with the positions.
func TestSpatialPursuitDirections(t *testing.T) {
	c := pursuitStudy(unequal3, .02, 0, 3)
	ch, err := c.Pursuit.compile()
	if err != nil {
		t.Fatal(err)
	}
	if ch.Capture == nil {
		t.Fatal("no capture")
	}
	f := ch.evaluation()
	n := len(unequal3)
	const h = 1e-5
	for tk := .01; tk < ch.End-2*h; tk += ch.End / 37 {
		now, before, after := ch.positions(tk), ch.positions(tk-h), ch.positions(tk+h)
		for i := range now {
			v := after[i].sub(before[i]).mul(1 / (2 * h))
			want := now[(i+1)%n].sub(now[i]).unit().mul(unequal3[i].Speed)
			if v.sub(want).norm() > 1e-7 {
				t.Fatalf("t=%v pursuer %d: velocity %v want %v", tk, i+1, v, want)
			}
		}
		r, v, a, ok := f(tk)
		if !ok || r != now[0] {
			t.Fatalf("t=%v: base %v, want %v", tk, r, now[0])
		}
		_, vb, _, _ := f(tk - h)
		_, va, _, _ := f(tk + h)
		near(t, v, now[1].sub(now[0]).unit().mul(unequal3[0].Speed), 1e-12)
		near(t, a, va.sub(vb).mul(1/(2*h)), 1e-5)
	}
	if _, _, _, ok := f(ch.End + 1e-9); ok {
		t.Fatal("a base point after the capture")
	}
	if _, _, _, ok := f(-1e-9); ok {
		t.Fatal("a base point before the start")
	}
}

// Tightening the tolerance converges: capture times and states agree ever
// more closely, with more steps.
func TestSpatialPursuitStepRefinement(t *testing.T) {
	c := pursuitStudy(unequal3, .02, 0, 3)
	run := func(tol float64) *spatialChase {
		saved := chaseTolerance
		defer func() { chaseTolerance = saved }()
		chaseTolerance = tol
		ch, err := c.Pursuit.compile()
		if err != nil {
			t.Fatal(err)
		}
		return ch
	}
	loose, mid, tight := run(1e-6), run(1e-9), run(1e-12)
	if math.Abs(loose.End-tight.End) > 1e-4 || math.Abs(mid.End-tight.End) > 1e-7 {
		t.Fatalf("capture times %v %v %v", loose.End, mid.End, tight.End)
	}
	worst := func(a *spatialChase) float64 {
		d := 0.0
		for tk := 0.; tk < tight.End*.999; tk += tight.End / 50 {
			x, y := a.positions(tk), tight.positions(tk)
			for i := range x {
				d = math.Max(d, x[i].sub(y[i]).norm())
			}
		}
		return d
	}
	if l, m := worst(loose), worst(mid); !(m < l/100) || m > 1e-6 {
		t.Fatalf("differences %v then %v", l, m)
	}
	if tight.Steps() <= mid.Steps() || mid.Steps() <= loose.Steps() {
		t.Fatalf("steps %d %d %d", loose.Steps(), mid.Steps(), tight.Steps())
	}
}

func TestSpatialPursuitCaptureAtStart(t *testing.T) {
	ps := []SpatialPursuer{{0, 0, 0, 1}, {1, 1, 1, 1}, {1, 1, 1.005, 1}}
	q := chased(t, pursuitStudy(ps, .01, -1, 1)).Pursuit
	if c := q.Capture; c == nil || c.Time != -1 || c.Pursuer != 1 || c.Target != 2 || q.End != -1 {
		t.Fatalf("capture %+v end %v", q.Capture, q.End)
	}
	for j, path := range q.Paths {
		near(t, *path[0], Vec3{ps[j].X, ps[j].Y, ps[j].Z}, 0)
		for _, p := range path[1:] {
			if p != nil {
				t.Fatalf("pursuer %d moves after the capture", j+1)
			}
		}
	}
	if len(q.Polygons) != 1 || q.Polygons[0].SampleIndex != 0 {
		t.Fatalf("polygons %+v", q.Polygons)
	}
	// Caught at once with nobody moving, the chase is still drawn alone as
	// its starts. Pursuer 1's start is still regular, so a construction
	// runs on that one sample.
	ps = []SpatialPursuer{{0, 0, 0, 1}, {0, 0, .001, 1}, {1, 1, 1, 1}}
	c := pursuitStudy(ps, .01, 0, 1)
	if q := chased(t, c).Pursuit; q.Capture == nil || q.Capture.Time != 0 || q.Capture.Pursuer != 0 {
		t.Fatalf("capture %+v", q.Capture)
	}
	c.Construction = "developable"
	if out, err := Compute(c); err != nil || out.Invalid != c.Samples {
		t.Fatalf("error %v, %d invalid", err, out.Invalid)
	}
}

func TestSpatialPursuitNoCapture(t *testing.T) {
	// A chase that outlasts the interval: every sample known, one polygon at
	// each representative sample, the finals at the end.
	c := pursuitStudy(unequal3, .02, 0, .5)
	q := chased(t, c).Pursuit
	if q.Capture != nil || q.Exhausted || q.End != .5 {
		t.Fatalf("%+v", q)
	}
	for k, path := range q.Paths {
		for i, p := range path {
			if p == nil {
				t.Fatalf("pursuer %d: no sample %d", k+1, i)
			}
		}
		near(t, q.Final[k], *path[c.Samples], 1e-12)
	}
	if len(q.Polygons) != c.Lines || q.Polygons[c.Lines-1].SampleIndex != c.Samples {
		t.Fatalf("%d polygons", len(q.Polygons))
	}
}

func TestSpatialPursuitStepBudget(t *testing.T) {
	saved := maxChaseSteps
	defer func() { maxChaseSteps = saved }()
	maxChaseSteps = 20
	c := pursuitStudy(unequal3, .02, 0, 3)
	q := chased(t, c).Pursuit
	if !q.Exhausted || q.Capture != nil || q.End <= 0 || q.End >= 3 {
		t.Fatalf("%+v", q)
	}
	for i, p := range q.Paths[0] {
		if known := chaseTime(c, i) <= q.End; known != (p != nil) {
			t.Fatalf("sample %d at t=%v: %v with the chase known to %v", i, chaseTime(c, i), p, q.End)
		}
	}
}

// Constructions run on the first pursuer's path. The regular chase in a
// tilted plane is a planar spiral, so its tangent developable lies in that
// plane, and its speed is constant, so its acceleration is purely normal,
// v² cos(π/n)/r.
func TestSpatialPursuitConstructions(t *testing.T) {
	n, r0, v := 5, 1.0, 1.0
	ps := make([]SpatialPursuer, n)
	for j := range ps {
		a := 2 * math.Pi * float64(j) / float64(n)
		p := tilt.apply(Vec3{r0 * math.Cos(a), r0 * math.Sin(a), 0})
		ps[j] = SpatialPursuer{p.X, p.Y, p.Z, v}
	}
	c := pursuitStudy(ps, .05, 0, 2)
	for _, construction := range []string{"developable", "involute", "tangent-foot", "orthotomic", "inversion", "framed", "ruled", "canal"} {
		c.Construction = construction
		c.Inversion = InversionRequest{Radius: 2, Input: "base"}
		c.Frame = FrameRequest{Kind: "rotation-minimizing", Reference: Vec3{0, 0, 1}, Width: .1, Offset: .1, Strands: 1, Closure: "seam"}
		c.Ruled = RuledRequest{Partner: "chord", Rate: 1, Shift: .1}
		c.Canal = CanalRequest{Radius: .02, Profile: "1", Meridians: 2}
		c.Involute = InvoluteRequest{Anchor: .5, Offset: .2}
		c.Pole = Vec3{0, 0, 5}
		out, err := Compute(c)
		if err != nil {
			t.Fatalf("%s: %v", construction, err)
		}
		if out.Pursuit == nil || len(out.Pursuit.Paths) != n {
			t.Fatalf("%s: no pursuit", construction)
		}
		if construction == "developable" {
			for _, m := range corners(out.Mesh) {
				if math.Abs(math.Abs(m.Normal.dot(tilt.w))-1) > 1e-6 {
					t.Fatalf("developable normal %v, want ±%v", m.Normal, tilt.w)
				}
			}
			if len(corners(out.Mesh)) == 0 {
				t.Fatal("no developable")
			}
		}
	}
	ch, _ := c.Pursuit.compile()
	f := ch.evaluation()
	for _, tk := range []float64{.1, .7, 1.3} {
		r, _, a, _ := f(tk)
		if want := v * v * math.Cos(math.Pi/float64(n)) / r.sub(tilt.shift).norm(); math.Abs(a.norm()-want) > 1e-9 {
			t.Fatalf("t=%v: |a| = %v, want %v", tk, a.norm(), want)
		}
	}
}

// A still first pursuer has no tangent: alone it is drawn, under a
// construction it is refused, and a chase where nobody moves is refused.
func TestSpatialPursuitStill(t *testing.T) {
	ps := []SpatialPursuer{{0, 0, 0, 0}, {1, 0, 0, 1}, {0, 1, 0, 1}}
	chased(t, pursuitStudy(ps, .01, 0, 1))
	c := pursuitStudy(ps, .01, 0, 1)
	c.Construction = "developable"
	if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "pursuer 1") {
		t.Fatalf("error %v", err)
	}
	for i := range ps {
		ps[i].Speed = 0
	}
	if _, err := Compute(pursuitStudy(ps, .01, 0, 1)); err == nil || !strings.Contains(err.Error(), "no pursuer moves") {
		t.Fatalf("error %v", err)
	}
}

func TestSpatialPursuitInvalid(t *testing.T) {
	ok := []SpatialPursuer{{0, 0, 0, 1}, {1, 0, 0, 1}, {0, 1, 1, 1}}
	with := func(i int, p SpatialPursuer) []SpatialPursuer {
		out := append([]SpatialPursuer{}, ok...)
		out[i] = p
		return out
	}
	many := make([]SpatialPursuer, 17)
	for i := range many {
		many[i] = SpatialPursuer{float64(i), 0, 0, 1}
	}
	for _, tc := range []struct {
		c    Request
		want string
	}{
		{pursuitStudy(ok[:1], .1, 0, 1), "2–16 pursuers"},
		{pursuitStudy(many, .1, 0, 1), "2–16 pursuers"},
		{pursuitStudy(with(1, SpatialPursuer{0, 0, math.NaN(), 1}), .1, 0, 1), "pursuer 2: the coordinates"},
		{pursuitStudy(with(2, SpatialPursuer{0, 2e5, 0, 1}), .1, 0, 1), "pursuer 3: the coordinates"},
		{pursuitStudy(with(0, SpatialPursuer{0, 0, 0, -1}), .1, 0, 1), "pursuer 1: the speed"},
		{pursuitStudy(with(0, SpatialPursuer{0, 0, 0, math.Inf(1)}), .1, 0, 1), "pursuer 1: the speed"},
		{pursuitStudy(ok, 0, 0, 1), "capture distance"},
		{pursuitStudy(ok, math.NaN(), 0, 1), "capture distance"},
		{pursuitStudy(ok, 2e5, 0, 1), "capture distance"},
		{pursuitStudy(ok, .1, 1, 0), "domain"},
	} {
		if _, err := Compute(tc.c); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%+v: got %v, want %q", tc.c.Pursuit, err, tc.want)
		}
	}
}

func TestSpatialPursuitJSON(t *testing.T) {
	out := chased(t, pursuitStudy(unequal3, .02, 0, .5))
	b, _ := json.Marshal(out)
	for _, key := range []string{`"pursuit":{"paths":[[{`, `"polygons":[{"sampleIndex":0,"points":[{"x":1,"y":0,"z":0.2}`, `"capture":null`, `"exhausted":false`, `"end":0.5`, `"final":[{`} {
		if !strings.Contains(string(b), key) {
			t.Fatalf("result lacks %s", key)
		}
	}
	b, _ = json.Marshal(flowed(t, fieldRequest("-y", "x", "a", seedRing(2, 1, 0), 0, 1)))
	if strings.Contains(string(b), `"pursuit"`) {
		t.Fatal("pursuit result on a vector field")
	}
}
