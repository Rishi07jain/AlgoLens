export const pct = (x: number | null | undefined, d = 1) => (x == null || !isFinite(x) ? "–" : `${(x * 100).toFixed(d)}%`);
export const num = (x: number | null | undefined, d = 2) => (x == null || !isFinite(x) ? "–" : x.toFixed(d));
export const signed = (x: number | null | undefined, d = 2) => (x == null || !isFinite(x) ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(d)}`);
export const signedPct = (x: number | null | undefined, d = 1) => (x == null || !isFinite(x) ? "–" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);

/** Indian digit grouping: 10,00,000 */
export function inr(x: number | null | undefined, compact = false): string {
  if (x == null || !isFinite(x)) return "–";
  const a = Math.abs(x);
  if (compact) {
    if (a >= 1e7) return `₹${(x / 1e7).toFixed(2)} Cr`;
    if (a >= 1e5) return `₹${(x / 1e5).toFixed(2)} L`;
  }
  return `${x < 0 ? "-" : ""}₹${Math.round(a).toLocaleString("en-IN")}`;
}

export const year = (d: string) => d.slice(0, 4);
export const monthYear = (d: string) => {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

/** First date of each calendar year (every `step` years) - used as category-axis ticks so a
 *  "2020" label sits on the first trading week of 2020. */
export function yearTicks(dates: string[], maxTicks = 9): string[] {
  const firsts: string[] = [];
  let last = "";
  for (const d of dates) {
    const y = d.slice(0, 4);
    if (y !== last) { firsts.push(d); last = y; }
  }
  const out = firsts.slice(1);
  const step = Math.ceil(out.length / maxTicks);
  return out.filter((_, i) => i % step === 0);
}
