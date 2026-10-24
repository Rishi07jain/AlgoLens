import { HBarChart, MatrixHeatmap } from "../components/charts";
import { ChartCard, ErrorBox, FamilyDot, Loading, PageHeader, strategyMap, useMeta } from "../components/ui";
import { useData } from "../lib/data";
import { downloadCSV } from "../lib/exporters";
import { useParam } from "../lib/filters";
import { num, pct } from "../lib/format";
import { divergingColor, divergingInk, useTheme } from "../lib/theme";
import type { Leaderboard } from "../lib/types";

interface Cell { x: number; y: number; sharpe: number; cagr: number; sharpe_is: number; sharpe_oos: number; default: boolean }
interface Grid { strategy: string; x: string; y: string; xs: number[]; ys: number[]; cells: Cell[];
  best_is: { x: number; y: number; sharpe_is: number; sharpe_oos: number; oos_rank: number; n_cells: number }; default: { sharpe_is: number; sharpe_oos: number }; share_positive_oos: number }
interface Rob {
  cost_axes: { slippage_bps: number[]; brokerage_pct: number[] };
  cost_grid: Record<string, { cagr: number; sharpe: number }[][]>;
  cost_drag: Record<string, { gross_cagr: number; net_cagr: number; gross_sharpe: number; net_sharpe: number; turnover: number; annual_cost: number }>;
  param_grids: Grid[]; yearly: Record<string, { year: number; ret: number; sharpe: number }[]>;
  bootstrap: Record<string, { sharpe: number; lo: number; hi: number }>;
  deflated: Record<string, { dsr: number; sr0_annual: number; n_trials: number }>; n_trials: number;
}

export default function Robustness() {
  const meta = useMeta();
  const { pal, familyColor } = useTheme();
  const { data: r, error } = useData<Rob>("robustness.json");
  const { data: lb } = useData<Leaderboard>("leaderboard.json");
  const [slip, setSlip] = useParam("slip", "1");
  const [brok, setBrok] = useParam("brok", "0");
  const [grid, setGrid] = useParam("grid", "sma_50_200");
  const [gm, setGm] = useParam("gm", "sharpe_oos");
  const S = strategyMap(meta);
  if (error) return <ErrorBox error={error} />;
  if (!r || !lb || !meta) return <Loading />;
  const ids = Object.keys(r.cost_drag);
  const active = ids.filter((s) => S[s]?.family !== "Benchmark");
  const si = Number(slip), bi = Number(brok);
  const g = r.param_grids.find((x) => x.strategy === grid) ?? r.param_grids[0];
  const isM = lb.metrics.is.net, oosM = lb.metrics.oos.net;
  const years = r.yearly[ids[0]].map((y) => y.year);
  return (
    <div>
      <PageHeader title="Costs & robustness" question="How much return survives Indian transaction costs? Do results hold out of sample, or are they tuned to one lucky parameter set?" />
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <ChartCard title="CAGR gross (bar) vs net (dot), 2010 – latest"
          meaning={`Default costs: STT 0.1% each side, NSE ${(meta.costs.net.exchange_txn_pct * 100).toFixed(5)}%, SEBI fee, 18% GST, 0.015% stamp duty on buys and 5 bps slippage per side ≈ ${pct(meta.costs.net.round_trip, 2)} a round trip. High-turnover strategies lose the most.`}
          table={<table className="text-[12px] tnum w-full"><thead><tr className="text-muted text-left"><th>Strategy</th><th>Gross CAGR</th><th>Net CAGR</th><th>Turnover</th><th>Costs / yr</th></tr></thead>
            <tbody>{ids.map((s) => <tr key={s}><td>{S[s]?.name}</td><td>{pct(r.cost_drag[s].gross_cagr)}</td><td>{pct(r.cost_drag[s].net_cagr)}</td><td>{num(r.cost_drag[s].turnover, 1)}x</td><td>{pct(r.cost_drag[s].annual_cost, 2)}</td></tr>)}</tbody></table>}>
          <HBarChart unit="pct" v1Label="gross" v2Label="net"
            rows={[...ids].sort((a, b) => (r.cost_drag[b].gross_cagr - r.cost_drag[b].net_cagr) - (r.cost_drag[a].gross_cagr - r.cost_drag[a].net_cagr))
              .map((s) => ({ id: s, label: S[s]?.name, value: r.cost_drag[s].gross_cagr, value2: r.cost_drag[s].net_cagr, color: familyColor(S[s]?.family) }))} />
        </ChartCard>
        <ChartCard title="Cost sensitivity: change slippage and brokerage"
          meaning="Results were precomputed for each slider position (no in-browser backtest). Brokerage is per side as a % of trade value; 0.03% is roughly ₹20 on a ₹67k order, 0.3% is a full-service broker."
          actions={<button className="chip" onClick={() => downloadCSV("algolens_cost_grid.csv", [["strategy", "brokerage_pct", "slippage_bps", "cagr", "sharpe"],
            ...ids.flatMap((s) => r.cost_axes.brokerage_pct.flatMap((b, i) => r.cost_axes.slippage_bps.map((sl, j) => [S[s]?.name, b, sl, r.cost_grid[s][i][j].cagr, r.cost_grid[s][i][j].sharpe])))])}>CSV</button>}>
          <div className="grid sm:grid-cols-2 gap-4 mb-3 text-[13px]">
            <label className="block"><span className="text-muted">Slippage per side: <b className="text-ink">{r.cost_axes.slippage_bps[si]} bps</b></span>
              <input type="range" min={0} max={r.cost_axes.slippage_bps.length - 1} step={1} value={si} onChange={(e) => setSlip(e.target.value)} className="w-full" aria-label="Slippage" /></label>
            <label className="block"><span className="text-muted">Brokerage per side: <b className="text-ink">{(r.cost_axes.brokerage_pct[bi] * 100).toFixed(2)}%</b></span>
              <input type="range" min={0} max={r.cost_axes.brokerage_pct.length - 1} step={1} value={bi} onChange={(e) => setBrok(e.target.value)} className="w-full" aria-label="Brokerage" /></label>
          </div>
          <div className="text-[12px] text-muted mb-1">Sharpe at these costs (bar) vs gross, with no costs at all (dot). Statutory charges (STT, fees, GST, stamp duty) always apply.</div>
          <HBarChart unit="ratio" v1Label="at these costs" v2Label="gross"
            rows={[...ids].sort((a, b) => r.cost_grid[b][bi][si].sharpe - r.cost_grid[a][bi][si].sharpe)
              .map((s) => ({ id: s, label: S[s]?.name, value: r.cost_grid[s][bi][si].sharpe, value2: r.cost_drag[s].gross_sharpe, color: familyColor(S[s]?.family) }))} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr] mb-4">
        <ChartCard title="Parameter heatmap"
          meaning={`Best 2010-19 setting: ${g.x} ${g.best_is.x}, ${g.y} ${g.best_is.y} (Sharpe ${num(g.best_is.sharpe_is)}). After 2020 it ranked ${g.best_is.oos_rank} of ${g.best_is.n_cells}. ${pct(g.share_positive_oos, 0)} of settings kept a positive Sharpe out of sample. A broad plateau of similar colours is more trustworthy than one bright cell.`}
          actions={<>
            <select value={grid} onChange={(e) => setGrid(e.target.value)} aria-label="Strategy grid">{r.param_grids.map((x) => <option key={x.strategy} value={x.strategy}>{S[x.strategy]?.name}</option>)}</select>
            <select value={gm} onChange={(e) => setGm(e.target.value)} aria-label="Grid metric"><option value="sharpe_is">Sharpe 2010-19</option><option value="sharpe_oos">Sharpe 2020+</option><option value="sharpe">Sharpe full</option><option value="cagr">CAGR full</option></select>
          </>}>
          <div className="overflow-x-auto">
            <table className="text-[12px] tnum border-separate" style={{ borderSpacing: 3 }}>
              <thead><tr><th className="text-muted font-normal text-left pr-2">{g.x} ↓ / {g.y} →</th>{g.ys.map((y) => <th key={y} className="text-muted font-normal min-w-[60px]">{y}</th>)}</tr></thead>
              <tbody>{g.xs.map((x) => (
                <tr key={x}><td className="text-ink2 pr-2">{x}</td>
                  {g.ys.map((y) => {
                    const c = g.cells.find((k) => k.x === x && k.y === y);
                    const v = c ? (c[gm as keyof Cell] as number) : null;
                    const sc = gm === "cagr" ? 0.25 : 1.2;
                    const isBest = c && c.x === g.best_is.x && c.y === g.best_is.y;
                    return <td key={y} className="text-center rounded-md h-10 relative" title={c ? `IS ${num(c.sharpe_is)} · OOS ${num(c.sharpe_oos)} · full ${num(c.sharpe)}` : "not valid"}
                      style={{ background: c ? divergingColor(pal, v, sc) : "transparent", color: divergingInk(pal, v, sc), outline: c?.default ? `2px solid ${pal.text}` : isBest ? `2px dashed ${pal.text}` : undefined }}>
                      {c ? (gm === "cagr" ? pct(v, 0) : num(v)) : <span className="text-muted">·</span>}
                    </td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
            <p className="text-[12px] text-muted mt-2">Solid outline = default setting. Dashed outline = best in-sample setting.</p>
          </div>
        </ChartCard>
        <ChartCard title="In-sample (2010-19, bar) vs out-of-sample (2020+, dot) Sharpe"
          meaning="Every strategy used fixed default parameters chosen before looking at results. A dot well left of its bar means the edge faded after 2019.">
          <HBarChart unit="ratio" v1Label="2010-19" v2Label="2020+"
            rows={ids.map((s) => ({ id: s, label: S[s]?.name, value: isM[s].sharpe, value2: oosM[s].sharpe, color: familyColor(S[s]?.family) }))} />
        </ChartCard>
      </div>

      <ChartCard className="mb-4" title="Walk-forward timeline: calendar-year return (net)"
        meaning="Each column is one year. Strategies that only work in a few years show isolated blue cells; consistent ones show long blue runs."
        actions={<button className="chip" onClick={() => downloadCSV("algolens_yearly.csv", [["strategy", ...years], ...ids.map((s) => [S[s]?.name, ...r.yearly[s].map((y) => y.ret)])])}>CSV</button>}>
        <MatrixHeatmap rowLabel="Strategy" scale={0.4} fmt={(v) => (v == null ? "" : (v * 100).toFixed(0))}
          rows={ids.map((s) => ({ id: s, label: <span className="flex items-center"><FamilyDot family={S[s]?.family} />{S[s]?.name}</span> }))}
          cols={years.map((y) => ({ id: String(y), label: String(y) }))}
          value={(s, c) => r.yearly[s].find((y) => String(y.year) === c)?.ret} />
      </ChartCard>

      <ChartCard title={`Is the Sharpe real? Bootstrap 95% interval and deflated Sharpe (${r.n_trials} configurations tested)`}
        meaning="Bars show the 95% range of Sharpe from a block bootstrap of daily returns. The deflated Sharpe ratio (DSR) is the probability the true Sharpe beats the best you would expect by luck from this many trials; 95% is the usual bar."
        table={<table className="text-[12px] tnum w-full"><thead><tr className="text-muted text-left"><th>Strategy</th><th>Sharpe</th><th>95% low</th><th>95% high</th><th>DSR</th></tr></thead>
          <tbody>{ids.map((s) => <tr key={s}><td>{S[s]?.name}</td><td>{num(r.bootstrap[s].sharpe)}</td><td>{num(r.bootstrap[s].lo)}</td><td>{num(r.bootstrap[s].hi)}</td><td>{pct(r.deflated[s].dsr, 0)}</td></tr>)}</tbody></table>}>
        <CIChart ids={[...active, "buy_hold", "nifty_bh"].sort((a, b) => r.bootstrap[b].sharpe - r.bootstrap[a].sharpe)} r={r} names={(s) => S[s]?.name ?? s} color={(s) => familyColor(S[s]?.family)} />
      </ChartCard>
    </div>
  );
}

function CIChart({ ids, r, names, color }: { ids: string[]; r: Rob; names: (s: string) => string; color: (s: string) => string }) {
  const { pal } = useTheme();
  const lo = Math.min(...ids.map((s) => r.bootstrap[s].lo)), hi = Math.max(...ids.map((s) => r.bootstrap[s].hi));
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return (
    <div className="text-[12px]">
      {ids.map((s) => {
        const b = r.bootstrap[s];
        const dsr = r.deflated[s].dsr;
        return (
          <div key={s} className="grid grid-cols-[minmax(90px,170px)_1fr_120px] items-center gap-2 py-[3px] hover:bg-[var(--surface-2)] rounded px-1"
            title={`${names(s)}: Sharpe ${num(b.sharpe)} (95% ${num(b.lo)} to ${num(b.hi)}), DSR ${pct(dsr, 0)}`}>
            <span className="truncate text-ink2">{names(s)}</span>
            <div className="relative h-4">
              <div className="absolute top-0 bottom-0 w-px" style={{ left: `${x(0)}%`, background: pal.axis }} />
              <div className="absolute top-[6px] h-[4px] rounded-full" style={{ left: `${x(b.lo)}%`, width: `${x(b.hi) - x(b.lo)}%`, background: color(s), opacity: 0.55 }} />
              <div className="absolute top-1/2 w-[9px] h-[9px] rounded-full -translate-x-1/2 -translate-y-1/2" style={{ left: `${x(b.sharpe)}%`, background: color(s), boxShadow: `0 0 0 2px ${pal.surface}` }} />
            </div>
            <span className="tnum text-right">{num(b.sharpe)} · <span className={dsr >= 0.95 ? "" : "text-muted"}>DSR {pct(dsr, 0)}</span></span>
          </div>
        );
      })}
    </div>
  );
}
