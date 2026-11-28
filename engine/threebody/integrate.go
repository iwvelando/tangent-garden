package threebody

import (
	"math"

	"tangentgarden/engine/ode"
)

// Settings are the integration's tolerances and budgets.
type Settings struct {
	// Local error per step, relative to 1 + |y| component by component.
	Tolerance float64
	// A pair closer than Floor ends the history with an encounter.
	Floor float64
	// Attempted steps, accepted plus rejected, and rejections in a row.
	MaxAttempts, MaxRejections int
	// The relative energy error that ends the history with drift; 0 for none.
	DriftBudget float64
	// No step is longer than Eta times any pair's separation over its
	// relative speed, or its free-fall time √(r³/(mᵢ+mⱼ)).
	Eta float64
}

// DefaultSettings are the research admission settings, chosen by the #552
// measurements: at 10⁻¹² regular corpus paths stay within 10⁻⁷ of the
// reference over 100 time units; a pericenter of 10⁻⁴ costs about 10⁻⁸ in
// relative energy (10⁻⁵ costs 5·10⁻⁷, and 10⁻⁶ collapses the step); and the
// corpus's largest energy error, 1.3·10⁻⁸ in Burrau's problem, sits two
// orders inside the drift budget.
func DefaultSettings() Settings {
	return Settings{Tolerance: 1e-12, Floor: 1e-4, MaxAttempts: 200000, MaxRejections: 32, DriftBudget: 1e-6, Eta: 0.25}
}

// Terminal is why and where a history ends. Reason is "end" at the horizon,
// "encounter" where a pair comes within the floor, "unresolved" where the
// step size collapses or too many steps in a row are rejected, "exhausted"
// where the attempt budget runs out, "drift" where the energy error leaves
// its budget, or "nonfinite" where the starting accelerations are not
// finite. Check names the test that stopped it; Pair (bodies numbered from
// 1) and Separation describe an encounter.
type Terminal struct {
	Reason     string  `json:"reason"`
	Check      string  `json:"check"`
	Time       float64 `json:"time"`
	Pair       [2]int  `json:"pair"`
	Separation float64 `json:"separation"`
}

// History is an integrated system from T0 to End: the accepted steps it
// owns, and the dense solution between them. A state between two steps is
// one step of the same method from the earlier, as in package ode. Nothing
// is known past End, and nothing is interpolated across the terminal.
type History struct {
	sys    *system
	t0, hi float64
	ts     []float64
	ys     [][]float64
	// Each accepted step's error estimate, as a fraction of the tolerance.
	sizes []float64

	End                          float64
	Terminal                     Terminal
	Accepted, Rejected, Attempts int
	settings                     Settings
}

// integrate follows y0 from t0 for duration, by Dormand–Prince 5(4).
func integrate(s *system, t0 float64, y0 []float64, duration float64, set Settings) *History {
	h := &History{sys: s, t0: t0, hi: t0 + duration, End: t0, settings: set}
	y := append([]float64{}, y0...)
	a := make([]float64, 2*s.n)
	if !s.accel(y, a) || !finiteAll(y) {
		h.Terminal = Terminal{Reason: "nonfinite", Check: "initial state", Time: t0}
		return h
	}
	h.ts, h.ys, h.sizes = []float64{t0}, [][]float64{y}, []float64{0}
	finite := true
	f := func(t float64, y, out []float64) {
		s.deriv(t, y, out)
		if !finiteAll(out) || !finiteAll(y) {
			finite = false
		}
	}
	var w ode.Stages
	e := make([]float64, len(y))
	e0 := s.energy(y)
	t, step, run := t0, duration, 0
	for {
		if t >= h.hi {
			h.Terminal = Terminal{Reason: "end", Check: "horizon", Time: t}
			break
		}
		if run >= set.MaxRejections {
			h.Terminal = Terminal{Reason: "unresolved", Check: "rejections", Time: t}
			break
		}
		if h.Attempts >= set.MaxAttempts {
			h.Terminal = Terminal{Reason: "exhausted", Check: "attempts", Time: t}
			break
		}
		step = math.Min(step, set.Eta*s.stepLimit(y))
		last := t+step >= h.hi
		if last {
			step = h.hi - t
		} else if step < 1e-12*duration {
			h.Terminal = Terminal{Reason: "unresolved", Check: "step size", Time: t}
			break
		}
		h.Attempts++
		finite = true
		next := w.Step(f, t, y, step, true)
		size := math.Inf(1)
		if finite {
			w.Estimate(step, e)
			size = 0
			for q := range e {
				size = math.Max(size, math.Abs(e[q])/(set.Tolerance*(1+math.Max(math.Abs(y[q]), math.Abs(next[q])))))
			}
			if math.IsNaN(size) {
				size = math.Inf(1)
			}
		}
		if size > 1 {
			h.Rejected++
			run++
			if math.IsInf(size, 1) {
				step *= .25
			} else {
				step *= math.Max(.2, .9*math.Pow(size, -.2))
			}
			continue
		}
		run = 0
		next = append([]float64{}, next...)
		if d, pair, check, ok := h.encounter(t, y, step, next); ok {
			at := h.dense(t, y, d)
			h.Accepted++
			h.ts, h.ys, h.sizes = append(h.ts, t+d), append(h.ys, at), append(h.sizes, size)
			p := s.pairs[pair]
			sep := math.Hypot(at[2*p[1]]-at[2*p[0]], at[2*p[1]+1]-at[2*p[0]+1])
			t += d
			h.Terminal = Terminal{Reason: "encounter", Check: check, Time: t, Pair: [2]int{p[0] + 1, p[1] + 1}, Separation: sep}
			break
		}
		if set.DriftBudget > 0 && math.Abs(s.energy(next)-e0) > set.DriftBudget*math.Abs(e0) {
			h.Terminal = Terminal{Reason: "drift", Check: "energy", Time: t}
			break
		}
		h.Accepted++
		if t += step; last {
			t = h.hi
		}
		h.ts, h.ys, h.sizes, y = append(h.ts, t), append(h.ys, next), append(h.sizes, size), next
		if size == 0 {
			step *= 5
		} else {
			step *= math.Min(5, .9*math.Pow(size, -.2))
		}
	}
	h.End = t
	return h
}

func finiteAll(v []float64) bool {
	for _, x := range v {
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return false
		}
	}
	return true
}

// stepLimit is the shortest of every pair's separation over its relative
// speed and its free-fall time.
func (s *system) stepLimit(y []float64) float64 {
	k := 2 * s.n
	best := math.Inf(1)
	for _, p := range s.pairs {
		i, j := p[0], p[1]
		dx, dy := y[2*j]-y[2*i], y[2*j+1]-y[2*i+1]
		ux, uy := y[k+2*j]-y[k+2*i], y[k+2*j+1]-y[k+2*i+1]
		r := math.Hypot(dx, dy)
		if v := math.Hypot(ux, uy); v > 0 {
			best = math.Min(best, r/v)
		}
		best = math.Min(best, math.Sqrt(r*r*r/(s.m[i]+s.m[j])))
	}
	return best
}

// dense is one step of the method from y at t by d, a copy the caller owns.
func (h *History) dense(t float64, y []float64, d float64) []float64 {
	if d == 0 {
		return append([]float64{}, y...)
	}
	var w ode.Stages
	return append([]float64{}, w.Step(h.sys.deriv, t, y, d, false)...)
}

// encounter finds the first time within the accepted step from y at t by
// step that a pair comes within the floor: at the step's end, or at a
// minimum inside the step, where the pair's radial velocity changes sign on
// the dense solution. It returns the offset of the last moment at or above
// the floor, the pair, and the check that found it.
func (h *History) encounter(t float64, y []float64, step float64, next []float64) (float64, int, string, bool) {
	s, floor := h.sys, h.settings.Floor
	k := 2 * s.n
	sep := func(y []float64, p [2]int) float64 {
		return math.Hypot(y[2*p[1]]-y[2*p[0]], y[2*p[1]+1]-y[2*p[0]+1])
	}
	radial := func(y []float64, p [2]int) float64 {
		dx, dy := y[2*p[1]]-y[2*p[0]], y[2*p[1]+1]-y[2*p[0]+1]
		return dx*(y[k+2*p[1]]-y[k+2*p[0]]) + dy*(y[k+2*p[1]+1]-y[k+2*p[0]+1])
	}
	// The largest offset in [lo, hi] where below(d) is false, given that it
	// is false at lo and true at hi.
	bisect := func(lo, hi float64, below func(float64) bool) float64 {
		for {
			mid := (lo + hi) / 2
			if mid <= lo || mid >= hi {
				return lo
			}
			if below(mid) {
				hi = mid
			} else {
				lo = mid
			}
		}
	}
	best, at, how := math.Inf(1), -1, ""
	for n, p := range s.pairs {
		end, check := -1.0, ""
		if sep(next, p) < floor {
			end, check = step, "step end"
		} else if radial(y, p) < 0 && radial(next, p) > 0 {
			d := bisect(0, step, func(d float64) bool { return radial(h.dense(t, y, d), p) >= 0 })
			if sep(h.dense(t, y, d), p) < floor {
				end, check = d, "interior minimum"
			}
		}
		if end < 0 {
			continue
		}
		d := bisect(0, end, func(d float64) bool { return sep(h.dense(t, y, d), p) < floor })
		if d < best {
			best, at, how = d, n, check
		}
	}
	return best, at, how, at >= 0
}

// State returns a copy of the state at t, positions then velocities, while
// it is known.
func (h *History) State(t float64) ([]float64, bool) {
	if len(h.ts) == 0 || !(t >= h.t0 && t <= h.End) {
		return nil, false
	}
	k, top := 0, len(h.ts)-1
	for k < top {
		mid := (k + top + 1) / 2
		if h.ts[mid] <= t {
			k = mid
		} else {
			top = mid - 1
		}
	}
	return h.dense(h.ts[k], h.ys[k], t-h.ts[k]), true
}
