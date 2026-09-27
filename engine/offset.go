package engine

import (
	"fmt"
	"math"
)

// Offset returns the point at signed distance d along the left unit normal,
// positive d toward the left of travel. Only a regular first derivative is
// required: where 1-dκ = 0 the offset has a cusp on the evolute, which is a
// valid point even though the offset's own speed vanishes there.
func Offset(p, derivative Vec, d float64) *Vec {
	if !p.Valid() || !derivative.Valid() || !finite(d) || derivative.Norm() < 1e-9 {
		return nil
	}
	return point(p.Add(derivative.Perp().Unit().Mul(d)))
}

// Stack requests count offsets at evenly spaced distances from From to To,
// in that order, in place of the single offset distance.
type Stack struct {
	Enabled bool    `json:"enabled"`
	From    float64 `json:"from"`
	To      float64 `json:"to"`
	Count   int     `json:"count"`
}

// Path is one member of a family, indexed like the base samples, with nil gaps.
type Path struct {
	Distance float64 `json:"distance"`
	Points   []*Vec  `json:"points"`
}

// Circle is a generating circle centered on the base curve at SampleIndex.
type Circle struct {
	SampleIndex int     `json:"sampleIndex"`
	Center      Vec     `json:"center"`
	Radius      float64 `json:"radius"`
}

// maxStackPoints bounds the work and transfer size of a stack.
const maxStackPoints = 131072

func (s Stack) validate(samples int) error {
	if s.Count < 2 || s.Count > 64 || s.Count*samples > maxStackPoints {
		return fmt.Errorf("offset stacks need 2–64 offsets and at most 131,072 points (offsets × samples)")
	}
	if !finite(s.From) || !finite(s.To) || math.Abs(s.From) > 1e5 || math.Abs(s.To) > 1e5 {
		return fmt.Errorf("offset stack distances must be finite and within ±100000")
	}
	return nil
}

func (s Stack) paths(samples int) []Path {
	paths := make([]Path, s.Count)
	for k := range paths {
		// This form returns both endpoints exactly.
		u := float64(k) / float64(s.Count-1)
		paths[k] = Path{Distance: s.From*(1-u) + s.To*u, Points: make([]*Vec, samples)}
	}
	return paths
}

// span is the signed distance range the stack's normal segments cover,
// extended to include the base curve itself.
func (s Stack) span() (float64, float64) {
	return math.Min(0, math.Min(s.From, s.To)), math.Max(0, math.Max(s.From, s.To))
}
