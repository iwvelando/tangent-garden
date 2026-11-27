package physical

import (
	"errors"
	"fmt"
	"math"
	"math/cmplx"
)

// Base is the plaque under the plan: a disk of Radius, bounded by a
// regular polygon of Segments sides unless Framed, when the plan's own
// outermost loop is the plaque's edge (a frame band reaching the rim).
type Base struct {
	Radius   float64
	Segments int
	Framed   bool
}

// Levels are the heights of the plan's top and of the rest of the plaque;
// the bottom is at zero. Raised: Plan > Rest. Recessed: Plan < Rest.
type Levels struct{ Plan, Rest float64 }

// Solidify builds the plaque as a two-level height field: the plan region
// up to Plan, the rest up to Rest, both from a flat bottom, joined by
// vertical walls along the plan's loops and around the plaque's edge.
// Each top is triangulated on its own from the same loop points, so the
// walls share their edges exactly; nothing is snapped or welded.
func Solidify(c *Contours, b Base, lv Levels) (*Mesh, error) {
	return SolidifyWithin(c, b, lv, DefaultLimits)
}

// SolidifyWithin is Solidify under the given ceilings.
func SolidifyWithin(c *Contours, b Base, lv Levels, lim Limits) (*Mesh, error) {
	if !(lv.Plan > 0) || !(lv.Rest > 0) || lv.Plan == lv.Rest {
		return nil, errors.New("the plan and the rest need distinct positive heights")
	}
	pts := append([]complex128(nil), c.Points...)
	loops := c.Loops
	planPolys, orphans := Nest(pts, loops)
	if len(orphans) > 0 {
		return nil, errors.New("a hole of the plan lies in no piece of it")
	}
	reversed := make([][]int32, len(loops))
	for i, l := range loops {
		r := make([]int32, len(l))
		for k := range l {
			r[k] = l[len(l)-1-k]
		}
		reversed[i] = r
	}
	var edge []int32 // the plaque's outline, counterclockwise
	edgeLoop := -1
	if b.Framed {
		best := 0.0
		for i, l := range loops {
			if a := Area(pts, l); a > best {
				best, edgeLoop = a, i
			}
		}
		if edgeLoop < 0 {
			return nil, errors.New("a framed plaque needs its frame")
		}
		edge = loops[edgeLoop]
	} else {
		if b.Segments < 3 {
			return nil, errors.New("the plaque needs at least three sides")
		}
		for k := range b.Segments {
			pts = append(pts, cmplx.Rect(b.Radius, 2*math.Pi*float64(k)/float64(b.Segments)))
			edge = append(edge, int32(len(pts)-1))
		}
		reversed = append(reversed, edge)
	}
	restPolys, orphans := Nest(pts, reversed)
	if b.Framed && (len(orphans) != 1 || orphans[0] != edgeLoop) || !b.Framed && len(orphans) != 0 {
		return nil, errors.New("the plan leaves the plaque")
	}

	m := &Mesh{}
	type key struct {
		p     int32
		level uint8
	}
	heights := [3]float64{0, lv.Rest, lv.Plan}
	ids := map[key]int32{}
	vid := func(p int32, level uint8) int32 {
		k := key{p, level}
		if v, ok := ids[k]; ok {
			return v
		}
		v := int32(len(m.V) / 3)
		ids[k] = v
		m.V = append(m.V, real(pts[p]), imag(pts[p]), heights[level])
		return v
	}
	tri := func(a, b, c int32) error {
		m.T = append(m.T, a, b, c)
		if len(m.T)/3 > lim.Triangles {
			return fmt.Errorf("the solid would pass its ceiling of %d triangles: choose a smaller plaque, wider lines, a crop or a coarser grid step: %w", lim.Triangles, ErrLimit)
		}
		return nil
	}
	top := func(polys []Polygon, level uint8) error {
		for _, p := range polys {
			ts, err := Triangulate(pts, p)
			if err != nil {
				return err
			}
			for _, t := range ts {
				if err := tri(vid(t[0], level), vid(t[1], level), vid(t[2], level)); err != nil {
					return err
				}
			}
		}
		return nil
	}
	// The plan's top at Plan, the rest's at Rest.
	if err := top(planPolys, 2); err != nil {
		return nil, err
	}
	if err := top(restPolys, 1); err != nil {
		return nil, err
	}
	// The bottom: the outline at zero, facing down.
	bottom, err := Triangulate(pts, Polygon{Outer: edge})
	if err != nil {
		return nil, err
	}
	for _, t := range bottom {
		if err := tri(vid(t[0], 0), vid(t[2], 0), vid(t[1], 0)); err != nil {
			return nil, err
		}
	}
	// wall joins the loop's edges from level lo to level hi, facing to
	// the loop's right when out is true, else to its left.
	wall := func(l []int32, lo, hi uint8, right bool) error {
		for k := range l {
			a, b := l[k], l[(k+1)%len(l)]
			al, bl, ah, bh := vid(a, lo), vid(b, lo), vid(a, hi), vid(b, hi)
			if right {
				if err := tri(al, bl, bh); err != nil {
					return err
				}
				if err := tri(al, bh, ah); err != nil {
					return err
				}
			} else {
				if err := tri(al, bh, bl); err != nil {
					return err
				}
				if err := tri(al, ah, bh); err != nil {
					return err
				}
			}
		}
		return nil
	}
	raised := lv.Plan > lv.Rest
	for i, l := range loops {
		if i == edgeLoop {
			continue
		}
		var err error
		if raised {
			err = wall(l, 1, 2, true)
		} else {
			err = wall(l, 2, 1, false)
		}
		if err != nil {
			return nil, err
		}
	}
	// The plaque's edge, from the bottom to the top beside it.
	side := uint8(1)
	if b.Framed {
		side = 2
	}
	if err := wall(edge, 0, side, true); err != nil {
		return nil, err
	}
	return m, nil
}
