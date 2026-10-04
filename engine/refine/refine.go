// Package refine inserts points between a drawn curve's uniform samples
// wherever the chord joining them strays from the curve. It is shared by the
// planar and spatial engines and knows nothing of their vector types: a
// caller supplies the distance from a point to a chord and the length of a
// chord. The uniform samples stay the study's identity (its constructions,
// reveal and probe); refinement only adds drawn points between them.
package refine

import (
	"container/heap"
	"math"
	"sort"
)

const (
	// Each uniform interval is bisected at most Depth times, so no inserted
	// point is closer than 1/1024 of a sample step to another.
	Depth = 10
	// At most Budget points are inserted into one path.
	Budget = 16384
	// The tolerance is this fraction of the radius fitted to the path's
	// own uniform samples.
	Epsilon = 2e-4
	// A chord still longer than this many tolerances at the finest step
	// cannot belong to a continuous curve there: a jump through a pole.
	Jump = 50
)

// Path is a drawn curve with its refinement. Points and At run in parameter
// order: At is each point's position in sample steps, whole at the uniform
// samples (which are all present, unchanged) and fractional between them. A
// nil point is a break: a uniform sample without a point, an interval the
// uniform study breaks, or one refinement found (Breaks counts the uniform
// intervals it broke). A segment still farther than Tolerance from the
// curve at the finest step, or when the budget ran out (Exhausted), is
// counted in Unresolved.
type Path[P any] struct {
	Points     []*P
	At         []float64
	Tolerance  float64
	Inserted   int
	Breaks     int
	Unresolved int
	Exhausted  bool
}

// Metric measures a caller's points: Distance from p to the chord ab, and
// Length of the chord ab.
type Metric[P any] struct {
	Distance func(p, a, b P) float64
	Length   func(a, b P) float64
}

// segment is a piece [a, b] of one uniform interval (positions in sample
// steps) with its end points (nil where undefined) and three probes at its
// quarter points; score is the largest distance of a probe from the chord,
// infinite when a probe is undefined.
type segment[P any] struct {
	a, b   float64
	pa, pb *P
	probes [3]*P
	depth  int
	score  float64
}

type segments[P any] []*segment[P]

func (s segments[P]) Len() int { return len(s) }
func (s segments[P]) Less(i, j int) bool {
	if s[i].score != s[j].score {
		return s[i].score > s[j].score
	}
	return s[i].a < s[j].a
}
func (s segments[P]) Swap(i, j int) { s[i], s[j] = s[j], s[i] }
func (s *segments[P]) Push(x any)   { *s = append(*s, x.(*segment[P])) }
func (s *segments[P]) Pop() any {
	old := *s
	x := old[len(old)-1]
	*s = old[:len(old)-1]
	return x
}

// Refine refines a path sampled uniformly at n+1 parameters from lo to hi,
// with breaks[i+1] marking a broken interval i, evaluating the curve with at
// (nil where it is undefined). Segments are bisected worst first, so a
// budget that runs out leaves the error evenly spread. A segment with an
// undefined probe is bisected to localize where the curve stops; one with
// an undefined end is bisected only toward that end, after every segment
// above tolerance. It returns the intervals refinement broke, in order.
func Refine[P any](points []*P, breaks []bool, at func(float64) *P, m Metric[P], lo, hi, tolerance float64, budget int) (*Path[P], []int) {
	n := len(points) - 1
	param := func(u float64) float64 { return lo*(1-u/float64(n)) + hi*u/float64(n) }
	eval := func(u float64) *P { return at(param(u)) }
	score := func(s *segment[P]) {
		switch {
		case s.pa == nil || s.pb == nil:
			// Only localizing remains: after every segment above
			// tolerance.
			s.score = 2 * tolerance
		case s.probes[0] == nil || s.probes[1] == nil || s.probes[2] == nil:
			s.score = math.Inf(1)
		default:
			s.score = 0
			for _, p := range s.probes {
				s.score = math.Max(s.score, m.Distance(*p, *s.pa, *s.pb))
			}
		}
	}
	newSegment := func(a, b float64, pa, pb, middle *P, depth int) *segment[P] {
		w := b - a
		s := &segment[P]{a: a, b: b, pa: pa, pb: pb, depth: depth}
		s.probes = [3]*P{eval(a + w/4), middle, eval(a + 3*w/4)}
		if middle == nil && depth == 0 {
			s.probes[1] = eval(a + w/2)
		}
		score(s)
		return s
	}
	queue := segments[P]{}
	for i := 0; i < n; i++ {
		if points[i] != nil && points[i+1] != nil && !breaks[i+1] {
			queue = append(queue, newSegment(float64(i), float64(i+1), points[i], points[i+1], nil, 0))
		}
	}
	heap.Init(&queue)
	type vertex struct {
		u float64
		p *P
	}
	var inserted []vertex
	brokenAt := map[int]bool{}
	path := &Path[P]{Tolerance: tolerance}
	for queue.Len() > 0 {
		s := heap.Pop(&queue).(*segment[P])
		if s.score <= tolerance {
			break
		}
		interval := int(math.Floor(s.a))
		if s.depth == Depth {
			switch {
			case s.pa == nil || s.pb == nil:
				// Localized to the finest step: the break stands.
			case s.score == math.Inf(1) || m.Length(*s.pa, *s.pb) > Jump*tolerance:
				inserted = append(inserted, vertex{(s.a + s.b) / 2, nil})
				brokenAt[interval] = true
			default:
				path.Unresolved++
			}
			continue
		}
		if path.Inserted == budget {
			path.Exhausted = true
			if s.pa != nil && s.pb != nil {
				path.Unresolved++
			}
			for _, rest := range queue {
				if rest.score > tolerance && rest.pa != nil && rest.pb != nil {
					path.Unresolved++
				}
			}
			break
		}
		mid := (s.a + s.b) / 2
		pm := s.probes[1]
		inserted = append(inserted, vertex{mid, pm})
		if pm != nil {
			path.Inserted++
		} else {
			brokenAt[interval] = true
		}
		// A child toward an undefined end is only localizing, so it needs
		// no probes of its own.
		for _, child := range []*segment[P]{
			newSegment(s.a, mid, s.pa, pm, s.probes[0], s.depth+1),
			newSegment(mid, s.b, pm, s.pb, s.probes[2], s.depth+1),
		} {
			if child.pa == nil && child.pb == nil {
				continue
			}
			heap.Push(&queue, child)
		}
	}
	sort.Slice(inserted, func(i, j int) bool { return inserted[i].u < inserted[j].u })
	k := 0
	for i := 0; i <= n; i++ {
		path.Points = append(path.Points, points[i])
		path.At = append(path.At, float64(i))
		if i == n {
			break
		}
		if points[i] == nil || points[i+1] == nil || breaks[i+1] {
			// The uniform study's break, kept in the drawn path.
			path.Points = append(path.Points, nil)
			path.At = append(path.At, float64(i)+0.5)
			continue
		}
		for ; k < len(inserted) && inserted[k].u < float64(i+1); k++ {
			path.Points = append(path.Points, inserted[k].p)
			path.At = append(path.At, inserted[k].u)
		}
	}
	var broken []int
	for i := 0; i < n; i++ {
		if brokenAt[i] {
			broken = append(broken, i)
		}
	}
	path.Breaks = len(broken)
	return path, broken
}

// Radius is the radius a path's tolerance is a fraction of: the largest
// distance from the center of its points' robust bounding box to a point
// inside that box, at least 10⁻⁴, or 1 for a path without points. Along each
// axis, outer Tukey fences (three interquartile ranges beyond the quartiles)
// leave out isolated tails near asymptotes when there are at least eight
// points, as the spatial engine's framing does. coords gives a point's
// coordinates.
func Radius[P any](points []*P, coords func(P) []float64) float64 {
	var values [][]float64
	for _, p := range points {
		if p == nil {
			continue
		}
		c := coords(*p)
		if values == nil {
			values = make([][]float64, len(c))
		}
		for axis, v := range c {
			values[axis] = append(values[axis], v)
		}
	}
	if values == nil {
		return 1
	}
	low, high := make([]float64, len(values)), make([]float64, len(values))
	for axis, vs := range values {
		sort.Float64s(vs)
		l, h := vs[0], vs[len(vs)-1]
		if len(vs) >= 8 {
			q1, q3 := vs[len(vs)/4], vs[3*len(vs)/4]
			if spread := q3 - q1; spread > 1e-12 {
				a, b := q1-3*spread, q3+3*spread
				for _, v := range vs {
					if v >= a {
						l = v
						break
					}
				}
				for j := len(vs) - 1; j >= 0; j-- {
					if vs[j] <= b {
						h = vs[j]
						break
					}
				}
			}
		}
		low[axis], high[axis] = l, h
	}
	radius := 1e-4
	for _, p := range points {
		if p == nil {
			continue
		}
		inside, sum := true, 0.0
		for axis, v := range coords(*p) {
			if v < low[axis] || v > high[axis] {
				inside = false
				break
			}
			d := v - (low[axis]+high[axis])/2
			sum += d * d
		}
		if inside {
			radius = math.Max(radius, math.Sqrt(sum))
		}
	}
	return radius
}
