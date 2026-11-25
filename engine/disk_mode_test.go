package engine

import (
	"errors"
	"math"
	"testing"
)

// The test's own nodal geometry: zeros from the reference series, cached.
var ownZeros = map[int][]float64{}

func zerosOf(m int) []float64 {
	if z, ok := ownZeros[m]; ok {
		return z
	}
	var z []float64
	step := 0.05
	prev := refBessel(m, step)
	for x := 2 * step; len(z) < maxDiskRing; x += step {
		v := refBessel(m, x)
		if (v > 0) != (prev > 0) {
			z = append(z, refZero(m, x-step, x))
		}
		prev = v
	}
	ownZeros[m] = z
	return z
}

// ownMode evaluates the mode independently of the engine: math.Jn, the
// test's zeros, and the angle from atan2. Its scale is the engine's peak,
// which TestBesselPeaksBoundEveryValue checks separately.
func ownMode(m, k int, R, a float64) func(p Vec) float64 {
	j, peak := zerosOf(m)[k-1], besselPeaks[m]
	return func(p Vec) float64 {
		r := math.Hypot(p.X, p.Y)
		angular := 1.0
		if m > 0 {
			angular = math.Cos(float64(m)*math.Atan2(p.Y, p.X) - a)
		}
		return math.Jn(m, j*r/R) / peak * angular
	}
}

// The exact nodal set: m diameters where mθ − a = π/2 (mod π), and circles
// at R j_{m,l}/j_{m,k}, l < k.
type nodalSet struct {
	ends  []Vec // both ends of every diameter, on the boundary
	dirs  []Vec
	radii []float64
	R     float64
}

func exactNodal(m, k int, R, a float64) nodalSet {
	s := nodalSet{R: R}
	for i := range m {
		θ := (a + math.Pi/2 + float64(i)*math.Pi) / float64(m)
		d := Vec{math.Cos(θ), math.Sin(θ)}
		s.dirs = append(s.dirs, d)
		s.ends = append(s.ends, d.Mul(R), d.Mul(-R))
	}
	z := zerosOf(m)
	for l := 1; l < k; l++ {
		s.radii = append(s.radii, R*z[l-1]/z[k-1])
	}
	return s
}

func (s nodalSet) dist(p Vec) float64 {
	best := math.Inf(1)
	r := p.Norm()
	for _, rr := range s.radii {
		best = math.Min(best, math.Abs(r-rr))
	}
	for _, d := range s.dirs {
		best = math.Min(best, math.Abs(d.Cross(p)))
	}
	return best
}

// points samples the exact nodal set inside the disk, every step.
func (s nodalSet) points(step float64) []Vec {
	var out []Vec
	n := int(math.Ceil(2 * s.R / step))
	for _, d := range s.dirs {
		for i := 0; i <= n; i++ {
			out = append(out, d.Mul(-s.R+2*s.R*float64(i)/float64(n)))
		}
	}
	for _, r := range s.radii {
		c := int(math.Ceil(2 * math.Pi * r / step))
		for i := range c {
			θ := 2 * math.Pi * float64(i) / float64(c)
			out = append(out, Vec{r * math.Cos(θ), r * math.Sin(θ)})
		}
	}
	return out
}

// chordIndex finds the distance from a point to the nearest chord, with
// chords bucketed on a grid of the given cell size.
type chordIndex struct {
	cell    float64
	buckets map[[2]int][][2]Vec
}

func indexChords(sets []LevelSet, cell float64) chordIndex {
	ix := chordIndex{cell, map[[2]int][][2]Vec{}}
	for _, set := range sets {
		for _, c := range set.Contours {
			n := len(c.Points)
			last := n - 1
			if c.Closed {
				last = n
			}
			for j := 0; j < last; j++ {
				e := [2]Vec{c.Points[j], c.Points[(j+1)%n]}
				lo := [2]int{int(math.Floor(math.Min(e[0].X, e[1].X) / cell)), int(math.Floor(math.Min(e[0].Y, e[1].Y) / cell))}
				hi := [2]int{int(math.Floor(math.Max(e[0].X, e[1].X) / cell)), int(math.Floor(math.Max(e[0].Y, e[1].Y) / cell))}
				for x := lo[0]; x <= hi[0]; x++ {
					for y := lo[1]; y <= hi[1]; y++ {
						ix.buckets[[2]int{x, y}] = append(ix.buckets[[2]int{x, y}], e)
					}
				}
			}
		}
	}
	return ix
}

// near returns the distance to the nearest chord within reach cells, or
// +Inf.
func (ix chordIndex) near(p Vec, reach int) float64 {
	best := math.Inf(1)
	cx, cy := int(math.Floor(p.X/ix.cell)), int(math.Floor(p.Y/ix.cell))
	for x := cx - reach; x <= cx+reach; x++ {
		for y := cy - reach; y <= cy+reach; y++ {
			for _, e := range ix.buckets[[2]int{x, y}] {
				best = math.Min(best, segmentDistance(p, e[0], e[1]))
			}
		}
	}
	return best
}

func segmentDistance(p, a, b Vec) float64 {
	e := b.Sub(a)
	t := 0.0
	if l := e.Dot(e); l > 0 {
		t = math.Max(0, math.Min(1, p.Sub(a).Dot(e)/l))
	}
	return p.Sub(a.Add(e.Mul(t))).Norm()
}

func diskStudy(m, k int, R float64, cells int) Implicit {
	w := 1.04 * R
	return Implicit{F: "x", Window: Window{-w, w, -w, w}, Cells: cells, Disk: &Disk{Order: m, Ring: k, Radius: R}}
}

func TestDiskModeRefusesByField(t *testing.T) {
	for _, c := range []struct {
		d     Disk
		field string
	}{
		{Disk{-1, 1, 1}, "disk.order"}, {Disk{maxDiskOrder + 1, 1, 1}, "disk.order"},
		{Disk{2, 0, 1}, "disk.ring"}, {Disk{2, maxDiskRing + 1, 1}, "disk.ring"},
		{Disk{2, 1, 0}, "disk.radius"}, {Disk{2, 1, 9e-4}, "disk.radius"},
		{Disk{2, 1, 1.0001e4}, "disk.radius"}, {Disk{2, 1, math.NaN()}, "disk.radius"},
	} {
		v := diskStudy(0, 1, 1, 80)
		v.Disk = &c.d
		_, _, err := v.contours(0, 12)
		var named *FieldError
		if !errors.As(err, &named) || named.Field != c.field {
			t.Errorf("%+v: error %v, want one under %s", c.d, err, c.field)
		}
	}
	// The range's edges are admitted, and F's text is not read.
	for _, d := range []Disk{{0, 1, 1e-3}, {maxDiskOrder, maxDiskRing, 1e4}} {
		v := diskStudy(d.Order, d.Ring, d.Radius, 80)
		v.F = "this is not an expression"
		if _, _, err := v.contours(0, 12); err != nil {
			t.Errorf("%+v refused: %v", d, err)
		}
	}
}

// The mode solves −Δu = λu with λ = (j/R)², vanishes on r = R, and agrees
// with an independent evaluation inside the disk.
func TestDiskModeSolvesTheBoundaryValueProblem(t *testing.T) {
	for _, mk := range [][2]int{{0, 1}, {0, 6}, {1, 1}, {3, 2}, {5, 3}, {7, 4}, {12, 10}} {
		m, k := mk[0], mk[1]
		for _, R := range []float64{1, 0.01, 250} {
			a := 0.37
			d := Disk{m, k, R}
			u := d.field(a)
			own := ownMode(m, k, R, a)
			λ := math.Pow(zerosOf(m)[k-1]/R, 2)
			h := 1e-3 / math.Sqrt(λ)
			for i := range 60 {
				// Points spread over the disk, short of the boundary by 2h.
				r := (R - 2*h) * math.Sqrt(float64(i)+0.5) / math.Sqrt(60)
				θ := 2.399963 * float64(i)
				p := Vec{r * math.Cos(θ), r * math.Sin(θ)}
				at := func(q Vec) float64 { return u(q.X, q.Y) }
				lap := (at(p.Add(Vec{h, 0})) + at(p.Sub(Vec{h, 0})) + at(p.Add(Vec{0, h})) + at(p.Sub(Vec{0, h})) - 4*at(p)) / (h * h)
				if res := math.Abs(lap + λ*at(p)); res > 1e-5*λ {
					t.Fatalf("(%d, %d), R = %g: −Δu − λu = %.3g at %v, λ = %g", m, k, R, res, p, λ)
				}
				if diff := math.Abs(at(p) - own(p)); diff > 2e-12 {
					t.Fatalf("(%d, %d), R = %g: u = %.17g at %v, independently %.17g", m, k, R, at(p), p, own(p))
				}
			}
			for i := range 64 {
				θ := 2 * math.Pi * float64(i) / 64
				if v := u(R*math.Cos(θ), R*math.Sin(θ)); math.Abs(v) > 1e-14 {
					t.Fatalf("(%d, %d), R = %g: u = %.3g on the boundary at θ = %g", m, k, R, v, θ)
				}
			}
			if v := u(2*R, 0); !math.IsNaN(v) {
				t.Errorf("(%d, %d): u = %g outside the disk, want NaN", m, k, v)
			}
		}
	}
	// Every admitted mode vanishes on its boundary.
	for m := 0; m <= maxDiskOrder; m++ {
		for k := 1; k <= maxDiskRing; k++ {
			u := Disk{m, k, 1}.field(0.37)
			for i := range 16 {
				θ := 2 * math.Pi * float64(i) / 16
				if v := u(math.Cos(θ), math.Sin(θ)); math.Abs(v) > 1e-14 {
					t.Fatalf("(%d, %d): u = %.3g on the boundary", m, k, v)
				}
			}
		}
	}
}

// The gradient evaluated with the value is the value's own gradient: the
// value is the field's bit for bit, and the gradient agrees with central
// differences of the independent evaluation.
func TestDiskModeGradientIsTheFieldsOwn(t *testing.T) {
	for _, mk := range [][2]int{{0, 1}, {0, 6}, {1, 1}, {2, 3}, {5, 3}, {8, 5}, {12, 10}} {
		m, k := mk[0], mk[1]
		for _, R := range []float64{1, 0.01, 250} {
			for _, a := range []float64{0, 0.37, 2, 7} {
				d := Disk{m, k, R}
				u, ug := d.field(a), d.fieldGradient(a)
				own := ownMode(m, k, R, a)
				scale := zerosOf(m)[k-1] / R
				h := 1e-6 * R
				pts := []Vec{{0, 0}, {R, 0}, {0, -R}, {R * 0.6, R * 0.8}}
				for i := range 80 {
					r := R * math.Sqrt(float64(i)+0.5) / math.Sqrt(80)
					θ := 2.399963 * float64(i)
					pts = append(pts, Vec{r * math.Cos(θ), r * math.Sin(θ)})
				}
				for _, p := range pts {
					v, g := ug(p.X, p.Y)
					if want := u(p.X, p.Y); v != want && !(math.IsNaN(v) && math.IsNaN(want)) {
						t.Fatalf("(%d, %d), R = %g: value %.17g at %v, the field's %.17g", m, k, R, v, p, want)
					}
					// Central differences, kept inside the disk.
					q := p.Mul(math.Min(1, (R-2*h)/math.Max(p.Norm(), 1e-300)))
					num := Vec{
						(own(q.Add(Vec{h, 0})) - own(q.Sub(Vec{h, 0}))) / (2 * h),
						(own(q.Add(Vec{0, h})) - own(q.Sub(Vec{0, h}))) / (2 * h),
					}
					_, gq := ug(q.X, q.Y)
					if diff := gq.Sub(num).Norm(); diff > 1e-6*scale {
						t.Fatalf("(%d, %d), R = %g, a = %g: gradient %v at %v, central differences %v", m, k, R, a, gq, q, num)
					}
					if !g.Valid() {
						t.Fatalf("(%d, %d): gradient %v at %v", m, k, g, p)
					}
				}
				if v, _ := ug(2*R, 0); !math.IsNaN(v) {
					t.Errorf("(%d, %d): value %g outside the disk, want NaN", m, k, v)
				}
			}
		}
	}
}

// The edge root on a disk sheet ends, as bisection does, at adjacent
// floating-point numbers between which F − c changes sign, or where it is
// zero, so every crossing lies on its level to rounding.
func TestDiskRootsAreBracketedToAdjacentFloats(t *testing.T) {
	for _, mk := range [][2]int{{0, 6}, {5, 3}, {8, 5}, {12, 10}} {
		v := diskStudy(mk[0], mk[1], 1, 120)
		s, err := newSheet(v, 0.37)
		if err != nil {
			t.Fatal(err)
		}
		checked := 0
		for _, c := range []float64{0, 0.24, -0.6} {
			for e := 0; e < 2*(s.nx+1)*(s.ny+1); e++ {
				if e%2 == 0 && e/2%(s.nx+1) == s.nx || e%2 == 1 && e/2/(s.nx+1) == s.ny {
					continue
				}
				a, b, fa, fb := s.ends(e)
				if math.IsNaN(fa) || math.IsNaN(fb) || (fa-c >= 0) == (fb-c >= 0) {
					continue
				}
				p, ok := s.root(e, c)
				if !ok {
					t.Fatalf("%v: edge %d rejected at level %g", mk, e, c)
				}
				g := s.at(p) - c
				if g == 0 {
					checked++
					continue
				}
				// The next float from p toward b.
				q := p
				if a.X != b.X {
					q.X = math.Nextafter(p.X, b.X)
				} else {
					q.Y = math.Nextafter(p.Y, b.Y)
				}
				if gq := s.at(q) - c; gq != 0 && (gq > 0) == (g > 0) {
					t.Fatalf("%v: root %v of edge %d at level %g: F − c is %.3g there and %.3g at the next float", mk, p, e, c, g, gq)
				}
				checked++
			}
		}
		if checked < 500 {
			t.Fatalf("%v: only %d crossings checked", mk, checked)
		}
	}
}

// Screening chords by the first-order distance keeps exactly the chords
// that projecting every midpoint keeps, over modes, levels and angles.
func TestDiskScreeningKeepsWhatProjectionKeeps(t *testing.T) {
	for _, mk := range [][2]int{{0, 6}, {1, 2}, {5, 3}, {8, 5}, {12, 10}} {
		for _, cells := range []int{80, 200} {
			for _, a := range []float64{0, 0.37, 2.1} {
				v := diskStudy(mk[0], mk[1], 1, cells)
				v.Family = Levels{Enabled: true, From: -0.6, To: 0.6, Count: 7}
				trace := func(screen bool) (*ContourResult, int) {
					s, err := newSheet(v, a)
					if err != nil {
						t.Fatal(err)
					}
					s.screen = screen
					res, _, err := v.traceOn(s, a, 24)
					if err != nil {
						t.Fatal(err)
					}
					return res, s.evaluations
				}
				got, fewer := trace(true)
				want, more := trace(false)
				for k, set := range append([]LevelSet{want.Curve}, want.Family...) {
					other := append([]LevelSet{got.Curve}, got.Family...)[k]
					if len(other.Contours) != len(set.Contours) {
						t.Fatalf("%v, %d cells, a = %g, level %g: %d contours screened, %d projected", mk, cells, a, set.Level, len(other.Contours), len(set.Contours))
					}
					for i, c := range set.Contours {
						if len(other.Contours[i].Points) != len(c.Points) {
							t.Fatalf("%v, %d cells, a = %g, level %g: contour %d has %d points screened, %d projected", mk, cells, a, set.Level, i, len(other.Contours[i].Points), len(c.Points))
						}
						for j, p := range c.Points {
							if other.Contours[i].Points[j] != p {
								t.Fatalf("%v, %d cells, a = %g, level %g: contour %d point %d is %v screened, %v projected", mk, cells, a, set.Level, i, j, other.Contours[i].Points[j], p)
							}
						}
					}
				}
				if !(fewer < more) {
					t.Fatalf("%v: %d evaluations screened, %d projected", mk, fewer, more)
				}
			}
		}
	}
}

// Radial lace, the heaviest catalog frame, stays within a fixed number of
// field evaluations: the #415 prototype took 2.2 million.
func TestDiskFrameIsFrugal(t *testing.T) {
	v := diskStudy(8, 5, 1, 200)
	v.Family = Levels{Enabled: true, From: -0.24, To: 0.24, Count: 6}
	v.StableNormals = true
	s, err := newSheet(v, 0.37)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := v.traceOn(s, 0.37, 24); err != nil {
		t.Fatal(err)
	}
	if s.evaluations > 500000 {
		t.Fatalf("%d field evaluations for one frame", s.evaluations)
	}
	t.Logf("%d field evaluations", s.evaluations)
}

func TestDiskModeCenterAngleAndScale(t *testing.T) {
	for m := 0; m <= maxDiskOrder; m++ {
		for _, k := range []int{1, 4, 10} {
			u := Disk{m, k, 1}.field(0.37)
			want := 0.0
			if m == 0 {
				want = 1
			}
			if v := u(0, 0); v != want {
				t.Errorf("(%d, %d): u(0) = %g, want the limit %g", m, k, v, want)
			}
			// Approaching the center along a ray, u ~ r^m.
			if m > 0 {
				dir := Vec{0.6, 0.8}
				// The ratio is 2^m to within (jε)², the series' next term.
				for _, ε := range []float64{1e-5, 1e-8} {
					ratio := u(ε*dir.X, ε*dir.Y) / u(ε/2*dir.X, ε/2*dir.Y)
					if math.Abs(ratio/math.Pow(2, float64(m))-1) > 1e-6 {
						t.Errorf("(%d, %d): u(ε)/u(ε/2) = %g at ε = %g, want 2^%d", m, k, ratio, ε, m)
					}
				}
			}
			// The peak is 1: nowhere above it, and reached along θ = a/m.
			peak := 0.0
			θ := 0.37 / math.Max(1, float64(m))
			for i := 0; i <= 20000; i++ {
				r := float64(i) / 20000
				v := math.Abs(u(r*math.Cos(θ), r*math.Sin(θ)))
				if v > 1+1e-14 {
					t.Fatalf("(%d, %d): |u| = %.17g above 1", m, k, v)
				}
				peak = math.Max(peak, v)
			}
			if peak < 1-1e-5 {
				t.Errorf("(%d, %d): the peak along the crest is %g, want 1", m, k, peak)
			}
			if m == 0 {
				continue
			}
			// Turning by π/m changes the sign; a turns the pattern by a/m;
			// a full period of a restores it; no seam at θ = π.
			u0, u2π := Disk{m, k, 1}.field(0), Disk{m, k, 1}.field(0.37+2*math.Pi)
			step := math.Pi / float64(m)
			for i := range 40 {
				r, φ := 0.05+0.9*float64(i)/40, 0.7*float64(i)
				at := func(f func(x, y float64) float64, θ float64) float64 { return f(r*math.Cos(θ), r*math.Sin(θ)) }
				if d := math.Abs(at(u, φ+step) + at(u, φ)); d > 1e-13 {
					t.Fatalf("(%d, %d): u(θ + π/m) ≠ −u(θ) by %.3g", m, k, d)
				}
				if d := math.Abs(at(u, φ) - at(u0, φ-0.37/float64(m))); d > 1e-13 {
					t.Fatalf("(%d, %d): a = 0.37 is not the a = 0 mode turned by a/m (%.3g)", m, k, d)
				}
				if d := math.Abs(at(u, φ) - at(u2π, φ)); d > 1e-13 {
					t.Fatalf("(%d, %d): a + 2π differs from a by %.3g", m, k, d)
				}
				δ := 1e-9
				if d := math.Abs(at(u, math.Pi-δ) - at(u, -math.Pi+δ)); d > 1e-6 {
					t.Fatalf("(%d, %d): u jumps by %.3g across θ = π", m, k, d)
				}
			}
		}
	}
}

// What the engine reports about the mode agrees with the test's own zeros
// and angles.
func TestDiskResultDescribesTheMode(t *testing.T) {
	for _, mk := range [][2]int{{0, 6}, {1, 2}, {5, 3}, {12, 10}} {
		m, k := mk[0], mk[1]
		res, _, err := diskStudy(m, k, 2.5, 80).contours(0.37, 12)
		if err != nil {
			t.Fatal(err)
		}
		d, own := res.Disk, exactNodal(m, k, 2.5, 0.37)
		j := zerosOf(m)[k-1]
		if d.Order != m || d.Ring != k || d.Radius != 2.5 || math.Abs(d.Zero-j) > 1e-14*j || math.Abs(d.Eigenvalue-(j/2.5)*(j/2.5)) > 1e-13*d.Eigenvalue {
			t.Errorf("(%d, %d): result %+v, own zero %.17g", m, k, d, j)
		}
		if len(d.Radii) != k-1 || len(d.Angles) != m {
			t.Fatalf("(%d, %d): %d radii and %d angles", m, k, len(d.Radii), len(d.Angles))
		}
		for l, r := range d.Radii {
			if math.Abs(r-own.radii[l]) > 1e-14*2.5 {
				t.Errorf("(%d, %d): radius %d = %.17g, own %.17g", m, k, l, r, own.radii[l])
			}
		}
		for i, θ := range d.Angles {
			if θ < 0 || θ >= math.Pi || math.Abs(own.dirs[i].Cross(Vec{math.Cos(θ), math.Sin(θ)})) > 1e-14 {
				t.Errorf("(%d, %d): angle %d = %g, not along the own diameter", m, k, i, θ)
			}
		}
		if res.UsesA != (m > 0) {
			t.Errorf("(%d, %d): usesA = %v", m, k, res.UsesA)
		}
	}
}

// The drawn nodal set, from the engine's returned contours: on the exact
// set, ending on the boundary only at diameters, never running along it,
// and within the stated bounds near the center and at crossings.
func TestDiskContoursFollowTheExactNodalSet(t *testing.T) {
	type mode struct{ m, k int }
	corpus := []mode{{0, 1}, {0, 6}, {1, 2}, {2, 3}, {3, 4}, {5, 3}, {8, 5}, {12, 10}}
	type spread struct{ center, beyond float64 }
	worst := map[[2]int]spread{}
	for _, md := range corpus {
		for _, R := range []float64{1, 250} {
			for _, cells := range []int{80, 161, 320} {
				for _, a := range []float64{0, 0.37} {
					if md.m == 0 && a != 0 {
						continue
					}
					v := diskStudy(md.m, md.k, R, cells)
					res, warnings, err := v.contours(a, 12)
					if err != nil || len(warnings) > 0 {
						t.Fatalf("%+v: %v %v", md, err, warnings)
					}
					h := 2.08 * R / float64(cells)
					tol := drawingTolerance * 2.08 * R
					own, u := exactNodal(md.m, md.k, R, a), ownMode(md.m, md.k, R, a)
					center := (float64(md.m)/math.Pi + 1.2) * h
					crossing := math.Max(tol, h/math.Sqrt2)
					if cells == 320 {
						crossing = tol
					}
					if res.Nonfinite != 0 || len(res.Discontinuities) != 0 {
						t.Fatalf("%+v at %d cells: %d undefined points, %d discontinuities", md, cells, res.Nonfinite, len(res.Discontinuities))
					}
					ends := map[int]int{}
					closed := 0
					var s spread
					for _, c := range res.Curve.Contours {
						if c.Closed {
							closed++
						}
						for _, p := range c.Points {
							if p.Norm() > R*(1+1e-12) {
								t.Fatalf("%+v at %d cells: a vertex at r = %.17g beyond R", md, cells, p.Norm())
							}
							if math.Abs(u(p)) > 5e-12 {
								t.Fatalf("%+v at %d cells: u = %.3g at a vertex %v", md, cells, u(p), p)
							}
							// Near the boundary only on a diameter: never
							// along the boundary, where u is 0 as well.
							if p.Norm() > R-h/4 && !onDiameter(own, p, crossing) {
								t.Fatalf("%+v at %d cells: a vertex at r = %.6g, along the boundary away from any diameter", md, cells, p.Norm())
							}
						}
						if !c.Closed {
							for _, p := range []Vec{c.Points[0], c.Points[len(c.Points)-1]} {
								if math.Abs(p.Norm()-R) <= 1e-12*R {
									for e, q := range own.ends {
										if p.Sub(q).Norm() <= crossing {
											ends[e]++
										}
									}
								}
							}
						}
						n := len(c.Points)
						last := n - 1
						if c.Closed {
							last = n
						}
						for j := 0; j < last; j++ {
							p, q := c.Points[j], c.Points[(j+1)%n]
							d := own.dist(p.Add(q).Mul(.5))
							if math.Min(p.Norm(), q.Norm()) <= center {
								s.center = math.Max(s.center, d/h)
								if d > h/math.Sqrt2 {
									t.Fatalf("%+v at %d cells: a chord near the center is %.3g cells off", md, cells, d/h)
								}
							} else {
								s.beyond = math.Max(s.beyond, d/h)
								if d > crossing {
									t.Fatalf("%+v at %d cells, a = %g: a chord at r = %.4g is %.3g off (bound %.3g)", md, cells, a, p.Norm(), d, crossing)
								}
							}
						}
					}
					// Every diameter's ends, each reached once.
					if len(ends) != 2*md.m {
						t.Fatalf("%+v at %d cells: %d of %d diameter ends reached", md, cells, len(ends), 2*md.m)
					}
					for e, n := range ends {
						if n != 1 {
							t.Fatalf("%+v at %d cells: diameter end %d reached %d times", md, cells, e, n)
						}
					}
					// Every point of the exact set is drawn: within the
					// crossing bound beyond the center, and within m/π + ½
					// cells inside it, where 2m rays are closer than a cell.
					ix := indexChords([]LevelSet{res.Curve}, h)
					for _, p := range own.points(h / 4) {
						d := ix.near(p, 6)
						if p.Norm() <= center && d > (float64(md.m)/math.Pi+0.5)*h || p.Norm() > center && d > crossing {
							t.Fatalf("%+v at %d cells, a = %g: the nodal point %v (r = %.4g) is %.3g cells from the drawing", md, cells, a, p, p.Norm(), d/h)
						}
					}
					// A round mode's rings are whole loops.
					if md.m == 0 && closed != md.k-1 {
						t.Fatalf("(0, %d) at %d cells: %d closed contours", md.k, cells, closed)
					}
					key := [2]int{md.m, cells}
					worst[key] = spread{math.Max(worst[key].center, s.center), math.Max(worst[key].beyond, s.beyond)}
				}
			}
		}
	}
	// The center's deviation converges with the cell: in cells it stays
	// bounded, so in length it shrinks fourfold from 80 to 320 cells,
	// unless it is already at rounding, as where the diameters run through
	// grid nodes.
	for _, md := range corpus {
		if md.m < 2 {
			continue
		}
		c80, c320 := worst[[2]int{md.m, 80}].center*2.08/80, worst[[2]int{md.m, 320}].center*2.08/320
		if !(c320 <= 0.3*c80 || c80 <= 1e-12) {
			t.Errorf("(%d, %d): the center's deviation falls from %.3g to %.3g only", md.m, md.k, c80, c320)
		}
	}
}

func onDiameter(s nodalSet, p Vec, within float64) bool {
	for _, d := range s.dirs {
		if math.Abs(d.Cross(p)) <= within {
			return true
		}
	}
	return false
}

func TestDiskFamilyAndWindows(t *testing.T) {
	// Nearby levels lie on their own levels, inside the disk.
	v := diskStudy(8, 5, 1, 200)
	v.Family = Levels{Enabled: true, From: -0.24, To: 0.24, Count: 6}
	res, warnings, err := v.contours(math.Pi/8, 24)
	if err != nil || len(warnings) > 0 {
		t.Fatal(err, warnings)
	}
	u := ownMode(8, 5, 1, math.Pi/8)
	for _, set := range res.Family {
		if len(set.Contours) == 0 {
			t.Fatalf("level %g has no contours", set.Level)
		}
		for _, c := range set.Contours {
			for _, p := range c.Points {
				if p.Norm() > 1+1e-12 || math.Abs(u(p)-set.Level) > 5e-12 {
					t.Fatalf("level %g: a vertex at r = %.17g has u = %.17g", set.Level, p.Norm(), u(p))
				}
			}
		}
	}
	if len(res.Normals) == 0 {
		t.Fatal("no normals")
	}
	for _, n := range res.Normals {
		if n.Point.Norm() > 1+1e-12 {
			t.Fatalf("a normal at r = %g outside the disk", n.Point.Norm())
		}
	}
	// A window holding part of the disk cuts its contours at its edge; one
	// beyond it draws nothing; neither counts undefined points.
	part := diskStudy(5, 3, 1, 120)
	part.Window = Window{0, 1.2, -0.2, 0.4}
	res, _, _ = part.contours(0.37, 12)
	if len(res.Curve.Contours) == 0 || res.Nonfinite != 0 {
		t.Fatalf("partial window: %d contours, %d undefined", len(res.Curve.Contours), res.Nonfinite)
	}
	for _, c := range res.Curve.Contours {
		for _, p := range c.Points {
			if p.Norm() > 1+1e-12 || p.X < -1e-12 || p.X > 1.2+1e-12 || p.Y < -0.2-1e-12 || p.Y > 0.4+1e-12 {
				t.Fatalf("partial window: vertex %v outside the window or disk", p)
			}
		}
	}
	away := diskStudy(5, 3, 1, 120)
	away.Window = Window{2, 3, 2, 3}
	res, _, _ = away.contours(0, 12)
	if len(res.Curve.Contours) != 0 || res.Nonfinite != 0 {
		t.Fatalf("window beyond the disk: %d contours, %d undefined", len(res.Curve.Contours), res.Nonfinite)
	}
}

// The largest mode at the most cells, with the most levels, stays within
// the shared budgets, skipping levels by name.
func TestDiskModeWorkStaysBounded(t *testing.T) {
	v := diskStudy(maxDiskOrder, maxDiskRing, 1, maxCells)
	v.Family = Levels{Enabled: true, From: -0.9, To: 0.9, Count: 64}
	res, warnings, err := v.contours(0.37, 64)
	if err != nil {
		t.Fatal(err)
	}
	points := 0
	for _, set := range append([]LevelSet{res.Curve}, res.Family...) {
		for _, c := range set.Contours {
			points += len(c.Points)
		}
	}
	if len(res.Curve.Contours) == 0 || len(warnings) == 0 || len(res.Family) == 64 {
		t.Fatalf("%d curve contours, %d family levels, warnings %v", len(res.Curve.Contours), len(res.Family), warnings)
	}
	if points > maxContourPoints+4*len(res.Family)+64 {
		t.Fatalf("%d points beyond the budget", points)
	}
}

// A full period of a gives the same field and so the same drawing, bit for
// bit: a pure mode's crossings are exact, so the pieces there are decided
// by rounding, and a seamless loop must end on exactly its start.
func TestDiskModePeriodIsExact(t *testing.T) {
	for _, mk := range [][2]int{{5, 3}, {8, 5}, {12, 10}} {
		v := diskStudy(mk[0], mk[1], 1, 160)
		v.Family = Levels{Enabled: true, From: -0.24, To: 0.24, Count: 6}
		start, _, _ := v.contours(0, 24)
		end, _, _ := v.contours(2*math.Pi, 24)
		if len(start.Curve.Contours) != len(end.Curve.Contours) {
			t.Fatalf("%v: %d pieces at a = 0, %d at a = 2π", mk, len(start.Curve.Contours), len(end.Curve.Contours))
		}
		for i, c := range start.Curve.Contours {
			for j, p := range c.Points {
				if q := end.Curve.Contours[i].Points[j]; p != q {
					t.Fatalf("%v: piece %d point %d is %v at a = 0, %v at a = 2π", mk, i, j, p, q)
				}
			}
		}
	}
}
