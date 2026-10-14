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
	"math/bits"
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
	// Once every piece is within tolerance, the scan evaluates at most Scan
	// more probes on one path, spent in whole levels: each halves the
	// spacing of every piece's probes, down to the finest step.
	Scan = 4096
	// A scanned piece is refined further when its probes stray beyond the
	// tolerance and more than Unseen times as far as its three quarter
	// points do: something they could not see.
	Unseen = 2
)

// Path is a drawn curve with its refinement. Points and At run in parameter
// order: At is each point's position in sample steps, whole at the uniform
// samples (which are all present, unchanged) and fractional between them. A
// nil point is a break: a uniform sample without a point, an interval the
// uniform study breaks, or one refinement found (Breaks counts the uniform
// intervals it broke). A segment still farther than Tolerance from the
// curve at the finest step, or when the budget ran out (Exhausted), is
// counted in Unresolved. Under a focus with a Scale, Finest is the finest
// tolerance a piece meeting the view was refined to, or 0 if none was finer
// than Tolerance.
type Path[P any] struct {
	Points     []*P
	At         []float64
	Tolerance  float64
	Inserted   int
	Breaks     int
	Unresolved int
	Exhausted  bool
	Finest     float64
}

// Focus is a view to refine more finely than the rest of a path: a segment
// that meets it is refined to Tolerance, finer than the path's own, and to
// chords no longer than Chord, ahead of every segment that does not. Meets
// reports whether the bounding box of points, grown by grow on every side,
// meets the view. Scale, when it is not nil, multiplies Tolerance and Chord
// for a segment that meets the view, from its points and the same growth: a
// perspective's depth, or which of several views it meets.
// A segment whose tolerance is then no finer than the path's own is treated
// as one that does not meet the view.
type Focus[P any] struct {
	Tolerance float64
	Chord     float64
	Meets     func(points []*P, grow float64) bool
	Scale     func(points []*P, grow float64) float64
}

// Metric measures a caller's points: Distance from p to the chord ab, and
// Length of the chord ab.
type Metric[P any] struct {
	Distance func(p, a, b P) float64
	Length   func(a, b P) float64
}

// segment is a piece [a, b] of one uniform interval (positions in sample
// steps) with its end points (nil where undefined) and its probes, the
// curve's points at a + k(b − a)/2^level for k from 1 to 2^level − 1: its
// quarter points (level 2) until the scan adds more. score is the largest
// distance of a probe from the chord, infinite when a probe is undefined;
// quarter is that of the quarter points alone. Under a focus, a segment
// that meets the view is focused, tol is its tolerance, and excess is how
// far it is from both of its limits, as a multiple of them: above 1 when it
// needs refining.
type segment[P any] struct {
	a, b    float64
	pa, pb  *P
	probes  []*P
	level   int
	depth   int
	score   float64
	quarter float64
	focused bool
	tol     float64
	excess  float64
}

// probe is the segment's probe at a + k(b − a)/2^level.
func (s *segment[P]) probe(k int) *P { return s.probes[k-1] }

type segments[P any] []*segment[P]

func (s segments[P]) Len() int { return len(s) }

// Under a focus, the segments that need refining come first, those that
// meet the view ahead of the rest; without one, excess is zero throughout
// and the worst score comes first.
func (s segments[P]) Less(i, j int) bool {
	if over, other := s[i].excess > 1, s[j].excess > 1; over != other {
		return over
	}
	if s[i].focused != s[j].focused {
		return s[i].focused
	}
	if s[i].excess != s[j].excess {
		return s[i].excess > s[j].excess
	}
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
// above tolerance. Once every segment is within tolerance, a scan probes
// them more densely, level by level, for what three probes miss: a segment
// whose probes then see an undefined point, or stray beyond the tolerance
// and Unseen times as far as its quarter points, is refined as before. It
// returns the intervals refinement broke, in order.
func Refine[P any](points []*P, breaks []bool, at func(float64) *P, m Metric[P], lo, hi, tolerance float64, budget int) (*Path[P], []int) {
	return refine(points, breaks, at, m, lo, hi, tolerance, budget, Scan, nil)
}

// RefineFocused is Refine with a view refined more finely, first (see
// Focus). A focus whose tolerance is no finer than tolerance, without a
// Scale, is ignored, so a view that shows the whole path changes nothing.
// Breaks are judged against tolerance alone, so a view does not move them.
func RefineFocused[P any](points []*P, breaks []bool, at func(float64) *P, m Metric[P], lo, hi, tolerance float64, budget int, focus Focus[P]) (*Path[P], []int) {
	if focus.Scale == nil && !(focus.Tolerance < tolerance) {
		return Refine(points, breaks, at, m, lo, hi, tolerance, budget)
	}
	return refine(points, breaks, at, m, lo, hi, tolerance, budget, Scan, &focus)
}

// refine is Refine with at most scan probes for the scan, and an optional
// focus.
func refine[P any](points []*P, breaks []bool, at func(float64) *P, m Metric[P], lo, hi, tolerance float64, budget, scan int, focus *Focus[P]) (*Path[P], []int) {
	n := len(points) - 1
	// The finest tolerance of a segment that met the view, under a Scale.
	finest := 0.0
	param := func(u float64) float64 { return lo*(1-u/float64(n)) + hi*u/float64(n) }
	eval := func(u float64) *P { return at(param(u)) }
	stray := func(s *segment[P], probes []*P) float64 {
		worst := 0.0
		for _, p := range probes {
			if p == nil {
				return math.Inf(1)
			}
			worst = math.Max(worst, m.Distance(*p, *s.pa, *s.pb))
		}
		return worst
	}
	score := func(s *segment[P]) {
		s.tol = tolerance
		if s.pa == nil || s.pb == nil {
			// Only localizing remains: after every segment above
			// tolerance.
			s.score = 2 * tolerance
			if focus != nil {
				s.excess = 2
			}
			return
		}
		q := 1 << (s.level - 2)
		s.quarter = stray(s, []*P{s.probe(q), s.probe(2 * q), s.probe(3 * q)})
		s.score = s.quarter
		if s.level > 2 {
			s.score = stray(s, s.probes)
		}
		if focus == nil {
			return
		}
		// The curve strays from the chord by about score, so a segment
		// whose points' box, grown by that, misses the view cannot show
		// in it.
		points := append([]*P{s.pa, s.pb}, s.probes...)
		s.focused = focus.Meets(points, s.score)
		chord := focus.Chord
		if s.focused {
			s.tol = focus.Tolerance
			if focus.Scale != nil {
				k := focus.Scale(points, s.score)
				s.tol, chord = k*s.tol, k*chord
				if s.focused = s.tol < tolerance; !s.focused {
					s.tol = tolerance
				}
			}
		}
		if s.focused {
			if finest == 0 || s.tol < finest {
				finest = s.tol
			}
			s.excess = math.Max(s.score/s.tol, m.Length(*s.pa, *s.pb)/chord)
		} else {
			s.excess = s.score / s.tol
		}
	}
	// over reports whether a segment needs refining. Without a focus it is
	// the score against the tolerance, exactly as it always was.
	over := func(s *segment[P]) bool {
		if focus == nil {
			return s.score > tolerance
		}
		return s.excess > 1
	}
	// Segments and probe lists are taken from blocks, one allocation for
	// many: allocation costs WASM's collector more than the arithmetic.
	var segmentBlock []segment[P]
	var probeBlock []*P
	probeList := func(n int) []*P {
		if cap(probeBlock)-len(probeBlock) < n {
			probeBlock = make([]*P, 0, max(1024, n))
		}
		k := len(probeBlock)
		probeBlock = probeBlock[:k+n]
		return probeBlock[k : k+n : k+n]
	}
	// A child takes its parent's probes on its half; one with fewer than
	// its quarter points evaluates them around the middle it is given.
	newSegment := func(a, b float64, pa, pb *P, probes []*P, depth int) *segment[P] {
		w := b - a
		if len(segmentBlock) == cap(segmentBlock) {
			segmentBlock = make([]segment[P], 0, 256)
		}
		segmentBlock = append(segmentBlock, segment[P]{a: a, b: b, pa: pa, pb: pb, depth: depth})
		s := &segmentBlock[len(segmentBlock)-1]
		if len(probes) >= 3 {
			s.probes, s.level = probes, bits.Len(uint(len(probes)))
		} else {
			var middle *P
			if len(probes) == 1 {
				middle = probes[0]
			}
			quarter := eval(a + w/4)
			s.probes, s.level = probeList(3), 2
			s.probes[0], s.probes[1], s.probes[2] = quarter, middle, eval(a+3*w/4)
			if middle == nil && depth == 0 {
				s.probes[1] = eval(a + w/2)
			}
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
	// within holds the segments left within tolerance.
	var within []*segment[P]
	// refineQueue bisects the queue's segments worst first until all are
	// within tolerance, which it moves to within, or the budget runs out.
	refineQueue := func() {
		for queue.Len() > 0 {
			s := heap.Pop(&queue).(*segment[P])
			if !over(s) {
				within = append(within, s)
				within = append(within, queue...)
				queue = queue[:0]
				return
			}
			interval := int(math.Floor(s.a))
			if s.depth == Depth {
				switch {
				case s.pa == nil || s.pb == nil:
					// Localized to the finest step: the break stands.
				case s.score == math.Inf(1) || s.score > tolerance && m.Length(*s.pa, *s.pb) > Jump*tolerance:
					// A segment refined this far only for a view is not a
					// jump: breaks do not depend on the view.
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
					if over(rest) && rest.pa != nil && rest.pb != nil {
						path.Unresolved++
					}
				}
				queue = queue[:0]
				return
			}
			mid := (s.a + s.b) / 2
			half := len(s.probes) / 2
			pm := s.probes[half]
			inserted = append(inserted, vertex{mid, pm})
			if pm != nil {
				path.Inserted++
			} else {
				brokenAt[interval] = true
			}
			// A child toward an undefined end is only localizing, so it
			// needs no probes of its own.
			for _, child := range []*segment[P]{
				newSegment(s.a, mid, s.pa, pm, s.probes[:half], s.depth+1),
				newSegment(mid, s.b, pm, s.pb, s.probes[half+1:], s.depth+1),
			} {
				if child.pa == nil && child.pb == nil {
					continue
				}
				heap.Push(&queue, child)
			}
		}
	}
	refineQueue()
	// The scan: each level probes every segment within tolerance at a
	// spacing of 2^−level sample steps, if the whole level fits in what is
	// left of the scan's probes.
	for level := 3; level <= Depth && !path.Exhausted; level++ {
		cost := 0
		for _, s := range within {
			if s.depth+s.level < level {
				cost += 1<<(level-s.depth) - 1<<s.level
			}
		}
		if cost > scan {
			break
		}
		scan -= cost
		sort.Slice(within, func(i, j int) bool { return within[i].a < within[j].a })
		kept := within[:0]
		for _, s := range within {
			if s.depth+s.level >= level {
				kept = append(kept, s)
				continue
			}
			for s.depth+s.level < level {
				w := (s.b - s.a) / float64(int(1)<<(s.level+1))
				probes := probeList(2*len(s.probes) + 1)[:0]
				for k, p := range s.probes {
					probes = append(probes, eval(s.a+float64(2*k+1)*w), p)
				}
				s.probes, s.level = append(probes, eval(s.b-w)), s.level+1
			}
			score(s)
			if s.score > s.tol && s.score > Unseen*s.quarter {
				heap.Push(&queue, s)
			} else {
				kept = append(kept, s)
			}
		}
		within = kept
		refineQueue()
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
	if focus != nil && focus.Scale != nil {
		path.Finest = finest
	}
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

// Reach is what a refined path's points between samples add to the extent
// of its samples: those outside the box of their interval's two samples,
// in order, with their positions in sample steps (see Path). A point inside
// that box lies within the extent of two points already counted; a point
// beside a missing sample has no box, so it reaches. coords gives a
// point's coordinates. Both are nil when nothing reaches.
func Reach[P any](points []*P, at []float64, coords func(P) []float64) ([]P, []float64) {
	var reach []P
	var positions []float64
	var a *P
	for k, p := range points {
		u := at[k]
		if u == math.Trunc(u) {
			a = p
			continue
		}
		if p == nil {
			continue
		}
		// The interval's next sample follows its points between samples.
		j := k + 1
		for at[j] != math.Trunc(at[j]) {
			j++
		}
		b := points[j]
		outside := a == nil || b == nil
		if !outside {
			ca, cb := coords(*a), coords(*b)
			for axis, v := range coords(*p) {
				if v < math.Min(ca[axis], cb[axis]) || v > math.Max(ca[axis], cb[axis]) {
					outside = true
					break
				}
			}
		}
		if outside {
			reach, positions = append(reach, *p), append(positions, u)
		}
	}
	return reach, positions
}
