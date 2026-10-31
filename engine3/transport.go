package engine3

import (
	"math"
)

// TransportRequest carries a tangent vector along a path of a geodesic
// study by the surface's Levi-Civita connection: along the selected thread
// ("thread"), or around the octant triangle of a sphere ("triangle"), the
// quarter great circles from (r, 0, 0) to (0, r, 0), to (0, 0, r) and
// back.
//
// The vector is a unit vector, Angle degrees from the path's first unit
// tangent T toward N × T, where N, the unit vector along X_u × X_v, points
// out of the sphere and out of the torus's tube whichever way the study's
// normal is reversed. Size is how long it is drawn, in the surface's units
// of length, and has no part in the mathematics; Arrows reference arrows
// are evaluated at s = jL/M, j = 0…M − 1, along the path of length L.
type TransportRequest struct {
	Path   string  `json:"path"`
	Angle  float64 `json:"angle"`
	Size   float64 `json:"size"`
	Arrows int     `json:"arrows"`
}

// TransportSamples are states along the path at arc lengths Arcs: the
// point, the carried unit vector, the unit normal N and the path's unit
// tangent there. At a triangle's corner the tangent is the arriving
// side's.
type TransportSamples struct {
	Arcs     []float64 `json:"arcs"`
	Points   []Vec3    `json:"points"`
	Vectors  []Vec3    `json:"vectors"`
	Normals  []Vec3    `json:"normals"`
	Tangents []Vec3    `json:"tangents"`
}

// TransportDrift is the largest departure of the carried vector from unit
// length, and from the tangent plane (its component along N), over every
// sample and reference.
type TransportDrift struct {
	Norm     float64 `json:"norm"`
	Tangency float64 `json:"tangency"`
}

// TransportResult is the carried vector along Path, of length Length.
// Samples are at s_k = kL/N, k = 0…N, for the study's N samples per
// thread, with a triangle's two corners among them (Corners, their
// indices) and, when the path stopped between samples, its state where it
// stopped. Reason, Reached and Steps are as for a thread: the arrow along
// a torus thread is integrated on its own, with the same method, from the
// launch settings. Returns says whether the path ends where it started,
// heading the way it started (the triangle always does; a thread by the
// closure test of its own end), and Holonomy is then the angle, in
// radians within (−π, π], by which the vector comes home turned about the
// start's N. Size is the request's drawn length, for the drawing.
// Unavailable, when set, says why there is no arrow.
type TransportResult struct {
	Path        string           `json:"path"`
	Unavailable string           `json:"unavailable,omitempty"`
	Length      float64          `json:"length"`
	Size        float64          `json:"size"`
	Samples     TransportSamples `json:"samples"`
	References  TransportSamples `json:"references"`
	Corners     []int            `json:"corners"`
	Reason      string           `json:"reason"`
	Reached     float64          `json:"reached"`
	Steps       int              `json:"steps"`
	Returns     bool             `json:"returns"`
	Holonomy    float64          `json:"holonomy"`
	Drift       TransportDrift   `json:"drift"`
}

// The most reference arrows along a path, and the most samples the arrow's
// path adds beyond a thread's N + 1: two corners, or a stop between
// samples.
const (
	maxTransportArrows = 36
	transportExtra     = 2
)

func (q TransportRequest) validate() error {
	switch {
	case q.Path != "thread" && q.Path != "triangle":
		return fieldErr("surface.geodesics.transport.path", "the arrow follows the selected thread or the octant triangle")
	case !bounded(q.Angle):
		return fieldErr("surface.geodesics.transport.angle", "the angle α must be finite and within ±100000°")
	case !finite(q.Size) || q.Size <= 0 || q.Size > 1e5:
		return fieldErr("surface.geodesics.transport.size", "the arrow's length must be above 0 and at most 100000")
	case q.Arrows < 0 || q.Arrows > maxTransportArrows:
		return fieldErr("surface.geodesics.transport.arrows", "use 0–%d reference arrows", maxTransportArrows)
	}
	return nil
}

func newTransportSamples() TransportSamples {
	return TransportSamples{Arcs: []float64{}, Points: []Vec3{}, Vectors: []Vec3{}, Normals: []Vec3{}, Tangents: []Vec3{}}
}

func (s *TransportSamples) add(arc float64, p, v, n, tg Vec3) {
	s.Arcs = append(s.Arcs, arc)
	s.Points = append(s.Points, p)
	s.Vectors = append(s.Vectors, v)
	s.Normals = append(s.Normals, n)
	s.Tangents = append(s.Tangents, tg)
}

// finish measures the drift and, for a path that ends where it started,
// the holonomy.
func (tr *TransportResult) finish(r float64) {
	for _, s := range []TransportSamples{tr.Samples, tr.References} {
		for k, v := range s.Vectors {
			tr.Drift.Norm = math.Max(tr.Drift.Norm, math.Abs(v.norm()-1))
			tr.Drift.Tangency = math.Max(tr.Drift.Tangency, math.Abs(v.dot(s.Normals[k])))
		}
	}
	s := tr.Samples
	last := len(s.Points) - 1
	if tr.Path == "thread" {
		tr.Returns = tr.Reason == "end" && last > 0 &&
			s.Points[last].sub(s.Points[0]).norm() <= closureResidual*r &&
			s.Tangents[last].sub(s.Tangents[0]).norm() <= closureResidual
	}
	if tr.Returns {
		v0, v1 := s.Vectors[0], s.Vectors[last]
		tr.Holonomy = math.Atan2(s.Normals[0].dot(v0.cross(v1)), v0.dot(v1))
	}
}

// transport carries the request's arrow along the fan's selected thread,
// launched in direction beta, or around the triangle; budget is the
// arrow's share of the fan's steps.
func (q SurfaceRequest) transport(surface string, beta float64, budget int) *TransportResult {
	g := *q.Geodesics
	tq := *g.Transport
	out := &TransportResult{Path: tq.Path, Size: tq.Size, Samples: newTransportSamples(), References: newTransportSamples(), Corners: []int{}}
	alpha := tq.Angle * math.Pi / 180
	switch {
	case tq.Path == "triangle" && surface != "sphere":
		out.Unavailable = "The octant triangle lies on a sphere; on a torus the arrow can follow the selected thread."
		return out
	case tq.Path == "triangle":
		octantTransport(out, q.A, alpha, g.Samples, tq.Arrows)
	case surface == "sphere":
		sphereTransport(out, q.A, g, beta, alpha, tq.Arrows)
	default:
		torusTransport(out, q.A, q.B, g, beta, alpha, tq.Arrows, budget)
	}
	r := q.A
	if surface == "torus" {
		r = q.B
	}
	out.finish(r)
	return out
}

// sphereTransport carries the arrow along the great circle from X(u₀, v₀)
// in direction beta. On a sphere of radius r the Levi-Civita equation of a
// tangent field V along a unit-speed path X(s) is dV/ds = −(V·T)X/r²: V
// changes only along the normal. Along a great circle with tangent T(s)
// the axis B = X₀ × T₀/r is fixed, and V(s) = cos α T(s) + sin α B solves
// it exactly: the vector turns rigidly with the circle.
func sphereTransport(out *TransportResult, r float64, g GeodesicRequest, beta, alpha float64, arrows int) {
	p0, eu, ev := chartFrame(0, r, g.U, g.V)
	b := beta * math.Pi / 180
	t0 := eu.mul(math.Cos(b)).add(ev.mul(math.Sin(b)))
	axis := p0.cross(t0).mul(1 / r)
	at := func(s *TransportSamples, arc float64) {
		c, sn := math.Cos(arc/r), math.Sin(arc/r)
		p := p0.mul(c).add(t0.mul(r * sn))
		tg := p0.mul(-sn / r).add(t0.mul(c))
		s.add(arc, p, tg.mul(math.Cos(alpha)).add(axis.mul(math.Sin(alpha))), p.mul(1/r), tg)
	}
	for k := 0; k <= g.Samples; k++ {
		at(&out.Samples, sampleArc(g.Length, k, g.Samples))
	}
	for j := 0; j < arrows; j++ {
		at(&out.References, arc(g.Length, j, arrows))
	}
	out.Length, out.Reached, out.Reason = g.Length, g.Length, "end"
}

// sampleArc is sample k of n over length L, the last exactly L.
func sampleArc(L float64, k, n int) float64 {
	if k == n {
		return L
	}
	return arc(L, k, n)
}

// octantTransport carries the arrow around the octant triangle of a sphere
// of radius r: side i runs from r e_i to r e_{i+1}, a quarter great circle
// of length q = πr/2 about the axis B_i = e_i × e_{i+1}. On each side the
// vector it arrived with, V_i, turns rigidly about B_i, as along any great
// circle (see sphereTransport); a corner keeps the vector that arrived,
// and the next side turns it about its own axis. The vector starts
// cos α e₂ + sin α e₃, at angle α from the first side's tangent e₂ toward
// N × T = e₃. A corner belongs to the side arriving at it, and the samples
// are at kL/N with the two corners among them, L = 3q.
func octantTransport(out *TransportResult, r, alpha float64, n, arrows int) {
	e := [3]Vec3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	q := math.Pi * r / 2
	length := 3 * q
	corners := [2]float64{q, 2 * q}
	// The vector each side starts with.
	var start [3]Vec3
	start[0] = e[1].mul(math.Cos(alpha)).add(e[2].mul(math.Sin(alpha)))
	side := func(i int, sigma float64) (p, v, tg Vec3) {
		from, to, axis := e[i], e[(i+1)%3], e[i].cross(e[(i+1)%3])
		c, s := math.Cos(sigma/r), math.Sin(sigma/r)
		p = from.mul(r * c).add(to.mul(r * s))
		tg = from.mul(-s).add(to.mul(c))
		v = tg.mul(start[i].dot(to)).add(axis.mul(start[i].dot(axis)))
		return p, v, tg
	}
	for i := 1; i < 3; i++ {
		_, start[i], _ = side(i-1, q)
	}
	// The arc of each sample, a corner when within a billionth of a sample
	// spacing of one.
	near := 1e-9 * length / float64(n)
	at := func(s *TransportSamples, arc float64) bool {
		corner := false
		for _, c := range corners {
			if math.Abs(arc-c) <= near {
				arc, corner = c, true
			}
		}
		i := 0
		for i < 2 && arc > corners[i] {
			i++
		}
		p, v, tg := side(i, arc-float64(i)*q)
		s.add(arc, p, v, p.mul(1/r), tg)
		return corner
	}
	next := 0
	for k := 0; k <= n; k++ {
		a := sampleArc(length, k, n)
		for next < 2 && corners[next] < a-near {
			at(&out.Samples, corners[next])
			out.Corners = append(out.Corners, len(out.Samples.Arcs)-1)
			next++
		}
		if at(&out.Samples, a) {
			out.Corners = append(out.Corners, len(out.Samples.Arcs)-1)
			next++
		}
	}
	for j := 0; j < arrows; j++ {
		at(&out.References, arc(length, j, arrows))
	}
	out.Length, out.Reached, out.Reason, out.Returns = length, length, "end", true
}

// torusTransport integrates the arrow along the thread from X(u₀, v₀) in
// direction beta, with the thread, for at most budget attempted steps.
//
// With ρ = R + r cos v, the only Christoffel symbols of the torus are
// Γ^u_uv = Γ^u_vu = −r sin v/ρ and Γ^v_uu = ρ sin v/r, so a vector
// V = p X_u + q X_v is carried along the path (u(s), v(s)) when
//
//	p′ = (r sin v/ρ)(u′q + v′p),  q′ = −(ρ sin v/r) u′p,
//
// the equations the geodesic's own tangent obeys. In the thread's
// dimensionless state, with c = r p, d = r q against τ = s/r and k = R/r,
//
//	c′ = sin v (ad + bc)/(k + cos v),  d′ = −(k + cos v) sin v ac,
//
// and V is (k + cos v)c along unit X_u plus d along unit X_v. Its first
// value, at angle α from the thread's tangent toward N × T, is the unit
// vector at β + α from unit X_u. The six components are integrated
// together, each step's error measured on all of them (see torusError),
// and nothing renormalizes the vector or projects it onto the surface.
func torusTransport(out *TransportResult, R, r float64, g GeodesicRequest, beta, alpha float64, arrows, budget int) {
	k := R / r
	geodesic := torusGeodesic(k)
	f := func(t float64, y, dy []float64) {
		geodesic(t, y, dy)
		w, sv := k+math.Cos(y[1]), math.Sin(y[1])
		dy[4] = sv * (y[2]*y[5] + y[3]*y[4]) / w
		dy[5] = -w * sv * y[2] * y[4]
	}
	b := beta * math.Pi / 180
	w0 := k + math.Cos(g.V)
	y := []float64{g.U, g.V, math.Cos(b) / w0, math.Sin(b), math.Cos(b+alpha) / w0, math.Sin(b + alpha)}
	state := func(s *TransportSamples, arc float64, y []float64) {
		x, eu, ev := chartFrame(R, r, y[0], y[1])
		w := k + math.Cos(y[1])
		s.add(arc, x, eu.mul(w*y[4]).add(ev.mul(y[5])), eu.cross(ev), eu.mul(w*y[2]).add(ev.mul(y[3])))
	}
	// The samples' and references' arc lengths, merged in order, each
	// target naming which it is: k ≥ 0 a sample, −j − 1 a reference.
	type target struct {
		tau  float64
		arc  float64
		name int
	}
	targets := make([]target, 0, g.Samples+arrows)
	j := 1
	for i := 1; i <= g.Samples; i++ {
		s := arc(g.Length, i, g.Samples)
		for ; j < arrows && arc(g.Length, j, arrows) < s; j++ {
			a := arc(g.Length, j, arrows)
			targets = append(targets, target{a / r, a, -j - 1})
		}
		targets = append(targets, target{s / r, sampleArc(g.Length, i, g.Samples), i})
	}
	taus := make([]float64, len(targets))
	for i, t := range targets {
		taus[i] = t.tau
	}
	state(&out.Samples, 0, y)
	if arrows > 0 {
		state(&out.References, 0, y)
	}
	reason, t, steps := torusRun(f, y, g.Length/r, taus, budget, torusError(k), func(i int, y []float64) {
		if tg := targets[i]; tg.name >= 0 {
			state(&out.Samples, tg.arc, y)
		} else {
			state(&out.References, tg.arc, y)
		}
	})
	out.Length, out.Reason, out.Steps, out.Reached = g.Length, reason, steps, t*r
	if reason == "end" {
		out.Reached = g.Length
	}
	// Where it stopped between samples, its state there.
	arcs := out.Samples.Arcs
	if out.Reached > arcs[len(arcs)-1]+1e-9*g.Length/float64(g.Samples) {
		state(&out.Samples, out.Reached, y)
	}
}
