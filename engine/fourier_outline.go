package engine

import (
	"fmt"
	"math"
	"tangentgarden/engine/refine"
)

// FourierOutlineMaxEvaluations bounds all source evaluations, including probes
// discarded by refinement. Expression parsing retains its ordinary size/depth
// bounds. No construction derivatives or integrated solvers run on this path.
const FourierOutlineMaxEvaluations = 32768

const (
	// fourierOutlineSweep is the number of uniform parameter steps of the
	// continuity sweep.
	fourierOutlineSweep = 8192
	// fourierOutlineBisections is how far the sweep bisects a long step before
	// calling it a jump: past any steep but continuous change it can resolve.
	fourierOutlineBisections = 16
)

const fourierOutlineDiscontinuity = "source has a discontinuity or detail too fine to resolve; no discontinuity was joined"

// FourierOutline is a transient approximation in original model units, in
// traversal order. Tolerance describes sampled chord deviation, not a certified
// continuous bound and not the fit's separate 1024-point sample residual.
type FourierOutline struct {
	Points           []Vec   `json:"points"`
	Tolerance        float64 `json:"tolerance"`
	Evaluations      int     `json:"evaluations"`
	ClosureTolerance float64 `json:"closureTolerance"`
	// Open reports entered endpoints further apart than ClosureTolerance. Its
	// polyline ends where the source does; nothing joins them until a closed fit.
	Open bool `json:"open,omitempty"`
}

// FourierCurveOutline admits only direct base curves. It shares the production
// evaluator and refinement's gap/unresolved decisions, but does not require a
// construction tangent: continuous corners and cusps are valid here. An open
// source is admitted and reported as Open, never silently closed.
func FourierCurveOutline(c Curve, input string) (FourierOutline, error) {
	out := FourierOutline{}
	if input != "curve" && input != "" {
		return out, fmt.Errorf("Use a direct base curve, not a derived input")
	}
	switch c.Format {
	case "parametric", "polar", "roulette", "lissajous", "fourier":
	default:
		return out, fmt.Errorf("Use a direct parametric, polar, roulette, Lissajous or Fourier base curve; this source is unavailable")
	}
	start, end := c.Min, c.Max
	if start > end {
		c.Min, c.Max = end, start
	}
	at, err := compile(c)
	if err != nil {
		return out, err
	}
	// Preserve both exact entered endpoints, including descending traversal.
	param := func(u float64) float64 { return start*(1-u) + end*u }
	var failure error
	eval := func(t float64) *Vec {
		if failure != nil {
			return nil
		}
		if out.Evaluations == FourierOutlineMaxEvaluations {
			failure = fmt.Errorf("source approximation could not be resolved within 32768 evaluations")
			return nil
		}
		out.Evaluations++
		p := at(t)
		if !p.Valid() {
			failure = fmt.Errorf("source contains a gap or nonfinite interval; choose a continuous curve")
			return nil
		}
		if math.Abs(p.X) > 1e5 || math.Abs(p.Y) > 1e5 {
			failure = fmt.Errorf("source coordinates must be within ±100000")
			return nil
		}
		return &p
	}
	const intervals = 256
	points := make([]*Vec, intervals+1)
	var low, high Vec
	magnitude := 0.0
	for j := range points {
		p := eval(param(float64(j) / intervals))
		if failure != nil {
			return out, failure
		}
		points[j] = p
		if j == 0 {
			low, high = *p, *p
		}
		low.X = math.Min(low.X, p.X)
		low.Y = math.Min(low.Y, p.Y)
		high.X = math.Max(high.X, p.X)
		high.Y = math.Max(high.Y, p.Y)
		magnitude = math.Max(magnitude, math.Max(math.Abs(p.X), math.Abs(p.Y)))
	}
	extent := high.Sub(low).Norm()
	// Endpoint parameter arithmetic also rounds at the entered parameter's
	// scale. Estimate endpoint speed on a small one-sided step to carry that
	// uncertainty into model units, without needing a tangent at a corner.
	h := (end - start) * 1e-6
	pa, pb := eval(start+h), eval(end-h)
	if failure != nil {
		return out, failure
	}
	speed := math.Max(pa.Sub(*points[0]).Norm(), pb.Sub(*points[intervals]).Norm()) / math.Abs(h)
	out.ClosureTolerance = 32 * 0x1p-52 * (math.Max(extent, magnitude) + speed*math.Max(math.Abs(start), math.Max(math.Abs(end), math.Abs(end-start))))
	if out.ClosureTolerance > 1e-6*extent && extent > 0 {
		return out, fmt.Errorf("source precision cannot resolve endpoint closure at this coordinate/parameter scale")
	}
	out.Open = points[0].Sub(*points[intervals]).Norm() > out.ClosureTolerance
	if extent == 0 {
		return out, fmt.Errorf("source has zero or near-zero length; use an outline at least 0.000001 long")
	}
	out.Tolerance = 1e-4 * extent
	path, _ := refine.RefineFocused(points, make([]bool, len(points)), eval, plane, start, end, out.Tolerance, FourierFitMaxPoints-len(points), refine.Focus[Vec]{
		Tolerance: out.Tolerance / 2, Chord: extent / 32,
		Meets: func([]*Vec, float64) bool { return true },
	})
	if failure != nil {
		return out, failure
	}
	if path.Exhausted {
		return out, fmt.Errorf("source approximation could not be resolved within 4096 outline points; simplify the curve or shorten its domain")
	}
	if path.Unresolved > 0 || path.Breaks > 0 {
		return out, fmt.Errorf(fourierOutlineDiscontinuity)
	}
	length := 0.0
	for j := 1; j < len(path.Points); j++ {
		a, b := path.Points[j-1], path.Points[j]
		if a == nil || b == nil {
			return out, fmt.Errorf("source contains a gap; no discontinuity was joined")
		}
		length += b.Sub(*a).Norm()
	}
	// Probes either side of a jump lie on its chord, so deviation from a chord,
	// here and in the audit below, cannot see one. A step of this sweep is about
	// length/sweep where the curve is continuous and moves evenly. Bisecting a
	// long one follows its longer half: a continuous step soon halves, while a
	// jump stays in it. A jump near or below the step of the sweep can pass.
	long := math.Max(out.Tolerance, 2*length/fourierOutlineSweep)
	previous := points[0]
	for j := 1; j <= fourierOutlineSweep; j++ {
		lo, hi := param(float64(j-1)/fourierOutlineSweep), param(float64(j)/fourierOutlineSweep)
		next := eval(hi)
		if failure != nil {
			return out, failure
		}
		a, b := previous, next
		step := b.Sub(*a).Norm()
		for level := 0; step > long && b.Sub(*a).Norm() > step/2; level++ {
			if level == fourierOutlineBisections {
				return out, fmt.Errorf(fourierOutlineDiscontinuity)
			}
			mid := (lo + hi) / 2
			m := eval(mid)
			if failure != nil {
				return out, failure
			}
			if m.Sub(*a).Norm() >= b.Sub(*m).Norm() {
				hi, b = mid, m
			} else {
				lo, a = mid, m
			}
		}
		previous = next
	}
	// Audit off the refiner's dyadic grid, against each probe's own parameter
	// interval rather than the nearest arbitrary edge of a self-crossing path.
	// This catches common aliasing, but is still a sampled, not certified bound.
	edge := 0
	for j := 0; j < 1021; j++ {
		u := (float64(j) + .3819660112501051) / 1021
		for edge+1 < len(path.At)-1 && path.At[edge+1] < u*intervals {
			edge++
		}
		p := eval(param(u))
		if failure != nil {
			return out, failure
		}
		if plane.Distance(*p, *path.Points[edge], *path.Points[edge+1]) > out.Tolerance {
			return out, fmt.Errorf("source approximation could not be resolved by the off-grid sampling audit")
		}
	}
	for _, p := range path.Points {
		out.Points = append(out.Points, *p)
	}
	if len(out.Points) > FourierFitMaxPoints {
		return FourierOutline{}, fmt.Errorf("source approximation could not be resolved within 4096 outline points")
	}
	// Only rounding-sized endpoint disagreement is snapped, retaining the start.
	if !out.Open {
		out.Points[len(out.Points)-1] = out.Points[0]
	}
	if length < 1e-6 {
		return out, fmt.Errorf("source total length must be at least 0.000001")
	}
	return out, nil
}
