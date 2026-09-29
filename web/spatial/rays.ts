import type { CausticSheet, FocalShape, RaysResult } from "./types";

const shapes: Record<Exclude<FocalShape, "none">, string> = {
  surface: "a surface",
  curve: "a curve",
  point: "a point",
};
const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
// Where each caustic branch is real and virtual and what each part spans,
// and every sample left without a reflection, with why.
export function raysNote(r: RaysResult): string[] {
  const branch = (b: 1 | 2) => {
    const find = (virtual: boolean) =>
      r.caustics.find((c) => c.branch === b && c.virtual === virtual)!;
    const [real, virtual] = [find(false), find(true)].map((c: CausticSheet) =>
      c.shape === "none" ? "" : shapes[c.shape],
    );
    const name = `Caustic ${b} (μ${b === 1 ? "₁" : "₂"})`;
    const clipped = r.clipped[b - 1];
    const where =
      real && virtual
        ? `is real where the rays converge (${real}) and virtual, behind the mirror, where they diverge (${virtual})`
        : real
          ? `is real, ahead of the mirror: ${real}`
          : virtual
            ? `is virtual, behind the mirror: ${virtual}`
            : "lies wholly at infinity";
    return `${name} ${where}${
      clipped && (real || virtual)
        ? `; at ${count(clipped, "sample", "samples")} it is beyond 100 surface radii, treated as at infinity`
        : ""
    }.`;
  };
  return [
    branch(1),
    branch(2),
    ...(r.unlit
      ? [
          `${count(r.unlit, "sample is", "samples are")} unlit: the light grazes the mirror there or arrives behind its mirror side.`,
        ]
      : []),
    ...(r.singular
      ? [
          `${count(r.singular, "sample is a chart singularity", "samples are chart singularities")}, with no normal and no reflection.`,
        ]
      : []),
    ...(r.atSource
      ? [
          `${count(r.atSource, "sample lies", "samples lie")} at the source, with no incident direction.`,
        ]
      : []),
    ...(r.stigmatic
      ? [
          `${count(r.stigmatic, "sample is", "samples are")} stigmatic (μ₁ = μ₂): the reflected wavefront bends equally every way there, and the two caustics meet.`,
        ]
      : []),
  ];
}
