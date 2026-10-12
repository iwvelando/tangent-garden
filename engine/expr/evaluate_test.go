package expr

import (
	"math"
	"testing"
)

// Each operator and function against Go's own arithmetic and math package,
// including nonfinite values and poles, which must stay nonfinite rather
// than be rewritten away (0*t at an infinite t is NaN, not 0).
func TestOperatorsAndFunctions(t *testing.T) {
	inf, nan, negZero := math.Inf(1), math.NaN(), math.Copysign(0, -1)
	sech := func(x float64) float64 { return 1 / math.Cosh(x) }
	for _, tc := range []struct {
		s    string
		at   float64
		want float64
	}{
		{"t+2", 3, 5}, {"2+t", 3, 5}, {"t-2", 3, 1}, {"2-t", 3, -1}, {"t*2", 3, 6}, {"2*t", 3, 6},
		{"t/2", 3, 1.5}, {"2/t", 4, 0.5}, {"t^2", 3, 9}, {"2^t", 3, 8}, {"t^t", 2, 4}, {"t^0.5", 2, math.Sqrt2},
		{"t^-1", 4, 0.25}, {"-t", 0, negZero}, {"+t", 3, 3}, {"--t", 3, 3}, {"t*t+t", 3, 12}, {"t+t*t", 3, 12},
		{"(t+1)*(t-1)", 3, 8}, {"t^65", 1, 1}, {"t^64", -1, 1}, {"t^3", -2, -8},
		{"1/t", 0, inf}, {"1/t", negZero, math.Inf(-1)}, {"t/t", 0, nan}, {"0*t", inf, nan}, {"t-t", inf, nan},
		{"t+1", nan, nan}, {"t^0", nan, 1}, {"t^2", inf, inf}, {"t^2", nan, nan}, {"t^3", math.Inf(-1), math.Inf(-1)},
		{"t^2", 1e200, inf}, {"t^-2", 0, inf}, {"log(t)", 0, math.Inf(-1)}, {"ln(t)", -1, nan}, {"sqrt(t)", -1, nan},
		{"exp(t)", 1000, inf}, {"exp(t)", math.Inf(-1), 0}, {"tan(t)", math.Pi / 2, math.Tan(math.Pi / 2)},
		{"asin(t)", 2, nan}, {"acos(t)", -2, nan}, {"atan(t)", inf, math.Pi / 2}, {"sech(t)", inf, 0},
		{"tanh(t)", inf, 1}, {"sinh(t)", inf, inf}, {"cosh(t)", math.Inf(-1), inf}, {"abs(t)", math.Inf(-1), inf},
		{"sin(t)", inf, nan}, {"cos(t)", nan, nan},
	} {
		f, err := Parse(tc.s)
		if err != nil {
			t.Fatalf("%s: %v", tc.s, err)
		}
		if got := f(tc.at); !sameBits(got, tc.want) {
			t.Errorf("%s at %v = %v, want %v", tc.s, tc.at, got, tc.want)
		}
	}
	functions := map[string]func(float64) float64{
		"sin": math.Sin, "cos": math.Cos, "tan": math.Tan, "asin": math.Asin, "acos": math.Acos, "atan": math.Atan,
		"sinh": math.Sinh, "cosh": math.Cosh, "tanh": math.Tanh, "sech": sech,
		"exp": math.Exp, "log": math.Log, "ln": math.Log, "sqrt": math.Sqrt, "abs": math.Abs,
	}
	if len(functions) != len(functionNames) {
		t.Fatalf("%d functions here, %d in the equivalence test", len(functions), len(functionNames))
	}
	for name, g := range functions {
		f, err := Parse(name + "(t)")
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		for _, x := range []float64{0, negZero, 0.3, -0.7, 1, 2.5, -40, 800, inf, math.Inf(-1), nan} {
			if got, want := f(x), g(x); !sameBits(got, want) {
				t.Errorf("%s(%v) = %v, want %v", name, x, got, want)
			}
		}
	}
}

// Every named constant and the parameter a, bound when the text is parsed.
func TestConstantsAndBinding(t *testing.T) {
	phi := (1 + math.Sqrt(5)) / 2
	for _, tc := range []struct {
		s           string
		a, at, want float64
	}{
		{"pi", 0, 0, math.Pi}, {"e", 0, 0, math.E}, {"phi", 0, 0, phi}, {"a", 2.5, 0, 2.5}, {"a*x", -3, 2, -6},
		{"t^a", 3, 2, 8}, {"x^(a+1)", 1, 3, 9}, {"2*pi*t", 0, 0.5, 2 * math.Pi * 0.5}, {"t*2*pi", 0, 0.5, 0.5 * 2 * math.Pi},
	} {
		f, err := ParseWithParameter(tc.s, tc.a)
		if err != nil {
			t.Fatalf("%s: %v", tc.s, err)
		}
		if got := f(tc.at); got != tc.want {
			t.Errorf("%s with a = %v at %v: %v, want %v", tc.s, tc.a, tc.at, got, tc.want)
		}
	}
	field, _, err := ParseField("x - 2*y + 4*t + a", 8)
	if err != nil {
		t.Fatal(err)
	}
	if got := field(1, 10, 100); got != 1-20+400+8 {
		t.Errorf("field: %v", got)
	}
	spatial, _, err := ParseSpatialField("x - 2*y + 4*z - 8*t + a", 16)
	if err != nil {
		t.Fatal(err)
	}
	if got := spatial(1, 10, 100, 1000); got != 1-20+400-8000+16 {
		t.Errorf("spatial field: %v", got)
	}
}

// A parsed expression is compiled to closures: constant parts are folded to
// one value when the text is parsed, a constant or variable operand rides
// with its operation rather than being a call of its own, and evaluating
// needs no allocation.
func TestCompiledInstructions(t *testing.T) {
	for _, tc := range []struct {
		s    string
		vars map[string]int
		want int
	}{
		{"t", curveVariables, 1},
		{"(1+2)*pi/4 - sqrt(phi)", curveVariables, 1},
		{"sin(2*pi*t)+1", curveVariables, 3},
		{"1+0.2*sin(5*t)", curveVariables, 4},
		{"t^4 - 5*t^2", curveVariables, 4},
		// Not reassociated: t*2*pi is (t*2)*pi.
		{"t*2*pi", curveVariables, 2},
		{"sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)", spatialVariables, 11},
	} {
		_, prog, err := parse(tc.s, tc.vars, nil)
		if err != nil {
			t.Fatalf("%s: %v", tc.s, err)
		}
		if prog.calls != tc.want {
			t.Errorf("%s: %d calls, want %d", tc.s, prog.calls, tc.want)
		}
	}
	f, _, err := ParseSpatialField("sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x) + ((x-a)^2+y^2)^2", 1)
	if err != nil {
		t.Fatal(err)
	}
	if n := testing.AllocsPerRun(100, func() { f(0.1, 0.2, 0.3, 0) }); n != 0 {
		t.Errorf("%v allocations per evaluation", n)
	}
}
