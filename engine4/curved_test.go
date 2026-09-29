package engine4

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func curvedRequest(object string) Request {
	return Request{Object: object, Mode: "section", Radius: 2, Tube: .6, Count: 1, Curves: 5, Samples: 64}
}
func TestCurvedSections(t *testing.T) {
	for _, object := range []string{"ball", "tube"} {
		q := curvedRequest(object)
		support := q.Radius
		if object == "tube" {
			support = q.Tube
		}
		for _, scale := range []float64{.002, 1, 40} {
			q.Radius = 2 * scale
			q.Tube = .6 * scale
			support = 2 * scale
			if object == "tube" {
				support = q.Tube
			}
			for _, fraction := range []float64{0, .6, 1, 1.025, -.6, -1} {
				q.Slice = fraction * support
				r, err := Compute(q)
				if err != nil {
					t.Fatal(err)
				}
				s := r.Sections[0]
				switch {
				case math.Abs(fraction) > 1:
					if s.Dimension != -1 || len(r.Paths) != 0 || len(r.Points) != 0 {
						t.Fatal("outside section is not empty", s)
					}
				case math.Abs(fraction) == 1:
					if object == "ball" {
						if s.Kind != "point" || s.Dimension != 0 || len(r.Points) != 1 || len(r.Paths) != 0 {
							t.Fatal("ball tangency", s)
						}
					} else {
						if s.Kind != "core-circle" || s.Dimension != 1 || len(r.Paths) != 1 {
							t.Fatal("tube tangency", s)
						}
					}
				default:
					want := support * math.Sqrt(1-fraction*fraction)
					if s.Dimension != 3 || math.Abs(s.Radius-want) > 1e-12*scale {
						t.Fatal("section radius", s, want)
					}
				}
				points := 0
				for _, path := range r.Paths {
					if path.SectionID != s.ID || path.Source == "" || path.Role != "section" || path.Branch != "0" {
						t.Fatal("missing identity")
					}
					if path.Points[0] != path.Points[len(path.Points)-1] {
						t.Fatal("circle not exactly closed")
					}
					for _, p := range path.Points {
						residual := dot(p, p) + q.Slice*q.Slice - q.Radius*q.Radius
						if object == "tube" {
							d := math.Hypot(p[0], p[1]) - q.Radius
							residual = d*d + p[2]*p[2] + q.Slice*q.Slice - q.Tube*q.Tube
						}
						if math.Abs(residual) > 1e-11*scale*scale {
							t.Fatalf("%s section residual %g", object, residual)
						}
						if math.Sqrt(dot(p, p)) > r.Radius*(1+1e-12) {
							t.Fatal("framing failed")
						}
					}
					points += len(path.Points)
				}
				if r.EmittedPoints != points+len(r.Points) {
					t.Fatal("wrong work accounting")
				}
				// Smooth sections do not invent polyhedral counts.
				bytes, _ := json.Marshal(s)
				var fields map[string]any
				_ = json.Unmarshal(bytes, &fields)
				for _, key := range []string{"vertices", "edges", "faces"} {
					if _, ok := fields[key]; ok {
						t.Fatal("fake polyhedral counts", string(bytes))
					}
				}
			}
		}
	}
}
func TestOppositeSectionIdentities(t *testing.T) {
	for _, object := range []string{"ball", "tube"} {
		q := curvedRequest(object)
		q.Count = 2
		q.Spread = .8
		r, err := Compute(q)
		if err != nil {
			t.Fatal(err)
		}
		if r.Sections[0].Level != -.4 || r.Sections[1].Level != .4 {
			t.Fatal("family spread was not applied", r.Sections)
		}
		n := len(r.Paths) / 2
		if r.Sections[0].ID == r.Sections[1].ID || r.Sections[0].Level != -r.Sections[1].Level {
			t.Fatal("levels lost")
		}
		for i := 0; i < n; i++ {
			a, b := r.Paths[i], r.Paths[i+n]
			if a.SectionID == b.SectionID || a.Source != b.Source {
				t.Fatal("identities lost")
			}
			for j := range a.Points {
				if a.Points[j] != b.Points[j] {
					t.Fatal("opposite outlines differ")
				}
			}
		}
	}
}
func TestCurvedToleranceAndInvalid(t *testing.T) {
	for _, object := range []string{"ball", "tube"} {
		q := curvedRequest(object)
		support := q.Radius
		if object == "tube" {
			support = q.Tube
		}
		tol := 1e-12 + 1e-10*support
		for _, sign := range []float64{-1, 1} {
			for _, d := range []float64{-.5 * tol, .5 * tol} {
				q.Slice = sign * (support + d)
				r, err := Compute(q)
				if err != nil || r.Sections[0].Kind == "solid" || r.Sections[0].Kind == "empty" {
					t.Fatal("tolerance band", r, err)
				}
			}
			q.Slice = sign * (support + 2*tol)
			r, _ := Compute(q)
			if r.Sections[0].Kind != "empty" {
				t.Fatal("outside threshold")
			}
			q.Slice = sign * (support - 2*tol)
			r, _ = Compute(q)
			if r.Sections[0].Kind != "solid" {
				t.Fatal("inside threshold")
			}
		}
	}
	for _, change := range []func(*Request){
		func(q *Request) { q.Mode = "perspective" }, func(q *Request) { q.Angles[3] = .1 }, func(q *Request) { q.Radius = 0 }, func(q *Request) { q.Radius = math.NaN() }, func(q *Request) { q.Tube = q.Radius }, func(q *Request) { q.Tube = 0 }, func(q *Request) { q.Count = 26 }, func(q *Request) { q.Curves = 2 }, func(q *Request) { q.Samples = 257 }, func(q *Request) { q.Spread = math.Inf(1) }, func(q *Request) { q.Slice = math.NaN() }, func(q *Request) { q.Count = 25; q.Curves = 16 }, func(q *Request) { q.Count = 8; q.Curves = 16; q.Samples = 256 },
	} {
		q := curvedRequest("tube")
		change(&q)
		if _, err := Compute(q); err == nil {
			t.Fatal("invalid request accepted", q)
		}
	}
}
func TestCircleConvergence(t *testing.T) {
	for _, object := range []string{"ball", "tube"} {
		sources := []string{"meridian/0", "latitude/1"}
		if object == "tube" {
			sources = []string{"fixed-u/0", "fixed-v/1"}
		}
		for _, source := range sources {
			t.Run(object+"/"+source, func(t *testing.T) {
				previousLength, previousSagitta := 0., 0.
				for _, n := range []int{16, 32, 64, 128} {
					q := curvedRequest(object)
					q.Samples = n
					q.Slice = .3
					result, err := Compute(q)
					if err != nil {
						t.Fatal(err)
					}
					var path Path
					for _, candidate := range result.Paths {
						if candidate.Source == object+"/"+source {
							path = candidate
							break
						}
					}
					if len(path.Points) != n+1 {
						t.Fatal("missing circle", source)
					}
					support := q.Radius
					if object == "tube" {
						support = q.Tube
					}
					rho := math.Sqrt(support*support - q.Slice*q.Slice)
					radius, center := rho, Vec3{}
					switch source {
					case "latitude/1":
						angle := math.Pi / float64(q.Curves)
						radius, center[2] = rho*math.Sin(angle), rho*math.Cos(angle)
					case "fixed-u/0":
						center[0] = q.Radius
					case "fixed-v/1":
						angle := 2 * math.Pi / float64(q.Curves)
						radius, center[2] = q.Radius+rho*math.Cos(angle), rho*math.Sin(angle)
					}
					length, sagitta := 0., 0.
					for i := 1; i < len(path.Points); i++ {
						delta := sub(path.Points[i], path.Points[i-1])
						length += math.Sqrt(dot(delta, delta))
						midpoint := Vec3{}
						for k := range midpoint {
							midpoint[k] = (path.Points[i][k] + path.Points[i-1][k]) / 2
						}
						radial := sub(midpoint, center)
						sagitta = math.Max(sagitta, radius-math.Sqrt(dot(radial, radial)))
					}
					want := radius * (1 - math.Cos(math.Pi/float64(n)))
					if math.Abs(sagitta-want) > 1e-12*radius {
						t.Fatal("incorrect sagitta", sagitta, want)
					}
					lengthError := 2*math.Pi*radius - length
					if lengthError <= 0 || sagitta <= 0 {
						t.Fatal("bad circle approximation")
					}
					if previousLength > 0 {
						for _, ratio := range []float64{previousLength / lengthError, previousSagitta / sagitta} {
							if ratio < 3.9 || ratio > 4.1 {
								t.Fatal("expected second-order convergence", ratio)
							}
						}
					}
					previousLength, previousSagitta = lengthError, sagitta
				}
			})
		}
	}
}

// Midpoint quadrature uses the engine's section radii, not a second radius formula.
func TestIntegratedSectionVolumes(t *testing.T) {
	const n = 10000
	for _, object := range []string{"ball", "tube"} {
		q := curvedRequest(object)
		q.Count, q.Curves, q.Samples = 25, 3, 8
		support := q.Radius
		if object == "tube" {
			support = q.Tube
		}
		step := 2 * support / n
		q.Spread = float64(q.Count-1) * step
		volume := 0.
		for i := 0; i < n; i += q.Count {
			q.Slice = -support + (float64(i)+float64(q.Count)/2)*step
			result, err := Compute(q)
			if err != nil {
				t.Fatal(err)
			}
			for _, section := range result.Sections {
				rho := section.Radius
				v := 4 * math.Pi * math.Pow(rho, 3) / 3
				if object == "tube" {
					v = 2 * math.Pi * math.Pi * q.Radius * rho * rho
				}
				volume += v * step
			}
		}
		want := math.Pi * math.Pi * math.Pow(q.Radius, 4) / 2
		if object == "tube" {
			want = 8 * math.Pi * math.Pi * q.Radius * math.Pow(q.Tube, 3) / 3
		}
		if math.Abs(volume/want-1) > 2e-8 {
			t.Fatal("integrated engine section volume", volume, want)
		}
	}
}
func BenchmarkCurvedLargest(b *testing.B) {
	q := curvedRequest("tube")
	q.Count = 16
	q.Curves = 16
	q.Samples = 127
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}

func TestCurvedExactBudgetBoundary(t *testing.T) {
	q := curvedRequest("tube")
	q.Count = 16
	q.Curves = 16
	q.Samples = 127
	r, err := Compute(q)
	if err != nil {
		t.Fatal("exact ceilings must be accepted", err)
	}
	if len(r.Paths) != 512 || r.EmittedPoints != 65536 || r.Evaluations != 65024 {
		t.Fatal("wrong total work", len(r.Paths), r.EmittedPoints, r.Evaluations)
	}
	q.Samples++
	if _, err := Compute(q); err == nil {
		t.Fatal("one extra subdivision must exceed the shared point budget")
	}
	q.Samples = 8
	q.Count++
	if _, err := Compute(q); err == nil {
		t.Fatal("one extra section must exceed the shared curve budget")
	}
}

func TestCurvedFieldErrorsAndInactiveSpread(t *testing.T) {
	t.Run("inactive spread", func(t *testing.T) {
		q := curvedRequest("ball")
		q.Spread = 100
		if _, err := Compute(q); err != nil {
			t.Fatal("single section must ignore spread", err)
		}
	})
	t.Run("spread error", func(t *testing.T) {
		q := curvedRequest("ball")
		q.Count = 2
		q.Spread = 100
		if _, err := Compute(q); err == nil || !strings.HasPrefix(err.Error(), "section spread") {
			t.Fatal("spread-specific error", err)
		}
	})
	t.Run("slice error", func(t *testing.T) {
		q := curvedRequest("ball")
		q.Slice = 100
		if _, err := Compute(q); err == nil || !strings.HasPrefix(err.Error(), "slice offset") || strings.Contains(err.Error(), "spread") {
			t.Fatal("slice-specific error", err)
		}
	})
}
