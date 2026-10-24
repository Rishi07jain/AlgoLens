import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { PERIOD_LABEL, useFilters, useQueryString } from "../lib/filters";
import { useTheme } from "../lib/theme";
import { Segmented, useMeta } from "./ui";

const NAV = [
  { to: "/", label: "Findings" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/strategy", label: "Deep dive" },
  { to: "/accuracy", label: "Accuracy vs profit" },
  { to: "/regimes", label: "Regime lab" },
  { to: "/robustness", label: "Costs & robustness" },
  { to: "/compare", label: "Compare & combine" },
  { to: "/methodology", label: "Methodology" },
];

export default function Layout() {
  const [f, setF] = useFilters();
  const qs = useQueryString();
  const meta = useMeta();
  const { mode, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const usesUniverse = ["/leaderboard"].includes(loc.pathname);
  return (
    <div className="min-h-screen flex flex-col">
      <header className="md:sticky top-0 z-30 border-b border-edge bg-[var(--page)]/95 backdrop-blur">
        <div className="max-w-[1280px] mx-auto px-4 flex items-center gap-4 h-14">
          <NavLink to={`/${qs}`} className="flex items-center gap-2 font-semibold shrink-0">
            <img src="/favicon.svg" alt="" className="w-6 h-6" />
            AlgoLens
          </NavLink>
          <nav className="hidden xl:flex items-center gap-1 text-[13px]" aria-label="Pages">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={`${n.to}${qs}`}
                end={n.to === "/"}
                className={({ isActive }) => `px-2.5 py-1.5 rounded-md whitespace-nowrap ${isActive ? "bg-[var(--surface-2)] text-ink font-medium" : "text-ink2 hover:text-ink"}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={toggle} className="chip py-1" aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} theme`}>
              {mode === "dark" ? "☀ Light" : "☾ Dark"}
            </button>
            <button className="xl:hidden chip py-1" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="mnav">Menu</button>
          </div>
        </div>
        {open && (
          <nav id="mnav" className="xl:hidden border-t border-edge px-4 py-2 grid grid-cols-2 gap-1 text-[14px]" aria-label="Pages">
            {NAV.map((n) => (
              <NavLink key={n.to} to={`${n.to}${qs}`} end={n.to === "/"} onClick={() => setOpen(false)}
                className={({ isActive }) => `px-2 py-1.5 rounded-md ${isActive ? "bg-[var(--surface-2)] font-medium" : "text-ink2"}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="border-t border-edge">
          <div className="max-w-[1280px] mx-auto px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
            <label className="flex flex-wrap items-center gap-2 max-w-full">
              <span className="text-muted">Period</span>
              <Segmented label="Period" value={f.period} onChange={(v) => setF({ period: v })}
                options={(["full", "is", "oos"] as const).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} />
            </label>
            <label className="flex flex-wrap items-center gap-2 max-w-full">
              <span className="text-muted">Costs</span>
              <Segmented label="Costs" value={f.cost} onChange={(v) => setF({ cost: v })}
                options={[{ value: "net", label: "Net of costs" }, { value: "gross", label: "Gross" }]} />
            </label>
            <label className="flex flex-wrap items-center gap-2 max-w-full">
              <span className="text-muted">Universe</span>
              <select value={f.universe} onChange={(e) => setF({ universe: e.target.value })} aria-label="Universe"
                title={usesUniverse ? "" : "Sector universes apply to the Leaderboard"}>
                <option value="all">Nifty 50 ({meta?.universe.length ?? 44} stocks)</option>
                {meta?.sectors.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="flex flex-wrap items-center gap-2 max-w-full">
              <span className="text-muted">Positions</span>
              <Segmented label="Positions" value="long" onChange={() => {}}
                options={[{ value: "long", label: "Long-only" }, { value: "ls", label: "Long-short", disabled: true, title: "Planned for a later version" }]} />
            </label>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-edge text-[12px] text-muted">
        <div className="max-w-[1280px] mx-auto px-4 py-4 flex flex-wrap gap-x-6 gap-y-1">
          <span><strong className="text-ink2">Educational project, not investment advice.</strong> Past backtested performance does not predict future results.</span>
          {meta && <span>Data {meta.start} to {meta.end} · NSE, Yahoo Finance, Kaggle · built {meta.generated_at.slice(0, 10)}</span>}
        </div>
      </footer>
    </div>
  );
}
