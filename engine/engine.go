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
	Pole         Vec     `json:"pole"`
	NIncident    float64 `json:"nIncident"`
	NTransmitted float64 `json:"nTransmitted"`
	Offset       float64 `json:"offset"`
	Distance     float64 `json:"distance"`
	Stack        Stack   `json:"stack"`
	Circles      bool    `json:"circles"`
	Rolling      Roller  `json:"rolling"`
	// Envelope is the family of lines for the envelope construction.
	Envelope EnvelopeFamily `json:"envelope"`
	// Inversion is the circle and the curve inverted by the inversion
	// construction.
	Inversion Inversion `json:"inversion"`
	Samples   int       `json:"samples"`
	Lines     int       `json:"lines"`
}
type Ray struct {
	SampleIndex int  `json:"sampleIndex"`
	Origin      Vec  `json:"origin"`
	Direction   Vec  `json:"direction"`
	Incident    Vec  `json:"incident"`
	Target      *Vec `json:"target"`
	Virtual     bool `json:"virtual"`
	TIR         bool `json:"tir"`
	// End is a chord's far endpoint, present only for chords.
	End *Vec `json:"end,omitempty"`
}
type Result struct {
	Base           []*Vec    `json:"base"`
	Derived        []*Vec    `json:"derived"`
	Virtual        []bool    `json:"virtual"`
	Rays           []Ray     `json:"rays"`
	Family         []Path    `json:"family"`
	Circles        []Circle  `json:"circles"`
	Rolling        []Rolling `json:"rolling"`
	Warnings       []string  `json:"warnings"`
	Invalid        int       `json:"invalid"`
	SourcePosition *Vec      `json:"sourcePosition,omitempty"`
	// Roulette is present only for a roulette curve.
	Roulette *RouletteResult `json:"roulette,omitempty"`
	// Harmonic is present only for a Lissajous or Fourier curve.
	Harmonic *HarmonicResult `json:"harmonic,omitempty"`
	// Moving is present only for a rolling curve.
	Moving *MovingResult `json:"moving,omitempty"`
	// Second holds the chords' far endpoints, indexed like Base, present
	// only for chords.
	Second []*Vec `json:"second,omitempty"`
	// Inversion is present only for an inversion.
	Inversion *InversionResult `json:"inversion,omitempty"`
}

func Compute(q Request) (Result, error) {
	out := Result{Rays: []Ray{}, Family: []Path{}, Circles: []Circle{}, Rolling: []Rolling{}, Warnings: []string{}}
	optical := q.Kind == "catacaustic" || q.Kind == "diacaustic"
	if !optical && q.Kind != "evolute" && q.Kind != "involute" && q.Kind != "offset" && q.Kind != "rolling" && q.Kind != "envelope" && q.Kind != "inversion" && !usesPole(q.Kind) {
		return out, fmt.Errorf("unknown construction")
	}
	if usesPole(q.Kind) && !q.Pole.Valid() {
		return out, fmt.Errorf("pole coordinates must be finite numbers")
	}
	if q.Samples < 64 || q.Samples > 32768 || q.Lines < 2 || q.Lines > 2048 || q.Lines > q.Samples {
		return out, fmt.Errorf("samples must be 64–32768 and lines 2–2048, with no more lines than samples")
	}
	if !finite(q.Offset) || math.Abs(q.Offset) > 1e5 {
		return out, fmt.Errorf("involute offset must be finite and within ±100000")
	}
	if !finite(q.Distance) || math.Abs(q.Distance) > 1e5 {
		return out, fmt.Errorf("offset distance must be finite and within ±100000")
	}
	if q.Kind == "rolling" {
		if err := q.Rolling.validate(); err != nil {
			return out, err
		}
	}
	var inv *inverter
	if q.Kind == "inversion" {
		if err := q.Inversion.validate(q.Pole); err != nil {
			return out, err
		}
		out.Inversion = &InversionResult{Center: q.Inversion.Center, Radius: q.Inversion.Radius, Breaks: []int{}}
		if q.Inversion.Of != "curve" {
			out.Inversion.Source = make([]*Vec, q.Samples)
		}
	}
	stacked := q.Kind == "offset" && q.Stack.Enabled
	if stacked {
		if err := q.Stack.validate(q.Samples); err != nil {
			return out, err
		}
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
	if out.Inversion != nil {
		inv = &inverter{Inversion: q.Inversion, f: f, lo: q.Curve.Min, hi: q.Curve.Max, pole: q.Pole, distance: q.Distance}
	}
	var mv *mover
	if q.Kind == "rolling" && q.Rolling.curve() {
		if mv, out.Moving, err = newMover(q.Rolling, q.Curve.A, q.Samples); err != nil {
			return out, err
		}
	}
	var family *lines
	var circles *rings
	if q.Kind == "envelope" && q.Envelope.Mode == "circle" {
		if circles, err = newRings(q.Envelope, q.Curve.A, q.Curve.Min, q.Curve.Max); err != nil {
			return out, err
		}
	} else if q.Kind == "envelope" {
		if family, err = newLines(q.Envelope, f, q.Curve.A, q.Curve.Min, q.Curve.Max); err != nil {
			return out, err
		}
		if family.end != nil {
			out.Second = make([]*Vec, q.Samples)
		}
	}
	var roll *Roulette
	if q.Curve.Format == "roulette" {
		g := q.Curve.Roulette
		roll = &g
		turns, lobes := g.closure()
		out.Roulette = &RouletteResult{Roll: g.Roll, Turns: turns, Lobes: lobes, Positions: []Rolling{}}
		if g.Roll != "line" {
			out.Roulette.FixedRadius = g.FixedRadius
		}
	}
	var epicycles func(float64) Epicycles
	if q.Curve.Format == "lissajous" || q.Curve.Format == "fourier" {
		out.Harmonic, epicycles = harmonicResult(q.Curve)
	}
	lo, hi := q.Curve.Min, q.Curve.Max
	step := (hi - lo) / float64(q.Samples-1)
	out.Base = make([]*Vec, q.Samples)
	// A stack or a circle family's two branches replace the single derived
	// curve with several paths.
	paths := stacked || circles != nil
	if paths {
		out.Derived, out.Virtual = []*Vec{}, []bool{}
	}
	if stacked {
		out.Family = q.Stack.paths(q.Samples)
	} else if circles != nil {
		out.Family = circles.paths(q.Samples)
	} else {
		out.Derived = make([]*Vec, q.Samples)
		out.Virtual = make([]bool, q.Samples)
	}
	radius := 0.0
	if q.Kind == "offset" && q.Circles {
		radius = math.Abs(q.Distance)
		if stacked {
			radius = math.Max(math.Abs(q.Stack.From), math.Abs(q.Stack.To))
		}
	}
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
	// Both the involute and the rolling circle measure arc length from the
	// domain start; neither continues across a break in it.
	arc := 0.0
	arcOK := true
	arcLength := q.Kind == "involute" || q.Kind == "rolling"
	reversed := false
	// Why a rolling curve stopped, other than the base's own arc length.
	movingStop := placedOK
	tirCount := 0
	coincident := 0
	stationary, nested, unsized := 0, 0, 0
	// The last sample with an image, where the inverted curve was at src.
	onCenter, last, lastT, lastSrc := 0, -2, 0.0, Vec{}
	nextLine := 0
	for j := 0; j < q.Samples; j++ {
		t := lo + float64(j)*step
		p := f(t)
		dp, ddp := derivatives(f, t, lo, hi)
		out.Base[j] = point(p)
		if out.Second != nil {
			out.Second[j] = point(family.end(t))
		}
		line := nextLine < q.Lines && j == int(math.Round(float64(nextLine)*float64(q.Samples-1)/float64(q.Lines-1)))
		if line {
			nextLine++
			// The rolling circle is shown wherever the trace itself is finite,
			// even where the construction is undefined, such as at a cusp.
			if roll != nil && p.Valid() {
				s := roll.state(t)
				s.SampleIndex = j
				out.Roulette.Positions = append(out.Roulette.Positions, s)
			}
			if epicycles != nil && p.Valid() {
				s := epicycles(t)
				s.SampleIndex = j
				out.Harmonic.Positions = append(out.Harmonic.Positions, s)
			}
		}
		stableSample := true
		switch derivativeOrder(q) {
		case 1:
			stableSample = stableTangent(f, t, lo, hi, dp)
		case 2:
			stableSample = stable(f, t, lo, hi, dp, ddp)
		}
		if !p.Valid() || !stableSample {
			out.Base[j] = nil
			out.Invalid++
			if arcLength {
				arcOK = false
			}
			continue
		}
		if j > 0 && arcLength && arcOK {
			a, _ := derivatives(f, t-step, lo, hi)
			b, _ := derivatives(f, t-step/2, lo, hi)
			inc := step / 6 * (a.Norm() + 4*b.Norm() + dp.Norm())
			// A tangent that reverses within one step marks a cusp or corner
			// between samples, where the circle would jump to the other side.
			if q.Kind == "rolling" && (a.Dot(b) <= 0 || b.Dot(dp) <= 0) {
				arcOK, reversed = false, true
			} else if !finite(inc) {
				arcOK = false
			} else {
				arc += inc
			}
		}
		var target *Vec
		var rolled *Rolling
		var placed *Placement
		var member familyLine
		var circle ring
		origin := p
		var dir Vec
		virtual, tir := false, false
		switch q.Kind {
		case "pedal":
			target = Pedal(p, dp, q.Pole)
		case "contrapedal":
			target = Contrapedal(p, dp, q.Pole)
		case "orthotomic":
			target = Orthotomic(p, dp, q.Pole)
		case "offset":
			if !stacked {
				target = Offset(p, dp, q.Distance)
				break
			}
			for k := range out.Family {
				out.Family[k].Points[j] = Offset(p, dp, out.Family[k].Distance)
			}
			// The segment crosses every member and reaches back to the curve.
			lo, hi := q.Stack.span()
			if start := Offset(p, dp, lo); start != nil {
				origin, target = *start, Offset(p, dp, hi)
			}
		case "rolling":
			if arcOK && mv != nil {
				s, why := mv.place(p, dp, arc)
				if why != placedOK {
					arcOK, movingStop = false, why
					break
				}
				s.SampleIndex = j
				target, placed = point(s.Point), &s
			} else if arcOK {
				s := q.Rolling.at(p, dp, arc)
				s.SampleIndex = j
				if target = point(s.Point); target != nil && s.Center.Valid() {
					rolled = &s
				}
			}
		case "envelope":
			if circles != nil {
				circle = circles.at(t, p, dp)
				out.Family[0].Points[j], out.Family[1].Points[j] = circle.left, circle.right
				target = circle.left
				switch {
				case !circle.ok:
					unsized++
				case circle.stationary:
					stationary++
				case circle.nested:
					nested++
				}
				break
			}
			member = family.at(t, p, dp)
			target, virtual = member.target, member.virtual
			if member.coincident {
				coincident++
			}
		case "inversion":
			src := inv.at(p, dp, ddp)
			if out.Inversion.Source != nil {
				out.Inversion.Source[j] = src
			}
			if src == nil {
				break
			}
			origin = *src
			if target = Invert(*src, inv.Center, inv.Radius); target == nil {
				onCenter++
				break
			}
			if last == j-1 && inv.open(lastT, t, lastSrc, *src) {
				out.Inversion.Breaks = append(out.Inversion.Breaks, j)
			}
			last, lastT, lastSrc = j, t, *src
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
		if !paths {
			out.Derived[j] = target
			out.Virtual[j] = virtual
		}
		if target == nil {
			out.Invalid++
		}
		if line && inv != nil {
			// Each correspondence segment joins a point to its image.
			if target != nil {
				out.Rays = append(out.Rays, Ray{SampleIndex: j, Origin: origin, Target: target})
			}
		} else if line && circle.ok {
			// Every circle is drawn, touching its envelope or not, with its
			// radii to the touching points.
			out.Circles = append(out.Circles, Circle{SampleIndex: j, Center: p, Radius: circle.radius})
			for _, e := range []*Vec{circle.left, circle.right} {
				if e != nil {
					out.Rays = append(out.Rays, Ray{SampleIndex: j, Origin: p, Target: e})
				}
			}
		} else if line && member.ok {
			// Every defined line is drawn, touching its envelope or not.
			out.Rays = append(out.Rays, Ray{SampleIndex: j, Origin: p, Direction: member.direction, Target: target, Virtual: virtual, End: member.end})
		} else if line {
			if p.Valid() && dp.Valid() && dp.Norm() > 1e-9 {
				if optical && dir.Valid() {
					out.Rays = append(out.Rays, Ray{SampleIndex: j, Origin: p, Direction: dir, Incident: incident(t), Target: target, Virtual: virtual, TIR: tir})
				} else if !optical && target != nil {
					out.Rays = append(out.Rays, Ray{SampleIndex: j, Origin: origin, Target: target})
					if rolled != nil {
						out.Rolling = append(out.Rolling, *rolled)
					}
					if placed != nil {
						out.Moving.Positions = append(out.Moving.Positions, *placed)
					}
					if radius > 0 {
						out.Circles = append(out.Circles, Circle{SampleIndex: j, Center: p, Radius: radius})
					}
				}
			}
		}
	}
	if out.Invalid > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf("%d samples have no finite construction (singularity, parallel rays, or invalid domain).", out.Invalid))
	}
	if coincident > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf("At %d samples the chord's endpoints coincide, so it has no direction; they are left as gaps.", coincident))
	}
	if unsized > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf("At %d samples the radius is not positive (or undefined), so there is no circle; they are left as gaps.", unsized))
	}
	if stationary > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf("At %d samples the center is stationary, so neighbouring circles are concentric or the same; they have no envelope point.", stationary))
	}
	if nested > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf("At %d samples the radius changes faster than the center moves (|R′| > |c′|): each circle nests inside its neighbours, with no real envelope point.", nested))
	}
	if onCenter > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf("At %d samples the inverted curve lies exactly on the center of inversion, whose image is at infinity; they are left as gaps.", onCenter))
	}
	if n := len(breaksOf(out)); n > 0 {
		places := "places"
		if n == 1 {
			places = "place"
		}
		out.Warnings = append(out.Warnings, fmt.Sprintf("In %d %s the inverted curve passes through or close to the center between samples, where its image runs off toward infinity, or is undefined between them: the image is left open there, not joined across. More samples resolve a close pass.", n, places))
	}
	if tirCount > 0 {
		out.Warnings = append(out.Warnings, fmt.Sprintf("Total internal reflection at %d samples; reflected rays are shown in amber.", tirCount))
	}
	roller, rolling := "the circle", "the rolling circle"
	if mv != nil {
		roller, rolling = "the rolling curve", "the rolling curve"
	}
	switch {
	case movingStop == exhausted:
		out.Warnings = append(out.Warnings, "The contact reached the end of the rolling curve's domain; it stopped there. Extend its domain, or close the curve so it wraps around.")
	case movingStop == irregular:
		out.Warnings = append(out.Warnings, "The contact reached a cusp, corner, or invalid point on the rolling curve; it stopped there. Choose a regular stretch of the rolling curve.")
	case reversed:
		out.Warnings = append(out.Warnings, "The tangent reversed between samples, at a cusp or corner; "+roller+" cannot roll past it and stopped there. Choose a regular domain.")
	case !arcOK && q.Kind == "rolling":
		out.Warnings = append(out.Warnings, "Arc length crossed an invalid interval; "+rolling+" stopped. Choose a continuous domain.")
	case !arcOK:
		out.Warnings = append(out.Warnings, "Arc length crossed an invalid interval; involute stopped. Choose a continuous domain.")
	}
	return out, nil
}

func breaksOf(r Result) []int {
	if r.Inversion == nil {
		return nil
	}
	return r.Inversion.Breaks
}

// derivativeOrder is the number of stable derivatives a construction needs,
// so an ill-conditioned higher derivative must not turn its samples into gaps.
func derivativeOrder(q Request) int {
	switch {
	case q.Kind == "inversion":
		return q.Inversion.order()
	case usesPole(q.Kind) || q.Kind == "offset" || q.Kind == "rolling" || q.Kind == "envelope":
		return 1
	}
	return 2
}
