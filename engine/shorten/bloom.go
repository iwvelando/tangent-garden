package shorten

// Experiment 2 of #322: curve shortening of star-shaped flowers, which need
// not be convex, as a radial graph about the seed's center.
//
// The loop is X(φ) = c + r(φ)(cos φ, sin φ) on N equally spaced polar
// angles. Moving each point along its ray, the inward flow dX/dt = −κ n_out
// is r_t = −κ √(r² + r_φ²)/r. In ℓ = ln r, with p = ℓ_φ and q = ℓ_φφ,
//
//	ℓ_t = e^{−2ℓ} (q − 1 − p²) / (1 + p²),  κ = (1 + p² − q) / (r (1 + p²)^{3/2}).
//
// Points slide along their rays rather than along the normal; that
// tangential motion is the parameterization itself, so nothing is remeshed.
// The formulation holds while the loop stays star-shaped about c, which the
// flow need not preserve: the film stops when a tangent comes within
// atan(1/10) of its ray (|p| > 10).
//
// Space: central differences for p and q (second order, exact on circles
// about c). Time: ROS2 with the exact cyclic tridiagonal Jacobian, as in
// experiment 1, and steps dt = τ / max |ℓ_t|, so dt = τR² on a circle.

import "math"

// Bloom is a supported seed, the polar loop
// r(φ) = R(1 + a cos kφ + b cos(jφ + ψ)) about (CenterX, CenterY): k petals
// of depth a and j ruffles of depth b. With |a| + |b| ≤ 0.9 it is
// star-shaped, so embedded; its area is πR²(1 + a²/2 + b²/2).
type Bloom struct {
	Radius  float64 `json:"radius"`
	Petals  int     `json:"petals"`
	Depth   float64 `json:"depth"`
	Ruffles int     `json:"ruffles"`
	Ruffle  float64 `json:"ruffle"`
	Phase   float64 `json:"phase"`
	CenterX float64 `json:"centerX"`
	CenterY float64 `json:"centerY"`
}

// BloomRequest is one evolution: the seed, N polar nodes, the
// dimensionless step factor τ, and the horizon as a fraction of the
// extinction time A₀/2π.
type BloomRequest struct {
	Seed    Bloom   `json:"seed"`
	Nodes   int     `json:"nodes"`
	Tau     float64 `json:"tau"`
	Horizon float64 `json:"horizon"`
}

const (
	// The largest turn between consecutive edges an accepted loop may have.
	turnLimit = 0.25
	// The largest |ℓ_φ|: tangents stay at least atan(1/10) off their rays.
	starLimit = 10
	// Nodes per wavelength of the seed's finest harmonic.
	nodesPerWave = 8
)

func validateBloom(q BloomRequest) error {
	s := q.Seed
	finite := func(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
	if !finite(s.Radius) || s.Radius < 1e-3 || s.Radius > 1e3 {
		return field("seed.radius", "Radius must be from 0.001 to 1,000.")
	}
	if s.Petals != 0 && (s.Petals < 2 || s.Petals > 12) {
		return field("seed.petals", "Petals must be 0 (none) or 2 to 12.")
	}
	if !finite(s.Depth) || (s.Petals == 0 && s.Depth != 0) {
		return field("seed.depth", "Petal depth must be finite, and 0 without petals.")
	}
	if s.Ruffles != 0 && (s.Ruffles < 8 || s.Ruffles > 64 || s.Ruffles == s.Petals) {
		return field("seed.ruffles", "Ruffles must be 0 (none) or 8 to 64, other than the petal count.")
	}
	if !finite(s.Ruffle) || (s.Ruffles == 0 && s.Ruffle != 0) {
		return field("seed.ruffle", "Ruffle depth must be finite, and 0 without ruffles.")
	}
	if math.Abs(s.Depth)+math.Abs(s.Ruffle) > 0.9 {
		return field("seed.depth", "Petal and ruffle depths together must be at most 0.9.")
	}
	if !finite(s.Phase) {
		return field("seed.phase", "Phase must be finite.")
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
	if finest := max(s.Petals, s.Ruffles); q.Nodes < nodesPerWave*finest {
		return field("nodes", "%d harmonics need at least %d nodes.", finest, nodesPerWave*finest)
	}
	if !finite(q.Tau) || q.Tau < limits.MinTau || q.Tau > 0.05 {
		return field("tau", "Step factor must be from 0.001 to 0.05.")
	}
	if !finite(q.Horizon) || q.Horizon <= 0 || q.Horizon > 0.999 {
		return field("horizon", "Horizon must be above 0 and at most 0.999 of the extinction time.")
	}
	return nil
}

// SolveBloom validates q and evolves its flower to the horizon or the
// first limit.
func SolveBloom(q BloomRequest) (*Film, error) {
	if err := validateBloom(q); err != nil {
		return nil, err
	}
	s, n := q.Seed, q.Nodes
	f := &Film{tau: q.Tau}
	f.Area0 = math.Pi * s.Radius * s.Radius * (1 + s.Depth*s.Depth/2 + s.Ruffle*s.Ruffle/2)
	f.Extinction = f.Area0 / (2 * math.Pi)
	f.horizon = q.Horizon * f.Extinction
	p := newPolar(n, s.CenterX, s.CenterY)
	p.floor = floorFraction * math.Sqrt(f.Area0/math.Pi)
	f.s = p
	k, j := float64(s.Petals), float64(s.Ruffles)
	l := make([]float64, n)
	for i := range n {
		phi := 2 * math.Pi * float64(i) / float64(n)
		l[i] = math.Log(s.Radius * (1 + s.Depth*math.Cos(k*phi) + s.Ruffle*math.Cos(j*phi+s.Phase)))
	}
	switch p.guard(l) {
	case "":
	case "resolution":
		return nil, field("nodes", "%d nodes cannot resolve this seed's curvature; use more.", n)
	case "star":
		return nil, field("seed.depth", "This seed's tangents come too close to its rays.")
	default:
		return nil, field("seed.depth", "This seed is not supported.")
	}
	f.run(l)
	return f, nil
}

// polar is the radial-graph scheme on N polar angles about (cx, cy).
type polar struct {
	n        int
	d        float64
	cos, sin []float64
	cx, cy   float64
	floor    float64
	f        []float64
}

func newPolar(n int, cx, cy float64) *polar {
	p := &polar{n: n, d: 2 * math.Pi / float64(n), cx: cx, cy: cy}
	p.cos, p.sin, p.f = make([]float64, n), make([]float64, n), make([]float64, n)
	for i := range n {
		p.sin[i], p.cos[i] = math.Sincos(p.d * float64(i))
	}
	return p
}

func (p *polar) size() int { return p.n }

// derivatives are ℓ_φ and ℓ_φφ at node i.
func (p *polar) derivatives(l []float64, i int) (dp, dq float64) {
	n := p.n
	prev, next := l[(i+n-1)%n], l[(i+1)%n]
	return (next - prev) / (2 * p.d), (next - 2*l[i] + prev) / (p.d * p.d)
}

func (p *polar) eval(l, out []float64, jac *tri) bool {
	d := p.d
	for i := range p.n {
		dp, dq := p.derivatives(l, i)
		e := math.Exp(-2 * l[i])
		g := 1 + dp*dp
		out[i] = e * (dq - 1 - dp*dp) / g
		if math.IsNaN(out[i]) || math.IsInf(out[i], 0) {
			return false
		}
		if jac != nil {
			cross := dp * dq / (d * g * g)
			jac.sub[i] = e * (1/(d*d*g) + cross)
			jac.sup[i] = e * (1/(d*d*g) - cross)
			jac.diag[i] = -2*out[i] - 2*e/(d*d*g)
		}
	}
	return true
}

// rate is max |ℓ_t|, the fastest relative change of a radius.
func (p *polar) rate(l []float64) float64 {
	p.eval(l, p.f, nil)
	top := 0.0
	for _, v := range p.f {
		top = max(top, math.Abs(v))
	}
	return top
}

func (p *polar) guard(l []float64) string {
	n := p.n
	area := 0.0
	for i := range n {
		if math.IsNaN(l[i]) || math.IsInf(l[i], 0) {
			return "positivity"
		}
		if dp, _ := p.derivatives(l, i); math.Abs(dp) > starLimit {
			return "star"
		}
		area += math.Exp(2*l[i]) * p.d / 2
	}
	// The turn at each vertex, between its incoming and outgoing edges.
	for i := range n {
		a, b, c := (i+n-1)%n, i, (i+1)%n
		ra, rb, rc := math.Exp(l[a]), math.Exp(l[b]), math.Exp(l[c])
		ux, uy := rb*p.cos[b]-ra*p.cos[a], rb*p.sin[b]-ra*p.sin[a]
		vx, vy := rc*p.cos[c]-rb*p.cos[b], rc*p.sin[c]-rb*p.sin[b]
		if math.Abs(math.Atan2(ux*vy-uy*vx, ux*vx+uy*vy)) > turnLimit {
			return "resolution"
		}
	}
	if math.Sqrt(area/math.Pi) < p.floor {
		return "floor"
	}
	return ""
}

func (p *polar) contour(t float64, l []float64, steps int) Contour {
	n := p.n
	c := Contour{T: t, X: make([]float64, n), Y: make([]float64, n), Steps: steps}
	c.MinKappa, c.MaxKappa = math.Inf(1), math.Inf(-1)
	for i := range n {
		r := math.Exp(l[i])
		c.X[i] = p.cx + r*p.cos[i]
		c.Y[i] = p.cy + r*p.sin[i]
		dp, dq := p.derivatives(l, i)
		g := 1 + dp*dp
		k := (g - dq) / (r * g * math.Sqrt(g))
		c.MinKappa, c.MaxKappa = min(c.MinKappa, k), max(c.MaxKappa, k)
	}
	polygonStats(&c, p.cx, p.cy)
	return c
}
