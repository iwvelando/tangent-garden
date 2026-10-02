package engine3

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
	harmonic := func() Request {
		return harmonicStudy(0, 2*math.Pi, Vec3{}, HarmonicTerm{1, Vec3{1, 0, 0}, Vec3{0, 1, 0}}, HarmonicTerm{2, Vec3{}, Vec3{0, 0, 1}})
	}
	ellipsoid := func() Request { return surfaceStudy("ellipsoid", 1, 1, 1, 0, 2*math.Pi, -1, 1, 24, 24) }
	rays := func(light RaysRequest) Request {
		return mirror("paraboloid", 1, 1, 0, -1, 1, -1, 1, 24, 24, light)
	}
	box := Box{-2, 2, -2, 2, -2, 2}
	level := func() Request {
		return Request{Format: "implicit", Implicit: implicitStudy("x^2+y^2+z^2", 1, box, 24)}
	}
	field := func() Request {
		return fieldRequest("-y", "x", "0.2", []Vec3{{1, 0, 0}, {2, 0, 0}}, 0, 6)
	}
	chase := func() Request {
		return pursuitStudy([]SpatialPursuer{{1, 0, 0, 1}, {0, 1, 0, 1}, {0, 0, 1, 1}}, 0.01, 0, 10)
	}
	cases := []struct {
		name  string
		field string
		build func() Request
	}{
		{"samples", "samples", func() Request { c := study(); c.Samples = 100; return c }},
		{"lines", "lines", func() Request { c := study(); c.Lines = 2; return c }},
		{"construction", "construction", func() Request { c := study(); c.Construction = "evolute"; return c }},
		{"reach", "length", func() Request { c := study(); c.Length = 0; return c }},
		{"projection pole", "pole.y", func() Request { c := study(); c.Construction = "tangent-foot"; c.Pole.Y = nan; return c }},
		{"input", "input", func() Request { c := study(); c.Input = "evolute"; return c }},
		{"composed pole", "pole.z", func() Request { c := study(); c.Input = "orthotomic"; c.Pole.Z = 2e5; return c }},
		{"input string", "unwinding.offset", func() Request { return unwound(study(), 1, 2e5) }},
		{"input anchor", "unwinding.anchor", func() Request { return unwound(study(), 9, 1) }},
		{"input anchor finite", "unwinding.anchor", func() Request { return unwound(study(), nan, 1) }},
		{"input anchor on a break", "unwinding.anchor", func() Request {
			c := unwound(custom("tan(t)", "cos(t)", "sin(t)", -2, 2), math.Pi/2, 0.3)
			c.Samples = 481
			return c
		}},
		{"radius", "radius", func() Request { c := study(); c.Radius = 30; return c }},
		{"tube", "tube", func() Request { c := study(); c.Tube = 3; return c }},
		{"p", "p", func() Request { c := study(); c.P = 9; return c }},
		{"q", "q", func() Request { c := study(); c.Q = 4; c.P = 2; return c }},
		{"curve start", "curve.min", func() Request { c := custom("t", "t^2", "0", nan, 1); return c }},
		{"curve end", "curve.max", func() Request { c := custom("t", "t^2", "0", 1, 0); return c }},
		{"curve x", "curve.x", func() Request { return custom("t+", "t", "0", 0, 1) }},
		{"curve z", "curve.z", func() Request { return custom("t", "t", "q", 0, 1) }},
		{"harmonic start", "harmonic.min", func() Request { c := harmonic(); c.Harmonic.Min = nan; return c }},
		{"harmonic end", "harmonic.max", func() Request { c := harmonic(); c.Harmonic.Max = -1; return c }},
		{"harmonic center", "harmonic.center.y", func() Request { c := harmonic(); c.Harmonic.Center.Y = 2e5; return c }},
		{"harmonic frequency", "harmonic.terms.1.frequency", func() Request { c := harmonic(); c.Harmonic.Terms[1].Frequency = 2000; return c }},
		{"harmonic A", "harmonic.terms.0.cosine.z", func() Request { c := harmonic(); c.Harmonic.Terms[0].Cosine.Z = nan; return c }},
		{"harmonic B", "harmonic.terms.1.sine.x", func() Request { c := harmonic(); c.Harmonic.Terms[1].Sine.X = 2e5; return c }},
		{"involute string", "involute.offset", func() Request { return involuteStudy("cos(t)", "sin(t)", "t", 0, 6, 1, 2e5) }},
		{"involute anchor", "involute.anchor", func() Request { return involuteStudy("cos(t)", "sin(t)", "t", 0, 6, 7, 1) }},
		{"involute anchor on a cusp", "involute.anchor", func() Request {
			c := unwound(study(), 0, 0)
			c.Construction, c.Involute = "involute", InvoluteRequest{Anchor: 0, Offset: 1}
			return c
		}},
		{"family from", "involute.family.from", func() Request {
			c := involuteStudy("cos(t)", "sin(t)", "t", 0, 6, 1, 0)
			c.Involute.Family = InvoluteFamily{Enabled: true, From: nan, To: 1, Count: 3}
			return c
		}},
		{"family to", "involute.family.to", func() Request {
			c := involuteStudy("cos(t)", "sin(t)", "t", 0, 6, 1, 0)
			c.Involute.Family = InvoluteFamily{Enabled: true, From: 0, To: 2e5, Count: 3}
			return c
		}},
		{"family count", "involute.family.count", func() Request {
			c := involuteStudy("cos(t)", "sin(t)", "t", 0, 6, 1, 0)
			c.Involute.Family = InvoluteFamily{Enabled: true, From: 0, To: 1, Count: 30}
			return c
		}},
		{"inversion radius", "inversion.radius", func() Request { return inversionStudy("t", "1", "0", -1, 1, Vec3{}, 0) }},
		{"inversion center", "inversion.center.x", func() Request { return inversionStudy("t", "1", "0", -1, 1, Vec3{nan, 0, 0}, 1) }},
		{"inversion input", "inversion.input", func() Request {
			c := inversionStudy("t", "1", "0", -1, 1, Vec3{}, 1)
			c.Inversion.Input = "involute"
			return c
		}},
		{"inversion pole", "pole.x", func() Request {
			c := inversionStudy("t", "1", "0", -1, 1, Vec3{}, 1)
			c.Inversion.Input, c.Pole = "tangent-foot", Vec3{2e5, 0, 0}
			return c
		}},
		{"frame kind", "frame.kind", func() Request { c := framedCustom("cos(t)", "sin(t)", "t", 0, 6); c.Frame.Kind = "bishop"; return c }},
		{"frame reference", "frame.reference.y", func() Request { c := framedCustom("cos(t)", "sin(t)", "t", 0, 6); c.Frame.Reference.Y = nan; return c }},
		{"frame zero reference", "frame.reference.x", func() Request {
			c := framedCustom("cos(t)", "sin(t)", "t", 0, 6)
			c.Frame.Reference = Vec3{}
			return c
		}},
		{"frame angle", "frame.angle", func() Request { c := framedCustom("cos(t)", "sin(t)", "t", 0, 6); c.Frame.Angle = 2000; return c }},
		{"frame twist", "frame.twist", func() Request { c := framedCustom("cos(t)", "sin(t)", "t", 0, 6); c.Frame.Twist = 200; return c }},
		{"frame offset", "frame.offset", func() Request { c := framedCustom("cos(t)", "sin(t)", "t", 0, 6); c.Frame.Offset = -1; return c }},
		{"frame width", "frame.width", func() Request { c := framedCustom("cos(t)", "sin(t)", "t", 0, 6); c.Frame.Width = -1; return c }},
		{"frame strands", "frame.strands", func() Request { c := framedCustom("cos(t)", "sin(t)", "t", 0, 6); c.Frame.Strands = 13; return c }},
		{"frame closure", "frame.closure", func() Request { c := framedCustom("cos(t)", "sin(t)", "t", 0, 6); c.Frame.Closure = "hide"; return c }},
		{"ruled partner", "ruled.partner", func() Request { c := chords(ring(0), 2, 0); c.Ruled.Partner = "web"; return c }},
		{"ruled rate", "ruled.rate", func() Request { return chords(ring(0), 200, 0) }},
		{"ruled shift", "ruled.shift", func() Request { return chords(ring(0), 2, 2e6) }},
		{"ruled thread", "ruled.thread.y", func() Request { return threaded(ring(0), "cos(t)", "sin(", "1", 1, 0) }},
		{"canal radius", "canal.radius", func() Request { return canalled(circle(), 0, "1", 4) }},
		{"canal meridians", "canal.meridians", func() Request { return canalled(circle(), 0.2, "1", 13) }},
		{"canal profile", "canal.profile", func() Request { return canalled(circle(), 0.2, "1+", 4) }},
		{"canal profile never positive", "canal.profile", func() Request { return canalled(circle(), 0.2, "-1", 4) }},
		{"field seed", "field.seeds.1.z", func() Request { c := field(); c.Field.Seeds[1].Z = nan; return c }},
		{"field escape", "field.escape", func() Request { c := field(); c.Field.Escape = 0; return c }},
		{"field dy", "field.y", func() Request { c := field(); c.Field.Y = "x+"; return c }},
		{"field start", "field.min", func() Request { c := field(); c.Field.Min = nan; return c }},
		{"field end", "field.max", func() Request { c := field(); c.Field.Max = -1; return c }},
		{"pursuer start", "pursuit.pursuers.2.y", func() Request { c := chase(); c.Pursuit.Pursuers[2].Y = 2e5; return c }},
		{"pursuer speed", "pursuit.pursuers.0.speed", func() Request { c := chase(); c.Pursuit.Pursuers[0].Speed = -1; return c }},
		{"capture", "pursuit.capture", func() Request { c := chase(); c.Pursuit.Capture = 0; return c }},
		{"pursuit end", "pursuit.max", func() Request { c := chase(); c.Pursuit.Max = -1; return c }},
		{"surface kind", "surface.kind", func() Request { c := ellipsoid(); c.Surface.Kind = "cube"; return c }},
		{"surface a", "surface.a", func() Request { c := ellipsoid(); c.Surface.A = 0; return c }},
		{"surface c", "surface.c", func() Request { c := ellipsoid(); c.Surface.C = nan; return c }},
		{"torus b", "surface.b", func() Request { return surfaceStudy("torus", 2, 0, 0, 0, 1, 0, 1, 24, 24) }},
		{"u start", "surface.uMin", func() Request { c := ellipsoid(); c.Surface.UMin = nan; return c }},
		{"v end", "surface.vMax", func() Request { c := ellipsoid(); c.Surface.VMax = -2; return c }},
		{"v samples", "surface.vSamples", func() Request { c := ellipsoid(); c.Surface.VSamples = 4; return c }},
		{"surface curves", "surface.curves", func() Request { c := ellipsoid(); c.Surface.Curves = 1; return c }},
		{"surface offset", "surface.offset", func() Request { c := ellipsoid(); c.Surface.Offset = nan; return c }},
		{"surface reach", "surface.reach", func() Request { c := ellipsoid(); c.Surface.Reach = 2e5; return c }},
		{"n2", "rays.n2", func() Request {
			c := rays(parallel(0, 90))
			c.Rays.Interaction, c.Rays.N1, c.Rays.N2 = "refract", 1, 0
			return c
		}},
		{"interaction", "rays.interaction", func() Request { c := rays(parallel(0, 90)); c.Rays.Interaction = "absorb"; return c }},
		{"elevation", "rays.elevation", func() Request { return rays(parallel(0, nan)) }},
		{"source", "rays.source.z", func() Request { return rays(lamp(Vec3{0, 0, 2e5})) }},
		{"light", "rays.light", func() Request { c := rays(parallel(0, 90)); c.Rays.Light = "laser"; return c }},
		{"ray length", "rays.length", func() Request { c := rays(parallel(0, 90)); c.Rays.Length = -1; return c }},
		{"receiver plane", "rays.receiver.plane", func() Request { return receive(rays(parallel(0, 90)), "w", 0, 0, 0, 1, 24) }},
		{"receiver at", "rays.receiver.at", func() Request { return receive(rays(parallel(0, 90)), "z", nan, 0, 0, 1, 24) }},
		{"receiver centre", "rays.receiver.c2", func() Request { return receive(rays(parallel(0, 90)), "z", 0, 0, 2e5, 1, 24) }},
		{"receiver size", "rays.receiver.size", func() Request { return receive(rays(parallel(0, 90)), "z", 0, 0, 0, 0, 24) }},
		{"receiver bins", "rays.receiver.bins", func() Request { return receive(rays(parallel(0, 90)), "z", 0, 0, 0, 1, 1) }},
		{"implicit a", "implicit.a", func() Request { c := level(); c.Implicit.A = nan; return c }},
		{"implicit level", "implicit.level", func() Request { c := level(); c.Implicit.Level = nan; return c }},
		{"box", "implicit.box.yMax", func() Request { c := level(); c.Implicit.Box.YMax = 2e5; return c }},
		{"box width", "implicit.box.zMax", func() Request { c := level(); c.Implicit.Box.ZMax = -3; return c }},
		{"cells", "implicit.cells", func() Request { c := level(); c.Implicit.Cells = 1; return c }},
		{"refine", "implicit.refine", func() Request { c := level(); c.Implicit.Refine = 9; return c }},
		{"sections", "implicit.sections.count", func() Request { c := level(); c.Implicit.Sections.Count = 99; return c }},
		{"section normal", "implicit.sections.normal.x", func() Request {
			c := level()
			c.Implicit.Sections = SectionRequest{Count: 3, From: -1, To: 1}
			return c
		}},
		{"section offsets", "implicit.sections.to", func() Request {
			c := level()
			c.Implicit.Sections = SectionRequest{Normal: Vec3{0, 0, 1}, Count: 3, From: -1, To: nan}
			return c
		}},
		{"implicit F", "implicit.f", func() Request { c := level(); c.Implicit.F = "x+"; return c }},
		{"implicit F reads t", "implicit.f", func() Request { c := level(); c.Implicit.F = "x+t"; return c }},
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

// Errors about the study as a whole name no field.
func TestStudyErrorsNameNoField(t *testing.T) {
	for name, c := range map[string]Request{
		"stands still":   custom("0", "0", "0", 0, 1),
		"straight input": unwound(custom("pi*t", "e*t+1", "t/3", -1, 1), 0.1, 1),
		"nothing turns":  harmonicStudy(0, 1, Vec3{}, HarmonicTerm{0, Vec3{1, 0, 0}, Vec3{}}),
	} {
		_, err := Compute(c)
		var named *FieldError
		if err == nil || errors.As(err, &named) {
			t.Errorf("%s: %v", name, err)
		}
	}
}
