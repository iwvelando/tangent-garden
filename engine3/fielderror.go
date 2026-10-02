package engine3

import (
	"fmt"
	"math"
)

// FieldError is a validation error that names one request field by its
// JSON path, such as "unwinding.offset" or "harmonic.terms.0.cosine.x",
// so the notebook can show the message beside that field's control.
type FieldError struct {
	Field   string
	Message string
}

func (e *FieldError) Error() string { return e.Message }

func fieldErr(field, format string, args ...any) error {
	return &FieldError{field, fmt.Sprintf(format, args...)}
}

// named gives an existing error the field it is about.
func named(field string, err error) error {
	if err == nil {
		return nil
	}
	return &FieldError{field, err.Error()}
}

// axis names the first coordinate of v that ok refuses, under prefix; x
// when each passes on its own, as for a zero vector.
func axis(prefix string, v Vec3, ok func(float64) bool) string {
	switch {
	case !ok(v.X):
		return prefix + ".x"
	case !ok(v.Y):
		return prefix + ".y"
	case !ok(v.Z):
		return prefix + ".z"
	}
	return prefix + ".x"
}

// ends names the end of a domain or range that domain refuses: its start
// when the start is out of bounds by itself, and otherwise its end.
func ends(start, end string, lo float64) string {
	if !finite(lo) || math.Abs(lo) > 1e6 {
		return start
	}
	return end
}

// scalarBounded is bounded, for validators that shadow it with a vector test.
var scalarBounded = bounded

func poleBounded(p Vec3) bool { return p.valid() && bounded(p.X) && bounded(p.Y) && bounded(p.Z) }

var boxFields = [6]string{"xMin", "xMax", "yMin", "yMax", "zMin", "zMax"}
