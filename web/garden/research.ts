// Issue #385's research preview: ?research=385 in the address. Without it
// the garden, its examples and its links behave as on main.
export const gardenResearch =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("research") === "385";
