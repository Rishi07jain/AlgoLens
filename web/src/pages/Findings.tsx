import { Link, useNavigate } from "react-router-dom";
import { HBarChart } from "../components/charts";
import { StrategyScatter } from "../components/StrategyScatter";
import { ChartCard, ErrorBox, FamilyDot, Loading, PageHeader, Sparkline, strategyMap, useMeta } from "../components/ui";
import { useData } from "../lib/data";
import { useFilters, useQueryString } from "../lib/filters";
import { num, pct } from "../lib/format";
import { useTheme } from "../lib/theme";
import type { Finding, Leaderboard } from "../lib/types";

export default function Findings() {
  const meta = useMeta();
  const { data: f, error } = useData<{ cards: Finding[] }>("findings.json");
  const { data: lb } = useData<Leaderboard>("leaderboard.json");
  const [filters] = useFilters();
  const qs = useQueryString();
  const nav = useNavigate();
  const { familyColor, pal } = useTheme();
  if (error) return <ErrorBox error={error} />;
  if (!f || !meta || !lb) return <Loading />;
  const S = strategyMap(meta);
  const m = lb.metrics[filters.period][filters.cost];
  const top = Object.keys(m).filter((s) => S[s]?.family !== "Benchmark").sort((a, b) => (m[b].sharpe ?? -9) - (m[a].sharpe ?? -9)).slice(0, 5);
  const main = f.cards.filter((c) => c.question != null && c.question !== 6 && c.question !== 8).slice(0, 6);
  const more = f.cards.filter((c) => !main.includes(c));
  const full = lb.metrics.full.net;
  return (
    <div>
      <PageHeader title="Which trading algorithms actually work on Indian stocks, and after costs?">
        <p className="mt-2 text-ink2 max-w-3xl">
          AlgoLens ran {meta.strategies.length - 2} strategies and 2 benchmarks on {meta.universe.length} Nifty 50 stocks from {meta.start.slice(0, 4)} to {meta.end}, with the same ₹10 lakh,
          next-day-open execution and Indian delivery costs. Every number below comes from real NSE prices; nothing is simulated.
        </p>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 mb-6">
        {main.map((c, i) => (
          <article key={c.id} className="card p-4 flex flex-col">
            <div className="text-[12px] text-muted mb-1">Finding {i + 1}{c.question ? ` · Question ${c.question}` : ""}</div>
            <h2 className="font-semibold leading-snug">{c.title}</h2>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tnum whitespace-nowrap">{c.metric}</span>
              <span className="text-[12px] text-ink2">{c.metric_label}</span>
            </div>
            <p className="mt-2 text-[13px] text-ink2 leading-relaxed">{c.body}</p>
            {c.chart && (
              <div className="mt-3 flex-1">
                <div className="text-[11px] text-muted mb-1">{c.chart.label}</div>
                <HBarChart unit={c.chart.unit} v1Label="bar" v2Label={c.chart.type === "bar2" ? "dot" : undefined}
                  onClick={(id) => S[id] && nav(`/strategy/${id}${qs}`)}
                  rows={c.chart.data.filter((d, k) => k < 6 || S[d.id]?.family === "Benchmark").map((d) => ({ id: d.id, label: d.label, value: d.value, value2: d.value2, color: S[d.id] ? familyColor(S[d.id].family) : pal.series[0] }))} />
              </div>
            )}
            <Link to={`${c.page}${qs}`} className="mt-3 text-[13px] font-medium" style={{ color: "var(--accent)" }}>See the evidence →</Link>
          </article>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] mb-6">
        <ChartCard title="Hit rate vs Sharpe, one dot per strategy (2010 – latest, net)"
          meaning="Dots far apart on the vertical axis can share almost the same hit rate. How often a signal is right says little about whether it makes money after costs."
          table={<table className="text-[12px] w-full tnum"><thead><tr className="text-muted text-left"><th>Strategy</th><th>Hit rate</th><th>Win rate</th><th>Sharpe</th></tr></thead>
            <tbody>{Object.keys(full).map((s) => <tr key={s}><td>{S[s]?.name}</td><td>{pct(full[s].hit_rate)}</td><td>{pct(full[s].win_rate)}</td><td>{num(full[s].sharpe)}</td></tr>)}</tbody></table>}>
          <StrategyScatter qs={qs} strategies={S} xLabel="Hit rate (long days followed by an up day)" yLabel="Net Sharpe"
            xRef={full.buy_hold.base_rate ?? undefined}
            points={Object.keys(full).map((s) => ({ id: s, x: full[s].hit_rate, y: full[s].sharpe, extra: { "Win rate": pct(full[s].win_rate) } }))} />
        </ChartCard>
        <ChartCard title={`Top 5 by Sharpe · ${filters.cost === "net" ? "net" : "gross"}`} meaning="Click a strategy to open its deep dive. The dashed line on the scatter is the base rate of up days.">
          <ol className="divide-y divide-[var(--grid)]">
            {top.map((s, i) => (
              <li key={s}>
                <button className="w-full grid grid-cols-[20px_1fr_auto_auto] items-center gap-3 py-2 text-left hover:bg-[var(--surface-2)] rounded px-1" onClick={() => nav(`/strategy/${s}${qs}`)}>
                  <span className="text-muted tnum">{i + 1}</span>
                  <span className="flex items-center min-w-0"><FamilyDot family={S[s].family} /><span className="truncate">{S[s].name}</span></span>
                  <Sparkline values={lb.sparklines[s]} color={familyColor(S[s].family)} width={90} />
                  <span className="tnum text-right w-24"><b>{num(m[s].sharpe)}</b> <span className="text-muted text-[12px]">{pct(m[s].cagr)}</span></span>
                </button>
              </li>
            ))}
          </ol>
          <Link to={`/leaderboard${qs}`} className="mt-2 inline-block text-[13px] font-medium" style={{ color: "var(--accent)" }}>Full leaderboard →</Link>
        </ChartCard>
      </div>

      <h2 className="text-lg font-semibold mb-3">More findings</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {more.map((c) => (
          <ChartCard key={c.id} title={c.title} meaning={c.body}>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-xl font-semibold tnum whitespace-nowrap">{c.metric}</span>
              <span className="text-[12px] text-ink2">{c.metric_label}</span>
            </div>
            {c.chart && (
              <>
                <div className="text-[12px] text-muted mb-1">{c.chart.label}</div>
                <HBarChart unit={c.chart.unit} v1Label="bar" v2Label={c.chart.type === "bar2" ? "dot" : undefined}
                  rows={c.chart.data.map((d) => ({ id: d.id, label: d.label, value: d.value, value2: d.value2, color: S[d.id] ? familyColor(S[d.id].family) : pal.series[0] }))} />
              </>
            )}
          </ChartCard>
        ))}
      </div>
    </div>
  );
}
