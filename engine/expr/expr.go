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
type parser struct {
	s             string
	pos, depth    int
	allowVariable bool
	parameter     *float64
}

var functions = map[string]func(float64) float64{
	"sin": math.Sin, "cos": math.Cos, "tan": math.Tan, "asin": math.Asin, "acos": math.Acos, "atan": math.Atan,
	"sinh": math.Sinh, "cosh": math.Cosh, "tanh": math.Tanh, "sech": func(x float64) float64 { return 1 / math.Cosh(x) },
	"exp": math.Exp, "log": math.Log, "ln": math.Log, "sqrt": math.Sqrt, "abs": math.Abs,
}

func Parse(s string) (Expr, error) {
	return parse(s, true, nil)
}

// ParseWithParameter binds a numeric shape parameter without symbolic rewriting.
func ParseWithParameter(s string, a float64) (Expr, error) {
	if math.IsNaN(a) || math.IsInf(a, 0) {
		return nil, fmt.Errorf("shape parameter a must be finite")
	}
	return parse(s, true, &a)
}

// Scalar accepts constants and arithmetic, but never a curve-dependent variable.
func Scalar(s string) (float64, error) {
	e, err := parse(s, false, nil)
	if err != nil {
		return 0, err
	}
	v := e(0)
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, fmt.Errorf("expression must have a finite real value")
	}
	return v, nil
}

func parse(s string, allowVariable bool, parameter *float64) (Expr, error) {
	if len(s) > 1024 {
		return nil, fmt.Errorf("expression exceeds 1024 characters")
	}
	p := parser{s: strings.ToLower(s), allowVariable: allowVariable, parameter: parameter}
	e, err := p.expression(0)
	p.space()
	if err == nil && p.pos != len(p.s) {
		err = fmt.Errorf("unexpected text at column %d; use * for multiplication", p.pos+1)
	}
	return e, err
}
func (p *parser) space() {
	for p.pos < len(p.s) && unicode.IsSpace(rune(p.s[p.pos])) {
		p.pos++
	}
}
func (p *parser) expression(min int) (Expr, error) {
	p.depth++
	defer func() { p.depth-- }()
	if p.depth > 64 {
		return nil, fmt.Errorf("expression nesting exceeds 64")
	}
	p.space()
	if p.pos >= len(p.s) {
		return nil, fmt.Errorf("expected an expression")
	}
	var left Expr
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
			left = func(t float64) float64 { return -e(t) }
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
		left = func(float64) float64 { return v }
	case c >= 'a' && c <= 'z':
		start := p.pos - 1
		for p.pos < len(p.s) && p.s[p.pos] >= 'a' && p.s[p.pos] <= 'z' {
			p.pos++
		}
		name := p.s[start:p.pos]
		switch name {
		case "t", "x":
			if !p.allowVariable {
				return nil, fmt.Errorf("%s is not allowed in a constant expression", name)
			}
			left = func(t float64) float64 { return t }
		case "a":
			if p.parameter == nil {
				return nil, fmt.Errorf("a is only allowed in curve expressions")
			}
			value := *p.parameter
			left = func(float64) float64 { return value }
		case "pi":
			left = func(float64) float64 { return math.Pi }
		case "e":
			left = func(float64) float64 { return math.E }
		case "phi":
			left = func(float64) float64 { return (1 + math.Sqrt(5)) / 2 }
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
			left = func(t float64) float64 { return f(arg(t)) }
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
		a, b := left, right
		left = func(t float64) float64 {
			switch op {
			case '+':
				return a(t) + b(t)
			case '-':
				return a(t) - b(t)
			case '*':
				return a(t) * b(t)
			case '/':
				return a(t) / b(t)
			default:
				return math.Pow(a(t), b(t))
			}
		}
	}
	return left, nil
}
