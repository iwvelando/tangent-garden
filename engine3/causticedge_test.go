package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// withCausticEdges asks for the caustics' cuspidal edges.
func withCausticEdges(c Request) Request {
	c.Rays.Edges = true
	return c
}

// along returns the parameter step w with Āw = e, which moves the ray's
// foot across R by the unit vector e across R (see fold): ĀᵀĀ is the
// metric of X_u and X_v with their parts along R taken out.
func along(q SurfaceRequest, u, v float64, R, e Vec3) [2]float64 {
	_, xu, xv, _, _, _ := q.patch(u, v)
	pu, pv := xu.sub(R.mul(R.dot(xu))), xv.sub(R.mul(R.dot(xv)))
	g := [2][2]float64{{pu.dot(pu), pu.dot(pv)}, {pu.dot(pv), pv.dot(pv)}}
	det := g[0][0]*g[1][1] - g[0][1]*g[0][1]
	eu, ev := xu.dot(e), xv.dot(e)
	return [2]float64{(g[1][1]*eu - g[0][1]*ev) / det, (g[0][0]*ev - g[0][1]*eu) / det}
}

// differencedFold is μ² R·C_w, with branch k's caustic point C differenced
// along w on the mirror, independently of fold's exact derivatives.
func differencedFold(q SurfaceRequest, r RaysRequest, u, v float64, k int) float64 {
	p := q.ray(r, u, v, 1)
	w := along(q, u, v, p.R, p.Dir[k])
	const h = 1e-5
	plus := q.ray(r, u+h*w[0], v+h*w[1], 1).caustic(k)
	minus := q.ray(r, u-h*w[0], v-h*w[1], 1).caustic(k)
	return p.Mu[k] * p.Mu[k] * p.R.dot(plus.sub(minus).mul(1/(2*h)))
}

// A circular cylinder of radius R lit on its inside by parallel light
// slanting down at β, travelling along −y, reflects every section's light
// into the section's nephroid, swept along z: its rays are unchanged by
// sliding along the axis, so they meet across it only at infinity (branch
// 2), and branch 1 is the nephroid's sheet, which folds back over the
// nephroid's cusp. That cusp is the paraxial focus of the ray meeting the
// wall head on, at u = 3π/2, R/2 from the wall in the section; along the
// slanting ray it is (R/2)/cos β away, so the edge is the line
// (0, −R/2, v + (R/2) tan β). The domain starts off π so that the edge
// does not run along a grid line.
func TestCylinderCausticFoldsOverItsNephroidsCusp(t *testing.T) {
	const R, beta = 1.5, -25.0
	c := withCausticEdges(inside(mirror("cylinder", R, R, 0, math.Pi+0.01, 2*math.Pi+0.01, -0.5, 0.5, 96, 12, parallel(-90, beta))))
	r := rayed(t, c)
	if r.Edges == nil || len(*r.Edges) != 1 {
		t.Fatalf("edges %v, want the one over the cusp", r.Edges)
	}
	e := (*r.Edges)[0]
	if e.Branch != 1 || e.Closed || e.Virtual || len(e.Points) != 13 || len(e.I) != 13 || len(e.J) != 13 {
		t.Fatalf("branch %d, closed %v, virtual %v, %d points; want a real, open edge of branch 1 on each of 13 rows", e.Branch, e.Closed, e.Virtual, len(e.Points))
	}
	if len(e.Feet) != 13 {
		t.Fatalf("%d feet, want one for each point", len(e.Feet))
	}
	tan := math.Tan(beta * math.Pi / 180)
	u, v := params(c.Surface, e)
	for m, p := range e.Points {
		if math.Abs(u[m]-3*math.Pi/2) > 1e-9 {
			t.Fatalf("edge point %d at u = %v, not 3π/2", m, u[m])
		}
		want := Vec3{0, -R / 2, v[m] + R/2*tan}
		if p.sub(want).norm() > 1e-9 {
			t.Fatalf("edge point %d at %v, not the cusp's %v", m, p, want)
		}
		if foot := (Vec3{0, -R, v[m]}); e.Feet[m].sub(foot).norm() > 1e-9 {
			t.Fatalf("edge point %d's foot %v, not the wall's %v", m, e.Feet[m], foot)
		}
	}
}

// fold, differentiated exactly, matches the caustic point differenced
// along its own direction on the mirror and changes sign with it, under
// both kinds of light, reflecting and refracting, on every kind of patch.
func TestFoldIsTheCausticDifferencedAlongItsDirection(t *testing.T) {
	for _, c := range []Request{
		mirror("ellipsoid", 1.5, 1, .7, .2, 2.5, -1.2, .4, 36, 24, lamp(Vec3{.3, .2, 2})),
		inside(mirror("ellipsoid", 1.5, 1, .7, 0, 2*math.Pi, -1.4, 1.4, 36, 24, lamp(Vec3{.4, -.2, .3}))),
		mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 48, 24, parallel(25, -60)),
		mirror("paraboloid", .5, .3, 0, -1.5, 1.5, -1.5, 1.5, 24, 24, parallel(10, -70)),
		inside(mirror("cylinder", 1.4, .8, 0, 0, 2*math.Pi, -1, 1, 36, 12, lamp(Vec3{.3, -.2, .5}))),
		mirror("monkey", .4, 0, 0, -1, 1, -1, 1, 24, 24, parallel(10, -80)),
		glass(mirror("ellipsoid", 1.5, 1.2, 1, 0, 2*math.Pi, .05, 1.5, 36, 24, parallel(20, -75)), 1, 1.5),
		glass(mirror("paraboloid", .6, -.4, 0, -1, 1, -1, 1, 24, 24, lamp(Vec3{.2, .1, 1.5})), 1, 1.33),
		glass(inside(mirror("ellipsoid", 1.2, 1, .9, 0, 2*math.Pi, .2, 1.5, 36, 24, lamp(Vec3{.1, .2, -.3}))), 1.5, 1),
	} {
		q, light := c.Surface, c.Rays
		checked := 0
		// Points spread over the domain, off its grid lines.
		for n := range 49 {
			u := q.UMin + (float64(n%7)+.37)/7*(q.UMax-q.UMin)
			v := q.VMin + (float64(n/7)+.61)/7*(q.VMax-q.VMin)
			p := q.ray(light, u, v, 1)
			if !p.traced() || p.Stigmatic {
				continue
			}
			for k := range 2 {
				if math.Abs(p.Mu[k]) < 1e-3 {
					continue
				}
				got, want := q.fold(light, u, v, p, k), differencedFold(q, light, u, v, k)
				size := p.Mu[0]*p.Mu[0] + p.Mu[1]*p.Mu[1]
				if math.Abs(got-want) > 1e-6*(size+math.Abs(want)) {
					t.Fatalf("%s %s at (%v, %v) branch %d: fold %v, differenced %v", q.Kind, light.Interaction, u, v, k+1, got, want)
				}
				p.Dir[k] = p.Dir[k].mul(-1)
				if flipped := q.fold(light, u, v, p, k); flipped != -got {
					t.Fatalf("%s at (%v, %v) branch %d: fold along −e %v, not −%v", q.Kind, u, v, k+1, flipped, got)
				}
				p.Dir[k] = p.Dir[k].mul(-1)
				checked++
			}
		}
		if checked < 4 {
			t.Fatalf("%s %s: %d points checked", q.Kind, light.Interaction, checked)
		}
	}
}

// Every point of a caustic's cuspidal edge is a fold: the caustic point,
// differenced along its own direction on the mirror, does not move along
// its ray, against its motion elsewhere. Each edge is wholly real or
// wholly virtual, as its points' μ says, and lies on its branch's caustic.
// This holds for coma, where a tilted paraboloid's caustic folds, a lamp
// inside and outside an ellipsoid, on a fine grid and a coarse one, a
// torus, and refraction.
func TestCausticEdgePointsAreFolds(t *testing.T) {
	for _, c := range []Request{
		mirror("paraboloid", .5, .5, 0, -1.6, 1.6, -1.6, 1.6, 72, 72, parallel(0, -70)),
		inside(mirror("ellipsoid", 1.5, 1, .7, 0.05, 0.05+2*math.Pi, -math.Pi/2, math.Pi/2, 72, 72, lamp(Vec3{.4, .2, .1}))),
		// Coarse, so that neighboring crossings straddle a caustic at
		// infinity, on its real side and its virtual one.
		inside(mirror("ellipsoid", 1.5, 1, .7, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 24, 24, lamp(Vec3{.4, .2, .1}))),
		mirror("ellipsoid", 1.5, 1, .7, 0.05, 0.05+2*math.Pi, -math.Pi/2, math.Pi/2, 72, 72, lamp(Vec3{2.5, 1, 1.5})),
		inside(mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 72, 48, parallel(25, -60))),
		glass(mirror("ellipsoid", 1.5, 1.2, 1, 0, 2*math.Pi, .05, math.Pi/2, 72, 48, parallel(20, -60)), 1, 1.5),
	} {
		q, light := c.Surface, c.Rays
		r := rayed(t, withCausticEdges(c))
		if r.Edges == nil || len(*r.Edges) == 0 {
			t.Fatalf("%s %s: no edges", q.Kind, light.Interaction)
		}
		size := 0.0
		for i := 0; i <= q.USamples; i += 3 {
			for j := 0; j <= q.VSamples; j += 3 {
				u, v := q.at(i, j)
				if p := q.ray(light, u, v, 1); p.traced() && !p.Stigmatic {
					for k := range 2 {
						size = math.Max(size, math.Abs(differencedFold(q, light, u, v, k))/(p.Mu[0]*p.Mu[0]+p.Mu[1]*p.Mu[1]))
					}
				}
			}
		}
		for n, e := range *r.Edges {
			us, vs := params(q, e)
			for m, x := range e.Points {
				k := e.Branch - 1
				p := q.ray(light, us[m], vs[m], 1)
				if (p.Mu[k] < 0) != e.Virtual {
					t.Fatalf("%s: edge %d point %d has μ %v, virtual %v", q.Kind, n, m, p.Mu[k], e.Virtual)
				}
				if x.sub(p.caustic(k)).norm() > 1e-9*(1+x.norm()) {
					t.Fatalf("%s: edge %d point %d at %v, off its caustic %v", q.Kind, n, m, x, p.caustic(k))
				}
				if d := differencedFold(q, light, us[m], vs[m], k) / (p.Mu[0]*p.Mu[0] + p.Mu[1]*p.Mu[1]); math.Abs(d) > 1e-6*size {
					t.Fatalf("%s %s: edge %d point %d at (%v, %v): fold differenced %v, against %v elsewhere", q.Kind, light.Interaction, n, m, us[m], vs[m], d, size)
				}
			}
		}
	}
}

// A convex mirror lit from outside only appears to gather its light
// behind itself: every edge it has is virtual.
func TestConvexMirrorEdgesAreVirtual(t *testing.T) {
	r := rayed(t, withCausticEdges(mirror("ellipsoid", 1.5, 1, .7, 0.05, 0.05+2*math.Pi, -math.Pi/2, math.Pi/2, 72, 72, lamp(Vec3{2.5, 1, 1.5}))))
	if len(*r.Edges) == 0 {
		t.Fatal("no edges")
	}
	for k, e := range *r.Edges {
		if !e.Virtual {
			t.Fatalf("edge %d is real", k)
		}
	}
}

// Edges are found only when asked for, and a study asking whose caustics
// are not surfaces (a plane mirror's virtual image, a point) has none.
func TestCausticEdgesAreOptIn(t *testing.T) {
	c := mirror("paraboloid", .5, .5, 0, -1.6, 1.6, -1.6, 1.6, 48, 48, parallel(0, -70))
	r := rayed(t, c)
	if r.Edges != nil {
		t.Fatalf("%d edges unasked", len(*r.Edges))
	}
	encoded, _ := json.Marshal(r)
	if strings.Contains(string(encoded), `"edges"`) || strings.Contains(string(encoded), `"virtual":true,"points"`) {
		t.Fatal("the result encodes edges unasked")
	}
	plane := withCausticEdges(mirror("paraboloid", 0, 0, 0, -1, 1, -1, 1, 24, 24, lamp(Vec3{0, 0, 1})))
	r = rayed(t, plane)
	if r.Edges == nil || len(*r.Edges) != 0 {
		t.Fatalf("a plane mirror has edges %v, want an empty list", r.Edges)
	}
	encoded, _ = json.Marshal(r)
	if !strings.Contains(string(encoded), `"edges":[]`) {
		t.Fatal("a plane mirror encodes no empty list of edges")
	}
}

// A dish cut from the ellipsoid (1.5, b, 1) within 47° of its lowest
// point, lit straight down on its inside, is symmetric in the planes x = 0
// and y = 0, so its caustics fold over them: by symmetry the ray from a
// foot in either plane stays in it, and its caustic point is stationary
// across the plane. Caustic 1 folds over y = 0 and caustic 2 over x = 0,
// each split by the pole, where the chart has no normal. From b ≈ 1.03
// the reflected wavefront has two stigmatic points on y = 0, where the
// sheets touch; past each, toward the rim, the fold over y = 0 belongs to
// caustic 2, as a ridge passes from κ₁ to κ₂ at an umbilic.
func TestDishCausticsFoldOverItsPlanesOfSymmetry(t *testing.T) {
	for _, tc := range []struct {
		b            float64
		over, beyond int
	}{{1, 2, 0}, {1.2, 2, 2}} {
		c := withCausticEdges(inside(mirror("ellipsoid", 1.5, tc.b, 1, 0, 2*math.Pi, -math.Pi/2, -0.75, 120, 60, parallel(0, -90))))
		r := rayed(t, c)
		over, beyond := 0, 0
		for k, e := range *r.Edges {
			// The plane each lies over, and on.
			inX, inY := true, true
			for m, p := range e.Points {
				f := e.Feet[m]
				inX = inX && math.Abs(f.X) < 1e-12 && math.Abs(p.X) < 1e-12
				inY = inY && math.Abs(f.Y) < 1e-12 && math.Abs(p.Y) < 1e-12
			}
			switch {
			case e.Virtual || e.Closed:
				t.Fatalf("b = %v: edge %d virtual %v, closed %v", tc.b, k, e.Virtual, e.Closed)
			case e.Branch == 1 && inY:
				over++
			case e.Branch == 2 && inX:
				over++
			case e.Branch == 2 && inY:
				// Beyond a stigmatic point, toward the rim.
				if e.J[0] < 50 && e.J[len(e.J)-1] < 50 {
					t.Fatalf("b = %v: caustic 2's edge %d over y = 0 does not reach the rim", tc.b, k)
				}
				beyond++
			default:
				t.Fatalf("b = %v: edge %d of caustic %d lies over neither plane", tc.b, k, e.Branch)
			}
		}
		if over != 2*tc.over || beyond != tc.beyond {
			t.Fatalf("b = %v: %d edges over their own planes and %d beyond a stigmatic point, want %d and %d", tc.b, over, beyond, 2*tc.over, tc.beyond)
		}
	}
}

// A sphere of radius R lit on its inside by a lamp at distance s from its
// center is symmetric about the line through both, so its caustics are
// surfaces of revolution about it: caustic 2 is a stretch of that axis,
// and caustic 1 folds back along one circle about it. The wavefront is
// stigmatic where the axis meets the sphere, at (±R, 0, 0), which are
// samples here (the second twice, across the seam); there the principal
// directions are arbitrary, so no edge point lies on a grid edge from
// either.
func TestSphereCausticFoldsInACircleAboutItsLampsAxis(t *testing.T) {
	const R = 1.5
	c := withCausticEdges(inside(mirror("ellipsoid", R, R, R, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 48, 24, lamp(Vec3{.6, 0, 0}))))
	r := rayed(t, c)
	if r.Stigmatic != 3 {
		t.Fatalf("%d stigmatic samples, want 3", r.Stigmatic)
	}
	if len(*r.Edges) != 1 {
		t.Fatalf("%d edges, want one circle", len(*r.Edges))
	}
	e := (*r.Edges)[0]
	if e.Branch != 1 || !e.Closed || e.Virtual || len(e.Points) < 24 {
		t.Fatalf("branch %d, closed %v, virtual %v, %d points; want a real closed edge of caustic 1", e.Branch, e.Closed, e.Virtual, len(e.Points))
	}
	first := e.Points[0]
	for m, p := range e.Points {
		if math.Abs(p.X-first.X) > 1e-9 || math.Abs(math.Hypot(p.Y, p.Z)-math.Hypot(first.Y, first.Z)) > 1e-9 {
			t.Fatalf("edge point %d at %v, off the circle through %v", m, p, first)
		}
	}
	for m := range e.I {
		for _, at := range [][2]float64{{0, 12}, {24, 12}, {48, 12}} {
			di, dj := math.Abs(e.I[m]-at[0]), math.Abs(e.J[m]-at[1])
			if di < 1 && dj == 0 || dj < 1 && di == 0 {
				t.Fatalf("edge point %d at (%v, %v) lies on a grid edge from the stigmatic sample %v", m, e.I[m], e.J[m], at)
			}
		}
	}
}
