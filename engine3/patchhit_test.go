package engine3

import (
	"math"
	"math/rand"
	"sort"
	"testing"
)

// memberHits is an oracle independent of the patch tree: the parameters t
// in (lo, hi) where the line o + t d meets the family's member over q's
// domain, from the family's description as one meridian screwed about z.
// Horizontally x + iy = s e^{iu}(sin θ cosh v − i cos θ sinh v), so a point
// at radius ρ has sinh²v = ρ²/s² − sin²θ, v = ±asinh of its root, then u
// from the height (θ < π/2) and a residual angle; on the catenoid v is the
// height and the residual is ρ − s cosh v; the helicoid's own equation
// avoids the angle's wrap at its axis. Roots are bracketed on a fine
// sampling of t and bisected; each also returns its (u, v).
func memberHits(q SurfaceRequest, o, d Vec3, lo, hi float64, steps int) [][3]float64 {
	s, theta := q.A, q.B
	ct, st := math.Cos(theta), math.Sin(theta)
	catenoid := theta == math.Pi/2
	at := func(t float64) Vec3 { return o.add(d.mul(t)) }
	// branch returns the residual on branch σ at t, with its (u, v), and
	// whether the point has a real v at all.
	branch := func(t float64, sigma float64) (float64, float64, float64, bool) {
		p := at(t)
		rho := math.Hypot(p.X, p.Y)
		if theta == 0 {
			// The helicoid is x cos(z/s) + y sin(z/s) = 0, with no wrap
			// near its axis; then u = z/s and s sinh v = x sin u − y cos u.
			u := p.Z / s
			su, cu := math.Sincos(u)
			return p.X*cu + p.Y*su, u, math.Asinh((p.X*su - p.Y*cu) / s), true
		}
		if catenoid {
			v := p.Z / s
			return rho - s*math.Cosh(v), math.NaN(), v, true
		}
		// Inside the waist's cylinder the branches meet at v = 0; the
		// residual stays continuous there, and every root is verified on
		// the patch below.
		w := math.Max(0, rho*rho/(s*s)-st*st)
		v := sigma * math.Asinh(math.Sqrt(w))
		u := (p.Z/s - st*v) / ct
		psi := u - math.Atan2(ct*math.Sinh(v), st*math.Cosh(v))
		g := math.Remainder(math.Atan2(p.Y, p.X)-psi, 2*math.Pi)
		return g, u, v, true
	}
	inside := func(u, v float64) bool {
		return u >= q.UMin && u <= q.UMax && v >= q.VMin && v <= q.VMax
	}
	var out [][3]float64
	for _, sigma := range []float64{1, -1} {
		if (catenoid || theta == 0) && sigma < 0 {
			break
		}
		h := (hi - lo) / float64(steps)
		g0, _, _, ok0 := branch(lo, sigma)
		for k := 1; k <= steps; k++ {
			t1 := lo + h*float64(k)
			g1, _, _, ok1 := branch(t1, sigma)
			if ok0 && ok1 && (g0 == 0 || g0*g1 < 0) && math.Abs(g1-g0) < 1 {
				a, b, ga := t1-h, t1, g0
				for range 200 {
					m := (a + b) / 2
					gm, _, _, _ := branch(m, sigma)
					if (gm < 0) == (ga < 0) {
						a, ga = m, gm
					} else {
						b = m
					}
				}
				t := (a + b) / 2
				_, u, v, _ := branch(t, sigma)
				on := func(u, v float64) bool {
					x, _, _, _, _, _ := q.patch(u, v)
					return x.sub(at(t)).norm() <= 1e-7*s
				}
				if catenoid {
					p := at(t)
					base := math.Atan2(p.Y, p.X)
					for m := -3; m <= 3; m++ {
						if uu := base + 2*math.Pi*float64(m); inside(uu, v) && on(uu, v) {
							out = append(out, [3]float64{t, uu, v})
						}
					}
				} else if inside(u, v) && on(u, v) {
					out = append(out, [3]float64{t, u, v})
				}
			}
			g0, ok0 = g1, ok1
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i][0] < out[j][0] })
	unique := out[:0]
	for _, h := range out {
		if n := len(unique); n > 0 && math.Abs(unique[n-1][0]-h[0]) <= 1e-9*s && math.Abs(unique[n-1][1]-h[1]) <= 1e-6 {
			continue
		}
		unique = append(unique, h)
	}
	return unique
}

// occludedState is the sample's state under first-hit semantics, by the
// oracle's occluder: traced, shadowed, undecided or unlit.
func occludedState(t *testing.T, c Request, u, v float64) string {
	t.Helper()
	_, scale, err := c.Surface.positions()
	if err != nil {
		t.Fatal(err)
	}
	o, ok := newOccluder(c.Surface, c.Rays, scale)
	if !ok {
		t.Fatal("no occluder")
	}
	p := c.Surface.ray(c.Rays, u, v, scale)
	s := o.apply(p, u, v)
	switch {
	case s.undecided:
		return "undecided"
	case s.shadowed:
		return "shadowed"
	case p.traced():
		return "traced"
	}
	return "unlit"
}

func hitTree(t *testing.T, q SurfaceRequest) *patchTree {
	t.Helper()
	_, scale, err := q.positions()
	if err != nil {
		t.Fatal(err)
	}
	tree, ok := newPatchTree(q, scale)
	if !ok {
		t.Fatalf("%s has no patch tree", q.Kind)
	}
	return tree
}

// The first hit along random lines agrees with the oracle: the same t and
// (u, v), with X(u, v) on the line to 10⁻¹⁰ of the scale. A line that
// misses finds nothing. Undecided answers are allowed only for the rare
// line that the oracle shows grazing the patch or meeting it within 10⁻⁶
// of the domain's edge, and are counted.
func TestPatchTreeFirstHit(t *testing.T) {
	rng := rand.New(rand.NewSource(397))
	agreed, missed, undecided := 0, 0, 0
	for _, theta := range []float64{0, .35, math.Pi / 4, 1.1, math.Pi / 2} {
		for _, s := range []float64{.02, 1, 300} {
			q := surfaceStudy("helicoid-catenoid", s, theta, 0, -2.2*math.Pi, 1.9*math.Pi, -1.4, 1.2, 72, 36).Surface
			tree := hitTree(t, q)
			for range 300 {
				// Aim through a random point of the patch's neighborhood.
				u := q.UMin + rng.Float64()*(q.UMax-q.UMin)
				v := q.VMin - .2 + rng.Float64()*(q.VMax-q.VMin+.4)
				x, _, _, _, _, _ := q.patch(u, v)
				x = x.add(Vec3{rng.NormFloat64(), rng.NormFloat64(), rng.NormFloat64()}.mul(.3 * s))
				d := Vec3{rng.NormFloat64(), rng.NormFloat64(), rng.NormFloat64()}.unit()
				o := x.sub(d.mul(12 * s))
				// Half the lines start beside the patch, where it also
				// lies behind them.
				lo, hi := 0.0, 24*s
				if rng.Intn(2) == 0 {
					o, hi = x, 12*s
				}
				want := memberHits(q, o, d, lo, hi, 20000)
				got := tree.first(o, d, lo, hi, nil)
				switch {
				case got.state == hitUndecided:
					undecided++
					if len(want) == 0 {
						continue
					}
					// Undecided only beside a grazing hit or the edge.
					w := want[0]
					_, xu, xv, _, _, _ := q.patch(w[1], w[2])
					graze := math.Abs(d.dot(xu.cross(xv).unit()))
					edge := math.Min(math.Min(w[1]-q.UMin, q.UMax-w[1])/(q.UMax-q.UMin), math.Min(w[2]-q.VMin, q.VMax-w[2])/(q.VMax-q.VMin))
					if graze > 1e-3 && edge > 1e-6 {
						t.Fatalf("θ %v s %v: undecided at %v beside a clear hit at %v (|d·n| %v, edge %v), o %#v d %#v", theta, s, got.t, w, graze, edge, o, d)
					}
				case len(want) == 0:
					missed++
					if got.state != hitNone {
						t.Fatalf("θ %v s %v: hit at t %v (u %v v %v) where the oracle finds none", theta, s, got.t, got.u, got.v)
					}
				default:
					agreed++
					w := want[0]
					if got.state != hitFound || math.Abs(got.t-w[0]) > 1e-8*s {
						t.Fatalf("θ %v s %v: first hit %+v, oracle %v (all %v)", theta, s, got, w, want)
					}
					p, _, _, _, _, _ := q.patch(got.u, got.v)
					if got.t <= lo || p.sub(o.add(d.mul(got.t))).norm() > 1e-10*s {
						t.Fatalf("θ %v s %v: residual %v", theta, s, p.sub(o.add(d.mul(got.t))).norm())
					}
				}
			}
		}
	}
	if agreed < 1500 || missed < 500 || undecided > 30 {
		t.Fatalf("%d agreed, %d missed, %d undecided", agreed, missed, undecided)
	}
	t.Logf("%d agreed, %d missed, %d undecided", agreed, missed, undecided)
}

// A line's own point is not a hit: from a sample along any direction off
// its tangent plane, the next hit is the oracle's next root after it.
func TestPatchTreeOwnPoint(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	q := surfaceStudy("helicoid-catenoid", 1, .6, 0, -2*math.Pi, 2*math.Pi, -1.5, 1.5, 96, 40).Surface
	tree := hitTree(t, q)
	for range 400 {
		u, v := q.UMin+rng.Float64()*(q.UMax-q.UMin), q.VMin+rng.Float64()*(q.VMax-q.VMin)
		x, xu, xv, _, _, _ := q.patch(u, v)
		d := Vec3{rng.NormFloat64(), rng.NormFloat64(), rng.NormFloat64()}.unit()
		if math.Abs(d.dot(xu.cross(xv).unit())) < .05 {
			continue
		}
		got := tree.first(x, d, 0, 30, &[2]float64{u, v})
		want := memberHits(q, x, d, 1e-6, 30, 60000)
		if len(want) == 0 {
			if got.state != hitNone {
				t.Fatalf("(%v, %v): hit %+v where the oracle finds none", u, v, got)
			}
			continue
		}
		if got.state != hitFound || math.Abs(got.t-want[0][0]) > 1e-8 {
			t.Fatalf("(%v, %v) along %+v: %+v, oracle %v", u, v, d, got, want)
		}
	}
}

// A line tangent to the patch along a principal direction touches it at a
// double root, where no rectangle can prove a root unique: the answer is
// undecided, never a hit or a miss. Moved off the tangent plane by a
// thousandth of the scale toward the side the patch bends to, the line
// crosses it twice near the touching point; moved away, it misses there.
func TestPatchTreeGrazing(t *testing.T) {
	for _, theta := range []float64{0, math.Pi / 4, math.Pi / 2} {
		q := surfaceStudy("helicoid-catenoid", 1, theta, 0, -math.Pi/2, math.Pi/2, -1, 1, 48, 32).Surface
		tree := hitTree(t, q)
		for _, at := range [][2]float64{{.3, .4}, {-.5, -.2}, {.1, .7}} {
			p := q.point(at[0], at[1], 1)
			x := p.X
			for k := range 2 {
				e := p.Dir[k]
				o := x.sub(e.mul(2))
				if h := tree.first(o, e, 0, 2+.2, nil); h.state != hitUndecided {
					t.Fatalf("θ %v at %v, direction %d: tangent line %+v", theta, at, k+1, h)
				}
				// κ > 0 bends toward n.
				side := p.N.mul(math.Copysign(1e-3, p.Kappa[k]))
				if h := tree.first(o.add(side), e, 0, 2+.2, nil); h.state != hitFound || math.Abs(h.t-2) > .2 {
					t.Fatalf("θ %v at %v, direction %d: line moved toward the bend %+v", theta, at, k+1, h)
				}
				if h := tree.first(o.sub(side), e, 1.8, 2.2, nil); h.state != hitNone {
					t.Fatalf("θ %v at %v, direction %d: line moved away %+v", theta, at, k+1, h)
				}
			}
		}
	}
}

// Under light straight down the helicoid's vertical line through X(u, v)
// meets it again every half turn, at (u + π, −v): with v symmetric, a lit
// sample is in shadow exactly when u + π is inside the domain. A sample
// whose blocker would be at the domain's edge is undecided, not guessed.
// The engine draws every lit sample all the same (nothing is occluded):
// this is the case the family's help warns of.
func TestOccluderHelicoidShadow(t *testing.T) {
	c := minimal(1, 0, -2*math.Pi, 2*math.Pi, -1.2, 1.2, 64, 24, parallel(0, -90))
	r := rayed(t, c)
	q := c.Surface
	shadowed, undecided, lit := 0, 0, 0
	for i := 0; i <= q.USamples; i++ {
		for j := 0; j <= q.VSamples; j++ {
			u, v := grid(q, i, j)
			if !(v < -1e-9) {
				continue
			}
			lit++
			p := occludedState(t, c, u, v)
			// The blockers are (u + kπ, (−1)ᵏv) for k ≥ 1 within the
			// domain; one on its edge decides nothing.
			clear, edge := false, false
			for k := 1; u+float64(k)*math.Pi <= q.UMax+1e-9; k++ {
				bu, bv := u+float64(k)*math.Pi, v*math.Pow(-1, float64(k))
				if math.Abs(bu-q.UMax) < 1e-9 || math.Abs(math.Abs(bv)-q.VMax) < 1e-9 {
					edge = true
				} else {
					clear = true
				}
			}
			want := "traced"
			if clear {
				want = "shadowed"
				shadowed++
			} else if edge {
				want = "undecided"
				undecided++
			}
			if p != want {
				t.Fatalf("(%d, %d) at (%v, %v): state %s, want %s", i, j, u, v, p, want)
			}
		}
	}
	// Single event: every lit sample reflects, shadowed or not.
	traced := 0
	for i := 0; i <= q.USamples; i++ {
		for j := 0; j <= q.VSamples; j++ {
			u, v := grid(q, i, j)
			if q.ray(c.Rays, u, v, 1).traced() {
				traced++
			}
		}
	}
	if shadowed < 300 || undecided == 0 || traced != lit || r.Unlit+lit != (q.USamples+1)*(q.VSamples+1) {
		t.Fatalf("shadowed %d, undecided %d, traced %d of %d lit, unlit %d", shadowed, undecided, traced, lit, r.Unlit)
	}
}

// Slanting light on the catenoid's inside, and refracted into the stair:
// the oracle blocks each outgoing ray that meets the patch again at the
// closed-form oracle's distance b, and a real caustic point at or beyond b
// is not reached, one before it is, and virtual points always are. Both
// studies have many of each, so a preset whose drawing reaches beyond a
// block fails TestMinimalOpticsPresetsShadowFree.
func TestOccluderBlockedCaustics(t *testing.T) {
	throat := minimal(1, math.Pi/2, -math.Pi, .9*math.Pi, -1.3, 1.6, 60, 40, parallel(0, -60))
	throat.Surface.Reverse = true
	stair := glass(minimal(1, 0, -.85*math.Pi, .85*math.Pi, -1.2, 1.2, 60, 30, parallel(30, -60)), 1, 1.5)
	for _, c := range []Request{throat, stair} {
		c.Rays.Length = 50
		blockedCaustics(t, c)
	}
}

func blockedCaustics(t *testing.T, c Request) {
	t.Helper()
	q := c.Surface
	_, scale, _ := q.positions()
	o, _ := newOccluder(q, c.Rays, scale)
	wall := func(x, d Vec3) float64 {
		if b := memberHits(q, x, d, 1e-6, 60, 60000); len(b) > 0 {
			return b[0][0]
		}
		return math.Inf(1)
	}
	blocked, reached, virtual := 0, 0, 0
	for i := 0; i <= q.USamples; i++ {
		for j := 0; j <= q.VSamples; j++ {
			u, v := grid(q, i, j)
			p := q.ray(c.Rays, u, v, scale)
			s := o.apply(p, u, v)
			if !p.traced() || s.shadowed || s.undecided {
				continue
			}
			b := wall(p.X, p.R)
			if s.blocked != !math.IsInf(b, 1) || s.blocked && math.Abs(s.block-b) > 1e-8 {
				t.Fatalf("(%d, %d): block %v at %v, oracle %v", i, j, s.blocked, s.block, b)
			}
			for k := range p.Mu {
				if !p.finite(k, focalReach*scale) {
					continue
				}
				switch {
				case p.Mu[k] < 0:
					if !s.reached(p, k) {
						t.Fatalf("(%d, %d): virtual caustic %d not reached", i, j, k+1)
					}
					virtual++
				case 1/p.Mu[k] >= b:
					if s.reached(p, k) {
						t.Fatalf("(%d, %d): caustic %d reached beyond the wall", i, j, k+1)
					}
					blocked++
				default:
					if !s.reached(p, k) {
						t.Fatalf("(%d, %d): caustic %d before the wall not reached", i, j, k+1)
					}
					reached++
				}
			}
		}
	}
	if blocked < 20 || reached < 100 || virtual < 100 {
		t.Fatalf("blocked %d, reached %d, virtual %d", blocked, reached, virtual)
	}
}
