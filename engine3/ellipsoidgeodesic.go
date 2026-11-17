package engine3

import "math"

// The thinnest ellipsoid whose threads are traced: its shortest semi-axis
// at least this fraction of its longest.
const minEllipsoidAspect = 1e-2

// ellipsoidThread integrates the geodesic of the ellipsoid of semi-axes
// a, b and c from X(u₀, v₀) in direction beta, for at most budget
// attempted steps, over the whole surface.
//
// The latitude chart X = (a cos v cos u, b cos v sin u, c sin v) is
// singular at the poles, so the thread is integrated in space instead,
// from the implicit equation x²/a² + y²/b² + z²/c² = 1, which is regular
// everywhere. With W = diag(1/a², 1/b², 1/c²) the normal is along WX,
// and a unit-speed geodesic, accelerating only along it, satisfies
//
//	X′ = T,  T′ = −((T·WT)/(X·W²X)) WX,
//
// which keeps X on the surface, T tangent and |T| = 1. It is written
// without units, in ℓ = the largest semi-axis: the state (X/ℓ, T) against
// τ = s/ℓ. Each Dormand–Prince 5(4) step holds the larger of |δX|/ℓ and
// |δT| to geodesicTolerance, and samples between steps are one step of
// the same method, as on the torus.
//
// Integrated as it stands, the system lets its constraints drift: errors
// in |T| feed the position, and the departure from the surface grows with
// the square of the length (to 10⁻² of the surface on the flattest
// admitted ellipsoid over 1000 units). So each accepted step ends settled
// back onto them: X scaled radially onto the surface, X/√F(X), exact for
// a quadric, then T made tangent there and unit. This moves the state by
// about the step's own error and leaves the route's accuracy as before;
// Joachimsthal's integral, which nothing enforces, measures it.
//
// The chart only places the start and the direction: β is measured from
// unit X_u toward the unit tangent perpendicular to it on X_v's side,
// with X_u/cos v = (−a sin u, b cos u, 0), so a launch at a pole is
// defined along meridian u₀, as on the sphere.
func (q SurfaceRequest) ellipsoidThread(g GeodesicRequest, beta float64, budget int) GeodesicThread {
	e := q.ellipsoidSystem()
	l := e.l
	x, t0, _ := q.ellipsoidLaunch(g, beta)
	y := []float64{x.X / l, x.Y / l, x.Z / l, t0.X, t0.Y, t0.Z}
	th := GeodesicThread{Direction: beta}
	state := func(y []float64) (Vec3, Vec3) {
		return Vec3{y[0] * l, y[1] * l, y[2] * l}, Vec3{y[3], y[4], y[5]}
	}
	sample := func(_ int, y []float64) {
		p, tg := state(y)
		th.Points = append(th.Points, p)
		th.Tangents = append(th.Tangents, tg)
	}
	sample(0, y)
	targets := make([]float64, g.Samples)
	for i := range targets {
		targets[i] = arc(g.Length, i+1, g.Samples) / l
	}
	var t float64
	th.Reason, t, th.Steps = torusRun(e.f, y, g.Length/l, targets, budget, e.size, sample, nil, e.settle)
	th.End, th.EndTangent = state(y)
	th.Reached = t * l
	if th.Reason == "end" {
		th.Reached = g.Length
	}
	th.closing(l)
	return th
}

// ellipsoidSystem is an ellipsoid's dimensionless geodesic system (see
// ellipsoidThread), in units of l, its largest semi-axis, with w the
// diagonal of ℓ²W. A state longer than (X/ℓ, T) carries a vector V after
// them (see ellipsoidTransport): f, size and settle treat it too.
type ellipsoidSystem struct {
	l      float64
	w      [3]float64
	f      func(t float64, y, out []float64)
	size   func(y, end, e []float64) float64
	settle func(y []float64)
}

func (q SurfaceRequest) ellipsoidSystem() ellipsoidSystem {
	l := q.offers().geodesics.scale(q)
	w := [3]float64{(l / q.A) * (l / q.A), (l / q.B) * (l / q.B), (l / q.C) * (l / q.C)}
	e := ellipsoidSystem{l: l, w: w}
	e.f = func(_ float64, y, out []float64) {
		var bend, normal float64
		for i, wi := range w {
			bend += wi * y[3+i] * y[3+i]
			normal += wi * wi * y[i] * y[i]
		}
		k := bend / normal
		for i, wi := range w {
			out[i] = y[3+i]
			out[3+i] = -k * wi * y[i]
		}
		if len(y) > 6 {
			var turn float64
			for i, wi := range w {
				turn += wi * y[6+i] * y[3+i]
			}
			k = turn / normal
			for i, wi := range w {
				out[6+i] = -k * wi * y[i]
			}
		}
	}
	e.size = func(_, _, e []float64) float64 {
		size := math.Max(math.Sqrt(e[0]*e[0]+e[1]*e[1]+e[2]*e[2]), math.Sqrt(e[3]*e[3]+e[4]*e[4]+e[5]*e[5]))
		if len(e) > 6 {
			size = math.Max(size, math.Sqrt(e[6]*e[6]+e[7]*e[7]+e[8]*e[8]))
		}
		return size / geodesicTolerance
	}
	e.settle = func(y []float64) {
		var level float64
		for i, wi := range w {
			level += wi * y[i] * y[i]
		}
		scale := 1 / math.Sqrt(level)
		for i := range w {
			y[i] *= scale
		}
		n := Vec3{w[0] * y[0], w[1] * y[1], w[2] * y[2]}
		n = n.mul(1 / n.norm())
		tg := Vec3{y[3], y[4], y[5]}
		tg = tg.sub(n.mul(tg.dot(n)))
		tg = tg.mul(1 / tg.norm())
		y[3], y[4], y[5] = tg.X, tg.Y, tg.Z
		if len(y) > 6 {
			v := Vec3{y[6], y[7], y[8]}
			v = v.sub(n.mul(v.dot(n)))
			y[6], y[7], y[8] = v.X, v.Y, v.Z
		}
	}
	return e
}

// ellipsoidLaunch is a thread's start X(u₀, v₀), its unit tangent in
// direction beta (see ellipsoidThread) and the outward unit normal there.
func (q SurfaceRequest) ellipsoidLaunch(g GeodesicRequest, beta float64) (x, t0, n Vec3) {
	cu, su, cv, sv := math.Cos(g.U), math.Sin(g.U), math.Cos(g.V), math.Sin(g.V)
	x = Vec3{q.A * cv * cu, q.B * cv * su, q.C * sv}
	along := Vec3{-q.A * su, q.B * cu, 0}
	eu := along.mul(1 / along.norm())
	xv := Vec3{-q.A * sv * cu, -q.B * sv * su, q.C * cv}
	side := xv.sub(eu.mul(xv.dot(eu)))
	b := beta * math.Pi / 180
	t0 = eu.mul(math.Cos(b)).add(side.mul(math.Sin(b) / side.norm()))
	n = Vec3{x.X / (q.A * q.A), x.Y / (q.B * q.B), x.Z / (q.C * q.C)}
	return x, t0, n.mul(1 / n.norm())
}
