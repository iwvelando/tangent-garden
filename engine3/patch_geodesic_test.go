package engine3

import (
	"errors"
	"math"
	"testing"
)

// Geodesic threads on finite patches, the cylinder and the
// helicoid–catenoid family, are checked against routes written out here:
// the cylinder's unrolled straight lines, the family's meridians and its
// Clairaut-one spiral toward the neck, and the screw motion's conserved
// quantity, all observed in the returned points, tangents and chart
// coordinates.

// cylinderStudy is the elliptic cylinder of semi-axes a and b over
// [u0, u1] × [v0, v1].
func cylinderStudy(a, b, u0, u1, v0, v1 float64) Request {
	return surfaceStudy("cylinder", a, b, 0, u0, u1, v0, v1, 24, 24)
}

// unwrap returns successive angles made continuous.
func unwrap(angles []float64) []float64 {
	out := append([]float64(nil), angles...)
	for k := 1; k < len(out); k++ {
		for out[k]-out[k-1] > math.Pi {
			out[k] -= 2 * math.Pi
		}
		for out[k]-out[k-1] < -math.Pi {
			out[k] += 2 * math.Pi
		}
	}
	return out
}

// ellipseArc is the arc length of (a cos u, b sin u) from 0 to u, by
// composite Simpson quadrature with steps of at most 10⁻³.
func ellipseArc(a, b, u float64) float64 {
	n := 2 * int(math.Ceil(math.Abs(u)/2e-3)+1)
	h := u / float64(n)
	speed := func(x float64) float64 { return math.Hypot(a*math.Sin(x), b*math.Cos(x)) }
	sum := speed(0) + speed(u)
	for k := 1; k < n; k++ {
		sum += float64(2+2*(k%2)) * speed(float64(k)*h)
	}
	return sum * h / 3
}

// drawn is the thread's drawn polyline: its samples, then where it stopped
// when that lies beyond its last sample.
func drawn(th GeodesicThread, step float64) []*Vec3 {
	out := []*Vec3{}
	for k := range th.Points {
		out = append(out, &th.Points[k])
	}
	if th.Reached > float64(len(th.Points)-1)*step+1e-9*step {
		end := th.End
		out = append(out, &end)
	}
	return out
}

// samplesThrough checks the thread holds every sample at or before where it
// stopped and nothing after.
func samplesThrough(t *testing.T, what string, th GeodesicThread, step float64) {
	t.Helper()
	want := int(math.Floor(th.Reached/step*(1+1e-12))) + 1
	if len(th.Points) != want || len(th.Tangents) != want || len(th.U) != want || len(th.V) != want {
		t.Fatalf("%s: reached %g (step %g) with %d points, %d u, want %d", what, th.Reached, step, len(th.Points), len(th.U), want)
	}
}

// A circular cylinder's threads unroll to straight lines: with φ the polar
// angle of the returned point, (rφ, z) moves by (s cos β, s sin β) at arc
// length s, and the tangent is cos β along the parallel plus sin β up. A
// thread leaves through the top or bottom where that line meets it, and on
// a whole turn crosses the seam.
func TestCylinderGeodesicsUnroll(t *testing.T) {
	const r, v0, v1 = 1.3, -1.0, 1.5
	for _, at := range []struct{ u, v, beta float64 }{
		{0, 0, 20}, {1, -0.4, 160}, {5.5, 1.2, -35}, {2, 0, 85}, {6, 0.3, 0},
	} {
		const L, N = 30.0, 1500
		g := threads(t, launch(cylinderStudy(r, r, 0, 2*math.Pi, v0, v1), at.u, at.v, at.beta, 0, 1, L, N))
		if g.Surface != "cylinder" || len(g.Threads) != 1 {
			t.Fatalf("%+v: %q with %d threads (%s)", at, g.Surface, len(g.Threads), g.Unavailable)
		}
		th := g.Threads[0]
		b := at.beta * math.Pi / 180
		// Where the straight line meets the top or the bottom.
		exit, edge := L, ""
		if s := math.Sin(b); s > 0 {
			exit, edge = (v1-at.v)/s, "vMax"
		} else if s < 0 {
			exit, edge = (v0-at.v)/s, "vMin"
		}
		if exit >= L {
			exit, edge = L, ""
		}
		if edge == "" {
			if th.Reason != "end" || th.Reached != L || th.Edge != "" {
				t.Fatalf("%+v: %s at %g on %q, want its whole length", at, th.Reason, th.Reached, th.Edge)
			}
		} else if th.Reason != "edge" || th.Edge != edge || math.Abs(th.Reached-exit) > 1e-12*L {
			t.Fatalf("%+v: %s at %g on %q, want the edge %s at %g", at, th.Reason, th.Reached, th.Edge, edge, exit)
		}
		samplesThrough(t, "cylinder", th, g.Step)
		phis := make([]float64, len(th.Points))
		for k, p := range th.Points {
			phis[k] = math.Atan2(p.Y, p.X)
		}
		phis = unwrap(phis)
		for k, p := range th.Points {
			s := float64(k) * g.Step
			if math.Abs(r*(phis[k]-phis[0])-s*math.Cos(b)) > 1e-10 || math.Abs(p.Z-at.v-s*math.Sin(b)) > 1e-10 {
				t.Fatalf("%+v: sample %d at s = %g unrolls to (%g, %g), want (%g, %g)", at, k, s, r*(phis[k]-phis[0]), p.Z-at.v, s*math.Cos(b), s*math.Sin(b))
			}
			if math.Abs(math.Hypot(p.X, p.Y)-r) > 1e-12 {
				t.Fatalf("%+v: sample %d leaves the cylinder", at, k)
			}
			want := Vec3{-math.Sin(phis[k]) * math.Cos(b), math.Cos(phis[k]) * math.Cos(b), math.Sin(b)}
			nearVec(t, "tangent", th.Tangents[k], want, 1e-10)
		}
		if edge != "" {
			// The end lies on the edge, where the line meets it.
			wantZ := map[string]float64{"vMax": v1, "vMin": v0}[edge]
			if th.End.Z != wantZ || th.EndV != wantZ {
				t.Fatalf("%+v: ends at z = %g, v = %g, not on the edge %g", at, th.End.Z, th.EndV, wantZ)
			}
			phi := at.u + exit*math.Cos(b)/r
			nearVec(t, "exit point", th.End, Vec3{r * math.Cos(phi), r * math.Sin(phi), wantZ}, 1e-10)
		}
	}
	// Around the waist the thread crosses the seam, its u unwrapped, and
	// returns after one turn.
	g := threads(t, launch(cylinderStudy(r, r, 0, 2*math.Pi, v0, v1), 6, 0.3, 0, 0, 1, 2*math.Pi*r, 600))
	th := g.Threads[0]
	if th.Reason != "end" || !th.Closes || !(th.EndU > 2*math.Pi+5) {
		t.Fatalf("around the waist: %s, closes %v, ends at u = %g", th.Reason, th.Closes, th.EndU)
	}
}

// An elliptic cylinder is flat too: its threads unroll, by the cross
// section's own arc length, to straight lines.
func TestEllipticCylinderGeodesicsUnroll(t *testing.T) {
	const a, b = 1.6, 0.6
	for _, beta := range []float64{10, 40, -70, 135} {
		g := threads(t, launch(cylinderStudy(a, b, 0, 2*math.Pi, -2, 2), 0.7, 0.2, beta, 0, 1, 12, 1200))
		th := g.Threads[0]
		bt := beta * math.Pi / 180
		start := ellipseArc(a, b, 0.7)
		us := make([]float64, len(th.Points))
		for k, p := range th.Points {
			us[k] = math.Atan2(p.Y/b, p.X/a)
		}
		us = unwrap(us)
		for k, p := range th.Points {
			s := float64(k) * g.Step
			if math.Abs(math.Hypot(p.X/a, p.Y/b)-1) > 1e-12 {
				t.Fatalf("β = %g: sample %d leaves the cylinder", beta, k)
			}
			if d := ellipseArc(a, b, us[k]) - start; math.Abs(d-s*math.Cos(bt)) > 1e-8 || math.Abs(p.Z-0.2-s*math.Sin(bt)) > 1e-8 {
				t.Fatalf("β = %g: sample %d at s = %g unrolls to (%g, %g), want (%g, %g)", beta, k, s, d, p.Z-0.2, s*math.Cos(bt), s*math.Sin(bt))
			}
			if math.Abs(th.Tangents[k].norm()-1) > 1e-9 || math.Abs(th.Tangents[k].Z-math.Sin(bt)) > 1e-9 {
				t.Fatalf("β = %g: sample %d's tangent %v", beta, k, th.Tangents[k])
			}
		}
	}
}

// killing is the screw motion's conserved quantity along a thread of the
// family at scale s and angle theta: (ẑ × X + s cos θ ẑ)·T, the generator of
// the motion along u, which every member admits.
func killing(s, theta float64, x, tg Vec3) float64 {
	return Vec3{-x.Y, x.X, s * math.Cos(theta)}.dot(tg)
}

// On every member of the family each thread runs at unit speed on the
// surface, tangent to it, and keeps the screw motion's quantity, which is
// Clairaut's s cosh v cos ψ.
func TestAssociateGeodesicInvariants(t *testing.T) {
	const s = 1.7
	for _, theta := range []float64{0, 0.6, math.Pi / 2} {
		g := threads(t, launch(associateStudy(s, theta, -3, 3, -2, 2, 24, 24), 0.4, -0.3, 25, 300, 9, 40, 2000))
		if g.Surface != helicoidCatenoid || len(g.Threads) != 9 {
			t.Fatalf("θ = %g: %q with %d threads (%s)", theta, g.Surface, len(g.Threads), g.Unavailable)
		}
		for i, th := range g.Threads {
			if th.Reason != "edge" && th.Reason != "end" {
				t.Fatalf("θ = %g thread %d: %s", theta, i, th.Reason)
			}
			samplesThrough(t, "family", th, g.Step)
			b := th.Direction * math.Pi / 180
			c0 := s * math.Cosh(-0.3) * math.Cos(b)
			for k, p := range th.Points {
				u, v := th.U[k], th.V[k]
				if u < -3 || u > 3 || v < -2 || v > 2 {
					t.Fatalf("θ = %g thread %d sample %d lies outside the patch at (%g, %g)", theta, i, k, u, v)
				}
				associateNear(t, "on the surface", p, associateX(s, theta, u, v), 1e-12*s*math.Cosh(v))
				tg := th.Tangents[k]
				if math.Abs(tg.norm()-1) > 1e-9 || math.Abs(tg.dot(gaussMap(u, v))) > 1e-12 {
					t.Fatalf("θ = %g thread %d sample %d: tangent %v is not a unit tangent", theta, i, k, tg)
				}
				if q := killing(s, theta, p, tg); math.Abs(q-c0) > 1e-8*s {
					t.Fatalf("θ = %g thread %d sample %d: screw quantity %g, launched with %g", theta, i, k, q, c0)
				}
			}
			if th.Reason == "edge" {
				on := map[string]float64{"uMin": th.EndU + 3, "uMax": 3 - th.EndU, "vMin": th.EndV + 2, "vMax": 2 - th.EndV}[th.Edge]
				if on != 0 {
					t.Fatalf("θ = %g thread %d stops on %q at (%g, %g)", theta, i, th.Edge, th.EndU, th.EndV)
				}
				associateNear(t, "stop on the surface", th.End, associateX(s, theta, th.EndU, th.EndV), 1e-12*s*math.Cosh(th.EndV))
			}
		}
	}
}

// Exact routes of the shared metric: a meridian, u fixed, reaches v at arc
// length s(sinh v − sinh v₀) and leaves where v meets the edge; the thread
// with Clairaut constant s (cos β = 1/cosh v₀) spirals toward the neck
// with u − u₀ = ln tanh(v₀/2) − ln tanh(v/2) and σ/s = cosh v₀ + ln tanh(v₀/2)
// − cosh v − ln tanh(v/2).
func TestAssociateGeodesicOracles(t *testing.T) {
	const s = 0.9
	for _, theta := range []float64{0, 1.1, math.Pi / 2} {
		g := threads(t, launch(associateStudy(s, theta, -1, 1, -2, 1.5, 24, 24), 0.3, -0.5, 90, 0, 1, 10, 1000))
		th := g.Threads[0]
		exit := s * (math.Sinh(1.5) - math.Sinh(-0.5))
		if th.Reason != "edge" || th.Edge != "vMax" || math.Abs(th.Reached-exit) > 1e-9*s {
			t.Fatalf("θ = %g meridian: %s on %q at %g, want vMax at %g", theta, th.Reason, th.Edge, th.Reached, exit)
		}
		for k := range th.Points {
			v := math.Asinh(math.Sinh(-0.5) + float64(k)*g.Step/s)
			if math.Abs(th.U[k]-0.3) > 1e-12 || math.Abs(th.V[k]-v) > 1e-9 {
				t.Fatalf("θ = %g meridian sample %d at (%g, %g), want (0.3, %g)", theta, k, th.U[k], th.V[k], v)
			}
			associateNear(t, "meridian", th.Points[k], associateX(s, theta, 0.3, v), 1e-9*s)
		}
		associateNear(t, "meridian's exit", th.End, associateX(s, theta, 0.3, 1.5), 1e-9*s)

		const v0 = 1.0
		beta := -math.Acos(1/math.Cosh(v0)) * 180 / math.Pi
		// Four scale lengths take it within v ≈ 0.03 of the neck, where an
		// error in v grows by about 1/v in the arc length it implies.
		g = threads(t, launch(associateStudy(s, theta, -4*math.Pi, 4*math.Pi, -2, 2, 24, 24), 0, v0, beta, 0, 1, 4*s, 1200))
		th = g.Threads[0]
		if th.Reason != "end" {
			t.Fatalf("θ = %g spiral: %s at %g", theta, th.Reason, th.Reached)
		}
		lt := func(v float64) float64 { return math.Log(math.Tanh(v / 2)) }
		for k := range th.Points {
			v := th.V[k]
			if !(v > 0) {
				t.Fatalf("θ = %g spiral sample %d crossed the neck: v = %g", theta, k, v)
			}
			if du := lt(v0) - lt(v); math.Abs(th.U[k]-du) > 1e-7 {
				t.Fatalf("θ = %g spiral sample %d: u = %g, want %g", theta, k, th.U[k], du)
			}
			if tau := math.Cosh(v0) + lt(v0) - math.Cosh(v) - lt(v); math.Abs(tau-float64(k)*g.Step/s) > 1e-8 {
				t.Fatalf("θ = %g spiral sample %d: σ/s = %g, want %g", theta, k, float64(k)*g.Step/s, tau)
			}
		}
	}
}

// The family's members share their metric, so a launch traces the same
// route in (u, v), stopping on the same edge at the same arc length, at
// every angle, while its points move in space; and the length of each
// drawn polyline converges, at second order, to the arc length reached.
func TestAssociateRouteAgreesAcrossAngles(t *testing.T) {
	const s = 1.2
	thetas := []float64{0, 0.4, 1.0, math.Pi / 2}
	var first *GeodesicResult
	for _, theta := range thetas {
		g := threads(t, launch(associateStudy(s, theta, -0.85*math.Pi, 0.85*math.Pi, -1.2, 1.2, 24, 24), -1, 0.2, 40, 180, 7, 25, 2000))
		if first == nil {
			first = g
			continue
		}
		for i, th := range g.Threads {
			ref := first.Threads[i]
			if th.Reason != ref.Reason || th.Edge != ref.Edge || math.Abs(th.Reached-ref.Reached) > 1e-9 || len(th.U) != len(ref.U) {
				t.Fatalf("θ = %g thread %d: %s on %q at %g, at 0: %s on %q at %g", theta, i, th.Reason, th.Edge, th.Reached, ref.Reason, ref.Edge, ref.Reached)
			}
			for k := range th.U {
				if math.Abs(th.U[k]-ref.U[k]) > 1e-9 || math.Abs(th.V[k]-ref.V[k]) > 1e-9 {
					t.Fatalf("θ = %g thread %d sample %d at (%g, %g), at 0 (%g, %g)", theta, i, k, th.U[k], th.V[k], ref.U[k], ref.V[k])
				}
			}
		}
		if theta > 0.5 && th0moved(first, g) < 0.1 {
			t.Fatalf("θ = %g: the threads did not move in space", theta)
		}
	}
	// One long thread that leaves through an edge: its drawn length, at
	// 50, 100 and 200 samples, against the arc length reached.
	for _, theta := range thetas {
		var errs []float64
		for _, n := range []int{50, 100, 200} {
			g := threads(t, launch(associateStudy(s, theta, -0.85*math.Pi, 0.85*math.Pi, -1.2, 1.2, 24, 24), -1, 0.2, 40, 0, 1, 25, n))
			th := g.Threads[0]
			errs = append(errs, th.Reached-pathLength(drawn(th, g.Step)))
		}
		for k := 1; k < len(errs); k++ {
			if !(errs[k-1] > 0 && errs[k] > 0) || math.Abs(errs[k-1]/errs[k]-4) > 0.3 {
				t.Fatalf("θ = %g: drawn length short of the arc length by %v, not second order", theta, errs)
			}
		}
	}
}

// th0moved is how far, at most, the first thread's samples lie from the
// same samples at the other angle.
func th0moved(a, b *GeodesicResult) float64 {
	most := 0.0
	for k := range a.Threads[0].Points {
		most = math.Max(most, a.Threads[0].Points[k].sub(b.Threads[0].Points[k]).norm())
	}
	return most
}

// The end of a long family thread, turning back from the neck, and where
// another leaves the patch, converge as the tolerance tightens, against a
// 10⁻¹⁴ reference.
func TestAssociateGeodesicConvergence(t *testing.T) {
	defer func(saved float64) { geodesicTolerance = saved }(geodesicTolerance)
	for _, c := range []struct {
		beta, length float64
		reason       string
	}{{-12, 9, "end"}, {28, 30, "edge"}} {
		run := func(tol float64) GeodesicThread {
			geodesicTolerance = tol
			return threads(t, launch(associateStudy(1, 0.7, -4*math.Pi, 4*math.Pi, -3, 3, 24, 24), 0, 0.4, c.beta, 0, 1, c.length, 300)).Threads[0]
		}
		ref := run(1e-14)
		if ref.Reason != c.reason {
			t.Fatalf("β = %g reference: %s at %g", c.beta, ref.Reason, ref.Reached)
		}
		last, steps := math.Inf(1), 0
		for _, tol := range []float64{1e-6, 1e-8, 1e-10, 1e-12} {
			th := run(tol)
			e := math.Max(th.End.sub(ref.End).norm(), th.EndTangent.sub(ref.EndTangent).norm())
			if th.Reason != ref.Reason || th.Edge != ref.Edge || !(e < last) || !(e < 1e3*tol) || !(th.Steps > steps) {
				t.Fatalf("β = %g, tolerance %g: %s on %q, error %g after %g, %d steps after %d", c.beta, tol, th.Reason, th.Edge, e, last, th.Steps, steps)
			}
			t.Logf("β = %g, tolerance %g: error %.2g in %d steps", c.beta, tol, e, th.Steps)
			last, steps = e, th.Steps
		}
	}
}

// Stops at the patch's edges: a start on an edge heading out stops at
// once; one along an edge keeps going; a corner names an edge it meets;
// a narrow cylinder's u edge stops a thread, while a whole turn's is a
// seam; the family's ends stop it even where the catenoid's meet; and a
// thread that dips beyond an edge within one step, turning back by the
// neck, still stops there.
func TestPatchGeodesicEdges(t *testing.T) {
	const r = 1.0
	at := func(c Request, u, v, beta, length float64) GeodesicThread {
		t.Helper()
		g := threads(t, launch(c, u, v, beta, 0, 1, length, 400))
		th := g.Threads[0]
		samplesThrough(t, "edge", th, g.Step)
		return th
	}
	if th := at(cylinderStudy(r, r, 0, 2*math.Pi, -1, 1), 1, 1, 30, 5); th.Reason != "edge" || th.Edge != "vMax" || th.Reached != 0 || len(th.Points) != 1 {
		t.Fatalf("heading out of the top: %s on %q at %g with %d points", th.Reason, th.Edge, th.Reached, len(th.Points))
	}
	if th := at(cylinderStudy(r, r, 0, 2*math.Pi, -1, 1), 1, 1, 0, 5); th.Reason != "end" || th.EndV != 1 {
		t.Fatalf("along the top: %s at %g, v = %g", th.Reason, th.Reached, th.EndV)
	}
	// Toward the corner (u, v) = (2, 1) from (1, 0) on the unit cylinder.
	corner := math.Atan2(1, 1) * 180 / math.Pi
	if th := at(cylinderStudy(r, r, 0, 2, -1, 1), 1, 0, corner, 5); th.Reason != "edge" || (th.Edge != "uMax" && th.Edge != "vMax") || math.Abs(th.Reached-math.Sqrt2) > 1e-12 || math.Abs(th.EndU-2) > 1e-12 || math.Abs(th.EndV-1) > 1e-12 {
		t.Fatalf("into the corner: %s on %q at %g, (%g, %g)", th.Reason, th.Edge, th.Reached, th.EndU, th.EndV)
	}
	if th := at(cylinderStudy(r, r, 0, 2, -1, 1), 1, 0, 180, 5); th.Reason != "edge" || th.Edge != "uMin" || math.Abs(th.Reached-1) > 1e-12 || th.EndU != 0 {
		t.Fatalf("out of a narrow cylinder: %s on %q at %g", th.Reason, th.Edge, th.Reached)
	}
	if th := at(cylinderStudy(r, r, 0, 2*math.Pi, -1, 1), 1, 0, 180, 5); th.Reason != "end" || math.Abs(th.EndU+4) > 1e-12 {
		t.Fatalf("across a whole turn's seam: %s at %g, u = %g", th.Reason, th.Reached, th.EndU)
	}
	if th := at(associateStudy(1, math.Pi/2, -math.Pi, math.Pi, -1, 1, 24, 24), 3, 0, 0, 5); th.Reason != "edge" || th.Edge != "uMax" || math.Abs(th.Reached-(math.Pi-3)) > 1e-9 {
		t.Fatalf("the catenoid's end: %s on %q at %g", th.Reason, th.Edge, th.Reached)
	}
	// Clairaut constant s cosh v_t: from v = 1.5 toward the neck the thread
	// turns back at v_t, just beyond or just short of the edge v = 0.5.
	// The shallowest dips last only a few thousandths of a step beyond it.
	for _, vt := range []float64{0.4999, 0.49999, 0.499999, 0.4999999, 0.5001, 0.500001} {
		beta := -math.Acos(math.Cosh(vt)/math.Cosh(1.5)) * 180 / math.Pi
		th := at(associateStudy(1, 0.3, -4*math.Pi, 4*math.Pi, 0.5, 2, 24, 24), 0, 1.5, beta, 8)
		if vt < 0.5 && (th.Reason != "edge" || th.Edge != "vMin" || th.EndV != 0.5) {
			t.Fatalf("turning at %g, beyond the edge: %s on %q at v = %g", vt, th.Reason, th.Edge, th.EndV)
		}
		if vt > 0.5 && th.Edge == "vMin" {
			t.Fatalf("turning at %g, short of the edge: stopped on it at %g", vt, th.Reached)
		}
	}
}

// A patch thread starts within the patch; anywhere else is refused by its
// field. An arrow cannot yet be carried on these surfaces: it is
// unavailable while the threads are drawn.
func TestPatchGeodesicLimits(t *testing.T) {
	for _, c := range []struct {
		field string
		q     Request
	}{
		{"surface.geodesics.u", launch(cylinderStudy(1, 1, 0, 2, -1, 1), 2.5, 0, 0, 0, 1, 1, 10)},
		{"surface.geodesics.u", launch(cylinderStudy(1, 1, 0, 2*math.Pi, -1, 1), -0.1, 0, 0, 0, 1, 1, 10)},
		{"surface.geodesics.v", launch(cylinderStudy(1, 1, 0, 2, -1, 1), 1, 1.01, 0, 0, 1, 1, 10)},
		{"surface.geodesics.v", launch(associateStudy(1, 0, -1, 1, 0, 1, 24, 24), 0, -0.2, 0, 0, 1, 1, 10)},
	} {
		var fe *FieldError
		if _, err := Compute(c.q); !errors.As(err, &fe) || fe.Field != c.field {
			t.Fatalf("%s: got %v", c.field, err)
		}
	}
	for _, q := range []Request{
		cylinderStudy(1, 1, 0, 2*math.Pi, -1, 1),
		associateStudy(1, 0.5, -2, 2, -1, 1, 24, 24),
	} {
		q = carry(launch(q, 0, 0, 30, 0, 1, 5, 100), "thread", 90, 4)
		g := threads(t, q)
		if g.Transport == nil || g.Transport.Unavailable == "" || len(g.Threads) != 1 || len(g.Threads[0].Points) < 2 {
			t.Fatalf("%s: the arrow should be unavailable with the thread drawn", q.Surface.Kind)
		}
	}
}

// A family fan shares the budget of attempted steps; a thread that runs
// out stops there and reports it.
func TestAssociateGeodesicBudget(t *testing.T) {
	defer func(saved int) { maxGeodesicSteps = saved }(maxGeodesicSteps)
	maxGeodesicSteps = 90
	g := threads(t, launch(associateStudy(1, 0.5, -4*math.Pi, 4*math.Pi, -3, 3, 24, 24), 0, 0, 30, 20, 3, 80, 400))
	total := 0
	for k, th := range g.Threads {
		total += th.Steps
		if th.Reason != "exhausted" || th.Steps != 30 || !(th.Reached > 0 && th.Reached < 80) {
			t.Fatalf("thread %d: %s at %g after %d steps", k, th.Reason, th.Reached, th.Steps)
		}
		samplesThrough(t, "exhausted", th, g.Step)
		associateNear(t, "where it stopped", th.End, associateX(1, 0.5, th.EndU, th.EndV), 1e-12*math.Cosh(th.EndV))
	}
	if g.Steps != total || total > maxGeodesicSteps {
		t.Fatalf("%d steps attempted, reported %d", total, g.Steps)
	}
}
