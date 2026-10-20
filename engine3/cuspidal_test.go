package engine3

import (
	"encoding/json"
	"math"
	"slices"
	"strings"
	"testing"
)

// params returns the parameters of an edge's points, from their places on
// the grid.
func params(q SurfaceRequest, e CuspidalEdge) ([]float64, []float64) {
	u, v := make([]float64, len(e.I)), make([]float64, len(e.J))
	for k := range e.I {
		u[k] = q.UMin + e.I[k]*(q.UMax-q.UMin)/float64(q.USamples)
		v[k] = q.VMin + e.J[k]*(q.VMax-q.VMin)/float64(q.VSamples)
	}
	return u, v
}

// withEdges asks for the offset d and its cuspidal edges.
func withEdges(c Request, d float64) Request {
	c.Surface.Offset, c.Surface.Edges = d, true
	return c
}

// An elliptic cylinder (a cos u, b sin u, v) bends only around its
// sections, with radius of curvature ρ(u) = (a² sin² u + b² cos² u)^{3/2}/(ab),
// so its inward offset at distance |d| has a cuspidal edge along each line
// u = const where ρ(u) = |d|. There the offset point is the center of
// curvature, on the ellipse's evolute ((a² − b²)/a cos³u, (b² − a²)/b
// sin³u): a straight edge parallel to z. With a = 1.5, b = 1, ρ runs from
// b²/a = 2/3 to a²/b = 2.25, so d = −1 meets it at four u in the whole
// turn, one in each quadrant.
func TestEllipticCylinderOffsetEdgesStandOnItsEvolute(t *testing.T) {
	const a, b, d = 1.5, 1.0, -1.0
	// The cylinder's normal X_u × X_v points out of the tube, so κ₂ =
	// −1/ρ < κ₁ = 0, and the inward offset has d < 0.
	c := withEdges(surfaceStudy("cylinder", a, b, 0, 0, 2*math.Pi, -0.5, 0.5, 96, 12), d)
	s := surfaced(t, c)
	if len(*s.Edges) != 4 {
		t.Fatalf("%d cuspidal edges, want 4", len(*s.Edges))
	}
	quadrants := map[int]bool{}
	for k, e := range *s.Edges {
		if e.Branch != 2 || e.Closed {
			t.Fatalf("edge %d: branch %d closed %v, want an open edge of branch 2", k, e.Branch, e.Closed)
		}
		if len(e.Points) != 13 || len(e.I) != 13 || len(e.J) != 13 {
			t.Fatalf("edge %d has %d points (%d i, %d j), want one on each of the 13 rows", k, len(e.Points), len(e.I), len(e.J))
		}
		for m, j := range e.J {
			if j != float64(m) && j != float64(12-m) {
				t.Fatalf("edge %d's point %d is at j = %v, not on a row", k, m, j)
			}
		}
		u, _ := params(c.Surface, e)
		first, last := e.Points[0], e.Points[len(e.Points)-1]
		if math.Abs(math.Abs(last.Z-first.Z)-1) > 1e-12 {
			t.Fatalf("edge %d runs from z = %v to %v, not the whole height", k, first.Z, last.Z)
		}
		for _, p := range e.Points {
			if math.Hypot(p.X-first.X, p.Y-first.Y) > 1e-12 {
				t.Fatalf("edge %d leaves its line: %v against %v", k, p, first)
			}
		}
		// On the evolute: cos u and sin u from its two coordinates must
		// make a unit vector, at a u where ρ = |d|, and the edge stands
		// |d| from the ellipse's point there.
		cu := math.Cbrt(first.X * a / (a*a - b*b))
		su := math.Cbrt(first.Y * b / (b*b - a*a))
		if math.Abs(cu*cu+su*su-1) > 1e-9 {
			t.Fatalf("edge %d at %v is off the evolute: cos² + sin² = %v", k, first, cu*cu+su*su)
		}
		rho := math.Pow(a*a*su*su+b*b*cu*cu, 1.5) / (a * b)
		if math.Abs(rho-math.Abs(d)) > 1e-9 {
			t.Fatalf("edge %d where ρ = %v, not |d| = %v", k, rho, math.Abs(d))
		}
		if r := math.Hypot(first.X-a*cu, first.Y-b*su); math.Abs(r-math.Abs(d)) > 1e-9 {
			t.Fatalf("edge %d stands %v from its foot, not |d|", k, r)
		}
		// Its parameters are the foot's.
		if math.Abs(math.Cos(u[0])-cu) > 1e-9 || math.Abs(math.Sin(u[0])-su) > 1e-9 {
			t.Fatalf("edge %d's u %v is not its foot's", k, u[0])
		}
		quadrants[int(math.Floor(math.Mod(math.Atan2(su, cu)+2*math.Pi, 2*math.Pi)/(math.Pi/2)))] = true
	}
	if len(quadrants) != 4 {
		t.Fatalf("edges in quadrants %v, want one in each", quadrants)
	}
}

// A spheroid (a cos v cos u, a cos v sin u, c sin v), a = 1.5, c = 0.7, with
// its outward normal, has meridian radius ρ_m = (a² sin² v + c² cos² v)^{3/2}/(ac),
// from c²/a ≈ 0.327 at the equator to a²/c ≈ 3.21 at the poles, and
// parallel radius ρ_p = a√(a² sin² v + c² cos² v)/c, from a to a²/c. Both
// depend on v alone, so each cuspidal edge of the inward offset is a whole
// parallel, z = const, on the meridian's evolute ((a² − c²)/a cos³v, (c² −
// a²)/c sin³v): d = −1 meets only ρ_m, whose κ = −1/ρ_m is then the
// smaller, once north of the equator and once south, in closed circles
// about the axis.
func TestSpheroidOffsetEdgesAreClosedParallels(t *testing.T) {
	const a, c, d = 1.5, 0.7, -1.0
	s := surfaced(t, withEdges(surfaceStudy("ellipsoid", a, a, c, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 72, 60), d))
	if len(*s.Edges) != 2 {
		t.Fatalf("%d cuspidal edges, want 2", len(*s.Edges))
	}
	signs := map[bool]bool{}
	for k, e := range *s.Edges {
		if !e.Closed || e.Branch != 2 {
			t.Fatalf("edge %d: closed %v, branch %d; a whole parallel of branch 2 closes across the seam u = 0", k, e.Closed, e.Branch)
		}
		// One point on each of the 72 meridians, the seam's once.
		if len(e.Points) != 72 {
			t.Fatalf("edge %d has %d points, want 72", k, len(e.Points))
		}
		z := e.Points[0].Z
		radius := math.Hypot(e.Points[0].X, e.Points[0].Y)
		for _, p := range e.Points {
			if math.Abs(p.Z-z) > 1e-12 || math.Abs(math.Hypot(p.X, p.Y)-radius) > 1e-12 {
				t.Fatalf("edge %d leaves its circle: %v", k, p)
			}
		}
		cv := math.Cbrt(radius * a / (a*a - c*c))
		sv := math.Cbrt(z * c / (c*c - a*a))
		if math.Abs(cv*cv+sv*sv-1) > 1e-9 {
			t.Fatalf("edge %d is off the meridian's evolute: cos² + sin² = %v", k, cv*cv+sv*sv)
		}
		if rho := math.Pow(a*a*sv*sv+c*c*cv*cv, 1.5) / (a * c); math.Abs(rho-math.Abs(d)) > 1e-9 {
			t.Fatalf("edge %d where ρ_m = %v, not |d|", k, rho)
		}
		signs[z > 0] = true
	}
	if len(signs) != 2 {
		t.Fatal("both edges on one side of the equator")
	}
}

// A three-axis ellipsoid's inward offset past its smallest radius has
// cuspidal edges whose every point is the offset point X + dn of its own
// parameters, where 1 − dκ = 0 for one principal curvature κ, found here
// from the ellipsoid's implicit form. No edge stops inside the domain:
// each is closed, or ends on the domain's boundary or beside a pole, where
// the chart has no normal.
func TestEllipsoidOffsetEdgesLieWhereTheOffsetIsSingular(t *testing.T) {
	c := withEdges(surfaceStudy("ellipsoid", 1.5, 1, 0.7, 11*math.Pi/10, 21*math.Pi/10, -math.Pi/2, math.Pi/2, 80, 80), -0.6)
	q := c.Surface
	s := surfaced(t, c)
	if len(*s.Edges) < 2 {
		t.Fatalf("%d cuspidal edges", len(*s.Edges))
	}
	du, dv := (q.UMax-q.UMin)/float64(q.USamples), (q.VMax-q.VMin)/float64(q.VSamples)
	for k, e := range *s.Edges {
		if len(e.Points) < 2 || len(e.I) != len(e.Points) || len(e.J) != len(e.Points) {
			t.Fatalf("edge %d has %d points, %d i and %d j", k, len(e.Points), len(e.I), len(e.J))
		}
		us, vs := params(q, e)
		for m, p := range e.Points {
			if e.I[m] != math.Trunc(e.I[m]) && e.J[m] != math.Trunc(e.J[m]) {
				t.Fatalf("edge %d point %d at (%v, %v) is on no grid edge", k, m, e.I[m], e.J[m])
			}
			u, v := us[m], vs[m]
			x, n := ellipsoidNormal(q.A, q.B, q.C, u, v)
			if o := x.add(n.mul(q.Offset)); o.sub(p).norm() > 1e-12 {
				t.Fatalf("edge %d point %v is not the offset of its parameters (%v)", k, p, o)
			}
			r := ellipsoidSingularity(q.A, q.B, q.C, u, v, q.Offset)
			if math.Abs(r[e.Branch-1]) > 1e-9 {
				t.Fatalf("edge %d point %d: 1 − dκ%d = %v", k, m, e.Branch, r[e.Branch-1])
			}
		}
		if e.Closed {
			continue
		}
		for _, m := range []int{0, len(e.Points) - 1} {
			u, v := us[m], vs[m]
			if !(math.Abs(u-q.UMin) < 1e-12 || math.Abs(u-q.UMax) < 1e-12 || v < q.VMin+1.01*dv || v > q.VMax-1.01*dv) {
				t.Fatalf("edge %d stops inside the domain at u = %v, v = %v (cells %v × %v)", k, u, v, du, dv)
			}
		}
	}
}

// ellipsoidNormal is the ellipsoid's point at (u, v) and its outward unit
// normal, the gradient of x²/a² + y²/b² + z²/c².
func ellipsoidNormal(a, b, c, u, v float64) (Vec3, Vec3) {
	x := Vec3{a * math.Cos(v) * math.Cos(u), b * math.Cos(v) * math.Sin(u), c * math.Sin(v)}
	g := Vec3{x.X / (a * a), x.Y / (b * b), x.Z / (c * c)}
	return x, g.mul(1 / g.norm())
}

// ellipsoidSingularity returns 1 − dκ₁ and 1 − dκ₂ at (u, v), κ₁ ≥ κ₂,
// with the outward normal: the shape operator −dn restricted to the
// tangent plane is −(I − nnᵀ) diag(1/a², 1/b², 1/c²)/|∇| there.
func ellipsoidSingularity(a, b, c, u, v, d float64) [2]float64 {
	x, n := ellipsoidNormal(a, b, c, u, v)
	m := Vec3{x.X / (a * a), x.Y / (b * b), x.Z / (c * c)}.norm()
	t1 := n.cross(Vec3{0, 0, 1})
	if t1.norm() < 0.3 {
		t1 = n.cross(Vec3{1, 0, 0})
	}
	t1 = t1.mul(1 / t1.norm())
	t2 := n.cross(t1)
	dn := func(w Vec3) Vec3 {
		h := Vec3{w.X / (a * a), w.Y / (b * b), w.Z / (c * c)}.mul(1 / m)
		return h.sub(n.mul(n.dot(h)))
	}
	p, q, s := -t1.dot(dn(t1)), -t1.dot(dn(t2)), -t2.dot(dn(t2))
	mean, spread := (p+s)/2, math.Hypot((p-s)/2, q)
	return [2]float64{1 - d*(mean+spread), 1 - d*(mean-spread)}
}

// Edges are opt-in: without them, or with no offset, the result carries
// none and encodes as before, with no "edges" key.
func TestOffsetEdgesAreOptIn(t *testing.T) {
	c := surfaceStudy("ellipsoid", 1.5, 1, 0.7, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 48, 48)
	c.Surface.Offset = -0.6
	for name, study := range map[string]Request{"off": c, "no offset": withEdges(c, 0)} {
		out, err := Compute(study)
		if err != nil {
			t.Fatal(err)
		}
		if out.Surface.Edges != nil {
			t.Fatalf("%s: %d edges", name, len(*out.Surface.Edges))
		}
		encoded, _ := json.Marshal(out.Surface)
		if strings.Contains(string(encoded), `"edges"`) {
			t.Fatalf("%s: the result encodes an edges key", name)
		}
	}
	// A sphere's offset never folds along an edge: both radii are R
	// everywhere, so short of collapsing to its center it has none.
	for _, d := range []float64{-0.4, -1.6, 0.5} {
		s := surfaced(t, withEdges(sphere(1, 36, 24), d))
		if s.Edges == nil || len(*s.Edges) != 0 {
			t.Fatalf("a sphere offset by %v has edges %v, want an empty list", d, s.Edges)
		}
		encoded, _ := json.Marshal(s)
		if !strings.Contains(string(encoded), `"edges":[]`) {
			t.Fatalf("a sphere offset by %v encodes no empty list of edges", d)
		}
	}
}

// The saddle z = (x² − y²)/2 curves most, κ₁ = 1, at its vertex, so the
// edge of d = 1.2 is one closed loop of branch 1 about the vertex, however
// it is sampled, including with the vertex at a cell's center, and its
// every point is a root of 1 − dκ₁.
func TestParaboloidOffsetEdgeIsOneLoop(t *testing.T) {
	for _, n := range []int{12, 13, 40} {
		c := withEdges(surfaceStudy("paraboloid", 1, -1, 0, -1, 1, -1, 1, n, n), 1.2)
		s := surfaced(t, c)
		if len(*s.Edges) != 1 || !(*s.Edges)[0].Closed || (*s.Edges)[0].Branch != 1 {
			t.Fatalf("%d samples: %d edges %+v, want one closed loop of branch 1", n, len(*s.Edges), (*s.Edges))
		}
		us, vs := params(c.Surface, (*s.Edges)[0])
		for m, u := range us {
			v := vs[m]
			// For z = (x² − y²)/2, with h = 1 + u² + v², K = −1/h² and
			// H = (v² − u²)/(2h^{3/2}), so κ₁ = H + √(H² − K).
			h := 1 + u*u + v*v
			H := (v*v - u*u) / (2 * math.Pow(h, 1.5))
			k1 := H + math.Sqrt(H*H+1/(h*h))
			if math.Abs(1-1.2*k1) > 1e-9 {
				t.Fatalf("%d samples: point %d at (%v, %v) has 1 − dκ₁ = %v", n, m, u, v, 1-1.2*k1)
			}
		}
	}
}

// A cell joins the two sides its level set crosses; a saddle, crossed on
// all four, keeps its center's side whole: f = xy − c on the cell
// [−1, 1]², corners counterclockwise from (−1, −1), is above at corners 0
// and 2, and its center −c is above with them only for c ≤ 0.
func TestMarchSplitsSaddlesByTheirCenter(t *testing.T) {
	saddle := func(c float64) ([4]float64, func() float64) {
		return [4]float64{1 - c, -1 - c, 1 - c, -1 - c}, func() float64 { return 0 - c }
	}
	for _, tc := range []struct {
		c    float64
		want [][2]int
	}{
		// The center with corners 0 and 2: corners 1 and 3 are cut off.
		{-0.5, [][2]int{{0, 1}, {2, 3}}},
		{0, [][2]int{{0, 1}, {2, 3}}},
		{0.5, [][2]int{{3, 0}, {1, 2}}},
	} {
		corner, center := saddle(tc.c)
		if got := march(corner, center); !slices.Equal(got, tc.want) {
			t.Fatalf("c = %v: %v, want %v", tc.c, got, tc.want)
		}
	}
	never := func() float64 { t.Fatal("a cell that is not a saddle evaluated its center"); return 0 }
	if got := march([4]float64{1, -1, -1, 1}, never); !slices.Equal(got, [][2]int{{0, 2}}) {
		t.Fatalf("a cell crossed on sides 0 and 2 joins %v", got)
	}
	if got := march([4]float64{0, 1, 2, 3}, never); got != nil {
		t.Fatalf("a cell wholly above, a zero counting as above, joins %v", got)
	}
	// A negative zero, an oriented level's zero turned over, is below.
	if got := march([4]float64{math.Copysign(0, -1), 1, 2, 3}, never); !slices.Equal(got, [][2]int{{0, 3}}) {
		t.Fatalf("a cell with a corner at −0 joins %v", got)
	}
	// Without a center value the corners' mean decides.
	corner, _ := saddle(0.5)
	if got := march(corner, func() float64 { return math.NaN() }); !slices.Equal(got, [][2]int{{3, 0}, {1, 2}}) {
		t.Fatalf("a saddle with no center value joins %v", got)
	}
}

// The Illinois method finds a root to rounding, from either side, in a
// few steps, and reports a missing value.
func TestRootBracketsAndConverges(t *testing.T) {
	for _, g := range []func(float64) float64{
		func(t float64) float64 { return math.Cos(3*t) - 0.2 },
		func(t float64) float64 { return 0.2 - math.Cos(3*t) },
		func(t float64) float64 { return math.Pow(t-0.3, 3) },
	} {
		r, ok := root(g, g(0), g(1))
		if !ok || math.Abs(g(r)) > 1e-14 {
			t.Fatalf("root %v (ok %v) leaves %v", r, ok, g(r))
		}
	}
	if want := math.Acos(0.2) / 3; math.Abs(mustRoot(t, func(t float64) float64 { return math.Cos(3*t) - 0.2 })-want) > 1e-14 {
		t.Fatal("cos 3t = 0.2 missed")
	}
	// On a convex function plain regula falsi keeps one end fixed and
	// creeps; Illinois halving converges superlinearly, in a few steps.
	for _, g := range []func(float64) float64{
		func(t float64) float64 { return math.Exp(5*t) - 2 },
		func(t float64) float64 { return math.Exp(-5*(t-0.2)) - 2 },
	} {
		calls := 0
		r := mustRoot(t, func(t float64) float64 { calls++; return g(t) })
		if math.Abs(g(r)) > 1e-15 || calls > 2+16 {
			t.Fatalf("root %v leaves %v after %d evaluations", r, g(r), calls)
		}
	}
	if _, ok := root(func(t float64) float64 { return math.NaN() }, 1, -1); ok {
		t.Fatal("a missing value went unreported")
	}
	// An end at −0, an oriented level's zero turned over, is below: the
	// root is that end, not the other.
	slope := func(t float64) float64 {
		if t == 1 {
			return math.Copysign(0, -1)
		}
		return 1 - t
	}
	if r, ok := root(slope, 1, slope(1)); !ok || r < 1-1e-12 {
		t.Fatalf("from 1 to −0 the root is %v (ok %v), not the end at −0", r, ok)
	}
}

func mustRoot(t *testing.T, g func(float64) float64) float64 {
	t.Helper()
	r, ok := root(g, g(0), g(1))
	if !ok {
		t.Fatal("no root")
	}
	return r
}

// The whole ellipsoid (1.5, 1, 0.7): its larger curvature, against the
// outward normal, has a saddle at the ends of the middle axis, where it is
// b/c² ≈ 2.04, between its maximum a/c² at the ends of the long axis and
// its value c/b² at the poles. So the second sheet's edges reconnect there
// at d = −c²/b = −0.49: just beyond, they run round the short axis, north
// and south of the equator; just short of it, they ring the ends of the
// long axis.
func TestEllipsoidEdgesReconnectThroughTheSaddle(t *testing.T) {
	for _, tc := range []struct {
		d     float64
		round string
	}{{-0.5, "z"}, {-0.48, "x"}} {
		s := surfaced(t, withEdges(surfaceStudy("ellipsoid", 1.5, 1, 0.7, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 96, 96), tc.d))
		if len(*s.Edges) != 2 {
			t.Fatalf("d = %v: %d edges, want 2", tc.d, len(*s.Edges))
		}
		sides := map[bool]bool{}
		for k, e := range *s.Edges {
			if e.Branch != 2 || !e.Closed {
				t.Fatalf("d = %v: edge %d of branch %d, closed %v", tc.d, k, e.Branch, e.Closed)
			}
			var c Vec3
			for _, p := range e.Points {
				c = c.add(p.mul(1 / float64(len(e.Points))))
			}
			// A ring round an axis has its center on that axis, off the
			// center of the ellipsoid.
			on, off := c.Z, math.Hypot(c.X, c.Y)
			if tc.round == "x" {
				on, off = c.X, math.Hypot(c.Y, c.Z)
			}
			if off > 1e-9 || math.Abs(on) < 0.01 {
				t.Fatalf("d = %v: edge %d centered at %v, not round the %s axis", tc.d, k, c, tc.round)
			}
			sides[on > 0] = true
		}
		if len(sides) != 2 {
			t.Fatalf("d = %v: both edges on one side", tc.d)
		}
	}
}
