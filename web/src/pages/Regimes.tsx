import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MatrixHeatmap } from "../components/charts";
import { ChartCard, ErrorBox, FamilyDot, Legend, Loading, PageHeader, strategyMap, TipBox, useMeta } from "../components/ui";
import { useData } from "../lib/data";
import { downloadCSV } from "../lib/exporters";
import { useParam, useQueryString } from "../lib/filters";
import { num, pct, year, yearTicks } from "../lib/format";
import { useTheme } from "../lib/theme";
import { useNavigate } from "react-router-dom";

interface RegFile {
  vix_terciles: [number, number];
  counts: { trend: Record<string, number>; vol: Record<string, number> };
  sharpe: Record<string, Record<string, number | null>>;
  ann_return: Record<string, Record<string, number | null>>;
  combo: Record<string, Record<string, { sharpe: number; ann_return: number; days: number }>>;
  combo_counts: Record<string, number>;
  nifty: { d: string; c: number; sma: number; vix: number; t: string | null; v: string | null }[];
}

const TREND = ["bull", "sideways", "bear"];
const VOL = ["low", "normal", "high"];

export default function Regimes() {
  const meta = useMeta();
  const qs = useQueryString();
  const nav = useNavigate();
  const { pal } = useTheme();
  const { data: r, error } = useData<RegFile>("regimes.json");
  const [metric, setMetric] = useParam("m", "sharpe");
  const [sel, setSel] = useParam("s", "ema_12_26");
  const S = strategyMap(meta);
  const bands = useMemo(() => {
    if (!r) return [];
    const out: { t: string; a: string; b: string }[] = [];
    r.nifty.forEach((p, i) => {
      if (!p.t) return;
      const last = out[out.length - 1];
      if (last && last.t === p.t && r.nifty[i - 1]?.t === p.t) last.b = p.d;
      else out.push({ t: p.t, a: p.d, b: p.d });
    });
    return out;
  }, [r]);
  if (error) return <ErrorBox error={error} />;
  if (!r || !meta) return <Loading />;
  const ids = Object.keys(r.sharpe);
  const src = metric === "sharpe" ? r.sharpe : r.ann_return;
  const fmt = metric === "sharpe" ? (v: number | null | undefined) => num(v) : (v: number | null | undefined) => pct(v, 0);
  const scale = metric === "sharpe" ? 1.5 : 0.3;
  const bandColor: Record<string, string> = { bull: pal.divPos[0], bear: pal.divNeg[0], sideways: pal.divMid };
  const total = Object.values(r.counts.trend).reduce((a, b) => a + b, 0);
  const combo = r.combo[sel] ?? {};
  return (
    <div>
      <PageHeader title="Regime lab" question="Which algorithms work in bull, bear and sideways markets, and in high vs low volatility?" />
      <ChartCard className="mb-4" title="Nifty 50 with its 200-day SMA, shaded by trend regime"
        meaning={`Bull = above a rising 200-day SMA, bear = below a falling one, else sideways. Days: bull ${pct(r.counts.trend.bull / total, 0)}, sideways ${pct(r.counts.trend.sideways / total, 0)}, bear ${pct(r.counts.trend.bear / total, 0)}. The rule is slow, so it labels some sharp rebounds as bear.`}>
        <Legend items={[{ label: "Bull", color: bandColor.bull, marker: "square" }, { label: "Sideways", color: bandColor.sideways, marker: "square" }, { label: "Bear", color: bandColor.bear, marker: "square" },
          { label: "Nifty 50", color: pal.text }, { label: "200-day SMA", color: pal.neutral, dashed: true }]} />
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={r.nifty} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={pal.grid} vertical={false} />
            {bands.map((b, i) => <ReferenceArea key={i} x1={b.a} x2={b.b} fill={bandColor[b.t]} fillOpacity={0.6} strokeOpacity={0} ifOverflow="hidden" />)}
            <XAxis dataKey="d" ticks={yearTicks(r.nifty.map((p) => p.d))} interval={0} tickFormatter={year} stroke={pal.axis} tickLine={false} />
            <YAxis scale="log" domain={["auto", "auto"]} tickFormatter={(v) => Math.round(v).toLocaleString("en-IN")} width={62} stroke={pal.axis} tickLine={false} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as RegFile["nifty"][number];
              return <TipBox title={String(label)} rows={[{ label: "Nifty", value: Math.round(p.c).toLocaleString("en-IN") }, { label: "200-day SMA", value: Math.round(p.sma).toLocaleString("en-IN") },
                { label: "India VIX", value: num(p.vix, 1) }, { label: "Trend", value: p.t ?? "–" }, { label: "Volatility", value: p.v ?? "–" }]} />;
            }} />
            <Line dataKey="c" stroke={pal.text} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="sma" stroke={pal.neutral} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard className="mb-4" title={`Strategy × regime: ${metric === "sharpe" ? "annualised Sharpe" : "annualised return"} (net)`}
        meaning={`Each strategy's daily returns are grouped by the regime known at the previous close. VIX terciles: low ≤ ${num(r.vix_terciles[0], 1)}, high > ${num(r.vix_terciles[1], 1)}. Click a row to see its trend × volatility grid below.`}
        actions={<>
          <select value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Metric"><option value="sharpe">Sharpe</option><option value="ret">Return</option></select>
          <button className="chip" onClick={() => downloadCSV(`algolens_regimes_${metric}.csv`, [["strategy", ...TREND, ...VOL], ...ids.map((s) => [S[s]?.name, ...[...TREND, ...VOL].map((k) => src[s][k])])])}>CSV</button>
        </>}>
        <MatrixHeatmap rowLabel="Strategy" scale={scale} fmt={fmt}
          rows={ids.map((s) => ({ id: s, label: <span className="flex items-center"><FamilyDot family={S[s]?.family} />{S[s]?.name}{s === sel ? " ◂" : ""}</span> }))}
          cols={[...TREND.map((t) => ({ id: t, label: t[0].toUpperCase() + t.slice(1) })), ...VOL.map((v) => ({ id: v, label: `${v[0].toUpperCase() + v.slice(1)} VIX` }))]}
          value={(s, c) => src[s]?.[c]} onRowClick={setSel} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={`${S[sel]?.name ?? sel}: trend × volatility`} meaning="Cells with fewer than 40 days are left blank. Day counts are shown under each value."
          actions={<button className="chip" onClick={() => nav(`/strategy/${sel}${qs}`)}>Deep dive →</button>}>
          <table className="w-full text-[12px] tnum border-separate" style={{ borderSpacing: 3 }}>
            <thead><tr><th /> {VOL.map((v) => <th key={v} className="text-muted font-normal">{v} VIX</th>)}</tr></thead>
            <tbody>{TREND.map((t) => (
              <tr key={t}><td className="text-ink2 pr-2">{t}</td>
                {VOL.map((v) => {
                  const c = combo[`${t}|${v}`];
                  return <td key={v} className="text-center rounded-md py-2" style={{ background: c ? (c.sharpe >= 0 ? pal.divPos[Math.min(2, Math.floor(Math.abs(c.sharpe) / 0.6))] : pal.divNeg[Math.min(2, Math.floor(Math.abs(c.sharpe) / 0.6))]) : "transparent", color: c && Math.abs(c.sharpe) >= 1.2 ? (pal.surface === "#fcfcfb" ? "#fff" : "#0b0b0b") : pal.text }}>
                    {c ? <><div className="font-semibold">{num(c.sharpe)}</div><div className="text-[11px] opacity-80">{pct(c.ann_return, 0)} · {c.days}d</div></> : <span className="text-muted">–</span>}
                  </td>;
                })}
              </tr>
            ))}</tbody>
          </table>
        </ChartCard>
        <ChartCard title="Days in each trend × volatility regime" meaning="Bear markets are rare in this sample, so bear-regime statistics rest on few days and are noisy.">
          <table className="w-full text-[12px] tnum border-separate" style={{ borderSpacing: 3 }}>
            <thead><tr><th /> {VOL.map((v) => <th key={v} className="text-muted font-normal">{v} VIX</th>)}</tr></thead>
            <tbody>{TREND.map((t) => (
              <tr key={t}><td className="text-ink2 pr-2">{t}</td>
                {VOL.map((v) => {
                  const n = r.combo_counts[`${t}|${v}`] ?? 0;
                  const k = Math.min(6, Math.floor((n / 1400) * 7));
                  return <td key={v} className="text-center rounded-md py-3 font-medium" style={{ background: pal.seq[k], color: k >= 4 ? (pal.surface === "#fcfcfb" ? "#fff" : "#0b0b0b") : pal.text }}>{n}</td>;
                })}
              </tr>
            ))}</tbody>
          </table>
        </ChartCard>
      </div>
    </div>
  );
}
