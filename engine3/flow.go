package engine3

import (
	"fmt"
	"math"
	"tangentgarden/engine/expr"
	"tangentgarden/engine/ode"
)

// FieldRequest is the spatial system r′ = V(x, y, z, t) = (X, Y, Z), with
// time t running from Min to Max from every seed. The expressions bind the
// shape parameter A. A trajectory ends early the first time it leaves the
// sphere of radius Escape about the origin, or where the field stops being
// finite along it. Trajectories are independent: one ending never stops
// another. The first seed's trajectory is the base curve that every
// construction uses.
type FieldRequest struct {
	X      string  `json:"x"`
	Y      string  `json:"y"`
	Z      string  `json:"z"`
	Seeds  []Vec3  `json:"seeds"`
	Escape float64 `json:"escape"`
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
	A      float64 `json:"a"`
}

// TrajectoryEnd is where and why a trajectory stopped: "end" at Max,
// "escape" where it leaves the escape sphere (at Min, with no Point, for a
// seed outside it), "singular" where the field is not finite or the step
// size collapses, or "exhausted" where the integration step budget ran out.
// Point is the last position known, and Steps the accepted steps.
type TrajectoryEnd struct {
	Time   float64 `json:"time"`
	Reason string  `json:"reason"`
	Point  *Vec3   `json:"point"`
	Steps  int     `json:"steps"`
}

// FieldArrow is the field's value at trajectory Seed's position at base
// sample SampleIndex.
type FieldArrow struct {
	SampleIndex int  `json:"sampleIndex"`
	Seed        int  `json:"seed"`
	Point       Vec3 `json:"point"`
	Velocity    Vec3 `json:"velocity"`
}

// FieldResult holds every trajectory, indexed like the base samples, so the
// same index is the same time on every path; the first is the base curve.
// Samples after a trajectory's end are gaps. Arrows sit at the
// representative samples. Resting marks seeds where an autonomous field's
// speed is below 10⁻⁹, whose trajectories stay put. Timed is whether the
// field's expressions read t.
type FieldResult struct {
	Paths   [][]*Vec3       `json:"paths"`
	Arrows  []FieldArrow    `json:"arrows"`
	Ends    []TrajectoryEnd `json:"ends"`
	Resting []bool          `json:"resting"`
	Timed   bool            `json:"timed"`
}

const maxSeeds = 12

// Local error per step, relative to the distance from the origin with a
// floor of 10⁻⁶ of the escape radius, and the budget of attempted steps for
// one trajectory. Variables so tests can refine and exhaust them.
var (
	fieldTolerance = 1e-10
	maxFieldSteps  = 50000
)

// spatialField is V at a point and time.
type spatialField func(p Vec3, t float64) Vec3

func (v FieldRequest) validate() error {
	if len(v.Seeds) < 1 || len(v.Seeds) > maxSeeds {
		return fmt.Errorf("a vector field has 1–12 seeds")
	}
	for i, s := range v.Seeds {
		if !s.valid() || math.Max(math.Abs(s.X), math.Max(math.Abs(s.Y), math.Abs(s.Z))) > 1e5 {
			return fmt.Errorf("seed %d: the coordinates must be finite and within ±100000", i+1)
		}
	}
	if !finite(v.Escape) || v.Escape <= 0 || v.Escape > 1e5 {
		return fmt.Errorf("the escape radius must be finite, positive, and at most 100000")
	}
	return nil
}

// system parses the field, binding a, and reports whether it reads t.
func (v FieldRequest) system() (spatialField, bool, error) {
	var parts [3]expr.SpatialField
	timed := false
	for i, s := range []string{v.X, v.Y, v.Z} {
		f, reads, err := expr.ParseSpatialField(s, v.A)
		if err != nil {
			return nil, false, fmt.Errorf("d%s/dt: %w", []string{"x", "y", "z"}[i], err)
		}
		parts[i], timed = f, timed || reads
	}
	return func(p Vec3, t float64) Vec3 {
		return Vec3{parts[0](p.X, p.Y, p.Z, t), parts[1](p.X, p.Y, p.Z, t), parts[2](p.X, p.Y, p.Z, t)}
	}, timed, nil
}

// trajectory is one integrated seed.
type trajectory struct {
	ode.Solution
	escape float64
	reason string
}

func (f spatialField) system() ode.Func {
	return func(t float64, y, out []float64) {
		v := f(Vec3{y[0], y[1], y[2]}, t)
		out[0], out[1], out[2] = v.X, v.Y, v.Z
	}
}

func newTrajectory(f ode.Func, seed Vec3, lo, hi, escape, tol float64) *trajectory {
	r := &trajectory{escape: escape}
	r.F, r.Lo, r.Hi, r.End = f, lo, hi, lo
	y := []float64{seed.X, seed.Y, seed.Z}
	if seed.norm() > escape {
		r.reason = "escape"
		return r
	}
	r.Ts, r.Ys = []float64{lo}, [][]float64{y}
	v := make([]float64, 3)
	size3 := func(y []float64) float64 { return math.Sqrt(y[0]*y[0] + y[1]*y[1] + y[2]*y[2]) }
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
		// it starts with, so it rarely leaves the sphere and comes back
		// unseen. An infinite speed allows no step at all.
		f(t, y, v)
		if speed := size3(v); speed > 0 {
			h = math.Min(h, escape/(8*speed))
		}
		last := t+h >= hi
		if last {
			h = hi - t
		} else if h < 1e-12*(hi-lo) {
			r.reason = "singular"
			break
		}
		next, e := ode.DormandPrince(f, t, y, h, true)
		scale := tol * (math.Max(size3(y), size3(next)) + 1e-6*escape)
		size := math.Max(math.Abs(e[0]), math.Max(math.Abs(e[1]), math.Abs(e[2]))) / scale
		if math.IsNaN(size) {
			size = math.Inf(1)
		}
		if size > 1 {
			h *= math.Max(.2, .9*math.Pow(size, -.2))
			continue
		}
		if size3(next) > escape {
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
// inside the escape sphere.
func (r *trajectory) crossing(t float64, y []float64, h float64) float64 {
	in, out := 0.0, h
	for {
		mid := (in + out) / 2
		if mid <= in || mid >= out {
			return in
		}
		p, _ := ode.DormandPrince(r.F, t, y, mid, false)
		if math.Sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2]) > r.escape {
			out = mid
		} else {
			in = mid
		}
	}
}

// at returns the trajectory's position at t, while it is known.
func (r *trajectory) at(t float64) (Vec3, bool) {
	y, ok := r.State(t)
	if !ok {
		return Vec3{}, false
	}
	return Vec3{y[0], y[1], y[2]}, true
}

// evaluation is the trajectory as a curve. Its velocity is the field itself,
// and its acceleration r″ = (∂V/∂r)V + ∂V/∂t is a central difference of the
// field along the flow, at two steps scaled to span, discarded when they
// disagree. No derivative is taken of the integrated positions.
func (r *trajectory) evaluation(f spatialField, span float64) evaluation {
	along := func(p, v Vec3, t, h float64) Vec3 {
		return f(p.add(v.mul(h)), t+h).sub(f(p.sub(v.mul(h)), t-h)).mul(1 / (2 * h))
	}
	return func(t float64) (Vec3, Vec3, Vec3, bool) {
		p, ok := r.at(t)
		if !ok {
			nan := Vec3{math.NaN(), math.NaN(), math.NaN()}
			return nan, nan, nan, false
		}
		v := f(p, t)
		a, a2 := along(p, v, t, span*1e-4), along(p, v, t, span*5e-5)
		if !a.valid() || !a2.valid() || a.sub(a2).norm() > 1e-2*math.Max(a.norm(), a2.norm())+1e-4*math.Max(1, v.norm()/span) {
			a = Vec3{math.NaN(), 0, 0}
		}
		return p, v, a, p.valid() && v.valid()
	}
}

// flowCurve is a parsed field with every seed integrated.
type flowCurve struct {
	f     spatialField
	timed bool
	flows []*trajectory
}

func (v FieldRequest) compile() (*flowCurve, error) {
	if err := domain(v.Min, v.Max); err != nil {
		return nil, err
	}
	if err := v.validate(); err != nil {
		return nil, err
	}
	f, timed, err := v.system()
	if err != nil {
		return nil, err
	}
	return &flowCurve{f, timed, v.integrate(f)}, nil
}

// integrate follows every seed.
func (v FieldRequest) integrate(f spatialField) []*trajectory {
	out := make([]*trajectory, len(v.Seeds))
	for i, s := range v.Seeds {
		out[i] = newTrajectory(f.system(), s, v.Min, v.Max, v.Escape, fieldTolerance)
	}
	return out
}

// fieldGeometry samples every trajectory at the base samples, with the
// field at the representative ones, and returns the paths to be framed.
func fieldGeometry(c Request, f spatialField, timed bool, flows []*trajectory) (*FieldResult, [][]*Vec3) {
	n, lo, hi := c.Samples, c.Field.Min, c.Field.Max
	out := &FieldResult{Paths: make([][]*Vec3, len(flows)), Arrows: []FieldArrow{}, Ends: make([]TrajectoryEnd, len(flows)), Resting: make([]bool, len(flows)), Timed: timed}
	for k, r := range flows {
		out.Paths[k] = make([]*Vec3, n+1)
		for i := 0; i <= n; i++ {
			if p, ok := r.at(lo*(1-float64(i)/float64(n)) + hi*float64(i)/float64(n)); ok && p.valid() {
				out.Paths[k][i] = &p
			}
		}
		end := TrajectoryEnd{Time: r.End, Reason: r.reason, Steps: max(0, r.Steps())}
		if p, ok := r.at(r.End); ok && p.valid() {
			end.Point = &p
		}
		out.Ends[k] = end
		out.Resting[k] = !timed && f(c.Field.Seeds[k], lo).norm() < 1e-9
	}
	for line := 0; line < c.Lines; line++ {
		i := line * n / (c.Lines - 1)
		t := lo*(1-float64(i)/float64(n)) + hi*float64(i)/float64(n)
		for k, path := range out.Paths {
			if path[i] == nil {
				continue
			}
			if v := f(*path[i], t); v.valid() && v.norm() > 0 {
				out.Arrows = append(out.Arrows, FieldArrow{SampleIndex: i, Seed: k, Point: *path[i], Velocity: v})
			}
		}
	}
	return out, out.Paths
}

// moves reports whether any path has two distinct positions.
func moves(paths [][]*Vec3) bool {
	for _, path := range paths {
		var first *Vec3
		for _, p := range path {
			if p == nil {
				continue
			}
			if first == nil {
				first = p
			} else if *p != *first {
				return true
			}
		}
	}
	return false
}
