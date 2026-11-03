// Package shorten evolves a smooth closed loop by curve shortening,
// dX/dt = -κ n_out (docs/mathematics.md#curves-that-smooth-themselves).
// Two schemes share one Film: a flower as a radial graph (bloom.go) and a
// strictly convex loop through its support function h(θ) on a fixed grid of
// outward normal angles, described here.
//
// For a strictly convex loop the outward normal angle θ is an intrinsic
// parameter: X(θ) = h n + h_θ T with n = (cos θ, sin θ), T = (−sin θ, cos θ),
// and the radius of curvature is ρ = h + h_θθ > 0. At fixed θ the inward
// flow is h_t = −1/ρ. The flow keeps a convex loop convex and makes it
// rounder, so the grid is never remeshed or reparameterized.
//
// Space: ρ_i = h_i + (h_{i+1} − 2h_i + h_{i−1}) / (2(1 − cos Δθ)) and
// h_θ,i = (h_{i+1} − h_{i−1}) / (2 sin Δθ). Both are second order and exact
// on constants and first harmonics, so a circle and any translation are
// represented without spatial error.
//
// Time: the linearly implicit two-stage Rosenbrock method ROS2 of Verwer,
// Spee, Blom and Hundsdorfer (γ = 1 + 1/√2; order 2 for any Jacobian,
// L-stable with the exact one), using the exact Jacobian diag(1/ρ²)(I + D₂),
// a cyclic tridiagonal matrix solved in O(N). Steps are Δt = τ·min ρ²:
// time has units of length², so τ is dimensionless and the step sequence is
// covariant under scaling. A step with a nonfinite value or a nonpositive ρ
// at either stage is rejected and retried at half the step.
//
// Every accepted state must keep the neighbor curvature variation
// |ρ_{i+1} − ρ_i| / min(ρ_i, ρ_{i+1}) at most 1/4 and min ρ at least 1/20
// of the initial equal-area radius √(A₀/π). The first state that fails ends
// the film at the state before it; nothing beyond is returned.
package shorten

import (
	"fmt"
	"math"

	"tangentgarden/engine"
)

// Seed is a supported initial loop: the support function
// h(θ) = R(1 + ε cos(mθ)) about (CenterX, CenterY). With m in {3, 6} and
// |ε|(m²−1) ≤ 1/2 its radius of curvature R(1 + ε(1−m²) cos(mθ)) is at
// least R/2. Mode 0 with ε = 0 is a circle.
type Seed struct {
	Radius  float64 `json:"radius"`
	Mode    int     `json:"mode"`
	Epsilon float64 `json:"epsilon"`
	CenterX float64 `json:"centerX"`
	CenterY float64 `json:"centerY"`
}

// Request is one evolution: the seed, the number of normal-angle nodes,
// the dimensionless step factor τ, and the horizon as a fraction of the
// continuum extinction time A₀/2π.
type Request struct {
	Seed    Seed    `json:"seed"`
	Nodes   int     `json:"nodes"`
	Tau     float64 `json:"tau"`
	Horizon float64 `json:"horizon"`
}

// Stats counts a solve's work. A node update is one node through one
// attempted step; Remeshed is always 0 and is reported to say so.
type Stats struct {
	Accepted  int `json:"accepted"`
	Rejected  int `json:"rejected"`
	Attempted int `json:"attempted"`
	// Discarded is 1 when a successful step failed a state limit and ended
	// the film; that state is never returned.
	Discarded int `json:"discarded"`
	// Trials are the steps of root solves that land a partial step on a
	// horizon, used by the tests' arclength reference; counted in
	// NodeUpdates, not in Attempted.
	Trials      int `json:"trials,omitempty"`
	Remeshed    int `json:"remeshed"`
	NodeUpdates int `json:"nodeUpdates"`
	Checkpoints int `json:"checkpoints"`
	// Stride is the number of accepted steps between checkpoints, and so
	// the most a seek recomputes, apart from rejected attempts and the
	// final partial step.
	Stride int `json:"stride"`
}

// The experiment's ceilings, per solve. Tests lower them.
var limits = struct {
	Nodes, Checkpoints, Attempts, NodeUpdates int
	MinTau                                    float64
}{512, 64, 100_000, 20_000_000, 0.001}

const (
	// The largest neighbor curvature variation an accepted state may have.
	resolution = 0.25
	// The curvature floor, as a fraction of the initial equal-area radius.
	floorFraction = 0.05
	// Halvings of a rejected step before the film ends.
	retries = 30
)

// Contour is the loop at one time: its vertices at the N normal angles
// 2πi/N, counterclockwise, with diagnostics of the returned polygon and of
// the solver's radius of curvature, and the steps recomputed to reach it.
type Contour struct {
	T       float64   `json:"t"`
	X       []float64 `json:"x"`
	Y       []float64 `json:"y"`
	MinRho  float64   `json:"minRho,omitempty"`
	MaxRho  float64   `json:"maxRho,omitempty"`
	Area    float64   `json:"area"`
	Length  float64   `json:"length"`
	CenterX float64   `json:"centerX"`
	CenterY float64   `json:"centerY"`
	Steps   int       `json:"steps"`
	Trials  int       `json:"trials,omitempty"`
	// Experiment 2: the closure defect removed, and the curvature range.
	Closure  float64 `json:"closure,omitempty"`
	MinKappa float64 `json:"minKappa,omitempty"`
	MaxKappa float64 `json:"maxKappa,omitempty"`
}

type checkpoint struct {
	step int
	t    float64
	h    []float64
}

// A scheme is a semi-discrete evolution h' = F(h) on N nodes: its step
// rate, F with its cyclic tridiagonal Jacobian, the state limits and the
// geometry. Film steps every scheme with ROS2 and the same rule.
type scheme interface {
	size() int
	// rate is the step rule's scale: dt = τ / rate(h), in 1/length².
	rate(h []float64) float64
	// eval writes F(h) into out and, when jac is not nil, its Jacobian, and
	// reports whether h is a valid state.
	eval(h, out []float64, jac *tri) bool
	// guard names the first state limit h fails, or "".
	guard(h []float64) string
	contour(t float64, h []float64, steps int) Contour
}

// tri is a cyclic tridiagonal matrix: row i is sub[i]·x[i−1] + diag[i]·x[i]
// + sup[i]·x[i+1], indices mod N.
type tri struct{ sub, diag, sup []float64 }

func newTri(n int) tri {
	return tri{make([]float64, n), make([]float64, n), make([]float64, n)}
}

// Film is a solved evolution on [0, End]: retained checkpoints from which
// any time in that interval is recomputed by the same step rule, so a
// sample depends only on the request and the time.
type Film struct {
	End        float64
	Extinction float64
	Area0      float64
	// Stop is "horizon", or what ended the film first: the scheme's limit
	// ("curvature" or "floor", "resolution", "star"), "positivity" (no
	// valid step) or "work".
	Stop  string
	Stats Stats

	s           scheme
	tau         float64
	horizon     float64
	checkpoints []checkpoint
	ws          workspace
}

type workspace struct {
	f, k1, k2, stage, u, z, cp []float64
	w                          tri
}

func newWorkspace(n int) workspace {
	ws := workspace{w: newTri(n)}
	for _, p := range []*[]float64{&ws.f, &ws.k1, &ws.k2, &ws.stage, &ws.u, &ws.z, &ws.cp} {
		*p = make([]float64, n)
	}
	return ws
}

// solveCyclic solves m·x = r in place of r by the Thomas algorithm with a
// Sherman–Morrison correction for the corners. The schemes keep m strictly
// diagonally dominant, so no pivoting is needed.
func (ws *workspace) solveCyclic(m tri, r []float64) {
	n := len(r)
	alpha, beta := m.sub[0], m.sup[n-1]
	gamma := -m.diag[0]
	bb := ws.cp
	copy(bb, m.diag)
	bb[0] -= gamma
	bb[n-1] -= alpha * beta / gamma
	u := ws.u
	for i := range u {
		u[i] = 0
	}
	u[0], u[n-1] = gamma, beta
	tridiagonal(m.sub, bb, m.sup, r, ws.z)
	tridiagonal(m.sub, bb, m.sup, u, ws.z)
	fact := (r[0] + alpha*r[n-1]/gamma) / (1 + u[0] + alpha*u[n-1]/gamma)
	for i := range r {
		r[i] -= fact * u[i]
	}
}

// tridiagonal solves in place of r, with scratch w.
func tridiagonal(a, b, c, r, w []float64) {
	n := len(r)
	beta := b[0]
	r[0] /= beta
	for i := 1; i < n; i++ {
		w[i] = c[i-1] / beta
		beta = b[i] - a[i]*w[i]
		r[i] = (r[i] - a[i]*r[i-1]) / beta
	}
	for i := n - 2; i >= 0; i-- {
		r[i] -= w[i+1] * r[i+1]
	}
}

var gamma = 1 + 1/math.Sqrt2

// ros2 advances h by dt into out with Verwer's ROS2 and the exact Jacobian
// at h, and reports whether both stages and the result are valid states.
func (f *Film) ros2(h []float64, dt float64, out []float64) bool {
	ws, w := &f.ws, f.ws.w
	if !f.s.eval(h, ws.k1, &w) {
		return false
	}
	for i := range w.diag {
		w.sub[i] *= -gamma * dt
		w.sup[i] *= -gamma * dt
		w.diag[i] = 1 - gamma*dt*w.diag[i]
	}
	ws.solveCyclic(w, ws.k1)
	for i := range h {
		ws.stage[i] = h[i] + dt*ws.k1[i]
	}
	if !f.s.eval(ws.stage, ws.k2, nil) {
		return false
	}
	for i := range ws.k2 {
		ws.k2[i] -= 2 * ws.k1[i]
	}
	ws.solveCyclic(w, ws.k2)
	for i := range h {
		out[i] = h[i] + dt*(1.5*ws.k1[i]+0.5*ws.k2[i])
		if math.IsNaN(out[i]) || math.IsInf(out[i], 0) {
			return false
		}
	}
	return f.s.eval(out, ws.f, nil)
}

// step is the step rule: from h at t, the next accepted state into out and
// its time, with the attempts it took; at most budget attempts. The solve
// and every seek call it, so they take the same steps.
func (f *Film) step(h []float64, t float64, out []float64, budget int) (next float64, attempts int, ok bool) {
	dt := f.tau / f.s.rate(h)
	for range min(retries+1, budget) {
		next = t + dt
		if next >= f.horizon {
			next, dt = f.horizon, f.horizon-t
		}
		attempts++
		if f.ros2(h, dt, out) {
			return next, attempts, true
		}
		dt /= 2
	}
	return t, attempts, false
}

// run evolves h from t = 0 to the horizon or the first limit.
func (f *Film) run(h []float64) {
	n := f.s.size()
	f.ws = newWorkspace(n)
	f.checkpoints = []checkpoint{{0, 0, append([]float64{}, h...)}}
	st := &f.Stats
	st.Stride = 1
	t, out := 0.0, make([]float64, n)
	for {
		if t >= f.horizon {
			f.Stop = "horizon"
			break
		}
		budget := min(limits.Attempts-st.Attempted, (limits.NodeUpdates-st.NodeUpdates)/n)
		if budget <= 0 {
			f.Stop = "work"
			break
		}
		next, attempts, ok := f.step(h, t, out, budget)
		st.Attempted += attempts
		st.NodeUpdates += attempts * n
		if !ok {
			st.Rejected += attempts
			if attempts < retries+1 {
				f.Stop = "work"
			} else {
				f.Stop = "positivity"
			}
			break
		}
		st.Rejected += attempts - 1
		if why := f.s.guard(out); why != "" {
			st.Discarded = 1
			f.Stop = why
			break
		}
		st.Accepted++
		h, out, t = out, h, next
		if st.Accepted%st.Stride == 0 {
			f.checkpoints = append(f.checkpoints, checkpoint{st.Accepted, t, append([]float64{}, h...)})
			if len(f.checkpoints) > limits.Checkpoints {
				kept := f.checkpoints[:0]
				for _, c := range f.checkpoints {
					if c.step%(2*st.Stride) == 0 {
						kept = append(kept, c)
					}
				}
				f.checkpoints = kept
				st.Stride *= 2
			}
		}
	}
	f.End = t
	st.Checkpoints = len(f.checkpoints)
}

// Sample recomputes the loop at time t in [0, End] from the last checkpoint
// at or before t, taking the solve's own steps and then one partial step.
func (f *Film) Sample(t float64) (Contour, error) {
	if !(t >= 0 && t <= f.End) {
		return Contour{}, fmt.Errorf("time %g is outside the solved interval [0, %g]", t, f.End)
	}
	k := 0
	for k+1 < len(f.checkpoints) && f.checkpoints[k+1].t <= t {
		k++
	}
	c := f.checkpoints[k]
	h := append([]float64{}, c.h...)
	out := make([]float64, len(h))
	now, steps := c.t, 0
	for now < t {
		next, attempts, ok := f.step(h, now, out, retries+1)
		steps += attempts
		if !ok {
			return Contour{}, fmt.Errorf("a recomputed step failed at %g", now)
		}
		if next <= t {
			h, out, now = out, h, next
			continue
		}
		// The partial step to t, halved until it keeps the state valid.
		if !f.partial(h, now, t, out, &steps) {
			return Contour{}, fmt.Errorf("the partial step to %g failed", t)
		}
		h, now = out, t
	}
	return f.s.contour(t, h, steps), nil
}

func (f *Film) partial(h []float64, from, to float64, out []float64, steps *int) bool {
	*steps++
	if f.ros2(h, to-from, out) {
		return true
	}
	if *steps > retries {
		return false
	}
	mid := from + (to-from)/2
	half := make([]float64, len(h))
	return f.partial(h, from, mid, half, steps) && f.partial(half, mid, to, out, steps)
}

// grid is the convex scheme: the support function on N normal angles.
type grid struct {
	n        int
	cos, sin []float64
	// 1/(2(1 − cos Δθ)) and 1/(2 sin Δθ).
	second, first float64
	floor         float64
	cx, cy        float64
	rho, k        []float64
}

func newGrid(n int) *grid {
	g := &grid{n: n}
	g.cos, g.sin = make([]float64, n), make([]float64, n)
	for i := range n {
		g.sin[i], g.cos[i] = math.Sincos(2 * math.Pi * float64(i) / float64(n))
	}
	d := 2 * math.Pi / float64(n)
	g.second = 1 / (2 * (1 - math.Cos(d)))
	g.first = 1 / (2 * math.Sin(d))
	g.rho, g.k = make([]float64, n), make([]float64, n)
	return g
}

func (g *grid) size() int { return g.n }

// radii writes ρ = h + D₂h into out and reports whether every value is
// finite and positive.
func (g *grid) radii(h, out []float64) bool {
	n := g.n
	ok := true
	for i := range n {
		prev, next := h[(i+n-1)%n], h[(i+1)%n]
		out[i] = h[i] + (next-2*h[i]+prev)*g.second
		if !(out[i] > 0) || math.IsInf(out[i], 0) {
			ok = false
		}
	}
	return ok
}

// eval is h_t = −1/ρ, with Jacobian diag(1/ρ²)(I + D₂).
func (g *grid) eval(h, out []float64, jac *tri) bool {
	if !g.radii(h, g.rho) {
		return false
	}
	for i, r := range g.rho {
		out[i] = -1 / r
		if jac != nil {
			k := 1 / (r * r)
			jac.sub[i] = k * g.second
			jac.sup[i] = k * g.second
			jac.diag[i] = k * (1 - 2*g.second)
		}
	}
	return true
}

func (g *grid) guard(h []float64) string {
	rho := g.rho
	if !g.radii(h, rho) {
		return "positivity"
	}
	low := math.Inf(1)
	for i := range g.n {
		j := (i + 1) % g.n
		if math.Abs(rho[j]-rho[i]) > resolution*min(rho[i], rho[j]) {
			return "resolution"
		}
		low = min(low, rho[i])
	}
	if low < g.floor {
		return "curvature"
	}
	return ""
}

// rate is the largest relative rate of change of the radius of curvature,
// max |ρ_t| / ρ with ρ_t = −(κ + κ_θθ): 1/R² for a circle of radius R, and
// faster while a ripple decays, at (m² − 1)κ² for mode m.
func (g *grid) rate(h []float64) float64 {
	n := g.n
	g.radii(h, g.rho)
	k := g.k
	for i, r := range g.rho {
		k[i] = 1 / r
	}
	top := 0.0
	for i := range n {
		dk := k[i] + (k[(i+1)%n]-2*k[i]+k[(i+n-1)%n])*g.second
		top = max(top, math.Abs(dk)*k[i])
	}
	return top
}

func (g *grid) contour(t float64, h []float64, steps int) Contour {
	n := g.n
	c := Contour{T: t, X: make([]float64, n), Y: make([]float64, n), Steps: steps}
	rho := make([]float64, n)
	g.radii(h, rho)
	c.MinRho, c.MaxRho = math.Inf(1), 0
	for i := range n {
		d := (h[(i+1)%n] - h[(i+n-1)%n]) * g.first
		c.X[i] = g.cx + h[i]*g.cos[i] - d*g.sin[i]
		c.Y[i] = g.cy + h[i]*g.sin[i] + d*g.cos[i]
		c.MinRho, c.MaxRho = min(c.MinRho, rho[i]), max(c.MaxRho, rho[i])
	}
	polygonStats(&c, g.cx, g.cy)
	return c
}

func field(path, format string, args ...any) error {
	return &engine.FieldError{Field: path, Message: fmt.Sprintf(format, args...)}
}

func validate(q Request) error {
	s := q.Seed
	finite := func(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
	if !finite(s.Radius) || s.Radius < 1e-3 || s.Radius > 1e3 {
		return field("seed.radius", "Radius must be from 0.001 to 1,000.")
	}
	m := float64(s.Mode)
	switch s.Mode {
	case 0:
		if s.Epsilon != 0 {
			return field("seed.epsilon", "A circle has no ripple; choose 3 or 6 lobes for one.")
		}
	case 3, 6:
		if !finite(s.Epsilon) || math.Abs(s.Epsilon)*(m*m-1) > 0.5*(1+1e-12) {
			return field("seed.epsilon", "Ripple must keep |ε|(m²−1) at most 1/2: |ε| ≤ %.6g.", 0.5/(m*m-1))
		}
	default:
		return field("seed.mode", "Lobes must be 0 (a circle), 3 or 6.")
	}
	for _, c := range []struct {
		path string
		v    float64
	}{{"seed.centerX", s.CenterX}, {"seed.centerY", s.CenterY}} {
		if !finite(c.v) || math.Abs(c.v) > 1e3 {
			return field(c.path, "Center coordinates must be within ±1,000.")
		}
	}
	if q.Nodes < 32 || q.Nodes > limits.Nodes || q.Nodes%2 != 0 {
		return field("nodes", "Nodes must be an even number from 32 to %d.", limits.Nodes)
	}
	if !finite(q.Tau) || q.Tau < limits.MinTau || q.Tau > 0.05 {
		return field("tau", "Step factor must be from 0.001 to 0.05.")
	}
	if !finite(q.Horizon) || q.Horizon <= 0 || q.Horizon > 0.999 {
		return field("horizon", "Horizon must be above 0 and at most 0.999 of the extinction time.")
	}
	return nil
}

// Solve validates q and evolves its seed to the horizon or the first limit.
func Solve(q Request) (*Film, error) {
	if err := validate(q); err != nil {
		return nil, err
	}
	s, n := q.Seed, q.Nodes
	m := float64(s.Mode)
	f := &Film{tau: q.Tau}
	f.Area0 = math.Pi * s.Radius * s.Radius * (1 + s.Epsilon*s.Epsilon*(1-m*m)/2)
	f.Extinction = f.Area0 / (2 * math.Pi)
	f.horizon = q.Horizon * f.Extinction
	g := newGrid(n)
	g.floor = floorFraction * math.Sqrt(f.Area0/math.Pi)
	g.cx, g.cy = s.CenterX, s.CenterY
	f.s = g
	// The support function about the seed's center: translations are first
	// harmonics, so the evolution of h does not depend on them.
	h := make([]float64, n)
	for i := range n {
		h[i] = s.Radius * (1 + s.Epsilon*math.Cos(m*2*math.Pi*float64(i)/float64(n)))
	}
	if why := g.guard(h); why == "resolution" {
		return nil, field("nodes", "%d nodes cannot resolve this ripple's curvature; use more.", n)
	} else if why != "" {
		return nil, fmt.Errorf("the seed fails the %s limit", why)
	}
	f.run(h)
	return f, nil
}

// FrameRequest asks for the loop at some physical times of one evolution:
// a convex seed or a flower, exactly one.
type FrameRequest struct {
	Convex *Request      `json:"convex,omitempty"`
	Bloom  *BloomRequest `json:"bloom,omitempty"`
	Times  []float64     `json:"times"`
}

// Solve solves the request's evolution.
func (q FrameRequest) Solve() (*Film, error) {
	switch {
	case q.Convex != nil && q.Bloom == nil:
		return Solve(*q.Convex)
	case q.Bloom != nil && q.Convex == nil:
		return SolveBloom(*q.Bloom)
	}
	return nil, fmt.Errorf("ask for one evolution, convex or bloom")
}

// Reply is a film's summary and the loop at each requested time. Fresh says
// whether this reply solved the film or reused one retained for the same
// request; the geometry is identical either way.
type Reply struct {
	End        float64   `json:"end"`
	Extinction float64   `json:"extinction"`
	Area0      float64   `json:"area0"`
	Stop       string    `json:"stop"`
	Stats      Stats     `json:"stats"`
	Contours   []Contour `json:"contours"`
	Fresh      bool      `json:"fresh"`
}

// maxTimes bounds one reply: a contour family or one movie frame.
const maxTimes = 64

// Frames samples the film at each time, which must lie in [0, End].
func (f *Film) Frames(times []float64) (Reply, error) {
	return frames(Reply{End: f.End, Extinction: f.Extinction, Area0: f.Area0, Stop: f.Stop, Stats: f.Stats}, times, f.Sample)
}

// polygonStats fills the returned polygon's area, perimeter and centroid,
// summed about (cx, cy) to keep them well conditioned.
func polygonStats(c *Contour, cx, cy float64) {
	n := len(c.X)
	var a, mx, my float64
	c.Length = 0
	for i := range n {
		j := (i + 1) % n
		xi, yi := c.X[i]-cx, c.Y[i]-cy
		xj, yj := c.X[j]-cx, c.Y[j]-cy
		cross := xi*yj - xj*yi
		a += cross
		mx += (xi + xj) * cross
		my += (yi + yj) * cross
		c.Length += math.Hypot(xj-xi, yj-yi)
	}
	c.Area = a / 2
	c.CenterX = cx + mx/(3*a)
	c.CenterY = cy + my/(3*a)
}

// frames fills r with sample at each time.
func frames(r Reply, times []float64, sample func(float64) (Contour, error)) (Reply, error) {
	if len(times) > maxTimes {
		return Reply{}, field("times", "Ask for at most %d times at once.", maxTimes)
	}
	for i, t := range times {
		c, err := sample(t)
		if err != nil {
			return Reply{}, field(fmt.Sprintf("times.%d", i), "Time %g is outside the solved interval [0, %g].", t, r.End)
		}
		r.Contours = append(r.Contours, c)
	}
	return r, nil
}
