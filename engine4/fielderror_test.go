package engine4

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
	weaving := func() Request { return weaveRequest("tori", 3, 4, math.Pi/4, .6) }
	lift := func() Request { return liftRequest(t, "lifted", Vec3{}, 1, 1) }
	route := func() Request { return bypassRequest(t, "shadow", "embedded", 1, .5) }
	section := func() Request { q := request(); q.Mode, q.Count, q.Spread = "section", 3, 1; return q }
	cases := []struct {
		name  string
		field string
		build func() Request
	}{
		{"object", "object", func() Request { q := request(); q.Object = "simplex"; return q }},
		{"mode", "mode", func() Request { q := request(); q.Mode = "lifted"; return q }},
		{"angle", "angles.4", func() Request { q := request(); q.Angles[4] = nan; return q }},
		{"eye distance", "distance", func() Request { q := request(); q.Mode, q.Distance = "perspective", 2; return q }},
		{"slice", "slice", func() Request { q := section(); q.Slice = 4.1; return q }},
		{"spread", "spread", func() Request { q := section(); q.Spread = -1; return q }},
		{"sections", "count", func() Request { q := section(); q.Count = 26; return q }},
		{"grid", "grid", func() Request { q := request(); q.Grid = 13; return q }},
		{"arc samples", "samples", func() Request { q := request(); q.Mode, q.Samples = "stereo", 7; return q }},
		{"window", "clip", func() Request { q := request(); q.Mode, q.Clip = "stereo", 1; return q }},
		{"curved mode", "mode", func() Request { q := curvedRequest("ball"); q.Mode = "stereo"; return q }},
		{"ball radius", "radius", func() Request { q := curvedRequest("ball"); q.Radius = 0; return q }},
		{"tube radius", "tube", func() Request { q := curvedRequest("tube"); q.Tube = 3; return q }},
		{"curved slice", "slice", func() Request { q := curvedRequest("ball"); q.Slice = nan; return q }},
		{"curved spread", "spread", func() Request { q := curvedRequest("tube"); q.Count, q.Spread = 3, 9; return q }},
		{"curved sections", "count", func() Request { q := curvedRequest("ball"); q.Count = 0; return q }},
		{"curves", "curves", func() Request { q := curvedRequest("ball"); q.Curves = 2; return q }},
		{"curve samples", "samples", func() Request { q := curvedRequest("tube"); q.Samples = 300; return q }},
		{"weave mode", "mode", func() Request { q := weaving(); q.Mode = "section"; return q }},
		{"weave family", "weave.family", func() Request { q := weaving(); q.Weave.Family = "knots"; return q }},
		{"weave angle", "angles.3", func() Request { q := weaving(); q.Angles[3] = math.Inf(1); return q }},
		{"latitudes", "count", func() Request { q := weaving(); q.Count = 10; return q }},
		{"weave curves", "curves", func() Request { q := weaving(); q.Curves = 0; return q }},
		{"weave samples", "samples", func() Request { q := weaving(); q.Samples = 7; return q }},
		{"weave window", "clip", func() Request { q := weaving(); q.Clip = 13; return q }},
		{"latitude spread", "weave.spread", func() Request { q := weaving(); q.Weave.Spread = 2; return q }},
		{"coincident latitudes", "weave.spread", func() Request { q := weaving(); q.Weave.Spread = 0; return q }},
		{"central latitude", "weave.alpha", func() Request { q := weaving(); q.Weave.Alpha = 1.4; return q }},
		{"latitude start", "weave.alphaFrom", func() Request { q := weaving(); q.Weave.AlphaFrom = -.1; return q }},
		{"latitude end", "weave.alphaTo", func() Request { q := weaving(); q.Weave.AlphaTo = nan; return q }},
		{"lift mode", "mode", func() Request { q := lift(); q.Mode = "stereo"; return q }},
		{"lift center", "lift.center.1", func() Request { q := lift(); q.Lift.Center[1] = 21; return q }},
		{"drift start", "lift.from.2", func() Request { q := lift(); q.Lift.From[2] = nan; return q }},
		{"drift end", "lift.to.0", func() Request { q := lift(); q.Lift.To[0] = -30; return q }},
		{"support", "lift.support", func() Request { q := lift(); q.Lift.Support = 0; return q }},
		{"support start", "lift.radiusFrom", func() Request { q := lift(); q.Lift.RadiusFrom = 21; return q }},
		{"support end", "lift.radiusTo", func() Request { q := lift(); q.Lift.RadiusTo = nan; return q }},
		{"lift height", "lift.height", func() Request { q := lift(); q.Lift.Height = 11; return q }},
		{"presentation angle", "lift.angle", func() Request { q := lift(); q.Lift.Angle = nan; return q }},
		{"thread samples", "samples", func() Request { q := lift(); q.Samples = 7; return q }},
		{"bypass mode", "mode", func() Request { q := route(); q.Mode = "section"; return q }},
		{"obstacle", "bypass.obstacle", func() Request { q := route(); q.Bypass.Obstacle = "wall"; return q }},
		{"inner radius", "bypass.inner", func() Request { q := route(); q.Bypass.Inner = 0; return q }},
		{"outer radius", "bypass.outer", func() Request { q := route(); q.Bypass.Outer = 1; return q }},
		{"extent", "bypass.extent", func() Request { q := route(); q.Bypass.Extent = 6; return q }},
		{"route height", "bypass.height", func() Request { q := route(); q.Bypass.Height = -1; return q }},
		{"route position", "bypass.position", func() Request { q := route(); q.Bypass.Position = 2; return q }},
		{"outside point", "bypass.outside.2", func() Request { q := route(); q.Bypass.Outside[2] = nan; return q }},
		{"first comparison", "bypass.w1", func() Request { q := route(); q.Bypass.W1 = 21; return q }},
		{"second comparison", "bypass.w2", func() Request { q := route(); q.Bypass.W2 = nan; return q }},
		{"shell samples", "samples", func() Request { q := route(); q.Samples = 300; return q }},
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

// An error about the study as a whole, or one that several fields decide
// together, names no field.
func TestStudyErrorsNameNoField(t *testing.T) {
	budget := weaveRequest("tori", 9, 16, math.Pi/4, 1)
	budget.Samples = 256
	inside := bypassRequest(t, "shadow", "embedded", 1, .5)
	inside.Bypass.Outside = Vec3{1.5, 0, 0}
	turned := curvedRequest("ball")
	turned.Angles[0] = 1
	for name, q := range map[string]Request{
		"weave budget":        budget,
		"curved budget":       {Object: "tube", Mode: "section", Radius: 2, Tube: .6, Count: 25, Curves: 16, Samples: 256},
		"outside within b":    inside,
		"turned curved solid": turned,
		"no weave":            {Object: "weave", Mode: "stereo"},
	} {
		_, err := Compute(q)
		var named *FieldError
		if err == nil || errors.As(err, &named) {
			t.Errorf("%s: %v", name, err)
		}
	}
}
