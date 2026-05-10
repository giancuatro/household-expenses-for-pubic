/**
 * Curated 24-color palette for category, user, and kind color customization.
 *
 * Saturation/lightness are constrained to keep the UI calm — strong colors
 * would clash with the existing neutral surfaces. Each entry is a Tailwind
 * "500" or "600" tone so it sits at chart strength without overpowering.
 */
export const COLOR_PALETTE: ReadonlyArray<{ hex: string; name: string }> = [
  // Cool blues & teals
  { hex: "#3b82f6", name: "blue" },
  { hex: "#0ea5e9", name: "sky" },
  { hex: "#06b6d4", name: "cyan" },
  { hex: "#14b8a6", name: "teal" },
  // Greens
  { hex: "#10b981", name: "emerald" },
  { hex: "#22c55e", name: "green" },
  { hex: "#84cc16", name: "lime" },
  { hex: "#eab308", name: "yellow" },
  // Warm
  { hex: "#f59e0b", name: "amber" },
  { hex: "#f97316", name: "orange" },
  { hex: "#ef4444", name: "red" },
  { hex: "#dc2626", name: "rose-deep" },
  // Pinks & purples
  { hex: "#ec4899", name: "pink" },
  { hex: "#d946ef", name: "fuchsia" },
  { hex: "#a855f7", name: "purple" },
  { hex: "#8b5cf6", name: "violet" },
  // Indigos
  { hex: "#6366f1", name: "indigo" },
  { hex: "#4f46e5", name: "indigo-deep" },
  // Muted neutrals
  { hex: "#64748b", name: "slate" },
  { hex: "#6b7280", name: "gray" },
  { hex: "#78716c", name: "stone" },
  { hex: "#a16207", name: "yellow-deep" },
  { hex: "#15803d", name: "green-deep" },
  { hex: "#1d4ed8", name: "blue-deep" },
];

/**
 * Lighten a hex color by mixing it with white. ratio in [0,1].
 * Used to derive the "bg" surface for chips/badges from a chart color.
 */
export function lightenHex(hex: string, ratio = 0.85): string {
  const { r, g, b } = parseHex(hex);
  const lr = Math.round(r + (255 - r) * ratio);
  const lg = Math.round(g + (255 - g) * ratio);
  const lb = Math.round(b + (255 - b) * ratio);
  return `#${toHex(lr)}${toHex(lg)}${toHex(lb)}`;
}

/**
 * Darken a hex color by mixing it with black. ratio in [0,1].
 * Used to derive the "text" tone for chips/badges from a chart color.
 */
export function darkenHex(hex: string, ratio = 0.45): string {
  const { r, g, b } = parseHex(hex);
  const dr = Math.round(r * (1 - ratio));
  const dg = Math.round(g * (1 - ratio));
  const db = Math.round(b * (1 - ratio));
  return `#${toHex(dr)}${toHex(dg)}${toHex(db)}`;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
}
