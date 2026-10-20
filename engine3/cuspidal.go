package engine3

import "math"

// CuspidalEdge is a curve along which the offset X + dn folds: the image of
// a curve in the parameter plane where 1 − dκᵢ = 0, so that dX_d = (I −
// dA) dX loses rank along eᵢ there and the offset meets focal sheet Branch.
// It is also a curve along which focal sheet Branch folds, the image of a
// ridge of the patch, whose points are then its Feet (see ridges); an
// offset's edge has none. Points are on the offset or the sheet, each at its place (I, J) on the parameter grid
// in sample steps, u = UMin + I·(UMax − UMin)/USamples and v likewise, one
// of them a whole number: the grid edge it crosses. A Closed edge returns
// to its first point after its last, which it does not repeat.
type CuspidalEdge struct {
	Branch int       `json:"branch"`
	Closed bool      `json:"closed"`
	Points []Vec3    `json:"points"`
	I      []float64 `json:"i"`
	J      []float64 `json:"j"`
	Feet   []Vec3    `json:"feet,omitempty"`
}

// cuspidalEdges traces each branch's level set 1 − dκᵢ = 0 over the
// parameter grid, whose samples it is given (see contours); each point is
// the offset's, X + dn.
func (q SurfaceRequest) cuspidalEdges(samples [][]surfacePoint, scale float64) []CuspidalEdge {
	d := q.Offset
	out := []CuspidalEdge{}
	for branch := range 2 {
		out = append(out, q.contours(samples, scale, branch, level{
			value: func(s surfacePoint, _, _ float64) (float64, Vec3) {
				if !s.Normal {
					return math.NaN(), Vec3{}
				}
				return 1 - d*s.Kappa[branch], Vec3{}
			},
			place: func(s surfacePoint) (Vec3, bool) {
				return s.X.add(s.N.mul(d)), s.Normal
			},
		})...)
	}
	return out
}

// ridges traces the patch's ridges, where a principal curvature κᵢ is
// stationary along its own principal direction eᵢ, dκᵢ(eᵢ) = 0, on each
// branch whose focal sheet is a surface (see contours). There the sheet
// X + n/κᵢ has no tangent plane: it folds back in a cuspidal edge, at
// whose points the ridge's own are its Feet. The extremality is odd in eᵢ,
// which the patch orients nowhere, so each cell orients its corners'
// directions alike, and leaves out a cell around which they turn by half
// a turn, as about an umbilic, or with an umbilic corner. A point whose
// center is at infinity, beyond focalReach radii, has no place, so the
// ridge stops there.
func (q SurfaceRequest) ridges(samples [][]surfacePoint, focal []FocalSheet, scale float64) []CuspidalEdge {
	out := []CuspidalEdge{}
	for branch := range 2 {
		if focal[branch].Shape != "surface" {
			continue
		}
		out = append(out, q.contours(samples, scale, branch, level{
			oriented: true,
			value: func(s surfacePoint, u, v float64) (float64, Vec3) {
				if !s.Normal || s.Umbilic {
					return math.NaN(), Vec3{}
				}
				// Over κ₁² + κ₂², in the same units, so that it is as
				// unchanged by scale as 1 − dκ, and the root's tolerance
				// holds at any size.
				return q.extremality(u, v, s, branch) / (s.Kappa[0]*s.Kappa[0] + s.Kappa[1]*s.Kappa[1]), s.Dir[branch]
			},
			place: func(s surfacePoint) (Vec3, bool) {
				return s.focal(branch, focalReach*scale)
			},
			feet: true,
		})...)
	}
	return out
}

// level is a level set contours traces: value is its function at the
// patch point s at (u, v), or NaN where it has none, and, when oriented,
// the direction of the line field it depends on there, in which it is odd;
// place is where a crossing at s lands, and feet asks for s's own point
// too.
type level struct {
	oriented bool
	value    func(s surfacePoint, u, v float64) (float64, Vec3)
	place    func(s surfacePoint) (Vec3, bool)
	feet     bool
}

// contours traces a level set of branch over the parameter grid, whose
// samples it is given, by marching squares. Each grid edge whose two ends
// lie on opposite sides holds one crossing, found on the patch itself,
// between its samples, by the Illinois method; a cell with all four edges
// crossed (a saddle) is split by the side its center lies on. Crossings
// are joined cell to cell into curves. A cell with a corner without a
// value (a chart singularity) is left out, so a curve stops beside it.
// When the patch's first and last rows (or columns) coincide, as across an
// ellipsoid's or a torus's seam, they are one row, and a curve crosses the
// seam. An oriented level orients each grid edge's far end, and the points
// between, as its near end, and each cell's corners in turn from its
// first, leaving the cell out when its last corner turns against its
// first.
func (q SurfaceRequest) contours(samples [][]surfacePoint, scale float64, branch int, f level) []CuspidalEdge {
	nu, nv := q.USamples, q.VSamples
	seam := func(n, m int, at func(k, l int) Vec3) bool {
		for l := 0; l <= m; l++ {
			if at(0, l).sub(at(n, l)).norm() > 1e-12*scale {
				return false
			}
		}
		return true
	}
	seamU := seam(nu, nv, func(k, l int) Vec3 { return samples[k][l].X })
	seamV := seam(nv, nu, func(k, l int) Vec3 { return samples[l][k].X })
	wrap := func(k, n int, closed bool) int {
		if closed && k == n {
			return 0
		}
		return k
	}
	// orient turns an oriented level's direction toward toward, unless
	// that is zero, and its value with it: a zero turned over is −0, on
	// the other side (see march).
	orient := func(value float64, e, toward Vec3) (float64, Vec3) {
		if f.oriented && e.dot(toward) < 0 {
			return -value, e.mul(-1)
		}
		return value, e
	}
	// value at sample (i, j), or at the patch point (u, v), oriented toward.
	// A seam's last row is its first, so that the cells on either side of
	// it agree on its sides even where the value is only rounding. Each
	// sample's is found once.
	type valued struct {
		known bool
		value float64
		e     Vec3
	}
	values := grid2[valued](nu+1, nv+1)
	sample := func(i, j int, toward Vec3) (float64, Vec3) {
		i, j = wrap(i, nu, seamU), wrap(j, nv, seamV)
		c := &values[i][j]
		if !c.known {
			u, v := q.at(i, j)
			c.value, c.e = f.value(samples[i][j], u, v)
			c.known = true
		}
		return orient(c.value, c.e, toward)
	}
	at := func(u, v float64, toward Vec3) (float64, Vec3, surfacePoint) {
		s := q.point(u, v, scale)
		value, e := f.value(s, u, v)
		value, e = orient(value, e, toward)
		return value, e, s
	}
	// A grid edge from sample (i, j), along u (alongV false) or v, named
	// by its wrapped start.
	type edge struct {
		alongV bool
		i, j   int
	}
	name := func(alongV bool, i, j int) edge {
		if alongV {
			return edge{true, wrap(i, nu, seamU), j}
		}
		return edge{false, i, wrap(j, nv, seamV)}
	}
	type crossing struct {
		ok      bool
		i, j    float64
		x, foot Vec3
	}
	crossings := map[edge]crossing{}
	order := []edge{}
	// cross finds the crossing on the grid edge from (i, j) to (i+di,
	// j+dj), once for both cells beside it.
	cross := func(i, j, di, dj int) edge {
		e := name(dj == 1, i, j)
		if _, seen := crossings[e]; seen {
			return e
		}
		u0, v0 := q.at(i, j)
		u1, v1 := q.at(i+di, j+dj)
		f0, toward := sample(i, j, Vec3{})
		f1, _ := sample(i+di, j+dj, toward)
		t, ok := root(func(t float64) float64 {
			value, _, _ := at(u0+t*(u1-u0), v0+t*(v1-v0), toward)
			return value
		}, f0, f1)
		c := crossing{i: float64(i) + t*float64(di), j: float64(j) + t*float64(dj)}
		_, _, s := at(u0+t*(u1-u0), v0+t*(v1-v0), toward)
		if x, placed := f.place(s); ok && placed {
			c.ok, c.x, c.foot = true, x, s.X
		}
		crossings[e] = c
		order = append(order, e)
		return e
	}
	next := map[edge][]edge{}
	join := func(a, b edge) {
		if crossings[a].ok && crossings[b].ok {
			next[a], next[b] = append(next[a], b), append(next[b], a)
		}
	}
	for i := 0; i < nu; i++ {
		for j := 0; j < nv; j++ {
			// Corners counterclockwise in (u, v), each oriented as the one
			// before it.
			places := [4][2]int{{i, j}, {i + 1, j}, {i + 1, j + 1}, {i, j + 1}}
			var corner [4]float64
			var toward [4]Vec3
			missing := false
			for k, p := range places {
				previous := Vec3{}
				if k > 0 {
					previous = toward[k-1]
				}
				corner[k], toward[k] = sample(p[0], p[1], previous)
				missing = missing || math.IsNaN(corner[k])
			}
			if missing || f.oriented && toward[3].dot(toward[0]) < 0 {
				continue
			}
			// Edge k runs from corner k to corner k + 1, the cell's
			// sides counterclockwise in (u, v).
			starts := [4][4]int{{i, j, 1, 0}, {i + 1, j, 0, 1}, {i, j + 1, 1, 0}, {i, j, 0, 1}}
			side := func(k int) edge {
				s := starts[k]
				return cross(s[0], s[1], s[2], s[3])
			}
			center := func() float64 {
				u0, v0 := q.at(i, j)
				u1, v1 := q.at(i+1, j+1)
				value, _, _ := at((u0+u1)/2, (v0+v1)/2, toward[0])
				return value
			}
			for _, pair := range march(corner, center) {
				join(side(pair[0]), side(pair[1]))
			}
		}
	}
	visited := map[edge]bool{}
	walk := func(start edge) CuspidalEdge {
		c := CuspidalEdge{Branch: branch + 1, Points: []Vec3{}, I: []float64{}, J: []float64{}}
		if f.feet {
			c.Feet = []Vec3{}
		}
		previous, at := start, start
		for {
			visited[at] = true
			p := crossings[at]
			c.Points, c.I, c.J = append(c.Points, p.x), append(c.I, p.i), append(c.J, p.j)
			if f.feet {
				c.Feet = append(c.Feet, p.foot)
			}
			following, found := edge{}, false
			for _, n := range next[at] {
				if n != previous {
					following, found = n, true
					break
				}
			}
			if !found || following == start || visited[following] {
				c.Closed = found && following == start && len(c.Points) > 2
				return c
			}
			previous, at = at, following
		}
	}
	out := []CuspidalEdge{}
	// Open curves first, from either end, then the loops.
	for _, e := range order {
		if !visited[e] && len(next[e]) == 1 {
			out = append(out, walk(e))
		}
	}
	for _, e := range order {
		if !visited[e] && len(next[e]) == 2 {
			out = append(out, walk(e))
		}
	}
	return out
}

// march returns which of a cell's sides its level set joins: side k runs
// from corner k to corner k + 1 (mod 4), counterclockwise, and a corner of
// value +0 or more counts as above, −0 as below. A cell with every side crossed is a
// saddle, split by its center's side (center is called only then; a center
// without a value takes the corners' mean): where the center lies with
// corners 0 and 2, they meet through it and corners 1 and 3 are cut off.
func march(corner [4]float64, center func() float64) [][2]int {
	side := func(c float64) bool { return !math.Signbit(c) }
	crossed := []int{}
	for k := range 4 {
		if side(corner[k]) != side(corner[(k+1)%4]) {
			crossed = append(crossed, k)
		}
	}
	if len(crossed) == 2 {
		return [][2]int{{crossed[0], crossed[1]}}
	}
	if len(crossed) < 4 {
		return nil
	}
	c := center()
	if math.IsNaN(c) {
		c = (corner[0] + corner[1] + corner[2] + corner[3]) / 4
	}
	if side(c) == side(corner[0]) {
		return [][2]int{{0, 1}, {2, 3}}
	}
	return [][2]int{{3, 0}, {1, 2}}
}

// root finds where g, continuous on [0, 1] with g(0) = g0 and g(1) = g1 on
// opposite sides of zero (+0 counting as above, −0 below, as in march),
// crosses zero, by the Illinois variant of regula falsi; it reports false
// when g has no value somewhere it looked, and returns its last estimate.
func root(g func(float64) float64, g0, g1 float64) (float64, bool) {
	lo, hi, flo, fhi := 0.0, 1.0, g0, g1
	if flo == 0 {
		return 0, true
	}
	side := 0
	for range 100 {
		t := (lo*fhi - hi*flo) / (fhi - flo)
		if !(t > lo && t < hi) {
			t = (lo + hi) / 2
		}
		ft := g(t)
		if math.IsNaN(ft) {
			return t, false
		}
		if ft == 0 || hi-lo < 1e-15 || math.Abs(ft) < 1e-15 {
			return t, true
		}
		if math.Signbit(ft) == math.Signbit(fhi) {
			hi, fhi = t, ft
			if side == -1 {
				flo /= 2
			}
			side = -1
		} else {
			lo, flo = t, ft
			if side == 1 {
				fhi /= 2
			}
			side = 1
		}
	}
	return (lo*fhi - hi*flo) / (fhi - flo), true
}
