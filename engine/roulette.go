package engine

import (
	"fmt"
	"math"
)

// Roulette is a point at distance Arm from the center of a circle of radius
// Radius that rolls without slipping inside or outside a fixed circle of
// radius FixedRadius centered at the origin, or along the x-axis on its
// upper side. For a fixed circle, t is the polar angle of the rolling center;
// on the line, t is the angle the rolling circle has turned, so the center is
// (Radius·t, Radius). Phase turns the tracing arm counterclockwise from the
// direction of the contact point at t=0.
type Roulette struct {
	Roll        string  `json:"roll"`
	FixedRadius float64 `json:"fixedRadius"`
	Radius      float64 `json:"radius"`
	Arm         float64 `json:"arm"`
	Phase       float64 `json:"phase"`
}

// Rolling is the rolling circle, its contact with the fixed circle or line,
// and the tracing point at base sample SampleIndex.
type Rolling struct {
	SampleIndex int     `json:"sampleIndex"`
	Center      Vec     `json:"center"`
	Radius      float64 `json:"radius"`
	Contact     Vec     `json:"contact"`
	Point       Vec     `json:"point"`
}

// RouletteResult describes the fixed geometry and the closure of a rational
// ratio: the trace repeats after Turns revolutions of the rolling center
// (t advancing by 2π·Turns), with Lobes arches. Turns is 0 when the ratio is
// not p/q with q ≤ maxClosureTurns, and always on a line.
type RouletteResult struct {
	Roll        string    `json:"roll"`
	FixedRadius float64   `json:"fixedRadius"`
	Turns       int       `json:"turns"`
	Lobes       int       `json:"lobes"`
	Positions   []Rolling `json:"positions"`
}

// maxClosureTurns bounds the closure denominator; larger ones are treated
// as not closing, since each turn needs its own share of the samples.
const maxClosureTurns = 200

func (g Roulette) validate() error {
	switch g.Roll {
	case "inside", "outside", "line":
	default:
		return fmt.Errorf("a roulette rolls inside, outside, or along a line")
	}
	positive := func(x float64) bool { return finite(x) && x > 0 && x <= 1e5 }
	if g.Roll != "line" && !positive(g.FixedRadius) {
		return fmt.Errorf("the fixed radius R must be positive, finite, and at most 100000")
	}
	if !positive(g.Radius) {
		return fmt.Errorf("the rolling radius r must be positive, finite, and at most 100000")
	}
	if g.Roll == "inside" && g.Radius >= g.FixedRadius {
		return fmt.Errorf("a circle rolling inside needs a rolling radius r smaller than the fixed radius R")
	}
	if !finite(g.Arm) || g.Arm < 0 || g.Arm > 1e5 {
		return fmt.Errorf("the tracing distance d must be finite and within 0–100000")
	}
	if !finite(g.Phase) || math.Abs(g.Phase) > 1e6 {
		return fmt.Errorf("the roulette phase must be finite and within ±1000000 radians")
	}
	return nil
}

// state places the rolling circle at parameter t. The arm starts toward the
// contact point, turned by Phase, and rotates with the circle's spin: −(R−r)/r
// inside, (R+r)/r outside, and −1 along the line.
func (g Roulette) state(t float64) Rolling {
	r := g.Radius
	var center, contact Vec
	var arm float64
	switch g.Roll {
	case "line":
		center, contact = Vec{r * t, r}, Vec{r * t, 0}
		arm = -math.Pi/2 + g.Phase - t
	case "inside":
		k := g.FixedRadius - r
		center, contact = Vec{k * math.Cos(t), k * math.Sin(t)}, Vec{g.FixedRadius * math.Cos(t), g.FixedRadius * math.Sin(t)}
		arm = g.Phase - k*t/r
	default:
		k := g.FixedRadius + r
		center, contact = Vec{k * math.Cos(t), k * math.Sin(t)}, Vec{g.FixedRadius * math.Cos(t), g.FixedRadius * math.Sin(t)}
		arm = math.Pi + g.Phase + k*t/r
	}
	return Rolling{Center: center, Radius: r, Contact: contact, Point: center.Add(Vec{math.Cos(arm), math.Sin(arm)}.Mul(g.Arm))}
}

// closure finds R/r = p/q in lowest terms with q ≤ maxClosureTurns, by
// continued-fraction convergents, and returns (q, p). The arm's angle to the
// contact direction changes by −(R/r)t inside and +(R/r)t outside, so the
// trace repeats exactly when t = 2πq, after p arches. Real ratios that are
// merely close are not rounded into closure.
func (g Roulette) closure() (turns, lobes int) {
	if g.Roll == "line" {
		return 0, 0
	}
	p, q, _ := ratio(g.FixedRadius/g.Radius, maxClosureTurns)
	return q, p
}

func (g Roulette) curve() curveFunc {
	return func(t float64) Vec { return g.state(t).Point }
}
