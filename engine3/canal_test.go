package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// canalled turns a study into the canal construction with sphere radius
// R·ρ(t), carried by a rotation-minimizing frame started from N₀ = z.
func canalled(c Request, radius float64, profile string, meridians int) Request {
	c.Construction = "canal"
	c.Canal = CanalRequest{Radius: radius, Profile: profile, Meridians: meridians}
	c.Frame = FrameRequest{Kind: "rotation-minimizing", Reference: Vec3{0, 0, 1}, Closure: "seam"}
	return c
}

func canal(t *testing.T, c Request) Result {
	t.Helper()
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Canal == nil || r.Frame == nil {
		t.Fatal("missing canal or frame result")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	return r
}

// circle is the closed circle of radius 2 in the xy-plane.
func circle() Request {
	return harmonicStudy(0, 2*math.Pi, Vec3{}, HarmonicTerm{1, Vec3{2, 0, 0}, Vec3{0, 2, 0}})
}

// row recovers the sample a mesh vertex belongs to from its phase.
func row(r Result, v Vertex) int { return int(math.Round(v.Phase * float64(len(r.Base)-1))) }

// A constant radius around a circle is the torus (√(x²+y²) − 2)² + z² = R²,
// whose normal points away from the core circle.
func TestTubeAroundCircleIsTorus(t *testing.T) {
	r := canal(t, canalled(circle(), 0.5, "1", 6))
	q := r.Canal
	if !q.Constant || !q.Closed || q.Gap != 0 || q.Imaginary != 0 || q.Collapsed != 0 || q.Folded != 0 || q.Undefined != 0 || q.Steepest != 0 || r.Omitted != 0 {
		t.Fatalf("summary %+v omitted %d", q, r.Omitted)
	}
	if len(r.Mesh) != 480*canalSegments*6 || len(q.Circles) != 24 || len(q.Meridians) != 6 || len(r.Rulings) != 0 {
		t.Fatalf("%d vertices, %d circles, %d meridians, %d rulings", len(r.Mesh), len(q.Circles), len(q.Meridians), len(r.Rulings))
	}
	torus := func(p Vec3) float64 { return math.Pow(math.Hypot(p.X, p.Y)-2, 2) + p.Z*p.Z - 0.25 }
	core := func(p Vec3) Vec3 { return Vec3{p.X, p.Y, 0}.unit().mul(2) }
	for _, v := range r.Mesh {
		if math.Abs(torus(v.Position)) > 1e-12 {
			t.Fatalf("vertex %+v off the torus", v.Position)
		}
		near(t, v.Normal, v.Position.sub(core(v.Position)).mul(2), 1e-9)
	}
	for _, m := range q.Meridians {
		for i, p := range m {
			if math.Abs(torus(*p)) > 1e-12 || math.Abs(p.sub(*r.Base[i]).dot(Vec3{-r.Base[i].Y, r.Base[i].X, 0})) > 1e-9 {
				t.Fatalf("meridian point %d %+v", i, *p)
			}
		}
	}
	for _, g := range q.Circles {
		if !g.Real || g.Sphere != 0.5 || g.Radius != 0.5 || len(g.Points) != canalSegments*2+1 {
			t.Fatalf("circle %+v", g)
		}
		near(t, g.Center, r.Base[g.SampleIndex], 1e-12)
		near(t, g.Points[0], g.Points[len(g.Points)-1], 1e-12)
		for _, p := range g.Points {
			if math.Abs(torus(p)) > 1e-12 {
				t.Fatalf("circle point %+v", p)
			}
		}
	}
}

// Around a straight line the tube is a cylinder; open, so it does not close.
func TestTubeAroundLineIsCylinder(t *testing.T) {
	r := canal(t, canalled(custom("0", "0", "t", -2, 2), 0.7, "1", 4))
	if r.Canal.Closed || !r.Canal.Constant || r.Canal.Folded != 0 {
		t.Fatalf("summary %+v", r.Canal)
	}
	for _, v := range r.Mesh {
		p := v.Position
		if math.Abs(p.X*p.X+p.Y*p.Y-0.49) > 1e-12 || math.Abs(v.Normal.Z) > 1e-12 {
			t.Fatalf("vertex %+v normal %+v", p, v.Normal)
		}
	}
}

// Every point satisfies both envelope equations, |q|² = R² and q·c′ = −RR′,
// and its normal is q/R.
func TestCanalEnvelopeEquations(t *testing.T) {
	c := canalled(custom("cos(t)", "sin(t)", "t/2", 0, 4*math.Pi), 0.3, "1+0.5*sin(3*t)", 5)
	r := canal(t, c)
	q := r.Canal
	speed := math.Sqrt(1.25)
	if q.Constant || q.Imaginary != 0 || q.Collapsed != 0 || math.Abs(q.Steepest-0.45/speed) > 1e-6 {
		t.Fatalf("summary %+v", q)
	}
	at := func(i int) float64 { return 4 * math.Pi * float64(i) / float64(c.Samples) }
	check := func(i int, p Vec3) {
		t.Helper()
		s := at(i)
		center := Vec3{math.Cos(s), math.Sin(s), s / 2}
		velocity := Vec3{-math.Sin(s), math.Cos(s), 0.5}
		radius, slope := 0.3*(1+0.5*math.Sin(3*s)), 0.45*math.Cos(3*s)
		d := p.sub(center)
		if math.Abs(d.dot(d)-radius*radius) > 1e-12 || math.Abs(d.dot(velocity)+radius*slope) > 1e-9 {
			t.Fatalf("sample %d: |q|² − R² = %g, q·c′ + RR′ = %g", i, d.dot(d)-radius*radius, d.dot(velocity)+radius*slope)
		}
	}
	for _, m := range q.Meridians {
		for i, p := range m {
			check(i, *p)
		}
	}
	for _, g := range q.Circles {
		for _, p := range g.Points {
			check(g.SampleIndex, p)
		}
	}
	for _, v := range r.Mesh {
		i := row(r, v)
		check(i, v.Position)
		radius := 0.3 * (1 + 0.5*math.Sin(3*at(i)))
		near(t, v.Normal, v.Position.sub(*r.Base[i]).mul(1/radius), 1e-9)
	}
}

// The tangents of the sampled surface, by central differences along each
// meridian, become orthogonal to the sphere's radius q at second order: the
// sphere normal is the surface normal.
func TestCanalNormalConvergence(t *testing.T) {
	deviation := func(samples int) float64 {
		c := canalled(custom("cos(t)", "sin(t)", "t/2", 0, 4*math.Pi), 0.3, "1+0.5*sin(3*t)", 5)
		c.Samples = samples
		r := canal(t, c)
		worst := 0.0
		for _, m := range r.Canal.Meridians {
			for i := 1; i < samples; i++ {
				along := m[i+1].sub(*m[i-1])
				radial := m[i].sub(*r.Base[i]).unit()
				worst = math.Max(worst, math.Abs(radial.dot(along))/along.norm())
			}
		}
		return worst
	}
	a, b, d := deviation(240), deviation(480), deviation(960)
	if !(b < a/3.5 && d < b/3.5 && d < 3e-4) {
		t.Fatalf("deviations %g, %g, %g", a, b, d)
	}
}

// Along a unit-speed line with R = t/2, each circle sits at 3t/4 with radius
// (√3/4)t: a cone of half-angle 30°. With R = t every circle collapses to
// the apex.
func TestCanalConeAndCollapse(t *testing.T) {
	r := canal(t, canalled(custom("0", "0", "t", 0.5, 3), 1, "t/2", 4))
	if r.Canal.Collapsed != 0 || math.Abs(r.Canal.Steepest-0.5) > 1e-9 {
		t.Fatalf("summary %+v", r.Canal)
	}
	for _, v := range r.Mesh {
		p := v.Position
		if math.Abs(3*(p.X*p.X+p.Y*p.Y)-p.Z*p.Z) > 1e-9 {
			t.Fatalf("vertex %+v off the cone", p)
		}
	}
	for _, g := range r.Canal.Circles {
		s := r.Base[g.SampleIndex].Z
		near(t, g.Center, Vec3{0, 0, 0.75 * s}, 1e-9)
		if math.Abs(g.Radius-math.Sqrt(3)/4*s) > 1e-9 {
			t.Fatalf("circle %+v", g)
		}
	}
	r = canal(t, canalled(custom("0", "0", "t", 0.5, 3), 1, "t", 4))
	if r.Canal.Collapsed != 481 || r.Canal.Imaginary != 0 {
		t.Fatalf("summary %+v", r.Canal)
	}
	for _, m := range r.Canal.Meridians {
		for _, p := range m {
			near(t, p, Vec3{}, 1e-9)
		}
	}
	for _, g := range r.Canal.Circles {
		if !g.Real || g.Radius != 0 {
			t.Fatalf("circle %+v", g)
		}
	}
}

// Where the radius changes faster than the centre moves, |R′| > v, the
// spheres have no real envelope: those samples have no circle, and the
// surface is not joined across them.
func TestNoRealEnvelope(t *testing.T) {
	c := canalled(custom("0", "0", "t", -3, 3), 1, "1+0.8*sin(2*t)", 3)
	r := canal(t, c)
	q := r.Canal
	missing := 0
	for i := 0; i <= c.Samples; i++ {
		s := -3 + 6*float64(i)/float64(c.Samples)
		imaginary := math.Abs(1.6*math.Cos(2*s)) > 1
		if imaginary {
			missing++
			if q.Meridians[0][i] != nil || (i > 0 && !q.Breaks[i]) || (i < c.Samples && !q.Breaks[i+1]) {
				t.Fatalf("sample %d not left out", i)
			}
		} else if q.Meridians[0][i] == nil {
			t.Fatalf("sample %d left out", i)
		}
	}
	if missing < 100 || q.Imaginary != missing || q.Between != 0 || math.Abs(q.Steepest-1.6) > 1e-6 {
		t.Fatalf("imaginary %d, want %d; steepest %g", q.Imaginary, missing, q.Steepest)
	}
	unreal := 0
	for _, g := range q.Circles {
		if !g.Real {
			unreal++
			if len(g.Points) != 0 || g.Radius != 0 || g.Sphere <= 0 {
				t.Fatalf("circle %+v", g)
			}
		}
	}
	if unreal == 0 {
		t.Fatal("no representative sphere without a circle")
	}
	for _, v := range r.Mesh {
		if q.Meridians[0][row(r, v)] == nil {
			t.Fatalf("vertex on a missing circle %+v", v)
		}
	}
}

// |R′| exceeds v only between two samples: the midpoint check breaks that
// interval although both of its circles are real.
func TestEnvelopeVanishesBetweenSamples(t *testing.T) {
	// Samples t = (i − 239.5)h, so t = 0 is the midpoint of interval 239.
	h := 6.0 / 480
	c := canalled(custom("0", "0", "t", -239.5*h, 240.5*h), 1, "3+1.00001*sin(t)", 3)
	r := canal(t, c)
	q := r.Canal
	if q.Imaginary != 0 || q.Collapsed != 0 || q.Steepest > 1 {
		t.Fatalf("imaginary %d, collapsed %d, steepest %v", q.Imaginary, q.Collapsed, q.Steepest)
	}
	for i, broken := range q.Breaks {
		if broken != (i == 240) {
			t.Fatalf("break %d is %v", i, broken)
		}
	}
	if r.Omitted != 1 || q.Between != 1 {
		t.Fatalf("omitted %d, between %d", r.Omitted, q.Between)
	}
}

// A helix of radius 1 and pitch 1/2 has curvature 0.8. A tube narrower than
// the radius of curvature 1.25 is regular; a wider one folds through itself,
// and is drawn so.
func TestTubeFoldsBeyondRadiusOfCurvature(t *testing.T) {
	helix := custom("cos(t)", "sin(t)", "t/2", 0, 4*math.Pi)
	if r := canal(t, canalled(helix, 1.2, "1", 0)); r.Canal.Folded != 0 {
		t.Fatalf("folded %d", r.Canal.Folded)
	}
	r := canal(t, canalled(helix, 1.3, "1", 0))
	if r.Canal.Folded != 481 || r.Omitted != 0 || len(r.Mesh) != 480*canalSegments*6 {
		t.Fatalf("folded %d, omitted %d", r.Canal.Folded, r.Omitted)
	}
}

// A periodic profile closes the surface; a drifting one leaves a gap. The
// meridians show the frame's seam, but the mesh always closes.
func TestCanalClosureAndSeam(t *testing.T) {
	if r := canal(t, canalled(circle(), 0.4, "1+0.3*sin(t)", 4)); !r.Canal.Closed || r.Canal.Gap != 0 || r.Canal.Constant {
		t.Fatalf("summary %+v", r.Canal)
	}
	// Coaxial contact circles: the axial offset −RR′/v and the radius both
	// change between the ends.
	r := canal(t, canalled(circle(), 0.4, "1+0.1*t", 4))
	start, end := 0.4, 0.4*(1+0.2*math.Pi)
	offset := func(R float64) float64 { return R * 0.04 / 2 }
	radius := func(R float64) float64 { return R * math.Sqrt(1-0.02*0.02) }
	if gap := math.Hypot(offset(end)-offset(start), radius(end)-radius(start)); r.Canal.Closed || math.Abs(r.Canal.Gap-gap) > 1e-9 {
		t.Fatalf("summary %+v", r.Canal)
	}
	knot := canalled(study(), 0.3, "1", 4)
	r = canal(t, knot)
	if !r.Canal.Closed || r.Frame.Kind != "rotation-minimizing" || math.Abs(r.Frame.Holonomy) < 0.01 || r.Frame.Seam == nil {
		t.Fatalf("frame %+v", r.Frame)
	}
	n := knot.Samples
	first, last := []Vec3{}, []Vec3{}
	for _, v := range r.Mesh {
		switch row(r, v) {
		case 0:
			first = append(first, v.Position)
		case n:
			last = append(last, v.Position)
		}
	}
	if len(first) == 0 || len(first) != len(last) {
		t.Fatalf("%d first, %d last", len(first), len(last))
	}
	for _, p := range last {
		closest := math.Inf(1)
		for _, s := range first {
			closest = math.Min(closest, p.sub(s).norm())
		}
		if closest > 1e-9 {
			t.Fatalf("last ring point %+v is %g from the first ring", p, closest)
		}
	}
	knot.Frame.Closure = "distribute"
	if r := canal(t, knot); r.Frame.Seam != nil || r.Frame.Correction == 0 {
		t.Fatalf("frame %+v", r.Frame)
	}
	// A Frenet frame is never used for the tube's angle.
	knot.Frame.Kind = "frenet"
	if r := canal(t, knot); r.Frame.Kind != "rotation-minimizing" {
		t.Fatalf("frame %s", r.Frame.Kind)
	}
}

// A stationary centre has no contact circle, and a nonpositive radius no
// sphere: both are gaps.
func TestCanalGaps(t *testing.T) {
	r := canal(t, canalled(custom("t^3", "t", "0", -1, 1), 0.2, "1", 2))
	if r.Canal.Undefined != 0 || r.Omitted != 0 {
		t.Fatalf("summary %+v omitted %d", r.Canal, r.Omitted)
	}
	r = canal(t, canalled(custom("t^3", "0", "0", -1, 1), 0.2, "1", 2))
	if r.Invalid != 1 || r.Canal.Meridians[0][240] != nil || !r.Canal.Breaks[240] || !r.Canal.Breaks[241] || r.Omitted != 2 {
		t.Fatalf("invalid %d, omitted %d", r.Invalid, r.Omitted)
	}
	r = canal(t, canalled(custom("0", "0", "t", -1, 1), 0.5, "t", 2))
	if r.Canal.Undefined != 241 || r.Canal.Meridians[0][240] != nil || r.Canal.Meridians[0][241] == nil {
		t.Fatalf("undefined %d", r.Canal.Undefined)
	}
	r = canal(t, canalled(custom("0", "0", "t", -1, 1), 0.5, "sqrt(t)", 2))
	if r.Canal.Undefined != 241 {
		t.Fatalf("undefined %d", r.Canal.Undefined)
	}
}

// At the largest sample count, the mesh is drawn on fewer rings, but always
// on the ring beside a gap, so the surface reaches it.
func TestCanalMeshRingsReachGaps(t *testing.T) {
	c := canalled(custom("0", "0", "t", -3, 3), 1, "1+0.8*sin(2*t)", 0)
	c.Samples = 2400
	r := canal(t, c)
	rows := map[int]bool{}
	for _, v := range r.Mesh {
		rows[row(r, v)] = true
	}
	if len(rows) > canalRings+60 {
		t.Fatalf("%d rings", len(rows))
	}
	edges := 0
	c.Canal.Meridians = 1
	r = canal(t, c)
	m := r.Canal.Meridians[0]
	rows = map[int]bool{}
	for _, v := range r.Mesh {
		rows[row(r, v)] = true
	}
	for i := 0; i < c.Samples; i++ {
		if (m[i] == nil) != (m[i+1] == nil) {
			edges++
			side := i
			if m[i] == nil {
				side = i + 1
			}
			if !rows[side] {
				t.Fatalf("ring %d beside a gap is not drawn", side)
			}
		}
	}
	if edges < 4 {
		t.Fatalf("%d gap edges", edges)
	}
}

func TestCanalRigidMotionAndReparameterization(t *testing.T) {
	c := canalled(custom("2*cos(t)", "2*sin(t)", "t/2", 0, 4*math.Pi), 0.4, "1+0.3*cos(t)", 3)
	c.Frame.Reference, c.Frame.Twist = Vec3{0.3, -1, 0.2}, 1.5
	r := canal(t, c)
	turned := canalled(custom("t/2", "2*cos(t)", "2*sin(t)", 0, 4*math.Pi), 0.4, "1+0.3*cos(t)", 3)
	turned.Frame.Reference, turned.Frame.Twist = Vec3{0.2, 0.3, -1}, 1.5
	m := canal(t, turned)
	rotate := func(v Vec3) Vec3 { return Vec3{v.Z, v.X, v.Y} }
	faster := canalled(custom("2*cos(2*t)", "2*sin(2*t)", "t", 0, 2*math.Pi), 0.4, "1+0.3*cos(2*t)", 3)
	faster.Frame.Reference, faster.Frame.Twist = Vec3{0.3, -1, 0.2}, 1.5
	f := canal(t, faster)
	for k := range r.Canal.Meridians {
		for i, p := range r.Canal.Meridians[k] {
			near(t, m.Canal.Meridians[k][i], rotate(*p), 1e-9)
			near(t, f.Canal.Meridians[k][i], p, 1e-8)
		}
	}
	for k, g := range r.Canal.Circles {
		near(t, m.Canal.Circles[k].Center, rotate(g.Center), 1e-9)
		near(t, f.Canal.Circles[k].Center, g.Center, 1e-8)
		if math.Abs(f.Canal.Circles[k].Radius-g.Radius) > 1e-8 {
			t.Fatalf("circle %d radius %g vs %g", k, f.Canal.Circles[k].Radius, g.Radius)
		}
	}
	if len(m.Mesh) != len(r.Mesh) {
		t.Fatalf("%d vs %d vertices", len(m.Mesh), len(r.Mesh))
	}
	for i := range r.Mesh {
		near(t, m.Mesh[i].Position, rotate(r.Mesh[i].Position), 1e-9)
	}
}

func TestCanalBoundsHoldTube(t *testing.T) {
	r := canal(t, canalled(custom("cos(t)", "sin(t)", "0", 0, 2*math.Pi), 30, "1", 0))
	if r.Bounds.Radius < 30 {
		t.Fatalf("bounds %+v", r.Bounds)
	}
}

func TestCanalValidation(t *testing.T) {
	good := canalled(circle(), 0.5, "1", 4)
	for _, tc := range []struct {
		edit func(*Request)
		want string
	}{
		{func(c *Request) { c.Canal.Radius = math.NaN() }, "the radius R must be finite, above 0, and at most 100000"},
		{func(c *Request) { c.Canal.Radius = 0 }, "the radius R must be finite, above 0, and at most 100000"},
		{func(c *Request) { c.Canal.Radius = 2e5 }, "the radius R must be finite, above 0, and at most 100000"},
		{func(c *Request) { c.Canal.Meridians = 13 }, "use 0–12 meridians"},
		{func(c *Request) { c.Canal.Meridians = -1 }, "use 0–12 meridians"},
		{func(c *Request) { c.Canal.Profile = "sin(" }, "ρ(t):"},
		{func(c *Request) { c.Canal.Profile = "a*t" }, "ρ(t):"},
		{func(c *Request) { c.Canal.Profile = "-1" }, "the sphere radius R·ρ(t) is never positive"},
		{func(c *Request) { c.Frame.Closure = "trim" }, "closure must show the seam or distribute the correction"},
		{func(c *Request) { c.Frame.Reference = Vec3{} }, "the reference normal N₀ must be nonzero"},
		{func(c *Request) { c.Frame.Twist = 101 }, "twist must be finite and within ±100 turns"},
	} {
		c := good
		tc.edit(&c)
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("want %q, got %v", tc.want, err)
		}
	}
	// The ribbon's own fields do not apply to a canal surface.
	c := good
	c.Frame.Width, c.Frame.Offset, c.Frame.Strands = -1, -1, 99
	if r := canal(t, c); len(r.Frame.Strands) != 0 || len(r.Minus) != 0 || len(r.Plus) != 0 {
		t.Fatalf("ribbon drawn: %d strands", len(r.Frame.Strands))
	}
}
