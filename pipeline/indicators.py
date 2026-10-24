"""Technical indicators on wide panels (rows = dates, columns = symbols).

Every value at row t uses only data up to and including the close of day t.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def sma(x: pd.DataFrame, n: int) -> pd.DataFrame:
    return x.rolling(n, min_periods=n).mean()


def ema(x: pd.DataFrame, n: int) -> pd.DataFrame:
    return x.ewm(span=n, adjust=False, min_periods=n).mean()


def rsi(close: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    """Wilder's RSI."""
    d = close.diff()
    gain = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    loss = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = gain / loss.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.where(loss != 0, 100.0).where(gain.notna())


def macd(close: pd.DataFrame, fast: int = 12, slow: int = 26, signal: int = 9):
    line = ema(close, fast) - ema(close, slow)
    sig = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return line, sig, line - sig


def bollinger(close: pd.DataFrame, n: int = 20, k: float = 2.0):
    mid = sma(close, n)
    sd = close.rolling(n, min_periods=n).std(ddof=0)
    return mid - k * sd, mid, mid + k * sd


def percent_b(close: pd.DataFrame, n: int = 20, k: float = 2.0) -> pd.DataFrame:
    lo, _, hi = bollinger(close, n, k)
    return (close - lo) / (hi - lo).replace(0, np.nan)


def zscore(close: pd.DataFrame, n: int = 20) -> pd.DataFrame:
    m = sma(close, n)
    sd = close.rolling(n, min_periods=n).std(ddof=0)
    return (close - m) / sd.replace(0, np.nan)


def true_range(high: pd.DataFrame, low: pd.DataFrame, close: pd.DataFrame) -> pd.DataFrame:
    pc = close.shift(1)
    a = (high - low).to_numpy()
    b = (high - pc).abs().to_numpy()
    c = (low - pc).abs().to_numpy()
    tr = np.fmax(np.fmax(a, b), c)
    return pd.DataFrame(tr, index=close.index, columns=close.columns)


def atr(high: pd.DataFrame, low: pd.DataFrame, close: pd.DataFrame, n: int = 14) -> pd.DataFrame:
    tr = true_range(high, low, close)
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def donchian(high: pd.DataFrame, low: pd.DataFrame, entry: int = 55, exit_: int = 20):
    """Channel of the *previous* N days (excludes today) so a breakout is today's close
    above the prior N-day high."""
    upper = high.rolling(entry, min_periods=entry).max().shift(1)
    lower = low.rolling(exit_, min_periods=exit_).min().shift(1)
    return upper, lower


def supertrend(high: pd.DataFrame, low: pd.DataFrame, close: pd.DataFrame, n: int = 10, mult: float = 3.0) -> pd.DataFrame:
    """Returns +1 (uptrend) / -1 (downtrend) / NaN (warm-up) per day."""
    a = atr(high, low, close, n)
    hl2 = (high + low) / 2
    ub_basic = (hl2 + mult * a).to_numpy()
    lb_basic = (hl2 - mult * a).to_numpy()
    c = close.to_numpy()
    T, N = c.shape
    out = np.full((T, N), np.nan)
    for j in range(N):
        ub = lb = np.nan
        trend = 0
        for t in range(T):
            if np.isnan(ub_basic[t, j]) or np.isnan(c[t, j]):
                continue
            if np.isnan(ub):
                ub, lb, trend = ub_basic[t, j], lb_basic[t, j], 1
                out[t, j] = trend
                continue
            prev_c = c[t - 1, j]
            ub = ub_basic[t, j] if (ub_basic[t, j] < ub or prev_c > ub) else ub
            lb = lb_basic[t, j] if (lb_basic[t, j] > lb or prev_c < lb) else lb
            if trend == 1 and c[t, j] < lb:
                trend = -1
            elif trend == -1 and c[t, j] > ub:
                trend = 1
            out[t, j] = trend
    return pd.DataFrame(out, index=close.index, columns=close.columns)


def volume_zscore(volume: pd.DataFrame, n: int = 20) -> pd.DataFrame:
    lv = np.log1p(volume)
    m = lv.rolling(n, min_periods=n).mean()
    sd = lv.rolling(n, min_periods=n).std(ddof=0)
    return (lv - m) / sd.replace(0, np.nan)


def state_machine(entry: pd.DataFrame, exit_: pd.DataFrame) -> pd.DataFrame:
    """Long-only position from entry/exit boolean signals: enter on entry, stay long
    until exit. Fully path-dependent but causal (row t uses rows <= t)."""
    e = entry.fillna(False).to_numpy()
    x = exit_.fillna(False).to_numpy()
    T, N = e.shape
    pos = np.zeros((T, N))
    cur = np.zeros(N)
    for t in range(T):
        cur = np.where(cur == 1, np.where(x[t], 0.0, 1.0), np.where(e[t], 1.0, 0.0))
        pos[t] = cur
    return pd.DataFrame(pos, index=entry.index, columns=entry.columns)
