import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { HBarChart } from "../components/charts";
import { StrategyScatter } from "../components/StrategyScatter";
import { ChartCard, ErrorBox, Legend, Loading, PageHeader, strategyMap, TipBox, useMeta } from "../components/ui";
import { useData } from "../lib/data";
import { downloadCSV } from "../lib/exporters";
import { useParam, useQueryString } from "../lib/filters";
import { num, pct } from "../lib/format";
import { FAMILY_ORDER, useTheme } from "../lib/theme";

interface Pt { sid: string; symbol: string; sector: string; hit_rate: number; base_rate: number; sharpe: number; cagr: number; win_rate: number | null; payoff: number | null; n_trades: number; gross_sharpe: number }
interface Uni { hit_rate: number; accuracy: number; precision: number; recall: number; f1: number; base_rate: number; win_rate: number | null; payoff_ratio: number | null; profit_factor: number | null; sharpe: number; cagr: number; confusion: { tp: number; fp: number; fn: number; tn: number }; ic: number | null; ic_t: number | null; auc?: number | null; n_trades: number; expectancy_pct: number | null }
interface MLBlock { roc: [number, number][]; auc: number; auc_by_year: { year: number; auc: number }[]; deciles: { decile: number; p: number; up_rate: number; avg_ret: number }[]; share_long: number }
interface AccFile { points: Pt[]; universe: Record<string, Uni>; ml: Record<string, MLBlock>; hit_vs_sharpe: { spearman: number; pearson: number; n: number };
  feature_importance: Record<string, { feature: string; label: string; value: number }[]> }

export default function Accuracy() {
  const meta = useMeta();
  const qs = useQueryString();
  const { pal, familyColor } = useTheme();
  const { data: a, error } = useData<AccFile>("accuracy.json");
  const [fam, setFam] = useParam("hl", "Machine learning");
  const S = strategyMap(meta);
  const pts = useMemo(() => (a ? a.points.filter((p) => p.sid !== "buy_hold" && p.hit_rate != null && p.sharpe != null) : []), [a]);
  if (error) return <ErrorBox error={error} />;
  if (!a || !meta) return <Loading />;
  const U = a.universe;
  const ids = Object.keys(U);
  const mlIds = Object.keys(a.ml);
  const hl = pts.filter((p) => S[p.sid]?.family === fam);
  const rest = pts.filter((p) => S[p.sid]?.family !== fam);
  const base = U.buy_hold?.base_rate ?? 0.5;
  const dec = (a.ml.random_forest ?? a.ml[mlIds[0]])?.deciles ?? [];
  const famWin = ["Trend", "Mean reversion"].map((fam) => {
    const xs = ids.filter((s) => S[s]?.family === fam && U[s].win_rate != null && U[s].payoff_ratio != null);
    return { fam, win: xs.reduce((t, s) => t + (U[s].win_rate ?? 0), 0) / (xs.length || 1), pay: xs.reduce((t, s) => t + (U[s].payoff_ratio ?? 0), 0) / (xs.length || 1) };
  });
  return (
    <div>
      <PageHeader title="Accuracy vs effectiveness" question="Does higher prediction accuracy mean higher profit? Where do the two diverge?" />
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <ChartCard title={`Hit rate vs net Sharpe · every strategy × stock (${pts.length} pairs)`}
          meaning={`Spearman correlation ${num(a.hit_vs_sharpe.spearman)}: knowing a strategy-stock pair's hit rate tells you little about its Sharpe. The dashed line is the share of up days (${pct(base)}).`}
          actions={<select value={fam} onChange={(e) => setFam(e.target.value)} aria-label="Highlight family">{FAMILY_ORDER.filter((f) => f !== "Momentum" && f !== "Stat-arb").map((f) => <option key={f}>{f}</option>)}</select>}
          table={<PointsTable pts={pts} names={(s) => S[s]?.name ?? s} />}>
          <Legend items={[{ label: `${fam} (highlighted)`, color: familyColor(fam), marker: "dot" }, { label: "Other per-stock strategies", color: pal.axis, marker: "dot" }]} />
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
              <CartesianGrid stroke={pal.grid} />
              <XAxis type="number" dataKey="hit_rate" tickFormatter={(v) => pct(v, 0)} domain={["auto", "auto"]} stroke={pal.axis} tickLine={false}
                label={{ value: "Hit rate", position: "insideBottom", offset: -10, fill: pal.muted, fontSize: 12 }} />
              <YAxis type="number" dataKey="sharpe" tickFormatter={(v) => num(v, 1)} stroke={pal.axis} tickLine={false} width={40} />
              <ZAxis range={[28, 28]} />
              <ReferenceLine x={base} stroke={pal.muted} strokeDasharray="4 4" />
              <ReferenceLine y={0} stroke={pal.axis} />
              <Tooltip cursor={false} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as Pt;
                return <TipBox title={`${S[p.sid]?.name} · ${p.symbol}`} rows={[{ label: "Hit rate", value: pct(p.hit_rate) }, { label: "Net Sharpe", value: num(p.sharpe) },
                  { label: "Win rate", value: pct(p.win_rate, 0) }, { label: "Payoff", value: `${num(p.payoff, 1)}x` }, { label: "Trades", value: p.n_trades }]} />;
              }} />
              <Scatter data={rest} fill={pal.axis} isAnimationActive={false} />
              <Scatter data={hl} fill={familyColor(fam)} stroke={pal.surface} strokeWidth={1} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Win rate vs payoff ratio · one dot per strategy"
          meaning={`Profit needs win rate × average win to beat loss rate × average loss. Averages here: ${famWin.map((x) => `${x.fam} wins ${pct(x.win, 0)} of trades at ${num(x.pay, 1)}x payoff`).join("; ")}.`}>
          <StrategyScatter qs={qs} strategies={S} xLabel="Win rate (closed trades)" yLabel="Payoff (avg win / avg loss)" yFmt={(v) => `${v.toFixed(1)}x`} xFmt={(v) => pct(v, 0)} yRef={1}
            points={ids.filter((s) => U[s].payoff_ratio != null).map((s) => ({ id: s, x: U[s].win_rate, y: U[s].payoff_ratio, extra: { "Net Sharpe": num(U[s].sharpe) } }))} />
        </ChartCard>
      </div>

      <ChartCard title="Signal quality by strategy (2010 – latest)" className="mb-4"
        meaning="Hit rate = share of long days followed by an up close. Precision = hit rate; recall = share of up days the strategy was long for. IC = rank correlation of the signal's strength with the next return (momentum and ML only)."
        actions={<button className="chip" onClick={() => downloadCSV("algolens_accuracy.csv", [["strategy", "hit_rate", "accuracy", "precision", "recall", "f1", "base_rate", "win_rate", "payoff", "ic", "ic_t", "auc", "net_sharpe"],
          ...ids.map((s) => [S[s]?.name, U[s].hit_rate, U[s].accuracy, U[s].precision, U[s].recall, U[s].f1, U[s].base_rate, U[s].win_rate, U[s].payoff_ratio, U[s].ic, U[s].ic_t, U[s].auc, U[s].sharpe])])}>CSV</button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] tnum min-w-[860px]">
            <thead><tr className="text-left text-muted border-b border-edge">{["Strategy", "Hit rate", "vs base", "Accuracy", "Recall", "F1", "Win rate", "Payoff", "IC (t)", "AUC", "Net Sharpe"].map((h) => <th key={h} className="py-2 pr-3 font-normal">{h}</th>)}</tr></thead>
            <tbody>{ids.map((s) => (
              <tr key={s} className="border-b border-[var(--grid)]">
                <td className="py-1.5 pr-3">{S[s]?.name}</td><td>{pct(U[s].hit_rate)}</td>
                <td style={{ color: (U[s].hit_rate ?? 0) > (U[s].base_rate ?? 0) ? "var(--good)" : "var(--bad)" }}>{U[s].hit_rate != null ? `${((U[s].hit_rate - U[s].base_rate) * 100).toFixed(1)} pp` : "–"}</td>
                <td>{pct(U[s].accuracy)}</td><td>{pct(U[s].recall, 0)}</td><td>{num(U[s].f1)}</td><td>{pct(U[s].win_rate, 0)}</td><td>{U[s].payoff_ratio != null ? `${num(U[s].payoff_ratio, 1)}x` : "–"}</td>
                <td>{U[s].ic != null ? `${num(U[s].ic, 3)} (${num(U[s].ic_t, 1)})` : "–"}</td><td>{num(U[s].auc, 3)}</td><td className="font-medium">{num(U[s].sharpe)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </ChartCard>

      <h2 className="text-lg font-semibold mb-3">Machine-learning models (walk-forward, out-of-sample only)</h2>
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <ChartCard title="ROC curves" meaning="The diagonal is a coin flip. Curves hugging it mean the models rank up-days only slightly better than chance.">
          <Legend items={mlIds.map((s, i) => ({ label: `${S[s]?.name} (AUC ${a.ml[s].auc.toFixed(3)})`, color: pal.series[[4, 6, 0][i] ?? i] }))} />
          <ResponsiveContainer width="100%" height={300}>
            <LineChart margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
              <CartesianGrid stroke={pal.grid} />
              <XAxis type="number" dataKey="x" domain={[0, 1]} tickFormatter={(v) => num(v, 1)} stroke={pal.axis} tickLine={false} label={{ value: "False positive rate", position: "insideBottom", offset: -10, fill: pal.muted, fontSize: 12 }} />
              <YAxis type="number" domain={[0, 1]} tickFormatter={(v) => num(v, 1)} stroke={pal.axis} tickLine={false} width={36} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke={pal.muted} strokeDasharray="4 4" />
              <Tooltip content={({ active, payload }) => active && payload?.length ? <TipBox rows={payload.map((p) => ({ label: String(p.name), value: `TPR ${num(Number(p.value), 3)}`, color: String(p.color) }))} /> : null} />
              {mlIds.map((s, i) => (
                <Line key={s} name={S[s]?.name} data={a.ml[s].roc.map(([x, y]) => ({ x, y }))} dataKey="y" stroke={pal.series[[4, 6, 0][i] ?? i]} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Out-of-sample AUC by test year" meaning="Each model was trained only on years before the test year. AUC drifting around 0.5 means the edge is small and unstable.">
          <Legend items={mlIds.map((s, i) => ({ label: S[s]?.name ?? s, color: pal.series[[4, 6, 0][i] ?? i] }))} />
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={a.ml[mlIds[0]].auc_by_year.map((r, k) => ({ year: r.year, ...Object.fromEntries(mlIds.map((s) => [s, a.ml[s].auc_by_year[k]?.auc])) }))} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={pal.grid} vertical={false} />
              <XAxis dataKey="year" stroke={pal.axis} tickLine={false} />
              <YAxis domain={[0.47, 0.56]} tickFormatter={(v) => num(v, 2)} stroke={pal.axis} tickLine={false} width={40} />
              <ReferenceLine y={0.5} stroke={pal.muted} strokeDasharray="4 4" />
              <Tooltip content={({ active, payload, label }) => active && payload?.length ? <TipBox title={String(label)} rows={payload.map((p) => ({ label: S[String(p.dataKey)]?.name, value: num(Number(p.value), 3), color: String(p.color) }))} /> : null} />
              {mlIds.map((s, i) => <Line key={s} dataKey={s} stroke={pal.series[[4, 6, 0][i] ?? i]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        {mlIds.map((s) => {
          const c = U[s].confusion;
          const tot = c.tp + c.fp + c.fn + c.tn;
          const cell = (v: number, good: boolean) => (
            <div className="rounded-md p-3 text-center" style={{ background: good ? pal.divPos[0] : pal.divNeg[0], color: pal.text }}>
              <div className="text-lg font-semibold tnum">{v.toLocaleString("en-IN")}</div><div className="text-[11px]">{pct(v / tot)}</div>
            </div>
          );
          return (
            <ChartCard key={s} title={`${S[s]?.name}: confusion matrix`} meaning={`Long ${pct(a.ml[s].share_long, 0)} of stock-days. Precision ${pct(U[s].precision)} vs base rate ${pct(U[s].base_rate)}.`}>
              <div className="grid grid-cols-[auto_1fr_1fr] gap-1.5 text-[12px] items-center">
                <span /><span className="text-center text-muted">Actual up</span><span className="text-center text-muted">Actual down</span>
                <span className="text-muted pr-1">Predicted up</span>{cell(c.tp, true)}{cell(c.fp, false)}
                <span className="text-muted pr-1">Predicted down</span>{cell(c.fn, false)}{cell(c.tn, true)}
              </div>
            </ChartCard>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Calibration: next-day up rate by predicted-probability decile (random forest)" meaning={`If the model had a real edge, the top deciles would rise clearly above the bottom ones. Top decile up-rate ${pct(dec.at(-1)?.up_rate)} vs bottom ${pct(dec[0]?.up_rate)} (${(((dec.at(-1)?.up_rate ?? 0) - (dec[0]?.up_rate ?? 0)) * 100).toFixed(1)} pp).`}>
          <HBarChart unit="pct" v1Label="up rate" v2Label="avg predicted p"
            rows={(a.ml.random_forest ?? a.ml[mlIds[0]]).deciles.map((d) => ({ id: String(d.decile), label: `Decile ${d.decile}`, value: d.up_rate, value2: d.p, color: familyColor("Machine learning") }))} />
        </ChartCard>
        <ChartCard title="Feature importance (random forest, averaged over folds)" meaning={`Which inputs the trees split on most. The top three: ${(a.feature_importance.random_forest ?? []).slice(0, 3).map((f) => f.label).join(", ")}. High importance does not mean the feature predicts well, only that it was used.`}>
          <HBarChart unit="ratio" v1Label="importance"
            rows={(a.feature_importance.random_forest ?? []).map((f) => ({ id: f.feature, label: f.label, value: f.value, color: familyColor("Machine learning") }))} />
        </ChartCard>
      </div>
    </div>
  );
}

function PointsTable({ pts, names }: { pts: Pt[]; names: (s: string) => string }) {
  return (
    <table className="text-[12px] tnum w-full">
      <thead><tr className="text-left text-muted"><th>Strategy</th><th>Stock</th><th>Hit rate</th><th>Sharpe</th><th>Win</th><th>Payoff</th></tr></thead>
      <tbody>{pts.map((p) => <tr key={p.sid + p.symbol}><td>{names(p.sid)}</td><td>{p.symbol}</td><td>{pct(p.hit_rate)}</td><td>{num(p.sharpe)}</td><td>{pct(p.win_rate, 0)}</td><td>{num(p.payoff, 1)}</td></tr>)}</tbody>
    </table>
  );
}
