"""Accuracy (is the signal right?) and effectiveness (does it make risk-adjusted money?)
metrics. All functions take daily simple returns."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats

from pipeline import config

RF_DAILY = (1 + config.RISK_FREE_ANNUAL) ** (1 / config.TRADING_DAYS) - 1
EULER_GAMMA = 0.5772156649


def _clean(x: float | None, nd: int = 6):
    if x is None:
        return None
    try:
        if not np.isfinite(x):
            return None
    except TypeError:
        return None
    return round(float(x), nd)


def cagr(r: pd.Series) -> float:
    if len(r) < 2:
        return np.nan
    growth = float((1 + r).prod())
    years = len(r) / config.TRADING_DAYS
    return growth ** (1 / years) - 1 if growth > 0 else -1.0


def sharpe(r: pd.Series) -> float:
    ex = r - RF_DAILY
    sd = r.std(ddof=1)
    return float(ex.mean() / sd * math.sqrt(config.TRADING_DAYS)) if sd > 0 else np.nan


def sortino(r: pd.Series) -> float:
    ex = r - RF_DAILY
    dd = np.sqrt((np.minimum(ex, 0) ** 2).mean())
    return float(ex.mean() / dd * math.sqrt(config.TRADING_DAYS)) if dd > 0 else np.nan


def drawdown(r: pd.Series) -> pd.Series:
    eq = (1 + r).cumprod()
    return eq / eq.cummax() - 1


def max_drawdown_stats(r: pd.Series) -> tuple[float, int, str | None, str | None]:
    """Max drawdown, longest underwater spell in trading days, and the worst DD's peak/trough dates."""
    dd = drawdown(r)
    mdd = float(dd.min()) if len(dd) else np.nan
    under = (dd < 0).to_numpy()
    longest = cur = 0
    for u in under:
        cur = cur + 1 if u else 0
        longest = max(longest, cur)
    if len(dd) and mdd < 0:
        trough = dd.idxmin()
        peak = (1 + r).cumprod().loc[:trough].idxmax()
        return mdd, longest, str(peak.date()), str(trough.date())
    return mdd, longest, None, None


def alpha_beta(r: pd.Series, b: pd.Series) -> tuple[float, float]:
    j = pd.concat([r - RF_DAILY, b - RF_DAILY], axis=1).dropna()
    if len(j) < 30 or j.iloc[:, 1].var() == 0:
        return np.nan, np.nan
    beta = j.iloc[:, 0].cov(j.iloc[:, 1]) / j.iloc[:, 1].var()
    alpha = (j.iloc[:, 0].mean() - beta * j.iloc[:, 1].mean()) * config.TRADING_DAYS
    return float(alpha), float(beta)


def var_cvar(r: pd.Series, q: float = 0.05) -> tuple[float, float]:
    if len(r) == 0:
        return np.nan, np.nan
    v = float(np.quantile(r, q))
    tail = r[r <= v]
    return v, float(tail.mean()) if len(tail) else v


def trade_stats(trades: pd.DataFrame | None) -> dict:
    if trades is None or len(trades) == 0:
        return {"n_trades": 0, "win_rate": None, "profit_factor": None, "expectancy_pct": None,
                "expectancy_inr": None, "payoff_ratio": None, "avg_hold_days": None}
    t = trades
    wins, losses = t[t["ret"] > 0], t[t["ret"] <= 0]
    gp, gl = wins["pnl"].sum(), -losses["pnl"].sum()
    aw = wins["ret"].mean() if len(wins) else np.nan
    al = -losses["ret"].mean() if len(losses) else np.nan
    return {
        "n_trades": int(len(t)),
        "win_rate": _clean(len(wins) / len(t)),
        "profit_factor": _clean(gp / gl) if gl > 0 else None,
        "expectancy_pct": _clean(t["ret"].mean()),
        "expectancy_inr": _clean(t["pnl"].mean(), 2),
        "payoff_ratio": _clean(aw / al) if (al and al > 0) else None,
        "avg_hold_days": _clean(t["days"].mean(), 2),
    }


def effectiveness(r: pd.Series, bench: pd.Series | None, exposure: pd.Series | None = None,
                  turnover_annual: float | None = None, trades: pd.DataFrame | None = None,
                  n_sleeves: int = 1) -> dict:
    r = r.dropna()
    mdd, dd_days, peak, trough = max_drawdown_stats(r)
    c = cagr(r)
    a, b = alpha_beta(r, bench.reindex(r.index)) if bench is not None else (np.nan, np.nan)
    v, cv = var_cvar(r)
    years = len(r) / config.TRADING_DAYS
    ts = trade_stats(trades)
    out = {
        "start": str(r.index.min().date()) if len(r) else None,
        "end": str(r.index.max().date()) if len(r) else None,
        "years": _clean(years, 2),
        "total_return": _clean(float((1 + r).prod() - 1)),
        "cagr": _clean(c),
        "vol": _clean(float(r.std(ddof=1) * math.sqrt(config.TRADING_DAYS))),
        "sharpe": _clean(sharpe(r), 4),
        "sortino": _clean(sortino(r), 4),
        "max_dd": _clean(mdd),
        "max_dd_days": int(dd_days),
        "dd_peak": peak, "dd_trough": trough,
        "calmar": _clean(c / abs(mdd)) if mdd and mdd < 0 else None,
        "alpha": _clean(a), "beta": _clean(b, 4),
        "var95": _clean(v), "cvar95": _clean(cv),
        "exposure": _clean(float(exposure.reindex(r.index).mean())) if exposure is not None else None,
        "turnover": _clean(turnover_annual, 4),
        "trades_per_year": _clean(ts["n_trades"] / years / max(n_sleeves, 1), 3) if years > 0 else None,
    }
    out.update(ts)
    return out


def classification(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """Directional accuracy of a long/flat call vs the next day's close-to-close direction."""
    y_true = np.asarray(y_true, dtype=bool)
    y_pred = np.asarray(y_pred, dtype=bool)
    tp = int((y_true & y_pred).sum())
    fp = int((~y_true & y_pred).sum())
    fn = int((y_true & ~y_pred).sum())
    tn = int((~y_true & ~y_pred).sum())
    n = tp + fp + fn + tn
    prec = tp / (tp + fp) if tp + fp else None
    rec = tp / (tp + fn) if tp + fn else None
    f1 = 2 * prec * rec / (prec + rec) if prec and rec else None
    return {
        "hit_rate": _clean(prec),               # % of long days followed by an up day
        "accuracy": _clean((tp + tn) / n) if n else None,
        "precision": _clean(prec), "recall": _clean(rec), "f1": _clean(f1),
        "base_rate": _clean((tp + fn) / n) if n else None,
        "long_days": tp + fp,
        "confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
    }


def rank_ic(score: pd.DataFrame, fwd: pd.DataFrame, min_names: int = 5) -> tuple[float | None, float | None]:
    """Mean cross-sectional Spearman correlation between a score and forward return,
    plus its t-stat."""
    s = score.rank(axis=1)
    f = fwd.rank(axis=1)
    ok = s.notna() & f.notna()
    s, f = s.where(ok), f.where(ok)
    cnt = ok.sum(axis=1)
    sd = s.sub(s.mean(axis=1), axis=0)
    fd = f.sub(f.mean(axis=1), axis=0)
    ic = (sd * fd).sum(axis=1) / np.sqrt((sd ** 2).sum(axis=1) * (fd ** 2).sum(axis=1))
    ic = ic[cnt >= min_names].dropna()
    if len(ic) < 3:
        return None, None
    t = ic.mean() / (ic.std(ddof=1) / math.sqrt(len(ic)))
    return _clean(float(ic.mean())), _clean(float(t), 3)


def bootstrap_sharpe_ci(r: pd.Series, n_boot: int = 1000, block: int = 21, seed: int = 7) -> tuple[float, float]:
    """95% CI on annualised Sharpe from a moving-block bootstrap (keeps autocorrelation)."""
    x = r.dropna().to_numpy()
    T = len(x)
    if T < block * 3:
        return np.nan, np.nan
    rng = np.random.default_rng(seed)
    nb = int(np.ceil(T / block))
    out = np.empty(n_boot)
    for i in range(n_boot):
        starts = rng.integers(0, T - block, nb)
        sample = np.concatenate([x[s:s + block] for s in starts])[:T]
        sd = sample.std(ddof=1)
        out[i] = (sample.mean() - RF_DAILY) / sd * math.sqrt(config.TRADING_DAYS) if sd > 0 else np.nan
    return float(np.nanpercentile(out, 2.5)), float(np.nanpercentile(out, 97.5))


def deflated_sharpe(r: pd.Series, trial_sharpes_daily: np.ndarray) -> dict:
    """Deflated Sharpe ratio (Bailey & Lopez de Prado, 2014). Probability that the true
    Sharpe is above the best Sharpe expected by luck from N trials."""
    x = r.dropna()
    T = len(x)
    sr = (x.mean() - RF_DAILY) / x.std(ddof=1)
    n = len(trial_sharpes_daily)
    var_sr = float(np.var(trial_sharpes_daily, ddof=1)) if n > 1 else 0.0
    if n > 1:
        z1 = stats.norm.ppf(1 - 1 / n)
        z2 = stats.norm.ppf(1 - 1 / (n * math.e))
        sr0 = math.sqrt(var_sr) * ((1 - EULER_GAMMA) * z1 + EULER_GAMMA * z2)
    else:
        sr0 = 0.0
    sk = float(stats.skew(x))
    ku = float(stats.kurtosis(x, fisher=False))
    denom = math.sqrt(max(1 - sk * sr + (ku - 1) / 4 * sr ** 2, 1e-12))
    dsr = stats.norm.cdf((sr - sr0) * math.sqrt(T - 1) / denom)
    return {"dsr": _clean(float(dsr), 4), "sr0_annual": _clean(sr0 * math.sqrt(config.TRADING_DAYS), 4),
            "n_trials": int(n), "skew": _clean(sk, 4), "kurtosis": _clean(ku, 4)}


def monthly_returns(r: pd.Series) -> list[dict]:
    m = (1 + r).groupby([r.index.year, r.index.month]).prod() - 1
    return [{"y": int(y), "m": int(mo), "r": _clean(float(v))} for (y, mo), v in m.items()]


def yearly_returns(r: pd.Series) -> list[dict]:
    out = []
    for y, g in r.groupby(r.index.year):
        out.append({"year": int(y), "ret": _clean(float((1 + g).prod() - 1)), "sharpe": _clean(sharpe(g), 4)})
    return out
