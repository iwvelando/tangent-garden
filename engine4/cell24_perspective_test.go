package engine4

import (
	"encoding/json"
	"errors"
	"math"
	"testing"
)

// The perspective shadow of the 24-cell: after the shared rotation,
// P(x, y, z, w) = d(x, y, z)/(d − w), with d in [2.05, 20]. Both
// configurations lie in the ball of radius √2, which these tests check
// independently of the engine's framing radius.

func cell24Perspective(selected int, view string, angles [6]float64, d float64) Request {
	q := cell24Request(selected, view, angles)
	q.Mode, q.Distance = "perspective", d
	return q
}

var perspectiveAngles = [][6]float64{
	{},
	{.3, .2, .1, .7, .5, .3},
	{.31, .54, -.13, .81, .75, -.23},
	{-1.2, 2.7, .4, -2.9, 1.1, 3.0},
	// The extremes of the admitted angles.
	{1e6, -1e6, 1e6, -1e6, 1e6, -1e6},
}

// The greatest |P| over the ball |x| ≤ R, found by sampling w on a fine
// grid rather than from the derived formula R d/√(d² − R²).
func sampledFramingRadius(R, d float64) float64 {
	best := 0.
	const n = 200000
	for i := 0; i <= n; i++ {
		w := -R + 2*R*float64(i)/n
		best = math.Max(best, d*math.Sqrt(math.Max(0, R*R-w*w))/(d-w))
	}
	return best
}

func TestCell24PerspectiveProjection(t *testing.T) {
	for _, angles := range perspectiveAngles {
		for _, d := range []float64{2.05, 2.4, 4, 20} {
			r, p := cell24Result(t, cell24Perspective(5, "crystal", angles, d))
			if r.Object != "cell24" || r.Operation != "perspective" {
				t.Fatal(r.Object, r.Operation)
			}
			_, o := cell24Result(t, cell24Request(5, "crystal", angles))
			bound := sampledFramingRadius(math.Sqrt2, d)
			if math.Abs(r.Radius-bound) > 1e-6 || r.Radius < bound {
				t.Fatalf("d %g: framing radius %v, sampled maximum %v", d, r.Radius, bound)
			}
			for _, c := range []struct {
				name     string
				got, ort PairPolytope
			}{{"primal", p.Primal, o.Primal}, {"dual", p.Dual, o.Dual}} {
				for i, v := range c.got.Rotated {
					// Source and rotated coordinates are those of the
					// orthogonal shadow, bit for bit.
					if v != c.ort.Rotated[i] || c.got.Source[i] != c.ort.Source[i] {
						t.Fatalf("%s %d: rotated %v, orthogonal %v", c.name, i, v, c.ort.Rotated[i])
					}
					den := d - v[3]
					if !(den >= d-math.Sqrt2-1e-12) || !(den > 0.6) {
						t.Fatalf("%s %d: denominator %g at d %g", c.name, i, den, d)
					}
					q := c.got.Points[i]
					for j := 0; j < 3; j++ {
						want := d * v[j] / den
						if math.Abs(q[j]-want) > 1e-12*math.Max(1, math.Abs(want)) {
							t.Fatalf("%s %d: %v, want %g in coordinate %d", c.name, i, q, want, j)
						}
					}
					if l := math.Sqrt(dot(q, q)); l > r.Radius*(1+1e-12) {
						t.Fatalf("%s %d: |P| %g beyond %g", c.name, i, l, r.Radius)
					}
				}
				if c.got.EdgeLength != c.ort.EdgeLength || c.got.Circumradius != c.ort.Circumradius {
					t.Fatal("source metric changed")
				}
			}
			// Drawn edges and diagonals are chords of the hull. The image of
			// the ball is convex, so their interior points stay inside too:
			// check the projected 4D midpoints and quarter points.
			for _, e := range p.Primal.Edges {
				for _, s := range []float64{.25, .5, .75} {
					m := mix(p.Primal.Rotated[e[0]], p.Primal.Rotated[e[1]], s)
					q := Vec3{d * m[0] / (d - m[3]), d * m[1] / (d - m[3]), d * m[2] / (d - m[3])}
					if math.Sqrt(dot(q, q)) > r.Radius {
						t.Fatal("edge interior beyond the framing radius")
					}
				}
			}
		}
	}
}

// The framing radius is attained: a source point on the sphere at
// w = R²/d, rotated onto x, projects to exactly R d/√(d² − R²).
func TestCell24PerspectiveBoundAttained(t *testing.T) {
	for _, d := range []float64{2.05, 4, 20} {
		r, _ := cell24Result(t, cell24Perspective(0, "cell", [6]float64{}, d))
		w := 2 / d
		x := math.Sqrt(2 - w*w)
		near(t, d*x/(d-w), r.Radius)
	}
}

// Lines map to lines: each projected diagonal still passes through the
// projected center, but the center is generally not its midpoint.
func TestCell24PerspectiveCollinearity(t *testing.T) {
	offMidpoint := 0.
	for _, angles := range perspectiveAngles {
		for _, d := range []float64{2.05, 4, 20} {
			_, p := cell24Result(t, cell24Perspective(0, "cell", angles, d))
			for k := 0; k < 24; k++ {
				cell := primal24().cells[k]
				c := p.Dual.Points[k]
				for i := 0; i < 6; i += 2 {
					a, b := p.Primal.Points[cell[i]], p.Primal.Points[cell[i+1]]
					ab := sub(b, a)
					s := dot(sub(c, a), ab) / dot(ab, ab)
					x := cross(ab, sub(c, a))
					if !(s > 0 && s < 1) || math.Sqrt(dot(x, x)) > 1e-12*dot(ab, ab) {
						t.Fatalf("cell %d diagonal %d: s %g, off-line %g", k, i/2, s, math.Sqrt(dot(x, x)))
					}
					m := Vec3{(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2}
					offMidpoint = math.Max(offMidpoint, math.Sqrt(dot(sub(m, c), sub(m, c))))
				}
			}
		}
	}
	if offMidpoint < 0.05 {
		t.Fatalf("projected centers stayed at diagonal midpoints (%g)", offMidpoint)
	}
}

// Incidence, selection and identities are those of the orthogonal shadow.
func TestCell24PerspectiveIncidence(t *testing.T) {
	for _, angles := range perspectiveAngles[:3] {
		for k := 0; k < 24; k++ {
			_, p := cell24Result(t, cell24Perspective(k, "crystal", angles, 2.05))
			_, o := cell24Result(t, cell24Request(k, "crystal", angles))
			x, _ := json.Marshal([]any{p.Primal.Edges, p.Dual.Edges, p.CellVertices, p.CellEdges, p.Neighbors, p.NeighborEdges, p.SharedFaces, p.Selected, p.View})
			y, _ := json.Marshal([]any{o.Primal.Edges, o.Dual.Edges, o.CellVertices, o.CellEdges, o.Neighbors, o.NeighborEdges, o.SharedFaces, o.Selected, o.View})
			if string(x) != string(y) {
				t.Fatalf("cell %d: incidence differs from the orthogonal shadow", k)
			}
		}
	}
}

// Source lengths stay √2 and 1; the shadow-edge readouts measure the
// projected edges, which differ from the orthogonal shadow's.
func TestCell24PerspectiveLengths(t *testing.T) {
	angles := [6]float64{.3, .2, .1, .7, .5, .3}
	_, p := cell24Result(t, cell24Perspective(0, "cell", angles, 2.05))
	_, o := cell24Result(t, cell24Request(0, "cell", angles))
	short, long := math.Inf(1), 0.
	for _, e := range p.CellEdges {
		ends := p.Primal.Edges[e]
		s4 := sub4(p.Primal.Rotated[ends[0]], p.Primal.Rotated[ends[1]])
		near(t, math.Sqrt(dot4(s4, s4)), math.Sqrt2)
		// Independently projected endpoints.
		pr := func(v Vec4) Vec3 {
			return Vec3{2.05 * v[0] / (2.05 - v[3]), 2.05 * v[1] / (2.05 - v[3]), 2.05 * v[2] / (2.05 - v[3])}
		}
		l := sub(pr(p.Primal.Rotated[ends[0]]), pr(p.Primal.Rotated[ends[1]]))
		short, long = math.Min(short, math.Sqrt(dot(l, l))), math.Max(long, math.Sqrt(dot(l, l)))
	}
	near(t, p.ShadowEdges[0], short)
	near(t, p.ShadowEdges[1], long)
	if math.Abs(p.ShadowEdges[1]-o.ShadowEdges[1]) < 0.05 {
		t.Fatal("perspective shadow edges equal the orthogonal ones", p.ShadowEdges, o.ShadowEdges)
	}
	if p.Primal.EdgeLength != math.Sqrt2 || p.Dual.EdgeLength != 1 {
		t.Fatal(p.Primal.EdgeLength, p.Dual.EdgeLength)
	}
}

// A distant eye approaches the orthogonal shadow: every point moves by at
// most |xyz| |w|/(d − w) ≤ 1/(d − √2), since |xyz| |w| ≤ (|xyz|² + w²)/2
// ≤ 1, and less as d grows.
func TestCell24PerspectiveApproachesOrthogonal(t *testing.T) {
	angles := [6]float64{.31, .54, -.13, .81, .75, -.23}
	_, o := cell24Result(t, cell24Request(0, "crystal", angles))
	previous := math.Inf(1)
	for _, d := range []float64{2.05, 4, 10, 20} {
		_, p := cell24Result(t, cell24Perspective(0, "crystal", angles, d))
		worst := 0.
		for _, c := range []struct{ got, ort PairPolytope }{{p.Primal, o.Primal}, {p.Dual, o.Dual}} {
			for i := range c.got.Points {
				v := sub(c.got.Points[i], c.ort.Points[i])
				worst = math.Max(worst, math.Sqrt(dot(v, v)))
			}
		}
		if worst > 1/(d-math.Sqrt2) || worst >= previous {
			t.Fatalf("d %g: deviation %g (previous %g)", d, worst, previous)
		}
		previous = worst
	}
	if previous > 0.054 {
		t.Fatal(previous)
	}
}

// Unrotated, ±e_w both project to the origin: distinct dual vertices keep
// their IDs. The eight pairs (x, y, z, ±½) that coincide orthogonally are
// separated by perspective.
func TestCell24PerspectiveCoincidentCenters(t *testing.T) {
	_, p := cell24Result(t, cell24Perspective(0, "crystal", [6]float64{}, 4))
	shadows := map[Vec3][]int{}
	for i, q := range p.Dual.Points {
		shadows[q] = append(shadows[q], i)
	}
	if len(shadows) != 23 {
		t.Fatalf("%d distinct dual shadows", len(shadows))
	}
	ids := shadows[Vec3{}]
	if len(ids) != 2 || p.Dual.Source[ids[0]] == p.Dual.Source[ids[1]] ||
		math.Abs(p.Dual.Source[ids[0]][3]) != 1 || math.Abs(p.Dual.Source[ids[1]][3]) != 1 {
		t.Fatal(ids)
	}
}

// The eye distance is validated in perspective only; an unfinished
// distance does not block the other views.
func TestCell24PerspectiveValidation(t *testing.T) {
	for _, d := range []float64{math.NaN(), math.Inf(1), math.Inf(-1), 2.0499, 20.0001, 0, -4} {
		_, err := Compute(cell24Perspective(0, "cell", [6]float64{}, d))
		var f *FieldError
		if !errors.As(err, &f) || f.Field != "distance" {
			t.Fatalf("d %g: %v", d, err)
		}
	}
	for _, d := range []float64{2.05, 20} {
		compute(t, cell24Perspective(0, "cell", [6]float64{}, d))
	}
	angles := [6]float64{.3, .2, .1, .7, .5, .3}
	for _, mode := range []string{"orthographic", "section"} {
		q := cell24Request(3, "crystal", angles)
		q.Mode, q.Count, q.Spread = mode, 3, 1
		valid := compute(t, q)
		q.Distance = math.NaN()
		inactive := compute(t, q)
		x, _ := json.Marshal(valid)
		y, _ := json.Marshal(inactive)
		if string(x) != string(y) {
			t.Fatalf("%s: an inactive distance changed the result", mode)
		}
	}
	q := cell24Perspective(0, "cell", [6]float64{}, 4)
	q.Angles[1] = math.NaN()
	if _, err := Compute(q); err == nil {
		t.Fatal("NaN angle accepted in perspective")
	}
}

// The orthogonal shadow keeps its framing radius and its points.
func TestCell24OrthogonalUnchangedByPerspective(t *testing.T) {
	r, p := cell24Result(t, cell24Request(5, "crystal", perspectiveAngles[2]))
	if r.Radius != math.Sqrt2 {
		t.Fatal(r.Radius)
	}
	for i, v := range p.Primal.Rotated {
		if p.Primal.Points[i] != (Vec3{v[0], v[1], v[2]}) {
			t.Fatal("orthogonal shadow changed")
		}
	}
}
