package engine

import (
	"fmt"
	"math"
	"os"
	"sort"
	"testing"
	"time"
)

// Issue #389's evidence report, printed with
//
//	LACE_REPORT=1 go test ./engine -run LaceTilingReport -v
//
// Engine time here is Go on the machine running it, not WASM and not a
// device frame rate; scripts/lace-tilings-research.mjs measures WASM.
func TestLaceTilingReport(t *testing.T) {
	if os.Getenv("LACE_REPORT") == "" {
		t.Skip("set LACE_REPORT=1 for the research report")
	}
	out := func(format string, a ...any) { fmt.Printf(format+"\n", a...) }
	out("## Seeds")
	out("| tiling | angle | circumradius R | apothem h | side s | corner radius |")
	for _, id := range researchTilings {
		_, q := tilingPQ(t, id)
		r := mustLace(t, tiling(id, 0, 1, 0.3))
		out("| {%s} | %.1f° | %.4f | %.4f | %.4f | %.4f |", id, 360/float64(q), r.Circumradius, r.Apothem, r.SideLength, r.VertexRadius)
	}

	out("\n## Supported patches (tile limit 1,000)")
	out("| tiling | rings 0–8 | deepest complete ring | tiles there | depth 8 at 1,000: stops at | outermost 1 − |z|² | complete to radius (hyperbolic) |")
	for _, id := range researchTilings {
		p, q := tilingPQ(t, id)
		x := exactGenerate(p, q, 8, 1<<20, 1<<22)
		ring := make([]int, 9)
		for _, d := range x.depth {
			ring[d]++
		}
		total, complete := 0, 0
		for d, n := range ring {
			if total+n > LaceMaxTiles {
				break
			}
			total += n
			complete = d
		}
		r := mustLace(t, tiling(id, 8, 1000, 0.3))
		gap := 1.0
		for _, v := range r.Vertex {
			gap = math.Min(gap, rimGap(cz(v)))
		}
		stop := "complete"
		if r.Stopped != "" {
			stop = fmt.Sprintf("%d tiles, depth %d partial", len(r.Center), int(r.Depth[len(r.Depth)-1]))
		} else {
			stop = fmt.Sprintf("%d tiles, depth 8 complete", len(r.Center))
		}
		out("| {%s} | %v | %d | %d | %s | %.2e | %.3f (%.2f) |", id, ring, complete, total, stop, gap, r.Coverage.Radius, r.Coverage.Distance)
	}

	out("\n## Near the rim: float disagreement against 1 − |z|²")
	out("Each tile's corners recomputed from its own transformation, against the stored vertex (placed by the first tile to reach it), over unlimited patches.")
	out("| tiling | depth | tiles | smallest 1 − |z|² | worst disagreement | worst disagreement·(1 − |z|²) | precision omissions |")
	deep := map[string]int{"7,3": 10, "5,4": 10, "4,5": 12, "3,7": 16}
	for _, id := range researchTilings {
		p, _ := tilingPQ(t, id)
		for d := 4; d <= deep[id]; d += 2 {
			r := computeLace(tiling(id, d, 1<<22, 0.3), laceLimits{d, 1 << 24, lacePolicy})
			seed := newLaceSeed(id, 0.3)
			worst, scaled, gap := 0.0, 0.0, 1.0
			for i, m := range r.Transform {
				g := mobius{a: complex(m[0], m[1]), b: complex(m[2], m[3]), odd: r.Reversed[i]}
				for k := range p {
					z := corner(r, i, k)
					dd := dist(g.apply(seed.vertex[k]), z)
					worst = math.Max(worst, dd)
					scaled = math.Max(scaled, dd*rimGap(z))
					gap = math.Min(gap, rimGap(z))
				}
			}
			out("| {%s} | %d | %d | %.2e | %.1e | %.1e | %d |", id, d, len(r.Center), gap, worst, scaled, r.Omitted.Precision)
		}
	}

	out("\n## Exact generator: cost and coefficients")
	out("| tiling | 1,000-tile patch, float generator (median of 7) | exact generator | largest exact coefficient at 1,000 tiles | at depth 8 unlimited |")
	for _, id := range researchTilings {
		p, q := tilingPQ(t, id)
		var fl, ex []time.Duration
		var x *exactLace
		for range 7 {
			start := time.Now()
			if _, err := ComputeLace(tiling(id, 8, 1000, 0.3)); err != nil {
				t.Fatal(err)
			}
			fl = append(fl, time.Since(start))
			start = time.Now()
			x = exactGenerate(p, q, 8, 1000, LaceMaxCandidates)
			ex = append(ex, time.Since(start))
		}
		med := func(d []time.Duration) time.Duration {
			sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
			return d[len(d)/2]
		}
		deepX := exactGenerate(p, q, 8, 1<<20, 1<<22)
		out("| {%s} | %v | %v | %d | %d |", id, med(fl).Round(time.Microsecond), med(ex).Round(time.Microsecond), x.maxCoef, deepX.maxCoef)
	}
}
