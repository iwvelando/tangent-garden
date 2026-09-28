package engine

// odeFunc is a first-order system y' = f(t, y), written into out.
type odeFunc func(t float64, y, out []float64)

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

// dormandPrince advances y from t by h with the fifth-order solution, and
// returns the embedded error estimate when asked.
func dormandPrince(f odeFunc, t float64, y []float64, h float64, estimate bool) (next, err []float64) {
	var w stages
	next = append([]float64{}, w.step(f, t, y, h, estimate)...)
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

// stages holds one step's slopes and stage state, so that repeated steps
// allocate nothing.
type stages struct {
	k     [7][]float64
	stage []float64
}

// step advances y from t by h and returns the fifth-order solution, valid
// until the next step. The final slope, at that solution, is needed only for
// the error estimate.
func (w *stages) step(f odeFunc, t float64, y []float64, h float64, estimate bool) []float64 {
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

// solution is an integrated system: the accepted steps from states ys at
// times ts, known from lo to end. A state between two steps is one step of
// the same method from the earlier, so it is smooth in t within each step
// and continuous across them.
type solution struct {
	f      odeFunc
	lo, hi float64
	ts     []float64
	ys     [][]float64
	end    float64
	// Whether the solution runs all the way to hi.
	complete bool
	// Scratch for evaluating between steps.
	work stages
}

func (s *solution) steps() int { return len(s.ts) - 1 }

// state returns the solution at t, while it is known. The state is valid
// until the next call.
func (s *solution) state(t float64) ([]float64, bool) {
	if t > s.end && s.complete && t-s.end <= 1e-12*(s.hi-s.lo) {
		// The last sample can land a rounding error past the domain end.
		t = s.end
	}
	if len(s.ts) == 0 || !(t >= s.lo && t <= s.end) {
		return nil, false
	}
	// The last accepted step starting at or before t.
	k, top := 0, len(s.ts)-1
	for k < top {
		mid := (k + top + 1) / 2
		if s.ts[mid] <= t {
			k = mid
		} else {
			top = mid - 1
		}
	}
	y := s.ys[k]
	if d := t - s.ts[k]; d > 0 {
		// Valid until the next call; callers copy what they keep.
		y = s.work.step(s.f, s.ts[k], y, d, false)
	}
	return y, true
}
