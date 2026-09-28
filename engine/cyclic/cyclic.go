// Package cyclic integrates a cyclic pursuit in any dimension: pursuer i
// runs straight at pursuer i+1, the last at the first, at its own constant
// speed, p_i′ = v_i (p_{i+1} − p_i) / |p_{i+1} − p_i|. The capture policy,
// step control and budget live here so that planar and spatial chases stop
// by the same rule; callers own validation and sampling.
package cyclic

import (
	"math"
	"tangentgarden/engine/ode"
)

// Capture is the moment a chase stopped: pursuer Pursuer came within the
// capture distance of Target at Time. Indices count from 0. When several
// pairs close at once, the closest is reported, then the lowest index.
type Capture struct {
	Time    float64 `json:"time"`
	Pursuer int     `json:"pursuer"`
	Target  int     `json:"target"`
}

// Chase is an integrated pursuit whose state is the pursuers' positions,
// flattened Dim coordinates at a time. The direction is undefined when a
// pursuer reaches its target, so the chase stops, for every pursuer, the
// first time any pursuer comes within Eps of its own target. Nothing merges
// and nobody changes target. The chase is known from Lo to End: Hi, the
// Capture, or, when Exhausted, where the step budget ran out.
type Chase struct {
	ode.Solution
	Dim       int
	Speeds    []float64
	Eps       float64
	Capture   *Capture
	Exhausted bool
}

// Gap returns the smallest distance from a pursuer to its target in the
// flattened state y, and that pursuer, the lowest index among equals.
func Gap(y []float64, dim int) (float64, int) {
	n := len(y) / dim
	best, at := math.Inf(1), 0
	for i := 0; i < n; i++ {
		if g := distance(y, dim, i, (i+1)%n); g < best {
			best, at = g, i
		} else if math.IsNaN(g) {
			return g, i
		}
	}
	return best, at
}

// distance folds math.Hypot over the coordinates, so a planar chase, or a
// spatial one with every z zero, rounds exactly as the planar chase always
// has; which of several equal gaps closes first can depend on it.
func distance(y []float64, dim, i, j int) float64 {
	d := 0.0
	for k := 0; k < dim; k++ {
		d = math.Hypot(d, y[dim*j+k]-y[dim*i+k])
	}
	return d
}

// Velocity is the pursuit field; it is NaN where a pursuer is on its target.
func (c *Chase) Velocity(_ float64, y, out []float64) {
	n, dim := len(y)/c.Dim, c.Dim
	for i := 0; i < n; i++ {
		j := (i + 1) % n
		// On the target, 0/0 leaves the direction NaN.
		d := distance(y, dim, i, j)
		for k := 0; k < dim; k++ {
			out[dim*i+k] = c.Speeds[i] * (y[dim*j+k] - y[dim*i+k]) / d
		}
	}
}

// Run integrates the chase from the flattened starting positions at lo
// towards hi with the Dormand–Prince 5(4) pair, holding each step's local
// error to tol of the smallest gap at its start, within budget attempted
// steps.
func Run(start []float64, dim int, speeds []float64, eps, lo, hi, tol float64, budget int) *Chase {
	n := len(speeds)
	c := &Chase{Dim: dim, Speeds: speeds, Eps: eps}
	c.F, c.Lo, c.Hi = c.Velocity, lo, hi
	y := append([]float64{}, start...)
	vmax := 0.0
	for _, v := range speeds {
		vmax = math.Max(vmax, v)
	}
	c.Ts, c.Ys = []float64{lo}, [][]float64{y}
	t, h := lo, hi-lo
	for attempts := 0; ; attempts++ {
		g0, i := Gap(y, dim)
		// Within a hair of ε, the pursuer has caught its target. The hair
		// allows for rounding in the pair's own coordinates.
		j := (i + 1) % n
		pair := 0.0
		for k := 0; k < dim; k++ {
			pair = math.Max(pair, math.Max(math.Abs(y[dim*i+k]), math.Abs(y[dim*j+k])))
		}
		if !(g0-eps > 1e-12*eps+1e-14*pair) {
			c.Capture = &Capture{Time: t, Pursuer: i, Target: j}
			c.End = t
			return c
		}
		if t >= hi {
			break
		}
		if attempts >= budget {
			c.Exhausted = true
			break
		}
		// No gap closes faster than the two speeds in it together, so no
		// pursuer can come within ε of its target during a step this short.
		// Near a capture the steps shrink with the remaining gap, and the
		// chase stops once that is negligible.
		if vmax > 0 {
			h = math.Min(h, (g0-eps)/(2*vmax))
		}
		last := t+h >= hi
		if last {
			h = hi - t
		}
		next, e := ode.DormandPrince(c.F, t, y, h, true)
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
				c.Exhausted = true
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
	c.Complete = t >= hi && !c.Exhausted
	return c
}
