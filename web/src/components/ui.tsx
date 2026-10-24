import { useRef, useState, type ReactNode } from "react";
import { downloadPNG } from "../lib/exporters";
import { useTheme } from "../lib/theme";
import type { Meta, Strategy } from "../lib/types";
import { useData } from "../lib/data";

export function useMeta() {
  return useData<Meta>("meta.json").data;
}

export function strategyMap(meta: Meta | null): Record<string, Strategy> {
  const m: Record<string, Strategy> = {};
  meta?.strategies.forEach((s) => (m[s.id] = s));
  return m;
}

export function PageHeader({ title, question, children }: { title: string; question?: string; children?: ReactNode }) {
  return (
    <header className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {question && <p className="mt-1 text-ink2 max-w-3xl">{question}</p>}
      {children}
    </header>
  );
}

export function Loading({ label = "Loading results…" }: { label?: string }) {
  return <div className="py-16 text-center text-muted text-sm" role="status">{label}</div>;
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="card p-4 text-sm">
      Could not load results ({error}). Run <code>make backtest</code> to generate <code>web/public/results</code>.
    </div>
  );
}

/** A chart panel: title, one-line "what this means", PNG export, optional table toggle. */
export function ChartCard({
  title, meaning, children, table, className = "", actions, filename,
}: {
  title: string; meaning?: ReactNode; children: ReactNode; table?: ReactNode; className?: string; actions?: ReactNode; filename?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [showTable, setShowTable] = useState(false);
  return (
    <section ref={ref} className={`card p-4 min-w-0 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <h2 className="font-semibold text-[15px]">{title}</h2>
        <div className="flex flex-wrap items-center gap-2 max-w-full" data-noexport="1">
          {actions}
          {table && (
            <button className="chip hover:bg-[var(--surface-2)]" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
              {showTable ? "Chart" : "Table"}
            </button>
          )}
          <button
            className="chip hover:bg-[var(--surface-2)]"
            onClick={() => ref.current && downloadPNG(ref.current, `${filename ?? title.replace(/\W+/g, "_").toLowerCase()}.png`)}
            title="Download this chart as PNG"
          >
            PNG
          </button>
        </div>
      </div>
      {showTable && table ? <div className="overflow-auto max-h-[420px]">{table}</div> : children}
      {meaning && <p className="mt-3 text-[13px] text-ink2"><span className="font-medium text-ink">What this means: </span>{meaning}</p>}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; marker?: "dot" | "line" | "square" }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink2 mb-2" aria-label="Legend">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          {it.marker === "dot" ? (
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: it.color }} />
          ) : it.marker === "square" ? (
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: it.color }} />
          ) : (
            <span className="inline-block w-4 h-0 border-t-2" style={{ borderColor: it.color, borderStyle: it.dashed ? "dashed" : "solid" }} />
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="text-xl font-semibold mt-0.5" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
      {sub && <div className="text-[12px] text-ink2 mt-0.5">{sub}</div>}
    </div>
  );
}

export function Sparkline({ values, color, width = 120, height = 28 }: { values: (number | null)[]; color: string; width?: number; height?: number }) {
  const v = values.filter((x): x is number => x != null);
  if (v.length < 2) return null;
  const lo = Math.min(...v), hi = Math.max(...v);
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * (width - 2) + 1).toFixed(1)},${(height - 2 - ((y - lo) / (hi - lo || 1)) * (height - 4)).toFixed(1)}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function FamilyDot({ family }: { family: string }) {
  const { familyColor } = useTheme();
  return <span className="inline-block w-2 h-2 rounded-full mr-2 shrink-0" style={{ background: familyColor(family) }} aria-hidden="true" />;
}

/** Tooltip container used by every Recharts chart. */
export function TipBox({ title, rows }: { title?: ReactNode; rows: { label: ReactNode; value: ReactNode; color?: string }[] }) {
  return (
    <div className="card px-3 py-2 text-[12px] shadow-lg" style={{ minWidth: 150 }}>
      {title && <div className="font-semibold mb-1">{title}</div>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink2">
            {r.color && <span className="inline-block w-2 h-2 rounded-full" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="tnum font-medium">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap max-w-full rounded-lg border border-edge p-0.5 bg-surface">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-[12px] rounded-md whitespace-nowrap ${value === o.value ? "bg-[var(--accent)] text-white" : "text-ink2 hover:text-ink"} ${o.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
