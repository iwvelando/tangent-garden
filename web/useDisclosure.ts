import { useState, type SyntheticEvent } from "react";

// Remembers which collapsible sections a visitor left open. Storage can be
// disabled, in which case sections still work and simply start at defaults.
const key = "tangent-garden.sections";
export type Section =
  "animation" | "export" | "expressions" | "indices" | "diagnostics";

function read(): Partial<Record<Section, boolean>> {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

export function useDisclosure(section: Section, initial = false) {
  const [open, setOpen] = useState(() => {
    const saved = read()[section];
    return typeof saved === "boolean" ? saved : initial;
  });
  return {
    open,
    onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
      const next = event.currentTarget.open;
      setOpen(next);
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ ...read(), [section]: next }),
        );
      } catch {
        /* Keep the in-memory state. */
      }
    },
  };
}
