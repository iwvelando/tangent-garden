//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"tangentgarden/engine"
	"tangentgarden/engine/expr"
	"tangentgarden/engine3"
	"tangentgarden/engine4"
)

func main() {
	hyper := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 {
			return `{"error":"expected one tesseract JSON request"}`
		}
		var q engine4.Request
		err := json.Unmarshal([]byte(args[0].String()), &q)
		var result engine4.Result
		if err == nil {
			result, err = engine4.Compute(q)
		}
		if err != nil {
			b, _ := json.Marshal(map[string]string{"error": err.Error()})
			return string(b)
		}
		b, err := json.Marshal(result)
		if err != nil {
			return `{"error":"non-finite tesseract result"}`
		}
		return string(b)
	})
	js.Global().Set("tangentGardenTesseract", hyper)

	spatial := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 {
			return `{"error":"expected one spatial JSON request"}`
		}
		var q engine3.Request
		err := json.Unmarshal([]byte(args[0].String()), &q)
		var result engine3.Result
		if err == nil {
			result, err = engine3.Compute(q)
		}
		if err != nil {
			b, _ := json.Marshal(map[string]string{"error": err.Error()})
			return string(b)
		}
		b, err := json.Marshal(result)
		if err != nil {
			return `{"error":"non-finite spatial result"}`
		}
		return string(b)
	})
	js.Global().Set("tangentGardenSpatial", spatial)

	fn := js.FuncOf(func(this js.Value, args []js.Value) any {
		var q engine.Request
		var result engine.Result
		var err error
		if len(args) != 1 {
			return `{"error":"expected one JSON request"}`
		}
		err = json.Unmarshal([]byte(args[0].String()), &q)
		if err == nil {
			result, err = engine.Compute(q)
		}
		if err != nil {
			b, _ := json.Marshal(map[string]string{"error": err.Error()})
			return string(b)
		}
		b, err := json.Marshal(result)
		if err != nil {
			return `{"error":"non-finite numerical result"}`
		}
		return string(b)
	})
	js.Global().Set("tangentGardenCompute", fn)
	scalars := js.FuncOf(func(this js.Value, args []js.Value) any {
		var expressions []string
		if len(args) != 1 {
			return `{"error":"expected scalar expressions"}`
		}
		err := json.Unmarshal([]byte(args[0].String()), &expressions)
		if len(expressions) > 64 {
			return `{"error":"too many scalar expressions"}`
		}
		values := make([]float64, len(expressions))
		if err == nil {
			for i, s := range expressions {
				values[i], err = expr.Scalar(s)
				if err != nil {
					break
				}
			}
		}
		if err != nil {
			b, _ := json.Marshal(map[string]string{"error": err.Error()})
			return string(b)
		}
		b, _ := json.Marshal(map[string]any{"values": values})
		return string(b)
	})
	js.Global().Set("tangentGardenScalars", scalars)
	select {}
}
