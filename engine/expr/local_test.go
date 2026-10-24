package expr

import (
	"fmt"
	"math"
	"strings"
	"testing"
)

func TestLocalExpression(t *testing.T) {
	for _, tc := range []struct {
		s            string
		origin, want float64
	}{
		{"5000+t^2", 5000, 0.25},
		{"t^2+5000", 5000, 0.25},
		{"5000-t^2", 5000, -0.25},
		{"t^2-5000", -5000, 0.25},
		{"-(5000+t^2)", -5000, -0.25},
		{"2*(5000+t^2)", 10000, 0.5},
		{"(5000+t^2)*a", 15000, 0.75},
		{"(5000+t^2)/2", 2500, 0.125},
		{"5000+t^2+3000+t^3", 8000, 0.375},
		{"5000+t^2-(3000+t^3)", 2000, 0.125},
		{"5000", 5000, 0},
		// Constants inside a nonlinear operation are part of its shape.
		{"sin(t+5000)", 0, math.Sin(5000.5)},
		{"5000/(t+1)", 0, 5000 / 1.5},
		{"(5000+t)*(3000+t)", 0, 5000.5 * 3000.5},
		{"(5000+t)^2", 0, 5000.5 * 5000.5},
	} {
		t.Run(tc.s, func(t *testing.T) {
			local, origin, err := ParseLocalWithParameter(tc.s, 3)
			if err != nil {
				t.Fatal(err)
			}
			if origin != tc.origin || local(0.5) != tc.want {
				t.Fatalf("local %g, origin %g; want %g, %g", local(0.5), origin, tc.want, tc.origin)
			}
		})
	}
	local, _, err := ParseLocalWithParameter("5000+t^2", 0)
	if err != nil {
		t.Fatal(err)
	}
	// The moving part remains resolved even when the translated value rounds
	// to its origin. This is what numerical differentiation needs at a cusp.
	if math.Abs(local(1e-8)-1e-16) > 1e-30 {
		t.Fatalf("small displacement: %g", local(1e-8))
	}
}

func TestLocalExpressionRemainsBounded(t *testing.T) {
	for _, s := range []string{"t+", "y+1", strings.Repeat("t+", 600) + "t", strings.Repeat("(", 70) + "t" + strings.Repeat(")", 70)} {
		if _, _, err := ParseLocalWithParameter(s, 0); err == nil {
			t.Errorf("accepted %q", s)
		}
	}
	if _, _, err := ParseLocalWithParameter("t+a", math.Inf(1)); err == nil {
		t.Error("accepted nonfinite parameter")
	}
	// Each rationalized root keeps the entered radical beside its local
	// radicand, so nesting grows the evaluation quadratically, never
	// exponentially. The deepest nesting the parser accepts stays bounded.
	deepest := 0
	for d := 1; ; d++ {
		s := strings.Repeat("sqrt(1+", d) + "t" + strings.Repeat(")", d)
		_, tree, err := parseTree(s, curveVariables, new(float64))
		if err != nil {
			break
		}
		local, _ := localTree(tree)
		if calls := compile(local).calls; calls > 2*d*d+2*d {
			t.Fatalf("depth %d: %d calls", d, calls)
		}
		deepest = d
	}
	if deepest < 8 {
		t.Fatalf("parser accepted only %d nested roots", deepest)
	}
}

// Rationalizing a radical's displacement keeps variations smaller than an
// ulp of its origin, including at a cusp where the displacement is quadratic.
func TestLocalRadical(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-20, 0x1p20} {
		for _, sign := range []string{"", "-"} {
			s := fmt.Sprintf("%s%.17g*sqrt(640000+3200*cos(t)+4*cos(t)^2)", sign, scale)
			f, origin, err := ParseLocalWithParameter(s, 0)
			if err != nil {
				t.Fatal(err)
			}
			factor := scale
			if sign == "-" {
				factor = -factor
			}
			if origin != factor*800 {
				t.Fatalf("origin %g", origin)
			}
			for _, u := range []float64{0, 0.1, 0.731, math.Pi / 2, math.Pi, 2 * math.Pi} {
				want := factor * 2 * math.Cos(u)
				if math.Abs(f(u)-want) > math.Abs(factor)*2e-15 {
					t.Fatalf("%s at %g: %g, want %g", s, u, f(u), want)
				}
			}
		}
	}
	f, origin, err := ParseLocalWithParameter("sqrt(640000+t^2)", 0)
	if err != nil {
		t.Fatal(err)
	}
	if origin != 800 || math.Abs(f(1e-8)-6.25e-20) > 1e-34 {
		t.Fatalf("tiny displacement %g + %g", origin, f(1e-8))
	}
	// Preserve the entered radical's domain and overflow, even when the
	// rationalized numerator is finite or the origin cannot be separated.
	for _, s := range []string{"sqrt(1+t)", "sqrt(t)", "sqrt(-1+t)", "sqrt(1e308+1e308*t)"} {
		local, o, err := ParseLocalWithParameter(s, 0)
		if err != nil {
			t.Fatal(err)
		}
		ordinary, _ := Parse(s)
		for _, u := range []float64{-2, -1, 0, 1, 2} {
			got, want := local(u)+o, ordinary(u)
			if math.IsNaN(want) {
				if !math.IsNaN(got) {
					t.Fatalf("%s at %g: %g, want NaN", s, u, got)
				}
				continue
			}
			if math.IsInf(want, 0) {
				if got != want {
					t.Fatalf("%s at %g: %g, want %g", s, u, got, want)
				}
				continue
			}
			if math.Abs(got-want) > 2e-15*math.Max(1, math.Abs(want)) {
				t.Fatalf("%s at %g: %g, want %g", s, u, got, want)
			}
		}
	}
}
