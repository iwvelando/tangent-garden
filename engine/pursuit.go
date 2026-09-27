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

// chase is an integrated pursuit: the accepted Dormand–Prince steps from
// states ys at times ts. A state between two steps is one step of the same
// method from the earlier, so positions are smooth in t within each step and
// continuous across them.
type chase struct {
	speeds    []float64
	eps, tol  float64
	lo, hi    float64
	ts        []float64
	ys        [][]float64
	capture   *Capture
	exhausted bool
	end       float64
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
func (c *chase) velocity(y, out []float64) {
	n := len(y) / 2
	for i := 0; i < n; i++ {
		j := (i + 1) % n
		dx, dy := y[2*j]-y[2*i], y[2*j+1]-y[2*i+1]
		// On the target, 0/0 leaves the direction NaN.
		d := math.Hypot(dx, dy)
		out[2*i], out[2*i+1] = c.speeds[i]*dx/d, c.speeds[i]*dy/d
	}
}

// Dormand–Prince 5(4) coefficients.
var (
	dpA = [6][]float64{
		{1.0 / 5},
		{3.0 / 40, 9.0 / 40},
		{44.0 / 45, -56.0 / 15, 32.0 / 9},
		{19372.0 / 6561, -25360.0 / 2187, 64448.0 / 6561, -212.0 / 729},
		{9017.0 / 3168, -355.0 / 33, 46732.0 / 5247, 49.0 / 176, -5103.0 / 18656},
		{35.0 / 384, 0, 500.0 / 1113, 125.0 / 192, -2187.0 / 6784, 11.0 / 84},
	}
	// The fifth-order solution minus the embedded fourth-order one.
	dpE = [7]float64{71.0 / 57600, 0, -71.0 / 16695, 71.0 / 1920, -17253.0 / 339200, 22.0 / 525, -1.0 / 40}
)

// step advances y by h with the fifth-order solution, and returns the
// embedded error estimate when asked.
func (c *chase) step(y []float64, h float64, estimate bool) (next, err []float64) {
	m := len(y)
	var k [7][]float64
	stage := make([]float64, m)
	k[0] = make([]float64, m)
	c.velocity(y, k[0])
	for s, row := range dpA {
		for q := range stage {
			sum := 0.0
			for r, a := range row {
				sum += a * k[r][q]
			}
			stage[q] = y[q] + h*sum
		}
		k[s+1] = make([]float64, m)
		c.velocity(stage, k[s+1])
	}
	// The last stage is evaluated at the fifth-order solution itself.
	next = append([]float64{}, stage...)
	if estimate {
		err = make([]float64, m)
		for q := range err {
			for r, e := range dpE {
				err[q] += h * e * k[r][q]
			}
		}
	}
	return next, err
}

func newChase(p Pursuit, lo, hi, tol float64) *chase {
	n := len(p.Pursuers)
	c := &chase{speeds: make([]float64, n), eps: p.Capture, tol: tol, lo: lo, hi: hi}
	y := make([]float64, 2*n)
	vmax := 0.0
	for i, q := range p.Pursuers {
		y[2*i], y[2*i+1], c.speeds[i] = q.X, q.Y, q.Speed
		vmax = math.Max(vmax, q.Speed)
	}
	c.ts, c.ys = []float64{lo}, [][]float64{y}
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
		next, e := c.step(y, h, true)
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
		c.ts, c.ys, y = append(c.ts, t), append(c.ys, next), next
		if size == 0 {
			h *= 5
		} else {
			h *= math.Min(5, .9*math.Pow(size, -.2))
		}
	}
	c.end = t
	return c
}

func (c *chase) stop(t float64, i int) {
	n := len(c.speeds)
	c.capture = &Capture{Time: t, Pursuer: i, Target: (i + 1) % n}
	c.end = t
}

func (c *chase) steps() int { return len(c.ts) - 1 }

// at returns every pursuer's position at t, while the chase is known.
func (c *chase) at(t float64) ([]Vec, bool) {
	if t > c.end && c.end == c.hi && c.capture == nil && !c.exhausted && t-c.end <= 1e-12*(c.hi-c.lo) {
		// The last sample can land a rounding error past the domain end.
		t = c.end
	}
	if !(t >= c.lo && t <= c.end) {
		return nil, false
	}
	// The last accepted step starting at or before t.
	k, top := 0, len(c.ts)-1
	for k < top {
		mid := (k + top + 1) / 2
		if c.ts[mid] <= t {
			k = mid
		} else {
			top = mid - 1
		}
	}
	y := c.ys[k]
	if s := t - c.ts[k]; s > 0 {
		y, _ = c.step(y, s, false)
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
	out := &PursuitResult{Paths: make([][]*Vec, len(c.speeds)), Polygons: []Polygon{}, Capture: c.capture, Exhausted: c.exhausted, End: c.end}
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
