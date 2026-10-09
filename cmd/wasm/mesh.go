//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"unsafe"

	"tangentgarden/cmd/wasm/lift"
	"tangentgarden/engine3"
)

// Float arrays and int arrays bound for one buffer, each under a group and
// a name in the reply.
type floats struct {
	group, name string
	values      []float64
}
type ints struct {
	group, name string
	values      []int32
}

// meshReply moves a spatial result's meshes and large numeric arrays out
// of its JSON: they return as Float64Array and Int32Array views on one
// ArrayBuffer, the float64 and int32 values Go computed, which the worker
// can transfer without copying. The reply is { json, mesh, implicit,
// lifted }: mesh holds the curve study's indexed triangles
// (engine3.CurveMesh: vertices, seven numbers each, triangles, and
// sampleIndex, one per triangle), implicit, only for an implicit surface,
// its positions, normals, triangles, cut and open, and lifted the result's
// other large arrays (see liftReply). The JSON keeps every other field,
// with null in place of each array. WebAssembly and every browser are
// little-endian, so the bytes are copied as they lie in memory.
func meshReply(result *engine3.Result, refused string) any {
	fs := []floats{{"mesh", "vertices", result.Mesh.Vertices}}
	is := []ints{{"mesh", "triangles", result.Mesh.Triangles}, {"mesh", "sampleIndex", result.Mesh.SampleIndex}}
	groups := map[string]map[string]any{"mesh": {}}
	if m := result.Implicit; m != nil {
		fs = append(fs, floats{"implicit", "positions", m.Positions}, floats{"implicit", "normals", m.Normals})
		is = append(is, ints{"implicit", "triangles", m.Triangles}, ints{"implicit", "cut", m.Cut}, ints{"implicit", "open", m.Open})
		groups["implicit"] = map[string]any{}
		m.Positions, m.Normals, m.Triangles, m.Cut, m.Open = nil, nil, nil, nil, nil
	}
	result.Mesh = engine3.CurveMesh{}
	return liftReply(result, refused, fs, is, groups)
}

// liftReply encodes result as JSON beside typed views on one ArrayBuffer:
// the arrays fs and is, which the caller has already taken out of result,
// and the result's large numeric arrays, which lift.Lift takes out (see
// cmd/wasm/lift). The lifted floats arrive as lifted.floats, with
// lifted.places, JSON, saying where each array goes back; the page puts
// them back (web/lifted.ts). A result lift or JSON refuses, holding a NaN
// or an infinity, is refused with the message refused.
func liftReply(result any, refused string, fs []floats, is []ints, groups map[string]map[string]any) any {
	values, places, err := lift.Lift(result)
	if err != nil {
		return refused
	}
	where, err := json.Marshal(places)
	if err != nil {
		return refused
	}
	text, err := json.Marshal(result)
	if err != nil {
		return refused
	}
	fs = append(fs, floats{"lifted", "floats", values})
	groups["lifted"] = map[string]any{"places": string(where)}
	size := 0
	for _, f := range fs {
		size += 8 * len(f.values)
	}
	for _, i := range is {
		size += 4 * len(i.values)
	}
	buffer := js.Global().Get("ArrayBuffer").New(size)
	bytes := js.Global().Get("Uint8Array").New(buffer)
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
	reply := map[string]any{"json": string(text)}
	for name, group := range groups {
		reply[name] = group
	}
	return js.ValueOf(reply)
}
