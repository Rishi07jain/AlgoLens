"""Cross-sectional and multi-asset strategies that produce target weights."""
from __future__ import annotations

import itertools

import numpy as np
import pandas as pd
from statsmodels.tsa.stattools import coint

from pipeline import config
from pipeline.backtest import Panel


def month_end_flags(index: pd.DatetimeIndex) -> pd.Series:
    """True on the last trading day of each month (known at that day's close because
    the calendar is the exchange calendar)."""
    s = pd.Series(index, index=index)
    return s.groupby([index.year, index.month]).transform("max") == s


def momentum_scores(p: Panel, lookback_m: int = 12, skip_m: int = 1) -> pd.DataFrame:
    """12-1 momentum: return from t-252 to t-21 trading days (skips the latest month)."""
    lb, sk = 21 * lookback_m, 21 * skip_m
    return p.close.shift(sk) / p.close.shift(lb) - 1


def cross_sectional_momentum(p: Panel, lookback_m: int = 12, skip_m: int = 1, top: int = 10) -> pd.DataFrame:
    score = momentum_scores(p, lookback_m, skip_m)
    me = month_end_flags(p.close.index)
    w = pd.DataFrame(np.nan, index=p.close.index, columns=p.close.columns)
    for d in p.close.index[me.to_numpy()]:
        s = score.loc[d].where(p.tradable.loc[d]).dropna()
        if len(s) < top:
            continue
        pick = s.nlargest(top).index
        row = pd.Series(0.0, index=p.close.columns)
        row[pick] = 1.0 / top
        w.loc[d] = row
    return w.ffill().fillna(0.0)


def dual_momentum(idx: Panel, lookback_m: int = 12) -> pd.DataFrame:
    """Hold the Nifty 50 when its 12-month return beats the risk-free rate, else cash.
    Checked at each month end. Uses the index level as a proxy for an index ETF."""
    c = idx.close.iloc[:, 0]
    r12 = c / c.shift(21 * lookback_m) - 1
    hurdle = (1 + config.RISK_FREE_ANNUAL) ** (lookback_m / 12) - 1
    me = month_end_flags(c.index)
    w = pd.Series(np.nan, index=c.index)
    w[me] = (r12[me] > hurdle).astype(float)
    w = w.where(r12.notna() | ~me)
    return w.ffill().fillna(0.0).to_frame(idx.close.columns[0])


def pairs_trading(p: Panel, sectors: dict[str, str], formation_days: int = 504, n_pairs: int = 5,
                  entry_z: float = 2.0, exit_z: float = 0.0, pvalue: float = 0.05,
                  start: str = config.BACKTEST_START) -> tuple[pd.DataFrame, list[dict]]:
    """Long-only pairs: each calendar year, pick up to `n_pairs` cointegrated same-sector
    pairs using only the previous `formation_days` of log prices (Engle-Granger test).
    During the year, z = (spread - formation mean) / formation sd. If z < -entry buy the
    first leg (cheap), if z > +entry buy the second leg; exit when z crosses `exit_z`.
    Each pair gets 1/n_pairs of capital. Positions are closed at the end of the year."""
    logp = np.log(p.close)
    idx = p.close.index
    w = pd.DataFrame(0.0, index=idx, columns=p.close.columns)
    chosen: list[dict] = []
    years = sorted({d.year for d in idx if d >= pd.Timestamp(start)})
    by_sector: dict[str, list[str]] = {}
    for s in p.close.columns:
        by_sector.setdefault(sectors.get(s, "Other"), []).append(s)
    for y in years:
        ys, ye = pd.Timestamp(f"{y}-01-01"), pd.Timestamp(f"{y}-12-31")
        form = logp.loc[:ys - pd.Timedelta(days=1)].tail(formation_days)
        cand = []
        for sec, names in by_sector.items():
            for a, b in itertools.combinations(sorted(names), 2):
                fa, fb = form[a], form[b]
                ok = fa.notna() & fb.notna()
                if ok.sum() < formation_days * 0.95:
                    continue
                try:
                    _, pv, _ = coint(fa[ok], fb[ok])
                except Exception:
                    continue
                if pv < pvalue:
                    beta, alpha = np.polyfit(fb[ok], fa[ok], 1)
                    spread = fa[ok] - (alpha + beta * fb[ok])
                    cand.append((pv, a, b, beta, alpha, spread.mean(), spread.std(ddof=0), sec))
        cand.sort()
        used: set[str] = set()
        picks = []
        for c in cand:
            if c[1] in used or c[2] in used:
                continue
            picks.append(c)
            used |= {c[1], c[2]}
            if len(picks) == n_pairs:
                break
        trade_days = idx[(idx >= ys) & (idx <= ye)]
        if not len(trade_days) or not picks:
            continue
        last_day = trade_days[-1]
        for pv, a, b, beta, alpha, mu, sd, sec in picks:
            chosen.append({"year": y, "a": a, "b": b, "sector": sec, "pvalue": round(float(pv), 4),
                           "beta": round(float(beta), 4)})
            z = ((logp.loc[trade_days, a] - (alpha + beta * logp.loc[trade_days, b])) - mu) / sd
            state = 0  # +1 long a, -1 long b
            for d, zv in z.items():
                if not np.isfinite(zv):
                    pass
                elif state == 0:
                    state = 1 if zv < -entry_z else (-1 if zv > entry_z else 0)
                elif state == 1 and zv >= exit_z:
                    state = 0
                elif state == -1 and zv <= exit_z:
                    state = 0
                if d == last_day:
                    state = 0
                if state == 1:
                    w.at[d, a] += 1.0 / n_pairs
                elif state == -1:
                    w.at[d, b] += 1.0 / n_pairs
    return w, chosen
