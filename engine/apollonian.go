package engine

import (
	"errors"
	"math"
)

// GardenSeed names the one enclosing Descartes configuration: signed
// curvatures (−1, 2, 2, 3). See docs/mathematics.md, Apollonian garden.
const GardenSeed = "-1,2,2,3"

// GardenRequest asks for the finite Apollonian packing grown from a seed.
// MinRadius is in model units, the enclosing circle's radius being 1.
type GardenRequest struct {
	Seed       string  `json:"seed"`
	Depth      int     `json:"depth"`
	MinRadius  float64 `json:"minRadius"`
	MaxCircles int     `json:"maxCircles"`
}

// GardenOmitted counts unfilled gaps by the cutoff that left them. A gap
// whose circle is below the minimum radius counts as radius, even when it
// is also beyond the depth.
type GardenOmitted struct {
	Radius int `json:"radius"`
	Depth  int `json:"depth"`
}

// GardenResult holds circles in breadth-first order as parallel arrays.
// Circle 0 is the enclosing circle and 1–3 the other seeds. Curvature and
// the curvature-weighted center are exact integers, the circle's identity.
// Parents holds the generating triple, and Opposite the circle replaced in
// the quadruple it was generated from; both are −1 for seeds.
type GardenResult struct {
	Seed       string        `json:"seed"`
	X          []float64     `json:"x"`
	Y          []float64     `json:"y"`
	Radius     []float64     `json:"radius"`
	Curvature  []float64     `json:"curvature"`
	WeightedX  []float64     `json:"weightedX"`
	WeightedY  []float64     `json:"weightedY"`
	Generation []float64     `json:"generation"`
	Parents    [][3]float64  `json:"parents"`
	Opposite   []float64     `json:"opposite"`
	Omitted    GardenOmitted `json:"omitted"`
	// Stopped is "count" or "configurations" when that ceiling ended
	// generation with Pending configurations not fully expanded, else "".
	Stopped string `json:"stopped"`
	Pending int    `json:"pending"`
	// Processed counts candidate configurations examined, each one gap.
	Processed  int `json:"processed"`
	Duplicates int `json:"duplicates"`
}

const (
	GardenMaxDepth          = 12
	GardenMaxCircles        = 5000
	GardenMaxConfigurations = 20000
)

type gardenLimits struct{ configurations int }

// An integer circle: curvature b and curvature-weighted center b·c.
type gardenCircle struct{ b, x, y int64 }

// The seed's circles in index order: enclosing, left, right, top.
var gardenSeed = [4]gardenCircle{{-1, 0, 0}, {2, -1, 0}, {2, 1, 0}, {3, 0, 2}}

func ComputeGarden(q GardenRequest) (GardenResult, error) {
	return computeGarden(q, gardenLimits{GardenMaxConfigurations})
}

func (q GardenRequest) validate() error {
	if q.Seed != GardenSeed {
		return fieldErr("seed", "choose the enclosing seed (−1, 2, 2, 3)")
	}
	if q.Depth < 0 || q.Depth > GardenMaxDepth {
		return fieldErr("depth", "depth must be 0–%d generations", GardenMaxDepth)
	}
	if !finite(q.MinRadius) || q.MinRadius <= 0 || q.MinRadius > 1 {
		return fieldErr("minRadius", "minimum radius must be above 0 and at most 1")
	}
	if q.MaxCircles < 4 || q.MaxCircles > GardenMaxCircles {
		return fieldErr("maxCircles", "circle count must be 4–%d", GardenMaxCircles)
	}
	return nil
}

var errGardenRange = errors.New("a circle's curvature exceeds the exact integer range")

// Breadth-first over Descartes quadruples. Children fill a quadruple's
// gaps in index order, skipping the reversal that restores its parent, so
// each gap is met once. Pruning a gap prunes its descendants, which lie in
// that gap and are smaller than the circle that fills it.
func computeGarden(q GardenRequest, limits gardenLimits) (GardenResult, error) {
	if err := q.validate(); err != nil {
		return GardenResult{}, err
	}
	type quad struct {
		id        [4]int
		last, gen int
	}
	r := GardenResult{Seed: q.Seed}
	var circles []gardenCircle
	known := map[gardenCircle]bool{}
	add := func(c gardenCircle, gen int, parents [3]float64, opposite float64) {
		b := float64(c.b)
		circles = append(circles, c)
		known[c] = true
		// Adding zero turns the enclosing circle's −0 into 0.
		r.X = append(r.X, float64(c.x)/b+0)
		r.Y = append(r.Y, float64(c.y)/b+0)
		r.Radius = append(r.Radius, 1/math.Abs(b))
		r.Curvature = append(r.Curvature, b)
		r.WeightedX = append(r.WeightedX, float64(c.x))
		r.WeightedY = append(r.WeightedY, float64(c.y))
		r.Generation = append(r.Generation, float64(gen))
		r.Parents = append(r.Parents, parents)
		r.Opposite = append(r.Opposite, opposite)
	}
	for _, c := range gardenSeed {
		add(c, 0, [3]float64{-1, -1, -1}, -1)
	}
	queue := []quad{{id: [4]int{0, 1, 2, 3}, last: -1}}
	for head := 0; head < len(queue); head++ {
		p := queue[head]
		for i := 0; i < 4; i++ {
			if i == p.last {
				continue
			}
			if r.Processed == limits.configurations {
				r.Stopped, r.Pending = "configurations", len(queue)-head
				return r, nil
			}
			r.Processed++
			var others [3]int
			for j, k := 0, 0; j < 4; j++ {
				if j != i {
					others[k] = p.id[j]
					k++
				}
			}
			a, b, c, old := circles[others[0]], circles[others[1]], circles[others[2]], circles[p.id[i]]
			nb, ok1 := descartes(a.b, b.b, c.b, old.b)
			nx, ok2 := descartes(a.x, b.x, c.x, old.x)
			ny, ok3 := descartes(a.y, b.y, c.y, old.y)
			if !ok1 || !ok2 || !ok3 {
				return GardenResult{}, errGardenRange
			}
			next := gardenCircle{nb, nx, ny}
			gen := p.gen + 1
			switch {
			case 1/float64(nb) < q.MinRadius:
				r.Omitted.Radius++
				continue
			case gen > q.Depth:
				r.Omitted.Depth++
				continue
			case known[next]:
				r.Duplicates++
				continue
			case len(circles) == q.MaxCircles:
				r.Stopped, r.Pending = "count", len(queue)-head
				return r, nil
			}
			add(next, gen, [3]float64{float64(others[0]), float64(others[1]), float64(others[2])}, float64(p.id[i]))
			child := p
			child.id[i], child.last, child.gen = len(circles)-1, i, gen
			queue = append(queue, child)
		}
	}
	return r, nil
}

// descartes is 2(a + b + c) − old, the circle (or weighted center) on the
// other side of a, b and c, or false beyond ±2^53, where float64 transport
// stops being exact. Inputs are within that range, so nothing overflows.
func descartes(a, b, c, old int64) (int64, bool) {
	const limit = 1 << 53
	for _, v := range []int64{a, b, c, old} {
		if v > limit || v < -limit {
			return 0, false
		}
	}
	v := 2*(a+b+c) - old
	return v, v <= limit && v >= -limit
}
