"""Feature set shared by every ML model. A row (date t, stock) uses only data known at
the close of day t; the target is whether close(t+1) > close(t)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline import config
from pipeline import indicators as ind
from pipeline.backtest import Panel

FEATURES = [
    "ret_1", "ret_5", "ret_20", "rsi_14", "macd_hist", "pct_b", "atr_pct", "vol_z",
    "dist_sma50", "dist_sma200", "vix", "vix_chg",
]

FEATURE_LABELS = {
    "ret_1": "1-day return", "ret_5": "5-day return", "ret_20": "20-day return",
    "rsi_14": "RSI(14)", "macd_hist": "MACD histogram / price", "pct_b": "Bollinger %B",
    "atr_pct": "ATR(14) / price", "vol_z": "Volume z-score (20d)",
    "dist_sma50": "Distance from 50-day SMA", "dist_sma200": "Distance from 200-day SMA",
    "vix": "India VIX level", "vix_chg": "India VIX 1-day change",
}


def build_features(p: Panel) -> pd.DataFrame:
    c = p.close
    vix = pd.read_parquet(config.PROCESSED / "vix.parquet")["vix"].reindex(c.index)
    # VIX can miss a day: carry the last known value (still only past information)
    vix = vix.ffill()
    _, _, hist = ind.macd(c)
    wide = {
        "ret_1": np.log(c / c.shift(1)),
        "ret_5": np.log(c / c.shift(5)),
        "ret_20": np.log(c / c.shift(20)),
        "rsi_14": ind.rsi(c, 14),
        "macd_hist": hist / c,
        "pct_b": ind.percent_b(c, 20, 2.0),
        "atr_pct": ind.atr(p.high, p.low, c, 14) / c,
        "vol_z": ind.volume_zscore(p.volume, 20),
        "dist_sma50": c / ind.sma(c, 50) - 1,
        "dist_sma200": c / ind.sma(c, 200) - 1,
    }
    nxt = c.shift(-1)
    fwd = nxt / c - 1
    target = (nxt > c).astype(float).where(nxt.notna())
    long = []
    for name, df in wide.items():
        long.append(df.stack(future_stack=True).rename(name))
    X = pd.concat(long, axis=1)
    X.index.names = ["date", "symbol"]
    X = X.reset_index()
    X["vix"] = X["date"].map(vix)
    X["vix_chg"] = X["date"].map(vix.pct_change())
    X["fwd_ret"] = fwd.stack(future_stack=True).reindex(pd.MultiIndex.from_frame(X[["date", "symbol"]])).to_numpy()
    X["target"] = target.stack(future_stack=True).reindex(pd.MultiIndex.from_frame(X[["date", "symbol"]])).to_numpy()
    # date of the close the target refers to (next trading day on the exchange calendar)
    next_date = pd.Series(c.index[1:].append(pd.DatetimeIndex([pd.NaT])), index=c.index)
    X["target_date"] = X["date"].map(next_date)
    tradable = p.tradable.stack(future_stack=True).rename("tradable")
    X = X.merge(tradable.reset_index().rename(columns={"level_0": "date"}), on=["date", "symbol"], how="left")
    X = X.replace([np.inf, -np.inf], np.nan)
    return X.dropna(subset=FEATURES).reset_index(drop=True)
