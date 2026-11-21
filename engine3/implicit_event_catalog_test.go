package engine3

import (
	"math"
	"slices"
	"testing"

	"tangentgarden/engine/expr"
)

// The topology theater's stories with several events, or several critical
// points at one event (web/spatial/story.ts and docs/mathematics.md,
// "Curated events"): the tanglecube, whose eight drops join into a genus-5
// cage, close into a hollow shell and lose the hollow, and the double
// torus, whose two holes close at one level. As in implicit_event_test.go,
// the analysis's facts are checked on F as the engine parses it, then the
// mesher's returned classes beside each event, and where finite resolution
// stops supporting them.

type criticalPoint struct {
	at Vec3
	// The Hessian, diagonal in these coordinates.
	hessian [3]float64
}

type catalogStory struct {
	preset string
	// The levels the story covers.
	low, high float64
	// Ascending critical levels, and every critical point at each.
	critical []float64
	points   [][]criticalPoint
	// Euler characteristics of the closed pieces on each side, ascending:
	// below the first critical level, between each pair, above the last.
	sides [][]int
	// The story's regular level on each side.
	levels []float64
	// Half-widths of the box about the origin holding F ≤ c, and where each
	// is reached on F = c.
	extent   func(c float64) Vec3
	extremes func(c float64) []Vec3
	// The width of the feature narrowing toward event i from below
	// (above = false) or above, at level c; 0 when nothing narrows.
	feature func(i int, above bool, c float64) float64
	// Away from these levels' neighborhoods, F's gradient vanishes only at
	// the listed points: a sampled check of the analysis's completeness.
	floor float64
}

// g(t) = t⁴ − 5t², each coordinate's term of the tanglecube, and the t² at
// which g(t) = v: the smaller root (minus) or the larger.
func tangleRoot(v float64, larger bool) float64 {
	d := math.Sqrt(25 + 4*v)
	if larger {
		return (5 + d) / 2
	}
	return (5 - d) / 2
}

var tangleSaddle = math.Sqrt(2.5)

func tanglePoints(nonzero int) []criticalPoint {
	var out []criticalPoint
	for _, sx := range []float64{-1, 0, 1} {
		for _, sy := range []float64{-1, 0, 1} {
			for _, sz := range []float64{-1, 0, 1} {
				s := [3]float64{sx, sy, sz}
				n := 0
				var p criticalPoint
				for i, v := range s {
					p.hessian[i] = -10
					if v != 0 {
						n++
						p.hessian[i] = 20
					}
				}
				if n != nonzero {
					continue
				}
				p.at = Vec3{sx * tangleSaddle, sy * tangleSaddle, sz * tangleSaddle}
				out = append(out, p)
			}
		}
	}
	return out
}

// h = (x² + y²)² − x² + y² for the double torus, F = h² + z².
const dtRoot = 0.7071067811865476 // 1/√2

var catalogStories = []catalogStory{
	{
		preset:   "The tanglecube's three events",
		low:      -18,
		high:     4,
		critical: []float64{-12.5, -6.25, 0},
		// 12 index-1 saddles (two nonzero coordinates), 6 of index 2 and
		// the maximum. The 8 minima at −75/4 lie below the story's levels.
		points: [][]criticalPoint{tanglePoints(2), tanglePoints(1), tanglePoints(0)},
		sides:  [][]int{{2, 2, 2, 2, 2, 2, 2, 2}, {-8}, {2, 2}, {2}},
		levels: []float64{-15, -10, -3, 2},
		// g(x) ≤ c − g(y) − g(z) ≤ c + 25/2, reached with y, z = ±√(5/2).
		extent: func(c float64) Vec3 {
			r := math.Sqrt(tangleRoot(c+12.5, true))
			return Vec3{r, r, r}
		},
		extremes: func(c float64) []Vec3 {
			r, s := math.Sqrt(tangleRoot(c+12.5, true)), tangleSaddle
			return []Vec3{{r, s, s}, {s, r, s}, {s, s, r}}
		},
		feature: func(i int, above bool, c float64) float64 {
			switch {
			case i == 0 && !above:
				// The gap between neighboring drops on the edge line
				// (t, √(5/2), √(5/2)), where F = g(t) − 25/2.
				return 2 * math.Sqrt(tangleRoot(c+12.5, false))
			case i == 0:
				// The neck's width on the line (0, t, √(5/2)): g(t) ≤ c + 25/4.
				return math.Sqrt(tangleRoot(c+6.25, true)) - math.Sqrt(tangleRoot(c+6.25, false))
			case i == 1 && !above:
				// The window in the face x = √(5/2), on its line z = 0.
				return 2 * math.Sqrt(tangleRoot(c+6.25, false))
			case i == 1:
				// The wall's thickness on the x axis, where F = g(x).
				return math.Sqrt(tangleRoot(c, true)) - math.Sqrt(tangleRoot(c, false))
			case !above:
				// The hollow's diameter on the x axis.
				return 2 * math.Sqrt(tangleRoot(c, false))
			}
			return 0
		},
		floor: 0.5,
	},
	{
		preset:   "Two handles open at once",
		low:      0.01,
		high:     0.1,
		critical: []float64{0.0625},
		// The holes' centers: F = h² + z² with h = −1/4, ∇h = 0, and
		// F_xx = 2h·h_xx = −2, F_yy = 2h·h_yy = −2.
		points: [][]criticalPoint{{
			{Vec3{dtRoot, 0, 0}, [3]float64{-2, -2, 2}},
			{Vec3{-dtRoot, 0, 0}, [3]float64{-2, -2, 2}},
		}},
		sides:  [][]int{{-2}, {2}},
		levels: []float64{0.04, 0.09},
		// With u = x², v = y² and s = √c, |h| ≤ s: u is greatest on v = 0,
		// u² − u = s; v is greatest, (1 + 4s)/8, where the quadratic in u has
		// a double root u = (1 − 2v)/2; z² = c − h² is greatest on h = 0.
		extent: func(c float64) Vec3 {
			s := math.Sqrt(c)
			return Vec3{math.Sqrt((1 + math.Sqrt(1+4*s)) / 2), math.Sqrt((1 + 4*s) / 8), s}
		},
		extremes: func(c float64) []Vec3 {
			s := math.Sqrt(c)
			v := (1 + 4*s) / 8
			return []Vec3{{math.Sqrt((1 + math.Sqrt(1+4*s)) / 2), 0, 0}, {math.Sqrt((1 - 2*v) / 2), math.Sqrt(v), 0}, {1, 0, s}}
		},
		feature: func(_ int, above bool, c float64) float64 {
			if above {
				// Between the dimples over a hole's center, where h = −1/4.
				return 2 * math.Sqrt(c-0.0625)
			}
			// The hole h < −√c: across it on y = 0 (h = x⁴ − x²) and on
			// x = 1/√2 (h = y⁴ + 2y² − 1/4); the narrower.
			s := math.Sqrt(c)
			d := math.Sqrt(1 - 4*s)
			across := math.Sqrt((1+d)/2) - math.Sqrt((1-d)/2)
			along := 2 * math.Sqrt(math.Sqrt(1.25-s)-1)
			return math.Min(across, along)
		},
		floor: 0.02,
	},
}

func catalogField(t *testing.T, s catalogStory) (ImplicitRequest, func(Vec3) float64) {
	t.Helper()
	q := spatialPresets(t)[s.preset].Implicit
	if q.F == "" {
		t.Fatalf("no preset %q", s.preset)
	}
	f, _, err := expr.ParseSpatialField(q.F, q.A)
	if err != nil {
		t.Fatal(err)
	}
	return q, func(p Vec3) float64 { return f(p.X, p.Y, p.Z, 0) }
}

// The side of the critical levels a regular level lies on.
func (s catalogStory) side(c float64) int {
	i := 0
	for i < len(s.critical) && s.critical[i] < c {
		i++
	}
	return i
}

func (s catalogStory) shifted(q ImplicitRequest) Box {
	b := q.Box
	w := b.XMax - b.XMin
	dx, dy, dz := 0.0093*w, 0.0053*w, -0.0039*w
	return Box{b.XMin + dx, b.XMax + dx, b.YMin + dy, b.YMax + dy, b.ZMin + dz, b.ZMax + dz}
}

// The analysis's facts on F: each critical point has the critical value,
// a vanishing gradient and the derived Hessian; the gradient vanishes
// nowhere else on a dense sample of the covered levels; every half-width
// is reached on the level set, and the example's box holds them strictly,
// moved off its lattice too.
func TestEventCatalogAnalytic(t *testing.T) {
	const h = 1e-4
	axes := []Vec3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	for _, s := range catalogStories {
		q, F := catalogField(t, s)
		if !slices.IsSorted(s.critical) || len(s.sides) != len(s.critical)+1 || len(s.levels) != len(s.sides) {
			t.Fatalf("%s: malformed story", s.preset)
		}
		for i, c := range s.critical {
			for _, p := range s.points[i] {
				if v := F(p.at); math.Abs(v-c) > 1e-12 {
					t.Fatalf("%s: F%v = %v, want %v", s.preset, p.at, v, c)
				}
				for a, e := range axes {
					if g := (F(p.at.add(e.mul(h))) - F(p.at.sub(e.mul(h)))) / (2 * h); math.Abs(g) > 1e-6 {
						t.Fatalf("%s: ∂F/∂%c = %v at %v", s.preset, "xyz"[a], g, p.at)
					}
					for b, d := range axes {
						second := (F(p.at.add(e.add(d).mul(h))) - F(p.at.add(e.sub(d).mul(h))) - F(p.at.add(d.sub(e).mul(h))) + F(p.at.add(e.add(d).mul(-h)))) / (4 * h * h)
						want := 0.0
						if a == b {
							want = p.hessian[a]
						}
						if math.Abs(second-want) > 1e-4 {
							t.Fatalf("%s: H[%d][%d] = %v at %v, want %v", s.preset, a, b, second, p.at, want)
						}
					}
				}
			}
		}
		for i, c := range s.levels {
			if s.side(c) != i || c <= s.low || c >= s.high {
				t.Fatalf("%s: level %v is not on side %d within the story", s.preset, c, i)
			}
		}
		// Every sample whose gradient is small, at a level the story
		// covers, lies beside a listed critical point.
		e, b := s.extent(s.high), q.Box
		const n = 80
		sampled, small := 0, 0
		for i := 0; i <= n; i++ {
			for j := 0; j <= n; j++ {
				for k := 0; k <= n; k++ {
					p := Vec3{
						b.XMin + (b.XMax-b.XMin)*float64(i)/n + 1e-7,
						b.YMin + (b.YMax-b.YMin)*float64(j)/n + 2e-7,
						b.ZMin + (b.ZMax-b.ZMin)*float64(k)/n + 3e-7,
					}
					if v := F(p); v < s.low || v > s.high {
						continue
					}
					sampled++
					var g Vec3
					g.X = (F(p.add(axes[0].mul(h))) - F(p.sub(axes[0].mul(h)))) / (2 * h)
					g.Y = (F(p.add(axes[1].mul(h))) - F(p.sub(axes[1].mul(h)))) / (2 * h)
					g.Z = (F(p.add(axes[2].mul(h))) - F(p.sub(axes[2].mul(h)))) / (2 * h)
					if g.norm() >= s.floor {
						continue
					}
					small++
					near := false
					for _, at := range s.points {
						for _, c := range at {
							near = near || p.sub(c.at).norm() < 0.1
						}
					}
					if !near {
						t.Fatalf("%s: |∇F| = %v at %v, F = %v, beside no critical point", s.preset, g.norm(), p, F(p))
					}
				}
			}
		}
		// The sample reaches the critical points it looks for.
		if sampled < 10000 || small == 0 {
			t.Fatalf("%s: %d samples, %d with a small gradient", s.preset, sampled, small)
		}
		t.Logf("%s: %d samples, %d with |∇F| < %v", s.preset, sampled, small, s.floor)
		for _, c := range []float64{s.low, s.critical[0], s.high} {
			e := s.extent(c)
			for _, p := range s.extremes(c) {
				if math.Abs(F(p)-c) > 1e-12*math.Max(1, math.Abs(c)) {
					t.Fatalf("%s: F%v = %v at c = %v", s.preset, p, F(p), c)
				}
				if math.Abs(p.X) > e.X+1e-15 || math.Abs(p.Y) > e.Y+1e-15 || math.Abs(p.Z) > e.Z+1e-15 {
					t.Fatalf("%s: %v beyond the extent %v", s.preset, p, e)
				}
			}
		}
		for _, b := range []Box{q.Box, s.shifted(q)} {
			if !(b.XMin < -e.X && b.XMax > e.X && b.YMin < -e.Y && b.YMax > e.Y && b.ZMin < -e.Z && b.ZMax > e.Z) {
				t.Fatalf("%s: box %+v does not hold %v", s.preset, b, e)
			}
		}
	}
}

// At each side's regular level and at the ends of the covered levels, the
// mesh is the analysis's class on several grids, refined or not, in the
// example's box and in one moved off its lattice, never cut by the box.
func TestEventCatalogSides(t *testing.T) {
	for _, s := range catalogStories {
		base, _ := catalogField(t, s)
		levels := append([]float64{s.low, s.high}, s.levels...)
		for _, box := range []Box{base.Box, s.shifted(base)} {
			for _, cells := range []int{base.Cells - 8, base.Cells, base.Cells + 5} {
				for _, refine := range []int{0, 1} {
					for k, c := range levels {
						if refine > 0 && k < 2 {
							continue
						}
						q := base
						q.Box, q.Cells, q.Refine, q.Level = box, cells, refine, c
						m := levelSet(t, q)
						got, whole := eventPieces(m)
						if want := s.sides[s.side(c)]; !whole || !slices.Equal(got, want) || m.Singular != 0 || len(m.Cut) != 0 {
							t.Fatalf("%s at c = %v, %d cells, %d levels, box %v: pieces %v (whole %v), want %v; %d singular, %d cut",
								s.preset, c, cells, refine, box, got, whole, want, m.Singular, len(m.Cut)/2)
						}
					}
				}
			}
		}
	}
}

// Narrowing toward each event narrows the feature that changes there. Off
// the lattice, the class holds wherever that feature spans at least two
// cells; nearer the event a grid can misread it, which is logged, not
// asserted.
func TestEventCatalogResolution(t *testing.T) {
	for _, s := range catalogStories {
		base, _ := catalogField(t, s)
		box := s.shifted(base)
		asserted := 0
		// The example's grid, and one half again as fine, which resolves
		// steps nearer each event.
		for _, cells := range []int{base.Cells, base.Cells * 3 / 2} {
			h := (box.XMax - box.XMin) / float64(cells)
			for i, cs := range s.critical {
				// Steps toward the event, each a share of the distance to the
				// neighboring events or the covered range.
				lo, hi := s.low, s.high
				if i > 0 {
					lo = s.critical[i-1]
				}
				if i < len(s.critical)-1 {
					hi = s.critical[i+1]
				}
				for _, share := range []float64{0.4, 0.1, 0.02, 0.004} {
					for _, above := range []bool{false, true} {
						c := cs - share*(cs-lo)
						if above {
							c = cs + share*(hi-cs)
						}
						w := s.feature(i, above, c)
						if w == 0 {
							continue
						}
						q := base
						q.Box, q.Cells, q.Level = box, cells, c
						var m *ImplicitResult
						if w >= 2*h {
							m = levelSet(t, q)
						} else {
							m = eventMesh(t, q)
						}
						got, whole := eventPieces(m)
						want := s.sides[s.side(c)]
						if w >= 2*h {
							asserted++
							if !whole || !slices.Equal(got, want) {
								t.Fatalf("%s at c = %v, %d cells: feature %.3g of cell %.3g, pieces %v (whole %v), want %v",
									s.preset, c, cells, w, h, got, whole, want)
							}
						} else if !slices.Equal(got, want) {
							t.Logf("%s at c = %v, %d cells: feature %.3g, %.2g cells, reads %v", s.preset, c, cells, w, w/h, got)
						}
					}
				}
			}
		}
		// Each event offers 16 cases, two grids by four steps on each side;
		// the nearest steps are under a cell wide.
		if asserted < 6*len(s.critical) {
			t.Fatalf("%s: only %d resolved cases asserted", s.preset, asserted)
		}
	}
}

// Each feature's width shrinks to zero at its event, and is an actual
// width: its ends lie on the level set.
func TestEventCatalogFeatures(t *testing.T) {
	for _, s := range catalogStories {
		_, F := catalogField(t, s)
		for i, cs := range s.critical {
			for _, above := range []bool{false, true} {
				previous := math.Inf(1)
				for _, d := range []float64{1e-1, 1e-2, 1e-4, 1e-8} {
					span := math.Min(1, math.Abs(cs)+0.1) * d
					if s.preset == "Two handles open at once" {
						span = 0.05 * d
					}
					c := cs - span
					if above {
						c = cs + span
					}
					w := s.feature(i, above, c)
					if w == 0 {
						break
					}
					if !(w < previous) {
						t.Fatalf("%s event %d (above %v): width %v at c = %v not below %v", s.preset, i, above, w, c, previous)
					}
					previous = w
				}
				if previous != math.Inf(1) && previous > 1e-3 {
					t.Fatalf("%s event %d (above %v): width %v beside the event", s.preset, i, above, previous)
				}
			}
		}
		// Spot check: the tanglecube's gap ends lie on F = c.
		if s.preset == "The tanglecube's three events" {
			c := -14.0
			x := s.feature(0, false, c) / 2
			if v := F(Vec3{x, tangleSaddle, tangleSaddle}); math.Abs(v-c) > 1e-12 {
				t.Fatalf("the gap's end: F = %v at c = %v", v, c)
			}
		}
	}
}

// At each critical level the surface is singular and no mesh certifies
// it. The mesh is closed and never cut; it either marks a singular vertex
// or reads as one of the neighboring sides.
func TestEventCatalogSingular(t *testing.T) {
	for _, s := range catalogStories {
		base, _ := catalogField(t, s)
		for i, c := range s.critical {
			for _, box := range []Box{base.Box, s.shifted(base)} {
				for _, cells := range []int{base.Cells - 8, base.Cells, base.Cells + 1} {
					q := base
					q.Box, q.Cells, q.Level = box, cells, c
					m := eventMesh(t, q)
					got, _ := eventPieces(m)
					if len(m.Cut) != 0 || len(m.Open) != 0 || !closed(m) {
						t.Fatalf("%s at c = %v, %d cells: %d cut, %d open", s.preset, c, cells, len(m.Cut)/2, len(m.Open)/2)
					}
					neighbor := slices.Equal(got, s.sides[i]) || slices.Equal(got, s.sides[i+1])
					if m.Singular == 0 && m.Cones == 0 && !neighbor {
						t.Fatalf("%s at c = %v, %d cells, box %v: %v with no singular vertex", s.preset, c, cells, box, got)
					}
					t.Logf("%s at c = %v, %d cells: %v, %d singular, %d cones", s.preset, c, cells, got, m.Singular, m.Cones)
				}
			}
		}
	}
}

// A box that does not hold the surface cuts it open, and it is not read as
// a closed class.
func TestEventCatalogCut(t *testing.T) {
	for _, s := range catalogStories {
		q, _ := catalogField(t, s)
		e := s.extent(s.levels[len(s.levels)-1])
		q.Box = Box{-0.9 * e.X, 0.9 * e.X, -0.9 * e.Y, 0.9 * e.Y, -0.9 * e.Z, 0.9 * e.Z}
		q.Level = s.levels[len(s.levels)-1]
		m := eventMesh(t, q)
		if _, whole := eventPieces(m); whole || len(m.Cut) == 0 {
			t.Fatalf("%s clipped: %d cut edges", s.preset, len(m.Cut)/2)
		}
	}
}
