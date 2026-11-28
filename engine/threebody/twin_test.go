package threebody

import (
	"errors"
	"math"
	"reflect"
	"testing"

	"tangentgarden/engine"
)

// component is the value a twin names, read independently of Apply.
func component(b Body, kind, axis string) float64 {
	v := b.Position
	if kind == "velocity" {
		v = b.Velocity
	}
	if axis == "y" {
		return v.Y
	}
	return v.X
}

// The twin moves exactly the declared component by its size and nothing
// else; keeping the center of mass and momentum moves the other two bodies
// together by −mᵢ·size/(mⱼ + mₖ) along the same component, and nothing else.
func TestTwinMovesTheDeclaredComponent(t *testing.T) {
	base := caseNamed("pythagorean").Bodies
	for body := 0; body < 3; body++ {
		for _, kind := range []string{"position", "velocity"} {
			for _, axis := range []string{"x", "y"} {
				for _, conserve := range []bool{false, true} {
					w := Twin{Body: body, Kind: kind, Axis: axis, Size: 3e-4, Conserve: conserve}
					got := w.Apply(base)
					others := 0.0
					for j := range base {
						if j != body {
							others += base[j].Mass
						}
					}
					for j := range base {
						if got[j].Mass != base[j].Mass {
							t.Errorf("%+v moved mass %d", w, j)
						}
						for _, k := range []string{"position", "velocity"} {
							for _, a := range []string{"x", "y"} {
								want := component(base[j], k, a)
								if k == kind && a == axis {
									if j == body {
										want += 3e-4
									} else if conserve {
										want -= base[body].Mass * 3e-4 / others
									}
								}
								if g := component(got[j], k, a); g != want {
									t.Errorf("%+v: body %d %s %s is %.17g, want %.17g", w, j+1, k, a, g, want)
								}
							}
						}
					}
					if conserve {
						s := newSystem(Request{Bodies: base}.masses())
						y0, y1 := bodyState(base), bodyState(got)
						c0, c1 := s.center(y0), s.center(y1)
						p0, p1 := s.momentum(y0), s.momentum(y1)
						if math.Hypot(c1[0]-c0[0], c1[1]-c0[1]) > 1e-16 || math.Hypot(p1[0]-p0[0], p1[1]-p0[1]) > 1e-16 {
							t.Errorf("%+v moved the center of mass or the momentum", w)
						}
					}
				}
			}
		}
	}
	// The reference state is left as it was.
	if !reflect.DeepEqual(base, caseNamed("pythagorean").Bodies) {
		t.Error("Apply changed the reference state")
	}
}

func TestTwinRefusalsNameTheirField(t *testing.T) {
	good := PairRequest{Request: figureEight(10, 100), Twin: Twin{Body: 0, Kind: "velocity", Axis: "x", Size: 0.01}}
	edit := func(f func(*PairRequest)) PairRequest {
		q := good
		q.Request.Bodies = append([]Body{}, good.Request.Bodies...)
		f(&q)
		return q
	}
	for _, c := range []struct {
		name, field string
		q           PairRequest
	}{
		{"fourth body", "twin.body", edit(func(q *PairRequest) { q.Twin.Body = 3 })},
		{"negative body", "twin.body", edit(func(q *PairRequest) { q.Twin.Body = -1 })},
		{"spin", "twin.kind", edit(func(q *PairRequest) { q.Twin.Kind = "spin" })},
		{"z", "twin.axis", edit(func(q *PairRequest) { q.Twin.Axis = "z" })},
		{"NaN", "twin.size", edit(func(q *PairRequest) { q.Twin.Size = math.NaN() })},
		{"large", "twin.size", edit(func(q *PairRequest) { q.Twin.Size = 0.1000001 })},
		{"large negative", "twin.size", edit(func(q *PairRequest) { q.Twin.Size = -0.2 })},
		// A twin outside the admission limits is refused on its size.
		{"twin out of range", "twin.size", edit(func(q *PairRequest) {
			q.Request.Bodies[0].Position.X = 9.95
			q.Twin = Twin{Body: 0, Kind: "position", Axis: "x", Size: 0.1}
		})},
		{"twin too close", "twin.size", edit(func(q *PairRequest) {
			q.Request.Bodies[1].Position = q.Request.Bodies[0].Position.Add(engine.Vec{X: 0.011})
			q.Twin = Twin{Body: 1, Kind: "position", Axis: "x", Size: -0.002}
		})},
		// The reference's own refusals keep their paths.
		{"reference mass", "bodies.1.mass", edit(func(q *PairRequest) { q.Request.Bodies[1].Mass = 5e-4 })},
		{"reference duration", "duration", edit(func(q *PairRequest) { q.Request.Duration = 0 })},
	} {
		_, err := c.q.Prepare()
		var named *engine.FieldError
		if !errors.As(err, &named) || named.Field != c.field {
			t.Errorf("%s: %v, want a refusal of %s", c.name, err, c.field)
		}
	}
	for _, size := range []float64{0, 0.1, -0.1} {
		q := edit(func(q *PairRequest) { q.Twin.Size = size })
		if _, err := q.Prepare(); err != nil {
			t.Errorf("size %g was refused: %v", size, err)
		}
	}
}

// The pair's reference is the single history bit for bit, and a zero twin
// is the reference bit for bit, so the comparison is exactly zero.
func TestZeroTwinIsTheReference(t *testing.T) {
	q := Request{Bodies: caseNamed("pythagorean").Bodies, Duration: 30, Samples: 3001}
	single, err := q.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	for _, conserve := range []bool{false, true} {
		for _, kind := range []string{"position", "velocity"} {
			p, err := PairRequest{Request: q, Twin: Twin{Body: 1, Kind: kind, Axis: "y", Conserve: conserve}}.Prepare()
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(p.Reference, single) {
				t.Error("the pair's reference differs from the single history")
			}
			if !reflect.DeepEqual(p.Twin, single) || !reflect.DeepEqual(p.Bodies, q.Bodies) {
				t.Errorf("a zero %s twin (conserve %v) differs from the reference", kind, conserve)
			}
			c := p.Comparison
			if c.Common != single.Available || c.Largest != 0 || len(c.Separation) != c.Common {
				t.Errorf("comparison %d samples, largest %g", c.Common, c.Largest)
			}
			for k := range c.Separation {
				if c.Separation[k] != 0 || c.SpeedSeparation[k] != 0 {
					t.Fatalf("sample %d separated by %g", k, c.Separation[k])
				}
			}
			for _, x := range c.Crossings {
				if x.Reached {
					t.Errorf("a zero twin crossed %g", x.Threshold)
				}
			}
		}
	}
}

// The separation is the farthest any body is from its own twin, in raw
// coordinates; its summary is read from the same samples.
func TestComparisonIsTheLabeledSeparation(t *testing.T) {
	q := PairRequest{Request: Request{Bodies: caseNamed("pythagorean").Bodies, Duration: 30, Samples: 3001},
		Twin: Twin{Body: 0, Kind: "position", Axis: "x", Size: 1e-4}}
	p, err := q.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	c := p.Comparison
	if c.Common != 3001 || c.End != 30 || len(c.Separation) != 3001 || len(c.SpeedSeparation) != 3001 {
		t.Fatalf("comparison %d samples to %g", c.Common, c.End)
	}
	largest, at := 0.0, 0.0
	first := map[float64]float64{}
	for k := 0; k < c.Common; k++ {
		d, v := 0.0, 0.0
		for i := 0; i < 3; i++ {
			d = math.Max(d, p.Twin.Paths[i].Positions[k].Sub(p.Reference.Paths[i].Positions[k]).Norm())
			v = math.Max(v, p.Twin.Paths[i].Velocities[k].Sub(p.Reference.Paths[i].Velocities[k]).Norm())
		}
		if c.Separation[k] != d || c.SpeedSeparation[k] != v {
			t.Fatalf("sample %d: separation %g, want %g", k, c.Separation[k], d)
		}
		if d > largest {
			largest, at = d, p.Reference.Times[k]
		}
		for _, th := range []float64{1e-3, 1e-1} {
			if _, ok := first[th]; !ok && d >= th {
				first[th] = p.Reference.Times[k]
			}
		}
	}
	// (x + 10⁻⁴) − x is 10⁻⁴ within the rounding of x.
	near(t, "initial separation", c.Separation[0], 1e-4, 1e-15)
	if c.Largest != largest || c.LargestTime != at {
		t.Errorf("largest %g at %g, want %g at %g", c.Largest, c.LargestTime, largest, at)
	}
	if len(c.Crossings) != 2 {
		t.Fatalf("crossings %+v", c.Crossings)
	}
	for _, x := range c.Crossings {
		want, ok := first[x.Threshold]
		if x.Reached != ok || (ok && x.Time != want) {
			t.Errorf("crossing %+v, want %v at %g", x, ok, want)
		}
	}
	if !c.Crossings[0].Reached {
		t.Error("Burrau's twin stayed within 10⁻³ through t = 30")
	}
	// The record holds the twin's own starting state, as integrated.
	if p.Bodies[0].Position.X != q.Request.Bodies[0].Position.X+1e-4 {
		t.Errorf("twin starts at %v", p.Bodies[0].Position)
	}
	if p.Comparison.RetainedBytes != p.Reference.Diagnostics.RetainedBytes+p.Twin.Diagnostics.RetainedBytes+2*c.Common*8 {
		t.Errorf("joint retained bytes %d", p.Comparison.RetainedBytes)
	}
}

// When one history stops first the comparison ends at its last sample and
// nothing is extrapolated to match the other.
func TestComparisonEndsWithTheEarlierHistory(t *testing.T) {
	q := PairRequest{Request: Request{Bodies: caseNamed("pythagorean").Bodies, Duration: 43, Samples: 4301},
		Twin: Twin{Body: 0, Kind: "position", Axis: "x", Size: 0.01}}
	p, err := q.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	if p.Twin.Terminal.Reason != "encounter" || p.Reference.Terminal.Reason != "end" {
		t.Fatalf("terminals %+v and %+v", p.Reference.Terminal, p.Twin.Terminal)
	}
	c := p.Comparison
	if c.Common != p.Twin.Available || len(c.Separation) != c.Common || c.End != p.Twin.Times[c.Common-1] {
		t.Errorf("compared %d samples to %g; the twin has %d and stops at %g", c.Common, c.End, p.Twin.Available, p.Twin.Final.Time)
	}
	if c.End > p.Twin.Final.Time {
		t.Errorf("the comparison runs past the twin's end")
	}
	// And the other way round.
	r := PairRequest{Request: q.Request, Twin: q.Twin}
	r.Request.Bodies = p.Bodies
	r.Twin.Size = -0.01
	back, err := r.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	if back.Reference.Terminal.Reason != "encounter" || back.Comparison.Common != back.Reference.Available {
		t.Errorf("reversed: reference %+v, compared %d", back.Reference.Terminal, back.Comparison.Common)
	}
}

// The pair's budget covers both histories and the comparison together.
func TestPairBudgetIsJoint(t *testing.T) {
	q := PairRequest{Request: figureEight(30, 20000), Twin: Twin{Body: 2, Kind: "velocity", Axis: "y", Size: 0.01}}
	p, err := q.prepare(maxRetained)
	if err != nil {
		t.Fatal(err)
	}
	joint := p.Comparison.RetainedBytes
	if joint <= p.Reference.Diagnostics.RetainedBytes || joint <= p.Twin.Diagnostics.RetainedBytes {
		t.Fatalf("joint bytes %d", joint)
	}
	if _, err := q.prepare(joint); err != nil {
		t.Errorf("refused at its own size: %v", err)
	}
	if _, err := q.prepare(joint - 1); err == nil {
		t.Error("admitted above the joint budget")
	}
}

// twinAgainstReference runs the pair and both starting states through the
// double-double reference on 2,001 of the plan's times. It returns the
// pair (on that plan), the reference separation at each time, the time
// until which both histories stay within 10⁻⁶ of their references, and
// each reference's final positions.
func twinAgainstReference(t *testing.T, name string, w Twin) (*Pair, []float64, float64, [2][]engine.Vec) {
	t.Helper()
	c := caseNamed(name)
	q := PairRequest{Request: Request{Bodies: c.Bodies, Duration: c.Duration, Samples: 2001}, Twin: w}
	p, err := q.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	other := q.Request
	other.Bodies = p.Bodies
	a, _ := taylorRun(ddFrom, q.Request.masses(), q.Request.initial(), p.Reference.Times, 1e-28, 30)
	b, _ := taylorRun(ddFrom, other.masses(), other.initial(), p.Reference.Times, 1e-28, 30)
	at := func(y []dd, i int) engine.Vec { return engine.Vec{X: y[2*i].Float(), Y: y[2*i+1].Float()} }
	truth := make([]float64, p.Comparison.Common)
	accurate := c.Duration
	for k := range truth {
		e := 0.0
		for i := 0; i < 3; i++ {
			truth[k] = math.Max(truth[k], at(b[k], i).Sub(at(a[k], i)).Norm())
			e = math.Max(e, math.Max(p.Reference.Paths[i].Positions[k].Sub(at(a[k], i)).Norm(), p.Twin.Paths[i].Positions[k].Sub(at(b[k], i)).Norm()))
		}
		if e > 1e-6 && accurate == c.Duration {
			accurate = p.Reference.Times[k]
		}
	}
	var finals [2][]engine.Vec
	for i := 0; i < 3; i++ {
		finals[0] = append(finals[0], at(a[len(a)-1], i))
		finals[1] = append(finals[1], at(b[len(b)-1], i))
	}
	return p, truth, accurate, finals
}

// The examples' twins (web/threebody/configurations.ts). The figure-eight's
// stays a neighbor: its separation grows about linearly, as the reference's
// does. Burrau's parts while both histories are still within 10⁻⁶ of the
// reference, so the divergence is the perturbation's and not rounding, and
// the reference confirms that the twin throws body 1 out the opposite way.
func TestExampleTwinsAgainstTheReference(t *testing.T) {
	if testing.Short() {
		t.Skip("the reference takes a few seconds")
	}
	p, truth, accurate, _ := twinAgainstReference(t, "figure-eight", Twin{Body: 0, Kind: "velocity", Axis: "x", Size: 0.01, Conserve: true})
	if accurate < p.Reference.Times[len(p.Reference.Times)-1] {
		t.Errorf("figure-eight pair within 10⁻⁶ of the reference only until %g", accurate)
	}
	for k := range truth {
		near(t, "figure-eight separation", p.Comparison.Separation[k], truth[k], 1e-8)
	}
	// Measured: 0.17 at t = 10.96 (one period), 0.46 at most over three.
	third := (len(truth) - 1) / 3
	if s := p.Comparison.Separation; s[3*third] > 4.5*s[third] || p.Comparison.Largest > 0.6 {
		t.Errorf("figure-eight twin separated %g after a period and %g after three", s[third], s[3*third])
	}

	p, truth, accurate, finals := twinAgainstReference(t, "pythagorean", Twin{Body: 0, Kind: "position", Axis: "x", Size: 1e-4})
	// Measured: both within 10⁻⁶ until 24.7 natively on arm64, 23.1 on
	// amd64 without FMA and 23.05 in WASM; the separation passes 10⁻³ at
	// 17.1 on each.
	if accurate < 20 {
		t.Errorf("Burrau pair within 10⁻⁶ of the reference only until %g", accurate)
	}
	cross := p.Comparison.Crossings[0]
	if !cross.Reached || cross.Time > accurate-2 || cross.Time < 15 {
		t.Errorf("the twins pass 10⁻³ apart at %+v; the pair is accurate until %g", cross, accurate)
	}
	for k, at := range p.Reference.Times[:p.Comparison.Common] {
		if at < accurate {
			near(t, "Burrau separation", p.Comparison.Separation[k], truth[k], 2e-6)
		}
	}
	// Body 1 leaves upward in the history and downward in its twin, in the
	// reference as in the integration: 71° and −105°.
	for j, h := range []*Prepared{p.Reference, p.Twin} {
		got, want := h.Final.Positions[0], finals[j][0]
		if math.Abs(math.Atan2(got.Y, got.X)-math.Atan2(want.Y, want.X)) > 0.02 || want.Norm() < 5 {
			t.Errorf("history %d: body 1 ends at %v, the reference at %v", j, got, want)
		}
	}
	if finals[0][0].Y < 3 || finals[1][0].Y > -3 {
		t.Errorf("the reference throws body 1 to %v and its twin to %v", finals[0][0], finals[1][0])
	}
}
