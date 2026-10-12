package expr

import (
	"math"
	"math/rand/v2"
	"strconv"
	"strings"
	"testing"
)

// Every expression must parse, refuse and evaluate exactly as the closure
// evaluator did (legacy_test.go): the same error text, the same timed flag,
// and the same bits from every operation. A NaN matches any NaN: which of
// two NaN operands' sign and payload an operation keeps is left open by Go
// (on amd64 it follows the register the compiler picks for a commutative
// operation) and by WebAssembly, and nothing reads them.

var functionNames = []string{"sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "sech", "exp", "log", "ln", "sqrt", "abs"}

// randomExpression writes an expression of the grammar: every operator,
// unary sign, parenthesis, function, named constant and number form, and
// the given variables, nested to at most depth.
func randomExpression(r *rand.Rand, names []string, depth int) string {
	leaf := func() string {
		switch r.IntN(9) {
		case 0, 1, 2:
			if len(names) > 0 {
				return names[r.IntN(len(names))]
			}
			return "pi"
		case 3:
			return []string{"pi", "e", "phi", "a"}[r.IntN(4)]
		case 4:
			return strconv.Itoa(r.IntN(70))
		case 5:
			return []string{"0", "0.5", ".25", "1e3", "2.5e-3", "1E+2", "64", "65", "1e400", "0.1"}[r.IntN(10)]
		default:
			return strconv.FormatFloat(r.Float64()*10, 'g', 1+r.IntN(17), 64)
		}
	}
	if depth == 0 {
		return leaf()
	}
	sub := func() string { return randomExpression(r, names, depth-1) }
	switch r.IntN(10) {
	case 0, 1:
		return leaf()
	case 2:
		return functionNames[r.IntN(len(functionNames))] + "(" + sub() + ")"
	case 3:
		return []string{"-", "+", "- "}[r.IntN(3)] + sub()
	case 4:
		return "(" + sub() + ")"
	case 5:
		// A power with a small whole exponent, as studies write them.
		return sub() + "^" + []string{"2", "3", "4", "5", "8", "64", "-2", "0", "1", "2.5", "(1+1)", "(t)", "a", "65"}[r.IntN(14)]
	default:
		op := []string{"+", "-", "*", "/", "^", " + ", " * "}[r.IntN(7)]
		return sub() + op + sub()
	}
}

// evaluationPoints holds values every expression is evaluated at: the
// special values, the poles of the functions and of division, and
// ordinary values.
func evaluationPoints(r *rand.Rand) []float64 {
	xs := []float64{0, math.Copysign(0, -1), 1, -1, 2, -2, 0.5, math.Pi / 2, -math.Pi / 2, math.Pi, math.Inf(1), math.Inf(-1), math.NaN(),
		math.MaxFloat64, -math.MaxFloat64, math.SmallestNonzeroFloat64, 710, -745, 1e-300, 1e300, 1.0000000000000002}
	for range 20 {
		xs = append(xs, (r.Float64()*2-1)*math.Pow(10, r.Float64()*8-4))
	}
	return xs
}

func sameResult(t *testing.T, s string, got, want float64, at ...float64) {
	t.Helper()
	if !sameBits(got, want) {
		t.Fatalf("%q at %v: %v (%#x), the closure evaluator gives %v (%#x)", s, at, got, math.Float64bits(got), want, math.Float64bits(want))
	}
}

func sameError(t *testing.T, s string, got, want error) {
	t.Helper()
	if (got == nil) != (want == nil) || got != nil && got.Error() != want.Error() {
		t.Fatalf("%q: error %v, the closure evaluator gives %v", s, got, want)
	}
}

// compareCurve checks Parse and ParseWithParameter for s at every point.
func compareCurve(t *testing.T, s string, xs []float64) {
	t.Helper()
	f, err := Parse(s)
	g, legacyErr := legacyParseCurve(s)
	sameError(t, s, err, legacyErr)
	if err == nil {
		for _, x := range xs {
			sameResult(t, s, f(x), g(x), x)
		}
	}
	for _, a := range []float64{0, 2, -1.5, 3, 1e300, math.NaN()} {
		f, err := ParseWithParameter(s, a)
		g, legacyErr := legacyParseWithParameter(s, a)
		sameError(t, s, err, legacyErr)
		if err == nil {
			for _, x := range xs {
				sameResult(t, s, f(x), g(x), x, a)
			}
		}
	}
}

func compareField(t *testing.T, s string, xs []float64) {
	t.Helper()
	f, timed, err := ParseField(s, 1.5)
	g, legacyTimed, legacyErr := legacyParseField(s, 1.5)
	sameError(t, s, err, legacyErr)
	if timed != legacyTimed {
		t.Fatalf("%q: timed %v, the closure evaluator gives %v", s, timed, legacyTimed)
	}
	if err == nil {
		for i, x := range xs {
			y, u := xs[(i+7)%len(xs)], xs[(i+13)%len(xs)]
			sameResult(t, s, f(x, y, u), g(x, y, u), x, y, u)
		}
	}
}

func compareSpatial(t *testing.T, s string, xs []float64) {
	t.Helper()
	f, timed, err := ParseSpatialField(s, -0.75)
	g, legacyTimed, legacyErr := legacyParseSpatialField(s, -0.75)
	sameError(t, s, err, legacyErr)
	if timed != legacyTimed {
		t.Fatalf("%q: timed %v, the closure evaluator gives %v", s, timed, legacyTimed)
	}
	if err == nil {
		for i, x := range xs {
			y, z, u := xs[(i+5)%len(xs)], xs[(i+11)%len(xs)], xs[(i+17)%len(xs)]
			sameResult(t, s, f(x, y, z, u), g(x, y, z, u), x, y, z, u)
		}
	}
}

func compareScalar(t *testing.T, s string) {
	t.Helper()
	v, err := Scalar(s)
	w, legacyErr := legacyScalar(s)
	sameError(t, s, err, legacyErr)
	sameResult(t, s, v, w)
}

// Expressions from the presets and the documentation, written as studies
// write them.
var studyExpressions = []string{
	"1+0.2*sin(5*t)", "2*cos(t)", "3*sin(t)", "a*cos(t)+phi", "(2+cos(3*t))*cos(2*t)", "sin(3*t)",
	"sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)", "x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2",
	"((x - a)^2 + y^2 + z^2) * ((x + a)^2 + y^2 + z^2)", "((x^2 + y^2)^2 - x^2 + y^2)^2 + z^2",
	"((x-a)^2+y^2)*((x+a)^2+y^2)", "2*t+pi/2", "cos(a*t)", "1+0.35*sin(a*t)", "t^2", "1/t", "tan(t)",
	"sech(t)", "exp(-t^2)*cos(8*t)", "sqrt(1-t^2)", "log(abs(t))", "-2^2", "2^3^2", "2^-2", "x^2+y^2-1-0.3*sin(t)",
	"x*y*z - 0.1*t", "e^t", "t^a", "t^(a+1)", "2^t", "t^0.5", "t^65", "t^64", "(-t)^3", "asin(t/2)+acos(t/3)+atan(t)",
	"sinh(t)-cosh(t)+tanh(t)", "ln(e)", "0*t", "t-t", "t/t", "1e-3 + .2", "   t  *  2  ", "Sin(T)", "PI*T",
}

var malformedExpressions = []string{
	"", "2t", "sin t", "unknown(t)", "sin(", "1;alert(1)", "t=2", "1..2", "1e", "(", ")", "t)", "(t", "t+", "+", "*t",
	"t**2", "t^", "sin()", "sin(t", "sin", "y", "z", "x+y", "a", "2pi", "pi2", "t 2", "1e+", "e^", "sqrt(-)", "$", "t#",
	"é", "1,5", "sin(t))", "--t", "+-t", "t^^2", "phi(t)", "a(t)", "t(2)",
	strings.Repeat("(", 64) + "t" + strings.Repeat(")", 64), strings.Repeat("(", 63) + "t" + strings.Repeat(")", 63),
	strings.Repeat("-", 64) + "t", strings.Repeat("-", 63) + "t", strings.Repeat("t^", 64) + "t", strings.Repeat("t^", 62) + "t",
	strings.Repeat("1", 1025), strings.Repeat("1", 1024), "1" + strings.Repeat("+1", 511), "1" + strings.Repeat("+1", 512),
}

func TestCompiledMatchesClosureEvaluator(t *testing.T) {
	r := rand.New(rand.NewPCG(7, 11))
	xs := evaluationPoints(r)
	expressions := append(append([]string{}, studyExpressions...), malformedExpressions...)
	for _, names := range [][]string{{"t"}, {"x"}, {"x", "y", "t"}, {"x", "y", "z", "t"}, nil} {
		for range 1500 {
			s := randomExpression(r, names, 1+r.IntN(6))
			expressions = append(expressions, s)
			// Damaged text, for the errors: cut short, or a character changed.
			if n := len(s); n > 1 {
				expressions = append(expressions, s[:r.IntN(n)])
				b := []byte(s)
				b[r.IntN(n)] = "()+-*/^.e x,1"[r.IntN(13)]
				expressions = append(expressions, string(b))
			}
		}
	}
	for _, s := range expressions {
		compareCurve(t, s, xs)
		compareField(t, s, xs)
		compareSpatial(t, s, xs)
		compareScalar(t, s)
	}
}

func FuzzCompiledMatchesClosureEvaluator(f *testing.F) {
	for _, s := range studyExpressions {
		f.Add(s, 0.3, -1.2, 2.5, 0.75)
	}
	for _, s := range malformedExpressions {
		f.Add(s, 0.0, 0.0, 0.0, 0.0)
	}
	f.Fuzz(func(t *testing.T, s string, x, y, z, u float64) {
		xs := []float64{x, y, z, u, 0, math.Inf(1), math.NaN()}
		compareCurve(t, s, xs)
		compareField(t, s, xs)
		compareSpatial(t, s, xs)
		compareScalar(t, s)
	})
}
