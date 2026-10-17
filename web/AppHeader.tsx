import { ColorSchemeMenu } from "./ColorSchemeMenu";
import type { ReactNode } from "react";
import type { useTheme } from "./useTheme";

// Shared by all notebooks so switching between them never changes the
// header; each notebook supplies only its own link, animation and export
// actions.
export function AppHeader({
  theme: { dark, preference, toggle, followSystem, scheme, chooseScheme },
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
        <span className="local-note">A little geometry. A lot of beauty.</span>
        <div className="appearance-controls">
          <ColorSchemeMenu {...{ scheme, dark }} onChange={chooseScheme} />
          <button
            className="theme-toggle"
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
          <button
            className="system-theme"
            aria-label="Follow system"
            aria-pressed={preference === "system"}
            onClick={followSystem}
            title={
              preference === "system"
                ? "Following your system theme"
                : "Follow system changes, including time-of-day changes"
            }
          >
            <svg
              className="system-theme-icon"
              viewBox="0 0 24 24"
              width="19"
              height="19"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M8 21h8m-4-4v4" />
            </svg>
          </button>
        </div>
        <div className="study-actions">{children}</div>
      </div>
    </header>
  );
}
