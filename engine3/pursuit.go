package engine3

import (
	"fmt"
	"math"
	"tangentgarden/engine/cyclic"
)

// SpatialPursuer starts at (X, Y, Z) at the interval start and always runs
// straight at the next pursuer, the last at the first, at constant Speed.
type SpatialPursuer struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Z     float64 `json:"z"`
	Speed float64 `json:"speed"`
}

// PursuitRequest is a spatial cyclic pursuit, p_i′ = v_i (p_{i+1} − p_i) /
// |p_{i+1} − p_i|, with time t running from Min to Max. It keeps the planar
// capture policy: the chase stops, for every pursuer, the first time any
// pursuer comes within Capture of its own target. Nothing merges, nobody
// changes target, and pursuers that are not chasing one another may pass
// through each other. The first pursuer's path is the base curve that every
// construction uses.
type PursuitRequest struct {
	Pursuers []SpatialPursuer `json:"pursuers"`
	Capture  float64          `json:"capture"`
	Min      float64          `json:"min"`
	Max      float64          `json:"max"`
}

// PursuitPolygon is the pursuers' positions, in chase order, at base sample
// SampleIndex.
type PursuitPolygon struct {
	SampleIndex int    `json:"sampleIndex"`
	Points      []Vec3 `json:"points"`
}

// PursuitResult holds every pursuer's path, indexed like the base samples
// (the first is the base curve), and the connecting polygons at the
// representative samples. The chase is known from Min to End: Max, the
// Capture, or, when Exhausted, where the step budget ran out. Later samples
// are gaps. Final is every pursuer's position at End.
type PursuitResult struct {
	Paths     [][]*Vec3        `json:"paths"`
	Polygons  []PursuitPolygon `json:"polygons"`
	Capture   *cyclic.Capture  `json:"capture"`
	Exhausted bool             `json:"exhausted"`
	End       float64          `json:"end"`
	Final     []Vec3           `json:"final"`
}

const maxPursuers = 16

// Local error per step, relative to the smallest gap at its start, as for
// the planar chase, and the budget of attempted steps. Variables so tests
// can refine and exhaust them.
var (
	chaseTolerance = 1e-12
	maxChaseSteps  = 40000
)

func (p PursuitRequest) validate() error {
	if len(p.Pursuers) < 2 || len(p.Pursuers) > maxPursuers {
		return fmt.Errorf("spatial cyclic pursuit has 2–16 pursuers")
	}
	for i, q := range p.Pursuers {
		switch {
		case !(Vec3{q.X, q.Y, q.Z}).valid() || math.Max(math.Abs(q.X), math.Max(math.Abs(q.Y), math.Abs(q.Z))) > 1e5:
			return fieldErr(axis(fmt.Sprintf("pursuit.pursuers.%d", i), Vec3{q.X, q.Y, q.Z}, bounded), "pursuer %d: the coordinates must be finite and within ±100000", i+1)
		case !finite(q.Speed) || q.Speed < 0 || q.Speed > 1e5:
			return fieldErr(fmt.Sprintf("pursuit.pursuers.%d.speed", i), "pursuer %d: the speed must be finite and within 0–100000", i+1)
		}
	}
	if !finite(p.Capture) || p.Capture <= 0 || p.Capture > 1e5 {
		return fieldErr("pursuit.capture", "the capture distance must be finite, positive, and at most 100000")
	}
	return nil
}

// spatialChase is an integrated spatial pursuit.
type spatialChase struct{ *cyclic.Chase }

func (p PursuitRequest) compile() (*spatialChase, error) {
	if err := domain(p.Min, p.Max); err != nil {
		return nil, named(ends("pursuit.min", "pursuit.max", p.Min), err)
	}
	if err := p.validate(); err != nil {
		return nil, err
	}
	y, speeds := make([]float64, 3*len(p.Pursuers)), make([]float64, len(p.Pursuers))
	for i, q := range p.Pursuers {
		y[3*i], y[3*i+1], y[3*i+2], speeds[i] = q.X, q.Y, q.Z, q.Speed
	}
	return &spatialChase{cyclic.Run(y, 3, speeds, p.Capture, p.Min, p.Max, chaseTolerance, maxChaseSteps)}, nil
}

// positions returns every pursuer's position at t, or nil outside the chase.
func (c *spatialChase) positions(t float64) []Vec3 {
	y, ok := c.State(t)
	if !ok {
		return nil
	}
	out := make([]Vec3, len(y)/3)
	for i := range out {
		out[i] = Vec3{y[3*i], y[3*i+1], y[3*i+2]}
	}
	return out
}

// evaluation is the first pursuer's path as a curve. Its velocity is the
// pursuit law itself, v₁u with u the unit vector to pursuer 2 at gap d, and
// its acceleration the exact derivative of that law, (v₁/d)(w − (u·w)u) for
// the closing velocity w = p₂′ − p₁′. Nothing is differentiated numerically.
func (c *spatialChase) evaluation() evaluation {
	return func(t float64) (Vec3, Vec3, Vec3, bool) {
		ps := c.positions(t)
		if ps == nil {
			nan := Vec3{math.NaN(), math.NaN(), math.NaN()}
			return nan, nan, nan, false
		}
		n := len(ps)
		heading := func(i int) Vec3 { return ps[(i+1)%n].sub(ps[i]).unit().mul(c.Speeds[i]) }
		gap := ps[1].sub(ps[0])
		d := gap.norm()
		u, v := gap.mul(1/d), heading(0)
		w := heading(1).sub(v)
		a := w.sub(u.mul(u.dot(w))).mul(c.Speeds[0] / d)
		return ps[0], v, a, ps[0].valid() && v.valid()
	}
}

// pursuitGeometry samples every path at the base samples, with the
// connecting polygons at the representative ones, and returns the paths to
// be framed.
func pursuitGeometry(c Request, ch *spatialChase) (*PursuitResult, [][]*Vec3) {
	n, lo, hi := c.Samples, c.Pursuit.Min, c.Pursuit.Max
	k := len(ch.Speeds)
	out := &PursuitResult{Paths: make([][]*Vec3, k), Polygons: []PursuitPolygon{}, Capture: ch.Capture, Exhausted: ch.Exhausted, End: ch.End, Final: ch.positions(ch.End)}
	for j := range out.Paths {
		out.Paths[j] = make([]*Vec3, n+1)
	}
	at := func(i int) []Vec3 {
		return ch.positions(lo*(1-float64(i)/float64(n)) + hi*float64(i)/float64(n))
	}
	for i := 0; i <= n; i++ {
		for j, p := range at(i) {
			out.Paths[j][i] = &p
		}
	}
	for line := 0; line < c.Lines; line++ {
		i := line * n / (c.Lines - 1)
		if ps := at(i); ps != nil {
			out.Polygons = append(out.Polygons, PursuitPolygon{SampleIndex: i, Points: ps})
		}
	}
	return out, out.Paths
}
