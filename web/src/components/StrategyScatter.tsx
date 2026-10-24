import { CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { useNavigate } from "react-router-dom";
import { num, pct } from "../lib/format";
import { FAMILY_ORDER, useTheme } from "../lib/theme";
import type { Strategy } from "../lib/types";
import { Legend, TipBox } from "./ui";

export interface ScatterPt { id: string; x: number | null | undefined; y: number | null | undefined; extra?: Record<string, string> }

/** One point per strategy, coloured by family, labelled directly. */
export function StrategyScatter({ points, strategies, xLabel, yLabel, xFmt = (v) => pct(v), yFmt = (v) => num(v), xRef, yRef = 0, height = 360, qs = "" }: {
  points: ScatterPt[]; strategies: Record<string, Strategy>; xLabel: string; yLabel: string;
  xFmt?: (v: number) => string; yFmt?: (v: number) => string; xRef?: number; yRef?: number; height?: number; qs?: string;
}) {
  const { pal, familyColor } = useTheme();
  const nav = useNavigate();
  const fams = [...FAMILY_ORDER, "Benchmark"].filter((f) => points.some((p) => strategies[p.id]?.family === f));
  const raw = points.filter((p) => p.x != null && p.y != null).map((p) => ({ ...p, name: strategies[p.id]?.name ?? p.id, family: strategies[p.id]?.family ?? "" }));
  // Direct-label only points with room around them; crowded ones stay readable via hover and the table view.
  const xs = raw.map((p) => p.x as number), ys = raw.map((p) => p.y as number);
  const nx = (v: number) => (v - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs) || 1);
  const ny = (v: number) => (v - Math.min(...ys)) / (Math.max(...ys) - Math.min(...ys) || 1);
  const placed: { x: number; y: number }[] = [];
  const data = [...raw].sort((a, b) => (b.y as number) - (a.y as number)).map((p) => {
    const q = { x: nx(p.x as number), y: ny(p.y as number) };
    const free = placed.every((o) => Math.abs(o.y - q.y) > 0.11 || Math.abs(o.x - q.x) > 0.3);
    if (free) placed.push(q);
    return { ...p, label: free ? p.name : "" };
  });
  return (
    <div>
      <Legend items={fams.map((f) => ({ label: f, color: familyColor(f), marker: "dot" }))} />
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 12, right: 96, bottom: 18, left: 4 }}>
          <CartesianGrid stroke={pal.grid} />
          <XAxis type="number" dataKey="x" name={xLabel} tickFormatter={xFmt} domain={["auto", "auto"]} stroke={pal.axis} tickLine={false}
            label={{ value: xLabel, position: "insideBottom", offset: -10, fill: pal.muted, fontSize: 12 }} />
          <YAxis type="number" dataKey="y" name={yLabel} tickFormatter={yFmt} domain={["auto", "auto"]} stroke={pal.axis} tickLine={false} width={56}
            label={{ value: yLabel, angle: -90, position: "insideLeft", fill: pal.muted, fontSize: 12 }} />
          <ZAxis range={[90, 90]} />
          {xRef != null && <ReferenceLine x={xRef} stroke={pal.muted} strokeDasharray="4 4" />}
          {yRef != null && <ReferenceLine y={yRef} stroke={pal.axis} />}
          <Tooltip cursor={false} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as (typeof data)[number];
            return <TipBox title={p.name} rows={[{ label: xLabel, value: xFmt(p.x!) }, { label: yLabel, value: yFmt(p.y!) },
              ...Object.entries(p.extra ?? {}).map(([k, v]) => ({ label: k, value: v })), { label: "Family", value: p.family, color: familyColor(p.family) }]} />;
          }} />
          {fams.map((f) => (
            <Scatter key={f} data={data.filter((d) => d.family === f)} fill={familyColor(f)} stroke={pal.surface} strokeWidth={2}
              isAnimationActive={false} cursor="pointer" onClick={(d: { id?: string }) => d.id && nav(`/strategy/${d.id}${qs}`)}>
              <LabelList dataKey="label" position="right" style={{ fill: pal.text2, fontSize: 11 }} />
            </Scatter>
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
