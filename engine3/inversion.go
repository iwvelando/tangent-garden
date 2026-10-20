package engine3

import "math"

// InversionRequest inverts a source curve in the sphere of center O and
// radius R: J(p) = O + R²(p − O)/|p − O|². Input names the source: the base
// curve, or its tangent-foot or orthotomic path from the independent pole.
// Composition is bounded to this one level.
type InversionRequest struct {
	Center Vec3    `json:"center"`
	Radius float64 `json:"radius"`
	Input  string  `json:"input"`
}

// InversionCorrespondence joins a source point to its image. Both lie on one
// ray from the center, so the segment is a geometric connector, not a ray.
type InversionCorrespondence struct {
	SampleIndex int  `json:"sampleIndex"`
	Source      Vec3 `json:"source"`
	Image       Vec3 `json:"image"`
}

// InversionResult shares the base's parameter indices. Breaks adds the
// intervals whose source passes through the center (Crossings) to the base's
// breaks: the image leaves through infinity there and must not be joined.
// A projected source runs on through the base's cusps, as the projection
// does (see crossing), and Crossed counts the cusps it joins.
// Invalid counts finite source points without a finite image.
type InversionResult struct {
	Center          Vec3                      `json:"center"`
	Radius          float64                   `json:"radius"`
	Input           string                    `json:"input"`
	Pole            *Vec3                     `json:"pole,omitempty"`
	Source          []*Vec3                   `json:"source"`
	Points          []*Vec3                   `json:"points"`
	Breaks          []bool                    `json:"breaks"`
	Correspondences []InversionCorrespondence `json:"correspondences"`
	Collapsed       bool                      `json:"collapsed"`
	Invalid         int                       `json:"invalid"`
	Crossings       int                       `json:"crossings"`
	Crossed         int                       `json:"crossed,omitempty"`
}

func invert(center Vec3, radius float64, p Vec3) Vec3 {
	d := p.sub(center)
	return center.add(d.mul(radius * radius / d.dot(d)))
}

// source is the point of the source curve at base point r with unit tangent.
func (q InversionRequest) source(pole, r, tangent Vec3) Vec3 {
	if q.Input == "base" {
		return r
	}
	return project(q.Input, pole, r, tangent)
}

func (q InversionRequest) validate(pole Vec3) error {
	bounded := func(v Vec3) bool {
		return v.valid() && math.Max(math.Abs(v.X), math.Max(math.Abs(v.Y), math.Abs(v.Z))) <= 1e5
	}
	if !finite(q.Radius) || q.Radius <= 0 || q.Radius > 1e5 {
		return fieldErr("inversion.radius", "the inversion radius must be finite, positive, and at most 100000")
	}
	if !bounded(q.Center) {
		return fieldErr(axis("inversion.center", q.Center, scalarBounded), "inversion center coordinates must be finite and within ±100000")
	}
	switch q.Input {
	case "base":
	case "tangent-foot", "orthotomic":
		if !bounded(pole) {
			return fieldErr(axis("pole", pole, scalarBounded), "pole coordinates must be finite and within ±100000")
		}
	default:
		return fieldErr("inversion.input", "sphere inversion supports the base curve, tangent-foot, or orthotomic input")
	}
	return nil
}

// along is the source's point at t, with the base's tangent line in place
// of its unit tangent for a projected source, so that it is defined at a
// cusp of the base too (see units.line).
func (q InversionRequest) along(c Request, evaluate evaluation, t float64) (Vec3, bool) {
	r, v, a, ok := evaluate(t)
	if !ok || !r.valid() {
		return Vec3{}, false
	}
	if q.Input == "base" {
		return r, v.valid() && !c.units.still(v)
	}
	line, defined := c.units.line(v, a)
	return q.source(c.Pole, r, line), defined
}

// join is the base's breaks with the cusps of the base that a projected
// source crosses joined (see crossings), where both images beside them
// are defined.
func (q *InversionResult) join(crossing map[int]float64, breaks []bool) []bool {
	out := append([]bool(nil), breaks...)
	for i := range crossing {
		out[i+1] = q.Points[i] == nil || q.Points[i+1] == nil
	}
	return out
}

// inversions evaluates the source pointwise at every sample and interval
// midpoint. Inversion reverses direction along a ray through the center, so
// an image that turns back between a sample and the midpoint marks a passage
// through the center; a near passage the samples cannot resolve is broken the
// same way rather than joined with a chord. A projected source is joined
// across the base's cusps that crossing lists, and the passage test then
// checks those intervals as well. A sample on such a cusp, where the base
// has no tangent and keeps its gap, takes its source on the line along the
// acceleration there.
func inversions(c Request, evaluate evaluation, lo, hi float64, base []*Vec3, tangents []Vec3, breaks []bool, crossing map[int]float64) *InversionResult {
	q := c.Inversion
	n := len(base) - 1
	source := func(r, tangent Vec3) Vec3 { return q.source(c.Pole, r, tangent) }
	at := func(i int) float64 { return lo*(1-float64(i)/float64(n)) + hi*float64(i)/float64(n) }
	out := &InversionResult{Center: q.Center, Radius: q.Radius, Input: q.Input, Source: make([]*Vec3, n+1), Points: make([]*Vec3, n+1), Breaks: append([]bool(nil), breaks...), Correspondences: make([]InversionCorrespondence, 0, c.Lines)}
	if q.Input != "base" {
		out.Pole = &c.Pole
	}
	var first *Vec3
	collapsed := true
	for i, r := range base {
		if r == nil {
			continue
		}
		s := source(*r, tangents[i])
		if !s.valid() {
			out.Invalid++
			continue
		}
		out.Source[i] = &s
		j := invert(q.Center, q.Radius, s)
		if !j.valid() {
			out.Invalid++
			continue
		}
		out.Points[i] = &j
		if first == nil {
			first = &j
		}
		// Rounding is measured against the inversion's radius, its length,
		// and the image point's distance from the center.
		collapsed = collapsed && j.sub(*first).norm() <= 1e-9*(q.Radius+j.sub(q.Center).norm())
	}
	out.Collapsed = collapsed && first != nil
	for i := range crossing {
		for _, j := range []int{i, i + 1} {
			if base[j] != nil || out.Source[j] != nil {
				continue
			}
			s, ok := q.along(c, evaluate, at(j))
			if !ok || !s.valid() {
				continue
			}
			out.Source[j] = &s
			if image := invert(q.Center, q.Radius, s); image.valid() {
				out.Points[j] = &image
			} else {
				out.Invalid++
			}
		}
	}
	if len(crossing) > 0 {
		out.Breaks = out.join(crossing, breaks)
	}
	for i := 0; i < n; i++ {
		a, b := out.Points[i], out.Points[i+1]
		if a == nil || b == nil || out.Breaks[i+1] {
			continue
		}
		s, ok := q.along(c, evaluate, lo+(hi-lo)*(float64(i)+0.5)/float64(n))
		m := invert(q.Center, q.Radius, s)
		crossed := !ok || !m.valid()
		if !crossed {
			before, after := m.sub(*a), b.sub(m)
			// A collapsed image has only roundoff between its points.
			negligible := 1e-9 * (q.Radius + m.sub(q.Center).norm())
			crossed = before.dot(after) < 0 && math.Max(before.norm(), after.norm()) > negligible
		}
		if crossed {
			out.Breaks[i+1] = true
			out.Crossings++
		}
	}
	out.Crossed = crossed(crossing, out.Breaks)
	for j := 0; j < c.Lines; j++ {
		i := j * n / (c.Lines - 1)
		if out.Points[i] != nil {
			out.Correspondences = append(out.Correspondences, InversionCorrespondence{i, *out.Source[i], *out.Points[i]})
		}
	}
	return out
}
