package engine

import (
	"fmt"
	"maps"
	"math"
	"sort"
	"strconv"
	"tangentgarden/engine/expr"
)

// Window is the rectangle an implicit curve is sought in.
type Window struct {
	XMin float64 `json:"xMin"`
	XMax float64 `json:"xMax"`
	YMin float64 `json:"yMin"`
	YMax float64 `json:"yMax"`
}

// Levels is an optional family of evenly spaced levels, From and To
// included, drawn alongside the curve's own level.
type Levels struct {
	Enabled bool    `json:"enabled"`
	From    float64 `json:"from"`
	To      float64 `json:"to"`
	Count   int     `json:"count"`
}

// Implicit is the curve F(x, y) = Level within Window, sought on a grid of
// Cells square cells along the window's longer side. F may use a, but not t.
type Implicit struct {
	F      string  `json:"f"`
	Level  float64 `json:"level"`
	Family Levels  `json:"family"`
	Window Window  `json:"window"`
	Cells  int     `json:"cells"`
}

// Contour is one connected piece of a level set, running with larger F on
// its left. An open contour ends where it leaves the window or meets cells
// where F is not finite or not continuous.
type Contour struct {
	Points []Vec `json:"points"`
	Closed bool  `json:"closed"`
}

// LevelSet is every contour of one level.
type LevelSet struct {
	Level    float64   `json:"level"`
	Contours []Contour `json:"contours"`
}

// Normal is the gradient of F at a point of the curve.
type Normal struct {
	Point    Vec `json:"point"`
	Gradient Vec `json:"gradient"`
}

// ContourResult holds the curve's level set, the family's, and the gradient
// at representative points spaced evenly by arc length along the curve.
// Discontinuities are where F changes sign along a grid edge without
// reaching the level (a pole or a jump), one per edge in edge order, and
// Nonfinite counts the grid points where F is not a finite number; neither
// is drawn through.
type ContourResult struct {
	Window          Window     `json:"window"`
	Columns         int        `json:"columns"`
	Rows            int        `json:"rows"`
	Curve           LevelSet   `json:"curve"`
	Family          []LevelSet `json:"family"`
	Normals         []Normal   `json:"normals"`
	Discontinuities []Vec      `json:"discontinuities"`
	Nonfinite       int        `json:"nonfinite"`
}

const (
	minCells, maxCells = 4, 1024
	// Refinement stops once a chord's midpoint is within this fraction of a
	// cell of the curve.
	contourTolerance = 1e-3
)

// Work bounds: grid edges crossed over all levels, points over all contours,
// and chord halvings from each grid chord.
var (
	maxContourCrossings = 65536
	maxContourPoints    = 131072
	maxRefineDepth      = 6
)

func formatLevel(v float64) string { return strconv.FormatFloat(v, 'g', 6, 64) }

// validate checks a window for an implicit curve or a density grid.
func (w Window) validate() error {
	for i, x := range []float64{w.XMin, w.XMax, w.YMin, w.YMax} {
		if !finite(x) || math.Abs(x) > 1e5 {
			return fieldErr([]string{"xMin", "xMax", "yMin", "yMax"}[i], "the window must be finite and within ±100000")
		}
	}
	if !(w.XMax-w.XMin >= 1e-6) {
		return fieldErr("xMax", "the window needs x and y ranges at least 0.000001 wide, each from below to above")
	}
	if !(w.YMax-w.YMin >= 1e-6) {
		return fieldErr("yMax", "the window needs x and y ranges at least 0.000001 wide, each from below to above")
	}
	return nil
}

// gridShape divides a window into columns × rows cells as close to square
// as it allows, with cells along its longer side.
func gridShape(w Window, cells int) (nx, ny int) {
	width, height := w.XMax-w.XMin, w.YMax-w.YMin
	nx, ny = cells, cells
	if width >= height {
		ny = max(1, int(math.Round(height/(width/float64(cells)))))
	} else {
		nx = max(1, int(math.Round(width/(height/float64(cells)))))
	}
	return
}

func (v Implicit) validate() error {
	if err := v.Window.validate(); err != nil {
		return within("window", err)
	}
	if v.Cells < minCells || v.Cells > maxCells {
		return fieldErr("cells", "an implicit curve needs 4–1024 cells along the window's longer side")
	}
	if !finite(v.Level) {
		return fieldErr("level", "the level must be finite")
	}
	if f := v.Family; f.Enabled {
		if f.Count < 2 || f.Count > 64 {
			return fieldErr("family.count", "a family of levels has 2–64 levels")
		}
		if !finite(f.From) {
			return fieldErr("family.from", "family levels must be finite")
		}
		if !finite(f.To) {
			return fieldErr("family.to", "family levels must be finite")
		}
	}
	return nil
}

// sheet is F sampled on the grid.
type sheet struct {
	f         func(x, y float64) float64
	w         Window
	nx, ny    int
	hx, hy    float64
	values    []float64
	scale     float64
	nonfinite int
	// Grid edges crossed and contour points so far, over every level.
	crossings, points int
	// Grid edges where F changes sign without being continuous, over every
	// level.
	rejected  map[int]Vec
	truncated bool
	// Per edge, the edge the segment starting there leads to, and whether
	// a segment ends there, kept between levels and cleared after each.
	next    []int32
	entered []bool
}

func (s *sheet) node(i, j int) Vec {
	return Vec{s.w.XMin + (s.w.XMax-s.w.XMin)*float64(i)/float64(s.nx), s.w.YMin + (s.w.YMax-s.w.YMin)*float64(j)/float64(s.ny)}
}

func (s *sheet) at(p Vec) float64 { return s.f(p.X, p.Y) }

// gradient differentiates F with a five-point stencil a thousandth of a
// cell wide.
func (s *sheet) gradient(p Vec) Vec {
	h := 1e-3 * math.Min(s.hx, s.hy)
	d := func(e Vec) float64 {
		return (s.at(p.Sub(e.Mul(2*h))) - 8*s.at(p.Sub(e.Mul(h))) + 8*s.at(p.Add(e.Mul(h))) - s.at(p.Add(e.Mul(2*h)))) / (12 * h)
	}
	return Vec{d(Vec{1, 0}), d(Vec{0, 1})}
}

func newSheet(v Implicit, a float64) (*sheet, error) {
	f, timed, err := expr.ParseField(v.F, a)
	if err != nil {
		return nil, fieldErr("f", "F(x, y): %v", err)
	}
	if timed {
		return nil, fieldErr("f", "F(x, y) cannot use t; animate a or the level instead")
	}
	return sample(func(x, y float64) float64 { return f(x, y, 0) }, v.Window, v.Cells), nil
}

// sample evaluates f on the grid of cells cells along the window's longer
// side.
func sample(f func(x, y float64) float64, w Window, cells int) *sheet {
	width, height := w.XMax-w.XMin, w.YMax-w.YMin
	s := &sheet{f: f, w: w, rejected: map[int]Vec{}}
	s.nx, s.ny = gridShape(w, cells)
	s.hx, s.hy = width/float64(s.nx), height/float64(s.ny)
	s.scale = math.Max(width, height) + math.Max(math.Max(math.Abs(w.XMin), math.Abs(w.XMax)), math.Max(math.Abs(w.YMin), math.Abs(w.YMax)))
	s.values = make([]float64, (s.nx+1)*(s.ny+1))
	for j := 0; j <= s.ny; j++ {
		for i := 0; i <= s.nx; i++ {
			g := s.at(s.node(i, j))
			if !finite(g) {
				g = math.NaN()
				s.nonfinite++
			}
			s.values[j*(s.nx+1)+i] = g
		}
	}
	return s
}

// ContourBudget carries the budgets of grid edges bisected and contour
// points from one trace to the next, as a family's levels share them.
type ContourBudget struct {
	Crossings int
	Points    int
	// Truncated is set once refinement stops at the point budget.
	Truncated bool
}

// TraceLevel traces and refines the level set f = c exactly as an implicit
// curve's, for a field given as a function rather than an expression, such
// as a section of a spatial field. The window, of cells cells along its
// longer side, must be valid; a grid point where f is not finite leaves
// out the cells beside it. It returns the discontinuities found, in edge
// order, or reports false and traces nothing when the crossings would
// exceed the budget left after b.
func TraceLevel(f func(x, y float64) float64, w Window, cells int, c float64, b *ContourBudget) (LevelSet, []Vec, bool) {
	s := sample(f, w, cells)
	s.crossings, s.points = b.Crossings, b.Points
	set, ok := s.level(c)
	if !ok {
		return set, nil, false
	}
	s.refine(&set)
	b.Crossings, b.Points, b.Truncated = s.crossings, s.points, b.Truncated || s.truncated
	return set, s.discontinuities(), true
}

// Grid edges: the horizontal edge from node (i, j) is 2k and the vertical
// edge 2k + 1, where k indexes node (i, j).
func (s *sheet) edge(i, j int, vertical bool) int {
	k := 2 * (j*(s.nx+1) + i)
	if vertical {
		k++
	}
	return k
}

func (s *sheet) ends(e int) (Vec, Vec, float64, float64) {
	k := e / 2
	i, j := k%(s.nx+1), k/(s.nx+1)
	i2, j2 := i+1, j
	if e%2 == 1 {
		i2, j2 = i, j+1
	}
	return s.node(i, j), s.node(i2, j2), s.values[k], s.values[j2*(s.nx+1)+i2]
}

// root bisects edge e for F = c, with the ends' values g0 and g1 of F − c
// on opposite sides: F − c ≥ 0 and < 0. It reports false where F is not
// continuous there: the value it converges on does not shrink with the
// bracket, as at a pole or a jump, or is not a number. The point is then
// where that happens.
func (s *sheet) root(e int, c float64) (Vec, bool) {
	a, b, fa, fb := s.ends(e)
	ga, gb := fa-c, fb-c
	if ga == 0 {
		return a, true
	}
	if gb == 0 {
		return b, true
	}
	lo, hi, glo, ghi := a, b, ga, gb
	for {
		mid := lo.Add(hi).Mul(.5)
		if mid == lo || mid == hi {
			break
		}
		g := s.at(mid) - c
		if !finite(g) {
			return mid, false
		}
		if g == 0 {
			return mid, true
		}
		if (g >= 0) == (glo >= 0) {
			lo, glo = mid, g
		} else {
			hi, ghi = mid, g
		}
	}
	// A continuous F changes by at most a million times its mean slope
	// along the edge over the last bracket.
	slope := (math.Abs(ga) + math.Abs(gb)) / b.Sub(a).Norm()
	if math.Min(math.Abs(glo), math.Abs(ghi)) > 1e6*slope*hi.Sub(lo).Norm() {
		return lo, false
	}
	return lo, true
}

// Local cell geometry, counterclockwise from the lower left: corners and
// the edges from each corner to the next.
var (
	cellCorners = [4]Vec{{0, 0}, {1, 0}, {1, 1}, {0, 1}}
	cellEdges   = [4]Vec{{.5, 0}, {1, .5}, {.5, 1}, {0, .5}}
)

// level traces every contour of F = c, or reports false, leaving the sheet
// unchanged, when they would cross more grid edges than the budget allows.
func (s *sheet) level(c float64) (LevelSet, bool) {
	set := LevelSet{Level: c, Contours: []Contour{}}
	if s.next == nil {
		edges := 2 * (s.nx + 1) * (s.ny + 1)
		s.next, s.entered = make([]int32, edges), make([]bool, edges)
		for k := range s.next {
			s.next[k] = -1
		}
	}
	// Segments start at these edges; they are cleared again on return.
	var from []int
	defer func() {
		for _, e := range from {
			s.entered[s.next[e]], s.next[e] = false, -1
		}
	}()
	// Every edge bisected counts toward the budget, crossed or not.
	crossings, rejected := map[int]Vec{}, map[int]Vec{}
	over := false
	cross := func(e int) bool {
		if _, ok := crossings[e]; ok {
			return true
		}
		if _, ok := rejected[e]; ok {
			return false
		}
		p, ok := s.root(e, c)
		if ok {
			crossings[e] = p
		} else {
			rejected[e] = p
		}
		over = s.crossings+len(crossings)+len(rejected) > maxContourCrossings
		return ok
	}
	// link orients the segment between local edges a and b so that ref, a
	// point of the cell, lies on its left exactly when left is true.
	link := func(ids [4]int, a, b int, ref Vec, left bool) {
		if (cellEdges[b].Sub(cellEdges[a]).Cross(ref.Sub(cellEdges[a])) > 0) != left {
			a, b = b, a
		}
		// Both crossings are sought, so each rejected edge is counted.
		if ca, cb := cross(ids[a]), cross(ids[b]); ca && cb {
			s.next[ids[a]], s.entered[ids[b]] = int32(ids[b]), true
			from = append(from, ids[a])
		}
	}
	row := s.nx + 1
	for j := 0; j < s.ny && !over; j++ {
		for i := 0; i < s.nx && !over; i++ {
			k := j*row + i
			g := [4]float64{s.values[k] - c, s.values[k+1] - c, s.values[k+row+1] - c, s.values[k+row] - c}
			// A cell entirely on one side has no crossing; NaN counts as
			// negative here and is checked below.
			mask := 0
			for q, v := range g {
				if v >= 0 {
					mask |= 1 << q
				}
			}
			if mask == 0 || mask == 15 {
				continue
			}
			if math.IsNaN(g[0]) || math.IsNaN(g[1]) || math.IsNaN(g[2]) || math.IsNaN(g[3]) {
				continue
			}
			ids := [4]int{s.edge(i, j, false), s.edge(i+1, j, true), s.edge(i, j+1, false), s.edge(i, j, true)}
			pos := func(q int) bool { return mask&(1<<q) != 0 }
			var changed [4]int
			n := 0
			for q := range 4 {
				if pos(q) != pos((q+1)%4) {
					changed[n], n = q, n+1
				}
			}
			if n == 2 {
				// The positive corners lie together on one side.
				var ref Vec
				count := 0.0
				for q, d := range cellCorners {
					if pos(q) {
						ref, count = ref.Add(d), count+1
					}
				}
				link(ids, changed[0], changed[1], ref.Mul(1/count), true)
				continue
			}
			// Diagonal corners share a sign. The bilinear interpolant's
			// saddle value decides which pair is connected through the cell
			// (the asymptotic decider); the other pair's corners are each
			// cut off by a segment.
			saddle := (g[0]*g[2] - g[1]*g[3]) / (g[0] + g[2] - g[1] - g[3])
			cut := [2]int{0, 2}
			if (saddle >= 0) == pos(0) {
				cut = [2]int{1, 3}
			}
			for _, q := range cut {
				link(ids, (q+3)%4, q, cellCorners[q], pos(q))
			}
		}
	}
	if over {
		return set, false
	}
	s.crossings += len(crossings) + len(rejected)
	// Every level converges on the same point of a discontinuity.
	maps.Copy(s.rejected, rejected)
	// Open contours start at an edge nothing enters; the rest are loops.
	// Both are taken in edge order.
	sort.Ints(from)
	visited := map[int]bool{}
	trace := func(start int, closed bool) {
		var points []Vec
		for e := start; e >= 0 && !visited[e]; e = int(s.next[e]) {
			visited[e] = true
			// Crossings at a shared grid point coincide.
			if p := crossings[e]; len(points) == 0 || p != points[len(points)-1] {
				points = append(points, p)
			}
		}
		if closed && len(points) > 1 && points[0] == points[len(points)-1] {
			points = points[:len(points)-1]
		}
		// A lone point where F touches the level is not a curve.
		if len(points) > 1 {
			set.Contours = append(set.Contours, Contour{Points: points, Closed: closed})
			s.points += len(points)
		}
	}
	for _, e := range from {
		if !s.entered[e] {
			trace(e, false)
		}
	}
	for _, e := range from {
		if !visited[e] {
			trace(e, true)
		}
	}
	return set, true
}

// project follows F's gradient from x to the curve F = c by Newton's
// method.
func (s *sheet) project(x Vec, c float64) (Vec, bool) {
	for range 30 {
		g := s.at(x) - c
		if g == 0 {
			return x, true
		}
		d := s.gradient(x)
		n := d.Dot(d)
		if !finite(g) || !finite(n) || n == 0 {
			return x, false
		}
		step := d.Mul(g / n)
		if x = x.Sub(step); !x.Valid() {
			return x, false
		}
		if step.Norm() <= 1e-15*s.scale {
			return x, true
		}
	}
	return x, false
}

// subdivide appends the curve's points strictly between p and q, then q.
// A chord is halved where its midpoint projects onto the curve farther than
// tol away, between p and q and within half the chord, so refinement never
// crosses to another piece of the level set.
func (s *sheet) subdivide(out []Vec, p, q Vec, c, tol float64, depth int) []Vec {
	if depth > 0 {
		mid, chord := p.Add(q).Mul(.5), q.Sub(p)
		r, ok := s.project(mid, c)
		along := r.Sub(p).Dot(chord) / chord.Dot(chord)
		if ok && r.Sub(mid).Norm() > tol && r.Sub(mid).Norm() <= chord.Norm()/2 && along > 0 && along < 1 {
			if s.points >= maxContourPoints {
				s.truncated = true
			} else {
				s.points++
				out = s.subdivide(out, p, r, c, tol, depth-1)
				return s.subdivide(out, r, q, c, tol, depth-1)
			}
		}
	}
	return append(out, q)
}

func (s *sheet) refine(set *LevelSet) {
	tol := contourTolerance * math.Min(s.hx, s.hy)
	for k := range set.Contours {
		c := &set.Contours[k]
		pts := c.Points
		out := []Vec{pts[0]}
		for j := 1; j < len(pts); j++ {
			out = s.subdivide(out, pts[j-1], pts[j], set.Level, tol, maxRefineDepth)
		}
		if c.Closed {
			out = s.subdivide(out, pts[len(pts)-1], pts[0], set.Level, tol, maxRefineDepth)
			out = out[:len(out)-1]
		}
		c.Points = out
	}
}

// normals places n points evenly by arc length along the set's contours,
// each projected onto the curve, with F's gradient there.
func (s *sheet) normals(set LevelSet, n int) []Normal {
	out := []Normal{}
	var chords [][2]Vec
	total := 0.0
	for _, c := range set.Contours {
		for j := 1; j < len(c.Points); j++ {
			chords = append(chords, [2]Vec{c.Points[j-1], c.Points[j]})
		}
		if c.Closed {
			chords = append(chords, [2]Vec{c.Points[len(c.Points)-1], c.Points[0]})
		}
	}
	for _, e := range chords {
		total += e[1].Sub(e[0]).Norm()
	}
	if !(total > 0) {
		return out
	}
	k, walked := 0, 0.0
	for _, e := range chords {
		length := e[1].Sub(e[0]).Norm()
		for ; k < n && (float64(k)+.5)*total/float64(n) <= walked+length; k++ {
			u := ((float64(k)+.5)*total/float64(n) - walked) / length
			x := e[0].Add(e[1].Sub(e[0]).Mul(u))
			p, ok := s.project(x, set.Level)
			if !ok || p.Sub(x).Norm() > length {
				continue
			}
			if d := s.gradient(p); d.Valid() {
				out = append(out, Normal{Point: p, Gradient: d})
			}
		}
		walked += length
	}
	return out
}

// discontinuities returns where F changes sign without crossing the level,
// in edge order.
func (s *sheet) discontinuities() []Vec {
	edges := make([]int, 0, len(s.rejected))
	for e := range s.rejected {
		edges = append(edges, e)
	}
	sort.Ints(edges)
	out := make([]Vec, len(edges))
	for k, e := range edges {
		out[k] = s.rejected[e]
	}
	return out
}

// contours traces the curve and its family, with lines normals.
func (v Implicit) contours(a float64, lines int) (*ContourResult, []string, error) {
	if err := v.validate(); err != nil {
		return nil, nil, err
	}
	s, err := newSheet(v, a)
	if err != nil {
		return nil, nil, err
	}
	var warnings []string
	out := &ContourResult{Window: v.Window, Columns: s.nx, Rows: s.ny, Family: []LevelSet{}, Normals: []Normal{}}
	var ok bool
	if out.Curve, ok = s.level(v.Level); !ok {
		warnings = append(warnings, fmt.Sprintf("The curve was not traced: it would cross more than %d grid edges. Use fewer cells.", maxContourCrossings))
	}
	if f := v.Family; f.Enabled {
		for k := range f.Count {
			// This form returns both endpoints exactly.
			u := float64(k) / float64(f.Count-1)
			set, ok := s.level(f.From*(1-u) + f.To*u)
			if !ok {
				skipped := "Every family level was skipped"
				if k > 0 {
					skipped = "Family levels after " + formatLevel(out.Family[k-1].Level) + " were skipped"
				}
				warnings = append(warnings, fmt.Sprintf("%s: the contours would cross more than %d grid edges in all. Use fewer cells or levels.", skipped, maxContourCrossings))
				break
			}
			out.Family = append(out.Family, set)
		}
	}
	s.refine(&out.Curve)
	for k := range out.Family {
		s.refine(&out.Family[k])
	}
	if s.truncated {
		warnings = append(warnings, fmt.Sprintf("Contours stopped being refined at %d points; they are drawn with straighter chords.", maxContourPoints))
	}
	out.Normals = s.normals(out.Curve, lines)
	out.Discontinuities = s.discontinuities()
	out.Nonfinite = s.nonfinite
	return out, warnings, nil
}
