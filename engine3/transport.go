package engine3

import (
	"fmt"
	"math"
	"tangentgarden/engine/ode"
)

// TransportRequest carries a tangent vector along a path of a geodesic
// study by the surface's Levi-Civita connection: along the selected thread
// ("thread"), around the octant triangle of a sphere ("triangle"), the
// quarter great circles from (r, 0, 0) to (0, r, 0), to (0, 0, r) and
// back, or around a geodesic polygon on a sphere ("polygon") through
// Vertices, in order, closed from the last back to the first.
//
// The vector is a unit vector, Angle degrees from the path's first unit
// tangent T toward N × T, where N, the unit vector along X_u × X_v, points
// out of the sphere, the ellipsoid and the torus's tube whichever way the
// study's normal is reversed. Size is how long it is drawn, in the
// surface's units of length, and has no part in the mathematics; Arrows
// reference arrows are evaluated at s = jL/M, j = 0…M − 1, along the path
// of length L. Vertices are read only for a polygon.
type TransportRequest struct {
	Path     string          `json:"path"`
	Angle    float64         `json:"angle"`
	Size     float64         `json:"size"`
	Arrows   int             `json:"arrows"`
	Vertices []PolygonVertex `json:"vertices,omitempty"`
}

// PolygonVertex is a corner of a geodesic polygon in the sphere's chart:
// longitude U and latitude V, within ±π/2.
type PolygonVertex struct {
	U float64 `json:"u"`
	V float64 `json:"v"`
}

// TransportSamples are states along the path at arc lengths Arcs: the
// point, the carried unit vector, the unit normal N and the path's unit
// tangent there. At a corner the tangent is the arriving side's.
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
// thread, with a closed path's corners among them (Corners, their
// indices) and, when the path stopped between samples, its state where it
// stopped. Reason, Edge, Reached and Steps are as for a thread: the arrow
// along an integrated thread is integrated on its own, with the same
// method, from the launch settings, and stops where its path leaves a
// patch. Returns says whether the path ends where it started, heading the
// way it started: a triangle or polygon always does, closed by
// construction; a thread only nearly, by the closure test of its own end.
// Holonomy is then the angle, in radians within (−π, π], by which the
// vector comes home turned about the start's N. Area is a closed path's
// signed area, positive counterclockwise seen from outside, within
// (−2πr², 2πr²]. Size is the request's drawn length, for the drawing.
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
	Edge        string           `json:"edge,omitempty"`
	Reached     float64          `json:"reached"`
	Steps       int              `json:"steps"`
	Returns     bool             `json:"returns"`
	Holonomy    float64          `json:"holonomy"`
	Area        float64          `json:"area"`
	Drift       TransportDrift   `json:"drift"`
}

// The most reference arrows along a path, and the most samples the arrow's
// path adds beyond a thread's N + 1, unless it is a polygon: two corners,
// or a stop between samples. A polygon has 3–maxPolygonVertices vertices,
// and each side subtends at least minPolygonSide radians and falls short
// of a half circle by as much.
const (
	maxTransportArrows = 36
	transportExtra     = 2
	maxPolygonVertices = 12
	minPolygonSide     = 1e-6
)

// extra is how many samples the arrow's path adds beyond N + 1: a
// polygon's corners after its first vertex, or two.
func (q TransportRequest) extra() int {
	if q.Path == "polygon" {
		return max(transportExtra, min(len(q.Vertices), maxPolygonVertices)-1)
	}
	return transportExtra
}

func (q TransportRequest) validate() error {
	switch {
	case q.Path != "thread" && q.Path != "triangle" && q.Path != "polygon":
		return fieldErr("surface.geodesics.transport.path", "the arrow follows the selected thread, the octant triangle or a geodesic polygon")
	case !bounded(q.Angle):
		return fieldErr("surface.geodesics.transport.angle", "the angle α must be finite and within ±100000°")
	case !finite(q.Size) || q.Size <= 0 || q.Size > 1e5:
		return fieldErr("surface.geodesics.transport.size", "the arrow's length must be above 0 and at most 100000")
	case q.Arrows < 0 || q.Arrows > maxTransportArrows:
		return fieldErr("surface.geodesics.transport.arrows", "use 0–%d reference arrows", maxTransportArrows)
	}
	if q.Path == "polygon" {
		return q.validatePolygon()
	}
	return nil
}

// validatePolygon checks the vertices' count and coordinates, and that
// each side, from a vertex to the next and from the last to the first,
// has one shortest great-circle arc: its ends neither coincide nor lie
// opposite, within minPolygonSide. A side's refusal names its later
// vertex.
func (q TransportRequest) validatePolygon() error {
	vs := q.Vertices
	n := len(vs)
	if n < 3 || n > maxPolygonVertices {
		return fieldErr("surface.geodesics.transport.vertices", "a polygon has 3–%d vertices", maxPolygonVertices)
	}
	field := func(k int, c string) string { return fmt.Sprintf("surface.geodesics.transport.vertices.%d.%s", k, c) }
	for k, p := range vs {
		if !bounded(p.U) {
			return fieldErr(field(k, "u"), "vertex %d: u must be finite and within ±100000", k+1)
		}
		if !(math.Abs(p.V) <= math.Pi/2) {
			return fieldErr(field(k, "v"), "vertex %d: v is a latitude, within ±π/2", k+1)
		}
	}
	ps := polygonPoints(vs)
	for i := range ps {
		j := (i + 1) % n
		switch theta := sideAngle(ps[i], ps[j]); {
		case theta < minPolygonSide:
			return fieldErr(field(j, "u"), "vertices %d and %d coincide, so the side between them has no direction", i+1, j+1)
		case theta > math.Pi-minPolygonSide:
			return fieldErr(field(j, "u"), "vertices %d and %d lie opposite, so no single shortest arc joins them", i+1, j+1)
		}
	}
	return nil
}

// polygonPoints are the vertices on the unit sphere.
func polygonPoints(vs []PolygonVertex) []Vec3 {
	ps := make([]Vec3, len(vs))
	for k, p := range vs {
		ps[k], _, _ = chartFrame(0, 1, p.U, p.V)
	}
	return ps
}

// sideAngle is the angle between unit vectors a and b, stable near 0 and π.
func sideAngle(a, b Vec3) float64 { return math.Atan2(a.cross(b).norm(), a.dot(b)) }

// sphericalArea is the signed area of the closed polygon through the unit
// vectors ps, with its sides the shorter arcs: positive when it runs
// counterclockwise seen from outside, counted once for each turn it makes
// around a region, within (−2π, 2π]. It is the sum of the signed spherical
// triangles from a reference direction c to each side, each by Van
// Oosterom and Strackee's tan(E/2) = c·(a × b)/(1 + c·a + a·b + b·c),
// which is defined unless c lies opposite a vertex. So c is the one of the
// 26 directions (i, j, k)/|(i, j, k)|, i, j, k ∈ {−1, 0, 1}, farthest from
// every vertex's antipode. The sum is the area to the path's left modulo
// the whole sphere, 4π, whatever c is.
func sphericalArea(ps []Vec3) float64 {
	best, c := -1.0, Vec3{}
	for i := -1.0; i <= 1; i++ {
		for j := -1.0; j <= 1; j++ {
			for k := -1.0; k <= 1; k++ {
				d := Vec3{i, j, k}
				if i == 0 && j == 0 && k == 0 {
					continue
				}
				d = d.mul(1 / d.norm())
				far := math.Inf(1)
				for _, p := range ps {
					far = math.Min(far, d.add(p).norm())
				}
				if far > best {
					best, c = far, d
				}
			}
		}
	}
	sum := 0.0
	for i, a := range ps {
		b := ps[(i+1)%len(ps)]
		sum += 2 * math.Atan2(c.dot(a.cross(b)), 1+c.dot(a)+a.dot(b)+b.dot(c))
	}
	sum = math.Mod(sum, 4*math.Pi)
	if sum <= -2*math.Pi {
		sum += 4 * math.Pi
	} else if sum > 2*math.Pi {
		sum -= 4 * math.Pi
	}
	return sum
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
// launched in direction beta, or around a closed path of a sphere; budget
// is the arrow's share of the fan's steps.
func (q SurfaceRequest) transport(surface string, beta float64, budget int) *TransportResult {
	g := *q.Geodesics
	tq := *g.Transport
	out := &TransportResult{Path: tq.Path, Size: tq.Size, Samples: newTransportSamples(), References: newTransportSamples(), Corners: []int{}}
	alpha := tq.Angle * math.Pi / 180
	switch {
	case tq.Path == "triangle" && surface != "sphere":
		out.Unavailable = "The octant triangle lies on a sphere; on this surface the arrow can follow the selected thread."
		return out
	case tq.Path == "polygon" && surface != "sphere":
		out.Unavailable = "A geodesic polygon is drawn on a sphere; on this surface the arrow can follow the selected thread."
		return out
	case tq.Path == "triangle":
		octantTransport(out, q.A, alpha, g.Samples, tq.Arrows)
	case tq.Path == "polygon":
		polygonTransport(out, q.A, alpha, g.Samples, tq.Arrows, tq.Vertices)
	case surface == "sphere":
		sphereTransport(out, q.A, g, beta, alpha, tq.Arrows)
	case surface == "torus":
		torusTransport(out, q.A, q.B, g, beta, alpha, tq.Arrows, budget)
	case surface == "ellipsoid":
		q.ellipsoidTransport(out, g, beta, alpha, tq.Arrows, budget)
	default:
		q.patchTransport(out, g, beta, alpha, tq.Arrows, budget)
	}
	r := q.A
	switch surface {
	case "sphere":
	case "torus":
		r = q.B
	default:
		r = q.offers().geodesics.scale(q)
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
// N × T = e₃. The samples are as for any closed path (see piecewise), with
// L = 3q.
func octantTransport(out *TransportResult, r, alpha float64, n, arrows int) {
	e := [3]Vec3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	q := math.Pi * r / 2
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
	piecewise(out, r, 3*q, []float64{q, 2 * q}, n, arrows, side)
	out.Area = sphericalArea(e[:]) * r * r
}

// polygonTransport carries the arrow around the geodesic polygon through
// vertices on a sphere of radius r, which validatePolygon admitted. Side i
// runs from unit vertex p_i to the next, p_{i+1}, the last side back to
// p₀, along the shorter great-circle arc: about the axis
// B_i = p_i × p_{i+1}/|p_i × p_{i+1}|, through the angle θ_i between
// them, with length rθ_i. On each side the vector it arrived with turns
// rigidly about B_i, as along any great circle, decomposed along the
// side's first tangent B_i × p_i and along B_i; a corner keeps the vector
// that arrived. At p₀ the path heads along B₀ × p₀, and N × T is B₀, so
// the vector starts cos α (B₀ × p₀) + sin α B₀. Everything is closed
// form, so it takes no steps.
func polygonTransport(out *TransportResult, r, alpha float64, n, arrows int, vertices []PolygonVertex) {
	ps := polygonPoints(vertices)
	m := len(ps)
	axes := make([]Vec3, m)
	ends := make([]float64, m)
	at := 0.0
	for i, p := range ps {
		w := p.cross(ps[(i+1)%m])
		axes[i] = w.mul(1 / w.norm())
		at += r * sideAngle(p, ps[(i+1)%m])
		ends[i] = at
	}
	starts := make([]Vec3, m)
	starts[0] = axes[0].cross(ps[0]).mul(math.Cos(alpha)).add(axes[0].mul(math.Sin(alpha)))
	side := func(i int, sigma float64) (p, v, tg Vec3) {
		from, axis := ps[i], axes[i]
		to := axis.cross(from)
		c, s := math.Cos(sigma/r), math.Sin(sigma/r)
		p = from.mul(r * c).add(to.mul(r * s))
		tg = from.mul(-s).add(to.mul(c))
		v = tg.mul(starts[i].dot(to)).add(axis.mul(starts[i].dot(axis)))
		return p, v, tg
	}
	for i := 1; i < m; i++ {
		begin := 0.0
		if i > 1 {
			begin = ends[i-2]
		}
		_, starts[i], _ = side(i-1, ends[i-1]-begin)
	}
	piecewise(out, r, ends[m-1], ends[:m-1], n, arrows, side)
	out.Area = sphericalArea(ps) * r * r
}

// piecewise samples a closed path of geodesic sides on a sphere of radius
// r, of total length L, whose side i is side(i, σ) at arc length σ from its
// start, the sides meeting at the increasing arc lengths corners. The
// samples are at kL/N with the corners among them: a sample within a
// billionth of a sample spacing of a corner becomes the corner, and
// otherwise the corner is inserted. A corner belongs to the side arriving
// at it. Reference arrows stand at jL/M.
func piecewise(out *TransportResult, r, length float64, corners []float64, n, arrows int, side func(i int, sigma float64) (p, v, tg Vec3)) {
	near := 1e-9 * length / float64(n)
	at := func(s *TransportSamples, arc float64) bool {
		corner := false
		for _, c := range corners {
			if math.Abs(arc-c) <= near {
				arc, corner = c, true
			}
		}
		i := 0
		for i < len(corners) && arc > corners[i] {
			i++
		}
		begin := 0.0
		if i > 0 {
			begin = corners[i-1]
		}
		p, v, tg := side(i, arc-begin)
		s.add(arc, p, v, p.mul(1/r), tg)
		return corner
	}
	next := 0
	for k := 0; k <= n; k++ {
		a := sampleArc(length, k, n)
		for next < len(corners) && corners[next] < a-near {
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

// integrated carries the arrow along a path integrated in a state y,
// against τ = s/l, by the system f with error size, stops leave and
// settle as torusRun takes them, for at most budget attempted steps: the
// samples at kL/N and the references at jL/M, merged in order, each as
// state gives it. Where the path stopped between samples, its state there
// ends the samples; nothing beyond a stop is kept.
func integrated(out *TransportResult, g GeodesicRequest, l float64, y []float64, f ode.Func, size func(y, end, e []float64) float64, lv leave, settle func([]float64), arrows, budget int, state func(s *TransportSamples, arc float64, y []float64)) {
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
			targets = append(targets, target{a / l, a, -j - 1})
		}
		targets = append(targets, target{s / l, sampleArc(g.Length, i, g.Samples), i})
	}
	taus := make([]float64, len(targets))
	for i, t := range targets {
		taus[i] = t.tau
	}
	state(&out.Samples, 0, y)
	if arrows > 0 {
		state(&out.References, 0, y)
	}
	reason, t, steps := torusRun(f, y, g.Length/l, taus, budget, size, func(i int, y []float64) {
		if tg := targets[i]; tg.name >= 0 {
			state(&out.Samples, tg.arc, y)
		} else {
			state(&out.References, tg.arc, y)
		}
	}, lv, settle)
	out.Length, out.Reason, out.Steps, out.Reached = g.Length, reason, steps, t*l
	if reason == "end" {
		out.Reached = g.Length
	}
	// Where it stopped between samples, its state there.
	arcs := out.Samples.Arcs
	if out.Reached > arcs[len(arcs)-1]+1e-9*g.Length/float64(g.Samples) {
		state(&out.Samples, out.Reached, y)
	}
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
	integrated(out, g, r, y, f, torusError(k), nil, nil, arrows, budget, state)
}

// ellipsoidTransport integrates the arrow along the thread of a three-axis
// ellipsoid from X(u₀, v₀) in direction beta, with the thread, for at most
// budget attempted steps, over the whole surface. The thread's state
// (X/ℓ, T) (see ellipsoidThread) carries V too: tangent along the path, V
// changes only along the normal WX, and keeping V·WX = 0 gives
//
//	V′ = −((V·WT)/(X·W²X)) WX,
//
// the equation of T with V in one place of T. It starts at angle α from
// T toward N × T, N the outward unit normal along WX. Each step's error
// includes |δV|. Each settle, after returning X and T to the surface,
// makes V tangent at the settled point, removing its normal component,
// and leaves its length alone, so the reported length drift measures the
// integration.
func (q SurfaceRequest) ellipsoidTransport(out *TransportResult, g GeodesicRequest, beta, alpha float64, arrows, budget int) {
	e := q.ellipsoidSystem()
	x, t0, n0 := q.ellipsoidLaunch(g, beta)
	v0 := t0.mul(math.Cos(alpha)).add(n0.cross(t0).mul(math.Sin(alpha)))
	l := e.l
	y := []float64{x.X / l, x.Y / l, x.Z / l, t0.X, t0.Y, t0.Z, v0.X, v0.Y, v0.Z}
	state := func(s *TransportSamples, arc float64, y []float64) {
		p := Vec3{y[0] * l, y[1] * l, y[2] * l}
		n := Vec3{e.w[0] * y[0], e.w[1] * y[1], e.w[2] * y[2]}
		s.add(arc, p, Vec3{y[6], y[7], y[8]}, n.mul(1/n.norm()), Vec3{y[3], y[4], y[5]})
	}
	integrated(out, g, l, y, e.f, e.size, nil, e.settle, arrows, budget, state)
}

// patchTransport integrates the arrow along the thread of a patch whose
// threads run within it, from X(u₀, v₀) in direction beta, with the
// thread, for at most budget attempted steps, until it has run its length
// or its path leaves the patch. The chart state (u, v, a, b) (see
// chartPath) carries V = (cX_u + dX_v)/ℓ as (c, d), which obey the
// geodesic's own equations with Q replaced by the bilinear
// X_uu ac + X_uv(ad + bc) + X_vv bd. Its first value is at angle α from
// the thread's tangent toward N × T, N the unit X_u × X_v, in the chart
// the metric is read from, so on the family its chart components are the
// same at every angle. A start on an edge heading out stops at once.
func (q SurfaceRequest) patchTransport(out *TransportResult, g GeodesicRequest, beta, alpha float64, arrows, budget int) {
	c := q.chartPath()
	y, t0, n0 := q.patchLaunch(c, g, beta)
	xu, xv, _, _, _ := q.chartDerivatives(g.U, g.V)
	v0 := t0.mul(math.Cos(alpha)).add(n0.cross(t0).mul(math.Sin(alpha)))
	vc, vd := c.components(xu, xv, v0)
	y = append(y, vc, vd)
	state := func(s *TransportSamples, arc float64, y []float64) {
		x, xu, xv, _, _, _ := q.patch(y[0], y[1])
		n := xu.cross(xv)
		s.add(arc, x, xu.mul(y[4]/c.l).add(xv.mul(y[5]/c.l)), n.mul(1/n.norm()), xu.mul(y[2]/c.l).add(xv.mul(y[3]/c.l)))
	}
	if edge := c.headingOut(y); edge != "" {
		state(&out.Samples, 0, y)
		if arrows > 0 {
			state(&out.References, 0, y)
		}
		out.Length, out.Reason, out.Edge = g.Length, "edge", edge
		return
	}
	integrated(out, g, c.l, y, c.f, c.size, c.leave, nil, arrows, budget, state)
	if out.Reason == "edge" {
		out.Edge = c.edge
	}
}
