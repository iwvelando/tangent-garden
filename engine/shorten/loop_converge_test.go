package shorten

import (
	"fmt"
	"math"
	"os"
	"strings"
	"testing"
	"time"

	"tangentgarden/engine"
)

// shapeError is the largest distance from a returned vertex to the
// reference curve (the trigonometric interpolant of a fine arclength
// film's vertices), over the reference's equal-area radius at that time:
// the solver's error at its nodes, without its own chords' sag.
func shapeError(ref, c Contour) float64 {
	return curveDistance(ref, c) / math.Sqrt(math.Abs(ref.Area)/math.Pi)
}

type sampler interface {
	Sample(float64) (Contour, error)
	Frames([]float64) (Reply, error)
}

// LOOP_CONVERGE=1 prints #409's refinement matrix.
func TestLoopConvergence(t *testing.T) {
	if os.Getenv("LOOP_CONVERGE") == "" {
		t.Skip("set LOOP_CONVERGE=1")
	}
	wideLimits(t)
	fractions := []float64{0.25, 0.5, 0.75, 0.95}
	type arm struct {
		solver string
		order  int
		nodes  []int
		taus   []float64
		// The base resolution and step the other refinement holds fixed.
		n   int
		tau float64
	}
	arms := []arm{
		{"polar", 0, []int{128, 256, 512, 1024}, []float64{0.01, 0.005, 0.0025, 0.00125}, 1024, 0.0025},
		{"arc", 0, []int{256, 512, 1024, 2048}, []float64{0.04, 0.02, 0.01, 0.005}, 0, 0.01},
		{"bgn", 1, []int{256, 512, 1024, 2048}, []float64{0.01, 0.005, 0.0025, 0.00125}, 2048, 0.0025},
		{"bgn", 2, []int{256, 512, 1024, 2048}, []float64{0.02, 0.01, 0.005, 0.0025}, 2048, 0.0025},
	}
	cases := []corpusCase{
		{"circle, off center", Loop{Terms: circleTerms(1, 3+2i)}},
		{"ellipse 2:1", Loop{Terms: ellipseTerms(2, 1)}},
		{"leaf, 8 terms", Loop{Terms: leafTerms(t, 8)}},
		{"leaf, 16 terms", Loop{Terms: leafTerms(t, 16)}},
		{"near cusp a=0.3", Loop{Terms: nearCusp(0.3)}},
		{"ripple f=16 ε=0.02", Loop{Terms: rippleTerms(16, 0.02)}},
	}
	var b strings.Builder
	for _, c := range cases {
		start := time.Now()
		ref, err := SolveLoop(LoopRequest{Loop: c.loop, Solver: "arc", Nodes: 4096, Tau: 0.0025, Horizon: 0.999})
		if err != nil {
			fmt.Fprintf(&b, "\n%s: no reference: %v\n", c.name, err)
			continue
		}
		rr, _ := ref.Frames(nil)
		T := rr.Extinction
		refs := []Contour{}
		for _, fr := range fractions {
			k, _ := ref.Sample(fr * T)
			refs = append(refs, k)
		}
		fmt.Fprintf(&b, "\n**%s** (reference: arc N=4096, step 0.0025, ends %.4fT %s, %.1fs)\n\n", c.name, rr.End/T, rr.Stop, time.Since(start).Seconds())
		fmt.Fprintln(&b, "| arm | refinement | N | τ | t=0.25T | 0.5T | 0.75T | 0.95T | end | steps | updates | time |")
		fmt.Fprintln(&b, "|---|---|---|---|---|---|---|---|---|---|---|---|")
		for _, a := range arms {
			row := func(kind string, n int, tau float64) {
				start := time.Now()
				f, err := SolveLoop(LoopRequest{Loop: c.loop, Solver: a.solver, Nodes: n, Tau: tau, Horizon: 0.999, Order: a.order})
				name := a.solver
				if a.order != 0 {
					name = fmt.Sprintf("%s%d", a.solver, a.order)
				}
				if err != nil {
					fmt.Fprintf(&b, "| %s | %s | %d | %g | %s |||||||\n", name, kind, n, tau, short(err.Error()))
					return
				}
				r, _ := f.Frames(nil)
				line := fmt.Sprintf("| %s | %s | %d | %g |", name, kind, f.Admission.Nodes, tau)
				for i, fr := range fractions {
					if fr*T > r.End {
						line += " — |"
						continue
					}
					k, err := f.Sample(fr * T)
					if err != nil {
						line += " err |"
						continue
					}
					line += fmt.Sprintf(" %.1e |", shapeError(refs[i], k))
				}
				line += fmt.Sprintf(" %.3fT %s | %d | %.1fM | %.2fs |", r.End/T, r.Stop, r.Stats.Accepted, float64(r.Stats.NodeUpdates)/1e6, time.Since(start).Seconds())
				fmt.Fprintln(&b, line)
			}
			for _, n := range a.nodes {
				row("space", n, a.tau/4)
			}
			for _, tau := range a.taus {
				row("time", a.n, tau)
			}
		}
	}
	t.Log("\n" + b.String())
}

// LOOP_CONVERGE=1 also prints the polygon arm's self-convergence on loops
// only it admits: the distance between successive refinements (each
// returned vertex to the finer level's polygon, over the equal-area
// radius). For order p the differences fall by 2^p per halving.
func TestLoopSelfConvergence(t *testing.T) {
	if os.Getenv("LOOP_CONVERGE") == "" {
		t.Skip("set LOOP_CONVERGE=1")
	}
	wideLimits(t)
	fractions := []float64{0.01, 0.25, 0.5, 0.75, 0.95}
	cases := []corpusCase{
		{"limaçon b=0.9", Loop{Terms: limacon(0.9)}},
		{"near cusp a=0.45", Loop{Terms: nearCusp(0.45)}},
		{"ripple f=63 ε=0.004", Loop{Terms: rippleTerms(63, 0.004)}},
		{"outline: example leaf", Loop{Points: exampleLeaf}},
		{"outline: square", Loop{Points: []engine.Vec{{X: 0, Y: 0}, {X: 1, Y: 0}, {X: 1, Y: 1}, {X: 0, Y: 1}}}},
		{"outline: horseshoe, gap 0.02", Loop{Points: cShape(0.02, 0.3, 0.02)}},
	}
	var b strings.Builder
	for _, c := range cases {
		fmt.Fprintf(&b, "\n**%s**\n\n", c.name)
		fmt.Fprintln(&b, "| order | levels | 0.01T | 0.25T | 0.5T | 0.75T | 0.95T | finer level: end, steps, updates, remeshed (error), time |")
		fmt.Fprintln(&b, "|---|---|---|---|---|---|---|---|")
		levels := func(order int, kind string, qs []LoopRequest, names []string) {
			var prev []Contour
			for k, q := range qs {
				start := time.Now()
				f, err := SolveLoop(q)
				if err != nil {
					fmt.Fprintf(&b, "| bgn%d | %s | %s |||||| \n", order, names[k], short(err.Error()))
					prev = nil
					continue
				}
				r, _ := f.Frames(nil)
				T := r.Extinction
				cur := make([]Contour, len(fractions))
				for i, fr := range fractions {
					if fr*T <= r.End {
						cur[i], _ = f.Sample(fr * T)
					}
				}
				if prev != nil {
					line := fmt.Sprintf("| bgn%d | %s → %s |", order, names[k-1], names[k])
					for i := range fractions {
						if prev[i].X == nil || cur[i].X == nil {
							line += " — |"
							continue
						}
						line += fmt.Sprintf(" %.1e |", toPolygon(prev[i].X, prev[i].Y, cur[i].X, cur[i].Y)/math.Sqrt(math.Abs(cur[i].Area)/math.Pi))
					}
					line += fmt.Sprintf(" %.3fT %s, %d, %.1fM, %d (%.1e R), %.2fs |", r.End/T, r.Stop, r.Stats.Accepted, float64(r.Stats.NodeUpdates)/1e6, r.Stats.Remeshed, r.Stats.RemeshError, time.Since(start).Seconds())
					fmt.Fprintln(&b, line)
				}
				prev = cur
			}
		}
		for _, order := range []int{1, 2} {
			var qs []LoopRequest
			var names []string
			for _, tau := range []float64{0.01, 0.005, 0.0025, 0.00125, 0.000625} {
				qs = append(qs, LoopRequest{Loop: c.loop, Solver: "bgn", Nodes: 2048, Tau: tau, Horizon: 0.999, Order: order})
				names = append(names, fmt.Sprintf("τ %g", tau))
			}
			levels(order, "time", qs, names)
		}
		var qs []LoopRequest
		var names []string
		for _, n := range []int{512, 1024, 2048, 4096} {
			qs = append(qs, LoopRequest{Loop: c.loop, Solver: "bgn", Nodes: n, Tau: 0.0003, Horizon: 0.999, Order: 1})
			names = append(names, fmt.Sprintf("N %d", n))
		}
		levels(1, "space", qs, names)
	}
	t.Log("\n" + b.String())
}
