package expr

import "math"

// A parsed expression is a tree of operations (tree), folded where it is
// constant and compiled to closures that each take up to four variables,
// in the order the parser's variable indices give. A constant or variable
// operand rides inside the closure of its operation rather than being a
// closure of its own, and a function calls the math package directly, so
// an evaluation makes as few calls as the tree allows. Every closure takes
// its operation in the tree's order on the tree's operands, one operation
// each: nothing is rewritten, reordered or fused, so every value is the one
// the tree gives bit for bit.
type node func(v0, v1, v2, v3 float64) float64

// A program is a compiled expression and how many closures one evaluation
// calls.
type program struct {
	eval  node
	calls int
}

type opcode uint8

const (
	opConst opcode = iota
	opVar
	// Operations on one operand. A whole power keeps its exponent as the
	// tree's index and its fast path's limit as its value (powInt).
	opNeg
	opSin
	opCos
	opTan
	opAsin
	opAcos
	opAtan
	opSinh
	opCosh
	opTanh
	opSech
	opExp
	opLog
	opSqrt
	opAbs
	opPowInt
	// Operations on two.
	opAdd
	opSub
	opMul
	opDiv
	opPow
)

// A parse tree: a constant, a variable, or an operation on one operand
// (left) or two. An operation whose operands are all constant is never
// built: it is folded to a constant as the parser meets it, by the same
// closure that would evaluate it.
type tree struct {
	op opcode
	// A constant's value; a whole power's limit.
	value float64
	// A variable's index; a whole power's exponent.
	index       uint8
	left, right *tree
}

func constant(v float64) *tree { return &tree{op: opConst, value: v} }

func (t *tree) leaf() bool { return t.op == opConst || t.op == opVar }

// unary applies op to x, folding a constant now.
func unary(op opcode, x *tree, index uint8, value float64) *tree {
	t := &tree{op: op, index: index, value: value, left: x}
	if x.op == opConst {
		return constant(compile(t).eval(0, 0, 0, 0))
	}
	return t
}

// binary applies op, opAdd to opPow, to l and r, folding constants now.
func binary(op opcode, l, r *tree) *tree {
	// A constant whole exponent, such as the 4 of x^4, takes its own path.
	if n := r.value; op == opPow && r.op == opConst && n >= 2 && n <= 64 && n == math.Trunc(n) {
		return unary(opPowInt, l, uint8(n), powerLimit(int(n)))
	}
	t := &tree{op: op, left: l, right: r}
	if l.op == opConst && r.op == opConst {
		return constant(compile(t).eval(0, 0, 0, 0))
	}
	return t
}

func compile(t *tree) *program {
	p := &program{}
	p.eval = p.node(t)
	return p
}

// variable is the variable k of v0 to v3.
func variable(k uint8, v0, v1, v2, v3 float64) float64 {
	switch k {
	case 0:
		return v0
	case 1:
		return v1
	case 2:
		return v2
	}
	return v3
}

// node returns the closure that evaluates t.
func (p *program) node(t *tree) node {
	p.calls++
	switch {
	case t.op == opConst:
		c := t.value
		return func(_, _, _, _ float64) float64 { return c }
	case t.op == opVar:
		switch t.index {
		case 0:
			return func(v0, _, _, _ float64) float64 { return v0 }
		case 1:
			return func(_, v1, _, _ float64) float64 { return v1 }
		case 2:
			return func(_, _, v2, _ float64) float64 { return v2 }
		}
		return func(_, _, _, v3 float64) float64 { return v3 }
	case t.op < opAdd:
		return p.unaryNode(t)
	}
	return p.binaryNode(t)
}

// unaryNode returns the closure that evaluates an operation on one operand.
func (p *program) unaryNode(t *tree) node {
	n, limit := int(t.index), t.value
	// A square takes powInt's own path without a call: there its products
	// are 1·(x·x), which is x·x exactly. 1/limit is a power of two.
	if low := 1 / limit; t.op == opPowInt && n == 2 {
		if x := t.left; x.op == opVar {
			k := x.index
			return func(v0, v1, v2, v3 float64) float64 {
				x := variable(k, v0, v1, v2, v3)
				if m := math.Abs(x); m > low && m < limit {
					return x * x
				}
				return powInt(x, 2, limit)
			}
		}
		a := p.node(t.left)
		return func(v0, v1, v2, v3 float64) float64 {
			x := a(v0, v1, v2, v3)
			if m := math.Abs(x); m > low && m < limit {
				return x * x
			}
			return powInt(x, 2, limit)
		}
	}
	if x := t.left; x.op == opVar {
		k := x.index
		switch t.op {
		case opSin:
			return func(v0, v1, v2, v3 float64) float64 { return math.Sin(variable(k, v0, v1, v2, v3)) }
		case opCos:
			return func(v0, v1, v2, v3 float64) float64 { return math.Cos(variable(k, v0, v1, v2, v3)) }
		case opTan:
			return func(v0, v1, v2, v3 float64) float64 { return math.Tan(variable(k, v0, v1, v2, v3)) }
		case opAsin:
			return func(v0, v1, v2, v3 float64) float64 { return math.Asin(variable(k, v0, v1, v2, v3)) }
		case opAcos:
			return func(v0, v1, v2, v3 float64) float64 { return math.Acos(variable(k, v0, v1, v2, v3)) }
		case opAtan:
			return func(v0, v1, v2, v3 float64) float64 { return math.Atan(variable(k, v0, v1, v2, v3)) }
		case opSinh:
			return func(v0, v1, v2, v3 float64) float64 { return math.Sinh(variable(k, v0, v1, v2, v3)) }
		case opCosh:
			return func(v0, v1, v2, v3 float64) float64 { return math.Cosh(variable(k, v0, v1, v2, v3)) }
		case opTanh:
			return func(v0, v1, v2, v3 float64) float64 { return math.Tanh(variable(k, v0, v1, v2, v3)) }
		case opSech:
			return func(v0, v1, v2, v3 float64) float64 { return 1 / math.Cosh(variable(k, v0, v1, v2, v3)) }
		case opExp:
			return func(v0, v1, v2, v3 float64) float64 { return math.Exp(variable(k, v0, v1, v2, v3)) }
		case opLog:
			return func(v0, v1, v2, v3 float64) float64 { return math.Log(variable(k, v0, v1, v2, v3)) }
		case opSqrt:
			return func(v0, v1, v2, v3 float64) float64 { return math.Sqrt(variable(k, v0, v1, v2, v3)) }
		case opAbs:
			return func(v0, v1, v2, v3 float64) float64 { return math.Abs(variable(k, v0, v1, v2, v3)) }
		case opNeg:
			return func(v0, v1, v2, v3 float64) float64 { return -variable(k, v0, v1, v2, v3) }
		case opPowInt:
			return func(v0, v1, v2, v3 float64) float64 { return powInt(variable(k, v0, v1, v2, v3), n, limit) }
		}
	}
	a := p.node(t.left)
	switch t.op {
	case opSin:
		return func(v0, v1, v2, v3 float64) float64 { return math.Sin(a(v0, v1, v2, v3)) }
	case opCos:
		return func(v0, v1, v2, v3 float64) float64 { return math.Cos(a(v0, v1, v2, v3)) }
	case opTan:
		return func(v0, v1, v2, v3 float64) float64 { return math.Tan(a(v0, v1, v2, v3)) }
	case opAsin:
		return func(v0, v1, v2, v3 float64) float64 { return math.Asin(a(v0, v1, v2, v3)) }
	case opAcos:
		return func(v0, v1, v2, v3 float64) float64 { return math.Acos(a(v0, v1, v2, v3)) }
	case opAtan:
		return func(v0, v1, v2, v3 float64) float64 { return math.Atan(a(v0, v1, v2, v3)) }
	case opSinh:
		return func(v0, v1, v2, v3 float64) float64 { return math.Sinh(a(v0, v1, v2, v3)) }
	case opCosh:
		return func(v0, v1, v2, v3 float64) float64 { return math.Cosh(a(v0, v1, v2, v3)) }
	case opTanh:
		return func(v0, v1, v2, v3 float64) float64 { return math.Tanh(a(v0, v1, v2, v3)) }
	case opSech:
		return func(v0, v1, v2, v3 float64) float64 { return 1 / math.Cosh(a(v0, v1, v2, v3)) }
	case opExp:
		return func(v0, v1, v2, v3 float64) float64 { return math.Exp(a(v0, v1, v2, v3)) }
	case opLog:
		return func(v0, v1, v2, v3 float64) float64 { return math.Log(a(v0, v1, v2, v3)) }
	case opSqrt:
		return func(v0, v1, v2, v3 float64) float64 { return math.Sqrt(a(v0, v1, v2, v3)) }
	case opAbs:
		return func(v0, v1, v2, v3 float64) float64 { return math.Abs(a(v0, v1, v2, v3)) }
	case opNeg:
		return func(v0, v1, v2, v3 float64) float64 { return -a(v0, v1, v2, v3) }
	case opPowInt:
		return func(v0, v1, v2, v3 float64) float64 { return powInt(a(v0, v1, v2, v3), n, limit) }
	}
	panic("expr: not an operation on one operand")
}

// binaryNode returns the closure that evaluates an operation on two
// operands. Two constants are folded already.
func (p *program) binaryNode(t *tree) node {
	l, r := t.left, t.right
	switch {
	case l.op == opConst && r.op == opVar:
		c, k := l.value, r.index
		switch t.op {
		case opAdd:
			return func(v0, v1, v2, v3 float64) float64 { return c + variable(k, v0, v1, v2, v3) }
		case opSub:
			return func(v0, v1, v2, v3 float64) float64 { return c - variable(k, v0, v1, v2, v3) }
		case opMul:
			return func(v0, v1, v2, v3 float64) float64 { return c * variable(k, v0, v1, v2, v3) }
		case opDiv:
			return func(v0, v1, v2, v3 float64) float64 { return c / variable(k, v0, v1, v2, v3) }
		case opPow:
			return func(v0, v1, v2, v3 float64) float64 { return math.Pow(c, variable(k, v0, v1, v2, v3)) }
		}
	case l.op == opVar && r.op == opConst:
		k, c := l.index, r.value
		switch t.op {
		case opAdd:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) + c }
		case opSub:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) - c }
		case opMul:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) * c }
		case opDiv:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) / c }
		case opPow:
			return func(v0, v1, v2, v3 float64) float64 { return math.Pow(variable(k, v0, v1, v2, v3), c) }
		}
	case l.op == opVar && r.op == opVar:
		k, j := l.index, r.index
		switch t.op {
		case opAdd:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) + variable(j, v0, v1, v2, v3) }
		case opSub:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) - variable(j, v0, v1, v2, v3) }
		case opMul:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) * variable(j, v0, v1, v2, v3) }
		case opDiv:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) / variable(j, v0, v1, v2, v3) }
		case opPow:
			return func(v0, v1, v2, v3 float64) float64 {
				return math.Pow(variable(k, v0, v1, v2, v3), variable(j, v0, v1, v2, v3))
			}
		}
	case r.op == opConst:
		a, c := p.node(l), r.value
		switch t.op {
		case opAdd:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) + c }
		case opSub:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) - c }
		case opMul:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) * c }
		case opDiv:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) / c }
		case opPow:
			return func(v0, v1, v2, v3 float64) float64 { return math.Pow(a(v0, v1, v2, v3), c) }
		}
	case r.op == opVar:
		a, k := p.node(l), r.index
		switch t.op {
		case opAdd:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) + variable(k, v0, v1, v2, v3) }
		case opSub:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) - variable(k, v0, v1, v2, v3) }
		case opMul:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) * variable(k, v0, v1, v2, v3) }
		case opDiv:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) / variable(k, v0, v1, v2, v3) }
		case opPow:
			return func(v0, v1, v2, v3 float64) float64 { return math.Pow(a(v0, v1, v2, v3), variable(k, v0, v1, v2, v3)) }
		}
	case l.op == opConst:
		c, b := l.value, p.node(r)
		switch t.op {
		case opAdd:
			return func(v0, v1, v2, v3 float64) float64 { return c + b(v0, v1, v2, v3) }
		case opSub:
			return func(v0, v1, v2, v3 float64) float64 { return c - b(v0, v1, v2, v3) }
		case opMul:
			return func(v0, v1, v2, v3 float64) float64 { return c * b(v0, v1, v2, v3) }
		case opDiv:
			return func(v0, v1, v2, v3 float64) float64 { return c / b(v0, v1, v2, v3) }
		case opPow:
			return func(v0, v1, v2, v3 float64) float64 { return math.Pow(c, b(v0, v1, v2, v3)) }
		}
	case l.op == opVar:
		k, b := l.index, p.node(r)
		switch t.op {
		case opAdd:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) + b(v0, v1, v2, v3) }
		case opSub:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) - b(v0, v1, v2, v3) }
		case opMul:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) * b(v0, v1, v2, v3) }
		case opDiv:
			return func(v0, v1, v2, v3 float64) float64 { return variable(k, v0, v1, v2, v3) / b(v0, v1, v2, v3) }
		case opPow:
			return func(v0, v1, v2, v3 float64) float64 { return math.Pow(variable(k, v0, v1, v2, v3), b(v0, v1, v2, v3)) }
		}
	default:
		a, b := p.node(l), p.node(r)
		switch t.op {
		case opAdd:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) + b(v0, v1, v2, v3) }
		case opSub:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) - b(v0, v1, v2, v3) }
		case opMul:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) * b(v0, v1, v2, v3) }
		case opDiv:
			return func(v0, v1, v2, v3 float64) float64 { return a(v0, v1, v2, v3) / b(v0, v1, v2, v3) }
		case opPow:
			return func(v0, v1, v2, v3 float64) float64 { return math.Pow(a(v0, v1, v2, v3), b(v0, v1, v2, v3)) }
		}
	}
	panic("expr: not an operation on two operands")
}

// powInt returns x^n for a whole n from 2 to 64, equal to math.Pow(x, n)
// bit for bit but without its general path; limit is powerLimit(n). Pow
// multiplies x's mantissa by successive squarings for each set bit of n,
// keeping the powers of two apart; here the same products are taken in the
// same order on x itself. While |x| lies within 2^±⌊1000/n⌋, every product
// used is a normal number, so the powers of two scale it exactly and each
// rounding is Pow's. Beyond that, and for zero, infinities and NaN, Pow
// decides.
func powInt(x float64, n int, limit float64) float64 {
	if a := math.Abs(x); !(a > 1/limit && a < limit) {
		return math.Pow(x, float64(n))
	}
	r, b := 1.0, x
	for i := n; i != 0; i >>= 1 {
		if i&1 == 1 {
			r *= b
		}
		b *= b
	}
	return r
}

// powerLimit is the bound on |x| within which powInt(x, n) takes its own
// path.
func powerLimit(n int) float64 { return math.Ldexp(1, 1000/n) }
