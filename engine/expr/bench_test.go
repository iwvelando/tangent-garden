package expr

import "testing"

// Expressions as studies write them, each evaluated by the compiled
// evaluator and by the closure evaluator it replaced. Under WebAssembly,
// where the studies run:
//
//	GOOS=js GOARCH=wasm go test -run '^$' -bench Evaluate -exec "$(go env GOROOT)/lib/wasm/go_js_wasm_exec" ./engine/expr
var benchmarkExpressions = []struct{ name, s string }{
	{"profile", "1+0.2*sin(5*t)"},
	{"torus-knot", "(2+cos(3*t))*cos(2*t)"},
	{"gyroid", "sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)"},
	{"tanglecube", "x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2"},
	{"drops", "((x - a)^2 + y^2 + z^2) * ((x + a)^2 + y^2 + z^2)"},
}

func BenchmarkEvaluate(b *testing.B) {
	for _, e := range benchmarkExpressions {
		for _, kind := range []string{"compiled", "closures"} {
			parse := ParseSpatialField
			if kind == "closures" {
				parse = legacyParseSpatialField
			}
			f, _, err := parse(e.s, 1)
			if err != nil {
				b.Fatal(err)
			}
			b.Run(e.name+"/"+kind, func(b *testing.B) {
				s := 0.0
				for i := 0; b.Loop(); i++ {
					v := float64(i%1000) / 400
					s += f(v, -v, v/2, v)
				}
				_ = s
			})
		}
	}
}
