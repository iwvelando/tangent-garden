package engine4

import "fmt"

// FieldError is a validation error that names one request field by its
// JSON path, such as "lift.center.1" or "weave.alpha", so the notebook can
// show the message beside that field's control.
type FieldError struct {
	Field   string
	Message string
}

func (e *FieldError) Error() string { return e.Message }

func fieldErr(field, format string, args ...any) error {
	return &FieldError{field, fmt.Sprintf(format, args...)}
}
