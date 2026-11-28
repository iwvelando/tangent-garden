package threebody

import (
	"fmt"
	"math"
	"os"
	"testing"
	"time"

	"tangentgarden/engine"
)

// TestThreeBodyReport prints the #552 research evidence: each corpus case's
// reference precision, the production method's accuracy and work at
// several tolerances against it, the float64 Taylor candidate, agreement
// horizons, perturbation growth, and the encounter-floor study. Run it with
//
//	THREEBODY_REPORT=1 go test ./engine/threebody -run TestThreeBodyReport -v -timeout 30m
func TestThreeBodyReport(t *testing.T) {
	if os.Getenv("THREEBODY_REPORT") == "" {
		t.Skip("set THREEBODY_REPORT=1 to print the three-body evidence")
	}
	const horizon, n = 100.0, 2001
	times := Times(horizon, n)
	positions := func(p *Prepared, k int) []float64 {
		var y []float64
		for i := 0; i < 3; i++ {
			y = append(y, p.Paths[i].Positions[k].X, p.Paths[i].Positions[k].Y)
		}
		return y
	}
	// first is the first sample time where d exceeds the threshold, or "—".
	first := func(d []float64, th float64) string {
		for k, v := range d {
			if v > th {
				return fmt.Sprintf("%.2f", times[k])
			}
		}
		return "—"
	}

	fmt.Println("### Reference precision (double-double Taylor, order 30 at 10⁻²⁸ against order 36 at 10⁻³¹)")
	fmt.Println()
	fmt.Println("| case | reference steps | time | largest difference over 100 | first beyond 10⁻¹² |")
	fmt.Println("|---|---|---|---|---|")
	refs := map[string][][]float64{}
	for _, c := range Corpus() {
		q := Request{Bodies: c.Bodies}
		start := time.Now()
		a, sa := taylorRun(ddFrom, q.masses(), q.initial(), times, 1e-28, 30)
		el := time.Since(start)
		b, _ := taylorRun(ddFrom, q.masses(), q.initial(), times, 1e-31, 36)
		d := make([]float64, n)
		worst := 0.0
		ref := make([][]float64, n)
		for k := range times {
			for qq := 0; qq < 6; qq++ {
				d[k] = math.Max(d[k], math.Abs(a[k][qq].Sub(b[k][qq]).Float()))
			}
			worst = math.Max(worst, d[k])
			ref[k] = floats(a[k])
		}
		refs[c.Name] = ref
		fmt.Printf("| %s | %d | %v | %.1e | %s |\n", c.Name, sa.steps, el.Round(time.Millisecond), worst, first(d, 1e-12))
	}

	fmt.Println()
	fmt.Println("### Production candidates against the reference, positions over 100 time units (floor 10⁻⁶ here, so no encounter stops a case)")
	fmt.Println()
	fmt.Println("| case | method | terminal | accepted | rejected | native time | largest error | first beyond 10⁻⁶ | first beyond 10⁻³ | energy error | closest |")
	fmt.Println("|---|---|---|---|---|---|---|---|---|---|---|")
	for _, c := range Corpus() {
		ref := refs[c.Name]
		for _, tol := range []float64{1e-9, 1e-10, 1e-11, 1e-12, 1e-13} {
			set := DefaultSettings()
			set.Tolerance, set.Floor, set.DriftBudget = tol, 1e-6, 0
			q := Request{Bodies: c.Bodies, Duration: horizon, Samples: n}
			start := time.Now()
			h, _ := q.integrate(set)
			el := time.Since(start)
			p, _ := h.Sample(n)
			d := make([]float64, n)
			worst := 0.0
			for k := 0; k < p.Available; k++ {
				d[k] = maxDiff(positions(p, k), ref[k], 0, 6)
				worst = math.Max(worst, d[k])
			}
			fmt.Printf("| %s | DP 5(4), %.0e | %s at %.2f | %d | %d | %v | %.1e | %s | %s | %.1e | %.2e |\n",
				c.Name, tol, h.Terminal.Reason, h.End, h.Accepted, h.Rejected, el.Round(time.Millisecond), worst,
				first(d[:p.Available], 1e-6), first(d[:p.Available], 1e-3), p.Diagnostics.EnergyError, p.Diagnostics.Closest)
		}
		q := Request{Bodies: c.Bodies}
		for _, o := range []struct {
			tol   float64
			order int
		}{{1e-12, 16}, {1e-14, 20}, {1e-16, 24}} {
			start := time.Now()
			r, s := taylorRun(fromFloat, q.masses(), q.initial(), times, o.tol, o.order)
			el := time.Since(start)
			d := make([]float64, n)
			worst := 0.0
			for k := range times {
				d[k] = maxDiff(floats(r[k]), ref[k], 0, 6)
				worst = math.Max(worst, d[k])
			}
			fmt.Printf("| %s | Taylor float64, order %d, %.0e | end | %d | 0 | %v | %.1e | %s | %s | | |\n",
				c.Name, o.order, o.tol, s.steps, el.Round(time.Millisecond), worst, first(d, 1e-6), first(d, 1e-3))
		}
	}

	fmt.Println()
	fmt.Println("### Growth of a 10⁻⁸ displacement of body 3 (production settings), at t = 0, 10, …, 100")
	fmt.Println()
	for _, c := range Corpus() {
		a := Request{Bodies: c.Bodies, Duration: horizon, Samples: 11}
		b := a
		b.Bodies = append([]Body{}, c.Bodies...)
		b.Bodies[2].Position = b.Bodies[2].Position.Add(engine.Vec{X: 1e-8})
		pa, _ := a.Prepare()
		pb, _ := b.Prepare()
		line := ""
		for k := 0; k < pa.Available && k < pb.Available; k++ {
			line += fmt.Sprintf(" %.1e", deviation(pa, pb, k))
		}
		fmt.Printf("- %s (%s, %s):%s\n", c.Name, pa.Terminal.Reason, pb.Terminal.Reason, line)
	}

	fmt.Println()
	fmt.Println("### Encounter floor: one pericenter of bodies 1 and 2 (0.45 each), body 3 (0.1) at distance 8, floor a tenth of the pericenter")
	fmt.Println()
	fmt.Println("| pericenter | terminal | accepted | energy error | angular momentum error |")
	fmt.Println("|---|---|---|---|---|")
	for _, peri := range []float64{1e-2, 1e-3, 1e-4, 1e-5, 1e-6} {
		k := kepler{m1: 0.45, m2: 0.45, a: 1, e: 1 - peri}
		k.tp = k.period() / 2
		y2 := k.at(0)
		y := []float64{y2[0], y2[1], y2[2], y2[3], 0, 8, y2[4], y2[5], y2[6], y2[7], 0, 0}
		set := DefaultSettings()
		set.Floor, set.DriftBudget = peri/10, 0
		h := integrate(newSystem([]float64{0.45, 0.45, 0.1}), 0, y, k.period(), set)
		p, _ := h.Sample(1000)
		fmt.Printf("| %.0e | %s (%s) at %.3f | %d | %.1e | %.1e |\n", peri, h.Terminal.Reason, h.Terminal.Check, h.End, h.Accepted, p.Diagnostics.EnergyError, p.Diagnostics.AngularError)
	}

	fmt.Println()
	fmt.Println("### Production histories of the corpus studies (default settings, 20,000 samples)")
	fmt.Println()
	fmt.Println("| case | duration | terminal | attempts | native time | energy | momentum | angular momentum | center | retained |")
	fmt.Println("|---|---|---|---|---|---|---|---|---|---|")
	for _, c := range Corpus() {
		for _, dur := range []float64{c.Duration, horizon} {
			start := time.Now()
			p, err := Request{Bodies: c.Bodies, Duration: dur, Samples: maxSamples}.Prepare()
			el := time.Since(start)
			if err != nil {
				fmt.Printf("| %s | %.2f | %v |\n", c.Name, dur, err)
				continue
			}
			d := p.Diagnostics
			fmt.Printf("| %s | %.2f | %s at %.2f | %d | %v | %.1e | %.1e | %.1e | %.1e | %.1f MiB |\n", c.Name, dur, p.Terminal.Reason, p.Final.Time, p.Attempts,
				el.Round(time.Millisecond), d.EnergyError, d.MomentumError, d.AngularError, d.CenterError, float64(d.RetainedBytes)/(1<<20))
		}
	}

	// The largest admitted work: the attempt budget spent.
	set := DefaultSettings()
	set.Tolerance = 1e-13
	start := time.Now()
	h, _ := Request{Bodies: caseNamed("pythagorean").Bodies, Duration: horizon, Samples: maxSamples}.integrate(set)
	el := time.Since(start)
	p, _ := h.Sample(maxSamples)
	fmt.Printf("\nAttempt budget spent (Burrau's problem at 10⁻¹³): %s after %d attempts in %v; %.1f MiB retained.\n", h.Terminal.Reason, h.Attempts, el.Round(time.Millisecond), float64(p.Diagnostics.RetainedBytes)/(1<<20))
}
