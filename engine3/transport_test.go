package engine3

import (
	"errors"
	"math"
	"reflect"
	"testing"
)

// carry adds a carried arrow to a study with geodesic threads.
func carry(c Request, path string, angle float64, arrows int) Request {
	g := *c.Surface.Geodesics
	g.Transport = &TransportRequest{Path: path, Angle: angle, Size: 0.3, Arrows: arrows}
	c.Surface.Geodesics = &g
	return c
}

func transported(t *testing.T, c Request) *TransportResult {
	t.Helper()
	g := threads(t, c)
	if g.Transport == nil {
		t.Fatal("no transport result")
	}
	return g.Transport
}

// rotate is Rodrigues' rotation of v by angle about the unit axis, written
// out independently of the engine.
func rotate(v, axis Vec3, angle float64) Vec3 {
	c, s := math.Cos(angle), math.Sin(angle)
	return v.mul(c).add(axis.cross(v).mul(s)).add(axis.mul(axis.dot(v) * (1 - c)))
}

// The torus's unit normal at a point, from the point alone: away from the
// core circle.
func torusNormal(R, r float64, p Vec3) Vec3 {
	rho := math.Hypot(p.X, p.Y)
	core := Vec3{R * p.X / rho, R * p.Y / rho, 0}
	return p.sub(core).mul(1 / r)
}

// Every sample's vector is a unit tangent vector, by the returned normal
// and by an independent one, and the drift reported covers what is
// measured.
func tangentUnit(t *testing.T, what string, tr *TransportResult, normal func(Vec3) Vec3, tol float64) {
	t.Helper()
	s := tr.Samples
	if len(s.Arcs) != len(s.Points) || len(s.Vectors) != len(s.Points) || len(s.Normals) != len(s.Points) || len(s.Tangents) != len(s.Points) {
		t.Fatalf("%s: arrays of %d, %d, %d, %d and %d", what, len(s.Arcs), len(s.Points), len(s.Vectors), len(s.Normals), len(s.Tangents))
	}
	worstNorm, worstTangency := 0.0, 0.0
	for k, v := range s.Vectors {
		n := normal(s.Points[k])
		nearVec(t, what+" normal", s.Normals[k], n, 1e-9)
		worstNorm = math.Max(worstNorm, math.Abs(v.norm()-1))
		worstTangency = math.Max(worstTangency, math.Abs(v.dot(n)))
		if k > 0 && !(s.Arcs[k] > s.Arcs[k-1]) {
			t.Fatalf("%s: arcs not increasing at %d: %g then %g", what, k, s.Arcs[k-1], s.Arcs[k])
		}
	}
	if worstNorm > tol || worstTangency > tol {
		t.Fatalf("%s: norm drift %.3g, tangency %.3g", what, worstNorm, worstTangency)
	}
	// The engine's own normal and its fused arithmetic can differ from
	// these by a rounding error.
	if tr.Drift.Norm < worstNorm-1e-15 || tr.Drift.Tangency < worstTangency-1e-15 || tr.Drift.Norm > tol || tr.Drift.Tangency > tol {
		t.Fatalf("%s: drift reported %+v, measured %.3g and %.3g", what, tr.Drift, worstNorm, worstTangency)
	}
}

// The octant triangle: three quarter great circles from (r, 0, 0) to
// (0, r, 0), (0, 0, r) and back. On each, the carried vector is the vector
// it arrived with, rigidly rotated about that arc's axis; a corner keeps
// it. Whatever its first angle, it comes home turned +π/2 about the
// outward normal, the area of the octant on a sphere of curvature 1/r².
func TestOctantTriangleHolonomy(t *testing.T) {
	const r = 1.7
	e := []Vec3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	quarter := math.Pi * r / 2
	for _, alpha := range []float64{0, 30, 90, -120, 400} {
		for _, n := range []int{300, 301, 10} {
			tr := transported(t, carry(launch(sphere(r, 24, 24), 0.3, 0.2, 10, 0, 1, 1, n), "triangle", alpha, 0))
			if tr.Path != "triangle" || tr.Unavailable != "" || tr.Reason != "end" {
				t.Fatalf("α = %g: %s %q %s", alpha, tr.Path, tr.Unavailable, tr.Reason)
			}
			if math.Abs(tr.Length-3*quarter) > 1e-15*r || tr.Reached != tr.Length {
				t.Fatalf("length %g reached %g, want %g", tr.Length, tr.Reached, 3*quarter)
			}
			tangentUnit(t, "triangle", tr, func(p Vec3) Vec3 { return p.mul(1 / r) }, 1e-14)
			s := tr.Samples
			// N + 1 samples at kL/N, with each corner one of them or
			// inserted where it falls between two.
			want := n + 1
			if n%3 != 0 {
				want += 2
			}
			if len(s.Points) != want || len(tr.Corners) != 2 {
				t.Fatalf("N = %d: %d samples and corners %v", n, len(s.Points), tr.Corners)
			}
			b := alpha * math.Pi / 180
			// At (r, 0, 0) the path heads along +y; N × T is +z.
			v := e[1].mul(math.Cos(b)).add(e[2].mul(math.Sin(b)))
			side := 0
			for k, arc := range s.Arcs {
				// A corner belongs to the side arriving at it.
				for side < 2 && arc > float64(side+1)*quarter*(1+1e-14) {
					v = rotate(v, e[side].cross(e[(side+1)%3]), math.Pi/2)
					side++
				}
				from, to := e[side], e[(side+1)%3]
				sigma := arc - float64(side)*quarter
				p := from.mul(r * math.Cos(sigma/r)).add(to.mul(r * math.Sin(sigma/r)))
				tg := from.mul(-math.Sin(sigma / r)).add(to.mul(math.Cos(sigma / r)))
				nearVec(t, "triangle point", s.Points[k], p, 1e-14*r)
				nearVec(t, "triangle tangent", s.Tangents[k], tg, 1e-14)
				nearVec(t, "rigid rotation", s.Vectors[k], rotate(v, from.cross(to), sigma/r), 1e-14)
			}
			for j, k := range tr.Corners {
				if s.Arcs[k] != float64(j+1)*quarter {
					t.Fatalf("corner %d at %.17g, want %.17g", j, s.Arcs[k], float64(j+1)*quarter)
				}
				nearVec(t, "corner", s.Points[k], e[j+1].mul(r), 1e-14*r)
				// Its tangent is the arriving side's, toward the corner.
				nearVec(t, "arriving tangent", s.Tangents[k], e[j].mul(-1), 1e-14)
			}
			last := s.Vectors[len(s.Vectors)-1]
			start := s.Vectors[0]
			nearVec(t, "returned", last, rotate(start, e[0], math.Pi/2), 1e-14)
			if !tr.Returns || math.Abs(tr.Holonomy-math.Pi/2) > 1e-14 {
				t.Fatalf("α = %g: returns %v, holonomy %.17g", alpha, tr.Returns, tr.Holonomy)
			}
		}
	}
	// Starting along +y, the arrow comes home along +z.
	tr := transported(t, carry(launch(sphere(r, 24, 24), 0, 0, 0, 0, 1, 1, 90), "triangle", 0, 0))
	nearVec(t, "first", tr.Samples.Vectors[0], e[1], 0)
	nearVec(t, "home", tr.Samples.Vectors[len(tr.Samples.Vectors)-1], e[2], 1e-15)
}

// Along a sphere's great circle the carried vector rotates rigidly about
// the circle's axis, including over a pole and from one; a whole circle
// brings it back unturned.
func TestSphereThreadTransport(t *testing.T) {
	const r = 1.3
	for _, at := range []struct{ u, v, beta, alpha float64 }{
		{1, 0.3, 90, 0}, {1, 0.3, 90, 70}, {2, -1.2, -140, -35}, {1, math.Pi / 2, 0, 120}, {5, -math.Pi / 2, 200, 10},
	} {
		c := carry(launch(sphere(r, 24, 24), at.u, at.v, at.beta, 0, 1, 2*math.Pi*r, 400), "thread", at.alpha, 0)
		tr := transported(t, c)
		th := threads(t, c).Threads[0]
		tangentUnit(t, "sphere thread", tr, func(p Vec3) Vec3 { return p.mul(1 / r) }, 1e-13)
		p0, eu, ev := sphereChart(r, at.u, at.v)
		b, a := at.beta*math.Pi/180, at.alpha*math.Pi/180
		t0 := eu.mul(math.Cos(b)).add(ev.mul(math.Sin(b)))
		axis := p0.cross(t0).mul(1 / r)
		v0 := t0.mul(math.Cos(a)).add(axis.mul(math.Sin(a)))
		if len(tr.Samples.Points) != 401 {
			t.Fatalf("%d samples", len(tr.Samples.Points))
		}
		for k, arc := range tr.Samples.Arcs {
			if arc != float64(k)*th.Reached/400 && math.Abs(arc-float64(k)*th.Reached/400) > 1e-15*r {
				t.Fatalf("sample %d at arc %g", k, arc)
			}
			nearVec(t, "on the thread", tr.Samples.Points[k], th.Points[k], 1e-13*r)
			nearVec(t, "thread tangent", tr.Samples.Tangents[k], th.Tangents[k], 1e-13)
			nearVec(t, "rigid rotation", tr.Samples.Vectors[k], rotate(v0, axis, arc/r), 1e-12)
		}
		if !tr.Returns || math.Abs(tr.Holonomy) > 1e-12 {
			t.Fatalf("%+v: a whole great circle returns unturned: %v, %g", at, tr.Returns, tr.Holonomy)
		}
	}
	// Short of a whole circle, it does not return.
	tr := transported(t, carry(launch(sphere(r, 24, 24), 1, 0.3, 90, 0, 1, 0.999*2*math.Pi*r, 100), "thread", 30, 0))
	if tr.Returns {
		t.Fatal("0.999 of a great circle should not return")
	}
}

// Retracing a path backward with the arrow it arrived with recovers the
// arrow it left with, on both surfaces.
func TestTransportInverseTraversal(t *testing.T) {
	for _, c := range []struct {
		name  string
		base  Request
		tol   float64
		chart func(u, v float64) (Vec3, Vec3, Vec3)
	}{
		{"sphere", sphere(1.3, 24, 24), 1e-12, func(u, v float64) (Vec3, Vec3, Vec3) { return sphereChart(1.3, u, v) }},
		{"torus", torusPatch(2, 0.8, 24, 24), 1e-6, func(u, v float64) (Vec3, Vec3, Vec3) { return torusChart(2, 0.8, u, v) }},
	} {
		const alpha = 37.0
		out := transported(t, carry(launch(c.base, 0.4, -0.3, 70, 0, 1, 23, 800), "thread", alpha, 0))
		th := threads(t, launch(c.base, 0.4, -0.3, 70, 0, 1, 23, 800)).Threads[0]
		last := len(th.Points) - 1
		u, v := th.EndU, th.EndV
		if c.name == "sphere" {
			// The end's chart point on the sphere.
			p := th.End
			u, v = math.Atan2(p.Y, p.X), math.Asin(p.Z/1.3)
		}
		_, eu, ev := c.chart(u, v)
		back := th.Tangents[last].mul(-1)
		beta := math.Atan2(back.dot(ev), back.dot(eu)) * 180 / math.Pi
		// Reversing the path turns the arrow's angle from it by 180°.
		again := transported(t, carry(launch(c.base, u, v, beta, 0, 1, 23, 800), "thread", alpha+180, 0))
		// The arrow is integrated on its own, so on the torus it arrives
		// within the integration's accuracy of the thread's end.
		nearVec(t, c.name+" retraced arrival", again.Samples.Vectors[0], out.Samples.Vectors[last], c.tol/1000)
		end := len(again.Samples.Vectors) - 1
		nearVec(t, c.name+" recovered", again.Samples.Vectors[end], out.Samples.Vectors[0], c.tol)
	}
}

// On the torus the arrow is integrated with the thread; along a geodesic it
// keeps its angle to the thread, while staying a unit tangent vector. The
// fan itself is unchanged, and the thread's chart can be shifted by whole
// turns without changing the arrow.
func TestTorusThreadTransport(t *testing.T) {
	const R, r = 2.0, 0.8
	normal := func(p Vec3) Vec3 { return torusNormal(R, r, p) }
	for _, alpha := range []float64{0, 90, -63} {
		plain := launch(torusPatch(R, r, 24, 24), 0.4, -0.3, 60, 40, 3, 80, 4000)
		plain.Surface.Geodesics.Selected = 2
		c := carry(plain, "thread", alpha, 0)
		tr := transported(t, c)
		g := threads(t, c)
		th := g.Threads[1]
		if tr.Reason != "end" || tr.Steps == 0 || tr.Reached != 80 || len(tr.Samples.Points) != 4001 {
			t.Fatalf("α = %g: %s after %d steps at %g with %d samples", alpha, tr.Reason, tr.Steps, tr.Reached, len(tr.Samples.Points))
		}
		tangentUnit(t, "torus thread", tr, normal, 1e-9)
		a := alpha * math.Pi / 180
		for k, p := range tr.Samples.Points {
			nearVec(t, "on the thread", p, th.Points[k], 1e-9)
			tg := tr.Samples.Tangents[k]
			nearVec(t, "thread tangent", tg, th.Tangents[k], 1e-9)
			v := tr.Samples.Vectors[k]
			left := normal(p).cross(tg)
			if math.Abs(v.dot(tg)-math.Cos(a)) > 1e-9 || math.Abs(v.dot(left)-math.Sin(a)) > 1e-9 {
				t.Fatalf("α = %g: sample %d turns from the thread: %.12g, %.12g", alpha, k, v.dot(tg), v.dot(left))
			}
		}
		// The fan is the one launched without the arrow.
		alone := threads(t, plain)
		if !reflect.DeepEqual(alone.Threads, g.Threads) || alone.Steps != g.Steps {
			t.Fatalf("α = %g: the arrow changed the fan", alpha)
		}
		// Whole turns of either chart coordinate change nothing.
		for _, shift := range [][2]float64{{2 * math.Pi, 0}, {0, -2 * math.Pi}, {-4 * math.Pi, 2 * math.Pi}} {
			moved := plain
			mg := *plain.Surface.Geodesics
			mg.U += shift[0]
			mg.V += shift[1]
			moved.Surface.Geodesics = &mg
			other := transported(t, carry(moved, "thread", alpha, 0))
			if len(other.Samples.Points) != len(tr.Samples.Points) {
				t.Fatalf("shift %v: %d samples", shift, len(other.Samples.Points))
			}
			for k := range tr.Samples.Points {
				nearVec(t, "shifted chart", other.Samples.Points[k], tr.Samples.Points[k], 1e-8)
				nearVec(t, "shifted chart arrow", other.Samples.Vectors[k], tr.Samples.Vectors[k], 1e-8)
			}
		}
	}
	// A closed geodesic, the outer equator, brings the arrow home unturned.
	tr := transported(t, carry(launch(torusPatch(R, r, 24, 24), 0, 0, 0, 0, 1, 2*math.Pi*(R+r), 360), "thread", 50, 0))
	if !tr.Returns || math.Abs(tr.Holonomy) > 1e-9 {
		t.Fatalf("outer equator: returns %v, holonomy %g", tr.Returns, tr.Holonomy)
	}
}

// Tightening the tolerance makes the carried arrow converge, with more
// steps; the default leaves it well within its stated accuracy.
func TestTorusTransportConvergence(t *testing.T) {
	defer func(saved float64) { geodesicTolerance = saved }(geodesicTolerance)
	const R, r = 1.3, 1
	study := carry(launch(torusPatch(R, r, 24, 24), 0.1, 2.5, 37, 0, 1, 60, 600), "thread", 75, 0)
	geodesicTolerance = 1e-14
	reference := transported(t, study)
	previous, steps := math.Inf(1), 0
	drifts := []float64{}
	for _, tol := range []float64{1e-6, 1e-8, 1e-10, 1e-12} {
		geodesicTolerance = tol
		tr := transported(t, study)
		drifts = append(drifts, tr.Drift.Norm)
		e := tr.Samples.Vectors[600].sub(reference.Samples.Vectors[600]).norm()
		t.Logf("tolerance %g: %d steps, arrow error %.3g", tol, tr.Steps, e)
		if !(e < previous/20) || tr.Steps <= steps {
			t.Fatalf("tolerance %g: arrow error %.3g after %d steps does not improve on %.3g after %d", tol, e, tr.Steps, previous, steps)
		}
		previous, steps = e, tr.Steps
	}
	if previous > 1e-9 {
		t.Fatalf("the default tolerance leaves an arrow error of %.3g", previous)
	}
	// The reported drift measures the integration, which nothing
	// renormalizes: loose steps let the length wander, tight ones do not.
	if !(drifts[0] > 1e-8 && drifts[3] < drifts[0]/1000) {
		t.Fatalf("norm drift %v does not follow the tolerance", drifts)
	}
}

// A thread's arrow comes home only when the path ends at its start heading
// the way it started; then its turn is measured about the start's normal.
func TestTransportReturnNeedsPositionAndDirection(t *testing.T) {
	n := Vec3{1, 0, 0}
	for _, c := range []struct {
		end, tangent Vec3
		returns      bool
	}{
		{Vec3{2, 0, 0}, Vec3{0, 1, 0}, true},
		{Vec3{2, 0, 0}, Vec3{0, 0, 1}, false},
		{Vec3{2, 0, 3e-6}, Vec3{0, 1, 0}, false},
	} {
		tr := TransportResult{Path: "thread", Reason: "end", Samples: TransportSamples{
			Points:   []Vec3{{2, 0, 0}, {0, 2, 0}, c.end},
			Tangents: []Vec3{{0, 1, 0}, {-1, 0, 0}, c.tangent},
			Vectors:  []Vec3{{0, 1, 0}, {0, 0, 1}, {0, 0, 1}},
			Normals:  []Vec3{n, {0, 1, 0}, n},
		}}
		tr.finish(2)
		if tr.Returns != c.returns {
			t.Fatalf("end %v heading %v: returns %v", c.end, c.tangent, tr.Returns)
		}
		if c.returns && math.Abs(tr.Holonomy-math.Pi/2) > 1e-15 {
			t.Fatalf("holonomy %g", tr.Holonomy)
		}
		if !c.returns && tr.Holonomy != 0 {
			t.Fatalf("a path that does not return has no holonomy, got %g", tr.Holonomy)
		}
	}
}

// Samples between the integration's steps, and a final length that ends
// part way through a step, give the arrow a run of exactly that length
// ends with; every sample is kept, the last at the end state.
func TestTransportOffGridAndPartialLengths(t *testing.T) {
	const R, r = 2.0, 0.8
	long := transported(t, carry(launch(torusPatch(R, r, 24, 24), 0.4, -0.3, 70, 0, 1, 30, 97), "thread", 20, 0))
	for _, k := range []int{1, 13, 50, 96} {
		short := transported(t, carry(launch(torusPatch(R, r, 24, 24), 0.4, -0.3, 70, 0, 1, long.Samples.Arcs[k], 9), "thread", 20, 0))
		last := len(short.Samples.Vectors) - 1
		nearVec(t, "sample against a run of its length", long.Samples.Vectors[k], short.Samples.Vectors[last], 1e-9)
		nearVec(t, "its point", long.Samples.Points[k], short.Samples.Points[last], 1e-9)
	}
	for _, c := range []struct {
		length  float64
		samples int
	}{{0.1, 12}, {0.7, 187}, {7.7, 13}, {4 * math.Pi, 13}} {
		tr := transported(t, carry(launch(torusPatch(R, r, 24, 24), 0.4, -0.3, 70, 0, 1, c.length, c.samples), "thread", 20, 0))
		if tr.Reason != "end" || len(tr.Samples.Points) != c.samples+1 || tr.Samples.Arcs[c.samples] != tr.Reached {
			t.Fatalf("L = %g, N = %d: %s with %d samples, last at %g", c.length, c.samples, tr.Reason, len(tr.Samples.Points), tr.Samples.Arcs[len(tr.Samples.Arcs)-1])
		}
	}
}

// Reference arrows stand at s = jL/M for j = 0…M − 1, evaluated there, not
// borrowed from the nearest sample.
func TestTransportReferences(t *testing.T) {
	const r = 1.3
	quarter := math.Pi * r / 2
	tri := transported(t, carry(launch(sphere(r, 24, 24), 0, 0, 0, 0, 1, 1, 100), "triangle", 0, 3))
	want := []Vec3{{0, 1, 0}, {-1, 0, 0}, {-1, 0, 0}}
	// The drawn length travels with the result, for the drawing.
	if tri.Size != 0.3 {
		t.Fatalf("size %g", tri.Size)
	}
	if len(tri.References.Arcs) != 3 {
		t.Fatalf("%d references", len(tri.References.Arcs))
	}
	for j, v := range want {
		if math.Abs(tri.References.Arcs[j]-float64(j)*quarter) > 1e-15 {
			t.Fatalf("reference %d at %g", j, tri.References.Arcs[j])
		}
		nearVec(t, "triangle reference", tri.References.Vectors[j], v, 1e-15)
		nearVec(t, "its point", tri.References.Points[j], []Vec3{{r, 0, 0}, {0, r, 0}, {0, 0, r}}[j], 1e-15)
	}
	// On the torus each matches a run of exactly its length.
	const R, rt = 2.0, 0.8
	tr := transported(t, carry(launch(torusPatch(R, rt, 24, 24), 0.4, -0.3, 70, 0, 1, 30, 97), "thread", 20, 7))
	if len(tr.References.Arcs) != 7 || len(tr.References.Normals) != 7 {
		t.Fatalf("%d references", len(tr.References.Arcs))
	}
	for j := 1; j < 7; j++ {
		arc := 30 * float64(j) / 7
		if math.Abs(tr.References.Arcs[j]-arc) > 1e-14 {
			t.Fatalf("reference %d at %g, want %g", j, tr.References.Arcs[j], arc)
		}
		short := transported(t, carry(launch(torusPatch(R, rt, 24, 24), 0.4, -0.3, 70, 0, 1, tr.References.Arcs[j], 9), "thread", 20, 0))
		last := len(short.Samples.Vectors) - 1
		nearVec(t, "torus reference", tr.References.Vectors[j], short.Samples.Vectors[last], 1e-9)
		nearVec(t, "its normal", tr.References.Normals[j], torusNormal(R, rt, tr.References.Points[j]), 1e-9)
	}
	if none := transported(t, carry(launch(sphere(r, 24, 24), 0, 0, 0, 0, 1, 1, 100), "triangle", 0, 0)); len(none.References.Arcs) != 0 {
		t.Fatalf("no references asked, %d drawn", len(none.References.Arcs))
	}
}

// The arrow's integration is one more share of the fan's budget; one that
// runs out or cannot continue stops, says so, and keeps nothing beyond.
func TestTransportStops(t *testing.T) {
	defer func(saved int) { maxGeodesicSteps = saved }(maxGeodesicSteps)
	defer func(saved float64) { geodesicTolerance = saved }(geodesicTolerance)
	maxGeodesicSteps = 1200
	c := carry(launch(torusPatch(2, 0.8, 24, 24), 0.4, -0.3, 23, 20, 3, 80, 400), "thread", 10, 5)
	g := threads(t, c)
	tr := g.Transport
	for k, th := range g.Threads {
		if th.Steps != 300 || th.Reason != "exhausted" {
			t.Fatalf("thread %d: %s after %d steps", k, th.Reason, th.Steps)
		}
	}
	if tr.Reason != "exhausted" || tr.Steps != 300 || !(tr.Reached > 0 && tr.Reached < 80) || tr.Returns {
		t.Fatalf("arrow: %s after %d steps at %g", tr.Reason, tr.Steps, tr.Reached)
	}
	s := tr.Samples
	if s.Arcs[len(s.Arcs)-1] != tr.Reached || s.Arcs[len(s.Arcs)-2] >= tr.Reached {
		t.Fatalf("the arrow's last sample is at %g, its stop at %g", s.Arcs[len(s.Arcs)-1], tr.Reached)
	}
	if n := int(math.Floor(tr.Reached/(80.0/400))) + 2; len(s.Arcs) != n {
		t.Fatalf("%d samples for a stop at %g, want %d", len(s.Arcs), tr.Reached, n)
	}
	for _, arc := range tr.References.Arcs {
		if arc > tr.Reached {
			t.Fatalf("a reference at %g lies beyond the stop at %g", arc, tr.Reached)
		}
	}
	tangentUnit(t, "exhausted", tr, func(p Vec3) Vec3 { return torusNormal(2, 0.8, p) }, 1e-9)
	// A tolerance no step can meet leaves the arrow unresolved at its start.
	maxGeodesicSteps = 200000
	geodesicTolerance = 1e-40
	tr = transported(t, carry(launch(torusPatch(2, 0.8, 24, 24), 0.4, -0.3, 23, 0, 1, 80, 400), "thread", 10, 0))
	if tr.Reason != "unresolved" || tr.Reached != 0 || len(tr.Samples.Points) != 1 || tr.Returns {
		t.Fatalf("unresolved: %s at %g with %d samples", tr.Reason, tr.Reached, len(tr.Samples.Points))
	}
}

// The triangle is drawn on a sphere only; a torus says so and keeps its
// fan. Fields refuse by name, and the arrow's path counts toward the fan's
// points.
func TestTransportValidation(t *testing.T) {
	g := threads(t, carry(launch(torusPatch(2, 0.8, 24, 24), 0, 0, 0, 30, 4, 10, 100), "triangle", 0, 0))
	if g.Transport == nil || g.Transport.Unavailable == "" || len(g.Transport.Samples.Points) != 0 || len(g.Threads) != 4 {
		t.Fatalf("a triangle on a torus: %+v", g.Transport)
	}
	ok := func() Request {
		return carry(launch(torusPatch(2, 0.8, 24, 24), 0, 0, 0, 30, 4, 10, 100), "thread", 0, 3)
	}
	for _, c := range []struct {
		field string
		edit  func(*GeodesicRequest)
	}{
		{"surface.geodesics.transport.path", func(g *GeodesicRequest) { g.Transport.Path = "square" }},
		{"surface.geodesics.transport.angle", func(g *GeodesicRequest) { g.Transport.Angle = math.NaN() }},
		{"surface.geodesics.transport.angle", func(g *GeodesicRequest) { g.Transport.Angle = 2e5 }},
		{"surface.geodesics.transport.size", func(g *GeodesicRequest) { g.Transport.Size = 0 }},
		{"surface.geodesics.transport.size", func(g *GeodesicRequest) { g.Transport.Size = math.Inf(1) }},
		{"surface.geodesics.transport.size", func(g *GeodesicRequest) { g.Transport.Size = 2e5 }},
		{"surface.geodesics.transport.arrows", func(g *GeodesicRequest) { g.Transport.Arrows = -1 }},
		{"surface.geodesics.transport.arrows", func(g *GeodesicRequest) { g.Transport.Arrows = maxTransportArrows + 1 }},
		// 31 threads of 6,249 samples fit alone, but not with the arrow's.
		{"surface.geodesics.samples", func(g *GeodesicRequest) { g.Count, g.Selected, g.Samples = 31, 1, 6249 }},
	} {
		q := ok()
		c.edit(q.Surface.Geodesics)
		_, err := Compute(q)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Fatalf("%s: got %v", c.field, err)
		}
	}
	q := ok()
	q.Surface.Geodesics.Count, q.Surface.Geodesics.Samples, q.Surface.Geodesics.Length = 31, 6248, 1
	if _, err := Compute(q); err != nil {
		t.Fatal(err)
	}
	q.Surface.Geodesics.Transport = nil
	q.Surface.Geodesics.Samples = 6249
	if _, err := Compute(q); err != nil {
		t.Fatal(err)
	}
	// A surface without threads has no arrow either.
	if with := surfaced(t, carry(launch(surfaceStudy("cylinder", 1, 1, 0, 0, 2*math.Pi, -1, 1, 24, 24), 0, 0, 0, 0, 1, 1, 10), "thread", 0, 0)); with.Geodesics.Transport != nil {
		t.Fatal("unavailable threads carry no arrow")
	}
}
