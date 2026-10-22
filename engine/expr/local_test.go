package expr

import (
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
}
