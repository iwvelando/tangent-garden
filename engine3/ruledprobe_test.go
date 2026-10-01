package engine3

import (
	"math"
	"testing"
)

// probeColumn is the column of a ruled probe's grid nearest to u.
func probeColumn(d *SurfaceDiagnostics, u float64) int {
	best := 0
	for k, v := range d.V {
		if math.Abs(v-u) < math.Abs(d.V[best]-u) {
			best = k
		}
	}
	return best
}

// relative checks got against want to a relative tolerance, or an
// absolute one where want is 0.
func relative(t *testing.T, what string, got *float64, want, tol float64) {
	t.Helper()
	if want != 0 {
		tol *= math.Abs(want)
	}
	closeTo(t, what, got, want, tol)
}

// A custom curve's r‴ comes from central differences of its r″ at a step
// of 5·10⁻⁴ of the domain, so curvatures that need it agree with closed
// forms to about this relative tolerance.
const differenced = 5e-5

// The tangent developable r + uT of a helix of radius a and pitch b, with
// the drawn normal sign(u)·B, has κ = 0 along each ruling, whose centre is
// at infinity, and κ = τ/(κ_c|u|) = b/(a|u|) across it, in the direction of
// the principal normal; its Gaussian curvature vanishes. The grid leaves out
// u = 0, the edge of regression, where the surface is singular: its columns
// are ±L·k/12 for k = 1…12.
func TestDevelopableProbeOnHelix(t *testing.T) {
	const a, b = 2.0, 1.0 / 3
	c := custom("2*cos(t)", "2*sin(t)", "t/3", -2*math.Pi, 2*math.Pi)
	_, d := probed(t, c)
	if d.Kind != "developable" || d.Periodic {
		t.Fatalf("kind %q periodic %v", d.Kind, d.Periodic)
	}
	if len(d.V) != 24 {
		t.Fatalf("%d columns", len(d.V))
	}
	for k := 0; k < 12; k++ {
		want := c.Length * float64(12-k) / 12
		if math.Abs(d.V[k]+want) > 1e-15 || math.Abs(d.V[23-k]-want) > 1e-15 {
			t.Fatalf("columns %d and %d at %g and %g, want ∓%g", k, 23-k, d.V[k], d.V[23-k], want)
		}
	}
	regular := 0
	for row, s := range d.U {
		r := Vec3{a * math.Cos(s), a * math.Sin(s), b * s}
		T := Vec3{-a * math.Sin(s), a * math.Cos(s), b}.unit()
		N := Vec3{-math.Cos(s), -math.Sin(s), 0}
		B := T.cross(N)
		for k, u := range d.V {
			near(t, d.Points[row][k], r.add(T.mul(u)), 1e-9)
			regular++
			near(t, d.Normals[row][k], B.mul(math.Copysign(1, u)), 1e-7)
			closeTo(t, "κ along the ruling", d.Curvature[0][row][k], 0, 1e-6)
			relative(t, "κ across the ruling", d.Curvature[1][row][k], b/(a*math.Abs(u)), differenced)
			if e := d.Direction[0][row][k]; e == nil || math.Abs(math.Abs(e.dot(T))-1) > 1e-7 {
				t.Fatalf("row %d column %d: direction along the ruling %v, want ±T", row, k, e)
			}
			if e := d.Direction[1][row][k]; e == nil || math.Abs(math.Abs(e.dot(N))-1) > 1e-7 {
				t.Fatalf("row %d column %d: direction across the ruling %v, want ±N", row, k, e)
			}
			if d.Focal[0][row][k] != nil {
				t.Fatalf("row %d column %d: a finite centre along the ruling", row, k)
			}
			kappa := b / (a * math.Abs(u))
			near(t, d.Focal[1][row][k], r.add(T.mul(u)).add(B.mul(math.Copysign(1/kappa, u))), differenced/kappa)
		}
	}
	if d.Singular != 0 || d.Unknown != 0 || d.Umbilics != 0 || d.Clipped[0] != regular || d.Clipped[1] != 0 {
		t.Fatalf("singular %d unknown %d umbilics %d clipped %v; want %d clipped", d.Singular, d.Unknown, d.Umbilics, d.Clipped, regular)
	}
}

// A torus knot's developable uses the knot's analytic third derivative:
// the curvature across each ruling is τ/(κ_c|u|), with the knot's own
// curvature and torsion, and K vanishes everywhere.
func TestDevelopableProbeOnKnot(t *testing.T) {
	c := study()
	c.Diagnostics = true
	r, d := probed(t, c)
	curve := r.Diagnostics
	if !d.closed {
		t.Fatal("a knot's developable is closed")
	}
	checked := 0
	eachProbed(d, func(row, k int, x, n Vec3, kappa [2]*float64) {
		i, u := d.Along[row], d.V[k]
		if curve.Torsion[i] == nil || curve.Curvature[i] == nil {
			return
		}
		checked++
		closeTo(t, "κ along the ruling", kappa[0], 0, 1e-9)
		relative(t, "κ across the ruling", kappa[1], *curve.Torsion[i]/(*curve.Curvature[i]*math.Abs(u)), 1e-9)
	})
	if checked < (len(d.U)-1)*len(d.V) {
		t.Fatalf("only %d points checked", checked)
	}
}

// The developable of a plane curve is flat: every regular point is a flat
// umbilic, with both curvatures zero and both centres at infinity.
func TestDevelopableProbeOfPlaneCurveIsFlat(t *testing.T) {
	_, d := probed(t, custom("cos(t)", "2*sin(t)", "0", 0, 2*math.Pi))
	points := 0
	eachProbed(d, func(row, k int, x, n Vec3, kappa [2]*float64) {
		points++
		closeTo(t, "κ along", kappa[0], 0, 1e-6)
		closeTo(t, "κ across", kappa[1], 0, 1e-6)
		if d.Direction[0][row][k] != nil || d.Direction[1][row][k] != nil {
			t.Fatalf("row %d column %d: a principal direction at a flat umbilic", row, k)
		}
	})
	if points == 0 || d.Umbilics != points || d.Clipped != [2]int{points, points} {
		t.Fatalf("%d points, %d umbilics, clipped %v", points, d.Umbilics, d.Clipped)
	}
}

// Where the curve straightens momentarily, r′ × r″ = 0 and the whole ruling
// is singular: (t, t³, t⁴) at t = 0.
func TestDevelopableProbeSingularAtInflection(t *testing.T) {
	_, d := probed(t, custom("t", "t^3", "t^4", -1, 1))
	row := -1
	for r, s := range d.U {
		if s == 0 {
			row = r
		}
	}
	if row < 0 {
		t.Fatal("no row at t = 0")
	}
	for k := range d.V {
		if d.Points[row][k] == nil || d.Normals[row][k] != nil {
			t.Fatalf("column %d at the inflection: point %v normal %v", k, d.Points[row][k], d.Normals[row][k])
		}
	}
}

// Rigid motions and regular reparameterization do not change the
// curvatures at corresponding points.
func TestDevelopableProbeIsGeometric(t *testing.T) {
	_, base := probed(t, custom("2*cos(t)", "2*sin(t)", "t/3", 0, 4))
	// A rotation about x by 90° and a translation, then t = 2s.
	_, moved := probed(t, custom("2*cos(2*t) + 1", "-2*t/3 - 2", "2*sin(2*t) + 5", 0, 2))
	for row := range base.U {
		for k := range base.V {
			for b := 0; b < 2; b++ {
				p, q := base.Curvature[b][row][k], moved.Curvature[b][row][k]
				if (p == nil) != (q == nil) {
					t.Fatalf("row %d column %d branch %d: known %v and %v", row, k, b, p != nil, q != nil)
				}
				if p != nil {
					closeTo(t, "moved κ", q, *p, differenced*math.Abs(*p)+1e-12)
				}
			}
		}
	}
}

// ribbon is a framed ribbon of half-width w on the curve, with a frame of
// the given kind, θ₀ = angle and twist turns.
func ribbon(c Request, kind string, reference Vec3, angle, twist, w float64) Request {
	c.Construction = "framed"
	c.Frame = FrameRequest{Kind: kind, Reference: reference, Angle: angle, Twist: twist, Width: w, Closure: "seam"}
	return c
}

// gaussVanishes checks that K = κ₁κ₂ vanishes against the larger curvature.
func gaussVanishes(t *testing.T, d *SurfaceDiagnostics, tol float64) int {
	t.Helper()
	checked := 0
	eachProbed(d, func(row, k int, x, n Vec3, kappa [2]*float64) {
		if kappa[0] == nil || kappa[1] == nil {
			t.Fatalf("row %d column %d: unknown curvature", row, k)
		}
		big := math.Max(math.Abs(*kappa[0]), math.Abs(*kappa[1]))
		if math.Abs(*kappa[0]**kappa[1]) > tol*big*big {
			t.Fatalf("row %d column %d: K = %g with κ %g, %g", row, k, *kappa[0]**kappa[1], *kappa[0], *kappa[1])
		}
		checked++
	})
	return checked
}

// A rotation-minimizing frame turns only toward the tangent, D′ ∥ T, so
// det(r′, D, D′) = 0: an untwisted rotation-minimizing ribbon is
// developable, on a helix and around a knot.
func TestUntwistedRibbonProbeIsDevelopable(t *testing.T) {
	for _, c := range []Request{
		ribbon(custom("2*cos(t)", "2*sin(t)", "t/3", 0, 8), "rotation-minimizing", Vec3{0, 0, 1}, 0.4, 0, 0.6),
		ribbon(study(), "rotation-minimizing", Vec3{0, 0, 1}, 1.1, 0, 0.35),
	} {
		_, d := probed(t, c)
		if d.Kind != "framed" || d.V[0] != -c.Frame.Width || d.V[ruledColumns] != c.Frame.Width {
			t.Fatalf("kind %q, columns %g to %g", d.Kind, d.V[0], d.V[ruledColumns])
		}
		if n := gaussVanishes(t, d, 1e-5); n < len(d.U)*len(d.V)/2 {
			t.Fatalf("only %d points checked", n)
		}
	}
}

// On a helix of radius a and pitch b, a ribbon along the principal normal
// N = −(cos t, sin t, 0) is the helicoid ((a − u) cos t, (a − u) sin t, bt),
// a minimal surface: with ρ = a − u, κ = ±b/(b² + ρ²), so H = 0 and
// K = −b²/(b² + ρ²)². A Frenet ribbon with θ = 0 gives it, and so does a
// rotation-minimizing one started along N and twisted at the torsion,
// Twist = τL/2π. The drawn normal is D × S_t.
func TestHelixRibbonProbeIsHelicoid(t *testing.T) {
	const a, b, lo, hi = 2.0, 1.0 / 3, 0.0, 8.0
	tau, length := b/(a*a+b*b), math.Hypot(a, b)*(hi-lo)
	helix := custom("2*cos(t)", "2*sin(t)", "t/3", lo, hi)
	for _, c := range []Request{
		ribbon(helix, "frenet", Vec3{}, 0, 0, 0.8),
		ribbon(helix, "rotation-minimizing", Vec3{-1, 0, 0}, 0, tau*length/(2*math.Pi), 0.8),
	} {
		_, d := probed(t, c)
		tol := differenced
		if c.Frame.Kind != "frenet" {
			tol = 1e-4 // the transported frame is itself second order
		}
		points := 0
		eachProbed(d, func(row, k int, x, n Vec3, kappa [2]*float64) {
			s, u := d.U[row], d.V[k]
			rho := a - u
			near(t, x, Vec3{rho * math.Cos(s), rho * math.Sin(s), b * s}, tol)
			want := b / (b*b + rho*rho)
			if kappa[0] != nil {
				relative(t, c.Frame.Kind+" κ₁", kappa[0], want, tol)
				relative(t, c.Frame.Kind+" κ₂", kappa[1], -want, tol)
			}
			// D × S_t, with D = N and S_t = (−ρ sin t, ρ cos t, b).
			drawn := Vec3{-math.Cos(s), -math.Sin(s), 0}.cross(Vec3{-rho * math.Sin(s), rho * math.Cos(s), b}).unit()
			near(t, n, drawn, tol)
			points++
		})
		// A Frenet ribbon needs τ′, differenced from τ; at the domain's ends
		// the one-sided r‴ shifts τ, the two steps disagree and κ is
		// unknown there rather than wrong.
		unknown := 0
		if c.Frame.Kind == "frenet" {
			for row := range d.U {
				for k := range d.V {
					if d.Curvature[0][row][k] == nil {
						if row != 0 && row != len(d.U)-1 {
							t.Fatalf("frenet row %d column %d: unknown inside the domain", row, k)
						}
						unknown++
					}
				}
			}
		}
		if points != len(d.U)*len(d.V) || d.Unknown != unknown || d.Singular+d.Umbilics != 0 {
			t.Fatalf("%s: %d points; singular %d unknown %d (want %d) umbilics %d", c.Frame.Kind, points, d.Singular, d.Unknown, unknown, d.Umbilics)
		}
	}
}

// A Frenet ribbon around a knot uses the knot's analytic r‴, so τ′ is
// found everywhere, and Ω = τ + 2π·Twist/L: at the spine K = −Ω².
func TestFrenetRibbonProbeOnKnot(t *testing.T) {
	c := ribbon(study(), "frenet", Vec3{}, 0.5, 1, 0.3)
	c.Diagnostics = true
	r, d := probed(t, c)
	if d.Unknown != 0 || d.Singular != 0 {
		t.Fatalf("unknown %d singular %d", d.Unknown, d.Singular)
	}
	spine := probeColumn(d, 0)
	for row := range d.U {
		i := d.Along[row]
		omega := *r.Diagnostics.Torsion[i] + 2*math.Pi*c.Frame.Twist/r.Frame.Length
		gauss := *d.Curvature[0][row][spine] * *d.Curvature[1][row][spine]
		relative(t, "K at the spine", &gauss, -omega*omega, 1e-6)
	}
}

// At the spine u = 0, K = −Ω², where Ω is the rate at which D turns about
// T in arc length: for a rotation-minimizing frame, (2π·Twist +
// Correction)/L, including the correction distributed around a closed
// loop.
func TestTwistedRibbonProbeSpine(t *testing.T) {
	for _, closure := range []string{"seam", "distribute"} {
		c := ribbon(study(), "rotation-minimizing", Vec3{0, 0, 1}, 0.3, 2, 0.35)
		c.Frame.Closure = closure
		r, d := probed(t, c)
		f := r.Frame
		if closure == "distribute" && f.Correction == 0 {
			t.Fatal("no correction to distribute")
		}
		omega := (2*math.Pi*c.Frame.Twist + f.Correction) / f.Length
		// The ribbon closes only where the frame returns: distributed, not
		// left at a seam, where the last row is counted on its own.
		if d.closed != (closure == "distribute") || (f.Seam == nil) != d.closed {
			t.Fatalf("%s: closed %v with seam %v", closure, d.closed, f.Seam)
		}
		spine := probeColumn(d, 0)
		for row := range d.U {
			k0, k1 := d.Curvature[0][row][spine], d.Curvature[1][row][spine]
			if k0 == nil || k1 == nil {
				t.Fatalf("%s row %d: unknown at the spine", closure, row)
			}
			gauss := *k0 * *k1
			relative(t, closure+" K at the spine", &gauss, -omega*omega, 1e-6)
		}
	}
}

// Without a ribbon there is no surface to probe.
func TestNarrowRibbonHasNoProbe(t *testing.T) {
	c := ribbon(study(), "rotation-minimizing", Vec3{0, 0, 1}, 0, 1, 0)
	c.Frame.Offset, c.Frame.Strands = 0.4, 3
	c.SurfaceDiagnostics = true
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Probe != nil {
		t.Fatal("a probe without a ribbon")
	}
}

// The analytic r⁗ of a knot and a harmonic curve agree with central
// differences of their analytic r‴, and the error falls fourfold as the
// step halves.
func TestAnalyticSnap(t *testing.T) {
	knotted := study()
	harmonic := harmonicStudy(0, 2*math.Pi, Vec3{1, 2, 3}, HarmonicTerm{1, Vec3{1, 0, 0}, Vec3{0, 1, 0.5}}, HarmonicTerm{3, Vec3{0, 0.3, 0}, Vec3{0.2, 0, 0}})
	for _, c := range []Request{knotted, harmonic} {
		third := func(s float64) Vec3 {
			if c.Format == "harmonic" {
				return harmonicJerk(c.Harmonic, s)
			}
			return knotJerk(c, s)
		}
		fourth := snap(c)
		for _, s := range []float64{0.1, 1.3, 4.4} {
			err := func(h float64) float64 {
				d := third(s + h).sub(third(s - h)).mul(1 / (2 * h))
				return d.sub(fourth(s)).norm()
			}
			e1, e2 := err(1e-3), err(5e-4)
			if !(e2 < 1e-4*math.Max(1, fourth(s).norm())) || !(e1/e2 > 3.5 && e1/e2 < 4.5) {
				t.Fatalf("%q t = %g: errors %g, %g", c.Format, s, e1, e2)
			}
		}
	}
	if snap(custom("t", "t", "t", 0, 1)) != nil {
		t.Fatal("a custom curve has no analytic r⁗")
	}
}

// quadric gives the Gaussian and mean curvatures of the level set F = 0 at
// a point with gradient g and diagonal Hessian h, independently of any
// parameterization. With n = g/|g|, a curve on the surface has
// X″·g = −X′ᵀ Hess X′, so the normal curvature is −eᵀ Hess e/|g| (a
// sphere's is −1/R with its outward normal). Then
// K = (h₂h₃n₁² + h₁h₃n₂² + h₁h₂n₃²)/|g|² and H = −(tr Hess − nᵀ Hess n)/2|g|.
func quadric(g Vec3, h [3]float64) (gauss, mean float64) {
	length := g.norm()
	n := g.mul(1 / length)
	gauss = (h[1]*h[2]*n.X*n.X + h[0]*h[2]*n.Y*n.Y + h[0]*h[1]*n.Z*n.Z) / (length * length)
	mean = -(h[0] + h[1] + h[2] - (h[0]*n.X*n.X + h[1]*n.Y*n.Y + h[2]*n.Z*n.Z)) / (2 * length)
	return gauss, mean
}

// checkQuadric compares the probe's K and H with the level set's, at
// every regular point, with H's sign following the probe's normal, which
// is S_t × S_u as drawn. It returns the number of points checked.
func checkQuadric(t *testing.T, what string, d *SurfaceDiagnostics, gradient func(Vec3) Vec3, h [3]float64, tol float64) int {
	t.Helper()
	points := 0
	eachProbed(d, func(row, k int, x, n Vec3, kappa [2]*float64) {
		if kappa[0] == nil || kappa[1] == nil {
			t.Fatalf("%s row %d column %d: unknown curvature", what, row, k)
		}
		g := gradient(x)
		gauss, mean := quadric(g, h)
		side := math.Copysign(1, n.dot(g))
		if n.cross(g.unit()).norm() > 1e-9 {
			t.Fatalf("%s row %d column %d: normal %v not along the gradient %v", what, row, k, n, g)
		}
		k1, k2 := *kappa[0], *kappa[1]
		if k1 < k2 {
			t.Fatalf("%s: κ₁ %g < κ₂ %g", what, k1, k2)
		}
		scale := math.Max(1, math.Max(math.Abs(k1), math.Abs(k2)))
		if math.Abs(k1*k2-gauss) > tol*scale*scale || math.Abs((k1+k2)/2-side*mean) > tol*scale {
			t.Fatalf("%s at %v: K %g H %g, want %g and %g", what, x, k1*k2, (k1+k2)/2, gauss, side*mean)
		}
		points++
	})
	return points
}

// The surfaces between two rings are quadrics: the hyperboloid
// x² + y² − z² sin²(δ/2) = cos²(δ/2) for a shift δ, the cylinder for δ = 0,
// and, joining one ring to a point, the cone x² + y² = (1 − z/2)², whose
// apex is singular. The ruled surface's probe matches each level set's
// curvatures, and its normal is the drawn S_t × S_u.
func TestRuledProbeQuadrics(t *testing.T) {
	delta := 1.3
	k := math.Pow(math.Sin(delta/2), 2)
	_, hyperboloid := probed(t, threaded(ring(-1), "cos(t)", "sin(t)", "1", 1, delta))
	if hyperboloid.Kind != "ruled" || hyperboloid.V[0] != 0 || hyperboloid.V[ruledColumns] != 1 || !hyperboloid.closed {
		t.Fatalf("kind %q columns %g to %g closed %v", hyperboloid.Kind, hyperboloid.V[0], hyperboloid.V[ruledColumns], hyperboloid.closed)
	}
	n := checkQuadric(t, "hyperboloid", hyperboloid, func(x Vec3) Vec3 { return Vec3{2 * x.X, 2 * x.Y, -2 * k * x.Z} }, [3]float64{2, 2, -2 * k}, 1e-9)
	if n != len(hyperboloid.U)*len(hyperboloid.V) || hyperboloid.Singular+hyperboloid.Unknown+hyperboloid.Umbilics != 0 {
		t.Fatalf("hyperboloid: %d points, %+v", n, hyperboloid)
	}

	// The same hyperboloid with the thread written at half speed, rate
	// m = 2 and shift 2δ, so b(2t + 2δ) is the same ring and S_tt carries
	// m²b″.
	_, fast := probed(t, threaded(ring(-1), "cos(t/2)", "sin(t/2)", "1", 2, 2*delta))
	checkQuadric(t, "hyperboloid at rate 2", fast, func(x Vec3) Vec3 { return Vec3{2 * x.X, 2 * x.Y, -2 * k * x.Z} }, [3]float64{2, 2, -2 * k}, 1e-6)

	_, cylinder := probed(t, threaded(ring(-1), "cos(t)", "sin(t)", "1", 1, 0))
	checkQuadric(t, "cylinder", cylinder, func(x Vec3) Vec3 { return Vec3{2 * x.X, 2 * x.Y, 0} }, [3]float64{2, 2, 0}, 1e-9)
	eachProbed(cylinder, func(row, k int, x, n Vec3, kappa [2]*float64) {
		// Outward normal: the circles bend away from it, κ = −1.
		closeTo(t, "cylinder κ₁", kappa[0], 0, 1e-9)
		closeTo(t, "cylinder κ₂", kappa[1], -1, 1e-9)
		if cylinder.Focal[0][row][k] != nil {
			t.Fatal("the cylinder's straight direction has a finite centre")
		}
	})

	_, cone := probed(t, threaded(ring(0), "0", "0", "2", 1, 0))
	checkQuadric(t, "cone", cone, func(x Vec3) Vec3 { return Vec3{2 * x.X, 2 * x.Y, 1 - x.Z/2} }, [3]float64{2, 2, -0.5}, 1e-9)
	for row := range cone.U {
		if cone.Points[row][ruledColumns] == nil || cone.Normals[row][ruledColumns] != nil {
			t.Fatalf("row %d: the apex is not singular", row)
		}
	}
	if cone.Singular != len(cone.U)-1 {
		t.Fatalf("cone: %d singular, want the apex on every row but the closed last", cone.Singular)
	}
}

// A ruled surface has S_uu = 0, so K = −M²/(EG − F²) ≤ 0 wherever it is
// regular: chords of a knot, at a whole and a fractional rate.
func TestRuledProbeGaussianIsNotPositive(t *testing.T) {
	for _, c := range []Request{chords(study(), 1, 2*math.Pi/3), chords(study(), 0.5, 1)} {
		_, d := probed(t, c)
		negative := 0
		eachProbed(d, func(row, k int, x, n Vec3, kappa [2]*float64) {
			if kappa[0] == nil {
				return
			}
			gauss := *kappa[0] * *kappa[1]
			scale := math.Max(*kappa[0]**kappa[0], *kappa[1]**kappa[1])
			if gauss > 1e-9*scale {
				t.Fatalf("rate %g row %d column %d: K = %g > 0", c.Ruled.Rate, row, k, gauss)
			}
			if gauss < -1e-6*scale {
				negative++
			}
		})
		if negative == 0 {
			t.Fatalf("rate %g: no negative curvature on a surface that is not developable", c.Ruled.Rate)
		}
	}
}

// Coincident rulings, where the threads meet, have points but no tangent
// plane; where an open curve's chord leaves the domain there is no surface.
func TestRuledProbeDegenerate(t *testing.T) {
	_, d := probed(t, chords(study(), 1, 0))
	if d.Singular != (len(d.U)-1)*len(d.V) {
		t.Fatalf("coincident chords: %d singular", d.Singular)
	}
	_, d = probed(t, chords(custom("cos(t)", "sin(t)", "0.2*t", 0, 4*math.Pi), 1, math.Pi))
	for row, i := range d.Along {
		for k := range d.V {
			if (i > 360) != (d.Points[row][k] == nil) {
				t.Fatalf("sample %d column %d: point %v", i, k, d.Points[row][k])
			}
		}
	}
}

// eulerError measures the probe against the drawn surface at a few interior
// grid points. The surface's rulings are straight, so its points at sample
// i are base_i + (u/span)(plus_i − base_i) for each construction's span of
// u. Central differences across samples give S_t and S_tt, so the normal
// curvature along t is S_tt·n/|S_t|², which Euler's formula gives as
// κ₀cos²α + κ₁sin²α, with α measured from the first principal direction.
// It returns the largest relative disagreement.
func eulerError(t *testing.T, c Request, span float64) float64 {
	t.Helper()
	r, d := probed(t, c)
	n := len(r.Base) - 1
	h := (d.U[len(d.U)-1] - d.U[0]) / float64(n)
	at := func(i int, u float64) Vec3 {
		return r.Base[i].add(r.Plus[i].sub(*r.Base[i]).mul(u / span))
	}
	worst := 0.0
	for _, f := range []float64{0.23, 0.51, 0.77} {
		row := int(math.Round(f * float64(len(d.U)-1)))
		i := d.Along[row]
		for _, k := range []int{3, 9, 20} {
			u := d.V[k]
			nrm, e0 := d.Normals[row][k], d.Direction[0][row][k]
			k0, k1 := d.Curvature[0][row][k], d.Curvature[1][row][k]
			if nrm == nil || e0 == nil || k0 == nil || k1 == nil {
				t.Fatalf("%s row %d column %d: undefined", c.Construction, row, k)
			}
			st := at(i+1, u).sub(at(i-1, u)).mul(1 / (2 * h))
			stt := at(i+1, u).sub(at(i, u).mul(2)).add(at(i-1, u)).mul(1 / (h * h))
			drawn := stt.dot(*nrm) / st.dot(st)
			cos := st.unit().dot(*e0)
			euler := *k0*cos*cos + *k1*(1-cos*cos)
			worst = math.Max(worst, math.Abs(drawn-euler)/math.Max(math.Abs(*k0), math.Abs(*k1)))
		}
	}
	return worst
}

// The probe's curvatures converge to the drawn surface's at second order:
// a developable and a Frenet ribbon on a knot (analytic r‴ and r⁗), a
// twisted rotation-minimizing ribbon on a harmonic curve, and a harmonic
// loom of rulings.
func TestRuledProbeConvergesToDrawnSurface(t *testing.T) {
	harmonic := harmonicStudy(0, 2*math.Pi, Vec3{}, HarmonicTerm{1, Vec3{2, 0, 0}, Vec3{0, 2, 0.4}}, HarmonicTerm{3, Vec3{0, 0, 0.5}, Vec3{0.3, 0, 0}})
	loom := threaded(ring(-1), "cos(t) + 0.2*cos(3*t)", "sin(t)", "1 + 0.3*sin(2*t)", 1, 2.4)
	cases := []struct {
		name string
		c    Request
		span float64
	}{
		{"developable", study(), study().Length},
		{"frenet ribbon", ribbon(study(), "frenet", Vec3{}, 0.5, 1, 0.3), 0.3},
		{"twisted ribbon", ribbon(harmonic, "rotation-minimizing", Vec3{0, 0, 1}, 0.2, 3, 0.4), 0.4},
		{"loom", loom, 1},
	}
	for _, tc := range cases {
		coarse, fine := tc.c, tc.c
		coarse.Samples, fine.Samples = 600, 1200
		e1, e2 := eulerError(t, coarse, tc.span), eulerError(t, fine, tc.span)
		if !(e2 < 1e-2) || !(e1/e2 > 3.2) {
			t.Fatalf("%s: errors %g at 600 samples, %g at 1200 (ratio %g)", tc.name, e1, e2, e1/e2)
		}
	}
}

// Each kind of sample is counted once: a missing point is left out, a
// point without the drawing's tangent plane is singular, one whose S_t
// cannot be found (r″ or r‴ unknown) and one whose second derivatives
// cannot be found are unknown, the second keeping its normal, and a closed
// surface's last row is not counted.
func TestRuledProbeCountsEachSample(t *testing.T) {
	nan := Vec3{math.NaN(), math.NaN(), math.NaN()}
	plane := ruledSample{St: Vec3{1, 0, 0}, Su: Vec3{0, 1, 0}, Point: true, Regular: true, Known: true}
	at := func(i int, u float64) ruledSample {
		s := plane
		s.X = Vec3{float64(i), u, 0}
		switch {
		case u == 0:
			return ruledSample{}
		case u < 0.2:
			s.Regular = false
		case u < 0.3:
			s.St = nan
		case u < 0.4:
			s.Known = false
		}
		return s
	}
	for _, closed := range []bool{false, true} {
		d := ruledProbe("ruled", 240, closed, 0, 1, spanned(0, 1), at, func(float64) bool { return false }, false)
		counted := len(d.U)
		if closed {
			counted--
		}
		// Columns k/24: 0 missing; 1–4 singular; 5–7 without S_t; 8–9
		// without second derivatives; the rest a plane, a flat umbilic.
		if d.Singular != 4*counted || d.Unknown != 5*counted || d.Umbilics != 15*counted {
			t.Fatalf("closed %v: singular %d unknown %d umbilics %d for %d rows", closed, d.Singular, d.Unknown, d.Umbilics, counted)
		}
		for k := range d.V {
			missing, normal := d.Points[0][k] == nil, d.Normals[0][k] != nil
			if missing != (k == 0) || normal != (k >= 8) || (d.Curvature[0][0][k] != nil) != (k >= 10) {
				t.Fatalf("column %d: missing %v normal %v curvature %v", k, missing, normal, d.Curvature[0][0][k])
			}
		}
	}
}

// The same trefoil written as expressions has only differenced derivatives,
// so its Frenet ribbon's τ′ is differenced from a differenced r‴. It agrees
// with the analytic knot's ribbon to 10⁻² of the larger curvature wherever
// it is known, and the rest is counted unknown, never guessed: around the
// torsion's sharp peaks the two steps disagree. An expression curve is not
// assumed closed, so its last row is counted.
func TestFrenetRibbonProbeOnExpressionKnot(t *testing.T) {
	analytic := ribbon(study(), "frenet", Vec3{}, 0.5, 1, 0.3)
	written := ribbon(custom("(2.4 + 0.85*cos(3*t))*cos(2*t)", "(2.4 + 0.85*cos(3*t))*sin(2*t)", "0.85*sin(3*t)", 0, 2*math.Pi), "frenet", Vec3{}, 0.5, 1, 0.3)
	_, want := probed(t, analytic)
	_, got := probed(t, written)
	unknown := 0
	for r := range want.U {
		for k := range want.V {
			k0, k1 := want.Curvature[0][r][k], want.Curvature[1][r][k]
			big := math.Max(math.Abs(*k0), math.Abs(*k1))
			if got.Curvature[0][r][k] == nil {
				if got.Normals[r][k] == nil {
					t.Fatalf("row %d column %d: no normal", r, k)
				}
				unknown++
				continue
			}
			closeTo(t, "κ₁", got.Curvature[0][r][k], *k0, 1e-2*big)
			closeTo(t, "κ₂", got.Curvature[1][r][k], *k1, 1e-2*big)
		}
	}
	if unknown == 0 || unknown > len(want.U)*len(want.V)/10 || got.Unknown != unknown {
		t.Fatalf("%d unknown points, %d counted", unknown, got.Unknown)
	}
}
