package shorten

import (
	"fmt"
	"math"
	"math/cmplx"
	"strings"
	"sync"
	"testing"
)

// An independent reference: the same flow, dX/dt = -κ n_out, written for a
// parametric curve X(u) rather than a support function. Positions move
// along their normals only (no reparameterization), derivatives in u are
// spectral, and time is classical RK4 with steps far inside its stability
// limit. It assumes neither convexity nor the normal-angle grid, so
// agreement with it is evidence about the support-function solver rather
// than a restatement of it. Its only regularization is the Hou–Li filter
// exp(−36 (|k|/k_max)³⁶) after each step, which suppresses aliasing in the
// highest modes and leaves resolved modes unchanged to rounding; its
// convergence is checked by TestReferenceIsFarFinerThanTheMeasuredErrors.
type reference struct {
	m     int
	times []float64
	// Fourier coefficients of x(u) and y(u) at each time.
	cx, cy [][]complex128
}

// derivatives returns the first and second u-derivatives of samples v.
func derivatives(v []float64) (d1, d2 []float64) {
	n := len(v)
	c := make([]complex128, n)
	for i, x := range v {
		c[i] = complex(x, 0)
	}
	fft(c, false)
	a, b := make([]complex128, n), make([]complex128, n)
	for k := range c {
		w := wavenumber(k, n)
		a[k] = c[k] * complex(0, w)
		b[k] = c[k] * complex(-w*w, 0)
	}
	fft(a, true)
	fft(b, true)
	d1, d2 = make([]float64, n), make([]float64, n)
	for i := range n {
		d1[i], d2[i] = real(a[i]), real(b[i])
	}
	return d1, d2
}

func referenceVelocity(x, y []float64) (vx, vy []float64, minSpeed float64) {
	xu, xuu := derivatives(x)
	yu, yuu := derivatives(y)
	n := len(x)
	vx, vy = make([]float64, n), make([]float64, n)
	minSpeed = math.Inf(1)
	for i := range n {
		s := math.Hypot(xu[i], yu[i])
		minSpeed = min(minSpeed, s)
		k := (xu[i]*yuu[i] - yu[i]*xuu[i]) / (s * s * s)
		// The outward normal of a counterclockwise curve is (y_u, -x_u)/s.
		vx[i], vy[i] = -k*yu[i]/s, k*xu[i]/s
	}
	return vx, vy, minSpeed
}

func houLi(v []float64) {
	n := len(v)
	c := make([]complex128, n)
	for i, x := range v {
		c[i] = complex(x, 0)
	}
	fft(c, false)
	for k := range c {
		r := math.Abs(wavenumber(k, n)) / float64(n/2)
		if 2*k == n {
			r = 1
		}
		c[k] *= complex(math.Exp(-36*math.Pow(r, 36)), 0)
	}
	fft(c, true)
	for i := range v {
		v[i] = real(c[i])
	}
}

func solveReference(seed Seed, m int, times []float64) *reference {
	x, y := make([]float64, m), make([]float64, m)
	mm := float64(seed.Mode)
	for i := range m {
		u := 2 * math.Pi * float64(i) / float64(m)
		s, c := math.Sincos(u)
		h := seed.Radius * (1 + seed.Epsilon*math.Cos(mm*u))
		hu := -seed.Radius * seed.Epsilon * mm * math.Sin(mm*u)
		x[i] = seed.CenterX + h*c - hu*s
		y[i] = seed.CenterY + h*s + hu*c
	}
	r := &reference{m: m, times: times}
	now := 0.0
	add := func(a []float64, h float64, b []float64) []float64 {
		out := make([]float64, len(a))
		for i := range a {
			out[i] = a[i] + h*b[i]
		}
		return out
	}
	for _, target := range times {
		for now < target {
			k1x, k1y, s := referenceVelocity(x, y)
			// Spectral second derivatives scale like (m/2)²/s²; RK4 is
			// stable to about 2.78 on the negative real axis.
			h := min(2*s*s/float64(m*m/4), target-now)
			if target-now-h < 1e-3*h {
				h = target - now
			}
			k2x, k2y, _ := referenceVelocity(add(x, h/2, k1x), add(y, h/2, k1y))
			k3x, k3y, _ := referenceVelocity(add(x, h/2, k2x), add(y, h/2, k2y))
			k4x, k4y, _ := referenceVelocity(add(x, h, k3x), add(y, h, k3y))
			for i := range m {
				x[i] += h / 6 * (k1x[i] + 2*k2x[i] + 2*k3x[i] + k4x[i])
				y[i] += h / 6 * (k1y[i] + 2*k2y[i] + 2*k3y[i] + k4y[i])
			}
			houLi(x)
			houLi(y)
			now += h
		}
		cx, cy := make([]complex128, m), make([]complex128, m)
		for i := range m {
			cx[i], cy[i] = complex(x[i], 0), complex(y[i], 0)
		}
		fft(cx, false)
		fft(cy, false)
		r.cx, r.cy = append(r.cx, cx), append(r.cy, cy)
	}
	return r
}

// at evaluates the reference's trigonometric interpolant at time index k
// and parameter u, with its first two u-derivatives.
func (r *reference) at(k int, u float64) (p, d1, d2 [2]float64) {
	for c, coef := range [][]complex128{r.cx[k], r.cy[k]} {
		for j, a := range coef {
			w := wavenumber(j, r.m)
			if 2*j == r.m {
				continue
			}
			e := a * cmplx.Rect(1/float64(r.m), w*u)
			p[c] += real(e)
			d1[c] += real(e * complex(0, w))
			d2[c] += real(e * complex(-w*w, 0))
		}
	}
	return
}

// distance is the distance from q to the reference curve at time index k,
// by Newton's method from the nearest of a coarse set of parameters.
func (r *reference) distance(k int, q [2]float64) float64 {
	best, bestU := math.Inf(1), 0.0
	for i := range 4 * r.m {
		u := 2 * math.Pi * float64(i) / float64(4*r.m)
		p, _, _ := r.at(k, u)
		if d := math.Hypot(p[0]-q[0], p[1]-q[1]); d < best {
			best, bestU = d, u
		}
	}
	u := bestU
	for range 30 {
		p, d1, d2 := r.at(k, u)
		g := (p[0]-q[0])*d1[0] + (p[1]-q[1])*d1[1]
		dg := d1[0]*d1[0] + d1[1]*d1[1] + (p[0]-q[0])*d2[0] + (p[1]-q[1])*d2[1]
		step := g / dg
		u -= step
		if math.Abs(step) < 1e-15 {
			break
		}
	}
	p, _, _ := r.at(k, u)
	return math.Hypot(p[0]-q[0], p[1]-q[1])
}

// vertexError is the largest distance from a returned vertex to the
// reference curve: the shape error at the vertices, without the chords'
// own departure from the curve.
func (r *reference) vertexError(k int, c Contour) float64 {
	return curveDistance(r.contour(k), c)
}

// contour is the reference curve's samples at time index k.
func (r *reference) contour(k int) Contour {
	x, y := append([]complex128{}, r.cx[k]...), append([]complex128{}, r.cy[k]...)
	fft(x, true)
	fft(y, true)
	c := Contour{X: make([]float64, r.m), Y: make([]float64, r.m)}
	for i := range r.m {
		c.X[i], c.Y[i] = real(x[i]), real(y[i])
	}
	return c
}

// The fixed physical times of the matrix, as fractions of extinction, well
// before collapse.
var matrixFractions = []float64{0.25, 0.5, 0.75}

var references sync.Map

func referenceFor(t *testing.T, seed Seed, m int) *reference {
	t.Helper()
	key := fmt.Sprint(seed, m)
	if r, ok := references.Load(key); ok {
		return r.(*reference)
	}
	f := solve(t, Request{Seed: seed, Nodes: 128, Tau: 0.05, Horizon: 0.5})
	times := make([]float64, len(matrixFractions))
	for i, frac := range matrixFractions {
		times[i] = frac * f.Extinction
	}
	r := solveReference(seed, m, times)
	references.Store(key, r)
	return r
}

func TestReferenceIsFarFinerThanTheMeasuredErrors(t *testing.T) {
	if testing.Short() {
		t.Skip("reference solves")
	}
	for _, seed := range []Seed{triangle, hexagon} {
		a, b := referenceFor(t, seed, 128), referenceFor(t, seed, 256)
		for k := range matrixFractions {
			e := 0.0
			for i := range 64 {
				p, _, _ := b.at(k, 2*math.Pi*float64(i)/64)
				e = max(e, a.distance(k, p))
			}
			t.Logf("%+v t=%.2fT: reference 128 vs 256 points differ by %.2e", seed, matrixFractions[k], e)
			// The smallest error the matrix measures is about 1e-6.
			if e > 1e-8 {
				t.Errorf("the reference is not converged: %.2e", e)
			}
		}
	}
}

// table formats a refinement table: errors by level and time, with the
// observed order between successive levels.
func table(name string, levels []string, errs [][]float64) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s\n%-10s", name, "level")
	for _, f := range matrixFractions {
		fmt.Fprintf(&b, " | t=%.2fT    order", f)
	}
	b.WriteString("\n")
	for i, l := range levels {
		fmt.Fprintf(&b, "%-10s", l)
		for k := range matrixFractions {
			fmt.Fprintf(&b, " | %.3e", errs[i][k])
			if i > 0 {
				fmt.Fprintf(&b, "  %5.2f", math.Log2(errs[i-1][k]/errs[i][k]))
			} else {
				b.WriteString("       ")
			}
		}
		b.WriteString("\n")
	}
	return b.String()
}

func checkOrders(t *testing.T, name string, errs [][]float64) {
	t.Helper()
	for i := 1; i < len(errs); i++ {
		for k := range matrixFractions {
			if o := math.Log2(errs[i-1][k] / errs[i][k]); o < 1.7 || o > 2.3 {
				t.Errorf("%s: level %d at t=%.2fT has observed order %.2f, want 2 ± 0.3", name, i, matrixFractions[k], o)
			}
		}
	}
}

// fineTau lets a test solve below the product's smallest step factor, for
// references whose time error must be negligible.
func fineTau(t *testing.T) {
	saved := limits
	limits.MinTau = 0.0001
	t.Cleanup(func() { limits = saved })
}

func TestShapeErrorsConvergeUnderSpatialRefinement(t *testing.T) {
	if testing.Short() {
		t.Skip("refinement matrix")
	}
	fineTau(t)
	for _, seed := range []Seed{triangle, hexagon} {
		ref := referenceFor(t, seed, 256)
		// The hexagon's ripple is unresolved on 64 nodes (see the guard).
		nodes := []int{64, 128, 256, 512}
		if seed.Mode == 6 {
			nodes = nodes[1:]
		}
		var levels []string
		var errs [][]float64
		for _, n := range nodes {
			f := solve(t, Request{Seed: seed, Nodes: n, Tau: 0.0002, Horizon: 0.8})
			row := make([]float64, len(matrixFractions))
			for k, frac := range matrixFractions {
				row[k] = ref.vertexError(k, sample(t, f, frac*f.Extinction))
			}
			levels = append(levels, fmt.Sprintf("N=%d", n))
			errs = append(errs, row)
		}
		t.Log(table(fmt.Sprintf("spatial refinement, τ=0.0002, %+v", seed), levels, errs))
		checkOrders(t, fmt.Sprintf("%+v spatial", seed), errs[:3])
	}
}

// Time refinement at N = 256, against the independent reference (whose
// difference floors at the N = 256 spatial error, about 5e-6) and against
// τ = 0.0001 at the same N, which isolates the time error. Coarse levels are
// pre-asymptotic: while a ripple decays, the observed order is below 2 and
// rises with refinement, so the order is asserted over the finest levels.
func TestShapeErrorsConvergeUnderTimeRefinement(t *testing.T) {
	if testing.Short() {
		t.Skip("refinement matrix")
	}
	fineTau(t)
	for _, seed := range []Seed{triangle, hexagon} {
		ref := referenceFor(t, seed, 256)
		var levels []string
		var errs, own [][]float64
		fine := solve(t, Request{Seed: seed, Nodes: 256, Tau: 0.0001, Horizon: 0.8})
		for _, tau := range []float64{0.02, 0.01, 0.005, 0.0025, 0.00125} {
			f := solve(t, Request{Seed: seed, Nodes: 256, Tau: tau, Horizon: 0.8})
			row, self := make([]float64, len(matrixFractions)), make([]float64, len(matrixFractions))
			for k, frac := range matrixFractions {
				c := sample(t, f, frac*f.Extinction)
				row[k] = ref.vertexError(k, c)
				d := sample(t, fine, frac*f.Extinction)
				for i := range c.X {
					self[k] = max(self[k], math.Hypot(c.X[i]-d.X[i], c.Y[i]-d.Y[i]))
				}
			}
			levels = append(levels, fmt.Sprintf("τ=%g", tau))
			errs, own = append(errs, row), append(own, self)
		}
		t.Log(table(fmt.Sprintf("time refinement, N=256, against the reference, %+v", seed), levels, errs))
		t.Log(table(fmt.Sprintf("time refinement, N=256, against τ=0.0001 at the same N, %+v", seed), levels, own))
		checkOrders(t, fmt.Sprintf("%+v time", seed), own[2:])
	}
}

func TestDefaultSettingsMeetTheShapeTolerance(t *testing.T) {
	if testing.Short() {
		t.Skip("reference solves")
	}
	for _, seed := range []Seed{triangle, hexagon} {
		ref := referenceFor(t, seed, 256)
		f := solve(t, Request{Seed: seed, Nodes: 256, Tau: 0.005, Horizon: 0.8})
		scale := math.Sqrt(f.Area0 / math.Pi)
		for k, frac := range matrixFractions {
			e := ref.vertexError(k, sample(t, f, frac*f.Extinction))
			t.Logf("%+v t=%.2fT: %.2e of the equal-area radius", seed, frac, e/scale)
			if e > 1e-4*scale {
				t.Errorf("%+v t=%.2fT: shape error %.2e exceeds 1e-4 of the equal-area radius", seed, frac, e/scale)
			}
		}
	}
}

// Approach to collapse, separately from the matrix: the default settings
// against a much finer solve, up to the film's end at the curvature floor.
// The error is a nearly fixed error in R² (a time shift, about 3e-5 R₀² at
// τ = 0.005; see TestCircleLawConvergesAtSecondOrderInTime), so the error
// in position times the radius stays bounded while the error relative to
// the shrinking loop grows like 1/R², to about 0.6% at the floor.
func TestApproachToCollapseKeepsRelativeErrorSmall(t *testing.T) {
	if testing.Short() {
		t.Skip("fine solves")
	}
	fineTau(t)
	for _, seed := range []Seed{circle, triangle, hexagon} {
		f := solve(t, Request{Seed: seed, Nodes: 256, Tau: 0.005, Horizon: 0.999})
		fine := solve(t, Request{Seed: seed, Nodes: 512, Tau: 0.0005, Horizon: 0.999})
		var b strings.Builder
		fmt.Fprintf(&b, "%+v: default ends at %.5fT (%s), fine at %.5fT\n", seed, f.End/f.Extinction, f.Stop, fine.End/fine.Extinction)
		for _, frac := range []float64{0.5, 0.9, 0.95, 0.99, math.Min(f.End, fine.End) / f.Extinction} {
			at := frac * f.Extinction
			c, d := sample(t, f, at), sample(t, fine, at)
			// Vertices at the same normal angle: every other fine node.
			e := 0.0
			for i := range c.X {
				e = max(e, math.Hypot(c.X[i]-d.X[2*i], c.Y[i]-d.Y[2*i]))
			}
			radius := math.Sqrt(spectralArea(d) / math.Pi)
			fmt.Fprintf(&b, "  t=%.5fT  radius %.4f  error %.2e = %.2e of the radius  ρ range [%.4f, %.4f]\n", frac, radius, e, e/radius, c.MinRho, c.MaxRho)
			if e*radius > 2e-5 {
				t.Errorf("%+v t=%.4fT: error × radius %.2e, above the time-shift bound 2e-5", seed, frac, e*radius)
			}
		}
		t.Log(b.String())
	}
}
