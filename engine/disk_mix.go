package engine

import "math"

// DiskMix is a superposition of two unit-peak Dirichlet modes on the same
// disk. Position is either a blend fraction or time in cycles of mode 1.
type DiskMix struct {
	Radius   float64 `json:"radius"`
	Motion   string  `json:"motion"`
	First    float64 `json:"first"`
	Second   float64 `json:"second"`
	Position float64 `json:"position"`
}

type DiskComponent struct {
	Order       int     `json:"order"`
	Ring        int     `json:"ring"`
	Zero        float64 `json:"zero"`
	Eigenvalue  float64 `json:"eigenvalue"`
	Coefficient float64 `json:"coefficient"`
}

type DiskMixResult struct {
	Radius     float64          `json:"radius"`
	Components [2]DiskComponent `json:"components"`
}

func (d DiskMix) validate() error {
	if !finite(d.Radius) || d.Radius < 1e-3 || d.Radius > 1e4 {
		return fieldErr("diskMix.radius", "the radius must be from 0.001 to 10,000")
	}
	if !bound(1)(d.First) {
		return fieldErr("diskMix.first", "amplitude A must be from −1 to 1")
	}
	if !bound(1)(d.Second) {
		return fieldErr("diskMix.second", "amplitude B must be from −1 to 1")
	}
	switch d.Motion {
	case "sweep":
		if !finite(d.Position) || d.Position < 0 || d.Position > 1 {
			return fieldErr("diskMix.position", "the blend fraction must be from 0 to 1")
		}
	case "oscillation":
		if !finite(d.Position) || d.Position < 0 || d.Position > 4 {
			return fieldErr("diskMix.position", "membrane time must be from 0 to 4 cycles of mode A")
		}
	default:
		return fieldErr("diskMix.motion", "choose a coefficient sweep or membrane oscillation")
	}
	return nil
}

type diskMixEvaluator struct {
	basis  [2]*diskEvaluator
	result DiskMixResult
}

func (d DiskMix) evaluator() *diskMixEvaluator {
	pair := [2]Disk{{Order: 3, Ring: 1, Radius: d.Radius}, {Order: 0, Ring: 2, Radius: d.Radius}}
	a, b := d.First*(1-d.Position), d.Second*d.Position
	if d.Motion == "oscillation" {
		ratio := besselZeros[pair[1].Order][pair[1].Ring-1] / besselZeros[pair[0].Order][pair[0].Ring-1]
		a, b = d.First*cosCycles(d.Position), d.Second*cosCycles(d.Position*ratio)
	}
	weights := [2]float64{a, b}
	e := &diskMixEvaluator{result: DiskMixResult{Radius: d.Radius}}
	for i, mode := range pair {
		basis := mode.evaluator(0)
		e.basis[i] = basis
		e.result.Components[i] = DiskComponent{mode.Order, mode.Ring, basis.j, basis.k * basis.k, weights[i]}
	}
	return e
}

func cosCycles(cycles float64) float64 {
	phase := math.Mod(cycles, 1)
	if phase == .25 || phase == .75 {
		return 0
	}
	return math.Cos(2 * math.Pi * phase)
}

func (e *diskMixEvaluator) flat() bool {
	return e.result.Components[0].Coefficient == 0 && e.result.Components[1].Coefficient == 0
}

// at takes the same weighted sum of values and gradients. Evaluate the
// value with the same arithmetic even when the caller requests a gradient.
//
//go:noinline
func (e *diskMixEvaluator) at(x, y float64, grad bool) (v, gx, gy float64) {
	r := math.Sqrt(x*x + y*y)
	R := e.result.Radius
	if !(r <= R*(1+1e-12)) {
		return math.NaN(), math.NaN(), math.NaN()
	}
	for i, mode := range e.basis {
		w := e.result.Components[i].Coefficient
		if w != 0 {
			u, ux, uy := mode.at(x, y, grad)
			v, gx, gy = v+w*u, gx+w*ux, gy+w*uy
		}
	}
	if r == R {
		v = 0
	}
	return v, gx, gy
}
