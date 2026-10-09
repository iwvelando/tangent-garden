// Package lift moves an engine result's large numeric arrays out of its
// JSON, for the WebAssembly bridge (cmd/wasm): encoding numbers as text in
// Go and parsing them back in the browser costs far more than copying their
// float64 bytes. The page puts each array back where it was
// (web/lifted.ts), as the values JSON would have delivered, so nothing that
// reads a result changes. This is transport only: it changes no engine
// type and no value.
package lift

import (
	"errors"
	"math"
	"reflect"
	"strings"
	"sync"
	"unsafe"

	"tangentgarden/engine3"
)

// Place says where a lifted array goes back: its JSON path from the
// result's root (object keys and array indices), its kind, where its
// floats start, and its length, or for an array of arrays each row's
// length, -1 for a null row.
//
// Kinds: "point" is an engine3 *Vec3, {x, y, z} or null (three NaN);
// "vector" an engine3 Vec3; "triple" a [3]float64, such as an engine4
// Vec3, [x, y, z]; "quad" a [4]float64, such as an engine4 Vec4;
// "number" a float64; "maybe" a *float64, a number or null (NaN).
type Place struct {
	Path   []any  `json:"path"`
	Kind   string `json:"kind"`
	Offset int    `json:"offset"`
	Count  int    `json:"count,omitempty"`
	Rows   []int  `json:"rows,omitempty"`
}

// minimum is the fewest floats worth lifting: shorter arrays stay in the
// JSON, where they cost less than their place would.
const minimum = 32

// errNonFinite matches json.Marshal, which refuses a NaN or an infinity.
var errNonFinite = errors.New("non-finite number")

var (
	vec3   = reflect.TypeOf(engine3.Vec3{})
	number = reflect.TypeOf(0.0)
)

// kind is the kind of a slice element type that lifts, or "".
func kind(t reflect.Type) string {
	switch t {
	case vec3:
		// Three float64 fields, laid out as three consecutive float64.
		return "vector"
	case reflect.PointerTo(vec3):
		return "point"
	case number:
		return "number"
	case reflect.PointerTo(number):
		return "maybe"
	}
	if t.Kind() == reflect.Array && t.Elem() == number {
		switch t.Len() {
		case 3:
			return "triple"
		case 4:
			return "quad"
		}
	}
	return ""
}

// Lift moves every large numeric array in the value result points to into
// one float64 slice, setting each to nil, so that it encodes as null, and
// says where each goes back. It looks through structs (including embedded
// ones, whose fields JSON lifts to the parent), pointers, slices and arrays,
// not interfaces, which engine results do not use. It lifts slices, and
// slices of slices, of the kinds Place lists, holding at least minimum
// floats. A field marked omitempty loses its key when it is lifted, and the
// page adds it back. A NaN or an infinity in a lifted array refuses the
// result, as encoding it would.
func Lift(result any) ([]float64, []Place, error) {
	l := &lifter{places: []Place{}}
	if err := l.walk(reflect.ValueOf(result)); err != nil {
		return nil, nil, err
	}
	return l.floats, l.places, nil
}

type lifter struct {
	floats []float64
	places []Place
	// path is the JSON path to the value being looked through.
	path []key
}

// key is an object key, or with no name an array index.
type key struct {
	name  string
	index int
}

func (l *lifter) walk(v reflect.Value) error {
	switch v.Kind() {
	case reflect.Pointer:
		if v.IsNil() {
			return nil
		}
		return l.walk(v.Elem())
	case reflect.Struct:
		return l.fields(v)
	case reflect.Slice:
		if v.IsNil() {
			return nil
		}
		// A slice that lifts holds nothing else, lifted or too short.
		if liftable(v.Type()) != "" {
			return l.lift(v)
		}
		fallthrough
	case reflect.Array:
		// Grids of flags or indices hold nothing to lift.
		if !holds(v.Type().Elem()) {
			return nil
		}
		n := len(l.path)
		for k := 0; k < v.Len(); k++ {
			l.path = append(l.path[:n], key{index: k})
			if err := l.walk(v.Index(k)); err != nil {
				return err
			}
		}
		l.path = l.path[:n]
	}
	return nil
}

func (l *lifter) fields(v reflect.Value) error {
	n := len(l.path)
	for _, f := range plan(v.Type()) {
		l.path = l.path[:n]
		if f.name != "" {
			l.path = append(l.path, key{name: f.name})
		}
		if err := l.walk(v.Field(f.index)); err != nil {
			return err
		}
	}
	l.path = l.path[:n]
	return nil
}

// A field of a struct to look through: its JSON name, or "" for an
// embedded struct whose fields JSON puts at its parent's level.
type field struct {
	index int
	name  string
}

var plans = map[reflect.Type][]field{}

// plan lists the fields of struct type t that JSON encodes and that can
// hold an array to lift, worked out once per type.
func plan(t reflect.Type) []field {
	holding.Lock()
	defer holding.Unlock()
	if p, ok := plans[t]; ok {
		return p
	}
	p := []field{}
	for k := 0; k < t.NumField(); k++ {
		f := t.Field(k)
		tag := f.Tag.Get("json")
		if tag == "-" || !holdsLocked(f.Type) {
			continue
		}
		name, _, _ := strings.Cut(tag, ",")
		// An unexported embedded struct's fields cannot be set: they stay.
		if f.Anonymous && name == "" {
			if f.IsExported() && (f.Type.Kind() == reflect.Struct || (f.Type.Kind() == reflect.Pointer && f.Type.Elem().Kind() == reflect.Struct)) {
				p = append(p, field{k, ""})
			}
			continue
		}
		if !f.IsExported() {
			continue
		}
		if name == "" {
			name = f.Name
		}
		p = append(p, field{k, name})
	}
	plans[t] = p
	return p
}

var (
	holding sync.Mutex
	held    = map[reflect.Type]bool{}
)

// holds reports whether a value of type t can contain an array that lifts.
func holds(t reflect.Type) bool {
	holding.Lock()
	defer holding.Unlock()
	return holdsLocked(t)
}

func holdsLocked(t reflect.Type) bool {
	if h, ok := held[t]; ok {
		return h
	}
	// A type that contains itself (a 4D result's companion) is assumed to
	// hold one while it is being looked through.
	held[t] = true
	h := false
	switch t.Kind() {
	case reflect.Pointer, reflect.Array:
		h = holdsLocked(t.Elem())
	case reflect.Slice:
		h = liftable(t) != "" || holdsLocked(t.Elem())
	case reflect.Struct:
		for k := 0; k < t.NumField() && !h; k++ {
			h = holdsLocked(t.Field(k).Type)
		}
	}
	held[t] = h
	return h
}

// liftable is the kind of a slice, or slice of slices, that lifts, or "".
func liftable(t reflect.Type) string {
	if t.Kind() != reflect.Slice {
		return ""
	}
	if k := kind(t.Elem()); k != "" {
		return k
	}
	if t.Elem().Kind() == reflect.Slice {
		return kind(t.Elem().Elem())
	}
	return ""
}

// lift moves the slice v, which lifts, if it is long enough.
func (l *lifter) lift(v reflect.Value) error {
	k := liftable(v.Type())
	per := width(k)
	nested := kind(v.Type().Elem()) == ""
	count := v.Len()
	if nested {
		count = 0
		for r := 0; r < v.Len(); r++ {
			count += v.Index(r).Len()
		}
	}
	if per*count < minimum {
		return nil
	}
	p := Place{Path: make([]any, len(l.path)), Kind: k, Offset: len(l.floats)}
	for j, key := range l.path {
		if p.Path[j] = key.index; key.name != "" {
			p.Path[j] = key.name
		}
	}
	if nested {
		p.Rows = make([]int, v.Len())
		for r := range p.Rows {
			row := v.Index(r)
			if row.IsNil() {
				p.Rows[r] = -1
				continue
			}
			p.Rows[r] = row.Len()
			if err := l.items(row, k); err != nil {
				return err
			}
		}
	} else {
		p.Count = count
		if err := l.items(v, k); err != nil {
			return err
		}
	}
	l.places = append(l.places, p)
	v.Set(reflect.Zero(v.Type()))
	return nil
}

// items appends the floats of a slice of kind k.
func (l *lifter) items(v reflect.Value, k string) error {
	nan, start := math.NaN(), len(l.floats)
	switch k {
	case "vector", "triple", "quad", "number":
		// Each of these lies in memory as consecutive float64 values.
		l.floats = append(l.floats, unsafe.Slice((*float64)(v.UnsafePointer()), width(k)*v.Len())...)
	case "point":
		for _, p := range v.Interface().([]*engine3.Vec3) {
			if p == nil {
				l.floats = append(l.floats, nan, nan, nan)
				continue
			}
			if !finite(p.X) || !finite(p.Y) || !finite(p.Z) {
				return errNonFinite
			}
			l.floats = append(l.floats, p.X, p.Y, p.Z)
		}
		return nil
	case "maybe":
		for _, p := range v.Interface().([]*float64) {
			if p == nil {
				l.floats = append(l.floats, nan)
				continue
			}
			if !finite(*p) {
				return errNonFinite
			}
			l.floats = append(l.floats, *p)
		}
		return nil
	}
	// Every float of the kinds without a null is checked here.
	for _, x := range l.floats[start:] {
		if !finite(x) {
			return errNonFinite
		}
	}
	return nil
}

// width is the number of floats in one item of kind k.
func width(k string) int {
	switch k {
	case "number", "maybe":
		return 1
	case "quad":
		return 4
	}
	return 3
}

func finite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }
