import { readout } from "./number-format";

export type RectangleMode = { aspect: number };
export type RectangleResult = {
  aspect: number;
  components: readonly [
    { m: number; n: number; eigenvalue: number; coefficient: number },
    { m: number; n: number; eigenvalue: number; coefficient: number },
  ];
};

export const rectangleAspectRange: [number, number] = [0.5, 2];
export const defaultRectangle: RectangleMode = { aspect: 1.5 };

export function rectangleNote(result: RectangleResult) {
  const [first, second] = result.components;
  return result.aspect === 1
    ? `The square modes (2, 3) and (3, 2) share one eigenvalue, λ = ${readout(first.eigenvalue)}.`
    : `An artistic blend of modes (2, 3) and (3, 2), with eigenvalues ${readout(first.eigenvalue)} and ${readout(second.eigenvalue)}.`;
}
