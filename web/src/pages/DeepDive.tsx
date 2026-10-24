import { lazy, Suspense } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DrawdownChart, EquityChart, MonthlyHeatmap } from "../components/charts";
import { ChartCard, ErrorBox, Legend, Loading, PageHeader, Stat, strategyMap, TipBox, useMeta } from "../components/ui";
import { useData } from "../lib/data";
import { downloadCSV } from "../lib/exporters";
import { useFilters, useParam, useQueryString } from "../lib/filters";
import { inr, num, pct } from "../lib/format";
import { FAMILY_ORDER, useTheme } from "../lib/theme";
import type { Leaderboard, Meta, StockFile, Strategy, StrategyFile, Trade } from "../lib/types";

const Candles = lazy(() => import("../components/Candles"));

export default function DeepDive() {
  const { id = "ema_12_26" } = useParams();
  const meta = useMeta();
  const [stock, setStock] = useParam("stock", "ALL");
  const qs = useQueryString();
  const nav = useNavigate();
  const S = strategyMap(meta);
  if (!meta) return <Loading />;
  const s = S[id] ?? S["ema_12_26"];
  const stockable = s.kind !== "index";
  const goto = (sid: string) => nav(`/strategy/${sid}${qs}${stock !== "ALL" && S[sid]?.kind !== "index" ? `${qs ? "&" : "?"}stock=${stock}` : ""}`);
  return (
    <div>
      <PageHeader title={`${s.name}`} question={s.logic}>
        <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
          <label className="flex items-center gap-2"><span className="text-muted">Strategy</span>
            <select value={s.id} onChange={(e) => goto(e.target.value)}>
              {[...FAMILY_ORDER, "Benchmark"].map((fam) => (
                <optgroup key={fam} label={fam}>
                  {meta.strategies.filter((x) => x.family === fam).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          {stockable && (
            <label className="flex items-center gap-2 max-w-full min-w-0"><span className="text-muted">Scope</span>
              <select className="max-w-full min-w-0" value={stock} onChange={(e) => setStock(e.target.value)}>
                <option value="ALL">Whole universe ({meta.universe.length} stocks)</option>
                {meta.universe.map((u) => <option key={u.symbol} value={u.symbol}>{u.symbol} · {u.name}</option>)}
              </select>
            </label>
          )}
          <span className="chip self-center">{s.family} · {s.priority} · {Object.entries(s.params).map(([k, v]) => `${k} ${v}`).join(", ") || "no parameters"}</span>
        </div>
        {s.note && <p className="mt-2 text-[13px] text-ink2 max-w-3xl">Note: {s.note}</p>}
      </PageHeader>
      {stock === "ALL" || !stockable ? <UniverseView s={s} meta={meta} /> : <StockView s={s} symbol={stock} meta={meta} />}
    </div>
  );
}

function UniverseView({ s, meta }: { s: Strategy; meta: Meta }) {
  const [f] = useFilters();
  const { pal, familyColor } = useTheme();
  const { data: d, error } = useData<StrategyFile>(`strategies/${s.id}.json`);
  const { data: lb } = useData<Leaderboard>("leaderboard.json");
  if (error) return <ErrorBox error={error} />;
  if (!d || !lb) return <Loading />;
  const m = lb.metrics[f.period][f.cost][s.id];
  const g = lb.metrics[f.period].gross[s.id];
  const n = lb.metrics[f.period].net[s.id];
  const color = familyColor(s.family);
  const startIdx = f.period === "oos" ? d.dates.findIndex((x) => x >= meta.oos_start) : 0;
  const endIdx = f.period === "is" ? d.dates.findIndex((x) => x > meta.is_end) : d.dates.length;
  const sl = <T,>(a: T[]) => a.slice(Math.max(startIdx, 0), endIdx < 0 ? undefined : endIdx);
  const rebase = (a: number[]) => { const x = sl(a); const b = x[0] || 1; return x.map((v) => (v / b) * meta.capital); };
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Stat label={`CAGR (${f.cost})`} value={pct(m.cagr)} sub={`gross ${pct(g.cagr)} · net ${pct(n.cagr)}`} />
        <Stat label="Sharpe" value={num(m.sharpe)} sub={`Sortino ${num(m.sortino)}`} />
        <Stat label="Max drawdown" value={pct(m.max_dd)} sub={`${m.max_dd_days} days underwater`} />
        <Stat label="Calmar" value={num(m.calmar)} sub={`Vol ${pct(m.vol)}`} />
        <Stat label="Alpha / beta" value={`${pct(m.alpha)}`} sub={`beta ${num(m.beta)} vs Nifty`} />
        <Stat label="Hit rate" value={pct(m.hit_rate)} sub={`base rate ${pct(m.base_rate)}`} />
        <Stat label="Win rate" value={pct(m.win_rate, 0)} sub={`payoff ${num(m.payoff_ratio, 1)}x · PF ${num(m.profit_factor)}`} />
        <Stat label="VaR / CVaR 95%" value={pct(m.var95, 2)} sub={`CVaR ${pct(m.cvar95, 2)} a day`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <ChartCard title="Equity: ₹10 lakh invested (log scale)"
          meaning={`Gross vs net shows what Indian costs took. Exposure averaged ${pct(m.exposure, 0)} with turnover of ${num(m.turnover, 1)}x capital a year (${num(m.trades_per_year, 1)} round trips per stock per year).`}
          table={<table className="text-[12px] tnum w-full"><thead><tr className="text-muted text-left"><th>Week</th><th>Net</th><th>Gross</th><th>Nifty</th></tr></thead>
            <tbody>{sl(d.dates).map((dt, i) => <tr key={dt}><td>{dt}</td><td>{inr(rebase(d.equity_net)[i])}</td><td>{inr(rebase(d.equity_gross)[i])}</td><td>{inr(rebase(d.benchmark)[i])}</td></tr>)}</tbody></table>}>
          <Legend items={[{ label: "Net of costs", color }, { label: "Gross", color, dashed: true }, { label: "Nifty 50 index", color: pal.neutral }]} />
          <EquityChart dates={sl(d.dates)} series={[
            { key: "n", label: "Net of costs", color, values: rebase(d.equity_net) },
            { key: "g", label: "Gross", color, dashed: true, values: rebase(d.equity_gross) },
            { key: "b", label: "Nifty 50 index", color: pal.neutral, values: rebase(d.benchmark) },
          ]} />
        </ChartCard>
        <ChartCard title="Trade return distribution (net)" meaning={`${m.n_trades.toLocaleString("en-IN")} trades. A strategy can lose more often than it wins and still profit if the right tail is long. The end bars collect every trade beyond ±30%.`}>
          {d.trade_hist ? <TradeHist hist={d.trade_hist} color={color} /> : <p className="text-muted text-sm">No closed trades.</p>}
        </ChartCard>
      </div>
      <ChartCard title="Drawdown (net)" meaning={m.dd_peak ? `Worst fall ran from ${m.dd_peak} to ${m.dd_trough}.` : undefined}>
        <DrawdownChart dates={sl(d.dates)} values={f.period === "full" ? d.drawdown : (() => { let pk = 0; return rebase(d.equity_net).map((v) => { pk = Math.max(pk, v); return v / pk - 1; }); })()} color={color} />
      </ChartCard>
      <ChartCard title="Monthly returns (net)" meaning="Each cell is one month's return for the whole portfolio. Long runs of red show when the strategy stopped working.">
        <MonthlyHeatmap monthly={d.monthly} yearly={d.yearly} />
      </ChartCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <TradesTable title="Best trades" trades={d.best_trades} name={`${s.id}_best_trades`} />
        <TradesTable title="Worst trades" trades={d.worst_trades} name={`${s.id}_worst_trades`} />
      </div>
      {d.pairs_chosen && (
        <ChartCard title="Pairs chosen each year (from the prior 2 years only)" meaning="Pairs are re-selected every January using Engle-Granger cointegration on past prices; nothing from the trading year is used.">
          <div className="overflow-auto max-h-80"><table className="text-[12px] tnum w-full"><thead><tr className="text-left text-muted"><th>Year</th><th>Leg A</th><th>Leg B</th><th>Sector</th><th>p-value</th><th>Hedge ratio</th></tr></thead>
            <tbody>{d.pairs_chosen.map((p, i) => <tr key={i} className="border-t border-[var(--grid)]"><td>{p.year}</td><td>{p.a}</td><td>{p.b}</td><td>{p.sector}</td><td>{p.pvalue}</td><td>{p.beta}</td></tr>)}</tbody></table></div>
        </ChartCard>
      )}
      {d.current_holdings && (
        <ChartCard title="Latest momentum portfolio" meaning="The 10 stocks held after the most recent month-end rebalance, by current weight. Not a recommendation.">
          <div className="flex flex-wrap gap-2">{d.current_holdings.map((h) => <span key={h.symbol} className="chip tnum">{h.symbol} {pct(h.weight, 1)}</span>)}</div>
        </ChartCard>
      )}
    </div>
  );
}

function TradeHist({ hist, color }: { hist: { edges: number[]; counts: number[] }; color: string }) {
  const { pal } = useTheme();
  const data = hist.counts.map((c, i) => ({ bin: `${(hist.edges[i] * 100).toFixed(0)}–${(hist.edges[i + 1] * 100).toFixed(0)}%`, mid: (hist.edges[i] + hist.edges[i + 1]) / 2, c }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
        <CartesianGrid stroke={pal.grid} vertical={false} />
        <XAxis dataKey="mid" tickFormatter={(v) => `${Math.round(v * 100)}%`} stroke={pal.axis} tickLine={false} interval={3} />
        <YAxis stroke={pal.axis} tickLine={false} width={44} />
        <Tooltip cursor={{ fill: pal.grid }} content={({ active, payload }) => active && payload?.length ? <TipBox title={`Trade return ${payload[0].payload.bin}`} rows={[{ label: "Trades", value: payload[0].payload.c }]} /> : null} />
        <Bar dataKey="c" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TradesTable({ title, trades, name }: { title: string; trades: Trade[]; name: string }) {
  const csv = () => downloadCSV(`${name}.csv`, [["symbol", "entry", "exit", "entry_px", "exit_px", "ret", "pnl_inr", "days"], ...trades.map((t) => [t.symbol, t.entry, t.exit ?? "open", t.entry_px, t.exit_px, t.ret, t.pnl, t.days])]);
  return (
    <ChartCard title={title} actions={<button className="chip" onClick={csv}>CSV</button>}>
      <div className="overflow-auto max-h-80">
        <table className="text-[12px] tnum w-full">
          <thead><tr className="text-left text-muted"><th>Stock</th><th>Entry</th><th>Exit</th><th className="text-right">Return</th><th className="text-right">P&L (sleeve)</th><th className="text-right">Days</th></tr></thead>
          <tbody>{trades.map((t, i) => (
            <tr key={i} className="border-t border-[var(--grid)]"><td>{t.symbol}</td><td>{t.entry}</td><td>{t.exit ?? "open"}</td>
              <td className="text-right" style={{ color: t.ret >= 0 ? "var(--good)" : "var(--bad)" }}>{pct(t.ret)}</td><td className="text-right">{inr(t.pnl)}</td><td className="text-right">{t.days}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </ChartCard>
  );
}

function StockView({ s, symbol, meta }: { s: Strategy; symbol: string; meta: Meta }) {
  const { pal, familyColor } = useTheme();
  const { data: d, error } = useData<StockFile>(`stocks/${symbol.replace(/[^A-Za-z0-9-]/g, "_")}.json`);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading label={`Loading ${symbol}…`} />;
  const st = d.strategies[s.id];
  const bh = d.strategies["buy_hold"];
  const color = familyColor(s.family);
  const m = st?.metrics;
  const trades = st?.trades ?? [];
  const csv = () => downloadCSV(`${s.id}_${symbol}_trades.csv`, [["entry", "exit", "net_return", "pnl_inr", "days"], ...trades.map((t) => [t[0], t[1] ?? "open", t[2], t[3], t[4]])]);
  return (
    <div className="grid gap-4">
      <p className="text-[13px] text-ink2">{d.name} · {d.sector}. {s.kind === "sleeve" ? `Here the full ₹${(meta.capital / 1e5).toFixed(0)} lakh runs this strategy on ${symbol} alone.` : "This strategy trades across the universe; below are its entries and exits in this stock."}</p>
      {m && st?.gross && st.accuracy && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Stat label="CAGR (net)" value={pct(m.cagr)} sub={`gross ${pct(st.gross.cagr)}`} />
          <Stat label="Sharpe (net)" value={num(m.sharpe)} sub={`gross ${num(st.gross.sharpe)}`} />
          <Stat label="Max drawdown" value={pct(m.max_dd)} sub={`${m.max_dd_days} days`} />
          <Stat label="Trades" value={m.n_trades ?? 0} sub={`${num(m.trades_per_year, 1)} a year`} />
          <Stat label="Win rate" value={pct(m.win_rate, 0)} sub={`payoff ${num(m.payoff_ratio, 1)}x`} />
          <Stat label="Expectancy" value={inr(m.expectancy_inr)} sub={`${pct(m.expectancy_pct, 2)} a trade`} />
          <Stat label="Hit rate" value={pct(st.accuracy.hit_rate)} sub={`base ${pct(st.accuracy.base_rate)}`} />
          <Stat label="Exposure" value={pct(m.exposure, 0)} sub={`buy & hold CAGR ${pct(bh?.metrics?.cagr)}`} />
        </div>
      )}
      <ChartCard title={`${symbol} daily candles with ${s.name} trades`} meaning="B marks a buy at that day's open (the signal fired at the previous close); S marks the exit with the trade's net return. Scroll or pinch to zoom; the view starts at the latest 500 days."
        actions={<button className="chip" onClick={csv}>Trades CSV</button>}>
        <Suspense fallback={<Loading label="Loading chart…" />}>
          <Candles ohlc={d.ohlc} trades={trades} />
        </Suspense>
      </ChartCard>
      {st?.equity && bh?.equity && (
        <ChartCard title={`Equity on ${symbol}: strategy vs buy-and-hold (log scale)`} meaning="Same stock, same start, same costs. The gap is what the timing rule added or took away.">
          <Legend items={[{ label: `${s.name} (net)`, color }, { label: "Buy & hold this stock", color: pal.neutral }]} />
          <EquityChart dates={d.weekly_dates} series={[
            { key: "s", label: s.name, color, values: st.equity },
            { key: "b", label: "Buy & hold", color: pal.neutral, values: bh.equity },
          ]} />
        </ChartCard>
      )}
      <ChartCard title={`Trade list · ${trades.length} trades`}>
        <div className="overflow-auto max-h-96">
          <table className="text-[12px] tnum w-full">
            <thead><tr className="text-left text-muted"><th>Entry (open)</th><th>Exit (open)</th><th className="text-right">Net return</th><th className="text-right">P&L</th><th className="text-right">Days</th></tr></thead>
            <tbody>{[...trades].reverse().map((t, i) => (
              <tr key={i} className="border-t border-[var(--grid)]"><td>{t[0]}</td><td>{t[1] ?? "open"}</td>
                <td className="text-right" style={{ color: t[2] >= 0 ? "var(--good)" : "var(--bad)" }}>{pct(t[2])}</td><td className="text-right">{inr(t[3])}</td><td className="text-right">{t[4]}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}
