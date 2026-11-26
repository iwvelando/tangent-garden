// Dirichlet modes of a circular membrane as an implicit study's field
// (docs/mathematics.md, Disk membrane modes).
import type { DiskMix, DiskMixResult, DiskMode, DiskResult } from "./types";
import { readout } from "./number-format";

// The engine's admitted indices and radius (engine/bessel.go,
// engine/disk_mode.go).
export const diskLimits = {
  order: [0, 12],
  ring: [1, 10],
  radius: [0.001, 10000],
} as const;

// The mode a study switching to a disk starts from: five diameters and two
// rings, in the unit disk.
export const defaultDisk: DiskMode = { order: 5, ring: 3, radius: 1 };

export const defaultDiskMix: DiskMix = {
  radius: 1,
  motion: "sweep",
  first: 1,
  second: 1,
  position: 0.5,
};

export const diskMixMotions = {
  sweep: {
    name: "Artistic coefficient sweep",
    position: "Blend fraction",
  },
  oscillation: {
    name: "Membrane oscillation",
    position: "Membrane time",
  },
} as const;

export function diskMixNote(mix: DiskMix, result: DiskMixResult) {
  const [a, b] = result.components.map((mode) => mode.coefficient);
  const name = diskMixMotions[mix.motion].name;
  return a === 0 && b === 0
    ? `${name}. Both coefficients are zero. The field is flat across the disk.`
    : `${name}. Current coefficients are A = ${readout(a)} and B = ${readout(b)}.`;
}

// What the mode is, from the engine's reply: its indices, eigenvalue and
// exact nodal set, short enough for the contour note.
export function diskNote(d: DiskResult) {
  const diameters =
    d.order === 0
      ? "no nodal diameters"
      : d.order === 1
        ? "one nodal diameter"
        : `${d.order} nodal diameters`;
  const circles =
    d.ring === 1
      ? "no nodal circle inside the boundary"
      : d.ring === 2
        ? "one nodal circle inside the boundary"
        : `${d.ring - 1} nodal circles inside the boundary`;
  return `Disk mode (m, k) = (${d.order}, ${d.ring}): ${diameters} and ${circles}; λ = (j/R)² = ${readout(d.eigenvalue)}, with j = ${readout(d.zero)}.`;
}
