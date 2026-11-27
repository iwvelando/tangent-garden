package physical

import (
	"math"
	"math/cmplx"
)

// SimplifyReport is what removing features below the minimums changed:
// the sampled area of material taken away and of gaps filled, in square
// millimeters, and where (bounded lists of node positions).
type SimplifyReport struct {
	RemovedArea float64      `json:"removedArea"`
	FilledArea  float64      `json:"filledArea"`
	Removed     []complex128 `json:"-"`
	Filled      []complex128 `json:"-"`
	// changed marks the nodes whose side changed, or that the trimmed
	// boundary passes beside.
	changed []bool
}

// Simplify removes, at the top level of the plaque, material thinner than
// the wall and fills gaps narrower than the gap, by two morphological
// openings sampled on the grid:
//
//  1. Material keeps exactly the points that some disk of diameter wall
//     inside the material reaches: its nodes within wall/2 of a node at
//     least wall/2 deep. Isolated pillars, thin walls and the thin tips
//     of acute corners go; everything else keeps its exact boundary.
//  2. Then the gaps (what is not material, inside the plaque) keep only
//     the points a disk of diameter gap inside them reaches; narrower
//     slots, cusps and wedge corners are filled.
//
// Raised, the material is the plan; recessed, the rest of the plaque. The
// plan stays inside outer. Decisions are made at nodes with an allowance
// of h/√2 on both the depth and the reach, so a feature at the minimum is
// kept, and so may one up to about a grid step narrower; kept regions'
// boundaries are not moved.
func (g *Grid) Simplify(raised bool, wall, gap, outer, plaque float64) SimplifyReport {
	var rep SimplifyReport
	n := g.NX * g.NY
	allowance := g.H / math.Sqrt2
	radius := make([]float64, n)
	for k := range n {
		radius[k] = cmplx.Abs(g.At(k%g.NX, k/g.NX))
	}
	// s is the signed clearance, positive inside the material.
	s := make([]float64, n)
	for k := range n {
		if raised {
			s[k] = -g.F[k]
		} else {
			s[k] = math.Min(g.F[k], plaque-radius[k])
		}
	}
	// open keeps the positive region's points within r of its core (the
	// nodes at least r deep); others become negative, at r minus their
	// distance to the core, which places the trimmed boundary between
	// nodes. It reports the nodes it turned.
	open := func(v []float64, r float64, strict bool) []int {
		seed := make([]float64, n)
		// A point at depth r may lie between nodes, whose depth is then
		// at least r − h/√2. Leniently, nodes that deep are the core, so a
		// feature exactly at the minimum keeps its core; strictly, only
		// nodes at least r deep, so every kept piece provably holds a
		// disk of the minimum, as the cell check then confirms.
		least := r - allowance
		if strict {
			least = r
		}
		for k := range n {
			if v[k] >= least {
				seed[k] = 0
			} else {
				seed[k] = math.Inf(1)
			}
		}
		d2 := distanceTransform(seed, g.NX, g.NY)
		var turned []int
		for k := range n {
			if v[k] <= 0 {
				continue
			}
			d := math.Sqrt(d2[k]) * g.H
			if d <= r+allowance {
				continue
			}
			v[k] = r - d
			turned = append(turned, k)
		}
		return turned
	}
	cell := g.H * g.H
	rep.changed = make([]bool, n)
	mark := func(k int) {
		i, j := k%g.NX, k/g.NX
		for dj := -1; dj <= 1; dj++ {
			for di := -1; di <= 1; di++ {
				if x, y := i+di, j+dj; x >= 0 && y >= 0 && x < g.NX && y < g.NY {
					rep.changed[y*g.NX+x] = true
				}
			}
		}
	}
	// The region the cell check judges (webs recessed, gaps raised) is
	// opened strictly; the other leniently, keeping lines at the wall.
	for _, k := range open(s, wall/2, !raised) {
		mark(k)
		rep.RemovedArea += cell
		if len(rep.Removed) < 20000 {
			rep.Removed = append(rep.Removed, g.At(k%g.NX, k/g.NX))
		}
	}
	// The gaps inside the plaque: beyond its edge nothing is a gap.
	t := make([]float64, n)
	for k := range n {
		t[k] = -s[k]
		if radius[k] >= plaque {
			t[k] = math.Inf(1)
		}
	}
	for _, k := range open(t, gap/2, raised) {
		mark(k)
		rep.FilledArea += cell
		if len(rep.Filled) < 20000 {
			rep.Filled = append(rep.Filled, g.At(k%g.NX, k/g.NX))
		}
	}
	// Back to the plan's field: negative inside the plan, which stays
	// inside outer, and never within the snap of zero.
	for k := range n {
		material := -t[k]
		if math.IsInf(t[k], 1) {
			material = s[k]
		}
		var f float64
		if raised {
			f = -material
		} else {
			f = material
		}
		f = math.Max(f, radius[k]-outer)
		f = math.Min(f, g.Cap)
		if math.Abs(f) < snap*g.H {
			f = math.Copysign(snap*g.H, f)
			if f == 0 {
				f = snap * g.H
			}
		}
		g.F[k] = f
	}
	return rep
}
