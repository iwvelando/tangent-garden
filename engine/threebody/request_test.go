package threebody

import (
	"errors"
	"math"
	"testing"

	"tangentgarden/engine"
)

// figureEight is the corpus figure-eight as a request.
func figureEight(duration float64, samples int) Request {
	return Request{Bodies: caseNamed("figure-eight").Bodies, Duration: duration, Samples: samples}
}

func TestRequestRefusalsNameTheirField(t *testing.T) {
	good := figureEight(10, 100)
	edit := func(f func(*Request)) Request {
		q := good
		q.Bodies = append([]Body{}, good.Bodies...)
		f(&q)
		return q
	}
	for _, c := range []struct {
		name, field string
		q           Request
	}{
		{"two bodies", "bodies", edit(func(q *Request) { q.Bodies = q.Bodies[:2] })},
		{"NaN mass", "bodies.0.mass", edit(func(q *Request) { q.Bodies[0].Mass = math.NaN() })},
		{"light mass", "bodies.1.mass", edit(func(q *Request) { q.Bodies[1].Mass = 5e-4 })},
		{"mass sum", "bodies.2.mass", edit(func(q *Request) { q.Bodies[2].Mass += 1e-9 })},
		{"NaN position", "bodies.1.position", edit(func(q *Request) { q.Bodies[1].Position.Y = math.NaN() })},
		{"far position", "bodies.0.position", edit(func(q *Request) { q.Bodies[0].Position.X = 10.5 })},
		{"infinite velocity", "bodies.2.velocity", edit(func(q *Request) { q.Bodies[2].Velocity.X = math.Inf(1) })},
		{"fast", "bodies.2.velocity", edit(func(q *Request) { q.Bodies[2].Velocity = engine.Vec{X: 15, Y: 15} })},
		{"coincident", "bodies.1.position", edit(func(q *Request) { q.Bodies[1].Position = q.Bodies[0].Position })},
		{"too close", "bodies.2.position", edit(func(q *Request) {
			q.Bodies[2].Position = q.Bodies[1].Position.Add(engine.Vec{X: 0.009})
		})},
		{"zero duration", "duration", edit(func(q *Request) { q.Duration = 0 })},
		{"negative duration", "duration", edit(func(q *Request) { q.Duration = -1 })},
		{"NaN duration", "duration", edit(func(q *Request) { q.Duration = math.NaN() })},
		{"long duration", "duration", edit(func(q *Request) { q.Duration = 100.5 })},
		{"one sample", "samples", edit(func(q *Request) { q.Samples = 1 })},
		{"many samples", "samples", edit(func(q *Request) { q.Samples = 20001 })},
	} {
		_, err := c.q.Prepare()
		var named *engine.FieldError
		if !errors.As(err, &named) || named.Field != c.field {
			t.Errorf("%s: %v, want a refusal of %s", c.name, err, c.field)
		}
	}
	if _, err := good.Prepare(); err != nil {
		t.Fatalf("the unedited request was refused: %v", err)
	}
	// The limits themselves are admitted.
	q := edit(func(q *Request) { q.Duration, q.Samples = 100, 20000 })
	if _, err := q.Prepare(); err != nil {
		t.Errorf("the largest request was refused: %v", err)
	}
}

func TestSamplingPlanIsTheEvenPhysicalClock(t *testing.T) {
	// The last time is the duration itself, though 0.1·3/3 is not 0.1.
	if last := Times(0.1, 4)[3]; last != 0.1 {
		t.Errorf("the plan ends at %v", last)
	}
	p, err := figureEight(7.5, 31).Prepare()
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Times) != 31 || p.Times[0] != 0 || p.Times[30] != 7.5 {
		t.Fatalf("times %v", p.Times)
	}
	for k, at := range p.Times {
		if at != 7.5*float64(k)/30 && k != 30 {
			t.Fatalf("time %d is %v", k, at)
		}
	}
	if p.Available != 31 || len(p.Paths) != 3 || len(p.Paths[2].Velocities) != 31 || len(p.StepErrors) != 31 {
		t.Fatalf("available %d, paths %d", p.Available, len(p.Paths))
	}
	if p.Final.Time != 7.5 || p.Final.Positions[1] != p.Paths[1].Positions[30] {
		t.Errorf("final %+v is not the last sample", p.Final)
	}
	for k, e := range p.StepErrors {
		if !(e >= 0 && e <= 1) {
			t.Errorf("sample %d carries step error %g of the tolerance", k, e)
		}
	}
}

// The output plan never changes the integration: shared times give
// bit-identical samples whatever the count.
func TestSamplesDoNotDependOnTheirCount(t *testing.T) {
	a, _ := figureEight(20, 101).Prepare()
	b, _ := figureEight(20, 201).Prepare()
	if a.Accepted != b.Accepted {
		t.Fatalf("%d and %d steps", a.Accepted, b.Accepted)
	}
	for k := range a.Times {
		if a.Times[k] != b.Times[2*k] {
			t.Fatalf("time %d: %v and %v", k, a.Times[k], b.Times[2*k])
		}
		for i := range a.Paths {
			if a.Paths[i].Positions[k] != b.Paths[i].Positions[2*k] || a.Paths[i].Velocities[k] != b.Paths[i].Velocities[2*k] {
				t.Fatalf("sample %d of body %d differs", k, i+1)
			}
		}
	}
}

// An encounter between output times ends the samples before it; the final
// state is the encounter itself, never a sample past it.
func TestEncounterBetweenOutputTimes(t *testing.T) {
	// Bodies 1 and 2 fall together from rest; body 3 is far away.
	q := Request{Bodies: []Body{
		{Mass: 0.45, Position: engine.Vec{X: -0.5}},
		{Mass: 0.45, Position: engine.Vec{X: 0.5}},
		{Mass: 0.1, Position: engine.Vec{Y: 8}},
	}, Duration: 10, Samples: 11}
	p, err := q.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	if p.Terminal.Reason != "encounter" || p.Terminal.Pair != [2]int{1, 2} {
		t.Fatalf("terminal %+v", p.Terminal)
	}
	end := p.Final.Time
	if p.Available < 1 || p.Times[p.Available-1] > end || (p.Available < len(p.Times) && p.Times[p.Available] <= end) {
		t.Fatalf("available %d samples for an end at %g: %v", p.Available, end, p.Times)
	}
	if end == p.Times[p.Available-1] {
		t.Fatalf("the encounter fell on a sample time, %g", end)
	}
	gap := p.Final.Positions[1].Sub(p.Final.Positions[0]).Norm()
	near(t, "final separation", gap, DefaultSettings().Floor, 1e-12)
	// Free fall from rest at separation 1 under total mass 0.9 reaches
	// separation d at t = √(1/(2·0.9)) (√(d(1−d)) + arccos √d), the radial
	// Kepler orbit; body 3 perturbs it slightly.
	d := DefaultSettings().Floor
	want := math.Sqrt(1/(2*0.9)) * (math.Sqrt(d*(1-d)) + math.Acos(math.Sqrt(d)))
	near(t, "encounter time", end, want, 1e-2)
}

// Each sample carries the error estimate of the step that holds it: the
// accepted step ending there, or the step its dense state is taken within.
func TestSamplesCarryTheirStepsError(t *testing.T) {
	h, err := figureEight(5, 2).Integrate()
	if err != nil {
		t.Fatal(err)
	}
	for k := 1; k+1 < len(h.ts); k += 37 {
		mid := (h.ts[k] + h.ts[k+1]) / 2
		if got := h.sizes[h.stepAt(mid)]; got != h.sizes[k+1] {
			t.Fatalf("a state inside step %d carries error %g, want %g", k+1, got, h.sizes[k+1])
		}
		if got := h.sizes[h.stepAt(h.ts[k])]; got != h.sizes[k] {
			t.Fatalf("accepted state %d carries error %g, want %g", k, got, h.sizes[k])
		}
	}
}

// The center of mass is measured against its moving straight line.
func TestCenterDriftFollowsTheMovingCenter(t *testing.T) {
	q := figureEight(20, 101)
	q.Bodies = append([]Body{}, q.Bodies...)
	for i := range q.Bodies {
		q.Bodies[i].Velocity = q.Bodies[i].Velocity.Add(engine.Vec{X: 0.05, Y: -0.03})
	}
	p, err := q.Prepare()
	if err != nil {
		t.Fatal(err)
	}
	if d := p.Diagnostics.CenterError; d > 1e-12 {
		t.Errorf("a boosted center leaves its line by %.3g", d)
	}
	if d := p.Diagnostics.MomentumError; d > 1e-13 {
		t.Errorf("momentum changed by %.3g", d)
	}
}

func TestDiagnosticsAndBudgets(t *testing.T) {
	p, err := figureEight(100, 20000).Prepare()
	if err != nil {
		t.Fatal(err)
	}
	d := p.Diagnostics
	if p.Terminal.Reason != "end" || p.Attempts > 200000 || p.Attempts != p.Accepted+p.Rejected {
		t.Fatalf("terminal %+v after %d attempts", p.Terminal, p.Attempts)
	}
	if d.RetainedBytes <= 0 || d.RetainedBytes > 64<<20 {
		t.Errorf("retained %d bytes", d.RetainedBytes)
	}
	if d.EnergyError > 1e-10 || d.MomentumError > 1e-13 || d.AngularError > 1e-12 || d.CenterError > 1e-12 {
		t.Errorf("diagnostics %+v", d)
	}
	if d.Closest <= 0.1 || d.StepError > 1 {
		t.Errorf("closest %g, step error %g", d.Closest, d.StepError)
	}
}
