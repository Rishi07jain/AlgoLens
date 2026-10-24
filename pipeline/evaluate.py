"""Run every strategy under the same rules and collect what the export step needs."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from pipeline import config
from pipeline.backtest import (Panel, extract_trades, extract_weight_trades, index_panel, load_panel,
                               run_portfolio, run_sleeves)
from pipeline.costs import GROSS, NET, CostModel
from pipeline.strategies import portfolio as pf
from pipeline.strategies import rules
from pipeline.strategies.registry import BY_ID, ML_IDS, STRATEGIES


@dataclass
class Run:
    sid: str
    kind: str
    returns: pd.Series                      # universe-level daily returns in window
    exposure: pd.Series
    turnover_daily: pd.Series               # one-way traded value / equity per day
    trades: pd.DataFrame
    n_sleeves: int
    signal: pd.DataFrame | None = None      # 0/1 call at each close (for accuracy)
    sleeve_factor: pd.DataFrame | None = None
    sleeve_holdings: pd.DataFrame | None = None
    extra: dict = field(default_factory=dict)


def window(s: pd.Series | pd.DataFrame):
    return s.loc[pd.Timestamp(config.BACKTEST_START):]


class Context:
    """Loads data once and builds signals once; costs can then be swapped cheaply."""

    def __init__(self):
        self.p: Panel = load_panel()
        self.idx: Panel = index_panel()
        u = pd.read_parquet(config.PROCESSED / "universe.parquet")
        self.universe = u[u["in_universe"]].set_index("symbol")
        self.sectors = self.universe["sector"].to_dict()
        self.nifty_ret = window(self.idx.close.iloc[:, 0].pct_change().fillna(0.0))
        self._signals: dict[str, pd.DataFrame] = {}
        self._weights: dict[str, pd.DataFrame] = {}
        self.ml = None
        self.pairs_chosen: list[dict] = []
        try:
            self.ml = pd.read_parquet(config.PROCESSED / "ml_predictions.parquet")
        except FileNotFoundError:
            pass

    # ---- signal builders -------------------------------------------------------------
    def sleeve_signal(self, sid: str, **params) -> pd.DataFrame:
        key = sid + repr(sorted(params.items()))
        if key in self._signals:
            return self._signals[key]
        p = self.p
        if sid == "sma_50_200":
            s = rules.sma_cross(p, params.get("fast", 50), params.get("slow", 200))
        elif sid == "ema_12_26":
            s = rules.ema_cross(p, params.get("fast", 12), params.get("slow", 26))
        elif sid == "macd_12_26_9":
            s = rules.macd_signal(p)
        elif sid == "donchian_55_20":
            s = rules.donchian(p, params.get("entry", 55), params.get("exit", 20))
        elif sid == "supertrend_10_3":
            s = rules.supertrend(p)
        elif sid == "rsi_14":
            s = rules.rsi_reversal(p, params.get("period", 14), params.get("entry", 30), 55)
        elif sid == "bollinger_20_2":
            s = rules.bollinger_reversion(p, params.get("window", 20), params.get("k", 2.0))
        elif sid == "zscore_20":
            s = rules.zscore_reversion(p)
        elif sid == "buy_hold":
            s = rules.buy_and_hold(p)
        elif sid in ML_IDS:
            if self.ml is None:
                raise RuntimeError("ML predictions missing: run `python -m pipeline.ml.walkforward` first")
            w = self.ml.pivot(index="date", columns="symbol", values=f"p_{sid}")
            s = (w > 0.5).astype(float).reindex(index=p.close.index, columns=p.close.columns).fillna(0.0)
        else:
            raise KeyError(sid)
        self._signals[key] = s
        return s

    def target_weights(self, sid: str, **params) -> tuple[pd.DataFrame, Panel]:
        key = sid + repr(sorted(params.items()))
        if sid == "xs_momentum":
            if key not in self._weights:
                self._weights[key] = pf.cross_sectional_momentum(self.p, params.get("lookback_m", 12), 1,
                                                                 params.get("top", 10))
            return self._weights[key], self.p
        if sid == "pairs":
            if key not in self._weights:
                w, chosen = pf.pairs_trading(self.p, self.sectors)
                self._weights[key] = w
                self.pairs_chosen = chosen
            return self._weights[key], self.p
        if sid == "dual_momentum":
            if key not in self._weights:
                self._weights[key] = pf.dual_momentum(self.idx)
            return self._weights[key], self.idx
        if sid == "nifty_bh":
            return pd.DataFrame(1.0, index=self.idx.close.index, columns=self.idx.close.columns), self.idx
        raise KeyError(sid)

    # ---- runs ------------------------------------------------------------------------
    def run(self, sid: str, costs: CostModel = NET, with_trades: bool = True, **params) -> Run:
        kind = BY_ID[sid]["kind"]
        if kind == "sleeve":
            sig = self.sleeve_signal(sid, **params)
            res = run_sleeves(self.p, sig, costs)
            n = sig.shape[1]
            seq = (res.factor.cumprod() / n)
            dh = (res.holdings - res.holdings.shift(1).fillna(0.0)).abs()
            turn = (dh * seq.shift(1).fillna(1 / n)).sum(axis=1) / seq.shift(1).fillna(1 / n).sum(axis=1)
            trades = extract_trades(window(res.holdings), window(res.factor), window(self.p.open),
                                    config.INITIAL_CAPITAL / n) if with_trades else pd.DataFrame()
            return Run(sid, kind, window(res.universe_returns()), window(res.exposure()), window(turn), trades, n,
                       signal=sig, sleeve_factor=window(res.factor), sleeve_holdings=window(res.holdings))
        w, panel = self.target_weights(sid, **params)
        res = run_portfolio(panel, w, costs)
        trades = extract_weight_trades(window(w), window(panel.open), costs, config.INITIAL_CAPITAL) if with_trades else pd.DataFrame()
        held = (w > 0).astype(float)
        return Run(sid, kind, window(res.returns()), window(res.exposure()), window(res.trades_value), trades,
                   n_sleeves=1 if kind == "index" else int(BY_ID[sid]["params"].get("top", 10)),
                   signal=held, extra={"weights": window(res.weights)})


def default_runs(ctx: Context, costs: CostModel) -> dict[str, Run]:
    out = {}
    for s in STRATEGIES:
        if s["id"] in ML_IDS and ctx.ml is None:
            continue
        out[s["id"]] = ctx.run(s["id"], costs)
    return out


def next_day_up(panel: Panel) -> pd.DataFrame:
    nxt = panel.close.shift(-1)
    return (nxt > panel.close).where(nxt.notna())


__all__ = ["Context", "Run", "default_runs", "next_day_up", "window", "GROSS", "NET", "np"]
