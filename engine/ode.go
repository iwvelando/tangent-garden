package engine

import "tangentgarden/engine/ode"

// The planar integrations share the dimension-free Dormand–Prince stepper.
type (
	odeFunc  = ode.Func
	solution = ode.Solution
)

var dormandPrince = ode.DormandPrince
