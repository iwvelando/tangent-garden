package engine3

import (
	"errors"
	"math"
	"reflect"
	"testing"
)

// launch is a surface study with a fan of geodesic threads from (u, v) at
// angle beta degrees.
func launch(c Request, u, v, beta, spread float64, count int, length float64, samples int) Request {
	c.Surface.Geodesics = &GeodesicRequest{U: u, V: v, Direction: beta, Spread: spread, Count: count, Length: length, Samples: samples, Selected: 1}
	return c
}

func threads(t *testing.T, c Request) *GeodesicResult {
	t.Helper()
	g := surfaced(t, c).Geodesics
	if g == nil {
		t.Fatal("no geodesic result")
	}
	return g
}

// The independent chart frame: X(u, v) and the unit vectors along X_u and
// X_v of each surface, written out here rather than read from the engine.
func sphereChart(r, u, v float64) (x, eu, ev Vec3) {
	return Vec3{r * math.Cos(v) * math.Cos(u), r * math.Cos(v) * math.Sin(u), r * math.Sin(v)},
		Vec3{-math.Sin(u), math.Cos(u), 0},
		Vec3{-math.Sin(v) * math.Cos(u), -math.Sin(v) * math.Sin(u), math.Cos(v)}
}

func torusChart(R, r, u, v float64) (x, eu, ev Vec3) {
	h := R + r*math.Cos(v)
	return Vec3{h * math.Cos(u), h * math.Sin(u), r * math.Sin(v)},
		Vec3{-math.Sin(u), math.Cos(u), 0},
		Vec3{-math.Sin(v) * math.Cos(u), -math.Sin(v) * math.Sin(u), math.Cos(v)}
}

func nearVec(t *testing.T, what string, got, want Vec3, tol float64) {
	t.Helper()
	if d := got.sub(want).norm(); !(d <= tol) {
		t.Fatalf("%s: got %v, want %v (off by %.3g)", what, got, want, d)
	}
}

// Every sphere thread is a great circle traversed at unit speed: it stays on
// the sphere and in the plane through the center spanned by its start and
// initial direction, and reaches the points that rotation predicts,
// including over a pole.
func TestSphereGeodesicsAreGreatCircles(t *testing.T) {
	const r = 2.0
	for _, at := range []struct{ u, v, beta float64 }{
		{0, 0, 90}, {0.3, 0.4, 30}, {2, -1.2, -140}, {1, math.Pi / 2, 0}, {1, math.Pi / 2, 90}, {5, -math.Pi / 2, 200},
	} {
		g := threads(t, launch(sphere(r, 24, 24), at.u, at.v, at.beta, 0, 1, 7*r, 700))
		if g.Surface != "sphere" || len(g.Threads) != 1 {
			t.Fatalf("%+v: %s with %d threads", at, g.Surface, len(g.Threads))
		}
		th := g.Threads[0]
		if th.Reason != "end" || th.Reached != 7*r || len(th.Points) != 701 || len(th.Tangents) != 701 {
			t.Fatalf("%+v: %s at %g with %d points", at, th.Reason, th.Reached, len(th.Points))
		}
		p0, eu, ev := sphereChart(r, at.u, at.v)
		b := at.beta * math.Pi / 180
		t0 := eu.mul(math.Cos(b)).add(ev.mul(math.Sin(b)))
		nearVec(t, "start", th.Points[0], p0, 1e-14*r)
		nearVec(t, "initial direction", th.Tangents[0], t0, 1e-14)
		plane := p0.cross(t0).mul(1 / r)
		for k, p := range th.Points {
			s := float64(k) * g.Step
			want := p0.mul(math.Cos(s / r)).add(t0.mul(r * math.Sin(s/r)))
			nearVec(t, "great circle", p, want, 1e-12*r)
			if math.Abs(p.norm()-r) > 1e-13*r || math.Abs(p.dot(plane)) > 1e-12*r {
				t.Fatalf("%+v: sample %d leaves the sphere or plane", at, k)
			}
			tg := th.Tangents[k]
			if math.Abs(tg.norm()-1) > 1e-13 || math.Abs(tg.dot(p)) > 1e-12*r {
				t.Fatalf("%+v: sample %d's tangent is not a unit tangent", at, k)
			}
		}
		if th.Closes {
			t.Fatalf("%+v: 3.5 radians of turn is not a return", at)
		}
	}
	// Northward from the equator at u = 0 the thread crosses the north
	// pole a quarter turn on and reaches the far side of the equator.
	th := threads(t, launch(sphere(r, 24, 24), 0, 0, 90, 0, 1, math.Pi*r, 8)).Threads[0]
	for k, want := range []Vec3{{r, 0, 0}, {r / math.Sqrt2, 0, r / math.Sqrt2}, {0, 0, r}, {-r / math.Sqrt2, 0, r / math.Sqrt2}, {-r, 0, 0}} {
		nearVec(t, "over the pole", th.Points[2*k], want, 1e-14*r)
	}
	nearVec(t, "direction over the pole", th.Tangents[4], Vec3{-1, 0, 0}, 1e-14)
	// At a pole, unit X_u is (−sin u, cos u, 0) and unit X_v points back
	// down meridian u: their limits from the chart.
	pole := threads(t, launch(sphere(r, 24, 24), math.Pi/2, math.Pi/2, 0, 0, 1, math.Pi*r/2, 8)).Threads[0]
	nearVec(t, "east from the pole", pole.Points[8], Vec3{-r, 0, 0}, 1e-14*r)
	pole = threads(t, launch(sphere(r, 24, 24), math.Pi/2, math.Pi/2, 90, 0, 1, math.Pi*r/2, 8)).Threads[0]
	nearVec(t, "north from the pole", pole.Points[8], Vec3{0, -r, 0}, 1e-14*r)
	// Chords sum to the arc length less exactly their sagitta's deficit.
	g := threads(t, launch(sphere(r, 24, 24), 0.3, 0.4, 30, 0, 1, 5, 50))
	chords := 0.0
	pts := g.Threads[0].Points
	for k := 1; k < len(pts); k++ {
		chords += pts[k].sub(pts[k-1]).norm()
	}
	if want := 50 * 2 * r * math.Sin(g.Step/(2*r)); math.Abs(chords-want) > 1e-12 || g.Step != 0.1 {
		t.Fatalf("chords sum to %.15g, want %.15g, step %g", chords, want, g.Step)
	}
	// A whole great circle returns to its start in position and direction.
	whole := threads(t, launch(sphere(r, 24, 24), 0.3, 0.4, 30, 0, 1, 2*math.Pi*r, 100)).Threads[0]
	if !whole.Closes || whole.Return.Position > 1e-12 || whole.Return.Direction > 1e-12 {
		t.Fatalf("a whole great circle: closes %v, residuals %+v", whole.Closes, whole.Return)
	}
	short := threads(t, launch(sphere(r, 24, 24), 0.3, 0.4, 30, 0, 1, 0.999*2*math.Pi*r, 100)).Threads[0]
	if short.Closes {
		t.Fatalf("0.999 of a great circle does not return: %+v", short.Return)
	}
}

// torusInvariants checks a torus thread against the surface, unit speed and
// Clairaut's relation, all read from the returned points and tangents: the
// axial component of X × T is ρ cos ψ, the radius times the cosine of the
// angle from the parallel.
func torusInvariants(t *testing.T, what string, R, r float64, th GeodesicThread, tol float64) {
	t.Helper()
	c0 := th.Points[0].cross(th.Tangents[0]).Z
	for k, p := range th.Points {
		rho := math.Hypot(p.X, p.Y)
		if d := math.Hypot(rho-R, p.Z) - r; math.Abs(d) > tol*r {
			t.Fatalf("%s: sample %d is %.3g off the torus", what, k, d)
		}
		tg := th.Tangents[k]
		x, eu, ev := torusChart(R, r, th.U[k], th.V[k])
		nearVec(t, what+" chart point", p, x, tol*r)
		if math.Abs(tg.norm()-1) > tol || math.Abs(tg.dot(eu.cross(ev))) > tol {
			t.Fatalf("%s: sample %d's tangent has length %.15g and normal part %.3g", what, k, tg.norm(), tg.dot(eu.cross(ev)))
		}
		if c := p.cross(tg).Z; math.Abs(c-c0) > tol*(R+r) {
			t.Fatalf("%s: Clairaut's ρ cos ψ drifts from %.15g to %.15g at sample %d", what, c0, c, k)
		}
		if k > 0 && (math.Abs(th.U[k]-th.U[k-1]) > 1 || math.Abs(th.V[k]-th.V[k-1]) > 1) {
			t.Fatalf("%s: the chart jumps at sample %d: (%g, %g) to (%g, %g)", what, k, th.U[k-1], th.V[k-1], th.U[k], th.V[k])
		}
	}
}

func TestTorusGeodesicInvariants(t *testing.T) {
	const R, r = 2.0, 0.8
	// The outer equator, the inner equator and a meridian are exact
	// circles.
	for _, c := range []struct {
		name         string
		v, beta      float64
		center, axis Vec3
		radius       float64
	}{
		{"outer equator", 0, 0, Vec3{}, Vec3{0, 0, 1}, R + r},
		{"inner equator", math.Pi, 0, Vec3{}, Vec3{0, 0, 1}, R - r},
		{"meridian", 0.7, 90, Vec3{R * math.Cos(1.2), R * math.Sin(1.2), 0}, Vec3{-math.Sin(1.2), math.Cos(1.2), 0}, r},
	} {
		u := 0.0
		if c.name == "meridian" {
			u = 1.2
		}
		th := threads(t, launch(torusPatch(R, r, 24, 24), u, c.v, c.beta, 0, 1, 2*math.Pi*c.radius, 360)).Threads[0]
		if th.Reason != "end" || len(th.Points) != 361 || th.Reached != 2*math.Pi*c.radius {
			t.Fatalf("%s: %s with %d points", c.name, th.Reason, len(th.Points))
		}
		torusInvariants(t, c.name, R, r, th, 1e-9)
		for k, p := range th.Points {
			d := p.sub(c.center)
			if math.Abs(d.norm()-c.radius) > 1e-9 || math.Abs(d.dot(c.axis)) > 1e-9 {
				t.Fatalf("%s: sample %d leaves its circle", c.name, k)
			}
		}
		if !th.Closes {
			t.Fatalf("%s: a whole circle returns to its start, residuals %+v", c.name, th.Return)
		}
	}
	// An oblique winding thread, long enough to cross every seam many
	// times, keeps its invariants; its chart unwraps.
	th := threads(t, launch(torusPatch(R, r, 24, 24), 0.4, -0.3, 70, 0, 1, 80, 4000)).Threads[0]
	if th.Reason != "end" || th.Steps == 0 {
		t.Fatalf("oblique: %s after %d steps", th.Reason, th.Steps)
	}
	torusInvariants(t, "oblique", R, r, th, 1e-8)
	// A thread that ran its length reached exactly that length, though
	// (13.7/r)r rounds away from 13.7.
	if short := threads(t, launch(torusPatch(R, r, 24, 24), 0.4, -0.3, 70, 0, 1, 13.7, 100)).Threads[0]; short.Reached != 13.7 {
		t.Fatalf("reached %.17g of 13.7", short.Reached)
	}
	if last := len(th.U) - 1; math.Abs(th.U[last]-th.U[0]) < 4*math.Pi || math.Abs(th.V[last]-th.V[0]) < 4*math.Pi {
		t.Fatalf("oblique: the chart should unwrap across several seams, ends at (%g, %g)", th.U[last], th.V[last])
	}
	if th.Closes {
		t.Fatalf("oblique: no return is certified, residuals %+v", th.Return)
	}
	// Reversed from its end, the thread retraces itself to its start, to
	// the integration's accuracy over twice its length.
	last := len(th.Points) - 1
	_, eu, ev := torusChart(R, r, th.U[last], th.V[last])
	back := th.Tangents[last].mul(-1)
	beta := math.Atan2(back.dot(ev), back.dot(eu)) * 180 / math.Pi
	again := threads(t, launch(torusPatch(R, r, 24, 24), th.U[last], th.V[last], beta, 0, 1, 80, 4000)).Threads[0]
	nearVec(t, "retraced start", again.Points[len(again.Points)-1], th.Points[0], 1e-6)
	nearVec(t, "retraced direction", again.Tangents[len(again.Tangents)-1], th.Tangents[0].mul(-1), 1e-6)
	for k := range th.Points {
		nearVec(t, "retraced", again.Points[last-k], th.Points[k], 1e-6)
	}
}

// Tightening the local error tolerance makes the end of a long winding
// thread converge, with more steps.
func TestTorusGeodesicConvergence(t *testing.T) {
	defer func(saved float64) { geodesicTolerance = saved }(geodesicTolerance)
	const R, r = 1.3, 1
	study := launch(torusPatch(R, r, 24, 24), 0.1, 2.5, 37, 0, 1, 60, 600)
	geodesicTolerance = 1e-14
	reference := threads(t, study).Threads[0]
	previous, steps := math.Inf(1), 0
	for _, tol := range []float64{1e-6, 1e-8, 1e-10, 1e-12} {
		geodesicTolerance = tol
		th := threads(t, study).Threads[0]
		torusInvariants(t, "converging", R, r, th, 300*tol)
		e := th.Points[600].sub(reference.Points[600]).norm()
		t.Logf("tolerance %g: %d steps, end error %.3g", tol, th.Steps, e)
		if !(e < previous/20) || th.Steps <= steps {
			t.Fatalf("tolerance %g: end error %.3g after %d steps does not improve on %.3g after %d", tol, e, th.Steps, previous, steps)
		}
		previous, steps = e, th.Steps
	}
	if previous > 1e-9 {
		t.Fatalf("the default tolerance leaves an end error of %.3g", previous)
	}
}

// Near a horn torus the inner equator runs close to the axis; the threads
// that pass it still keep their invariants, and a ratio the integration
// cannot resolve is unavailable rather than attempted.
func TestNearHornTorus(t *testing.T) {
	for _, R := range []float64{1.01, 1 + 2*minGeodesicNeck} {
		g := threads(t, launch(torusPatch(R, 1, 24, 24), 0, math.Pi*0.9, 15, 30, 5, 20, 1000))
		for k, th := range g.Threads {
			if th.Reason != "end" {
				t.Fatalf("R = %g: thread %d %s at %g after %d steps", R, k, th.Reason, th.Reached, th.Steps)
			}
			torusInvariants(t, "near horn", R, 1, th, 1e-7)
		}
	}
	for _, R := range []float64{1, 0.6, 0, 1 + minGeodesicNeck/2} {
		g := threads(t, launch(torusPatch(R, 1, 24, 24), 0, 0, 15, 0, 1, 5, 100))
		if g.Unavailable == "" || len(g.Threads) != 0 {
			t.Fatalf("R = %g: a horn, spindle or unresolved torus should be unavailable", R)
		}
	}
}

// Every member of a fan is the thread a single launch in its direction
// draws, bit for bit; the directions share the spread evenly, each at the
// middle of its share.
func TestGeodesicFanMembersMatchSingleLaunches(t *testing.T) {
	for _, base := range []Request{sphere(1.5, 24, 24), torusPatch(2, 0.8, 24, 24)} {
		fan := threads(t, launch(base, 0.5, 0.2, 40, 60, 4, 12, 300))
		if len(fan.Threads) != 4 {
			t.Fatalf("%d threads", len(fan.Threads))
		}
		for k, th := range fan.Threads {
			want := 40 + 60*((2*float64(k)+1)/8-0.5)
			if math.Abs(th.Direction-want) > 1e-12 {
				t.Fatalf("thread %d launches at %g°, want %g°", k, th.Direction, want)
			}
			one := threads(t, launch(base, 0.5, 0.2, th.Direction, 0, 1, 12, 300)).Threads[0]
			if !reflect.DeepEqual(one, th) {
				t.Fatalf("%s thread %d differs from its single launch", fan.Surface, k)
			}
		}
		ring := threads(t, launch(base, 0.5, 0.2, 10, 360, 4, 1, 10))
		for k, want := range []float64{-125, -35, 55, 145} {
			if math.Abs(ring.Threads[k].Direction-want) > 1e-12 {
				t.Fatalf("a whole-turn spread: thread %d at %g°", k, ring.Threads[k].Direction)
			}
		}
	}
}

// The fan shares one budget of attempted steps; a thread that runs out
// stops there, reports it, and draws nothing beyond.
func TestGeodesicBudgets(t *testing.T) {
	defer func(saved int) { maxGeodesicSteps = saved }(maxGeodesicSteps)
	maxGeodesicSteps = 900
	g := threads(t, launch(torusPatch(2, 0.8, 24, 24), 0.4, -0.3, 23, 20, 3, 80, 400))
	total := 0
	for k, th := range g.Threads {
		total += th.Steps
		if th.Reason != "exhausted" || th.Steps != 300 || !(th.Reached > 0 && th.Reached < 80) {
			t.Fatalf("thread %d: %s at %g after %d steps", k, th.Reason, th.Reached, th.Steps)
		}
		reached := int(math.Floor(th.Reached / g.Step))
		if len(th.Points) != reached+1 || len(th.U) != reached+1 {
			t.Fatalf("thread %d reached %g, sample %d, but has %d points", k, th.Reached, reached, len(th.Points))
		}
		x, _, _ := torusChart(2, 0.8, th.EndU, th.EndV)
		nearVec(t, "where it stopped", th.End, x, 1e-12)
	}
	if total > maxGeodesicSteps || g.Steps != total {
		t.Fatalf("%d steps attempted, reported %d, budget %d", total, g.Steps, maxGeodesicSteps)
	}
}

// Fields name themselves; a surface without geodesics is drawn unavailable
// for them, never converted, and the surface itself is unchanged.
func TestGeodesicValidation(t *testing.T) {
	ok := func() Request { return launch(torusPatch(2, 0.8, 24, 24), 0, 0, 0, 30, 4, 10, 100) }
	for _, c := range []struct {
		field string
		edit  func(*GeodesicRequest)
	}{
		{"surface.geodesics.count", func(g *GeodesicRequest) { g.Count = 0 }},
		{"surface.geodesics.count", func(g *GeodesicRequest) { g.Count = 33 }},
		{"surface.geodesics.samples", func(g *GeodesicRequest) { g.Samples = 3 }},
		{"surface.geodesics.samples", func(g *GeodesicRequest) { g.Count, g.Samples = 32, 6250 }},
		{"surface.geodesics.length", func(g *GeodesicRequest) { g.Length = 0 }},
		{"surface.geodesics.length", func(g *GeodesicRequest) { g.Length = math.NaN() }},
		{"surface.geodesics.length", func(g *GeodesicRequest) { g.Length = 1e6 }},
		{"surface.geodesics.u", func(g *GeodesicRequest) { g.U = math.Inf(1) }},
		{"surface.geodesics.v", func(g *GeodesicRequest) { g.V = 2e5 }},
		{"surface.geodesics.direction", func(g *GeodesicRequest) { g.Direction = math.NaN() }},
		{"surface.geodesics.spread", func(g *GeodesicRequest) { g.Spread = -1 }},
		{"surface.geodesics.spread", func(g *GeodesicRequest) { g.Spread = 361 }},
		{"surface.geodesics.selected", func(g *GeodesicRequest) { g.Selected = 0 }},
		{"surface.geodesics.selected", func(g *GeodesicRequest) { g.Selected = 5 }},
	} {
		q := ok()
		c.edit(q.Surface.Geodesics)
		_, err := Compute(q)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Fatalf("%s: got %v", c.field, err)
		}
	}
	// 32 threads of 6,249 samples is the most returned points allowed.
	q := ok()
	q.Surface.Geodesics.Count, q.Surface.Geodesics.Samples, q.Surface.Geodesics.Length = 32, 6249, 1
	if _, err := Compute(q); err != nil {
		t.Fatal(err)
	}
	// On a sphere, v is a latitude.
	q = launch(sphere(1, 24, 24), 0, 1.6, 0, 0, 1, 1, 10)
	var fe *FieldError
	if _, err := Compute(q); !errors.As(err, &fe) || fe.Field != "surface.geodesics.v" {
		t.Fatalf("a latitude beyond the pole: %v", err)
	}
	for _, c := range []Request{
		surfaceStudy("ellipsoid", 1, 1, 1.0001, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 24, 24),
		surfaceStudy("cylinder", 1, 1, 0, 0, 2*math.Pi, -1, 1, 24, 24),
		surfaceStudy("paraboloid", 1, 1, 0, -1, 1, -1, 1, 24, 24),
		surfaceStudy("monkey", 1, 0, 0, -1, 1, -1, 1, 24, 24),
	} {
		plain := surfaced(t, c)
		with := surfaced(t, launch(c, 0, 0, 0, 0, 1, 1, 10))
		if with.Geodesics == nil || with.Geodesics.Unavailable == "" || len(with.Geodesics.Threads) != 0 {
			t.Fatalf("%s: geodesics should be unavailable", c.Surface.Kind)
		}
		with.Geodesics = nil
		if !reflect.DeepEqual(plain, with) {
			t.Fatalf("%s: unavailable geodesics changed the surface", c.Surface.Kind)
		}
	}
	// The threads change nothing else about a supported surface, and an
	// opened patch frames the threads that run beyond it.
	for _, c := range []Request{sphere(1, 24, 24), torusPatch(2, 0.8, 24, 24)} {
		c.Surface.UMax = 1
		plain := surfaced(t, c)
		withOut, err := Compute(launch(c, 0, 0, 0, 0, 1, 20, 400))
		if err != nil {
			t.Fatal(err)
		}
		with := *withOut.Surface
		with.Geodesics = nil
		if !reflect.DeepEqual(*plain, with) {
			t.Fatalf("%s: the threads changed the surface", c.Surface.Kind)
		}
		plainOut, _ := Compute(c)
		outside := false
		for _, p := range withOut.Surface.Geodesics.Threads[0].Points {
			if p.sub(withOut.Bounds.Center).norm() > withOut.Bounds.Radius*(1+1e-12) {
				t.Fatalf("%s: thread point %v lies outside the bounds", c.Surface.Kind, p)
			}
			outside = outside || p.sub(plainOut.Bounds.Center).norm() > plainOut.Bounds.Radius
		}
		// The torus's second focal sheet, its axis, already frames more
		// than the whole torus.
		if !outside && c.Surface.Kind == "ellipsoid" {
			t.Fatalf("%s: the thread should run beyond the opened patch's bounds", c.Surface.Kind)
		}
	}
}

// A return needs both residuals within 10⁻⁶: the end at the start, and the
// final tangent along the first.
func TestGeodesicReturnNeedsPositionAndDirection(t *testing.T) {
	for _, c := range []struct {
		end, tangent Vec3
		closes       bool
	}{
		{Vec3{2, 0, 0}, Vec3{0, 1, 0}, true},
		{Vec3{2, 0, 1e-6}, Vec3{0, 1, 1e-6}, true},
		{Vec3{2, 0, 0}, Vec3{0, 0, 1}, false},
		{Vec3{2, 0, 3e-6}, Vec3{0, 1, 0}, false},
		{Vec3{2, 0, 0}, Vec3{0, 1, 2e-6}, false},
	} {
		th := GeodesicThread{Reason: "end", Points: []Vec3{{2, 0, 0}}, Tangents: []Vec3{{0, 1, 0}}, End: c.end, EndTangent: c.tangent}
		th.closing(2)
		if th.Closes != c.closes {
			t.Fatalf("end %v, tangent %v: closes %v, residuals %+v", c.end, c.tangent, th.Closes, th.Return)
		}
		th.Reason = "exhausted"
		th.Closes = false
		th.closing(2)
		if th.Closes {
			t.Fatal("a thread that stopped short is never a return")
		}
	}
}
