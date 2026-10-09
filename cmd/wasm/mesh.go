//go:build js && wasm

package main

import (
	"syscall/js"
	"unsafe"

	"tangentgarden/engine3"
)

// meshReply moves a spatial result's meshes out of its JSON: they return as
// Float64Array and Int32Array views on one ArrayBuffer, the float64 and
// int32 values Go computed, which the worker can transfer without copying.
// The reply is { json, mesh, implicit }: mesh holds the curve study's
// indexed triangles (engine3.CurveMesh: vertices, seven numbers each,
// triangles, and sampleIndex, one per triangle), and implicit, only for an
// implicit surface, its positions, normals, triangles, cut and open. The
// JSON keeps every other field, with null in place of each array.
// WebAssembly and every browser are little-endian, so the bytes are copied
// as they lie in memory.
func meshReply(result *engine3.Result, encode func() (string, error)) any {
	type floats struct {
		group, name string
		values      []float64
	}
	type ints struct {
		group, name string
		values      []int32
	}
	fs := []floats{{"mesh", "vertices", result.Mesh.Vertices}}
	is := []ints{{"mesh", "triangles", result.Mesh.Triangles}, {"mesh", "sampleIndex", result.Mesh.SampleIndex}}
	if m := result.Implicit; m != nil {
		fs = append(fs, floats{"implicit", "positions", m.Positions}, floats{"implicit", "normals", m.Normals})
		is = append(is, ints{"implicit", "triangles", m.Triangles}, ints{"implicit", "cut", m.Cut}, ints{"implicit", "open", m.Open})
	}
	size := 0
	for _, f := range fs {
		size += 8 * len(f.values)
	}
	for _, i := range is {
		size += 4 * len(i.values)
	}
	buffer := js.Global().Get("ArrayBuffer").New(size)
	bytes := js.Global().Get("Uint8Array").New(buffer)
	groups := map[string]map[string]any{"mesh": {}}
	if result.Implicit != nil {
		groups["implicit"] = map[string]any{}
	}
	// The float64 arrays come first, so every view is aligned.
	offset := 0
	view := func(group, name, kind string, raw []byte, count int) {
		js.CopyBytesToJS(bytes.Call("subarray", offset, offset+len(raw)), raw)
		groups[group][name] = js.Global().Get(kind).New(buffer, offset, count)
		offset += len(raw)
	}
	for _, f := range fs {
		view(f.group, f.name, "Float64Array", unsafe.Slice((*byte)(unsafe.Pointer(unsafe.SliceData(f.values))), 8*len(f.values)), len(f.values))
	}
	for _, i := range is {
		view(i.group, i.name, "Int32Array", unsafe.Slice((*byte)(unsafe.Pointer(unsafe.SliceData(i.values))), 4*len(i.values)), len(i.values))
	}
	result.Mesh = engine3.CurveMesh{}
	if m := result.Implicit; m != nil {
		m.Positions, m.Normals, m.Triangles, m.Cut, m.Open = nil, nil, nil, nil, nil
	}
	text, err := encode()
	if err != nil {
		return text
	}
	reply := map[string]any{"json": text}
	for name, group := range groups {
		reply[name] = group
	}
	return js.ValueOf(reply)
}
