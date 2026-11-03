package shorten

import (
	"errors"
	"math"
	"math/rand/v2"
	"testing"

	"tangentgarden/engine"
)

// The experiment's seeds at their largest allowed perturbation.
var (
	triangle = Seed{Radius: 1, Mode: 3, Epsilon: 1.0 / 16}
	hexagon  = Seed{Radius: 1, Mode: 6, Epsilon: 0.5 / 35}
	circle   = Seed{Radius: 1}
)

func solve(t *testing.T, q Request) *Film {
	t.Helper()
	f, err := Solve(q)
	if err != nil {
		t.Fatalf("Solve(%+v): %v", q, err)
	}
	return f
}

func sample(t *testing.T, f *Film, at float64) Contour {
	t.Helper()
	c, err := f.Sample(at)
	if err != nil {
		t.Fatalf("Sample(%g) of a film ending at %g (%s): %v", at, f.End, f.Stop, err)
	}
	return c
}

// polygonArea is the shoelace area of the returned vertices.
func polygonArea(c Contour) float64 {
	n, a := len(c.X), 0.0
	for i := range n {
		j := (i + 1) % n
		a += c.X[i]*c.Y[j] - c.X[j]*c.Y[i]
	}
	return a / 2
}

func polygonLength(c Contour) float64 {
	n, l := len(c.X), 0.0
	for i := range n {
		j := (i + 1) % n
		l += math.Hypot(c.X[j]-c.X[i], c.Y[j]-c.Y[i])
	}
	return l
}

// spectralArea is ½∮(x dy − y dx) over the trigonometric interpolants of
// the returned vertices, which lie at equally spaced normal angles: the
// enclosed area to spectral accuracy, measured from geometry alone.
func spectralArea(c Contour) float64 {
	n := len(c.X)
	dx, dy := spectralDerivative(c.X), spectralDerivative(c.Y)
	a := 0.0
	for i := range n {
		a += c.X[i]*dy[i] - c.Y[i]*dx[i]
	}
	return a / 2 * (2 * math.Pi / float64(n))
}

// spectralDerivative differentiates equally spaced periodic samples on
// [0, 2π) through their discrete Fourier series, dropping the Nyquist mode.
func spectralDerivative(v []float64) []float64 {
	n := len(v)
	re, im := make([]float64, n), make([]float64, n)
	for k := range n {
		for j, x := range v {
			s, c := math.Sincos(-2 * math.Pi * float64(k*j%n) / float64(n))
			re[k] += x * c
			im[k] += x * s
		}
	}
	out := make([]float64, n)
	for j := range n {
		for k := range n {
			w := k
			if k > n/2 {
				w = k - n
			}
			if 2*k == n {
				continue
			}
			s, c := math.Sincos(2 * math.Pi * float64(k*j%n) / float64(n))
			// d/dθ of (re + i im) e^{ikθ} is ik(re + i im) e^{ikθ}.
			out[j] += float64(w) * (-im[k]*c - re[k]*s)
		}
		out[j] /= float64(n)
	}
	return out
}

func TestCircleRecoversItsRadiusLawAtArbitraryTimes(t *testing.T) {
	for _, seed := range []Seed{circle, {Radius: 2.5, CenterX: 0.7, CenterY: -1.3}} {
		f := solve(t, Request{Seed: seed, Nodes: 64, Tau: 0.005, Horizon: 0.98})
		r0 := seed.Radius
		ext := r0 * r0 / 2
		if math.Abs(f.Extinction-ext) > 1e-15*ext {
			t.Fatalf("extinction %g, want %g", f.Extinction, ext)
		}
		// Times that fall between steps, through the matrix's latest time
		// 0.75T. Nearer collapse, see TestCircleLawConvergesAtSecondOrderInTime.
		for _, frac := range []float64{0.0123, 0.1777, 0.31415, 0.5, 0.7499} {
			at := frac * ext
			c := sample(t, f, at)
			if c.T != at {
				t.Fatalf("sample time %g, want %g", c.T, at)
			}
			var mean float64
			radii := make([]float64, len(c.X))
			for i := range c.X {
				radii[i] = math.Hypot(c.X[i]-seed.CenterX, c.Y[i]-seed.CenterY)
				mean += radii[i] / float64(len(c.X))
			}
			for _, r := range radii {
				if math.Abs(r-mean) > 1e-12*r0 {
					t.Fatalf("t=%g: radius %g departs from mean %g: not a circle about the seed center", at, r, mean)
				}
			}
			want := r0*r0 - 2*at
			if e := math.Abs(mean*mean - want); e > 1e-4*r0*r0 {
				t.Errorf("seed %+v t=%g: R² = %.12g, want %.12g (error %.2e R₀²)", seed, at, mean*mean, want, e/(r0*r0))
			}
		}
	}
}

// The circle law's error in R², including near collapse, where a fixed
// error in R² is a growing fraction of it: errors are reported as R₀²
// fractions and their observed order.
func TestCircleLawConvergesAtSecondOrderInTime(t *testing.T) {
	for _, frac := range []float64{0.4321, 0.9, 0.95, 0.99} {
		at := frac * 0.5
		var prev float64
		for k, tau := range []float64{0.04, 0.02, 0.01, 0.005, 0.0025} {
			f := solve(t, Request{Seed: circle, Nodes: 64, Tau: tau, Horizon: 0.999})
			c := sample(t, f, at)
			r := math.Hypot(c.X[0], c.Y[0])
			e := math.Abs(r*r - (1 - 2*at))
			order := math.NaN()
			if k > 0 {
				order = math.Log2(prev / e)
				if order < 1.7 || order > 2.3 {
					t.Errorf("t=%gT τ %g→%g: observed order %.2f, want 2 ± 0.3", frac, 2*tau, tau, order)
				}
			}
			t.Logf("t=%.4gT τ=%-6g |R²−(R₀²−2t)| = %.3e R₀² (%.2e of R²)  order %.2f  steps %d", frac, tau, e, e/(1-2*at), order, f.Stats.Accepted)
			prev = e
		}
	}
}

func TestSeedsAreValidatedByField(t *testing.T) {
	good := Request{Seed: triangle, Nodes: 128, Tau: 0.01, Horizon: 0.9}
	cases := []struct {
		field string
		edit  func(*Request)
	}{
		{"seed.radius", func(q *Request) { q.Seed.Radius = 0 }},
		{"seed.radius", func(q *Request) { q.Seed.Radius = math.Inf(1) }},
		{"seed.radius", func(q *Request) { q.Seed.Radius = 1e7 }},
		{"seed.mode", func(q *Request) { q.Seed.Mode = 4 }},
		{"seed.epsilon", func(q *Request) { q.Seed.Epsilon = 0.0626 }},
		{"seed.epsilon", func(q *Request) { q.Seed.Epsilon = math.NaN() }},
		{"seed.epsilon", func(q *Request) { q.Seed.Mode, q.Seed.Epsilon = 6, -0.015 }},
		{"seed.centerX", func(q *Request) { q.Seed.CenterX = math.NaN() }},
		{"seed.centerY", func(q *Request) { q.Seed.CenterY = 1e7 }},
		{"nodes", func(q *Request) { q.Nodes = 513 }},
		{"nodes", func(q *Request) { q.Nodes = 31 }},
		{"nodes", func(q *Request) { q.Nodes = 63 }},
		{"tau", func(q *Request) { q.Tau = 0.051 }},
		{"tau", func(q *Request) { q.Tau = 0.0009 }},
		{"horizon", func(q *Request) { q.Horizon = 0 }},
		{"horizon", func(q *Request) { q.Horizon = 1 }},
		// A seed the grid cannot resolve is refused before it runs.
		{"nodes", func(q *Request) { q.Seed, q.Nodes = hexagon, 32 }},
	}
	for _, c := range cases {
		q := good
		c.edit(&q)
		_, err := Solve(q)
		var named *engine.FieldError
		if !errors.As(err, &named) || named.Field != c.field {
			t.Errorf("%+v: error %v, want a field error on %s", q, err, c.field)
		}
	}
	if _, err := Solve(good); err != nil {
		t.Fatal(err)
	}
	// The perturbation bound itself is allowed, either sign.
	for _, s := range []Seed{triangle, hexagon, {Radius: 1, Mode: 3, Epsilon: -1.0 / 16}} {
		if _, err := Solve(Request{Seed: s, Nodes: 128, Tau: 0.01, Horizon: 0.5}); err != nil {
			t.Errorf("%+v: %v", s, err)
		}
	}
}

func TestNoncircularLoopsLoseAreaAtTwoPiAndShorten(t *testing.T) {
	for _, seed := range []Seed{triangle, hexagon, {Radius: 1, Mode: 3, Epsilon: -1.0 / 16, CenterX: 0.3}} {
		// τ = 0.005 is the default: at 0.01 the hexagon's area error
		// reaches 1.8e-4 A₀ (time error), above the declared 1e-4.
		f := solve(t, Request{Seed: seed, Nodes: 256, Tau: 0.005, Horizon: 0.95})
		a0 := spectralArea(sample(t, f, 0))
		m := float64(seed.Mode)
		analytic := math.Pi * (1 + seed.Epsilon*seed.Epsilon*(1-m*m)/2)
		// Vertices sit on the curve to O(Δθ²) along its tangent, which the
		// trigonometric interpolant reads as a small area change.
		if math.Abs(a0-analytic) > 1e-6*analytic {
			t.Fatalf("%+v: initial area %.15g, analytic %.15g", seed, a0, analytic)
		}
		prevLength := math.Inf(1)
		for k := 0; k <= 18; k++ {
			at := float64(k) / 20 * f.Extinction * 1.0001
			c := sample(t, f, at)
			if e := math.Abs(spectralArea(c) - (a0 - 2*math.Pi*at)); e > 1e-4*a0 {
				t.Errorf("%+v t=%.4g: area error %.2e A₀", seed, at, e/a0)
			}
			l := polygonLength(c)
			if !(l < prevLength) {
				t.Errorf("%+v t=%.4g: length %.12g did not decrease from %.12g", seed, at, l, prevLength)
			}
			prevLength = l
			// Strictly convex and positively oriented: every turn is left.
			n := len(c.X)
			for i := range n {
				a, b, d := i, (i+1)%n, (i+2)%n
				cross := (c.X[b]-c.X[a])*(c.Y[d]-c.Y[b]) - (c.Y[b]-c.Y[a])*(c.X[d]-c.X[b])
				if !(cross > 0) {
					t.Fatalf("%+v t=%.4g: vertex %d turns %g", seed, at, b, cross)
				}
			}
			if !(c.MinRho > 0) || c.MaxRho < c.MinRho {
				t.Errorf("%+v t=%.4g: radius of curvature range [%g, %g]", seed, at, c.MinRho, c.MaxRho)
			}
		}
	}
}

func TestEvolutionIsCovariantUnderScaleAndTranslation(t *testing.T) {
	const lambda = 2.5
	cx, cy := 0.7, -1.3
	for _, seed := range []Seed{triangle, hexagon} {
		moved := seed
		moved.Radius *= lambda
		moved.CenterX, moved.CenterY = cx, cy
		a := solve(t, Request{Seed: seed, Nodes: 128, Tau: 0.01, Horizon: 0.9})
		b := solve(t, Request{Seed: moved, Nodes: 128, Tau: 0.01, Horizon: 0.9})
		if math.Abs(b.End-lambda*lambda*a.End) > 1e-12*b.End || b.Stop != a.Stop {
			t.Fatalf("%+v: ends %g (%s) and %g (%s)", seed, a.End, a.Stop, b.End, b.Stop)
		}
		for _, frac := range []float64{0, 0.1234, 0.5, 0.8} {
			p := sample(t, a, frac*a.Extinction)
			q := sample(t, b, frac*b.Extinction)
			for i := range p.X {
				ex := math.Abs(q.X[i] - (lambda*p.X[i] + cx))
				ey := math.Abs(q.Y[i] - (lambda*p.Y[i] + cy))
				if ex > 1e-12*lambda || ey > 1e-12*lambda {
					t.Fatalf("%+v at %g: vertex %d differs by (%.2e, %.2e)", seed, frac, i, ex, ey)
				}
			}
		}
	}
}

func TestSamplingIsAPureFunctionOfTime(t *testing.T) {
	q := Request{Seed: hexagon, Nodes: 256, Tau: 0.005, Horizon: 0.99}
	f := solve(t, q)
	g := solve(t, q)
	if f.End != g.End || f.Stats != g.Stats {
		t.Fatalf("repeated solves differ: %g %+v and %g %+v", f.End, f.Stats, g.End, g.Stats)
	}
	rng := rand.New(rand.NewPCG(1, 2))
	times := []float64{0, f.End}
	for range 40 {
		times = append(times, rng.Float64()*f.End)
	}
	want := map[float64]Contour{}
	for _, at := range times {
		want[at] = sample(t, g, at)
	}
	// Reversed, shuffled and repeated seeks on another film agree exactly.
	for range 3 {
		rng.Shuffle(len(times), func(i, j int) { times[i], times[j] = times[j], times[i] })
		for k := len(times) - 1; k >= 0; k-- {
			c := sample(t, f, times[k])
			w := want[times[k]]
			for i := range c.X {
				if c.X[i] != w.X[i] || c.Y[i] != w.Y[i] {
					t.Fatalf("t=%g: vertex %d differs between seeks", times[k], i)
				}
			}
		}
	}
	// Nothing is returned outside the solved interval.
	for _, at := range []float64{-1e-9, f.End * (1 + 1e-9), math.NaN(), math.Inf(1)} {
		if _, err := f.Sample(at); err == nil {
			t.Errorf("Sample(%g) of a film ending at %g returned geometry", at, f.End)
		}
	}
}

func TestRetainedStorageAndSeekWorkAreBounded(t *testing.T) {
	for _, q := range []Request{
		{Seed: hexagon, Nodes: 512, Tau: 0.001, Horizon: 0.999},
		{Seed: circle, Nodes: 32, Tau: 0.05, Horizon: 0.2},
	} {
		f := solve(t, q)
		s := f.Stats
		t.Logf("%+v: %s at %g; %+v", q, f.Stop, f.End, s)
		if s.Checkpoints > 64 || s.Checkpoints < 1 || s.Remeshed != 0 {
			t.Errorf("%+v", s)
		}
		if s.Attempted != s.Accepted+s.Rejected+s.Discarded || s.Attempted > 100000 || s.NodeUpdates != s.Attempted*q.Nodes || s.NodeUpdates > 20_000_000 {
			t.Errorf("work counts %+v", s)
		}
		worst := 0
		for k := 0; k <= 200; k++ {
			c := sample(t, f, float64(k)/200*f.End)
			worst = max(worst, c.Steps)
		}
		if worst > s.Stride+s.Rejected+1 {
			t.Errorf("a seek recomputed %d steps; stride %d", worst, s.Stride)
		}
	}
}

func TestApproachToCollapseStopsAtTheCurvatureFloor(t *testing.T) {
	for _, seed := range []Seed{circle, triangle, hexagon} {
		f := solve(t, Request{Seed: seed, Nodes: 256, Tau: 0.01, Horizon: 0.999})
		if f.Stop != "curvature" || !(f.End < 0.999*f.Extinction) {
			t.Fatalf("%+v: stopped by %q at %g of %g", seed, f.Stop, f.End, f.Extinction)
		}
		floor := 0.05 * math.Sqrt(f.Area0/math.Pi)
		c := sample(t, f, f.End)
		if c.MinRho < floor {
			t.Errorf("%+v: the last returned loop has ρ %g below the floor %g", seed, c.MinRho, floor)
		}
		// The film stops within one step of the floor: the next step's ρ²
		// would be at most (1 - τ)·ρ² below it, roughly.
		if c.MinRho > floor*1.05 {
			t.Errorf("%+v: stopped early, ρ %g against floor %g", seed, c.MinRho, floor)
		}
	}
	// A horizon before the floor ends there exactly.
	f := solve(t, Request{Seed: triangle, Nodes: 128, Tau: 0.01, Horizon: 0.5})
	if f.Stop != "horizon" || f.End != 0.5*f.Extinction {
		t.Errorf("stopped by %q at %g, want the horizon %g", f.Stop, f.End, 0.5*f.Extinction)
	}
}

func TestWorkCapsTerminateWithoutGeometryBeyond(t *testing.T) {
	saved := limits
	defer func() { limits = saved }()
	limits.Attempts = 50
	f := solve(t, Request{Seed: triangle, Nodes: 128, Tau: 0.005, Horizon: 0.99})
	if f.Stop != "work" || f.Stats.Attempted != 50 {
		t.Fatalf("stopped by %q after %d attempts", f.Stop, f.Stats.Attempted)
	}
	if _, err := f.Sample(f.End * 1.0001); err == nil {
		t.Error("a sample past the terminated interval returned geometry")
	}
	limits = saved
	limits.NodeUpdates = 128 * 30
	f = solve(t, Request{Seed: triangle, Nodes: 128, Tau: 0.005, Horizon: 0.99})
	if f.Stop != "work" || f.Stats.NodeUpdates > 128*30 {
		t.Fatalf("stopped by %q after %d node updates", f.Stop, f.Stats.NodeUpdates)
	}
}

func TestFramesRefuseTimesOutsideTheFilmByIndex(t *testing.T) {
	f := solve(t, Request{Seed: triangle, Nodes: 128, Tau: 0.005, Horizon: 0.5})
	r, err := f.Frames([]float64{0, f.End / 2, f.End})
	if err != nil || len(r.Contours) != 3 || r.End != f.End || r.Stop != "horizon" {
		t.Fatalf("%+v %v", r, err)
	}
	for i, c := range r.Contours {
		want := sample(t, f, c.T)
		if c.X[7] != want.X[7] || c.T != []float64{0, f.End / 2, f.End}[i] {
			t.Errorf("contour %d differs from its sample", i)
		}
	}
	_, err = f.Frames([]float64{0, f.End * 1.001})
	var named *engine.FieldError
	if !errors.As(err, &named) || named.Field != "times.1" {
		t.Errorf("error %v, want a field error on times.1", err)
	}
	if _, err = f.Frames(make([]float64, 65)); !errors.As(err, &named) || named.Field != "times" {
		t.Errorf("error %v, want a field error on times", err)
	}
}

// The discretization's documented exactness: constants and first harmonics
// have ρ = the constant, and their geometry is the circle they describe, so
// translations cost nothing. The returned centroid is the polygon's.
func TestGridIsExactOnFirstHarmonics(t *testing.T) {
	for _, n := range []int{32, 128, 512} {
		f := solve(t, Request{Seed: circle, Nodes: n, Tau: 0.005, Horizon: 0.1})
		g := f.g
		h := make([]float64, n)
		for i := range n {
			h[i] = 1.25 + 0.3*g.cos[i] - 0.7*g.sin[i]
		}
		rho := make([]float64, n)
		g.radii(h, rho)
		// Rounding in h is amplified by the second difference's 1/δ².
		tol := 64 * 0x1p-52 * 2.25 * g.second
		for i, r := range rho {
			if math.Abs(r-1.25) > tol {
				t.Fatalf("N=%d node %d: ρ = %.15g, want 1.25", n, i, r)
			}
		}
		c := f.contour(0, h, 0)
		for i := range c.X {
			if d := math.Hypot(c.X[i]-0.3, c.Y[i]+0.7); math.Abs(d-1.25) > 1e-12 {
				t.Fatalf("N=%d vertex %d is %.15g from (0.3, −0.7), want 1.25", n, i, d)
			}
		}
		if math.Abs(c.CenterX-0.3) > 1e-12 || math.Abs(c.CenterY+0.7) > 1e-12 {
			t.Errorf("N=%d centroid (%g, %g), want (0.3, −0.7)", n, c.CenterX, c.CenterY)
		}
	}
}

// A horizon that cuts a step short still lands on the circle law.
func TestTheHorizonStepIsShortenedNotJustRelabeled(t *testing.T) {
	for _, horizon := range []float64{0.3, 0.5, 0.777} {
		f := solve(t, Request{Seed: circle, Nodes: 64, Tau: 0.02, Horizon: horizon})
		c := sample(t, f, f.End)
		r := math.Hypot(c.X[0], c.Y[0])
		if e := math.Abs(r*r - (1 - 2*f.End)); e > 1e-3 {
			t.Errorf("horizon %g: R² error %.2e at the end", horizon, e)
		}
	}
}
