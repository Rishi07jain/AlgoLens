"""Market regime tags for each trading day.

Trend regime (from the Nifty 50 index, known at the close):
  * bull     - close above its 200-day SMA and the SMA is higher than 60 days ago
  * bear     - close below its 200-day SMA and the SMA is lower than 60 days ago
  * sideways - everything else
Volatility regime: India VIX terciles over the backtest window (low / normal / high).
The VIX terciles use the whole window, so they describe the period; they are never used
to make trading decisions.

A strategy's return on day d is attributed to the regime tagged at the close of d-1
(the information available when the position was taken).
"""
from __future__ import annotations

import pandas as pd

from pipeline import config


def tag_regimes() -> pd.DataFrame:
    n = pd.read_parquet(config.PROCESSED / "nifty.parquet")["close"]
    vix = pd.read_parquet(config.PROCESSED / "vix.parquet")["vix"].reindex(n.index).ffill()
    sma = n.rolling(200, min_periods=200).mean()
    slope = sma / sma.shift(60) - 1
    trend = pd.Series("sideways", index=n.index)
    trend[(n > sma) & (slope > 0)] = "bull"
    trend[(n < sma) & (slope < 0)] = "bear"
    trend[sma.isna() | slope.isna()] = None
    win = n.index >= pd.Timestamp(config.BACKTEST_START)
    q1, q2 = vix[win].quantile([1 / 3, 2 / 3])
    vol = pd.Series("normal", index=n.index)
    vol[vix <= q1] = "low"
    vol[vix > q2] = "high"
    vol[vix.isna()] = None
    out = pd.DataFrame({"close": n, "sma200": sma, "slope60": slope, "vix": vix, "trend": trend, "vol": vol})
    out.attrs["vix_terciles"] = (float(q1), float(q2))
    return out
