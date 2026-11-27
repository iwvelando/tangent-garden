package engine

import "math"

// Rectangle mixes the (2,3) and (3,2) Dirichlet modes on [0, Aspect] × [0, 1].
type Rectangle struct {
	Aspect float64 `json:"aspect"`
}

type RectangleComponent struct {
	M           int     `json:"m"`
	N           int     `json:"n"`
	Eigenvalue  float64 `json:"eigenvalue"`
	Coefficient float64 `json:"coefficient"`
}

type RectangleResult struct {
	Aspect     float64               `json:"aspect"`
	Components [2]RectangleComponent `json:"components"`
}

func (r Rectangle) validate() error {
	if !finite(r.Aspect) || r.Aspect < .5 || r.Aspect > 2 {
		return fieldErr("rectangle.aspect", "the aspect ratio must be from 0.5 to 2")
	}
	return nil
}

type rectangleEvaluator struct {
	result RectangleResult
}

func (r Rectangle) evaluator(a float64) *rectangleEvaluator {
	phase := math.Remainder(a, 2*math.Pi)
	b, c := math.Sincos(phase)
	// The pure modes have exact zero weights at the cardinal phases.
	switch phase {
	case 0, math.Pi, -math.Pi:
		b = 0
	case math.Pi / 2, -math.Pi / 2:
		c = 0
	}
	mode := func(m, n int, weight float64) RectangleComponent {
		x, y := float64(m)/r.Aspect, float64(n)
		return RectangleComponent{m, n, math.Pi * math.Pi * (x*x + y*y), weight}
	}
	return &rectangleEvaluator{RectangleResult{r.Aspect, [2]RectangleComponent{mode(2, 3, c), mode(3, 2, b)}}}
}

func rectangleSincos(t float64) (s, c float64) {
	if t == .5 {
		return 1, 0
	}
	// Reflect back from the far edge so its sine is exactly zero too.
	if t > .5 {
		s, c = math.Sincos(math.Pi * (1 - t))
		return s, -c
	}
	return math.Sincos(math.Pi * t)
}

// at uses sin(2t) = 2 cos(t) sin(t) and sin(3t) = (4 cos²(t) − 1) sin(t).
// For the nodal trace, factor out the positive interior term sin(πx/W)
// sin(πy). Its zero edges are drawn separately. The remaining field
// continues the interior nodal lines to the edges of the sampling grid.
func (r *rectangleEvaluator) at(x, y float64, nodal bool) (float64, Vec) {
	width := r.result.Aspect
	sx, cx := rectangleSincos(x / width)
	sy, cy := rectangleSincos(y)
	a, b := r.result.Components[0].Coefficient, r.result.Components[1].Coefficient
	x2, y2 := 2*cx, 2*cy
	x3, y3 := x2*x2-1, y2*y2-1
	q := a*x2*y3 + b*x3*y2
	// Derivatives with respect to the two angles.
	qx := -2 * sx * (a*y3 + 2*b*x2*y2)
	qy := -2 * sy * (2*a*x2*y2 + b*x3)
	if nodal {
		return q, Vec{qx * (math.Pi / width), qy * math.Pi}
	}
	return sx * sy * q, Vec{
		(cx*q + sx*qx) * sy * (math.Pi / width),
		sx * (cy*q + sy*qy) * math.Pi,
	}
}

func (s *sheet) selectRectangleLevel(c float64) {
	if s.rectangle == nil {
		return
	}
	if (c == 0) != s.rectangleNodal {
		s.rectangleNodal = c == 0
		s.values, s.otherRectangleValues = s.otherRectangleValues, s.values
		s.setRectangleField()
	}
	if s.values == nil {
		s.sampleGrid()
	}
}

func (s *sheet) setRectangleField() {
	nodal := s.rectangleNodal
	s.fg = func(x, y float64) (float64, Vec) { return s.rectangle.at(x, y, nodal) }
	s.f = func(x, y float64) float64 {
		v, _ := s.rectangle.at(x, y, nodal)
		return v
	}
	s.lastAt = Vec{X: math.NaN()}
}
