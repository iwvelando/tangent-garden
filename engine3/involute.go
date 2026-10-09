package engine3

import "math"

// InvoluteRequest anchors arc length s at parameter Anchor, inside the curve's
// domain, and unwinds a taut string of signed initial length Offset (c):
// I_c(t) = r(t) + (c − s(t)) T(t). When Family is enabled, Count strings with
// lengths evenly spaced from From to To replace Offset. With Restart, arc
// length starts again past each break, from an anchor of each further
// stretch's own (see restart).
type InvoluteRequest struct {
	Anchor  float64        `json:"anchor"`
	Offset  float64        `json:"offset"`
	Family  InvoluteFamily `json:"family"`
	Restart bool           `json:"restart,omitempty"`
}
type InvoluteFamily struct {
	Enabled bool    `json:"enabled"`
	From    float64 `json:"from"`
	To      float64 `json:"to"`
	Count   int     `json:"count"`
}

// InvoluteMember is one filament, indexed like the base samples. A nil point
// is unreached: arc length never accumulates across a gap in the curve.
// Collapsed marks a filament whose every point coincides, as for a line.
type InvoluteMember struct {
	Offset    float64 `json:"offset"`
	Points    []*Vec3 `json:"points"`
	Collapsed bool    `json:"collapsed"`
}

// Strings are representative taut strings along the tangent at a sample,
// from the curve through every member of the family. Unreached counts
// regular samples that the arc length could not reach from the anchor.
// Restarts are the anchors it restarted from, in increasing t, when asked.
type InvoluteResult struct {
	Members   []InvoluteMember `json:"members"`
	Strings   []Ruling         `json:"strings"`
	Unreached int              `json:"unreached"`
	Restarts  []float64        `json:"restarts,omitempty"`
}

const (
	maxInvoluteCount  = 24
	maxInvolutePoints = 48000
)

func (q InvoluteRequest) offsets(samples int) ([]float64, error) {
	bounded := func(v float64) bool { return finite(v) && math.Abs(v) <= 1e5 }
	if !q.Family.Enabled {
		if !bounded(q.Offset) {
			return nil, fieldErr("involute.offset", "string length c must be finite and within ±100000")
		}
		return []float64{q.Offset}, nil
	}
	f := q.Family
	if !bounded(f.From) || !bounded(f.To) {
		return nil, fieldErr(map[bool]string{true: "involute.family.to", false: "involute.family.from"}[bounded(f.From)], "family string lengths must be finite and within ±100000")
	}
	if f.Count < 2 || f.Count > maxInvoluteCount {
		return nil, fieldErr("involute.family.count", "an involute family needs 2–%d members", maxInvoluteCount)
	}
	if f.Count*(samples+1) > maxInvolutePoints {
		return nil, fieldErr("involute.family.count", "an involute family is limited to %d points in total (members × samples); use fewer members or samples", maxInvolutePoints)
	}
	// Both entered endpoints are exact, and a descending range stays descending.
	out := make([]float64, f.Count)
	for k := range out {
		w := float64(k) / float64(f.Count-1)
		out[k] = f.From*(1-w) + f.To*w
	}
	return out, nil
}

// involutes measures arc length outward from the anchor with Simpson's rule
// on each sample interval, from speeds at its ends and midpoint, and stops at
// the first invalid sample or break on either side. It returns the arc
// length too, from which refinement evaluates members between samples.
func involutes(q InvoluteRequest, evaluate evaluation, lo, hi float64, base []*Vec3, tangents []Vec3, speeds, middles []float64, breaks []bool, lines int) (*InvoluteResult, *strung, error) {
	n := len(base) - 1
	offsets, err := q.offsets(n)
	if err != nil {
		return nil, nil, err
	}
	t0 := q.Anchor
	if !finite(t0) || t0 < lo || t0 > hi {
		return nil, nil, fieldErr("involute.anchor", "the anchor t₀ must lie within the domain [%.6g, %.6g]", lo, hi)
	}
	h := (hi - lo) / float64(n)
	k := min(n-1, int(math.Floor((t0-lo)/h)))
	speed := func(t float64) float64 {
		_, v, _, ok := evaluate(t)
		if !ok || !v.valid() || v.norm() < 1e-9 {
			return math.NaN()
		}
		return v.norm()
	}
	arc := make([]float64, n+1)
	reached := make([]bool, n+1)
	// open reports whether arc length can be carried across interval i.
	open := func(i int) bool {
		return base[i] != nil && base[i+1] != nil && !breaks[i+1] && finite(middles[i])
	}
	interval := func(i int) float64 { return h / 6 * (speeds[i] + 4*middles[i] + speeds[i+1]) }
	// measure sets s = 0 at t0, inside interval k, and carries it outward
	// to the first break on either side; it reports whether interval k
	// could be split there.
	measure := func(t0 float64, k int) bool {
		tk, tk1 := lo+float64(k)*h, lo+float64(k+1)*h
		at := speed(t0)
		left := (t0 - tk) / 6 * (speeds[k] + 4*speed((tk+t0)/2) + at)
		right := (tk1 - t0) / 6 * (at + 4*speed((t0+tk1)/2) + speeds[k+1])
		if base[k] == nil || base[k+1] == nil || breaks[k+1] || !finite(left) || !finite(right) {
			return false
		}
		arc[k], arc[k+1] = -left, right
		reached[k], reached[k+1] = true, true
		for i := k + 2; i <= n && open(i-1); i++ {
			arc[i], reached[i] = arc[i-1]+interval(i-1), true
		}
		for i := k - 1; i >= 0 && open(i); i-- {
			arc[i], reached[i] = arc[i+1]-interval(i), true
		}
		return true
	}
	if !measure(t0, k) {
		return nil, nil, fieldErr("involute.anchor", "the anchor t₀ must lie on a regular, continuous stretch of the curve it unwinds, not on a cusp or break")
	}
	var restarts []float64
	if q.Restart {
		restarts = restart(n, open, func(i int) bool { return reached[i] }, measure, lo, h)
	}
	out := &InvoluteResult{Members: make([]InvoluteMember, len(offsets)), Strings: make([]Ruling, 0, lines), Restarts: restarts}
	for i := range base {
		if base[i] != nil && !reached[i] {
			out.Unreached++
		}
	}
	for m, c := range offsets {
		points := make([]*Vec3, n+1)
		var first *Vec3
		collapsed := true
		for i := range points {
			if reached[i] {
				p := filament(*base[i], tangents[i], c, arc[i])
				points[i] = &p
				if first == nil {
					first = &p
				}
				// Relative to the string length, so a distant point stays a point.
				collapsed = collapsed && p.sub(*first).norm() <= 1e-9*(1+math.Abs(c)+math.Abs(arc[i]))
			}
		}
		out.Members[m] = InvoluteMember{Offset: c, Points: points, Collapsed: collapsed && first != nil}
	}
	low, high := math.Min(offsets[0], offsets[len(offsets)-1]), math.Max(offsets[0], offsets[len(offsets)-1])
	for j := 0; j < lines; j++ {
		i := j * n / (lines - 1)
		if reached[i] {
			from, to := math.Min(0, low-arc[i]), math.Max(0, high-arc[i])
			out.Strings = append(out.Strings, Ruling{i, base[i].add(tangents[i].mul(from)), base[i].add(tangents[i].mul(to))})
		}
	}
	return out, &strung{evaluate, speed, lo, hi, n, arc, reached, breaks, base, tangents, speeds}, nil
}

// restart anchors arc length again on each stretch of the curve that the
// first anchor's does not reach: on every maximal run of open intervals
// whose samples are unreached, at the middle of the parameters of its first
// and last samples, with s = 0 there. measure carries arc length from an
// anchor t inside interval k across its stretch. It returns the anchors,
// in increasing t. A lone regular sample, with no open interval beside it,
// stays unreached.
func restart(n int, open, reached func(int) bool, measure func(t float64, k int) bool, lo, h float64) []float64 {
	var anchors []float64
	knot := func(i int) float64 { return lo + float64(i)*h }
	for i := 0; i < n; {
		if !open(i) || reached(i) {
			i++
			continue
		}
		j := i
		for j+1 < n && open(j+1) && !reached(j+1) {
			j++
		}
		// Intervals i..j, samples i..j+1: the middle lies in interval m.
		t := (knot(i) + knot(j+1)) / 2
		m := min(j, max(i, int(math.Floor((t-lo)/h))))
		if measure(t, m) {
			anchors = append(anchors, t)
		}
		i = j + 1
	}
	return anchors
}

// filament is the free end of a string of length c unwound by s along the
// tangent T at r. The samples and refinement share this one compiled
// function, so a refined member passes exactly through the samples.
//
//go:noinline
func filament(r, T Vec3, c, s float64) Vec3 { return r.add(T.mul(c - s)) }

// strung is the involute construction's arc length at the samples, from
// which members are evaluated between them.
type strung struct {
	evaluate evaluation
	speed    func(float64) float64
	lo, hi   float64
	n        int
	arc      []float64
	reached  []bool
	breaks   []bool
	base     []*Vec3
	tangents []Vec3
	speeds   []float64
}

// knot is sample i's parameter, as Compute places it.
func (u *strung) knot(i int) float64 {
	return u.lo*(1-float64(i)/float64(u.n)) + u.hi*float64(i)/float64(u.n)
}

// member evaluates the member with string length c at any t between two
// reached samples, nonfinite elsewhere. Its arc length is the sample's own
// at the sample at or before t, carried on to t by the Simpson step the
// samples take, over part of the interval: so it converges at fourth order,
// as at the samples, and is undefined wherever a sample there would be.
func (u *strung) member(c float64) func(float64) Vec3 {
	undefined := Vec3{math.NaN(), 0, 0}
	return func(t float64) Vec3 {
		i := max(0, min(u.n-1, int(math.Floor((t-u.lo)/(u.hi-u.lo)*float64(u.n)))))
		// Restarted stretches meet at a break, across which their arc
		// lengths, from different anchors, do not continue.
		if !u.reached[i] || !u.reached[i+1] || u.breaks[i+1] {
			return undefined
		}
		start := u.knot(i)
		if t == start {
			return filament(*u.base[i], u.tangents[i], c, u.arc[i])
		}
		r, v, _, ok := u.evaluate(t)
		speed := v.norm()
		if !ok || !r.valid() || !v.valid() || speed < 1e-9 {
			return undefined
		}
		s := u.arc[i] + (t-start)/6*(u.speeds[i]+4*u.speed((start+t)/2)+speed)
		return filament(r, v.mul(1/speed), c, s)
	}
}
