"""Backtest engines. Both follow the same execution rule:

    a signal computed on day t's close is executed at day t+1's open.

* `run_sleeves` - one independent long-only account ("sleeve") per stock. Used for the
  per-stock rule and ML strategies. Positions are 0/1 so the maths is exact:
      factor_d = (1 + h_{d-1} * gap_d) * (1 - cost_d) * (1 + h_d * intraday_d)
  where h_d is the position held from day d's open, gap_d = open_d / close_{d-1} - 1 and
  intraday_d = close_d / open_d - 1. On days a sleeve is flat its cash earns the daily
  risk-free rate (as if parked in a liquid fund) - the same rule for every strategy.
  The universe result splits Rs 10 lakh equally across sleeves and sums them (no hidden
  rebalancing between sleeves). A stock that lists after the start keeps its sleeve in
  cash until it can trade.

* `run_portfolio` - one account holding several stocks with target weights (momentum,
  pairs, dual momentum). Trades only when the target changes; holdings drift between
  rebalances. Simulated day by day.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from pipeline import config
from pipeline.costs import CostModel


@dataclass
class Panel:
    open: pd.DataFrame
    high: pd.DataFrame
    low: pd.DataFrame
    close: pd.DataFrame
    volume: pd.DataFrame
    tradable: pd.DataFrame

    @property
    def symbols(self) -> list[str]:
        return list(self.close.columns)


def load_panel(universe_only: bool = True) -> Panel:
    p = pd.read_parquet(config.PROCESSED / "prices.parquet")
    if universe_only:
        u = pd.read_parquet(config.PROCESSED / "universe.parquet")
        p = p[p["symbol"].isin(u.loc[u["in_universe"], "symbol"])]
    nifty = pd.read_parquet(config.PROCESSED / "nifty.parquet")
    cal = nifty.index
    wide = {c: p.pivot(index="date", columns="symbol", values=c).reindex(cal) for c in
            ("open", "high", "low", "close", "volume", "tradable")}
    wide["tradable"] = wide["tradable"].astype("boolean").fillna(False).astype(bool)
    return Panel(**wide)


def index_panel() -> Panel:
    n = pd.read_parquet(config.PROCESSED / "nifty.parquet")
    f = lambda c: n[[c]].rename(columns={c: "NIFTY50"})
    tr = pd.DataFrame(True, index=n.index, columns=["NIFTY50"])
    return Panel(f("open"), f("high"), f("low"), f("close"), f("volume"), tr)


def window_mask(index: pd.DatetimeIndex, start: str = config.BACKTEST_START, end: str | None = None) -> np.ndarray:
    m = index >= pd.Timestamp(start)
    if end:
        m &= index <= pd.Timestamp(end)
    return m


def holdings_from_signal(signal: pd.DataFrame, tradable: pd.DataFrame, start: str = config.BACKTEST_START) -> pd.DataFrame:
    """Position held from each day's open = yesterday's signal, executed only on days the
    stock trades (otherwise the previous holding is carried). Zero before the backtest."""
    h = signal.shift(1)
    h = h.where(tradable).ffill().fillna(0.0)
    h.loc[h.index < pd.Timestamp(start)] = 0.0
    return h.clip(0.0, 1.0)


@dataclass
class SleeveResult:
    factor: pd.DataFrame          # daily net growth factor per sleeve
    holdings: pd.DataFrame        # position held from each day's open
    signal: pd.DataFrame          # signal at each day's close
    cost: pd.DataFrame            # cost fraction paid at each day's open

    def sleeve_equity(self, capital: float = config.INITIAL_CAPITAL) -> pd.DataFrame:
        return self.factor.cumprod() * capital

    def universe_equity(self, capital: float = config.INITIAL_CAPITAL) -> pd.Series:
        n = self.factor.shape[1]
        return (self.factor.cumprod() * (capital / n)).sum(axis=1)

    def universe_returns(self) -> pd.Series:
        eq = self.universe_equity()
        return eq.pct_change().fillna(0.0)

    def exposure(self) -> pd.Series:
        """Fraction of total capital invested each day (by value)."""
        n = self.factor.shape[1]
        eq = self.factor.cumprod() / n
        return (eq * self.holdings).sum(axis=1) / eq.sum(axis=1)


def cash_rate_daily() -> float:
    return (1 + config.RISK_FREE_ANNUAL) ** (1 / config.TRADING_DAYS) - 1


def run_sleeves(panel: Panel, signal: pd.DataFrame, costs: CostModel, start: str = config.BACKTEST_START) -> SleeveResult:
    signal = signal.reindex_like(panel.close).astype(float)
    h = holdings_from_signal(signal, panel.tradable, start)
    h_prev = h.shift(1).fillna(0.0)
    gap = (panel.open / panel.close.shift(1) - 1).fillna(0.0)
    intra = (panel.close / panel.open - 1).fillna(0.0)
    dh = h - h_prev
    # buys are funded from cash: Rs E buys E / (1 + buy_rate) of stock; sells lose sell_rate
    cost_factor = (1 - (-dh).clip(lower=0) * costs.sell_rate) / (1 + dh.clip(lower=0) * costs.buy_rate)
    cost = 1 - cost_factor
    rf = cash_rate_daily()
    factor = (1 + h_prev * gap) * cost_factor * (1 + h * intra) * (1 + (1 - h) * rf)
    factor = factor.where(panel.close.notna(), 1 + rf)   # not listed yet: sleeve sits in cash
    factor.loc[factor.index < pd.Timestamp(start)] = 1.0
    return SleeveResult(factor=factor, holdings=h, signal=signal, cost=cost)


@dataclass
class PortfolioResult:
    equity: pd.Series
    weights: pd.DataFrame          # end-of-day value weights actually held
    target: pd.DataFrame           # target weights decided at each close
    trades_value: pd.Series        # one-way traded value / equity per day
    cost: pd.Series

    def returns(self) -> pd.Series:
        return self.equity.pct_change().fillna(0.0)

    def exposure(self) -> pd.Series:
        return self.weights.sum(axis=1)


def run_portfolio(panel: Panel, target: pd.DataFrame, costs: CostModel, start: str = config.BACKTEST_START,
                  capital: float = config.INITIAL_CAPITAL) -> PortfolioResult:
    """target: weights (rows sum <= 1) decided at close t, executed at open t+1."""
    target = target.reindex_like(panel.close).fillna(0.0)
    idx = panel.close.index
    s = int(np.searchsorted(idx, pd.Timestamp(start)))
    o = panel.open.to_numpy(dtype=float)
    c = panel.close.to_numpy(dtype=float)
    trd = panel.tradable.to_numpy()
    tg = target.to_numpy(dtype=float)
    T, N = c.shape
    v = np.zeros(N)
    cash = capital
    equity = np.full(T, capital, dtype=float)
    wts = np.zeros((T, N))
    traded = np.zeros(T)
    costs_paid = np.zeros(T)
    last_target = np.zeros(N)
    rf = cash_rate_daily()
    for d in range(s, T):
        cash *= 1 + rf
        # overnight move on held positions
        if d > 0:
            g = o[d] / c[d - 1]
            v = v * np.where(np.isfinite(g), g, 1.0)
        tgt = tg[d - 1] if d > 0 else np.zeros(N)
        if not np.allclose(tgt, last_target):
            E = cash + v.sum()
            # size buys so the fees are paid from the same equity (no borrowing)
            want = tgt * E / (1 + costs.buy_rate * max(tgt.sum() - (v.sum() / E if E > 0 else 0), 0))
            # cannot trade a stock that has no price / no volume today
            can = trd[d] & np.isfinite(o[d])
            want = np.where(can, want, v)
            delta = want - v
            fee = (np.clip(delta, 0, None) * costs.buy_rate).sum() + (np.clip(-delta, 0, None) * costs.sell_rate).sum()
            if cash - delta.sum() - fee < 0 and want.sum() > 0:
                # fees would push cash below zero: scale the whole book down to fit
                want = np.where(can, want * (E - fee) / want.sum(), v) if tgt.sum() >= 0.999 else want
                delta = want - v
                fee = (np.clip(delta, 0, None) * costs.buy_rate).sum() + (np.clip(-delta, 0, None) * costs.sell_rate).sum()
            cash = cash - delta.sum() - fee
            v = want
            traded[d] = np.abs(delta).sum() / E if E > 0 else 0.0
            costs_paid[d] = fee / E if E > 0 else 0.0
            last_target = tgt
        r = c[d] / o[d]
        v = v * np.where(np.isfinite(r), r, 1.0)
        equity[d] = cash + v.sum()
        wts[d] = v / equity[d] if equity[d] > 0 else 0.0
    return PortfolioResult(
        equity=pd.Series(equity, index=idx),
        weights=pd.DataFrame(wts, index=idx, columns=panel.close.columns),
        target=target,
        trades_value=pd.Series(traded, index=idx),
        cost=pd.Series(costs_paid, index=idx),
    )


def extract_trades(holdings: pd.DataFrame, factor: pd.DataFrame, open_: pd.DataFrame,
                   capital_per_sleeve: float) -> pd.DataFrame:
    """Round trips from 0/1 sleeve holdings. A trade enters at the open of the first held
    day and exits at the open of the first flat day. Its return compounds the sleeve's
    daily net factors from entry day to exit day (exit day's factor = overnight gap less
    sell cost). Trades still open at the end are marked to the last close."""
    rows = []
    h = holdings.to_numpy()
    f = factor.to_numpy()
    o = open_.to_numpy()
    eq = np.cumprod(f, axis=0) * capital_per_sleeve
    idx = holdings.index
    T = len(idx)
    for j, sym in enumerate(holdings.columns):
        hj = h[:, j]
        d = np.diff(np.concatenate([[0.0], hj]))
        entries = np.flatnonzero(d > 0)
        exits = np.flatnonzero(d < 0)
        for e in entries:
            later = exits[exits > e]
            x = int(later[0]) if len(later) else None
            last = x if x is not None else T - 1
            seg = f[e:last + 1, j]
            ret = float(np.prod(seg) - 1)
            start_eq = eq[e - 1, j] if e > 0 else capital_per_sleeve
            rows.append({
                "symbol": sym, "entry": idx[e], "exit": idx[x] if x is not None else None,
                "entry_px": float(o[e, j]), "exit_px": float(o[x, j]) if x is not None else None,
                "ret": ret, "pnl": float(start_eq * ret), "days": int(last - e), "open": x is None,
            })
    return pd.DataFrame(rows)


def extract_weight_trades(weights_target: pd.DataFrame, open_: pd.DataFrame, costs: CostModel,
                          capital: float) -> pd.DataFrame:
    """Approximate round trips for portfolio strategies: a holding period starts when a
    stock's target weight turns positive and ends when it returns to zero. Return is
    open-to-open price change less one round trip of costs."""
    tg = weights_target.shift(1).fillna(0.0)  # executed next open
    rows = []
    o = open_.to_numpy()
    idx = tg.index
    for j, sym in enumerate(tg.columns):
        w = tg.iloc[:, j].to_numpy()
        on = (w > 0).astype(float)
        d = np.diff(np.concatenate([[0.0], on]))
        ent = np.flatnonzero(d > 0)
        ex = np.flatnonzero(d < 0)
        for e in ent:
            later = ex[ex > e]
            x = int(later[0]) if len(later) else None
            last = x if x is not None else len(idx) - 1
            px_in, px_out = o[e, j], o[last, j]
            if not (np.isfinite(px_in) and np.isfinite(px_out)) or px_in <= 0:
                continue
            ret = (px_out / px_in) * (1 - costs.sell_rate) / (1 + costs.buy_rate) - 1
            rows.append({"symbol": sym, "entry": idx[e], "exit": idx[x] if x is not None else None,
                         "entry_px": float(px_in), "exit_px": float(px_out) if x is not None else None,
                         "ret": float(ret), "pnl": float(ret * capital * w[e]), "days": int(last - e),
                         "open": x is None})
    return pd.DataFrame(rows)
