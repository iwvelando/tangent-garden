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

// FourierOutline is a transient approximation in original model units, in
// traversal order. Tolerance describes sampled chord deviation, not a certified
// continuous bound and not the fit's separate 1024-point sample residual.
type FourierOutline struct {
	Points           []Vec   `json:"points"`
	Tolerance        float64 `json:"tolerance"`
	Evaluations      int     `json:"evaluations"`
	ClosureTolerance float64 `json:"closureTolerance"`
	PreviewRadius    float64 `json:"previewRadius,omitempty"`
}

// FourierCurveOutline admits only direct, closed base curves. It shares the
// production evaluator and refinement's gap/unresolved decisions, but does not
// require a construction tangent: continuous corners and cusps are valid here.
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
			failure = fmt.Errorf("source contains a gap or nonfinite interval; choose a continuous closed curve")
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
		u := float64(j) / intervals
		// Preserve both exact entered endpoints, including descending traversal.
		t := start*(1-u) + end*u
		p := eval(t)
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
	if points[0].Sub(*points[intervals]).Norm() > out.ClosureTolerance {
		return out, fmt.Errorf("source is open at the entered endpoints; no closing chord was added")
	}
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
	if path.Exhausted || path.Unresolved > 0 || path.Breaks > 0 {
		return out, fmt.Errorf("source approximation could not be resolved within 4096 outline points; simplify the curve or shorten its domain")
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
		p := eval(start*(1-u) + end*u)
		if failure != nil {
			return out, failure
		}
		a, b := path.Points[edge], path.Points[edge+1]
		if a == nil || b == nil {
			return out, fmt.Errorf("source contains a gap; no discontinuity was joined")
		}
		if plane.Distance(*p, *a, *b) > out.Tolerance {
			return out, fmt.Errorf("source approximation could not be resolved by the off-grid sampling audit")
		}
	}
	for _, p := range path.Points {
		if p == nil {
			return out, fmt.Errorf("source contains a gap; no discontinuity was joined")
		}
		out.Points = append(out.Points, *p)
	}
	if len(out.Points) > FourierFitMaxPoints {
		return FourierOutline{}, fmt.Errorf("source approximation could not be resolved within 4096 outline points")
	}
	// Only rounding-sized endpoint disagreement is snapped, retaining the start.
	out.Points[len(out.Points)-1] = out.Points[0]
	var length float64
	for j := 1; j < len(out.Points); j++ {
		length += out.Points[j].Sub(out.Points[j-1]).Norm()
	}
	if length < 1e-6 {
		return out, fmt.Errorf("source total length must be at least 0.000001")
	}
	return out, nil
}
