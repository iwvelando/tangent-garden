//go:build js && wasm

package main

import (
	"encoding/json"
	"errors"
	"syscall/js"
	"tangentgarden/engine"
	"tangentgarden/engine/expr"
	"tangentgarden/engine3"
	"tangentgarden/engine4"
)

func main() {
	registerFourierFit()
	registerLoom()
	registerGarden()
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
			return refusal(err)
		}
		return liftReply(&result, `{"error":"non-finite tesseract result"}`, nil, nil, map[string]map[string]any{})
	})
	js.Global().Set("tangentGardenTesseract", hyper)

	var spatialEngine engine3.Engine
	spatial := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 {
			return `{"error":"expected one spatial JSON request"}`
		}
		var q engine3.Request
		err := json.Unmarshal([]byte(args[0].String()), &q)
		var result engine3.Result
		if err == nil {
			result, err = spatialEngine.Compute(q)
		}
		if err != nil {
			return refusal(err)
		}
		return meshReply(&result, `{"error":"non-finite spatial result"}`)
	})
	js.Global().Set("tangentGardenSpatial", spatial)
	spatialProbe := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 {
			return `{"error":"expected one spatial JSON request"}`
		}
		var q engine3.Request
		err := json.Unmarshal([]byte(args[0].String()), &q)
		// A surface probe's point, or else the curve probe's.
		var reply map[string]any
		if err == nil && q.SurfaceProbe != nil {
			var at *engine3.SurfaceDiagnostics
			if at, err = engine3.SurfaceProbeOnly(q); err == nil {
				reply = map[string]any{"surfaceProbe": at}
			}
		} else if err == nil {
			var at *engine3.ProbePoint
			if at, err = engine3.ProbeOnly(q); err == nil {
				reply = map[string]any{"probe": at}
			}
		}
		if err != nil {
			return refusal(err)
		}
		b, err := json.Marshal(reply)
		if err != nil {
			return `{"error":"non-finite probe"}`
		}
		return string(b)
	})
	js.Global().Set("tangentGardenSpatialProbe", spatialProbe)

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
			return refusal(err)
		}
		b, err := json.Marshal(result)
		if err != nil {
			return `{"error":"non-finite numerical result"}`
		}
		return string(b)
	})
	js.Global().Set("tangentGardenCompute", fn)
	probe := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 {
			return `{"error":"expected one JSON request"}`
		}
		var q engine.Request
		err := json.Unmarshal([]byte(args[0].String()), &q)
		var at *engine.ProbePoint
		if err == nil {
			at, err = engine.ProbeOnly(q)
		}
		if err != nil {
			return refusal(err)
		}
		b, err := json.Marshal(map[string]any{"probe": at})
		if err != nil {
			return `{"error":"non-finite probe"}`
		}
		return string(b)
	})
	js.Global().Set("tangentGardenProbe", probe)
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

// refusal is the reply to a request an engine refused. A validation error
// names its field, for the notebook to show beside that control.
func refusal(err error) string {
	reply := map[string]string{"error": err.Error()}
	var planar *engine.FieldError
	var spatial *engine3.FieldError
	var hyper *engine4.FieldError
	switch {
	case errors.As(err, &planar):
		reply["field"] = planar.Field
	case errors.As(err, &spatial):
		reply["field"] = spatial.Field
	case errors.As(err, &hyper):
		reply["field"] = hyper.Field
	}
	b, _ := json.Marshal(reply)
	return string(b)
}
