import { useEffect, useState } from "react";
type Theme = "system" | "light" | "dark";
const key = "tangent-garden.theme";
// Shared by lazily mounted notebooks when browser storage is unavailable.
let memory: Theme = "system";
const valid = (value: string | null): Theme =>
  value === "light" || value === "dark" ? value : "system";
export function useTheme() {
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
  return {
    dark,
    preference,
    toggle: () => choose(dark ? "light" : "dark"),
    followSystem: () => choose("system"),
  };
}
