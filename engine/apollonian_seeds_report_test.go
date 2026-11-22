package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strings"
	"testing"
	"time"
)

// The catalog's evidence, first gathered for issue #385: GARDEN_REPORT=1 go test ./engine -run GardenSeedReport -v
//
// For each seed it reports the default and largest packings' counts, work
// (examined gaps, including those pruned out of view or below the cutoffs)
// and size, then the error of a plain float64 recurrence against the exact
// one, and deep windows' error and work.

// The plain alternative to exact arithmetic: the same breadth-first
// parentage, with b and the weighted center carried as float64 through
// 2(a + b + c) − old. Returns each circle's curvature, center and radius in
// units of the enclosing radius.
func floatRecurrence(s *gardenSpec, r GardenResult) (b, x, y, radius []float64) {
	n := len(r.Curvature)
	b, zx, zy := make([]float64, n), make([]float64, n), make([]float64, n)
	x, y, radius = make([]float64, n), make([]float64, n), make([]float64, n)
	for i, c := range s.circles {
		b[i], zx[i], zy[i] = c.b.float(), c.x.float()/float64(s.denom), c.y.float()/float64(s.denom)
	}
	// A ring's first circles replace a virtual opposite: find it by the
	// generators.
	virtual := map[[3]int]gardenCircle{}
	for k, st := range s.starts {
		if st.only >= 0 {
			virtual[[3]int{st.id[0], st.id[1], st.id[2]}] = s.virtual[k]
		}
	}
	scale := math.Abs(b[0])
	for i := range r.Curvature {
		if i >= len(s.circles) {
			p := r.Parents[i]
			j, k, l := int(p[0]), int(p[1]), int(p[2])
			var ob, ox, oy float64
			if o := int(r.Opposite[i]); o >= 0 {
				ob, ox, oy = b[o], zx[o], zy[o]
			} else {
				v := virtual[[3]int{j, k, l}]
				ob, ox, oy = v.b.float(), v.x.float()/float64(s.denom), v.y.float()/float64(s.denom)
			}
			b[i] = float64(2*float64(b[j]+b[k]+b[l])) - ob
			zx[i] = float64(2*float64(zx[j]+zx[k]+zx[l])) - ox
			zy[i] = float64(2*float64(zy[j]+zy[k]+zy[l])) - oy
		}
		x[i], y[i], radius[i] = zx[i]/b[i]*scale, zy[i]/b[i]*scale, scale/math.Abs(b[i])
	}
	return
}

func TestGardenSeedReport(t *testing.T) {
	if os.Getenv("GARDEN_REPORT") == "" {
		t.Skip("set GARDEN_REPORT=1 for the seed report")
	}
	var out strings.Builder
	p := func(format string, a ...any) { fmt.Fprintf(&out, format+"\n", a...) }
	p("\n### Packings: circles, examined gaps and reply size (exact arithmetic)\n")
	p("| Seed | Cutoffs | Circles | Gaps examined | Left by radius / depth | Stopped | Largest coefficient | JSON bytes | Go time |")
	p("|---|---|---|---|---|---|---|---|---|")
	for _, id := range GardenSeedIDs() {
		for _, q := range []GardenRequest{
			seedGarden(id, 12, 0.002, 5000),
			seedGarden(id, GardenMaxDepth, 5e-324, GardenMaxCircles),
		} {
			start := time.Now()
			var r GardenResult
			for k := 0; k < 5; k++ {
				r = mustGarden(t, q)
			}
			el := time.Since(start) / 5
			big := 0.0
			for _, v := range r.Exact {
				big = math.Max(big, math.Abs(v))
			}
			for _, v := range r.Curvature {
				big = math.Max(big, math.Abs(v))
			}
			js, _ := json.Marshal(r)
			p("| `%s` | %d, %g, %d | %d | %d | %d / %d | %s | %.3g | %d | %v |", id, q.Depth, q.MinRadius, q.MaxCircles,
				len(r.Curvature), r.Processed, r.Omitted.Radius, r.Omitted.Depth, r.Stopped, big, len(js), el.Round(10*time.Microsecond))
		}
	}

	p("\n### A plain float64 recurrence against the exact one\n")
	p("Errors relative to each circle's own radius, worst over the packing, by generation band (largest packing: depth 12, 5,000 circles).\n")
	p("| Seed | gen 1–4 | gen 5–8 | gen 9–12 | float: worst tangency residual / radius | exact: worst tangency residual / radius |")
	p("|---|---|---|---|---|---|")
	for _, id := range GardenSeedIDs() {
		s := gardenSpecs[id]
		r := mustGarden(t, seedGarden(id, GardenMaxDepth, 5e-324, GardenMaxCircles))
		b, x, y, radius := floatRecurrence(s, r)
		var band [3]float64
		worstTangency, exactWorst := 0.0, 0.0
		for i := len(s.circles); i < len(r.Curvature); i++ {
			e := math.Max(math.Hypot(x[i]-r.X[i], y[i]-r.Y[i]), math.Abs(radius[i]-r.Radius[i])) / r.Radius[i]
			g := int(r.Generation[i]-1) / 4
			band[g] = math.Max(band[g], e)
			_ = b
			for _, pk := range r.Parents[i] {
				k := int(pk)
				d := math.Hypot(x[i]-x[k], y[i]-y[k])
				want := radius[i] + radius[k]
				if r.Curvature[k] < 0 {
					want = radius[k] - radius[i]
				}
				worstTangency = math.Max(worstTangency, math.Abs(d-want)/radius[i])
				// The exact path's residual on the same pair.
				de := math.Hypot(r.X[i]-r.X[k], r.Y[i]-r.Y[k])
				we := r.Radius[i] + r.Radius[k]
				if r.Curvature[k] < 0 {
					we = r.Radius[k] - r.Radius[i]
				}
				exactWorst = math.Max(exactWorst, math.Abs(de-we)/r.Radius[i])
			}
		}
		p("| `%s` | %.2g | %.2g | %.2g | %.2g | %.2g |", id, band[0], band[1], band[2], worstTangency, exactWorst)
	}

	p("\n### Repeated refinement: deep windows\n")
	p("The detail policy's request at the 100× zoom limit (level 13: cutoff 0.002/2^6.5, window of about 0.0286 × 0.0217 plus a cell), at each seed's tangency of its enclosing circle with its largest circle, and at the smallest circle of the default packing. Exact arithmetic throughout; tangency residual relative to the smaller radius.\n")
	p("| Seed | Where | Circles | Deepest gen | Examined | Out of view | Left by depth | Smallest radius | Exact: worst residual / radius | Float recurrence: worst error / radius, gen ≥ 9 | Go time |")
	p("|---|---|---|---|---|---|---|---|---|---|---|")
	for _, id := range GardenSeedIDs() {
		def := mustGarden(t, seedGarden(id, 12, 0.002, 5000))
		// The contact of circle 0 with the largest inner seed circle.
		big := -1
		for i := 1; i < len(def.Curvature) && def.Generation[i] == 0; i++ {
			if math.Hypot(def.X[i], def.Y[i]) > 0 && (big < 0 || def.Radius[i] > def.Radius[big]) {
				big = i
			}
		}
		d := math.Hypot(def.X[big], def.Y[big])
		cusp := [2]float64{def.X[big] / d, def.Y[big] / d}
		small := 0
		for i := range def.Radius {
			if def.Radius[i] < def.Radius[small] {
				small = i
			}
		}
		for _, w := range []struct {
			name string
			at   [2]float64
		}{{"enclosing cusp", cusp}, {"smallest circle", [2]float64{def.X[small], def.Y[small]}}} {
			cell := 1000.0 / (350 * math.Pow(2, 6.5)) / 4
			win := GardenWindow{XMin: w.at[0] - 3*cell, XMax: w.at[0] + 3*cell, YMin: w.at[1] - 2.5*cell, YMax: w.at[1] + 2.5*cell}
			q := windowed(seedGarden(id, 12, 0.002/math.Pow(2, 6.5), 5000), win)
			start := time.Now()
			r := mustGarden(t, q)
			el := time.Since(start)
			worst, smallest := 0.0, 1.0
			for i := len(gardenSpecs[id].circles); i < len(r.Curvature); i++ {
				smallest = math.Min(smallest, r.Radius[i])
				for _, pk := range r.Parents[i] {
					k := int(pk)
					de := math.Hypot(r.X[i]-r.X[k], r.Y[i]-r.Y[k])
					we := r.Radius[i] + r.Radius[k]
					if r.Curvature[k] < 0 {
						we = r.Radius[k] - r.Radius[i]
					}
					worst = math.Max(worst, math.Abs(de-we)/r.Radius[i])
				}
			}
			_, fx, fy, fr := floatRecurrence(gardenSpecs[id], r)
			floatWorst, deepest := 0.0, 0.0
			for i := range r.Curvature {
				deepest = math.Max(deepest, r.Generation[i])
				if r.Generation[i] >= 9 {
					floatWorst = math.Max(floatWorst, math.Max(math.Hypot(fx[i]-r.X[i], fy[i]-r.Y[i]), math.Abs(fr[i]-r.Radius[i]))/r.Radius[i])
				}
			}
			p("| `%s` | %s | %d | %v | %d | %d | %d | %.3g | %.2g | %.2g | %v |", id, w.name, len(r.Curvature), deepest, r.Processed, r.Omitted.View, r.Omitted.Depth, smallest, worst, floatWorst, el.Round(10*time.Microsecond))
		}
	}
	t.Log(out.String())
}
