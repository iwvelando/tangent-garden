package shorten

import (
	"errors"
	"fmt"
	"math"
	"math/cmplx"
	"math/rand/v2"
	"strings"
	"testing"

	"tangentgarden/engine"
)

// Experiment 2's seeds: nonconvex flowers, with and without fine ruffles.
var (
	fivePetals = Bloom{Radius: 1, Petals: 5, Depth: 0.3}
	// Ruffles sharp enough to see need 512 nodes; see the turn guard.
	ruffled    = Bloom{Radius: 1, Petals: 5, Depth: 0.25, Ruffles: 24, Ruffle: 0.015}
	eightBloom = Bloom{Radius: 1, Petals: 8, Depth: 0.15, Ruffles: 32, Ruffle: 0.01, Phase: 0.4}
	roundBloom = Bloom{Radius: 1}
)

func bloom(t *testing.T, q BloomRequest) *Film {
	t.Helper()
	f, err := SolveBloom(q)
	if err != nil {
		t.Fatalf("SolveBloom(%+v): %v", q, err)
	}
	return f
}

func bloomAt(t *testing.T, f *Film, at float64) Contour {
	t.Helper()
	c, err := f.Sample(at)
	if err != nil {
		t.Fatalf("Sample(%g) of a film ending at %g (%s): %v", at, f.End, f.Stop, err)
	}
	return c
}

// selfIntersects tests every pair of nonadjacent edges, independently of
// the solver's bucketed test.
func selfIntersects(c Contour) bool {
	n := len(c.X)
	orient := func(ax, ay, bx, by, cx, cy float64) float64 {
		return (bx-ax)*(cy-ay) - (by-ay)*(cx-ax)
	}
	for i := range n {
		i2 := (i + 1) % n
		for j := i + 2; j < n; j++ {
			j2 := (j + 1) % n
			if j2 == i {
				continue
			}
			d1 := orient(c.X[i], c.Y[i], c.X[i2], c.Y[i2], c.X[j], c.Y[j])
			d2 := orient(c.X[i], c.Y[i], c.X[i2], c.Y[i2], c.X[j2], c.Y[j2])
			d3 := orient(c.X[j], c.Y[j], c.X[j2], c.Y[j2], c.X[i], c.Y[i])
			d4 := orient(c.X[j], c.Y[j], c.X[j2], c.Y[j2], c.X[i2], c.Y[i2])
			if d1*d2 < 0 && d3*d4 < 0 {
				return true
			}
		}
	}
	return false
}

func nonconvex(c Contour) bool {
	n := len(c.X)
	for i := range n {
		a, b, d := i, (i+1)%n, (i+2)%n
		if (c.X[b]-c.X[a])*(c.Y[d]-c.Y[b])-(c.Y[b]-c.Y[a])*(c.X[d]-c.X[b]) < 0 {
			return true
		}
	}
	return false
}

func TestBloomCircleRecoversItsRadiusLaw(t *testing.T) {
	for _, seed := range []Bloom{roundBloom, {Radius: 2.5, CenterX: 0.7, CenterY: -1.3}} {
		f := bloom(t, BloomRequest{Seed: seed, Nodes: 64, Tau: 0.0025, Horizon: 0.995})
		r0 := seed.Radius
		for _, frac := range []float64{0.0123, 0.31415, 0.7499, 0.9, 0.99} {
			at := frac * r0 * r0 / 2
			c := bloomAt(t, f, at)
			if c.T != at {
				t.Fatalf("sample time %g, want %g", c.T, at)
			}
			mean := 0.0
			for i := range c.X {
				mean += math.Hypot(c.X[i]-seed.CenterX, c.Y[i]-seed.CenterY) / float64(len(c.X))
			}
			for i := range c.X {
				if r := math.Hypot(c.X[i]-seed.CenterX, c.Y[i]-seed.CenterY); math.Abs(r-mean) > 1e-12*r0 {
					t.Fatalf("t=%g: vertex %d at radius %.15g, mean %.15g", at, i, r, mean)
				}
			}
			if e := math.Abs(mean*mean - (r0*r0 - 2*at)); e > 1e-4*r0*r0 {
				t.Errorf("%+v t=%.4gT: R² error %.2e R₀²", seed, frac, e/(r0*r0))
			}
		}
	}
}

func TestBloomSeedsAreValidatedByField(t *testing.T) {
	good := BloomRequest{Seed: ruffled, Nodes: 512, Tau: 0.0025, Horizon: 0.9}
	// Refusals on one field are told apart by what they say.
	cases := []struct {
		field string
		edit  func(*BloomRequest)
		says  string
	}{
		{"seed.radius", func(q *BloomRequest) { q.Seed.Radius = -1 }, ""},
		{"seed.petals", func(q *BloomRequest) { q.Seed.Petals = 1 }, ""},
		{"seed.petals", func(q *BloomRequest) { q.Seed.Petals = 13 }, ""},
		{"seed.depth", func(q *BloomRequest) { q.Seed.Depth = 0.89 }, "at most 0.9"},
		{"seed.depth", func(q *BloomRequest) { q.Seed.Depth, q.Seed.Ruffle = 0.88, -0.03 }, "at most 0.9"},
		{"seed.depth", func(q *BloomRequest) { q.Seed.Depth = math.NaN() }, ""},
		{"seed.depth", func(q *BloomRequest) { q.Seed.Petals = 0 }, ""},
		{"seed.ruffles", func(q *BloomRequest) { q.Seed.Ruffles = 7 }, ""},
		{"seed.ruffles", func(q *BloomRequest) { q.Seed.Ruffles = 65 }, ""},
		{"seed.ruffles", func(q *BloomRequest) { q.Seed.Ruffles = 5; q.Seed.Petals = 5 }, ""},
		{"seed.ruffle", func(q *BloomRequest) { q.Seed.Ruffles = 0 }, ""},
		{"seed.phase", func(q *BloomRequest) { q.Seed.Phase = math.Inf(1) }, ""},
		{"seed.centerX", func(q *BloomRequest) { q.Seed.CenterX = 2e3 }, ""},
		{"nodes", func(q *BloomRequest) { q.Nodes = 255 }, ""},
		{"nodes", func(q *BloomRequest) { q.Nodes = 514 }, ""},
		{"tau", func(q *BloomRequest) { q.Tau = 0.051 }, ""},
		{"tau", func(q *BloomRequest) { q.Tau = 0.0009 }, ""},
		{"horizon", func(q *BloomRequest) { q.Horizon = 1 }, ""},
		// Harmonics the grid would alias are refused before they run: 24
		// ruffles need 192 nodes.
		{"nodes", func(q *BloomRequest) { q.Seed.Ruffles, q.Nodes = 40, 318 }, ""},
		// A seed whose curvature the grid cannot resolve is refused on its
		// depth, which the reader controls; the node count is fixed.
		{"seed.depth", func(q *BloomRequest) { q.Seed = Bloom{Radius: 1, Petals: 12, Depth: 0.3}; q.Nodes = 96 }, "too sharply"},
		{"seed.depth", func(q *BloomRequest) { q.Seed = Bloom{Radius: 1, Petals: 6, Depth: 0.45} }, "too sharply"},
		// Tangents nearly along their rays leave the radial graph; that is
		// checked before resolution.
		{"seed.depth", func(q *BloomRequest) { q.Seed = Bloom{Radius: 1, Petals: 12, Depth: 0.88}; q.Nodes = 512 }, "rays"},
	}
	for _, c := range cases {
		q := good
		c.edit(&q)
		_, err := SolveBloom(q)
		var named *engine.FieldError
		if !errors.As(err, &named) || named.Field != c.field || !strings.Contains(named.Message, c.says) {
			t.Errorf("%+v: error %v, want a field error on %s saying %q", q.Seed, err, c.field, c.says)
		}
	}
	if _, err := SolveBloom(good); err != nil {
		t.Fatal(err)
	}
}

func TestFlowersLoseAreaAtTwoPiShortenAndStayEmbedded(t *testing.T) {
	for _, seed := range []Bloom{fivePetals, ruffled, eightBloom} {
		f := bloom(t, BloomRequest{Seed: seed, Nodes: 512, Tau: 0.0025, Horizon: 0.98})
		first := bloomAt(t, f, 0)
		if !nonconvex(first) {
			t.Fatalf("%+v: the seed is convex", seed)
		}
		a0 := spectralArea(first)
		analytic := math.Pi * (1 + seed.Depth*seed.Depth/2 + seed.Ruffle*seed.Ruffle/2)
		if math.Abs(a0-analytic) > 1e-6*analytic || math.Abs(f.Area0-analytic) > 1e-12*analytic {
			t.Fatalf("%+v: initial area %.15g (film %.15g), analytic %.15g", seed, a0, f.Area0, analytic)
		}
		prev := math.Inf(1)
		sawConvex := false
		for k := 0; k <= 24; k++ {
			at := float64(k) / 25 * f.End
			c := bloomAt(t, f, at)
			if e := math.Abs(spectralArea(c) - (a0 - 2*math.Pi*at)); e > 1e-4*a0 {
				t.Errorf("%+v t=%.4g: area error %.2e A₀", seed, at, e/a0)
			}
			if l := polygonLength(c); !(l < prev) {
				t.Errorf("%+v t=%.4g: length %.12g did not decrease from %.12g", seed, at, l, prev)
			} else {
				prev = l
			}
			if selfIntersects(c) {
				t.Fatalf("%+v t=%.4g: the returned loop intersects itself", seed, at)
			}
			if !nonconvex(c) {
				sawConvex = true
			}
		}
		if !sawConvex {
			t.Errorf("%+v: never became convex before %g", seed, f.End)
		}
	}
}

func arcAt(t *testing.T, f *arcFilm, at float64) Contour {
	t.Helper()
	c, err := f.Sample(at)
	if err != nil {
		t.Fatalf("reference Sample(%g) of a film ending at %g (%s): %v", at, f.End, f.Stop, err)
	}
	return c
}

// wideLimits lets a test run the reference far past the product's caps.
func wideLimits(t *testing.T) {
	saved := limits
	limits.Nodes, limits.Attempts, limits.NodeUpdates, limits.MinTau = 4096, 10_000_000, 1<<40, 0.0001
	t.Cleanup(func() { limits = saved })
}

// The arclength reference and experiment 1's support-function solver share
// no formulation; on convex seeds they must agree before the reference is
// trusted with flowers.
func TestArclengthReferenceAgreesWithTheSupportFunctionSolver(t *testing.T) {
	if testing.Short() {
		t.Skip("fine solves")
	}
	wideLimits(t)
	for _, seed := range []Seed{triangle, hexagon} {
		support := solve(t, Request{Seed: seed, Nodes: 512, Tau: 0.0002, Horizon: 0.8})
		f, err := solveArc(arcRequest{Nodes: 1024, Step: 0.01, Horizon: 0.8}, supportCurve(seed), supportArea(seed))
		if err != nil {
			t.Fatal(err)
		}
		scale := math.Sqrt(f.Area0 / math.Pi)
		for _, frac := range matrixFractions {
			at := frac * f.Extinction
			e := curveDistance(arcAt(t, f, at), sample(t, support, at))
			t.Logf("%+v t=%.2fT: %.2e of the equal-area radius", seed, frac, e/scale)
			// Experiment 1 at N = 512 is itself within about 2e-6.
			if e > 1e-5*scale {
				t.Errorf("%+v t=%.2fT: solvers differ by %.2e of the equal-area radius", seed, frac, e/scale)
			}
		}
	}
}

func TestArclengthReferenceRecoversTheCircleLaw(t *testing.T) {
	f, err := solveArc(arcRequest{Nodes: 64, Step: 0.01, Horizon: 0.99}, bloomCurve(roundBloom), math.Pi)
	if err != nil {
		t.Fatal(err)
	}
	for _, frac := range []float64{0.123, 0.5, 0.9, 0.99} {
		at := frac / 2
		c := arcAt(t, f, at)
		if e := math.Abs(c.Area/math.Pi/(polygonArea(arcAt(t, f, 0))/math.Pi) - (1 - 2*at)); e > 1e-8 {
			t.Errorf("t=%gT: R² error %.2e", frac, e)
		}
	}
}

// curveDistance is the largest distance from a vertex of b to the curve
// interpolating a's vertices trigonometrically: from the nearest vertex of
// a, Newton's method on the squared distance along the interpolant.
func curveDistance(a, b Contour) float64 {
	n := len(a.X)
	cx, cy := make([]complex128, n), make([]complex128, n)
	for i := range n {
		cx[i], cy[i] = complex(a.X[i], 0), complex(a.Y[i], 0)
	}
	fft(cx, false)
	fft(cy, false)
	// The interpolant and two derivatives at u, by powers of e^{iu}.
	at := func(u float64) (p, d1, d2 [2]float64) {
		step := cmplx.Rect(1, u)
		for c, coef := range [][]complex128{cx, cy} {
			pos, neg := complex(1, 0), complex(1, 0)
			for k := 0; k <= n/2; k++ {
				if k > 0 {
					pos *= step
					neg /= step
				}
				for _, side := range [2]int{1, -1} {
					if (k == 0 || 2*k == n) && side == -1 {
						continue
					}
					j, e, w := k, pos, float64(k)
					if side == -1 {
						j, e, w = n-k, neg, -float64(k)
					}
					if 2*k == n {
						continue
					}
					v := coef[j] * e / complex(float64(n), 0)
					p[c] += real(v)
					d1[c] += real(v * complex(0, w))
					d2[c] -= w * w * real(v)
				}
			}
		}
		return
	}
	e := 0.0
	for i := range b.X {
		q := [2]float64{b.X[i], b.Y[i]}
		near, best := 0, math.Inf(1)
		for j := range n {
			if d := math.Hypot(a.X[j]-q[0], a.Y[j]-q[1]); d < best {
				near, best = j, d
			}
		}
		u := 2 * math.Pi * float64(near) / float64(n)
		for range 20 {
			p, d1, d2 := at(u)
			g := (p[0]-q[0])*d1[0] + (p[1]-q[1])*d1[1]
			dg := d1[0]*d1[0] + d1[1]*d1[1] + (p[0]-q[0])*d2[0] + (p[1]-q[1])*d2[1]
			step := g / dg
			u -= step
			if math.Abs(step) < 1e-14 {
				break
			}
		}
		p, _, _ := at(u)
		e = max(e, math.Hypot(p[0]-q[0], p[1]-q[1]))
	}
	return e
}

var trefoil = Bloom{Radius: 1, Petals: 3, Depth: 0.5}

// Flowers against the arclength reference at 2,048 nodes: spatial
// refinement at a fine step, time refinement at 512 nodes, and the time
// error alone against the same N at a fine step.
func TestBloomConvergesAgainstTheArclengthReference(t *testing.T) {
	if testing.Short() {
		t.Skip("refinement matrix")
	}
	wideLimits(t)
	for _, seed := range []Bloom{fivePetals, trefoil} {
		area := math.Pi * (1 + seed.Depth*seed.Depth/2)
		ref, err := solveArc(arcRequest{Nodes: 2048, Step: 0.005, Horizon: 0.8}, bloomCurve(seed), area)
		if err != nil {
			t.Fatal(err)
		}
		fine := bloom(t, BloomRequest{Seed: seed, Nodes: 512, Tau: 0.0002, Horizon: 0.8})
		scale := math.Sqrt(area / math.Pi)
		row := func(f *Film, against func(at float64) Contour) []float64 {
			out := make([]float64, len(matrixFractions))
			for k, frac := range matrixFractions {
				at := frac * f.Extinction
				out[k] = curveDistance(against(at), bloomAt(t, f, at)) / scale
			}
			return out
		}
		toRef := func(at float64) Contour { return arcAt(t, ref, at) }
		toFine := func(at float64) Contour { return bloomAt(t, fine, at) }
		var spaceLevels, timeLevels []string
		var space, timeRef, timeOwn [][]float64
		for _, n := range []int{64, 128, 256, 512, 1024} {
			f, err := SolveBloom(BloomRequest{Seed: seed, Nodes: n, Tau: 0.0002, Horizon: 0.8})
			if err != nil {
				t.Logf("%+v N=%d: %v", seed, n, err)
				continue
			}
			spaceLevels = append(spaceLevels, fmt.Sprintf("N=%d", n))
			space = append(space, row(f, toRef))
		}
		for _, tau := range []float64{0.02, 0.01, 0.005, 0.0025, 0.00125} {
			f := bloom(t, BloomRequest{Seed: seed, Nodes: 512, Tau: tau, Horizon: 0.8})
			timeLevels = append(timeLevels, fmt.Sprintf("τ=%g", tau))
			timeRef, timeOwn = append(timeRef, row(f, toRef)), append(timeOwn, row(f, toFine))
		}
		t.Log(table(fmt.Sprintf("spatial refinement, τ=0.0002, against the reference (fractions of the equal-area radius), %+v", seed), spaceLevels, space))
		t.Log(table(fmt.Sprintf("time refinement, N=512, against the reference, %+v", seed), timeLevels, timeRef))
		t.Log(table(fmt.Sprintf("time refinement, N=512, against τ=0.0002 at the same N, %+v", seed), timeLevels, timeOwn))
		checkOrders(t, fmt.Sprintf("%+v space", seed), space[len(space)-3:])
		checkOrders(t, fmt.Sprintf("%+v time", seed), timeOwn[2:])
	}
}

func TestBloomDefaultsMeetTheShapeTolerance(t *testing.T) {
	if testing.Short() {
		t.Skip("fine solves")
	}
	wideLimits(t)
	for _, seed := range []Bloom{fivePetals, trefoil} {
		area := math.Pi * (1 + seed.Depth*seed.Depth/2)
		ref, err := solveArc(arcRequest{Nodes: 2048, Step: 0.005, Horizon: 0.8}, bloomCurve(seed), area)
		if err != nil {
			t.Fatal(err)
		}
		f := bloom(t, BloomRequest{Seed: seed, Nodes: 256, Tau: 0.0025, Horizon: 0.8})
		scale := math.Sqrt(area / math.Pi)
		for _, frac := range matrixFractions {
			at := frac * f.Extinction
			e := curveDistance(arcAt(t, ref, at), bloomAt(t, f, at))
			t.Logf("%+v t=%.2fT: %.2e of the equal-area radius", seed, frac, e/scale)
			if e > 1e-4*scale {
				t.Errorf("%+v t=%.2fT: %.2e", seed, frac, e/scale)
			}
		}
	}
}

func TestBloomIsCovariantUnderScaleAndTranslation(t *testing.T) {
	const lambda = 2.5
	for _, seed := range []Bloom{fivePetals, ruffled} {
		moved := seed
		moved.Radius *= lambda
		moved.CenterX, moved.CenterY = 0.7, -1.3
		a := bloom(t, BloomRequest{Seed: seed, Nodes: 512, Tau: 0.01, Horizon: 0.9})
		b := bloom(t, BloomRequest{Seed: moved, Nodes: 512, Tau: 0.01, Horizon: 0.9})
		if math.Abs(b.End-lambda*lambda*a.End) > 1e-12*b.End || a.Stop != b.Stop || a.Stats != b.Stats {
			t.Fatalf("ends %g %s %+v and %g %s %+v", a.End, a.Stop, a.Stats, b.End, b.Stop, b.Stats)
		}
		for _, frac := range []float64{0, 0.1234, 0.5, 0.85} {
			p, q := bloomAt(t, a, frac*a.Extinction), bloomAt(t, b, frac*b.Extinction)
			for i := range p.X {
				if math.Abs(q.X[i]-(lambda*p.X[i]+0.7)) > 1e-12*lambda || math.Abs(q.Y[i]-(lambda*p.Y[i]-1.3)) > 1e-12*lambda {
					t.Fatalf("%+v at %g: vertex %d differs", seed, frac, i)
				}
			}
		}
	}
}

func TestBloomSamplingIsAPureFunctionOfTime(t *testing.T) {
	q := BloomRequest{Seed: eightBloom, Nodes: 512, Tau: 0.0025, Horizon: 0.999}
	f, g := bloom(t, q), bloom(t, q)
	if f.End != g.End || f.Stats != g.Stats {
		t.Fatalf("repeated solves differ")
	}
	rng := rand.New(rand.NewPCG(3, 4))
	times := []float64{0, f.End}
	for range 30 {
		times = append(times, rng.Float64()*f.End)
	}
	want := map[float64]Contour{}
	for _, at := range times {
		want[at] = bloomAt(t, g, at)
	}
	rng.Shuffle(len(times), func(i, j int) { times[i], times[j] = times[j], times[i] })
	for _, at := range times {
		c := bloomAt(t, f, at)
		for i := range c.X {
			if c.X[i] != want[at].X[i] || c.Y[i] != want[at].Y[i] {
				t.Fatalf("t=%g: vertex %d differs between seeks", at, i)
			}
		}
	}
	for _, at := range []float64{-1e-9, f.End * (1 + 1e-9), math.NaN()} {
		if _, err := f.Sample(at); err == nil {
			t.Errorf("Sample(%g) returned geometry beyond [0, %g]", at, f.End)
		}
	}
}

func TestBloomStopsAtTheFloorWithBoundedWork(t *testing.T) {
	for _, seed := range []Bloom{roundBloom, fivePetals, eightBloom} {
		f := bloom(t, BloomRequest{Seed: seed, Nodes: 512, Tau: 0.0025, Horizon: 0.999})
		s := f.Stats
		t.Logf("%+v: %s at %.5fT; %+v", seed, f.Stop, f.End/f.Extinction, s)
		if f.Stop != "floor" {
			t.Errorf("stopped by %q", f.Stop)
		}
		c := bloomAt(t, f, f.End)
		r := math.Sqrt(c.Area / math.Pi)
		floor := 0.05 * math.Sqrt(f.Area0/math.Pi)
		if r < floor || r > 1.1*floor {
			t.Errorf("last loop's equal-area radius %g against floor %g", r, floor)
		}
		if s.Checkpoints > 64 || s.Remeshed != 0 || s.Attempted != s.Accepted+s.Rejected+s.Discarded || s.NodeUpdates != (s.Attempted+s.Trials)*512 {
			t.Errorf("counts %+v", s)
		}
		worst := 0
		for k := 0; k <= 100; k++ {
			worst = max(worst, bloomAt(t, f, float64(k)/100*f.End).Steps)
		}
		if worst > s.Stride+s.Rejected+1 {
			t.Errorf("a seek recomputed %d steps; stride %d", worst, s.Stride)
		}
		if c.Closure > 1e-8 {
			t.Errorf("closure defect %g", c.Closure)
		}
	}
	saved := limits
	defer func() { limits = saved }()
	limits.Attempts = 20
	f := bloom(t, BloomRequest{Seed: fivePetals, Nodes: 256, Tau: 0.0025, Horizon: 0.99})
	if f.Stop != "work" || f.Stats.Attempted != 20 {
		t.Errorf("stopped by %q after %d attempts", f.Stop, f.Stats.Attempted)
	}
}

func TestFrameRequestsNameExactlyOneEvolution(t *testing.T) {
	b := BloomRequest{Seed: fivePetals, Nodes: 256, Tau: 0.0025, Horizon: 0.5}
	c := Request{Seed: triangle, Nodes: 128, Tau: 0.005, Horizon: 0.5}
	for _, q := range []FrameRequest{{}, {Bloom: &b, Convex: &c}} {
		if _, err := q.Solve(); err == nil {
			t.Errorf("%+v solved", q)
		}
	}
	f, err := FrameRequest{Bloom: &b}.Solve()
	if err != nil || f.Stop != "horizon" {
		t.Fatalf("%v %v", f, err)
	}
	r, err := f.Frames([]float64{0, f.End})
	if err != nil || len(r.Contours) != 2 || r.Contours[1].T != f.End {
		t.Fatalf("%+v %v", r, err)
	}
	var named *engine.FieldError
	if _, err := f.Frames([]float64{f.End * 1.01}); !errors.As(err, &named) || named.Field != "times.0" {
		t.Errorf("error %v", err)
	}
}

// The seed is the polar curve named, ruffles turned by the phase, and the
// curvature readout is the drawn loop's: against the polar formula
// κ = (r² + 2r′² − r r″)/(r² + r′²)^{3/2} at the nodes.
func TestBloomSeedAndCurvatureReadoutFollowThePolarCurve(t *testing.T) {
	seed := Bloom{Radius: 1, Petals: 5, Depth: 0.25, Ruffles: 24, Ruffle: 0.015, Phase: 0.4}
	f := bloom(t, BloomRequest{Seed: seed, Nodes: 512, Tau: 0.0025, Horizon: 0.5})
	c := bloomAt(t, f, 0)
	lo, hi := math.Inf(1), math.Inf(-1)
	for i := range c.X {
		phi := 2 * math.Pi * float64(i) / float64(len(c.X))
		r := 1 + seed.Depth*math.Cos(5*phi) + seed.Ruffle*math.Cos(24*phi+seed.Phase)
		if d := math.Hypot(c.X[i]-r*math.Cos(phi), c.Y[i]-r*math.Sin(phi)); d > 1e-14 {
			t.Fatalf("node %d is %.2e from the seed", i, d)
		}
		dr := -seed.Depth*5*math.Sin(5*phi) - seed.Ruffle*24*math.Sin(24*phi+seed.Phase)
		ddr := -seed.Depth*25*math.Cos(5*phi) - seed.Ruffle*576*math.Cos(24*phi+seed.Phase)
		k := (r*r + 2*dr*dr - r*ddr) / math.Pow(r*r+dr*dr, 1.5)
		lo, hi = min(lo, k), max(hi, k)
	}
	// Second-order differences on 512 nodes: within 1% of the range.
	tol := 0.01 * (hi - lo)
	if math.Abs(c.MinKappa-lo) > tol || math.Abs(c.MaxKappa-hi) > tol {
		t.Errorf("curvature readout [%g, %g], polar formula [%g, %g]", c.MinKappa, c.MaxKappa, lo, hi)
	}
}
