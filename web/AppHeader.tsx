import type { ReactNode } from "react";
import { NotebookMode } from "./NotebookMode";
import type { useTheme } from "./useTheme";

// Shared by all notebooks so switching between them never changes the
// header; each notebook supplies only its own export menu.
export function AppHeader({
  theme: { dark, preference, toggle, followSystem },
  children,
}: {
  theme: ReturnType<typeof useTheme>;
  children: ReactNode;
}) {
  return (
    <header>
      <a className="brand" href="./">
        <img
          className="brand-symbol"
          src={`${import.meta.env.BASE_URL}tangent-garden.svg`}
          alt=""
        />
        <span className="brand-name">Tangent Garden</span>
        <span className="brand-divider" /> <small>CURVES & CONSTRUCTIONS</small>
      </a>
      <div className="header-actions">
        <NotebookMode />
        <span className="local-note">A little geometry. A lot of beauty.</span>
        <button
          onClick={toggle}
          title={
            preference === "system"
              ? "Following your system theme. Click to choose a fixed theme."
              : "Your theme choice is saved in this browser."
          }
          aria-label={dark ? "Use light background" : "Use dark background"}
        >
          {dark ? "☼" : "◐"}
        </button>
        {preference !== "system" && (
          <button
            className="system-theme"
            onClick={followSystem}
            title="Follow system changes, including time-of-day changes"
          >
            Follow system
          </button>
        )}
        {children}
      </div>
    </header>
  );
}
