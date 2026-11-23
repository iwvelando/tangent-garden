package engine

import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"reflect"
	"testing"
)

// The inversive view (docs/mathematics.md, Apollonian garden, The
// inversive view). The checks read the engine's returned image coordinates
// and compare them with the inversion applied independently: pointwise to
// points sampled on each source circle, and through the closed form for a
// circle's image.

// The page at 1× zoom, in model units, which the default view frames.
var pageWindow = GardenWindow{XMin: -500.0 / 350, XMax: 500.0 / 350, YMin: -380.0 / 350, YMax: 380.0 / 350}

func inverted(q GardenRequest, x, y, radius float64, w GardenWindow) GardenRequest {
	q.Inversion = &GardenInversion{X: x, Y: y, Radius: radius}
	q.Window = &w
	return q
}

// A pole and radius to test, named.
type testPole struct {
	name    string
	x, y, r float64
}

// Poles inside a seed circle, in a gap, on a circle, at two tangencies,
// at the center of a seed circle and outside the packing.
var testPoles = []testPole{
	{"in the left circle", -0.25, 0, math.Sqrt(0.375)},
	{"in a gap", 0.3, 0.3, 0.5},
	{"on the right circle", 0.5, 0.5, 0.6},
	{"at the origin's tangency", 0, 0, math.Sqrt(0.375)},
	{"at the top tangency", 0, 1, 1},
	{"at the top circle's center", 0, 2.0 / 3, 1.0 / 3},
	{"outside", 0, 1.4, 1},
	{"near the rim", 0.7, -0.69, 0.4},
}

// The shape a circle's image coordinates describe: a circle with center
// and radius, oriented by sign (negative: its outside), or a line
// n·w = h, its interior where n·w > h.
type imageShape struct {
	line      bool
	x, y, r   float64
	negative  bool
	nx, ny, h float64
}

func shapeOf(r GardenResult, i int) imageShape {
	b, zx, zy, co := r.Image[4*i], r.Image[4*i+1], r.Image[4*i+2], r.Image[4*i+3]
	if b == 0 {
		return imageShape{line: true, nx: zx, ny: zy, h: co / 2}
	}
	return imageShape{x: zx / b, y: zy / b, r: 1 / math.Abs(b), negative: b < 0}
}

// invertPoint is the inversion itself: w = P + ρ²(z − P)/|z − P|².
func invertPoint(px, py, rho, x, y float64) (float64, float64) {
	dx, dy := x-px, y-py
	k := rho * rho / (dx*dx + dy*dy)
	return px + k*dx, py + k*dy
}

// Distance from a point to the shape's boundary, relative to the shape's
// size or the point's distance from the origin, whichever is larger.
func (s imageShape) residual(x, y float64) float64 {
	if s.line {
		return math.Abs(s.nx*x+s.ny*y-s.h) / math.Max(1, math.Hypot(x, y))
	}
	return math.Abs(math.Hypot(x-s.x, y-s.y)-s.r) / math.Max(s.r, math.Max(1, math.Hypot(x, y)))
}

func mustImage(t *testing.T, q GardenRequest) GardenResult {
	t.Helper()
	r := mustGarden(t, q)
	if len(r.Image) != 4*len(r.Curvature) {
		t.Fatalf("image has %d values for %d circles", len(r.Image), len(r.Curvature))
	}
	return r
}

// Every image is the source circle inverted point by point, and inverting
// the image's points returns the source circle: the map and its inverse,
// independently of the engine's linear form.
func TestGardenInversionMapsCirclesAndBack(t *testing.T) {
	for _, seed := range []string{GardenSeed, "-6,11,14,15", "3-2r3,1,1,1", "split 1/5"} {
		for _, p := range testPoles {
			r := mustImage(t, inverted(seedGarden(seed, 12, 0.004, 5000), p.x, p.y, p.r, pageWindow))
			worst, back := 0.0, 0.0
			for i := range r.Curvature {
				s := shapeOf(r, i)
				for k := 0; k < 12; k++ {
					a := 2 * math.Pi * (float64(k) + 0.37) / 12
					x, y := r.X[i]+r.Radius[i]*math.Cos(a), r.Y[i]+r.Radius[i]*math.Sin(a)
					if math.Hypot(x-p.x, y-p.y) < 1e-6 {
						continue
					}
					wx, wy := invertPoint(p.x, p.y, p.r, x, y)
					worst = math.Max(worst, s.residual(wx, wy))
				}
				// Back: points of the image, inverted, lie on the source.
				for k := 0; k < 12; k++ {
					a := 2 * math.Pi * (float64(k) + 0.21) / 12
					var x, y float64
					if s.line {
						t := 3 * math.Tan(a/2.2)
						x, y = s.nx*s.h-s.ny*t, s.ny*s.h+s.nx*t
					} else {
						x, y = s.x+s.r*math.Cos(a), s.y+s.r*math.Sin(a)
					}
					if math.Hypot(x-p.x, y-p.y) < 1e-6 {
						continue
					}
					zx, zy := invertPoint(p.x, p.y, p.r, x, y)
					d := math.Abs(math.Hypot(zx-r.X[i], zy-r.Y[i])-r.Radius[i]) / math.Max(r.Radius[i], 1)
					back = math.Max(back, d)
				}
			}
			if worst > 1e-9 || back > 1e-9 {
				t.Errorf("%s, pole %s: image residual %.3g, inverse %.3g", seed, p.name, worst, back)
			}
		}
	}
}

// The image's curvature has the closed form b(|P − c|² − r²)/ρ², from the
// source's own center and radius; its sign says where the pole lies. The
// coordinates satisfy |z|² − b·b̄ = 1.
func TestGardenInversionImageCurvature(t *testing.T) {
	for _, seed := range append(append([]string{}, catalogSeeds...), "split 1/20", "split 37/97") {
		for _, p := range testPoles {
			r := mustImage(t, inverted(seedGarden(seed, 12, 0.004, 5000), p.x, p.y, p.r, pageWindow))
			for i := range r.Curvature {
				b, zx, zy, co := r.Image[4*i], r.Image[4*i+1], r.Image[4*i+2], r.Image[4*i+3]
				sign := 1.0
				if r.Curvature[i] < 0 {
					sign = -1
				}
				d := math.Hypot(p.x-r.X[i], p.y-r.Y[i])
				want := sign / r.Radius[i] * (d - r.Radius[i]) * (d + r.Radius[i]) / (p.r * p.r)
				scale := (d + r.Radius[i]) * (d + r.Radius[i]) / r.Radius[i] / (p.r * p.r)
				if math.Abs(b-want) > 1e-10*math.Max(1, scale) {
					t.Fatalf("%s, pole %s, circle %d: image curvature %v, want %v", seed, p.name, i, b, want)
				}
				q := zx*zx + zy*zy - b*co
				if math.Abs(q-1) > 1e-8*math.Max(1, zx*zx+zy*zy) {
					t.Fatalf("%s, pole %s, circle %d: |z|² − b·b̄ = %v", seed, p.name, i, q)
				}
			}
		}
	}
}

// The signature: the original inverted about (0, 1), where the enclosing
// circle touches the top seed circle, with radius 1. Both become lines,
// exactly, at y = 1/2 and y = −1/2; the half-radius circles, orthogonal to
// the inversion circle, stay exactly where they are.
func TestGardenInversionUnrollsTheStripExactly(t *testing.T) {
	r := mustImage(t, inverted(garden(12, 0.002, 5000), 0, 1, 1, pageWindow))
	e, top := shapeOf(r, 0), shapeOf(r, 3)
	if !e.line || !top.line {
		t.Fatalf("enclosing and top images are %+v and %+v, want lines", e, top)
	}
	// The interiors: the enclosing circle's outside becomes y > 1/2, and
	// the top disk becomes y < −1/2.
	if e.nx != 0 || e.ny != 1 || e.h != 0.5 || top.nx != 0 || top.ny != -1 || top.h != 0.5 {
		t.Fatalf("lines %+v and %+v, want y = ±1/2 facing out", e, top)
	}
	for _, i := range []int{1, 2} {
		got := r.Image[4*i : 4*i+4]
		want := []float64{2, 2 * r.X[i], 0, 0}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("seed circle %d's image %v, want %v", i, got, want)
		}
	}
	// Every other circle lies between the lines.
	for i := 4; i < len(r.Curvature); i++ {
		s := shapeOf(r, i)
		if s.line || s.negative || s.y+s.r > 0.5+1e-12 || s.y-s.r < -0.5-1e-12 {
			t.Fatalf("circle %d's image %+v leaves the strip", i, s)
		}
	}
}

// Generalized-circle tangency, from the returned shapes: two circles at
// the sum of their radii, or the difference when one encloses the other; a
// circle at its radius from a line; two lines parallel. Scale-aware.
func tangencyResidual(a, b imageShape) float64 {
	switch {
	case a.line && b.line:
		return math.Abs(a.nx*b.ny - a.ny*b.nx)
	case a.line:
		return math.Abs(math.Abs(a.nx*b.x+a.ny*b.y-a.h)-b.r) / b.r
	case b.line:
		return tangencyResidual(b, a)
	}
	d := math.Hypot(a.x-b.x, a.y-b.y)
	want := a.r + b.r
	if a.negative != b.negative {
		want = math.Abs(a.r - b.r)
	}
	return math.Abs(d-want) / math.Max(a.r, b.r)
}

func TestGardenInversionKeepsTangency(t *testing.T) {
	for _, seed := range []string{GardenSeed, "-1,3,3,3,3,3,3,3", "-3,5,8,8", "split 1/4"} {
		for _, p := range testPoles {
			r := mustImage(t, inverted(seedGarden(seed, 12, 0.003, 5000), p.x, p.y, p.r, pageWindow))
			worst, descartes := 0.0, 0.0
			for i := range r.Curvature {
				if r.Generation[i] == 0 {
					continue
				}
				s := shapeOf(r, i)
				ps := r.Parents[i]
				for _, j := range ps {
					worst = math.Max(worst, tangencyResidual(s, shapeOf(r, int(j))))
				}
				if o := int(r.Opposite[i]); o >= 0 {
					q := []int{i, int(ps[0]), int(ps[1]), int(ps[2])}
					sum, sq, mag := 0.0, 0.0, 0.0
					for _, k := range q {
						b := r.Image[4*k]
						sum += b
						sq += b * b
						mag = math.Max(mag, math.Abs(b))
					}
					descartes = math.Max(descartes, math.Abs(sum*sum-2*sq)/(mag*mag))
				}
			}
			if worst > 1e-8 || descartes > 1e-8 {
				t.Errorf("%s, pole %s: tangency residual %.3g, Descartes %.3g", seed, p.name, worst, descartes)
			}
		}
	}
}

// identity is a circle's exact identity, whatever its seed.
func identity(r GardenResult, i int) [6]float64 {
	if r.Exact != nil {
		var k [6]float64
		copy(k[:], r.Exact[6*i:])
		return k
	}
	return [6]float64{r.Curvature[i], 0, r.WeightedX[i], 0, r.WeightedY[i], 0}
}

// The image of circle i under the pole, by the closed form from the source
// center and radius: center, radius and whether it is a bounded disk.
func closedImage(r GardenResult, i int, px, py, rho float64) (x, y, radius float64, bounded bool) {
	dx, dy := r.X[i]-px, r.Y[i]-py
	delta := dx*dx + dy*dy - r.Radius[i]*r.Radius[i]
	k := rho * rho / delta
	bounded = (delta > 0) == (r.Curvature[i] > 0)
	return px + k*dx, py + k*dy, math.Abs(k) * r.Radius[i], bounded
}

func meetsWindow(x, y, radius float64, w GardenWindow) bool {
	cx := math.Max(w.XMin, math.Min(w.XMax, x))
	cy := math.Max(w.YMin, math.Min(w.YMax, y))
	return math.Hypot(x-cx, y-cy) <= radius
}

// A view's packing against brute force: every circle of the unpruned
// packing at the same depth whose image meets the window, and whose image
// is at least the minimum radius, is present, in breadth-first order, and
// nothing outside that packing is.
func TestGardenInversionKeepsEveryVisibleCircle(t *testing.T) {
	for _, seed := range []string{GardenSeed, "-6,11,14,15", "-1,3,3,3,3,3,3,3", "split 1/5"} {
		full := mustGarden(t, seedGarden(seed, 6, 1e-9, 5000))
		if full.Stopped != "" {
			t.Fatalf("%s: the reference stopped: %s", seed, full.Stopped)
		}
		where := map[[6]float64]int{}
		for i := range full.Curvature {
			where[identity(full, i)] = i
		}
		windows := []GardenWindow{pageWindow, {XMin: -0.2, XMax: 0.1, YMin: 0.3, YMax: 0.5}, {XMin: 0.8, XMax: 3, YMin: -2, YMax: -1}}
		checked := 0
		for _, p := range testPoles {
			for _, w := range windows {
				for _, m := range []float64{0.05, 0.004} {
					r := mustImage(t, inverted(seedGarden(seed, 6, m, 5000), p.x, p.y, p.r, w))
					mine := map[[6]float64]bool{}
					last := -1
					for k := range r.Curvature {
						key := identity(r, k)
						mine[key] = true
						at, ok := where[key]
						if !ok || at <= last {
							t.Fatalf("%s, pole %s, %+v: circle %d is not in breadth-first order of the full packing", seed, p.name, w, k)
						}
						last = at
					}
					for k := range full.Curvature {
						x, y, radius, bounded := closedImage(full, k, p.x, p.y, p.r)
						if !bounded || radius < m || !meetsWindow(x, y, radius, w) {
							continue
						}
						checked++
						if !mine[identity(full, k)] {
							t.Fatalf("%s, pole %s, %+v, radius %v: visible circle %d (image radius %v) is missing", seed, p.name, w, m, k, radius)
						}
					}
				}
			}
		}
		t.Logf("%s: %d visible circles checked", seed, checked)
	}
}

// When the pole lies outside a gap's dual disk, the gap's first circle has
// the largest image of every circle that fills the gap. Checked on every
// gap of an unpruned packing, from the closed form.
func TestGardenInversionFirstCircleIsLargest(t *testing.T) {
	for _, seed := range []string{GardenSeed, "-6,11,14,15", "3-2r3,1,1,1"} {
		r := mustGarden(t, seedGarden(seed, 7, 1e-9, 5000))
		// descendants: each circle's generators are in its ancestry.
		n := len(r.Curvature)
		children := make([][]int, n)
		for i := range r.Curvature {
			if r.Generation[i] > 0 {
				for _, p := range r.Parents[i] {
					children[int(p)] = append(children[int(p)], i)
				}
			}
		}
		for _, p := range testPoles {
			gaps := 0
			for d := range r.Curvature {
				if r.Generation[d] == 0 {
					continue
				}
				// The pole against the gap's dual disk, from the contacts.
				gx, gy, gr := gapDisk(r, d)
				if math.Hypot(p.x-gx, p.y-gy) <= gr*(1+1e-9) {
					continue
				}
				_, _, rd, _ := closedImage(r, d, p.x, p.y, p.r)
				seen := map[int]bool{}
				stack := append([]int{}, children[d]...)
				for len(stack) > 0 {
					e := stack[len(stack)-1]
					stack = stack[:len(stack)-1]
					if seen[e] {
						continue
					}
					seen[e] = true
					stack = append(stack, children[e]...)
					_, _, re, bounded := closedImage(r, e, p.x, p.y, p.r)
					if !bounded || re > rd*(1+1e-9) {
						t.Fatalf("%s, pole %s: circle %d's image (%v) exceeds its gap's first circle %d (%v)", seed, p.name, e, re, d, rd)
					}
				}
				gaps++
			}
			if gaps < 100 {
				t.Fatalf("%s, pole %s: only %d gaps checked", seed, p.name, gaps)
			}
		}
	}
}

// A view leaves out exactly what its cutoffs say: no admitted circle's
// first circle was small when it could have been pruned, and the counts
// add up.
func TestGardenInversionReportsItsCutoffs(t *testing.T) {
	r := mustImage(t, inverted(garden(12, 0.002, 5000), 0, 1, 1, pageWindow))
	if r.Omitted.View == 0 || r.Omitted.Radius == 0 {
		t.Fatalf("strip omitted %+v, want gaps outside the view and below the radius", r.Omitted)
	}
	if r.Stopped != "" || len(r.Curvature) > 2000 {
		t.Fatalf("strip: %d circles, stopped %q", len(r.Curvature), r.Stopped)
	}
	if got := r.Processed; got != len(r.Curvature)-4+r.Omitted.Radius+r.Omitted.Depth+r.Omitted.View+r.Duplicates {
		t.Fatalf("processed %d does not add up: %+v", got, r)
	}
	// The source's minimum radius plays no part: the view's is in the
	// image, so a far smaller one in the source would change nothing.
	r2 := mustImage(t, inverted(garden(12, 0.002, 5000), 0, 1, 1, pageWindow))
	if !reflect.DeepEqual(r, r2) {
		t.Fatal("a view is not deterministic")
	}
}

// The circle and gap limits bound a view, its kept ancestry included.
func TestGardenInversionIsBounded(t *testing.T) {
	r := mustImage(t, inverted(garden(12, 1e-6, 300), 0.3, 0.3, 0.5, pageWindow))
	if r.Stopped != "count" || len(r.Curvature) != 300 {
		t.Fatalf("got %d circles, stopped %q", len(r.Curvature), r.Stopped)
	}
	r, err := computeGarden(inverted(garden(12, 1e-6, 5000), 0, 0, 0.6, pageWindow), gardenLimits{500})
	if err != nil || r.Stopped != "configurations" || r.Processed != 500 {
		t.Fatalf("work limit: %v, %q after %d", err, r.Stopped, r.Processed)
	}
}

// Without an inversion nothing changes: no image, the same reply.
func TestGardenWithoutInversionIsUnchanged(t *testing.T) {
	r := mustGarden(t, garden(12, 0.002, 5000))
	if r.Image != nil {
		t.Fatal("a garden without a view has an image")
	}
}

// The glide: exact ends and middle, a frozen packing whose every frame is
// its circles inverted about the frame's pole, and which holds every
// circle each frame's own view would generate.
func TestGardenGlidePath(t *testing.T) {
	q := inverted(garden(12, 0.004, 5000), 0, 1, 1, pageWindow)
	q.Glide = &GardenPoint{X: 0.1, Y: 1.4}
	for _, c := range []struct{ p, x, y float64 }{{0, 0, 1}, {1, 0, 1}, {0.5, 0.1, 1.4}} {
		x, y := q.poleAt(c.p)
		if x != c.x || y != c.y {
			t.Fatalf("pole at %v is (%v, %v), want (%v, %v)", c.p, x, y, c.x, c.y)
		}
	}
	checkGlide(t, q)
	// Through the packing, across the tangency at (0, 1), with a seed
	// exact in ℤ[√3] too.
	cross := inverted(garden(12, 0.004, 5000), 0, 1.3, 1, pageWindow)
	cross.Glide = &GardenPoint{X: 0, Y: 0.85}
	checkGlide(t, cross)
	three := inverted(seedGarden("3-2r3,1,1,1", 12, 0.004, 5000), 0.2, 0.9, 0.8, pageWindow)
	three.Glide = &GardenPoint{X: -0.4, Y: 0.3}
	checkGlide(t, three)
}

func checkGlide(t *testing.T, q GardenRequest) {
	t.Helper()
	rho := q.Inversion.Radius
	r := mustImage(t, q)
	src, err := NewGardenSource(q)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []float64{0, 1} {
		f, err := src.Frame(GardenFrameRequest{Garden: q, Progress: p})
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(f.Image, r.Image) {
			for k := range f.Image {
				if f.Image[k] != r.Image[k] {
					t.Fatalf("glide %+v: frame at %v differs from the static view at %d: %v vs %v", *q.Glide, p, k, f.Image[k], r.Image[k])
				}
			}
			t.Fatalf("length")
		}
	}
	have := map[[6]float64]bool{}
	for i := range r.Curvature {
		have[identity(r, i)] = true
	}
	if r.Stopped != "" {
		t.Fatalf("glide %+v stopped: %q", *q.Glide, r.Stopped)
	}
	for _, p := range []float64{0.03, 0.1, 0.2, 0.27, 0.3, 0.4, 0.5, 0.65, 0.8, 0.96} {
		f, err := src.Frame(GardenFrameRequest{Garden: q, Progress: p})
		if err != nil {
			t.Fatal(err)
		}
		x, y := q.poleAt(p)
		if f.Pole != [2]float64{x, y} {
			t.Fatalf("frame %v's pole %v", p, f.Pole)
		}
		frame := r
		frame.Image = f.Image
		for i := range r.Curvature {
			s := shapeOf(frame, i)
			a := 1.3
			cx, cy := r.X[i]+r.Radius[i]*math.Cos(a), r.Y[i]+r.Radius[i]*math.Sin(a)
			wx, wy := invertPoint(x, y, rho, cx, cy)
			if s.residual(wx, wy) > 1e-9 {
				t.Fatalf("frame %v, circle %d: not the source inverted about the frame's pole", p, i)
			}
		}
		alone := q
		alone.Glide = nil
		own := mustImage(t, inverted(alone, x, y, rho, pageWindow))
		for i := range own.Curvature {
			if !have[identity(own, i)] {
				t.Fatalf("glide %+v, frame %v: its own view's circle %d is missing", *q.Glide, p, i)
			}
		}
	}
	// A frame for other settings is refused.
	other := q
	other.Depth = 11
	if _, err := src.Frame(GardenFrameRequest{Garden: other, Progress: 0.3}); err == nil {
		t.Fatal("a frame for other settings was accepted")
	}
}

func TestGardenInversionRefusals(t *testing.T) {
	base := inverted(garden(12, 0.002, 5000), 0, 1, 1, pageWindow)
	cases := []struct {
		field string
		edit  func(q *GardenRequest)
	}{
		{"inversion.x", func(q *GardenRequest) { q.Inversion.X = 2.5 }},
		{"inversion.x", func(q *GardenRequest) { q.Inversion.X = math.NaN() }},
		{"inversion.y", func(q *GardenRequest) { q.Inversion.Y = -2.01 }},
		{"inversion.radius", func(q *GardenRequest) { q.Inversion.Radius = 0.04 }},
		{"inversion.radius", func(q *GardenRequest) { q.Inversion.Radius = 2.5 }},
		{"inversion.radius", func(q *GardenRequest) { q.Inversion.Radius = math.Inf(1) }},
		{"window", func(q *GardenRequest) { q.Window = nil }},
		{"glide.x", func(q *GardenRequest) { q.Glide = &GardenPoint{X: 3, Y: 0} }},
		{"glide.y", func(q *GardenRequest) { q.Glide = &GardenPoint{X: 0, Y: math.Inf(-1)} }},
		{"glide", func(q *GardenRequest) { q.Inversion, q.Glide = nil, &GardenPoint{} }},
	}
	for _, c := range cases {
		q := base
		inv := *base.Inversion
		q.Inversion = &inv
		c.edit(&q)
		_, err := ComputeGarden(q)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Errorf("%s: got %v", c.field, err)
		}
	}
	src, _ := NewGardenSource(base)
	for _, p := range []float64{-0.1, 1.1, math.NaN()} {
		_, err := src.Frame(GardenFrameRequest{Garden: base, Progress: p})
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != "progress" {
			t.Errorf("progress %v: got %v", p, err)
		}
	}
}

// Exact co-curvature: every circle's b̄ = (X² + Y² − D²)/b in the seed's
// units, recomputed in big integers, is what generation carried.
func TestGardenCoCurvatureIsExact(t *testing.T) {
	for _, seed := range append(append([]string{}, catalogSeeds...), "split 1/20", "split 19/20", "split 37/97") {
		q := seedGarden(seed, 12, 0.002, 5000)
		s, err := q.spec()
		if err != nil {
			t.Fatal(err)
		}
		var cos []qr
		k := s.coScale()
		_, err = computeGardenWith(q, s, gardenLimits{GardenMaxConfigurations}, func(c gardenCircle, co qr) {
			// b·b̄ = k(X² + Y² − D²), exactly in ℤ[√3].
			left := zMul([2]*big.Int{big.NewInt(c.b.p), big.NewInt(c.b.q)}, [2]*big.Int{big.NewInt(co.p), big.NewInt(co.q)})
			x := [2]*big.Int{big.NewInt(c.x.p), big.NewInt(c.x.q)}
			y := [2]*big.Int{big.NewInt(c.y.p), big.NewInt(c.y.q)}
			right := zMul(zInt(k), zSub(zAdd(zMul(x, x), zMul(y, y)), zInt(s.denom*s.denom)))
			if !zEq(left, right) {
				t.Fatalf("%s: circle %+v has co-curvature %+v", seed, c, co)
			}
			cos = append(cos, co)
		})
		if err != nil || len(cos) < 300 {
			t.Fatalf("%s: %v, %d circles", seed, err, len(cos))
		}
	}
}

var _ = fmt.Sprint

// The Bernstein bound never falls below the quartic on its piece, and is
// close to its maximum on a short one.
func TestGardenBernsteinBound(t *testing.T) {
	for k := 0; k < 200; k++ {
		var f [5]float64
		for j := range f {
			f[j] = math.Sin(float64(7*k+3*j)) * math.Pow(10, float64((k+j)%5))
		}
		a, w := math.Mod(float64(k)*0.137, 0.9), 0.1
		mx := math.Inf(-1)
		for i := 0; i <= 1000; i++ {
			s := a + w*float64(i)/1000
			mx = math.Max(mx, f[0]+s*(f[1]+s*(f[2]+s*(f[3]+s*f[4]))))
		}
		b := bernsteinMax(f, a, w)
		size := 0.0
		for _, c := range f {
			size += math.Abs(c)
		}
		if b < mx-1e-12*size {
			t.Fatalf("case %d: bound %v below the maximum %v", k, b, mx)
		}
		if b > mx+0.05*size {
			t.Fatalf("case %d: bound %v far above the maximum %v", k, b, mx)
		}
	}
}

// The image cutoff is exact: a circle whose gap's dual disk excludes the
// pole is admitted only when its image reaches the minimum radius; a
// smaller one is kept only where the pole lies in or on its gap's dual
// disk, whose circles may be larger than its first.
func TestGardenInversionCutoffIsExact(t *testing.T) {
	for _, seed := range []string{GardenSeed, "-6,11,14,15", "split 1/5"} {
		for _, p := range testPoles {
			for _, m := range []float64{0.01, 0.003} {
				r := mustImage(t, inverted(seedGarden(seed, 12, m, 5000), p.x, p.y, p.r, pageWindow))
				for i := range r.Curvature {
					if r.Generation[i] == 0 || r.Opposite[i] < 0 {
						continue
					}
					gx, gy, gr := gapDisk(r, i)
					if math.Hypot(p.x-gx, p.y-gy) <= gr*(1+1e-6) {
						continue
					}
					if _, _, radius, _ := closedImage(r, i, p.x, p.y, p.r); radius < m*(1-1e-9) {
						t.Fatalf("%s, pole %s, radius %v: circle %d's image %v is below the cutoff", seed, p.name, m, i, radius)
					}
				}
			}
		}
	}
}

// A selection outside an inverted view is kept, with its generators, as
// it is for zoom detail.
func TestGardenInversionKeepsTheChosenCircle(t *testing.T) {
	// Curvature 23 at (8/23, 12/23); a window far from its image.
	w := GardenWindow{XMin: -1.4, XMax: -1.2, YMin: -0.1, YMax: 0.1}
	q := inverted(garden(12, 0.002, 5000), 0, 1, 1, w)
	without := mustImage(t, q)
	keyed := func(r GardenResult) map[identityKey]int { return indexByIdentity(r) }
	if _, ok := keyed(without)[identityKey{23, 8, 12}]; ok {
		t.Fatal("the window already holds the circle")
	}
	q.Keep = &GardenIdentity{Curvature: 23, X: 8, Y: 12}
	with := mustImage(t, q)
	at, ok := keyed(with)[identityKey{23, 8, 12}]
	if !ok {
		t.Fatal("the kept circle is missing")
	}
	for _, p := range with.Parents[at] {
		if p < 0 || int(p) >= at {
			t.Fatalf("generator %v of the kept circle %d", p, at)
		}
	}
	if len(with.Curvature) > len(without.Curvature)+12 {
		t.Fatalf("keeping added %d circles", len(with.Curvature)-len(without.Curvature))
	}
}
