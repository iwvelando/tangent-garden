package engine

import (
	"math"
	"sort"
	"strings"
)

// maxTopologyLoops bounds the closed contours a level's nesting is worked
// out for: each loop is tested against every other, so the work is at most
// this many times the level's points.
const maxTopologyLoops = 64

// Loop is one contour of a level set in its nesting forest.
type Loop struct {
	// Parent indexes the smallest closed contour enclosing this one, among
	// the level's contours, or is −1.
	Parent int `json:"parent"`
	// Higher reports that F exceeds the level just inside a closed contour.
	Higher bool `json:"higher"`
	// Open marks a contour that ends where it leaves the window or meets
	// cells left out; it is neither nested nor coded.
	Open bool `json:"open,omitempty"`
}

// LevelTopology classifies the curve's own level set by its loops' nesting
// and the side of each that F is higher on (docs/mathematics.md, Planar
// events). Loops follow the level's contours. Open counts its open
// contours and Rejected the grid edges where F changes sign across this
// level without reaching it. Class is the canonical code of the closed
// loops' forest: a loop is "+" or "-", as F is higher inside or outside it,
// followed by its children's codes, sorted, in parentheses; the forest is
// its roots' codes, sorted. Unclassified is set, with no loops or code,
// when the level has more than maxTopologyLoops closed contours or one
// without area.
type LevelTopology struct {
	Loops        []Loop `json:"loops"`
	Open         int    `json:"open"`
	Rejected     int    `json:"rejected"`
	Class        string `json:"class"`
	Unclassified bool   `json:"unclassified,omitempty"`
}

// loopArea is a closed contour's signed area, positive counterclockwise.
func loopArea(points []Vec) float64 {
	s := 0.0
	for k, p := range points {
		s += p.Cross(points[(k+1)%len(points)])
	}
	return s / 2
}

// encloses reports whether p lies inside the closed polygon, by the
// even-odd rule.
func encloses(points []Vec, p Vec) bool {
	inside := false
	for k, a := range points {
		b := points[(k+1)%len(points)]
		if (a.Y > p.Y) != (b.Y > p.Y) && p.X < a.X+(p.Y-a.Y)*(b.X-a.X)/(b.Y-a.Y) {
			inside = !inside
		}
	}
	return inside
}

// levelTopology nests a level set's contours. Contours run with larger F
// on their left, so a counterclockwise loop has F higher inside it. At a
// regular level the loops are disjoint, so one point of a loop decides
// which others enclose it; at a critical level they can touch, and the
// result is a finite picture of a singular curve.
func levelTopology(set LevelSet, rejected int) *LevelTopology {
	top := &LevelTopology{Loops: []Loop{}, Rejected: rejected}
	closed := []int{}
	for k, c := range set.Contours {
		if c.Closed {
			closed = append(closed, k)
		} else {
			top.Open++
		}
	}
	unclassified := func() *LevelTopology {
		top.Loops, top.Unclassified = []Loop{}, true
		return top
	}
	if len(closed) > maxTopologyLoops {
		return unclassified()
	}
	area := make([]float64, len(set.Contours))
	for _, k := range closed {
		if area[k] = loopArea(set.Contours[k].Points); !(area[k] != 0) {
			return unclassified()
		}
	}
	for k, c := range set.Contours {
		loop := Loop{Parent: -1, Higher: area[k] > 0, Open: !c.Closed}
		if c.Closed {
			for _, j := range closed {
				if j != k && encloses(set.Contours[j].Points, c.Points[0]) &&
					(loop.Parent < 0 || math.Abs(area[j]) < math.Abs(area[loop.Parent])) {
					loop.Parent = j
				}
			}
		}
		top.Loops = append(top.Loops, loop)
	}
	children := map[int][]int{}
	for _, k := range closed {
		children[top.Loops[k].Parent] = append(children[top.Loops[k].Parent], k)
	}
	var code func(parent int) string
	code = func(parent int) string {
		parts := []string{}
		for _, k := range children[parent] {
			sign := "-"
			if top.Loops[k].Higher {
				sign = "+"
			}
			parts = append(parts, sign+"("+code(k)+")")
		}
		sort.Strings(parts)
		return strings.Join(parts, "")
	}
	top.Class = code(-1)
	return top
}
