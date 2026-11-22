package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// A closed loop of n points on the circle of radius r about (cx, cy),
// counterclockwise unless clockwise.
func circleLoop(cx, cy, r float64, n int, clockwise bool) Contour {
	pts := make([]Vec, n)
	for k := range pts {
		a := 2 * math.Pi * float64(k) / float64(n)
		if clockwise {
			a = -a
		}
		pts[k] = Vec{cx + r*math.Cos(a), cy + r*math.Sin(a)}
	}
	return Contour{Points: pts, Closed: true}
}

// The nesting forest of hand-built level sets, whose parents and sides are
// known by construction: a contour runs with larger F on its left, so a
// counterclockwise loop has F higher inside it.
func TestLevelTopologyForest(t *testing.T) {
	for _, tc := range []struct {
		name     string
		contours []Contour
		parents  []int
		higher   []bool
		class    string
	}{
		{"nothing", nil, []int{}, []bool{}, ""},
		{"one basin", []Contour{circleLoop(0, 0, 1, 12, true)}, []int{-1}, []bool{false}, "-()"},
		{"one hill", []Contour{circleLoop(0, 0, 1, 12, false)}, []int{-1}, []bool{true}, "+()"},
		{"two basins", []Contour{circleLoop(-2, 0, 1, 12, true), circleLoop(2, 0, 1, 12, true)}, []int{-1, -1}, []bool{false, false}, "-()-()"},
		// A ring: the region F < c between two circles, so F is higher
		// outside the outer one and inside the inner one.
		{"a ring", []Contour{circleLoop(0, 0, 1, 12, false), circleLoop(0, 0, 3, 24, true)}, []int{1, -1}, []bool{true, false}, "-(+())"},
		// Three deep, listed innermost first, beside a separate basin; the
		// code sorts siblings, so the order of contours does not matter.
		{"nested", []Contour{
			circleLoop(0.1, 0, 0.5, 12, true),
			circleLoop(5, 0, 1, 12, true),
			circleLoop(0, 0, 3, 24, true),
			circleLoop(0, 0, 1.5, 16, false),
		}, []int{3, -1, -1, 2}, []bool{false, false, false, true}, "-()-(+(-()))"},
	} {
		top := levelTopology(LevelSet{Contours: tc.contours}, 0)
		if top.Unclassified || top.Open != 0 || top.Class != tc.class || len(top.Loops) != len(tc.parents) {
			t.Fatalf("%s: %+v", tc.name, top)
		}
		for k, l := range top.Loops {
			if l.Parent != tc.parents[k] || l.Higher != tc.higher[k] || l.Open {
				t.Fatalf("%s: loop %d is %+v, want parent %d, higher %v", tc.name, k, l, tc.parents[k], tc.higher[k])
			}
		}
	}
}

// Open contours are listed, never nested or coded; a loop without area and
// too many loops leave the level unclassified, with nothing claimed.
func TestLevelTopologyLimits(t *testing.T) {
	open := Contour{Points: []Vec{{-3, 0}, {3, 0}}}
	top := levelTopology(LevelSet{Contours: []Contour{open, circleLoop(0, 2, 1, 12, true)}}, 2)
	if top.Open != 1 || !top.Loops[0].Open || top.Loops[0].Parent != -1 || top.Loops[1].Open || top.Class != "-()" || top.Rejected != 2 {
		t.Fatalf("open: %+v", top)
	}
	// An open contour is never nested, even one starting inside a loop.
	inner := Contour{Points: []Vec{{0, 2}, {0, 4}}}
	top = levelTopology(LevelSet{Contours: []Contour{circleLoop(0, 2, 1, 12, true), inner}}, 0)
	if top.Loops[1].Parent != -1 || !top.Loops[1].Open || top.Class != "-()" {
		t.Fatalf("open inside: %+v", top)
	}
	flat := Contour{Points: []Vec{{0, 0}, {1, 0}, {2, 0}}, Closed: true}
	if top := levelTopology(LevelSet{Contours: []Contour{flat}}, 0); !top.Unclassified || top.Class != "" || len(top.Loops) != 0 {
		t.Fatalf("no area: %+v", top)
	}
	many := make([]Contour, maxTopologyLoops+1)
	for k := range many {
		many[k] = circleLoop(3*float64(k), 0, 1, 8, true)
	}
	if top := levelTopology(LevelSet{Contours: many[:maxTopologyLoops]}, 0); top.Unclassified || top.Class != strings.Repeat("-()", maxTopologyLoops) {
		t.Fatalf("at the limit: unclassified %v", top.Unclassified)
	}
	if top := levelTopology(LevelSet{Contours: many}, 0); !top.Unclassified || top.Class != "" || len(top.Loops) != 0 {
		t.Fatalf("beyond the limit: %+v", top)
	}
}

// The classification travels only when asked for, so every other result,
// and so every preset, is unchanged by it.
func TestTopologyOnlyWhenAsked(t *testing.T) {
	q := implicitRequest("x^2+y^2", 1, square(2), 40)
	plain := compute(t, q)
	q.Topology = true
	asked := compute(t, q)
	// F is higher outside the circle: a basin.
	if plain.Contours.Topology != nil || asked.Contours.Topology == nil || asked.Contours.Topology.Class != "-()" {
		t.Fatalf("plain %v, asked %+v", plain.Contours.Topology, asked.Contours.Topology)
	}
	asked.Contours.Topology = nil
	a, _ := json.Marshal(plain)
	b, _ := json.Marshal(asked)
	if string(a) != string(b) {
		t.Fatal("asking for the topology changed the rest of the result")
	}
	p, _ := json.Marshal(plain.Contours)
	if strings.Contains(string(p), "topology") {
		t.Fatalf("an unasked result names the topology: %s", p)
	}
	// Parametric studies ignore the flag.
	q = request("evolute", "2*cos(t)", "3*sin(t)", 0, 2*math.Pi)
	q.Topology = true
	if r := compute(t, q); r.Contours != nil {
		t.Fatal("a parametric study gained contours")
	}
}

// Only the curve's own level counts its rejected edges: a family level's
// pole leaves the curve's classification whole.
func TestTopologyRejectedAtTheCurveLevel(t *testing.T) {
	// y/(x² + y² − 1) = c is a circle through (±1, 0); at c = 0 it is the
	// x-axis, crossing the pole circle, and away from 0 each level is cut
	// at the pole.
	q := implicitRequest("y/(x^2+y^2-1)", 0, square(2), 64)
	q.Topology = true
	top := compute(t, q).Contours.Topology
	if top.Rejected == 0 {
		t.Fatalf("the x-axis crosses the pole circle: %+v", top)
	}
	// F steps up by 10 across x = 1.7, from at least 2.89 to at least
	// 12.89: the family's level 5 straddles the step, the curve's level 1
	// does not.
	q = implicitRequest("x^2+y^2+5*(1+(x-1.7)/abs(x-1.7))", 1, square(2), 64)
	q.Curve.Implicit.Family = Levels{Enabled: true, From: 5, To: 6, Count: 2}
	q.Topology = true
	res := compute(t, q).Contours
	if len(res.Discontinuities) == 0 || res.Topology.Rejected != 0 || res.Topology.Class != "-()" {
		t.Fatalf("discontinuities %d, topology %+v", len(res.Discontinuities), res.Topology)
	}
}
