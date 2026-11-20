package engine4

import (
	"fmt"
	"math"
	"sort"
)

// Neighborhood sampling of Base sphere and fibers (docs/tesseracts.md,
// "Neighborhoods"). Instead of n fibers over the whole path, k fibers sit
// at the centers of k equal cells of the stretch [c − wT/2, c + wT/2] of
// the path's period T, centered on the moving point's parameter c:
// tᵢ = c + wT(i − (k − 1)/2)/k, reduced into [0, T). Every admitted path is
// closed, so a neighborhood wraps across the seam t = 0 ≡ T. The whole
// path's samples still carry the selection and its markers.

// The absent neighborhood width, a fraction of the path's period, and
// fiber count.
const (
	defaultNeighborhoodWidth = .125
	defaultNearby            = 17
	maxNearby                = 32
)

type NeighborhoodDiagnostics struct {
	Width  float64 `json:"width"`
	Fibers int     `json:"fibers"`
	// The stretch's ends c ∓ wT/2, unwrapped, so From may be negative and
	// To may pass T.
	From float64 `json:"from"`
	To   float64 `json:"to"`
	// The k cell centers tᵢ, reduced into [0, T), in cell order.
	Parameters []float64 `json:"parameters"`
	// Only when an exact pole repeats among the moving point and the cells:
	// entry i is the first cell at that point, or −1 for the moving fiber.
	// An odd k's center cell is the moving point, always −1.
	Aliases []int `json:"aliases,omitempty"`
}

type neighborhood struct {
	width float64
	k     int
}

// neighborhoodOf validates the sampling fields and returns the
// neighborhood, or nil for the whole path, whose fields are not read.
func neighborhoodOf(w WeaveParameters) (*neighborhood, error) {
	switch w.Sampling {
	case "", "path":
		return nil, nil
	case "neighborhood":
	default:
		return nil, fieldErr("weave.sampling", "Fiber sampling must be Whole path or Neighborhood")
	}
	h := neighborhood{width: defaultNeighborhoodWidth, k: defaultNearby}
	if w.Width != nil {
		h.width = *w.Width
	}
	if w.Nearby != nil {
		h.k = *w.Nearby
	}
	if !finite(h.width) || h.width <= 0 || h.width > 1 {
		return nil, fieldErr("weave.width", "Neighborhood width must be greater than 0 and at most 1, the whole path")
	}
	if h.k < 1 || h.k > maxNearby {
		return nil, fieldErr("weave.nearby", "Fibers in the neighborhood must be a whole number from 1 to %d", maxNearby)
	}
	return &h, nil
}

// neighborhoodPoints counts a neighborhood study's points before
// evaluation: k cells and the moving fiber with the window and base guides,
// as pairedWeavePoints counts n samples; a base curve of segments steps
// with its corners; the whole path's n sample markers; and the stretch's
// arc, at most every base-curve point and both ends.
func neighborhoodPoints(n, k, samples, segments, corners int) int {
	return pairedWeavePoints(k, samples) + segments - samples + corners + n + segments + corners + 2
}

// reducedParameter is t reduced into [0, T).
func reducedParameter(t, period float64) float64 {
	t -= period * math.Floor(t/period)
	if t >= period {
		t -= period
	}
	return t
}

// cells returns the k cell centers around c and the stretch's ends.
func (h neighborhood) cells(c, period float64) (ts []float64, from, to float64) {
	ts = make([]float64, h.k)
	for i := range ts {
		ts[i] = reducedParameter(c+h.width*period*(float64(i)-float64(h.k-1)/2)/float64(h.k), period)
	}
	return ts, c - h.width*period/2, c + h.width*period/2
}

// center is the cell on the moving point, or −1 for an even k.
func (h neighborhood) center() int {
	if h.k%2 == 1 {
		return (h.k - 1) / 2
	}
	return -1
}

// arcParameters are the stretch's parameters, unwrapped and increasing:
// its ends and every base-curve parameter strictly between them, so the arc
// lies on the base curve and passes through a polygon's corners. at holds,
// for each, the parameter in [0, T] to evaluate: the base curve's own
// interior parameters, and the ends reduced into [0, T).
func arcParameters(curve []float64, period, from, to float64) (ts, at []float64) {
	type pair struct{ s, t float64 }
	inside := []pair{}
	for _, t := range curve[:len(curve)-1] { // the last repeats the first
		for _, s := range []float64{t - period, t, t + period} {
			if s > from+weaveTolerance && s < to-weaveTolerance {
				inside = append(inside, pair{s, t})
			}
		}
	}
	sort.Slice(inside, func(i, j int) bool { return inside[i].s < inside[j].s })
	ts, at = []float64{from}, []float64{reducedParameter(from, period)}
	for _, p := range inside {
		ts, at = append(ts, p.s), append(at, p.t)
	}
	return append(ts, to), append(at, reducedParameter(to, period))
}

// neighborhoodSamples draws the cells' fibers and base markers, except an
// odd k's center, which is the moving fiber, and reports the diagnostics.
// An exact pole the moving point or an earlier cell already holds shares
// that fiber.
func (b *weaveBuilder) neighborhoodSamples(h neighborhood, c *CorrespondenceDiagnostics, period float64,
	pointAt func(float64) Vec3, section string, marker func(id, role string, p Vec3)) {
	ts, from, to := h.cells(c.Parameter, period)
	d := &NeighborhoodDiagnostics{Width: h.width, Fibers: h.k, From: from, To: to, Parameters: ts}
	c.Neighborhood = d
	aliases := make([]int, h.k)
	points := make([]Vec3, h.k)
	merged := false
	for i, t := range ts {
		aliases[i] = i
		if i == h.center() {
			aliases[i] = -1
			continue
		}
		p := pointAt(t)
		points[i] = p
		if p[2] == 1 || p[2] == -1 {
			if p == c.Base {
				aliases[i], merged = -1, true
				continue
			}
			for j := 0; j < i; j++ {
				if aliases[j] == j && points[j] == p {
					aliases[i], merged = j, true
					break
				}
			}
			if aliases[i] != i {
				continue
			}
		}
		rep, _ := hopfFiber(p)
		b.source(fiberCircle(fmt.Sprintf("weave/near/%d", i), "near", 0, rep), section)
		marker(fmt.Sprintf("weave/near/%d/base", i), "near", p)
	}
	if merged {
		d.Aliases = aliases
	}
}

// collapsedNeighborhood reports a pole's neighborhood: every cell shares
// its one circle.
func collapsedNeighborhood(h neighborhood, c *CorrespondenceDiagnostics, period float64) {
	ts, from, to := h.cells(c.Parameter, period)
	aliases := make([]int, h.k)
	for i := range aliases {
		aliases[i] = -1
	}
	c.Neighborhood = &NeighborhoodDiagnostics{Width: h.width, Fibers: h.k, From: from, To: to, Parameters: ts, Aliases: aliases}
}
