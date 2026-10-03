package engine

import (
	"fmt"
	"math"
	"tangentgarden/engine/cyclic"
)

// Pursuer is one member of a cyclic pursuit: it starts at (X, Y) at the
// domain start and always runs straight at the next pursuer, the last at the
// first, at constant Speed.
type Pursuer struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Speed float64 `json:"speed"`
}

// Pursuit is a cyclic pursuit, p_i' = v_i (p_{i+1} − p_i) / |p_{i+1} − p_i|,
// with time t running over the curve's domain. The direction is undefined
// when a pursuer reaches its target, so the chase stops, for every pursuer,
// the first time any pursuer comes within Capture of its own target. Nothing
// merges and nobody changes target. Pursuers that are not chasing each other
// may pass through one another: none steers around the rest.
type Pursuit struct {
	Pursuers []Pursuer `json:"pursuers"`
	Capture  float64   `json:"capture"`
}

// Capture is the moment the chase stopped, shared with spatial pursuit.
type Capture = cyclic.Capture

// Polygon is the pursuers' positions, in chase order, at base sample
// SampleIndex.
type Polygon struct {
	SampleIndex int   `json:"sampleIndex"`
	Points      []Vec `json:"points"`
}

// PursuitResult holds every pursuer's path, indexed like the base samples
// (the first pursuer's path is the base curve), and the connecting polygons
// at representative samples. The chase is known from the domain start to
// End: the domain end, the Capture, or, when Exhausted, the point where the
// integration step budget ran out. Later samples are gaps.
type PursuitResult struct {
	Paths     [][]*Vec  `json:"paths"`
	Polygons  []Polygon `json:"polygons"`
	Capture   *Capture  `json:"capture"`
	Exhausted bool      `json:"exhausted"`
	End       float64   `json:"end"`
}

const (
	maxPursuers = 16
	// Local error per step, relative to the smallest gap at its start: the
	// shape of the chase stays accurate as the pursuers close in.
	chaseTolerance = 1e-12
)

// The budget of attempted integration steps for one chase.
var maxChaseSteps = 40000

func (p Pursuit) validate() error {
	if len(p.Pursuers) < 2 || len(p.Pursuers) > maxPursuers {
		return fmt.Errorf("cyclic pursuit has 2–16 pursuers")
	}
	for i, q := range p.Pursuers {
		switch {
		case !bound(1e5)(q.X) || !bound(1e5)(q.Y):
			return fieldErr(coordinate(fmt.Sprintf("pursuers.%d", i), Vec{q.X, q.Y}, bound(1e5)), "pursuer %d: the coordinates must be finite and within ±100000", i+1)
		case !finite(q.Speed) || q.Speed < 0 || q.Speed > 1e5:
			return fieldErr(fmt.Sprintf("pursuers.%d.speed", i), "pursuer %d: the speed must be finite and within 0–100000", i+1)
		}
	}
	if !finite(p.Capture) || p.Capture <= 0 || p.Capture > 1e5 {
		return fieldErr("capture", "the capture distance must be finite, positive, and at most 100000")
	}
	return nil
}

// chase is an integrated planar pursuit.
type chase struct{ *cyclic.Chase }

func newChase(p Pursuit, lo, hi, tol float64) *chase {
	y, speeds := make([]float64, 2*len(p.Pursuers)), make([]float64, len(p.Pursuers))
	for i, q := range p.Pursuers {
		y[2*i], y[2*i+1], speeds[i] = q.X, q.Y, q.Speed
	}
	return &chase{cyclic.Run(y, 2, speeds, p.Capture, lo, hi, tol, maxChaseSteps)}
}

// at returns every pursuer's position at t, while the chase is known.
func (c *chase) at(t float64) ([]Vec, bool) {
	y, ok := c.State(t)
	if !ok {
		return nil, false
	}
	out := make([]Vec, len(y)/2)
	for i := range out {
		out[i] = Vec{y[2*i], y[2*i+1]}
	}
	return out, true
}

// pursuer returns the path of pursuer i, which is a gap outside the chase.
func (c *chase) pursuer(i int) curveFunc {
	return func(t float64) Vec {
		ps, ok := c.at(t)
		if !ok {
			return Vec{math.NaN(), math.NaN()}
		}
		return ps[i]
	}
}

func newPursuitResult(c *chase, samples int) *PursuitResult {
	out := &PursuitResult{Paths: make([][]*Vec, len(c.Speeds)), Polygons: []Polygon{}, Capture: c.Capture, Exhausted: c.Exhausted, End: c.End}
	for i := range out.Paths {
		out.Paths[i] = make([]*Vec, samples)
	}
	return out
}

// sample records every pursuer's position at base sample j, and the
// connecting polygon when it is a representative sample.
func (r *PursuitResult) sample(c *chase, j int, t float64, line bool) {
	ps, ok := c.at(t)
	if !ok {
		return
	}
	for i, p := range ps {
		r.Paths[i][j] = point(p)
	}
	if line {
		r.Polygons = append(r.Polygons, Polygon{SampleIndex: j, Points: ps})
	}
}
