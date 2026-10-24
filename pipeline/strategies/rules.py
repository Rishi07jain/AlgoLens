"""Per-stock rule-based strategies. Each returns a 0/1 signal panel computed at the
close; the backtest engine executes it at the next open."""
from __future__ import annotations

import pandas as pd

from pipeline import indicators as ind
from pipeline.backtest import Panel


def sma_cross(p: Panel, fast: int = 50, slow: int = 200) -> pd.DataFrame:
    f, s = ind.sma(p.close, fast), ind.sma(p.close, slow)
    return (f > s).astype(float).where(s.notna(), 0.0)


def ema_cross(p: Panel, fast: int = 12, slow: int = 26) -> pd.DataFrame:
    f, s = ind.ema(p.close, fast), ind.ema(p.close, slow)
    return (f > s).astype(float).where(s.notna(), 0.0)


def macd_signal(p: Panel, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    line, sig, _ = ind.macd(p.close, fast, slow, signal)
    return (line > sig).astype(float).where(sig.notna(), 0.0)


def donchian(p: Panel, entry: int = 55, exit_: int = 20) -> pd.DataFrame:
    up, lo = ind.donchian(p.high, p.low, entry, exit_)
    return ind.state_machine(p.close > up, p.close < lo)


def supertrend(p: Panel, n: int = 10, mult: float = 3.0) -> pd.DataFrame:
    st = ind.supertrend(p.high, p.low, p.close, n, mult)
    return (st == 1).astype(float)


def rsi_reversal(p: Panel, n: int = 14, entry: float = 30, exit_: float = 55) -> pd.DataFrame:
    r = ind.rsi(p.close, n)
    return ind.state_machine(r < entry, r > exit_)


def bollinger_reversion(p: Panel, n: int = 20, k: float = 2.0) -> pd.DataFrame:
    lo, mid, _ = ind.bollinger(p.close, n, k)
    return ind.state_machine(p.close < lo, p.close >= mid)


def zscore_reversion(p: Panel, n: int = 20, entry: float = -2.0, exit_: float = 0.0) -> pd.DataFrame:
    z = ind.zscore(p.close, n)
    return ind.state_machine(z < entry, z >= exit_)


def buy_and_hold(p: Panel) -> pd.DataFrame:
    return p.close.notna().astype(float)
