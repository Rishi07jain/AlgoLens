export type Period = "full" | "is" | "oos";
export type Cost = "net" | "gross";

export interface Strategy {
  id: string;
  name: string;
  family: string;
  priority: string;
  kind: "sleeve" | "portfolio" | "index";
  params: Record<string, unknown>;
  logic: string;
  note?: string;
}

export interface Metrics {
  start: string; end: string; years: number;
  total_return: number; cagr: number; vol: number; sharpe: number; sortino: number;
  max_dd: number; max_dd_days: number; dd_peak: string | null; dd_trough: string | null;
  calmar: number | null; alpha: number | null; beta: number | null; var95: number; cvar95: number;
  exposure: number | null; turnover: number | null; trades_per_year: number | null;
  n_trades: number; win_rate: number | null; profit_factor: number | null; expectancy_pct: number | null;
  expectancy_inr: number | null; payoff_ratio: number | null; avg_hold_days: number | null;
  hit_rate?: number | null; accuracy?: number | null; precision?: number | null; recall?: number | null;
  f1?: number | null; base_rate?: number | null; ic?: number | null; ic_t?: number | null; auc?: number | null;
  confusion?: { tp: number; fp: number; fn: number; tn: number } | null;
}

export interface Meta {
  generated_at: string; data_downloaded_at: string; start: string; end: string; is_end: string; oos_start: string;
  capital: number; risk_free: number; strategies: Strategy[];
  universe: { symbol: string; name: string; sector: string; first_date: string }[];
  excluded: { symbol: string; years: number }[];
  costs: { net: Record<string, number>; sources: { label: string; url: string }[]; checked_on: string };
  data_quality: {
    calendar: { first: string; last: string; days: number }; vix_first: string;
    symbols: { symbol: string; rows: number; first: string; last: string; years: number; missing_days: number;
      zero_volume_days: number; fixes: string[]; in_universe: boolean;
      kaggle_check: { overlap_days: number; corr: number; median_abs_diff_bps: number; days_diff_over_1pct: number } | null }[];
  };
  corporate_actions: { symbol: string; date: string; action: string; factor: string | number; note: string; source: string }[];
  ml: { features: { id: string; label: string }[] };
  sectors: string[];
}

export interface Leaderboard {
  metrics: Record<Period, Record<Cost, Record<string, Metrics>>>;
  sparklines: Record<string, number[]>;
  spark_dates: string[];
}

export interface ChartBar { id: string; label: string; value: number | null; value2?: number | null; family?: string }
export interface Finding {
  id: string; question: number | null; page: string; hero?: boolean; title: string; metric: string; metric_label: string;
  body: string; chart: { type: "bar" | "bar2"; unit: "ratio" | "pct"; label: string; data: ChartBar[] } | null;
}

export interface Trade { symbol: string; entry: string; exit: string | null; entry_px: number; exit_px: number | null; ret: number; pnl: number; days: number; open: boolean }

export interface StrategyFile {
  id: string; dates: string[]; equity_net: number[]; equity_gross: number[]; benchmark: number[];
  drawdown: number[]; exposure: number[];
  monthly: { y: number; m: number; r: number }[]; yearly: { year: number; ret: number; sharpe: number }[];
  best_trades: Trade[]; worst_trades: Trade[]; trade_hist: { edges: number[]; counts: number[] } | null;
  pairs_chosen?: { year: number; a: string; b: string; sector: string; pvalue: number; beta: number }[];
  current_holdings?: { symbol: string; weight: number }[];
  months_held?: Record<string, number>;
}

export type CompactTrade = [string, string | null, number, number, number];
export interface StockFile {
  symbol: string; name: string; sector: string; ohlc: [string, number, number, number, number][];
  weekly_dates: string[];
  strategies: Record<string, {
    equity?: number[]; metrics?: Partial<Metrics>; gross?: { cagr: number; sharpe: number; total_return: number };
    accuracy?: { hit_rate: number; accuracy: number; precision: number; recall: number; f1: number; base_rate: number };
    trades: CompactTrade[];
  }>;
}
