// Appearance only: never part of a study's geometry or shared link. Each
// scheme has separate inks for paper and dark backgrounds.
// Ink tuples: primary, secondary, construction, third family, fourth family.
export const colorSchemes = [
  {
    id: "default",
    names: {
      teal: "teal",
      gold: "gold",
      rust: "rust",
      slate: "slate",
      gray: "gray",
    },
    sectionHue: 170,
    label: "Turquoise & orange",
    light: ["#186b6b", "#bc562e", "#397f82", "#7050a2", "#ad5265"],
    dark: ["#72c9c4", "#f3bc83", "#86b5b6", "#bdacf0", "#ec9fa8"],
  },
  {
    id: "cobalt",
    names: {
      teal: "cobalt",
      gold: "rose",
      rust: "violet",
      slate: "ochre",
      gray: "blue-gray",
    },
    sectionHue: 218,
    label: "Cobalt & rose",
    light: ["#2758a5", "#ac365f", "#52729b", "#71601c", "#68569c"],
    dark: ["#8db7ff", "#ff9fbd", "#95b1d8", "#e2ca83", "#c4aff0"],
  },
  {
    id: "plum",
    names: {
      teal: "plum",
      gold: "gold",
      rust: "rose",
      slate: "blue-green",
      gray: "muted plum",
    },
    sectionHue: 282,
    label: "Plum & gold",
    light: ["#78448f", "#946214", "#80688b", "#286d78", "#b0465a"],
    dark: ["#d3a3ec", "#f2cc78", "#bda7c9", "#85ccdb", "#f6a4b4"],
  },
  {
    id: "forest",
    names: {
      teal: "forest green",
      gold: "berry",
      rust: "ochre",
      slate: "blue",
      gray: "muted green",
    },
    sectionHue: 140,
    label: "Forest & berry",
    light: ["#286640", "#a33669", "#52765c", "#355f9e", "#916019"],
    dark: ["#8cd4a3", "#f5a0c9", "#9abda4", "#a2bfff", "#edca8b"],
  },
] as const;
export type ColorScheme = (typeof colorSchemes)[number]["id"];
export const validColorScheme = (value: unknown): ColorScheme =>
  colorSchemes.find((s) => s.id === value)?.id ?? "default";
export const schemeInks = (scheme: ColorScheme, dark: boolean) =>
  colorSchemes.find((s) => s.id === scheme)![dark ? "dark" : "light"];

export const sectionHue = (scheme: ColorScheme) =>
  colorSchemes.find((s) => s.id === scheme)!.sectionHue;

// Existing descriptions keep their exact wording in the default scheme.
export function describeColors(text: string, scheme: ColorScheme) {
  const names = colorSchemes.find((s) => s.id === scheme)!.names;
  return text.replace(/\b(teal|gold|rust|slate|gray)\b/gi, (word) => {
    const name = names[word.toLowerCase() as keyof typeof names];
    return word[0] === word[0].toUpperCase()
      ? name[0].toUpperCase() + name.slice(1)
      : name;
  });
}
