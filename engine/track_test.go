package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func track(t *testing.T, q Request) ConstructionTrack {
	t.Helper()
	tr, err := Track(q)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := json.Marshal(tr); err != nil {
		t.Fatal(err)
	}
	return tr
}

// at is the track's points at sample j.
func (tr *PositionTrack) at(j int) []Vec {
	out := make([]Vec, tr.Width)
	for k := range out {
		i := 2 * (j*tr.Width + k)
		out[k] = Vec{tr.Coords[i], tr.Coords[i+1]}
	}
	return out
}

// same reports whether two vectors agree in every bit.
func same(a, b Vec) bool {
	return math.Float64bits(a.X) == math.Float64bits(b.X) && math.Float64bits(a.Y) == math.Float64bits(b.Y)
}

func sameBits(a, b float64) bool { return math.Float64bits(a) == math.Float64bits(b) }

// checkShape checks a track's lengths and that an undefined sample holds
// zeros.
func checkShape(t *testing.T, name string, tr *PositionTrack, samples, width int, valued bool) {
	t.Helper()
	if tr == nil {
		t.Fatalf("%s: no track", name)
	}
	if tr.Width != width || len(tr.Coords) != 2*samples*width || len(tr.Defined) != samples || valued != (tr.Values != nil) || valued && len(tr.Values) != samples {
		t.Fatalf("%s: width %d, %d coords, %d flags, %d values", name, tr.Width, len(tr.Coords), len(tr.Defined), len(tr.Values))
	}
	for j, ok := range tr.Defined {
		if ok {
			continue
		}
		for _, p := range tr.at(j) {
			if p != (Vec{}) {
				t.Fatalf("%s: undefined sample %d holds %v", name, j, p)
			}
		}
		if valued && tr.Values[j] != 0 {
			t.Fatalf("%s: undefined sample %d holds value %g", name, j, tr.Values[j])
		}
	}
}

// representative lists where a study's line samples fall, which is where
// its positions can be.
func representative(q Request) map[int]bool {
	out := map[int]bool{}
	for line := 0; line < q.Lines; line++ {
		out[int(math.Round(float64(line)*float64(q.Samples-1)/float64(q.Lines-1)))] = true
	}
	return out
}

// Every representative position is the track's at its sample, in every bit,
// and every line sample the track defines has a position: the two are taken
// at the same code point under the same conditions. Refinement changes
// neither.
func TestTrackHarmonicMatchesPositions(t *testing.T) {
	terms := []Term{{1, 1, 0}, {-3, .4, .3}, {5, .21, -1.1}, {-7, .09, 2}}
	for name, q := range map[string]Request{
		"fourier":   fourierRequest(terms, 0, 2*math.Pi),
		"lissajous": lissajousRequest(Lissajous{2, 1.4, 3, 2, math.Pi / 4}, -1, 2*math.Pi),
	} {
		q.Samples, q.Lines = 1999, 48
		tr := track(t, q)
		width := len(terms) + 1
		if name == "lissajous" {
			width = 3
		}
		checkShape(t, name, tr.Harmonic, q.Samples, width, false)
		if tr.Samples != q.Samples || tr.Roulette != nil || tr.Rolling != nil || tr.Moving != nil {
			t.Fatalf("%s: %+v", name, tr)
		}
		for _, refine := range []bool{false, true} {
			q.Adaptive, q.AdaptiveFrame = refine, refine
			r := compute(t, q)
			lines := representative(q)
			if len(r.Harmonic.Positions) != len(lines) {
				t.Fatalf("%s: %d positions for %d lines", name, len(r.Harmonic.Positions), len(lines))
			}
			for _, s := range r.Harmonic.Positions {
				got := tr.Harmonic.at(s.SampleIndex)
				for k, joint := range s.Joints {
					if !same(got[k], joint) {
						t.Fatalf("%s refine=%v: sample %d joint %d %v, positions %v", name, refine, s.SampleIndex, k, got[k], joint)
					}
				}
				if !same(got[width-1], s.Point) {
					t.Fatalf("%s: sample %d point %v, positions %v", name, s.SampleIndex, got[width-1], s.Point)
				}
			}
			// Between the representative samples, the chain's tip is the
			// curve's head.
			for j, ok := range tr.Harmonic.Defined {
				if !ok {
					t.Fatalf("%s: sample %d undefined", name, j)
				}
				closeVec(t, r.Base[j], tr.Harmonic.at(j)[width-1], 1e-14)
			}
		}
	}
}

// A Fourier chain starts at the origin and each link is its term's vector:
// the joints are partial sums.
func TestTrackFourierChain(t *testing.T) {
	terms := []Term{{1, 1, 0}, {-2, .5, .7}, {4, .25, -.2}}
	q := fourierRequest(terms, 0, 2*math.Pi)
	tr := track(t, q)
	step := 2 * math.Pi / float64(q.Samples-1)
	for _, j := range []int{0, 1, 77, 250, 499, 500} {
		u := float64(j) * step
		got := tr.Harmonic.at(j)
		sum := Vec{}
		for k, term := range terms {
			closeVec(t, &got[k], sum, 1e-14)
			a := term.Frequency*u + term.Phase
			sum = sum.Add(Vec{math.Cos(a), math.Sin(a)}.Mul(term.Radius))
		}
		closeVec(t, &got[len(terms)], sum, 1e-14)
	}
}

// A roulette's rolling circle: center, contact and tracing point, with its
// radius, at every sample; the tracing point is the curve.
func TestTrackRoulette(t *testing.T) {
	for _, g := range []Roulette{
		{Roll: "inside", FixedRadius: 5, Radius: 2, Arm: 3, Phase: .4},
		{Roll: "outside", FixedRadius: 3, Radius: 1, Arm: 1, Phase: 0},
		{Roll: "line", Radius: 1, Arm: 1.5, Phase: .2},
	} {
		q := rouletteRequest(g, 0, 4*math.Pi)
		q.Samples, q.Lines = 1201, 30
		tr := track(t, q)
		checkShape(t, g.Roll, tr.Roulette, q.Samples, 3, true)
		r := compute(t, q)
		if len(r.Roulette.Positions) != q.Lines {
			t.Fatalf("%s: %d positions", g.Roll, len(r.Roulette.Positions))
		}
		for _, s := range r.Roulette.Positions {
			got := tr.Roulette.at(s.SampleIndex)
			if !same(got[0], s.Center) || !same(got[1], s.Contact) || !same(got[2], s.Point) || !sameBits(tr.Roulette.Values[s.SampleIndex], s.Radius) {
				t.Fatalf("%s: sample %d track %v %g, position %+v", g.Roll, s.SampleIndex, got, tr.Roulette.Values[s.SampleIndex], s)
			}
		}
		for j := range r.Base {
			if !tr.Roulette.Defined[j] || !same(tr.Roulette.at(j)[2], *r.Base[j]) {
				t.Fatalf("%s: sample %d %v, base %v", g.Roll, j, tr.Roulette.at(j), r.Base[j])
			}
			// The circle touches its contact point.
			got := tr.Roulette.at(j)
			if math.Abs(got[0].Sub(got[1]).Norm()-g.Radius) > 1e-12 {
				t.Fatalf("%s: sample %d contact %v off the circle %v", g.Roll, j, got[1], got[0])
			}
		}
	}
}

// The rolling circle construction is defined where its trace is: the
// tracing point is the derived curve. A stationary point leaves a gap, and
// the line samples it defines are exactly the representative positions.
func TestTrackRollingCircle(t *testing.T) {
	for name, q := range map[string]Request{
		"ellipse": rollingRequest("2*cos(t)", "1.2*sin(t)", 0, 6, Roller{Side: "left", Radius: .3, Arm: .5, Phase: .1}),
		// (t³, t²) is stationary at t = 0, a cusp the circle cannot roll
		// over: the arc length stops there.
		"cusp": rollingRequest("t^3", "t^2", -1, 1, Roller{Side: "right", Radius: .1, Arm: .1}),
	} {
		q.Samples, q.Lines = 1001, 41
		tr := track(t, q)
		checkShape(t, name, tr.Rolling, q.Samples, 3, true)
		if tr.Harmonic != nil || tr.Roulette != nil || tr.Moving != nil {
			t.Fatalf("%s: %+v", name, tr)
		}
		r := compute(t, q)
		positions := map[int]Rolling{}
		for _, s := range r.Rolling {
			positions[s.SampleIndex] = s
		}
		gaps := 0
		for j, ok := range tr.Rolling.Defined {
			s, drawn := positions[j]
			if representative(q)[j] && drawn != ok {
				t.Fatalf("%s: line sample %d defined %v, drawn %v", name, j, ok, drawn)
			}
			if !ok {
				gaps++
				continue
			}
			got := tr.Rolling.at(j)
			if !same(got[2], *r.Derived[j]) {
				t.Fatalf("%s: sample %d point %v, derived %v", name, j, got[2], r.Derived[j])
			}
			if drawn && (!same(got[0], s.Center) || !same(got[1], s.Contact) || !sameBits(tr.Rolling.Values[j], s.Radius)) {
				t.Fatalf("%s: sample %d track %v, position %+v", name, j, got, s)
			}
		}
		if len(positions) < 10 || name == "cusp" && gaps == 0 || name == "ellipse" && gaps != 0 {
			t.Fatalf("%s: %d positions, %d gaps", name, len(positions), gaps)
		}
	}
}

// A rolling curve's placement at every sample, and none after it stops.
func TestTrackRollingCurve(t *testing.T) {
	m := MovingCurve{X: "cos(t)^3", Y: "sin(t)^3", Min: 0, Max: 3, Start: .3}
	q := curveRequest("t", "0", 0, 3, "left", m, Vec{0, .5})
	tr := track(t, q)
	checkShape(t, "moving", tr.Moving, q.Samples, 3, true)
	if tr.Rolling != nil {
		t.Fatal("a rolling curve has no rolling circle")
	}
	r := compute(t, q)
	positions := map[int]Placement{}
	for _, s := range r.Moving.Positions {
		positions[s.SampleIndex] = s
	}
	last := -1
	for j, ok := range tr.Moving.Defined {
		s, drawn := positions[j]
		if representative(q)[j] && drawn != ok {
			t.Fatalf("line sample %d defined %v, drawn %v", j, ok, drawn)
		}
		if !ok {
			continue
		}
		last = j
		got := tr.Moving.at(j)
		if !same(got[2], *r.Derived[j]) {
			t.Fatalf("sample %d point %v, derived %v", j, got[2], r.Derived[j])
		}
		if drawn && (!same(got[0], s.Origin) || !same(got[1], s.Contact) || !sameBits(tr.Moving.Values[j], s.Angle)) {
			t.Fatalf("sample %d track %v %g, position %+v", j, got, tr.Moving.Values[j], s)
		}
	}
	// It stops at the cusp, before the domain ends.
	if last < 10 || last > q.Samples-50 || len(positions) < 5 {
		t.Fatalf("last defined sample %d, %d positions", last, len(positions))
	}
}

// A roulette with a rolling circle construction on it has both tracks.
func TestTrackBothConstructions(t *testing.T) {
	q := rouletteRequest(Roulette{Roll: "outside", FixedRadius: 3, Radius: 1, Arm: 1}, 0, 2*math.Pi)
	q.Kind, q.Rolling = "rolling", Roller{Side: "left", Radius: .2}
	tr := track(t, q)
	if tr.Roulette == nil || tr.Rolling == nil || tr.Harmonic != nil || tr.Moving != nil {
		t.Fatalf("%+v", tr)
	}
}

// Other studies have no moving construction to track; an invalid study is
// refused as Compute refuses it.
func TestTrackElsewhere(t *testing.T) {
	tr := track(t, request("evolute", "2*cos(t)", "sin(t)", 0, 6))
	if tr.Samples != 501 || tr.Harmonic != nil || tr.Roulette != nil || tr.Rolling != nil || tr.Moving != nil {
		t.Fatalf("%+v", tr)
	}
	q := fourierRequest([]Term{{1, 1, 0}}, 0, 1)
	q.Samples = 63
	if _, err := Track(q); err == nil || !strings.Contains(err.Error(), "samples") {
		t.Fatalf("error %v", err)
	}
}

// The track is the study's own run, with its result unchanged: computing a
// study after its track gives the same reply, with no track in it.
func TestTrackLeavesResult(t *testing.T) {
	q := fourierRequest([]Term{{1, 1, 0}, {3, .3, 1}}, 0, 2*math.Pi)
	q.Adaptive = true
	before, _ := json.Marshal(compute(t, q))
	track(t, q)
	after, _ := json.Marshal(compute(t, q))
	if string(before) != string(after) || strings.Contains(string(after), "coords") {
		t.Fatal("the track changed the study's reply")
	}
}
