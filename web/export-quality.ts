export const exportQualities = {
  standard: { label: "Standard · 1000 × 760", scale: 1, compression: 0.95 },
  fine: {
    label: "Fine · 2000 × 1520",
    scale: 2,
    compression: 1,
  },
} as const;
export type ExportQuality = keyof typeof exportQualities;
