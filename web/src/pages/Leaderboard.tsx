import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChartCard, ErrorBox, FamilyDot, Loading, PageHeader, Sparkline, strategyMap, useMeta } from "../components/ui";
import { useData } from "../lib/data";
import { downloadCSV } from "../lib/exporters";
import { PERIOD_LABEL, useFilters, useParam, useQueryString } from "../lib/filters";
import { num, pct } from "../lib/format";
import { FAMILY_ORDER, useTheme } from "../lib/theme";
import type { Leaderboard, Metrics } from "../lib/types";

type Col = { key: keyof Metrics; label: string; fmt: (v: number | null | undefined) => string; higher: boolean; title: string };
const COLS: Col[] = [
  { key: "sharpe", label: "Sharpe", fmt: (v) => num(v), higher: true, title: "Annualised excess return over the 6.5% risk-free rate per unit of volatility" },
  { key: "cagr", label: "CAGR", fmt: (v) => pct(v), higher: true, title: "Compound annual growth rate" },
  { key: "sortino", label: "Sortino", fmt: (v) => num(v), higher: true, title: "Like Sharpe, but only downside volatility counts" },
  { key: "max_dd", label: "Max DD", fmt: (v) => pct(v), higher: true, title: "Worst peak-to-trough fall" },
  { key: "calmar", label: "Calmar", fmt: (v) => num(v), higher: true, title: "CAGR divided by max drawdown" },
  { key: "vol", label: "Vol", fmt: (v) => pct(v), higher: false, title: "Annualised volatility of daily returns" },
  { key: "hit_rate", label: "Hit rate", fmt: (v) => pct(v), higher: true, title: "Share of long days followed by an up day (close to close)" },
  { key: "win_rate", label: "Win rate", fmt: (v) => pct(v, 0), higher: true, title: "Share of closed trades with a positive net return" },
  { key: "profit_factor", label: "Profit factor", fmt: (v) => num(v), higher: true, title: "Gross profit / gross loss of trades" },
  { key: "alpha", label: "Alpha", fmt: (v) => pct(v), higher: true, title: "Annualised excess return not explained by Nifty exposure" },
  { key: "beta", label: "Beta", fmt: (v) => num(v), higher: false, title: "Sensitivity to the Nifty 50 index" },
  { key: "exposure", label: "Exposure", fmt: (v) => pct(v, 0), higher: true, title: "Average share of capital invested" },
  { key: "turnover", label: "Turnover", fmt: (v) => (v == null ? "–" : `${v.toFixed(1)}x`), higher: false, title: "Traded value per year as a multiple of capital" },
];

export default function LeaderboardPage() {
  const meta = useMeta();
  const [f] = useFilters();
  const qs = useQueryString();
  const nav = useNavigate();
  const { familyColor } = useTheme();
  const [sortKey, setSortKey] = useParam("sort", "sharpe");
  const [family, setFamily] = useParam("family", "all");
  const [desc, setDesc] = useState(true);
  const { data: lb, error } = useData<Leaderboard>("leaderboard.json");
  const sectorMode = f.universe !== "all";
  const { data: sec } = useData<{ metrics: Record<string, Record<string, Record<string, Record<string, Metrics>>>> }>(sectorMode ? "sectors.json" : null);
  const S = strategyMap(meta);

  const rows = useMemo(() => {
    if (!lb || !meta) return [];
    const base = lb.metrics[f.period][f.cost];
    const src: Record<string, Partial<Metrics>> = sectorMode ? (sec?.metrics[f.universe]?.[f.period]?.[f.cost] ?? {}) : base;
    const col = COLS.find((c) => c.key === sortKey) ?? COLS[0];
    return Object.keys(base)
      .filter((s) => family === "all" || S[s]?.family === family)
      .map((s) => ({ id: s, m: src[s] as Partial<Metrics> | undefined }))
      .sort((a, b) => {
        const va = (a.m?.[col.key] as number | null | undefined) ?? -Infinity, vb = (b.m?.[col.key] as number | null | undefined) ?? -Infinity;
        const d = (va > vb ? 1 : va < vb ? -1 : 0) * (col.higher ? 1 : -1);
        return desc ? -d : d;
      });
  }, [lb, meta, sec, f, sortKey, family, desc, sectorMode, S]);

  if (error) return <ErrorBox error={error} />;
  if (!lb || !meta) return <Loading />;

  const exportCsv = () =>
    downloadCSV(`algolens_leaderboard_${f.period}_${f.cost}_${f.universe}.csv`, [
      ["strategy", "family", ...COLS.map((c) => c.key), "n_trades", "trades_per_year"],
      ...rows.map((r) => [S[r.id].name, S[r.id].family, ...COLS.map((c) => (r.m?.[c.key] as number | null | undefined) ?? ""), r.m?.n_trades ?? "", r.m?.trades_per_year ?? ""]),
    ]);

  return (
    <div>
      <PageHeader title="Leaderboard" question="Which algorithm family has the best risk-adjusted return on Nifty 50 stocks? Click a column to sort, a row to open the deep dive." />
      <div className="flex flex-wrap items-center gap-3 mb-3 text-[13px]">
        <label className="flex items-center gap-2"><span className="text-muted">Family</span>
          <select value={family} onChange={(e) => setFamily(e.target.value)}>
            <option value="all">All families</option>
            {[...FAMILY_ORDER, "Benchmark"].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2"><span className="text-muted">Rank by</span>
          <select value={sortKey} onChange={(e) => { setSortKey(e.target.value); setDesc(true); }}>
            {COLS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <span className="text-muted">{PERIOD_LABEL[f.period]} · {f.cost === "net" ? "net of Indian costs" : "gross, before costs"} · {sectorMode ? `${f.universe} stocks only` : `${meta.universe.length} stocks`}</span>
      </div>
      <ChartCard
        title="All strategies"
        actions={<button className="chip hover:bg-[var(--surface-2)]" onClick={exportCsv}>CSV</button>}
        meaning={sectorMode
          ? "Sector view rebuilds per-stock strategies on that sector's stocks only. Portfolio strategies (momentum, pairs, index) pick across the whole universe, so they show no sector numbers."
          : "Compare each strategy with buy-and-hold of the same stocks, not only with the Nifty index: the stock list is today's winners, which flatters every stock-level result."}
      >
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-[13px] tnum min-w-[1080px]">
            <thead>
              <tr className="text-left text-muted border-b border-edge">
                <th className="py-2 pr-2 font-normal w-6">#</th>
                <th className="py-2 pr-2 font-normal">Strategy</th>
                <th className="py-2 pr-2 font-normal">Equity (net, 2010+)</th>
                {COLS.map((c) => (
                  <th key={c.key} className="py-2 px-2 font-normal text-right" title={c.title}>
                    <button className={`hover:text-ink ${sortKey === c.key ? "text-ink font-medium" : ""}`}
                      onClick={() => (sortKey === c.key ? setDesc((d) => !d) : (setSortKey(c.key), setDesc(true)))}
                      aria-sort={sortKey === c.key ? (desc ? "descending" : "ascending") : "none"}>
                      {c.label}{sortKey === c.key ? (desc ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-b border-[var(--grid)] hover:bg-[var(--surface-2)] cursor-pointer" onClick={() => nav(`/strategy/${r.id}${qs}`)}>
                  <td className="py-2 pr-2 text-muted">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center"><FamilyDot family={S[r.id].family} /><span className="font-medium">{S[r.id].name}</span>
                      {S[r.id].priority !== "P0" && <span className="ml-2 text-[10px] text-muted border border-edge rounded px-1">{S[r.id].priority}</span>}</div>
                    <div className="text-[11px] text-muted ml-4">{S[r.id].family}</div>
                  </td>
                  <td className="py-2 pr-2"><Sparkline values={lb.sparklines[r.id]} color={familyColor(S[r.id].family)} /></td>
                  {COLS.map((c) => (
                    <td key={c.key} className={`py-2 px-2 text-right ${sortKey === c.key ? "font-semibold" : ""}`}>
                      {r.m ? c.fmt(r.m[c.key] as number | null | undefined) : <span className="text-muted">n/a</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}
