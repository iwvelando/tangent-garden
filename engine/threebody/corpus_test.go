package threebody

import (
	"math"
	"testing"

	"tangentgarden/engine"
)

func bodyState(bs []Body) []float64 { return Request{Bodies: bs}.initial() }

func TestCorpusIsInFixtureUnits(t *testing.T) {
	for _, c := range Corpus() {
		if err := (Request{Bodies: c.Bodies, Duration: c.Duration, Samples: 2}).Validate(); err != nil {
			t.Errorf("%s: %v", c.Name, err)
			continue
		}
		s := newSystem(Request{Bodies: c.Bodies}.masses())
		y := bodyState(c.Bodies)
		center, far := s.center(y), 0.0
		for i := range c.Bodies {
			far = math.Max(far, math.Hypot(y[2*i]-center[0], y[2*i+1]-center[1]))
		}
		near(t, c.Name+" farthest body", far, 1, 1e-6)
		if c.Periodicity == "" || c.Stability == "" || c.Source == "" {
			t.Errorf("%s is not classified and sourced", c.Name)
		}
	}
}

// The fixture transformation is a symmetry of Newton's equations: the
// published figure-eight (masses 1) at time t is λ times the fixture at
// t·√(M/λ³).
func TestNormalizationIsCovariant(t *testing.T) {
	c := caseNamed("figure-eight")
	r1 := [2]float64{-0.97000436, 0.24308753}
	v3 := [2]float64{0.93240737, 0.86473146}
	v1 := [2]float64{-v3[0] / 2, -v3[1] / 2}
	published := state([][2]float64{r1, {-r1[0], -r1[1]}, {0, 0}}, [][2]float64{v1, v1, v3})
	hp := integrate(newSystem([]float64{1, 1, 1}), 0, published, 5, DefaultSettings())
	hf := integrate(newSystem(Request{Bodies: c.Bodies}.masses()), 0, bodyState(c.Bodies), 5*c.TimeFactor, DefaultSettings())
	for _, at := range []float64{0, 1.3, 2.9, 5} {
		p, _ := hp.State(at)
		f, _ := hf.State(at * c.TimeFactor)
		for q := 0; q < 6; q++ {
			near(t, "position", f[q]*c.Length, p[q], 1e-9)
			near(t, "velocity", f[6+q]/math.Sqrt(c.Length/3), p[6+q], 1e-9)
		}
	}
	near(t, "period", c.Period, 6.32591398*math.Sqrt(3), 1e-6)
}

// period finds the labeled return nearest the published period: the time
// minimizing the largest position difference from the start.
func period(h *History, y0 []float64, guess float64) float64 {
	f := func(at float64) float64 {
		y, _ := h.State(at)
		return maxDiff(y, y0, 0, 6)
	}
	lo, hi := guess-0.01, guess+0.01
	for i := 0; i < 200; i++ {
		a, b := lo+(hi-lo)*0.382, lo+(hi-lo)*0.618
		if f(a) < f(b) {
			hi = b
		} else {
			lo = a
		}
	}
	return (lo + hi) / 2
}

// relabel puts body s[i]'s state in place of body i's.
func relabel(y []float64, s [3]int) []float64 {
	o := make([]float64, 12)
	for i := 0; i < 3; i++ {
		o[2*i], o[2*i+1] = y[2*s[i]], y[2*s[i]+1]
		o[6+2*i], o[7+2*i] = y[6+2*s[i]], y[7+2*s[i]]
	}
	return o
}

// Full-period closure is a return of every labeled position and velocity.
// A third of a period only permutes the bodies.
func TestFigureEightClosesOnLabeledStates(t *testing.T) {
	c := caseNamed("figure-eight")
	set := DefaultSettings()
	set.Tolerance = 1e-13
	y0 := bodyState(c.Bodies)
	h := integrate(newSystem(Request{Bodies: c.Bodies}.masses()), 0, y0, 100, set)
	T := period(h, y0, c.Period)
	// The printed data have 8 digits: the measured period of these data,
	// 6.32591401 in published units, is 3·10⁻⁸ from the printed 6.32591398.
	near(t, "published period", T/c.TimeFactor, 6.32591398, 1e-7)
	y, _ := h.State(T)
	if p, v := maxDiff(y, y0, 0, 6), maxDiff(y, y0, 6, 12); p > 2e-9 || v > 2e-9 {
		t.Errorf("one period: positions return within %.3g, velocities %.3g (measured 5.4·10⁻¹⁰, 5.1·10⁻¹⁰)", p, v)
	}
	y, _ = h.State(8 * T)
	if p := maxDiff(y, y0, 0, 12); p > 3e-8 {
		t.Errorf("eight periods: return within %.3g (measured 6.8·10⁻⁹)", p)
	}
	third, _ := h.State(T / 3)
	if d := maxDiff(third, y0, 0, 12); d < 0.5 {
		t.Errorf("a third of a period returns within %g: that would be closure", d)
	}
	if d := maxDiff(relabel(third, [3]int{1, 2, 0}), y0, 0, 12); d > 1e-7 {
		t.Errorf("a third of a period is not the cyclic relabeling: %.3g", d)
	}
}

// deviation is the largest position difference between two requests'
// samples, up to the shorter's end.
func deviation(a, b *Prepared, k int) float64 {
	d := 0.0
	for i := range a.Paths {
		d = math.Max(d, a.Paths[i].Positions[k].Sub(b.Paths[i].Positions[k]).Norm())
	}
	return d
}

// Stability is separate from sensitivity: a 10⁻⁸ displacement of a stable
// orbit only drifts in phase, growing about linearly, while the unstable
// triangle amplifies it exponentially.
func TestPerturbationsDistinguishStability(t *testing.T) {
	grow := func(name string) []float64 {
		c := caseNamed(name)
		a := Request{Bodies: c.Bodies, Duration: 100, Samples: 11}
		b := a
		b.Bodies = append([]Body{}, c.Bodies...)
		b.Bodies[2].Position = b.Bodies[2].Position.Add(engine.Vec{X: 1e-8})
		pa, _ := a.Prepare()
		pb, _ := b.Prepare()
		var out []float64
		for k := 0; k < 11; k++ {
			out = append(out, deviation(pa, pb, k))
		}
		return out
	}
	// Measured at t = 100: 1.4·10⁻⁶, 2.7·10⁻⁷ and 1.7·10⁻⁶.
	for _, name := range []string{"figure-eight", "lagrange-routh", "hierarchical"} {
		g := grow(name)
		if g[10] > 1e-5 || g[10] > 4*g[5] {
			t.Errorf("%s: a 10⁻⁸ displacement grew to %.3g at t = 50 and %.3g at 100", name, g[5], g[10])
		}
	}
	// Measured: 8.2·10⁻⁸ at t = 10, 9.1·10⁻³ at 50: an e-folding time of
	// about 3.4.
	g := grow("lagrange-equal")
	if g[5] < 1e3*g[1] {
		t.Errorf("the equal-mass triangle grew a displacement only from %.3g to %.3g", g[1], g[5])
	}
}

// The equal-mass triangle is periodic and linearly unstable: it holds its
// rigid rotation for its two-period study, then rounding alone breaks it
// before t = 100. The Routh-stable triangle holds throughout.
func TestLagrangeTrianglesRotateRigidly(t *testing.T) {
	rigid := func(c Case, at float64) []float64 {
		omega := 2 * math.Pi / c.Period
		cs, sn := math.Cos(omega*at), math.Sin(omega*at)
		y := bodyState(c.Bodies)
		for i := 0; i < 6; i += 2 {
			y[i], y[i+1] = cs*y[i]-sn*y[i+1], sn*y[i]+cs*y[i+1]
			y[6+i], y[7+i] = cs*y[6+i]-sn*y[7+i], sn*y[6+i]+cs*y[7+i]
		}
		return y
	}
	worst := func(c Case, dur float64) float64 {
		h, _ := Request{Bodies: c.Bodies, Duration: dur, Samples: 2}.Integrate()
		w := 0.0
		for i := 0; i <= 400; i++ {
			at := dur * float64(i) / 400
			y, _ := h.State(at)
			w = math.Max(w, maxDiff(y, rigid(c, at), 0, 6))
		}
		return w
	}
	equal := caseNamed("lagrange-equal")
	if w := worst(equal, equal.Duration); w > 1e-8 {
		t.Errorf("equal masses leave the rigid rotation by %.3g within two periods", w)
	}
	if w := worst(equal, 100); w < 1e-3 {
		t.Errorf("equal masses held the rigid rotation to %.3g for 100: no instability observed", w)
	}
	if w := worst(caseNamed("lagrange-routh"), 100); w > 1e-7 {
		t.Errorf("the Routh-stable triangle leaves the rigid rotation by %.3g", w)
	}
}

func TestHierarchicalTripleStaysRegular(t *testing.T) {
	c := caseNamed("hierarchical")
	p, err := Request{Bodies: c.Bodies, Duration: 100, Samples: 2001}.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	if p.Terminal.Reason != "end" || p.Diagnostics.EnergyError > 1e-8 {
		t.Fatalf("terminal %+v, energy error %.3g", p.Terminal, p.Diagnostics.EnergyError)
	}
	lo, hi := math.Inf(1), 0.0
	for k := 0; k < p.Available; k++ {
		d := p.Paths[1].Positions[k].Sub(p.Paths[0].Positions[k]).Norm()
		lo, hi = math.Min(lo, d), math.Max(hi, d)
	}
	// The inner binary stays near its separation of 0.2 (measured 0.199
	// to 0.21), perturbed by the third body.
	if lo < 0.18 || hi > 0.23 {
		t.Errorf("inner separation ranged %.3f–%.3f", lo, hi)
	}
}

// Burrau's problem against the double-double reference: the production
// history agrees until its close approaches near t = 25 have amplified the
// differences, and ends as published, with the lightest body ejected.
func TestPythagoreanAgainstTheReference(t *testing.T) {
	if testing.Short() {
		t.Skip("the reference takes about a second")
	}
	c := caseNamed("pythagorean")
	times := Times(100, 2001)
	q := Request{Bodies: c.Bodies, Duration: 100, Samples: len(times)}
	ref, _ := taylorRun(ddFrom, q.masses(), q.initial(), times, 1e-28, 30)
	p, err := q.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	if p.Terminal.Reason != "end" {
		t.Fatalf("terminal %+v", p.Terminal)
	}
	horizon := 100.0
	for k := 0; k < p.Available; k++ {
		d := 0.0
		for i := 0; i < 3; i++ {
			d = math.Max(d, p.Paths[i].Positions[k].Sub(engine.Vec{X: ref[k][2*i].Float(), Y: ref[k][2*i+1].Float()}).Norm())
		}
		if d > 1e-6 {
			horizon = times[k]
			break
		}
	}
	// Measured 28.1 at 10⁻⁶ (37.3 at 10⁻³).
	if horizon < 25 {
		t.Errorf("agreement within 10⁻⁶ only until %g", horizon)
	}
	// Bodies 2 and 3 (masses 4 and 5) end bound; body 1 (mass 3) recedes.
	s := newSystem(q.masses())
	y := q.initial()
	for i := 0; i < 3; i++ {
		y[2*i], y[2*i+1] = p.Final.Positions[i].X, p.Final.Positions[i].Y
		y[6+2*i], y[7+2*i] = p.Final.Velocities[i].X, p.Final.Velocities[i].Y
	}
	if d, pair := s.closest(y); pair != 2 || d > 1 {
		t.Errorf("closest pair %d at %g, want bodies 2 and 3 bound", pair, d)
	}
	if r := p.Final.Positions[0].Norm(); r < 30 {
		t.Errorf("body 1 is only %g from the center", r)
	}
}

func transform(bs []Body, f, g func(engine.Vec) engine.Vec) []Body {
	out := make([]Body, len(bs))
	for i, b := range bs {
		out[i] = Body{Mass: b.Mass, Position: f(b.Position), Velocity: g(b.Velocity)}
	}
	return out
}

// Rotation, translation with a Galilean boost, and scaling by λ (time by
// λ^(3/2), velocity by λ^(−1/2)) carry the returned paths with them.
func TestPathsAreCovariant(t *testing.T) {
	for _, name := range []string{"figure-eight", "hierarchical"} {
		c := caseNamed(name)
		const dur, n = 20.0, 201
		base, _ := Request{Bodies: c.Bodies, Duration: dur, Samples: n}.Prepare()
		cs, sn := math.Cos(0.7), math.Sin(0.7)
		rot := func(v engine.Vec) engine.Vec { return engine.Vec{X: cs*v.X - sn*v.Y, Y: sn*v.X + cs*v.Y} }
		shift, w := engine.Vec{X: 3, Y: -2}, engine.Vec{X: 0.05, Y: -0.03}
		L := 2.0
		pr, _ := Request{Bodies: transform(c.Bodies, rot, rot), Duration: dur, Samples: n}.Prepare()
		pt, _ := Request{Bodies: transform(c.Bodies,
			func(v engine.Vec) engine.Vec { return v.Add(shift) },
			func(v engine.Vec) engine.Vec { return v.Add(w) }), Duration: dur, Samples: n}.Prepare()
		ps, _ := Request{Bodies: transform(c.Bodies,
			func(v engine.Vec) engine.Vec { return v.Mul(L) },
			func(v engine.Vec) engine.Vec { return v.Mul(1 / math.Sqrt(L)) }), Duration: dur * math.Pow(L, 1.5), Samples: n}.Prepare()
		er, et, es := 0.0, 0.0, 0.0
		for k := 0; k < n; k++ {
			for i := 0; i < 3; i++ {
				p := base.Paths[i].Positions[k]
				er = math.Max(er, rot(p).Sub(pr.Paths[i].Positions[k]).Norm())
				et = math.Max(et, p.Add(shift).Add(w.Mul(base.Times[k])).Sub(pt.Paths[i].Positions[k]).Norm())
				es = math.Max(es, p.Mul(L).Sub(ps.Paths[i].Positions[k]).Norm()/L)
			}
		}
		// Measured at most 1.3·10⁻⁹; each history keeps its own adaptive
		// steps, so agreement is at the integration's accuracy.
		if er > 1e-8 || et > 1e-8 || es > 1e-8 {
			t.Errorf("%s: rotation %.3g, translation and boost %.3g, scaling %.3g", name, er, et, es)
		}
	}
}

// Reversing the final velocities retraces a regular history to its start,
// positions and (negated) velocities.
func TestReverseTimeReturns(t *testing.T) {
	for _, c := range []struct {
		name string
		dur  float64
		max  float64
	}{
		// Positions measured within 9.2·10⁻⁹, 2.1·10⁻⁷, 7.4·10⁻⁹ and,
		// before its close approaches, 3.8·10⁻⁹ for Burrau's problem; the
		// hierarchical inner binary's velocities, turning ten times as
		// fast, within 2·10⁻⁶.
		{"figure-eight", 100, 5e-8},
		{"hierarchical", 100, 5e-6},
		{"lagrange-routh", 100, 5e-8},
		{"pythagorean", 20, 2e-8},
	} {
		k := caseNamed(c.name)
		p, _ := Request{Bodies: k.Bodies, Duration: c.dur, Samples: 2}.Prepare()
		back := make([]Body, 3)
		for i := range back {
			back[i] = Body{Mass: k.Bodies[i].Mass, Position: p.Final.Positions[i], Velocity: p.Final.Velocities[i].Mul(-1)}
		}
		r, err := Request{Bodies: back, Duration: c.dur, Samples: 2}.Prepare()
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		d := 0.0
		for i := 0; i < 3; i++ {
			d = math.Max(d, r.Final.Positions[i].Sub(k.Bodies[i].Position).Norm())
			d = math.Max(d, r.Final.Velocities[i].Add(k.Bodies[i].Velocity).Norm())
		}
		if d > c.max {
			t.Errorf("%s: returns within %.3g after %g", c.name, d, c.dur)
		}
	}
}
