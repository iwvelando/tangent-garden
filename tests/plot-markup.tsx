// The 2D drawing as static SVG markup, as export and the loop check draw
// it. Tests load this through Vite (createServer().ssrLoadModule), which
// compiles the drawing's JSX for React itself; Playwright's own transform
// would compile it for component testing instead.
import { renderToStaticMarkup } from "react-dom/server";
import { Plot } from "../web/Plot";
import type { ComponentProps } from "react";

export const plotMarkup = (props: ComponentProps<typeof Plot>) =>
  renderToStaticMarkup(<Plot {...props} />);
