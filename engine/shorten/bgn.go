package shorten

// The polygon solver for user loops (#409's arm C, shipped by #410): curve
// shortening of a closed polygon by the semi-implicit parametric scheme of
// Barrett, Garcke and Nürnberg (J. Comput. Phys. 222, 2007), with mass
// lumping.
//
// With X the vertices of a counterclockwise polygon, edge lengths h_j and
// outward edge normals ν_j, each vertex has the lumped mass
// m_i = (h_{i−1} + h_i)/2 and the weighted normal
// ω_i = (h_{i−1}ν_{i−1} + h_iν_i)/(h_{i−1} + h_i). A step solves
//
//	(m_i/Δt) ω_iω_iᵀ (X_i' − X_i) + (A X')_i = 0,
//	(A X)_i = (X_i − X_{i−1})/h_{i−1} − (X_{i+1} − X_i)/h_i,
//
// a symmetric positive definite cyclic block-tridiagonal system with 2×2
// blocks, in O(N). The normal velocity is the discrete curvature; the
// tangential velocity the scheme leaves free equidistributes the vertices
// over time, so vertices are never moved apart from the flow; the only
// remeshing halves them (below). It is first order in time and takes
// a polygon's corners as given. Steps are Δt = τ / max κ_i², with κ_i the
// discrete curvature |(AX)_i|/m_i, so the step sequence is covariant under
// scaling.
//
// Order 2 replaces the difference quotient by variable-step BDF2 and takes
// the geometry (m, ω, h) from the extrapolation X̃ = (1 + r)Xⁿ − rXⁿ⁻¹,
// r = Δtₙ/Δtₙ₋₁, as Jiang, Su and Zhang's second-order BGN scheme does:
//
//	(m̃_i/Δt) ω̃_iω̃_iᵀ (a X_i' − b_i) + (Ã X')_i = 0,
//	a = (1 + 2r)/(1 + r),  b = (1 + r)Xⁿ − r²/(1 + r) Xⁿ⁻¹.
//
// Remeshing: every remeshEvery accepted steps, a polygon of more than
// bgnNodes vertices keeps every other vertex when the halved polygon still
// turns at most turnLimit/2 at each vertex and its narrowest neck spans
// 2·neckSpacings of the new spacings. Each dropped vertex's distance from
// the new chord is the remeshing error, and the film keeps the largest.
// Seeks replay it at the same steps. An order-2 film restarts at order 1.
//
// The first step, which has no Xⁿ⁻¹, is order 1. Order 2 is experimental:
// the extrapolated geometry fails on corners and on fast tangential
// sliding (#409's findings), so order 1 is the default.

import (
	"fmt"
	"math"
)

type bgnFilm struct {
	End, Extinction, Area0 float64
	Stop                   string
	Stats                  Stats

	n      int
	order  int
	radius float64
	// Whether the last step reached its limit unshortened.
	landedWhole bool
	// When the solve remeshed, and the vertex count after each.
	remeshes    []bgnRemesh
	tau         float64
	horizon     float64
	floor       float64
	turn        float64
	checkpoints []bgnCheckpoint
	ws          bgnWork
}

type bgnRemesh struct {
	t     float64
	nodes int
}

type bgnCheckpoint struct {
	step int
	t    float64
	st   bgnState
}

// bgnState is the polygon and, for order 2, the one before it and the
// step between them (0 before the first step).
type bgnState struct {
	x, y, px, py []float64
	dt           float64
}

func (s bgnState) clone() bgnState {
	c := func(v []float64) []float64 { return append([]float64(nil), v...) }
	return bgnState{c(s.x), c(s.y), c(s.px), c(s.py), s.dt}
}

// kept is the state a checkpoint keeps: an order-1 step reads no previous
// polygon, so it is left out.
func (f *bgnFilm) kept(s bgnState) bgnState {
	if f.order == 1 {
		s.px, s.py, s.dt = nil, nil, 0
	}
	return s.clone()
}

type bgnWork struct {
	h, nx, ny          []float64
	b                  [][4]float64
	a, c               []float64
	px, py             []float64
	q                  [][4]float64
	bb                 [][4]float64
	rx, ry             []float64
	qq                 [][4]float64
	ox, oy, sx, sy, kx []float64
	gx, gy, ux, uy     []float64
}

func newBGNWork(n int) bgnWork {
	w := bgnWork{b: make([][4]float64, n), q: make([][4]float64, n), bb: make([][4]float64, n), qq: make([][4]float64, n)}
	for _, p := range []*[]float64{&w.h, &w.nx, &w.ny, &w.a, &w.c, &w.px, &w.py, &w.rx, &w.ry, &w.ox, &w.oy, &w.sx, &w.sy, &w.kx, &w.gx, &w.gy, &w.ux, &w.uy} {
		*p = make([]float64, n)
	}
	return w
}

// The largest ratio of consecutive order-2 steps.
const growth = 1.5

// Accepted steps between remeshing checks.
const remeshEvery = 16

// 2×2 matrices as [a b; c d] = [4]float64{a, b, c, d}.
func inv2(m [4]float64) ([4]float64, bool) {
	det := m[0]*m[3] - m[1]*m[2]
	if !(math.Abs(det) > 0) || math.IsInf(det, 0) {
		return m, false
	}
	return [4]float64{m[3] / det, -m[1] / det, -m[2] / det, m[0] / det}, true
}

func mul2(a, b [4]float64) [4]float64 {
	return [4]float64{a[0]*b[0] + a[1]*b[2], a[0]*b[1] + a[1]*b[3], a[2]*b[0] + a[3]*b[2], a[2]*b[1] + a[3]*b[3]}
}

func app2(m [4]float64, x, y float64) (float64, float64) {
	return m[0]*x + m[1]*y, m[2]*x + m[3]*y
}

// geometry fills edge lengths and outward normals, and reports whether
// every edge has positive finite length.
func (w *bgnWork) geometry(x, y []float64) bool {
	n := len(x)
	for j := range n {
		k := (j + 1) % n
		dx, dy := x[k]-x[j], y[k]-y[j]
		w.h[j] = math.Hypot(dx, dy)
		if !(w.h[j] > 0) || math.IsInf(w.h[j], 0) {
			return false
		}
		w.nx[j], w.ny[j] = dy/w.h[j], -dx/w.h[j]
	}
	return true
}

// curvatures writes κ_i·ω-free magnitudes |(AX)_i|/m_i into kx and returns
// the largest, after geometry.
func (w *bgnWork) curvatures(x, y []float64) float64 {
	n := len(x)
	top := 0.0
	for i := range n {
		p, q := (i+n-1)%n, (i+1)%n
		ax := (x[i]-x[p])/w.h[p] - (x[q]-x[i])/w.h[i]
		ay := (y[i]-y[p])/w.h[p] - (y[q]-y[i])/w.h[i]
		m := (w.h[p] + w.h[i]) / 2
		w.kx[i] = math.Hypot(ax, ay) / m
		top = math.Max(top, w.kx[i])
	}
	return top
}

// step advances st by dt into (ox, oy) and reports success: order 1, or
// order 2 once st has a previous polygon.
func (f *bgnFilm) step(st bgnState, dt float64, ox, oy []float64) bool {
	f.resize(len(st.x))
	w := &f.ws
	n := f.n
	x, y := st.x, st.y
	a := 1.0
	gx, gy := x, y
	bx, by := x, y
	if f.order == 2 && st.dt > 0 {
		r := dt / st.dt
		a = (1 + 2*r) / (1 + r)
		gx, gy, bx, by = w.gx, w.gy, w.sx, w.sy
		for i := range n {
			gx[i] = (1+r)*x[i] - r*st.px[i]
			gy[i] = (1+r)*y[i] - r*st.py[i]
			bx[i] = (1+r)*x[i] - r*r/(1+r)*st.px[i]
			by[i] = (1+r)*y[i] - r*r/(1+r)*st.py[i]
		}
	}
	if !w.geometry(gx, gy) {
		return false
	}
	// Row i: a_i X_{i−1} + B_i X_i + c_i X_{i+1} = d_i.
	for i := range n {
		p := (i + n - 1) % n
		m := (w.h[p] + w.h[i]) / 2
		ox_, oy_ := (w.h[p]*w.nx[p]+w.h[i]*w.nx[i])/(2*m), (w.h[p]*w.ny[p]+w.h[i]*w.ny[i])/(2*m)
		s := m / dt
		k := 1/w.h[p] + 1/w.h[i]
		w.b[i] = [4]float64{a*s*ox_*ox_ + k, a * s * ox_ * oy_, a * s * ox_ * oy_, a*s*oy_*oy_ + k}
		w.a[i], w.c[i] = -1/w.h[p], -1/w.h[i]
		// d_i = (m/Δt) ωωᵀ b_i.
		dot := ox_*bx[i] + oy_*by[i]
		w.rx[i], w.ry[i] = s*ox_*dot, s*oy_*dot
	}
	if !f.solve(ox, oy) {
		return false
	}
	for i := range n {
		if math.IsNaN(ox[i]) || math.IsInf(ox[i], 0) || math.IsNaN(oy[i]) || math.IsInf(oy[i], 0) {
			return false
		}
	}
	return true
}

// solve solves the cyclic block system in w (rows a, b, c, right side rx,
// ry) into (ox, oy): rows 1…N−1 as a block-tridiagonal system in X_1…
// X_{N−1} whose solution is affine in X_0, X_i = p_i + Q_i X_0, then row 0
// for X_0.
func (f *bgnFilm) solve(ox, oy []float64) bool {
	w := &f.ws
	n := f.n
	// Forward elimination over rows 1…N−1, carrying the right side and the
	// two columns of X_0's coupling (row 1 through a_1, row N−1 through
	// c_{N−1}).
	var prevInv [4]float64
	for i := 1; i < n; i++ {
		bi := w.b[i]
		rx, ry := w.rx[i], w.ry[i]
		var q [4]float64
		if i == 1 {
			q = [4]float64{-w.a[1], 0, 0, -w.a[1]}
		}
		if i == n-1 {
			q[0] -= w.c[n-1]
			q[3] -= w.c[n-1]
		}
		if i > 1 {
			// L = a_i B'_{i−1}^{-1}; B'_i = B_i − L c_{i−1}.
			l := prevInv
			for k := range l {
				l[k] *= w.a[i]
			}
			for k := range bi {
				bi[k] -= l[k] * w.c[i-1]
			}
			lx, ly := app2(l, w.px[i-1], w.py[i-1])
			rx, ry = rx-lx, ry-ly
			lq := mul2(l, w.qq[i-1])
			for k := range q {
				q[k] -= lq[k]
			}
		}
		inv, ok := inv2(bi)
		if !ok {
			return false
		}
		w.bb[i], prevInv = bi, inv
		w.px[i], w.py[i], w.qq[i] = rx, ry, q
	}
	// Back substitution: X_i = B'_i^{-1}(r'_i − c_i X_{i+1}), as p_i + Q_i X_0.
	for i := n - 1; i >= 1; i-- {
		inv, _ := inv2(w.bb[i])
		rx, ry := w.px[i], w.py[i]
		q := w.qq[i]
		if i < n-1 {
			rx -= w.c[i] * w.ux[i+1]
			ry -= w.c[i] * w.uy[i+1]
			for k := range q {
				q[k] -= w.c[i] * w.q[i+1][k]
			}
		}
		w.ux[i], w.uy[i] = app2(inv, rx, ry)
		w.q[i] = mul2(inv, q)
	}
	// Row 0: a_0 X_{N−1} + B_0 X_0 + c_0 X_1 = d_0.
	m := w.b[0]
	for k := range m {
		m[k] += w.a[0]*w.q[n-1][k] + w.c[0]*w.q[1][k]
	}
	rx := w.rx[0] - w.a[0]*w.ux[n-1] - w.c[0]*w.ux[1]
	ry := w.ry[0] - w.a[0]*w.uy[n-1] - w.c[0]*w.uy[1]
	inv, ok := inv2(m)
	if !ok {
		return false
	}
	x0, y0 := app2(inv, rx, ry)
	ox[0], oy[0] = x0, y0
	for i := 1; i < n; i++ {
		qx, qy := app2(w.q[i], x0, y0)
		ox[i], oy[i] = w.ux[i]+qx, w.uy[i]+qy
	}
	return true
}

// guard names the first state limit (x, y) fails, or "".
func (f *bgnFilm) guard(x, y []float64) string {
	if !f.ws.geometry(x, y) {
		return "positivity"
	}
	if math.Sqrt(math.Abs(signedArea(x, y))/math.Pi) < f.floor {
		return "floor"
	}
	if corner(x, y) > f.turn {
		return "resolution"
	}
	if !embedded(Contour{X: x, Y: y}) {
		return "embedding"
	}
	return ""
}

// next is the step rule from st at t, ending no later than limit: the
// next state and time.
func (f *bgnFilm) next(st bgnState, t, limit float64, ox, oy []float64, budget int) (float64, int, bool) {
	f.resize(len(st.x))
	f.ws.geometry(st.x, st.y)
	dt := f.tau / math.Pow(f.ws.curvatures(st.x, st.y), 2)
	// Variable-step BDF2 is zero-stable only for step ratios below 1 + √2;
	// as a corner rounds off, τ/κ² can grow faster than that.
	if f.order == 2 && st.dt > 0 {
		dt = math.Min(dt, growth*st.dt)
	}
	attempts := 0
	f.landedWhole = false
	for range min(retries+1, budget) {
		next := t + dt
		f.landedWhole = next == limit
		if next >= limit {
			next, dt = limit, limit-t
		}
		attempts++
		if f.step(st, dt, ox, oy) {
			return next, attempts, true
		}
		dt /= 2
	}
	return t, attempts, false
}

// resize makes the workspace fit a polygon of n vertices.
func (f *bgnFilm) resize(n int) {
	if f.n != n || len(f.ws.h) != n {
		f.n = n
		f.ws = newBGNWork(n)
	}
}

// coarsen halves st's polygon when the loop no longer needs its vertices,
// and reports the dropped vertices' largest distance from the new chords.
func (f *bgnFilm) coarsen(st bgnState) (bgnState, float64, bool) {
	n := len(st.x)
	m := (n + 1) / 2
	if m < bgnNodes {
		return st, 0, false
	}
	// The even vertices; an odd count keeps its last, beside the first.
	x2, y2 := make([]float64, m), make([]float64, m)
	for i := range m {
		x2[i], y2[i] = st.x[2*i], st.y[2*i]
	}
	if corner(x2, y2) > turnLimit/2 {
		return st, 0, false
	}
	c := Contour{X: x2, Y: y2}
	polygonStats(&c, x2[0], y2[0])
	if neck(st.x, st.y, 2*f.radius) < 2*neckSpacings*c.Length/float64(m) {
		return st, 0, false
	}
	e := 0.0
	for i := 1; i < n; i += 2 {
		a, b := i/2, (i/2+1)%m
		e = math.Max(e, pointSegment(st.x[i], st.y[i], x2[a], y2[a], x2[b], y2[b]))
	}
	return bgnState{x: x2, y: y2}, e, true
}

// advance makes (ox, oy), reached by step dt, the state, keeping st's
// polygon as the previous one; it returns the new state and the spare
// arrays for the next step.
func advance(st bgnState, ox, oy []float64, dt float64) (bgnState, []float64, []float64) {
	spareX, spareY := st.px, st.py
	if spareX == nil {
		spareX, spareY = make([]float64, len(ox)), make([]float64, len(oy))
	}
	return bgnState{x: ox, y: oy, px: st.x, py: st.y, dt: dt}, spareX, spareY
}

func (f *bgnFilm) run(x, y []float64) {
	n := len(x)
	st := bgnState{x: x, y: y}
	f.checkpoints = []bgnCheckpoint{{0, 0, st.clone()}}
	stats := &f.Stats
	stats.Stride = 1
	t := 0.0
	ox, oy := make([]float64, n), make([]float64, n)
	for {
		if t >= f.horizon {
			f.Stop = "horizon"
			break
		}
		n := len(st.x)
		budget := min(limits.Attempts-stats.Attempted, (limits.NodeUpdates-stats.NodeUpdates)/n)
		if budget <= 0 {
			f.Stop = "work"
			break
		}
		next, attempts, ok := f.next(st, t, f.horizon, ox, oy, budget)
		stats.Attempted += attempts
		stats.NodeUpdates += attempts * n
		if !ok {
			stats.Rejected += attempts
			f.Stop = "positivity"
			break
		}
		stats.Rejected += attempts - 1
		if why := f.guard(ox, oy); why != "" {
			stats.Discarded = 1
			f.Stop = why
			break
		}
		stats.Accepted++
		st, ox, oy = advance(st, ox, oy, next-t)
		t = next
		if stats.Accepted%remeshEvery == 0 {
			if c, e, ok := f.coarsen(st); ok {
				st = c
				stats.Remeshed++
				f.remeshes = append(f.remeshes, bgnRemesh{t, len(c.x)})
				stats.RemeshError = math.Max(stats.RemeshError, e/f.radius)
				ox, oy = make([]float64, len(c.x)), make([]float64, len(c.x))
			}
		}
		if stats.Accepted%stats.Stride == 0 {
			f.checkpoints = append(f.checkpoints, bgnCheckpoint{stats.Accepted, t, f.kept(st)})
			if len(f.checkpoints) > loopCheckpoints {
				kept := f.checkpoints[:0]
				for _, c := range f.checkpoints {
					if c.step%(2*stats.Stride) == 0 {
						kept = append(kept, c)
					}
				}
				f.checkpoints = kept
				stats.Stride *= 2
			}
		}
	}
	f.End = t
	stats.Checkpoints = len(f.checkpoints)
}

// Sample recomputes the polygon at t in [0, End] from the last checkpoint
// at or before t: the solve's own steps, the last one ending exactly at t.
func (f *bgnFilm) Sample(t float64) (Contour, error) {
	if !(t >= 0 && t <= f.End) {
		return Contour{}, fmt.Errorf("time %g is outside the solved interval [0, %g]", t, f.End)
	}
	k := 0
	for k+1 < len(f.checkpoints) && f.checkpoints[k+1].t <= t {
		k++
	}
	st := f.checkpoints[k].st.clone()
	ox, oy := make([]float64, len(st.x)), make([]float64, len(st.x))
	now, steps, index := f.checkpoints[k].t, 0, f.checkpoints[k].step
	for now < t {
		// The solve's step rule, landing on t; between checkpoints the
		// solve's steps are retaken exactly, since its limit was later.
		next, attempts, ok := f.next(st, now, t, ox, oy, retries+1)
		steps += attempts
		if !ok {
			return Contour{}, fmt.Errorf("a recomputed step failed at %g", now)
		}
		// A step the landing did not shorten is one of the solve's, so the
		// solve's remeshing follows it.
		full := next < t || f.landedWhole
		st, ox, oy = advance(st, ox, oy, next-now)
		now = next
		if full {
			index++
			if index%remeshEvery == 0 {
				if c, _, ok := f.coarsen(st); ok {
					st = c
					ox, oy = make([]float64, len(c.x)), make([]float64, len(c.x))
				}
			}
		}
	}
	x, y := st.x, st.y
	f.resize(len(x))
	out := Contour{T: t, X: x, Y: y, Steps: steps}
	f.ws.geometry(x, y)
	f.ws.curvatures(x, y)
	out.MinKappa, out.MaxKappa = math.Inf(1), math.Inf(-1)
	for i := range f.n {
		p, q := (i+f.n-1)%f.n, (i+1)%f.n
		ux, uy := x[i]-x[p], y[i]-y[p]
		vx, vy := x[q]-x[i], y[q]-y[i]
		turn := math.Atan2(ux*vy-uy*vx, ux*vx+uy*vy)
		k := turn / ((f.ws.h[p] + f.ws.h[i]) / 2)
		out.MinKappa, out.MaxKappa = math.Min(out.MinKappa, k), math.Max(out.MaxKappa, k)
	}
	polygonStats(&out, x[0], y[0])
	return out, nil
}

func (f *bgnFilm) Frames(times []float64) (Reply, error) {
	return frames(Reply{End: f.End, Extinction: f.Extinction, Area0: f.Area0, Stop: f.Stop, Stats: f.Stats}, times, f.Sample)
}

// bgn seeds the polygon arm. An outline keeps every vertex, with points
// inserted on each edge so that no edge is longer than L/N; a smooth loop
// is sampled at N points of equal arclength.
func (src *source) bgn(q LoopRequest) (*bgnFilm, int, float64, error) {
	n := q.Nodes
	if n == 0 {
		// Enough nodes for the narrowest neck to span neckSpacings of them,
		// from bgnNodes up to bgnTo.
		need := neckSpacings * src.adm.Length / (src.adm.Neck * src.adm.Radius) * 1.05
		n = int(math.Min(bgnTo, math.Max(bgnNodes, math.Ceil(need))))
	}
	if n < 32 || n > bgnTo {
		return nil, 0, 0, field("nodes", "Nodes must be from 32 to %d.", bgnTo)
	}
	tau := q.Tau
	if tau == 0 {
		tau = 0.0025
	}
	var x, y []float64
	if src.adm.Source == "outline" {
		total := src.adm.Length
		p := src.poly
		for j := range p {
			a, b := p[j], p[(j+1)%len(p)]
			k := int(math.Ceil(b.Sub(a).Norm() / (total / float64(n)) * (1 - 1e-12)))
			k = max(k, 1)
			for s := range k {
				w := float64(s) / float64(k)
				x = append(x, a.X+(b.X-a.X)*w)
				y = append(y, a.Y+(b.Y-a.Y)*w)
			}
		}
		if len(x) > bgnTo {
			return nil, 0, 0, &tooFine{field("nodes", "the outline needs %d nodes, more than %d", len(x), bgnTo), true}
		}
	} else {
		if src.smoothOK != "" {
			return nil, 0, 0, field(src.path(), "the loop is not certified embedded (%s)", src.smoothOK)
		}
		x, y = src.equalArc(n)
	}
	order := q.Order
	if order == 0 {
		order = 1
	}
	f := &bgnFilm{n: len(x), tau: tau, order: order, radius: src.adm.Radius}
	f.ws = newBGNWork(f.n)
	f.Area0 = math.Abs(signedArea(x, y))
	f.Extinction = f.Area0 / (2 * math.Pi)
	f.horizon = q.Horizon * f.Extinction
	f.floor = floorFraction * src.adm.Radius
	f.turn = math.Max(turnLimit, corner(x, y)*(1+1e-9))
	if !src.neckResolved(f.n) {
		return nil, 0, 0, &tooFine{field("nodes", "the loop's narrowest neck spans fewer than %d node spacings on %d nodes", neckSpacings, f.n), true}
	}
	if why := f.guard(x, y); why != "" {
		return nil, 0, 0, &tooFine{field("nodes", "the polygon fails the %s limit", why), false}
	}
	remesh := 0.0
	if src.adm.Source != "outline" {
		remesh = src.chordDeparture(x, y)
	}
	n0 := f.n
	f.run(x, y)
	return f, n0, remesh, nil
}
