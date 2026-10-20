package engine

import (
	"errors"
	"math"
)

// ComputeOn is Compute on the curve f, a function of t over q.Curve's
// domain, in place of the curve q.Curve's format and formula describe: the
// 3D notebook's shadow of a space curve on a plane is such a curve. The
// domain is checked as always, and f is sampled, differentiated and
// refined as an expression curve would be.
func ComputeOn(q Request, f func(float64) Vec) (Result, error) {
	q.Curve.Format, q.given = "parametric", f
	return Compute(q)
}

// compiled is the curve the request describes, or the one it was given.
func (q Request) compiled() (curveFunc, error) {
	if q.given == nil {
		return compile(q.Curve)
	}
	if err := q.Curve.checkDomain(); err != nil {
		return nil, err
	}
	return q.given, nil
}

var errUnanchored = errors.New("the involute's arc length cannot reach the anchor from the start of the domain")

// contact is where an involute's string leaves its input curve: the
// point and the velocity there.
type contact struct{ p, d Vec }

// AnchoredInvolutes are the involutes of f, or of the derived input q.Input
// built on it, with arc length s measured from the anchor t₀ rather than
// the domain's start: member k is g + (c_k − s)T, the 3D notebook's
// convention, for each string length c_k, as points indexed like the
// samples. The engine's own involute is g − (s₀ + offset)T with s₀ from
// the start, so each member is that involute with offset −c_k − s₀(t₀),
// and s₀(t₀) continues the involute's own arc length at the last sample
// before t₀ by its own Simpson step. The involute is computed once, with
// offset 0, and returned for its warnings; every member is unwound from its
// contacts by Involute, as the sample loop unwinds it, so each is exactly
// the involute computed with its own offset, and refined, when the request
// refines, exactly as that involute would be. An anchor outside the domain,
// or where the involute has stopped or has no point (past a gap, or at a
// cusp's sample), is refused.
func AnchoredInvolutes(q Request, f func(float64) Vec, anchor float64, strings []float64) (Involutes, error) {
	q.Kind, q.Offset = "involute", 0
	adaptive := q.Adaptive
	q.Adaptive = false
	first, err := ComputeOn(q, f)
	out := Involutes{Result: first}
	if err != nil {
		return out, err
	}
	arc, err := first.arcAt(q, anchor)
	if err != nil {
		return out, err
	}
	out.Members = make([][]*Vec, len(strings))
	for k, c := range strings {
		out.Members[k] = make([]*Vec, q.Samples)
		for i, s := range first.arcs {
			if !math.IsNaN(s) {
				out.Members[k][i] = Involute(first.contacts[i].p, first.contacts[i].d, s, -c-arc)
			}
		}
	}
	if adaptive {
		// Each member as the engine refines the involute computed with its
		// own offset: from its own arc lengths, broken where the curve and
		// its input are.
		q.Adaptive = true
		f, g := first.curve, first.input
		_, broken := q.adaptCurves(&first, f, g)
		lo, hi := q.Curve.Min, q.Curve.Max
		step := (hi - lo) / float64(q.Samples-1)
		// Refinement probes every member at the same parameters wherever it
		// has nothing to insert, and they share the input and its arc
		// length there: each is evaluated once for them all.
		stations, arcs := q.sharedStations(f, g), map[float64]float64{}
		for k, c := range strings {
			offset := -c - arc
			at := q.alongStations(stations, func(t float64, p, d, _ Vec) *Vec {
				s, ok := arcs[t]
				if !ok {
					j := q.sampleBefore(t)
					s = q.arcTo(g, lo+float64(j)*step, first.arcs[j], t, d)
					arcs[t] = s
				}
				return Involute(p, d, s, offset)
			})
			path, _ := refinePath(out.Members[k], broken, at, lo, hi, q.View)
			out.Refined = append(out.Refined, path)
		}
	}
	return out, nil
}

// Involutes are a family of anchored involutes: each member's points,
// indexed like the samples, with each refined between samples when the
// request refines, and the involute with offset 0 they are unwound from,
// for its warnings.
type Involutes struct {
	Members [][]*Vec
	Refined []*RefinedPath
	Result  Result
}

// arcAt is a computed involute's arc length from the domain's start to
// the anchor: at the last sample before it, continued by the involute's
// own Simpson step.
func (r Result) arcAt(q Request, anchor float64) (float64, error) {
	lo, hi := q.Curve.Min, q.Curve.Max
	if !(anchor >= lo && anchor <= hi) {
		return 0, errUnanchored
	}
	step := (hi - lo) / float64(q.Samples-1)
	j := min(int((anchor-lo)/step), q.Samples-1)
	t := lo + float64(j)*step
	arc := r.arcs[j]
	if math.IsNaN(arc) {
		return 0, errUnanchored
	}
	if h := anchor - t; h > 0 {
		a, _ := derivatives(r.input, t, lo, hi)
		b, _ := derivatives(r.input, t+h/2, lo, hi)
		d, _ := derivatives(r.input, anchor, lo, hi)
		arc += h / 6 * (a.Norm() + 4*b.Norm() + d.Norm())
	}
	if !finite(arc) {
		return 0, errUnanchored
	}
	return arc, nil
}
