package engine3

import (
	"math"
	"slices"
)

// Refining a surface along the curve: with AdaptiveSurface, the mesh a curve
// construction draws gains columns between its samples at the positions
// where refinement drew points on the curves that bound or lie on it (see
// surfaceColumns), each placed by the construction's own pointwise
// evaluator, as at a sample. Rulings, cross-lines, contact circles, the
// probe and framing keep the evenly spaced samples.

// surfaceVertices bounds the vertices refinement adds to one surface's
// mesh; a surface with more vertices to a column takes fewer columns.
const surfaceVertices = 1 << 17

// refinesSurface reports whether the study asked for its surface to be
// refined along the curve, and can refine its curves.
func (c Request) refinesSurface() bool { return c.refines() && c.AdaptiveSurface }

// surfaceColumns gathers, for each of n sample intervals that joined
// accepts, the positions strictly between its samples, in sample steps,
// where any of paths has a drawn point. Refinement bisects, so each such
// position is k/2^d past its sample for some depth d up to refineDepth;
// positions are taken a depth at a time, from the coarsest, while the whole
// depth fits within budget, so a surface that runs out is still refined
// evenly. It returns them per interval in order, their count, and whether a
// depth was left out.
func surfaceColumns(n int, joined func(int) bool, budget int, paths ...*RefinedPath) ([][]float64, int, bool) {
	levels := make([]map[float64]bool, refineDepth+1)
	for d := range levels {
		levels[d] = map[float64]bool{}
	}
	for _, path := range paths {
		if path == nil {
			continue
		}
		for j, p := range path.Points {
			at := path.At[j]
			i := math.Floor(at)
			if p == nil || at == i || int(i) < 0 || int(i) >= n || !joined(int(i)) {
				continue
			}
			d := 1
			for f := at - i; d < refineDepth && math.Ldexp(f, d) != math.Trunc(math.Ldexp(f, d)); d++ {
			}
			levels[d][at] = true
		}
	}
	columns := make([][]float64, n)
	count, capped := 0, false
	for _, level := range levels[1:] {
		if count+len(level) > budget {
			capped = true
			break
		}
		count += len(level)
		for at := range level {
			i := int(math.Floor(at))
			columns[i] = append(columns[i], at)
		}
	}
	for _, c := range columns {
		slices.Sort(c)
	}
	return columns, count, capped
}

// stations lists the positions, in sample steps, at which interval i's
// strips of the surface are drawn: its two samples and its columns.
func stations(i int, columns [][]float64) []float64 {
	if columns == nil {
		return []float64{float64(i), float64(i + 1)}
	}
	return append(append([]float64{float64(i)}, columns[i]...), float64(i+1))
}

// parameterAt is the parameter at a position in sample steps.
func parameterAt(lo, hi float64, n int, at float64) float64 {
	return lo*(1-at/float64(n)) + hi*at/float64(n)
}
