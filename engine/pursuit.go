package engine

import (
	"fmt"
	"math"
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

// Capture is the moment the chase stopped: pursuer Pursuer came within the
// capture distance of Target at Time. Indices count from 0. When several
// pairs close at once, the closest is reported, then the lowest index.
type Capture struct {
	Time    float64 `json:"time"`
	Pursuer int     `json:"pursuer"`
	Target  int     `json:"target"`
}

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
		case !finite(q.X) || !finite(q.Y) || math.Abs(q.X) > 1e5 || math.Abs(q.Y) > 1e5:
			return fmt.Errorf("pursuer %d: the coordinates must be finite and within ±100000", i+1)
		case !finite(q.Speed) || q.Speed < 0 || q.Speed > 1e5:
			return fmt.Errorf("pursuer %d: the speed must be finite and within 0–100000", i+1)
		}
	}
	if !finite(p.Capture) || p.Capture <= 0 || p.Capture > 1e5 {
		return fmt.Errorf("the capture distance must be finite, positive, and at most 100000")
	}
	return nil
}

// chase is an integrated pursuit, its state the pursuers' flattened
// positions.
type chase struct {
	solution
	speeds    []float64
	eps, tol  float64
	capture   *Capture
	exhausted bool
}

// gap returns the smallest distance from a pursuer to its target, and that
// pursuer, the lowest index among equals.
func gap(y []float64) (float64, int) {
	n := len(y) / 2
	best, at := math.Inf(1), 0
	for i := 0; i < n; i++ {
		j := (i + 1) % n
		if g := math.Hypot(y[2*j]-y[2*i], y[2*j+1]-y[2*i+1]); g < best {
			best, at = g, i
		} else if math.IsNaN(g) {
			return g, i
		}
	}
	return best, at
}

// velocity is the pursuit field; it is NaN where a pursuer is on its target.
func (c *chase) velocity(_ float64, y, out []float64) {
	n := len(y) / 2
	for i := 0; i < n; i++ {
		j := (i + 1) % n
		dx, dy := y[2*j]-y[2*i], y[2*j+1]-y[2*i+1]
		// On the target, 0/0 leaves the direction NaN.
		d := math.Hypot(dx, dy)
		out[2*i], out[2*i+1] = c.speeds[i]*dx/d, c.speeds[i]*dy/d
	}
}

func newChase(p Pursuit, lo, hi, tol float64) *chase {
	n := len(p.Pursuers)
	c := &chase{speeds: make([]float64, n), eps: p.Capture, tol: tol}
	c.F, c.Lo, c.Hi = c.velocity, lo, hi
	y := make([]float64, 2*n)
	vmax := 0.0
	for i, q := range p.Pursuers {
		y[2*i], y[2*i+1], c.speeds[i] = q.X, q.Y, q.Speed
		vmax = math.Max(vmax, q.Speed)
	}
	c.Ts, c.Ys = []float64{lo}, [][]float64{y}
	t, h := lo, hi-lo
	for attempts := 0; ; attempts++ {
		g0, i := gap(y)
		// Within a hair of ε, the pursuer has caught its target. The hair
		// allows for rounding in the pair's own coordinates.
		j := (i + 1) % n
		pair := math.Max(math.Max(math.Abs(y[2*i]), math.Abs(y[2*i+1])), math.Max(math.Abs(y[2*j]), math.Abs(y[2*j+1])))
		if !(g0-c.eps > 1e-12*c.eps+1e-14*pair) {
			c.stop(t, i)
			return c
		}
		if t >= hi {
			break
		}
		if attempts >= maxChaseSteps {
			c.exhausted = true
			break
		}
		// No gap closes faster than the two speeds in it together, so no
		// pursuer can come within ε of its target during a step this short.
		// Near a capture the steps shrink with the remaining gap, and the
		// chase stops once that is negligible.
		if vmax > 0 {
			h = math.Min(h, (g0-c.eps)/(2*vmax))
		}
		last := t+h >= hi
		if last {
			h = hi - t
		}
		next, e := dormandPrince(c.F, t, y, h, true)
		size := 0.0
		for q := range e {
			size = math.Max(size, math.Abs(e[q])/(tol*g0+1e-14*math.Abs(y[q])))
		}
		if math.IsNaN(size) {
			size = math.Inf(1)
		}
		if size > 1 {
			h *= math.Max(.2, .9*math.Pow(size, -.2))
			if t+h == t {
				c.exhausted = true
				break
			}
			continue
		}
		// The step cannot close any gap past ε; rounding can only bring it
		// to ε, and the next pass stops there.
		if t += h; last {
			t = hi
		}
		c.Ts, c.Ys, y = append(c.Ts, t), append(c.Ys, next), next
		if size == 0 {
			h *= 5
		} else {
			h *= math.Min(5, .9*math.Pow(size, -.2))
		}
	}
	c.End = t
	c.Complete = t >= hi && !c.exhausted
	return c
}

func (c *chase) stop(t float64, i int) {
	n := len(c.speeds)
	c.capture = &Capture{Time: t, Pursuer: i, Target: (i + 1) % n}
	c.End = t
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
	out := &PursuitResult{Paths: make([][]*Vec, len(c.speeds)), Polygons: []Polygon{}, Capture: c.capture, Exhausted: c.exhausted, End: c.End}
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
