package shorten

// A test-only reference for experiment 2 of #322: curve shortening of smooth embedded loops that need
// not be convex, such as flowers, in the tangent-angle and length
// formulation of Hou, Lowengrub and Shelley.
//
// The parameter α ∈ [0, 2π) is proportional to arclength: X_α = σ(cos θ,
// sin θ) with σ = L/2π, and θ = α + γ(α) with γ periodic. The flow
// X_t = κN + W T (N the left normal, inward on a counterclockwise loop)
// keeps the parameter equal-arclength when W_α = κθ_α − mean(κθ_α). That
// tangential velocity is part of the equations: nodes never move
// discretely, and nothing is remeshed. In rescaled time dτ = dt/σ² the
// shape evolves on its own, free of scale:
//
//	γ_τ = γ_αα + w θ_α,  w = ∂_α⁻¹(θ_α² − mean θ_α²) (mean zero),
//	(ln L)_τ = −mean θ_α²,  t_τ = σ²,
//	X₀_τ = σ(θ_α N + w T) at α = 0.
//
// Space: Fourier collocation on N = 2^p nodes, with no smoothing filter.
// Time: ETDRK4 (Cox and Matthews), with coefficients by Kassam and
// Trefethen's contour integrals, so γ_αα is integrated exactly. Steps are
// dτ = c / max θ_α², so dt = c R² on a circle of radius R. The loop is
// rebuilt from θ by a spectral antiderivative of e^{iθ}, after removing
// its mean, the closure defect, which is reported and guarded.

import (
	"fmt"
	"math"
	"math/cmplx"
)

// arcRequest asks the reference for an evolution: N nodes, the step
// factor c, and the horizon as a fraction of the extinction time.
type arcRequest struct {
	Nodes   int
	Step    float64
	Horizon float64
}

const (
	// The curvature spectrum beyond N/4, as a fraction of all of it.
	tailLimit = 1e-6
	// |mean e^{iθ}|, the loop's failure to close before it is removed.
	closureLimit = 1e-8
	// Contour points for the ETDRK4 coefficients.
	contourPoints = 32
)

// arcFilm is a solved reference evolution on [0, End], recomputed from
// retained checkpoints like Film.
type arcFilm struct {
	End        float64
	Extinction float64
	Area0      float64
	// Stop is "horizon", or what ended the film first: "floor" (the
	// equal-area radius reached 1/20 of its start), "resolution",
	// "closure", "embedding", "nonfinite" or "work".
	Stop  string
	Stats Stats

	e           *etd
	horizon     float64
	checkpoints []bloomCheckpoint
}

type bloomCheckpoint struct {
	step int
	u    []complex128
}

// A seedCurve gives a closed curve at parameter φ ∈ [0, 2π): its point,
// speed |X′(φ)| and tangent angle, continuous, with angle − φ periodic.
type seedCurve func(phi float64) (x, y, speed, angle float64)

func bloomCurve(s Bloom) seedCurve {
	k, j := float64(s.Petals), float64(s.Ruffles)
	return func(phi float64) (x, y, speed, angle float64) {
		r := s.Radius * (1 + s.Depth*math.Cos(k*phi) + s.Ruffle*math.Cos(j*phi+s.Phase))
		dr := -s.Radius * (s.Depth*k*math.Sin(k*phi) + s.Ruffle*j*math.Sin(j*phi+s.Phase))
		sn, cs := math.Sincos(phi)
		return s.CenterX + r*cs, s.CenterY + r*sn, math.Hypot(r, dr), phi + math.Atan2(r, dr)
	}
}

// supportCurve is experiment 1's seed, parameterized by normal angle.
func supportCurve(s Seed) seedCurve {
	m := float64(s.Mode)
	return func(th float64) (x, y, speed, angle float64) {
		h := s.Radius * (1 + s.Epsilon*math.Cos(m*th))
		dh := -s.Radius * s.Epsilon * m * math.Sin(m*th)
		rho := h - s.Radius*s.Epsilon*m*m*math.Cos(m*th)
		sn, cs := math.Sincos(th)
		return s.CenterX + h*cs - dh*sn, s.CenterY + h*sn + dh*cs, rho, th + math.Pi/2
	}
}

func supportArea(s Seed) float64 {
	m := float64(s.Mode)
	return math.Pi * s.Radius * s.Radius * (1 + s.Epsilon*s.Epsilon*(1-m*m)/2)
}

func validateRun(q arcRequest) error {
	if q.Nodes < 64 || q.Nodes > limits.Nodes || q.Nodes&(q.Nodes-1) != 0 {
		return field("nodes", "Nodes must be 64, 128, 256 or 512.")
	}
	if math.IsNaN(q.Step) || q.Step < 0.002 || q.Step > 0.2 {
		return field("step", "Step factor must be from 0.002 to 0.2.")
	}
	if math.IsNaN(q.Horizon) || q.Horizon <= 0 || q.Horizon > 0.999 {
		return field("horizon", "Horizon must be above 0 and at most 0.999 of the extinction time.")
	}
	return nil
}

// solveArc evolves any seed curve whose area is area0.
func solveArc(q arcRequest, curve seedCurve, area0 float64) (*arcFilm, error) {
	if err := validateRun(q); err != nil {
		return nil, err
	}
	n := q.Nodes
	f := &arcFilm{Area0: area0, Extinction: area0 / (2 * math.Pi)}
	f.horizon = q.Horizon * f.Extinction
	e := newETD(n, q.Step)
	f.e = e
	u := e.initial(curve)
	floor := floorFraction * math.Sqrt(area0/math.Pi)
	if why := e.guard(u, floor); why == "resolution" {
		return nil, field("nodes", "%d nodes cannot resolve this seed's curvature; use more.", n)
	} else if why != "" {
		return nil, fmt.Errorf("the seed fails the %s limit", why)
	}
	if !embedded(e.contour(u, 0, 0)) {
		return nil, fmt.Errorf("the seed crosses itself")
	}
	f.checkpoints = []bloomCheckpoint{{0, append([]complex128{}, u...)}}
	st := &f.Stats
	st.Stride = 1
	out := make([]complex128, len(u))
	for {
		t := real(u[n+1])
		if t >= f.horizon {
			f.Stop = "horizon"
			break
		}
		budget := min(limits.Attempts-st.Attempted, (limits.NodeUpdates-st.NodeUpdates)/n)
		if budget <= 0 {
			f.Stop = "work"
			break
		}
		attempts, trials, ok := e.next(u, out, budget, f.horizon)
		st.Attempted += attempts
		st.Trials += trials
		st.NodeUpdates += (attempts + trials) * n
		if !ok {
			st.Rejected += attempts
			f.Stop = "nonfinite"
			if attempts < retries+1 {
				f.Stop = "work"
			}
			break
		}
		st.Rejected += attempts - 1
		if why := e.guard(out, floor); why != "" {
			st.Discarded = 1
			f.Stop = why
			break
		}
		st.Accepted++
		u, out = out, u
		if st.Accepted%st.Stride == 0 {
			if !embedded(e.contour(u, real(u[n+1]), 0)) {
				f.Stop = "embedding"
				u = f.checkpoints[len(f.checkpoints)-1].u
				break
			}
			f.checkpoints = append(f.checkpoints, bloomCheckpoint{st.Accepted, append([]complex128{}, u...)})
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
	if f.Stop != "embedding" && !embedded(e.contour(u, real(u[n+1]), 0)) {
		// The last stretch after the last checkpoint is given up.
		f.Stop = "embedding"
		u = f.checkpoints[len(f.checkpoints)-1].u
	}
	f.End = real(u[n+1])
	st.Checkpoints = len(f.checkpoints)
	return f, nil
}

// Sample recomputes the loop at time t in [0, End] from the last checkpoint
// at or before it: the solve's own steps, then one partial step whose
// length is solved so that it ends at t. Steps counts the steps retaken;
// the partial step's root solve is in Trials.
func (f *arcFilm) Sample(t float64) (Contour, error) {
	if !(t >= 0 && t <= f.End) {
		return Contour{}, fmt.Errorf("time %g is outside the solved interval [0, %g]", t, f.End)
	}
	e := f.e
	n := e.n
	k := 0
	for k+1 < len(f.checkpoints) && real(f.checkpoints[k+1].u[n+1]) <= t {
		k++
	}
	u := append([]complex128{}, f.checkpoints[k].u...)
	out := make([]complex128, len(u))
	steps, trials := 0, 0
	for real(u[n+1]) < t {
		attempts, tr, ok := e.next(u, out, retries+1, t)
		steps += attempts
		trials += tr
		if !ok {
			return Contour{}, fmt.Errorf("a recomputed step failed at %g", real(u[n+1]))
		}
		u, out = out, u
	}
	c := e.contour(u, t, steps)
	c.Trials = trials
	return c, nil
}

// Frames samples the film at each time, which must lie in [0, End].
func (f *arcFilm) Frames(times []float64) (Reply, error) {
	return frames(Reply{End: f.End, Extinction: f.Extinction, Area0: f.Area0, Stop: f.Stop, Stats: f.Stats}, times, f.Sample)
}

// etd is the discretization and its scratch: N Fourier modes of γ, then
// ln L, t, and the base point's x and y.
type etd struct {
	n    int
	c    float64
	wave []float64
	lin  []float64
	// Coefficients for the step h they were computed for.
	h                       float64
	ex, ex2, q, f1, f2, f3  []float64
	nv, na, nb, nc, a, b, s []complex128
	w1, w2, w3              []complex128
}

func newETD(n int, c float64) *etd {
	e := &etd{n: n, c: c, h: math.NaN()}
	m := n + 4
	e.wave = make([]float64, n)
	e.lin = make([]float64, m)
	for k := range n {
		e.wave[k] = wavenumber(k, n)
		w := float64(k)
		if k > n/2 {
			w = float64(k - n)
		}
		e.lin[k] = -w * w
	}
	for _, p := range []*[]float64{&e.ex, &e.ex2, &e.q, &e.f1, &e.f2, &e.f3} {
		*p = make([]float64, m)
	}
	for _, p := range []*[]complex128{&e.nv, &e.na, &e.nb, &e.nc, &e.a, &e.b, &e.s} {
		*p = make([]complex128, m)
	}
	for _, p := range []*[]complex128{&e.w1, &e.w2, &e.w3} {
		*p = make([]complex128, n)
	}
	return e
}

// coefficients computes ETDRK4's coefficients for step h by contour
// integrals, which stay accurate where hλ is small.
func (e *etd) coefficients(h float64) {
	if h == e.h {
		return
	}
	e.h = h
	cache := map[float64][6]float64{}
	for i, l := range e.lin {
		if v, ok := cache[l]; ok {
			e.ex[i], e.ex2[i], e.q[i], e.f1[i], e.f2[i], e.f3[i] = v[0], v[1], v[2], v[3], v[4], v[5]
			continue
		}
		z0 := h * l
		var q, a1, a2, a3 complex128
		for j := range contourPoints {
			z := complex(z0, 0) + cmplx.Rect(1, math.Pi*(float64(j)+0.5)/contourPoints)
			ez, ez2 := cmplx.Exp(z), cmplx.Exp(z/2)
			z3 := z * z * z
			q += (ez2 - 1) / z
			a1 += (-4 - z + ez*(4-3*z+z*z)) / z3
			a2 += (2 + z + ez*(z-2)) / z3
			a3 += (-4 - 3*z - z*z + ez*(4-z)) / z3
		}
		v := [6]float64{math.Exp(z0), math.Exp(z0 / 2), h * real(q) / contourPoints,
			h * real(a1) / contourPoints, h * real(a2) / contourPoints, h * real(a3) / contourPoints}
		cache[l] = v
		e.ex[i], e.ex2[i], e.q[i], e.f1[i], e.f2[i], e.f3[i] = v[0], v[1], v[2], v[3], v[4], v[5]
	}
}

// slopes returns θ_α at the nodes, into e.w1 (real parts), and max θ_α².
func (e *etd) slopes(u []complex128) float64 {
	n := e.n
	for k := range n {
		e.w1[k] = u[k] * complex(0, e.wave[k])
	}
	fft(e.w1, true)
	top := 0.0
	for j := range n {
		v := 1 + real(e.w1[j])
		e.w1[j] = complex(v, 0)
		top = max(top, v*v)
	}
	return top
}

// nonlinear writes the explicit part of u_τ into out.
func (e *etd) nonlinear(u, out []complex128) {
	n := e.n
	e.slopes(u)
	ta := e.w1
	mean := 0.0
	for j := range n {
		mean += real(ta[j]) * real(ta[j])
	}
	mean /= float64(n)
	for j := range n {
		e.w2[j] = complex(real(ta[j])*real(ta[j])-mean, 0)
	}
	fft(e.w2, false)
	for k := range n {
		if e.wave[k] == 0 {
			e.w2[k] = 0
		} else {
			e.w2[k] /= complex(0, e.wave[k])
		}
	}
	fft(e.w2, true)
	for j := range n {
		e.w3[j] = complex(real(e.w2[j])*real(ta[j]), 0)
	}
	fft(e.w3, false)
	copy(out[:n], e.w3)
	g0 := 0.0
	for k := range n {
		g0 += real(u[k])
	}
	g0 /= float64(n)
	sigma := math.Exp(real(u[n])) / (2 * math.Pi)
	sn, cs := math.Sincos(g0)
	w0, t0 := real(e.w2[0]), real(ta[0])
	out[n] = complex(-mean, 0)
	out[n+1] = complex(sigma*sigma, 0)
	out[n+2] = complex(sigma*(-t0*sn+w0*cs), 0)
	out[n+3] = complex(sigma*(t0*cs+w0*sn), 0)
}

// step advances u by h into out with ETDRK4 and reports whether the
// result is finite.
func (e *etd) step(u []complex128, h float64, out []complex128) bool {
	e.coefficients(h)
	e.nonlinear(u, e.nv)
	for i := range u {
		e.a[i] = complex(e.ex2[i], 0)*u[i] + complex(e.q[i], 0)*e.nv[i]
	}
	e.nonlinear(e.a, e.na)
	for i := range u {
		e.b[i] = complex(e.ex2[i], 0)*u[i] + complex(e.q[i], 0)*e.na[i]
	}
	e.nonlinear(e.b, e.nb)
	for i := range u {
		e.s[i] = complex(e.ex2[i], 0)*e.a[i] + complex(e.q[i], 0)*(2*e.nb[i]-e.nv[i])
	}
	e.nonlinear(e.s, e.nc)
	for i := range u {
		out[i] = complex(e.ex[i], 0)*u[i] + complex(e.f1[i], 0)*e.nv[i] +
			complex(2*e.f2[i], 0)*(e.na[i]+e.nb[i]) + complex(e.f3[i], 0)*e.nc[i]
		if cmplx.IsNaN(out[i]) || cmplx.IsInf(out[i]) {
			return false
		}
	}
	return true
}

// next is the step rule: from u, the next state into out, ending no later
// than limit in physical time. A step that would pass limit is replaced by
// a partial step solved to end there, whose trial steps are counted apart.
// At most budget attempts are made.
func (e *etd) next(u, out []complex128, budget int, limit float64) (attempts, trials int, ok bool) {
	n := e.n
	h := e.c / e.slopes(u)
	for range min(retries+1, budget) {
		attempts++
		if !e.step(u, h, out) {
			h /= 2
			continue
		}
		if real(out[n+1]) <= limit {
			return attempts, trials, true
		}
		tr, ok := e.land(u, h, limit, out)
		return attempts, trials + tr, ok
	}
	return attempts, trials, false
}

// land solves for the step length in (0, hi) whose step from u ends at
// physical time target, by the Illinois method on the bracket, and leaves
// that step, with its time set to target, in out.
func (e *etd) land(u []complex128, hi, target float64, out []complex128) (int, bool) {
	n := e.n
	lo, flo := 0.0, real(u[n+1])-target
	fhi := real(out[n+1]) - target
	side := 0
	trials := 0
	for range 64 {
		h := (lo*fhi - hi*flo) / (fhi - flo)
		if !(h > lo && h < hi) {
			h = (lo + hi) / 2
		}
		trials++
		if !e.step(u, h, out) {
			return trials, false
		}
		fh := real(out[n+1]) - target
		if math.Abs(fh) <= 4*math.Abs(target)*0x1p-52 || hi-lo <= 4*hi*0x1p-52 {
			break
		}
		if fh < 0 {
			lo, flo = h, fh
			if side == -1 {
				fhi /= 2
			}
			side = -1
		} else {
			hi, fhi = h, fh
			if side == 1 {
				flo /= 2
			}
			side = 1
		}
	}
	out[n+1] = complex(target, 0)
	return trials, true
}

// initial builds the equal-arclength state of a seed curve: Newton on its
// spectrally integrated arclength places the nodes.
func (e *etd) initial(curve seedCurve) []complex128 {
	n := e.n
	m := 4 * n
	sp := make([]complex128, m)
	mean := 0.0
	for i := range m {
		_, _, v, _ := curve(2 * math.Pi * float64(i) / float64(m))
		sp[i] = complex(v, 0)
		mean += v / float64(m)
	}
	length := 2 * math.Pi * mean
	for i := range sp {
		sp[i] -= complex(mean, 0)
	}
	fft(sp, false)
	for k := range sp {
		if w := wavenumber(k, m); w == 0 {
			sp[k] = 0
		} else {
			sp[k] /= complex(0, w*float64(m))
		}
	}
	periodic := func(phi float64) float64 {
		v := 0.0
		for k, a := range sp {
			v += real(a * cmplx.Rect(1, wavenumber(k, m)*phi))
		}
		return v
	}
	p0 := periodic(0)
	u := make([]complex128, n+4)
	phi := 0.0
	for j := range n {
		target := length * float64(j) / float64(n)
		if j > 0 {
			phi += 2 * math.Pi / float64(n)
		}
		for range 40 {
			_, _, v, _ := curve(phi)
			d := (length*phi/(2*math.Pi) + periodic(phi) - p0 - target) / v
			phi -= d
			if math.Abs(d) < 1e-15 {
				break
			}
		}
		_, _, _, angle := curve(phi)
		u[j] = complex(angle-2*math.Pi*float64(j)/float64(n), 0)
	}
	fft(u[:n], false)
	x0, y0, _, _ := curve(0)
	u[n] = complex(math.Log(length), 0)
	u[n+2], u[n+3] = complex(x0, 0), complex(y0, 0)
	return u
}

// guard names the first state limit u fails, or "".
func (e *etd) guard(u []complex128, floor float64) string {
	n := e.n
	for _, v := range u {
		if cmplx.IsNaN(v) || cmplx.IsInf(v) {
			return "nonfinite"
		}
	}
	total, tail := 0.0, 0.0
	for k := range n {
		v := cmplx.Abs(u[k]) * math.Abs(e.wave[k])
		total += v
		if math.Abs(e.wave[k]) > float64(n)/4 {
			tail += v
		}
	}
	if total > 1e-12*float64(n) && tail > tailLimit*total {
		return "resolution"
	}
	c := e.contour(u, real(u[n+1]), 0)
	if c.Closure > closureLimit {
		return "closure"
	}
	if math.Sqrt(e.area(u, c)/math.Pi) < floor {
		return "floor"
	}
	return ""
}

// area is ½∮(x dy − y dx) with the exact tangent X_α = σe^{iθ}.
func (e *etd) area(u []complex128, c Contour) float64 {
	n := e.n
	sigma := math.Exp(real(u[n])) / (2 * math.Pi)
	a := 0.0
	for j := range n {
		sn, cs := math.Sincos(e.theta(j))
		a += (c.X[j]-c.X[0])*sn - (c.Y[j]-c.Y[0])*cs
	}
	return a * sigma * math.Pi / float64(n)
}

// theta is θ at node j, valid after contour has filled e.w3 with γ.
func (e *etd) theta(j int) float64 {
	return 2*math.Pi*float64(j)/float64(e.n) + real(e.w3[j])
}

// contour rebuilds the loop: X = X₀ + σ ∫₀^α e^{iθ}, the mean of e^{iθ}
// removed and reported as Closure.
func (e *etd) contour(u []complex128, t float64, steps int) Contour {
	n := e.n
	copy(e.w3, u[:n])
	fft(e.w3, true)
	z := e.w2
	for j := range n {
		z[j] = cmplx.Rect(1, e.theta(j))
	}
	fft(z, false)
	closure := cmplx.Abs(z[0]) / float64(n)
	for k := range n {
		if e.wave[k] == 0 {
			z[k] = 0
		} else {
			z[k] /= complex(0, e.wave[k])
		}
	}
	fft(z, true)
	sigma := math.Exp(real(u[n])) / (2 * math.Pi)
	x0, y0 := real(u[n+2]), real(u[n+3])
	c := Contour{T: t, X: make([]float64, n), Y: make([]float64, n), Steps: steps, Closure: closure}
	for j := range n {
		c.X[j] = x0 + sigma*real(z[j]-z[0])
		c.Y[j] = y0 + sigma*imag(z[j]-z[0])
	}
	e.slopes(u)
	c.MinKappa, c.MaxKappa = math.Inf(1), math.Inf(-1)
	for j := range n {
		k := real(e.w1[j]) / sigma
		c.MinKappa, c.MaxKappa = min(c.MinKappa, k), max(c.MaxKappa, k)
	}
	polygonStats(&c, x0, y0)
	return c
}

// embedded reports whether no two nonadjacent edges of c cross, testing
// only edges that share a grid cell as large as the longest edge.
func embedded(c Contour) bool {
	n := len(c.X)
	cell := 0.0
	for i := range n {
		j := (i + 1) % n
		cell = max(cell, math.Hypot(c.X[j]-c.X[i], c.Y[j]-c.Y[i]))
	}
	if !(cell > 0) {
		return false
	}
	buckets := map[[2]int][]int{}
	for i := range n {
		j := (i + 1) % n
		x0, x1 := math.Floor(min(c.X[i], c.X[j])/cell), math.Floor(max(c.X[i], c.X[j])/cell)
		y0, y1 := math.Floor(min(c.Y[i], c.Y[j])/cell), math.Floor(max(c.Y[i], c.Y[j])/cell)
		for x := x0; x <= x1; x++ {
			for y := y0; y <= y1; y++ {
				key := [2]int{int(x), int(y)}
				buckets[key] = append(buckets[key], i)
			}
		}
	}
	orient := func(a, b, p int) float64 {
		return (c.X[b]-c.X[a])*(c.Y[p]-c.Y[a]) - (c.Y[b]-c.Y[a])*(c.X[p]-c.X[a])
	}
	for _, edges := range buckets {
		for p, i := range edges {
			for _, j := range edges[p+1:] {
				if d := (j - i + n) % n; d <= 1 || d == n-1 {
					continue
				}
				i2, j2 := (i+1)%n, (j+1)%n
				if orient(i, i2, j)*orient(i, i2, j2) < 0 && orient(j, j2, i)*orient(j, j2, i2) < 0 {
					return false
				}
			}
		}
	}
	return true
}

func fft(a []complex128, inverse bool) {
	n := len(a)
	for i, j := 1, 0; i < n; i++ {
		bit := n >> 1
		for ; j&bit != 0; bit >>= 1 {
			j ^= bit
		}
		j ^= bit
		if i < j {
			a[i], a[j] = a[j], a[i]
		}
	}
	sign := -1.0
	if inverse {
		sign = 1
	}
	for size := 2; size <= n; size <<= 1 {
		w := cmplx.Rect(1, sign*2*math.Pi/float64(size))
		for start := 0; start < n; start += size {
			z := complex(1, 0)
			for k := range size / 2 {
				u, v := a[start+k], a[start+k+size/2]*z
				a[start+k], a[start+k+size/2] = u+v, u-v
				z *= w
			}
		}
	}
	if inverse {
		for i := range a {
			a[i] /= complex(float64(n), 0)
		}
	}
}

// wavenumber is mode k's wavenumber on n points, 0 for the Nyquist mode,
// whose derivative is not represented.
func wavenumber(k, n int) float64 {
	if 2*k == n {
		return 0
	}
	if k > n/2 {
		return float64(k - n)
	}
	return float64(k)
}
