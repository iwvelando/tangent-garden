package engine3

import (
	"math"
	"tangentgarden/engine/ode"
)

// GeodesicRequest launches a fan of Count geodesic threads from the chart
// point X(U, V) of a sphere (an ellipsoid with equal axes) or a ring torus
// (R > r). Each runs Length, in the surface's units of length, sampled at
// Samples + 1 evenly spaced arc lengths from its start.
//
// Direction β, in degrees, is measured from the unit vector along X_u
// toward the unit vector along X_v, whatever the normal's orientation. On a
// sphere V is a latitude within ±π/2, and at a pole those vectors are their
// limits along meridian U: (−sin U, cos U, 0) and the direction back down
// that meridian. The fan shares Spread degrees evenly among its threads,
// each at the middle of its share: thread k of n leaves at
// β + Spread((2k + 1)/2n − 1/2), so one thread leaves at β and a spread of
// 360 rings the point. Selected, from 1 to Count, is the thread drawn and
// described on its own.
type GeodesicRequest struct {
	U         float64 `json:"u"`
	V         float64 `json:"v"`
	Direction float64 `json:"direction"`
	Spread    float64 `json:"spread"`
	Count     int     `json:"count"`
	Length    float64 `json:"length"`
	Samples   int     `json:"samples"`
	Selected  int     `json:"selected"`
}

// GeodesicReturn is how far a thread's end lies from its start: in
// position, as a fraction of the sphere's or the tube's radius r, and in
// direction, between the unit tangents.
type GeodesicReturn struct {
	Position  float64 `json:"position"`
	Direction float64 `json:"direction"`
}

// GeodesicThread is one thread, launched Direction degrees from unit X_u.
// Points and Tangents, the unit tangent, are at arc lengths s_k = kL/N from
// its start, through the last it reached; a torus thread's U and V are its
// chart coordinates there, unwrapped across the seams. Nothing follows a
// stop. Reason is "end" when it ran its whole length, "exhausted" when its
// share of the step budget ran out, and "unresolved" when the integration
// failed: a value not finite, or a step too small to advance. Reached is
// the arc length it reached, where its state is End, EndTangent and, on a
// torus, (EndU, EndV); it can lie between samples. Steps counts the steps
// it attempted (none on a sphere, which is evaluated exactly). Return is
// its end's distance from its start, for a thread that ran its length, and
// Closes says whether both residuals are within closureResidual.
type GeodesicThread struct {
	Direction  float64        `json:"direction"`
	Points     []Vec3         `json:"points"`
	Tangents   []Vec3         `json:"tangents"`
	U          []float64      `json:"u,omitempty"`
	V          []float64      `json:"v,omitempty"`
	Reason     string         `json:"reason"`
	Reached    float64        `json:"reached"`
	End        Vec3           `json:"end"`
	EndTangent Vec3           `json:"endTangent"`
	EndU       float64        `json:"endU"`
	EndV       float64        `json:"endV"`
	Steps      int            `json:"steps"`
	Return     GeodesicReturn `json:"return"`
	Closes     bool           `json:"closes"`
}

// GeodesicResult holds the fan on Surface, "sphere" or "torus", with
// Length each thread's arc length as requested, Step the arc length between
// samples and Steps the steps attempted in all.
// Unavailable, when set, says why this surface has no threads, and
// Threads is empty; the surface itself is drawn as before.
type GeodesicResult struct {
	Surface     string           `json:"surface"`
	Unavailable string           `json:"unavailable,omitempty"`
	Length      float64          `json:"length"`
	Step        float64          `json:"step"`
	Threads     []GeodesicThread `json:"threads"`
	Selected    int              `json:"selected"`
	Steps       int              `json:"steps"`
}

// Local error per torus step, in the dimensionless state (see
// torusThread), and the fan's budget of attempted steps, shared equally
// among its threads. Variables so tests can refine and exhaust them.
var (
	geodesicTolerance = 1e-10
	maxGeodesicSteps  = 200000
)

const (
	maxGeodesicThreads = 32
	maxGeodesicSamples = 20000
	// The most points a fan returns, across its threads.
	maxGeodesicPoints = 200000
	// The narrowest neck, (R − r)/r, a torus's threads are traced on.
	minGeodesicNeck = 1e-3
	// Both residuals at most this make a return.
	closureResidual = 1e-6
	// The longest torus step, in tube radians.
	maxTorusStep = 0.5
)

func (g GeodesicRequest) validate() error {
	switch {
	case !bounded(g.U):
		return fieldErr("surface.geodesics.u", "the start u₀ must be finite and within ±100000")
	case !bounded(g.V):
		return fieldErr("surface.geodesics.v", "the start v₀ must be finite and within ±100000")
	case !bounded(g.Direction):
		return fieldErr("surface.geodesics.direction", "the direction β must be finite and within ±100000°")
	case !finite(g.Spread) || g.Spread < 0 || g.Spread > 360:
		return fieldErr("surface.geodesics.spread", "the spread must be within 0–360°")
	case g.Count < 1 || g.Count > maxGeodesicThreads:
		return fieldErr("surface.geodesics.count", "use 1–32 threads")
	case g.Samples < 8 || g.Samples > maxGeodesicSamples || g.Count*(g.Samples+1) > maxGeodesicPoints:
		return fieldErr("surface.geodesics.samples", "use 8–20000 samples per thread, with at most 200,000 points across the fan")
	case !finite(g.Length) || g.Length <= 0 || g.Length > 1e5:
		return fieldErr("surface.geodesics.length", "the length L must be above 0 and at most 100000")
	case g.Selected < 1 || g.Selected > g.Count:
		return fieldErr("surface.geodesics.selected", "the selected thread must be one of the %d", g.Count)
	}
	return nil
}

// geodesicSurface names the surface whose threads q can trace, or says why
// it has none. A sphere's axes agree to rounding, 10⁻¹² of the largest.
func (q SurfaceRequest) geodesicSurface() (string, string) {
	switch q.Kind {
	case "ellipsoid":
		if math.Max(math.Abs(q.A-q.B), math.Abs(q.B-q.C)) <= 1e-12*math.Max(q.A, math.Max(q.B, q.C)) {
			return "sphere", ""
		}
		return "", "Geodesic threads need a sphere: give the ellipsoid equal axes a = b = c."
	case "torus":
		if !(q.A > q.B) {
			return "", "Geodesic threads need a ring torus, with R above r: a horn or spindle torus meets its axis."
		}
		if q.A-q.B < minGeodesicNeck*q.B {
			return "", "Geodesic threads need R to exceed r by at least 0.1% of r: nearer a horn torus the inner equator is too tight to trace."
		}
		return "torus", ""
	}
	return "", "Geodesic threads are traced on a sphere or a ring torus."
}

// geodesics launches the request's fan, or says why the surface has none.
func (q SurfaceRequest) geodesics() (*GeodesicResult, error) {
	g := *q.Geodesics
	out := &GeodesicResult{Threads: []GeodesicThread{}, Selected: g.Selected, Length: g.Length, Step: g.Length / float64(g.Samples)}
	surface, unavailable := q.geodesicSurface()
	if unavailable != "" {
		out.Unavailable = unavailable
		return out, nil
	}
	if surface == "sphere" && !(math.Abs(g.V) <= math.Pi/2) {
		return nil, fieldErr("surface.geodesics.v", "on a sphere v₀ is a latitude, within ±π/2")
	}
	out.Surface = surface
	budget := maxGeodesicSteps / g.Count
	for k := 0; k < g.Count; k++ {
		beta := g.Direction + g.Spread*((2*float64(k)+1)/(2*float64(g.Count))-0.5)
		var th GeodesicThread
		if surface == "sphere" {
			th = sphereThread(q.A, g, beta)
		} else {
			th = torusThread(q.A, q.B, g, beta, budget)
		}
		out.Steps += th.Steps
		out.Threads = append(out.Threads, th)
	}
	return out, nil
}

// chartFrame is X(u, v) on a sphere of radius r (R = 0) or a torus, with
// the unit vectors along X_u and X_v. The sphere's are written by latitude,
// so they stay defined at its poles.
func chartFrame(R, r, u, v float64) (x, eu, ev Vec3) {
	cu, su, cv, sv := math.Cos(u), math.Sin(u), math.Cos(v), math.Sin(v)
	h := R + r*cv
	return Vec3{h * cu, h * su, r * sv}, Vec3{-su, cu, 0}, Vec3{-sv * cu, -sv * su, cv}
}

// arc is the arc length of sample k of n over length L.
func arc(L float64, k, n int) float64 { return L * float64(k) / float64(n) }

// closing measures how far a thread that ran its whole length ends from
// its start.
func (th *GeodesicThread) closing(r float64) {
	if th.Reason != "end" {
		return
	}
	th.Return = GeodesicReturn{th.End.sub(th.Points[0]).norm() / r, th.EndTangent.sub(th.Tangents[0]).norm()}
	th.Closes = th.Return.Position <= closureResidual && th.Return.Direction <= closureResidual
}

// sphereThread is the great circle from X(u₀, v₀) in direction beta,
// evaluated exactly: X(s) = X₀ cos(s/r) + r T₀ sin(s/r).
func sphereThread(r float64, g GeodesicRequest, beta float64) GeodesicThread {
	p0, eu, ev := chartFrame(0, r, g.U, g.V)
	b := beta * math.Pi / 180
	t0 := eu.mul(math.Cos(b)).add(ev.mul(math.Sin(b)))
	th := GeodesicThread{Direction: beta, Reason: "end", Reached: g.Length, Points: make([]Vec3, g.Samples+1), Tangents: make([]Vec3, g.Samples+1)}
	for k := range th.Points {
		c, s := math.Cos(arc(g.Length, k, g.Samples)/r), math.Sin(arc(g.Length, k, g.Samples)/r)
		th.Points[k] = p0.mul(c).add(t0.mul(r * s))
		th.Tangents[k] = p0.mul(-s / r).add(t0.mul(c))
	}
	th.End, th.EndTangent = th.Points[g.Samples], th.Tangents[g.Samples]
	th.closing(r)
	return th
}

// torusThread integrates the geodesic equations of the torus of radii
// R > r from X(u₀, v₀) in direction beta, for at most budget attempted
// steps.
//
// With ρ = R + r cos v, the metric is E = ρ², F = 0, G = r², and a unit
// speed geodesic in arc length s satisfies
//
//	u″ = (2r sin v/ρ) u′v′,  v″ = −(ρ sin v/r) u′²,
//
// from u′ = cos β/ρ, v′ = sin β/r. The state is written without units:
// (u, v, a = r u′, b = r v′) against τ = s/r, with k = R/r, so that
//
//	a′ = 2 sin v ab/(k + cos v),  b′ = −(k + cos v) sin v a²,
//
// and a unit tangent is (k + cos v)a along unit X_u and b along unit X_v.
// Each Dormand–Prince 5(4) step holds its local error, the largest of
// (k + cos v)δu, δv, (k + cos v)δa and δb, with the larger k + cos v at its
// ends, to geodesicTolerance: a position error in tube radii and a tangent
// error. Samples between steps are one step of the same method from the
// step's start, as ode.Solution evaluates them.
func torusThread(R, r float64, g GeodesicRequest, beta float64, budget int) GeodesicThread {
	k := R / r
	f := func(_ float64, y, out []float64) {
		w, sv := k+math.Cos(y[1]), math.Sin(y[1])
		out[0], out[1] = y[2], y[3]
		out[2] = 2 * sv * y[2] * y[3] / w
		out[3] = -w * sv * y[2] * y[2]
	}
	b := beta * math.Pi / 180
	y := []float64{g.U, g.V, math.Cos(b) / (k + math.Cos(g.V)), math.Sin(b)}
	th := GeodesicThread{Direction: beta}
	sample := func(y []float64) {
		x, eu, ev := chartFrame(R, r, y[0], y[1])
		th.Points = append(th.Points, x)
		th.Tangents = append(th.Tangents, eu.mul((k+math.Cos(y[1]))*y[2]).add(ev.mul(y[3])))
		th.U, th.V = append(th.U, y[0]), append(th.V, y[1])
	}
	sample(y)
	total := g.Length / r
	tau := func(i int) float64 { return arc(g.Length, i, g.Samples) / r }
	var step, dense ode.Stages
	e := make([]float64, 4)
	t, h, next := 0.0, math.Min(0.1, total), 1
	th.Reason = "unresolved"
	for {
		if t >= total {
			th.Reason = "end"
			break
		}
		if th.Steps >= budget {
			th.Reason = "exhausted"
			break
		}
		h = math.Min(h, maxTorusStep)
		last := t+h >= total
		if last {
			h = total - t
		} else if h < 1e-12*total {
			break
		}
		th.Steps++
		end := step.Step(f, t, y, h, true)
		step.Estimate(h, e)
		w := k + math.Max(math.Cos(y[1]), math.Cos(end[1]))
		size := math.Max(math.Max(w*math.Abs(e[0]), math.Abs(e[1])), math.Max(w*math.Abs(e[2]), math.Abs(e[3]))) / geodesicTolerance
		if !(size <= 1) || !finite(end[0]+end[1]+end[2]+end[3]) {
			if math.IsNaN(size) || math.IsInf(size, 0) {
				size = 1e10
			}
			h *= math.Max(.2, .9*math.Pow(math.Max(size, 1), -.2))
			continue
		}
		reached := t + h
		if last {
			reached = total
		}
		// The last step takes every remaining sample: s_N = L·N/N can
		// round above L, and so past the end it reaches.
		for ; next <= g.Samples && (last || tau(next) <= reached); next++ {
			if d := tau(next) - t; d < h && !(last && next == g.Samples) {
				sample(dense.Step(f, t, y, d, false))
			} else {
				sample(end)
			}
		}
		t = reached
		copy(y, end)
		if size == 0 {
			h *= 5
		} else {
			h *= math.Min(5, .9*math.Pow(size, -.2))
		}
	}
	x, eu, ev := chartFrame(R, r, y[0], y[1])
	th.End, th.EndTangent = x, eu.mul((k+math.Cos(y[1]))*y[2]).add(ev.mul(y[3]))
	th.EndU, th.EndV, th.Reached = y[0], y[1], t*r
	if th.Reason == "end" {
		th.Reached = g.Length
	}
	th.closing(r)
	return th
}

// geodesicFamily is every thread's points, for the bounds.
func (g *GeodesicResult) family() []*Vec3 {
	out := []*Vec3{}
	for i := range g.Threads {
		for k := range g.Threads[i].Points {
			out = append(out, &g.Threads[i].Points[k])
		}
	}
	return out
}
