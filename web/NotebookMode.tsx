import { createContext, useContext } from "react";
export const NotebookContext = createContext<{
  mode: "2d" | "3d" | "4d";
  choose: (mode: "2d" | "3d" | "4d") => void;
}>({ mode: "2d", choose: () => {} });
export function NotebookMode() {
  const { mode, choose } = useContext(NotebookContext);
  return (
    <nav className="notebook-mode" aria-label="Study dimension">
      <button aria-pressed={mode === "2d"} onClick={() => choose("2d")}>
        2D curves
      </button>
      <button aria-pressed={mode === "3d"} onClick={() => choose("3d")}>
        3D curves
      </button>
      <button aria-pressed={mode === "4d"} onClick={() => choose("4d")}>
        4D tesseracts
      </button>
    </nav>
  );
}
