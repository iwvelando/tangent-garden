package engine3

import (
	"math"
	"reflect"
	"slices"
	"testing"
)

// surfaceRefined computes a study refined between samples, with its curves
// alone and with its surface too, checks that refining the surface changes
// nothing but the mesh and the column count, and returns both.
func surfaceRefined(t *testing.T, c Request) (Result, Result) {
	t.Helper()
	curves := refinedStudy(t, c)
	c.AdaptiveSurface = true
	r := refinedStudy(t, c)
	if curves.Adaptive.Columns != 0 {
		t.Fatalf("%d columns added without asking", curves.Adaptive.Columns)
	}
	if r.Adaptive.Columns == 0 {
		t.Fatal("no columns added to the surface")
	}
	same, want := r, curves
	same.Mesh, want.Mesh = CurveMesh{}, CurveMesh{}
	adaptive := *same.Adaptive
	adaptive.Columns, adaptive.Capped, adaptive.Minus, adaptive.Plus = 0, false, nil, nil
	same.Adaptive = &adaptive
	if !reflect.DeepEqual(same, want) {
		t.Fatal("refining the surface changed more than its mesh")
	}
	checkColumns(t, r)
	return curves, r
}

// checkColumns asserts the refined mesh's shape: every triangle within its
// own sample interval, every vertex at a position the surface's samples or
// columns hold, and as many positions between samples as reported.
func checkColumns(t *testing.T, r Result) {
	t.Helper()
	n := float64(len(r.Base) - 1)
	between := map[float64]bool{}
	for _, v := range corners(r.Mesh) {
		at := v.Phase * n
		if !(at >= float64(v.SampleIndex-1)-1e-9 && at <= float64(v.SampleIndex)+1e-9) {
			t.Fatalf("a triangle of sample %d has a corner at %g", v.SampleIndex, at)
		}
		if math.Abs(at-math.Round(at)) > 1e-9 {
			between[v.Phase] = true
		}
	}
	if len(between) != r.Adaptive.Columns {
		t.Fatalf("%d positions between samples in the mesh, %d reported", len(between), r.Adaptive.Columns)
	}
}

// closest is the point of triangle abc nearest p (Ericson, Real-Time
// Collision Detection, 5.1.5).
func closest(p, a, b, c Vec3) Vec3 {
	ab, ac, ap := b.sub(a), c.sub(a), p.sub(a)
	d1, d2 := ab.dot(ap), ac.dot(ap)
	if d1 <= 0 && d2 <= 0 {
		return a
	}
	bp := p.sub(b)
	d3, d4 := ab.dot(bp), ac.dot(bp)
	if d3 >= 0 && d4 <= d3 {
		return b
	}
	vc := d1*d4 - d3*d2
	if vc <= 0 && d1 >= 0 && d3 <= 0 {
		return a.add(ab.mul(d1 / (d1 - d3)))
	}
	cp := p.sub(c)
	d5, d6 := ab.dot(cp), ac.dot(cp)
	if d6 >= 0 && d5 <= d6 {
		return c
	}
	vb := d5*d2 - d1*d6
	if vb <= 0 && d2 >= 0 && d6 <= 0 {
		return a.add(ac.mul(d2 / (d2 - d6)))
	}
	va := d3*d6 - d5*d4
	if va <= 0 && d4-d3 >= 0 && d5-d6 >= 0 {
		return b.add(c.sub(b).mul((d4 - d3) / ((d4 - d3) + (d5 - d6))))
	}
	denominator := 1 / (va + vb + vc)
	return a.add(ab.mul(vb * denominator)).add(ac.mul(vc * denominator))
}

// offMesh is the largest distance from a refined path's points between
// samples to the mesh's triangles in their own sample interval.
func offMesh(r Result, path *RefinedPath) float64 {
	triangles := corners(r.Mesh)
	worst := 0.0
	for j, p := range path.Points {
		at := path.At[j]
		if p == nil || at == math.Trunc(at) {
			continue
		}
		sample := int(math.Floor(at)) + 1
		nearest := math.Inf(1)
		for k := 0; k < len(triangles); k += 3 {
			if triangles[k].SampleIndex != sample {
				continue
			}
			q := closest(*p, triangles[k].Position, triangles[k+1].Position, triangles[k+2].Position)
			nearest = math.Min(nearest, q.sub(*p).norm())
		}
		worst = math.Max(worst, nearest)
	}
	return worst
}

// edge collects the mesh's vertices that pick chooses, one per position in
// parameter order, as a drawn path.
func edge(r Result, pick func(Vertex) bool) ([]*Vec3, []float64) {
	n := float64(len(r.Base) - 1)
	seen := map[float64]Vec3{}
	for _, v := range corners(r.Mesh) {
		if pick(v) {
			seen[v.Phase] = v.Position
		}
	}
	phases := make([]float64, 0, len(seen))
	for phase := range seen {
		phases = append(phases, phase)
	}
	slices.Sort(phases)
	points, at := make([]*Vec3, len(phases)), make([]float64, len(phases))
	for k, phase := range phases {
		p := seen[phase]
		points[k], at[k] = &p, phase*n
	}
	return points, at
}

// turned is the largest turn, as a fraction of the tube's radius, of any
// mesh angle between neighboring rings of a canal's mesh beyond the move of
// their centers: rings are listed whole, 25 vertices each, and a ring
// between samples turned unlike the samples' rings jumps against them.
func turned(r Result, radius float64) float64 {
	m := r.Mesh
	type ring struct {
		phase  float64
		points []Vec3
	}
	var rings []ring
	for first := 0; first < len(m.Vertices)/7; first += canalSegments + 1 {
		g := ring{m.Vertices[7*first+6], nil}
		for k := 0; k <= canalSegments; k++ {
			x := m.Vertices[7*(first+k):]
			g.points = append(g.points, Vec3{x[0], x[1], x[2]})
		}
		rings = append(rings, g)
	}
	slices.SortFunc(rings, func(a, b ring) int { return compareVec(Vec3{a.phase, 0, 0}, Vec3{b.phase, 0, 0}) })
	center := func(g ring) Vec3 {
		c := Vec3{}
		for _, p := range g.points[:canalSegments] {
			c = c.add(p.mul(1.0 / canalSegments))
		}
		return c
	}
	worst := 0.0
	for j := 1; j < len(rings); j++ {
		a, b := rings[j-1], rings[j]
		move := center(b).sub(center(a))
		for k := range a.points {
			worst = math.Max(worst, b.points[k].sub(a.points[k]).sub(move).norm()/radius)
		}
	}
	return worst
}

// A ring of radius 3 run thirty times as fast as a unit ring below it, as
// in TestRefinedPartnerThreadOnARing: the treads' far edge turns once every
// eight samples. Refining the surface puts a column at every point of the
// refined thread, so the thread lies on the mesh's edge, and every column
// is a ruling of the closed-form surface (1 − u)a(t) + u b(30t + δ).
func TestRefinedRuledSurfaceCarriesItsThread(t *testing.T) {
	delta := 0.7
	c := threaded(ring(-1), "3*cos(t)", "3*sin(t)", "1", 30, delta)
	c.Samples = 240
	curves, r := surfaceRefined(t, c)
	thread := r.Adaptive.Partner
	if before := offMesh(curves, thread); before < 4*thread.Tolerance {
		t.Fatalf("the uniform mesh already holds the thread, within %g", before)
	}
	if after := offMesh(r, thread); after > 1e-9 {
		t.Fatalf("the refined thread lies %g off the mesh", after)
	}
	base := func(u float64) Vec3 { return Vec3{math.Cos(u), math.Sin(u), -1} }
	partner := func(u float64) Vec3 { return Vec3{3 * math.Cos(30*u+delta), 3 * math.Sin(30*u+delta), 1} }
	for _, v := range corners(r.Mesh) {
		u := 2 * math.Pi * v.Phase
		a, b := base(u), partner(u)
		if d := distanceToSegment(v.Position, a, b); d > 1e-9 {
			t.Fatalf("vertex %+v lies %g off its ruling", v.Position, d)
		}
	}
	// Each column's vertices are shaded by the surface's normal there,
	// S_t × S_u with S_t = (1 − u)a′ + u·30b′(30t + δ) and S_u = b − a.
	for _, v := range corners(r.Mesh) {
		u := 2 * math.Pi * v.Phase
		a, b := base(u), partner(u)
		along := v.Position.sub(a).norm() / b.sub(a).norm()
		da := Vec3{-math.Sin(u), math.Cos(u), 0}
		db := Vec3{-90 * math.Sin(30*u+delta), 90 * math.Cos(30*u+delta), 0}
		normal := da.mul(1 - along).add(db.mul(along)).cross(b.sub(a)).unit()
		if v.Normal.sub(normal).norm() > 1e-6 && v.Normal.add(normal).norm() > 1e-6 {
			t.Fatalf("vertex %+v has normal %+v, want ±%+v", v.Position, v.Normal, normal)
		}
	}
	far := func(v Vertex) bool { return v.Position.Z > 0.999 }
	points, at := edge(r, far)
	if fine := chordError(points, at, partner, 0, 2*math.Pi, c.Samples); fine > 1.5*thread.Tolerance {
		t.Fatalf("the mesh's edge strays %g from the thread, tolerance %g", fine, thread.Tolerance)
	}
	points, at = edge(curves, far)
	if coarse := chordError(points, at, partner, 0, 2*math.Pi, c.Samples); coarse < 4*thread.Tolerance {
		t.Fatalf("the uniform edge strays only %g", coarse)
	}
}

// A thread undefined on a window narrower than a quarter interval, as in
// TestRefinedPartnerBreaksTheSurface: the refined surface adds no column in
// the interval refinement broke, and no face across it.
func TestRefinedRuledSurfaceKeepsTheBreak(t *testing.T) {
	c := threaded(custom("t", "0", "0", 0, 2), "t", "1", "1+0*sqrt((t-1.00104)^2-0.00000009)", 1, 0)
	c.Lines = 24
	c.AdaptiveSurface = true
	r := refinedStudy(t, c)
	crack := 241
	if !r.Ruled.Breaks[crack] {
		t.Fatal("refinement does not break the surface")
	}
	for _, v := range corners(r.Mesh) {
		if v.SampleIndex == crack {
			t.Fatalf("face across the gap at %+v", v.Position)
		}
	}
}

// A tube of radius 0.1 round a ring of radius 2 coiled forty times by 0.3,
// six samples a coil. Every vertex of the refined mesh lies on the contact
// circle at its own parameter, at distance 0.1 from the curve in its normal
// plane, and every refined meridian lies within a segment's sagitta of the
// mesh, where the uniform rings leave it far behind.
func TestRefinedTubeFollowsACoil(t *testing.T) {
	c := canaled(custom("(2+0.3*cos(40*t))*cos(t)", "(2+0.3*cos(40*t))*sin(t)", "0.3*sin(40*t)", 0, 2*math.Pi), 0.1, "1", 2)
	c.Samples = 240
	curves, r := surfaceRefined(t, c)
	if r.Adaptive.Capped {
		t.Fatal("the columns' budget ran out")
	}
	curve := func(u float64) (Vec3, Vec3) {
		h, dh := 2+0.3*math.Cos(40*u), -12*math.Sin(40*u)
		return Vec3{h * math.Cos(u), h * math.Sin(u), 0.3 * math.Sin(40*u)},
			Vec3{dh*math.Cos(u) - h*math.Sin(u), dh*math.Sin(u) + h*math.Cos(u), 12 * math.Cos(40*u)}
	}
	for _, v := range corners(r.Mesh) {
		p, velocity := curve(2 * math.Pi * v.Phase)
		d := v.Position.sub(p)
		if math.Abs(d.norm()-0.1) > 1e-7 || math.Abs(d.dot(velocity.unit())) > 1e-7 {
			t.Fatalf("vertex %+v: %g from the curve, %g along it", v.Position, d.norm(), d.dot(velocity.unit()))
		}
	}
	// Neighboring rings turn together, as the samples' rings do.
	if before, after := turned(curves, 0.1), turned(r, 0.1); after > before {
		t.Fatalf("refined rings turn by %g of the radius between neighbors, the samples' by %g", after, before)
	}
	sagitta := 0.1 * (1 - math.Cos(math.Pi/canalSegments))
	for k, path := range r.Adaptive.Meridians {
		if before := offMesh(curves, path); before < 10*sagitta {
			t.Fatalf("meridian %d: the uniform mesh already holds it, within %g", k, before)
		}
		if after := offMesh(r, path); after > sagitta+1e-9 {
			t.Fatalf("meridian %d lies %g off the mesh, a segment's sagitta is %g", k, after, sagitta)
		}
	}
}

// A ribbon of half-width 0.3 round the circle of radius 2, twisted thirty
// times: as on the torus of TestRefinedMeridiansOnATorus, its edges are
// r ± 0.3D with D = cos θ e_z + sin θ (T × e_z), θ = θ₀ + 30t. The ribbon
// draws no strand, so its columns come from refining its own edges, which
// the mesh then follows within their tolerance.
func TestRefinedRibbonFollowsItsTwist(t *testing.T) {
	c := circle()
	c.Construction = "framed"
	c.Frame = FrameRequest{Kind: "rotation-minimizing", Reference: Vec3{0, 0, 1}, Width: 0.3, Angle: 0.4, Twist: 30, Closure: "seam"}
	c.Samples = 240
	curves, r := surfaceRefined(t, c)
	side := func(sign float64) func(float64) Vec3 {
		return func(u float64) Vec3 {
			tangent, axis := Vec3{-math.Sin(u), math.Cos(u), 0}, Vec3{0, 0, 1}
			theta := 0.4 + 30*u
			d := axis.mul(math.Cos(theta)).add(tangent.cross(axis).mul(math.Sin(theta)))
			return Vec3{2 * math.Cos(u), 2 * math.Sin(u), 0}.add(d.mul(0.3 * sign))
		}
	}
	for _, sign := range []float64{-1, 1} {
		curve := side(sign)
		on := func(v Vertex) bool { return v.Position.sub(curve(2*math.Pi*v.Phase)).norm() < 1e-9 }
		points, at := edge(r, on)
		tolerance := refineEpsilon * fit(points).Radius
		if fine := chordError(points, at, curve, 0, 2*math.Pi, c.Samples); fine > 1.5*tolerance || len(points) <= c.Samples+1 {
			t.Fatalf("edge %g: %d points stray %g, tolerance %g", sign, len(points), fine, tolerance)
		}
		points, at = edge(curves, on)
		if coarse := chordError(points, at, curve, 0, 2*math.Pi, c.Samples); coarse < 4*tolerance {
			t.Fatalf("edge %g: the uniform edge strays only %g", sign, coarse)
		}
	}
	for _, v := range corners(r.Mesh) {
		if v.Position.sub(side(-1)(2*math.Pi*v.Phase)).norm() > 1e-9 && v.Position.sub(side(1)(2*math.Pi*v.Phase)).norm() > 1e-9 {
			t.Fatalf("vertex %+v is on neither edge", v.Position)
		}
	}
	// The drawn edges are refined too, on their closed forms.
	for k, path := range []*RefinedPath{r.Adaptive.Minus, r.Adaptive.Plus} {
		curve := side(float64(2*k - 1))
		checkPath(t, path, [][]*Vec3{r.Minus, r.Plus}[k], r.Frame.Breaks)
		for j, p := range path.Points {
			near(t, p, curve(2*math.Pi*path.At[j]/float64(c.Samples)), 1e-9)
		}
		if fine := chordError(path.Points, path.At, curve, 0, 2*math.Pi, c.Samples); fine > 1.5*path.Tolerance || path.Inserted == 0 {
			t.Fatalf("edge %d strays %g, tolerance %g", k, fine, path.Tolerance)
		}
	}
	if curves.Adaptive.Minus != nil || curves.Adaptive.Plus != nil {
		t.Fatal("edges refined without refining the surface")
	}
	// Both triangles of a cell share its normal, so thin cells shade
	// smoothly rather than alternately.
	triangles := corners(r.Mesh)
	for k := 0; k+5 < len(triangles); k += 6 {
		if triangles[k].Normal != triangles[k+3].Normal {
			t.Fatalf("a cell's triangles have normals %+v and %+v", triangles[k].Normal, triangles[k+3].Normal)
		}
	}
}

// The tangent developable of a helix of twenty turns, twelve samples a
// turn, reaching 2 along each tangent, so its edges turn much faster than
// the helix: every vertex of the refined mesh lies on the helix or on a
// tangent at its own parameter, the refined helix lies on the mesh, and the
// sheets' far edges follow r ± 2T within their tolerance, where the uniform
// edges stray beyond it.
func TestRefinedDevelopableFollowsAHelix(t *testing.T) {
	c := custom("cos(20*t)", "sin(20*t)", "t", 0, 2*math.Pi)
	c.Samples, c.Length = 240, 2
	curves, r := surfaceRefined(t, c)
	helix := func(u float64) (Vec3, Vec3) {
		return Vec3{math.Cos(20 * u), math.Sin(20 * u), u}, Vec3{-20 * math.Sin(20*u), 20 * math.Cos(20*u), 1}.unit()
	}
	for _, v := range corners(r.Mesh) {
		p, tangent := helix(2 * math.Pi * v.Phase)
		d := v.Position.sub(p)
		if d.sub(tangent.mul(d.dot(tangent))).norm() > 1e-7 || math.Abs(d.dot(tangent)) > 2+1e-7 {
			t.Fatalf("vertex %+v is not on the tangent at %g", v.Position, v.Phase)
		}
	}
	base := r.Adaptive.Base
	if after := offMesh(r, base); after > 1e-9 {
		t.Fatalf("the refined helix lies %g off the mesh", after)
	}
	for _, sign := range []float64{-1, 1} {
		curve := func(u float64) Vec3 { p, tangent := helix(u); return p.add(tangent.mul(2 * sign)) }
		on := func(v Vertex) bool { return v.Position.sub(curve(2*math.Pi*v.Phase)).norm() < 1e-6 }
		points, at := edge(r, on)
		tolerance := refineEpsilon * fit(points).Radius
		if fine := chordError(points, at, curve, 0, 2*math.Pi, c.Samples); fine > 1.5*tolerance || len(points) <= c.Samples+1+base.Inserted {
			t.Fatalf("edge %g strays %g, tolerance %g", sign, fine, tolerance)
		}
		points, at = edge(curves, on)
		if coarse := chordError(points, at, curve, 0, 2*math.Pi, c.Samples); coarse < 4*tolerance {
			t.Fatalf("edge %g: the uniform edge strays only %g", sign, coarse)
		}
	}
}

// Columns are taken a level of bisection at a time, from the coarsest,
// while the whole level fits in the budget; none in a broken interval.
func TestSurfaceColumnsTakeWholeLevels(t *testing.T) {
	p := Vec3{}
	path := func(at ...float64) *RefinedPath {
		points := make([]*Vec3, len(at))
		for k := range points {
			points[k] = &p
		}
		return &RefinedPath{Points: points, At: at}
	}
	broken := &RefinedPath{Points: []*Vec3{&p, nil, &p}, At: []float64{2, 2.5, 3}}
	paths := []*RefinedPath{
		path(0, 0.5, 0.75, 1, 1.25, 1.5, 1.5625, 2),
		path(0, 0.25, 0.5, 1, 1.5, 2),
		broken,
		path(2, 2.5, 3),
	}
	joined := func(i int) bool { return i != 2 }
	columns, count, capped := surfaceColumns(3, joined, 100, paths...)
	want := [][]float64{{0.25, 0.5, 0.75}, {1.25, 1.5, 1.5625}, nil}
	if count != 6 || capped || !reflect.DeepEqual(columns, want) {
		t.Fatalf("columns %v, count %d, capped %v", columns, count, capped)
	}
	// Levels 1 and 2 fit in five columns; level 4 would make six.
	columns, count, capped = surfaceColumns(3, joined, 5, paths...)
	want = [][]float64{{0.25, 0.5, 0.75}, {1.25, 1.5}, nil}
	if count != 5 || !capped || !reflect.DeepEqual(columns, want) {
		t.Fatalf("budget 5: columns %v, count %d, capped %v", columns, count, capped)
	}
	columns, count, capped = surfaceColumns(3, joined, 1, paths...)
	if count != 0 || !capped || slices.ContainsFunc(columns, func(c []float64) bool { return len(c) > 0 }) {
		t.Fatalf("budget 1: columns %v, count %d", columns, count)
	}
}

// Asking for the surface alone, without refinement, changes nothing.
func TestSurfaceRefinementNeedsRefinement(t *testing.T) {
	for name, c := range curveMeshes() {
		plain, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		c.AdaptiveSurface = true
		asked, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(plain, asked) {
			t.Fatalf("%s: the surface changed without refinement", name)
		}
	}
}

// The lost envelope of TestRefinedMeridiansFindALostEnvelope, on a canal
// that draws no meridian: refining the curves alone cannot see it, but the
// refined surface's own seams find it and leave no face across it.
func TestRefinedTubeFindsALostEnvelope(t *testing.T) {
	c := canaled(custom("t", "0", "0", 0, 2), 1, "3+1.0000001*sin(t-1.00104)", 0)
	crack := 241
	curves := refinedStudy(t, c)
	if curves.Canal.Breaks[crack] || curves.Omitted != 0 {
		t.Fatalf("the curves alone already break: omitted %d", curves.Omitted)
	}
	c.AdaptiveSurface = true
	r := refinedStudy(t, c)
	if !r.Canal.Breaks[crack] || r.Omitted != 1 || r.Adaptive.Meridians != nil {
		t.Fatalf("canal break %v, omitted %d", r.Canal.Breaks[crack], r.Omitted)
	}
	for _, v := range corners(r.Mesh) {
		if v.SampleIndex == crack {
			t.Fatalf("face across the gap at %+v", v.Position)
		}
	}
	checkColumns(t, r)
}

// A refined tube round a closed knot still closes, with its seam shown or
// its holonomy spread along it: its first and last rings are the same
// circle, vertex for vertex, as without refinement, neighboring rings turn
// together, and every ring lies on its contact circle. Untwisted and
// spread, meridian 0 runs along the mesh's angle 0, so each of its refined
// points is a vertex.
func TestRefinedTubeCloses(t *testing.T) {
	for _, closure := range []string{"distribute", "seam"} {
		c := canaled(study(), 0.3, "1", 3)
		c.Samples = 240
		c.Frame.Closure = closure
		curves, r := surfaceRefined(t, c)
		first := func(r Result, phase float64) []Vec3 {
			var ring []Vec3
			for _, v := range corners(r.Mesh) {
				if v.Phase == phase && !slices.Contains(ring, v.Position) {
					ring = append(ring, v.Position)
				}
			}
			return ring
		}
		for _, phase := range []float64{0, 1} {
			a, b := first(curves, phase), first(r, phase)
			slices.SortFunc(a, compareVec)
			slices.SortFunc(b, compareVec)
			if len(a) == 0 || !reflect.DeepEqual(a, b) {
				t.Fatalf("%s: ring at phase %g differs: %d and %d points", closure, phase, len(a), len(b))
			}
		}
		if r.Frame.Holonomy == 0 {
			t.Fatalf("%s: the knot's frame returns unturned", closure)
		}
		if before, after := turned(curves, 0.3), turned(r, 0.3); after > before {
			t.Fatalf("%s: refined rings turn by %g of the radius between neighbors, the samples' by %g", closure, after, before)
		}
		for _, v := range corners(r.Mesh) {
			u := 2 * math.Pi * v.Phase
			p, velocity, _ := knot(c, u)
			d := v.Position.sub(p)
			if math.Abs(d.norm()-0.3) > 1e-9 || math.Abs(d.dot(velocity.unit())) > 1e-9 {
				t.Fatalf("%s: vertex %+v: %g from the knot, %g along it", closure, v.Position, d.norm(), d.dot(velocity.unit()))
			}
		}
		if closure != "distribute" {
			continue
		}
		meridian := r.Adaptive.Meridians[0]
		if meridian.Inserted == 0 {
			t.Fatal("meridian 0 is not refined")
		}
		vertices := map[Vec3]bool{}
		for _, v := range corners(r.Mesh) {
			vertices[v.Position] = true
		}
		for j, p := range meridian.Points {
			if p == nil || meridian.At[j] == math.Trunc(meridian.At[j]) {
				continue
			}
			nearest := math.Inf(1)
			for q := range vertices {
				nearest = math.Min(nearest, q.sub(*p).norm())
			}
			if nearest > 1e-9 {
				t.Fatalf("meridian 0's point at %g lies %g from the nearest vertex", meridian.At[j], nearest)
			}
		}
	}
}

func compareVec(p, q Vec3) int {
	for _, d := range []float64{p.X - q.X, p.Y - q.Y, p.Z - q.Z} {
		if d < 0 {
			return -1
		}
		if d > 0 {
			return 1
		}
	}
	return 0
}

// A corner between samples, where y = 0.3|t − 1.0013| turns: the curve is
// continuous and its refinement joins it, but a developable's or ribbon's
// edges jump there by their reach times the tangent's turn. Refining the
// surface finds the jump on its edges and leaves that interval's faces out,
// where the uniform surface joins across it.
func TestRefinedSurfaceLeavesAnEdgeJumpOpen(t *testing.T) {
	developable := custom("t", "0.3*abs(t-1.0013)", "t^2", 0, 2)
	developable.Samples, developable.Length = 240, 1
	ribbon := framedCustom("t", "0.3*abs(t-1.0013)", "t^2", 0, 2)
	ribbon.Samples = 240
	crack := 121
	for name, c := range map[string]Request{"developable": developable, "ribbon": ribbon} {
		curves := refinedStudy(t, c)
		if curves.Breaks[crack] {
			t.Fatalf("%s: the curve breaks at its corner", name)
		}
		joined := false
		for _, v := range corners(curves.Mesh) {
			joined = joined || v.SampleIndex == crack
		}
		if !joined {
			t.Fatalf("%s: the uniform surface leaves the corner open already", name)
		}
		c.AdaptiveSurface = true
		r := refinedStudy(t, c)
		if r.Adaptive.Plus.Breaks == 0 || r.Omitted != curves.Omitted+1 {
			t.Fatalf("%s: edge breaks %d, omitted %d, before %d", name, r.Adaptive.Plus.Breaks, r.Omitted, curves.Omitted)
		}
		for _, v := range corners(r.Mesh) {
			if v.SampleIndex == crack {
				t.Fatalf("%s: face across the edge's jump at %+v", name, v.Position)
			}
		}
	}
}
