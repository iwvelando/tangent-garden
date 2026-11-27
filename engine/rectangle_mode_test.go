package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"testing"
)

func rectangleRequest(t *testing.T, aspect, phase, level float64, cells int) Request {
	t.Helper()
	// The request goes through the same JSON fields as the WASM entry point.
	var q Request
	raw := fmt.Sprintf(`{"kind":"evolute","samples":300,"lines":64,"curve":{"format":"implicit","a":%.17g,"implicit":{"f":"invalid expression draft","cells":%d,"level":%.17g,"rectangle":{"aspect":%.17g}}}}`, phase, cells, level, aspect)
	if err := json.Unmarshal([]byte(raw), &q); err != nil {
		t.Fatal(err)
	}
	return q
}

func independentRectangle(p Vec, w, a float64) float64 {
	mode := func(m, n float64) float64 {
		return math.Sin(m*math.Pi*p.X/w) * math.Sin(n*math.Pi*p.Y)
	}
	return math.Cos(a)*mode(2, 3) + math.Sin(a)*mode(3, 2)
}

func TestRectangleModeBoundaryAndEigenvalues(t *testing.T) {
	for _, width := range []float64{.5, 1, 1.7, 2} {
		t.Run(fmt.Sprint(width), func(t *testing.T) {
			q := rectangleRequest(t, width, .37, 0, 97)
			got := contours(t, q)
			if got.Window != (Window{XMax: width, YMax: 1}) || !got.UsesA || got.Nonfinite != 0 || len(got.Discontinuities) != 0 || len(got.Curve.Contours) == 0 {
				t.Fatalf("invalid contour result over %v: grid %d×%d, %d undefined points, %d paths", got.Window, got.Columns, got.Rows, got.Nonfinite, len(got.Curve.Contours))
			}
			if math.Abs(width*float64(got.Rows)-float64(got.Columns)) > 1 {
				t.Fatalf("grid cells are not approximately square: %d×%d", got.Columns, got.Rows)
			}
			raw, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			var metadata struct {
				Rectangle struct {
					Aspect     float64
					Components []struct {
						M, N                    int
						Eigenvalue, Coefficient float64
					}
				}
			}
			if err := json.Unmarshal(raw, &metadata); err != nil {
				t.Fatal(err)
			}
			if metadata.Rectangle.Aspect != width || len(metadata.Rectangle.Components) != 2 {
				t.Fatalf("missing rectangle provenance: %+v", metadata)
			}
			for i, a := range []float64{0, math.Pi / 2} {
				m, n := float64(2+i), float64(3-i)
				component := metadata.Rectangle.Components[i]
				lambda := (m*m/(width*width) + n*n) * math.Pi * math.Pi
				if float64(component.M) != m || float64(component.N) != n || math.Abs(component.Eigenvalue-lambda) > 1e-12 || math.Abs(component.Coefficient-math.Cos(.37-a)) > 1e-14 {
					t.Fatalf("mode %d: %+v, eigenvalue want %g", i, component, lambda)
				}
				eval, err := newSheet(rectangleRequest(t, width, a, 0, 40).Curve.Implicit, a)
				if err != nil {
					t.Fatal(err)
				}
				for _, p := range []Vec{{0, .4}, {width, .4}, {width * .6, 0}, {width * .6, 1}} {
					if v := eval.at(p); v != 0 {
						t.Fatalf("not a zero boundary at %v: %g", p, v)
					}
				}
				p := Vec{width * .21, .14}
				center := eval.at(p)
				if math.Abs(center-independentRectangle(p, width, a)) > 2e-14 {
					t.Fatalf("wrong pure mode at %v: %g", p, center)
				}
				h := 1e-4
				laplacian := (eval.at(p.Add(Vec{h, 0})) + eval.at(p.Sub(Vec{h, 0})) + eval.at(p.Add(Vec{0, h})) + eval.at(p.Sub(Vec{0, h})) - 4*center) / (h * h)
				if math.Abs(laplacian+lambda*center) > 1e-4 {
					t.Fatalf("wrong Laplacian at %v: %g, want %g", p, laplacian, -lambda*center)
				}
			}
			residual(t, got.Curve, func(p Vec) float64 { return independentRectangle(p, width, q.Curve.A) }, 2e-13)
			if len(got.Normals) < 32 {
				t.Fatalf("lost contour normals: %d", len(got.Normals))
			}
			for _, normal := range got.Normals {
				p := normal.Point
				h := 1e-6
				eval := func(p Vec) float64 { return independentRectangle(p, width, q.Curve.A) }
				dx := (eval(p.Add(Vec{h, 0})) - eval(p.Sub(Vec{h, 0}))) / (2 * h)
				dy := (eval(p.Add(Vec{0, h})) - eval(p.Sub(Vec{0, h}))) / (2 * h)
				if math.Abs(eval(p)) > 2e-13 || normal.Gradient.Sub(Vec{dx, dy}).Norm() > 1e-7 {
					t.Fatalf("wrong normal for the original field at %v: %v", p, normal.Gradient)
				}
			}
		})
	}
}

func TestRectangleModeSquareCompatibility(t *testing.T) {
	const squareField = "cos(a)*sin(2*pi*x)*sin(3*pi*y)+sin(a)*sin(3*pi*x)*sin(2*pi*y)"
	for _, a := range []float64{.31, 0, math.Pi / 2, math.Pi, -2.8, .31 + 2*math.Pi} {
		q := rectangleRequest(t, 1, a, .2, 121)
		ref, err := newSheet(Implicit{F: squareField, Window: Window{XMax: 1, YMax: 1}, Cells: 121}, a)
		if err != nil {
			t.Fatal(err)
		}
		got, err := newSheet(q.Curve.Implicit, a)
		if err != nil {
			t.Fatal(err)
		}
		for i := 1; i < 20; i++ {
			p := Vec{float64(i) / 20, float64((i*7)%20) / 20}
			if diff := math.Abs(ref.at(p) - got.at(p)); diff > 3e-14 {
				t.Fatalf("square compatibility at a=%g, %v: %g", a, p, diff)
			}
		}
		q.Curve.Implicit.Family = Levels{Enabled: true, From: -.2, To: .2, Count: 3}
		r := contours(t, q)
		if len(r.Family) != 3 || len(r.Family[1].Contours) == 0 {
			t.Fatalf("missing zero level within a family at a=%g", a)
		}
		for _, set := range append(r.Family, r.Curve) {
			residual(t, set, func(p Vec) float64 { return ref.at(p) }, 2e-13)
			for _, c := range set.Contours {
				if set.Level != 0 && !c.Closed {
					t.Fatalf("nonzero level meets the boundary at a=%g: %g", a, set.Level)
				}
			}
		}
	}
}

func TestRectangleModeCrossingConvergence(t *testing.T) {
	const width = 1.5
	var last float64
	for i, cells := range []int{91, 181, 361} {
		q := rectangleRequest(t, width, 0, 0, cells)
		got := contours(t, q)
		s, err := newSheet(q.Curve.Implicit, 0)
		if err != nil {
			t.Fatal(err)
		}
		s.selectRectangleLevel(0)
		unrefined, ok := s.level(0)
		if !ok {
			t.Fatal("the unrefined trace exceeded its budget")
		}
		var extent [6]bool
		var worst float64
		for _, c := range got.Curve.Contours {
			if c.Closed {
				t.Fatal("a pure (2,3) mode has no closed nodal component")
			}

			for _, end := range []Vec{c.Points[0], c.Points[len(c.Points)-1]} {
				ends := [...]Vec{{0, 1.0 / 3}, {0, 2.0 / 3}, {width, 1.0 / 3}, {width, 2.0 / 3}, {width / 2, 0}, {width / 2, 1}}
				for i, want := range ends {
					extent[i] = extent[i] || end.Sub(want).Norm() < 1e-13
				}
			}
		}
		for _, c := range unrefined.Contours {
			for _, chord := range contourChords(c) {
				mid := chord[0].Add(chord[1]).Mul(.5)
				dist := math.Min(math.Abs(mid.X-width/2), math.Min(math.Abs(mid.Y-1.0/3), math.Abs(mid.Y-2.0/3)))
				worst = math.Max(worst, dist)
			}
		}
		if extent != [6]bool{true, true, true, true, true, true} {
			t.Fatalf("%d cells: missing nodal ends %v", cells, extent)
		}
		if worst > width/float64(cells) || (i > 0 && worst > .72*last+1e-14) {
			t.Fatalf("%d cells: crossing chord error %g following %g", cells, worst, last)
		}
		last = worst
	}
}

func TestRectangleModeSharesLevelBudgets(t *testing.T) {
	q := rectangleRequest(t, 1.6, .37, 0, 128)
	q.Curve.Implicit.Family = Levels{Enabled: true, From: -.3, To: .3, Count: 5}
	s, err := newSheet(q.Curve.Implicit, q.Curve.A)
	if err != nil {
		t.Fatal(err)
	}
	// Either grid fits alone. The call must refuse a later level when
	// their combined work exhausts the single crossing allowance.
	limit := maxContourCrossings
	maxContourCrossings = 950
	t.Cleanup(func() { maxContourCrossings = limit })
	got, warnings, err := q.Curve.Implicit.traceOn(s, q.Curve.A, q.Lines)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Curve.Contours) == 0 || len(got.Family) == 0 || len(got.Family) >= q.Curve.Implicit.Family.Count || len(warnings) == 0 {
		t.Fatalf("want base and a partial family with a budget warning, got %d paths, %d levels and %v", len(got.Curve.Contours), len(got.Family), warnings)
	}
	if s.crossings > maxContourCrossings || s.points > maxContourPoints {
		t.Fatalf("exceeded contour budget: %d crossings, %d points", s.crossings, s.points)
	}
	grid := (got.Columns + 1) * (got.Rows + 1)
	if len(s.values) != grid || len(s.otherRectangleValues) != grid {
		t.Fatalf("want two cached %d-point grids, got %d and %d", grid, len(s.values), len(s.otherRectangleValues))
	}
}
