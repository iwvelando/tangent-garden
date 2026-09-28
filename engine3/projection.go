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

// ProjectionResult shares the base's parameter indices and interval breaks.
// Pole is an independent geometric point, with no optical-source semantics.
// Feet remain available in orthotomic mode to show the midpoint of P–Q.
type ProjectionResult struct {
	Pole          Vec3                     `json:"pole"`
	Points        []*Vec3                  `json:"points"`
	Feet          []*Vec3                  `json:"feet"`
	Constructions []ProjectionConstruction `json:"constructions"`
	Collapsed     bool                     `json:"collapsed"`
	Invalid       int                      `json:"invalid"`
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
		collapsed = collapsed && p.sub(*first).norm() <= 1e-9*(1+p.sub(c.Pole).norm())
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
