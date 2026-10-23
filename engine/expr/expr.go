// Package expr parses a small, bounded mathematical language without executing code.
package expr

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
)

type Expr func(float64) float64

// Field is an expression in the plane's coordinates x, y and the time t.
type Field func(x, y, t float64) float64

// SpatialField is an expression in the space coordinates x, y, z and the time t.
type SpatialField func(x, y, z, t float64) float64

type parser struct {
	s          string
	pos, depth int
	// The argument each variable name reads; nil in a constant expression.
	variables map[string]int
	// The variables the expression reads.
	used      map[string]bool
	parameter *float64
}

var arithmetic = map[byte]opcode{'+': opAdd, '-': opSub, '*': opMul, '/': opDiv, '^': opPow}

var (
	curveVariables   = map[string]int{"t": 0, "x": 0}
	fieldVariables   = map[string]int{"x": 0, "y": 1, "t": 2}
	spatialVariables = map[string]int{"x": 0, "y": 1, "z": 2, "t": 3}
)

var functions = map[string]opcode{
	"sin": opSin, "cos": opCos, "tan": opTan, "asin": opAsin, "acos": opAcos, "atan": opAtan,
	"sinh": opSinh, "cosh": opCosh, "tanh": opTanh, "sech": opSech,
	"exp": opExp, "log": opLog, "ln": opLog, "sqrt": opSqrt, "abs": opAbs,
}

func Parse(s string) (Expr, error) {
	return curve(s, nil)
}

// ParseWithParameter binds a numeric shape parameter without symbolic rewriting.
func ParseWithParameter(s string, a float64) (Expr, error) {
	if math.IsNaN(a) || math.IsInf(a, 0) {
		return nil, fmt.Errorf("shape parameter a must be finite")
	}
	return curve(s, &a)
}

// ParseField parses an expression in x, y and t, binding the shape
// parameter a numerically. timed reports whether the text reads t at all.
func ParseField(s string, a float64) (f Field, timed bool, err error) {
	if math.IsNaN(a) || math.IsInf(a, 0) {
		return nil, false, fmt.Errorf("shape parameter a must be finite")
	}
	p, e, err := parse(s, fieldVariables, &a)
	if err != nil {
		return nil, false, err
	}
	return func(x, y, t float64) float64 { return e.eval(x, y, t, 0) }, p.used["t"], nil
}

// ParseSpatialField parses an expression in x, y, z and t, binding the shape
// parameter a numerically. timed reports whether the text reads t at all.
func ParseSpatialField(s string, a float64) (f SpatialField, timed bool, err error) {
	if math.IsNaN(a) || math.IsInf(a, 0) {
		return nil, false, fmt.Errorf("shape parameter a must be finite")
	}
	p, e, err := parse(s, spatialVariables, &a)
	if err != nil {
		return nil, false, err
	}
	return SpatialField(e.eval), p.used["t"], nil
}

// curve parses an expression in its one variable, written t or x.
func curve(s string, a *float64) (Expr, error) {
	_, e, err := parse(s, curveVariables, a)
	if err != nil {
		return nil, err
	}
	return func(t float64) float64 { return e.eval(t, 0, 0, 0) }, nil
}

// Scalar accepts constants and arithmetic, but never a curve-dependent variable.
func Scalar(s string) (float64, error) {
	_, e, err := parse(s, nil, nil)
	if err != nil {
		return 0, err
	}
	v := e.eval(0, 0, 0, 0)
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, fmt.Errorf("expression must have a finite real value")
	}
	return v, nil
}

func parse(s string, variables map[string]int, parameter *float64) (*parser, *program, error) {
	p, e, err := parseTree(s, variables, parameter)
	if err != nil {
		return p, nil, err
	}
	return p, compile(e), nil
}

func parseTree(s string, variables map[string]int, parameter *float64) (*parser, *tree, error) {
	if len(s) > 1024 {
		return nil, nil, fmt.Errorf("expression exceeds 1024 characters")
	}
	p := &parser{s: strings.ToLower(s), variables: variables, used: map[string]bool{}, parameter: parameter}
	e, err := p.expression(0)
	p.space()
	if err == nil && p.pos != len(p.s) {
		err = fmt.Errorf("unexpected text at column %d; use * for multiplication", p.pos+1)
	}
	if err != nil {
		return p, nil, err
	}
	return p, e, nil
}

func (p *parser) space() {
	for p.pos < len(p.s) && unicode.IsSpace(rune(p.s[p.pos])) {
		p.pos++
	}
}
func (p *parser) expression(min int) (*tree, error) {
	p.depth++
	defer func() { p.depth-- }()
	if p.depth > 64 {
		return nil, fmt.Errorf("expression nesting exceeds 64")
	}
	p.space()
	if p.pos >= len(p.s) {
		return nil, fmt.Errorf("expected an expression")
	}
	var left *tree
	c := p.s[p.pos]
	p.pos++
	switch {
	case c == '+' || c == '-':
		e, err := p.expression(25)
		if err != nil {
			return nil, err
		}
		left = e
		if c == '-' {
			left = unary(opNeg, e, 0, 0)
		}
	case c == '(':
		e, err := p.expression(0)
		if err != nil {
			return nil, err
		}
		p.space()
		if p.pos >= len(p.s) || p.s[p.pos] != ')' {
			return nil, fmt.Errorf("expected closing parenthesis")
		}
		p.pos++
		left = e
	case c >= '0' && c <= '9' || c == '.':
		start := p.pos - 1
		for p.pos < len(p.s) && ((p.s[p.pos] >= '0' && p.s[p.pos] <= '9') || p.s[p.pos] == '.') {
			p.pos++
		}
		if p.pos < len(p.s) && p.s[p.pos] == 'e' {
			p.pos++
			if p.pos < len(p.s) && (p.s[p.pos] == '+' || p.s[p.pos] == '-') {
				p.pos++
			}
			for p.pos < len(p.s) && p.s[p.pos] >= '0' && p.s[p.pos] <= '9' {
				p.pos++
			}
		}
		v, err := strconv.ParseFloat(p.s[start:p.pos], 64)
		if err != nil {
			return nil, fmt.Errorf("invalid number")
		}
		left = constant(v)
	case c >= 'a' && c <= 'z':
		start := p.pos - 1
		for p.pos < len(p.s) && p.s[p.pos] >= 'a' && p.s[p.pos] <= 'z' {
			p.pos++
		}
		name := p.s[start:p.pos]
		switch name {
		case "t", "x", "y", "z":
			if p.variables == nil {
				return nil, fmt.Errorf("%s is not allowed in a constant expression", name)
			}
			k, ok := p.variables[name]
			if !ok {
				return nil, fmt.Errorf("unknown name %q", name)
			}
			p.used[name] = true
			left = &tree{op: opVar, index: uint8(k)}
		case "a":
			if p.parameter == nil {
				return nil, fmt.Errorf("a is only allowed in curve expressions")
			}
			left = constant(*p.parameter)
		case "pi":
			left = constant(math.Pi)
		case "e":
			left = constant(math.E)
		case "phi":
			left = constant((1 + math.Sqrt(5)) / 2)
		default:
			f, ok := functions[name]
			if !ok {
				return nil, fmt.Errorf("unknown name %q", name)
			}
			p.space()
			if p.pos >= len(p.s) || p.s[p.pos] != '(' {
				return nil, fmt.Errorf("%s requires parentheses", name)
			}
			p.pos++
			arg, err := p.expression(0)
			if err != nil {
				return nil, err
			}
			p.space()
			if p.pos >= len(p.s) || p.s[p.pos] != ')' {
				return nil, fmt.Errorf("expected closing parenthesis")
			}
			p.pos++
			left = unary(f, arg, 0, 0)
		}
	default:
		return nil, fmt.Errorf("unexpected character %q", c)
	}
	for {
		p.space()
		if p.pos >= len(p.s) {
			break
		}
		op := p.s[p.pos]
		prec := 0
		switch op {
		case '+', '-':
			prec = 10
		case '*', '/':
			prec = 20
		case '^':
			prec = 30
		}
		if prec == 0 || prec < min {
			break
		}
		p.pos++
		next := prec + 1
		if op == '^' {
			next = prec
		}
		right, err := p.expression(next)
		if err != nil {
			return nil, err
		}
		left = binary(arithmetic[op], left, right)
	}
	return left, nil
}
