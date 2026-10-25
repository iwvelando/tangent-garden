package engine3

import "math"

// fmin and fmax are the builtin min and max, NaNs and signed zeros
// included. On WASM the builtins are runtime calls, which cost more than
// the rest of a receiver bin's arithmetic; these inline.
func fmin(x, y float64) float64 {
	if y != y || y < x {
		return y
	}
	if x != x || x < y || x != 0 {
		return x
	}
	return math.Float64frombits(math.Float64bits(x) | math.Float64bits(y))
}

func fmax(x, y float64) float64 {
	if y != y || y > x {
		return y
	}
	if x != x || x > y || x != 0 {
		return x
	}
	return math.Float64frombits(math.Float64bits(x) & math.Float64bits(y))
}
