"""Look-ahead tests. Small hand-made price series are used *only* to test the code paths;
they are never exported or shown as market data."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from pipeline import indicators as ind
from pipeline.backtest import Panel, holdings_from_signal, run_portfolio, run_sleeves
from pipeline.costs import GROSS, NET
from pipeline.ml.walkforward import walk_forward_splits
from pipeline.strategies import rules

DATES = pd.bdate_range("2009-06-01", periods=400)


def toy_panel(seed: int = 0, n: int = 3) -> Panel:
    rng = np.random.default_rng(seed)
    c = pd.DataFrame(100 * np.exp(np.cumsum(rng.normal(0, 0.01, (len(DATES), n)), axis=0)),
                     index=DATES, columns=[f"S{i}" for i in range(n)])
    o = c.shift(1).fillna(c) * (1 + rng.normal(0, 0.002, c.shape))
    h = np.maximum(o, c) * 1.005
    lo = np.minimum(o, c) * 0.995
    v = pd.DataFrame(rng.integers(1_000, 5_000, c.shape), index=DATES, columns=c.columns).astype(float)
    return Panel(o, h, lo, c, v, pd.DataFrame(True, index=DATES, columns=c.columns))


def truncated(p: Panel, k: int) -> Panel:
    return Panel(*(getattr(p, f).iloc[:k] for f in ("open", "high", "low", "close", "volume", "tradable")))


@pytest.mark.parametrize("fn", [rules.sma_cross, rules.ema_cross, rules.macd_signal, rules.donchian, rules.supertrend,
                                rules.rsi_reversal, rules.bollinger_reversion, rules.zscore_reversion])
def test_signals_do_not_change_when_future_is_removed(fn):
    """A signal at day t must be identical whether or not days after t exist."""
    p = toy_panel()
    full = fn(p)
    for k in (250, 300, 399):
        part = fn(truncated(p, k))
        pd.testing.assert_frame_equal(full.iloc[:k], part, check_dtype=False)


def test_future_shock_does_not_move_past_signals():
    p = toy_panel()
    base = rules.sma_cross(p, 10, 30)
    shocked_close = p.close.copy()
    shocked_close.iloc[350:] *= 3.0
    p2 = Panel(p.open, p.high, p.low, shocked_close, p.volume, p.tradable)
    after = rules.sma_cross(p2, 10, 30)
    pd.testing.assert_frame_equal(base.iloc[:350], after.iloc[:350])


def test_execution_is_next_open():
    sig = pd.DataFrame({"S0": [0, 1, 1, 0, 0]}, index=DATES[:5], dtype=float)
    tr = pd.DataFrame(True, index=sig.index, columns=sig.columns)
    h = holdings_from_signal(sig, tr, start=str(DATES[0].date()))
    assert h["S0"].tolist() == [0, 0, 1, 1, 0]


def test_same_day_return_is_not_captured():
    """A signal that fires on a big up-day close must not earn that day's move."""
    idx = DATES[:6]
    c = pd.DataFrame({"S0": [100, 100, 150, 150, 150, 150]}, index=idx, dtype=float)
    o = pd.DataFrame({"S0": [100, 100, 100, 150, 150, 150]}, index=idx, dtype=float)
    p = Panel(o, c, c, c, c * 0 + 1, pd.DataFrame(True, index=idx, columns=["S0"]))
    sig = pd.DataFrame({"S0": [0, 0, 1, 1, 1, 1]}, index=idx, dtype=float)   # fires at day-2 close (after +50%)
    res = run_sleeves(p, sig, GROSS, start=str(idx[0].date()))
    gain = res.factor["S0"].prod() / (1 + 0) - 1
    rf_days = (1 + ((1.065) ** (1 / 252) - 1)) ** 3   # flat for days 0-2 earns cash yield only
    assert gain == pytest.approx(rf_days - 1, abs=1e-9)


def test_portfolio_engine_executes_next_open():
    idx = DATES[:5]
    c = pd.DataFrame({"S0": [100, 100, 120, 120, 120]}, index=idx, dtype=float)
    o = pd.DataFrame({"S0": [100, 100, 100, 120, 120]}, index=idx, dtype=float)
    p = Panel(o, c, c, c, c * 0 + 1, pd.DataFrame(True, index=idx, columns=["S0"]))
    w = pd.DataFrame({"S0": [0, 0, 1, 1, 1]}, index=idx, dtype=float)
    res = run_portfolio(p, w, GROSS, start=str(idx[0].date()), capital=100.0)
    # bought at day-3 open (120), so the +20% on day 2 is not captured
    assert res.weights["S0"].iloc[2] == 0
    assert res.equity.iloc[-1] < 101.0


def test_costs_reduce_returns():
    p = toy_panel()
    sig = rules.ema_cross(p)
    g = run_sleeves(p, sig, GROSS, start=str(DATES[50].date())).factor.prod()
    n = run_sleeves(p, sig, NET, start=str(DATES[50].date())).factor.prod()
    assert (n < g).all()


def test_walk_forward_never_trains_on_test_year():
    d = pd.Series(pd.bdate_range("2008-01-01", "2014-12-31"))
    td = d.shift(-1)
    for year, train, test in walk_forward_splits(d, td, 2010, 2014):
        ys = pd.Timestamp(f"{year}-01-01")
        assert td[train].max() < ys, "a training target uses a test-year price"
        assert d[train].max() < ys
        assert d[test].min() >= ys and d[test].max().year == year
        assert not (train & test).any()


def test_ml_predictions_are_out_of_sample():
    """On the real exported predictions: each prediction's fold must have ended before it."""
    import json
    from pipeline import config
    path = config.PROCESSED / "ml_folds.json"
    if not path.exists():
        pytest.skip("run the ML walk-forward first")
    folds = json.loads(path.read_text())["folds"]
    for f in folds:
        assert pd.Timestamp(f["train_end"]) < pd.Timestamp(f"{f['year']}-01-01")


def test_state_machine_is_causal():
    e = pd.DataFrame({"a": [False, True, False, False, False]})
    x = pd.DataFrame({"a": [False, False, False, True, False]})
    assert ind.state_machine(e, x)["a"].tolist() == [0, 1, 1, 0, 0]
