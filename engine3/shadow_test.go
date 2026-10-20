package engine3

import (
	"encoding/json"
	"math"
	"tangentgarden/engine"
	"testing"
)

func shadowed(t *testing.T, c Request) Result {
	t.Helper()
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Shadow == nil {
		t.Fatal("missing shadow")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	return r
}

// The shadow on each plane is the curve with that coordinate replaced, so
// it keeps the curve's breaks, and the window on the plane holds it all,
// as the study's bounds hold the window.
func TestShadowIsTheOrthogonalProjection(t *testing.T) {
	for _, plane := range []string{"x", "y", "z"} {
		c := study()
		c.Construction = "none"
		c.Shadow = &ShadowRequest{Plane: plane, At: -4.5}
		r := shadowed(t, c)
		s := r.Shadow
		if s.Plane != plane || s.At != -4.5 || s.Kind != "" || len(s.Planar) != 0 || len(s.Cast) != 0 || s.Deviation != nil {
			t.Fatalf("%s: shadow of a curve alone: %+v", plane, s)
		}
		if len(s.Curve.Points) != len(r.Base) {
			t.Fatalf("%s: shadow has %d points, the curve %d", plane, len(s.Curve.Points), len(r.Base))
		}
		flat := func(p Vec3) Vec3 {
			switch plane {
			case "x":
				p.X = -4.5
			case "y":
				p.Y = -4.5
			default:
				p.Z = -4.5
			}
			return p
		}
		for i, p := range r.Base {
			near(t, s.Curve.Points[i], flat(*p), 0)
			if s.Curve.Breaks[i] != r.Breaks[i] {
				t.Fatalf("%s: break %d differs from the curve's", plane, i)
			}
		}
		for _, corner := range s.Corners {
			near(t, corner, flat(corner), 0)
			if corner.sub(r.Bounds.Center).norm() > r.Bounds.Radius*(1+1e-12) {
				t.Fatalf("%s: the window's corner %+v lies outside the bounds", plane, corner)
			}
		}
		u, v := map[string][2]func(Vec3) float64{
			"x": {func(p Vec3) float64 { return p.Y }, func(p Vec3) float64 { return p.Z }},
			"y": {func(p Vec3) float64 { return p.Z }, func(p Vec3) float64 { return p.X }},
			"z": {func(p Vec3) float64 { return p.X }, func(p Vec3) float64 { return p.Y }},
		}[plane][0], map[string][2]func(Vec3) float64{
			"x": {nil, func(p Vec3) float64 { return p.Z }},
			"y": {nil, func(p Vec3) float64 { return p.X }},
			"z": {nil, func(p Vec3) float64 { return p.Y }},
		}[plane][1]
		lowU, highU := math.Min(u(s.Corners[0]), u(s.Corners[2])), math.Max(u(s.Corners[0]), u(s.Corners[2]))
		lowV, highV := math.Min(v(s.Corners[0]), v(s.Corners[2])), math.Max(v(s.Corners[0]), v(s.Corners[2]))
		for _, p := range s.Curve.Points {
			if u(*p) < lowU || u(*p) > highU || v(*p) < lowV || v(*p) > highV {
				t.Fatalf("%s: the window leaves out %+v", plane, p)
			}
		}
	}
}

// A curve lying in a plane parallel to the shadow's casts every
// construction exactly: its tangent has no component across the plane, so
// arc length, tangent feet and half-turns are the same in the plane, and
// inversion is when its center lies in the curve's plane. The pole stands
// off the curve's plane, which a tangent foot does not notice.
func TestShadowOfAPlanarCurveReduces(t *testing.T) {
	for _, tc := range []struct {
		construction, input, kind string
		members                   int
	}{
		{"involute", "base", "involute", 1},
		{"involute", "base", "involute", 5},
		{"involute", "tangent-foot", "involute", 3},
		{"tangent-foot", "base", "pedal", 1},
		{"orthotomic", "base", "orthotomic", 1},
		{"inversion", "base", "inversion", 1},
		{"inversion", "orthotomic", "inversion", 1},
	} {
		c := custom("2*cos(t)", "sin(t)+0.3*cos(2*t)", "1.3", 0, 2*math.Pi)
		c.Samples = 720
		c.Construction, c.Input = tc.construction, "base"
		c.Pole = Vec3{0.4, -0.3, 2.2}
		c.Involute = InvoluteRequest{Anchor: 1, Offset: 0.6}
		if tc.members > 1 {
			c.Involute.Family = InvoluteFamily{Enabled: true, From: -1, To: 2, Count: tc.members}
		}
		if tc.construction == "involute" {
			c.Input = tc.input
		}
		c.Inversion = InversionRequest{Center: Vec3{0.2, 0.1, 1.3}, Radius: 1.4, Input: tc.input}
		if tc.construction == "inversion" && tc.input == "orthotomic" {
			// The half-turn 2H − P leaves the curve's plane with the pole,
			// and inversion then sees the height: here it must not.
			c.Pole.Z = 1.3
		}
		c.Shadow = &ShadowRequest{Plane: "z", At: -1}
		s := shadowed(t, c).Shadow
		name := tc.construction + " of " + tc.input
		if s.Kind != tc.kind || len(s.Planar) != tc.members || len(s.Cast) != tc.members {
			t.Fatalf("%s: kind %q with %d planar and %d cast paths", name, s.Kind, len(s.Planar), len(s.Cast))
		}
		if s.Deviation == nil || *s.Deviation > 1e-8 {
			t.Fatalf("%s: the reduction should hold, deviation %v", name, s.Deviation)
		}
		if s.Compared < c.Samples/2 {
			t.Fatalf("%s: compared only %d samples", name, s.Compared)
		}
	}
}

// The helix r = (2 cos t, 2 sin t, t/2) climbs at a constant slope: its
// shadow is the circle of radius 2, whose pedal about its center is the
// circle itself and whose involutes anchored at t₀ are
// 2(cos t, sin t) + (c − 2(t − t₀))(−sin t, cos t). Its own tangent feet
// from P = (0, 0, z₀) lie at r + k r′ with k = (z₀ − t/2)/8.5, and its
// involutes' shadows are the circle's involutes with string c·2/√4.25: the
// reduction fails, by an amount these give independently.
func TestShadowOfAHelixParts(t *testing.T) {
	const z0, t0, c0 = 0.3, 2.0, 1.2
	helix := func() Request {
		c := custom("2*cos(t)", "2*sin(t)", "t/2", 0, 4*math.Pi)
		c.Samples = 1200
		c.Pole = Vec3{0, 0, z0}
		c.Involute = InvoluteRequest{Anchor: t0, Offset: c0}
		c.Shadow = &ShadowRequest{Plane: "z", At: -2}
		return c
	}
	parameter := func(i int) float64 { return 4 * math.Pi * float64(i) / 1200 }
	worst := 0.0
	c := helix()
	c.Construction = "tangent-foot"
	s := shadowed(t, c).Shadow
	for i, p := range s.Planar[0].Points {
		u := parameter(i)
		near(t, p, Vec3{2 * math.Cos(u), 2 * math.Sin(u), -2}, 1e-8)
		k := (z0 - u/2) / 8.5
		want := Vec3{2*math.Cos(u) - 2*k*math.Sin(u), 2*math.Sin(u) + 2*k*math.Cos(u), -2}
		near(t, s.Cast[0].Points[i], want, 1e-8)
		worst = math.Max(worst, want.sub(*p).norm())
	}
	if s.Deviation == nil || math.Abs(*s.Deviation*s.Size-worst) > 1e-8 {
		t.Fatalf("deviation %v of size %g, want %g", s.Deviation, s.Size, worst)
	}
	if math.Abs(s.Size-2) > 1e-6 {
		t.Fatalf("the shadow's size is %g, want the circle's radius 2", s.Size)
	}
	c = helix()
	c.Construction = "involute"
	s = shadowed(t, c).Shadow
	slope := 2 / math.Sqrt(4.25)
	for i, p := range s.Planar[0].Points {
		u := parameter(i)
		string := c0 - 2*(u-t0)
		near(t, p, Vec3{2*math.Cos(u) - string*math.Sin(u), 2*math.Sin(u) + string*math.Cos(u), -2}, 1e-7)
		cast := (c0 - math.Sqrt(4.25)*(u-t0)) * slope
		near(t, s.Cast[0].Points[i], Vec3{2*math.Cos(u) - cast*math.Sin(u), 2*math.Sin(u) + cast*math.Cos(u), -2}, 1e-7)
	}
	if s.Deviation == nil || *s.Deviation < 0.01 {
		t.Fatalf("the helix's involutes do not reduce, deviation %v", s.Deviation)
	}
}

// A study without a shadow, or with none, is unchanged, and a surface,
// mirror or level set ignores the shadow altogether.
func TestShadowLeavesOtherStudiesAlone(t *testing.T) {
	encode := func(c Request) string {
		r, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(r)
		return string(b)
	}
	c := study()
	c.Construction = "involute"
	c.Involute = InvoluteRequest{Anchor: 1, Offset: 0.5}
	want := encode(c)
	for _, s := range []*ShadowRequest{{Plane: "none", At: 3}, {Plane: "", At: math.NaN()}} {
		c.Shadow = s
		if encode(c) != want {
			t.Fatalf("a shadow on plane %q changed the study", s.Plane)
		}
	}
	surface := Request{Format: "surface", Surface: SurfaceRequest{Kind: "ellipsoid", A: 1, B: 1, C: 1, UMin: 0, UMax: math.Pi, VMin: 0, VMax: 2 * math.Pi, USamples: 12, VSamples: 12, Curves: 4}}
	surface.Shadow = &ShadowRequest{Plane: "w", At: math.Inf(1)}
	r, err := Compute(surface)
	if err != nil || r.Shadow != nil {
		t.Fatalf("a surface study should ignore the shadow: %v %+v", err, r.Shadow)
	}
}

func TestShadowFieldErrors(t *testing.T) {
	for _, tc := range []struct {
		shadow ShadowRequest
		field  string
	}{
		{ShadowRequest{Plane: "w"}, "shadow.plane"},
		{ShadowRequest{Plane: "z", At: math.NaN()}, "shadow.at"},
		{ShadowRequest{Plane: "x", At: 2e5}, "shadow.at"},
	} {
		c := study()
		c.Shadow = &tc.shadow
		_, err := Compute(c)
		if fe, ok := err.(*FieldError); !ok || fe.Field != tc.field {
			t.Fatalf("%+v: got %v, want an error on %s", tc.shadow, err, tc.field)
		}
	}
}

// A construction with no planar counterpart casts only the curve's
// shadow; a field's trajectory casts one too, and its involute is the 2D
// engine's on that shadow.
func TestShadowWithoutAPlanarConstruction(t *testing.T) {
	for _, construction := range []string{"developable", "framed", "ruled", "canal"} {
		c := study()
		c.Construction = construction
		c.Frame = FrameRequest{Kind: "rotation-minimizing", Reference: Vec3{0, 0, 1}, Width: 0.3, Closure: "seam"}
		c.Ruled = RuledRequest{Partner: "chord", Rate: 1, Shift: 2}
		c.Canal = CanalRequest{Radius: 0.2, Profile: "1"}
		c.Shadow = &ShadowRequest{Plane: "z", At: -3}
		s := shadowed(t, c).Shadow
		if s.Kind != "" || len(s.Planar)+len(s.Cast) != 0 || s.Deviation != nil || len(s.Curve.Points) == 0 {
			t.Fatalf("%s: %+v", construction, s)
		}
	}
	c := study()
	c.Construction = "involute"
	c.Input = "coil"
	c.Coil = CoilRequest{Radius: 0.2, Turns: 3}
	c.Involute = InvoluteRequest{Anchor: 1, Offset: 0.5}
	c.Shadow = &ShadowRequest{Plane: "z", At: -3}
	if s := shadowed(t, c).Shadow; s.Kind != "" || len(s.Cast) != 0 {
		t.Fatalf("an involute of a coil has no planar counterpart: %+v", s)
	}
}

// An anchor the shadow's arc length cannot reach leaves the 2D involute
// out, with a note, and the rest of the study is drawn.
func TestShadowInvoluteUnanchored(t *testing.T) {
	c := custom("t", "1/(t-1)", "0", 0, 3)
	c.Construction = "involute"
	c.Involute = InvoluteRequest{Anchor: 2, Offset: 0.5}
	c.Shadow = &ShadowRequest{Plane: "z", At: -1}
	s := shadowed(t, c).Shadow
	if len(s.Planar) != 0 || len(s.Notes) == 0 || len(s.Cast) != 1 {
		t.Fatalf("unanchored: %+v", s)
	}
}

// Where the study's construction is broken, its shadow is too, and the 2D
// construction is broken where its own is: a circle through the inversion
// center inverts to a line, through infinity once in the plane as in
// space, at the same interval; tangent feet keep the curve's breaks, here
// at its pole.
func TestShadowKeepsBreaks(t *testing.T) {
	c := custom("cos(t)", "sin(t)", "0.5", -math.Pi+0.3, math.Pi+0.3)
	c.Construction = "inversion"
	c.Inversion = InversionRequest{Center: Vec3{1, 0, 0.5}, Radius: 1, Input: "base"}
	c.Shadow = &ShadowRequest{Plane: "z", At: -1}
	s := shadowed(t, c).Shadow
	broken := func(b []bool) []int {
		var at []int
		for i, on := range b {
			if on {
				at = append(at, i)
			}
		}
		return at
	}
	planar, cast := broken(s.Planar[0].Breaks), broken(s.Cast[0].Breaks)
	if len(planar) != 1 || len(cast) != 1 || planar[0] != cast[0] {
		t.Fatalf("breaks in the plane %v and in space %v", planar, cast)
	}
	c = custom("t", "1/(t-1)", "0", 0, 3)
	c.Construction = "tangent-foot"
	c.Pole = Vec3{0, 0, 1}
	c.Shadow = &ShadowRequest{Plane: "z", At: -1}
	r := shadowed(t, c)
	if got := broken(r.Shadow.Cast[0].Breaks); len(got) == 0 || len(got) != len(broken(r.Breaks)) {
		t.Fatalf("cast feet broken at %v, the curve at %v", got, broken(r.Breaks))
	}
}

// Seen edge on, a nearly flat helix's shadow (at, 2 sin t) turns at each
// crest within about a of t, and each involute's free end swings round a
// semicircle there, as far from the crest as its string is long. The
// samples step across it in one chord as long as the semicircle is wide;
// refinement draws it round. The study's own refinement casts refined
// shadows too, and without it there are none.
func TestShadowRefinesTheSwings(t *testing.T) {
	c := custom("2*cos(t)", "a*t", "2*sin(t)", -math.Pi, math.Pi)
	c.Curve.A = 0.0012
	c.Samples = 1200
	c.Construction = "involute"
	c.Involute = InvoluteRequest{Anchor: 0, Family: InvoluteFamily{Enabled: true, From: -3, To: 3, Count: 7}}
	c.Shadow = &ShadowRequest{Plane: "x", At: -9.9}
	// The longest step between neighboring drawn points.
	longest := func(points []*Vec3) float64 {
		far := 0.0
		for i := 1; i < len(points); i++ {
			if points[i] != nil && points[i-1] != nil {
				far = math.Max(far, points[i].sub(*points[i-1]).norm())
			}
		}
		return far
	}
	s := shadowed(t, c).Shadow
	if s.Adaptive != nil {
		t.Fatal("refined shadows without refinement")
	}
	sampled := 0.0
	for _, p := range s.Planar {
		sampled = math.Max(sampled, longest(p.Points))
	}
	c.Adaptive = true
	r := shadowed(t, c)
	a := r.Shadow.Adaptive
	if a == nil || a.Curve == nil || len(a.Planar) != 7 || len(a.Cast) != 7 {
		t.Fatalf("refined shadows: %+v", a)
	}
	refined := 0.0
	for _, p := range a.Planar {
		refined = math.Max(refined, longest(p.Points))
		if p.Exhausted || p.Unresolved > 0 {
			t.Fatalf("refinement stopped short: %+v", p)
		}
	}
	// The longest string, 3 at the anchor, has about 5 left at a crest:
	// sampled, its semicircle is crossed in one step about 10 long.
	// Refined to 2·10⁻⁴ of its size, a chord of 0.5 would sag 0.006 on it.
	if sampled < 5 || refined > 0.5 {
		t.Fatalf("longest steps: sampled %g, refined %g", sampled, refined)
	}
	// Each refined path lies on the plane, and the cast ones are the
	// shadows of the study's own refined involutes.
	for k, p := range a.Cast {
		want := r.Adaptive.Involute[k]
		if len(p.Points) != len(want.Points) {
			t.Fatalf("cast %d has %d points, its involute %d", k, len(p.Points), len(want.Points))
		}
		for i, q := range p.Points {
			if (q == nil) != (want.Points[i] == nil) || q != nil && (q.X != -9.9 || q.Y != want.Points[i].Y || q.Z != want.Points[i].Z) {
				t.Fatalf("cast %d point %d: %v, the involute's %v", k, i, q, want.Points[i])
			}
		}
	}
	for _, p := range append(append([]*RefinedPath{a.Curve}, a.Planar...), a.Cast...) {
		for _, q := range p.Points {
			if q != nil && q.X != -9.9 {
				t.Fatalf("refined point %v off the plane", q)
			}
		}
	}
	// The window holds what is drawn on it.
	for _, p := range a.Planar {
		for _, q := range p.Points {
			if q != nil && (q.Y < r.Shadow.Corners[0].Y || q.Y > r.Shadow.Corners[2].Y || q.Z < r.Shadow.Corners[0].Z || q.Z > r.Shadow.Corners[2].Z) {
				t.Fatalf("the window leaves out %v", q)
			}
		}
	}
}

// The grid of views asks for the 2D engine's whole study of the shadow,
// for the 2D notebook's own drawing of the plane. It is the very study
// whose curve the plane draws, in units of a power of two: scaled back and
// lifted, its construction is each planar path bit for bit, an involute
// family's first string its derived curve and the rest its family, and its
// pole and inversion circle the study's projected. Each representative
// line is the construction's own: a tangent foot sees the pole square to
// the tangent through the curve's point, an orthotomic point is the pole
// reflected across that tangent, an image lies on the ray from the center,
// and a string reaches its involute's point. Without the grid, or with no
// 2D counterpart, there is no study and nothing else changes.
func TestShadowGridStudy(t *testing.T) {
	for _, tc := range []struct {
		construction, kind string
		members            int
	}{
		{"tangent-foot", "pedal", 1},
		{"orthotomic", "orthotomic", 1},
		{"inversion", "inversion", 1},
		{"involute", "involute", 1},
		{"involute", "involute", 4},
	} {
		c := custom("2*cos(t)+0.2*cos(3*t)", "sin(t)", "0.4*sin(2*t)", 0, 2*math.Pi)
		c.Samples, c.Lines = 480, 36
		c.Construction, c.Input = tc.construction, "base"
		c.Pole = Vec3{0.4, -0.3, 2.2}
		c.Involute = InvoluteRequest{Anchor: 1, Offset: 0.6}
		if tc.members > 1 {
			c.Involute.Family = InvoluteFamily{Enabled: true, From: -1, To: 2, Count: tc.members}
		}
		c.Inversion = InversionRequest{Center: Vec3{0.2, 0.1, 1.3}, Radius: 1.4, Input: "base"}
		c.Shadow = &ShadowRequest{Plane: "y", At: -2}
		name := tc.construction
		plain := shadowed(t, c).Shadow
		if plain.Study != nil {
			t.Fatalf("%s: a study without the grid", name)
		}
		c.Shadow = &ShadowRequest{Plane: "y", At: -2, Grid: true}
		s := shadowed(t, c).Shadow
		study := s.Study
		if study == nil {
			t.Fatalf("%s: no study with the grid", name)
		}
		was, _ := json.Marshal(plain)
		s.Study = nil
		now, _ := json.Marshal(s)
		s.Study = study
		if string(was) != string(now) {
			t.Fatalf("%s: the grid changed the shadow", name)
		}
		if study.Kind != tc.kind || study.Unit != binade(shadowed(t, c).Bounds.Radius) {
			t.Fatalf("%s: kind %q in units of %v", name, study.Kind, study.Unit)
		}
		q, unit, r := *c.Shadow, study.Unit, study.Result
		lift := func(p engine.Vec) Vec3 { return q.lift(p.Mul(unit)) }
		paths := append([][]*engine.Vec{r.Derived}, func() (m [][]*engine.Vec) {
			for _, f := range r.Family {
				m = append(m, f.Points)
			}
			return
		}()...)
		if len(paths) != tc.members {
			t.Fatalf("%s: %d paths for %d members", name, len(paths), tc.members)
		}
		for k, path := range paths {
			for i, p := range path {
				want := s.Planar[k].Points[i]
				if (p == nil) != (want == nil) || (p != nil && lift(*p) != *want) {
					t.Fatalf("%s: member %d point %d is %v, the plane's %v", name, k, i, p, want)
				}
			}
		}
		for i, p := range r.Base {
			if p != nil && lift(*p).sub(*s.Curve.Points[i]).norm() > 1e-12 {
				t.Fatalf("%s: base point %d off the shadow", name, i)
			}
		}
		if lift(study.Pole) != q.lift(q.flat(c.Pole)) {
			t.Fatalf("%s: pole %v", name, study.Pole)
		}
		if tc.kind == "inversion" && (lift(study.Inversion.Center) != q.lift(q.flat(c.Inversion.Center)) || study.Inversion.Radius*unit != c.Inversion.Radius) {
			t.Fatalf("%s: inversion %+v", name, study.Inversion)
		}
		if len(r.Rays) < c.Lines-1 {
			t.Fatalf("%s: %d representative lines for %d", name, len(r.Rays), c.Lines)
		}
		pole := study.Pole
		for _, ray := range r.Rays {
			if ray.Target == nil {
				continue
			}
			o, g := ray.Origin, *ray.Target
			var miss float64
			switch tc.kind {
			case "pedal":
				// The tangent through o and the foot g, square to g − pole.
				d := r.Derived[ray.SampleIndex]
				miss = g.Sub(pole).Dot(g.Sub(o))/(g.Sub(pole).Norm()*g.Sub(o).Norm()+1e-300) + (*d).Sub(g).Norm()
			case "orthotomic":
				// The foot, halfway to the image, is square to the pole.
				h := g.Add(pole).Mul(0.5)
				miss = h.Sub(pole).Dot(h.Sub(o)) / (h.Sub(pole).Norm()*h.Sub(o).Norm() + 1e-300)
			case "inversion":
				center := study.Inversion.Center
				a, b := o.Sub(center), g.Sub(center)
				miss = math.Abs(a.X*b.Y-a.Y*b.X)/(a.Norm()*b.Norm()) + math.Abs(a.Norm()*b.Norm()-study.Inversion.Radius*study.Inversion.Radius)
			case "involute":
				miss = g.Sub(*r.Derived[ray.SampleIndex]).Norm()
			}
			if math.Abs(miss) > 1e-9 {
				t.Fatalf("%s: line at sample %d misses by %v", name, ray.SampleIndex, miss)
			}
		}
	}
	c := study()
	c.Construction = "developable"
	c.Shadow = &ShadowRequest{Plane: "z", At: -3, Grid: true}
	if s := shadowed(t, c).Shadow; s.Study != nil {
		t.Fatalf("a developable has no 2D study: %+v", s.Study)
	}
}
