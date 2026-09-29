import type {
  CausticSheet,
  FocalShape,
  RaysConfig,
  RaysResult,
  ReceiverResult,
} from "./types";

const shapes: Record<Exclude<FocalShape, "none">, string> = {
  surface: "a surface",
  curve: "a curve",
  point: "a point",
};
const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
// A share never rounds to nothing or to everything unless it is.
const percent = (part: number, whole: number) =>
  part > 0 && part < 5e-4 * whole
    ? "under 0.1%"
    : part < whole && part > (1 - 5e-4) * whole
      ? "over 99.9%"
      : `${((100 * part) / whole).toFixed(1)}%`;
// The plane's cyclic coordinates, as Go orders them.
export const receiverAxes = {
  x: ["y", "z"],
  y: ["z", "x"],
  z: ["x", "y"],
} as const;
// Where each caustic branch is real and virtual and what each part spans,
// and every sample left without an outgoing ray, with why.
export function raysNote(r: RaysResult, light: RaysConfig): string[] {
  const refracting = light.interaction === "refract";
  const surface = refracting ? "the interface" : "the mirror";
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
        ? `is real where the rays converge (${real}) and virtual, behind ${surface}, where they diverge (${virtual})`
        : real
          ? `is real, ahead of ${surface}: ${real}`
          : virtual
            ? `is virtual, behind ${surface}: ${virtual}`
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
          `${count(r.unlit, "sample is", "samples are")} unlit: the light grazes ${surface} there or arrives behind its ${refracting ? "incident" : "mirror"} side.`,
        ]
      : []),
    ...(r.total
      ? [
          `${count(r.total, "sample is", "samples are")} at or beyond the critical angle, where sin θ₁ ≥ n₂/n₁: nothing is transmitted, and their rays are drawn totally reflected, in grey.`,
        ]
      : []),
    ...(r.singular
      ? [
          `${count(r.singular, "sample is a chart singularity", "samples are chart singularities")}, with no normal and no ${refracting ? "refraction" : "reflection"}.`,
        ]
      : []),
    ...(r.atSource
      ? [
          `${count(r.atSource, "sample lies", "samples lie")} at the source, with no incident direction.`,
        ]
      : []),
    ...(r.stigmatic
      ? [
          `${count(r.stigmatic, "sample is", "samples are")} stigmatic (μ₁ = μ₂): the outgoing wavefront bends equally every way there, and the two caustics meet.`,
        ]
      : []),
    ...(r.receiver ? receiverNote(r.receiver, light) : []),
  ];
}

// Where the light went, and what the receiver's shade means.
export function receiverNote(g: ReceiverResult, light: RaysConfig): string[] {
  const plane = `${g.plane} = ${light.receiver.at.toLocaleString()}`;
  if (!(g.emitted > 0))
    return [
      `No light reaches the surface, so the receiver on ${plane} is dark.`,
    ];
  const parallel = light.light === "parallel";
  const lost = (
    [
      [g.outside, "lands on the plane outside the window"],
      [g.away, "never crosses the plane ahead of its rays"],
      [g.total, "is totally reflected"],
      [g.edge, "falls in cells at the edge of the light"],
    ] as const
  )
    .filter(([flux]) => flux > 1e-12 * g.emitted)
    .map(([flux, where]) => `${percent(flux, g.emitted)} ${where}`);
  const received = `The receiver on ${plane} collects ${percent(g.received, g.emitted)} of the ${
    parallel
      ? `light the surface intercepts (${g.emitted.toPrecision(3)} units of beam area)`
      : `lamp's light the surface intercepts (${g.emitted.toPrecision(3)} sr)`
  }${
    lost.length
      ? `; ${lost.length > 1 ? `${lost.slice(0, -1).join(", ")} and ${lost.at(-1)}` : lost[0]}`
      : ""
  }.`;
  return [
    received,
    g.peak > 0
      ? `Its shade is irradiance on a logarithmic scale over three decades up to its peak, ${g.peak.toPrecision(3)} ${
          parallel ? "times the beam's own" : "per unit area at unit intensity"
        }, averaged over each bin, with no Fresnel losses or shadows.`
      : "No light lands in its window.",
  ];
}
