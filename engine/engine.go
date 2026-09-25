// Package engine computes planar constructions independently of browsers or rendering.
package engine

import (
	"fmt"
	"math"
)

type Source struct {
	Kind        string  `json:"kind"`
	Position    Vec     `json:"position"`
	Angle       float64 `json:"angle"`
	Coordinates string  `json:"coordinates,omitempty"`
	Radius      float64 `json:"radius,omitempty"`
	Theta       float64 `json:"theta,omitempty"` // radians, counterclockwise from +x
}
type Request struct {
	Kind         string  `json:"kind"`
	Curve        Curve   `json:"curve"`
	Source       Source  `json:"source"`
	NIncident    float64 `json:"nIncident"`
	NTransmitted float64 `json:"nTransmitted"`
	Offset       float64 `json:"offset"`
	Samples      int     `json:"samples"`
	Lines        int     `json:"lines"`
}
type Ray struct {
	SampleIndex int  `json:"sampleIndex"`
	Origin      Vec  `json:"origin"`
	Direction   Vec  `json:"direction"`
	Incident    Vec  `json:"incident"`
	Target      *Vec `json:"target"`
	Virtual     bool `json:"virtual"`
	TIR         bool `json:"tir"`
}
type Result struct {
	Base           []*Vec   `json:"base"`
	Derived        []*Vec   `json:"derived"`
	Virtual        []bool   `json:"virtual"`
	Rays           []Ray    `json:"rays"`
	Warnings       []string `json:"warnings"`
	Invalid        int      `json:"invalid"`
	SourcePosition *Vec     `json:"sourcePosition,omitempty"`
}

func Compute(q Request) (Result, error) {
	out := Result{Rays: []Ray{}, Warnings: []string{}}
	optical := q.Kind == "catacaustic" || q.Kind == "diacaustic"
	if !optical && q.Kind != "evolute" && q.Kind != "involute" {
		return out, fmt.Errorf("unknown construction")
	}
	if q.Samples < 64 || q.Samples > 32768 || q.Lines < 2 || q.Lines > 2048 || q.Lines > q.Samples {
		return out, fmt.Errorf("samples must be 64–32768 and lines 2–2048, with no more lines than samples")
	}
	if !finite(q.Offset) || math.Abs(q.Offset) > 1e5 {
		return out, fmt.Errorf("involute offset must be finite and within ±100000")
	}
	if optical && q.Source.Kind == "point" {
		switch q.Source.Coordinates {
		case "", "cartesian":
		case "polar":
			if !finite(q.Source.Radius) || q.Source.Radius < 0 || !finite(q.Source.Theta) {
				return out, fmt.Errorf("polar source radius must be finite and nonnegative; theta must be finite (radians)")
			}
			q.Source.Position = Vec{q.Source.Radius * math.Cos(q.Source.Theta), q.Source.Radius * math.Sin(q.Source.Theta)}
		default:
			return out, fmt.Errorf("unknown source coordinate format")
		}
		out.SourcePosition = point(q.Source.Position)
	}
	if optical && (q.Source.Kind != "point" && q.Source.Kind != "parallel" || !q.Source.Position.Valid() || !finite(q.Source.Angle)) {
		return out, fmt.Errorf("invalid light source")
	}
	if q.Kind == "diacaustic" && (!finite(q.NIncident) || !finite(q.NTransmitted) || q.NIncident < 0.01 || q.NTransmitted < 0.01 || q.NIncident > 10 || q.NTransmitted > 10) {
		return out, fmt.Errorf("medium indices must be 0.01–10")
	}
	f, err := compile(q.Curve)
	if err != nil {
		return out, err
	}
	lo, hi := q.Curve.Min, q.Curve.Max
	step := (hi - lo) / float64(q.Samples-1)
	out.Base = make([]*Vec, q.Samples)
	out.Derived = make([]*Vec, q.Samples)
	out.Virtual = make([]bool, q.Samples)
	incident := func(t float64) Vec {
		if q.Source.Kind == "parallel" {
			a := q.Source.Angle * math.Pi / 180
			return Vec{math.Cos(a), math.Sin(a)}
		}
		delta := f(t).Sub(q.Source.Position)
		if delta.Norm() < 1e-9 {
			return Vec{math.NaN(), math.NaN()}
		}
		return delta.Unit()
	}
	direction := func(t float64) Vec {
		dp, _ := derivatives(f, t, lo, hi)
		if dp.Norm() < 1e-9 {
			return Vec{math.NaN(), math.NaN()}
		}
		i := incident(t)
		n := dp.Perp().Unit()
		if q.Kind == "catacaustic" {
			return Reflect(i, n)
		}
		v, ok := Refract(i, n, q.NIncident/q.NTransmitted)
		if !ok {
			return Vec{math.NaN(), math.NaN()}
		}
		return v
	}
	arc := 0.0
	arcOK := true
	tirCount := 0
	nextLine := 0
	for j := 0; j < q.Samples; j++ {
		t := lo + float64(j)*step
		p := f(t)
		dp, ddp := derivatives(f, t, lo, hi)
		out.Base[j] = point(p)
		if !p.Valid() || !stable(f, t, lo, hi, dp, ddp) {
			out.Base[j] = nil
			out.Invalid++
			if q.Kind == "involute" {
				arcOK = false
			}
			if nextLine < q.Lines && j == int(math.Round(float64(nextLine)*float64(q.Samples-1)/float64(q.Lines-1))) {
				nextLine++
			}
			continue
		}
		if j > 0 && q.Kind == "involute" {
			a, _ := derivatives(f, t-step, lo, hi)
			b, _ := derivatives(f, t-step/2, lo, hi)
			inc := step / 6 * (a.Norm() + 4*b.Norm() + dp.Norm())
			if !finite(inc) {
				arcOK = false
			} else {
				arc += inc
			}
		}
		var target *Vec
		var dir Vec
		virtual, tir := false, false
		switch q.Kind {
		case "evolute":
			target = Evolute(p, dp, ddp)
		case "involute":
			if arcOK {
				target = Involute(p, dp, arc, q.Offset)
			}
		default:
			dir = direction(t)
			if !dir.Valid() && p.Valid() && dp.Norm() > 1e-9 && incident(t).Valid() {
				tir = q.Kind == "diacaustic"
				if tir {
					tirCount++
					dir = Reflect(incident(t), dp.Perp().Unit())
				}
			}
			if !tir && dir.Valid() {
				dprime, _ := derivatives(direction, t, lo, hi)
				var s float64
				target, s = Envelope(p, dp, dir, dprime)
				virtual = s < 0
			}
		}
		out.Derived[j] = target
		out.Virtual[j] = virtual
		if target == nil {
			out.Invalid++
		}
		if nextLine < q.Lines && j == int(math.Round(float64(nextLine)*float64(q.Samples-1)/float64(q.Lines-1))) {
			nextLine++
			if p.Valid() && dp.Valid() && dp.Norm() > 1e-9 {
				if optical && dir.Valid() {
					out.Rays = append(out.Rays, Ray{SampleIndex: j, Origin: p, Direction: dir, Incident: incident(t), Target: target, Virtual: virtual, TIR: tir})
				} else if !optical && target != nil {
					out.Rays = append(out.Rays, Ray{SampleIndex: j, Origin: p, Target: target})
				}
			}
		}
	}
	if out.Invalid > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf("%d samples have no finite construction (singularity, parallel rays, or invalid domain).", out.Invalid))
	}
	if tirCount > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf("Total internal reflection at %d samples; reflected rays are shown in amber.", tirCount))
	}
	if !arcOK {
		out.Warnings = append(out.Warnings, "Arc length crossed an invalid interval; involute stopped. Choose a continuous domain.")
	}
	return out, nil
}
