package engine

import "math"

// A derived loom source is one of the curves the notebook evaluates
// pointwise from its base as a construction input (engine/input.go): the
// evolute, the pedal family about the source's pole, or the offset at its
// distance. The loom evaluates it with that same declared evaluator at any
// base parameter t, never from a sampled polyline, so the source parameter
// is the base curve's own.
var loomDerivedNames = map[string]string{
	"evolute":     "Evolute",
	"pedal":       "Pedal curve",
	"contrapedal": "Contrapedal",
	"orthotomic":  "Orthotomic",
	"offset":      "Offset",
}

// LoomDerivedCharge is the evaluations a derived node is charged against
// the request's budget: the most base-curve evaluations it makes, so the
// budget bounds the base work, not only the number of nodes. The point and
// the base's five-point stencil and its half step take 11; the derived
// input's stencil takes 6 more, and the evolute's, whose half step reuses
// only the points it shares bit for bit, up to 11. A direct node, and a
// base-reference node, costs one.
const LoomDerivedCharge = 22

// LoomBase is a derived source's base curve, refined in the source plane
// alone: its parameters and points, null where the base is undefined.
type LoomBase struct {
	At     []float64 `json:"at"`
	Points []*Vec    `json:"points"`
}

// loomDerived evaluates a derived source at base parameter t, with the
// base's point, its stencil tangent and, for the evolute, the side of the
// tangent its center of curvature lies on, whose sign is the curvature's.
type loomDerived struct {
	input  string
	base   curveFunc
	g      curveFunc
	lo, hi float64
}

type loomAux struct {
	base    Vec
	tangent Vec
	bend    float64
}

// at is the ordinary sample rule (engine.go): the base point must be finite
// and its stencil derivatives stable to the input's order, and then the
// point is the derived input's. Elsewhere it is undefined.
func (d loomDerived) at(t float64) (Vec, loomAux) {
	undefined := Vec{math.NaN(), math.NaN()}
	p := d.base(t)
	dp, ddp := derivatives(d.base, t, d.lo, d.hi)
	stable, _ := baseStencil(d.lo, d.hi).checked(d.base, t, dp, ddp, inputOrder(d.input))
	if !p.Valid() || !stable {
		return undefined, loomAux{}
	}
	g := d.g(t)
	if !g.Valid() {
		return undefined, loomAux{}
	}
	aux := loomAux{base: p, tangent: dp}
	if d.input == "evolute" {
		aux.bend = g.Sub(p).Dot(dp.Perp())
	}
	return g, aux
}

// singular reports whether a derived path may be discontinuous between two
// neighboring nodes: the base tangent reverses (a stationary point of the
// base, where every derived path is undefined and an offset jumps by twice
// its distance), or the evolute's curvature changes sign (an inflection,
// where the center of curvature runs through infinity).
func (d loomDerived) singular(a, b loomNode) bool {
	return a.aux.tangent.Dot(b.aux.tangent) <= 0 || d.input == "evolute" && a.aux.bend*b.aux.bend <= 0
}

// derivedSource is a validated derived curve source's evaluator.
func (s LoomSource) derivedSource(f curveFunc) *loomDerived {
	q := Request{Curve: s.Curve, Input: s.Input, Pole: s.Pole, Distance: s.Distance}
	return &loomDerived{s.Input, f, q.derivedInput(f), s.Curve.Min, s.Curve.Max}
}

// validateDerived checks the source's path and the settings it reads.
func (s LoomSource) validateDerived() error {
	if s.Input == "curve" {
		return nil
	}
	if _, ok := loomDerivedNames[s.Input]; !ok {
		return fieldErr("source.input", "the loom accepts the curve itself, its evolute, pedal, contrapedal, orthotomic or offset")
	}
	if usesPole(s.Input) && !s.Pole.Valid() {
		return fieldErr(coordinate("source.pole", s.Pole, finite), "pole coordinates must be finite numbers")
	}
	if s.Input == "offset" && (!finite(s.Distance) || math.Abs(s.Distance) > 1e5) {
		return fieldErr("source.distance", "offset distance must be finite and within ±100000")
	}
	return nil
}
