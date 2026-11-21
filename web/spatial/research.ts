// Issue #406's research preview: ?research=406 in the address. Without it
// nothing of the scan reaches the app, its links or its gallery. Not a
// public feature: it does not merge as is.
export const eventScan =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("research") === "406";
