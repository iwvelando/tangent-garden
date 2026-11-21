package engine3

import (
	"errors"
	"math"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// The topology-change scan (scan.go): a bounded coarse scan of one
// scalar, bisection of the brackets where the mesh's reading changes, and
// a recheck of each bracket's ends on two other grids. These tests run it
// over fields whose events are known exactly (the curated stories, and
// fields chosen for one difficulty each) and compare what it returns with
// the analysis. The expectations are derived here, never read from the
// mesher.

// scanStudy is an implicit study with no sections, as the scanner meshes.
func scanStudy(f string, level, a float64, b Box, cells int) ImplicitRequest {
	return ImplicitRequest{F: f, Level: level, A: a, Box: b, Cells: cells, Sections: SectionRequest{Normal: Vec3{0, 0, 1}}}
}

func runScan(t *testing.T, q ScanRequest) ScanResult {
	t.Helper()
	r, err := RunScan(q)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// eight returns n copies of χ.
func repeat(chi, n int) []int {
	out := make([]int, n)
	for k := range out {
		out[k] = chi
	}
	return out
}

// An expected event: its exact value, and the readings on either side in
// the axis's ascending order.
type knownEvent struct {
	at            float64
	below, above  []int
	belowCut      bool
	aboveCut      bool
	kind          string
	allowUnstable bool
}

// checkEvents asserts that the scan found exactly the expected events, in
// order, each bracketing a change between the expected readings, and that
// its bracket lies within tol of the exact value.
func checkEvents(t *testing.T, r ScanResult, want []knownEvent, tol float64) {
	t.Helper()
	if len(r.Candidates) != len(want) {
		t.Fatalf("%d candidates, want %d: %+v", len(r.Candidates), len(want), brief(r))
	}
	for k, w := range want {
		c := r.Candidates[k]
		if c.Kind != w.kind {
			t.Errorf("candidate %d is %q, want %q", k, c.Kind, w.kind)
		}
		pieces := func(r ScanReading, cut bool) []int {
			if cut {
				return r.Cut
			}
			return r.Pieces
		}
		if !slices.Equal(pieces(c.Before, w.belowCut), w.below) || !slices.Equal(pieces(c.After, w.aboveCut), w.above) {
			t.Errorf("candidate %d reads %+v → %+v, want %v → %v", k, c.Before, c.After, w.below, w.above)
		}
		if (c.Before.Status == "cut") != w.belowCut || (c.After.Status == "cut") != w.aboveCut {
			t.Errorf("candidate %d's statuses %q → %q", k, c.Before.Status, c.After.Status)
		}
		if !(c.Lo < c.Hi) {
			t.Errorf("candidate %d bracket [%g, %g] is empty", k, c.Lo, c.Hi)
		}
		if gap := math.Max(c.Lo-w.at, w.at-c.Hi); gap > tol {
			t.Errorf("candidate %d bracket [%g, %g] lies %g from the event at %g (tolerance %g)", k, c.Lo, c.Hi, gap, w.at, tol)
		}
		if !w.allowUnstable && c.Stability != "stable" {
			t.Errorf("candidate %d at %g is %q: %+v %+v", k, w.at, c.Stability, c.Lattice, c.Finer)
		}
	}
}

func brief(r ScanResult) []string {
	var out []string
	for _, c := range r.Candidates {
		out = append(out, c.Kind+" "+fmtF(c.Lo)+".."+fmtF(c.Hi)+" "+fmtI(c.Before.Pieces)+"→"+fmtI(c.After.Pieces))
	}
	return out
}

// The four curated stories (docs/mathematics.md, Curated events), each
// scanned over its covered levels on its example's grid. Every event is
// found once, between the analysis's classes, and every bracket lies
// within a quarter of the coarse step of the exact critical level.
func TestScanStories(t *testing.T) {
	presets := spatialPresets(t)
	cases := []struct {
		preset   string
		low, hi  float64
		events   []knownEvent
		minWidth float64
	}{
		{"Two drops become one", 0.64, 1.44, []knownEvent{{at: 1, below: []int{2, 2}, above: []int{2}, kind: "change"}}, 0},
		{"The instant a handle appears", 0.64, 1.44, []knownEvent{{at: 1, below: []int{0}, above: []int{2}, kind: "change"}}, 0},
		{"The tanglecube's three events", -18, 4, []knownEvent{
			{at: -12.5, below: repeat(2, 8), above: []int{-8}, kind: "change"},
			{at: -6.25, below: []int{-8}, above: []int{2, 2}, kind: "change"},
			{at: 0, below: []int{2, 2}, above: []int{2}, kind: "change"},
		}, 0},
		{"Two handles open at once", 0.01, 0.1, []knownEvent{{at: 1.0 / 16, below: []int{-2}, above: []int{2}, kind: "change"}}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.preset, func(t *testing.T) {
			q := presets[tc.preset].Implicit
			r := runScan(t, ScanRequest{Implicit: q, Axis: "level", From: tc.low, To: tc.hi, Samples: 17, Depth: 8, Recheck: true})
			if r.Stop != "complete" {
				t.Fatalf("stopped: %s", r.Stop)
			}
			step := (tc.hi - tc.low) / 16
			checkEvents(t, r, tc.events, step/4)
			// Every coarse sample is complete, uncut and reads its side.
			for _, s := range r.Samples {
				if s.Reading.Status != "complete" {
					t.Errorf("sample %g: %+v", s.Value, s.Reading)
				}
			}
			// The bisection reached its depth: each bracket is the coarse
			// step halved eight times.
			for _, c := range r.Candidates {
				if c.Depth != 8 || math.Abs((c.Hi-c.Lo)-step/256) > 1e-9*step {
					t.Errorf("bracket [%g, %g] at depth %d", c.Lo, c.Hi, c.Depth)
				}
			}
		})
	}
}

// The drops are born at −75/4, below the tanglecube story's levels: from
// −20 the scan finds the birth as a change from no surface to eight drops.
func TestScanBirth(t *testing.T) {
	q := spatialPresets(t)["The tanglecube's three events"].Implicit
	r := runScan(t, ScanRequest{Implicit: q, Axis: "level", From: -20, To: -16, Samples: 9, Depth: 8, Recheck: true})
	// A drop is meshed only once it holds a grid point, so the mesh sees
	// the birth late, by at most F's growth from the minimum to the
	// farthest a grid point can be: the Hessian there is 20 on every axis,
	// so 10 (√3 h/2)² with h = 6/32, the coarsest grid's cell.
	h := 6.0 / 32
	late := 10 * 3 * h * h / 4
	checkEvents(t, r, []knownEvent{{at: -75.0/4 + late/2, below: []int{}, above: repeat(2, 8), kind: "change"}}, late/2)
	if c := r.Candidates[0]; c.Lo <= -75.0/4 || c.Spread[0] <= -75.0/4 {
		t.Errorf("the birth is seen early: %+v", c)
	}
	if r.Samples[0].Reading.Status != "complete" || len(r.Samples[0].Reading.Pieces) != 0 {
		t.Errorf("no surface at −20 should read complete and empty: %+v", r.Samples[0].Reading)
	}
}

// The shape parameter: two drops parted by a, F = (r² + a²)² − 4a²x² at
// c = 1. ∇F = (4x(r² − a²), 4y(r² + a²), 4z(r² + a²)) vanishes at the
// foci (F = 0) and at the origin, where F = a⁴: one sphere while a⁴ < 1,
// two drops once a⁴ > 1. And a handle of radius √a, F = (ρ² − a)² + z² at
// c = 1, whose origin has F = a²: a sphere while a < 1, a torus above.
func TestScanShapeParameter(t *testing.T) {
	cases := []struct {
		name  string
		f     string
		box   Box
		event knownEvent
	}{
		{"drops", "((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)", Box{-2, 2, -1.2, 1.2, -1.2, 1.2},
			knownEvent{at: 1, below: []int{2}, above: []int{2, 2}, kind: "change"}},
		{"handle", "(x^2+y^2-a)^2+z^2", Box{-2, 2, -2, 2, -1.2, 1.2},
			knownEvent{at: 1, below: []int{2}, above: []int{0}, kind: "change"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := runScan(t, ScanRequest{Implicit: scanStudy(tc.f, 1, 0.6, tc.box, 40), Axis: "a", From: 0.6, To: 1.4, Samples: 9, Depth: 8, Recheck: true})
			checkEvents(t, r, []knownEvent{tc.event}, 0.1/4)
			// The scan changes a alone: every sample's level is the study's.
			for _, s := range r.Samples {
				if s.Reading.Status != "complete" {
					t.Errorf("a = %g: %+v", s.Value, s.Reading)
				}
			}
		})
	}
	// A field that does not read a has no shape axis.
	_, err := RunScan(ScanRequest{Implicit: scanStudy("x^2+y^2+z^2", 1, 1, cube(2), 16), Axis: "a", From: 0, To: 1, Samples: 5})
	wantField(t, err, "scan.axis")
}

// A sphere growing through its box, F = r² in [−1, 1]³: it meets the
// faces at c = 1, the edges at c = 2 and the corners at c = 3, and F has no
// critical point there. Inside the box it is a sphere, then a sphere less
// six disks (χ = −4, cut), then eight corner patches (χ = 1 each, cut), then
// nothing. Every candidate involves the box, and none is a change.
func TestScanBoxEvents(t *testing.T) {
	r := runScan(t, ScanRequest{Implicit: scanStudy("x^2+y^2+z^2", 0.5, 1, cube(1), 32), Axis: "level", From: 0.5, To: 3.5, Samples: 13, Depth: 8, Recheck: true})
	checkEvents(t, r, []knownEvent{
		{at: 1, below: []int{2}, above: []int{-4}, aboveCut: true, kind: "box", allowUnstable: true},
		{at: 2, below: []int{-4}, above: repeat(1, 8), belowCut: true, aboveCut: true, kind: "box", allowUnstable: true},
		{at: 3, below: repeat(1, 8), above: []int{}, belowCut: true, kind: "box", allowUnstable: true},
	}, 0.25)
}

// The tanglecube in *The tanglecube*'s box, [−2.6, 2.6]³, which its
// shell's half-width √((5 + √(75 + 4c))/2) reaches at c = (8.52² − 75)/4
// ≈ −0.6024: the box cuts the outer sphere open there, a box event, which
// the mesh sees late, once the shell crosses a grid edge on a face. The
// hollow still vanishes at c = 0 inside the cut shell, a change beside a
// cut piece that does not change.
func TestScanChangeBesideCut(t *testing.T) {
	reach := (math.Pow(2*2.6*2.6-5, 2) - 75) / 4
	q := scanStudy("x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2", 0, 1, cube(2.6), 48)
	r := runScan(t, ScanRequest{Implicit: q, Axis: "level", From: -3, To: 2, Samples: 11, Depth: 6, Recheck: true})
	if len(r.Candidates) != 2 {
		t.Fatalf("%v", brief(r))
	}
	box, hollow := r.Candidates[0], r.Candidates[1]
	if box.Kind != "box" || !slices.Equal(box.Before.Pieces, []int{2, 2}) || len(box.After.Cut) != 1 || !slices.Equal(box.After.Pieces, []int{2}) ||
		!(box.Lo > reach && box.Hi < reach+0.05) {
		t.Errorf("reach %g: %+v", reach, box)
	}
	if hollow.Kind != "change" || !slices.Equal(hollow.Before.Pieces, []int{2}) || len(hollow.After.Pieces) != 0 ||
		!slices.Equal(hollow.Before.Cut, hollow.After.Cut) || !(hollow.Spread[0] <= 0 && hollow.Spread[1] >= 0) {
		t.Errorf("%+v", hollow)
	}
}

// A tilted double well, F = g(x) + y² + z² with g(t) = t⁴ − 2t² + bt: below
// the shallow well's minimum the level set is one sphere, between that
// minimum and the barrier's maximum two, and above the barrier one again.
// A coarse step wider than that gap can miss both events, whose readings
// cancel; a finer one finds them as two candidates.
func TestScanCancellingPair(t *testing.T) {
	const b = 1.0
	birth, merge := tiltedWell(b)
	if !(merge-birth > 0.15 && merge-birth < 0.25) {
		t.Fatalf("gap %g", merge-birth)
	}
	q := scanStudy("x^4 - 2*x^2 + 1*x + y^2 + z^2", 0, 1, cube(2.2), 48)
	// Samples every 0.4 from −1 miss (−0.073, 0.130).
	coarse := runScan(t, ScanRequest{Implicit: q, Axis: "level", From: -1, To: 1.4, Samples: 7, Depth: 8, Recheck: true})
	if len(coarse.Candidates) != 0 {
		t.Errorf("a coarse scan found %v", brief(coarse))
	}
	fine := runScan(t, ScanRequest{Implicit: q, Axis: "level", From: -1, To: 1.4, Samples: 25, Depth: 8, Recheck: true})
	checkEvents(t, fine, []knownEvent{
		{at: birth, below: []int{2}, above: []int{2, 2}, kind: "change"},
		{at: merge, below: []int{2, 2}, above: []int{2}, kind: "change"},
	}, 0.1/4)
}

// tiltedWell returns g's shallow minimum and barrier maximum, the roots of
// g′(t) = 4t³ − 4t + bt above the deepest, by Newton's method on g′ from
// either side of the barrier, on g itself.
func tiltedWell(b float64) (birth, merge float64) {
	g := func(t float64) float64 { return t*t*t*t - 2*t*t + b*t }
	root := func(t float64) float64 {
		for range 60 {
			t -= (4*t*t*t - 4*t + b) / (12*t*t - 4)
		}
		return t
	}
	return g(root(1)), g(root(0))
}

// A pole: F = 1/(r² − 1) changes sign across the unit sphere without
// crossing any level, so every sample is unresolved and no change is
// claimed. A field undefined in the box's corners is unresolved too.
func TestScanUnresolved(t *testing.T) {
	for _, tc := range []struct{ f, why string }{
		{"1/(x^2+y^2+z^2-1)", "poles"}, // 25 cells: no grid point on the pole
		{"sqrt(4-x^2-y^2-z^2)", "open"},
	} {
		r := runScan(t, ScanRequest{Implicit: scanStudy(tc.f, 1, 1, cube(1.5), 25), Axis: "level", From: 0.5, To: 1.5, Samples: 9, Depth: 6, Recheck: true})
		if len(r.Candidates) != 0 {
			t.Errorf("%s: %v", tc.f, brief(r))
		}
		if r.Unresolved != len(r.Samples) {
			t.Errorf("%s: %d of %d samples unresolved", tc.f, r.Unresolved, len(r.Samples))
		}
		for _, s := range r.Samples {
			if s.Reading.Status != "incomplete" || s.Reading.Why != tc.why {
				t.Errorf("%s at %g: %+v", tc.f, s.Value, s.Reading)
			}
		}
	}
}

// A sample exactly at a critical level, where the mesh has a vertex
// without a normal: on the drops' 56-cell grid at c = 1 the origin is a
// grid point, and the two drops share it (χ = 3). The two brackets either
// side of it are reported as one candidate through that singular sample.
func TestScanSingularSample(t *testing.T) {
	q := spatialPresets(t)["Two drops become one"].Implicit
	r := runScan(t, ScanRequest{Implicit: q, Axis: "level", From: 0.5, To: 1.5, Samples: 3, Depth: 6, Recheck: false})
	k := slices.IndexFunc(r.Samples, func(s ScanSample) bool { return s.Value == 1 })
	if k < 0 || !r.Samples[k].Coarse || r.Samples[k].Reading.Singular == 0 || !slices.Equal(r.Samples[k].Reading.Pieces, []int{3}) {
		t.Fatalf("the middle sample: %+v", r.Samples)
	}
	if len(r.Candidates) != 2 {
		t.Fatalf("%v", brief(r))
	}
	c := r.Candidates[0]
	if c.Kind != "change" || c.Through == nil || c.Through.Value != 1 || !slices.Equal(c.Before.Pieces, []int{2, 2}) || !slices.Equal(c.After.Pieces, []int{2}) {
		t.Errorf("%+v", c)
	}
	if !(c.Lo < 1 && c.Hi > 1 && c.Hi-c.Lo <= 2*0.5/64+1e-12) || !slices.Contains(c.Singular, 1) {
		t.Errorf("bracket [%g, %g], singular %v", c.Lo, c.Hi, c.Singular)
	}
	if c.Stability != "unchecked" {
		t.Errorf("without recheck: %q", c.Stability)
	}
	// Bisection lands on c = 1.25, where two grid points lie on the level
	// at both ends of a grid edge, and the mesher reports a false pole
	// (#504). The scan calls that one sample unresolved, with a sphere on
	// either side, and claims no change.
	u := r.Candidates[1]
	if u.Kind != "unresolved" || u.Through == nil || u.Through.Value != 1.25 || u.Through.Reading.Why != "poles" ||
		!slices.Equal(u.Before.Pieces, []int{2}) || !slices.Equal(u.After.Pieces, []int{2}) {
		t.Errorf("%+v", u)
	}
}

// Near an event a feature narrower than a cell is misread. On 29 cells,
// half the handle example's 56 and odd, so the origin lies inside a cell,
// the hole is missed below c ≈ 0.986, so the bracket lies below the event.
// The rechecks find the change nearer 1 on their grids, and the spread
// across the three grids holds the event, wide; on the example's own grid
// it is narrow.
func TestScanResolutionShift(t *testing.T) {
	q := spatialPresets(t)["The instant a handle appears"].Implicit
	req := ScanRequest{Implicit: q, Axis: "level", From: 0.64, To: 1.44, Samples: 17, Depth: 8, Recheck: true}
	req.Implicit.Cells = 29
	r := runScan(t, req)
	if len(r.Candidates) != 1 {
		t.Fatalf("%v", brief(r))
	}
	c := r.Candidates[0]
	if !(c.Hi < 0.99) || !(c.Spread[0] == c.Lo && c.Spread[1] >= 1 && c.Spread[1]-c.Spread[0] > 0.01) {
		t.Errorf("29 cells: [%g, %g] spread %v, %+v %+v", c.Lo, c.Hi, c.Spread, c.Lattice, c.Finer)
	}
	req.Implicit.Cells = 56
	c = runScan(t, req).Candidates[0]
	if c.Stability != "stable" || !(c.Spread[0] <= 1 && c.Spread[1] >= 1 && c.Spread[1]-c.Spread[0] < 0.005) {
		t.Errorf("56 cells: %q, spread %v", c.Stability, c.Spread)
	}
}

// Limits: the call and cell budgets stop the scan, which reports why and
// keeps what it has; every sample counts toward both. A canceled scan
// stops at once.
func TestScanBudgets(t *testing.T) {
	q := spatialPresets(t)["The tanglecube's three events"].Implicit
	req := ScanRequest{Implicit: q, Axis: "level", From: -18, To: 4, Samples: 17, Depth: 8, Recheck: true}
	full := runScan(t, req)
	// Every call is accounted for: the coarse samples, each bisection, and
	// for each recheck its two ends and its own bisections.
	calls, cells := 17+3*8, (17+3*8)*32*32*32
	for _, c := range full.Candidates {
		if c.Depth != 8 {
			t.Errorf("depth %d", c.Depth)
		}
		for _, r := range []*ScanRecheck{c.Lattice, c.Finer} {
			if r == nil || r.Outcome != "agrees" {
				t.Fatalf("%+v", r)
			}
			n := 2 + r.Depth
			calls += n
			cells += n * r.Cells * r.Cells * r.Cells
		}
	}
	if full.Calls != calls || full.Cells != cells || full.Calls > 17+3*8+3*2*(2+8) {
		t.Errorf("%d calls, %d cells; want %d, %d", full.Calls, full.Cells, calls, cells)
	}
	if full.Candidates[0].Lattice.Cells != 33 || full.Candidates[0].Finer.Cells != 48 {
		t.Errorf("recheck grids %d, %d", full.Candidates[0].Lattice.Cells, full.Candidates[0].Finer.Cells)
	}
	const cubeCells = 32 * 32 * 32

	saved := maxScanCalls
	maxScanCalls = 20
	r := runScan(t, req)
	maxScanCalls = saved
	if r.Stop != "calls" || r.Calls != 20 {
		t.Errorf("call limit: stop %q after %d", r.Stop, r.Calls)
	}
	// The coarse pass finished, leaving too few calls to recheck its three
	// brackets even unbisected: bisection never starts, every candidate is
	// still found, and the rechecks use what is left, the first candidate's
	// lattice and no more.
	if len(r.Candidates) != 3 || !r.Curtailed {
		t.Errorf("curtailed %v: %v", r.Curtailed, brief(r))
	}
	for k, c := range r.Candidates {
		if c.Depth != 0 || c.Stability != "unchecked" {
			t.Errorf("%+v", c)
		}
		if lattice := "skipped"; k == 0 && c.Lattice.Outcome != "agrees" || k > 0 && c.Lattice.Outcome != lattice || c.Finer.Outcome != "skipped" {
			t.Errorf("candidate %d's rechecks: %s, %s", k, c.Lattice.Outcome, c.Finer.Outcome)
		}
	}

	savedCells := maxScanCells
	maxScanCells = 10 * cubeCells
	r = runScan(t, req)
	maxScanCells = savedCells
	if r.Stop != "cells" || r.Calls != 10 || len(r.Samples) != 10 || r.Curtailed {
		t.Errorf("cell limit: stop %q after %d calls, %d samples", r.Stop, r.Calls, len(r.Samples))
	}

	s, err := NewScan(req)
	if err != nil {
		t.Fatal(err)
	}
	s.Step()
	s.Cancel()
	if s.Step() {
		t.Error("a canceled scan stepped")
	}
	if got := s.Result(); got.Stop != "canceled" || got.Calls != 1 {
		t.Errorf("canceled: %q after %d", got.Stop, got.Calls)
	}
}

// The page cancels a scan by closing its worker, so the last reply is all
// it keeps. Before the rechecks, that reply holds the candidates the
// brackets so far make, unchecked, exactly as Cancel settles them: during
// the coarse pass and during bisection alike. The tanglecube story from
// −18 to 4 changes at −12.5, −6.25 and 0; sixteen samples, 22/15 apart,
// put them between the fourth and fifth, ninth and tenth, and thirteenth
// and fourteenth.
func TestScanResultBeforeRechecks(t *testing.T) {
	q := spatialPresets(t)["The tanglecube's three events"].Implicit
	req := ScanRequest{Implicit: q, Axis: "level", From: -18, To: 4, Samples: 16, Depth: 5, Recheck: true}
	for _, steps := range []int{1, 8, 16, 16 + 4, 16 + 3*5} {
		s, err := NewScan(req)
		if err != nil {
			t.Fatal(err)
		}
		for range steps {
			s.Step()
		}
		kept := s.Result()
		if kept.Stop != "running" || kept.Calls != steps {
			t.Fatalf("after %d steps: %q, %d calls", steps, kept.Stop, kept.Calls)
		}
		s.Cancel()
		settled := s.Result()
		if !slices.EqualFunc(kept.Candidates, settled.Candidates, func(a, b ScanCandidate) bool {
			return a.Lo == b.Lo && a.Hi == b.Hi && a.Kind == b.Kind && a.Depth == b.Depth && a.Stability == b.Stability &&
				a.Lattice == nil && a.Finer == nil && b.Lattice == nil && b.Finer == nil
		}) {
			t.Errorf("after %d steps the reply holds %v; Cancel settles %v", steps, brief(kept), brief(settled))
		}
		// A change is bracketed once the sample after it is meshed.
		want := 0
		for _, after := range []int{5, 10, 14} {
			if steps >= after {
				want++
			}
		}
		if len(kept.Candidates) != want {
			t.Errorf("after %d steps: %d candidates, want %d: %v", steps, len(kept.Candidates), want, brief(kept))
		}
	}
}

// At the mesher's grid limit neither one cell more nor one half again as
// many fits: the rechecks use one cell fewer and two thirds as many.
func TestScanGridAtLimit(t *testing.T) {
	q := scanStudy("x", 0, 1, cube(1), 64)
	if g, f := scanGrid(q, false), scanGrid(q, true); g != 63 || f != 43 {
		t.Errorf("64 cells: rechecks on %d and %d", g, f)
	}
	q.Cells = 32
	if g, f := scanGrid(q, false), scanGrid(q, true); g != 33 || f != 48 {
		t.Errorf("32 cells: rechecks on %d and %d", g, f)
	}
}

// Requests are validated field by field before any meshing.
func TestScanValidate(t *testing.T) {
	ok := ScanRequest{Implicit: scanStudy("x^2+y^2+z^2", 1, 1, cube(2), 16), Axis: "level", From: 0, To: 1, Samples: 5, Depth: 4}
	cases := []struct {
		change func(*ScanRequest)
		field  string
	}{
		{func(q *ScanRequest) { q.Axis = "t" }, "scan.axis"},
		{func(q *ScanRequest) { q.From = math.NaN() }, "scan.from"},
		{func(q *ScanRequest) { q.To = 2e5 }, "scan.to"},
		{func(q *ScanRequest) { q.To = q.From }, "scan.to"},
		{func(q *ScanRequest) { q.Samples = 2 }, "scan.samples"},
		{func(q *ScanRequest) { q.Samples = maxScanSamples + 1 }, "scan.samples"},
		{func(q *ScanRequest) { q.Depth = -1 }, "scan.depth"},
		{func(q *ScanRequest) { q.Depth = maxScanDepth + 1 }, "scan.depth"},
		{func(q *ScanRequest) { q.Implicit.Cells = 2 }, "implicit.cells"},
		{func(q *ScanRequest) { q.Implicit.F = "x +" }, "implicit.f"},
	}
	for _, tc := range cases {
		q := ok
		tc.change(&q)
		_, err := NewScan(q)
		wantField(t, err, tc.field)
	}
	if _, err := NewScan(ok); err != nil {
		t.Error(err)
	}
}

func wantField(t *testing.T, err error, field string) {
	t.Helper()
	if err == nil {
		t.Fatalf("no error, want one on %s", field)
	}
	var fe *FieldError
	if !errors.As(err, &fe) || fe.Field != field {
		t.Errorf("%v, want an error on %s", err, field)
	}
}

func fmtF(v float64) string { return strconv.FormatFloat(v, 'g', 6, 64) }
func fmtI(v []int) string {
	var s []string
	for _, x := range v {
		s = append(s, strconv.Itoa(x))
	}
	return "[" + strings.Join(s, " ") + "]"
}

// The optional critical-point search: Newton's method from grid points
// near each candidate finds where ∇F vanishes (or, scanning a, where
// ∇ₓF = 0 on F = c). On the controls it returns the exact critical values
// and Morse indices; a box event, where F has no critical point, gets none.
func TestScanCritical(t *testing.T) {
	p := spatialPresets(t)
	// points, when not 0, is how many distinct points share the value.
	type want struct {
		value  float64
		index  int
		points int
	}
	birth, merge := tiltedWell(1)
	cases := []struct {
		name string
		req  ScanRequest
		want [][]want
	}{
		{"tanglecube", ScanRequest{Implicit: p["The tanglecube's three events"].Implicit, Axis: "level", From: -20, To: 4, Samples: 17, Depth: 5},
			[][]want{{{-75.0 / 4, 0, 0}}, {{-12.5, 1, 0}}, {{-6.25, 2, 0}}, {{0, 3, 1}}}},
		{"two handles", ScanRequest{Implicit: p["Two handles open at once"].Implicit, Axis: "level", From: 0.01, To: 0.1, Samples: 17, Depth: 5},
			[][]want{{{1.0 / 16, 2, 2}}}},
		{"tilted well", ScanRequest{Implicit: scanStudy("x^4 - 2*x^2 + 1*x + y^2 + z^2", 0, 1, cube(2.2), 48), Axis: "level", From: -1, To: 1.4, Samples: 25, Depth: 5},
			[][]want{{{birth, 0, 1}}, {{merge, 1, 1}}}},
		{"drops in a", ScanRequest{Implicit: scanStudy("((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)", 1, 1, Box{-2, 2, -1.2, 1.2, -1.2, 1.2}, 40), Axis: "a", From: 0.6, To: 1.4, Samples: 9, Depth: 5},
			[][]want{{{1, 1, 1}}}},
		{"handle in a", ScanRequest{Implicit: scanStudy("(x^2+y^2-a)^2+z^2", 1, 1, Box{-2, 2, -2, 2, -1.2, 1.2}, 40), Axis: "a", From: 0.6, To: 1.4, Samples: 9, Depth: 5},
			[][]want{{{1, 2, 1}}}},
		{"sphere through its box", ScanRequest{Implicit: scanStudy("x^2+y^2+z^2", 1, 1, cube(1), 32), Axis: "level", From: 0.5, To: 3.5, Samples: 13, Depth: 5},
			[][]want{{}, {}, {}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.req.Critical = true
			r := runScan(t, tc.req)
			if len(r.Candidates) != len(tc.want) {
				t.Fatalf("%v", brief(r))
			}
			for k, c := range r.Candidates {
				if len(c.Critical) != len(tc.want[k]) {
					t.Errorf("candidate %d: %+v", k, c.Critical)
					continue
				}
				for j, w := range tc.want[k] {
					got := c.Critical[j]
					if math.Abs(got.Value-w.value) > 1e-7*math.Max(1, math.Abs(w.value)) || got.Index != w.index || w.points > 0 && got.Points != w.points {
						t.Errorf("candidate %d: critical %+v, want value %g index %d", k, got, w.value, w.index)
					}
				}
			}
		})
	}
}

// Rechecks look outward and are strict. Drops parted by a, sampled every
// 0.133 from 0.6: the coarse sample at a = 1 is the critical value itself,
// which one cell more reads as already parted, so that recheck must look a
// step lower. The tanglecube in *The tanglecube*'s box at 7 samples: the
// box's cut is read differently on one recheck grid alone, which is enough
// to make it unstable. On 17 cells a sample lands on c = −12.5, where the
// mesh is singular; that blip is not a change, and does not narrow the
// recheck of the change before it.
func TestScanRecheckReach(t *testing.T) {
	drops := runScan(t, ScanRequest{Implicit: scanStudy("((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)", 1, 1, Box{-2, 2, -1.2, 1.2, -1.2, 1.2}, 40),
		Axis: "a", From: 0.6, To: 1.3986, Samples: 7, Depth: 8, Recheck: true})
	if len(drops.Candidates) != 1 {
		t.Fatalf("%v", brief(drops))
	}
	// The study grid's bracket lies above the coarse sample a = 0.9993,
	// just below the event; the lattice's lies wholly below that sample,
	// which only a wider look can find.
	if c := drops.Candidates[0]; c.Lo < 0.9993 || c.Stability != "stable" || !(c.Lattice.Hi < 0.9993) {
		t.Errorf("drops: %q, lattice %+v", c.Stability, c.Lattice)
	}

	box := runScan(t, ScanRequest{Implicit: scanStudy("x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2", 0, 1, cube(2.6), 48),
		Axis: "level", From: -18, To: 4, Samples: 7, Depth: 8, Recheck: true})
	k := slices.IndexFunc(box.Candidates, func(c ScanCandidate) bool { return c.Kind == "box" })
	if k < 0 {
		t.Fatalf("%v", brief(box))
	}
	if c := box.Candidates[k]; c.Stability != "unstable" || (c.Lattice.Outcome == "agrees") == (c.Finer.Outcome == "agrees") {
		t.Errorf("one recheck disagrees: %q, %s, %s", c.Stability, c.Lattice.Outcome, c.Finer.Outcome)
	}

	q := spatialPresets(t)["The tanglecube's three events"].Implicit
	q.Cells = 17
	r := runScan(t, ScanRequest{Implicit: q, Axis: "level", From: -18, To: 4, Samples: 17, Depth: 8, Recheck: true})
	k = slices.IndexFunc(r.Candidates, func(c ScanCandidate) bool { return c.Kind == "singular" })
	if k != 1 || r.Candidates[k].Through.Value != -12.5 {
		t.Fatalf("%v", brief(r))
	}
	if c := r.Candidates[0]; c.Stability != "stable" || !(c.Spread[0] <= -12.5 && c.Spread[1] >= -12.5) {
		t.Errorf("the drops join: %q, spread %v", c.Stability, c.Spread)
	}
	// The same field negated, scanned over the negated range: {−F = c} is
	// {F = −c}, so the same surfaces pass in reverse order, and the singular
	// sample at 12.5 now comes just before the change, whose rechecks it
	// does not narrow either.
	q.F = "-(" + q.F + ")"
	r = runScan(t, ScanRequest{Implicit: q, Axis: "level", From: -4, To: 18, Samples: 17, Depth: 8, Recheck: true})
	n := len(r.Candidates)
	if n < 2 || r.Candidates[n-2].Kind != "singular" || r.Candidates[n-2].Through.Value != 12.5 {
		t.Fatalf("negated: %v", brief(r))
	}
	if c := r.Candidates[n-1]; c.Kind != "change" || c.Stability != "stable" || !(c.Spread[0] <= 12.5 && c.Spread[1] >= 12.5) {
		t.Errorf("negated, the drops part: %q, spread %v", c.Stability, c.Spread)
	}
}

// Critical points are grouped by value and index. With the z term scaled
// by 0.97, the cage's twelve saddles take two values: four with z = 0 at
// −12.5, and eight with z = ±√(5/2) at −6.25 − 0.97 · 6.25 = −12.3125,
// all of index 1. Both lie beside the change where the drops join.
func TestScanCriticalGroups(t *testing.T) {
	q := scanStudy("x^4 - 5*x^2 + y^4 - 5*y^2 + 0.97*(z^4 - 5*z^2)", 0, 1, cube(3), 32)
	r := runScan(t, ScanRequest{Implicit: q, Axis: "level", From: -14, To: -11, Samples: 5, Depth: 5, Recheck: true, Critical: true})
	if len(r.Candidates) == 0 {
		t.Fatal("no candidate")
	}
	// On 33 cells the maximum at the origin lies at a cell's center, where
	// the eight nodes about it tie as seeds: it is still one point.
	odd := runScan(t, ScanRequest{Implicit: scanStudy("x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2", 0, 1, cube(3), 33), Axis: "level", From: -1, To: 1, Samples: 5, Depth: 4, Critical: true})
	if len(odd.Candidates) != 1 || len(odd.Candidates[0].Critical) != 1 || odd.Candidates[0].Critical[0].Points != 1 || odd.Candidates[0].Critical[0].Index != 3 {
		t.Errorf("33 cells: %v", odd.Candidates)
	}
	want := []ScanCritical{{Value: -12.5, Index: 1, Points: 4}, {Value: -12.3125, Index: 1, Points: 8}}
	for _, c := range r.Candidates {
		if len(c.Critical) != 2 {
			t.Errorf("%+v", c.Critical)
			continue
		}
		for j, w := range want {
			got := c.Critical[j]
			if math.Abs(got.Value-w.Value) > 1e-7 || got.Index != w.Index || got.Points != w.Points {
				t.Errorf("%+v, want %+v", got, w)
			}
		}
	}
}

// Every value the scan meshes is cleaned of floating-point tails first, as
// roundedGenerated cleans the app's generated defaults, so the value shown
// and set is the value meshed: the coarse samples of [0.6, 1.4] are 0.6,
// 0.7, …, 1.4 exactly, never 0.9999999999999999, and their midpoints are
// short decimals too. A range whose ends are not short decimals keeps
// its samples within rounding of the exact interpolation, and its ends.
func TestScanGeneratedValues(t *testing.T) {
	q := scanStudy("((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)", 1, 0.6, Box{-2, 2, -1.2, 1.2, -1.2, 1.2}, 24)
	r := runScan(t, ScanRequest{Implicit: q, Axis: "a", From: 0.6, To: 1.4, Samples: 9, Depth: 8, Recheck: true})
	digits := func(v float64) int {
		s := strings.TrimLeft(strings.Replace(strconv.FormatFloat(math.Abs(v), 'e', -1, 64), ".", "", 1), "0")
		return len(s[:strings.IndexByte(s, 'e')])
	}
	coarse := 0
	for _, s := range r.Samples {
		if s.Coarse {
			want, _ := strconv.ParseFloat(strconv.FormatFloat(0.6+0.1*float64(coarse), 'f', 1, 64), 64)
			if s.Value != want {
				t.Errorf("coarse sample %d is %v, want %v", coarse, s.Value, want)
			}
			coarse++
		}
		// Bisecting a step of 0.1 eight times leaves at most 12 digits.
		if digits(s.Value) > 12 {
			t.Errorf("sample %v has a tail", s.Value)
		}
	}
	if coarse != 9 || len(r.Candidates) != 1 {
		t.Fatalf("%d coarse samples, %v", coarse, brief(r))
	}
	c := r.Candidates[0]
	for _, v := range []float64{c.Lo, c.Hi, c.Lattice.Lo, c.Lattice.Hi, c.Finer.Lo, c.Finer.Hi} {
		if digits(v) > 12 {
			t.Errorf("bracket end %v has a tail", v)
		}
	}

	// Whatever the step, every value meshed, recheck ends and midpoints
	// included, is already clean: cleaning it again changes nothing.
	// (TestScanGeneratedRounding checks the cleaning itself.)
	for _, span := range [][2]float64{{0.6, 1.4}, {0.9, 1.1}} {
		r := runScan(t, ScanRequest{Implicit: q, Axis: "a", From: span[0], To: span[1], Samples: 7, Depth: 8, Recheck: true})
		// Seven samples: lerp alone would end at 1.3999999999999997.
		if first, last := r.Samples[0].Value, r.Samples[len(r.Samples)-1].Value; first != span[0] || last != span[1] {
			t.Errorf("%v: ends %v, %v", span, first, last)
		}
		values := []float64{}
		for _, s := range r.Samples {
			values = append(values, s.Value)
		}
		for _, c := range r.Candidates {
			for _, rc := range []*ScanRecheck{c.Lattice, c.Finer} {
				values = append(values, rc.Lo, rc.Hi)
			}
		}
		for _, v := range values {
			if w := generated(v, span[1]); w != v {
				t.Errorf("%v meshes %v, whose clean value is %v", span, v, w)
			}
		}
	}

	// Ends that are meaningful doubles: π/4 and π/2 stay exact, and every
	// coarse sample stays within rounding of π/4 + kπ/44. Twelve samples, where
	// lerp alone would end at 1.5707963267948963.
	lo, hi := math.Pi/4, math.Pi/2
	r = runScan(t, ScanRequest{Implicit: scanStudy("x^2+y^2+z^2", 1, 1, cube(2), 12), Axis: "level", From: lo, To: hi, Samples: 12})
	if r.Samples[0].Value != lo || r.Samples[len(r.Samples)-1].Value != hi {
		t.Errorf("ends %v, %v", r.Samples[0].Value, r.Samples[len(r.Samples)-1].Value)
	}
	for k, s := range r.Samples {
		exact := lo + (hi-lo)*float64(k)/11
		if math.Abs(s.Value-exact) > 4*0x1p-52*hi {
			t.Errorf("sample %d is %v, %g from %v", k, s.Value, s.Value-exact, exact)
		}
	}
}

// generated keeps a value's shortest decimal within rounding of its
// operands' scale, as roundedGenerated does: tails of sums and products
// go, cancellation's tail goes with its operands' scale, and a value with
// no short decimal that close stays.
func TestScanGeneratedRounding(t *testing.T) {
	// Variables, so the arithmetic is the machine's, not Go's exact
	// constant arithmetic.
	a, b, c, d := 1.65, 1.15, 1.6, 0.75
	cases := []struct{ v, scale, want float64 }{
		{lerp(0.6, 1.4, 4, 8), 1.4, 1},
		{a - 1, a, 0.65},
		{b - 1, b, 0.15},
		{c * d, c, 1.2},
		{math.Pi, math.Pi, math.Pi},
		{1e-300 / 3, 1e-300, 1e-300 / 3},
		{0, 1, 0},
		{-0.30000000000000004, 0.3, -0.3},
	}
	for _, tc := range cases {
		if got := generated(tc.v, tc.scale); got != tc.want {
			t.Errorf("generated(%v, %v) = %v, want %v", tc.v, tc.scale, got, tc.want)
		}
	}
}

// The recheck reserve: bisection stops early enough that the candidates'
// rechecks fit the cell limit, and the scan says it stopped bisecting
// early. Unreserved, twelve bisections of the tanglecube story's three
// brackets leave too few cells to recheck them all.
func TestScanRecheckReserve(t *testing.T) {
	q := spatialPresets(t)["The tanglecube's three events"].Implicit
	req := ScanRequest{Implicit: q, Axis: "level", From: -18, To: 4, Samples: 17, Depth: 12, Recheck: true}
	full := runScan(t, req)
	if full.Curtailed || full.Stop != "complete" {
		t.Fatalf("unlimited: curtailed %v, stop %q", full.Curtailed, full.Stop)
	}
	const limit = 4_000_000
	if full.Cells <= limit {
		t.Fatalf("the full scan meshes %d cells, within the test's limit", full.Cells)
	}
	saved := maxScanCells
	maxScanCells = limit
	r := runScan(t, req)
	maxScanCells = saved
	if r.Stop != "complete" || !r.Curtailed || r.Cells > limit {
		t.Errorf("stop %q, curtailed %v, %d cells", r.Stop, r.Curtailed, r.Cells)
	}
	if len(r.Candidates) != 3 {
		t.Fatalf("%v", brief(r))
	}
	for _, c := range r.Candidates {
		if c.Depth >= 12 || c.Depth < 1 {
			t.Errorf("depth %d", c.Depth)
		}
		if c.Stability != "stable" || c.Lattice.Outcome != "agrees" || c.Finer.Outcome != "agrees" {
			t.Errorf("%v: %q, %s, %s", brief(ScanResult{Candidates: []ScanCandidate{c}}), c.Stability, c.Lattice.Outcome, c.Finer.Outcome)
		}
	}
	// The call limit is reserved the same way: 2 + depth calls a bracket
	// on each recheck grid. Sixty calls leave three bisections each, and a
	// fourth for the first bracket, bisected first.
	savedCalls := maxScanCalls
	maxScanCalls = 60
	r = runScan(t, req)
	maxScanCalls = savedCalls
	if r.Stop != "complete" || !r.Curtailed || r.Calls > 60 {
		t.Errorf("call limit: stop %q, curtailed %v, %d calls", r.Stop, r.Curtailed, r.Calls)
	}
	for _, c := range r.Candidates {
		if c.Depth < 3 || c.Depth > 4 || c.Stability != "stable" {
			t.Errorf("call limit: depth %d, %q", c.Depth, c.Stability)
		}
	}
	// Without rechecks nothing is reserved.
	req.Recheck = false
	maxScanCells = limit
	r = runScan(t, req)
	maxScanCells = saved
	if r.Curtailed || r.Stop != "complete" || r.Candidates[0].Depth != 12 {
		t.Errorf("without rechecks: curtailed %v, stop %q, depth %d", r.Curtailed, r.Stop, r.Candidates[0].Depth)
	}
}

// Merged box intervals. In *A double torus*'s thin box the face cut near
// c = 0.0225 is followed by a cascade of box candidates, every one
// unstable, where the face's cut band is thinner than a cell. They merge
// into one box interval from the closed double torus to the three cut
// pieces. The holes closing at 1/16, which the critical search finds, and
// the stable box event above stay apart.
func TestScanMergedBox(t *testing.T) {
	q := spatialPresets(t)["A double torus"].Implicit
	r := runScan(t, ScanRequest{Implicit: q, Axis: "level", From: 0.005, To: 0.1, Samples: 17, Depth: 5, Recheck: true, Critical: true})
	if len(r.Candidates) != 3 {
		t.Fatalf("%v", brief(r))
	}
	m, holes, top := r.Candidates[0], r.Candidates[1], r.Candidates[2]
	if m.Kind != "box" || m.Merged < 3 || m.Stability != "unstable" || len(m.Critical) != 0 ||
		!slices.Equal(m.Before.Pieces, []int{-2}) || len(m.Before.Cut) != 0 ||
		len(m.After.Pieces) != 0 || !slices.Equal(m.After.Cut, []int{0, 0, 0}) {
		t.Errorf("merged: %+v", m)
	}
	if !(m.Lo < 0.0225 && m.Hi > 0.0235 && m.Hi < 0.024) || m.Spread[0] > m.Lo || m.Spread[1] < m.Hi || m.Lattice != nil || m.Finer != nil {
		t.Errorf("merged interval [%g, %g], spread %v", m.Lo, m.Hi, m.Spread)
	}
	if holes.Merged != 0 || holes.Stability != "stable" || len(holes.Critical) != 1 || math.Abs(holes.Critical[0].Value-1.0/16) > 1e-7 {
		t.Errorf("the holes: %+v", holes)
	}
	if top.Merged != 0 || top.Stability != "stable" {
		t.Errorf("above: %+v", top)
	}
	// Without the critical search no candidate is known to have no
	// critical point, and none merges.
	r = runScan(t, ScanRequest{Implicit: q, Axis: "level", From: 0.005, To: 0.1, Samples: 17, Depth: 5, Recheck: true})
	for _, c := range r.Candidates {
		if c.Merged != 0 {
			t.Errorf("merged without the critical search: %+v", c)
		}
	}
	if len(r.Candidates) < 5 {
		t.Errorf("%v", brief(r))
	}
}

// mergeBoxes joins a run of box candidates only when every one is
// unstable, none has a critical point, and each begins within a coarse
// step of where the one before ends.
func TestScanMergeBoxesRules(t *testing.T) {
	read := func(cut ...int) ScanReading {
		return ScanReading{Status: "cut", Pieces: []int{}, Cut: cut}
	}
	box := func(lo, hi float64, before, after int) ScanCandidate {
		return ScanCandidate{Lo: lo, Hi: hi, Before: read(before), After: read(after), Kind: "box", Stability: "unstable",
			Spread: [2]float64{lo - 0.01, hi}, Singular: []float64{}, Critical: []ScanCritical{}}
	}
	run := func() []ScanCandidate {
		return []ScanCandidate{box(1, 1.1, 1, 2), box(1.2, 1.3, 2, 3), box(1.4, 1.5, 3, 4)}
	}
	got := mergeBoxes(run(), 0.5)
	if len(got) != 1 || got[0].Merged != 3 || got[0].Lo != 1 || got[0].Hi != 1.5 || got[0].Before.Cut[0] != 1 || got[0].After.Cut[0] != 4 ||
		got[0].Spread != [2]float64{0.99, 1.5} {
		t.Errorf("a run: %+v", got)
	}
	breaks := []struct {
		name string
		part func([]ScanCandidate) []ScanCandidate
	}{
		{"stable", func(c []ScanCandidate) []ScanCandidate { c[1].Stability = "stable"; return c }},
		{"unchecked", func(c []ScanCandidate) []ScanCandidate { c[1].Stability = "unchecked"; return c }},
		{"critical", func(c []ScanCandidate) []ScanCandidate {
			c[1].Critical = []ScanCritical{{Value: 1.25, Index: 1, Points: 1}}
			return c
		}},
		{"change", func(c []ScanCandidate) []ScanCandidate { c[1].Kind = "change"; return c }},
		{"far", func(c []ScanCandidate) []ScanCandidate {
			for k := range c[1:] {
				c[k+1].Lo += 1
				c[k+1].Hi += 1
			}
			return c
		}},
	}
	for _, b := range breaks {
		got := mergeBoxes(b.part(run()), 0.5)
		// The middle candidate parts the run: nothing merges, except
		// across a gap, where the last two still do.
		want := 3
		if b.name == "far" {
			want = 2
		}
		if len(got) != want {
			t.Errorf("%s: %d candidates", b.name, len(got))
		}
	}
}
