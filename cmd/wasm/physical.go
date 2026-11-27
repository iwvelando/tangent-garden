//go:build js && wasm

package main

import (
	"encoding/json"
	"errors"
	"runtime"
	"runtime/debug"
	"syscall/js"
	"unsafe"

	"tangentgarden/engine"
	"tangentgarden/physical"
)

// tangentGardenLaceSolid prepares a plaque from a lace study
// (physical.BuildLaceSolid) and replies { json, vertices, triangles,
// package }: the report as JSON, and the solid's float64 vertices (x, y, z
// each), int32 triangles and 3MF bytes as views on one ArrayBuffer for
// the worker to transfer. Nothing is retained between calls.
func registerPhysical() {
	js.Global().Set("tangentGardenLaceSolid", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 {
			return `{"error":"enter plaque settings"}`
		}
		// A soft limit makes the collector run before the heap doubles,
		// which WebAssembly memory, never returned, would otherwise keep.
		debug.SetMemoryLimit(physical.MemoryBudget)
		q, err := physical.ParseLaceSolidRequest([]byte(args[0].String()))
		var s *physical.LaceSolid
		if err == nil {
			s, err = physical.BuildLaceSolid(q, physical.DefaultLimits)
		}
		if err != nil {
			var fe *physical.FieldError
			if errors.As(err, &fe) {
				b, _ := json.Marshal(map[string]string{"error": fe.Message, "field": fe.Field})
				return string(b)
			}
			var le *engine.FieldError
			if errors.As(err, &le) {
				b, _ := json.Marshal(map[string]string{"error": le.Error(), "field": "lace." + le.Field})
				return string(b)
			}
			return refusal(err)
		}
		// The Go runtime's memory from the browser: WebAssembly memory only
		// grows, so after a build it is the peak the build reached.
		var mem runtime.MemStats
		runtime.ReadMemStats(&mem)
		s.Stats.Memory = mem.Sys
		text, err := json.Marshal(s)
		if err != nil {
			return `{"error":"nonfinite solid report"}`
		}
		v, t, p := s.Solid.V, s.Solid.T, s.Package
		size := 8*len(v) + 4*len(t) + len(p)
		buffer := js.Global().Get("ArrayBuffer").New(size)
		bytes := js.Global().Get("Uint8Array").New(buffer)
		offset := 0
		put := func(raw []byte) int {
			at := offset
			js.CopyBytesToJS(bytes.Call("subarray", offset, offset+len(raw)), raw)
			offset += len(raw)
			return at
		}
		vat := put(unsafe.Slice((*byte)(unsafe.Pointer(unsafe.SliceData(v))), 8*len(v)))
		tat := put(unsafe.Slice((*byte)(unsafe.Pointer(unsafe.SliceData(t))), 4*len(t)))
		pat := put(p)
		return js.ValueOf(map[string]any{
			"json":      string(text),
			"vertices":  js.Global().Get("Float64Array").New(buffer, vat, len(v)),
			"triangles": js.Global().Get("Int32Array").New(buffer, tat, len(t)),
			"package":   js.Global().Get("Uint8Array").New(buffer, pat, len(p)),
		})
	}))
}
