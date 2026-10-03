package engine

import (
	"errors"
	"math"
	"testing"
)

// Every validation error that names one field carries its JSON path, the
// field whose control the notebook shows it under; the message is the
// same.
func TestValidationNamesItsField(t *testing.T) {
	nan := math.NaN()
	study := func() Request { return request("evolute", "cos(t)", "sin(t)", 0, 2*math.Pi) }
	roulette := func() Request {
		return rouletteRequest(Roulette{Roll: "inside", FixedRadius: 3, Radius: 1, Arm: 1}, 0, 2*math.Pi)
	}
	lissajous := func() Request {
		return lissajousRequest(Lissajous{AmplitudeX: 1, AmplitudeY: 1, FrequencyX: 3, FrequencyY: 2}, 0, 2*math.Pi)
	}
	fourier := func() Request {
		return fourierRequest([]Term{{1, 1, 0}, {-2, 0.5, 0}}, 0, 2*math.Pi)
	}
	chase := func() Request {
		return pursuitRequest(Pursuit{Pursuers: []Pursuer{{1, 0, 1}, {0, 1, 1}, {-1, 0, 1}}, Capture: 0.01}, 0, 10)
	}
	flow := func() Request { return fieldRequest("-y", "x", []Seed{{1, 0}, {2, 0}}, 10, 0, 6) }
	level := func() Request { return implicitRequest("x^2+y^2", 1, square(2), 40) }
	iterated := func() Request {
		v := clifford()
		v.Iterates = 1000
		return attractorRequest(v)
	}
	circle := func() Request {
		return rollingRequest("cos(t)", "sin(t)", 0, 2*math.Pi, Roller{Side: "left", Radius: 0.2, Arm: 0.2})
	}
	moving := func() Request {
		return curveRequest("cos(t)", "sin(t)", 0, 2*math.Pi, "left", MovingCurve{X: "0.2*cos(t)", Y: "0.2*sin(t)", Min: 0, Max: 2 * math.Pi}, Vec{0.2, 0})
	}
	optical := func() Request { return request("catacaustic", "cos(t)", "sin(t)", 0, 2*math.Pi) }
	cases := []struct {
		name  string
		field string
		build func() Request
	}{
		{"construction", "kind", func() Request { c := study(); c.Kind = "spiral"; return c }},
		{"pole", "pole.y", func() Request { c := study(); c.Kind = "pedal"; c.Pole.Y = nan; return c }},
		{"pole x", "pole.x", func() Request { c := study(); c.Kind = "pedal"; c.Pole.X = nan; return c }},
		{"samples", "samples", func() Request { c := study(); c.Samples = 10; return c }},
		{"lines", "lines", func() Request { c := study(); c.Lines = 1; return c }},
		{"more lines than samples", "lines", func() Request { c := study(); c.Samples, c.Lines = 100, 200; return c }},
		{"involute offset", "offset", func() Request { c := study(); c.Kind, c.Offset = "involute", 2e5; return c }},
		{"offset distance", "distance", func() Request { c := study(); c.Kind, c.Distance = "offset", nan; return c }},
		{"input", "input", func() Request { c := study(); c.Input = "evolute"; return c }},
		{"unknown input", "input", func() Request { c := study(); c.Kind, c.Input = "pedal", "spiral"; return c }},
		{"input pole", "pole.x", func() Request { c := study(); c.Input = "pedal"; c.Pole.X = nan; return c }},
		{"source radius", "source.radius", func() Request {
			c := optical()
			c.Source = Source{Kind: "point", Coordinates: "polar", Radius: -1}
			return c
		}},
		{"source theta", "source.theta", func() Request {
			c := optical()
			c.Source = Source{Kind: "point", Coordinates: "polar", Radius: 1, Theta: nan}
			return c
		}},
		{"source coordinates", "source.coordinates", func() Request { c := optical(); c.Source.Coordinates = "spherical"; return c }},
		{"source kind", "source.kind", func() Request { c := optical(); c.Source.Kind = "lamp"; return c }},
		{"source position", "source.position.y", func() Request { c := optical(); c.Source.Position.Y = nan; return c }},
		{"source angle", "source.angle", func() Request {
			c := optical()
			c.Source = Source{Kind: "parallel", Angle: nan}
			return c
		}},
		{"incident index", "nIncident", func() Request { c := optical(); c.Kind, c.NIncident = "diacaustic", 0; return c }},
		{"transmitted index", "nTransmitted", func() Request { c := optical(); c.Kind, c.NTransmitted = "diacaustic", 11; return c }},
		{"domain start", "curve.min", func() Request { c := study(); c.Curve.Min = nan; return c }},
		{"domain end", "curve.max", func() Request { c := study(); c.Curve.Max = math.Inf(1); return c }},
		{"domain empty", "curve.max", func() Request { c := study(); c.Curve.Max = 0; return c }},
		{"domain reversed", "curve.max", func() Request { c := study(); c.Curve.Max = -1; return c }},
		{"domain start bound", "curve.min", func() Request { c := study(); c.Curve.Min = -2e6; return c }},
		{"domain end bound", "curve.max", func() Request { c := study(); c.Curve.Min, c.Curve.Max = 1e6-1, 2e6; return c }},
		{"domain width", "curve.max", func() Request { c := study(); c.Curve.Max = 2e5; return c }},
		{"curve format", "curve.format", func() Request { c := study(); c.Curve.Format = "spline"; return c }},
		{"curve x", "curve.x", func() Request { c := study(); c.Curve.X = "cos(t"; return c }},
		{"curve y", "curve.y", func() Request { c := study(); c.Curve.Y = "q"; return c }},
		{"function f(x)", "curve.y", func() Request { c := study(); c.Curve.Format, c.Curve.Y = "cartesian", "t+"; return c }},
		{"polar r", "curve.r", func() Request { c := study(); c.Curve.Format, c.Curve.R = "polar", "1+"; return c }},
		{"roll", "curve.roulette.roll", func() Request { c := roulette(); c.Curve.Roulette.Roll = "spin"; return c }},
		{"fixed radius", "curve.roulette.fixedRadius", func() Request { c := roulette(); c.Curve.Roulette.FixedRadius = 0; return c }},
		{"rolling radius", "curve.roulette.radius", func() Request { c := roulette(); c.Curve.Roulette.Radius = nan; return c }},
		{"rolling inside", "curve.roulette.radius", func() Request { c := roulette(); c.Curve.Roulette.Radius = 3; return c }},
		{"roulette arm", "curve.roulette.arm", func() Request { c := roulette(); c.Curve.Roulette.Arm = -1; return c }},
		{"roulette phase", "curve.roulette.phase", func() Request { c := roulette(); c.Curve.Roulette.Phase = 2e6; return c }},
		{"amplitude A", "curve.lissajous.amplitudeX", func() Request { c := lissajous(); c.Curve.Lissajous.AmplitudeX = -1; return c }},
		{"amplitude B", "curve.lissajous.amplitudeY", func() Request { c := lissajous(); c.Curve.Lissajous.AmplitudeY = nan; return c }},
		{"frequency m", "curve.lissajous.frequencyX", func() Request { c := lissajous(); c.Curve.Lissajous.FrequencyX = 2000; return c }},
		{"frequency n", "curve.lissajous.frequencyY", func() Request { c := lissajous(); c.Curve.Lissajous.FrequencyY = nan; return c }},
		{"Lissajous phase", "curve.lissajous.phase", func() Request { c := lissajous(); c.Curve.Lissajous.Phase = nan; return c }},
		{"term radius", "curve.terms.1.radius", func() Request { c := fourier(); c.Curve.Terms[1].Radius = -1; return c }},
		{"term frequency", "curve.terms.0.frequency", func() Request { c := fourier(); c.Curve.Terms[0].Frequency = 2000; return c }},
		{"term phase", "curve.terms.1.phase", func() Request { c := fourier(); c.Curve.Terms[1].Phase = nan; return c }},
		{"pursuer x", "curve.pursuit.pursuers.1.x", func() Request { c := chase(); c.Curve.Pursuit.Pursuers[1].X = 2e5; return c }},
		{"pursuer y", "curve.pursuit.pursuers.2.y", func() Request { c := chase(); c.Curve.Pursuit.Pursuers[2].Y = nan; return c }},
		{"pursuer speed", "curve.pursuit.pursuers.0.speed", func() Request { c := chase(); c.Curve.Pursuit.Pursuers[0].Speed = -1; return c }},
		{"capture", "curve.pursuit.capture", func() Request { c := chase(); c.Curve.Pursuit.Capture = 0; return c }},
		{"seed x", "curve.field.seeds.1.x", func() Request { c := flow(); c.Curve.Field.Seeds[1].X = nan; return c }},
		{"seed y", "curve.field.seeds.0.y", func() Request { c := flow(); c.Curve.Field.Seeds[0].Y = 2e5; return c }},
		{"escape", "curve.field.escape", func() Request { c := flow(); c.Curve.Field.Escape = 0; return c }},
		{"dx/dt", "curve.field.x", func() Request { c := flow(); c.Curve.Field.X = "-y+"; return c }},
		{"dy/dt", "curve.field.y", func() Request { c := flow(); c.Curve.Field.Y = "q"; return c }},
		{"window x from", "curve.implicit.window.xMin", func() Request { c := level(); c.Curve.Implicit.Window.XMin = nan; return c }},
		{"window y to", "curve.implicit.window.yMax", func() Request { c := level(); c.Curve.Implicit.Window.YMax = 2e5; return c }},
		{"window x width", "curve.implicit.window.xMax", func() Request { c := level(); c.Curve.Implicit.Window.XMax = -3; return c }},
		{"window y width", "curve.implicit.window.yMax", func() Request { c := level(); c.Curve.Implicit.Window.YMax = -3; return c }},
		{"implicit cells", "curve.implicit.cells", func() Request { c := level(); c.Curve.Implicit.Cells = 2; return c }},
		{"level", "curve.implicit.level", func() Request { c := level(); c.Curve.Implicit.Level = nan; return c }},
		{"level count", "curve.implicit.family.count", func() Request {
			c := level()
			c.Curve.Implicit.Family = Levels{Enabled: true, From: 0, To: 1, Count: 1}
			return c
		}},
		{"levels from", "curve.implicit.family.from", func() Request {
			c := level()
			c.Curve.Implicit.Family = Levels{Enabled: true, From: nan, To: 1, Count: 3}
			return c
		}},
		{"levels to", "curve.implicit.family.to", func() Request {
			c := level()
			c.Curve.Implicit.Family = Levels{Enabled: true, From: 0, To: nan, Count: 3}
			return c
		}},
		{"F", "curve.implicit.f", func() Request { c := level(); c.Curve.Implicit.F = "x+"; return c }},
		{"F reads t", "curve.implicit.f", func() Request { c := level(); c.Curve.Implicit.F = "x+t"; return c }},
		{"map", "curve.attractor.map", func() Request { c := iterated(); c.Curve.Attractor.Map = "logistic"; return c }},
		{"coefficient c", "curve.attractor.c", func() Request { c := iterated(); c.Curve.Attractor.C = 2000; return c }},
		{"start y", "curve.attractor.start.y", func() Request { c := iterated(); c.Curve.Attractor.Start.Y = nan; return c }},
		{"discard", "curve.attractor.discard", func() Request { c := iterated(); c.Curve.Attractor.Discard = -1; return c }},
		{"iterates", "curve.attractor.iterates", func() Request { c := iterated(); c.Curve.Attractor.Iterates = 6e6; return c }},
		{"attractor cells", "curve.attractor.cells", func() Request { c := iterated(); c.Curve.Attractor.Cells = 2000; return c }},
		{"density window", "curve.attractor.window.yMin", func() Request { c := iterated(); c.Curve.Attractor.Window.YMin = nan; return c }},
		{"rolling shape", "rolling.shape", func() Request { c := circle(); c.Rolling.Shape = "square"; return c }},
		{"rolling side", "rolling.side", func() Request { c := circle(); c.Rolling.Side = "up"; return c }},
		{"rolling curve side", "rolling.side", func() Request { c := moving(); c.Rolling.Side = ""; return c }},
		{"rolling radius ρ", "rolling.radius", func() Request { c := circle(); c.Rolling.Radius = 0; return c }},
		{"rolling arm ℓ", "rolling.arm", func() Request { c := circle(); c.Rolling.Arm = nan; return c }},
		{"rolling phase ψ", "rolling.phase", func() Request { c := circle(); c.Rolling.Phase = nan; return c }},
		{"tracing point", "rolling.point.y", func() Request { c := moving(); c.Rolling.Point.Y = 2e5; return c }},
		{"rolling curve x", "rolling.curve.x", func() Request { c := moving(); c.Rolling.Curve.X = "cos("; return c }},
		{"rolling curve y", "rolling.curve.y", func() Request { c := moving(); c.Rolling.Curve.Y = "q"; return c }},
		{"rolling curve from", "rolling.curve.min", func() Request { c := moving(); c.Rolling.Curve.Min = nan; return c }},
		{"rolling curve to", "rolling.curve.max", func() Request { c := moving(); c.Rolling.Curve.Max = -1; return c }},
		{"contact start", "rolling.curve.start", func() Request { c := moving(); c.Rolling.Curve.Start = 9; return c }},
		{"envelope family", "envelope.mode", func() Request { return linesRequest("cos(t)", "sin(t)", 0, 6, EnvelopeFamily{Mode: "arcs"}) }},
		{"direction angle", "envelope.angle", func() Request {
			return linesRequest("cos(t)", "sin(t)", 0, 6, EnvelopeFamily{Mode: "angle", Angle: "t+"})
		}},
		{"second point x", "envelope.x", func() Request { return linesRequest("cos(t)", "sin(t)", 0, 6, chords("q", "0")) }},
		{"second point y", "envelope.y", func() Request { return linesRequest("cos(t)", "sin(t)", 0, 6, chords("0", "1+")) }},
		{"circle radius", "envelope.radius", func() Request { return circlesRequest("cos(t)", "sin(t)", 0, 6, "1+") }},
		{"inversion center", "inversion.center.y", func() Request { return inversionRequest("cos(t)", "sin(t)", 0, 6, Vec{0, nan}, 1) }},
		{"inversion radius", "inversion.radius", func() Request { return inversionRequest("cos(t)", "sin(t)", 0, 6, Vec{}, 0) }},
		{"offset count", "stack.count", func() Request { return stackRequest("cos(t)", "sin(t)", 0, 6, 0, 1, 1) }},
		{"offset points", "stack.count", func() Request {
			c := stackRequest("cos(t)", "sin(t)", 0, 6, 0, 1, 64)
			c.Samples = 4096
			return c
		}},
		{"first offset", "stack.from", func() Request { return stackRequest("cos(t)", "sin(t)", 0, 6, nan, 1, 3) }},
		{"last offset", "stack.to", func() Request { return stackRequest("cos(t)", "sin(t)", 0, 6, 0, 2e5, 3) }},
	}
	for _, c := range cases {
		_, err := Compute(c.build())
		var named *FieldError
		if !errors.As(err, &named) || named.Field != c.field {
			t.Errorf("%s: got %v (%#v), want field %s", c.name, err, named, c.field)
			continue
		}
		if named.Error() != named.Message || named.Message == "" {
			t.Errorf("%s: message %q", c.name, named.Message)
		}
	}
}

// An error about the study as a whole, such as how many items a list
// holds, names no field.
func TestStudyErrorsNameNoField(t *testing.T) {
	pursuers := pursuitRequest(Pursuit{Pursuers: []Pursuer{{1, 0, 1}}, Capture: 0.01}, 0, 10)
	for name, q := range map[string]Request{
		"one pursuer": pursuers,
		"no terms":    fourierRequest(nil, 0, 1),
		"no seeds":    fieldRequest("-y", "x", nil, 10, 0, 6),
	} {
		_, err := Compute(q)
		var named *FieldError
		if err == nil || errors.As(err, &named) {
			t.Errorf("%s: %v", name, err)
		}
	}
}
