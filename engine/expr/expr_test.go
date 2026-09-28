package expr

import (
	"fmt"
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

// Fields display exact fractions of pi as p*pi/q (web/engine-client.ts); the
// text must evaluate back to the same value, (p·π)/q, bit for bit.
func TestPiFractionsRoundTrip(t *testing.T) {
	for q := 2; q <= 12; q++ {
		for p := -400 * q; p <= 400*q; p++ {
			text := fmt.Sprintf("%d*pi/%d", p, q)
			switch p {
			case 0:
				continue
			case 1:
				text = fmt.Sprintf("pi/%d", q)
			case -1:
				text = fmt.Sprintf("-pi/%d", q)
			}
			if v, err := Scalar(text); err != nil || v != float64(p)*math.Pi/float64(q) {
				t.Fatalf("%s: %v, %v", text, v, err)
			}
		}
	}
}

func TestFieldVariables(t *testing.T) {
	f, timed, err := ParseField("x - 2*y + 3*t^2 + a", 5)
	if err != nil || !timed {
		t.Fatal(err, timed)
	}
	if got := f(1, 10, 2); math.Abs(got-(1-20+12+5)) > 1e-12 {
		t.Fatalf("got %g", got)
	}
	g, timed, err := ParseField("a*y", 3)
	if err != nil || timed {
		t.Fatal(err, timed)
	}
	// Time is read from the text: t*0 still counts, and so does T.
	for s, want := range map[string]bool{"x*y": false, "t*0": true, "sin(T)": true, "x+pi": false} {
		if _, timed, _ := ParseField(s, 0); timed != want {
			t.Errorf("%s uses t: %v", s, timed)
		}
	}
	if g(0, 2, 0) != 6 || f(0, 0, 0) != 5 {
		t.Fatal("parameter leaked between fields")
	}
	for _, s := range []string{"z", "x y", "", "sin x"} {
		if _, _, err := ParseField(s, 0); err == nil {
			t.Errorf("accepted field %q", s)
		}
	}
	if _, _, err := ParseField("x", math.Inf(1)); err == nil {
		t.Error("accepted a nonfinite a")
	}
	// y stays a field variable only: a curve has one variable, t or x.
	if _, err := Parse("y"); err == nil {
		t.Error("accepted y in a curve expression")
	}
	if _, err := Scalar("y"); err == nil || !strings.Contains(err.Error(), "constant") {
		t.Errorf("scalar y: %v", err)
	}
	h, _ := Parse("x*t")
	if h(3) != 9 {
		t.Error("x no longer aliases t in a curve expression")
	}
}
