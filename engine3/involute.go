package engine3

import "math"

// InvoluteRequest anchors arc length s at parameter Anchor, inside the curve's
// domain, and unwinds a taut string of signed initial length Offset (c):
// I_c(t) = r(t) + (c − s(t)) T(t). When Family is enabled, Count strings with
// lengths evenly spaced from From to To replace Offset.
type InvoluteRequest struct {
	Anchor float64        `json:"anchor"`
	Offset float64        `json:"offset"`
	Family InvoluteFamily `json:"family"`
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
type InvoluteResult struct {
	Members   []InvoluteMember `json:"members"`
	Strings   []Ruling         `json:"strings"`
	Unreached int              `json:"unreached"`
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
// the first invalid sample or break on either side.
func involutes(q InvoluteRequest, evaluate evaluation, lo, hi float64, base []*Vec3, tangents []Vec3, speeds, middles []float64, breaks []bool, lines int) (*InvoluteResult, error) {
	n := len(base) - 1
	offsets, err := q.offsets(n)
	if err != nil {
		return nil, err
	}
	t0 := q.Anchor
	if !finite(t0) || t0 < lo || t0 > hi {
		return nil, fieldErr("involute.anchor", "the anchor t₀ must lie within the domain [%.6g, %.6g]", lo, hi)
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
	tk, tk1 := lo+float64(k)*h, lo+float64(k+1)*h
	at := speed(t0)
	left := (t0 - tk) / 6 * (speeds[k] + 4*speed((tk+t0)/2) + at)
	right := (tk1 - t0) / 6 * (at + 4*speed((t0+tk1)/2) + speeds[k+1])
	if base[k] == nil || base[k+1] == nil || breaks[k+1] || !finite(left) || !finite(right) {
		return nil, fieldErr("involute.anchor", "the anchor t₀ must lie on a regular, continuous stretch of the curve it unwinds, not on a cusp or break")
	}
	arc := make([]float64, n+1)
	reached := make([]bool, n+1)
	arc[k], arc[k+1] = -left, right
	reached[k], reached[k+1] = true, true
	interval := func(i int) float64 { return h / 6 * (speeds[i] + 4*middles[i] + speeds[i+1]) }
	for i := k + 2; i <= n && base[i] != nil && !breaks[i] && finite(middles[i-1]); i++ {
		arc[i], reached[i] = arc[i-1]+interval(i-1), true
	}
	for i := k - 1; i >= 0 && base[i] != nil && !breaks[i+1] && finite(middles[i]); i-- {
		arc[i], reached[i] = arc[i+1]-interval(i), true
	}
	out := &InvoluteResult{Members: make([]InvoluteMember, len(offsets)), Strings: make([]Ruling, 0, lines)}
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
				p := base[i].add(tangents[i].mul(c - arc[i]))
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
	return out, nil
}
