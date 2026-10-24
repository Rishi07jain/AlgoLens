"""Clean raw downloads into data/processed/*.parquet and print a data-quality report.

Steps (all scripted, raw files are never modified):
  1. Read Yahoo CSVs. Build dividend/split-adjusted OHLC: factor = Adj Close / Close,
     applied to Open/High/Low/Close.
  2. Drop leading stale rows (zero volume, flat price) that Yahoo pads before real history.
  3. Apply documented corporate-action fixes from pipeline/corporate_actions.csv
     (demergers and a misplaced bonus adjustment that Yahoo gets wrong).
  4. Align every stock to the Nifty 50 trading calendar. Days a stock has no row are
     forward-filled for valuation only and flagged as non-tradable (counted as gaps).
  5. Cross-check daily returns against the Kaggle NSE dataset for 2010-2021.
"""
from __future__ import annotations

import json
import warnings

import numpy as np
import pandas as pd

from pipeline import config

warnings.filterwarnings("ignore")


def _read_yahoo(ticker: str) -> pd.DataFrame:
    fname = ticker.replace("^", "IDX_").replace("&", "_AND_")
    df = pd.read_csv(config.RAW / "yahoo" / f"{fname}.csv", index_col=0, parse_dates=True)
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return df


def _drop_stale_prefix(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Yahoo sometimes pads history with a flat, zero-volume price. Drop rows until the
    first day with volume > 0 that starts a run of >= 5 traded days."""
    traded = (df["volume"] > 0).astype(int)
    run = traded.rolling(5).sum().shift(-4)
    first = run[run >= 5].index.min()
    if pd.isna(first):
        return df.iloc[0:0], len(df)
    dropped = int((df.index < first).sum())
    return df.loc[first:], dropped


def adjusted_ohlcv(raw: pd.DataFrame) -> pd.DataFrame:
    f = (raw["Adj Close"] / raw["Close"]).replace([np.inf, -np.inf], np.nan)
    out = pd.DataFrame({
        "open": raw["Open"] * f,
        "high": raw["High"] * f,
        "low": raw["Low"] * f,
        "close": raw["Adj Close"],
        "volume": raw["Volume"].astype(float),
    })
    return out.dropna(subset=["open", "close"])


def apply_corporate_actions(sym: str, df: pd.DataFrame, actions: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    notes = []
    px = ["open", "high", "low", "close"]
    for _, a in actions[actions["symbol"] == sym].iterrows():
        d = pd.Timestamp(a["date"])
        if a["action"] == "drop_before":
            n = int((df.index < d).sum())
            df = df.loc[d:]
            notes.append(f"dropped {n} rows before {d.date()}")
        elif a["action"] == "scale_before":
            m = df.index < d
            df.loc[m, px] = df.loc[m, px] * float(a["factor"])
            df.loc[m, "volume"] = df.loc[m, "volume"] / float(a["factor"])
            notes.append(f"scaled prices before {d.date()} by {float(a['factor']):.4f}")
        elif a["action"] in ("gap_adjust", "neutralise_day"):
            i = df.index.get_loc(d)
            prev_close = df["close"].iloc[i - 1]
            if a["action"] == "gap_adjust":
                k = df["open"].iloc[i] / prev_close
            else:
                k = df["close"].iloc[i] / prev_close
            m = df.index < d
            df.loc[m, px] = df.loc[m, px] * k
            if a["action"] == "neutralise_day":
                c = df["close"].iloc[i]
                df.iloc[i, df.columns.get_loc("open")] = c
                df.iloc[i, df.columns.get_loc("high")] = max(df["high"].iloc[i], c)
                df.iloc[i, df.columns.get_loc("low")] = min(df["low"].iloc[i], c)
            notes.append(f"{a['action']} on {d.date()}: earlier prices x {k:.4f}")
    # keep OHLC internally consistent after adjustment
    df["high"] = df[["high", "open", "close"]].max(axis=1)
    df["low"] = df[["low", "open", "close"]].min(axis=1)
    return df, notes


def kaggle_crosscheck(sym: str, clean: pd.DataFrame) -> dict | None:
    alias = {"M&M": "MM", "TMPV": "TATAMOTORS"}
    path = config.RAW / "kaggle" / f"{alias.get(sym, sym)}.csv"
    if not path.exists():
        return None
    k = pd.read_csv(path, usecols=["Date", "Close", "Prev Close"], parse_dates=["Date"]).set_index("Date")
    k = k.loc[config.BACKTEST_START:]
    kr = (k["Close"] / k["Prev Close"] - 1).rename("kaggle")
    yr = clean["close"].pct_change().rename("yahoo")
    j = pd.concat([kr, yr], axis=1, join="inner").dropna()
    # Kaggle is unadjusted: split/bonus/dividend days differ by design, so use robust stats.
    diff = (j["kaggle"] - j["yahoo"]).abs()
    if j.empty:
        return None
    return {
        "overlap_days": int(len(j)),
        "corr": round(float(j["kaggle"].corr(j["yahoo"])), 4),
        "median_abs_diff_bps": round(float(diff.median() * 1e4), 2),
        "days_diff_over_1pct": int((diff > 0.01).sum()),
    }


def main() -> None:
    cons = pd.read_csv(config.RAW / "nse" / "ind_nifty50list.csv")
    actions = pd.read_csv(config.ROOT / "pipeline" / "corporate_actions.csv")
    kmeta_path = config.RAW / "kaggle" / "stock_metadata.csv"
    kmeta = pd.read_csv(kmeta_path).set_index("Symbol") if kmeta_path.exists() else pd.DataFrame()

    nifty = adjusted_ohlcv(_read_yahoo(config.BENCHMARK_TICKER))
    nifty = nifty[nifty["close"] > 0]
    vix_raw = _read_yahoo(config.VIX_TICKER)
    vix = vix_raw[["Close"]].rename(columns={"Close": "vix"}).dropna()
    vix = vix[vix["vix"] > 0]
    cal = nifty.index
    latest = cal.max()

    frames, report, meta = [], [], []
    for _, row in cons.iterrows():
        sym = row["Symbol"]
        raw = _read_yahoo(f"{sym}.NS")
        df = adjusted_ohlcv(raw)
        df, stale = _drop_stale_prefix(df)
        df, notes = apply_corporate_actions(sym, df, actions)
        if stale:
            notes.insert(0, f"dropped {stale} stale leading rows")
        first = df.index.min()
        on_cal = df.reindex(cal[cal >= first])
        missing = int(on_cal["close"].isna().sum())
        on_cal["tradable"] = on_cal["close"].notna() & (on_cal["volume"].fillna(0) > 0)
        on_cal["close"] = on_cal["close"].ffill()
        for c in ("open", "high", "low"):
            on_cal[c] = on_cal[c].fillna(on_cal["close"])
        on_cal["volume"] = on_cal["volume"].fillna(0.0)
        on_cal["symbol"] = sym
        rets = on_cal["close"].pct_change()
        years = (latest - first).days / 365.25
        in_universe = years >= config.MIN_HISTORY_YEARS
        frames.append(on_cal.reset_index().rename(columns={"index": "date", "Date": "date"}))
        xc = kaggle_crosscheck(sym, on_cal)
        report.append({
            "symbol": sym, "rows": int(len(on_cal)), "first": str(first.date()), "last": str(on_cal.index.max().date()),
            "years": round(years, 1), "missing_days": missing,
            "zero_volume_days": int((on_cal["volume"] == 0).sum()),
            "max_abs_daily_ret": round(float(rets.abs().max()), 3),
            "in_universe": bool(in_universe), "fixes": notes, "kaggle_check": xc,
        })
        kind = kmeta["Industry"].get(sym) if len(kmeta) and sym in kmeta.index else None
        meta.append({
            "symbol": sym, "name": row["Company Name"], "sector": row["Industry"],
            "kaggle_industry": kind, "isin": row["ISIN Code"], "first_date": str(first.date()),
            "in_universe": bool(in_universe),
        })

    prices = pd.concat(frames, ignore_index=True)
    prices["date"] = pd.to_datetime(prices["date"])
    config.PROCESSED.mkdir(parents=True, exist_ok=True)
    prices.to_parquet(config.PROCESSED / "prices.parquet", index=False)
    nifty.rename_axis("date").to_parquet(config.PROCESSED / "nifty.parquet")
    vix.rename_axis("date").to_parquet(config.PROCESSED / "vix.parquet")
    pd.DataFrame(meta).to_parquet(config.PROCESSED / "universe.parquet", index=False)

    rep = pd.DataFrame(report)
    q = {
        "generated_from": "data/raw (see manifest.json)",
        "calendar": {"first": str(cal.min().date()), "last": str(latest.date()), "days": int(len(cal))},
        "nifty_rows": int(len(nifty)), "vix_rows": int(len(vix)),
        "vix_first": str(vix.index.min().date()),
        "symbols": report,
        "universe_size": int(rep["in_universe"].sum()),
        "excluded": rep.loc[~rep["in_universe"], ["symbol", "years"]].to_dict("records"),
    }
    (config.PROCESSED / "data_quality.json").write_text(json.dumps(q, indent=2, default=str))

    pd.set_option("display.width", 200)
    print("\n=== DATA QUALITY REPORT ===")
    print(f"Nifty calendar {q['calendar']['first']} -> {q['calendar']['last']} ({len(cal)} days); "
          f"India VIX from {q['vix_first']} ({len(vix)} rows)")
    show = rep[["symbol", "rows", "first", "last", "years", "missing_days", "zero_volume_days", "max_abs_daily_ret", "in_universe"]].copy()
    show["kaggle_corr"] = [r["kaggle_check"]["corr"] if r["kaggle_check"] else None for r in report]
    show["kaggle_med_bps"] = [r["kaggle_check"]["median_abs_diff_bps"] if r["kaggle_check"] else None for r in report]
    print(show.to_string(index=False))
    print("\nFixes applied:")
    for r in report:
        if r["fixes"]:
            print(f"  {r['symbol']}: {'; '.join(r['fixes'])}")
    print(f"\nUniverse: {q['universe_size']} stocks with >= {config.MIN_HISTORY_YEARS} years of history. "
          f"Excluded: {[(e['symbol'], e['years']) for e in q['excluded']]}")


if __name__ == "__main__":
    main()
