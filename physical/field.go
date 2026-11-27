package physical

import (
	"errors"
	"fmt"
	"math"
	"math/cmplx"
)

// Plan describes the plan region L, the part of a plaque that is raised
// (or, recessed, cut): the points within each stroke's half width of its
// centerline, kept only inside Clip when Clip is positive, joined to a
// frame band when Frame is positive, and kept inside the plaque radius
// Outer.
//
// Lace strokes and the frame are kept apart from the rest of the plaque
// by the signed field
//
//	F(x) = max(min(max(min_s d_s(x) − h_s, |x| − Clip), |r − |x|| − Frame/2), |x| − Outer),
//
// negative inside L, where d_s is the exact distance to a centerline and
// r the frame's middle radius Clip + Frame/2. Outside L, min_s d_s − h_s is
// the exact distance to the union of bands.
type Plan struct {
	Strokes []Stroke
	Clip    float64
	Frame   float64
	Outer   float64
	// Plaque is the plaque's radius, beyond Outer when a border of the
	// rest surrounds the plan; zero means Outer. Only cell analysis reads
	// it: the plaque's edge bounds the outermost cell.
	Plaque float64
}

// Grid holds F at the nodes x0 + i·h + i(y0 + j·h), i < NX, j < NY, row
// by row, capped at Cap: a node farther than Cap from every band reads Cap.
// Near holds the stroke nearest each node, −1 when none is within Cap.
type Grid struct {
	X0, Y0, H float64
	NX, NY    int
	F         []float64
	Near      []int32
	Cap       float64
	// Evaluations counts stroke distances computed.
	Evaluations int
}

// Limits are the ceilings one build may not exceed.
type Limits struct {
	Strokes     int
	Nodes       int
	Evaluations int
	Vertices    int
	Triangles   int
	PairTests   int
	Rounds      int
	Package     int
}

// DefaultLimits are the research ceilings (#543). They bound work, not
// responsiveness. Measured first against a 128 MiB working budget, the
// worker's Go memory reached 52 MiB at 120 mm, 99–138 MiB at 180 mm and
// 162–242 MiB at 200–256 mm; the owner then chose larger ceilings over
// that budget, with real-phone checks still required. The planned values
// stand: 4 million field nodes (about 400 mm at 0.2 mm), 500,000
// triangles. An automatic grid step keeps a large plaque within them.
var DefaultLimits = Limits{
	Strokes:     200_000,
	Nodes:       4_000_000,
	Evaluations: 200_000_000,
	Vertices:    150_000,
	Triangles:   500_000,
	PairTests:   20_000_000,
	Rounds:      12,
	Package:     64 << 20,
}

// MemoryBudget is the soft memory limit a build in the browser's worker
// runs under: the collector works to stay below it rather than let the
// heap double, which WebAssembly memory, never returned, would keep.
const MemoryBudget = 512 << 20

// ErrLimit marks a build that would pass a ceiling; nothing is returned.
var ErrLimit = errors.New("ceiling")

type limitError struct{ what string }

func (e limitError) Error() string { return "the " + e.what + " would pass its ceiling" }
func (e limitError) Unwrap() error { return ErrLimit }

// snap is the share of a grid step below which a node value is pushed
// away from zero, keeping its sign, so that no contour vertex lies on or
// within snap·h of a node. It moves the contour by at most snap·h.
const snap = 0.01

// Sample evaluates the plan's field on a grid of step h covering the
// plaque with a margin of two steps, capped at cap.
func Sample(p Plan, h, cap float64, lim Limits) (*Grid, error) {
	if len(p.Strokes) > lim.Strokes {
		return nil, limitError{"number of strokes"}
	}
	if !(h > 0) || !(p.Outer > 0) {
		return nil, errors.New("the grid needs a positive step and plaque")
	}
	n := int(math.Ceil(2*p.Outer/h)) + 5
	if n*n > lim.Nodes {
		return nil, fmt.Errorf("the field would need %d nodes, above its ceiling of %d: choose a coarser grid step: %w", n*n, lim.Nodes, ErrLimit)
	}
	g := &Grid{X0: -float64(n-1) / 2 * h, Y0: -float64(n-1) / 2 * h, H: h, NX: n, NY: n, Cap: cap}
	g.F = make([]float64, n*n)
	g.Near = make([]int32, n*n)
	for k := range g.F {
		g.F[k] = cap
		g.Near[k] = -1
	}
	// Each stroke writes the nodes within its half width plus cap; the
	// least value wins.
	for si, s := range p.Strokes {
		if p.Clip > 0 && s.Distance(0) > p.Clip+s.Half+cap {
			continue
		}
		lo, hi := s.Bounds()
		reach := s.Half + cap
		i0, j0 := g.index(lo - complex(reach, reach))
		i1, j1 := g.index(hi + complex(reach, reach))
		i0, j0 = max(i0, 0), max(j0, 0)
		i1, j1 = min(i1+1, n-1), min(j1+1, n-1)
		work := (i1 - i0 + 1) * (j1 - j0 + 1)
		g.Evaluations += work
		if g.Evaluations > lim.Evaluations {
			return nil, limitError{"number of stroke evaluations"}
		}
		for j := j0; j <= j1; j++ {
			for i := i0; i <= i1; i++ {
				x := g.At(i, j)
				v := s.Distance(x) - s.Half
				k := j*n + i
				if v < g.F[k] {
					g.F[k] = v
					g.Near[k] = int32(si)
				}
			}
		}
	}
	for j := range n {
		for i := range n {
			k := j*n + i
			x := g.At(i, j)
			r := cmplx.Abs(x)
			v := g.F[k]
			if p.Clip > 0 {
				v = math.Max(v, r-p.Clip)
			}
			if p.Frame > 0 {
				mid := p.Clip + p.Frame/2
				if f := math.Abs(r-mid) - p.Frame/2; f < v {
					v = f
					g.Near[k] = -1
				}
			}
			v = math.Max(v, r-p.Outer)
			v = math.Min(v, cap)
			if math.Abs(v) < snap*h {
				v = math.Copysign(snap*h, v)
				if v == 0 {
					v = snap * h
				}
			}
			g.F[k] = v
		}
	}
	return g, nil
}

// Clean fills specks below the grid's resolution: pieces of the plan or
// of the rest holding at most three nodes, every one within a step of
// the boundary. They are the tips of wedges narrower than a step, cut off
// by sampling, and would otherwise become microscopic holes or islands in
// the mesh. It returns how many it filled; the true geometry differs from
// the cleaned by less than a step there.
func (g *Grid) Clean() int {
	filled := 0
	for _, inside := range []bool{false, true} {
		in := func(k int) bool { return (g.F[k] < 0) == inside }
		v := func(k int) float64 { return g.F[k] }
		lab, count := label(g, in, v, inside)
		size := make([]int, count+1)
		deep := make([]bool, count+1)
		for k, l := range lab {
			if l != 0 {
				size[l]++
				if math.Abs(g.F[k]) >= g.H {
					deep[l] = true
				}
			}
		}
		for k, l := range lab {
			if l != 0 && size[l] <= 3 && !deep[l] {
				g.F[k] = -g.F[k]
			}
		}
		for l := 1; l <= count; l++ {
			if size[l] <= 3 && !deep[l] {
				filled++
			}
		}
	}
	return filled
}

// At is node (i, j)'s position.
func (g *Grid) At(i, j int) complex128 {
	return complex(g.X0+float64(i)*g.H, g.Y0+float64(j)*g.H)
}

func (g *Grid) index(x complex128) (int, int) {
	return int(math.Floor((real(x) - g.X0) / g.H)), int(math.Floor((imag(x) - g.Y0) / g.H))
}

// Contours are closed polygons with the region on their left: outer
// boundaries counterclockwise, holes clockwise. Loops index Points.
type Contours struct {
	Points []complex128
	Loops  [][]int32
}

// Contour traces F < 0 by marching squares. Each grid edge whose ends
// differ in sign holds one vertex, by linear interpolation; a cell with
// four crossings joins its inside corners when the mean of its corners is
// negative. The loops are simple and pairwise disjoint, and every grid
// edge is crossed at most once, so they cannot cross.
func (g *Grid) Contour(lim Limits) (*Contours, error) {
	n, m := g.NX, g.NY
	// Vertex on the edge from node k: horizontal 2k, vertical 2k + 1.
	vid := make([]int32, 2*n*m)
	for k := range vid {
		vid[k] = -1
	}
	c := &Contours{}
	vertex := func(k, l int, e int) int32 {
		if vid[e] >= 0 {
			return vid[e]
		}
		fp, fq := g.F[k], g.F[l]
		t := fp / (fp - fq)
		p := g.At(k%n, k/n)
		q := g.At(l%n, l/n)
		vid[e] = int32(len(c.Points))
		c.Points = append(c.Points, p+complex(t, 0)*(q-p))
		return vid[e]
	}
	next := []int32{}
	link := func(a, b int32) {
		for int(a) >= len(next) || int(b) >= len(next) {
			next = append(next, -1)
		}
		next[a] = b
	}
	for j := 0; j < m-1; j++ {
		for i := 0; i < n-1; i++ {
			k0, k1, k2, k3 := j*n+i, j*n+i+1, (j+1)*n+i+1, (j+1)*n+i
			ks := [4]int{k0, k1, k2, k3}
			// The cell's sides counterclockwise, as edge ids: bottom,
			// right, top (from k2 to k3, the horizontal edge at k3) and
			// left (the vertical edge at k0).
			edges := [4]int{2 * k0, 2*k1 + 1, 2 * k3, 2*k0 + 1}
			var in [4]bool
			for q := range 4 {
				in[q] = g.F[ks[q]] < 0
			}
			type crossing struct {
				v    int32
				exit bool
			}
			var xs [4]crossing
			nx := 0
			for q := range 4 {
				a, b := q, (q+1)%4
				if in[a] == in[b] {
					continue
				}
				var v int32
				// The edge runs from its lower-numbered node.
				switch q {
				case 0:
					v = vertex(k0, k1, edges[0])
				case 1:
					v = vertex(k1, k2, edges[1])
				case 2:
					v = vertex(k3, k2, edges[2])
				case 3:
					v = vertex(k0, k3, edges[3])
				}
				xs[nx] = crossing{v, in[a]}
				nx++
			}
			if len(c.Points) > lim.Vertices {
				return nil, limitError{"number of contour vertices"}
			}
			switch nx {
			case 2:
				if xs[0].exit {
					link(xs[0].v, xs[1].v)
				} else {
					link(xs[1].v, xs[0].v)
				}
			case 4:
				joined := (g.F[k0]+g.F[k1]+g.F[k2]+g.F[k3])/4 < 0
				for q := range 4 {
					if !xs[q].exit {
						continue
					}
					if joined {
						link(xs[q].v, xs[(q+1)%4].v)
					} else {
						link(xs[q].v, xs[(q+3)%4].v)
					}
				}
			}
		}
	}
	for len(next) < len(c.Points) {
		next = append(next, -1)
	}
	seen := make([]bool, len(c.Points))
	for s := range c.Points {
		if seen[s] {
			continue
		}
		var loop []int32
		for v := int32(s); !seen[v]; v = next[v] {
			if next[v] < 0 {
				return nil, errors.New("an open contour: the grid does not surround the plan")
			}
			seen[v] = true
			loop = append(loop, v)
		}
		c.Loops = append(c.Loops, loop)
	}
	c.dropStraight()
	return c, nil
}

// straight is the distance in millimeters within which a contour vertex
// counts as lying on the chord of its neighbors, and is dropped. It
// removes the runs of collinear vertices that marching squares leaves
// along a straight band edge, which would otherwise make zero-area
// triangles; it moves no boundary by more than itself.
const straight = 1e-7

// dropStraight removes vertices within straight of their neighbors'
// chord, repeating until none is, keeping at least three per loop.
func (c *Contours) dropStraight() {
	for li, l := range c.Loops {
		for changed := true; changed && len(l) > 3; {
			changed = false
			out := l[:0:0]
			for k := 0; k < len(l); k++ {
				var a complex128
				if len(out) > 0 {
					a = c.Points[out[len(out)-1]]
				} else {
					a = c.Points[l[len(l)-1]]
				}
				b, n := c.Points[l[k]], c.Points[l[(k+1)%len(l)]]
				chord := n - a
				if d := math.Abs(cross(chord, b-a)) / cmplx.Abs(chord); d < straight && len(l)-(k-len(out)) > 3 && dot(b-a, n-b) > 0 {
					changed = true
					continue
				}
				out = append(out, l[k])
			}
			l = out
		}
		c.Loops[li] = l
	}
}

// Area is a loop's signed area: positive counterclockwise.
func Area(pts []complex128, loop []int32) float64 {
	s := 0.0
	for k := range loop {
		a, b := pts[loop[k]], pts[loop[(k+1)%len(loop)]]
		s += cross(a, b)
	}
	return s / 2
}
