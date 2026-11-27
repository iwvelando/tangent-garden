package physical

import (
	"bytes"
	"errors"
	"math"
	"strings"
	"testing"

	"tangentgarden/engine"
)

func starLace(depth, tiles int) engine.LaceRequest {
	return engine.LaceRequest{Tiling: "7,3", Depth: depth, MaxTiles: tiles, StarPoint: 0.5}
}

func solidRequest(q engine.LaceRequest, diameter, line float64, treatment, rim string) LaceSolidRequest {
	prof := DefaultProfiles()[0]
	prof.Wall, prof.Strut = line, line
	return LaceSolidRequest{
		Lace: q, Diameter: diameter, Rim: rim,
		Design:  Design{Treatment: treatment, Line: line, Floor: 1.6, Relief: 1.2},
		Profile: prof,
	}
}

func required(t *testing.T, s *LaceSolid) {
	t.Helper()
	for _, c := range s.Checks {
		if c.Required && c.Status != StatusPass {
			t.Errorf("required check %s: %s (%g against %g) %s", c.ID, c.Status, c.Value, c.Limit, c.Detail)
		}
	}
	if !s.Validated {
		t.Error("not validated")
	}
}

// The whole-motif cutoff keeps whole tiles in order of their drawn
// scale, and what it keeps passes every required check.
func TestLaceMotifCutoff(t *testing.T) {
	q := solidRequest(starLace(5, 1000), 120, 2, Raised, RimMotif)
	s, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	required(t, s)
	if s.Cutoff.Admitted == 0 || s.Cutoff.Admitted >= s.Source.Tiles {
		t.Fatalf("admitted %d of %d", s.Cutoff.Admitted, s.Source.Tiles)
	}
	in := map[int]bool{}
	least := math.Inf(1)
	for _, i := range s.Cutoff.Tiles {
		in[i] = true
		least = math.Min(least, s.scales[i])
	}
	for i, sc := range s.scales {
		if !in[i] && sc > least {
			t.Fatalf("tile %d (scale %g) left out above the least kept scale %g", i, sc, least)
		}
	}
	if s.Cutoff.Reason != "manufacturing" || !(s.Cutoff.Radius > 0) || s.Cutoff.Radius > 1 {
		t.Errorf("cutoff %+v", s.Cutoff)
	}
	if s.Mesh.Components != 1 || !s.Mesh.Valid() {
		t.Errorf("mesh %+v", s.Mesh)
	}
	t.Logf("kept %d of %d tiles in %d rounds; %d triangles; cutoff at model radius %.3f", s.Cutoff.Admitted, s.Source.Tiles, s.Cutoff.Rounds, s.Stats.Triangles, s.Cutoff.Radius)
}

// A patch that ends before any manufacturing limit is not reported as a
// cutoff: its edge is the source's.
func TestLaceUnderfilledPatch(t *testing.T) {
	s, err := BuildLaceSolid(solidRequest(starLace(1, 1000), 180, 2, Raised, RimMotif), DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	required(t, s)
	if s.Cutoff.Admitted != s.Source.Tiles || s.Cutoff.Reason != "source" || s.Source.BeyondDepth == 0 {
		t.Errorf("cutoff %+v source %+v", s.Cutoff, s.Source)
	}
}

// A plaque too small for any whole tile's gaps is refused, saying why.
func TestLaceUnprintableIsRefused(t *testing.T) {
	_, err := BuildLaceSolid(solidRequest(starLace(5, 1000), 20, 3, Raised, RimMotif), DefaultLimits)
	if err == nil || !strings.Contains(err.Error(), "no whole tile") {
		t.Fatalf("%v", err)
	}
}

// The view's window and zoom detail never reach the solid; the isometry
// does.
func TestLaceSolidIgnoresTheCamera(t *testing.T) {
	q := solidRequest(starLace(4, 1000), 90, 2, Raised, RimMotif)
	a, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	q.Lace.Window = &engine.LaceWindow{XMin: 0.2, XMax: 0.6, YMin: -0.1, YMax: 0.3}
	q.Lace.MinRadius = 0.004
	b, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(a.Package, b.Package) {
		t.Error("the camera changed the package")
	}
	q.Lace.Window, q.Lace.MinRadius = nil, 0
	q.Lace.Isometry = &engine.LaceIsometry{Offset: 0.3, Direction: 0.4}
	c, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(a.Package, c.Package) {
		t.Error("the isometry did not change the package")
	}
}

func TestLaceRecessedAndRim(t *testing.T) {
	for _, q := range []LaceSolidRequest{
		solidRequest(starLace(5, 1000), 120, 2, Recessed, RimMotif),
		solidRequest(starLace(5, 1000), 120, 2, Raised, RimClean),
	} {
		s, err := BuildLaceSolid(q, DefaultLimits)
		if err != nil {
			t.Fatal(err)
		}
		required(t, s)
		t.Logf("%s %s: %d tiles, clip %.3f, %d triangles", q.Design.Treatment, q.Rim, s.Cutoff.Admitted, s.Clip, s.Stats.Triangles)
	}
}

// A crop magnifies a disk of the lace to the plaque, framed at its edge.
func TestLaceCrop(t *testing.T) {
	q := solidRequest(starLace(5, 1000), 120, 2, Raised, RimCrop)
	q.Clip = 0.45
	s, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	// The frame's outer half and the plaque's edge hold no source cell.
	required(t, s)
	if want := (60 - 2) / 0.45; math.Abs(s.Scale-want) > 1e-9 {
		t.Errorf("scale %g, want %g", s.Scale, want)
	}
	if math.Abs(s.Mesh.Max[0]-60) > 0.01 || s.Mesh.Components != 1 {
		t.Errorf("mesh %+v", s.Mesh)
	}
	// Changing the crop changes the solid.
	q.Clip = 0.5
	o, _ := BuildLaceSolid(q, DefaultLimits)
	if o == nil || bytes.Equal(o.Package, s.Package) {
		t.Error("the crop did not change the solid")
	}
}

// Separate rings that come within the gap minimum of each other are
// fused pieces; the cutoff keeps only tiles whose rings stay apart.
func TestLaceSeparateRingsStayApart(t *testing.T) {
	l := starLace(4, 1000)
	l.Motif, l.Size = "rings", 0.6
	s, err := BuildLaceSolid(solidRequest(l, 150, 2, Raised, RimMotif), DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	required(t, s)
	if s.Cells.Fused != nil {
		t.Errorf("fused %v", s.Cells.Fused)
	}
	if s.Source.Pieces < 2 {
		t.Errorf("source pieces %d", s.Source.Pieces)
	}
}

func TestLaceRefusals(t *testing.T) {
	good := solidRequest(starLace(3, 1000), 120, 2, Raised, RimMotif)
	for _, c := range []struct {
		field string
		edit  func(*LaceSolidRequest)
	}{
		{"diameter", func(q *LaceSolidRequest) { q.Diameter = 4 }},
		{"diameter", func(q *LaceSolidRequest) { q.Diameter = 400 }},
		{"design.treatment", func(q *LaceSolidRequest) { q.Design.Treatment = "embossed" }},
		{"design.line", func(q *LaceSolidRequest) { q.Design.Line = 0 }},
		{"design.floor", func(q *LaceSolidRequest) { q.Design.Floor = math.NaN() }},
		{"rim", func(q *LaceSolidRequest) { q.Rim = "fade" }},
		{"clip", func(q *LaceSolidRequest) { q.Rim, q.Clip = RimCrop, 1.2 }},
		{"profile.version", func(q *LaceSolidRequest) { q.Profile.Version = 2 }},
		{"profile.nozzle", func(q *LaceSolidRequest) { q.Profile.Nozzle = -1 }},
		{"grid", func(q *LaceSolidRequest) { q.Grid = 0.01 }},
	} {
		q := good
		q.Profile = DefaultProfiles()[0]
		c.edit(&q)
		_, err := BuildLaceSolid(q, DefaultLimits)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Errorf("%s: %v", c.field, err)
		}
	}
}

// The node ceiling admits a 180 mm plaque at the default step and
// refuses a larger one there, asking for a coarser step, which admits the
// largest build plate's.
func TestLaceNodeCeiling(t *testing.T) {
	q := solidRequest(starLace(2, 1000), 180, 2, Raised, RimMotif)
	if _, err := BuildLaceSolid(q, DefaultLimits); err != nil {
		t.Fatalf("180 mm: %v", err)
	}
	q.Diameter = 200
	_, err := BuildLaceSolid(q, DefaultLimits)
	if !errors.Is(err, ErrLimit) || !strings.Contains(err.Error(), "coarser grid step") {
		t.Fatalf("200 mm at 0.2 mm: %v", err)
	}
	q.Diameter, q.Grid = 256, 0.3
	if _, err := BuildLaceSolid(q, DefaultLimits); err != nil {
		t.Fatalf("256 mm at 0.3 mm: %v", err)
	}
}
