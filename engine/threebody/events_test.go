package threebody

import (
	"math"
	"testing"
)

// fromApocenter is a Kepler orbit (masses 0.7, 0.3) that starts at
// apocenter, so its first pericenter is half a period later.
func fromApocenter(a, e float64) kepler {
	k := kepler{m1: 0.7, m2: 0.3, a: a, e: e}
	k.tp = k.period() / 2
	return k
}

// crossing is the analytic time the relative distance first falls to d on
// the way to the first pericenter.
func (k kepler) crossing(d float64) float64 {
	n := math.Sqrt((k.m1 + k.m2) / (k.a * k.a * k.a))
	E := math.Acos((1 - d/k.a) / k.e)
	return k.tp - (E-k.e*math.Sin(E))/n
}

func separation(y []float64) float64 { return math.Hypot(y[2]-y[0], y[3]-y[1]) }

func TestEncounterStopsAtTheFloorCrossing(t *testing.T) {
	k := fromApocenter(1, 0.999) // pericenter 0.001
	set := DefaultSettings()
	set.Floor = 0.01
	h := integrate(newSystem([]float64{0.7, 0.3}), 0, k.at(0), 10, set)
	if h.Terminal.Reason != "encounter" || h.Terminal.Pair != [2]int{1, 2} {
		t.Fatalf("terminal %+v, want an encounter of bodies 1 and 2", h.Terminal)
	}
	near(t, "encounter time", h.End, k.crossing(0.01), 1e-9)
	last, ok := h.State(h.End)
	if !ok {
		t.Fatal("no state at the encounter")
	}
	near(t, "separation at the encounter", separation(last), 0.01, 1e-12)
	near(t, "terminal separation", h.Terminal.Separation, 0.01, 1e-12)
	if _, ok := h.State(math.Nextafter(h.End, 11)); ok {
		t.Fatal("the history continues past the encounter")
	}
}

// A pericenter just below the floor falls between accepted steps, where
// neither step end is below it: the radial velocity's sign change finds it.
func TestEncounterInsideAStep(t *testing.T) {
	k := fromApocenter(1, 0.99) // pericenter 0.01
	q := k.a * (1 - k.e)
	set := DefaultSettings()
	set.Floor = q * (1 + 1e-7)
	h := integrate(newSystem([]float64{0.7, 0.3}), 0, k.at(0), 10, set)
	if h.Terminal.Reason != "encounter" {
		t.Fatalf("terminal %+v, want an encounter", h.Terminal)
	}
	if h.Terminal.Check != "interior minimum" {
		t.Errorf("found by %q, want the interior minimum", h.Terminal.Check)
	}
	near(t, "encounter time", h.End, k.crossing(set.Floor), 1e-7)

	// A floor just below the pericenter is a near miss, not an encounter.
	set.Floor = q * (1 - 1e-6)
	h = integrate(newSystem([]float64{0.7, 0.3}), 0, k.at(0), 10, set)
	if h.Terminal.Reason != "end" {
		t.Fatalf("near miss ended %+v", h.Terminal)
	}
}

func TestRejectedStepsAreBounded(t *testing.T) {
	k := kepler{m1: 0.7, m2: 0.3, a: 1, e: 0.5}
	s := newSystem([]float64{0.7, 0.3})

	// No step can meet a tolerance below rounding: consecutive rejections
	// stop it, at its start, before the step size collapses.
	set := DefaultSettings()
	set.Tolerance, set.MaxRejections = 1e-30, 5
	h := integrate(s, 0, k.at(0), 10, set)
	if h.Terminal.Reason != "unresolved" || h.Terminal.Check != "rejections" || h.End != 0 {
		t.Fatalf("terminal %+v at %g, want unresolved by rejections at 0", h.Terminal, h.End)
	}
	if h.Rejected != 5 || h.Attempts != h.Accepted+h.Rejected {
		t.Errorf("%d attempts, %d accepted, %d rejected", h.Attempts, h.Accepted, h.Rejected)
	}

	// With more rejections allowed, the step size collapses first.
	set.MaxRejections = 1000
	h = integrate(s, 0, k.at(0), 10, set)
	if h.Terminal.Reason != "unresolved" || h.Terminal.Check != "step size" {
		t.Fatalf("terminal %+v, want unresolved by step size", h.Terminal)
	}

	// The attempt budget counts rejected steps as well as accepted ones.
	set = DefaultSettings()
	set.MaxAttempts = 50
	h = integrate(s, 0, k.at(0), 100, set)
	if h.Terminal.Reason != "exhausted" || h.Attempts != 50 || h.Accepted+h.Rejected != 50 {
		t.Fatalf("terminal %+v after %d attempts", h.Terminal, h.Attempts)
	}
	if h.End != h.ts[len(h.ts)-1] || h.End <= 0 {
		t.Errorf("exhausted at %g, last step %g", h.End, h.ts[len(h.ts)-1])
	}
}

func TestEnergyBudgetEndsAtTheLastStepWithinIt(t *testing.T) {
	k := kepler{m1: 0.7, m2: 0.3, a: 1, e: 0.95}
	s := newSystem([]float64{0.7, 0.3})
	set := DefaultSettings()
	set.Tolerance, set.DriftBudget = 1e-7, 1e-9
	h := integrate(s, 0, k.at(0), 40, set)
	if h.Terminal.Reason != "drift" {
		t.Fatalf("terminal %+v, want drift", h.Terminal)
	}
	y, ok := h.State(h.End)
	if !ok {
		t.Fatal("no state at the drift end")
	}
	e0 := s.energy(k.at(0))
	if d := math.Abs(s.energy(y)-e0) / math.Abs(e0); d > set.DriftBudget {
		t.Errorf("last state's energy error %.3g exceeds the budget", d)
	}
}

func TestNonfiniteStartStopsAtOnce(t *testing.T) {
	y := kepler{m1: 0.7, m2: 0.3, a: 1, e: 0}.at(0)
	y[2], y[3] = y[0], y[1] // coincident
	h := integrate(newSystem([]float64{0.7, 0.3}), 0, y, 10, DefaultSettings())
	if h.Terminal.Reason != "nonfinite" || h.End != 0 || h.Attempts != 0 {
		t.Fatalf("terminal %+v", h.Terminal)
	}
}
