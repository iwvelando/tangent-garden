package engine3

import (
	"encoding/json"
	"math"
	"testing"
)

// Framing by refined points: with AdaptiveFrame, each refined curve reports
// its reach, the points between samples that lie outside the box of their
// interval's two samples, refined to the study's own tolerance whatever the
// view, and the bounds take it in within each family's fence.
// Expectations come from closed forms and from the refined points, measured
// here independently of the engine.

// The unit circle with a bump of height 1 in z, 0.004 wide in t, centered
// 0.3 of a step past sample 100 of 240: no sample sees it.
func bumpStudy() Request {
	n := 240
	h := 2 * math.Pi / float64(n)
	c := custom("cos(t)", "sin(t)", "exp(-((t-a)/0.004)^2)", -math.Pi, math.Pi)
	c.Curve.A = -math.Pi + 100.3*h
	c.Samples = n
	c.Construction = "none"
	return c
}

func framedStudy(c Request) Request {
	c.Adaptive = true
	c.AdaptiveFrame = true
	return c
}

// beyondTheirInterval is the points between samples of a refined path that
// lie outside the box of their interval's two samples, and their positions.
func beyondTheirInterval(path *RefinedPath) ([]Vec3, []float64) {
	samples := map[int]*Vec3{}
	for k, u := range path.At {
		if u == math.Trunc(u) {
			samples[int(u)] = path.Points[k]
		}
	}
	var out []Vec3
	var at []float64
	for k, p := range path.Points {
		u := path.At[k]
		if p == nil || u == math.Trunc(u) {
			continue
		}
		a, b := samples[int(math.Floor(u))], samples[int(math.Ceil(u))]
		if a == nil || b == nil ||
			p.X < math.Min(a.X, b.X) || p.X > math.Max(a.X, b.X) ||
			p.Y < math.Min(a.Y, b.Y) || p.Y > math.Max(a.Y, b.Y) ||
			p.Z < math.Min(a.Z, b.Z) || p.Z > math.Max(a.Z, b.Z) {
			out, at = append(out, *p), append(at, u)
		}
	}
	return out, at
}

func sameReach(t *testing.T, name string, path *RefinedPath) {
	t.Helper()
	want, wantAt := beyondTheirInterval(path)
	if len(path.Reach) != len(want) || len(path.ReachAt) != len(want) {
		t.Fatalf("%s: reach has %d points at %d positions, want the %d beyond their intervals", name, len(path.Reach), len(path.ReachAt), len(want))
	}
	for k := range want {
		if path.Reach[k] != want[k] || path.ReachAt[k] != wantAt[k] {
			t.Fatalf("%s: reach %d is %v at %g, want %v at %g", name, k, path.Reach[k], path.ReachAt[k], want[k], wantAt[k])
		}
	}
}

// contains reports whether the bounds' sphere holds p, to rounding.
func contains(b Bounds, p Vec3) bool {
	return p.sub(b.Center).norm() <= b.Radius*(1+1e-12)
}

func TestReachFramesWhatRefinementFindsBetweenSamples(t *testing.T) {
	c := bumpStudy()
	plain := refinedStudy(t, c)
	r := refinedStudy(t, framedStudy(c))
	sameReach(t, "base", r.Adaptive.Base)
	top := Vec3{}
	for _, p := range r.Adaptive.Base.Reach {
		if p.Z > top.Z {
			top = p
		}
	}
	// Refined to 2 × 10⁻⁴ of the circle's radius, the bump's top is found
	// to within a few tolerances.
	if top.Z < 1-5e-4 {
		t.Fatalf("the reach rises only to %g", top.Z)
	}
	if plain.Adaptive.Base.Reach != nil || plain.Adaptive.Base.ReachAt != nil {
		t.Fatal("a study that does not frame its reach reports one")
	}
	// The samples beside the bump rise only to exp(−(0.3h/0.004)²), about
	// 0.021, and leave its top outside their bounds; with the reach the
	// bounds' center rises halfway up the bump, from the samples' lowest
	// z, which underflows to 0.
	if plain.Bounds.Center.Z > 0.011 || contains(plain.Bounds, top) {
		t.Fatalf("the samples' bounds %+v already hold the bump's top %v", plain.Bounds, top)
	}
	if math.Abs(r.Bounds.Center.Z-top.Z/2) > 1e-12 {
		t.Fatalf("bounds centered at z = %g, want %g", r.Bounds.Center.Z, top.Z/2)
	}
	for _, p := range append(r.Adaptive.Base.Reach, top) {
		if !contains(r.Bounds, p) {
			t.Fatalf("bounds %+v leave out %v", r.Bounds, p)
		}
	}
	for _, p := range r.Base {
		if p != nil && !contains(r.Bounds, *p) {
			t.Fatalf("bounds %+v leave out the sample %v", r.Bounds, p)
		}
	}
	if r.Radius != r.Bounds.Radius {
		t.Fatalf("radius %g, bounds' %g", r.Radius, r.Bounds.Radius)
	}
	// Nothing else changes.
	r.Adaptive.Base.Reach, r.Adaptive.Base.ReachAt = nil, nil
	r.Bounds, r.Radius = plain.Bounds, plain.Radius
	x, _ := json.Marshal(plain)
	y, _ := json.Marshal(r)
	if string(x) != string(y) {
		t.Fatal("framing the reach changes more than the reach and the bounds")
	}
}

// A needle along x, 0.004 wide in t between samples: within the fence of
// the circle's x, three interquartile ranges beyond its quartiles (about
// 4.95), it frames the drawing; beyond it, as near an asymptote, it is left
// out, as an outlying sample would be.
func TestReachBeyondItsFamilysFenceIsLeftOut(t *testing.T) {
	needle := func(length string) Request {
		c := bumpStudy()
		c.Curve.X = "cos(t) + " + length + "*exp(-((t-a)/0.004)^2)"
		c.Curve.Z = "0"
		return framedStudy(c)
	}
	// The needle starts near (cos t₀, sin t₀) and points along +x.
	t0 := -math.Pi + 100.3*2*math.Pi/240
	foot := Vec3{math.Cos(t0), math.Sin(t0), 0}
	near := refinedStudy(t, needle("2"))
	sameReach(t, "near", near.Adaptive.Base)
	tip := Vec3{math.Inf(-1), 0, 0}
	for _, p := range near.Adaptive.Base.Reach {
		if p.X > tip.X {
			tip = p
		}
	}
	if tip.X < foot.X+2-1e-3 || !contains(near.Bounds, tip) {
		t.Fatalf("the needle's tip %v is not framed by %+v", tip, near.Bounds)
	}
	far := refinedStudy(t, needle("50"))
	sameReach(t, "far", far.Adaptive.Base)
	tip = Vec3{math.Inf(-1), 0, 0}
	for _, p := range far.Adaptive.Base.Reach {
		if p.X > tip.X {
			tip = p
		}
	}
	// Within x ≤ 4.95 and |y| ≤ 1 the bounds' radius is at most
	// √(2.98² + 1), about 3.14.
	if tip.X < foot.X+50-1e-2 || contains(far.Bounds, tip) || far.Bounds.Radius > 3.15 {
		t.Fatalf("a needle 50 long, its tip %v beyond the fence, frames the drawing: %+v", tip, far.Bounds)
	}
}

// The reach is that of the study refined to its own tolerance: under views
// about the bump, each refined more finely than the study, it and the
// bounds are the same byte for byte.
func TestReachIsTheStudysWhateverTheView(t *testing.T) {
	c := framedStudy(bumpStudy())
	want := refinedStudy(t, c)
	top := want.Adaptive.Base.Reach[0]
	for _, p := range want.Adaptive.Base.Reach {
		if p.Z > top.Z {
			top = p
		}
	}
	for _, v := range []View{
		orthographic(top, 0.01, 0.008),
		orthographic(top.add(Vec3{0, 0, -0.3}), 0.05, 0.04),
		orthographic(Vec3{0, 1, 0}, 0.2, 0.15),
	} {
		got := refinedStudy(t, viewed(c, v))
		if !(got.Adaptive.Base.View > 0) || got.Adaptive.Base.Inserted <= want.Adaptive.Base.Inserted {
			t.Fatalf("the view %+v refines nothing more finely", v)
		}
		x, _ := json.Marshal([]any{want.Adaptive.Base.Reach, want.Adaptive.Base.ReachAt, want.Bounds})
		y, _ := json.Marshal([]any{got.Adaptive.Base.Reach, got.Adaptive.Base.ReachAt, got.Bounds})
		if string(x) != string(y) {
			t.Fatalf("the view %+v moves the reach or the bounds", v)
		}
	}
	// So does a flight's piece.
	piece := c
	piece.Views = []View{orthographic(top, 0.01, 0.008), orthographic(top, 0.05, 0.04)}
	got := refinedStudy(t, piece)
	if got.Bounds != want.Bounds {
		t.Fatalf("a flight's piece moves the bounds: %+v, want %+v", got.Bounds, want.Bounds)
	}
}

// framingFamilies lists the families a study's bounds are fitted to, as
// documented for each construction, each with the refined curve drawn on
// it, nil for a family with none.
func framingFamilies(c Request, r Result) ([][]*Vec3, []*RefinedPath) {
	a := r.Adaptive
	switch {
	case c.Construction == "framed":
		families, paths := [][]*Vec3{r.Base, r.Minus, r.Plus}, []*RefinedPath{a.Base, a.Minus, a.Plus}
		for k, strand := range r.Frame.Strands {
			families, paths = append(families, strand), append(paths, a.Strands[k])
		}
		return families, paths
	case c.Construction == "ruled":
		return [][]*Vec3{r.Base, r.Plus}, []*RefinedPath{a.Base, a.Partner}
	case c.Construction == "canal":
		families, paths := [][]*Vec3{r.Base}, []*RefinedPath{a.Base}
		for k, meridian := range r.Canal.Meridians {
			families, paths = append(families, meridian), append(paths, a.Meridians[k])
		}
		var circles []*Vec3
		for _, g := range r.Canal.Circles {
			for j := range g.Points {
				circles = append(circles, &g.Points[j])
			}
		}
		return append(families, circles), append(paths, nil)
	case c.Construction == "involute":
		families, paths := [][]*Vec3{r.Base}, []*RefinedPath{a.Base}
		for k, m := range r.Involute.Members {
			families, paths = append(families, m.Points), append(paths, a.Involute[k])
		}
		return families, paths
	case c.Construction == "inversion":
		q := r.Inversion
		return [][]*Vec3{r.Base, q.Source, q.Points, {&q.Center}}, []*RefinedPath{a.Base, nil, a.Image, nil}
	case c.Construction == "orthotomic" || c.Construction == "tangent-foot":
		q := r.Projection
		return [][]*Vec3{r.Base, q.Points, q.Feet, {&q.Pole}}, []*RefinedPath{a.Base, a.Projection, nil, nil}
	case r.Composition != nil:
		q := r.Composition
		return [][]*Vec3{r.Base, r.Minus, r.Plus, q.Curve, {&q.Pole}}, []*RefinedPath{a.Base, a.Minus, a.Plus, a.Parent, nil}
	}
	return [][]*Vec3{r.Base, r.Minus, r.Plus}, []*RefinedPath{a.Base, a.Minus, a.Plus}
}

// Every curve a construction refines reports its reach, and the bounds take
// in each with the family drawn from that curve: the base and the curve
// beneath a derived input, a projection, an inversion's image, the
// involutes, the framed ribbon's edges and strands, the ruled partner and
// the canal's meridians. Each study is chosen so that leaving out its
// construction's curves' reach would change its bounds. The bump rises from a helix, so
// every family spreads on every axis.
func TestReachOfEveryRefinedCurve(t *testing.T) {
	bump := bumpStudy()
	bump.Curve.Z = "0.2*t + exp(-((t-a)/0.004)^2)"
	framed := bump
	framed.Construction = "framed"
	framed.Frame = frameRequest()
	framed.Frame.Strands, framed.Frame.Offset, framed.Frame.Width = 2, 0.4, 0.3
	framed.AdaptiveSurface = true
	ruled := bump
	ruled.Construction = "ruled"
	// A ring above the helix with a bump of its own, 0.001 wide, a quarter
	// of a step past sample 100, so that the samples' stencils never feel
	// it: the chord partner's would be the base's own.
	ruled.Ruled = RuledRequest{Partner: "thread", Rate: 1, Thread: Thread{
		X: "2.4*cos(t)", Y: "2.4*sin(t)", Z: "1.6 + exp(-((t + pi - 100.25*pi/120)/0.001)^2)",
	}}
	canal := canalled(bump, 0.2, "1", 3)
	involute := bump
	involute.Construction = "involute"
	involute.Involute = InvoluteRequest{Anchor: math.Pi, Family: InvoluteFamily{Enabled: true, From: -1, To: 1, Count: 3}}
	inversion := bump
	inversion.Construction = "inversion"
	inversion.Inversion = InversionRequest{Center: Vec3{0.3, -0.2, 0.5}, Radius: 1.7, Input: "base"}
	projection := bump
	projection.Construction = "orthotomic"
	projection.Pole = Vec3{2, 2, 0}
	composed := bump
	composed.Construction = "developable"
	composed.Length = 0.3
	composed.Input = "tangent-foot"
	composed.Pole = Vec3{0.2, 0.1, 0.3}
	developable := bump
	developable.Construction = "developable"
	developable.Length = 0.3
	developable.AdaptiveSurface = true
	for name, c := range map[string]Request{
		"framed": framed, "ruled": ruled, "canal": canal, "involute": involute, "inversion": inversion,
		"projection": projection, "composed": composed, "developable": developable,
	} {
		plain := refinedStudy(t, c)
		for path, p := range refinedPaths(plain.Adaptive) {
			if p.Reach != nil {
				t.Fatalf("%s: %s reports a reach unasked", name, path)
			}
		}
		c = framedStudy(c)
		r := refinedStudy(t, c)
		for path, p := range refinedPaths(r.Adaptive) {
			sameReach(t, name+" "+path, p)
		}
		families, paths := framingFamilies(c, r)
		reach := make([][]Vec3, len(paths))
		for k, p := range paths {
			reach[k] = reachOf(p)
		}
		if got := fitReach(families, reach); got != r.Bounds {
			t.Fatalf("%s: bounds %+v, want %+v from each family with its reach", name, r.Bounds, got)
		}
		if fitReach(families, nil) != plain.Bounds {
			t.Fatalf("%s: the samples' bounds are not fitted to these families", name)
		}
		// The construction's own curves, after the base, whose reach the
		// study of the bump alone shows framed.
		without := append([][]Vec3(nil), reach...)
		for k := 1; k < len(without); k++ {
			without[k] = nil
		}
		if fitReach(families, without) == r.Bounds {
			t.Fatalf("%s: the construction's reach does not change the bounds", name)
		}
	}
}

// Without refinement the setting changes nothing.
func TestReachNeedsRefinement(t *testing.T) {
	c := bumpStudy()
	plain, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	c.AdaptiveFrame = true
	framed, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	x, _ := json.Marshal(plain)
	y, _ := json.Marshal(framed)
	if string(x) != string(y) {
		t.Fatal("framing the reach without refinement changes the result")
	}
}
