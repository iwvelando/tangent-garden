import { useEffect, useState } from "react";
import { axisInks } from "./palette";
import { namedViews, type Basis, type NamedView } from "./named-views";

// The orientation indicator and named views beside a turntable drawing (3D
// and 4D). It sits outside the drawing, which carries geometry only: each
// coordinate axis is drawn as the drawing shows its direction, x, y and z
// in the 4D notebook's axis inks, nearer axes over farther ones. An axis
// within about 14° of the line of sight is drawn end on, as a dot toward
// the viewer or a ring away.
const radius = 15;
const endOn = 0.25;
export function Orientation({
  basis,
  dark,
  disabled = false,
  onTurn,
}: {
  basis: Basis;
  dark: boolean;
  disabled?: boolean;
  onTurn: (name: NamedView) => void;
}) {
  const inks = axisInks(dark);
  const axes = (["x", "y", "z"] as const)
    .map((name, k) => {
      const across = basis.right[k],
        up = basis.up[k],
        depth = basis.back[k];
      const length = Math.hypot(across, up);
      return {
        name,
        ink: inks[k],
        x: radius * across,
        y: -radius * up,
        depth,
        facing:
          length >= endOn ? "across" : depth > 0 ? "toward" : ("away" as const),
        // The label beyond the tip, or beside an axis seen end on.
        label:
          length >= endOn
            ? [((radius + 6) * across) / length, (-(radius + 6) * up) / length]
            : [7, -7],
      };
    })
    .sort((a, b) => a.depth - b.depth);
  return (
    <div className="orientation" role="group" aria-label="Named views">
      <svg
        className="orientation-axes"
        viewBox="-28 -28 56 56"
        role="img"
        aria-label="Directions of the x, y and z axes in the drawing"
      >
        {axes.map((a) => (
          <g
            key={a.name}
            data-axis={a.name}
            data-facing={a.facing}
            data-radius={radius}
            opacity={a.depth < -1e-9 ? 0.55 : 1}
          >
            <line
              x1={0}
              y1={0}
              x2={a.x}
              y2={a.y}
              stroke={a.ink}
              strokeWidth={2}
              strokeLinecap="round"
            />
            {a.facing === "across" ? (
              <circle cx={a.x} cy={a.y} r={2.2} fill={a.ink} />
            ) : (
              <circle
                r={3.2}
                fill={a.facing === "toward" ? a.ink : "none"}
                stroke={a.ink}
                strokeWidth={1.5}
              />
            )}
            <text
              x={a.label[0]}
              y={a.label[1]}
              fill={a.ink}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {a.name}
            </text>
          </g>
        ))}
      </svg>
      {(Object.keys(namedViews) as NamedView[]).map((name) => (
        <button
          key={name}
          type="button"
          title={namedViews[name].help}
          disabled={disabled}
          onClick={() => onTurn(name)}
        >
          {namedViews[name].label}
        </button>
      ))}
    </div>
  );
}

// The 3D drawing's camera lives outside React, so its indicator listens
// for each drawn camera rather than re-rendering the notebook every frame.
export type OrientationFeed = {
  last?: Basis;
  listener?: (basis: Basis) => void;
};
export function feedOrientation(feed: OrientationFeed, basis: Basis) {
  const last = feed.last;
  if (
    last &&
    (["right", "up", "back"] as const).every((k) =>
      last[k].every((x, i) => x === basis[k][i]),
    )
  )
    return;
  feed.last = basis;
  feed.listener?.(basis);
}
export function LiveOrientation({
  feed,
  ...props
}: { feed: OrientationFeed } & Omit<
  Parameters<typeof Orientation>[0],
  "basis"
>) {
  const [basis, setBasis] = useState(feed.last);
  useEffect(() => {
    feed.listener = setBasis;
    setBasis(feed.last);
    return () => {
      feed.listener = undefined;
    };
  }, [feed]);
  return basis ? <Orientation basis={basis} {...props} /> : null;
}
