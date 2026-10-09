package engine3

import (
	"math"
	"strings"
	"testing"
)

func fieldRequest(x, y, z string, seeds []Vec3, lo, hi float64) Request {
	return Request{
		Format: "field", Construction: "none",
		Field:   FieldRequest{X: x, Y: y, Z: z, Seeds: seeds, Escape: 100, Min: lo, Max: hi, A: .5},
		Samples: 480, Lines: 24, Length: 1,
	}
}

func flowed(t *testing.T, c Request) Result {
	t.Helper()
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if out.Field == nil {
		t.Fatal("no field result")
	}
	return out
}

func sampleTime(c Request, i int) float64 {
	n := float64(c.Samples)
	return c.Field.Min*(1-float64(i)/n) + c.Field.Max*float64(i)/n
}

// seedRing gives k seeds on the circle of the given radius at height z.
func seedRing(k int, radius, z float64) []Vec3 {
	out := make([]Vec3, k)
	for j := range out {
		phi := 2 * math.Pi * float64(j) / float64(k)
		out[j] = Vec3{radius * math.Cos(phi), radius * math.Sin(phi), z}
	}
	return out
}

// The rising vortex V = (−y, x, a) turns each seed into a helix,
// (ρ cos(φ + t), ρ sin(φ + t), z₀ + a t), every one at the same times.
func TestRisingVortexHelices(t *testing.T) {
	c := fieldRequest("-y", "x", "a", append(seedRing(3, 1, 0), Vec3{.5, 0, 1}), 0, 4*math.Pi)
	out := flowed(t, c)
	q := out.Field
	if len(q.Paths) != 4 || q.Timed {
		t.Fatalf("%d paths, timed %v", len(q.Paths), q.Timed)
	}
	for k, seed := range c.Field.Seeds {
		rho, phi := math.Hypot(seed.X, seed.Y), math.Atan2(seed.Y, seed.X)
		if len(q.Paths[k]) != c.Samples+1 {
			t.Fatalf("path %d has %d samples", k, len(q.Paths[k]))
		}
		for i, p := range q.Paths[k] {
			u := sampleTime(c, i)
			want := Vec3{rho * math.Cos(phi+u), rho * math.Sin(phi+u), seed.Z + .5*u}
			if p == nil || p.sub(want).norm() > 1e-8 {
				t.Fatalf("seed %d, t=%v: %v, want %v", k+1, u, p, want)
			}
		}
		if e := q.Ends[k]; e.Reason != "end" || e.Time != 4*math.Pi || e.Point == nil || e.Point.sub(*q.Paths[k][c.Samples]).norm() > 1e-12 || e.Steps < 1 {
			t.Fatalf("seed %d ended %+v", k+1, e)
		}
		if q.Resting[k] {
			t.Fatalf("seed %d rests", k+1)
		}
	}
	// Seed 1 is the base, exactly.
	for i, p := range out.Base {
		if p == nil || *p != *q.Paths[0][i] {
			t.Fatalf("base %d: %v vs %v", i, p, q.Paths[0][i])
		}
	}
	// Curve alone: no construction geometry, and the fit spans every path.
	if len(corners(out.Mesh)) != 0 || len(out.Rulings) != 0 || len(out.Minus) != 0 || len(out.Plus) != 0 {
		t.Fatal("the curve alone drew a construction")
	}
	for _, path := range q.Paths {
		for _, p := range path {
			if p.sub(out.Bounds.Center).norm() > out.Bounds.Radius*(1+1e-12) {
				t.Fatalf("%v outside %+v", p, out.Bounds)
			}
		}
	}
	// Field arrows at the representative samples of every trajectory.
	if len(q.Arrows) != c.Lines*len(c.Field.Seeds) {
		t.Fatalf("%d arrows", len(q.Arrows))
	}
	for _, a := range q.Arrows {
		if a.SampleIndex%(c.Samples/(c.Lines-1)) != 0 && a.SampleIndex != c.Samples {
			// Representative indices are i·n/(lines − 1).
			found := false
			for line := 0; line < c.Lines; line++ {
				found = found || line*c.Samples/(c.Lines-1) == a.SampleIndex
			}
			if !found {
				t.Fatalf("arrow at sample %d", a.SampleIndex)
			}
		}
		p := *q.Paths[a.Seed][a.SampleIndex]
		if a.Point != p || a.Velocity.sub(Vec3{-p.Y, p.X, .5}).norm() > 1e-15 {
			t.Fatalf("arrow %+v at %v", a, p)
		}
	}
}

// The base's derivatives come from the field, not from the drawn polyline:
// r′ = V and r″ = (∂V/∂r)V + ∂V/∂t.
func TestFieldDerivatives(t *testing.T) {
	for _, tc := range []struct {
		x, y, z string
		seed    Vec3
		exact   func(u float64) (Vec3, Vec3, Vec3)
	}{
		{"-y", "x", "a", Vec3{2, 0, 0}, func(u float64) (Vec3, Vec3, Vec3) {
			c, s := math.Cos(u), math.Sin(u)
			return Vec3{2 * c, 2 * s, .5 * u}, Vec3{-2 * s, 2 * c, .5}, Vec3{-2 * c, -2 * s, 0}
		}},
		// A timed field: r = (sin t, 1 − cos t, t) from the origin.
		{"cos(t)", "sin(t)", "1", Vec3{}, func(u float64) (Vec3, Vec3, Vec3) {
			c, s := math.Cos(u), math.Sin(u)
			return Vec3{s, 1 - c, u}, Vec3{c, s, 1}, Vec3{-s, c, 0}
		}},
	} {
		c := fieldRequest(tc.x, tc.y, tc.z, []Vec3{tc.seed}, 0, 6)
		f, _, err := c.Field.system()
		if err != nil {
			t.Fatal(err)
		}
		flows := c.Field.integrate(f)
		evaluate := flows[0].evaluation(f, 6)
		for _, u := range []float64{0, .3, 1, 2.5, 5.99, 6} {
			r, v, a, ok := evaluate(u)
			wr, wv, wa := tc.exact(u)
			if !ok || r.sub(wr).norm() > 1e-8 || v.sub(wv).norm() > 1e-8 || a.sub(wa).norm() > 1e-6 {
				t.Fatalf("%s at %v: %v %v %v, want %v %v %v", tc.x, u, r, v, a, wr, wv, wa)
			}
		}
		if _, _, _, ok := evaluate(6.5); ok {
			t.Fatal("evaluated past the interval")
		}
	}
	// A timed field is reported.
	if q := flowed(t, fieldRequest("cos(t)", "sin(t)", "1", []Vec3{{}}, 0, 6)).Field; !q.Timed {
		t.Fatal("timed field not reported")
	}
}

func TestFieldTrajectoryConstructions(t *testing.T) {
	c := fieldRequest("-y", "x", "a", seedRing(2, 1, 0), 0, 4*math.Pi)
	// A helix's tangent developable, tube and ribbon all run on seed 1.
	for _, construction := range []string{"developable", "involute", "tangent-foot", "orthotomic", "inversion", "framed", "ruled", "canal"} {
		q := c
		q.Construction = construction
		q.Inversion = InversionRequest{Radius: 2, Input: "base"}
		q.Frame = FrameRequest{Kind: "rotation-minimizing", Reference: Vec3{0, 0, 1}, Width: .2, Offset: .3, Strands: 1, Closure: "seam"}
		q.Ruled = RuledRequest{Partner: "chord", Rate: 1, Shift: 1}
		q.Canal = CanalRequest{Radius: .2, Profile: "1", Meridians: 2}
		q.Involute = InvoluteRequest{Anchor: 0, Offset: 1}
		q.Pole = Vec3{0, 0, 5}
		out, err := Compute(q)
		if err != nil {
			t.Fatalf("%s: %v", construction, err)
		}
		if out.Field == nil || len(out.Field.Paths) != 2 {
			t.Fatalf("%s: no field result", construction)
		}
		if out.Invalid != 0 {
			t.Fatalf("%s: %d invalid samples", construction, out.Invalid)
		}
	}
	// The developable's rulings follow the helix's exact unit tangent, and
	// its sheet normal is the helix's binormal.
	c.Construction = "developable"
	out := flowed(t, c)
	if len(corners(out.Mesh)) == 0 || out.Omitted != 0 {
		t.Fatalf("mesh %d, omitted %d", len(corners(out.Mesh)), out.Omitted)
	}
	for _, r := range out.Rulings {
		u := sampleTime(c, r.SampleIndex)
		want := Vec3{-math.Sin(u), math.Cos(u), .5}.unit()
		if got := r.To.sub(r.From).unit(); got.sub(want).norm() > 1e-9 {
			t.Fatalf("t=%v: tangent %v, want %v", u, got, want)
		}
	}
	for _, v := range corners(out.Mesh) {
		u := sampleTime(c, v.SampleIndex)
		b := Vec3{.5 * math.Sin(u), -.5 * math.Cos(u), 1}.unit()
		if math.Abs(math.Abs(v.Normal.dot(b))-1) > 1e-6 {
			// Vertices carry the normal of either end of their interval.
			b2 := Vec3{.5 * math.Sin(u-4*math.Pi/480), -.5 * math.Cos(u-4*math.Pi/480), 1}.unit()
			if math.Abs(math.Abs(v.Normal.dot(b2))-1) > 1e-6 {
				t.Fatalf("t=%v: normal %v", u, v.Normal)
			}
		}
	}
}

// A constant field gives straight lines with no normal, and a linear field
// with growth leaves the escape sphere at a located time.
func TestFieldEvents(t *testing.T) {
	c := fieldRequest("1", "2", "-1", []Vec3{{0, 0, 0}, {1, 1, 1}}, -1, 2)
	q := flowed(t, c).Field
	for k, seed := range c.Field.Seeds {
		for i, p := range q.Paths[k] {
			u := sampleTime(c, i) + 1
			if want := seed.add(Vec3{1, 2, -1}.mul(u)); p.sub(want).norm() > 1e-12 {
				t.Fatalf("%v, want %v", p, want)
			}
		}
	}
	// Radial growth r = seed·eᵗ leaves |r| = 10 at t = ln(10/|seed|).
	c = fieldRequest("x", "y", "z", []Vec3{{1, 0, 0}, {0, 2, 2}, {20, 0, 0}}, 0, 5)
	c.Field.Escape = 10
	out := flowed(t, c)
	q = out.Field
	for k, seed := range c.Field.Seeds[:2] {
		e := q.Ends[k]
		want := math.Log(10 / seed.norm())
		if e.Reason != "escape" || math.Abs(e.Time-want) > 1e-9 || e.Point == nil || math.Abs(e.Point.norm()-10) > 1e-8 {
			t.Fatalf("seed %d: %+v, want escape at %v", k+1, e, want)
		}
		for i, p := range q.Paths[k] {
			if u := sampleTime(c, i); (p != nil) != (u <= e.Time) {
				t.Fatalf("seed %d at t=%v (end %v): %v", k+1, u, e.Time, p)
			}
		}
	}
	// A seed outside the sphere escapes before it starts.
	if e := q.Ends[2]; e.Reason != "escape" || e.Time != 0 || e.Point != nil || e.Steps != 0 {
		t.Fatalf("outside seed: %+v", e)
	}
	for _, p := range q.Paths[2] {
		if p != nil {
			t.Fatal("an outside seed has a path")
		}
	}
	// ẋ = 1/(1 − x) from 0 reaches x = 1 with infinite speed at t = 1/2.
	c = fieldRequest("1/(1-x)", "0", "1", []Vec3{{0, 0, 0}}, 0, 1)
	c.Field.Escape = 1e5
	q = flowed(t, c).Field
	if e := q.Ends[0]; e.Reason != "singular" || math.Abs(e.Time-.5) > 1e-6 || e.Point == nil {
		t.Fatalf("finite-time blow-up: %+v", e)
	}
	// A field that is not finite at the seed stops there.
	c = fieldRequest("sqrt(x)", "1", "0", []Vec3{{-1, 0, 0}, {1, 0, 0}}, 0, 1)
	q = flowed(t, c).Field
	if e := q.Ends[0]; e.Reason != "singular" || e.Time != 0 {
		t.Fatalf("nonfinite seed: %+v", e)
	}
	if e := q.Ends[1]; e.Reason != "end" {
		t.Fatalf("finite seed: %+v", e)
	}
	// A spent step budget is its own event.
	defer func(n int) { maxFieldSteps = n }(maxFieldSteps)
	maxFieldSteps = 5
	c = fieldRequest("-y", "x", "a", []Vec3{{1, 0, 0}}, 0, 40*math.Pi)
	q = flowed(t, c).Field
	if e := q.Ends[0]; e.Reason != "exhausted" || e.Time <= 0 || e.Time >= 40*math.Pi || e.Point == nil {
		t.Fatalf("exhausted: %+v", e)
	}
}

// Lorenz with σ = 10, ρ = a = 28, β = 8/3 has equilibria at the origin and
// C± = (±√(β(ρ−1)), ±√(β(ρ−1)), ρ−1).
const lorenzX, lorenzY, lorenzZ = "10*(y-x)", "x*(a-z)-y", "x*y-8/3*z"

func TestLorenzConventions(t *testing.T) {
	w := math.Sqrt(8.0 / 3 * 27)
	c := fieldRequest(lorenzX, lorenzY, lorenzZ, []Vec3{{1, 1, 20}, {0, 0, 0}, {w, w, 27}, {-w, -w, 27}}, 0, 40)
	c.Field.A = 28
	c.Samples = 2400
	out := flowed(t, c)
	q := out.Field
	f, timed, _ := c.Field.system()
	if timed {
		t.Fatal("Lorenz reads t")
	}
	for k, seed := range c.Field.Seeds[1:] {
		if v := f(seed, 0); v.norm() > 1e-12 {
			t.Fatalf("equilibrium %v has speed %v", seed, v)
		}
		if !q.Resting[k+1] {
			t.Fatalf("equilibrium %d not reported", k+2)
		}
	}
	if q.Resting[0] {
		t.Fatal("a moving seed reported at rest")
	}
	// The trajectory stays on the attractor's familiar box and keeps
	// switching lobes; this is aggregate, not bit-for-bit, behaviour.
	crossings, last := 0, 0.0
	for i, p := range q.Paths[0] {
		if p == nil || math.Abs(p.X) > 25 || math.Abs(p.Y) > 35 || p.Z < 0 || p.Z > 55 {
			t.Fatalf("sample %d: %v", i, p)
		}
		if sampleTime(c, i) > 5 && p.X*last < 0 {
			crossings++
		}
		last = p.X
	}
	if crossings < 10 {
		t.Fatalf("%d lobe switches", crossings)
	}
	// Deterministic within a build.
	again := flowed(t, c)
	for i, p := range q.Paths[0] {
		if *p != *again.Field.Paths[0][i] {
			t.Fatalf("sample %d differs between runs", i)
		}
	}
}

// Rössler with a = b = 0.2, c = 5.7 has an equilibrium at x = (c −
// √(c² − 4ab))/2, y = −x/a, z = x/a.
func TestRosslerConventions(t *testing.T) {
	a, b, cc := .2, .2, 5.7
	x := (cc - math.Sqrt(cc*cc-4*a*b)) / 2
	c := fieldRequest("-y-z", "x+a*y", "0.2+z*(x-5.7)", []Vec3{{1, 1, 0}, {x, -x / a, x / a}}, 0, 300)
	c.Field.A = a
	c.Samples = 2400
	q := flowed(t, c).Field
	f, _, _ := c.Field.system()
	if v := f(c.Field.Seeds[1], 0); v.norm() > 1e-12 || !q.Resting[1] {
		t.Fatalf("equilibrium speed %v, resting %v", v.norm(), q.Resting[1])
	}
	crossings, spikes, last, high := 0, 0, 0.0, false
	for i, p := range q.Paths[0] {
		if p == nil || math.Abs(p.X) > 15 || math.Abs(p.Y) > 15 || p.Z < -.1 || p.Z > 30 {
			t.Fatalf("sample %d: %v", i, p)
		}
		if p.X*last < 0 {
			crossings++
		}
		if p.Z > 5 && !high {
			spikes++
		}
		last, high = p.X, p.Z > 5
	}
	if crossings < 60 || spikes < 20 {
		t.Fatalf("%d crossings, %d spikes", crossings, spikes)
	}
}

// Tightening the tolerance tightens the helix, at the cost of more steps.
func TestFieldToleranceRefinement(t *testing.T) {
	defer func(v float64) { fieldTolerance = v }(fieldTolerance)
	c := fieldRequest("-y", "x", "a", []Vec3{{1, 0, 0}}, 0, 20*math.Pi)
	var errs []float64
	var steps []int
	for _, tol := range []float64{1e-5, 1e-7, 1e-9, 1e-11} {
		fieldTolerance = tol
		q := flowed(t, c).Field
		worst := 0.0
		for i, p := range q.Paths[0] {
			u := sampleTime(c, i)
			worst = math.Max(worst, p.sub(Vec3{math.Cos(u), math.Sin(u), .5 * u}).norm())
		}
		errs, steps = append(errs, worst), append(steps, q.Ends[0].Steps)
	}
	for i := 1; i < len(errs); i++ {
		if errs[i] >= errs[i-1] || steps[i] <= steps[i-1] {
			t.Fatalf("errors %v, steps %v", errs, steps)
		}
	}
	if errs[len(errs)-1] > 1e-8 {
		t.Fatalf("errors %v", errs)
	}
}

// A translated field and seed give the translated trajectory.
func TestFieldTranslation(t *testing.T) {
	d := Vec3{5, -3, 2}
	c := fieldRequest("-y", "x", "a", []Vec3{{1, 0, 0}}, 0, 10)
	moved := fieldRequest("-(y+3)", "x-5", "a", []Vec3{d.add(Vec3{1, 0, 0})}, 0, 10)
	p, q := flowed(t, c).Field, flowed(t, moved).Field
	for i := range p.Paths[0] {
		if q.Paths[0][i].sub(p.Paths[0][i].add(d)).norm() > 1e-8 {
			t.Fatalf("sample %d: %v vs %v", i, q.Paths[0][i], p.Paths[0][i])
		}
	}
}

// A seed at rest has no tangent: alone it is still drawn, but a
// construction on it has nothing to build on.
func TestRestingBaseSeed(t *testing.T) {
	c := fieldRequest("-y", "x", "0", []Vec3{{0, 0, 1}, {1, 0, 0}}, 0, 6)
	out := flowed(t, c)
	if !out.Field.Resting[0] || out.Field.Resting[1] || out.Invalid != c.Samples+1 {
		t.Fatalf("resting %v, invalid %d", out.Field.Resting, out.Invalid)
	}
	for _, p := range out.Field.Paths[0] {
		if p == nil || *p != (Vec3{0, 0, 1}) {
			t.Fatalf("resting path %v", p)
		}
	}
	// A timed field is not at rest just because it vanishes at the start.
	if q := flowed(t, fieldRequest("t", "0", "0", []Vec3{{0, 0, 0}, {1, 0, 0}}, 0, 1)).Field; q.Resting[0] {
		t.Fatal("a timed field reported at rest")
	}
	c.Construction = "developable"
	if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "trajectory 1") {
		t.Fatalf("construction on a resting seed: %v", err)
	}
	c.Construction = "none"
	c.Field.Seeds = c.Field.Seeds[:1]
	if _, err := Compute(c); err == nil {
		t.Fatal("no moving trajectory was accepted")
	}
}

func TestFieldValidation(t *testing.T) {
	good := fieldRequest("-y", "x", "a", []Vec3{{1, 0, 0}}, 0, 6)
	many := make([]Vec3, 13)
	for i := range many {
		many[i] = Vec3{float64(i), 0, 0}
	}
	for _, tc := range []struct {
		name, want string
		change     func(*Request)
	}{
		{"no seeds", "1–12 seeds", func(c *Request) { c.Field.Seeds = nil }},
		{"many seeds", "1–12 seeds", func(c *Request) { c.Field.Seeds = many }},
		{"nonfinite seed", "seed 2", func(c *Request) { c.Field.Seeds = []Vec3{{}, {math.NaN(), 0, 0}} }},
		{"distant seed", "seed 1", func(c *Request) { c.Field.Seeds = []Vec3{{0, 2e5, 0}} }},
		{"escape", "escape radius", func(c *Request) { c.Field.Escape = 0 }},
		{"huge escape", "escape radius", func(c *Request) { c.Field.Escape = 2e5 }},
		{"nonfinite escape", "escape radius", func(c *Request) { c.Field.Escape = math.Inf(1) }},
		{"domain", "domain", func(c *Request) { c.Field.Max = c.Field.Min }},
		{"x", "dx/dt", func(c *Request) { c.Field.X = "w" }},
		{"y", "dy/dt", func(c *Request) { c.Field.Y = "(" }},
		{"z", "dz/dt", func(c *Request) { c.Field.Z = "" }},
		{"a", "shape parameter", func(c *Request) { c.Field.A = math.NaN() }},
		{"construction", "unknown spatial construction", func(c *Request) { c.Construction = "flow" }},
	} {
		c := good
		c.Field.Seeds = append([]Vec3{}, good.Field.Seeds...)
		tc.change(&c)
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v", tc.name, err)
		}
	}
	// Other definitions carry no field result, even under "none".
	c := Request{Format: "torus", Construction: "none", Radius: 2, Tube: .5, P: 2, Q: 3, Samples: 240, Lines: 12}
	out, err := Compute(c)
	if err != nil || out.Field != nil || len(corners(out.Mesh)) != 0 || len(out.Rulings) != 0 {
		t.Fatalf("torus alone: %v %+v", err, out.Field)
	}
}
