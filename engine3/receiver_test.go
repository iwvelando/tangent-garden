package engine3

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

// receive adds a receiver on plane axis = at, a window of side size centered
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
		t.Fatalf("emitted %v, received %v, center %v", g.Emitted, g.Received, g.Irradiance[4][4]*bin*bin)
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
	// the glass: 0.94 from the center, it reaches that far on 1.2.
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
		{func(c *Request) { c.Rays.Receiver.Bins = 961 }, "bins"},
		{func(c *Request) { c.Rays.Receiver.Tilt = math.NaN() }, "receiver's tilt"},
		{func(c *Request) { c.Rays.Receiver.Tilt = -2e5 }, "receiver's tilt"},
		{func(c *Request) { c.Rays.Receiver.Refine = -1 }, "0–3 refinement levels"},
		{func(c *Request) { c.Rays.Receiver.Refine = 4 }, "0–3 refinement levels"},
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
	c.Rays.Receiver.Bins = 960
	c.Rays.Receiver.Refine = 3
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
	if want := (ReceiverRequest{Plane: "z", At: -2, C1: .5, C2: -.5, Size: 3, Bins: 10}); c.Rays.Receiver != want {
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
	// A tilt is read in degrees, and absent is none.
	var r ReceiverRequest
	if err := json.Unmarshal([]byte(`{"plane":"x","at":1,"c1":0,"c2":0,"size":1,"bins":8,"tilt":-35}`), &r); err != nil || r.Tilt != -35 {
		t.Fatalf("%+v, %v", r, err)
	}
	if b, _ := json.Marshal(ReceiverRequest{Plane: "z", Size: 1, Bins: 8}); strings.Contains(string(b), "tilt") {
		t.Fatalf("an untilted receiver marshals %s", b)
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
	rim, center := 0.0, g.Irradiance[30][30]
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
	if !(rim > 5*center && center > 0) {
		t.Fatalf("rim %v, center %v", rim, center)
	}
}

// tilted turns receiver c's window by tilt degrees about its first axis.
func tilted(c Request, tilt float64) Request {
	c.Rays.Receiver.Tilt = tilt
	return c
}

// A tilted window turns about its first axis through its center, right
// handed: on z = 5 about x, its second axis y rises toward z. Its corners
// still run (lo, lo), (hi, lo), (hi, hi), (lo, hi) in its own coordinates.
func TestReceiverTiltedWindow(t *testing.T) {
	near := func(p, q Vec3) bool { return p.sub(q).norm() < 1e-12 }
	for _, tc := range []struct {
		axis string
		tilt float64
		want [4]Vec3
	}{
		// Turned a right angle, the window stands upright exactly.
		{"z", 90, [4]Vec3{{.5, 3, 4.5}, {1.5, 3, 4.5}, {1.5, 3, 5.5}, {.5, 3, 5.5}}},
		{"x", -90, [4]Vec3{{5.5, .5, 3}, {5.5, 1.5, 3}, {4.5, 1.5, 3}, {4.5, .5, 3}}},
		{"y", 180, [4]Vec3{{3.5, 5, .5}, {3.5, 5, 1.5}, {2.5, 5, 1.5}, {2.5, 5, .5}}},
		{"z", 30, [4]Vec3{{.5, 3 - math.Sqrt(3)/4, 4.75}, {1.5, 3 - math.Sqrt(3)/4, 4.75}, {1.5, 3 + math.Sqrt(3)/4, 5.25}, {.5, 3 + math.Sqrt(3)/4, 5.25}}},
	} {
		c := tilted(receive(flat(1, parallel(0, -60)), tc.axis, 5, 1, 3, 1, 8), tc.tilt)
		out, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		g := out.Rays.Receiver
		for k, p := range g.Corners {
			if !near(p, tc.want[k]) {
				t.Fatalf("%s turned %v°: corners %+v", tc.axis, tc.tilt, g.Corners)
			}
			if p.sub(out.Bounds.Center).norm() > out.Bounds.Radius*(1+1e-12) {
				t.Fatalf("%s: %+v lies outside %+v", tc.axis, p, out.Bounds)
			}
		}
	}
	// Turned whole turns, the window is exactly the untilted one, bit for bit.
	for _, tilt := range []float64{360, -720} {
		c := receive(glass(flat(1.5, parallel(20, -60)), 1, 1.5), "z", -1, .1, 0, 1, 16)
		if want, got := received(t, c), received(t, tilted(c, tilt)); !reflect.DeepEqual(got, want) {
			t.Fatalf("a receiver turned whole turns differs:\n%+v\n%+v", got, want)
		}
	}
}

// Parallel light crossing a flat interface carries a uniform beam: across
// it the transmitted irradiance is cos θ₁/cos θ₂, so a plane with unit
// normal m receives cos θ₁ |T·m|/cos θ₂ wherever the beam covers it, at any
// tilt.
func TestReceiverTiltedUniform(t *testing.T) {
	in := Vec3{.5 * math.Cos(math.Pi/9), .5 * math.Sin(math.Pi/9), -math.Sqrt(3) / 2}
	out, _ := snell(in, Vec3{0, 0, 1}, 1/1.5)
	cos1, cos2 := math.Sqrt(3)/2, -out.Z
	for _, tc := range []struct {
		axis   string
		at     float64
		tilt   float64
		normal Vec3
	}{
		// z = −1 turned about x: its normal leans from +z toward −y.
		{"z", -1, 25, Vec3{0, -math.Sin(25 * math.Pi / 180), math.Cos(25 * math.Pi / 180)}},
		{"z", -1, -60, Vec3{0, math.Sin(60 * math.Pi / 180), math.Cos(60 * math.Pi / 180)}},
		// x = .3 turned about y: its normal leans from +x toward −z.
		{"x", .3, 40, Vec3{math.Cos(40 * math.Pi / 180), 0, -math.Sin(40 * math.Pi / 180)}},
		// y = .2 turned about z: its normal leans from +y toward −x.
		{"y", .2, -30, Vec3{math.Sin(30 * math.Pi / 180), math.Cos(30 * math.Pi / 180), 0}},
	} {
		// The window, 0.4 across, lies within the beam leaving [−1.5, 1.5]².
		c := receive(glass(flat(1.5, parallel(20, -60)), 1, 1.5), tc.axis, tc.at, -.5, .1, .4, 12)
		switch tc.axis {
		case "x":
			c.Rays.Receiver.C1, c.Rays.Receiver.C2 = .1, -.5
		case "y":
			// Far enough below the flat that no ray reaching it starts in a
			// cell the plane cuts.
			c.Rays.Receiver.C1, c.Rays.Receiver.C2 = -1.2, .4
		}
		g := received(t, tilted(c, tc.tilt))
		accounted(t, g)
		want := cos1 * math.Abs(out.dot(tc.normal)) / cos2
		for a, column := range g.Irradiance {
			for b, e := range column {
				if math.Abs(e-want) > 1e-9 {
					t.Fatalf("%s turned %v°: bin (%d, %d) holds %v, want %v", tc.axis, tc.tilt, a, b, e, want)
				}
			}
		}
		if math.Abs(g.Received-want*.16) > 1e-9 {
			t.Fatalf("%s turned %v°: received %v, want %v", tc.axis, tc.tilt, g.Received, want*.16)
		}
	}
}

// A paraboloid's axial light all passes through its focus, so a window
// through the focus collects all of it in the focus's bin however it is
// turned.
func TestReceiverTiltedFocus(t *testing.T) {
	for _, tilt := range []float64{30, -50, 75} {
		c := receive(mirror("paraboloid", .5, .5, 0, -1, 1, -1, 1, 24, 24, parallel(0, -90)), "z", 1, 0, 0, 1, 9)
		g := received(t, tilted(c, tilt))
		accounted(t, g)
		bin := 1.0 / 9
		for a, column := range g.Irradiance {
			for b, e := range column {
				if (a != 4 || b != 4) && e != 0 {
					t.Fatalf("turned %v°: bin (%d, %d) holds %v", tilt, a, b, e)
				}
			}
		}
		if math.Abs(g.Received-4) > 1e-9 || math.Abs(g.Irradiance[4][4]*bin*bin-4) > 1e-9 {
			t.Fatalf("turned %v°: received %v", tilt, g.Received)
		}
	}
}

// A paraboloid's axial light all passes through its focus F, so a point q
// of a turned plane is lit exactly where the line through q and F meets
// the mirror at some X with q ahead of X: before F or past it. Every bin
// whose samples are all lit holds light, and every bin whose samples are
// all dark holds none, at tilts that keep the plane above F, that cut
// through F, and that stand nearly upright.
func TestReceiverTiltedLight(t *testing.T) {
	// z = (x² + y²)/2 over [−0.3, 0.3]², below F = (0, 0, 1/2): its light
	// leaves F in a cone about 45° wide.
	f, h := .5, .3
	c := mirror("paraboloid", 1, 1, 0, -h, h, -h, h, 96, 96, parallel(0, -90))
	lit := func(q Vec3) bool {
		// L(s) = F + s(q − F) meets z = (x² + y²)/2 where
		// (d_x² + d_y²)s²/2 − d_z s − f = 0, with d = q − F.
		d := q.sub(Vec3{0, 0, f})
		a, b := (d.X*d.X+d.Y*d.Y)/2, -d.Z
		roots := []float64{}
		if a == 0 {
			roots = append(roots, -f/b)
		} else if disc := b*b + 4*a*f; disc >= 0 {
			roots = append(roots, (-b-math.Sqrt(disc))/(2*a), (-b+math.Sqrt(disc))/(2*a))
		}
		for _, s := range roots {
			x := Vec3{0, 0, f}.add(d.mul(s))
			// The ray runs from X toward F, so q (s = 1) is ahead of X
			// when X lies on the far side of F, or past q beyond it.
			if math.Abs(x.X) <= h && math.Abs(x.Y) <= h && (s < 0 || s > 1) {
				return true
			}
		}
		return false
	}
	for _, tilt := range []float64{0, 35, 70, -80} {
		g := received(t, tilted(receive(c, "z", 1.2, 0, 0, 3, 30), tilt))
		accounted(t, g)
		tau := tilt * math.Pi / 180
		e1, e2 := Vec3{1, 0, 0}, Vec3{0, math.Cos(tau), math.Sin(tau)}
		bin := 3.0 / 30
		counts := [2]int{}
		for a, column := range g.Irradiance {
			for b, e := range column {
				in := 0
				for k := 0; k <= 2; k++ {
					for l := 0; l <= 2; l++ {
						x, y := -1.5+(float64(a)+float64(k)/2)*bin, -1.5+(float64(b)+float64(l)/2)*bin
						if lit(Vec3{0, 0, 1.2}.add(e1.mul(x)).add(e2.mul(y))) {
							in++
						}
					}
				}
				switch {
				case in == 9 && !(e > 0), in == 0 && e != 0:
					t.Fatalf("turned %v°: bin (%d, %d) has %d of 9 samples lit and holds %v", tilt, a, b, in, e)
				case in == 9:
					counts[0]++
				case in == 0:
					counts[1]++
				}
			}
		}
		if counts[0] < 20 || counts[1] < 20 {
			t.Fatalf("turned %v°: %d bins lit and %d dark", tilt, counts[0], counts[1])
		}
	}
}

// refined asks receiver c to refine its cells up to levels levels.
func refined(c Request, levels int) Request {
	c.Rays.Receiver.Refine = levels
	return c
}

// binsWithin says whether two receivers' bins agree within tol of their
// peak.
func binsWithin(g, h *Receiver, tol float64) (float64, bool) {
	worst := 0.0
	for a, column := range g.Irradiance {
		for b, e := range column {
			worst = math.Max(worst, math.Abs(e-h.Irradiance[a][b]))
		}
	}
	return worst, worst <= tol*math.Max(g.Peak, h.Peak)
}

// A lamp over a flat mirror magnifies each cell's image threefold onto the
// receiver, so on an 8 × 8 grid every cell lands over several bins, and
// so does every cell of each refinement until the third. Refining every
// cell L times evaluates exactly the rays of the grid 2^L times finer, so
// the bins match that grid's to rounding, which converge at second order
// (TestReceiverPointSource).
func TestReceiverRefineMatchesFinerGrid(t *testing.T) {
	lit := func(n, levels int) *Receiver {
		c := refined(receive(flat(1, lamp(Vec3{0, 0, 1})), "z", 2, .31, -.23, 1.2, 8), levels)
		c.Surface.USamples, c.Surface.VSamples = n, n
		g := received(t, c)
		accounted(t, g)
		return g
	}
	coarse := lit(12, 0)
	if coarse.Split != 0 || coarse.Exhausted {
		t.Fatalf("an unrefined receiver splits %d cells", coarse.Split)
	}
	for levels := 1; levels <= 3; levels++ {
		g, want := lit(12, levels), lit(12<<levels, 0)
		if worst, ok := binsWithin(g, want, 1e-12); !ok {
			t.Fatalf("%d levels: bins differ from the %d grid's by %v", levels, 12<<levels, worst)
		}
		if math.Abs(g.Received-want.Received) > 1e-12 || g.Split == 0 || g.Exhausted {
			t.Fatalf("%d levels: received %v, want %v; %d split", levels, g.Received, want.Received, g.Split)
		}
	}
}

// Where every cell already lands within a bin, refinement splits nothing
// and changes nothing: a paraboloid's focus takes each cell's image to a
// point, and a window far from the light receives none of it.
func TestReceiverRefineOnlyWhereNeeded(t *testing.T) {
	for _, c := range []Request{
		receive(mirror("paraboloid", .5, .5, 0, -1, 1, -1, 1, 24, 24, parallel(0, -90)), "z", 1, 0, 0, 1, 9),
		receive(flat(1, lamp(Vec3{0, 0, 1})), "z", 2, 40, 40, 1.2, 8),
	} {
		plain := received(t, c)
		g := received(t, refined(c, 3))
		accounted(t, g)
		if g.Split != 0 || !reflect.DeepEqual(g, plain) {
			t.Fatalf("%d split; %+v, want %+v", g.Split, g, plain)
		}
	}
}

// A uniform beam behind a flat interface lands uniformly however its cells
// are split, so every bin still receives (cos θ₁/cos θ₂)|T·m| = cos θ₁ on
// a parallel window, even with cells many bins wide.
func TestReceiverRefineUniform(t *testing.T) {
	cos := math.Sqrt(3) / 2
	c := receive(glass(flat(1.5, parallel(0, -60)), 1, 1.5), "z", -1, .1, 0, 1, 64)
	c.Surface.USamples, c.Surface.VSamples = 12, 12
	g := received(t, refined(c, 2))
	accounted(t, g)
	if g.Split == 0 {
		t.Fatal("no cell split")
	}
	for a, column := range g.Irradiance {
		for b, e := range column {
			if math.Abs(e-cos) > 1e-9 {
				t.Fatalf("bin (%d, %d): %v", a, b, e)
			}
		}
	}
}

// A glass dome refracts its light into a ring that folds across the
// receiver, where a coarse grid's triangles span several bins each; the
// window takes in part of the ring. Split where they land on it, its bins
// come several times nearer the uniformly finer grid's than the coarse
// grid's are, for under half that grid's cells.
func TestReceiverRefineFolds(t *testing.T) {
	dome := func(nu, nv, levels int) *Receiver {
		c := glass(mirror("ellipsoid", 1.5, 1.5, 1.5, 0, 2*math.Pi, .6, math.Pi/2, nu, nv, parallel(0, -90)), 1, 1.5)
		g := received(t, refined(receive(c, "z", -1.9, .12, 0, .2, 40), levels))
		accounted(t, g)
		return g
	}
	l1 := func(g, h *Receiver) float64 {
		s := 0.0
		for a, column := range g.Irradiance {
			for b, e := range column {
				s += math.Abs(e - h.Irradiance[a][b])
			}
		}
		return s
	}
	fine := dome(160, 80, 0)
	coarse, adapted := dome(40, 20, 0), dome(40, 20, 2)
	if !(l1(adapted, fine) < l1(coarse, fine)/3) {
		t.Fatalf("refined error %v, coarse %v", l1(adapted, fine), l1(coarse, fine))
	}
	if cells := 40*20 + 3*adapted.Split; !(adapted.Split > 0 && cells < 160*80/2) {
		t.Fatalf("%d split, %d cells", adapted.Split, cells)
	}
}

// Cells at the light's edge are split too where their light lands on the
// window, so the flux of cells only partly traced shrinks with each level,
// as it does with the grid (TestReceiverAccounting): here a sphere's
// terminator, whose grazing rays reach a wide window beside it.
func TestReceiverRefineEdge(t *testing.T) {
	R := 1.2
	edges := []float64{}
	for levels := 0; levels <= 2; levels++ {
		c := receive(mirror("ellipsoid", R, R, R, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 40, 20, parallel(30, -50)), "x", 3, 0, 0, 20, 32)
		g := received(t, refined(c, levels))
		accounted(t, g)
		edges = append(edges, g.Edge)
	}
	if !(edges[0] > 0 && edges[1] < edges[0]*.5 && edges[2] < edges[1]*.5) {
		t.Fatalf("the edge's flux shrinks with each level: %v", edges)
	}
}

// Refinement proceeds a level at a time, so a budget that runs out during
// the second level leaves every cell refined once, and the result says the
// budget ran out. The light is still all accounted for. The budget holds
// exactly the first level's cells.
func TestReceiverRefineBudget(t *testing.T) {
	c := receive(flat(1, lamp(Vec3{0, 0, 1})), "z", 2, .31, -.23, 1.2, 8)
	c.Surface.USamples, c.Surface.VSamples = 12, 12
	once := received(t, refined(c, 1))
	defer func(cells int) { receiverCells = cells }(receiverCells)
	receiverCells = 12*12 + 3*once.Split
	g := received(t, refined(c, 3))
	accounted(t, g)
	if !g.Exhausted || g.Split != once.Split {
		t.Fatalf("%d split, exhausted %v; once %d", g.Split, g.Exhausted, once.Split)
	}
	if worst, ok := binsWithin(g, once, 1e-12); !ok {
		t.Fatalf("bins differ from one level's by %v", worst)
	}
}

// A refined receiver traces its points by outgoing, which follows the
// light exactly as ray does without the wavefront's curvatures: across
// mirrors and interfaces, lamps and beams, unlit and grazed points, the
// source itself, and light beyond the critical angle.
func TestOutgoingMatchesRay(t *testing.T) {
	R := 1.2
	for _, c := range []Request{
		glass(mirror("ellipsoid", 1.5, 1.5, 1.5, 0, 2*math.Pi, .1, math.Pi/2, 24, 12, parallel(20, -70)), 1, 1.5),
		glass(inside(mirror("ellipsoid", R, R, R, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 24, 12, lamp(Vec3{.3, .4, .8}))), 1.5, 1),
		mirror("paraboloid", .5, .5, 0, -1, 1, -1, 1, 24, 24, lamp(Vec3{0, 0, 0})),
		mirror("torus", 2, .8, 0, 0, 2*math.Pi, 0, 2*math.Pi, 24, 24, parallel(10, -45)),
		// Light exactly grazing a flat mirror lights none of it.
		flat(1, parallel(0, 0)),
	} {
		q, r := c.Surface, c.Rays
		kinds := map[string]int{}
		for i := 0; i <= 40; i++ {
			for j := 0; j <= 40; j++ {
				u, v := lerp(q.UMin, q.UMax, i, 40), lerp(q.VMin, q.VMax, j, 40)
				if i == 20 && j == 20 && q.Kind == "paraboloid" {
					u, v = 0, 0
				}
				want := q.ray(r, u, v, 1)
				got, area := q.outgoing(r, u, v, 1)
				if _, xu, xv, _, _, _ := q.patch(u, v); area != xu.cross(xv).norm() {
					t.Fatalf("%s at (%v, %v): area %v, want %v", q.Kind, u, v, area, xu.cross(xv).norm())
				}
				near := func(a, b Vec3) bool { return a.sub(b).norm() <= 1e-13*(1+b.norm()) }
				if got.Normal != want.Normal || got.AtSource != want.AtSource || got.Lit != want.Lit || got.Total != want.Total ||
					!near(got.X, want.X) || !near(got.N, want.N) || !near(got.I, want.I) || !near(got.R, want.R) {
					t.Fatalf("%s at (%v, %v): %+v, want %+v", q.Kind, u, v, got, want)
				}
				switch {
				case want.AtSource:
					kinds["source"]++
				case want.Total:
					kinds["total"]++
				case want.traced():
					kinds["traced"]++
				default:
					kinds["unlit"]++
				}
			}
		}
		t.Logf("%s: %v", q.Kind, kinds)
	}
}

// BenchmarkReceiverRefined follows the cone preset at a fine receiver size.
func BenchmarkReceiverRefined(b *testing.B) {
	c := spatialPresets(b)["Conic sections cut from a cone of light"]
	c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 960, 2
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := Compute(c); err != nil {
			b.Fatal(err)
		}
	}
}

// Keep the full request (including its result) below 55 MB: the baseline
// uses 79 MB, dominated by repeatedly grown cell queues and three bin grids.
// This leaves room above the bounded queues and two grids without encoding
// allocator-specific object counts in the test.
func TestReceiverRefinedAllocationBudget(t *testing.T) {
	c := spatialPresets(t)["Conic sections cut from a cone of light"]
	c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 960, 2
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	result, err := Compute(c)
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatal(err)
	}
	runtime.KeepAlive(result)
	if bytes := after.TotalAlloc - before.TotalAlloc; bytes > 55_000_000 {
		t.Fatalf("refined cone allocated %d bytes, want at most 55 MB", bytes)
	}
}

// Record the existing cone, including every bin and accounting field, before
// changing storage. Separate hashes retain the native platforms' FMA
// differences; WASM comparisons also check the entire result bit for bit.
func TestReceiverConeStorageGuard(t *testing.T) {
	want := map[string][]string{
		"arm64": {
			"29542600b1acbce9a7c10cf56562d8f11e60c95549d244185af146cbb08eb6cd",
			"33a856739ff9db70f352559131dd88a9b55c6c604c3f580ae208c3610adb284f",
			"e0c71ba2d14a9a99768f48ae6a90d0b8f9b02d1eb823f02fd50abfd56b7d46e5",
			"12328f356316fccbbc96295df2fb318050521c8e122c26a520a2fc55f74c928f",
		},
		"amd64": {
			"9c19b17c23b811c4cb25ebfbe5b778c8ab92782ef5ba661c69a21e2212b6f942",
			"7c6d690701ab4839d0333a7f5bc0a639a16800fde94c89393f72b1c8b9b96076",
			"303d07f8d4e2eef68afab91f6d8dfd963b16c1ed31a7a1f7d1ac6f3c1e06bf40",
			"05b6d2e19b8fe9363fc478cbd84a1a11124a500e8444a0adb7250ec23346bd5c",
		},
	}[runtime.GOARCH]
	if want == nil {
		t.Skip("storage guard recorded on arm64 and amd64")
	}
	for _, levels := range []int{0, 1, 2, 3} {
		c := spatialPresets(t)["Conic sections cut from a cone of light"]
		c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 80, levels
		g := received(t, c)
		accounted(t, g)
		hash := sha256.New()
		fmt.Fprintf(hash, "%s %.10g %d %t", g.Plane, g.Size, g.Split, g.Exhausted)
		for _, f := range []float64{g.Peak, g.Emitted, g.Received, g.Outside, g.Away, g.Total, g.Edge} {
			fmt.Fprintf(hash, " %.10g", f)
		}
		for _, col := range g.Irradiance {
			for _, f := range col {
				fmt.Fprintf(hash, " %.10g", f)
			}
		}
		if got := fmt.Sprintf("%x", hash.Sum(nil)); got != want[levels] {
			t.Fatalf("level %d receiver changed: %s", levels, got)
		}
	}
}

// A worker keeps one ray family while its receiver moves. Every result,
// including caustics, diagnostics, bins and fitted bounds, must be the
// stateless engine's result, and returning to the opening must be exact.
func TestReceiverEngineReuse(t *testing.T) {
	c := spatialPresets(t)["Conic sections cut from a cone of light"]
	c.Surface.USamples, c.Surface.VSamples = 24, 12
	c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 48, 1
	var worker Engine
	check := func(c Request) {
		t.Helper()
		want, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		got, err := worker.Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if receiverResultJSON(t, got) != receiverResultJSON(t, want) {
			t.Fatal("cached result differs from stateless engine")
		}
		accounted(t, got.Rays.Receiver)
	}
	check(c)
	check(c)
	original := worker.rays
	if original == nil || original.receiver == nil {
		t.Fatal("no cached rays")
	}
	for _, tilt := range []float64{75, 45, 20} {
		c.Rays.Receiver.Tilt = tilt
		check(c)
		if worker.rays != original {
			t.Fatal("receiver movement discarded the ray family")
		}
	}
	for _, change := range []func(*Request){
		func(c *Request) { c.Rays.Receiver.At = -2.1 },
		func(c *Request) { c.Rays.Receiver.Size = 5 },
		func(c *Request) { c.Rays.Receiver.C1, c.Rays.Receiver.C2 = .3, -.2 },
		func(c *Request) { c.Rays.Receiver.Bins = 32 },
		func(c *Request) { c.Rays.Receiver.Refine = 2 },
		func(c *Request) { c.Rays.Receiver.Plane = "x" },
		func(c *Request) { c.LightDiagnostics = true },
		func(c *Request) { c.LightDiagnostics, c.SurfaceDiagnostics = false, true },
		func(c *Request) { c.SurfaceProbe = &SurfaceQuery{U: 1, V: .4} },
	} {
		change(&c)
		check(c)
		if worker.rays != original {
			t.Fatal("receiver or probe change discarded the ray family")
		}
	}
	// Editing either the surface or the light replaces the entire cache.
	for _, change := range []func(*Request){
		func(c *Request) { c.Surface.A *= .9 },
		func(c *Request) { c.Surface.Reverse = !c.Surface.Reverse },
		func(c *Request) { c.Surface.UMax -= .2 },
		func(c *Request) { c.Surface.USamples++ },
		func(c *Request) { c.Rays.N2 = 1.3 },
		func(c *Request) { c.Rays.Light, c.Rays.Source = "point", Vec3{0, 0, 4} },
		func(c *Request) { c.Rays.Source.X = .3 },
		func(c *Request) { c.Rays.Interaction = "reflect" },
	} {
		change(&c)
		check(c)
		if worker.rays == original {
			t.Fatal("edited rays reused the previous family")
		}
		original = worker.rays
	}
	// Invalid receiver edits must still validate, even on a cache hit.
	c.Rays.Receiver.Bins = 1
	if _, err := worker.Compute(c); err == nil {
		t.Fatal("invalid receiver accepted")
	}
	if _, err := worker.Compute(Request{Format: "surface", Surface: c.Surface}); err != nil {
		t.Fatal(err)
	}
	if worker.rays != nil {
		t.Fatal("leaving the study retained its ray family")
	}
}

// Reusing private traces does not make returned arrays shared:
// the WASM bridge consumes arrays when lifting them out of the JSON.
func TestReceiverEngineOwnershipAndRelease(t *testing.T) {
	c := receive(flat(1.5, parallel(0, -60)), "z", 1, 0, .2, 1, 16)
	var worker Engine
	if _, err := worker.Compute(c); err != nil {
		t.Fatal(err)
	}
	first, err := worker.Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	first.Rays.Surface.Points = nil
	first.Rays.Caustics[0].Points = nil
	first.Rays.Receiver.Irradiance = nil
	second, err := worker.Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Rays.Surface.Points) == 0 || len(second.Rays.Receiver.Irradiance) != 16 {
		t.Fatal("result consumed cached output")
	}
	c.Rays.Receiver.Plane = "none"
	if _, err := worker.Compute(c); err != nil {
		t.Fatal(err)
	}
	if worker.rays != nil {
		t.Fatal("disabled receiver retained its ray family")
	}
}

func BenchmarkReceiverMoving(b *testing.B) {
	c := spatialPresets(b)["Conic sections cut from a cone of light"]
	c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 960, 2
	var worker Engine
	frame := 0
	b.ReportAllocs()
	for b.Loop() {
		c.Rays.Receiver.Tilt = 20 + float64(frame%55)
		frame++
		if _, err := worker.Compute(c); err != nil {
			b.Fatal(err)
		}
	}
}

// Refined corner rays and midpoint flux do not depend on the receiver.
// A moved window must reuse them while recrossing and rasterizing from
// scratch; otherwise this optimization misses most of a refined frame.
func TestReceiverEngineRefinedTraceReuse(t *testing.T) {
	c := spatialPresets(t)["Conic sections cut from a cone of light"]
	c.Surface.USamples, c.Surface.VSamples = 24, 12
	c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 80, 2
	var worker Engine
	if _, err := worker.Compute(c); err != nil {
		t.Fatal(err)
	}
	for _, tilt := range []float64{20, 75, 20} {
		c.Rays.Receiver.Tilt = tilt
		got, err := worker.Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		want, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if receiverResultJSON(t, got) != receiverResultJSON(t, want) {
			t.Fatal("cached refinement changed the result")
		}
		traces := worker.rays.receiver
		if traces == nil || traces.bytes == 0 {
			t.Fatal("refined rays and flux were not retained")
		}
		if traces.bytes > maxReceiverTraceBytes {
			t.Fatal("refined traces exceeded their memory bound")
		}
		// Repeat exactly this view: no newly traced points or midpoints.
		count := traces.count
		if _, err := worker.Compute(c); err != nil {
			t.Fatal(err)
		}
		if traces.count != count {
			t.Fatal("repeated frame retraced receiver samples")
		}
	}
	// A full cache must fall back to evaluation, without dropping light.
	worker.rays.receiver = nil
	fallback := worker.rays.receiverGrid(c.Surface.USamples, c.Surface.VSamples, c.Rays.Receiver.Refine)
	fallback.bytes = maxReceiverTraceBytes
	c.Rays.Receiver.Tilt = 63
	got, err := worker.Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	want, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if receiverResultJSON(t, got) != receiverResultJSON(t, want) {
		t.Fatal("bounded trace fallback changed the result")
	}
	if fallback.count != 0 {
		t.Fatal("full cache retained new traces")
	}
}

// Reuse private tracing and raster scratch across moving frames. At 960
// bins the raster differences save about 7.4 MB: allow 31 MB for output,
// cell queues, fitting and tracing, above their observed 27 MB without
// depending on allocator-specific object counts.
func TestReceiverWarmAllocationBudget(t *testing.T) {
	c := spatialPresets(t)["Conic sections cut from a cone of light"]
	c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 960, 2
	var worker Engine
	for i := 0; i < 2; i++ {
		if _, err := worker.Compute(c); err != nil {
			t.Fatal(err)
		}
	}
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	c.Rays.Receiver.Tilt = 21
	result, err := worker.Compute(c)
	runtime.ReadMemStats(&after)
	if err != nil {
		t.Fatal(err)
	}
	runtime.KeepAlive(result)
	if bytes := after.TotalAlloc - before.TotalAlloc; bytes > 31_000_000 {
		t.Fatalf("warm receiver allocated %d bytes, want at most 31 MB", bytes)
	}
}

// Cached traces retain darkness, chart gaps and total internal reflection
// as well as lit rays, for both lamps and beams.
func TestReceiverEngineOpticalStates(t *testing.T) {
	for _, c := range []Request{
		flat(1, parallel(0, 0)),
		mirror("paraboloid", .5, .5, 0, -1, 1, -1, 1, 24, 24, lamp(Vec3{0, 0, 0})),
		glass(inside(mirror("ellipsoid", 1.2, 1.2, 1.2, 0, 2*math.Pi, -math.Pi/2, math.Pi/2, 24, 12, lamp(Vec3{.3, .4, .8}))), 1.5, 1),
	} {
		c = refined(receive(c, "z", 3, 0, 0, 4, 32), 2)
		var worker Engine
		for _, tilt := range []float64{0, 37, 90, 0} {
			c.Rays.Receiver.Tilt = tilt
			got, err := worker.Compute(c)
			if err != nil {
				t.Fatal(err)
			}
			want, err := Compute(c)
			if err != nil {
				t.Fatal(err)
			}
			if receiverResultJSON(t, got) != receiverResultJSON(t, want) {
				t.Fatal("cached optical state changed")
			}
			accounted(t, got.Rays.Receiver)
		}
	}
}

func receiverResultJSON(t *testing.T, r Result) string {
	t.Helper()
	data, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// Charge the entire sparse column table, including unused entries, and
// stop retaining columns at the scratch budget. A skipped column remains
// usable for the current frame.
func TestReceiverScratchBudget(t *testing.T) {
	cache := &rayCache{}
	traces := cache.receiverGrid(240, 60, 3)
	rows := (60 << 3) + 1
	first := traces.landingColumn(0, rows)
	if len(first) != rows {
		t.Fatal("no scratch column")
	}
	retained := 24*len(traces.landings) + 24*rows
	if traces.landingBytes < retained {
		t.Fatalf("charged %d bytes for at least %d retained", traces.landingBytes, retained)
	}
	for i := 1; i < len(traces.landings); i++ {
		traces.landingColumn(i, rows)
	}
	if traces.landingBytes > maxReceiverLandingBytes {
		t.Fatal("scratch retention exceeded its budget")
	}
	if traces.landings[len(traces.landings)-1] != nil {
		t.Fatal("oversized scratch grid was retained")
	}
}

// A light or surface animated on every frame cannot reuse its traces.
// Do not populate a fresh cache for these one-shot families: it adds
// allocation and memory pressure without saving any work.
func TestReceiverChangingFamilyDoesNotPopulateCache(t *testing.T) {
	c := spatialPresets(t)["Conic sections cut from a cone of light"]
	c.Surface.USamples, c.Surface.VSamples = 24, 12
	c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 48, 2
	var worker Engine
	for _, axis := range []float64{1, 1.1, 1.2} {
		c.Surface.A = axis
		if _, err := worker.Compute(c); err != nil {
			t.Fatal(err)
		}
		if worker.rays == nil || worker.rays.receiver != nil || worker.rays.samples != nil {
			t.Fatal("one-shot family populated a trace cache")
		}
	}
	if _, err := worker.Compute(c); err != nil {
		t.Fatal(err)
	}
	if worker.rays.receiver == nil || worker.rays.samples == nil {
		t.Fatal("repeated family did not enable reuse")
	}
}

// Decode through the public JSON request, including its optional receiver
// flag and transient view, before observing the engine's returned inset.
func receiverViewed(t *testing.T, c Request, view View, width, height int) (*Receiver, *ReceiverInset) {
	t.Helper()
	c.Rays.Receiver.RefineView = true
	view.Pixels = [2]int{width, height}
	c.View = &view
	data, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Request
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	g := received(t, decoded)
	return g, g.Inset
}

func TestReceiverViewInset(t *testing.T) {
	c := receive(flat(1.5, parallel(0, -90)), "z", 1, 0, 0, 2, 8)
	v := View{Center: Vec3{0, 0, 1}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: .5, Height: .25}
	baseline := received(t, c)
	g, inset := receiverViewed(t, c, v, 64, 32)
	if inset == nil {
		t.Fatal("visible receiver has no inset")
	}
	if inset.Rect != [4]float64{.25, .375, .75, .625} {
		t.Fatalf("rect %v", inset.Rect)
	}
	if len(inset.Irradiance) != 64 || len(inset.Irradiance[0]) != 32 {
		t.Fatalf("inset is not one bin per pixel: %d by %d", len(inset.Irradiance), len(inset.Irradiance[0]))
	}
	for _, column := range inset.Irradiance {
		for _, e := range column {
			if math.Abs(e-1) > 1e-10 {
				t.Fatalf("uniform beam: %v", e)
			}
		}
	}
	data, _ := json.Marshal(g)
	var record map[string]json.RawMessage
	json.Unmarshal(data, &record)
	delete(record, "inset")
	data, _ = json.Marshal(record)
	var without Receiver
	json.Unmarshal(data, &without)
	if !reflect.DeepEqual(baseline, &without) {
		t.Fatal("the view changed full-window bins or accounting")
	}
	// An inset at the original bins is exactly the original raster.
	v.Width, v.Height = 1, 1
	_, inset = receiverViewed(t, c, v, 8, 8)
	if inset == nil || !reflect.DeepEqual(inset.Irradiance, baseline.Irradiance) {
		t.Fatal("whole-window inset differs")
	}
	// Group four fine bins along each axis: their flux is the coarse bin's.
	_, inset = receiverViewed(t, c, v, 32, 32)
	for i, col := range baseline.Irradiance {
		for j, want := range col {
			sum := 0.0
			for a := 0; a < 4; a++ {
				for b := 0; b < 4; b++ {
					sum += inset.Irradiance[4*i+a][4*j+b] / 16
				}
			}
			if math.Abs(sum-want) > 1e-10 {
				t.Fatalf("bin %d,%d: fine %v coarse %v", i, j, sum, want)
			}
		}
	}
	v.Center.X = 10
	if _, inset = receiverViewed(t, c, v, 32, 32); inset != nil {
		t.Fatal("offscreen receiver has an inset")
	}
}

func TestReceiverViewTiltAndPerspective(t *testing.T) {
	c := receive(flat(2, parallel(0, -90)), "z", 1, 0, 0, 2, 8)
	c.Rays.Receiver.Tilt = 30
	c.Rays.Receiver.Refine = 1
	v := View{Center: Vec3{0, 0, 1}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: .4, Height: .3, Distance: 3, Near: .1}
	_, inset := receiverViewed(t, c, v, 80, 60)
	if inset == nil {
		t.Fatal("tilted perspective receiver has no inset")
	}
	for _, column := range inset.Irradiance {
		for _, e := range column {
			if math.Abs(e-math.Cos(math.Pi/6)) > 1e-8 {
				t.Fatalf("tilted beam irradiance %v", e)
			}
		}
	}
	if inset.Split == 0 {
		t.Fatal("inset did not refine the ray map")
	}
	saved := receiverCells
	receiverCells = c.Surface.USamples * c.Surface.VSamples
	defer func() { receiverCells = saved }()
	_, inset = receiverViewed(t, c, v, 80, 60)
	if inset == nil || !inset.Exhausted {
		t.Fatal("inset does not report its exhausted budget")
	}
}

func TestReceiverViewNonuniformFlux(t *testing.T) {
	c := receive(flat(1, lamp(Vec3{0, 0, 1})), "z", 2, 0, 0, 2, 8)
	v := View{Center: Vec3{0, 0, 2}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: 1, Height: 1}
	coarse := received(t, c)
	_, fine := receiverViewed(t, c, v, 32, 32)
	if fine == nil {
		t.Fatal("no inset")
	}
	for i, column := range coarse.Irradiance {
		for j, want := range column {
			sum := 0.0
			for a := 0; a < 4; a++ {
				for b := 0; b < 4; b++ {
					sum += fine.Irradiance[4*i+a][4*j+b] / 16
				}
			}
			if math.Abs(sum-want) > 1e-10 {
				t.Fatalf("nonuniform flux in %d,%d: %v != %v", i, j, sum, want)
			}
		}
	}
}

func TestReceiverViewRegionLimits(t *testing.T) {
	r := ReceiverRequest{Plane: "z", At: 1, Size: 2, Bins: 8}
	v := View{Center: Vec3{0, 0, 1}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: 1, Height: 1, Pixels: [2]int{32768, 32768}}
	region := r.region(v)
	if region == nil || region.width != 1024 || region.height != 1024 {
		t.Fatalf("uncapped region: %+v", region)
	}
	// A tilted window crossing the near plane must clip to the visible
	// polygon before dividing by depth, keeping finite in-window coordinates.
	r.Tilt = 80
	v.Distance = .2
	v.Near = .1
	region = r.region(v)
	if region == nil {
		t.Fatal("near-plane crossing lost its visible part")
	}
	for _, x := range region.rect {
		if !finite(x) || x < 0 || x > 1 {
			t.Fatalf("invalid clipped coordinate %v", x)
		}
	}
	v.Center.Z = -10
	v.Distance = 1
	if r.region(v) != nil {
		t.Fatal("window behind the eye is visible")
	}
}

// A worker's inset pass shares the window pass's cached traces and landing
// scratch. Each view must still give the stateless result, and moving the
// camera must keep the ray family.
func TestReceiverViewEngineReuse(t *testing.T) {
	c := spatialPresets(t)["A glass dome's luminous ring, close up"]
	c.Surface.USamples, c.Surface.VSamples = 48, 20
	view := View{Center: Vec3{0, 0, -1.9}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: .17, Height: .13, Pixels: [2]int{120, 90}}
	c.View = &view
	var worker Engine
	check := func(c Request) {
		t.Helper()
		want, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		got, err := worker.Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if got.Rays.Receiver.Inset == nil {
			t.Fatal("no inset")
		}
		if receiverResultJSON(t, got) != receiverResultJSON(t, want) {
			t.Fatal("cached result differs from stateless engine")
		}
	}
	check(c)
	check(c)
	original := worker.rays
	if original == nil || original.receiver == nil {
		t.Fatal("no cached rays")
	}
	for _, move := range []func(*View){
		func(v *View) { v.Center.X = .1 },
		func(v *View) { v.Width, v.Height = .4, .3 },
		func(v *View) { v.Pixels = [2]int{200, 150} },
		func(v *View) { v.Distance, v.Near = 3, .1 },
	} {
		move(&view)
		check(c)
		if worker.rays != original {
			t.Fatal("moving the camera discarded the ray family")
		}
	}
}

// Retaining raster scratch must neither overwrite an earlier result nor
// carry old flux across changes in bin count, refinement or plane.
func TestReceiverRasterOutputOwnership(t *testing.T) {
	c := refined(receive(flat(1, lamp(Vec3{.2, -.3, 1})), "z", 2, 0, 0, 3, 32), 1)
	var worker Engine
	if _, err := worker.Compute(c); err != nil {
		t.Fatal(err)
	}
	first, err := worker.Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	saved := receiverResultJSON(t, first)
	for _, change := range []func(*Request){
		func(c *Request) { c.Rays.Receiver.Tilt = 37 },
		func(c *Request) { c.Rays.Receiver.Bins = 48 },
		func(c *Request) { c.Rays.Receiver.Refine = 2 },
		func(c *Request) { c.Rays.Receiver.Plane = "x" },
		func(c *Request) { c.Rays.Receiver.Plane, c.Rays.Receiver.Tilt, c.Rays.Receiver.Bins = "z", 0, 32 },
	} {
		change(&c)
		got, err := worker.Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		want, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if receiverResultJSON(t, got) != receiverResultJSON(t, want) {
			t.Fatal("reused raster changed the result")
		}
		accounted(t, got.Rays.Receiver)
		if receiverResultJSON(t, first) != saved {
			t.Fatal("a later frame overwrote an earlier result")
		}
	}
}

// A bright frame's rounding threshold must not erase a faint frame after
// it: the second triangle still distributes its entire unit of flux.
func TestReceiverRasterResetsRoundingScale(t *testing.T) {
	var cache rayCache
	triangle := [3][2]float64{{0, 0}, {8, 0}, {0, 8}}
	bright := cache.receiverRaster(8)
	bright.triangle(triangle, 1e12)
	bright.bins()
	faint := cache.receiverRaster(8)
	faint.triangle(triangle, 1)
	flux := 0.0
	for _, column := range faint.bins() {
		for _, value := range column {
			flux += value
		}
	}
	if math.Abs(flux-1) > 1e-12 {
		t.Fatalf("faint frame received %g flux, want 1", flux)
	}
}

// An inset's size follows the view, so it must not displace the window's
// retained raster: every frame would otherwise allocate both.
func TestReceiverViewKeepsWindowRaster(t *testing.T) {
	c := refined(receive(flat(1, lamp(Vec3{.2, -.3, 1})), "z", 2, 0, 0, 3, 32), 1)
	c.Rays.Receiver.RefineView = true
	c.View = &View{Center: Vec3{0, 0, 2}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: .5, Height: .4, Pixels: [2]int{60, 40}}
	var worker Engine
	var rows *float64
	for frame := 0; frame < 3; frame++ {
		got, err := worker.Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if got.Rays.Receiver.Inset == nil {
			t.Fatal("no inset")
		}
		if frame == 0 {
			continue
		}
		scratch := worker.rays.raster.rows
		if len(scratch) != 32 || len(scratch[0]) != 34 {
			t.Fatalf("frame %d retained a %d-row raster, want the window's 32", frame, len(scratch))
		}
		if frame == 2 && &scratch[0][0] != rows {
			t.Fatal("the window's raster was reallocated")
		}
		rows = &scratch[0][0]
	}
}

// Moving only the receiver must not rebuild tens of thousands of surface
// and caustic vertices. The 10,000-allocation bound leaves room for fresh
// output rows, bins and exact raster work, but rejects the old 71,000+
// per-frame vertex allocations on this production preset.
func TestReceiverGeometryAllocationBudget(t *testing.T) {
	c := spatialPresets(t)["Conic sections cut from a cone of light"]
	c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 80, 0
	var worker Engine
	for range 3 {
		if _, err := worker.Compute(c); err != nil {
			t.Fatal(err)
		}
	}
	allocations := testing.AllocsPerRun(3, func() {
		c.Rays.Receiver.Tilt += 1
		if _, err := worker.Compute(c); err != nil {
			t.Fatal(err)
		}
	})
	if allocations > 10000 {
		t.Fatalf("moving receiver allocated %.0f objects, want at most 10000", allocations)
	}
}

// Callers own every nested output, including topology and pointed-to
// vertices. Corrupting a delivered result must not poison the next frame.
func TestReceiverGeometryOwnership(t *testing.T) {
	presets := spatialPresets(t)
	cases := []struct {
		name    string
		request Request
	}{
		{"Conic sections cut from a cone of light", presets["Conic sections cut from a cone of light"]},
		{"A glass dome's ring of light", presets["A glass dome's ring of light"]},
		{"cuspidal edges", receive(presets["An astigmatic dish's folded caustics"], "z", 1, 0, 0, 4, 32)},
		{"point source", receive(flat(1.5, lamp(Vec3{0, 0, 2})), "z", 1, 0, 0, 4, 32)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := tc.request
			c.Surface.USamples, c.Surface.VSamples = 24, 12
			c.Rays.Receiver.Bins = 32
			c.Rays.Edges, c.LightDiagnostics = true, true
			var worker Engine
			for range 2 {
				if _, err := worker.Compute(c); err != nil {
					t.Fatal(err)
				}
			}
			got, err := worker.Compute(c)
			if err != nil {
				t.Fatal(err)
			}
			if tc.name == "cuspidal edges" && (got.Rays.Edges == nil || len(*got.Rays.Edges) == 0) {
				t.Fatal("fixture has no cuspidal edges")
			}
			if tc.name == "point source" && got.Rays.Source == nil {
				t.Fatal("fixture has no point source")
			}
			corruptResult(reflect.ValueOf(got.Rays))
			for _, change := range []func(){func() {}, func() { c.Rays.Receiver.Tilt += 20 }, func() { c.LightDiagnostics, c.SurfaceDiagnostics = false, true }} {
				change()
				want, err := Compute(c)
				if err != nil {
					t.Fatal(err)
				}
				got, err := worker.Compute(c)
				if err != nil {
					t.Fatal(err)
				}
				if receiverResultJSON(t, got) != receiverResultJSON(t, want) {
					t.Fatal("caller mutation poisoned cached geometry")
				}
			}
		})
	}
}

// corruptResult overwrites every settable number and flag reachable from v
// and then empties its slices, as a caller or the WASM lifter consuming a
// result may. Strings are kept: a cache keyed by a diagnostics kind must
// still hit, so that sharing its storage with a result is observed.
func corruptResult(v reflect.Value) {
	switch v.Kind() {
	case reflect.Pointer:
		if !v.IsNil() {
			corruptResult(v.Elem())
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			corruptResult(v.Field(i))
		}
	case reflect.Slice:
		for i := 0; i < v.Len(); i++ {
			corruptResult(v.Index(i))
		}
		if v.CanSet() {
			v.SetZero()
		}
	case reflect.Float64:
		if v.CanSet() {
			v.SetFloat(12345)
		}
	case reflect.Int:
		if v.CanSet() {
			v.SetInt(12345)
		}
	case reflect.Bool:
		if v.CanSet() {
			v.SetBool(!v.Bool())
		}
	}
}

// A receiver moving beneath an unchanged probe should copy its diagnostics,
// rather than allocate every point, curvature and direction again. The bound
// allows grid copies but excludes the per-sample allocation of rebuilding.
func TestReceiverDiagnosticsAllocation(t *testing.T) {
	c := spatialPresets(t)["Conic sections cut from a cone of light"]
	c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 8, 0
	for _, light := range []bool{false, true} {
		c.SurfaceDiagnostics, c.LightDiagnostics = !light, light
		var worker Engine
		for i := 0; i < 3; i++ {
			if _, err := worker.Compute(c); err != nil {
				t.Fatal(err)
			}
		}
		with := testing.AllocsPerRun(3, func() {
			c.Rays.Receiver.Tilt++
			if _, err := worker.Compute(c); err != nil {
				panic(err)
			}
		})
		c.SurfaceDiagnostics, c.LightDiagnostics = false, false
		without := testing.AllocsPerRun(3, func() {
			c.Rays.Receiver.Tilt++
			if _, err := worker.Compute(c); err != nil {
				panic(err)
			}
		})
		t.Logf("light=%v diagnostics add %.0f allocations", light, with-without)
		if with-without > 2000 {
			t.Errorf("light=%v: diagnostics added %.0f allocations, want at most 2000", light, with-without)
		}
	}
}

func BenchmarkReceiverMovingDiagnostics(b *testing.B) {
	for _, light := range []bool{false, true} {
		name := "mirror"
		if light {
			name = "light"
		}
		b.Run(name, func(b *testing.B) {
			c := spatialPresets(b)["Conic sections cut from a cone of light"]
			c.SurfaceDiagnostics, c.LightDiagnostics = !light, light
			c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 480, 2
			var worker Engine
			frame := 0
			b.ReportAllocs()
			for b.Loop() {
				c.Rays.Receiver.Tilt = 20 + float64(frame%55)
				frame++
				if _, err := worker.Compute(c); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// Cached diagnostics remain identical to the stateless engine, even after
// transport or a caller consumes every nested array of a delivered result.
func TestReceiverDiagnosticsOwnership(t *testing.T) {
	for _, name := range []string{"Conic sections cut from a cone of light", "A glass dome's ring of light", "A lamp in water over air"} {
		c := spatialPresets(t)[name]
		c.Surface.USamples, c.Surface.VSamples = 24, 12
		c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 16, 1
		var worker Engine
		for _, mode := range []int{0, 1, 1, 2, 2, 0, 1} {
			c.SurfaceDiagnostics, c.LightDiagnostics = mode == 1, mode == 2
			for _, tilt := range []float64{20, 75, 35} {
				c.Rays.Receiver.Tilt = tilt
				want, err := Compute(c)
				if err != nil {
					t.Fatal(err)
				}
				got, err := worker.Compute(c)
				if err != nil {
					t.Fatal(err)
				}
				if receiverResultJSON(t, got) != receiverResultJSON(t, want) {
					t.Fatalf("%s mode %d tilt %v differs", name, mode, tilt)
				}
				if got.Probe != nil {
					corruptResult(reflect.ValueOf(got.Probe))
				}
			}
		}
	}
}

func TestReceiverDiagnosticsLifecycle(t *testing.T) {
	c := spatialPresets(t)["Conic sections cut from a cone of light"]
	c.Surface.USamples, c.Surface.VSamples = 24, 12
	c.Rays.Receiver.Bins, c.Rays.Receiver.Refine = 16, 0
	c.LightDiagnostics = true
	var worker Engine
	run := func() {
		t.Helper()
		if _, err := worker.Compute(c); err != nil {
			t.Fatal(err)
		}
	}
	run()
	if worker.rays.probe != nil {
		t.Fatal("one-shot family retained diagnostics")
	}
	run()
	first := worker.rays.probe
	if first == nil || first.Kind != "wavefront" {
		t.Fatal("missing cached light diagnostics")
	}
	c.Rays.Receiver.At += .1
	run()
	if worker.rays.probe != first {
		t.Fatal("receiver movement rebuilt diagnostics")
	}
	c.LightDiagnostics, c.SurfaceDiagnostics = false, true
	run()
	if worker.rays.probe == first || worker.rays.probe.Kind != "patch" {
		t.Fatal("target change reused light diagnostics")
	}
	c.SurfaceDiagnostics = false
	run()
	if worker.rays.probe != nil {
		t.Fatal("disabled probe retained diagnostics")
	}
	c.LightDiagnostics = true
	run()
	c.Rays.N2 = 1.3
	run()
	if worker.rays.probe != nil {
		t.Fatal("changed family retained diagnostics")
	}
	run()
	c.SurfaceDiagnostics = true
	if _, err := worker.Compute(c); err == nil || worker.rays != nil {
		t.Fatal("invalid dual target retained cache")
	}
}
