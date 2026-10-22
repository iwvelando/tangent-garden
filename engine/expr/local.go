package expr

import (
	"fmt"
	"math"
)

// ParseLocalWithParameter separates a curve expression's constant translation
// from its moving part for numerical differentiation. The returned expression
// plus origin equals the entered expression in real arithmetic. Only outer
// additions, subtractions, negations and multiplication or division by a
// constant are separated; constants inside other operations stay in place.
// Positions should still use ParseWithParameter, preserving their rounding
// and all domain checks in the entered expression.
func ParseLocalWithParameter(s string, a float64) (local Expr, origin float64, err error) {
	if math.IsNaN(a) || math.IsInf(a, 0) {
		return nil, 0, fmt.Errorf("shape parameter a must be finite")
	}
	_, t, err := parseTree(s, curveVariables, &a)
	if err != nil {
		return nil, 0, err
	}
	t, origin = localTree(t)
	e := compile(t)
	return func(t float64) float64 { return e.eval(t, 0, 0, 0) }, origin, nil
}

func localTree(t *tree) (*tree, float64) {
	switch t.op {
	case opConst:
		return constant(0), t.value
	case opNeg:
		x, o := localTree(t.left)
		return unary(opNeg, x, 0, 0), -o
	case opAdd, opSub:
		l, a := localTree(t.left)
		r, b := localTree(t.right)
		if t.op == opAdd {
			return binary(t.op, l, r), a + b
		}
		return binary(t.op, l, r), a - b
	case opMul:
		if t.left.op == opConst {
			r, o := localTree(t.right)
			return binary(opMul, t.left, r), t.left.value * o
		}
		if t.right.op == opConst {
			l, o := localTree(t.left)
			return binary(opMul, l, t.right), o * t.right.value
		}
	case opDiv:
		if t.right.op == opConst && t.right.value != 0 {
			l, o := localTree(t.left)
			return binary(opDiv, l, t.right), o / t.right.value
		}
	}
	return t, 0
}
