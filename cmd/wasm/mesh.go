//go:build js && wasm

package main

import (
	"syscall/js"
	"unsafe"

	"tangentgarden/engine3"
)

// meshReply moves an implicit mesh's arrays out of its JSON: they return
// as Float64Array and Int32Array views on one ArrayBuffer, the float64 and
// int32 values Go computed, which the worker can transfer without copying.
// The JSON keeps every other field, with null in place of each array.
// WebAssembly and every browser are little-endian, so the bytes are copied
// as they lie in memory.
func meshReply(m *engine3.ImplicitResult, encode func() (string, error)) any {
	floats := []struct {
		name   string
		values []float64
	}{{"positions", m.Positions}, {"normals", m.Normals}}
	ints := []struct {
		name   string
		values []int32
	}{{"triangles", m.Triangles}, {"cut", m.Cut}, {"open", m.Open}}
	size := 0
	for _, f := range floats {
		size += 8 * len(f.values)
	}
	for _, i := range ints {
		size += 4 * len(i.values)
	}
	buffer := js.Global().Get("ArrayBuffer").New(size)
	bytes := js.Global().Get("Uint8Array").New(buffer)
	reply := map[string]any{}
	// The float64 arrays come first, so every view is aligned.
	offset := 0
	view := func(name, kind string, raw []byte, count int) {
		js.CopyBytesToJS(bytes.Call("subarray", offset, offset+len(raw)), raw)
		reply[name] = js.Global().Get(kind).New(buffer, offset, count)
		offset += len(raw)
	}
	for _, f := range floats {
		view(f.name, "Float64Array", unsafe.Slice((*byte)(unsafe.Pointer(unsafe.SliceData(f.values))), 8*len(f.values)), len(f.values))
	}
	for _, i := range ints {
		view(i.name, "Int32Array", unsafe.Slice((*byte)(unsafe.Pointer(unsafe.SliceData(i.values))), 4*len(i.values)), len(i.values))
	}
	m.Positions, m.Normals, m.Triangles, m.Cut, m.Open = nil, nil, nil, nil, nil
	text, err := encode()
	if err != nil {
		return text
	}
	reply["json"] = text
	return js.ValueOf(reply)
}
