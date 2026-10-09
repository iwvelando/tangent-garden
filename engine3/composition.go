package engine3

import "math"

// CompositionResult describes the base curve under a construction that acts
// on a derived input: the base's tangent-foot curve or orthotomic from Pole,
// or its involute (see UnwindingRequest), which then fills the Result's Base
// and is what the construction is built on. Curve and Breaks are the base's
// own samples and breaks, indexed like Base. Constructions join a
// representative base point (Contact) to the foot of the pole's
// perpendicular on its tangent and to the input point (Image), as the
// projections do; for the involute and the coil, the foot is the contact
// itself and the connector is the taut string or the coil's arm. Cusps counts the runs of intervals where the
// input curve stops or turns back while the base continues, and where a
// construction on it is broken rather than joined across: not at an open
// curve's ends, and once where a closed curve's ends meet. Unreached counts
// the base's samples that the involute's arc length cannot reach from its
// anchor across a break; they are not cusps. Restarts are the involute's
// restarted anchors, when its UnwindingRequest asks to restart. The
// involute and the coil leave Pole zero.
type CompositionResult struct {
	Input         string                   `json:"input"`
	Pole          Vec3                     `json:"pole"`
	Curve         []*Vec3                  `json:"curve"`
	Breaks        []bool                   `json:"breaks"`
	Constructions []ProjectionConstruction `json:"constructions"`
	Cusps         int                      `json:"cusps"`
	Unreached     int                      `json:"unreached"`
	Restarts      []float64                `json:"restarts,omitempty"`
}

// composed reports whether the construction acts on a derived input. Only
// the constructions built on a curve take one; the projections, inversion
// (which has its own input) and the curve alone ignore it.
func (c Request) composed() bool {
	switch c.Construction {
	case "", "developable", "involute", "framed", "ruled", "canal":
		return c.Input == "tangent-foot" || c.Input == "orthotomic" || c.Input == "involute" || c.Input == "coil"
	}
	return false
}

// projected reports whether the construction acts on one of the base's
// tangent projections from the pole.
func (c Request) projected() bool {
	return c.composed() && (c.Input == "tangent-foot" || c.Input == "orthotomic")
}

func (c Request) validateInput() error {
	switch c.Input {
	case "", "base", "tangent-foot", "orthotomic", "involute", "coil":
	default:
		return fieldErr("input", "unknown input curve; use the base curve, its tangent-foot curve, its orthotomic, its involute, or a coil")
	}
	if c.composed() && c.Input == "involute" {
		return c.Unwinding.validate()
	}
	if c.composed() && c.Input == "coil" {
		return c.Coil.validate()
	}
	if c.projected() && !poleBounded(c.Pole) {
		return fieldErr(axis("pole", c.Pole, bounded), "pole coordinates must be finite and within ±100000")
	}
	return nil
}

// analytic names the closed-form derivatives of the curve a construction
// acts on: "torus" or "harmonic", or "" when they are numerical, as for
// expressions, integrated paths and every derived input.
func (c Request) analytic() string {
	switch {
	case c.composed():
		return ""
	case c.Format == "" || c.Format == "torus":
		return "torus"
	case c.Format == "harmonic":
		return "harmonic"
	}
	return ""
}

// composedEvaluation evaluates the input curve pointwise from the base's
// position and unit tangent, as sphere inversion does, and differentiates
// it numerically; it never differentiates a sampled path. An expression
// base is itself differentiated at three times its usual step (see compile).
func composedEvaluation(kind string, pole Vec3, base evaluation, lo, hi float64) evaluation {
	return sampled(func(t float64) Vec3 {
		r, v, _, ok := base(t)
		if !ok || !r.valid() || !v.valid() || v.norm() < 1e-9 {
			return Vec3{math.NaN(), 0, 0}
		}
		return project(kind, pole, r, v.unit())
	}, lo, hi, hi-lo)
}

// baseSamples samples the base by the same rules as Compute's sampling
// loop: its points, unit tangents, and breaks. Every base break also breaks
// the input curve, as the projections and inversion break there: across a
// cusp of the base the tangent line, and so its foot, may continue, but the
// correspondence with the base does not.
func baseSamples(c Request, base evaluation, lo, hi float64, n int, closed bool) ([]*Vec3, []Vec3, []bool) {
	curve, tangents, breaks := make([]*Vec3, n+1), make([]Vec3, n+1), make([]bool, n+1)
	at := func(i int) float64 { return lo*(1-float64(i)/float64(n)) + hi*float64(i)/float64(n) }
	for i := 0; i <= n; i++ {
		r, v, _, ok := base(at(i))
		if ok && r.valid() && v.valid() && v.norm() >= 1e-9 {
			curve[i], tangents[i] = &r, v.unit()
		}
	}
	if closed {
		curve[n], tangents[n] = curve[0], tangents[0]
	}
	step := (hi - lo) / float64(n)
	for i := 0; i < n; i++ {
		_, middle, _, ok := base(lo + (hi-lo)*(float64(i)+0.5)/float64(n))
		a, b := curve[i], curve[i+1]
		broken := a == nil || b == nil || !ok || !middle.valid() || middle.norm() < 1e-9 || tangents[i].dot(tangents[i+1]) < 0
		if !broken && c.Format == "parametric" {
			broken = jumps(*a, *b, middle, step)
		}
		breaks[i+1] = broken
	}
	return curve, tangents, breaks
}

// composition describes the base beneath the input curve, whose samples
// and breaks (which include the base's) Compute has found.
// reached marks the samples the involute's arc length reaches, and is nil
// for the projections and the coil, which reach every sample.
func composition(c Request, curve []*Vec3, tangents []Vec3, baseBreaks []bool, closed bool, input []*Vec3, breaks []bool, reached []bool) *CompositionResult {
	n := len(input) - 1
	out := &CompositionResult{Input: c.Input, Curve: curve, Breaks: baseBreaks, Constructions: make([]ProjectionConstruction, 0, c.Lines)}
	if c.projected() {
		out.Pole = c.Pole
	}
	for i := range curve {
		if reached != nil && curve[i] != nil && !reached[i] {
			out.Unreached++
		}
	}
	// A run of intervals where the input is broken but the base is not; a
	// missing input sample breaks both intervals beside it. The involute's
	// unreached samples run from a break of the base to an end of its open
	// domain, so they are never counted as a cusp.
	var runs [][2]int
	for i := 0; i < n; i++ {
		if !breaks[i+1] || baseBreaks[i+1] {
			continue
		}
		if len(runs) > 0 && runs[len(runs)-1][1] == i-1 {
			runs[len(runs)-1][1] = i
		} else {
			runs = append(runs, [2]int{i, i})
		}
	}
	// An open curve has nothing to join across at its ends; a closed one
	// joins them, so a stop there is one cusp.
	for k, run := range runs {
		atStart, atEnd := run[0] == 0, run[1] == n-1
		switch {
		case !closed && (atStart || atEnd):
		case closed && atEnd && k > 0 && runs[0][0] == 0:
		default:
			out.Cusps++
		}
	}
	for j := 0; j < c.Lines; j++ {
		i := j * n / (c.Lines - 1)
		if curve[i] != nil && input[i] != nil {
			if !c.projected() {
				out.Constructions = append(out.Constructions, ProjectionConstruction{i, *curve[i], *curve[i], *input[i]})
				continue
			}
			foot := project("tangent-foot", c.Pole, *curve[i], tangents[i])
			out.Constructions = append(out.Constructions, ProjectionConstruction{i, *curve[i], foot, *input[i]})
		}
	}
	return out
}
