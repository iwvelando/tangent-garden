import { plotPalette } from "./palette";
import { spatialPalette, hex } from "./spatial/palette";
import { useEffect, useState, type CSSProperties } from "react";
import { validColorScheme, type ColorScheme } from "./color-schemes";
type Theme = "system" | "light" | "dark";
const key = "tangent-garden.theme";
// Shared by lazily mounted notebooks when browser storage is unavailable.
let memory: Theme = "system";
const schemeKey = "tangent-garden.color-scheme";
let schemeMemory: ColorScheme = "default";
let schemeLoaded = false;
const valid = (value: string | null): Theme =>
  value === "light" || value === "dark" ? value : "system";
export function useTheme() {
  const [scheme, setScheme] = useState<ColorScheme>(() => {
    if (!schemeLoaded) {
      schemeLoaded = true;
      try {
        schemeMemory = validColorScheme(localStorage.getItem(schemeKey));
      } catch {
        /* Start with the in-memory choice when storage is unavailable. */
      }
    }
    return schemeMemory;
  });
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (event.key === schemeKey || event.key === null)
        setScheme((schemeMemory = validColorScheme(event.newValue)));
    };
    const local = (event: Event) =>
      setScheme((event as CustomEvent<ColorScheme>).detail);
    window.addEventListener("tangent-garden-color-scheme", local);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("tangent-garden-color-scheme", local);
      window.removeEventListener("storage", storage);
    };
  }, []);
  const chooseScheme = (value: ColorScheme) => {
    schemeMemory = value;
    setScheme(value);
    window.dispatchEvent(
      new CustomEvent("tangent-garden-color-scheme", { detail: value }),
    );
    try {
      if (value === "default") localStorage.removeItem(schemeKey);
      else localStorage.setItem(schemeKey, value);
    } catch {
      /* Keep the in-memory choice when storage is disabled. */
    }
  };
  const [preference, setPreference] = useState<Theme>(() => {
    try {
      return (memory = valid(localStorage.getItem(key)));
    } catch {
      return memory;
    }
  });
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    change();
    media.addEventListener("change", change);
    const storage = (event: StorageEvent) => {
      if (event.key === key || event.key === null)
        setPreference((memory = valid(event.newValue)));
    };
    const local = (event: Event) =>
      setPreference((event as CustomEvent<Theme>).detail);
    window.addEventListener("tangent-garden-theme", local);
    window.addEventListener("storage", storage);
    return () => {
      media.removeEventListener("change", change);
      window.removeEventListener("tangent-garden-theme", local);
      window.removeEventListener("storage", storage);
    };
  }, []);
  const dark = preference === "system" ? systemDark : preference === "dark";
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  const choose = (theme: Theme) => {
    memory = theme;
    setPreference(theme);
    window.dispatchEvent(
      new CustomEvent("tangent-garden-theme", { detail: theme }),
    );
    try {
      if (theme === "system") localStorage.removeItem(key);
      else localStorage.setItem(key, theme);
    } catch {
      /* Storage can be disabled; keep the in-memory preference. */
    }
  };
  const planar = plotPalette(dark, scheme),
    spatial = spatialPalette(scheme),
    k = dark ? 1 : 0;
  const style = {
    "--base-ink": planar.base,
    "--derived-ink": planar.derived,
    "--thread-ink": hex(spatial.curve[k]),
    "--surface-ink": hex(spatial.teal[k]),
    "--focal-ink": hex(spatial.rust[k]),
    "--second-focal-ink": hex(spatial.slate[k]),
    "--parent-ink": hex(spatial.recede[k]),
  } as CSSProperties;
  return {
    style,
    dark,
    scheme,
    chooseScheme,
    preference,
    toggle: () => choose(dark ? "light" : "dark"),
    followSystem: () => choose("system"),
  };
}
