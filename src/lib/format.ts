export const yen = (n: number): string =>
  (n < 0 ? "-" : "") + "¥" + Math.abs(Math.round(n)).toLocaleString("ja-JP");

export const yenPlain = (n: number): string =>
  Math.round(n).toLocaleString("ja-JP");

export const yenSigned = (n: number): string => {
  const r = Math.round(n);
  const sign = r > 0 ? "+" : r < 0 ? "-" : "±";
  return sign + "¥" + Math.abs(r).toLocaleString("ja-JP");
};

export function formatPctDiff(curr: number, prev: number): string {
  if (prev === 0) return curr === 0 ? "±0%" : "—";
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "" : "±";
  return `${sign}${pct.toFixed(1)}%`;
}

export function formatJaDate(d: string | Date): string {
  const dt = typeof d === "string" ? new Date(d + "T00:00:00") : d;
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`;
}

export function formatJaMonth(d: string | Date): string {
  const dt = typeof d === "string" ? new Date(d + "T00:00:00") : d;
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月`;
}

/**
 * Return the "month key" (YYYY-MM) for a given date using the 20-day cycle:
 *  - Day 1–19  → current calendar month  (cycle ends on the 19th of this month)
 *  - Day 20–31 → next calendar month     (new cycle starts on the 20th)
 *
 * Example: 2026-04-19 (day=19) → "2026-04"  |  2026-04-20 (day=20) → "2026-05"
 */
export function monthKey(d: Date = new Date()): string {
  const day = d.getDate();
  if (day < 20) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Return the date range [start, end] for the 20-day month cycle.
 * "YYYY-MM" → start = previous-calendar-month 20th, end = this-month 19th.
 *
 * Example: "2026-04" → { start: "2026-03-20", end: "2026-04-19" }
 */
export function monthDateRange(ym: string): { start: string; end: string } {
  const [year, month] = ym.split("-").map(Number);
  const startDate = new Date(year, month - 2, 20);
  const endDate = new Date(year, month - 1, 19);
  const fmt = (dt: Date) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  return { start: fmt(startDate), end: fmt(endDate) };
}

/** First day of the given YYYY-MM as YYYY-MM-DD. */
export function firstOfMonth(ym: string): string {
  return `${ym}-01`;
}

/** Add N months to YYYY-MM. */
export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 10); // use day 10 (< 20) so monthKey returns that month
  return monthKey(d);
}

/** Today as YYYY-MM-DD (local). */
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Pick a Y-axis unit (label + divisor) so tick numbers stay short. Always returns a non-empty label. */
export function yAxisUnit(maxVal: number): { divisor: number; label: string } {
  if (maxVal >= 1_000_000) return { divisor: 1_000_000, label: "(百万円)" };
  if (maxVal >= 10_000) return { divisor: 1_000, label: "(千円)" };
  return { divisor: 1, label: "(円)" };
}

export function makeTickFormatter(divisor: number) {
  return (v: number) =>
    divisor > 1 ? (v / divisor).toFixed(divisor >= 1_000_000 ? 1 : 0) : String(v);
}
