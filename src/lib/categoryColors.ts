import type { CategoryRow } from "./types";

// Chart colors — vibrant, used in recharts bars / pie cells
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

// Light backgrounds for UI chips / row highlights
const BG_PALETTE = [
  "#dbeafe", // blue-100
  "#ffedd5", // orange-100
  "#d1fae5", // green-100
  "#fee2e2", // red-100
  "#ede9fe", // purple-100
  "#fce7f3", // pink-100
  "#ccfbf1", // teal-100
  "#fef3c7", // amber-100
  "#e0e7ff", // indigo-100
  "#ecfccb", // lime-100
];

// Dark text to pair with the light backgrounds above
const TEXT_PALETTE = [
  "#1e40af", // blue-800
  "#9a3412", // orange-800
  "#065f46", // green-800
  "#991b1b", // red-800
  "#5b21b6", // purple-800
  "#9d174d", // pink-800
  "#134e4a", // teal-800
  "#92400e", // amber-800
  "#3730a3", // indigo-800
  "#3f6212", // lime-800
];

export interface CategoryColors {
  chart: string; // vibrant color for recharts elements
  bg: string;    // light background for chips/rows
  text: string;  // dark text for chips/rows
}

/**
 * Build a Map<categoryId, CategoryColors> based on each category's position
 * in the active, sort_order-sorted list. Both HomeClient and DashboardClient
 * receive categories in the same order, so colors are consistent across tabs.
 */
export function buildCategoryColorMap(
  categories: CategoryRow[]
): Map<string, CategoryColors> {
  const map = new Map<string, CategoryColors>();
  categories
    .filter((c) => c.is_active)
    .forEach((c, i) => {
      const idx = i % CATEGORY_PALETTE.length;
      map.set(c.id, {
        chart: CATEGORY_PALETTE[idx],
        bg: BG_PALETTE[idx],
        text: TEXT_PALETTE[idx],
      });
    });
  return map;
}
