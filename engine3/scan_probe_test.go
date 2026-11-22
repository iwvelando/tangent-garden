package engine3

import (
	"fmt"
	"math"
	"os"
	"strings"
	"testing"
)

// The scan's evidence tables: SCAN_REPORT=1 go test ./engine3 -run
// TestScanReport -v prints each corpus case's candidates beside the exact
// events. It asserts nothing; scan_test.go does.

type reportCase struct {
	name   string
	q      ImplicitRequest
	axis   string
	lo, hi float64
	exact  []float64
}

func reportScan(c reportCase, samples, depth int) string {
	if c.q.Cells > maxImplicitCells || c.q.Box.shape(c.q.Cells)[0]*c.q.Box.shape(c.q.Cells)[1]*c.q.Box.shape(c.q.Cells)[2] > maxImplicitGrid {
		return ""
	}
	r, err := RunScan(ScanRequest{Implicit: c.q, Axis: c.axis, From: c.lo, To: c.hi, Samples: samples, Depth: depth, Recheck: true, Critical: true})
	if err != nil {
		return "error: " + err.Error()
	}
	var b strings.Builder
	fmt.Fprintf(&b, "%-34s cells %3d r%d  N %2d D %2d  calls %3d cells %9d  stop %s  unresolved %d singular %d\n",
		c.name, c.q.Cells, c.q.Refine, samples, depth, r.Calls, r.Cells, r.Stop, r.Unresolved, r.Singular)
	matched := map[int]bool{}
	for _, k := range r.Candidates {
		near, d := -1, math.Inf(1)
		for i, e := range c.exact {
			if g := math.Max(0, math.Max(k.Spread[0]-e, e-k.Spread[1])); g < d {
				near, d = i, g
			}
		}
		tag := "false"
		step := (c.hi - c.lo) / float64(samples-1)
		if near >= 0 && d <= 2*step {
			tag = fmt.Sprintf("event %.6g, off %.3g", c.exact[near], d)
			matched[near] = true
		}
		through := ""
		if k.Through != nil {
			through = fmt.Sprintf(" through %.6g", k.Through.Value)
		}
		rc := func(r *ScanRecheck) string {
			if r == nil {
				return "-"
			}
			if r.Outcome == "agrees" {
				return fmt.Sprintf("%d:[%.5g, %.5g]", r.Cells, r.Lo, r.Hi)
			}
			return fmt.Sprintf("%d:%s", r.Cells, r.Outcome)
		}
		crit := ""
		for _, x := range k.Critical {
			crit += fmt.Sprintf(" crit %.9g i%d ×%d", x.Value, x.Index, x.Points)
		}
		fmt.Fprintf(&b, "   %-10s [%.6g, %.6g] spread [%.6g, %.6g] %v|%v → %v|%v%s  %s  lattice %s finer %s  (%s)\n",
			k.Kind, k.Lo, k.Hi, k.Spread[0], k.Spread[1], k.Before.Pieces, k.Before.Cut, k.After.Pieces, k.After.Cut, through,
			k.Stability, rc(k.Lattice), rc(k.Finer), tag+crit)
	}
	for i, e := range c.exact {
		if !matched[i] {
			fmt.Fprintf(&b, "   MISSED event %.6g\n", e)
		}
	}
	return b.String()
}

func TestScanReport(t *testing.T) {
	if os.Getenv("SCAN_REPORT") == "" {
		t.Skip("set SCAN_REPORT=1")
	}
	p := spatialPresets(t)
	story := func(name string, lo, hi float64, exact ...float64) reportCase {
		return reportCase{name, p[name].Implicit, "level", lo, hi, exact}
	}
	field := func(name, f string, level, a float64, b Box, cells int, axis string, lo, hi float64, exact ...float64) reportCase {
		return reportCase{name, scanStudy(f, level, a, b, cells), axis, lo, hi, exact}
	}
	birth, merge := tiltedWell(1)
	b14, m14 := tiltedWell(1.4)
	stories := []reportCase{
		story("Two drops become one", 0.64, 1.44, 1),
		story("The instant a handle appears", 0.64, 1.44, 1),
		story("The tanglecube's three events", -18, 4, -12.5, -6.25, 0),
		story("Two handles open at once", 0.01, 0.1, 1.0/16),
	}
	others := []reportCase{
		field("tanglecube birth", "x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2", 0, 1, cube(3), 32, "level", -20, -16, -75.0/4),
		field("a: drops parted by a", "((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)", 1, 1, Box{-2, 2, -1.2, 1.2, -1.2, 1.2}, 40, "a", 0.6, 1.4, 1),
		field("a: handle radius", "(x^2+y^2-a)^2+z^2", 1, 1, Box{-2, 2, -2, 2, -1.2, 1.2}, 40, "a", 0.5, 1.5, 1),
		field("box: sphere through its box", "x^2+y^2+z^2", 1, 1, cube(1), 32, "level", 0.5, 3.5, 1, 2, 3),
		field("box: tanglecube in 2.6 box", "x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2", 0, 1, cube(2.6), 48, "level", -18, 4, -12.5, -6.25, -0.6024, 0),
		field("pair b=1 (gap 0.20)", "x^4 - 2*x^2 + 1*x + y^2 + z^2", 0, 1, cube(2.2), 48, "level", -1, 1.4, birth, merge),
		field("pair b=1.4 (gap tiny)", "x^4 - 2*x^2 + 1.4*x + y^2 + z^2", 0, 1, cube(2.2), 48, "level", -1, 1.4, b14, m14),
		field("gyroid", "sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)", 0, 1, cube(math.Pi), 32, "level", -1.5, 1.5),
		reportCase{"box: double torus in its thin box", p["A double torus"].Implicit, "level", 0.005, 0.1, []float64{1.0 / 16, 0.0225}},
		field("pole", "1/(x^2+y^2+z^2-1)", 1, 1, cube(1.5), 25, "level", 0.5, 1.5),
		field("undefined corners", "sqrt(4-x^2-y^2-z^2)", 1, 1, cube(1.5), 24, "level", 0.5, 1.5),
	}
	filter := os.Getenv("SCAN_CASE")
	pick := func(c reportCase) bool { return filter == "" || strings.Contains(c.name, filter) }
	with := func(c reportCase, cells, refine int) reportCase { c.q.Cells, c.q.Refine = cells, refine; return c }
	shift := func(c reportCase, f float64, samples int) reportCase {
		step := (c.hi - c.lo) / float64(samples-1)
		c.lo, c.hi = c.lo-f*step, c.hi+(1-f)*step
		c.name += fmt.Sprintf(" (lattice -%.2f)", f)
		return c
	}
	fmt.Println("== Grids, at 17 samples and 8 bisections")
	for _, c := range stories {
		if !pick(c) {
			continue
		}
		n := c.q.Cells
		for _, cells := range []int{n / 2, n/2 + 1, n, n + 1, n * 3 / 2} {
			if cells <= maxImplicitCells {
				fmt.Print(reportScan(with(c, cells, 0), 17, 8))
			}
		}
		fmt.Print(reportScan(with(c, n/2, 1), 17, 8))
	}
	fmt.Println("== Samples and a shifted sample lattice, on the example's grid")
	for _, c := range stories {
		if !pick(c) {
			continue
		}
		for _, samples := range []int{5, 9, 33} {
			fmt.Print(reportScan(c, samples, 8))
		}
		fmt.Print(reportScan(shift(c, 0.37, 17), 17, 8))
	}
	fmt.Println("== Bisection depth, on the example's grid")
	for _, c := range stories[2:3] {
		if !pick(c) {
			continue
		}
		for _, d := range []int{0, 3, 5, 12} {
			fmt.Print(reportScan(c, 17, d))
		}
	}
	fmt.Println("== Other controls and adversarial fields")
	for _, c := range others {
		if !pick(c) {
			continue
		}
		for _, samples := range []int{7, 17, 33} {
			fmt.Print(reportScan(c, samples, 8))
		}
	}
}
