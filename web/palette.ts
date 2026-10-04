// The drawing's colours by role. The plot draws with them, and the example
// gallery's thumbnails, which record each colour's role rather than its value
// (scripts/build-thumbnails.mjs), take them from here in either theme.
export const plotPalette = (dark: boolean) =>
  dark
    ? {
        bg: "#0b1517",
        base: "#72c9c4",
        derived: "#f3bc83",
        line: "#86b5b6",
        incident: "#9aaab9",
        axis: "#2b3b41",
        text: "#a0b0b4",
        // The probe's inks (probe.ts), diagnostic rather than decorative.
        probe: "#ff78c4",
        probeTangent: "#ff7361",
        probeNormal: "#73e680",
      }
    : {
        bg: "#f3f1ea",
        base: "#186b6b",
        derived: "#bc562e",
        line: "#397f82",
        incident: "#8797aa",
        axis: "#e8e5dd",
        text: "#8a928f",
        // The probe's inks (probe.ts), diagnostic rather than decorative.
        probe: "#b81a75",
        probeTangent: "#cc291f",
        probeNormal: "#1a802e",
      };
export type PlotPalette = ReturnType<typeof plotPalette>;
