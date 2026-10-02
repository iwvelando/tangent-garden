package engine3

import (
	"math"
	"sort"
)

// ReceiverRequest declares a receiver: the plane Plane = At, for Plane "x",
// "y" or "z" (or "none", with no receiver), and on it a square window of
// side Size centred on (C1, C2), divided into Bins × Bins bins. The plane's
// coordinates run cyclically: (y, z) on x = At, (z, x) on y = At, and
// (x, y) on z = At.
type ReceiverRequest struct {
	Plane string  `json:"plane"`
	At    float64 `json:"at"`
	C1    float64 `json:"c1"`
	C2    float64 `json:"c2"`
	Size  float64 `json:"size"`
	Bins  int     `json:"bins"`
}

// Receiver is the irradiance the outgoing rays deliver to the receiver's
// window, a flux model separate from the caustics. Parallel light has unit
// irradiance across the beam, so a flux is an area of beam and an
// irradiance a multiple of the beam's; a point source has unit intensity,
// so a flux is a solid angle in steradians and an irradiance per unit area
// at unit intensity. Nothing is absorbed: a mirror reflects everything and
// an interface transmits everything short of the critical angle (there are
// no Fresnel losses), and nothing blocks a ray on its way to the receiver.
//
// Each parameter cell emits the flux its midpoint receives, E |I·n| |X_u ×
// X_v| Δu Δv, with E = 1 for parallel light and 1/|X − S|² for a point
// source. When all four of its corners send rays that cross the plane
// ahead of them, the cell's flux is spread evenly over the two triangles
// its corners' crossings make, half to each, and each bin receives the flux
// of the triangles' parts inside it: a box filter of this piecewise-linear
// ray map, exact for it, with no further smoothing. A triangle with no area
// puts all its flux at its centroid, and a bin whose flux is within 10⁻¹²
// of the magnitudes summed along its row holds only rounding and is zero.
// Irradiance[a][b] is bin (a, b)'s flux
// over its area, a counting along the plane's first coordinate, and Peak
// the largest.
//
// Emitted is the flux of every cell whose midpoint is lit. It is received
// in the window (Received), lands on the plane outside it (Outside), or
// belongs to a cell whose midpoint is beyond the critical angle (Total),
// whose corners are not all traced, at the edge of the light or of a
// chart singularity (Edge), or whose corners' rays do not all cross the
// plane ahead, or cross it more than 10⁶ bins from the window (Away).
type Receiver struct {
	Plane      string      `json:"plane"`
	Corners    [4]Vec3     `json:"corners"`
	Size       float64     `json:"size"`
	Irradiance [][]float64 `json:"irradiance"`
	Peak       float64     `json:"peak"`
	Emitted    float64     `json:"emitted"`
	Received   float64     `json:"received"`
	Outside    float64     `json:"outside"`
	Away       float64     `json:"away"`
	Total      float64     `json:"total"`
	Edge       float64     `json:"edge"`
}

const (
	minReceiverBins = 8
	maxReceiverBins = 240
	// A crossing farther than this many bins from the window is away.
	receiverReach = 1e6
)

func (r ReceiverRequest) validate() error {
	switch r.Plane {
	case "none":
		return nil
	case "x", "y", "z":
	default:
		return fieldErr("rays.receiver.plane", "the receiver plane must be none, x, y or z")
	}
	if !bounded(r.At) || !bounded(r.C1) || !bounded(r.C2) {
		field := "rays.receiver.c2"
		if !bounded(r.At) {
			field = "rays.receiver.at"
		} else if !bounded(r.C1) {
			field = "rays.receiver.c1"
		}
		return fieldErr(field, "the receiver's position and centre must be finite and within ±100000")
	}
	if !finite(r.Size) || r.Size <= 0 || r.Size > 1e5 {
		return fieldErr("rays.receiver.size", "the receiver's size must be finite, positive and at most 100000")
	}
	if r.Bins < minReceiverBins || r.Bins > maxReceiverBins {
		return fieldErr("rays.receiver.bins", "the receiver needs %d–%d bins each way", minReceiverBins, maxReceiverBins)
	}
	return nil
}

// axes returns the plane's normal axis and its two coordinates' axes.
func (r ReceiverRequest) axes() (int, int, int) {
	k := int(r.Plane[0] - 'x')
	return k, (k + 1) % 3, (k + 2) % 3
}

func component(v Vec3, k int) float64 {
	switch k {
	case 0:
		return v.X
	case 1:
		return v.Y
	}
	return v.Z
}

// point is the plane's point with coordinates (a, b).
func (r ReceiverRequest) point(a, b float64) Vec3 {
	k, i, j := r.axes()
	var p [3]float64
	p[k], p[i], p[j] = r.At, a, b
	return Vec3{p[0], p[1], p[2]}
}

// receive collects the outgoing rays of the sampled surface on the
// receiver; samples holds the grid's rays, and scale the surface's size.
func (q SurfaceRequest) receive(r RaysRequest, samples [][]mirrorPoint, scale float64) *Receiver {
	rc := r.Receiver
	half, n := rc.Size/2, rc.Bins
	lo1, lo2, bin := rc.C1-half, rc.C2-half, rc.Size/float64(n)
	out := &Receiver{Plane: rc.Plane, Size: rc.Size, Corners: [4]Vec3{
		rc.point(lo1, lo2), rc.point(lo1+rc.Size, lo2), rc.point(lo1+rc.Size, lo2+rc.Size), rc.point(lo1, lo2+rc.Size),
	}}
	k, i1, i2 := rc.axes()
	// cross returns where sample s's ray crosses the plane, in bins.
	cross := func(s mirrorPoint) ([2]float64, bool) {
		d := component(s.R, k)
		lambda := (rc.At - component(s.X, k)) / d
		if !(math.Abs(d) > 1e-12 && lambda > 0) {
			return [2]float64{}, false
		}
		y := s.X.add(s.R.mul(lambda))
		p := [2]float64{(component(y, i1) - lo1) / bin, (component(y, i2) - lo2) / bin}
		reach := receiverReach + float64(n)
		return p, math.Abs(p[0]) < reach && math.Abs(p[1]) < reach
	}
	g := newRaster(n, n)
	du := (q.UMax - q.UMin) / float64(q.USamples)
	dv := (q.VMax - q.VMin) / float64(q.VSamples)
	landed := 0.0
	for i := 0; i < q.USamples; i++ {
		for j := 0; j < q.VSamples; j++ {
			u, v := q.at(i, j)
			m := q.ray(r, u+du/2, v+dv/2, scale)
			if !m.Lit {
				continue
			}
			_, xu, xv, _, _, _ := q.patch(u+du/2, v+dv/2)
			flux := math.Abs(m.I.dot(m.N)) * xu.cross(xv).norm() * math.Abs(du*dv)
			if r.Light == "point" {
				d := m.X.sub(r.Source)
				flux /= d.dot(d)
			}
			out.Emitted += flux
			if m.Total {
				out.Total += flux
				continue
			}
			corners := [4]mirrorPoint{samples[i][j], samples[i+1][j], samples[i+1][j+1], samples[i][j+1]}
			var at [4][2]float64
			edge, away := false, false
			for c, s := range corners {
				if !s.traced() {
					edge = true
					break
				}
				p, ok := cross(s)
				at[c], away = p, away || !ok
			}
			switch {
			case edge:
				out.Edge += flux
			case away:
				out.Away += flux
			default:
				g.triangle([3][2]float64{at[0], at[1], at[2]}, flux/2)
				g.triangle([3][2]float64{at[0], at[2], at[3]}, flux/2)
				landed += flux
			}
		}
	}
	out.Irradiance = g.bins()
	for _, column := range out.Irradiance {
		for b := range column {
			out.Received += column[b]
			column[b] /= bin * bin
			out.Peak = math.Max(out.Peak, column[b])
		}
	}
	out.Outside = landed - out.Received
	return out
}

// raster accumulates flux over a w × h grid of unit bins by exact area
// coverage. Each triangle's flux is spread evenly over it: its three edges
// add their signed coverage, weighted by the triangle's density, to rows of
// differences that a running sum along each row turns into each bin's
// share, so a triangle costs the bins its edges cross, not those it
// covers.
type raster struct {
	w, h   int
	rows   [][]float64
	points [][]float64
	// scale[row] sums the magnitudes added to the row, which bounds the
	// rounding its running sum can leave.
	scale []float64
}

func newRaster(w, h int) *raster {
	return &raster{w: w, h: h, rows: grid2[float64](h, w+2), points: grid2[float64](w, h), scale: make([]float64, h)}
}

// triangle spreads flux over the triangle p, in bin coordinates.
func (g *raster) triangle(p [3][2]float64, flux float64) {
	area := ((p[1][0]-p[0][0])*(p[2][1]-p[0][1]) - (p[2][0]-p[0][0])*(p[1][1]-p[0][1])) / 2
	if !(math.Abs(area) > 1e-12) {
		x, y := (p[0][0]+p[1][0]+p[2][0])/3, (p[0][1]+p[1][1]+p[2][1])/3
		if x >= 0 && x < float64(g.w) && y >= 0 && y < float64(g.h) {
			g.points[int(x)][int(y)] += flux
		}
		return
	}
	// An edge rising in y covers the bins to its right positively, so a
	// counterclockwise triangle covers its inside by −1.
	density := -flux / area
	for k := range p {
		g.edge(p[k], p[(k+1)%3], density)
	}
}

// edge splits a line where it crosses the window's left and right sides,
// and clamps each piece's x into [0, w]: a bin's coverage depends only on
// how much of it lies to the right of the line, which clamping keeps.
func (g *raster) edge(a, b [2]float64, weight float64) {
	w := float64(g.w)
	cuts := []float64{0, 1}
	for _, x := range []float64{0, w} {
		if s := (x - a[0]) / (b[0] - a[0]); s > 0 && s < 1 {
			cuts = append(cuts, s)
		}
	}
	sort.Float64s(cuts)
	at := func(s float64) [2]float64 {
		p := [2]float64{a[0] + s*(b[0]-a[0]), a[1] + s*(b[1]-a[1])}
		p[0] = math.Min(math.Max(p[0], 0), w)
		return p
	}
	for k := 1; k < len(cuts); k++ {
		g.line(at(cuts[k-1]), at(cuts[k]), weight)
	}
}

// line adds a line's coverage, row by row, clipped to [0, h].
func (g *raster) line(p, q [2]float64, weight float64) {
	if p[1] == q[1] {
		return
	}
	if p[1] > q[1] {
		p, q, weight = q, p, -weight
	}
	dxdy := (q[0] - p[0]) / (q[1] - p[1])
	y0, y1 := math.Max(p[1], 0), math.Min(q[1], float64(g.h))
	for row := int(math.Max(math.Floor(y0), 0)); row < g.h && float64(row) < y1; row++ {
		top, bottom := math.Max(float64(row), y0), math.Min(float64(row+1), y1)
		if bottom <= top {
			continue
		}
		g.span(row, p[0]+(top-p[1])*dxdy, p[0]+(bottom-p[1])*dxdy, (bottom-top)*weight)
	}
}

// span adds, to a row's differences, a piece of line from x = a to x = b
// within the row, with weighted height d: bin c's share is d times the mean
// over the piece of the part of bin c to its right, clamp(c + 1 − x, 0, 1).
// With G(t) the integral of that clamp from 0 to t, the mean is
// (G(c + 1 − a) − G(c + 1 − b))/(b − a).
func (g *raster) span(r int, a, b, d float64) {
	row := g.rows[r]
	// Interpolating a clamped edge can stray past [0, w] by rounding.
	w := float64(g.w)
	a, b = math.Min(math.Max(a, 0), w), math.Min(math.Max(b, 0), w)
	lo, hi := math.Min(a, b), math.Max(a, b)
	share := func(c float64) float64 {
		clamp := func(t float64) float64 { return math.Min(math.Max(t, 0), 1) }
		if hi-lo < 1e-12 {
			return d * clamp(c+1-(a+b)/2)
		}
		G := func(t float64) float64 {
			switch {
			case t <= 0:
				return 0
			case t <= 1:
				return t * t / 2
			}
			return t - .5
		}
		return d * (G(c+1-lo) - G(c+1-hi)) / (hi - lo)
	}
	first, last := int(math.Floor(lo)), int(math.Ceil(hi))
	previous := 0.0
	for c := first; c <= last; c++ {
		s := share(float64(c))
		row[c] += s - previous
		g.scale[r] += math.Abs(s - previous)
		previous = s
	}
}

// bins returns each bin's flux, [a][b] with a along x. A running sum
// within 10⁻¹² of its row's scale is rounding, and is zero.
func (g *raster) bins() [][]float64 {
	out := grid2[float64](g.w, g.h)
	for b, row := range g.rows {
		sum := 0.0
		for a := 0; a < g.w; a++ {
			sum += row[a]
			if math.Abs(sum) <= 1e-12*g.scale[b] {
				sum = 0
			}
			out[a][b] = sum + g.points[a][b]
		}
	}
	return out
}
