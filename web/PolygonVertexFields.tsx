import { Fragment, type ReactNode } from "react";
import type { Help } from "./help";
import {
  maxPolygonVertices,
  minPolygonVertices,
  nextVertex,
  vertexLabel,
  type PolygonVertex,
} from "./sphere-polygon";

// A geodesic polygon's vertices as both notebooks edit them: a group for
// each vertex, its longitude u and latitude v side by side and a Remove
// button, then Add a vertex. `field` draws one constant-expression field
// the notebook's own way, and the first vertex's u carries the help.
// `edit` changes one coordinate of the latest study. `editVertices` adds or
// removes a vertex; the notebook applies it once pending evaluations have
// landed, since it renumbers the fields after it.
export function PolygonVertexFields({
  vertices,
  idPrefix,
  help,
  field,
  edit,
  editVertices,
}: {
  vertices: PolygonVertex[];
  idPrefix: string;
  help: Help<string>;
  field: (
    label: string,
    value: number,
    change: (value: number) => void,
    help?: Help<string>,
  ) => ReactNode;
  edit: (index: number, c: "u" | "v", value: number) => void;
  editVertices: (change: (vs: PolygonVertex[]) => PolygonVertex[]) => void;
}) {
  return (
    <>
      {vertices.map((vertex, i) => (
        <div
          className="term"
          role="group"
          aria-labelledby={`${idPrefix}-vertex-${i}`}
          key={i}
        >
          <div className="term-heading">
            <span id={`${idPrefix}-vertex-${i}`}>Vertex {i + 1}</span>
            <button
              type="button"
              aria-label={`Remove vertex ${i + 1}`}
              disabled={vertices.length <= minPolygonVertices}
              onClick={() => editVertices((vs) => vs.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <div className="pair">
            {(["u", "v"] as const).map((c) => (
              <Fragment key={c}>
                {field(
                  vertexLabel(i + 1, c),
                  vertex[c],
                  (value) => edit(i, c, value),
                  i === 0 && c === "u" ? help : undefined,
                )}
              </Fragment>
            ))}
          </div>
        </div>
      ))}
      <button
        className="closure"
        type="button"
        disabled={vertices.length >= maxPolygonVertices}
        onClick={() => editVertices((vs) => [...vs, nextVertex(vs)])}
      >
        {vertices.length >= maxPolygonVertices
          ? `At most ${maxPolygonVertices} vertices`
          : "Add a vertex"}
      </button>
    </>
  );
}
