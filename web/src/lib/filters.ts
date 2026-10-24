import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { Cost, Period } from "./types";

export interface Filters {
  period: Period;
  cost: Cost;
  universe: string; // "all" or a sector name
}

export const PERIOD_LABEL: Record<Period, string> = {
  full: "2010 – latest",
  is: "In-sample 2010–19",
  oos: "Out-of-sample 2020+",
};

/** Global filters live in the URL so any view can be shared. */
export function useFilters(): [Filters, (patch: Partial<Filters>) => void] {
  const [sp, setSp] = useSearchParams();
  const period = (["full", "is", "oos"].includes(sp.get("period") ?? "") ? sp.get("period") : "full") as Period;
  const cost = (sp.get("cost") === "gross" ? "gross" : "net") as Cost;
  const universe = sp.get("universe") ?? "all";
  const set = useCallback(
    (patch: Partial<Filters>) => {
      setSp((prev) => {
        const n = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          const dflt = k === "period" ? "full" : k === "cost" ? "net" : k === "universe" ? "all" : null;
          if (v == null || v === dflt) n.delete(k);
          else n.set(k, String(v));
        }
        return n;
      }, { replace: true });
    },
    [setSp],
  );
  return [{ period, cost, universe }, set];
}

/** Keep global filters when navigating between pages. */
export function useQueryString(): string {
  const [sp] = useSearchParams();
  const keep = new URLSearchParams();
  for (const k of ["period", "cost", "universe"]) {
    const v = sp.get(k);
    if (v) keep.set(k, v);
  }
  const s = keep.toString();
  return s ? `?${s}` : "";
}

export function useParam(key: string, fallback: string): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams();
  const v = sp.get(key) ?? fallback;
  const set = useCallback(
    (nv: string) =>
      setSp((prev) => {
        const n = new URLSearchParams(prev);
        if (nv === fallback) n.delete(key);
        else n.set(key, nv);
        return n;
      }, { replace: true }),
    [key, fallback, setSp],
  );
  return [v, set];
}
