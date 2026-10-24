package engine3

import (
	"math"
	"math/bits"
)

// ReceiverRequest declares a receiver: the plane Plane = At, for Plane "x",
// "y" or "z" (or "none", with no receiver), and on it a square window of
// side Size centered on (C1, C2), divided into Bins × Bins bins. The plane's
// coordinates run cyclically: (y, z) on x = At, (z, x) on y = At, and
// (x, y) on z = At. Tilt turns the window, and the plane with it, by Tilt
// degrees about its first axis through its center, right handed: the
// second axis rises toward the plane's normal axis, so z = At turned about
// x leans y toward z, x = At about y leans z toward x, and y = At about z
// leans x toward y. The window keeps its own coordinates as it turns.
// Refine splits the surface's cells, up to Refine levels (0–3), where
// their light lands on the window too coarsely (see Receiver). RefineView
// adds an inset for a supplied resting view, with independent accounting.
type ReceiverRequest struct {
	RefineView bool `json:"refineView,omitempty"`
	view       *View
	Plane      string  `json:"plane"`
	At         float64 `json:"at"`
	C1         float64 `json:"c1"`
	C2         float64 `json:"c2"`
	Size       float64 `json:"size"`
	Bins       int     `json:"bins"`
	Tilt       float64 `json:"tilt,omitempty"`
	Refine     int     `json:"refine,omitempty"`
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
// Refined, a cell is split into four, a level at a time, where its
// corners' crossings lie within a bin of the window and more than a bin
// apart (along a side or the diagonal its triangles share), or where some
// of its corners cross the plane ahead and others do not; each part is
// traced at the points of the grid 2^Refine times finer and emits as a
// cell does, so a cell split every time is that grid's cells, to rounding.
// Split counts the cells split, and at most receiverCells cells are
// spread: Exhausted says a cell that needed splitting was left whole.
//
// Emitted is the flux of every cell whose midpoint is lit. It is received
// in the window (Received), lands on the plane outside it (Outside), or
// belongs to a cell whose midpoint is beyond the critical angle (Total),
// whose corners are not all traced, at the edge of the light or of a
// chart singularity (Edge), or whose corners' rays do not all cross the
// plane ahead, or cross it more than 10⁶ bins from the window (Away).
type Receiver struct {
	Inset      *ReceiverInset `json:"inset,omitempty"`
	Plane      string         `json:"plane"`
	Corners    [4]Vec3        `json:"corners"`
	Size       float64        `json:"size"`
	Irradiance [][]float64    `json:"irradiance"`
	Peak       float64        `json:"peak"`
	Emitted    float64        `json:"emitted"`
	Received   float64        `json:"received"`
	Outside    float64        `json:"outside"`
	Away       float64        `json:"away"`
	Total      float64        `json:"total"`
	Edge       float64        `json:"edge"`
	Split      int            `json:"split,omitempty"`
	Exhausted  bool           `json:"exhausted,omitempty"`
}

const (
	minReceiverBins   = 8
	maxReceiverBins   = 960
	maxReceiverRefine = 3
	// A crossing farther than this many bins from the window is away.
	receiverReach = 1e6
)

// receiverCells bounds the cells a refined receiver spreads, base cells
// included; a variable so tests can run it out.
var receiverCells = 1 << 19

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
		return fieldErr(field, "the receiver's position and center must be finite and within ±100000")
	}
	if !finite(r.Size) || r.Size <= 0 || r.Size > 1e5 {
		return fieldErr("rays.receiver.size", "the receiver's size must be finite, positive and at most 100000")
	}
	if r.Bins < minReceiverBins || r.Bins > maxReceiverBins {
		return fieldErr("rays.receiver.bins", "the receiver needs %d–%d bins each way", minReceiverBins, maxReceiverBins)
	}
	if !bounded(r.Tilt) {
		return fieldErr("rays.receiver.tilt", "the receiver's tilt must be finite and within ±100000 degrees")
	}
	if r.Refine < 0 || r.Refine > maxReceiverRefine {
		return fieldErr("rays.receiver.refine", "use 0–%d refinement levels", maxReceiverRefine)
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

// turn rotates v by the tilt about the window's first axis, or back again
// when back is set, and says whether the window is turned at all: a whole
// number of turns leaves it, and every result, exactly as untilted.
func (r ReceiverRequest) turn(v Vec3, back bool) (Vec3, bool) {
	sin, cos := sincosDegrees(r.Tilt)
	if sin == 0 && cos == 1 {
		return v, false
	}
	if back {
		sin = -sin
	}
	k, _, j := r.axes()
	var p [3]float64
	p[0], p[1], p[2] = v.X, v.Y, v.Z
	p[j], p[k] = cos*p[j]-sin*p[k], sin*p[j]+cos*p[k]
	return Vec3{p[0], p[1], p[2]}, true
}

// window is the turned window's point with coordinates (a, b).
func (r ReceiverRequest) window(a, b float64) Vec3 {
	center := r.point(r.C1, r.C2)
	if d, ok := r.turn(r.point(a, b).sub(center), false); ok {
		return center.add(d)
	}
	return r.point(a, b)
}

// receiveRaster collects the outgoing rays on the window, or on a
// rectangular inset. Samples holds the surface grid's rays.
func (q SurfaceRequest) receiveRaster(r RaysRequest, samples [][]mirrorPoint, scale float64, cache *rayCache, target *receiverRegion) *Receiver {
	rc := r.Receiver
	half, n := rc.Size/2, rc.Bins
	lo1, lo2, bin := rc.C1-half, rc.C2-half, rc.Size/float64(n)
	ny, bin2 := n, bin
	if target != nil {
		lo1 += target.rect[0] * rc.Size
		lo2 += target.rect[1] * rc.Size
		n, ny = target.width, target.height
		bin = (target.rect[2] - target.rect[0]) * rc.Size / float64(n)
		bin2 = (target.rect[3] - target.rect[1]) * rc.Size / float64(ny)
	}
	out := &Receiver{Plane: rc.Plane, Size: rc.Size, Corners: [4]Vec3{
		rc.window(lo1, lo2), rc.window(lo1+rc.Size, lo2), rc.window(lo1+rc.Size, lo2+rc.Size), rc.window(lo1, lo2+rc.Size),
	}}
	k, i1, i2 := rc.axes()
	center := rc.point(rc.C1, rc.C2)
	// cross returns where sample s's ray crosses the plane, in bins. A
	// turned window turns the ray back instead, about the same axis, onto
	// the untilted plane.
	cross := func(s mirrorPoint) ([2]float64, bool) {
		if d, ok := rc.turn(s.X.sub(center), true); ok {
			s.X = center.add(d)
			s.R, _ = rc.turn(s.R, true)
		}
		d := component(s.R, k)
		lambda := (rc.At - component(s.X, k)) / d
		if !(math.Abs(d) > 1e-12 && lambda > 0) {
			return [2]float64{}, false
		}
		y := s.X.add(s.R.mul(lambda))
		p := [2]float64{(component(y, i1) - lo1) / bin, (component(y, i2) - lo2) / bin2}
		reach := receiverReach + float64(n)
		return p, math.Abs(p[0]) < reach && math.Abs(p[1]) < reach
	}
	// A ray's landing: whether it is traced, and where it crosses the
	// plane, in bins, if it crosses ahead and within reach.
	land := func(s mirrorPoint) receiverLanding {
		if !s.traced() {
			return receiverLanding{done: true}
		}
		p, ok := cross(s)
		return receiverLanding{p, true, ok, true}
	}
	nu, nv, levels := q.USamples, q.VSamples, rc.Refine
	base := grid2[receiverLanding](nu+1, nv+1)
	for i := range base {
		for j := range base[i] {
			base[i][j] = land(samples[i][j])
		}
	}
	// Refined cells live on the grid 2^levels times finer: a cell is its
	// lowest corner (i, j) there and its side. Points between the samples
	// are traced by outgoing, where that grid puts them.
	fu, fv, step := nu<<levels, nv<<levels, 1<<levels
	traces := cache.receiverGrid(nu, nv, levels)
	type cell struct{ i, j, side int }
	// Each column of the finer grid is held once a point on it is traced.
	points := traces.landingGrid(fu + 1)
	point := func(i, j int) receiverLanding {
		if i%step == 0 && j%step == 0 {
			return base[i/step][j/step]
		}
		if points[i] == nil {
			points[i] = traces.landingColumn(i, fv+1)
		}
		if l := points[i][j]; l.done {
			return l
		}
		s := traces.corner(i, j, fv+1, func() mirrorPoint {
			p, _ := q.outgoing(r, lerp(q.UMin, q.UMax, i, fu), lerp(q.VMin, q.VMax, j, fv), scale)
			return p
		})
		l := land(s)
		points[i][j] = l
		return l
	}
	corners := func(c cell) [4]receiverLanding {
		return [4]receiverLanding{point(c.i, c.j), point(c.i+c.side, c.j), point(c.i+c.side, c.j+c.side), point(c.i, c.j+c.side)}
	}
	// A cell splits where its light lands near the window and its corners'
	// crossings are more than a bin apart, or some of its corners land and
	// others do not: at the edge of the light, of total internal reflection
	// or of the rays that reach the plane.
	window, window2 := float64(n), float64(ny)
	splits := func(c cell) bool {
		at := corners(c)
		lands := 0
		lo, hi := [2]float64{math.Inf(1), math.Inf(1)}, [2]float64{math.Inf(-1), math.Inf(-1)}
		for _, l := range at {
			if l.traced && l.ok {
				lands++
				for k := range lo {
					lo[k], hi[k] = math.Min(lo[k], l.p[k]), math.Max(hi[k], l.p[k])
				}
			}
		}
		if lands == 0 || hi[0] < -1 || hi[1] < -1 || lo[0] > window+1 || lo[1] > window2+1 {
			return false
		}
		if lands < 4 {
			return true
		}
		for _, e := range [5][2]int{{0, 1}, {1, 2}, {2, 3}, {3, 0}, {0, 2}} {
			if math.Hypot(at[e[0]].p[0]-at[e[1]].p[0], at[e[0]].p[1]-at[e[1]].p[1]) > 1 {
				return true
			}
		}
		return false
	}
	// Each level splits every cell that needs it before the next begins, so
	// a budget that runs out leaves the cells evenly refined.
	cells := make([]cell, 0, nu*nv)
	for i := 0; i < nu; i++ {
		for j := 0; j < nv; j++ {
			cells = append(cells, cell{i * step, j * step, step})
		}
	}
	count := nu * nv
	// First mark the splits, then allocate exactly their children. Growing
	// the next queue while appending repeatedly copies its largest levels.
	// Compact unsplit cells in their old queue and retain each level apart:
	// this also avoids copying the final (largest) queue into the leaves.
	var leaves [maxReceiverRefine + 1][]cell
	for level := 0; level < levels; level++ {
		split := 0
		for i, c := range cells {
			if !out.Exhausted && splits(c) {
				if count+3 <= receiverCells {
					count += 3
					out.Split++
					split++
					cells[i].side = -c.side
					continue
				}
				out.Exhausted = true
			}
		}
		next := make([]cell, 0, 4*split)
		whole := cells[:0]
		for _, c := range cells {
			if c.side < 0 {
				h := -c.side / 2
				next = append(next, cell{c.i, c.j, h}, cell{c.i + h, c.j, h}, cell{c.i + h, c.j + h, h}, cell{c.i, c.j + h, h})
			} else {
				whole = append(whole, c)
			}
		}
		leaves[level], cells = whole, next
	}
	leaves[levels] = cells
	// Only the window keeps its raster scratch: an inset's size follows
	// the view, and alternating sizes would reallocate both every frame.
	var g *raster
	if target == nil {
		g = cache.receiverRaster(n)
	} else {
		g = newRaster(n, ny)
	}
	landed := 0.0
	for _, level := range leaves {
		for _, c := range level {
			u, v := lerp(q.UMin, q.UMax, c.i, fu), lerp(q.VMin, q.VMax, c.j, fv)
			du := (q.UMax - q.UMin) / float64(fu) * float64(c.side)
			dv := (q.VMax - q.VMin) / float64(fv) * float64(c.side)
			// A cell of the grid emits as it always has; a refined one by
			// outgoing, which traces the same light.
			depth := levels - bits.TrailingZeros(uint(c.side))
			emission := traces.emission(depth, c.i/c.side, c.j/c.side, nv<<depth, func() receiverFlux {
				var m mirrorPoint
				var area float64
				if c.side == step {
					m = q.ray(r, u+du/2, v+dv/2, scale)
					_, xu, xv, _, _, _ := q.patch(u+du/2, v+dv/2)
					area = xu.cross(xv).norm()
				} else {
					m, area = q.outgoing(r, u+du/2, v+dv/2, scale)
				}
				if !m.Lit {
					return receiverFlux{}
				}
				flux := math.Abs(m.I.dot(m.N)) * area * math.Abs(du*dv)
				if r.Light == "point" {
					d := m.X.sub(r.Source)
					flux /= d.dot(d)
				}
				return receiverFlux{flux: flux, lit: true, total: m.Total}
			})
			if !emission.lit {
				continue
			}
			flux := emission.flux
			out.Emitted += flux
			if emission.total {
				out.Total += flux
				continue
			}
			at := corners(c)
			edge, away := false, false
			for _, l := range at {
				edge, away = edge || !l.traced, away || !l.ok
			}
			switch {
			case edge:
				out.Edge += flux
			case away:
				out.Away += flux
			default:
				g.triangle([3][2]float64{at[0].p, at[1].p, at[2].p}, flux/2)
				g.triangle([3][2]float64{at[0].p, at[2].p, at[3].p}, flux/2)
				landed += flux
			}
		}
	}
	out.Irradiance = g.bins()
	for _, column := range out.Irradiance {
		for b := range column {
			out.Received += column[b]
			column[b] /= bin * bin2
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
	points [][]float64
	rasterScratch
}

// rasterScratch is private accumulation storage; the finished bins always
// belong to the result. Only the window's current bin count is retained,
// bounded by 960² bins (under 8 MiB), and changing the ray family releases
// it with the cache.
type rasterScratch struct {
	rows [][]float64
	// scale[row] sums the magnitudes added to the row, which bounds the
	// rounding its running sum can leave.
	scale []float64
}

func newRaster(w, h int) *raster {
	return &raster{w: w, h: h, rasterScratch: newRasterScratch(w, h), points: grid2[float64](w, h)}
}

func newRasterScratch(w, h int) rasterScratch {
	return rasterScratch{rows: grid2[float64](h, w+2), scale: make([]float64, h)}
}

func (c *rayCache) receiverRaster(n int) *raster {
	if c == nil {
		return newRaster(n, n)
	}
	if len(c.raster.rows) != n {
		c.raster = newRasterScratch(n, n)
	} else {
		for _, row := range c.raster.rows {
			clear(row)
		}
		clear(c.raster.scale)
	}
	return &raster{w: n, h: n, rasterScratch: c.raster, points: grid2[float64](n, n)}
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
	// The line's ends and where it crosses each side, in order along it.
	var cuts [4]float64
	m := 1
	for _, x := range [2]float64{0, w} {
		if s := (x - a[0]) / (b[0] - a[0]); s > 0 && s < 1 {
			cuts[m] = s
			m++
		}
	}
	if m == 3 && cuts[2] < cuts[1] {
		cuts[1], cuts[2] = cuts[2], cuts[1]
	}
	cuts[m] = 1
	at := func(s float64) [2]float64 {
		p := [2]float64{a[0] + s*(b[0]-a[0]), a[1] + s*(b[1]-a[1])}
		p[0] = min(max(p[0], 0), w)
		return p
	}
	for k := 1; k <= m; k++ {
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
	y0, y1 := max(p[1], 0), min(q[1], float64(g.h))
	for row := int(max(math.Floor(y0), 0)); row < g.h && float64(row) < y1; row++ {
		top, bottom := max(float64(row), y0), min(float64(row+1), y1)
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
	a, b = min(max(a, 0), w), min(max(b, 0), w)
	lo, hi := min(a, b), max(a, b)
	share := func(c float64) float64 {
		clamp := func(t float64) float64 { return min(max(t, 0), 1) }
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
// within 10⁻¹² of its row's scale is rounding, and is zero. It consumes
// the raster, finishing into its point-flux grid instead of a third grid.
func (g *raster) bins() [][]float64 {
	out := g.points
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
