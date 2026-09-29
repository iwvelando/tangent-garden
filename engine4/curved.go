package engine4

import (
	"fmt"
	"math"
)

// Curved sections are axis aligned. No rotated-ring approximation is allowed.
// Counts share a budget across the entire family; reject before allocating.
const maxCurves = 512
const maxPoints = 65536

func curved(q Request, r Result) (Result, error) {
	if q.Mode != "section" {
		return r, fmt.Errorf("curved solids support axis-aligned sections only")
	}
	for _, a := range q.Angles {
		if !finite(a) || a != 0 {
			return r, fmt.Errorf("curved sections require zero 4D rotation angles; orbit the 3D view instead")
		}
	}
	if !finite(q.Radius) || q.Radius < .001 || q.Radius > 100 {
		return r, fmt.Errorf("object radius must be between 0.001 and 100")
	}
	support := q.Radius
	r.Radius = q.Radius
	if q.Object == "tube" {
		if !finite(q.Tube) || q.Tube < .001 || q.Tube >= q.Radius {
			return r, fmt.Errorf("tube radius must be at least 0.001 and smaller than the core radius")
		}
		support, r.Radius = q.Tube, q.Radius+q.Tube
	}
	if !finite(q.Slice) || math.Abs(q.Slice) > 4*support {
		return r, fmt.Errorf("slice offset must be within four times the support radius")
	}
	if !finite(q.Spread) || (q.Count > 1 && (q.Spread < 0 || q.Spread > 4*support)) {
		return r, fmt.Errorf("section spread must be finite and, for a family, within zero to four times the support radius")
	}
	if q.Count < 1 || q.Count > 25 {
		return r, fmt.Errorf("use 1–25 sections")
	}
	if q.Curves < 3 || q.Curves > 16 {
		return r, fmt.Errorf("use 3–16 representative curves per direction")
	}
	if q.Samples < 8 || q.Samples > 256 {
		return r, fmt.Errorf("use 8–256 curve samples")
	}
	// Two circle directions for the tube; meridians and interior latitudes for the ball.
	perSection := 2 * q.Curves
	if q.Object == "ball" {
		perSection--
	}
	curves := q.Count * perSection
	points := curves * (q.Samples + 1)
	if curves > maxCurves || points > maxPoints {
		return r, fmt.Errorf("section family exceeds budget: at most 512 curves and 65536 points; reduce sections, curves or samples")
	}
	// Absolute plus relative tolerance on h, not on squared radius.
	tol := 1e-12 + 1e-10*support
	for i := 0; i < q.Count; i++ {
		h := q.Slice
		if q.Count > 1 {
			h += q.Spread * (float64(i)/float64(q.Count-1) - .5)
		}
		id := fmt.Sprintf("section/%d", i)
		s := Section{ID: id, Level: h, Dimension: -1, Kind: "empty"}
		delta := support - math.Abs(h)
		if delta < -tol {
			r.Sections = append(r.Sections, s)
			continue
		}
		rho := 0.
		if delta > tol {
			rho = math.Sqrt(delta * (support + math.Abs(h)))
			s.Dimension, s.Kind = 3, "solid"
		}
		s.Radius = rho
		add := func(source string, point func(float64) Vec3) {
			ps := make([]Vec3, q.Samples+1)
			for j := 0; j < q.Samples; j++ {
				ps[j] = point(2 * math.Pi * float64(j) / float64(q.Samples))
				r.Evaluations++
			}
			ps[q.Samples] = ps[0] // Exact closure, independently of sin(2π) rounding.
			r.Paths = append(r.Paths, Path{Points: ps, Family: i % 4, Source: q.Object + "/" + source, SectionID: id, Branch: "0", Role: "section"})
		}
		if rho == 0 {
			if q.Object == "ball" {
				s.Dimension, s.Kind = 0, "point"
				r.Points = append(r.Points, Vec3{})
			} else {
				s.Dimension, s.Kind = 1, "core-circle"
				add("core", func(t float64) Vec3 { return Vec3{q.Radius * math.Cos(t), q.Radius * math.Sin(t), 0} })
			}
		} else if q.Object == "ball" {
			for k := 0; k < q.Curves; k++ {
				a := math.Pi * float64(k) / float64(q.Curves)
				add(fmt.Sprintf("meridian/%d", k), func(t float64) Vec3 {
					return Vec3{rho * math.Cos(t) * math.Cos(a), rho * math.Cos(t) * math.Sin(a), rho * math.Sin(t)}
				})
			}
			for k := 1; k < q.Curves; k++ {
				a := math.Pi * float64(k) / float64(q.Curves)
				add(fmt.Sprintf("latitude/%d", k), func(t float64) Vec3 {
					return Vec3{rho * math.Sin(a) * math.Cos(t), rho * math.Sin(a) * math.Sin(t), rho * math.Cos(a)}
				})
			}
		} else {
			torus := func(u, v float64) Vec3 {
				d := q.Radius + rho*math.Cos(v)
				return Vec3{d * math.Cos(u), d * math.Sin(u), rho * math.Sin(v)}
			}
			for k := 0; k < q.Curves; k++ {
				a := 2 * math.Pi * float64(k) / float64(q.Curves)
				add(fmt.Sprintf("fixed-u/%d", k), func(t float64) Vec3 { return torus(a, t) })
				add(fmt.Sprintf("fixed-v/%d", k), func(t float64) Vec3 { return torus(t, a) })
			}
		}
		r.Sections = append(r.Sections, s)
	}
	return r, nil
}
