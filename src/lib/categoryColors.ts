import type { CategoryRow, ColorKindKey, KindColorRow } from "./types";
import { darkenHex, lightenHex } from "./colorPalette";

// Default chart colors — vibrant, used in recharts bars / pie cells when no
// per-row override is set on a category.
export const CATEGORY_PALETTE = [
  "#3b82f6", // blue
  "#f97316", // orange
  "#10b981", // green
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f59e0b", // amber
  "#6366f1", // indigo
  "#84cc16", // lime
];

// Light backgrounds for UI chips / row highlights (paired with CATEGORY_PALETTE).
const BG_PALETTE = [
  "#dbeafe", "#ffedd5", "#d1fae5", "#fee2e2", "#ede9fe",
  "#fce7f3", "#ccfbf1", "#fef3c7", "#e0e7ff", "#ecfccb",
];

// Dark text to pair with the light backgrounds above.
const TEXT_PALETTE = [
  "#1e40af", "#9a3412", "#065f46", "#991b1b", "#5b21b6",
  "#9d174d", "#134e4a", "#92400e", "#3730a3", "#3f6212",
];

export interface CategoryColors {
  chart: string; // vibrant color for recharts elements
  bg: string;    // light background for chips/rows
  text: string;  // dark text for chips/rows
}

/** Built-in fallback used by kind colors when no household override exists. */
export const KIND_DEFAULT_HEX: Record<ColorKindKey, string> = {
  income: "#10b981",
  fixed: "#6366f1",
  loan: "#a855f7",
  special: "#ef4444",
  advance: "#f59e0b",
  investment: "#0ea5e9",
  transfer_in: "#22c55e",
  transfer_out: "#dc2626",
};

/** Display labels for kind keys — used by the kind-color settings UI. */
export const KIND_LABEL: Record<ColorKindKey, string> = {
  income: "収入",
  fixed: "固定費",
  loan: "ローン",
  special: "特別費",
  advance: "立替",
  investment: "投資",
  transfer_in: "振込（入）",
  transfer_out: "振込（出）",
};

/** Order to render kinds in the settings UI. */
export const KIND_ORDER: ColorKindKey[] = [
  "income",
  "fixed",
  "special",
  "advance",
  "loan",
  "investment",
  "transfer_in",
  "transfer_out",
];

/**
 * Derive a CategoryColors triple from a chart hex. Used both when a category
 * has a user-chosen color_hex and when constructing kind colors.
 */
export function colorsFromHex(hex: string): CategoryColors {
  return {
    chart: hex,
    bg: lightenHex(hex, 0.85),
    text: darkenHex(hex, 0.45),
  };
}

/**
 * Build a Map<categoryId, CategoryColors>. Each category that has a saved
 * `color_hex` uses its hex, with derived bg/text. Categories without a saved
 * color fall back to the position-based palette (matches legacy behavior).
 */
export function buildCategoryColorMap(
  categories: CategoryRow[]
): Map<string, CategoryColors> {
  const map = new Map<string, CategoryColors>();
  categories
    .filter((c) => c.is_active)
    .forEach((c, i) => {
      if (c.color_hex) {
        map.set(c.id, colorsFromHex(c.color_hex));
        return;
      }
      const idx = i % CATEGORY_PALETTE.length;
      map.set(c.id, {
        chart: CATEGORY_PALETTE[idx],
        bg: BG_PALETTE[idx],
        text: TEXT_PALETTE[idx],
      });
    });
  return map;
}

/**
 * Build a Map<ColorKindKey, CategoryColors>. The household may override any
 * subset of kinds via the kind_colors table; missing kinds fall back to the
 * built-in defaults.
 */
export function buildKindColorMap(
  rows: KindColorRow[],
): Map<ColorKindKey, CategoryColors> {
  const map = new Map<ColorKindKey, CategoryColors>();
  const overrides = new Map(rows.map((r) => [r.kind, r.color_hex]));
  for (const k of KIND_ORDER) {
    const hex = overrides.get(k) ?? KIND_DEFAULT_HEX[k];
    map.set(k, colorsFromHex(hex));
  }
  return map;
}
