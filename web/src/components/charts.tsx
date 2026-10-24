import { useMemo, useState, type ReactNode } from "react";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { inr, num, pct, year, yearTicks } from "../lib/format";
import { divergingColor, divergingInk, useTheme } from "../lib/theme";
import { TipBox } from "./ui";

export interface HBarRow { id: string; label: ReactNode; value: number | null; value2?: number | null; color: string; href?: string }

/** Horizontal bars from a zero baseline, optional second measure as a dot on the same axis. */
export function HBarChart({ rows, unit, v1Label, v2Label, onClick }: {
  rows: HBarRow[]; unit: "pct" | "ratio"; v1Label: string; v2Label?: string; onClick?: (id: string) => void;
}) {
  const { pal } = useTheme();
  const [hover, setHover] = useState<string | null>(null);
  const vals = rows.flatMap((r) => [r.value, r.value2]).filter((v): v is number => v != null && isFinite(v));
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (v: number) => ((v - lo) / span) * 100;
  const fmt = (v: number | null | undefined) => (unit === "pct" ? pct(v) : num(v));
  return (
    <div role="list" className="text-[12px]">
      {rows.map((r) => {
        const v = r.value ?? 0;
        const left = Math.min(x(0), x(v)), width = Math.abs(x(v) - x(0));
        return (
          <div
            role="listitem"
            key={r.id}
            className={`grid grid-cols-[minmax(90px,170px)_1fr_auto] items-center gap-2 py-[3px] px-1 rounded ${onClick ? "cursor-pointer" : ""} ${hover === r.id ? "bg-[var(--surface-2)]" : ""}`}
            onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)} onClick={() => onClick?.(r.id)}
            title={`${typeof r.label === "string" ? r.label : r.id}: ${v1Label} ${fmt(r.value)}${v2Label ? `, ${v2Label} ${fmt(r.value2)}` : ""}`}
          >
            <div className="truncate text-ink2">{r.label}</div>
            <div className="relative h-4">
              <div className="absolute top-0 bottom-0 w-px" style={{ left: `${x(0)}%`, background: pal.axis }} />
              {r.value != null && (
                <div className="absolute top-[3px] bottom-[3px]" style={{
                  left: `${left}%`, width: `${Math.max(width, 0.4)}%`, background: r.color,
                  borderRadius: v >= 0 ? "0 4px 4px 0" : "4px 0 0 4px",
                }} />
              )}
              {r.value2 != null && (
                <div className="absolute top-1/2 w-[9px] h-[9px] rounded-full -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${x(r.value2)}%`, background: pal.text, boxShadow: `0 0 0 2px ${pal.surface}` }} />
              )}
            </div>
            <div className="tnum text-right whitespace-nowrap min-w-[84px]">
              <span className="text-ink">{fmt(r.value)}</span>
              {v2Label && <span className="text-muted"> · {fmt(r.value2)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const dateTick = (d: string) => year(d);

export interface LineSeries { key: string; label: string; color: string; dashed?: boolean; values: (number | null)[] }

/** Equity curves on one ₹ axis (log scale optional). */
export function EquityChart({ dates, series, height = 300, log = true, money = true }: {
  dates: string[]; series: LineSeries[]; height?: number; log?: boolean; money?: boolean;
}) {
  const { pal } = useTheme();
  const data = useMemo(() => dates.map((d, i) => {
    const row: Record<string, number | string | null> = { d };
    series.forEach((s) => (row[s.key] = s.values[i] ?? null));
    return row;
  }), [dates, series]);
  const fmt = (v: number) => (money ? inr(v, true) : num(v, 2));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={pal.grid} vertical={false} />
        <XAxis dataKey="d" ticks={yearTicks(dates)} tickFormatter={dateTick} interval={0} stroke={pal.axis} tickLine={false} />
        <YAxis scale={log ? "log" : "auto"} domain={["auto", "auto"]} tickFormatter={fmt} width={70} stroke={pal.axis} tickLine={false} allowDataOverflow />
        <Tooltip
          cursor={{ stroke: pal.muted, strokeDasharray: "3 3" }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TipBox title={String(label)} rows={payload.map((p) => ({
                label: series.find((s) => s.key === p.dataKey)?.label ?? String(p.dataKey), value: fmt(Number(p.value)), color: String(p.color),
              }))} />
            ) : null}
        />
        {series.map((s) => (
          <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false}
            strokeDasharray={s.dashed ? "5 4" : undefined} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DrawdownChart({ dates, values, color, height = 160 }: { dates: string[]; values: (number | null)[]; color: string; height?: number }) {
  const { pal } = useTheme();
  const data = dates.map((d, i) => ({ d, v: values[i] }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={pal.grid} vertical={false} />
        <XAxis dataKey="d" ticks={yearTicks(dates)} tickFormatter={dateTick} interval={0} stroke={pal.axis} tickLine={false} />
        <YAxis tickFormatter={(v) => pct(v, 0)} width={70} stroke={pal.axis} tickLine={false} domain={["dataMin", 0]} />
        <ReferenceLine y={0} stroke={pal.axis} />
        <Tooltip cursor={{ stroke: pal.muted, strokeDasharray: "3 3" }}
          content={({ active, payload, label }) => active && payload?.length ? <TipBox title={String(label)} rows={[{ label: "Drawdown", value: pct(Number(payload[0].value)) }]} /> : null} />
        <Area dataKey="v" stroke={color} fill={color} fillOpacity={0.18} strokeWidth={2} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Year x month grid of returns, diverging colour around 0, with the year total. */
export function MonthlyHeatmap({ monthly, yearly }: { monthly: { y: number; m: number; r: number }[]; yearly?: { year: number; ret: number }[] }) {
  const { pal } = useTheme();
  const years = [...new Set(monthly.map((x) => x.y))].sort();
  const get = (y: number, m: number) => monthly.find((x) => x.y === y && x.m === m)?.r;
  const yr = (y: number) => yearly?.find((x) => x.year === y)?.ret;
  const [tip, setTip] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] tnum border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr><th className="text-left text-muted font-normal pr-2">Year</th>{MONTHS.map((m) => <th key={m} className="text-muted font-normal w-11">{m}</th>)}<th className="text-muted font-normal w-14">Year</th></tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y}>
              <td className="pr-2 text-ink2">{y}</td>
              {MONTHS.map((_, i) => {
                const v = get(y, i + 1);
                return (
                  <td key={i} className="text-center rounded-[4px] h-6" onMouseEnter={() => setTip(`${MONTHS[i]} ${y}: ${pct(v)}`)} onMouseLeave={() => setTip(null)}
                    style={{ background: divergingColor(pal, v, 0.1), color: divergingInk(pal, v, 0.1) }} title={`${MONTHS[i]} ${y}: ${pct(v)}`}>
                    {v == null ? "" : (v * 100).toFixed(1)}
                  </td>
                );
              })}
              <td className="text-center rounded-[4px] font-medium" style={{ background: divergingColor(pal, yr(y), 0.4), color: divergingInk(pal, yr(y), 0.4) }}>{yr(y) == null ? "" : (yr(y)! * 100).toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[12px] text-muted mt-1 h-4">{tip ?? "Monthly return, % (blue up, red down). Hover a cell for details."}</div>
    </div>
  );
}

/** Generic matrix heatmap (rows x cols) with a diverging scale. */
export function MatrixHeatmap({ rows, cols, value, scale, fmt, rowLabel, colLabel, onRowClick }: {
  rows: { id: string; label: ReactNode }[]; cols: { id: string; label: string }[]; value: (r: string, c: string) => number | null | undefined;
  scale: number; fmt: (v: number | null | undefined) => string; rowLabel?: string; colLabel?: string; onRowClick?: (id: string) => void;
}) {
  const { pal } = useTheme();
  const [tip, setTip] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="text-[12px] tnum border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="text-left text-muted font-normal pr-2">{rowLabel}</th>
            {cols.map((c) => <th key={c.id} className="text-muted font-normal px-1 min-w-[58px]">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={onRowClick ? "cursor-pointer" : ""} onClick={() => onRowClick?.(r.id)}>
              <td className="pr-3 text-ink2 whitespace-nowrap">{r.label}</td>
              {cols.map((c) => {
                const v = value(r.id, c.id);
                return (
                  <td key={c.id} className="text-center rounded-[4px] h-7 px-1"
                    onMouseEnter={() => setTip(`${typeof r.label === "string" ? r.label : r.id} · ${colLabel ? colLabel + " " : ""}${c.label}: ${fmt(v)}`)}
                    onMouseLeave={() => setTip(null)}
                    style={{ background: divergingColor(pal, v, scale), color: divergingInk(pal, v, scale) }}>
                    {fmt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[12px] text-muted mt-1 h-4">{tip ?? "Hover a cell for details."}</div>
    </div>
  );
}
