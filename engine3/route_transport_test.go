package engine3

import (
	"math"
	"reflect"
	"testing"
)

// An arrow carried along threads on the routes S09.1 and S09.2 admitted:
// the cylinder, the paraboloid and the helicoid–catenoid family within
// their patches, and the three-axis ellipsoid over its whole surface. Each
// is checked with normals and parallel fields written out here: a carried
// vector stays a unit tangent vector and keeps its angle to a geodesic; on
// a cylinder it also keeps its angle to the rulings, which are parallel;
// on the family its chart components are the same at every angle; and at
// equal axes the ellipsoid's integration matches the sphere's rotation.

// cylinderNormal is the outward unit normal of the cylinder of semi-axes a
// and b at p.
func cylinderNormal(a, b float64) func(Vec3) Vec3 {
	return func(p Vec3) Vec3 {
		n := Vec3{p.X / (a * a), p.Y / (b * b), 0}
		return n.mul(1 / n.norm())
	}
}

// paraboloidNormal is the upward unit normal of z = (k₁x² + k₂y²)/2.
func paraboloidNormal(k1, k2 float64) func(Vec3) Vec3 {
	return func(p Vec3) Vec3 {
		n := Vec3{-k1 * p.X, -k2 * p.Y, 1}
		return n.mul(1 / n.norm())
	}
}

// ellipsoidOutward is the outward unit normal of the ellipsoid at p.
func ellipsoidOutward(a, b, c float64) func(Vec3) Vec3 {
	return func(p Vec3) Vec3 {
		n := Vec3{p.X / (a * a), p.Y / (b * b), p.Z / (c * c)}
		return n.mul(1 / n.norm())
	}
}

// keepsAngle checks the arrow lies on the selected thread and keeps the
// angle alpha from its tangent toward N × T, to tol.
func keepsAngle(t *testing.T, what string, tr *TransportResult, th GeodesicThread, normal func(Vec3) Vec3, alpha, tol float64) {
	t.Helper()
	keepsAngleBy(t, what, tr, th, func(_ int, p Vec3) Vec3 { return normal(p) }, alpha, tol)
}

// keepsAngleBy is keepsAngle with the normal at sample k, which also checks
// the arrow is a unit tangent vector there.
func keepsAngleBy(t *testing.T, what string, tr *TransportResult, th GeodesicThread, normal func(k int, p Vec3) Vec3, alpha, tol float64) {
	t.Helper()
	a := alpha * math.Pi / 180
	for k, p := range tr.Samples.Points {
		if k < len(th.Points) {
			nearVec(t, what+" on the thread", p, th.Points[k], 1e3*tol)
		}
		tg := tr.Samples.Tangents[k]
		v := tr.Samples.Vectors[k]
		n := normal(k, p)
		if math.Abs(v.norm()-1) > tol || math.Abs(v.dot(n)) > tol {
			t.Fatalf("%s: sample %d is not a unit tangent vector: |V| − 1 = %.3g, V·N = %.3g", what, k, v.norm()-1, v.dot(n))
		}
		left := n.cross(tg)
		if math.Abs(v.dot(tg)-math.Cos(a)) > tol || math.Abs(v.dot(left)-math.Sin(a)) > tol {
			t.Fatalf("%s: sample %d turns from the thread: %.12g, %.12g", what, k, v.dot(tg), v.dot(left))
		}
	}
}

// On a cylinder, flat with parallel rulings, the arrow keeps its height
// component V·ẑ, its angle to the rulings, along every route, including
// across the seam and to where it leaves through the top; it stops there
// with its thread.
func TestCylinderTransport(t *testing.T) {
	const a, b = 1.5, 0.8
	normal := cylinderNormal(a, b)
	for _, c := range []struct {
		beta, alpha float64
		reason      string
	}{{30, 50, "edge"}, {2, -110, "end"}, {-80, 200, "edge"}} {
		plain := launch(cylinderStudy(a, b, 0, 2*math.Pi, -2, 3), 0.4, 0.5, c.beta, 0, 1, 40, 2000)
		study := carry(plain, "thread", c.alpha, 6)
		g := threads(t, study)
		tr := g.Transport
		th := g.Threads[0]
		if tr == nil || tr.Unavailable != "" || tr.Reason != c.reason || th.Reason != c.reason {
			t.Fatalf("β = %g: %+v", c.beta, tr)
		}
		if math.Abs(tr.Reached-th.Reached) > 1e-8 || tr.Edge != th.Edge || tr.Steps == 0 {
			t.Fatalf("β = %g: the arrow stops at %g on %q after %d steps, its thread at %g on %q", c.beta, tr.Reached, tr.Edge, tr.Steps, th.Reached, th.Edge)
		}
		tangentUnit(t, "cylinder", tr, normal, 1e-9)
		keepsAngle(t, "cylinder", tr, th, normal, c.alpha, 1e-9)
		z0 := tr.Samples.Vectors[0].Z
		for k, v := range tr.Samples.Vectors {
			if math.Abs(v.Z-z0) > 1e-9 {
				t.Fatalf("β = %g: sample %d turns from the rulings: V·ẑ %g, first %g", c.beta, k, v.Z, z0)
			}
		}
		for j, v := range tr.References.Vectors {
			if math.Abs(v.Z-z0) > 1e-9 || tr.References.Arcs[j] > tr.Reached {
				t.Fatalf("β = %g: reference %d at %g: V·ẑ %g", c.beta, j, tr.References.Arcs[j], v.Z)
			}
		}
		// It ends where it stopped, on the top or bottom: at 30° exactly at a
		// sample, s = 5, which keeps that sample rather than one 10⁻⁹ of a
		// spacing from it.
		if c.reason == "edge" {
			last := len(tr.Samples.Points) - 1
			if math.Abs(tr.Samples.Arcs[last]-tr.Reached) > 1e-9*40.0/2000 || math.Abs(tr.Samples.Points[last].Z-3) > 1e-12 && math.Abs(tr.Samples.Points[last].Z+2) > 1e-12 {
				t.Fatalf("β = %g: the arrow's last sample at %g, z = %g", c.beta, tr.Samples.Arcs[last], tr.Samples.Points[last].Z)
			}
		}
		// The fan is the one launched without the arrow.
		alone := threads(t, plain)
		if !reflect.DeepEqual(alone.Threads, g.Threads) || alone.Steps != g.Steps {
			t.Fatalf("β = %g: the arrow changed the fan", c.beta)
		}
	}
	// A start on the bottom edge heading down stops at once.
	tr := transported(t, carry(launch(cylinderStudy(a, b, 0, 2*math.Pi, -2, 3), 0.4, -2, -60, 0, 1, 10, 100), "thread", 20, 3))
	if tr.Reason != "edge" || tr.Edge != "vMin" || tr.Reached != 0 || len(tr.Samples.Points) != 1 || len(tr.References.Points) != 1 {
		t.Fatalf("a start heading out: %s on %q at %g with %d samples", tr.Reason, tr.Edge, tr.Reached, len(tr.Samples.Points))
	}
	// The parallel circle round a whole turn ends where it started, only
	// a near-return: the angle the arrow is turned there is measured.
	ring := transported(t, carry(launch(cylinderStudy(1, 1, 0, 2*math.Pi, -2, 3), 0, 0, 0, 0, 1, 2*math.Pi, 720), "thread", 40, 0))
	if !ring.Returns || math.Abs(ring.Holonomy) > 1e-9 || ring.Area != 0 {
		t.Fatalf("whole parallel: returns %v, turned %g, area %g", ring.Returns, ring.Holonomy, ring.Area)
	}
}

// On a paraboloid the arrow is a unit tangent vector at a constant angle
// to its thread, which leaves the patch through an edge.
func TestParaboloidTransport(t *testing.T) {
	for _, k := range [][2]float64{{1, 1}, {1.5, -0.7}, {0.4, 2}} {
		normal := paraboloidNormal(k[0], k[1])
		plain := launch(paraboloid(k[0], k[1], -1.5, 1.5, -1, 1.2), 0.2, -0.3, 35, 0, 1, 12, 1500)
		g := threads(t, carry(plain, "thread", -70, 4))
		tr, th := g.Transport, g.Threads[0]
		if tr.Unavailable != "" || tr.Reason != th.Reason || tr.Edge != th.Edge || math.Abs(tr.Reached-th.Reached) > 1e-8 {
			t.Fatalf("k = %v: arrow %s on %q at %g, thread %s on %q at %g", k, tr.Reason, tr.Edge, tr.Reached, th.Reason, th.Edge, th.Reached)
		}
		tangentUnit(t, "paraboloid", tr, normal, 1e-9)
		keepsAngle(t, "paraboloid", tr, th, normal, -70, 1e-9)
		if alone := threads(t, plain); !reflect.DeepEqual(alone.Threads, g.Threads) {
			t.Fatalf("k = %v: the arrow changed the fan", k)
		}
	}
}

// partials are X_u and X_v of the family at (u, v), by central differences
// of the chart written out in associateX.
func partials(s, theta, u, v float64) (Vec3, Vec3) {
	const h = 1e-6
	xu := associateX(s, theta, u+h, v).sub(associateX(s, theta, u-h, v)).mul(1 / (2 * h))
	xv := associateX(s, theta, u, v+h).sub(associateX(s, theta, u, v-h)).mul(1 / (2 * h))
	return xu, xv
}

// components solves V = c X_u + d X_v.
func components(xu, xv, v Vec3) (float64, float64) {
	e, f, g := xu.dot(xu), xu.dot(xv), xv.dot(xv)
	p, q := xu.dot(v), xv.dot(v)
	det := e*g - f*f
	return (g*p - f*q) / det, (e*q - f*p) / det
}

// On every member of the helicoid–catenoid family the arrow keeps its
// angle to the thread, and, the members being isometric, its components
// in the chart are the same at every angle while it moves in space.
func TestAssociateTransportAcrossAngles(t *testing.T) {
	const s = 1.2
	type chart struct{ c, d []float64 }
	var first *chart
	var firstTr *TransportResult
	for _, theta := range []float64{0, 0.7, math.Pi / 2} {
		g := threads(t, carry(launch(associateStudy(s, theta, -0.85*math.Pi, 0.85*math.Pi, -1.2, 1.2, 24, 24), -1, 0.2, 40, 0, 1, 25, 1200), "thread", 65, 0))
		tr, th := g.Transport, g.Threads[0]
		if tr.Unavailable != "" || tr.Reason != "edge" || tr.Edge != th.Edge {
			t.Fatalf("θ = %g: %s on %q (%s)", theta, tr.Reason, tr.Edge, tr.Unavailable)
		}
		// The family's normal at the thread's chart point, or where it
		// stopped.
		normal := func(k int, _ Vec3) Vec3 {
			if k < len(th.U) {
				return gaussMap(th.U[k], th.V[k])
			}
			return gaussMap(th.EndU, th.EndV)
		}
		keepsAngleBy(t, "family", tr, th, normal, 65, 1e-8)
		cur := &chart{}
		for k := range th.Points {
			xu, xv := partials(s, theta, th.U[k], th.V[k])
			c, d := components(xu, xv, tr.Samples.Vectors[k])
			cur.c, cur.d = append(cur.c, c), append(cur.d, d)
		}
		if first == nil {
			first, firstTr = cur, tr
			continue
		}
		if len(cur.c) != len(first.c) {
			t.Fatalf("θ = %g: %d samples, at 0 %d", theta, len(cur.c), len(first.c))
		}
		for k := range cur.c {
			if math.Abs(cur.c[k]-first.c[k]) > 1e-7 || math.Abs(cur.d[k]-first.d[k]) > 1e-7 {
				t.Fatalf("θ = %g sample %d: chart components (%g, %g), at 0 (%g, %g)", theta, k, cur.c[k], cur.d[k], first.c[k], first.d[k])
			}
		}
		if mid := len(cur.c) / 2; theta > 1 && tr.Samples.Vectors[mid].sub(firstTr.Samples.Vectors[mid]).norm() < 0.1 {
			t.Fatalf("θ = %g: the arrow did not move in space", theta)
		}
	}
}

// At equal axes the ellipsoid's integration carries the arrow as the
// sphere's rigid rotation does.
func TestEllipsoidTransportAtEqualAxes(t *testing.T) {
	const r = 1.3
	for _, at := range []struct{ u, v, beta, alpha float64 }{{0.3, 0.2, 35, 80}, {2, -1.1, 120, -20}, {4, math.Pi / 2, 10, 190}} {
		q := carry(launch(sphere(r, 24, 24), at.u, at.v, at.beta, 0, 1, 9, 300), "thread", at.alpha, 5)
		g := *q.Surface.Geodesics
		exact := &TransportResult{Samples: newTransportSamples(), References: newTransportSamples()}
		sphereTransport(exact, r, g, at.beta, at.alpha*math.Pi/180, 5)
		tr := &TransportResult{Samples: newTransportSamples(), References: newTransportSamples()}
		q.Surface.ellipsoidTransport(tr, g, at.beta, at.alpha*math.Pi/180, 5, maxGeodesicSteps)
		if tr.Reason != "end" || len(tr.Samples.Points) != len(exact.Samples.Points) || len(tr.References.Points) != 5 {
			t.Fatalf("%+v: %s with %d samples", at, tr.Reason, len(tr.Samples.Points))
		}
		for k := range tr.Samples.Points {
			nearVec(t, "point", tr.Samples.Points[k], exact.Samples.Points[k], 1e-9*r)
			nearVec(t, "arrow", tr.Samples.Vectors[k], exact.Samples.Vectors[k], 1e-9)
			nearVec(t, "normal", tr.Samples.Normals[k], exact.Samples.Normals[k], 1e-9)
		}
		for j := range tr.References.Points {
			nearVec(t, "reference", tr.References.Vectors[j], exact.References.Vectors[j], 1e-9)
		}
	}
}

// On a three-axis ellipsoid the arrow, integrated over the whole surface
// with its thread, is a unit tangent vector at a constant angle to it; the
// fan is unchanged, and the arrow takes one more share of the steps.
func TestEllipsoidTransport(t *testing.T) {
	const a, b, c = 1.4, 1, 0.7
	normal := ellipsoidOutward(a, b, c)
	plain := launch(ellipsoid(a, b, c), 0.3, 0.4, 70, 30, 3, 60, 3000)
	plain.Surface.Geodesics.Selected = 3
	g := threads(t, carry(plain, "thread", 25, 8))
	tr := g.Transport
	if tr.Unavailable != "" || tr.Reason != "end" || tr.Reached != 60 || tr.Steps == 0 || len(tr.Samples.Points) != 3001 {
		t.Fatalf("%s at %g after %d steps (%s)", tr.Reason, tr.Reached, tr.Steps, tr.Unavailable)
	}
	tangentUnit(t, "ellipsoid", tr, normal, 1e-9)
	keepsAngle(t, "ellipsoid", tr, g.Threads[2], normal, 25, 1e-9)
	if alone := threads(t, plain); !reflect.DeepEqual(alone.Threads, g.Threads) {
		t.Fatal("the arrow changed the fan")
	}
	defer func(saved int) { maxGeodesicSteps = saved }(maxGeodesicSteps)
	maxGeodesicSteps = 400
	g = threads(t, carry(plain, "thread", 25, 0))
	for k, th := range g.Threads {
		if th.Steps != 100 || th.Reason != "exhausted" {
			t.Fatalf("thread %d: %s after %d steps", k, th.Reason, th.Steps)
		}
	}
	if g.Transport.Steps != 100 || g.Transport.Reason != "exhausted" || g.Transport.Returns {
		t.Fatalf("arrow: %s after %d steps", g.Transport.Reason, g.Transport.Steps)
	}
}

// Retracing a path backward with the arrow it arrived with, its angle
// turned by 180°, recovers the arrow it left with, on every new route.
func TestRouteTransportReversal(t *testing.T) {
	for _, c := range []struct {
		name string
		base Request
	}{
		{"ellipsoid", ellipsoid(1.4, 1, 0.7)},
		{"cylinder", cylinderStudy(1.5, 0.8, 0, 2*math.Pi, -20, 20)},
		{"paraboloid", paraboloid(1.5, -0.7, -5, 5, -5, 5)},
		{"family", associateStudy(1.2, 0.7, -2*math.Pi, 2*math.Pi, -4, 4, 24, 24)},
	} {
		const alpha = 37.0
		study := launch(c.base, 0.4, -0.3, 70, 0, 1, 6, 600)
		out := transported(t, carry(study, "thread", alpha, 0))
		th := threads(t, study).Threads[0]
		if th.Reason != "end" {
			t.Fatalf("%s: %s", c.name, th.Reason)
		}
		last := len(out.Samples.Points) - 1
		// The end's chart point and the backward direction there, from the
		// returned tangent: β from unit X_u toward its perpendicular.
		u, v := th.EndU, th.EndV
		var xu, xv Vec3
		if c.name == "ellipsoid" {
			p := th.End
			v = math.Asin(p.Z / 0.7)
			u = math.Atan2(p.Y/1, p.X/1.4)
			xu = Vec3{-1.4 * math.Sin(u), math.Cos(u), 0}
			xv = Vec3{-1.4 * math.Sin(v) * math.Cos(u), -math.Sin(v) * math.Sin(u), 0.7 * math.Cos(v)}
		} else {
			_, xu, xv, _, _, _ = c.base.Surface.patch(u, v)
		}
		eu := xu.mul(1 / xu.norm())
		side := xv.sub(eu.mul(xv.dot(eu)))
		side = side.mul(1 / side.norm())
		back := th.Tangents[len(th.Tangents)-1].mul(-1)
		beta := math.Atan2(back.dot(side), back.dot(eu)) * 180 / math.Pi
		again := transported(t, carry(launch(c.base, u, v, beta, 0, 1, 6, 600), "thread", alpha+180, 0))
		nearVec(t, c.name+" retraced arrival", again.Samples.Vectors[0], out.Samples.Vectors[last], 1e-8)
		end := len(again.Samples.Vectors) - 1
		nearVec(t, c.name+" recovered", again.Samples.Vectors[end], out.Samples.Vectors[0], 1e-7)
	}
}

// Tightening the tolerance makes the carried arrow converge on each new
// route, against a 10⁻¹⁴ reference.
func TestRouteTransportConvergence(t *testing.T) {
	defer func(saved float64) { geodesicTolerance = saved }(geodesicTolerance)
	for _, c := range []struct {
		name  string
		study Request
	}{
		{"ellipsoid", carry(launch(ellipsoid(1.4, 1, 0.5), 0.1, 0.5, 37, 0, 1, 30, 300), "thread", 75, 0)},
		{"paraboloid", carry(launch(paraboloid(1.5, -0.7, -5, 5, -5, 5), 0.1, 0.2, 37, 0, 1, 6, 300), "thread", 75, 0)},
		{"family", carry(launch(associateStudy(1.2, 0.7, -4*math.Pi, 4*math.Pi, -4, 4, 24, 24), 0.1, 0.9, 37, 0, 1, 8, 300), "thread", 75, 0)},
	} {
		geodesicTolerance = 1e-14
		reference := transported(t, c.study)
		if reference.Reason != "end" {
			t.Fatalf("%s: reference %s", c.name, reference.Reason)
		}
		previous := math.Inf(1)
		for _, tol := range []float64{1e-6, 1e-8, 1e-10, 1e-12} {
			geodesicTolerance = tol
			tr := transported(t, c.study)
			e := tr.Samples.Vectors[300].sub(reference.Samples.Vectors[300]).norm()
			t.Logf("%s tolerance %g: %d steps, arrow error %.3g", c.name, tol, tr.Steps, e)
			if !(e < previous/10) && !(e < 1e-12) {
				t.Fatalf("%s tolerance %g: arrow error %.3g does not improve on %.3g", c.name, tol, e, previous)
			}
			previous = e
		}
		if previous > 1e-9 {
			t.Fatalf("%s: the default tolerance leaves an arrow error of %.3g", c.name, previous)
		}
	}
}
