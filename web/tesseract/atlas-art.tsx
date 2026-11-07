// Atlas artwork uses the ordinary geometry-only vector composition, including
// every companion panel. Framing changes the drawing copy, never provenance.
import { useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ColorScheme } from "../color-schemes";
import { exportBaseSize, type ExportLayout } from "../export-quality";
import { Composition } from "./Composition";
import type { TesseractFrame } from "./atlas";
import type { TesseractStudy } from "./link";
import type { Result } from "./types";
export type AtlasRadii = readonly [number, number];
export function sharedAtlasRadii(results: Result[]): AtlasRadii | undefined {
  if (!results.length) return undefined;
  return [
    Math.max(...results.map((r) => r.radius)),
    Math.max(...results.map((r) => r.companion?.radius ?? 0)),
  ];
}
export function frameAtlasResult(result: Result, radii?: AtlasRadii): Result {
  return radii
    ? {
        ...result,
        radius: radii[0],
        ...(result.companion && {
          companion: { ...result.companion, radius: radii[1] },
        }),
      }
    : result;
}
export function AtlasArtwork({
  frame,
  study,
  dark,
  scheme,
  radii,
  inspection = false,
  layout = "rows",
}: {
  frame: TesseractFrame;
  study: TesseractStudy;
  dark: boolean;
  scheme: ColorScheme;
  radii?: AtlasRadii;
  inspection?: boolean;
  layout?: ExportLayout;
}) {
  const page = exportBaseSize(frame.result.companion ? layout : undefined);
  const content = useMemo(() => {
    try {
      return {
        markup: renderToStaticMarkup(
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={page.width}
            height={page.height}
            viewBox={`0 0 ${page.width} ${page.height}`}
          >
            <Composition
              {...study}
              config={frame.config}
              result={frameAtlasResult(frame.result, radii)}
              dark={dark}
              scheme={scheme}
              layout={layout}
            />
          </svg>,
        ),
        error: "",
      };
    } catch (e) {
      return { markup: "", error: (e as Error).message };
    }
  }, [frame, study, dark, scheme, radii, layout]);
  const [image, setImage] = useState({ markup: "", url: "" });
  const [failed, setFailed] = useState("");
  useEffect(() => {
    setFailed("");
    if (!content.markup) return;
    const url = URL.createObjectURL(
      new Blob([content.markup], { type: "image/svg+xml" }),
    );
    setImage({ markup: content.markup, url });
    return () => URL.revokeObjectURL(url);
  }, [content]);
  const error = content.error || failed;
  return (
    <>
      <div
        className={inspection ? "atlas-inspected-art" : "atlas-art"}
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        {image.markup === content.markup && image.url && !error && (
          <img
            src={image.url}
            alt=""
            data-radii={JSON.stringify(
              radii ?? [
                frame.result.radius,
                frame.result.companion?.radius ?? 0,
              ],
            )}
            onError={() =>
              setFailed(
                "This variant could not be drawn. It can still be inspected or adopted.",
              )
            }
          />
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
    </>
  );
}
