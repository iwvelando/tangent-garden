package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func frameRequest() FrameRequest {
	return FrameRequest{Kind: "rotation-minimizing", Reference: Vec3{0, 0, 1}, Offset: 0.5, Width: 0.25, Strands: 1, Closure: "seam"}
}

func framedCustom(x, y, z string, lo, hi float64) Request {
	c := custom(x, y, z, lo, hi)
	c.Construction = "framed"
	c.Frame = frameRequest()
	return c
}

func framedHarmonic(terms ...HarmonicTerm) Request {
	c := harmonicStudy(0, 2*math.Pi, Vec3{}, terms...)
	c.Construction = "framed"
	c.Frame = frameRequest()
	return c
}

func framed(t *testing.T, c Request) Result {
	t.Helper()
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Frame == nil {
		t.Fatal("missing frame result")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	return r
}

// direction recovers the unit offset direction D of strand k at sample i.
func direction(r Result, k, i int) Vec3 {
	return r.Frame.Strands[k][i].sub(*r.Base[i]).unit()
}

// signed is the angle from a to b about the unit axis, in (−π, π].
func signed(a, b, axis Vec3) float64 { return math.Atan2(a.cross(b).dot(axis), a.dot(b)) }

func orthonormal(t *testing.T, g FrameGlyph) {
	t.Helper()
	for _, v := range []Vec3{g.Tangent, g.Normal, g.Binormal} {
		if math.Abs(v.norm()-1) > 1e-12 {
			t.Fatalf("sample %d: not unit %+v", g.SampleIndex, g)
		}
	}
	if math.Abs(g.Tangent.dot(g.Normal)) > 1e-12 || g.Tangent.cross(g.Normal).sub(g.Binormal).norm() > 1e-12 {
		t.Fatalf("sample %d: not right-handed orthonormal %+v", g.SampleIndex, g)
	}
}

func TestFramesAreOrthonormal(t *testing.T) {
	for _, kind := range []string{"rotation-minimizing", "frenet"} {
		c := study()
		c.Construction = "framed"
		c.Frame = frameRequest()
		c.Frame.Kind = kind
		r := framed(t, c)
		if len(r.Frame.Frames) != c.Lines || r.Frame.Kind != kind {
			t.Fatalf("%s: %d frames", kind, len(r.Frame.Frames))
		}
		for _, g := range r.Frame.Frames {
			orthonormal(t, g)
			if *r.Base[g.SampleIndex] != g.Point {
				t.Fatalf("%s: glyph %d off the curve", kind, g.SampleIndex)
			}
		}
		// The developable's tangent reach plays no part.
		if r.Frame.Pieces != 1 || r.Frame.Length <= 0 {
			t.Fatalf("%s: %+v", kind, r.Frame)
		}
	}
}

// helixError is the largest distance between the transported U and the
// analytic rotation-minimizing normal of a helix of radius 2 and pitch
// b = 1/2, cos φ N + sin φ B with φ = −b t / |r′| from U = N at t = 0.
func helixError(t *testing.T, samples int) float64 {
	c := framedCustom("2*cos(t)", "2*sin(t)", "t/2", 0, 4*math.Pi)
	c.Samples, c.Lines = samples, 25
	c.Frame.Reference = Vec3{-1, 0, 0}
	r := framed(t, c)
	speed := math.Sqrt(4.25)
	worst := 0.0
	for _, g := range r.Frame.Frames {
		u := 4 * math.Pi * float64(g.SampleIndex) / float64(samples)
		tangent := Vec3{-2 * math.Sin(u), 2 * math.Cos(u), 0.5}.mul(1 / speed)
		normal := Vec3{-math.Cos(u), -math.Sin(u), 0}
		phi := -0.5 * u / speed
		want := normal.mul(math.Cos(phi)).add(tangent.cross(normal).mul(math.Sin(phi)))
		worst = math.Max(worst, g.Normal.sub(want).norm())
	}
	return worst
}

func TestRotationMinimizingHelixConverges(t *testing.T) {
	coarse, fine, finer := helixError(t, 240), helixError(t, 480), helixError(t, 960)
	if coarse > 1e-4 || coarse/fine < 10 || fine/finer < 10 {
		t.Fatalf("errors %g, %g, %g: not fourth order", coarse, fine, finer)
	}
}

func TestPrescribedTwist(t *testing.T) {
	// A unit circle is planar, so its transported normal stays the axis e_z,
	// and the offset direction turns exactly θ₀ + 2πN s/L about the tangent.
	c := framedHarmonic(HarmonicTerm{Frequency: 1, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1, 0}})
	c.Frame.Angle, c.Frame.Twist, c.Frame.Offset, c.Frame.Width = 0.4, 3, 0.5, 0.2
	r := framed(t, c)
	n := c.Samples
	if math.Abs(r.Frame.Length-2*math.Pi) > 1e-12 || !r.Frame.Closed || r.Frame.Holonomy != 0 || r.Frame.Seam != nil {
		t.Fatalf("circle loop %+v", r.Frame)
	}
	for i := 0; i <= n; i++ {
		u := 2 * math.Pi * float64(i) / float64(n)
		tangent := Vec3{-math.Sin(u), math.Cos(u), 0}
		frame := Vec3{0, 0, 1}
		theta := 0.4 + 6*math.Pi*float64(i)/float64(n)
		d := frame.mul(math.Cos(theta)).add(tangent.cross(frame).mul(math.Sin(theta)))
		near(t, r.Frame.Strands[0][i], r.Base[i].add(d.mul(0.5)), 1e-12)
		near(t, r.Plus[i], r.Base[i].add(d.mul(0.2)), 1e-12)
		near(t, r.Minus[i], r.Base[i].sub(d.mul(0.2)), 1e-12)
	}
	for _, g := range r.Frame.Frames {
		near(t, g.Normal, Vec3{0, 0, 1}, 1e-12)
	}
}

func TestStrandsSpreadEvenly(t *testing.T) {
	c := study()
	c.Construction = "framed"
	c.Frame = frameRequest()
	c.Frame.Strands, c.Frame.Twist = 5, 2
	r := framed(t, c)
	if len(r.Frame.Strands) != 5 {
		t.Fatalf("%d strands", len(r.Frame.Strands))
	}
	for i := 0; i <= c.Samples; i += 37 {
		tangent := r.Frame.Strands[0][i].sub(*r.Base[i]).cross(r.Frame.Strands[1][i].sub(*r.Base[i])).unit()
		for k := 1; k < 5; k++ {
			if math.Abs(signed(direction(r, 0, i), direction(r, k, i), tangent)-wrap(2*math.Pi*float64(k)/5)) > 1e-9 {
				t.Fatalf("sample %d strand %d not at 2πk/m", i, k)
			}
			if math.Abs(r.Frame.Strands[k][i].sub(*r.Base[i]).norm()-c.Frame.Offset) > 1e-12 {
				t.Fatalf("sample %d strand %d not at distance d", i, k)
			}
		}
	}
	c.Frame.Strands = 0
	if r := framed(t, c); len(r.Frame.Strands) != 0 {
		t.Fatal("zero strands drew some")
	}
}

func TestFramesThroughStraightSegment(t *testing.T) {
	// (t + |t|)³ = 8t³ for t > 0 and 0 before: a straight run, then a bend.
	c := framedCustom("t", "(t+abs(t))^3/8", "0.3*(t+abs(t))^3/8", -1, 1)
	c.Lines = 240
	c.Frame.Reference = Vec3{0, 1, 1}
	r := framed(t, c)
	if r.Frame.Pieces != 1 || r.Frame.Fallbacks != 0 {
		t.Fatalf("restarted %+v", r.Frame)
	}
	frames := r.Frame.Frames
	near(t, frames[0].Normal, Vec3{0, 1, 1}.unit(), 1e-9)
	for k := 1; k < len(frames); k++ {
		if frames[k].Normal.dot(frames[k-1].Normal) < 0.99 {
			t.Fatalf("jump at sample %d", frames[k].SampleIndex)
		}
	}
	// Frenet has no normal where the curve is straight.
	c.Frame.Kind = "frenet"
	f := framed(t, c)
	if f.Frame.Undefined < c.Samples/3 || f.Frame.Strands[0][0] != nil || f.Plus[0] != nil {
		t.Fatalf("Frenet on a straight run: %d undefined", f.Frame.Undefined)
	}
	for _, g := range f.Frame.Frames {
		orthonormal(t, g)
	}
}

func TestFramesThroughInflection(t *testing.T) {
	// (t, t³, t⁴) is regular with zero curvature at t = 0, where the Frenet
	// binormal reverses; an odd sample count keeps t = 0 between samples.
	c := framedCustom("t", "t^3", "t^4", -1, 1)
	c.Samples, c.Lines = 241, 240
	r := framed(t, c)
	if r.Frame.Pieces != 1 || r.Omitted != 0 || len(corners(r.Mesh)) != 6*c.Samples {
		t.Fatalf("transport broke at the inflection: %+v, %d omitted", r.Frame, r.Omitted)
	}
	for i := 1; i <= c.Samples; i++ {
		if direction(r, 0, i).dot(direction(r, 0, i-1)) < 0.99 || r.Frame.Breaks[i] {
			t.Fatalf("jump at sample %d", i)
		}
	}
	c.Frame.Kind = "frenet"
	f := framed(t, c)
	if f.Frame.Flips != 1 || !f.Frame.Breaks[c.Samples/2+1] || f.Omitted == 0 || f.Frame.Pieces != 2 {
		t.Fatalf("Frenet flip not broken: %+v", f.Frame)
	}
}

func TestFrameDependsOnReferenceOnlyByRotation(t *testing.T) {
	c := study()
	c.Construction = "framed"
	c.Frame = frameRequest()
	first := framed(t, c)
	c.Frame.Reference = Vec3{1, -2, 0.5}
	second := framed(t, c)
	g0 := first.Frame.Frames[0]
	angle := signed(g0.Normal, second.Frame.Frames[0].Normal, g0.Tangent)
	if math.Abs(angle) < 0.1 {
		t.Fatal("the references give the same start")
	}
	for k, g := range first.Frame.Frames {
		want := g.Normal.mul(math.Cos(angle)).add(g.Binormal.mul(math.Sin(angle)))
		near(t, second.Frame.Frames[k].Normal, want, 1e-9)
	}
	if math.Abs(first.Frame.Holonomy-second.Frame.Holonomy) > 1e-9 {
		t.Fatalf("holonomy depends on the reference: %g, %g", first.Frame.Holonomy, second.Frame.Holonomy)
	}
}

// trefoil is the harmonic trefoil e^{it} + 2e^{−2it} + cos 3t e_z.
var trefoil = []HarmonicTerm{
	{Frequency: 1, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1, 0}},
	{Frequency: -2, Cosine: Vec3{2, 0, 0}, Sine: Vec3{0, 2, 0}},
	{Frequency: 3, Cosine: Vec3{0, 0, 1}},
}

// lopsided is a closed loop without the trefoil's symmetry, so its total
// torsion, and with it the transported normal's return angle, is not zero.
var lopsided = []HarmonicTerm{
	{Frequency: 1, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1, 0}},
	{Frequency: 2, Cosine: Vec3{0, 0, 0.5}, Sine: Vec3{0.3, 0, 0}},
	{Frequency: 3, Cosine: Vec3{0, 0.2, 0}, Sine: Vec3{0, 0, 0.4}},
}

// totalTorsion integrates τ|r′| = ((r′ × r″)·r‴)|r′|/|r′ × r″|² over one period
// of a harmonic curve by the midpoint rule, independently of the transport.
func totalTorsion(t *testing.T, terms []HarmonicTerm) float64 {
	const m = 200000
	total := 0.0
	for j := 0; j < m; j++ {
		u := 2 * math.Pi * (float64(j) + 0.5) / m
		var v, a, jerk Vec3
		for _, term := range terms {
			w := term.Frequency
			c, s := math.Cos(w*u), math.Sin(w*u)
			v = v.add(term.Sine.mul(w * c).sub(term.Cosine.mul(w * s)))
			a = a.sub(term.Cosine.mul(w * w * c).add(term.Sine.mul(w * w * s)))
			jerk = jerk.add(term.Cosine.mul(w * w * w * s).sub(term.Sine.mul(w * w * w * c)))
		}
		b := v.cross(a)
		if b.norm() < 1e-3*v.norm()*v.norm()*v.norm() {
			t.Fatal("the test curve must have nonzero curvature")
		}
		total += b.dot(jerk) * v.norm() / b.dot(b) * 2 * math.Pi / m
	}
	return total
}

func wrap(a float64) float64 { return math.Atan2(math.Sin(a), math.Cos(a)) }

func TestClosedLoopSeam(t *testing.T) {
	c := framedHarmonic(lopsided...)
	c.Samples = 1200
	holonomy := wrap(-totalTorsion(t, lopsided))
	if math.Abs(holonomy) < 0.05 {
		t.Fatalf("a loop with holonomy %g cannot test the seam", holonomy)
	}
	n := c.Samples
	exposed := framed(t, c)
	q := exposed.Frame
	if !q.Closed || math.Abs(q.Holonomy-holonomy) > 1e-6 || q.Correction != 0 {
		t.Fatalf("holonomy %g, want %g (%+v)", q.Holonomy, holonomy, q)
	}
	if q.Seam == nil || math.Abs(q.Seam.Angle-holonomy) > 1e-6 || q.Seam.Point != *exposed.Base[0] {
		t.Fatalf("seam %+v", q.Seam)
	}
	near(t, q.Seam.Start, direction(exposed, 0, 0), 1e-12)
	near(t, q.Seam.End, direction(exposed, 0, n), 1e-12)
	if q.Strands[0][n].sub(*q.Strands[0][0]).norm() < 0.01 {
		t.Fatal("the seam was closed silently")
	}

	c.Frame.Closure = "distribute"
	closed := framed(t, c)
	p := closed.Frame
	if p.Seam != nil || math.Abs(p.Correction+p.Holonomy) > 1e-15 || math.Abs(p.Holonomy-holonomy) > 1e-6 {
		t.Fatalf("distributed %+v", p)
	}
	near(t, p.Strands[0][n], p.Strands[0][0], 1e-9)
	near(t, closed.Plus[n], closed.Plus[0], 1e-9)
	// The correction turns the frame by −α s/L: half of it by half the length.
	for _, g := range p.Frames {
		if g.SampleIndex == 600 {
			reference := q.Frames[len(q.Frames)/2]
			if reference.SampleIndex != 600 {
				t.Fatalf("representative %d", reference.SampleIndex)
			}
			s := halfway(t, c)
			if math.Abs(signed(reference.Normal, g.Normal, g.Tangent)-wrap(-holonomy*s/p.Length)) > 1e-9 {
				t.Fatal("correction is not proportional to arc length")
			}
		}
	}

	// Half a turn of twist cannot close, and says so through the seam.
	c.Frame.Twist = 0.5
	half := framed(t, c)
	if half.Frame.Seam == nil || math.Abs(math.Abs(half.Frame.Seam.Angle)-math.Pi) > 1e-9 {
		t.Fatalf("half-turn seam %+v", half.Frame.Seam)
	}

	// Frenet frames are periodic: no holonomy, and no seam at whole turns.
	c.Frame.Kind, c.Frame.Twist, c.Frame.Closure = "frenet", 2, "seam"
	frenet := framed(t, c)
	if !frenet.Frame.Closed || frenet.Frame.Holonomy != 0 || frenet.Frame.Seam != nil {
		t.Fatalf("Frenet loop %+v", frenet.Frame)
	}
}

// halfway is the Simpson arc length of the loop up to sample 600.
func halfway(t *testing.T, c Request) float64 {
	c.Harmonic.Max = math.Pi
	c.Samples = 600
	r := framed(t, c)
	return r.Frame.Length
}

func TestFrameRestartsAfterBreaks(t *testing.T) {
	c := framedCustom("t", "1/(t-0.3)", "0", -1, 1)
	c.Frame.Reference = Vec3{0, 1, 1}
	r := framed(t, c)
	q := r.Frame
	if q.Pieces != 2 || q.Closed || q.Seam != nil {
		t.Fatalf("pieces %+v", q)
	}
	for i := 1; i <= c.Samples; i++ {
		if r.Breaks[i] && !q.Breaks[i] {
			t.Fatal("frame breaks lost a base break")
		}
	}
	// Both pieces start from N₀ projected onto their first normal plane.
	for i := 0; i <= c.Samples; i++ {
		if r.Base[i] != nil && (i == 0 || r.Base[i-1] == nil || r.Breaks[i]) {
			tangent := r.Base[min(i+1, c.Samples)].sub(*r.Base[i]).unit()
			reference := Vec3{0, 1, 1}
			want := reference.sub(tangent.mul(reference.dot(tangent))).unit()
			if direction(r, 0, i).dot(want) < 0.999 {
				t.Fatalf("piece at %d did not restart from N₀", i)
			}
		}
	}
}

func TestFrameFallsBackFromTangentReference(t *testing.T) {
	c := framedCustom("t", "0", "0", 0, 1)
	c.Frame.Reference = Vec3{3, 0, 0}
	r := framed(t, c)
	if r.Frame.Fallbacks != 1 {
		t.Fatalf("%d fallbacks", r.Frame.Fallbacks)
	}
	for _, g := range r.Frame.Frames {
		orthonormal(t, g)
		near(t, g.Normal, r.Frame.Frames[0].Normal, 1e-12)
	}
}

func TestFrameRigidMotionAndReparameterization(t *testing.T) {
	c := framedCustom("2*cos(t)", "2*sin(t)", "t/2", 0, 4*math.Pi)
	c.Frame.Reference, c.Frame.Twist = Vec3{0.3, -1, 0.2}, 1.5
	r := framed(t, c)
	// The cyclic permutation (x, y, z) → (z, x, y) is a rotation.
	turned := framedCustom("t/2", "2*cos(t)", "2*sin(t)", 0, 4*math.Pi)
	turned.Frame.Reference, turned.Frame.Twist = Vec3{0.2, 0.3, -1}, 1.5
	m := framed(t, turned)
	rotate := func(v Vec3) Vec3 { return Vec3{v.Z, v.X, v.Y} }
	faster := framedCustom("2*cos(2*t)", "2*sin(2*t)", "t", 0, 2*math.Pi)
	faster.Frame.Reference, faster.Frame.Twist = Vec3{0.3, -1, 0.2}, 1.5
	f := framed(t, faster)
	for k, g := range r.Frame.Frames {
		near(t, m.Frame.Frames[k].Normal, rotate(g.Normal), 1e-9)
		near(t, f.Frame.Frames[k].Normal, g.Normal, 1e-9)
	}
	for i := 0; i <= c.Samples; i++ {
		near(t, m.Frame.Strands[0][i], rotate(*r.Frame.Strands[0][i]), 1e-9)
		near(t, f.Frame.Strands[0][i], r.Frame.Strands[0][i], 1e-9)
	}
}

func TestRibbonMesh(t *testing.T) {
	c := study()
	c.Construction = "framed"
	c.Frame = frameRequest()
	c.Frame.Width, c.Frame.Twist = 0.3, 2
	r := framed(t, c)
	if r.Omitted != 0 || len(corners(r.Mesh)) != 6*c.Samples || len(r.Rulings) != c.Lines {
		t.Fatalf("%d vertices, %d omitted, %d rulings", len(corners(r.Mesh)), r.Omitted, len(r.Rulings))
	}
	mesh := corners(r.Mesh)
	for k := 0; k < len(mesh); k += 3 {
		a, b, d := mesh[k], mesh[k+1], mesh[k+2]
		for _, v := range []Vertex{a, b, d} {
			if math.Abs(v.Normal.norm()-1) > 1e-12 || v.Normal != a.Normal {
				t.Fatalf("triangle %d normal %+v", k/3, v.Normal)
			}
		}
		for _, e := range []Vec3{b.Position.sub(a.Position), d.Position.sub(a.Position)} {
			if math.Abs(e.dot(a.Normal)) > 1e-12*(1+e.norm()) {
				t.Fatalf("triangle %d normal not perpendicular", k/3)
			}
		}
	}
	for _, g := range r.Rulings {
		if math.Abs(g.To.sub(g.From).norm()-0.6) > 1e-12 || g.From != *r.Minus[g.SampleIndex] {
			t.Fatalf("cross-line %+v", g)
		}
	}
	// No width, no ribbon.
	c.Frame.Width = 0
	flat := framed(t, c)
	if len(corners(flat.Mesh)) != 0 || len(flat.Rulings) != 0 || len(flat.Minus) != 0 || len(flat.Plus) != 0 {
		t.Fatal("zero width drew a ribbon")
	}
}

func TestFrameBoundsHoldStrands(t *testing.T) {
	c := framedCustom("t", "0", "0", 0, 1)
	c.Frame.Offset = 6
	r := framed(t, c)
	if r.Bounds.Radius < 3 {
		t.Fatalf("bounds %+v miss the strand", r.Bounds)
	}
	// A harmonic curve keeps its generating vectors under the frame.
	h := framedHarmonic(trefoil...)
	if len(framed(t, h).Harmonic.Positions) != h.Lines {
		t.Fatal("missing generating vectors")
	}
}

func TestFrameValidation(t *testing.T) {
	cases := []struct {
		change func(*FrameRequest)
		want   string
	}{
		{func(f *FrameRequest) { f.Kind = "bishop" }, "frame"},
		{func(f *FrameRequest) { f.Reference = Vec3{} }, "reference normal"},
		{func(f *FrameRequest) { f.Reference = Vec3{math.NaN(), 0, 0} }, "reference normal"},
		{func(f *FrameRequest) { f.Reference = Vec3{2e5, 0, 0} }, "reference normal"},
		{func(f *FrameRequest) { f.Angle = math.Inf(1) }, "angle"},
		{func(f *FrameRequest) { f.Angle = 1001 }, "angle"},
		{func(f *FrameRequest) { f.Twist = 101 }, "twist"},
		{func(f *FrameRequest) { f.Twist = math.NaN() }, "twist"},
		{func(f *FrameRequest) { f.Offset = -0.1 }, "offset distance"},
		{func(f *FrameRequest) { f.Offset = 2e5 }, "offset distance"},
		{func(f *FrameRequest) { f.Width = -1 }, "half-width"},
		{func(f *FrameRequest) { f.Width = math.Inf(1) }, "half-width"},
		{func(f *FrameRequest) { f.Strands = 13 }, "strands"},
		{func(f *FrameRequest) { f.Strands = -1 }, "strands"},
		{func(f *FrameRequest) { f.Closure = "glue" }, "closure"},
	}
	for _, k := range cases {
		c := study()
		c.Construction = "framed"
		c.Frame = frameRequest()
		k.change(&c.Frame)
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), k.want) {
			t.Fatalf("want %q, got %v", k.want, err)
		}
	}
	// Frenet frames never read N₀, so a hidden, unusable one is ignored.
	c := study()
	c.Construction = "framed"
	c.Frame = frameRequest()
	c.Frame.Kind, c.Frame.Reference = "frenet", Vec3{}
	framed(t, c)
}

func TestStartFallsBackToLeastAlignedAxis(t *testing.T) {
	for _, k := range []struct{ tangent, want Vec3 }{
		{Vec3{0, 0.6, 0.8}, Vec3{1, 0, 0}},
		{Vec3{0.6, 0, 0.8}, Vec3{0, 1, 0}},
		{Vec3{0.6, 0.8, 0}, Vec3{0, 0, 1}},
	} {
		u, fallback := start(k.tangent.mul(-2), k.tangent)
		if !fallback {
			t.Fatal("a tangent reference was used")
		}
		near(t, u, k.want, 1e-15)
	}
	if u, fallback := start(Vec3{0, 0, 5}, Vec3{1, 0, 0}); fallback || u != (Vec3{0, 0, 1}) {
		t.Fatalf("projected %+v", u)
	}
}
