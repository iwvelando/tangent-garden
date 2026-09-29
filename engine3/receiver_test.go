package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// receive adds a receiver on plane axis = at, a window of side size centred
// on (c1, c2), with bins × bins bins.
func receive(c Request, axis string, at, c1, c2, size float64, bins int) Request {
	c.Rays.Receiver = ReceiverRequest{Plane: axis, At: at, C1: c1, C2: c2, Size: size, Bins: bins}
	return c
}

func received(t *testing.T, c Request) *Receiver {
	t.Helper()
	r := rayed(t, c)
	if r.Receiver == nil {
		t.Fatal("no receiver")
	}
	g := r.Receiver
	if len(g.Irradiance) != c.Rays.Receiver.Bins || len(g.Irradiance[0]) != c.Rays.Receiver.Bins {
		t.Fatalf("%d × %d bins", len(g.Irradiance), len(g.Irradiance[0]))
	}
	return g
}

// accounted checks that every emitted unit of flux is accounted for once.
func accounted(t *testing.T, g *Receiver) {
	t.Helper()
	sum, peak := 0.0, 0.0
	bin := g.Size / float64(len(g.Irradiance))
	for _, column := range g.Irradiance {
		for _, e := range column {
			if !(e >= -1e-9*g.Peak) {
				t.Fatalf("negative irradiance %v", e)
			}
			sum += e * bin * bin
			peak = math.Max(peak, e)
		}
	}
	if math.Abs(sum-g.Received) > 1e-9*(1+g.Emitted) || peak != g.Peak {
		t.Fatalf("received %v, bins hold %v; peak %v, %v", g.Received, sum, g.Peak, peak)
	}
	if got := g.Received + g.Outside + g.Away + g.Total + g.Edge; math.Abs(got-g.Emitted) > 1e-9*g.Emitted || g.Outside < -1e-9*g.Emitted {
		t.Fatalf("emitted %v, accounted %v (%+v)", g.Emitted, got, g)
	}
}

// Parallel light of unit irradiance crosses a flat interface at θ₁ = 30°:
// each unit of interface receives cos θ₁, and the transmitted rays, all
// parallel, carry it unchanged to a parallel receiver. Reflected, it is the
// same above.
func TestReceiverUniform(t *testing.T) {
	cos := math.Sqrt(3) / 2
	for _, c := range []Request{
		receive(glass(flat(1.5, parallel(0, -60)), 1, 1.5), "z", -1, .1, 0, 1, 16),
		receive(flat(1.5, parallel(0, -60)), "z", 1, 0, .2, 1, 16),
	} {
		g := received(t, c)
		accounted(t, g)
		if math.Abs(g.Emitted-9*cos) > 1e-12 || math.Abs(g.Received-cos) > 1e-12 {
			t.Fatalf("emitted %v, received %v", g.Emitted, g.Received)
		}
		for a, column := range g.Irradiance {
			for b, e := range column {
				if math.Abs(e-cos) > 1e-12 {
					t.Fatalf("bin (%d, %d): %v", a, b, e)
				}
			}
		}
		if g.Away != 0 || g.Total != 0 || g.Edge != 0 {
			t.Fatalf("%+v", g)
		}
	}
	// Behind the surface, the plane receives nothing.
	g := received(t, receive(flat(1.5, parallel(0, -60)), "z", -1, 0, 0, 1, 16))
	accounted(t, g)
	if g.Received != 0 || math.Abs(g.Away-g.Emitted) > 1e-12 {
		t.Fatalf("%+v", g)
	}
}

// A lamp of unit intensity at height h above a square mirror [−1, 1]²:
// the mirror subtends 4 arctan(1/(h√(2 + h²))) steradians, the emitted
// flux, to second order in the grid. The reflected rays leave the lamp's
// image S′, so a receiver at height z gets E = |z − S′_z|/|Y − S′|³. Each
// bin holds the mean over the bin of the flux spread evenly over each
// cell's image, which converges to the mean of E at second order.
func TestReceiverPointSource(t *testing.T) {
	h := 1.0
	omega := 4 * math.Atan(1/(h*math.Sqrt(2+h*h)))
	image := Vec3{0, 0, -h}
	// mean integrates E over bin (a, b) by 8-point Gauss–Legendre.
	nodes := []float64{-.9602898564975363, -.7966664774136267, -.5255324099163290, -.1834346424956498, .1834346424956498, .5255324099163290, .7966664774136267, .9602898564975363}
	weights := []float64{.1012285362903763, .2223810344533745, .3137066458778873, .3626837833783620, .3626837833783620, .3137066458778873, .2223810344533745, .1012285362903763}
	bin := 1.2 / 8
	mean := func(a, b int) float64 {
		s := 0.0
		for k, x := range nodes {
			for l, y := range nodes {
				p := Vec3{.31 - .6 + (float64(a)+.5+x/2)*bin, -.23 - .6 + (float64(b)+.5+y/2)*bin, 2}
				s += weights[k] * weights[l] * (2 + h) / math.Pow(p.sub(image).norm(), 3)
			}
		}
		return s / 4
	}
	fluxes, irradiances := []float64{}, []float64{}
	for _, n := range []int{30, 60, 120} {
		c := receive(flat(1, lamp(Vec3{0, 0, h})), "z", 2, .31, -.23, 1.2, 8)
		c.Surface.USamples, c.Surface.VSamples = n, n
		g := received(t, c)
		accounted(t, g)
		if g.Outside <= 0 || g.Received <= 0 || g.Away != 0 || g.Edge != 0 {
			t.Fatalf("%+v", g)
		}
		fluxes = append(fluxes, math.Abs(g.Emitted-omega))
		worst := 0.0
		for a, column := range g.Irradiance {
			for b, e := range column {
				want := mean(a, b)
				worst = math.Max(worst, math.Abs(e-want)/want)
			}
		}
		irradiances = append(irradiances, worst)
	}
	if fluxes[0] > 1e-3 || irradiances[0] > 1e-2 {
		t.Fatalf("emitted flux error %v, worst relative irradiance error %v", fluxes[0], irradiances[0])
	}
	for k := 1; k < 3; k++ {
		if fluxes[k] > fluxes[k-1]/3.5 || irradiances[k] > irradiances[k-1]/3 {
			t.Fatalf("emitted flux errors %v, worst relative irradiance errors %v", fluxes, irradiances)
		}
	}
}

// A paraboloid z = k(x² + y²)/2 sends axial light through its focus, so a
// receiver in the focal plane z = 1/(2k) collects all of it in the focus's
// bin: each cell's image is a point.
func TestReceiverFocus(t *testing.T) {
	c := receive(mirror("paraboloid", .5, .5, 0, -1, 1, -1, 1, 24, 24, parallel(0, -90)), "z", 1, 0, 0, 1, 9)
	g := received(t, c)
	accounted(t, g)
	bin := 1.0 / 9
	// Rounding in the running sums leaves no residue where no light lands.
	for a, column := range g.Irradiance {
		for b, e := range column {
			if (a != 4 || b != 4) && e != 0 {
				t.Fatalf("bin (%d, %d) holds %v", a, b, e)
			}
		}
	}
	if math.Abs(g.Emitted-4) > 1e-12 || math.Abs(g.Received-4) > 1e-9 || math.Abs(g.Irradiance[4][4]*bin*bin-4) > 1e-9 {
		t.Fatalf("emitted %v, received %v, centre %v", g.Emitted, g.Received, g.Irradiance[4][4]*bin*bin)
	}
}

// Every lit unit of flux is received, lands outside the window, misses the
// plane, is totally reflected, or falls in a cell at the light's edge. A
// sphere intercepts πR² of a parallel beam; a lamp inside a sphere, 4π.
func TestReceiverAccounting(t *testing.T) {
	R := 1.2
	edges := []float64{}
	for _, n := range []int{20, 40, 80} {
		c := receive(mirror("ellipsoid", R, R, R, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 2*n, n, parallel(30, -50)), "x", 3, 0, 0, 4, 32)
		g := received(t, c)
		accounted(t, g)
		if math.Abs(g.Emitted-math.Pi*R*R) > 2e-2 {
			t.Fatalf("n = %d: a sphere intercepts %v, want %v", n, g.Emitted, math.Pi*R*R)
		}
		edges = append(edges, g.Edge)
	}
	if !(edges[0] > 0 && edges[1] < edges[0]*.7 && edges[2] < edges[1]*.7) {
		t.Fatalf("the edge's flux shrinks with the grid: %v", edges)
	}
	// Beyond the critical angle, sin θ₁ > 2/3, the lamp's light stays in
	// the glass: 0.94 from the centre, it reaches that far on 1.2.
	c := glass(inside(mirror("ellipsoid", R, R, R, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 160, 80, lamp(Vec3{.3, .4, .8}))), 1.5, 1)
	g := received(t, receive(c, "y", -2, 0, 0, 6, 24))
	accounted(t, g)
	if math.Abs(g.Emitted-4*math.Pi) > 2e-2 || g.Total <= 0 || g.Away <= 0 || g.Received <= 0 {
		t.Fatalf("%+v", g)
	}
	// The totally reflected flux leaves the glass beyond the critical angle.
	r := rayed(t, receive(c, "y", -2, 0, 0, 6, 24))
	if r.Total == 0 {
		t.Fatal("no sample is beyond the critical angle")
	}
}

// Rasterizing a triangle spreads its flux over the window's bins by exact
// area, clipped to the window, however it is oriented.
func TestRasterTriangle(t *testing.T) {
	area := func(p [][2]float64) float64 {
		s := 0.0
		for k := range p {
			q := p[(k+1)%len(p)]
			s += p[k][0]*q[1] - q[0]*p[k][1]
		}
		return math.Abs(s) / 2
	}
	// clip keeps the part of polygon p where the coordinate axis is on the
	// side of edge given by keep.
	clip := func(p [][2]float64, axis int, edge float64, keep func(float64) bool) [][2]float64 {
		out := [][2]float64{}
		for k := range p {
			a, b := p[k], p[(k+1)%len(p)]
			if keep(a[axis]) {
				out = append(out, a)
			}
			if keep(a[axis]) != keep(b[axis]) {
				s := (edge - a[axis]) / (b[axis] - a[axis])
				out = append(out, [2]float64{a[0] + s*(b[0]-a[0]), a[1] + s*(b[1]-a[1])})
			}
		}
		return out
	}
	within := func(p [][2]float64, x0, x1, y0, y1 float64) float64 {
		p = clip(p, 0, x0, func(x float64) bool { return x >= x0 })
		p = clip(p, 0, x1, func(x float64) bool { return x <= x1 })
		p = clip(p, 1, y0, func(y float64) bool { return y >= y0 })
		p = clip(p, 1, y1, func(y float64) bool { return y <= y1 })
		if len(p) < 3 {
			return 0
		}
		return area(p)
	}
	for _, tri := range [][3][2]float64{
		{{.3, .4}, {3.7, 1.2}, {1.9, 3.3}},
		{{-1, .5}, {3, .5}, {1, 2.5}},
		{{1.9, 3.3}, {3.7, 1.2}, {.3, .4}},
		{{-3, -2}, {9, 1.5}, {2.2, 7}},
		{{2.5, 2.5}, {2.5 + 1e-3, 2.5}, {2.5, 2.5 + 2e-3}},
		{{-.5, 1}, {6, 1.5}, {-.5, 1.25}},
	} {
		g := newRaster(4, 4)
		g.triangle(tri, 2)
		bins := g.bins()
		whole := area(tri[:])
		for a := 0; a < 4; a++ {
			for b := 0; b < 4; b++ {
				want := 2 * within(tri[:], float64(a), float64(a+1), float64(b), float64(b+1)) / whole
				if math.Abs(bins[a][b]-want) > 1e-12+1e-15/whole {
					t.Fatalf("%v: bin (%d, %d) holds %v, want %v", tri, a, b, bins[a][b], want)
				}
			}
		}
	}
	// A triangle with no area deposits its flux at its centroid.
	g := newRaster(4, 4)
	g.triangle([3][2]float64{{1.2, 2.5}, {1.2, 2.5}, {1.2, 2.5}}, 3)
	g.triangle([3][2]float64{{5, 2}, {5, 2}, {5, 2}}, 3)
	if bins := g.bins(); bins[1][2] != 3 {
		t.Fatal(bins)
	}
}

func TestReceiverValidation(t *testing.T) {
	ok := func() Request {
		return receive(mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 36, 24, parallel(10, -45)), "z", -2, 0, 0, 4, 32)
	}
	for _, tc := range []struct {
		change func(*Request)
		want   string
	}{
		{func(c *Request) { c.Rays.Receiver.Plane = "w" }, "receiver plane"},
		{func(c *Request) { c.Rays.Receiver.Plane = "" }, "receiver plane"},
		{func(c *Request) { c.Rays.Receiver.At = math.NaN() }, "receiver's position"},
		{func(c *Request) { c.Rays.Receiver.C2 = 2e5 }, "receiver's position"},
		{func(c *Request) { c.Rays.Receiver.Size = 0 }, "receiver's size"},
		{func(c *Request) { c.Rays.Receiver.Size = math.Inf(1) }, "receiver's size"},
		{func(c *Request) { c.Rays.Receiver.Bins = 7 }, "bins"},
		{func(c *Request) { c.Rays.Receiver.Bins = 241 }, "bins"},
	} {
		c := ok()
		tc.change(&c)
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("want %q, got %v", tc.want, err)
		}
	}
	// Without a receiver its fields are not read.
	c := ok()
	c.Rays.Receiver = ReceiverRequest{Plane: "none", At: math.NaN(), Bins: -1}
	if r := rayed(t, c); r.Receiver != nil {
		t.Fatal("a receiver without a plane")
	}
	c = ok()
	c.Rays.Receiver.Bins = 240
	c.Surface.USamples, c.Surface.VSamples = 240, 60
	g := received(t, c)
	accounted(t, g)
}

// The window's corners run (lo, lo), (hi, lo), (hi, hi), (lo, hi) in the
// plane's cyclic coordinates, and the window fits in the study's bounds.
func TestReceiverWindow(t *testing.T) {
	for _, tc := range []struct {
		axis string
		want Vec3
	}{
		{"x", Vec3{5, 1.5, 3.5}},
		{"y", Vec3{3.5, 5, 1.5}},
		{"z", Vec3{1.5, 3.5, 5}},
	} {
		c := receive(flat(1, parallel(0, -60)), tc.axis, 5, 1, 3, 1, 8)
		out, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		g := out.Rays.Receiver
		if g.Corners[2] != tc.want || g.Corners[0].sub(g.Corners[2]).norm() != math.Sqrt2 {
			t.Fatalf("%s: corners %+v", tc.axis, g.Corners)
		}
		for _, p := range g.Corners {
			if p.sub(out.Bounds.Center).norm() > out.Bounds.Radius*(1+1e-12) {
				t.Fatalf("%s: %+v lies outside %+v", tc.axis, p, out.Bounds)
			}
		}
	}
}

func TestReceiverJSON(t *testing.T) {
	var c Request
	if err := json.Unmarshal([]byte(`{"format":"rays","surface":{"kind":"paraboloid","a":0.5,"b":0.5,"uMin":-1,"uMax":1,"vMin":-1,"vMax":1,"uSamples":12,"vSamples":12,"curves":3},"rays":{"interaction":"refract","n1":1,"n2":1.5,"light":"parallel","azimuth":0,"elevation":-90,"length":1,"receiver":{"plane":"z","at":-2,"c1":0.5,"c2":-0.5,"size":3,"bins":10}}}`), &c); err != nil {
		t.Fatal(err)
	}
	if want := (ReceiverRequest{"z", -2, .5, -.5, 3, 10}); c.Rays.Receiver != want {
		t.Fatalf("%+v", c.Rays.Receiver)
	}
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(out)
	for _, key := range []string{`"receiver":{"plane":"z","corners":[{"x":`, `"irradiance":[[`, `"peak":`, `"emitted":`, `"received":`, `"outside":`, `"away":`, `"total":`, `"edge":`} {
		if !strings.Contains(string(b), key) {
			t.Fatalf("missing %s in %s", key, string(b)[:200])
		}
	}
}

// Where no light lands a bin holds exactly nothing, not the running sums'
// rounding, and no bin is negative: here a glass dome's light, cut by a
// plane across its caustic, lands within 0.2 of the axis, brightest on a
// ring at its rim.
func TestReceiverClean(t *testing.T) {
	c := glass(mirror("ellipsoid", 1.5, 1.5, 1.5, 0, 2*math.Pi, .6, math.Pi/2, 120, 60, parallel(0, -90)), 1, 1.5)
	g := received(t, receive(c, "z", -1.9, 0, 0, .6, 60))
	accounted(t, g)
	bin := .6 / 60
	rim, centre := 0.0, g.Irradiance[30][30]
	for a, column := range g.Irradiance {
		for b, e := range column {
			r := math.Hypot(-.3+(float64(a)+.5)*bin, -.3+(float64(b)+.5)*bin)
			if e < 0 || r > .2 && e != 0 {
				t.Fatalf("bin (%d, %d) at radius %v holds %v", a, b, r, e)
			}
			if r > .1 {
				rim = math.Max(rim, e)
			}
		}
	}
	if !(rim > 5*centre && centre > 0) {
		t.Fatalf("rim %v, centre %v", rim, centre)
	}
}
