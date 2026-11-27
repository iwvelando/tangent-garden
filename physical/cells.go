package physical

import (
	"math"
	"math/cmplx"
	"slices"
)

// CellStatus is a cell's verdict against a need.
type CellStatus string

const (
	CellPass       CellStatus = "pass"
	CellFail       CellStatus = "fail"
	CellUnresolved CellStatus = "unresolved"
)

// Cell is one connected piece of the plaque outside the plan: a gap
// between raised lines, or a web between grooves. Radius is the largest
// sampled clearance in it, a lower bound on its inscribed radius: the
// disk of that radius about Center lies in the cell. The true inscribed
// radius is at most Radius plus the report's Allowance.
type Cell struct {
	Center complex128 `json:"-"`
	X      float64    `json:"x"`
	Y      float64    `json:"y"`
	Radius float64    `json:"radius"`
	Nodes  int        `json:"nodes"`
	Status CellStatus `json:"status"`
	// Vanished marks a source cell the bands filled entirely.
	Vanished bool `json:"vanished"`
	// Tiles are the source tiles nearest the cell's nodes.
	Tiles []int `json:"-"`
}

// CellReport is the plaque's cells against a need, the least diameter a
// cell must hold: the gap minimum between raised lines or the wall
// minimum between grooves.
//
//   - A cell passes when its sampled inscribed diameter reaches the need,
//     fails when even the allowance cannot reach it, and is unresolved
//     between.
//   - Fused lists groups of separate source pieces that come within the
//     need of each other (or overlap), found on the plan widened by half
//     the need. Joints the frame makes by design are not counted.
//   - NarrowArea is the sampled area of cells no disk of the need's
//     diameter inside them reaches: channels, wedge corners and cusps,
//     where a slicer may close or skip the gap.
type CellReport struct {
	Need       float64      `json:"need"`
	Allowance  float64      `json:"allowance"`
	Cells      []Cell       `json:"-"`
	Count      int          `json:"count"`
	Failed     int          `json:"failed"`
	Unresolved int          `json:"unresolved"`
	Vanished   int          `json:"vanished"`
	Fused      [][]int32    `json:"fused"`
	NarrowArea float64      `json:"narrowArea"`
	Narrow     []complex128 `json:"-"`
}

// Worst is the cell with the least sampled radius.
func (r CellReport) Worst() Cell {
	if len(r.Cells) == 0 {
		return Cell{Status: CellPass}
	}
	w := r.Cells[0]
	for _, c := range r.Cells[1:] {
		if c.Radius < w.Radius {
			w = c
		}
	}
	return w
}

// label finds the connected pieces of nodes where in is true, joining
// diagonal neighbors across a cell when its two other corners are out
// and the cell's mean of value v agrees, the rule Contour uses at a
// saddle, so pieces match the contoured regions. Labels start at 1; 0 is
// outside.
func label(g *Grid, in func(k int) bool, v func(k int) float64, inside bool) ([]int32, int) {
	n := g.NX * g.NY
	lab := make([]int32, n)
	next := int32(0)
	queue := []int{}
	for s := range n {
		if lab[s] != 0 || !in(s) {
			continue
		}
		next++
		lab[s] = next
		queue = append(queue[:0], s)
		for len(queue) > 0 {
			k := queue[len(queue)-1]
			queue = queue[:len(queue)-1]
			i, j := k%g.NX, k/g.NX
			for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
				x, y := i+d[0], j+d[1]
				if x < 0 || y < 0 || x >= g.NX || y >= g.NY {
					continue
				}
				if q := y*g.NX + x; lab[q] == 0 && in(q) {
					lab[q] = next
					queue = append(queue, q)
				}
			}
			for _, d := range [4][2]int{{1, 1}, {-1, 1}, {1, -1}, {-1, -1}} {
				x, y := i+d[0], j+d[1]
				if x < 0 || y < 0 || x >= g.NX || y >= g.NY {
					continue
				}
				q := y*g.NX + x
				if lab[q] != 0 || !in(q) {
					continue
				}
				a, b := j*g.NX+x, y*g.NX+i
				if in(a) || in(b) {
					continue // joined through a side already
				}
				mean := (v(k) + v(q) + v(a) + v(b)) / 4
				if (mean < 0) == inside {
					lab[q] = next
					queue = append(queue, q)
				}
			}
		}
	}
	return lab, int(next)
}

// AnalyzeCells examines the plaque outside the plan for a need. comp
// names each stroke's source piece: strokes sharing ends share a piece.
func AnalyzeCells(g *Grid, p Plan, comp []int32, need float64) CellReport {
	r := CellReport{Need: need, Allowance: g.H / math.Sqrt2}
	plaque := p.Plaque
	if plaque == 0 {
		plaque = p.Outer
	}
	n := g.NX * g.NY
	clear := make([]float64, n)
	for k := range n {
		x := g.At(k%g.NX, k/g.NX)
		clear[k] = math.Min(g.F[k], plaque-cmplx.Abs(x))
	}
	// The cells.
	lab, count := label(g, func(k int) bool { return clear[k] > 0 }, func(k int) float64 { return g.F[k] }, false)
	r.Cells = make([]Cell, count)
	best := make([]int, count)
	for c := range best {
		best[c] = -1
	}
	tiles := make([]map[int]bool, count)
	for k, l := range lab {
		if l == 0 {
			continue
		}
		c := l - 1
		r.Cells[c].Nodes++
		if best[c] < 0 || clear[k] > clear[best[c]] {
			best[c] = k
		}
		if s := g.Near[k]; s >= 0 && int(s) < len(p.Strokes) && p.Strokes[s].Tile >= 0 && clear[k] < need {
			if tiles[c] == nil {
				tiles[c] = map[int]bool{}
			}
			tiles[c][p.Strokes[s].Tile] = true
		}
	}
	half := need / 2
	for c := range r.Cells {
		k := best[c]
		cell := &r.Cells[c]
		cell.Center = g.At(k%g.NX, k/g.NX)
		cell.X, cell.Y = real(cell.Center), imag(cell.Center)
		cell.Radius = clear[k]
		switch {
		case cell.Radius >= half || clear[k] >= g.Cap:
			cell.Status = CellPass
		case cell.Radius+r.Allowance < half:
			cell.Status = CellFail
			r.Failed++
		default:
			cell.Status = CellUnresolved
			r.Unresolved++
		}
		for t := range tiles[c] {
			cell.Tiles = append(cell.Tiles, t)
		}
	}
	r.Count = count
	// Source cells: the pieces outside the strokes' centerlines, widened
	// by a step so the grid resolves them (F + half is the distance to
	// the nearest centerline, the frame's included). A resolved source
	// cell holding no node of the plaque outside the plan has vanished:
	// the bands filled it. It fails, with radius zero.
	if len(p.Strokes) > 0 {
		half0 := p.Strokes[0].Half
		// Inside the frame's centerline, when there is a frame: beyond it
		// lies the frame's outer half and the border, not a source cell.
		within := plaque
		if p.Frame > 0 {
			within = p.Clip + p.Frame/2
		}
		src, sc := label(g, func(k int) bool { return g.F[k]+half0 > g.H && cmplx.Abs(g.At(k%g.NX, k/g.NX)) < within }, func(k int) float64 { return g.F[k] + half0 - g.H }, false)
		open := make([]bool, sc+1)
		at := make([]int, sc+1)
		for k, l := range src {
			if l == 0 {
				continue
			}
			if clear[k] > 0 {
				open[l] = true
			}
			if at[l] == 0 || g.F[k] > g.F[at[l]] {
				at[l] = k
			}
		}
		gone := make([]map[int]bool, sc+1)
		for k, l := range src {
			if l == 0 || open[l] {
				continue
			}
			if gone[l] == nil {
				gone[l] = map[int]bool{}
			}
			if s := g.Near[k]; s >= 0 && int(s) < len(p.Strokes) && p.Strokes[s].Tile >= 0 {
				gone[l][p.Strokes[s].Tile] = true
			}
		}
		for l := 1; l <= sc; l++ {
			// A source cell is judged only when the grid resolves it: a
			// node two steps from every centerline. Smaller ones are wedge
			// tips cut off by sampling.
			if open[l] || gone[l] == nil || g.F[at[l]]+half0 < 2*g.H {
				continue
			}
			k := at[l]
			c := Cell{Center: g.At(k%g.NX, k/g.NX), Status: CellFail, Vanished: true}
			c.X, c.Y = real(c.Center), imag(c.Center)
			for t := range gone[l] {
				c.Tiles = append(c.Tiles, t)
			}
			r.Cells = append(r.Cells, c)
			r.Failed++
			r.Vanished++
		}
	}
	// Separate pieces within the need of each other.
	if len(comp) == len(p.Strokes) && len(comp) > 0 {
		pieces := append([]int32(nil), comp...)
		top := int32(0)
		for _, c := range pieces {
			top = max(top, c)
		}
		frame := top + 1
		parent := make([]int32, frame+1)
		for i := range parent {
			parent[i] = int32(i)
		}
		var find func(int32) int32
		find = func(x int32) int32 {
			for parent[x] != x {
				parent[x] = parent[parent[x]]
				x = parent[x]
			}
			return x
		}
		if p.Frame > 0 {
			for s, st := range p.Strokes {
				if farthest(st)+st.Half >= p.Clip {
					parent[find(pieces[s])] = find(frame)
				}
			}
		}
		wide, _ := label(g, func(k int) bool { return g.F[k] < half }, func(k int) float64 { return g.F[k] - half }, true)
		groups := map[int32]map[int32]bool{}
		add := func(k int, piece int32) {
			if l := wide[k]; l != 0 {
				if groups[l] == nil {
					groups[l] = map[int32]bool{}
				}
				groups[l][find(piece)] = true
			}
		}
		for s, st := range p.Strokes {
			i, j := g.index(midpoint(st) + complex(g.H/2, g.H/2))
			if i >= 0 && j >= 0 && i < g.NX && j < g.NY {
				add(j*g.NX+i, pieces[s])
			}
		}
		if p.Frame > 0 {
			i, j := g.index(complex(p.Clip+p.Frame/2+g.H/2, g.H/2))
			add(j*g.NX+i, frame)
		}
		labels := make([]int32, 0, len(groups))
		for l := range groups {
			labels = append(labels, l)
		}
		slices.Sort(labels)
		for _, l := range labels {
			if len(groups[l]) < 2 {
				continue
			}
			var group []int32
			for c := range groups[l] {
				group = append(group, c)
			}
			slices.Sort(group)
			r.Fused = append(r.Fused, group)
		}
	}
	// Narrow area: nodes of a cell no disk of radius half inside it
	// reaches, from the exact distance to the nearest node of clearance
	// at least half, with a step's allowance.
	seed := make([]float64, n)
	for k := range n {
		if clear[k] >= half {
			seed[k] = 0
		} else {
			seed[k] = math.Inf(1)
		}
	}
	d2 := distanceTransform(seed, g.NX, g.NY)
	reach := half/g.H + 1
	for k := range n {
		if clear[k] > 0 && d2[k] > reach*reach {
			r.NarrowArea += g.H * g.H
			r.Narrow = append(r.Narrow, g.At(k%g.NX, k/g.NX))
		}
	}
	return r
}

// farthest is the greatest distance from the origin to a stroke.
func farthest(s Stroke) float64 {
	d := math.Max(cmplx.Abs(s.A), cmplx.Abs(s.B))
	if !s.Straight && cmplx.Abs(s.C) > 0 {
		far := s.C + complex(s.R/cmplx.Abs(s.C), 0)*s.C
		if s.Distance(far) < 1e-9*(1+s.R) {
			d = math.Max(d, cmplx.Abs(s.C)+s.R)
		}
	}
	return d
}

// midpoint is the point halfway along a stroke.
func midpoint(s Stroke) complex128 {
	if s.Straight {
		return (s.A + s.B) / 2
	}
	turn := cmplx.Phase((s.B - s.C) / (s.A - s.C))
	return s.C + (s.A-s.C)*cmplx.Rect(1, turn/2)
}

// distanceTransform is the squared Euclidean distance, in node steps,
// from each node to the nearest node whose value is 0, by the separable
// lower-envelope method of Felzenszwalb and Huttenlocher; f holds 0 or
// +Inf.
func distanceTransform(f []float64, nx, ny int) []float64 {
	out := make([]float64, len(f))
	col := make([]float64, max(nx, ny))
	res := make([]float64, max(nx, ny))
	v := make([]int, max(nx, ny))
	z := make([]float64, max(nx, ny)+1)
	pass := func(n int) {
		k := 0
		v[0] = 0
		z[0], z[1] = math.Inf(-1), math.Inf(1)
		first := -1
		for q := range n {
			if !math.IsInf(col[q], 1) {
				first = q
				break
			}
		}
		if first < 0 {
			for q := range n {
				res[q] = math.Inf(1)
			}
			return
		}
		v[0] = first
		for q := first + 1; q < n; q++ {
			if math.IsInf(col[q], 1) {
				continue
			}
			s := ((col[q] + float64(q*q)) - (col[v[k]] + float64(v[k]*v[k]))) / float64(2*q-2*v[k])
			for s <= z[k] {
				k--
				s = ((col[q] + float64(q*q)) - (col[v[k]] + float64(v[k]*v[k]))) / float64(2*q-2*v[k])
			}
			k++
			v[k] = q
			z[k] = s
			z[k+1] = math.Inf(1)
		}
		k = 0
		for q := range n {
			for z[k+1] < float64(q) {
				k++
			}
			d := float64(q - v[k])
			res[q] = d*d + col[v[k]]
		}
	}
	tmp := make([]float64, len(f))
	for i := range nx {
		for j := range ny {
			col[j] = f[j*nx+i]
		}
		pass(ny)
		for j := range ny {
			tmp[j*nx+i] = res[j]
		}
	}
	for j := range ny {
		copy(col[:nx], tmp[j*nx:(j+1)*nx])
		pass(nx)
		copy(out[j*nx:(j+1)*nx], res[:nx])
	}
	return out
}
