package engine

import (
	"errors"
	"fmt"
	"math"
)

// FieldError is a validation error that names one request field by its
// JSON path, such as "curve.roulette.radius" or "curve.terms.0.phase", so
// the notebook can show the message beside that field's control.
type FieldError struct {
	Field   string
	Message string
}

func (e *FieldError) Error() string { return e.Message }

func fieldErr(field, format string, args ...any) error {
	return &FieldError{field, fmt.Sprintf(format, args...)}
}

// within places a validator's field under prefix, the path of the value it
// validated, keeping the message; an error naming no field is unchanged.
func within(prefix string, err error) error {
	var named *FieldError
	if !errors.As(err, &named) {
		return err
	}
	return &FieldError{prefix + "." + named.Field, err.Error()}
}

// coordinate names the first coordinate of p that ok refuses, under
// prefix; x when each passes on its own.
func coordinate(prefix string, p Vec, ok func(float64) bool) string {
	if ok(p.X) {
		return prefix + ".y"
	}
	return prefix + ".x"
}

// bound is a coordinate within ±limit.
func bound(limit float64) func(float64) bool {
	return func(x float64) bool { return finite(x) && math.Abs(x) <= limit }
}
