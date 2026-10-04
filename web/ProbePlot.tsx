import { plotScale } from "./probe";

// Four significant figures, as the probe's readouts give them.
const short = (v: number) => String(Number(v.toPrecision(4)));
const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
const width = 240,
  height = 44;

// One diagnostic along the whole curve, broken where it is undefined, with
// the probe's sample marked in its ink. Geometry only: its range is stated
// beside it. Variation within resolution is drawn as constant (see
// plotScale).
export function ProbePlot({
  values,
  fromZero,
  at,
  label,
  ink,
  resolution,
  captionClass = "probe-caption",
}: {
  values: (number | null)[];
  fromZero: boolean;
  at: number;
  label: string;
  ink: string;
  resolution?: number;
  captionClass?: string;
}) {
  const { lo, hi, runs, pinned, constant } = plotScale(
    values,
    fromZero,
    resolution,
  );
  if (!runs.length)
    return (
      <p className={captionClass}>{label} is undefined at every sample.</p>
    );
  const n = Math.max(1, values.length - 1);
  const x = (i: number) => (i / n) * width;
  const y = (v: number) => 2 + (1 - (v - lo) / (hi - lo)) * (height - 4);
  return (
    <figure className="probe-plot">
      <figcaption>
        {constant !== null
          ? `${label}: constant at ${short(constant)}`
          : `${label} from ${short(lo)} to ${short(hi)}`}
        {pinned > 0 &&
          `; ${count(pinned, "sample", "samples")} beyond, pinned to the edge`}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {lo < 0 && hi > 0 && (
          <line className="probe-zero" x1={0} x2={width} y1={y(0)} y2={y(0)} />
        )}
        {runs.map((run, k) => (
          <polyline
            key={k}
            className="probe-series"
            points={run.map(([i, v]) => `${x(i)},${y(v)}`).join(" ")}
          />
        ))}
        <line
          x1={x(at)}
          x2={x(at)}
          y1={0}
          y2={height}
          stroke={ink}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}
