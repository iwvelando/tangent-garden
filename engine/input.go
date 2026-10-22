package engine

import (
	"math"
)

// A construction acts on its input: the base curve itself ("curve", or
// empty), or one of the derived curves defined pointwise from it, "evolute",
// "pedal", "contrapedal", "orthotomic" (with the request's pole), or
// "offset" (at its distance). Constructions built by integrating along the
// curve (the involute, rolling) or as envelopes of a family are not inputs.

// composed reports whether the input is a derived curve.
func composed(input string) bool { return input != "" && input != "curve" }

func validateInput(input, kind string, pole Vec) error {
	if inputOrder(input)+constructionOrder(kind) > 3 {
		return fieldErr("input", "an evolute's evolute or caustics would need the curve's fourth derivative, which finite differences cannot resolve reliably; choose another input or construction")
	}
	switch input {
	case "", "curve", "evolute", "offset":
	case "pedal", "contrapedal", "orthotomic":
		if !pole.Valid() {
			return fieldErr(coordinate("pole", pole, finite), "pole coordinates must be finite numbers")
		}
	default:
		return fieldErr("input", "construct on the curve, its evolute, pedal, contrapedal, orthotomic, or offset")
	}
	return nil
}

// inputOrder is the number of the base's derivatives an input needs: none for
// the base, which may have cusps, the second for the evolute, and the first
// for the others.
func inputOrder(input string) int {
	switch {
	case !composed(input):
		return 0
	case input == "evolute":
		return 2
	}
	return 1
}

// inputSpacing is the stencil spacing, as a fraction of the domain, for the
// base derivatives that define a derived input. The construction then
// differentiates the input at the base's own spacing, which divides the
// input's rounding by that spacing once per derivative; three times the
// base's spacing keeps an evolute's rounding small enough to differentiate
// once, and its truncation small over many turns of the curve.
const inputSpacing = 3e-4

// inputCurve evaluates the input at any t from the base's evaluator and its
// stencil derivatives, never from sampled points. It is undefined (NaN)
// wherever the derived curve is. Conditioning is checked where it is used:
// the base's derivatives at each sample, and the input's own derivatives,
// whose noise an ill-conditioned base derivative would show.
func inputCurve(input string, f curveFunc, lo, hi float64, pole Vec, distance float64) curveFunc {
	if !composed(input) {
		return f
	}
	s := stencil{lo, hi, (hi - lo) * inputSpacing, 1e-8}
	return func(t float64) Vec {
		var q *Vec
		if input == "evolute" {
			// The evolute also needs the half step's r″ to judge whether
			// its curvature is resolved.
			q = evolute(s.withHalf(f, t))
		} else {
			dp, ddp := s.derivatives(f, t)
			q = derive(input, f(t), dp, ddp, pole, distance)
		}
		if q == nil {
			return Vec{math.NaN(), math.NaN()}
		}
		return *q
	}
}

// derive is an input other than the evolute, which needs the half step too.
func derive(input string, p, dp, ddp, pole Vec, distance float64) *Vec {
	switch input {
	case "pedal", "contrapedal", "orthotomic":
		return polePoint(input, p, dp, ddp, pole)
	}
	return offsetPoint(p, dp, ddp, distance)
}
