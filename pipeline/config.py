"""Shared settings for the AlgoLens pipeline. Every strategy uses these same values."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
RESULTS = ROOT / "web" / "public" / "results"

# Download from 2007 so indicators (200-day SMA, 12-month momentum) and the first ML
# training window are warmed up before the backtest starts.
DOWNLOAD_START = "2007-01-01"
BACKTEST_START = "2010-01-01"
IS_END = "2019-12-31"          # in-sample 2010-2019, out-of-sample 2020 -> latest
OOS_START = "2020-01-01"

INITIAL_CAPITAL = 1_000_000    # Rs 10,00,000 for every strategy
TRADING_DAYS = 252

# Risk-free rate: documented constant (approx. RBI 91-day T-bill average, 2010-2026).
RISK_FREE_ANNUAL = 0.065

# A stock is in the universe if it is a current Nifty 50 constituent with at least this
# many years of price history before the latest date.
MIN_HISTORY_YEARS = 10

BENCHMARK_TICKER = "^NSEI"
VIX_TICKER = "^INDIAVIX"

NSE_CONSTITUENTS_URL = "https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv"
KAGGLE_DATASET = "rohanrao/nifty50-stock-market-data"
