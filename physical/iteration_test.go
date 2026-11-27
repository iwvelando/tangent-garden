package physical

import (
	"math"
	"math/cmplx"
	"strings"
	"testing"
)

// Recessed, the frame is the slab's own material at full height, so a
// crop or clean rim sits flat when turned over: no vertex near the edge
// is lower than the slab's top except on the bottom.
func TestRecessedFrameIsFullHeight(t *testing.T) {
	for _, rim := range []string{RimCrop, RimClean} {
		q := solidRequest(starLace(5, 1000), 120, 2, Recessed, rim)
		q.Clip = 0.6
		s, err := BuildLaceSolid(q, DefaultLimits)
		if err != nil {
			t.Fatal(err)
		}
		top := s.Levels.Rest
		v := s.Solid.V
		for i := 0; i < len(v); i += 3 {
			r := math.Hypot(v[i], v[i+1])
			// The frame's inner edge is at 58 mm, where grooves end.
			if r > 58+0.05 && v[i+2] != 0 && v[i+2] != top {
				t.Fatalf("%s: vertex at radius %.3f, height %g", rim, r, v[i+2])
			}
		}
		if !s.Mesh.Valid() {
			t.Fatalf("%s: %+v", rim, s.Mesh)
		}
	}
}

// Face down turns the solid over about the x axis, a rotation: the same
// volume, still valid, with the decorated face on the bed.
func TestFaceDownIsARotation(t *testing.T) {
	q := solidRequest(starLace(4, 1000), 90, 2, Recessed, RimCrop)
	q.Clip = 0.6
	up, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	q.Design.FaceDown = true
	down, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	if !down.Mesh.Valid() || math.Abs(down.Mesh.Volume-up.Mesh.Volume) > 1e-9*up.Mesh.Volume {
		t.Fatalf("down %+v, up volume %g", down.Mesh, up.Mesh.Volume)
	}
	H := math.Max(up.Levels.Plan, up.Levels.Rest)
	if len(up.Solid.V) != len(down.Solid.V) {
		t.Fatal("vertex counts differ")
	}
	for i := 0; i < len(up.Solid.V); i += 3 {
		x, y, z := up.Solid.V[i], up.Solid.V[i+1], up.Solid.V[i+2]
		if down.Solid.V[i] != x || down.Solid.V[i+1] != -y || down.Solid.V[i+2] != H-z {
			t.Fatalf("vertex %d not turned over", i/3)
		}
	}
	// The slab's top, frame included, lies on the bed.
	if a := down.Mesh.Up[H]; math.Abs(a-math.Pi*45*45) > 2 {
		t.Errorf("upward area at the top %.2f, want the plaque's bottom", a)
	}
}

// Floor 0 is openwork: raised, the lines alone; recessed, the webs alone,
// each with its volume and one body when the lace holds together.
func TestOpenwork(t *testing.T) {
	q := solidRequest(starLace(4, 1000), 100, 2, Raised, RimMotif)
	q.Design.Floor = 0
	s, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	if !s.Mesh.Valid() || s.Mesh.Components != 1 || s.Mesh.Min[2] != 0 || s.Mesh.Max[2] != 1.2 {
		t.Fatalf("raised openwork %+v", s.Mesh)
	}
	if want := s.Mesh.Up[1.2] * 1.2; math.Abs(s.Mesh.Volume-want) > 1e-9*want {
		t.Errorf("volume %g, want area × relief %g", s.Mesh.Volume, want)
	}
	required(t, s)
	q = solidRequest(starLace(4, 1000), 100, 2, Recessed, RimCrop)
	q.Clip, q.Design.Floor = 0.6, 0
	s, err = BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	if !s.Mesh.Valid() || s.Mesh.Min[2] != 0 || s.Mesh.Max[2] != 1.2 {
		t.Fatalf("recessed openwork %+v", s.Mesh)
	}
	// Separate rings as openwork fall apart: one body fails, with a hint.
	l := starLace(3, 1000)
	l.Motif, l.Size = "rings", 0.6
	q = solidRequest(l, 150, 2, Raised, RimMotif)
	q.Design.Floor = 0
	s, err = BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range s.Checks {
		if c.ID == "components" && (c.Status != StatusFail || c.Hint == "") {
			t.Errorf("separate rings as openwork: %+v", c)
		}
	}
}

// Removing features below the minimums: an isolated pillar and a thin
// wall attached to thick material are removed, and the narrow gap
// between two bands is filled; thick material and wide gaps are kept.
func TestSimplifyRemovesThinMaterialAndFillsNarrowGaps(t *testing.T) {
	const h, wall, gap = 0.1, 2.0, 1.0
	// Recessed: material is outside the bands. A ring of grooves leaves
	// an island 0.8 mm across at its center; a big island elsewhere.
	strokes := append(Circle(0, 1.4, 1), Circle(complex(12, 0), 5, 1)...)
	p := Plan{Strokes: strokes, Outer: 20, Plaque: 20}
	g, err := Sample(p, h, wall/2+2*h, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	r := g.Simplify(false, wall, gap, p.Outer, p.Plaque)
	if r.RemovedArea < 0.3 || r.RemovedArea > 1 {
		t.Errorf("removed %.3f mm², want the 0.8 mm island's", r.RemovedArea)
	}
	at := func(x complex128) float64 {
		i, j := g.index(x + complex(h/2, h/2))
		return g.F[j*g.NX+i]
	}
	if at(0) >= 0 {
		t.Error("the small island is still material")
	}
	if at(complex(12, 0)) <= 0 {
		t.Error("the big island was removed")
	}
	// Raised: two bands 0.6 mm apart get the gap between them filled;
	// bands 3 mm apart keep theirs.
	strokes = []Stroke{
		{A: -8 - 1i, B: 8 - 1i, Straight: true, Half: 1},
		{A: -8 + 0.6i + 1i, B: 8 + 0.6i + 1i, Straight: true, Half: 1},
		{A: -8 + 5.6i, B: 8 + 5.6i, Straight: true, Half: 1},
	}
	p = Plan{Strokes: strokes, Outer: 15, Plaque: 15}
	g, err = Sample(p, h, wall/2+2*h, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	r = g.Simplify(true, wall, gap, p.Outer, p.Plaque)
	if at(0.3i) >= 0 {
		t.Error("the narrow gap was not filled")
	}
	if at(3.3i) <= 0 {
		t.Error("the wide gap was filled")
	}
	if r.FilledArea < 5 {
		t.Errorf("filled %.2f mm²", r.FilledArea)
	}
	// Smooth boundaries do not move.
	if v := at(-2.05i); v <= 0 {
		t.Errorf("a band's outer edge moved: %g", v)
	}
}

// With the toggle, the user's failing recessed rim validates, with what
// was removed counted; without it, the failures say what to change.
func TestSimplifyThroughTheBuilder(t *testing.T) {
	q := solidRequest(starLace(5, 1000), 150, 2, Recessed, RimClean)
	q.Clip = 0.95
	s, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	if s.Validated {
		t.Fatal("the fine rim validated without simplifying")
	}
	for _, c := range s.Checks {
		if c.Required && c.Status != StatusPass && c.Hint == "" {
			t.Errorf("failing check %s has no hint", c.ID)
		}
		if c.ID == "cells" && !strings.Contains(c.Hint, "Remove features") {
			t.Errorf("cells hint %q", c.Hint)
		}
	}
	q.Design.Simplify = true
	s, err = BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	required(t, s)
	if s.Simplified.RemovedArea == 0 {
		t.Error("nothing was removed")
	}
	t.Logf("removed %.1f mm², filled %.1f mm²", s.Simplified.RemovedArea, s.Simplified.FilledArea)
}

// Tile sides join the solid as strokes of their own, by request.
func TestTileSides(t *testing.T) {
	l := starLace(3, 1000)
	l.Motif, l.Size = "rings", 0.6
	q := solidRequest(l, 150, 2, Raised, RimMotif)
	a, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	q.Lines = LinesBoth
	b, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	// The rings stay apart from the sides, which are one piece of their own.
	if b.Source.Strokes <= a.Source.Strokes || b.Source.Pieces != a.Source.Pieces+1 {
		t.Errorf("strokes %d → %d, pieces %d → %d", a.Source.Strokes, b.Source.Strokes, a.Source.Pieces, b.Source.Pieces)
	}
	q.Lines = LinesSides
	c, err := BuildLaceSolid(q, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	if c.Source.Pieces != 1 {
		t.Errorf("sides alone: %d pieces", c.Source.Pieces)
	}
	_ = cmplx.Abs
}

// The automatic grid step keeps the field within its ceiling.
func TestAutomaticGrid(t *testing.T) {
	q := solidRequest(starLace(2, 1000), 250, 2, Raised, RimMotif)
	lim := DefaultLimits
	lim.Nodes = 900_000
	s, err := BuildLaceSolid(q, lim)
	if err != nil {
		t.Fatal(err)
	}
	if s.Grid <= 0.2 || s.Stats.Nodes > lim.Nodes {
		t.Errorf("grid %g, nodes %d", s.Grid, s.Stats.Nodes)
	}
	q.Diameter = 100
	s, _ = BuildLaceSolid(q, lim)
	if s.Grid != 0.2 {
		t.Errorf("a small plaque's grid %g", s.Grid)
	}
}
