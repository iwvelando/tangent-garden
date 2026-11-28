package threebody

import (
	"errors"
	"fmt"
	"math"

	"tangentgarden/engine"
)

// The largest twin perturbation, in length units for a position and
// velocity units for a velocity.
const maxTwin = 0.1

// The separations whose first crossing a comparison reports.
var crossingThresholds = []float64{1e-3, 1e-1}

// Twin is the perturbation that makes a second history from the first: one
// declared component of one body's initial state, Kind "position" or
// "velocity" along Axis "x" or "y", moved by Size. With Conserve the other
// two bodies move together the opposite way by mᵢ·Size/(mⱼ + mₖ) along the
// same component, so the center of mass (for a position) or the momentum
// (for a velocity) is unchanged. Nothing else changes: the masses, the
// other components and the duration are the reference's, and nothing is
// rescaled, recentered or renormalized afterward.
type Twin struct {
	Body     int     `json:"body"`
	Kind     string  `json:"kind"`
	Axis     string  `json:"axis"`
	Size     float64 `json:"size"`
	Conserve bool    `json:"conserve"`
}

// Validate refuses a twin that names no component or moves it by more than
// 0.1, naming the field.
func (w Twin) Validate() error {
	if w.Body < 0 || w.Body > 2 {
		return fieldErr("twin.body", "the twin perturbs body 1, 2 or 3")
	}
	if w.Kind != "position" && w.Kind != "velocity" {
		return fieldErr("twin.kind", "the twin perturbs a position or a velocity")
	}
	if w.Axis != "x" && w.Axis != "y" {
		return fieldErr("twin.axis", "the twin perturbs an x or a y component")
	}
	if !finite(w.Size) || math.Abs(w.Size) > maxTwin {
		return fieldErr("twin.size", "the perturbation must be finite and within ±0.1")
	}
	return nil
}

// move adds d to the twin's component of b.
func (w Twin) move(b *Body, d float64) {
	v := &b.Position
	if w.Kind == "velocity" {
		v = &b.Velocity
	}
	if w.Axis == "y" {
		v.Y += d
	} else {
		v.X += d
	}
}

// Apply returns a copy of bodies with the twin's perturbation; bodies is
// left as it was. The twin must be valid.
func (w Twin) Apply(bodies []Body) []Body {
	out := append([]Body{}, bodies...)
	w.move(&out[w.Body], w.Size)
	if w.Conserve {
		others := 0.0
		for j, b := range bodies {
			if j != w.Body {
				others += b.Mass
			}
		}
		shift := bodies[w.Body].Mass * w.Size / others
		for j := range out {
			if j != w.Body {
				w.move(&out[j], -shift)
			}
		}
	}
	return out
}

// PairRequest is a reference history and its twin, prepared together on
// the reference's sampling plan.
type PairRequest struct {
	Request Request `json:"request"`
	Twin    Twin    `json:"twin"`
}

// Crossing is the first sample time at which the separation reaches
// Threshold, when it does within the comparison.
type Crossing struct {
	Threshold float64 `json:"threshold"`
	Reached   bool    `json:"reached"`
	Time      float64 `json:"time"`
}

// Comparison measures a twin against its reference at their shared
// samples: the first Common of them, which both histories have, ending at
// End. Separation is the farthest any body is from its own twin, body i
// against body i in the integration's coordinates, never aligned, rotated
// or rescaled; SpeedSeparation is the same for velocities. RetainedBytes
// counts both histories and the comparison together.
type Comparison struct {
	Common          int        `json:"common"`
	End             float64    `json:"end"`
	Separation      []float64  `json:"separation"`
	SpeedSeparation []float64  `json:"speedSeparation"`
	Largest         float64    `json:"largest"`
	LargestTime     float64    `json:"largestTime"`
	Crossings       []Crossing `json:"crossings"`
	RetainedBytes   int        `json:"retainedBytes"`
}

// Pair is a prepared reference and twin: the twin's starting state as
// integrated, both histories on the same sampling plan and their
// comparison.
type Pair struct {
	Reference  *Prepared  `json:"reference"`
	Twin       *Prepared  `json:"twin"`
	Bodies     []Body     `json:"bodies"`
	Comparison Comparison `json:"comparison"`
}

// Prepare integrates and samples the reference and its twin, one after the
// other, and compares them.
func (q PairRequest) Prepare() (*Pair, error) { return q.prepare(maxRetained) }

func (q PairRequest) prepare(budget int) (*Pair, error) {
	if err := q.Request.Validate(); err != nil {
		return nil, err
	}
	if err := q.Twin.Validate(); err != nil {
		return nil, err
	}
	twin := q.Request
	twin.Bodies = q.Twin.Apply(q.Request.Bodies)
	if err := twin.Validate(); err != nil {
		var named *engine.FieldError
		if errors.As(err, &named) {
			return nil, fieldErr("twin.size", "the twin's starting state is refused: %s", named.Message)
		}
		return nil, err
	}
	ref, err := q.Request.Prepare()
	if err != nil {
		return nil, err
	}
	other, err := twin.Prepare()
	if err != nil {
		return nil, err
	}
	c := Comparison{Common: min(ref.Available, other.Available)}
	c.Separation = make([]float64, c.Common)
	c.SpeedSeparation = make([]float64, c.Common)
	for _, th := range crossingThresholds {
		c.Crossings = append(c.Crossings, Crossing{Threshold: th})
	}
	for k := 0; k < c.Common; k++ {
		d, v := 0.0, 0.0
		for i := range ref.Paths {
			d = math.Max(d, other.Paths[i].Positions[k].Sub(ref.Paths[i].Positions[k]).Norm())
			v = math.Max(v, other.Paths[i].Velocities[k].Sub(ref.Paths[i].Velocities[k]).Norm())
		}
		c.Separation[k], c.SpeedSeparation[k] = d, v
		if d > c.Largest {
			c.Largest, c.LargestTime = d, ref.Times[k]
		}
		for j := range c.Crossings {
			if x := &c.Crossings[j]; !x.Reached && d >= x.Threshold {
				x.Reached, x.Time = true, ref.Times[k]
			}
		}
	}
	if c.Common > 0 {
		c.End = ref.Times[c.Common-1]
	}
	c.RetainedBytes = ref.Diagnostics.RetainedBytes + other.Diagnostics.RetainedBytes + 2*c.Common*8
	if c.RetainedBytes > budget {
		return nil, fmt.Errorf("the pair needs %d bytes, more than the 64 MiB allowed", c.RetainedBytes)
	}
	return &Pair{Reference: ref, Twin: other, Bodies: twin.Bodies, Comparison: c}, nil
}
