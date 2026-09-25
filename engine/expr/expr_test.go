package expr

import (
	"math"
	"strings"
	"testing"
)

func TestScalarConstants(t *testing.T) {
	for _, tc := range []struct {
		s    string
		want float64
	}{{"2*pi", 2 * math.Pi}, {"-phi", -(1 + math.Sqrt(5)) / 2}, {"ln(e)", 1}, {"sqrt(5)/2+1/2", (1 + math.Sqrt(5)) / 2}, {"Pi", math.Pi}} {
		v, err := Scalar(tc.s)
		if err != nil || math.Abs(v-tc.want) > 1e-12 {
			t.Errorf("%s: %g, %v", tc.s, v, err)
		}
	}
	for _, s := range []string{"t", "x+1", "a", "sqrt(-1)", "1/0", "", "2pi"} {
		if _, err := Scalar(s); err == nil {
			t.Errorf("accepted scalar %q", s)
		}
	}
}

func TestShapeParameterBinding(t *testing.T) {
	f, err := ParseWithParameter("a*cos(t)+phi", 2)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(f(0)-(2+(1+math.Sqrt(5))/2)) > 1e-12 {
		t.Fatal("wrong parameter binding")
	}
	g, err := ParseWithParameter("a*cos(t)+phi", 3)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(g(0)-f(0)-1) > 1e-12 {
		t.Fatal("parameter leaked between expressions")
	}
	if _, err := ParseWithParameter("a", math.Inf(1)); err == nil {
		t.Fatal("accepted infinite parameter")
	}
}

func TestExpressions(t *testing.T) {
	for _, tc := range []struct {
		s       string
		x, want float64
	}{
		{"-2^2", 0, -4}, {"2^3^2", 0, 512}, {"2^-2", 0, .25}, {"sin(pi/2)+cos(0)", 0, 2}, {"2*x^2+1", 3, 19}, {"ln(e)", 0, 1}, {"sech(0)", 0, 1}, {"1e-3 + .2", 0, .201}, {"sqrt(t)", 4, 2},
	} {
		t.Run(tc.s, func(t *testing.T) {
			e, err := Parse(tc.s)
			if err != nil {
				t.Fatal(err)
			}
			if math.Abs(e(tc.x)-tc.want) > 1e-12 {
				t.Fatalf("got %g want %g", e(tc.x), tc.want)
			}
		})
	}
}
func TestRejectMalformed(t *testing.T) {
	for _, s := range []string{"", "2t", "sin t", "unknown(t)", "sin(", "1;alert(1)", "t=2", "1..2", "1e", strings.Repeat("(", 70) + "t" + strings.Repeat(")", 70), strings.Repeat("1", 1025)} {
		if _, err := Parse(s); err == nil {
			t.Errorf("accepted %q", s)
		}
	}
}
func TestDomainErrorsRemainNonfinite(t *testing.T) {
	for _, s := range []string{"sqrt(-1)", "1/0", "log(-1)"} {
		e, err := Parse(s)
		if err != nil {
			t.Fatal(err)
		}
		if v := e(0); !math.IsNaN(v) && !math.IsInf(v, 0) {
			t.Errorf("%s became %g", s, v)
		}
	}
}
