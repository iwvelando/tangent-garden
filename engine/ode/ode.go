// Package ode integrates first-order systems y′ = f(t, y) of any dimension
// with the Dormand–Prince 5(4) pair. Step-size control and events belong to
// callers, which know their own error norms and stopping rules.
package ode

// Func is a first-order system y' = f(t, y), written into out.
type Func func(t float64, y, out []float64)

// Dormand–Prince 5(4) coefficients.
var (
	// The stage times, as fractions of the step.
	dpC = [6]float64{1.0 / 5, 3.0 / 10, 4.0 / 5, 8.0 / 9, 1, 1}
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

// DormandPrince advances y from t by h with the fifth-order solution, and
// returns the embedded error estimate, component by component, when asked.
func DormandPrince(f Func, t float64, y []float64, h float64, estimate bool) (next, err []float64) {
	var w Stages
	next = append([]float64{}, w.Step(f, t, y, h, estimate)...)
	if estimate {
		err = make([]float64, len(y))
		for q := range err {
			for r, e := range dpE {
				err[q] += h * e * w.k[r][q]
			}
		}
	}
	return next, err
}

// Stages holds one step's slopes and stage state, so that repeated steps
// allocate nothing.
type Stages struct {
	k     [7][]float64
	stage []float64
}

// Step advances y from t by h and returns the fifth-order solution, valid
// until the next step. The final slope, at that solution, is needed only for
// the error estimate.
func (w *Stages) Step(f Func, t float64, y []float64, h float64, estimate bool) []float64 {
	m := len(y)
	if len(w.stage) != m {
		for r := range w.k {
			w.k[r] = make([]float64, m)
		}
		w.stage = make([]float64, m)
	}
	f(t, y, w.k[0])
	for s, row := range dpA {
		for q := range w.stage {
			sum := 0.0
			for r, a := range row {
				sum += a * w.k[r][q]
			}
			w.stage[q] = y[q] + h*sum
		}
		if s+1 < len(dpA) || estimate {
			f(t+dpC[s]*h, w.stage, w.k[s+1])
		}
	}
	return w.stage
}

// Solution is an integrated system: the accepted steps from states Ys at
// times Ts, known from Lo to End. A state between two steps is one step of
// the same method from the earlier, so it is smooth in t within each step
// and continuous across them.
type Solution struct {
	F      Func
	Lo, Hi float64
	Ts     []float64
	Ys     [][]float64
	End    float64
	// Whether the solution runs all the way to Hi.
	Complete bool
	// Scratch for evaluating between steps.
	work Stages
}

func (s *Solution) Steps() int { return len(s.Ts) - 1 }

// State returns the solution at t, while it is known. The state is valid
// until the next call.
func (s *Solution) State(t float64) ([]float64, bool) {
	if t > s.End && s.Complete && t-s.End <= 1e-12*(s.Hi-s.Lo) {
		// The last sample can land a rounding error past the domain end.
		t = s.End
	}
	if len(s.Ts) == 0 || !(t >= s.Lo && t <= s.End) {
		return nil, false
	}
	// The last accepted step starting at or before t.
	k, top := 0, len(s.Ts)-1
	for k < top {
		mid := (k + top + 1) / 2
		if s.Ts[mid] <= t {
			k = mid
		} else {
			top = mid - 1
		}
	}
	y := s.Ys[k]
	if d := t - s.Ts[k]; d > 0 {
		// Valid until the next call; callers copy what they keep.
		y = s.work.Step(s.F, s.Ts[k], y, d, false)
	}
	return y, true
}
