import { useEffect, useState } from "react";
type Theme = "system" | "light" | "dark";
const key = "tangent-garden.theme";
const valid = (value: string | null): Theme =>
  value === "light" || value === "dark" ? value : "system";
export function useTheme() {
  const [preference, setPreference] = useState<Theme>(() => {
    try {
      return valid(localStorage.getItem(key));
    } catch {
      return "system";
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
        setPreference(valid(event.newValue));
    };
    window.addEventListener("storage", storage);
    return () => {
      media.removeEventListener("change", change);
      window.removeEventListener("storage", storage);
    };
  }, []);
  const dark = preference === "system" ? systemDark : preference === "dark";
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  const choose = (theme: Theme) => {
    setPreference(theme);
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
