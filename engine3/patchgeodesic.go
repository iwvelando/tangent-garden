package engine3

import (
	"math"
	"tangentgarden/engine/ode"
)

// A leave checks an accepted step from (t, y) by h, ending at end, for
// leaving the patch. Where it does, it returns the τ and the state where
// the path first meets the patch's edge, and true; it returns false when
// the whole step stays inside. The state is the leave's own.
type leave func(t, h float64, y, end []float64) (float64, []float64, bool)

// chartPath integrates geodesics in the chart of a patch whose threads run
// within it (see geodesicSupport): from its exact first and second
// derivatives, in units of its length scale l, stopped at its edges.
//
// With a = l du/dσ and b = l dv/dσ against τ = σ/l, for arc length σ, and
// Q = X_uu a² + 2X_uv ab + X_vv b², a geodesic satisfies u̇ = a, v̇ = b and
//
//	[[E, F], [F, G]] (ȧ, ḃ) = −(X_u·Q, X_v·Q),
//
// the tangential part of its acceleration vanishing; its unit tangent is
// (aX_u + bX_v)/l. Nothing in this reads the patch's embedding but its
// metric and Christoffel symbols, so two isometric patches, such as the
// helicoid–catenoid family's members, trace the same chart route.
type chartPath struct {
	q     SurfaceRequest
	l     float64
	seam  bool
	graph bool
	f     ode.Func
	dense ode.Stages
	// edge names the edge a thread last left by.
	edge string
}

// The most bisections that locate where a step leaves the patch or turns.
// A step is at most maxTorusStep in τ, as on the torus.
const chartBisect = 64

// chartScale is the length a patch's threads are integrated against, as
// its kind's descriptor gives it: the cylinder's larger semi-axis, the
// family's scale, or half a paraboloid patch's largest extent.
func (q SurfaceRequest) chartScale() float64 { return q.offers().geodesics.scale(q) }

// chartDerivatives supplies the metric and connection in an isometric
// embedding. The family's metric is independent of u and theta, so use
// u = theta = 0: its orthogonal derivative components then contain exact
// zeros. Rotating them first would introduce cancellation residuals that
// can turn a meridian along a patch edge into a spurious edge exit.
// Drawing points and tangents still use the requested embedding.
func (q SurfaceRequest) chartDerivatives(u, v float64) (xu, xv, xuu, xuv, xvv Vec3) {
	if q.Kind == "helicoid-catenoid" {
		q.B, u = 0, 0
	}
	_, xu, xv, xuu, xuv, xvv = q.patch(u, v)
	return
}

// On a graph X = (u, v, h(u, v)) the metric is I + ∇h∇hᵀ, whose inverse
// takes ∇h to ∇h/W with W = 1 + h_u² + h_v², and Q is vertical, so with
// q = h_uu a² + 2h_uv ab + h_vv b² the equations are
//
//	ȧ = −h_u q/W,  ḃ = −h_v q/W,
//
// written so, without EG − F², which loses its digits to cancellation
// where the patch is steep. A tangent's chart components are then its x
// and y components.
func (q SurfaceRequest) chartPath() *chartPath {
	c := &chartPath{q: q, l: q.chartScale()}
	support := q.offers().geodesics
	c.seam = support.seam && q.UMax-q.UMin >= 2*math.Pi*(1-1e-12)
	c.graph = support.graph
	c.f = func(_ float64, y, out []float64) {
		xu, xv, xuu, xuv, xvv := q.chartDerivatives(y[0], y[1])
		a, b := y[2], y[3]
		if c.graph {
			hu, hv := xu.Z, xv.Z
			bend := xuu.Z*a*a + 2*xuv.Z*a*b + xvv.Z*b*b
			w := 1 + hu*hu + hv*hv
			out[0], out[1] = a, b
			out[2], out[3] = -hu*bend/w, -hv*bend/w
			return
		}
		acc := xuu.mul(a * a).add(xuv.mul(2 * a * b)).add(xvv.mul(b * b))
		e, f, g := xu.dot(xu), xu.dot(xv), xv.dot(xv)
		p, r := xu.dot(acc), xv.dot(acc)
		det := e*g - f*f
		out[0], out[1] = a, b
		out[2] = -(g*p - f*r) / det
		out[3] = -(e*r - f*p) / det
	}
	return c
}

// size is a step's local error relative to geodesicTolerance: in position,
// (|X_u||δu| + |X_v||δv|)/l, and likewise in the tangent's (δa, δb), with
// the larger |X_u| and |X_v| at the step's ends.
func (c *chartPath) size(y, end, e []float64) float64 {
	xu0, xv0, _, _, _ := c.q.chartDerivatives(y[0], y[1])
	xu1, xv1, _, _, _ := c.q.chartDerivatives(end[0], end[1])
	nu, nv := math.Max(xu0.norm(), xu1.norm())/c.l, math.Max(xv0.norm(), xv1.norm())/c.l
	return math.Max(nu*math.Abs(e[0])+nv*math.Abs(e[1]), nu*math.Abs(e[2])+nv*math.Abs(e[3])) / geodesicTolerance
}

// edges are the patch's edges, each with its coordinate (0 for u, 1 for
// v), its value and the side the patch lies on.
var chartEdges = [4]struct {
	name  string
	coord int
	lower bool
}{{"uMin", 0, true}, {"uMax", 0, false}, {"vMin", 1, true}, {"vMax", 1, false}}

func (c *chartPath) edgeValue(k int) float64 {
	return [4]float64{c.q.UMin, c.q.UMax, c.q.VMin, c.q.VMax}[k]
}

// beyond is how far state y lies beyond the patch's edge k, negative
// within it. A seam's u edges are never crossed.
func (c *chartPath) beyond(y []float64, k int) float64 {
	e := chartEdges[k]
	if e.coord == 0 && c.seam {
		return math.Inf(-1)
	}
	if e.lower {
		return c.edgeValue(k) - y[e.coord]
	}
	return y[e.coord] - c.edgeValue(k)
}

// outside names the edge state y lies farthest beyond, or −1 when it lies
// within the closed patch.
func (c *chartPath) outside(y []float64) int {
	most, at := 0.0, -1
	for k := range chartEdges {
		if d := c.beyond(y, k); d > most {
			most, at = d, k
		}
	}
	return at
}

// margin is the chart distance from y to the nearest edge it can cross.
func (c *chartPath) margin(y []float64) float64 {
	m := math.Inf(1)
	for k := range chartEdges {
		m = math.Min(m, -c.beyond(y, k))
	}
	return m
}

// at is the state a step from (t, y) reaches at τ, as the samples are
// evaluated: one step of the same method, copied.
func (c *chartPath) at(t float64, y []float64, tau float64) []float64 {
	return append([]float64(nil), c.dense.Step(c.f, t, y, tau-t, false)...)
}

// leave finds where an accepted step from (t, y) by h first leaves the
// patch. Its end may lie beyond an edge; and a step that comes within its
// own chart reach, h(|a| + |b|), of an edge may leave and return within
// it, by turning there, so its middle and every point where a or b
// changes sign, between its start, middle and end, are checked too. The
// first of those checkpoints beyond an edge brackets where it left with
// the last within, which bisection narrows. The state returned is the
// last within, its coordinate on that edge set to the edge's.
func (c *chartPath) leave(t, h float64, y, end []float64) (float64, []float64, bool) {
	type point struct {
		t float64
		y []float64
	}
	checks := []point{}
	reach := h * math.Max(math.Abs(y[2])+math.Abs(y[3]), math.Abs(end[2])+math.Abs(end[3]))
	if math.Min(c.margin(y), c.margin(end)) <= reach {
		mid := point{t + h/2, c.at(t, y, t+h/2)}
		ends := []point{{t, y}, mid, {t + h, end}}
		for half := 0; half < 2; half++ {
			lo, hi := ends[half], ends[half+1]
			for comp := 2; comp < 4; comp++ {
				if lo.y[comp]*hi.y[comp] < 0 {
					a, b := lo.t, hi.t
					for i := 0; i < chartBisect && a < b; i++ {
						m := a + (b-a)/2
						if m <= a || m >= b {
							break
						}
						if c.at(t, y, m)[comp]*lo.y[comp] > 0 {
							a = m
						} else {
							b = m
						}
					}
					checks = append(checks, point{a, c.at(t, y, a)})
				}
			}
			checks = append(checks, hi)
		}
		// In time order: a turn in the first half precedes the middle.
		for i := 1; i < len(checks); i++ {
			for j := i; j > 0 && checks[j].t < checks[j-1].t; j-- {
				checks[j], checks[j-1] = checks[j-1], checks[j]
			}
		}
	} else {
		checks = append(checks, point{t + h, end})
	}
	inside := point{t, y}
	for _, p := range checks {
		if c.outside(p.y) < 0 {
			inside = p
			continue
		}
		a, b := inside.t, p.t
		for i := 0; i < chartBisect; i++ {
			m := a + (b-a)/2
			if m <= a || m >= b {
				break
			}
			if c.outside(c.at(t, y, m)) < 0 {
				a = m
			} else {
				b = m
			}
		}
		k := c.outside(c.at(t, y, b))
		state := inside.y
		if a > inside.t {
			state = c.at(t, y, a)
		} else {
			state = append([]float64(nil), state...)
		}
		state[chartEdges[k].coord] = c.edgeValue(k)
		c.edge = chartEdges[k].name
		return a, state, true
	}
	return 0, nil, false
}

// patchThread integrates the geodesic of a patch whose threads run within
// it from X(u₀, v₀) in direction beta, for at most budget attempted
// steps, until it has run its length or leaves the patch. Direction β is
// measured from unit X_u toward the unit tangent perpendicular to it on
// X_v's side, which is unit X_v where F = 0. A thread that starts on an
// edge heading out of the patch stops at once. The thread's u and v are
// its chart coordinates, unwrapped across a seam.
func (q SurfaceRequest) patchThread(g GeodesicRequest, beta float64, budget int) GeodesicThread {
	c := q.chartPath()
	b := beta * math.Pi / 180
	sn, cs := math.Sin(b), math.Cos(b)
	// Exact quarter turns have a zero component. A trigonometric residual
	// must not make a launch along a patch edge point outside it. Nearby
	// entered directions retain their nonzero component.
	switch math.Mod(beta, 360) {
	case 0:
		sn, cs = 0, 1
	case 90, -270:
		sn, cs = 1, 0
	case 180, -180:
		sn, cs = 0, -1
	case 270, -90:
		sn, cs = -1, 0
	}
	xu, xv, _, _, _ := q.chartDerivatives(g.U, g.V)
	eu := xu.mul(1 / xu.norm())
	side := xv.sub(eu.mul(xv.dot(eu)))
	t0 := eu.mul(cs).add(side.mul(sn / side.norm()))
	var y []float64
	if c.graph {
		y = []float64{g.U, g.V, t0.X * c.l, t0.Y * c.l}
	} else {
		e, f, gg := xu.dot(xu), xu.dot(xv), xv.dot(xv)
		p, r := xu.dot(t0)*c.l, xv.dot(t0)*c.l
		det := e*gg - f*f
		y = []float64{g.U, g.V, (gg*p - f*r) / det, (e*r - f*p) / det}
	}
	th := GeodesicThread{Direction: beta}
	state := func(y []float64) (Vec3, Vec3) {
		x, xu, xv, _, _, _ := q.patch(y[0], y[1])
		return x, xu.mul(y[2] / c.l).add(xv.mul(y[3] / c.l))
	}
	sample := func(_ int, y []float64) {
		x, tg := state(y)
		th.Points = append(th.Points, x)
		th.Tangents = append(th.Tangents, tg)
		th.U, th.V = append(th.U, y[0]), append(th.V, y[1])
	}
	sample(0, y)
	var t float64
	// On an edge, heading out of the patch.
	for k, edge := range chartEdges {
		if c.beyond(y, k) == 0 && (y[2+edge.coord] < 0) == edge.lower && y[2+edge.coord] != 0 {
			th.Reason, th.Edge = "edge", edge.name
			break
		}
	}
	if th.Reason == "" {
		targets := make([]float64, g.Samples)
		for i := range targets {
			targets[i] = arc(g.Length, i+1, g.Samples) / c.l
		}
		th.Reason, t, th.Steps = torusRun(c.f, y, g.Length/c.l, targets, budget, c.size, sample, c.leave, nil)
		if th.Reason == "edge" {
			th.Edge = c.edge
		}
	}
	th.End, th.EndTangent = state(y)
	th.EndU, th.EndV, th.Reached = y[0], y[1], t*c.l
	if th.Reason == "end" {
		th.Reached = g.Length
	}
	th.closing(c.l)
	return th
}
