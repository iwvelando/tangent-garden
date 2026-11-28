package threebody

import (
	"fmt"
	"math"

	"tangentgarden/engine"
)

// Admission limits. They bound the work and storage of a history; they are
// not accuracy claims.
const (
	maxDuration   = 100
	maxSamples    = 20000
	minMass       = 1e-3
	maxCoordinate = 10
	maxSpeed      = 20
	// The closest two bodies may start, a hundred times the encounter floor.
	minStart = 1e-2
	// The retained integration data allowed: accepted steps and samples.
	maxRetained = 64 << 20
)

// Body is one body's mass and initial state, in units with G = 1 and
// total mass 1.
type Body struct {
	Mass     float64    `json:"mass"`
	Position engine.Vec `json:"position"`
	Velocity engine.Vec `json:"velocity"`
}

// Request is three bodies followed for Duration from time 0, sampled at
// Samples evenly spaced physical times from 0 to Duration inclusive.
type Request struct {
	Bodies   []Body  `json:"bodies"`
	Duration float64 `json:"duration"`
	Samples  int     `json:"samples"`
}

func fieldErr(field, format string, args ...any) error {
	return &engine.FieldError{Field: field, Message: fmt.Sprintf(format, args...)}
}

func finite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }

// Validate refuses a request outside the admission limits, naming the
// field: a coordinate on its own path, and the speed and a close start on
// the vector they constrain.
func (q Request) Validate() error {
	if len(q.Bodies) != 3 {
		return fieldErr("bodies", "a three-body study has exactly three bodies")
	}
	total := 0.0
	for i, b := range q.Bodies {
		path := fmt.Sprintf("bodies.%d", i)
		if !finite(b.Mass) || b.Mass < minMass || b.Mass > 1 {
			return fieldErr(path+".mass", "body %d: the mass must be at least 0.001 and at most 1", i+1)
		}
		total += b.Mass
		for _, c := range []struct {
			axis string
			v    float64
		}{{"x", b.Position.X}, {"y", b.Position.Y}} {
			if !finite(c.v) || math.Abs(c.v) > maxCoordinate {
				return fieldErr(path+".position."+c.axis, "body %d: the position must be finite and within ±10", i+1)
			}
		}
		for _, c := range []struct {
			axis string
			v    float64
		}{{"x", b.Velocity.X}, {"y", b.Velocity.Y}} {
			if !finite(c.v) {
				return fieldErr(path+".velocity."+c.axis, "body %d: the velocity must be finite", i+1)
			}
		}
		if speed := math.Hypot(b.Velocity.X, b.Velocity.Y); speed > maxSpeed {
			return fieldErr(path+".velocity", "body %d: the speed must be at most 20; it is %.6g", i+1, speed)
		}
	}
	if math.Abs(total-1) > 1e-12 {
		return fieldErr("bodies.2.mass", "the masses must sum to 1; they sum to %.15g", total)
	}
	for j := 1; j < 3; j++ {
		for i := 0; i < j; i++ {
			if d := q.Bodies[j].Position.Sub(q.Bodies[i].Position).Norm(); d < minStart {
				return fieldErr(fmt.Sprintf("bodies.%d.position", j), "bodies %d and %d must start at least 0.01 apart", i+1, j+1)
			}
		}
	}
	if !finite(q.Duration) || q.Duration <= 0 || q.Duration > maxDuration {
		return fieldErr("duration", "the duration must be positive and at most 100")
	}
	if q.Samples < 2 || q.Samples > maxSamples {
		return fieldErr("samples", "the samples must be 2–20000")
	}
	return nil
}

func (q Request) masses() []float64 {
	m := make([]float64, len(q.Bodies))
	for i, b := range q.Bodies {
		m[i] = b.Mass
	}
	return m
}

func (q Request) initial() []float64 {
	n := len(q.Bodies)
	y := make([]float64, 4*n)
	for i, b := range q.Bodies {
		y[2*i], y[2*i+1] = b.Position.X, b.Position.Y
		y[2*n+2*i], y[2*n+2*i+1] = b.Velocity.X, b.Velocity.Y
	}
	return y
}

// Integrate validates the request and integrates it with the default
// settings into an immutable history.
func (q Request) Integrate() (*History, error) {
	return q.integrate(DefaultSettings())
}

func (q Request) integrate(set Settings) (*History, error) {
	if err := q.Validate(); err != nil {
		return nil, err
	}
	return integrate(newSystem(q.masses()), 0, q.initial(), q.Duration, set), nil
}

// Path is one body's sampled positions and velocities.
type Path struct {
	Positions  []engine.Vec `json:"positions"`
	Velocities []engine.Vec `json:"velocities"`
}

// Final is the state at the history's end, whether or not it falls on a
// sample time.
type Final struct {
	Time       float64      `json:"time"`
	Positions  []engine.Vec `json:"positions"`
	Velocities []engine.Vec `json:"velocities"`
}

// Diagnostics measure the history against the conserved quantities and its
// own budgets. Errors are the largest over the available samples and the
// final state: relative energy error; linear momentum change; angular
// momentum change relative to Σ m|r||v| at the start (or 1 if that is 0);
// and the center of mass's distance from its straight line c₀ + P₀t.
// Closest is the smallest separation at an accepted step.
type Diagnostics struct {
	Energy        float64 `json:"energy"`
	EnergyError   float64 `json:"energyError"`
	MomentumError float64 `json:"momentumError"`
	AngularError  float64 `json:"angularError"`
	CenterError   float64 `json:"centerError"`
	Closest       float64 `json:"closest"`
	ClosestTime   float64 `json:"closestTime"`
	StepError     float64 `json:"stepError"`
	Tolerance     float64 `json:"tolerance"`
	Floor         float64 `json:"floor"`
	RetainedBytes int     `json:"retainedBytes"`
}

// Prepared is a sampled history: the plan's times, the samples at those up
// to the end (Available of them), each sample's step error as a fraction of
// the tolerance, the final state, and why the history ended. Samples never
// reach past the end; the final state is the only state after the last.
type Prepared struct {
	Times       []float64   `json:"times"`
	Available   int         `json:"available"`
	Paths       []Path      `json:"paths"`
	StepErrors  []float64   `json:"stepErrors"`
	Final       Final       `json:"final"`
	Terminal    Terminal    `json:"terminal"`
	Accepted    int         `json:"accepted"`
	Rejected    int         `json:"rejected"`
	Attempts    int         `json:"attempts"`
	Diagnostics Diagnostics `json:"diagnostics"`
}

// Times is the sampling plan: n evenly spaced times from 0 to duration.
func Times(duration float64, n int) []float64 {
	out := make([]float64, n)
	for k := range out {
		out[k] = duration * float64(k) / float64(n-1)
	}
	out[n-1] = duration
	return out
}

// Retained is the history's retained bytes: its steps' times, errors and
// states.
func (h *History) Retained() int { return len(h.ts) * (2 + len(h.ys[0])) * 8 }

// Prepare integrates and samples a request.
func (q Request) Prepare() (*Prepared, error) {
	h, err := q.Integrate()
	if err != nil {
		return nil, err
	}
	return h.Sample(q.Samples)
}

// Sample evaluates the history at its plan's times, up to its end.
func (h *History) Sample(n int) (*Prepared, error) {
	if n < 2 || n > maxSamples {
		return nil, fieldErr("samples", "the samples must be 2–20000")
	}
	s, nb := h.sys, h.sys.n
	times := Times(h.hi-h.t0, n)
	for k := range times {
		times[k] += h.t0
	}
	out := &Prepared{Times: times, Paths: make([]Path, nb), Terminal: h.Terminal, Accepted: h.Accepted, Rejected: h.Rejected, Attempts: h.Attempts}
	if len(h.ys) == 0 {
		return out, nil
	}
	y0 := h.ys[0]
	e0, p0, l0, c0 := s.energy(y0), s.momentum(y0), s.angular(y0), s.center(y0)
	lscale := 0.0
	for i, m := range s.m {
		lscale += m * math.Hypot(y0[2*i], y0[2*i+1]) * math.Hypot(y0[2*nb+2*i], y0[2*nb+2*i+1])
	}
	if lscale == 0 {
		lscale = 1
	}
	d := &out.Diagnostics
	d.Energy, d.Tolerance, d.Floor = e0, h.settings.Tolerance, h.settings.Floor
	measure := func(t float64, y []float64) {
		d.EnergyError = math.Max(d.EnergyError, math.Abs(s.energy(y)-e0)/math.Abs(e0))
		p := s.momentum(y)
		d.MomentumError = math.Max(d.MomentumError, math.Hypot(p[0]-p0[0], p[1]-p0[1]))
		d.AngularError = math.Max(d.AngularError, math.Abs(s.angular(y)-l0)/lscale)
		c := s.center(y)
		d.CenterError = math.Max(d.CenterError, math.Hypot(c[0]-c0[0]-p0[0]*(t-h.t0), c[1]-c0[1]-p0[1]*(t-h.t0)))
	}
	for k, t := range times {
		if t > h.End {
			break
		}
		y, _ := h.State(t)
		out.Available++
		for i := 0; i < nb; i++ {
			out.Paths[i].Positions = append(out.Paths[i].Positions, engine.Vec{X: y[2*i], Y: y[2*i+1]})
			out.Paths[i].Velocities = append(out.Paths[i].Velocities, engine.Vec{X: y[2*nb+2*i], Y: y[2*nb+2*i+1]})
		}
		out.StepErrors = append(out.StepErrors, h.sizes[h.stepAt(t)])
		measure(times[k], y)
	}
	y, _ := h.State(h.End)
	measure(h.End, y)
	out.Final = Final{Time: h.End}
	for i := 0; i < nb; i++ {
		out.Final.Positions = append(out.Final.Positions, engine.Vec{X: y[2*i], Y: y[2*i+1]})
		out.Final.Velocities = append(out.Final.Velocities, engine.Vec{X: y[2*nb+2*i], Y: y[2*nb+2*i+1]})
	}
	d.Closest = math.Inf(1)
	for k, y := range h.ys {
		if c, _ := s.closest(y); c < d.Closest {
			d.Closest, d.ClosestTime = c, h.ts[k]
		}
	}
	for _, e := range out.StepErrors {
		d.StepError = math.Max(d.StepError, e)
	}
	d.RetainedBytes = h.Retained() + out.Available*(1+4*nb)*8 + len(times)*8
	if d.RetainedBytes > maxRetained {
		return nil, fmt.Errorf("the history needs %d bytes, more than the 64 MiB allowed", d.RetainedBytes)
	}
	return out, nil
}

// stepAt is the index of the step that holds t: the accepted step whose
// error the dense state at t carries. A state at a step's start is that
// step's accepted state, which carries the previous step's error.
func (h *History) stepAt(t float64) int {
	k, top := 0, len(h.ts)-1
	for k < top {
		mid := (k + top + 1) / 2
		if h.ts[mid] <= t {
			k = mid
		} else {
			top = mid - 1
		}
	}
	if k+1 < len(h.ts) && t > h.ts[k] {
		return k + 1
	}
	return k
}
