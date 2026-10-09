package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func cube(r float64) Box { return Box{-r, r, -r, r, -r, r} }

func implicitStudy(f string, level float64, box Box, cells int) ImplicitRequest {
	return ImplicitRequest{F: f, Level: level, Box: box, Cells: cells, Sections: SectionRequest{Normal: Vec3{0, 0, 1}}}
}

// levelSet computes an implicit study and checks that it is a well-formed
// indexed mesh: every triangle names three distinct vertices, every normal
// is a unit vector or zero, and every triangle with area faces larger F,
// along the normals at its corners. (A sliver, from a crossing within
// rounding of a grid point, can face either way.)
func levelSet(t *testing.T, q ImplicitRequest) *ImplicitResult {
	t.Helper()
	r, err := Compute(Request{Format: "implicit", Implicit: q})
	if err != nil {
		t.Fatal(err)
	}
	m := r.Implicit
	if m == nil || r.Surface != nil || r.Rays != nil || len(r.Base) != 0 || len(corners(r.Mesh)) != 0 {
		t.Fatalf("an implicit study has only its own result: %+v", r)
	}
	if len(m.Positions)%3 != 0 || len(m.Normals) != len(m.Positions) || len(m.Triangles)%3 != 0 {
		t.Fatalf("%d positions, %d normals, %d triangle indices", len(m.Positions), len(m.Normals), len(m.Triangles))
	}
	n := int32(len(m.Positions) / 3)
	h := r.Radius / float64(q.Cells)
	for k := 0; k < len(m.Triangles); k += 3 {
		a, b, c := m.Triangles[k], m.Triangles[k+1], m.Triangles[k+2]
		if a < 0 || b < 0 || c < 0 || a >= n || b >= n || c >= n || a == b || b == c || a == c {
			t.Fatalf("triangle %d: %d %d %d of %d vertices", k/3, a, b, c, n)
		}
		p, q, s := m.vertex(a), m.vertex(b), m.vertex(c)
		face := q.sub(p).cross(s.sub(p))
		along := m.normal(a).add(m.normal(b)).add(m.normal(c))
		if face.norm() > 1e-12*h*h && face.dot(along) < 0 {
			t.Fatalf("triangle %d faces %v against its normals %v", k/3, face, along)
		}
	}
	for k := int32(0); k < n; k++ {
		if l := m.normal(k).norm(); l != 0 && math.Abs(l-1) > 1e-12 {
			t.Fatalf("vertex %d normal has length %v", k, l)
		}
	}
	return m
}

// residual checks every vertex against F = c.
func (m *ImplicitResult) residual(t *testing.T, f func(Vec3) float64, c, tol float64) {
	t.Helper()
	for k := int32(0); k < int32(len(m.Positions)/3); k++ {
		if d := math.Abs(f(m.vertex(k)) - c); !(d <= tol) {
			t.Fatalf("vertex %d at %v: F − c = %g", k, m.vertex(k), d)
		}
	}
}

func (m *ImplicitResult) area() float64 {
	total := 0.0
	for k := 0; k < len(m.Triangles); k += 3 {
		p, q, s := m.vertex(m.Triangles[k]), m.vertex(m.Triangles[k+1]), m.vertex(m.Triangles[k+2])
		total += q.sub(p).cross(s.sub(p)).norm() / 2
	}
	return total
}

// volume is the volume the closed mesh encloses on its smaller-F side, by
// the divergence theorem.
func (m *ImplicitResult) volume() float64 {
	total := 0.0
	for k := 0; k < len(m.Triangles); k += 3 {
		p, q, s := m.vertex(m.Triangles[k]), m.vertex(m.Triangles[k+1]), m.vertex(m.Triangles[k+2])
		total += p.dot(q.cross(s)) / 6
	}
	return total
}

func eulers(m *ImplicitResult) []int {
	out := []int{}
	for _, c := range m.Components {
		out = append(out, c.Euler)
	}
	return out
}

func closed(m *ImplicitResult) bool {
	for _, c := range m.Components {
		if !c.Closed {
			return false
		}
	}
	return len(m.Cut) == 0 && len(m.Open) == 0
}

func squared(p Vec3) float64 { return p.dot(p) }

func TestImplicitSphere(t *testing.T) {
	for _, cells := range []int{9, 24, 31} {
		m := levelSet(t, implicitStudy("x^2 + y^2 + z^2", 1, cube(1.3), cells))
		m.residual(t, squared, 1, 1e-12)
		if m.Grid != [3]int{cells, cells, cells} || len(m.Components) != 1 || !closed(m) || m.Components[0].Euler != 2 {
			t.Fatalf("%d cells: grid %v, components %+v, %d cut, %d open", cells, m.Grid, m.Components, len(m.Cut), len(m.Open))
		}
		if m.Components[0].Triangles != len(m.Triangles)/3 || m.Nonfinite != 0 || m.Singular != 0 || m.Discontinuities != 0 || m.Ambiguous != 0 {
			t.Fatalf("%+v", m)
		}
		// ∇F = 2p points outward, toward larger F.
		for k := int32(0); k < int32(len(m.Positions)/3); k++ {
			if d := m.normal(k).sub(m.vertex(k)).norm(); d > 1e-8 {
				t.Fatalf("vertex %d: normal %v at %v", k, m.normal(k), m.vertex(k))
			}
		}
		if v := m.volume(); v < 0 || v > 4*math.Pi/3 {
			t.Fatalf("an inscribed mesh encloses %v", v)
		}
	}
}

// The mesh's area and volume converge to the sphere's at second order.
func TestImplicitConvergence(t *testing.T) {
	var area, volume []float64
	for _, cells := range []int{13, 26, 52} {
		m := levelSet(t, implicitStudy("x^2 + y^2 + z^2", 1, cube(1.3), cells))
		area = append(area, math.Abs(m.area()-4*math.Pi))
		volume = append(volume, math.Abs(m.volume()-4*math.Pi/3))
	}
	for k := 1; k < len(area); k++ {
		if area[k-1]/area[k] < 3 || volume[k-1]/volume[k] < 3 {
			t.Fatalf("area errors %v, volume errors %v", area, volume)
		}
	}
	if area[2] > 2e-2 {
		t.Fatalf("area errors %v", area)
	}
}

// A translated study is the same mesh, translated, to rounding.
func TestImplicitTranslation(t *testing.T) {
	a := levelSet(t, implicitStudy("x^2 + y^2 + z^2", 1, cube(1.3), 17))
	b := levelSet(t, implicitStudy("(x-100)^2 + (y+50)^2 + (z-20)^2", 1, Box{98.7, 101.3, -51.3, -48.7, 18.7, 21.3}, 17))
	if len(a.Positions) != len(b.Positions) || len(a.Triangles) != len(b.Triangles) {
		t.Fatalf("%d and %d positions, %d and %d triangles", len(a.Positions), len(b.Positions), len(a.Triangles), len(b.Triangles))
	}
	shift := Vec3{100, -50, 20}
	for k := int32(0); k < int32(len(a.Positions)/3); k++ {
		if d := b.vertex(k).sub(a.vertex(k).add(shift)).norm(); d > 1e-9 {
			t.Fatalf("vertex %d moved %g", k, d)
		}
	}
	b.residual(t, func(p Vec3) float64 { return squared(p.sub(shift)) }, 1, 1e-9)
}

func torus(R float64) func(Vec3) float64 {
	return func(p Vec3) float64 { return math.Pow(math.Hypot(p.X, p.Y)-R, 2) + p.Z*p.Z }
}

// A torus has Euler characteristic 0 until its tube reaches the axis, at
// c = R², where the hole closes and it becomes a sphere.
func TestImplicitTorus(t *testing.T) {
	for _, c := range []struct {
		level float64
		euler int
	}{{0.25, 0}, {0.7, 0}, {1.3, 2}} {
		q := implicitStudy("(sqrt(x^2+y^2) - a)^2 + z^2", c.level, Box{-2.3, 2.3, -2.3, 2.3, -1.3, 1.3}, 64)
		q.A = 1
		m := levelSet(t, q)
		m.residual(t, torus(1), c.level, 1e-12)
		if !closed(m) || len(m.Components) != 1 || m.Components[0].Euler != c.euler {
			t.Fatalf("c = %v: components %+v", c.level, m.Components)
		}
	}
}

// Two Cassini drops, product of squared distances to (±1, 0, 0), join
// through the saddle at the origin when c passes 1.
func TestImplicitCassini(t *testing.T) {
	cassini := func(p Vec3) float64 {
		return (math.Pow(p.X-1, 2) + p.Y*p.Y + p.Z*p.Z) * (math.Pow(p.X+1, 2) + p.Y*p.Y + p.Z*p.Z)
	}
	for _, shift := range []float64{0, 0.0371} {
		box := Box{-1.8 + shift, 1.8 + shift, -1.2, 1.2, -1.2, 1.2}
		for _, c := range []struct {
			level  float64
			eulers []int
		}{{0.8, []int{2, 2}}, {0.98, []int{2, 2}}, {1.02, []int{2}}, {1.2, []int{2}}} {
			q := implicitStudy("((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)", c.level, box, 48)
			q.A = 1
			m := levelSet(t, q)
			m.residual(t, cassini, c.level, 1e-12)
			if !closed(m) || len(m.Components) != len(c.eulers) {
				t.Fatalf("shift %v, c = %v: components %+v", shift, c.level, m.Components)
			}
			for k, e := range eulers(m) {
				if e != c.eulers[k] {
					t.Fatalf("shift %v, c = %v: Euler characteristics %v", shift, c.level, eulers(m))
				}
			}
		}
	}
	// At c = 1 with the saddle on a grid point, the drops touch there, at
	// a vertex without a normal.
	q := implicitStudy("((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)", 1, Box{-1.8, 1.8, -1.2, 1.2, -1.2, 1.2}, 48)
	q.A = 1
	m := levelSet(t, q)
	if len(m.Components) != 1 || m.Singular != 1 {
		t.Fatalf("components %+v, %d singular", m.Components, m.Singular)
	}
}

// A thickened lemniscate has two holes; the tanglecube has five, and
// splits into eight drops near its minimum.
func TestImplicitGenus(t *testing.T) {
	m := levelSet(t, implicitStudy("((x^2+y^2)^2 - x^2 + y^2)^2 + z^2", 0.02, Box{-1.3, 1.3, -0.7, 0.7, -0.3, 0.3}, 80))
	if !closed(m) || len(m.Components) != 1 || m.Components[0].Euler != -2 {
		t.Fatalf("lemniscate: components %+v", m.Components)
	}
	tangle := "x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2"
	m = levelSet(t, implicitStudy(tangle, -11.8, cube(2.6), 48))
	if !closed(m) || len(m.Components) != 1 || m.Components[0].Euler != -8 {
		t.Fatalf("tanglecube: components %+v", m.Components)
	}
	m = levelSet(t, implicitStudy(tangle, -17, cube(2.6), 48))
	if !closed(m) || len(m.Components) != 8 {
		t.Fatalf("tanglecube near its minimum: components %+v", m.Components)
	}
	for _, e := range eulers(m) {
		if e != 2 {
			t.Fatalf("Euler characteristics %v", eulers(m))
		}
	}
}

// The box cuts a level set open along its faces.
func TestImplicitCut(t *testing.T) {
	m := levelSet(t, implicitStudy("x^2 + y^2 + z^2", 1, Box{-1.3, 1.3, -1.3, 1.3, -0.5, 1.3}, 36))
	if len(m.Components) != 1 || m.Components[0].Closed || m.Components[0].Euler != 1 || len(m.Cut) == 0 || len(m.Open) != 0 {
		t.Fatalf("components %+v, %d cut, %d open", m.Components, len(m.Cut), len(m.Open))
	}
	for _, k := range m.Cut {
		p := m.vertex(k)
		if p.Z != -0.5 || math.Abs(p.X*p.X+p.Y*p.Y-0.75) > 1e-12 {
			t.Fatalf("cut vertex %v", p)
		}
	}
	// A plane across the box is a disk.
	m = levelSet(t, implicitStudy("z - 0.3*x + 0.2*y", 0, cube(1), 20))
	if len(m.Components) != 1 || m.Components[0].Euler != 1 || len(m.Cut) == 0 || len(m.Open) != 0 {
		t.Fatalf("components %+v, %d cut, %d open", m.Components, len(m.Cut), len(m.Open))
	}
	m.residual(t, func(p Vec3) float64 { return p.Z - 0.3*p.X + 0.2*p.Y }, 0, 1e-15)
	// The gyroid, cut open by one period's box.
	gyroid := func(p Vec3) float64 {
		return math.Sin(p.X)*math.Cos(p.Y) + math.Sin(p.Y)*math.Cos(p.Z) + math.Sin(p.Z)*math.Cos(p.X)
	}
	m = levelSet(t, implicitStudy("sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)", 0, cube(math.Pi), 40))
	m.residual(t, gyroid, 0, 1e-12)
	if len(m.Components) == 0 || closed(m) || len(m.Open) != 0 {
		t.Fatalf("components %+v, %d open", m.Components, len(m.Open))
	}
}

// A sign change is a crossing only where F is continuous: a pole or a jump
// is located and counted, never meshed.
func TestImplicitDiscontinuities(t *testing.T) {
	// The plane x = 0.0501 crosses 121 edges along x, 110 face diagonals
	// each way and 100 body diagonals.
	const crossed = 121 + 110 + 110 + 100
	for _, f := range []string{"1/(x - 0.0501)", "(x - 0.0501)/abs(x - 0.0501)", "tan(pi/4*(x - 0.0501) + pi/2)"} {
		m := levelSet(t, implicitStudy(f, 0, cube(1), 10))
		if len(m.Triangles) != 0 || m.Discontinuities != crossed || len(m.Marks) != crossed {
			t.Fatalf("%s: %d triangles, %d discontinuities, %d marks", f, len(m.Triangles)/3, m.Discontinuities, len(m.Marks))
		}
		for _, p := range m.Marks {
			if math.Abs(p.X-0.0501) > 1e-12 {
				t.Fatalf("%s: discontinuity at %v", f, p)
			}
		}
	}
	// F undefined inside an edge whose ends are defined: the search finds
	// no number there, and the crossing is rejected where it looked.
	m := levelSet(t, implicitStudy("x + 0*sqrt(x^2 - 0.0025)", 0, cube(1), 9))
	if len(m.Triangles) != 0 || m.Nonfinite != 0 || m.Discontinuities == 0 {
		t.Fatalf("%d triangles, %d nonfinite, %d discontinuities", len(m.Triangles)/3, m.Nonfinite, m.Discontinuities)
	}
	for _, p := range m.Marks {
		if math.Abs(p.X) >= 0.05 {
			t.Fatalf("discontinuity at %v", p)
		}
	}
	// The pole's other level is meshed; its sign change is not.
	m = levelSet(t, implicitStudy("1/(x - 0.0501)", 2, cube(1), 10))
	m.residual(t, func(p Vec3) float64 { return 1 / (p.X - 0.0501) }, 2, 1e-9)
	if len(m.Components) != 1 || m.Discontinuities != crossed {
		t.Fatalf("components %+v, %d discontinuities", m.Components, m.Discontinuities)
	}
	// A steep but continuous step is a crossing.
	m = levelSet(t, implicitStudy("tanh(1000*(x - 0.0501))", 0, cube(1), 10))
	if len(m.Components) != 1 || m.Discontinuities != 0 {
		t.Fatalf("components %+v, %d discontinuities", m.Components, m.Discontinuities)
	}
	for k := int32(0); k < int32(len(m.Positions)/3); k++ {
		if p := m.vertex(k); math.Abs(p.X-0.0501) > 1e-12 {
			t.Fatalf("vertex %v", p)
		}
	}
	// A level F touches without changing sign is not found.
	m = levelSet(t, implicitStudy("(x^2 + y^2 + z^2 - 1)^2", 0, cube(1.3), 20))
	if len(m.Triangles) != 0 {
		t.Fatalf("%d triangles", len(m.Triangles)/3)
	}
}

// Cubes touching a grid point where F is not finite are left out, and the
// mesh is open beside them.
func TestImplicitNonfinite(t *testing.T) {
	m := levelSet(t, implicitStudy("z - sqrt(x)", 0, Box{-1, 1, -1, 1, -0.5, 1.5}, 20))
	// Columns x = −1, −0.9, …, −0.1 are undefined, on 21 × 21 points each.
	if m.Nonfinite != 10*21*21 || m.Discontinuities != 0 || len(m.Open) == 0 || len(m.Cut) == 0 || len(m.Components) != 1 || m.Components[0].Euler != 1 {
		t.Fatalf("%d nonfinite, %d open, %d cut, components %+v", m.Nonfinite, len(m.Open), len(m.Cut), m.Components)
	}
	for k := int32(0); k < int32(len(m.Positions)/3); k++ {
		if p := m.vertex(k); p.X < 0 {
			t.Fatalf("vertex %v in the undefined half", p)
		}
	}
	for _, k := range m.Open {
		if p := m.vertex(k); p.X > 0.1+1e-12 {
			t.Fatalf("open edge at %v, away from the undefined cells", p)
		}
	}
}

// A grid face whose corners alternate is counted: there the grid's
// diagonal, not the field, decides whether the pieces join.
func TestImplicitAmbiguous(t *testing.T) {
	m := levelSet(t, implicitStudy("x*y", 0.001, Box{-1, 1, -1, 1, -0.5, 0.5}, 9))
	// The saddle's cell spans z in 5 layers of cells, with 6 faces.
	if m.Ambiguous != m.Grid[2]+1 {
		t.Fatalf("grid %v, %d ambiguous faces", m.Grid, m.Ambiguous)
	}
	m.residual(t, func(p Vec3) float64 { return p.X * p.Y }, 0.001, 1e-15)
}

func sectionArea(s SectionPath, n Vec3) float64 {
	total := 0.0
	for k := range s.Points {
		total += s.Points[k].cross(s.Points[(k+1)%len(s.Points)]).dot(n) / 2
	}
	return total
}

// Sections are the planar level sets on their planes: circles of latitude
// on a sphere, each with larger F on its left.
func TestImplicitSections(t *testing.T) {
	q := implicitStudy("x^2 + y^2 + z^2", 1, cube(1.3), 20)
	q.Sections = SectionRequest{Normal: Vec3{0, 0, 2}, From: -0.8, To: 0.8, Count: 5}
	m := levelSet(t, q)
	if len(m.Sections) != 5 || m.SectionDiscontinuities != 0 || m.SectionsSkipped != 0 {
		t.Fatalf("%d sections", len(m.Sections))
	}
	for k, s := range m.Sections {
		d := -0.8 + 0.4*float64(k)
		if math.Abs(s.Offset-d) > 1e-15 || len(s.Paths) != 1 || !s.Paths[0].Closed || len(s.Polygon) != 4 {
			t.Fatalf("section %d: offset %v, %d paths, polygon %v", k, s.Offset, len(s.Paths), s.Polygon)
		}
		for _, p := range s.Polygon {
			if p.Z != s.Offset || math.Abs(p.X) != 1.3 || math.Abs(p.Y) != 1.3 {
				t.Fatalf("section %d polygon %v", k, s.Polygon)
			}
		}
		for _, p := range s.Paths[0].Points {
			if p.Z != s.Offset || math.Abs(squared(p)-1) > 1e-12 {
				t.Fatalf("section %d point %v", k, p)
			}
		}
		// Clockwise seen from +z, as F grows outward.
		if a := sectionArea(s.Paths[0], Vec3{0, 0, 1}); math.Abs(a+math.Pi*(1-d*d)) > 1e-2 {
			t.Fatalf("section %d encloses %v", k, a)
		}
	}
	// A plane that misses the box has no section.
	q.Sections = SectionRequest{Normal: Vec3{1, 1, 0}, From: 2, To: 3, Count: 2}
	m = levelSet(t, q)
	if len(m.Sections) != 2 || len(m.Sections[0].Paths) != 0 || len(m.Sections[0].Polygon) != 0 {
		t.Fatalf("%+v", m.Sections)
	}
	// A plane along a face of the box passes through its corners exactly,
	// and its section is the face's.
	q.Sections = SectionRequest{Normal: Vec3{0, 0, 1}, From: 1.3, To: 1.3, Count: 1}
	q.F, q.Level = "x^2 + y^2", 1
	m = levelSet(t, q)
	if s := m.Sections[0]; len(s.Polygon) != 4 || len(s.Paths) != 1 || !s.Paths[0].Closed || s.Paths[0].Points[0].Z != 1.3 {
		t.Fatalf("%+v", s.Polygon)
	}
	// A plane that only clips a corner has a polygon, but it is too thin to
	// hold a section.
	n := Vec3{1, 1, 1}.mul(1 / math.Sqrt(3))
	q.Sections = SectionRequest{Normal: n, From: n.dot(Vec3{1.3, 1.3, 1.3}) - 1e-8, Count: 1}
	m = levelSet(t, q)
	if s := m.Sections[0]; len(s.Polygon) != 3 || len(s.Paths) != 0 || s.Skipped {
		t.Fatalf("%+v", s)
	}
	q.F, q.Level = "x^2 + y^2 + z^2", 1
	// One plane stands at the first offset.
	q.Sections = SectionRequest{Normal: Vec3{1, 0, 0}, From: 0.5, To: 3, Count: 1}
	m = levelSet(t, q)
	if len(m.Sections) != 1 || m.Sections[0].Offset != 0.5 || len(m.Sections[0].Paths) != 1 {
		t.Fatalf("%+v", m.Sections)
	}
}

// A torus's bitangent plane cuts it in two Villarceau circles of radius R,
// centred at (0, ±r, 0).
func TestImplicitVillarceau(t *testing.T) {
	q := implicitStudy("(sqrt(x^2+y^2) - a)^2 + z^2", 0.25, Box{-1.6, 1.6, -1.6, 1.6, -0.6, 0.6}, 32)
	q.A = 1
	q.Sections = SectionRequest{Normal: Vec3{-0.5, 0, math.Sqrt(3) / 2}, Count: 1}
	m := levelSet(t, q)
	s := m.Sections[0]
	length := 0.0
	for _, path := range s.Paths {
		for k, p := range path.Points {
			r := math.Min(math.Abs(p.sub(Vec3{0, 0.5, 0}).norm()-1), math.Abs(p.sub(Vec3{0, -0.5, 0}).norm()-1))
			if r > 1e-6 || math.Abs(torus(1)(p)-0.25) > 1e-12 || math.Abs(p.X*-0.5+p.Z*math.Sqrt(3)/2) > 1e-15 {
				t.Fatalf("point %v is %g from both circles", p, r)
			}
			if k > 0 || path.Closed {
				length += p.sub(path.Points[(k+len(path.Points)-1)%len(path.Points)]).norm()
			}
		}
	}
	// The circles cross twice, and the tracer rounds each crossing's cell.
	if math.Abs(length-4*math.Pi) > 1e-2*4*math.Pi {
		t.Fatalf("sections are %v long", length)
	}
}

// Sections share one bisection budget; planes beyond it are skipped.
func TestImplicitSectionBudget(t *testing.T) {
	// Near d = 0 the section is a dense network; near d = 1 it is small
	// loops around the peaks, cheap enough to fit, yet skipped all the
	// same once an earlier plane has been.
	q := implicitStudy("sin(5*x)*sin(5*y) + z", 0, Box{-5, 5, -5, 5, -1.2, 1.2}, 64)
	q.Sections = SectionRequest{Normal: Vec3{0, 0, 1}, From: 0, To: 0.99, Count: 24}
	m := levelSet(t, q)
	if m.SectionsSkipped == 0 || m.SectionsSkipped == 24 || len(m.Sections) != 24 {
		t.Fatalf("%d skipped of %d", m.SectionsSkipped, len(m.Sections))
	}
	for k, s := range m.Sections {
		if skipped := k >= 24-m.SectionsSkipped; skipped != (len(s.Paths) == 0) || !s.Skipped == skipped {
			t.Fatalf("section %d: %d paths, skipped %v", k, len(s.Paths), s.Skipped)
		}
	}
}

func TestImplicitCaps(t *testing.T) {
	defer func(tri, crossings int) { maxImplicitTriangles, maxImplicitCrossings = tri, crossings }(maxImplicitTriangles, maxImplicitCrossings)
	maxImplicitTriangles = 500
	_, err := Compute(Request{Format: "implicit", Implicit: implicitStudy("x^2 + y^2 + z^2", 1, cube(1.3), 24)})
	if err == nil || !strings.Contains(err.Error(), "500 triangles") {
		t.Fatalf("error %v", err)
	}
	maxImplicitTriangles, maxImplicitCrossings = 200000, 100
	_, err = Compute(Request{Format: "implicit", Implicit: implicitStudy("1/(x - 0.0501)", 0, cube(1), 20)})
	if err == nil || !strings.Contains(err.Error(), "100 grid edges") {
		t.Fatalf("error %v", err)
	}
}

func TestImplicitValidation(t *testing.T) {
	good := implicitStudy("x^2 + y^2 + z^2", 1, cube(1.3), 20)
	for _, c := range []struct {
		change func(*ImplicitRequest)
		want   string
	}{
		{func(q *ImplicitRequest) { q.F = "x^2 +" }, "F(x, y, z)"},
		{func(q *ImplicitRequest) { q.F = "x + t" }, "cannot use t"},
		{func(q *ImplicitRequest) { q.F = "x + w" }, "F(x, y, z)"},
		{func(q *ImplicitRequest) { q.A = math.NaN() }, "a must be finite"},
		{func(q *ImplicitRequest) { q.Level = math.Inf(1) }, "level c must be finite"},
		{func(q *ImplicitRequest) { q.Box.XMax = q.Box.XMin }, "box"},
		{func(q *ImplicitRequest) { q.Box.ZMin = -2e5 }, "box"},
		{func(q *ImplicitRequest) { q.Box.YMax = math.NaN() }, "box"},
		{func(q *ImplicitRequest) { q.Cells = 3 }, "4–128 cells"},
		{func(q *ImplicitRequest) { q.Cells = 129 }, "4–128 cells"},
		{func(q *ImplicitRequest) { q.Cells = 128 }, "262,144 cells"},
		{func(q *ImplicitRequest) { q.Refine = -1 }, "0–3 refinement levels"},
		{func(q *ImplicitRequest) { q.Refine = 4 }, "0–3 refinement levels"},
		{func(q *ImplicitRequest) { q.Sections.Count = 25 }, "0–24 section planes"},
		{func(q *ImplicitRequest) { q.Sections.Count = -1 }, "0–24 section planes"},
		{func(q *ImplicitRequest) { q.Sections = SectionRequest{Count: 1} }, "section normal"},
		{func(q *ImplicitRequest) { q.Sections = SectionRequest{Normal: Vec3{math.NaN(), 0, 1}, Count: 1} }, "section normal"},
		{func(q *ImplicitRequest) { q.Sections = SectionRequest{Normal: Vec3{0, 0, 1}, From: 2e5, Count: 1} }, "section offsets"},
	} {
		q := good
		c.change(&q)
		_, err := Compute(Request{Format: "implicit", Implicit: q})
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Fatalf("want %q, got %v", c.want, err)
		}
	}
	// Without sections, the normal is not read.
	q := good
	q.Sections = SectionRequest{}
	if _, err := Compute(Request{Format: "implicit", Implicit: q}); err != nil {
		t.Fatal(err)
	}
	// A flat box is nearly all cells along its longest side.
	q.Box = Box{-1, 1, -1, 1, -0.01, 0.01}
	q.Cells = 128
	m := levelSet(t, q)
	if m.Grid != [3]int{128, 128, 1} {
		t.Fatalf("grid %v", m.Grid)
	}
}

func TestImplicitJSON(t *testing.T) {
	var q Request
	if err := json.Unmarshal([]byte(`{"format":"implicit","implicit":{"f":"x^2+y^2+z^2-a","a":1,"level":0,"box":{"xMin":-1.3,"xMax":1.3,"yMin":-1.3,"yMax":1.3,"zMin":-1.3,"zMax":1.3},"cells":12,"sections":{"normal":{"x":0,"y":0,"z":1},"from":0,"to":0,"count":1}}}`), &q); err != nil {
		t.Fatal(err)
	}
	r, err := Compute(q)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"implicit":{`, `"grid":[12,12,12]`, `"positions":[`, `"normals":[`, `"triangles":[`, `"cut":[]`, `"open":[]`, `"components":[{"triangles":`, `"euler":2`, `"closed":true`, `"sections":[{"offset":0,"polygon":[`, `"paths":[{"points":[`, `"skipped":false`, `"marks":[]`, `"nonfinite":0`, `"discontinuities":0`, `"ambiguous":0`, `"singular":0`, `"sectionDiscontinuities":0`, `"sectionsSkipped":0`, `"truncated":false`, `"refinement":{"levels":0,"reached":0,"bisected":0,"unresolved":0,"exhausted":false}`} {
		if !strings.Contains(string(b), key) {
			t.Fatalf("JSON lacks %s", key)
		}
	}
	if !strings.Contains(string(b), `"box":{"xMin":-1.3`) {
		t.Fatal("JSON lacks the box")
	}
}

// Planes x = d parallel to the axis of a torus with R = 2r cut it in two
// loops until d = R − r = r, where the section is Bernoulli's lemniscate,
// and in one loop beyond.
func TestImplicitSpiric(t *testing.T) {
	q := implicitStudy("(sqrt(x^2 + y^2) - a)^2 + z^2", 0.25, Box{-1.6, 1.6, -1.6, 1.6, -0.6, 0.6}, 64)
	q.A = 1
	q.Sections = SectionRequest{Normal: Vec3{1, 0, 0}, From: 0, To: 1.25, Count: 6}
	m := levelSet(t, q)
	for k, loops := range []int{2, 2, -1, 1, 1, 1} {
		s := m.Sections[k]
		for _, path := range s.Paths {
			if loops > 0 && !path.Closed {
				t.Fatalf("d = %v: an open path", s.Offset)
			}
			for _, p := range path.Points {
				if p.X != s.Offset || math.Abs(torus(1)(p)-0.25) > 1e-12 {
					t.Fatalf("d = %v: point %v", s.Offset, p)
				}
			}
		}
		if loops > 0 && len(s.Paths) != loops {
			t.Fatalf("d = %v: %d paths", s.Offset, len(s.Paths))
		}
		// The lemniscate passes through its node, (0.5, 0, 0), where the
		// plane touches the inner equator.
		if loops < 0 {
			near := math.Inf(1)
			for _, path := range s.Paths {
				for _, p := range path.Points {
					near = math.Min(near, p.sub(Vec3{0.5, 0, 0}).norm())
				}
			}
			if near > 1e-12 {
				t.Fatalf("the lemniscate misses its node by %g", near)
			}
		}
	}
}

// The section planes' frames: e₁ × e₂ = n̂, with the cyclic axes for an
// axis-aligned normal.
func TestSectionFrame(t *testing.T) {
	x, y, z := Vec3{1, 0, 0}, Vec3{0, 1, 0}, Vec3{0, 0, 1}
	for _, c := range []struct{ normal, n, e1, e2 Vec3 }{
		{Vec3{0, 0, 3}, z, x, y},
		{Vec3{-2, 0, 0}, x.mul(-1), y.mul(-1), z},
		{Vec3{0, 5, 0}, y, z, x},
		{Vec3{-0.5, 0, math.Sqrt(3) / 2}, Vec3{-0.5, 0, math.Sqrt(3) / 2}, Vec3{math.Sqrt(3) / 2, 0, 0.5}, y},
	} {
		n, e1, e2 := SectionRequest{Normal: c.normal}.frame()
		for _, d := range []float64{n.sub(c.n).norm(), e1.sub(c.e1).norm(), e2.sub(c.e2).norm(), e1.cross(e2).sub(n).norm()} {
			if d > 1e-15 {
				t.Fatalf("normal %v: frame %v %v %v", c.normal, n, e1, e2)
			}
		}
	}
}
