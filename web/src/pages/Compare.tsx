import { useMemo } from "react";
import { EquityChart } from "../components/charts";
import { ChartCard, ErrorBox, FamilyDot, Legend, Loading, PageHeader, Stat, strategyMap, useMeta } from "../components/ui";
import { useData } from "../lib/data";
import { downloadCSV } from "../lib/exporters";
import { useParam } from "../lib/filters";
import { num, pct } from "../lib/format";
import { divergingColor, divergingInk, useTheme } from "../lib/theme";
import type { Metrics } from "../lib/types";

interface Cmp { ids: string[]; corr: (number | null)[][]; dates: string[]; equity: Record<string, number[]>;
  combos: Record<string, { label: string; members: string[]; metrics: Metrics; equity: number[] }> }

const RF = 0.065;

function weeklyStats(eq: number[], dates: string[]) {
  const r = eq.slice(1).map((v, i) => v / eq[i] - 1);
  const years = (new Date(dates.at(-1)!).getTime() - new Date(dates[0]).getTime()) / (365.25 * 864e5);
  const cagr = Math.pow(eq.at(-1)! / eq[0], 1 / years) - 1;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  const rfw = Math.pow(1 + RF, 1 / 52) - 1;
  let pk = eq[0], mdd = 0;
  eq.forEach((v) => { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); });
  return { cagr, vol: sd * Math.sqrt(52), sharpe: ((m - rfw) / sd) * Math.sqrt(52), mdd };
}

export default function Compare() {
  const meta = useMeta();
  const { pal } = useTheme();
  const { data: c, error } = useData<Cmp>("compare.json");
  const [selStr, setSel] = useParam("sel", "ema_12_26,xs_momentum,pairs,buy_hold");
  const S = strategyMap(meta);
  const sel = selStr.split(",").filter((s) => s && S[s]).slice(0, 4);
  const toggle = (s: string) => {
    const has = sel.includes(s);
    const next = has ? sel.filter((x) => x !== s) : sel.length >= 4 ? sel : [...sel, s];
    setSel(next.join(","));
  };
  const combo = useMemo(() => {
    if (!c || sel.length === 0) return null;
    const n = c.dates.length;
    const eq = [1];
    for (let i = 1; i < n; i++) {
      const r = sel.reduce((a, s) => a + (c.equity[s][i] / c.equity[s][i - 1] - 1), 0) / sel.length;
      eq.push(eq[i - 1] * (1 + r));
    }
    return { eq, stats: weeklyStats(eq, c.dates), parts: sel.map((s) => ({ s, ...weeklyStats(c.equity[s], c.dates) })) };
  }, [c, sel]);
  if (error) return <ErrorBox error={error} />;
  if (!c || !meta || !combo) return <Loading />;
  const idx = (s: string) => c.ids.indexOf(s);
  const avgParts = combo.parts.reduce((a, p) => a + p.sharpe, 0) / combo.parts.length;
  const selCorr = sel.length > 1 ? sel.flatMap((a, i) => sel.slice(i + 1).map((b) => c.corr[idx(a)][idx(b)] ?? 0)) : [];
  const avgCorr = selCorr.length ? selCorr.reduce((a, b) => a + b, 0) / selCorr.length : null;
  return (
    <div>
      <PageHeader title="Compare & combine" question="Which strategies diversify each other, and what does a combined portfolio look like?" />
      <div className="card p-3 mb-4">
        <div className="text-[12px] text-muted mb-2">Pick up to 4 strategies ({sel.length}/4)</div>
        <div className="flex flex-wrap gap-2">
          {meta.strategies.map((s) => {
            const on = sel.includes(s.id);
            const slot = sel.indexOf(s.id);
            return (
              <button key={s.id} onClick={() => toggle(s.id)} aria-pressed={on} disabled={!on && sel.length >= 4}
                className={`chip flex items-center gap-1.5 ${on ? "font-medium" : "text-ink2"} disabled:opacity-40`}
                style={on ? { borderColor: pal.series[slot], boxShadow: `inset 0 0 0 1px ${pal.series[slot]}` } : undefined}>
                {on ? <span className="w-2.5 h-2.5 rounded-full" style={{ background: pal.series[slot] }} /> : <FamilyDot family={s.family} />}{s.name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr] mb-4">
        <ChartCard title="Equity curves, ₹10 lakh each (net, log scale)" meaning="Same start date, same costs. The black line is an equal-weight mix of the selected strategies, rebalanced weekly.">
          <Legend items={[...sel.map((s, i) => ({ label: S[s].name, color: pal.series[i] })), { label: "Equal-weight mix", color: pal.text }]} />
          <EquityChart dates={c.dates} series={[
            ...sel.map((s, i) => ({ key: s, label: S[s].name, color: pal.series[i], values: c.equity[s].map((v) => v * meta.capital) })),
            { key: "mix", label: "Equal-weight mix", color: pal.text, values: combo.eq.map((v) => v * meta.capital) },
          ]} />
        </ChartCard>
        <div className="grid gap-3 content-start">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Mix CAGR" value={pct(combo.stats.cagr)} />
            <Stat label="Mix Sharpe (weekly)" value={num(combo.stats.sharpe)} sub={`avg of parts ${num(avgParts)}`} tone={combo.stats.sharpe > avgParts ? "good" : undefined} />
            <Stat label="Mix max drawdown" value={pct(combo.stats.mdd)} sub={`worst part ${pct(Math.min(...combo.parts.map((p) => p.mdd)))}`} />
            <Stat label="Avg pairwise correlation" value={num(avgCorr)} sub="daily net returns" />
          </div>
          <ChartCard title="Selected strategies (weekly data)">
            <table className="w-full text-[12px] tnum">
              <thead><tr className="text-left text-muted"><th>Strategy</th><th className="text-right">CAGR</th><th className="text-right">Sharpe</th><th className="text-right">Max DD</th></tr></thead>
              <tbody>{combo.parts.map((p, i) => <tr key={p.s} className="border-t border-[var(--grid)]"><td className="py-1"><span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: pal.series[i] }} />{S[p.s].name}</td><td className="text-right">{pct(p.cagr)}</td><td className="text-right">{num(p.sharpe)}</td><td className="text-right">{pct(p.mdd)}</td></tr>)}</tbody>
            </table>
            <p className="text-[11px] text-muted mt-2">Mix figures come from weekly returns, so they differ slightly from the daily figures elsewhere.</p>
          </ChartCard>
        </div>
      </div>
      <ChartCard className="mb-4" title="Correlation of daily net returns (2010 – latest)"
        meaning="Blue = move together, red = move opposite. Pairs with low correlation diversify each other; Bollinger and Z-score are 1.00 because they are the same rule."
        actions={<button className="chip" onClick={() => downloadCSV("algolens_correlation.csv", [["", ...c.ids.map((s) => S[s]?.name)], ...c.ids.map((a, i) => [S[a]?.name, ...c.corr[i]])])}>CSV</button>}>
        <div className="overflow-x-auto">
          <table className="text-[11px] tnum border-separate" style={{ borderSpacing: 2 }}>
            <thead><tr><th />{c.ids.map((s) => <th key={s} className="font-normal text-muted h-24 align-bottom"><div className="w-7 mx-auto [writing-mode:vertical-rl] rotate-180 text-left whitespace-nowrap">{S[s]?.name}</div></th>)}</tr></thead>
            <tbody>{c.ids.map((a, i) => (
              <tr key={a}><td className="pr-2 text-ink2 whitespace-nowrap">{S[a]?.name}</td>
                {c.ids.map((b, j) => {
                  const v = c.corr[i][j];
                  return <td key={b} className="w-7 h-7 text-center rounded-[4px]" title={`${S[a]?.name} × ${S[b]?.name}: ${num(v)}`}
                    style={{ background: divergingColor(pal, v, 1), color: divergingInk(pal, v, 1) }}>{v == null ? "" : (v * 100).toFixed(0)}</td>;
                })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </ChartCard>
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(c.combos).map(([k, v]) => (
          <ChartCard key={k} title={v.label} meaning={`Daily-rebalanced equal weight across ${v.members.length} strategies, computed from daily returns.`}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="CAGR" value={pct(v.metrics.cagr)} /><Stat label="Sharpe" value={num(v.metrics.sharpe)} />
              <Stat label="Max DD" value={pct(v.metrics.max_dd)} /><Stat label="Beta" value={num(v.metrics.beta)} />
            </div>
          </ChartCard>
        ))}
      </div>
    </div>
  );
}
