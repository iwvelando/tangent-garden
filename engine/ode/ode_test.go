package ode

import (
	"math"
	"testing"
)

// A rotation in the plane with a rising third coordinate: y(t) =
// (cos t, sin t, t) from (1, 0, 0). The stepper is dimension-free.
func spiral(_ float64, y, out []float64) { out[0], out[1], out[2] = -y[1], y[0], 1 }

func TestStepOrder(t *testing.T) {
	// One fifth-order step has local error O(h⁶); halving h divides it by
	// about 64. The embedded estimate is the fourth-order error, O(h⁵).
	errs, estimates := []float64{}, []float64{}
	for _, h := range []float64{.4, .2, .1} {
		next, e := DormandPrince(spiral, 0, []float64{1, 0, 0}, h, true)
		errs = append(errs, math.Hypot(next[0]-math.Cos(h), next[1]-math.Sin(h)))
		estimates = append(estimates, math.Hypot(e[0], e[1]))
		if math.Abs(next[2]-h) > 1e-15 {
			t.Fatalf("h=%v: linear coordinate %v", h, next[2])
		}
	}
	for i := 1; i < len(errs); i++ {
		if r := errs[i-1] / errs[i]; r < 40 || r > 90 {
			t.Fatalf("error ratio %v (%v)", r, errs)
		}
		if r := estimates[i-1] / estimates[i]; r < 20 || r > 45 {
			t.Fatalf("estimate ratio %v (%v)", r, estimates)
		}
	}
	if _, e := DormandPrince(spiral, 0, []float64{1, 0, 0}, .1, false); e != nil {
		t.Fatal("an unrequested estimate was computed")
	}
}

func TestSolutionState(t *testing.T) {
	s := &Solution{F: spiral, Lo: 0, Hi: 1}
	y := []float64{1, 0, 0}
	s.Ts, s.Ys = []float64{0}, [][]float64{y}
	for tk := 0.; tk < 1; tk += .125 {
		next, _ := DormandPrince(spiral, tk, y, .125, false)
		s.Ts, s.Ys, y = append(s.Ts, tk+.125), append(s.Ys, next), next
	}
	s.End, s.Complete = 1, true
	if s.Steps() != 8 {
		t.Fatalf("%d steps", s.Steps())
	}
	for _, tk := range []float64{0, .01, .3, .5, .77, 1, 1 + 1e-13} {
		p, ok := s.State(tk)
		if !ok {
			t.Fatalf("t=%v unknown", tk)
		}
		want := math.Min(tk, 1)
		if math.Hypot(p[0]-math.Cos(want), p[1]-math.Sin(want)) > 1e-8 || math.Abs(p[2]-want) > 1e-14 {
			t.Fatalf("t=%v: %v", tk, p)
		}
	}
	// A state at a step's end, reached from its start, is the stored state.
	p, _ := s.State(.5)
	if q := s.Ys[4]; p[0] != q[0] || p[1] != q[1] {
		t.Fatalf("step end %v, stored %v", p, q)
	}
	for _, tk := range []float64{-1e-9, 1.1, math.NaN()} {
		if _, ok := s.State(tk); ok {
			t.Fatalf("t=%v should be unknown", tk)
		}
	}
	s.Complete = false
	if _, ok := s.State(1 + 1e-13); ok {
		t.Fatal("an incomplete solution extended past its end")
	}
	if _, ok := (&Solution{}).State(0); ok {
		t.Fatal("an empty solution has no state")
	}
}
