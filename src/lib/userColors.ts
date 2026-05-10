import { darkenHex, lightenHex } from "./colorPalette";
import type { UserRow } from "./types";

/**
 * Per-user color set used for chips, dots, and side-borders. All values are
 * hex strings — consumers apply them via inline `style` so we can support both
 * the built-in fallback palette and user-chosen custom colors uniformly.
 */
export type UserColor = {
  /** Vibrant chart/dot color. */
  chart: string;
  /** Light tint for chip backgrounds. */
  bg: string;
  /** Dark tone for chip text. */
  text: string;
  /** Mid tone for borders / left rails. */
  border: string;
};

/** Built-in fallback palette — used when a user has no saved color_hex. */
const FALLBACK_HEXES: string[] = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
];

const DEFAULT_FALLBACK: UserColor = colorsFromHex("#64748b"); // slate

function colorsFromHex(hex: string): UserColor {
  return {
    chart: hex,
    bg: lightenHex(hex, 0.85),
    text: darkenHex(hex, 0.45),
    border: lightenHex(hex, 0.55),
  };
}

/**
 * Build Map<userId, UserColor>. Users with a saved `color_hex` use it;
 * others fall back to the position-based fallback palette.
 */
export function buildUserColorMap(users: UserRow[]): Map<string, UserColor> {
  const map = new Map<string, UserColor>();
  users.forEach((u, i) => {
    if (u.color_hex) {
      map.set(u.id, colorsFromHex(u.color_hex));
      return;
    }
    const hex = FALLBACK_HEXES[i % FALLBACK_HEXES.length];
    map.set(u.id, colorsFromHex(hex));
  });
  return map;
}

export function userColor(map: Map<string, UserColor>, id: string | null | undefined): UserColor {
  if (!id) return DEFAULT_FALLBACK;
  return map.get(id) ?? DEFAULT_FALLBACK;
}
