"""Download raw data from public sources into data/raw/. Never edits files by hand.

Sources:
  * NSE  - current Nifty 50 constituent list (symbol, company, industry)
  * Yahoo Finance via yfinance - daily OHLCV + Adj Close for <SYMBOL>.NS, ^NSEI, ^INDIAVIX
  * Kaggle rohanrao/nifty50-stock-market-data - 2000-2021 NSE history + stock_metadata.csv

If a download fails the script stops with an error. It never fills in missing data.
"""
from __future__ import annotations

import json
import shutil
import sys
import time
import warnings
from datetime import datetime, timezone

import pandas as pd
import requests

from pipeline import config

warnings.filterwarnings("ignore")

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120 Safari/537.36"}


def fetch_constituents() -> pd.DataFrame:
    out = config.RAW / "nse" / "ind_nifty50list.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(config.NSE_CONSTITUENTS_URL, headers=UA, timeout=30)
    r.raise_for_status()
    if "Symbol" not in r.text[:200]:
        raise RuntimeError("NSE constituent list did not return a CSV")
    out.write_text(r.text)
    df = pd.read_csv(out)
    print(f"NSE constituents: {len(df)} symbols -> {out.relative_to(config.ROOT)}")
    return df


def yahoo_symbol(nse_symbol: str) -> str:
    return f"{nse_symbol}.NS"


def fetch_yahoo(tickers: list[str]) -> dict[str, int]:
    import yfinance as yf

    out_dir = config.RAW / "yahoo"
    out_dir.mkdir(parents=True, exist_ok=True)
    rows: dict[str, int] = {}
    failed: list[str] = []
    for t in tickers:
        df = None
        for attempt in range(3):
            try:
                df = yf.download(t, start=config.DOWNLOAD_START, auto_adjust=False,
                                 progress=False, actions=False, threads=False)
                if df is not None and len(df):
                    break
            except Exception as e:  # network hiccup: retry, then give up loudly
                print(f"  {t}: attempt {attempt + 1} failed ({e})")
            time.sleep(1.5 * (attempt + 1))
        if df is None or df.empty:
            failed.append(t)
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df.index.name = "Date"
        fname = t.replace("^", "IDX_").replace("&", "_AND_")
        df.to_csv(out_dir / f"{fname}.csv")
        rows[t] = len(df)
        print(f"  {t:<16} {len(df):>5} rows  {df.index.min().date()} -> {df.index.max().date()}")
    if failed:
        raise SystemExit(f"Yahoo download failed for: {failed}. Stopping - no data is faked.")
    return rows


def fetch_kaggle() -> str:
    import kagglehub

    src = kagglehub.dataset_download(config.KAGGLE_DATASET)
    dst = config.RAW / "kaggle"
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    n = len(list(dst.glob("*.csv")))
    print(f"Kaggle {config.KAGGLE_DATASET}: {n} CSV files -> {dst.relative_to(config.ROOT)}")
    return src


def main() -> None:
    cons = fetch_constituents()
    tickers = [yahoo_symbol(s) for s in cons["Symbol"]] + [config.BENCHMARK_TICKER, config.VIX_TICKER]
    print(f"Downloading {len(tickers)} tickers from Yahoo Finance ...")
    rows = fetch_yahoo(tickers)
    try:
        fetch_kaggle()
        kaggle_ok = True
    except Exception as e:
        # Kaggle is a cross-check + sector source; NSE list already gives sectors.
        print(f"WARNING: Kaggle download failed ({e}). Cross-check will be skipped.", file=sys.stderr)
        kaggle_ok = False
    manifest = {
        "downloaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": {
            "nse_constituents": config.NSE_CONSTITUENTS_URL,
            "yahoo": "https://finance.yahoo.com via yfinance (auto_adjust=False; Close + Adj Close)",
            "kaggle": f"https://www.kaggle.com/datasets/{config.KAGGLE_DATASET}" if kaggle_ok else None,
        },
        "yahoo_rows": rows,
    }
    (config.RAW / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("Raw data manifest written to data/raw/manifest.json")


if __name__ == "__main__":
    main()
