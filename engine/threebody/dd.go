package threebody

import "math"

// dd is a double-double number, hi + lo with |lo| ≤ ulp(hi)/2: about 106
// significant bits. The error-free sums use additions only, and products
// use math.FMA, which is exact on every architecture. Every other product is
// converted to float64 explicitly: Go may otherwise fuse it with a later
// addition (it does on arm64, even across inlined calls), which breaks the
// error-free transformations.
type dd struct{ hi, lo float64 }

func ddFrom(x float64) dd { return dd{x, 0} }

func twoSum(a, b float64) (float64, float64) {
	s := a + b
	bb := s - a
	return s, (a - (s - bb)) + (b - bb)
}

func quickTwoSum(a, b float64) (float64, float64) {
	s := a + b
	return s, b - (s - a)
}

func twoProd(a, b float64) (float64, float64) {
	p := float64(a * b)
	return p, math.FMA(a, b, -p)
}

func (a dd) Add(b dd) dd {
	s, e := twoSum(a.hi, b.hi)
	t, f := twoSum(a.lo, b.lo)
	e += t
	s, e = quickTwoSum(s, e)
	e += f
	s, e = quickTwoSum(s, e)
	return dd{s, e}
}

func (a dd) Sub(b dd) dd { return a.Add(dd{-b.hi, -b.lo}) }

func (a dd) Mul(b dd) dd {
	p, e := twoProd(a.hi, b.hi)
	e += float64(a.hi*b.lo) + float64(a.lo*b.hi)
	p, e = quickTwoSum(p, e)
	return dd{p, e}
}

func (a dd) Scale(c float64) dd {
	p, e := twoProd(a.hi, c)
	e += float64(a.lo * c)
	p, e = quickTwoSum(p, e)
	return dd{p, e}
}

// Div refines the float64 quotient twice by the remainder.
func (a dd) Div(b dd) dd {
	q1 := a.hi / b.hi
	r := a.Sub(b.Scale(q1))
	q2 := r.hi / b.hi
	r = r.Sub(b.Scale(q2))
	q3 := r.hi / b.hi
	s, e := quickTwoSum(q1, q2)
	return dd{s, e}.Add(dd{q3, 0})
}

// Sqrt refines the float64 root by one Newton step: x + (a − x²)/(2x).
func (a dd) Sqrt() dd {
	if a.hi <= 0 {
		return dd{math.Sqrt(a.hi), 0}
	}
	x := math.Sqrt(a.hi)
	r := a.Sub(dd{x, 0}.Mul(dd{x, 0}))
	return dd{x, 0}.Add(dd{r.hi / float64(2*x), 0})
}

func (a dd) Float() float64 { return a.hi + a.lo }
