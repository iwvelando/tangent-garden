package engine3

import (
	"errors"
	"math"
	"math/rand"
	"testing"
)

// Geodesic polygons on a sphere: shortest great-circle arcs between the
// vertices, closed from the last back to the first. The carried arrow is
// checked against Rodrigues rotations of the arriving vector about each
// side's axis, written out here, and the signed area the engine reports is
// checked against areas found independently: the octant, a lune, and
// Gauss–Bonnet from interior angles measured here for regular polygons and
// stars. The holonomy, measured from the carried vectors, is the signed
// area times the curvature, modulo a whole turn.

// polygonAt is a polygon arrow on a study with threads, at angle alpha
// with the given reference arrows, through vertices (u, v).
func polygonAt(c Request, alpha float64, arrows int, vertices ...[2]float64) Request {
	c = carry(c, "polygon", alpha, arrows)
	tr := *c.Surface.Geodesics.Transport
	tr.Vertices = make([]PolygonVertex, len(vertices))
	for k, v := range vertices {
		tr.Vertices[k] = PolygonVertex{U: v[0], V: v[1]}
	}
	c.Surface.Geodesics.Transport = &tr
	return c
}

// onSphere is the point of the sphere of radius r at longitude u and
// latitude v, written out independently of the engine's chart.
func onSphere(r, u, v float64) Vec3 {
	return Vec3{r * math.Cos(v) * math.Cos(u), r * math.Cos(v) * math.Sin(u), r * math.Sin(v)}
}

// wrapTurn is x reduced into (−π, π].
func wrapTurn(x float64) float64 {
	x = math.Mod(x, 2*math.Pi)
	if x <= -math.Pi {
		x += 2 * math.Pi
	} else if x > math.Pi {
		x -= 2 * math.Pi
	}
	return x
}

// interior is the angle at p between the great-circle directions toward a
// and toward b.
func interior(p, a, b Vec3) float64 {
	n := p.mul(1 / p.norm())
	ta := a.sub(n.mul(a.dot(n)))
	tb := b.sub(n.mul(b.dot(n)))
	return math.Acos(math.Max(-1, math.Min(1, ta.dot(tb)/(ta.norm()*tb.norm()))))
}

// The arrow around a polygon is the vector it arrived with at each corner,
// rotated rigidly about each side's axis; it comes home turned by the
// signed area the path encloses times 1/r², modulo a whole turn, for
// convex, non-convex, self-crossing polygons and ones through a pole.
func TestPolygonHolonomyIsSignedArea(t *testing.T) {
	rng := rand.New(rand.NewSource(395))
	shapes := [][][2]float64{
		{{0, 0}, {math.Pi / 2, 0}, {0, math.Pi / 2}},
		{{0.3, -0.2}, {1.4, 0.1}, {1.1, 0.9}, {0.2, math.Pi / 2}, {-0.6, 0.5}},
		// Through both poles, which are not adjacent.
		{{0, math.Pi / 2}, {0, 0}, {0, -math.Pi / 2}, {2, 0}},
		// Its sides cross.
		{{0, 0.2}, {1.5, -0.3}, {1.5, 0.6}, {0, -0.4}},
	}
	for len(shapes) < 40 {
		n := 3 + rng.Intn(10)
		vs := make([][2]float64, n)
		for k := range vs {
			vs[k] = [2]float64{rng.Float64()*14 - 7, math.Asin(rng.Float64()*2 - 1)}
		}
		shapes = append(shapes, vs)
	}
	for i, vs := range shapes {
		for _, r := range []float64{1, 1.7} {
			alpha := float64(37 * i)
			c := polygonAt(launch(sphere(r, 24, 24), 0.3, 0.2, 10, 0, 1, 1, 300), alpha, 5, vs...)
			g, err := Compute(c)
			if err != nil {
				// A random side can come out too nearly opposite; that is
				// refused and checked below.
				var fe *FieldError
				if !errors.As(err, &fe) || i < 4 {
					t.Fatalf("shape %d: %v", i, err)
				}
				continue
			}
			tr := g.Surface.Geodesics.Transport
			if tr.Path != "polygon" || tr.Unavailable != "" || tr.Reason != "end" || !tr.Returns || tr.Steps != 0 {
				t.Fatalf("shape %d: %s %q %s returns %v after %d steps", i, tr.Path, tr.Unavailable, tr.Reason, tr.Returns, tr.Steps)
			}
			tangentUnit(t, "polygon", tr, func(p Vec3) Vec3 { return p.mul(1 / r) }, 1e-13)
			n := len(vs)
			p := make([]Vec3, n)
			for k, v := range vs {
				p[k] = onSphere(1, v[0], v[1])
			}
			// The sides' lengths and axes, and where each starts.
			starts := []float64{0}
			axes := []Vec3{}
			for k := range p {
				a, b := p[k], p[(k+1)%n]
				w := a.cross(b)
				axes = append(axes, w.mul(1/w.norm()))
				starts = append(starts, starts[k]+r*math.Atan2(w.norm(), a.dot(b)))
			}
			length := starts[n]
			if math.Abs(tr.Length-length) > 1e-13*length || tr.Reached != tr.Length {
				t.Fatalf("shape %d: length %.17g reached %g, want %.17g", i, tr.Length, tr.Reached, length)
			}
			b := alpha * math.Pi / 180
			// At the first vertex the path heads along axis × p₀; N × T is
			// the axis itself.
			t0 := axes[0].cross(p[0])
			v := t0.mul(math.Cos(b)).add(axes[0].mul(math.Sin(b)))
			s := tr.Samples
			side := 0
			for k, arc := range s.Arcs {
				for side < n-1 && arc > starts[side+1]+1e-12*length {
					v = rotate(v, axes[side], (starts[side+1]-starts[side])/r)
					side++
				}
				sigma := arc - starts[side]
				want := rotate(p[side], axes[side], sigma/r).mul(r)
				nearVec(t, "polygon point", s.Points[k], want, 1e-12*r)
				nearVec(t, "polygon tangent", s.Tangents[k], axes[side].cross(want.mul(1/r)), 1e-12)
				nearVec(t, "rigid rotation", s.Vectors[k], rotate(v, axes[side], sigma/r), 1e-12)
			}
			if len(tr.Corners) != n-1 {
				t.Fatalf("shape %d: corners %v for %d vertices", i, tr.Corners, n)
			}
			for j, k := range tr.Corners {
				if math.Abs(s.Arcs[k]-starts[j+1]) > 1e-13*length {
					t.Fatalf("shape %d corner %d at %.17g, want %.17g", i, j, s.Arcs[k], starts[j+1])
				}
				nearVec(t, "corner", s.Points[k], p[j+1].mul(r), 1e-12*r)
				// The arriving side's tangent.
				nearVec(t, "arriving tangent", s.Tangents[k], axes[j].cross(p[j+1]), 1e-12)
			}
			nearVec(t, "home", s.Points[len(s.Points)-1], p[0].mul(r), 1e-12*r)
			if !(tr.Area > -2*math.Pi*r*r && tr.Area <= 2*math.Pi*r*r) {
				t.Fatalf("shape %d: area %g outside (−2πr², 2πr²]", i, tr.Area)
			}
			if d := wrapTurn(tr.Holonomy - tr.Area/(r*r)); math.Abs(d) > 1e-11 {
				t.Fatalf("shape %d r = %g: holonomy %.15g, area/r² %.15g", i, r, tr.Holonomy, tr.Area/(r*r))
			}
			// Reversed, the path encloses the same region the other way.
			rev := make([][2]float64, n)
			for k := range vs {
				rev[k] = vs[n-1-k]
			}
			back := transported(t, polygonAt(launch(sphere(r, 24, 24), 0.3, 0.2, 10, 0, 1, 1, 300), alpha, 0, rev...))
			if d := wrapTurn(back.Holonomy + tr.Holonomy); math.Abs(d) > 1e-11 {
				t.Fatalf("shape %d reversed: holonomy %g against %g", i, back.Holonomy, tr.Holonomy)
			}
			if d := math.Mod(back.Area+tr.Area, 4*math.Pi*r*r); math.Abs(d) > 1e-11*r*r && math.Abs(math.Abs(d)-4*math.Pi*r*r) > 1e-11*r*r {
				t.Fatalf("shape %d reversed: area %g against %g", i, back.Area, tr.Area)
			}
		}
	}
}

// The signed area against areas found without the engine's formula.
func TestPolygonAreaOracles(t *testing.T) {
	const r = 1.3
	area := func(vs ...[2]float64) float64 {
		return transported(t, polygonAt(launch(sphere(r, 24, 24), 0, 0, 0, 0, 1, 1, 60), 0, 0, vs...)).Area
	}
	near := func(what string, got, want float64) {
		t.Helper()
		if math.Abs(got-want) > 1e-12*r*r {
			t.Fatalf("%s: area %.15g, want %.15g", what, got, want)
		}
	}
	// The octant, counterclockwise seen from outside.
	near("octant", area([2]float64{0, 0}, [2]float64{math.Pi / 2, 0}, [2]float64{0, math.Pi / 2}), math.Pi/2*r*r)
	near("octant reversed", area([2]float64{0, math.Pi / 2}, [2]float64{math.Pi / 2, 0}, [2]float64{0, 0}), -math.Pi/2*r*r)
	// A lune between meridians 0 and φ, down one and up the other:
	// 2φr².
	for _, phi := range []float64{0.4, 1.9, 3} {
		near("lune", area([2]float64{0, math.Pi / 2}, [2]float64{0, 0}, [2]float64{0, -math.Pi / 2}, [2]float64{phi, 0}), 2*phi*r*r)
	}
	// A convex polygon through (1, 1, 1)/√3, opposite one of the reference
	// directions the area may be measured from: by Gauss–Bonnet its
	// interior angles less (n − 2)π.
	corner := math.Asin(1 / math.Sqrt(3))
	convex := [][2]float64{{math.Pi / 4, corner}, {1.6, 0.2}, {1.9, 1.1}, {0.5, 1.3}}
	{
		p := make([]Vec3, len(convex))
		for k, v := range convex {
			p[k] = onSphere(1, v[0], v[1])
		}
		want := -float64(len(p)-2) * math.Pi
		for k := range p {
			want += interior(p[k], p[(k+len(p)-1)%len(p)], p[(k+1)%len(p)])
		}
		near("through (1, 1, 1)/√3", area(convex...), want*r*r)
	}
	// A regular n-gon round the pole, and the star {n/m} through the same
	// points: by Gauss–Bonnet the area is 2πm less the turns at the
	// corners, π less each interior angle, all over r².
	for _, star := range []struct{ n, m int }{{3, 1}, {4, 1}, {7, 1}, {12, 1}, {5, 2}, {7, 2}, {7, 3}} {
		for _, lat := range []float64{1.1, 0.6, 0.3} {
			vs := make([][2]float64, star.n)
			p := make([]Vec3, star.n)
			for k := range vs {
				vs[k] = [2]float64{2 * math.Pi * float64(k*star.m) / float64(star.n), lat}
				p[k] = onSphere(1, vs[k][0], vs[k][1])
			}
			want := 2 * math.Pi * float64(star.m)
			for k := range p {
				want -= math.Pi - interior(p[k], p[(k+star.n-1)%star.n], p[(k+1)%star.n])
			}
			want *= r * r
			// Reported within (−2πr², 2πr²]: a whole sphere less.
			if want > 2*math.Pi*r*r {
				want -= 4 * math.Pi * r * r
			}
			near("star", area(vs...), want)
		}
	}
}

// Samples at kL/N with each vertex after the first among them, snapped or
// inserted; reference arrows at jL/M; the arrow's path counts toward the
// fan's points with one point per corner past two.
func TestPolygonSamples(t *testing.T) {
	const r = 1.3
	square := [][2]float64{{0, 0}, {math.Pi / 2, 0}, {math.Pi / 2, math.Pi / 4}, {0, math.Pi / 4}}
	for _, n := range []int{8, 9, 400, 401} {
		tr := transported(t, polygonAt(launch(sphere(r, 24, 24), 0, 0, 0, 0, 1, 1, n), 30, 4, square...))
		if len(tr.Corners) != 3 || tr.Samples.Arcs[0] != 0 || tr.Samples.Arcs[len(tr.Samples.Arcs)-1] != tr.Length {
			t.Fatalf("N = %d: corners %v", n, tr.Corners)
		}
		inserted := len(tr.Samples.Arcs) - (n + 1)
		if inserted < 0 || inserted > 3 {
			t.Fatalf("N = %d: %d samples", n, len(tr.Samples.Arcs))
		}
		for k := 1; k < len(tr.Samples.Arcs); k++ {
			if !(tr.Samples.Arcs[k] > tr.Samples.Arcs[k-1]) {
				t.Fatalf("N = %d: arcs not increasing at %d", n, k)
			}
		}
		if len(tr.References.Arcs) != 4 {
			t.Fatalf("%d references", len(tr.References.Arcs))
		}
		for j, a := range tr.References.Arcs {
			if math.Abs(a-tr.Length*float64(j)/4) > 1e-14*tr.Length {
				t.Fatalf("reference %d at %g", j, a)
			}
		}
	}
	// The points: n(N + 1) + N + 1 + max(2, vertices − 1) at most 200,000,
	// tried where they come to exactly that. 26 threads and the arrow's
	// path of 7,407 points each, with 11 corners, and 17 threads and the
	// path of 11,111 points each, with two.
	twelve := make([][2]float64, 12)
	for k := range twelve {
		twelve[k] = [2]float64{2 * math.Pi * float64(k) / 12, 0.5}
	}
	points := func(count, samples int, vs ...[2]float64) error {
		_, err := Compute(polygonAt(launch(sphere(r, 24, 24), 0, 0, 0, 10, count, 1, samples), 0, 0, vs...))
		return err
	}
	var fe *FieldError
	for _, c := range []struct {
		count, samples int
		vs             [][2]float64
	}{{26, 7406, twelve}, {17, 11110, square[:3]}} {
		if err := points(c.count, c.samples, c.vs...); err != nil {
			t.Fatalf("%d vertices at the cap: %v", len(c.vs), err)
		}
		if err := points(c.count, c.samples+1, c.vs...); !errors.As(err, &fe) || fe.Field != "surface.geodesics.samples" {
			t.Fatalf("%d vertices past the cap: %v", len(c.vs), err)
		}
	}
}

// A polygon needs 3–12 vertices, latitudes within ±π/2, and sides that are
// neither a point nor half a great circle; each refusal names its field. On
// any surface but a sphere the polygon is unavailable and the fan is kept.
func TestPolygonValidation(t *testing.T) {
	ok := [][2]float64{{0, 0}, {1, 0}, {1, 1}, {0, 1}}
	refuse := func(field string, vs ...[2]float64) {
		t.Helper()
		_, err := Compute(polygonAt(launch(sphere(1, 24, 24), 0, 0, 0, 0, 1, 1, 60), 0, 0, vs...))
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != field {
			t.Fatalf("%v: got %v, want a refusal of %s", vs, err, field)
		}
	}
	base := "surface.geodesics.transport.vertices"
	refuse(base, ok[:2]...)
	refuse(base)
	thirteen := make([][2]float64, 13)
	for k := range thirteen {
		thirteen[k] = [2]float64{float64(k) * 0.4, 0}
	}
	refuse(base, thirteen...)
	refuse(base+".2.u", [2]float64{0, 0}, [2]float64{1, 0}, [2]float64{math.NaN(), 1})
	refuse(base+".1.u", [2]float64{0, 0}, [2]float64{2e5, 0}, [2]float64{1, 1})
	refuse(base+".1.v", [2]float64{0, 0}, [2]float64{1, 1.6}, [2]float64{1, 1})
	refuse(base+".0.v", [2]float64{0, math.Inf(-1)}, [2]float64{1, 0}, [2]float64{1, 1})
	// Coincident neighbors, also by a whole turn of u or at a pole.
	refuse(base+".2.u", [2]float64{0, 0}, [2]float64{1, 0}, [2]float64{1 + 2*math.Pi, 0}, [2]float64{0, 1})
	refuse(base+".1.u", [2]float64{0, math.Pi / 2}, [2]float64{3, math.Pi / 2}, [2]float64{1, 0})
	// The closing side, from the last vertex back to the first.
	refuse(base+".0.u", [2]float64{0, 0.5}, [2]float64{1, 0}, [2]float64{5e-7, 0.5})
	// Opposite neighbors.
	refuse(base+".1.u", [2]float64{0, 0}, [2]float64{math.Pi, 0}, [2]float64{1, 1})
	refuse(base+".0.u", [2]float64{0, -math.Pi / 2}, [2]float64{1, 0}, [2]float64{2, math.Pi / 2})
	refuse(base+".1.u", [2]float64{0, 0.3}, [2]float64{math.Pi + 1e-7, -0.3}, [2]float64{1, 1})
	// Just inside the limits.
	for _, vs := range [][][2]float64{
		{{0, 0}, {math.Pi - 2e-6, 0}, {1, 1}},
		{{0, 0}, {2e-6, 0}, {1e-6, 1e-6}},
	} {
		if _, err := Compute(polygonAt(launch(sphere(1, 24, 24), 0, 0, 0, 0, 1, 1, 60), 0, 0, vs...)); err != nil {
			t.Fatalf("%v: %v", vs, err)
		}
	}
	// A path that is not a polygon ignores the vertices.
	c := polygonAt(launch(sphere(1, 24, 24), 0, 0, 0, 0, 1, 1, 60), 0, 0, ok[:2]...)
	c.Surface.Geodesics.Transport.Path = "thread"
	if _, err := Compute(c); err != nil {
		t.Fatal(err)
	}
	for _, other := range []Request{torusPatch(2, 0.8, 24, 24), ellipsoid(1.4, 1, 0.7), cylinderStudy(1, 1, 0, 2*math.Pi, -1, 1)} {
		g := threads(t, polygonAt(launch(other, 0, 0, 0, 30, 4, 1, 60), 0, 0, ok...))
		if g.Transport == nil || g.Transport.Unavailable == "" || len(g.Transport.Samples.Points) != 0 || len(g.Threads) != 4 {
			t.Fatalf("%s: a polygon off a sphere: %+v", other.Surface.Kind, g.Transport)
		}
	}
}
