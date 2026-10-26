// A numeric field of a notebook configuration, addressed by its path, as the
// notebook's scalar fields and the journey's experiment controls edit it.
export function getIn(config: object, path: string[]): number {
  return path.reduce<any>((o, k) => o?.[k], config) ?? 0;
}
export function setIn<C extends object>(
  config: C,
  path: string[],
  value: number,
): C {
  const next = structuredClone(config);
  const parent = path.slice(0, -1).reduce<any>((o, k) => o[k], next);
  parent[path.at(-1)!] = value;
  return next;
}
