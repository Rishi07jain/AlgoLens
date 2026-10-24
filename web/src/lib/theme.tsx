import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Mode = "light" | "dark";

/** Validated categorical palette (slots in fixed order) + chart chrome, per mode. */
const PALETTES = {
  light: {
    series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
    neutral: "#898781",
    surface: "#fcfcfb",
    text: "#0b0b0b",
    text2: "#52514e",
    muted: "#6f6d68",
    grid: "#e1e0d9",
    axis: "#c3c2b7",
    good: "#006300",
    bad: "#d03b3b",
    seq: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"],
    divNeg: ["#f4c9c8", "#e98e8d", "#d03b3b"],
    divMid: "#f0efec",
    divPos: ["#b7d3f6", "#6da7ec", "#256abf"],
  },
  dark: {
    series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
    neutral: "#898781",
    surface: "#1a1a19",
    text: "#f0efec",
    text2: "#c3c2b7",
    muted: "#9a988f",
    grid: "#2c2c2a",
    axis: "#383835",
    good: "#0ca30c",
    bad: "#e66767",
    seq: ["#104281", "#184f95", "#1c5cab", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"],
    divNeg: ["#5a2a29", "#9a3a39", "#e66767"],
    divMid: "#383835",
    divPos: ["#173a66", "#1c5cab", "#5598e7"],
  },
};
export type Palette = (typeof PALETTES)["light"];

/** Strategy families take categorical slots in a fixed order; benchmarks are neutral. */
export const FAMILY_ORDER = ["Trend", "Mean reversion", "Momentum", "Stat-arb", "Machine learning"];

interface ThemeCtx { mode: Mode; pal: Palette; toggle: () => void; familyColor: (f: string) => string }
const Ctx = createContext<ThemeCtx | null>(null);

function systemMode(): Mode {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [stamp, setStamp] = useState<Mode | null>(() => {
    try { return (localStorage.getItem("algolens-theme") as Mode) || null; } catch { return null; }
  });
  const [sys, setSys] = useState<Mode>(systemMode);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const f = () => setSys(mq.matches ? "dark" : "light");
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  const mode = stamp ?? sys;
  useEffect(() => {
    if (stamp) document.documentElement.dataset.theme = stamp;
    else delete document.documentElement.dataset.theme;
  }, [stamp]);
  const value = useMemo<ThemeCtx>(() => {
    const pal = PALETTES[mode];
    return {
      mode, pal,
      toggle: () => {
        const next = mode === "dark" ? "light" : "dark";
        try { localStorage.setItem("algolens-theme", next); } catch { /* storage blocked */ }
        setStamp(next);
      },
      familyColor: (f: string) => {
        const i = FAMILY_ORDER.indexOf(f);
        return i >= 0 ? pal.series[i] : pal.neutral;
      },
    };
  }, [mode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("ThemeProvider missing");
  return c;
}

/** Diverging colour for a value (e.g. monthly return or Sharpe) around 0. */
export function divergingColor(pal: Palette, v: number | null | undefined, scale: number): string {
  if (v == null || !isFinite(v)) return "transparent";
  const t = Math.min(Math.abs(v) / scale, 1);
  if (t < 0.08) return pal.divMid;
  const arm = v < 0 ? pal.divNeg : pal.divPos;
  return arm[t < 0.4 ? 0 : t < 0.75 ? 1 : 2];
}

export function divergingInk(pal: Palette, v: number | null | undefined, scale: number): string {
  if (v == null || !isFinite(v)) return pal.muted;
  const t = Math.min(Math.abs(v) / scale, 1);
  if (pal === PALETTES.light) return t >= 0.75 ? "#ffffff" : pal.text;
  return t >= 0.75 ? "#0b0b0b" : pal.text;
}
