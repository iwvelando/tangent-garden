package shorten

import (
	"errors"
	"math"
	"math/cmplx"
	"strings"
	"testing"

	"tangentgarden/engine"
)

// #409 research: admission and evolution of users' own loops. Expectations
// are independent of the solvers: closed forms (the circle law, the area
// law, an ellipse's minor axis, a limaçon's inner loop) and invariance
// under the symmetries of the flow.

func refusedOn(t *testing.T, err error, path string) {
	t.Helper()
	var fe *engine.FieldError
	if !errors.As(err, &fe) || fe.Field != path {
		t.Fatalf("want a refusal on %s, got %v", path, err)
	}
}

func TestLoopsAreRefusedByField(t *testing.T) {
	cases := []struct {
		name string
		loop Loop
		path string
	}{
		{"neither", Loop{}, "loop"},
		{"both", Loop{Terms: circleTerms(1, 0), Points: exampleLeaf}, "loop"},
		{"seventeen terms", Loop{Terms: append(leafTerms(t, 16), engine.Term{Frequency: 20, Radius: 0.01})}, "loop.terms"},
		{"frequency 65", Loop{Terms: rippleTerms(64, 0.001)}, "loop.terms.1"},
		{"fractional frequency", Loop{Terms: []engine.Term{{Frequency: 1, Radius: 1}, {Frequency: 2.5, Radius: 0.1}}}, "loop.terms.1"},
		{"no area", Loop{Terms: terms(map[int]complex128{1: -0.5i, -1: 0.5i, 2: 0.25, -2: -0.25})}, "loop.terms"},
		{"inner loop", Loop{Terms: limacon(2)}, "loop.terms"},
		{"hairline inner loop", Loop{Terms: limacon(1.05)}, "loop.terms"},
		{"cusp", Loop{Terms: nearCusp(0.5)}, "loop.terms"},
		{"too few points", Loop{Points: []engine.Vec{{X: 0, Y: 0}, {X: 1, Y: 0}, {X: 1, Y: 0}, {X: 0, Y: 0}}}, "loop.points"},
		{"bowtie", Loop{Points: []engine.Vec{{X: 0, Y: 0}, {X: 1, Y: 1}, {X: 1, Y: 0}, {X: 0, Y: 1}}}, "loop.points"},
		{"pentagram", Loop{Points: pentagram()}, "loop.points"},
		{"nonfinite point", Loop{Points: []engine.Vec{{X: 0, Y: 0}, {X: math.NaN(), Y: 0}, {X: 0, Y: 1}}}, "loop.points.1"},
		{"too many points", Loop{Points: ellipseOutline(2, 1, loopPoints+1)}, "loop.points"},
	}
	for _, c := range cases {
		_, err := SolveLoop(LoopRequest{Loop: c.loop, Horizon: 0.5})
		t.Run(c.name, func(t *testing.T) { refusedOn(t, err, c.path) })
		// Admission names a crossing itself, before any arm sees the loop.
		if c.name == "pentagram" || c.name == "bowtie" || c.name == "inner loop" {
			if err == nil || !strings.Contains(err.Error(), "crosses itself") {
				t.Errorf("%s: %v", c.name, err)
			}
		}
	}
	_, err := SolveLoop(LoopRequest{Loop: Loop{Terms: circleTerms(1, 0)}, Solver: "spline", Horizon: 0.5})
	refusedOn(t, err, "solver")
	// Each arm's own refusals: the radial graph refuses a loop that is not
	// star-shaped as a loop, before its grid; the polygon arm refuses a neck
	// it would need more than 4,096 nodes to span four times.
	_, err = SolveLoop(LoopRequest{Loop: Loop{Terms: leafTerms(t, 16)}, Solver: "polar", Horizon: 0.5})
	refusedOn(t, err, "loop.terms")
	_, err = SolveLoop(LoopRequest{Loop: Loop{Terms: nearCusp(0.49)}, Solver: "bgn", Horizon: 0.5})
	refusedOn(t, err, "nodes")
	_, err = SolveLoop(LoopRequest{Loop: Loop{Terms: circleTerms(1, 0)}, Horizon: 1})
	refusedOn(t, err, "horizon")
}

// A limaçon r = 1 + b cos u has an inner loop for every b > 1, of
// diameter about b − 1 near the origin: far below the certificate's first
// sample spacing for b close to 1. It must never be certified.
func TestTheCertificateNeverAdmitsACrossing(t *testing.T) {
	for _, b := range []float64{1.5, 1.05, 1.01, 1 + 1e-3, 1 + 1e-4, 1 + 1e-6} {
		_, err := admit(Loop{Terms: limacon(b)})
		if err == nil {
			t.Errorf("b = %g: a loop that crosses itself was admitted", b)
		}
	}
	// Below b = 1 the limaçon is embedded and smooth; at b = 1 a cardioid's
	// cusp. b = 0.9 must be certified.
	src, err := admit(Loop{Terms: limacon(0.9)})
	if err != nil || !src.adm.Certified {
		t.Errorf("b = 0.9: %v", err)
	}
	if _, err := admit(Loop{Terms: limacon(1)}); err == nil {
		t.Error("the cardioid's cusp was admitted")
	}
}

func TestAdmissionMeasuresKnownShapes(t *testing.T) {
	// Ellipse with semi-axes 2 and 1: area 2π, equal-area radius √2, the
	// curvature range b/a² to a/b², and its neck the minor axis.
	src, err := admit(Loop{Terms: ellipseTerms(2, 1)})
	if err != nil {
		t.Fatal(err)
	}
	a := src.adm
	R := math.Sqrt2
	near := func(name string, got, want, tol float64) {
		t.Helper()
		if math.Abs(got-want) > tol {
			t.Errorf("%s: %.12g, want %.12g", name, got, want)
		}
	}
	near("area", a.Area, 2*math.Pi, 1e-12)
	near("radius", a.Radius, R, 1e-12)
	near("κR min", a.MinKappa, 1.0/4*R, 1e-9)
	near("κR max", a.MaxKappa, 2*R, 1e-9)
	near("neck", a.Neck, 2/R, 1e-6)
	near("thickness", a.Thickness, 0.5/R, 1e-9)
	near("center x", a.CenterX, 0, 1e-12)
	near("center y", a.CenterY, 0, 1e-12)
	if !a.Certified || a.Reversed {
		t.Errorf("certified %v, reversed %v", a.Certified, a.Reversed)
	}
	// A circle has no neck: the search's cap, 2R.
	src, _ = admit(Loop{Terms: circleTerms(3, 5-1i)})
	near("circle neck", src.adm.Neck, 2, 0)
	near("circle center x", src.adm.CenterX, 5, 1e-12)
	near("circle star", src.adm.Star, 1, 1e-9)
	// Horseshoes: the neck is the gap between their ends, within a sample
	// spacing of the 8,192 resampled points.
	for _, gap := range []float64{0.05, 0.02} {
		src, err := admit(Loop{Points: cShape(gap, 0.3, 0.004)})
		if err != nil {
			t.Fatal(err)
		}
		near("C neck", src.adm.Neck*src.adm.Radius, gap, src.adm.Length/8192)
	}
	// The example leaf is drawn clockwise; admission reverses it.
	src, _ = admit(Loop{Terms: leafTerms(t, 8)})
	if !src.adm.Reversed || !(src.adm.Area > 0) {
		t.Errorf("leaf: reversed %v, area %g", src.adm.Reversed, src.adm.Area)
	}
	src, _ = admit(Loop{Points: exampleLeaf})
	if !src.adm.Reversed || !(src.adm.Area > 0) {
		t.Errorf("leaf outline: reversed %v, area %g", src.adm.Reversed, src.adm.Area)
	}
}

// Every arm on an off-center circle: R² = R₀² − 2t between steps.
func TestEveryArmRecoversTheCircleLaw(t *testing.T) {
	// The polygon arm's first order in time leaves about 0.4% of R₀² by
	// the end; its order-2 variant meets the radial graph's 1e-4.
	for _, c := range []struct {
		arm   string
		order int
		tol   float64
	}{{"polar", 0, 1e-4}, {"arc", 0, 1e-6}, {"bgn", 1, 4e-3}, {"bgn", 2, 1e-4}} {
		arm, tol := c.arm, c.tol
		f, err := SolveLoop(LoopRequest{Loop: Loop{Terms: circleTerms(2, 3+4i)}, Solver: arm, Order: c.order, Horizon: 0.999})
		if err != nil {
			t.Fatal(arm, err)
		}
		for _, frac := range []float64{0.123, 0.5, 0.9, 0.99} {
			at := frac * 2
			c, err := f.Sample(at)
			if err != nil {
				t.Fatal(arm, err)
			}
			// The polygon's own area over the inscribed polygon's ratio,
			// measured on the returned loop: mean distance from the center.
			r2 := 0.0
			for i := range c.X {
				r2 += (math.Pow(c.X[i]-3, 2) + math.Pow(c.Y[i]-4, 2)) / float64(len(c.X))
			}
			if e := math.Abs(r2/4 - (1 - 2*at/4)); e > tol {
				t.Errorf("%s t=%gT: R² error %.2e of R₀²", arm, frac, e)
			}
		}
	}
}

// Area falls at 2π, length falls, and every returned loop is embedded, on
// each arm that admits the loop.
func TestAdmittedLoopsLoseAreaAtTwoPiAndStayEmbedded(t *testing.T) {
	cases := []struct {
		name string
		loop Loop
		arms []string
		tol  map[string]float64
	}{
		{"leaf, 8 terms", Loop{Terms: leafTerms(t, 8)}, []string{"arc", "bgn"}, nil},
		{"leaf, 16 terms", Loop{Terms: leafTerms(t, 16)}, []string{"arc", "bgn"}, nil},
		// A ripple of frequency 63 decays within the first thousandth of
		// the film; the arclength solver's steps must follow it (#410).
		{"ripple f=63 ε=0.001", Loop{Terms: rippleTerms(63, 0.001)}, []string{"arc"}, nil},
		{"near cusp a=0.3", Loop{Terms: nearCusp(0.3)}, []string{"polar", "arc", "bgn"}, nil},
		{"limaçon b=0.9", Loop{Terms: limacon(0.9)}, []string{"bgn"}, nil},
		{"leaf outline", Loop{Points: exampleLeaf}, []string{"bgn"}, nil},
		{"square", Loop{Points: []engine.Vec{{X: 0, Y: 0}, {X: 1, Y: 0}, {X: 1, Y: 1}, {X: 0, Y: 1}}}, []string{"bgn"}, nil},
		// Two arcs 0.02 apart, 4 node spacings at 3,225 nodes; the gap
		// widens as the ends retract, and the polygon halves once.
		{"horseshoe, gap 0.02", Loop{Points: cShape(0.02, 0.3, 0.02)}, []string{"bgn"}, nil},
		// Strokes as a pointer draws them, densely: pixel steps, and a
		// tremor. Their sharpest turn grows a little in the first steps
		// before the jags melt (#410's review).
		{"drawn, 600 samples in pixel steps", Loop{Points: drawnOutline(600, 0.01, 0)}, []string{"bgn"}, nil},
		{"drawn, 1,800 samples with tremor", Loop{Points: drawnOutline(1800, 0, 0.015)}, []string{"bgn"}, nil},
	}
	// The polygon arm is first order in time: at τ = 0.0025 its area runs
	// about 0.3% behind the law by the end (measured 2.8e-3 on the square).
	tol := map[string]float64{"polar": 1e-4, "arc": 1e-5, "bgn": 3e-3}
	for _, c := range cases {
		for _, arm := range c.arms {
			f, err := SolveLoop(LoopRequest{Loop: c.loop, Solver: arm, Horizon: 0.999})
			if err != nil {
				t.Errorf("%s/%s: %v", c.name, arm, err)
				continue
			}
			r, _ := f.Frames(nil)
			if r.End < 0.99*r.Extinction {
				t.Errorf("%s/%s: the film ends at %.3fT (%s)", c.name, arm, r.End/r.Extinction, r.Stop)
			}
			prev := math.Inf(1)
			first, _ := f.Sample(0)
			for k := 0; k <= 40; k++ {
				at := min(r.End, r.End*float64(k)/40)
				s, err := f.Sample(at)
				if err != nil {
					t.Fatal(err)
				}
				// The returned polygon's area, from its own start: the
				// inscribed polygon's constant deficit is not the flow's.
				if e := math.Abs(s.Area-(first.Area-2*math.Pi*at)) / r.Area0; e > tol[arm] {
					t.Errorf("%s/%s t=%.3fT: area error %.2e of A₀", c.name, arm, at/r.Extinction, e)
				}
				if !(s.Length < prev) && k > 0 {
					t.Errorf("%s/%s t=%.3fT: length %g after %g", c.name, arm, at/r.Extinction, s.Length, prev)
				}
				prev = s.Length
				if crossesItself(s) {
					t.Errorf("%s/%s t=%.3fT: the loop crosses itself", c.name, arm, at/r.Extinction)
				}
			}
		}
	}
}

// Scaling a loop by λ scales its film's times by λ² and its loops by λ;
// translating translates them; reversing the loop or shifting its start
// leaves the same curves. Compared as curves, by each vertex's distance
// from the other polygon, over the equal-area radius.
func TestLoopFilmsAreCovariant(t *testing.T) {
	base := leafTerms(t, 8)
	transform := func(lam float64, shift complex128) []engine.Term {
		out := []engine.Term{}
		for _, term := range base {
			c := cmplx.Rect(term.Radius*lam, term.Phase)
			if term.Frequency == 0 {
				c += shift
			}
			out = append(out, engine.Term{Frequency: term.Frequency, Radius: cmplx.Abs(c), Phase: cmplx.Phase(c)})
		}
		return out
	}
	reversed := []engine.Term{}
	shifted := []engine.Term{}
	for _, term := range base {
		reversed = append(reversed, engine.Term{Frequency: -term.Frequency, Radius: term.Radius, Phase: term.Phase})
		shifted = append(shifted, engine.Term{Frequency: term.Frequency, Radius: term.Radius, Phase: term.Phase + term.Frequency*0.7})
	}
	for _, arm := range []string{"arc", "bgn"} {
		ref, err := SolveLoop(LoopRequest{Loop: Loop{Terms: base}, Solver: arm, Horizon: 0.9})
		if err != nil {
			t.Fatal(err)
		}
		R := ref.Admission.Radius
		for _, v := range []struct {
			name  string
			terms []engine.Term
			lam   float64
			shift complex128
			tol   float64
		}{
			{"scaled 1e-3", transform(1e-3, 0), 1e-3, 0, 1e-9},
			{"scaled 512", transform(512, 0), 512, 0, 1e-9},
			// Absolute coordinates near 1,000 round at about 1e-13; the
			// steps compound it.
			{"translated 1e3", transform(1, 1e3+1e3i), 1, 1e3 + 1e3i, 1e-6},
			{"reversed", reversed, 1, 0, 1e-3},
			{"start shifted", shifted, 1, 0, 1e-3},
		} {
			f, err := SolveLoop(LoopRequest{Loop: Loop{Terms: v.terms}, Solver: arm, Horizon: 0.9})
			if err != nil {
				t.Fatal(arm, v.name, err)
			}
			for _, frac := range []float64{0, 0.3, 0.6, 0.85} {
				at := frac * ref.Admission.Area / (2 * math.Pi)
				a, _ := ref.Sample(at)
				b, err := f.Sample(at * v.lam * v.lam)
				if err != nil {
					t.Fatal(arm, v.name, err)
				}
				for i := range b.X {
					b.X[i] = (b.X[i] - real(v.shift)) / v.lam
					b.Y[i] = (b.Y[i] - imag(v.shift)) / v.lam
				}
				e := math.Max(toPolygon(a.X, a.Y, b.X, b.Y), toPolygon(b.X, b.Y, a.X, a.Y)) / R
				// Scale and translation retake the same steps; reversal and
				// a start shift sample the curve elsewhere, so they agree to
				// the solver's spatial error and its chords' sag.
				if e > v.tol {
					t.Errorf("%s %s t=%.2fT: %.2e of R", arm, v.name, frac, e)
				}
			}
		}
	}
}

// A sample depends only on the request and its time: bit-identical in any
// order, and each film's retained work is bounded.
func TestLoopSamplesArePureFunctionsOfTime(t *testing.T) {
	for _, q := range []LoopRequest{
		{Loop: Loop{Terms: leafTerms(t, 8)}, Solver: "arc", Horizon: 0.999},
		{Loop: Loop{Terms: nearCusp(0.3)}, Solver: "polar", Horizon: 0.999},
		{Loop: Loop{Points: exampleLeaf}, Solver: "bgn", Horizon: 0.999},
		// Remeshed once, about 0.15T in: seeks on either side replay it.
		{Loop: Loop{Points: cShape(0.02, 0.3, 0.02)}, Solver: "bgn", Horizon: 0.999},
	} {
		f, err := SolveLoop(q)
		if err != nil {
			t.Fatal(err)
		}
		r, _ := f.Frames(nil)
		if len(q.Loop.Points) > 100 && (r.Stats.Remeshed != 1 || !(r.Stats.RemeshError > 0 && r.Stats.RemeshError < 1e-4)) {
			t.Errorf("horseshoe: remeshed %d times, error %g R", r.Stats.Remeshed, r.Stats.RemeshError)
		}
		if r.Stats.Checkpoints > loopCheckpoints+1 || r.Stats.NodeUpdates > limits.NodeUpdates || r.Stats.Attempted > limits.Attempts {
			t.Errorf("%s: work %+v beyond the limits", q.Solver, r.Stats)
		}
		times := []float64{0.7 * r.End, 0.1 * r.End, r.End, 0.7 * r.End, 0}
		first := map[float64]Contour{}
		for _, at := range times {
			c, err := f.Sample(at)
			if err != nil {
				t.Fatal(err)
			}
			if prev, ok := first[at]; ok {
				for i := range c.X {
					if c.X[i] != prev.X[i] || c.Y[i] != prev.Y[i] {
						t.Fatalf("%s t=%g: a second sample differs", q.Solver, at)
					}
				}
			}
			first[at] = c
			if c.Steps > r.Stats.Stride+retries+64 {
				t.Errorf("%s t=%g: a seek retook %d steps (stride %d)", q.Solver, at, c.Steps, r.Stats.Stride)
			}
		}
	}
}

// crossesItself tests every pair of nonadjacent edges, independently of
// the solvers' bucketed test. Boxes must overlap first: an outline's
// inserted points are collinear, and orientations of collinear disjoint
// segments are rounding noise.
func crossesItself(c Contour) bool {
	n := len(c.X)
	o := func(a, b, p int) float64 {
		return (c.X[b]-c.X[a])*(c.Y[p]-c.Y[a]) - (c.Y[b]-c.Y[a])*(c.X[p]-c.X[a])
	}
	for i := range n {
		i2 := (i + 1) % n
		for j := i + 2; j < n; j++ {
			j2 := (j + 1) % n
			if j2 == i {
				continue
			}
			if max(c.X[i], c.X[i2]) < min(c.X[j], c.X[j2]) || max(c.X[j], c.X[j2]) < min(c.X[i], c.X[i2]) ||
				max(c.Y[i], c.Y[i2]) < min(c.Y[j], c.Y[j2]) || max(c.Y[j], c.Y[j2]) < min(c.Y[i], c.Y[i2]) {
				continue
			}
			if o(i, i2, j)*o(i, i2, j2) < 0 && o(j, j2, i)*o(j, j2, i2) < 0 {
				return true
			}
		}
	}
	return false
}

// A circle is resolved at every N: its curvature spectrum is rounding.
func TestTheArclengthArmAdmitsACircleAtEveryResolution(t *testing.T) {
	for n := arcFrom; n <= arcTo; n *= 2 {
		if _, err := SolveLoop(LoopRequest{Loop: Loop{Terms: circleTerms(1, 3+2i)}, Solver: "arc", Nodes: n, Horizon: 0.1}); err != nil {
			t.Errorf("N=%d: %v", n, err)
		}
	}
}

// A seek replays the solve's remeshing at the same steps: just after each
// remesh, and before the next checkpoint, a sample has the solve's vertex
// count, and just before it the count it had before.
func TestSeeksReplayRemeshing(t *testing.T) {
	f, err := SolveLoop(LoopRequest{Loop: Loop{Points: cShape(0.02, 0.3, 0.02)}, Solver: "bgn", Horizon: 0.999})
	if err != nil {
		t.Fatal(err)
	}
	b := f.film.(*bgnFilm)
	if len(b.remeshes) == 0 {
		t.Fatal("the horseshoe never remeshed")
	}
	for _, r := range b.remeshes {
		after, _ := f.Sample(math.Nextafter(r.t, math.Inf(1)))
		at, _ := f.Sample(r.t)
		before, _ := f.Sample(math.Nextafter(r.t, 0))
		if len(after.X) != r.nodes || len(at.X) != r.nodes || len(before.X) <= r.nodes {
			t.Errorf("remesh at t=%g to %d nodes: %d just before, %d at, %d just after", r.t, r.nodes, len(before.X), len(at.X), len(after.X))
		}
		// The remeshed polygon still resolves the loop: every vertex turns
		// at most half the resolution limit, and the neck spans twice the
		// admitted spacings.
		if c := corner(at.X, at.Y); c > turnLimit/2 {
			t.Errorf("remesh at t=%g: a vertex turns %.3f rad", r.t, c)
		}
		if nk := neck(at.X, at.Y, 2*f.Admission.Radius); nk < 2*neckSpacings*at.Length/float64(len(at.X)) {
			t.Errorf("remesh at t=%g: neck %.4f spans %.1f spacings", r.t, nk, nk/(at.Length/float64(len(at.X))))
		}
	}
}

// A five-pointed star polygon, {5/2}: it crosses itself, with nonzero area.
func pentagram() []engine.Vec {
	out := []engine.Vec{}
	for k := range 5 {
		a := math.Pi/2 + 4*math.Pi*float64(k)/5
		out = append(out, engine.Vec{X: math.Cos(a), Y: math.Sin(a)})
	}
	return out
}

// The automatic choice is the arclength solver, then the polygon solver
// (#410's contract): the radial graph, a comparison arm of the research,
// never evolves a user loop, nor is its refusal reported. Every outline
// goes to the polygon solver.
func TestTheAutomaticChoiceIsArclengthThenPolygon(t *testing.T) {
	for _, c := range append(fourierCorpus(t), outlineCorpus()...) {
		f, err := SolveLoop(LoopRequest{Loop: c.loop, Horizon: 0.5})
		if err != nil {
			continue
		}
		a := f.Admission
		if a.Solver != "arc" && a.Solver != "bgn" {
			t.Errorf("%s: evolved on %q", c.name, a.Solver)
		}
		if _, ok := a.Refused["polar"]; ok {
			t.Errorf("%s: the radial graph's refusal is reported", c.name)
		}
		if a.Source == "outline" && a.Solver != "bgn" {
			t.Errorf("%s: an outline on %q", c.name, a.Solver)
		}
	}
	f, err := SolveLoop(LoopRequest{Loop: Loop{Terms: leafTerms(t, 8)}, Horizon: 0.5})
	if err != nil || f.Admission.Solver != "arc" {
		t.Errorf("the 8-term leaf: %v", err)
	}
}

// A loop that admission accepts but neither solver can resolve is refused
// on its source's own path, in a sentence that names the reason and the
// limit, not the solvers' internal names.
func TestUnresolvableLoopsAreRefusedInPlainWords(t *testing.T) {
	for _, c := range []struct {
		name string
		loop Loop
		path string
		want string
	}{
		{"near cusp a=0.49", Loop{Terms: nearCusp(0.49)}, "loop.terms", "4,096"},
		{"horseshoe, gap 0.01", Loop{Points: cShape(0.01, 0.3, 0.02)}, "loop.points", "4,096"},
	} {
		_, err := SolveLoop(LoopRequest{Loop: c.loop, Horizon: 0.5})
		refusedOn(t, err, c.path)
		m := err.Error()
		if !strings.Contains(m, c.want) || !strings.HasSuffix(m, ".") || m[0] < 'A' || m[0] > 'Z' {
			t.Errorf("%s: %q", c.name, m)
		}
		for _, jargon := range []string{"arc:", "polar", "bgn", "nodes", "spacings"} {
			if strings.Contains(m, jargon) {
				t.Errorf("%s: %q names %q", c.name, m, jargon)
			}
		}
	}
}

// A ripple of frequency 63 decays within the first thousandth of the film,
// far faster than the curvature suggests. The arclength solver's steps are
// error-controlled (#410), so its film follows a reference whose steps are
// controlled a thousand times more tightly, from the transient to the end.
func TestTheArclengthStepFollowsAFastRipple(t *testing.T) {
	loop := Loop{Terms: rippleTerms(63, 0.001)}
	f, err := SolveLoop(LoopRequest{Loop: loop, Horizon: 0.999})
	if err != nil || f.Admission.Solver != "arc" {
		t.Fatalf("%v", err)
	}
	src, err := admit(loop)
	if err != nil {
		t.Fatal(err)
	}
	saved := arcTol
	arcTol = 1e-12
	ref, _, _, err := src.arc(LoopRequest{Loop: loop, Tau: 0.005, Horizon: 0.999})
	arcTol = saved
	if err != nil {
		t.Fatal(err)
	}
	r, _ := f.Frames(nil)
	first, _ := f.Sample(0)
	for _, frac := range []float64{1e-4, 1e-3, 1e-2, 0.1, 0.5, 0.95} {
		at := frac * r.Extinction
		c, err := f.Sample(at)
		if err != nil {
			t.Fatal(err)
		}
		k, _ := ref.Sample(at)
		if e := shapeError(k, c); e > 1e-6 {
			t.Errorf("t=%gT: %.1e of R(t) from the reference", frac, e)
		}
		if e := math.Abs(c.Area-(first.Area-2*math.Pi*at)) / r.Area0; e > 1e-5 {
			t.Errorf("t=%gT: area error %.1e of A₀", frac, e)
		}
	}
}

// The neck search bounded by a coarse pass returns exactly what a search to
// the limit does, on every loop of the corpus, smooth or drawn.
func TestTheBoundedNeckSearchMatchesTheFullOne(t *testing.T) {
	for _, c := range append(fourierCorpus(t), outlineCorpus()...) {
		src, err := admit(c.loop)
		if err != nil {
			continue
		}
		var x, y []float64
		if src.adm.Source == "outline" {
			for _, p := range resample(src.poly, 8192) {
				x, y = append(x, real(p)), append(y, imag(p))
			}
		} else {
			x, y = src.equalArc(8192)
		}
		limit := 2 * src.adm.Radius
		if got, want := neck(x, y, limit), neckBelow(x, y, limit); got != want {
			t.Errorf("%s: neck %v, full search %v", c.name, got, want)
		}
	}
}

// A seek retakes the solve's own steps: every state the solve accepted was
// checked for embedding, so a replay must reproduce it. Just before a
// checkpoint, a sample replays from the one before through the recorded
// steps and lands within rounding of the checkpoint's own state; a replay
// that took other steps would differ by their local error.
func TestArclengthSeeksRetakeTheSolvesOwnSteps(t *testing.T) {
	f, err := SolveLoop(LoopRequest{Loop: Loop{Terms: leafTerms(t, 8)}, Horizon: 0.999})
	if err != nil || f.Admission.Solver != "arc" {
		t.Fatalf("%v", err)
	}
	a := f.film.(*arcFilm)
	if a.Stats.Stride < 2 {
		t.Fatalf("stride %d: every step is a checkpoint", a.Stats.Stride)
	}
	n := a.e.n
	R := f.Admission.Radius
	for _, k := range []int{1, len(a.checkpoints) / 2, len(a.checkpoints) - 1} {
		at := real(a.checkpoints[k].u[n+1])
		c, _ := f.Sample(at)
		before, err := f.Sample(math.Nextafter(at, 0))
		if err != nil {
			t.Fatal(err)
		}
		if before.Steps != a.Stats.Stride {
			t.Errorf("checkpoint %d: the seek retook %d steps, not the stride %d", k, before.Steps, a.Stats.Stride)
		}
		e := 0.0
		for i := range c.X {
			e = math.Max(e, math.Hypot(c.X[i]-before.X[i], c.Y[i]-before.Y[i]))
		}
		if e > 1e-12*R {
			t.Errorf("checkpoint %d at t=%g: a replay just before it is %.1e R away", k, at, e/R)
		}
	}
}
