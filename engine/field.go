package engine

import (
	"fmt"
	"math"
	"strings"
	"tangentgarden/engine/expr"
)

// Seed is where a trajectory starts, at the domain start.
type Seed struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// VectorField is the planar system ẋ = X(x, y, t), ẏ = Y(x, y, t), with time
// t running over the curve's domain from each seed. A trajectory ends early
// the first time it leaves the circle of radius Escape about the origin, or
// where the field stops being finite along it. Trajectories are independent:
// one ending never stops another.
type VectorField struct {
	X      string  `json:"x"`
	Y      string  `json:"y"`
	Seeds  []Seed  `json:"seeds"`
	Escape float64 `json:"escape"`
}

// TrajectoryEnd is where and why a trajectory stopped: "end" at the domain
// end, "escape" where it leaves the escape circle (at the domain start for a
// seed outside it), "singular" where the field is not finite or the step
// size collapses, or "exhausted" where the integration step budget ran out.
type TrajectoryEnd struct {
	Time   float64 `json:"time"`
	Reason string  `json:"reason"`
}

// Arrow is the field's value at a trajectory's position at base sample
// SampleIndex.
type Arrow struct {
	SampleIndex int `json:"sampleIndex"`
	Seed        int `json:"seed"`
	Point       Vec `json:"point"`
	Velocity    Vec `json:"velocity"`
}

// Direction is the field's value at a lattice point.
type Direction struct {
	Point    Vec `json:"point"`
	Velocity Vec `json:"velocity"`
}

// Grid is the direction field on a square lattice of the given spacing.
type Grid struct {
	Spacing float64     `json:"spacing"`
	Points  []Direction `json:"points"`
}

// FieldResult holds every trajectory, indexed like the base samples (the
// first is the base curve), the field along them at representative samples,
// and why each one ended. Samples after a trajectory's end are gaps. Timed
// is whether the field's expressions read t; only a field that does not has
// a single direction field, Grid, spanning the trajectories. Where the field
// is zero or not finite, the lattice has no point.
type FieldResult struct {
	Paths  [][]*Vec        `json:"paths"`
	Arrows []Arrow         `json:"arrows"`
	Ends   []TrajectoryEnd `json:"ends"`
	Timed  bool            `json:"timed"`
	Grid   Grid            `json:"grid"`
}

const (
	maxSeeds = 16
	// Lattice points along the longer side of the direction field.
	gridPoints = 21
	// Local error per step, relative to the distance from the origin with a
	// floor of 10⁻⁶ of the escape radius.
	fieldTolerance = 1e-10
)

// The budget of attempted integration steps for one trajectory.
var maxFieldSteps = 50000

func (v VectorField) validate() error {
	if len(v.Seeds) < 1 || len(v.Seeds) > maxSeeds {
		return fmt.Errorf("a vector field has 1–16 seeds")
	}
	for i, s := range v.Seeds {
		if !finite(s.X) || !finite(s.Y) || math.Abs(s.X) > 1e5 || math.Abs(s.Y) > 1e5 {
			return fmt.Errorf("seed %d: the coordinates must be finite and within ±100000", i+1)
		}
	}
	if !finite(v.Escape) || v.Escape <= 0 || v.Escape > 1e5 {
		return fmt.Errorf("the escape radius must be finite, positive, and at most 100000")
	}
	return nil
}

// system parses the field, binding the shape parameter a, and reports
// whether it reads t.
func (v VectorField) system(a float64) (odeFunc, bool, error) {
	x, tx, err := expr.ParseField(v.X, a)
	if err != nil {
		return nil, false, fmt.Errorf("dx/dt: %w", err)
	}
	y, ty, err := expr.ParseField(v.Y, a)
	if err != nil {
		return nil, false, fmt.Errorf("dy/dt: %w", err)
	}
	return func(t float64, p, out []float64) {
		out[0], out[1] = x(p[0], p[1], t), y(p[0], p[1], t)
	}, tx || ty, nil
}

// trajectory is one integrated seed.
type trajectory struct {
	solution
	escape float64
	reason string
}

func newTrajectory(f odeFunc, seed Seed, lo, hi, escape, tol float64) *trajectory {
	r := &trajectory{escape: escape}
	r.F, r.Lo, r.Hi, r.End = f, lo, hi, lo
	y := []float64{seed.X, seed.Y}
	if math.Hypot(y[0], y[1]) > escape {
		r.reason = "escape"
		return r
	}
	r.Ts, r.Ys = []float64{lo}, [][]float64{y}
	v := make([]float64, 2)
	t, h := lo, hi-lo
	for attempts := 0; ; attempts++ {
		if t >= hi {
			r.reason = "end"
			break
		}
		if attempts >= maxFieldSteps {
			r.reason = "exhausted"
			break
		}
		// A step moves at most an eighth of the escape radius at the speed
		// it starts with, so it rarely leaves the circle and comes back
		// unseen. An infinite speed allows no step at all.
		f(t, y, v)
		if speed := math.Hypot(v[0], v[1]); speed > 0 {
			h = math.Min(h, escape/(8*speed))
		}
		last := t+h >= hi
		if last {
			h = hi - t
		} else if h < 1e-12*(hi-lo) {
			r.reason = "singular"
			break
		}
		next, e := dormandPrince(f, t, y, h, true)
		scale := tol * (math.Max(math.Hypot(y[0], y[1]), math.Hypot(next[0], next[1])) + 1e-6*escape)
		size := math.Max(math.Abs(e[0]), math.Abs(e[1])) / scale
		if math.IsNaN(size) {
			size = math.Inf(1)
		}
		if size > 1 {
			h *= math.Max(.2, .9*math.Pow(size, -.2))
			continue
		}
		if math.Hypot(next[0], next[1]) > escape {
			t += r.crossing(t, y, h)
			r.reason = "escape"
			break
		}
		if t += h; last {
			t = hi
		}
		r.Ts, r.Ys, y = append(r.Ts, t), append(r.Ys, next), next
		if size == 0 {
			h *= 5
		} else {
			h *= math.Min(5, .9*math.Pow(size, -.2))
		}
	}
	r.End = t
	r.Complete = r.reason == "end"
	return r
}

// crossing bisects an accepted step from y at t for the last moment still
// inside the escape circle.
func (r *trajectory) crossing(t float64, y []float64, h float64) float64 {
	in, out := 0.0, h
	for {
		mid := (in + out) / 2
		if mid <= in || mid >= out {
			return in
		}
		p, _ := dormandPrince(r.F, t, y, mid, false)
		if math.Hypot(p[0], p[1]) > r.escape {
			out = mid
		} else {
			in = mid
		}
	}
}

// at returns the trajectory's position at t, while it is known.
func (r *trajectory) at(t float64) (Vec, bool) {
	y, ok := r.State(t)
	if !ok {
		return Vec{}, false
	}
	return Vec{y[0], y[1]}, true
}

func (r *trajectory) curve() curveFunc {
	return func(t float64) Vec {
		p, ok := r.at(t)
		if !ok {
			return Vec{math.NaN(), math.NaN()}
		}
		return p
	}
}

// flows integrates every seed.
func (v VectorField) flows(a, lo, hi float64) ([]*trajectory, odeFunc, bool, error) {
	f, timed, err := v.system(a)
	if err != nil {
		return nil, nil, false, err
	}
	out := make([]*trajectory, len(v.Seeds))
	for i, s := range v.Seeds {
		out[i] = newTrajectory(f, s, lo, hi, v.Escape, fieldTolerance)
	}
	return out, f, timed, nil
}

// exhaustedWarning names the trajectories that ran out of integration steps.
func exhaustedWarning(flows []*trajectory) string {
	var names []string
	last := 0
	for i, r := range flows {
		if r.reason == "exhausted" {
			names, last = append(names, fmt.Sprint(i+1)), i
		}
	}
	switch len(names) {
	case 0:
		return ""
	case 1:
		return fmt.Sprintf("Trajectory %s ran out of integration steps at t = %.6g; its later samples are left empty.", names[0], flows[last].End)
	}
	return fmt.Sprintf("Trajectories %s ran out of integration steps; their later samples are left empty.", strings.Join(names, ", "))
}

func newFieldResult(flows []*trajectory, samples int, timed bool) *FieldResult {
	out := &FieldResult{Paths: make([][]*Vec, len(flows)), Arrows: []Arrow{}, Ends: make([]TrajectoryEnd, len(flows)), Timed: timed, Grid: Grid{Points: []Direction{}}}
	for i, r := range flows {
		out.Paths[i] = make([]*Vec, samples)
		out.Ends[i] = TrajectoryEnd{Time: r.End, Reason: r.reason}
	}
	return out
}

// sample records every trajectory's position at base sample j, and the
// field there when it is a representative sample.
func (res *FieldResult) sample(flows []*trajectory, f odeFunc, j int, t float64, line bool) {
	v := make([]float64, 2)
	for i, r := range flows {
		p, ok := r.at(t)
		if !ok {
			continue
		}
		res.Paths[i][j] = point(p)
		if !line {
			continue
		}
		f(t, []float64{p.X, p.Y}, v)
		if w := (Vec{v[0], v[1]}); w.Valid() {
			res.Arrows = append(res.Arrows, Arrow{SampleIndex: j, Seed: i, Point: p, Velocity: w})
		}
	}
}

// directions fills in the direction field of a field without t, on a
// square lattice centered on the sampled trajectories' bounding box, a tenth
// wider on each side, and at least half as tall as wide or wide as tall.
func (res *FieldResult) directions(f odeFunc) {
	if res.Timed {
		return
	}
	lo, hi := Vec{math.Inf(1), math.Inf(1)}, Vec{math.Inf(-1), math.Inf(-1)}
	for _, path := range res.Paths {
		for _, p := range path {
			if p != nil {
				lo = Vec{math.Min(lo.X, p.X), math.Min(lo.Y, p.Y)}
				hi = Vec{math.Max(hi.X, p.X), math.Max(hi.Y, p.Y)}
			}
		}
	}
	if !lo.Valid() {
		return
	}
	size := hi.Sub(lo).Mul(1.2)
	side := math.Max(size.X, size.Y)
	if !(side > 1e-9*math.Max(lo.Norm(), hi.Norm())) {
		// A lone fixed point: a unit square around it.
		side, size = 1, Vec{1, 1}
	}
	spacing := side / (gridPoints - 1)
	center := lo.Add(hi).Mul(.5)
	// A thin box, such as a straight trajectory's, still spans half the
	// longer side across.
	nx := min(gridPoints, int(math.Ceil(math.Max(size.X, side/2)/spacing-1e-9))+1)
	ny := min(gridPoints, int(math.Ceil(math.Max(size.Y, side/2)/spacing-1e-9))+1)
	res.Grid.Spacing = spacing
	v := make([]float64, 2)
	for j := 0; j < ny; j++ {
		for i := 0; i < nx; i++ {
			p := center.Add(Vec{(float64(i) - float64(nx-1)/2) * spacing, (float64(j) - float64(ny-1)/2) * spacing})
			f(0, []float64{p.X, p.Y}, v)
			if w := (Vec{v[0], v[1]}); w.Valid() && w.Norm() > 0 {
				res.Grid.Points = append(res.Grid.Points, Direction{Point: p, Velocity: w})
			}
		}
	}
}
