package engine3

// ProjectionConstruction keeps correspondence explicit: Contact is r(t), Foot
// is H on its tangent, and Image is H (tangent-foot) or 2H−P (orthotomic).
// These are geometric connectors, not rays or unwinding strings.
type ProjectionConstruction struct {
	SampleIndex int  `json:"sampleIndex"`
	Contact     Vec3 `json:"contact"`
	Foot        Vec3 `json:"foot"`
	Image       Vec3 `json:"image"`
}

// ProjectionResult shares the base's parameter indices and interval breaks,
// except across the base's cusps (see crossing): there Breaks, present only
// then, replaces the base's, and Crossed counts the cusps it joins.
// Pole is an independent geometric point, with no optical-source semantics.
// Feet remain available in orthotomic mode to show the midpoint of P–Q.
type ProjectionResult struct {
	Pole          Vec3                     `json:"pole"`
	Points        []*Vec3                  `json:"points"`
	Feet          []*Vec3                  `json:"feet"`
	Breaks        []bool                   `json:"breaks,omitempty"`
	Constructions []ProjectionConstruction `json:"constructions"`
	Collapsed     bool                     `json:"collapsed"`
	Invalid       int                      `json:"invalid"`
	Crossed       int                      `json:"crossed,omitempty"`
}

// project is the pointwise evaluator of both projections, from a contact
// point r and its unit tangent. Sphere inversion composes with it directly
// instead of differentiating a displayed path.
func project(kind string, pole, r, tangent Vec3) Vec3 {
	h := r.add(tangent.mul(pole.sub(r).dot(tangent)))
	if kind == "orthotomic" {
		return h.mul(2).sub(pole)
	}
	return h
}

// Only the base's stable first derivative is required. A vanishing derivative
// of the image (including a collapsed line image) does not invalidate it.
func projections(c Request, base []*Vec3, tangents []Vec3) *ProjectionResult {
	out := &ProjectionResult{Pole: c.Pole, Points: make([]*Vec3, len(base)), Feet: make([]*Vec3, len(base)), Constructions: make([]ProjectionConstruction, 0, c.Lines)}
	var first *Vec3
	collapsed := true
	for i, r := range base {
		if r == nil {
			continue
		}
		h := project("tangent-foot", c.Pole, *r, tangents[i])
		p := project(c.Construction, c.Pole, *r, tangents[i])
		if !h.valid() || !p.valid() {
			out.Invalid++
			continue
		}
		out.Feet[i], out.Points[i] = &h, &p
		if first == nil {
			first = &p
		}
		collapsed = collapsed && p.sub(*first).norm() <= 1e-9*(c.units.size+p.sub(c.Pole).norm())
	}
	out.Collapsed = collapsed && first != nil
	for j := 0; j < c.Lines; j++ {
		i := j * (len(base) - 1) / (c.Lines - 1)
		if out.Points[i] != nil {
			out.Constructions = append(out.Constructions, ProjectionConstruction{i, *base[i], *out.Feet[i], *out.Points[i]})
		}
	}
	return out
}

// cross joins the projection across the base's cusps, the intervals
// crossing lists (see crossings), breaking it where the base is broken
// otherwise. A sample on a cusp, where the base has no tangent and keeps
// its gap, takes the image on the line along the acceleration there.
func (q *ProjectionResult) cross(c Request, base evaluation, crossing map[int]float64, breaks []bool, lo, hi float64) {
	if len(crossing) == 0 {
		return
	}
	n := len(breaks) - 1
	q.Breaks = append([]bool(nil), breaks...)
	for i := range crossing {
		for _, j := range []int{i, i + 1} {
			if q.Points[j] != nil {
				continue
			}
			r, v, a, ok := base(lo*(1-float64(j)/float64(n)) + hi*float64(j)/float64(n))
			line, defined := c.units.line(v, a)
			if !ok || !r.valid() || !defined {
				continue
			}
			h, p := project("tangent-foot", c.Pole, r, line), project(c.Construction, c.Pole, r, line)
			if h.valid() && p.valid() {
				q.Feet[j], q.Points[j] = &h, &p
			}
		}
	}
	for i := range crossing {
		q.Breaks[i+1] = q.Points[i] == nil || q.Points[i+1] == nil
	}
	q.Crossed = crossed(crossing, q.Breaks)
}
