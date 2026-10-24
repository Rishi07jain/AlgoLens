"""Unit tests for metrics and the cost model (hand-computable inputs)."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from pipeline import config
from pipeline import metrics as M
from pipeline.costs import GROSS, NET, CostModel

IDX = pd.bdate_range("2015-01-01", periods=504)


def test_cagr_two_years_doubling():
    r = pd.Series((2 ** (1 / 504)) - 1, index=IDX)
    assert M.cagr(r) == pytest.approx(math.sqrt(2) - 1, rel=1e-9)


def test_sharpe_matches_formula():
    rng = np.random.default_rng(1)
    r = pd.Series(rng.normal(0.0005, 0.01, len(IDX)), index=IDX)
    expect = (r - M.RF_DAILY).mean() / r.std(ddof=1) * math.sqrt(252)
    assert M.sharpe(r) == pytest.approx(expect)


def test_max_drawdown_and_duration():
    r = pd.Series([0.1, -0.5, 0.0, 0.0, 1.0, 0.1], index=IDX[:6])
    mdd, days, peak, trough = M.max_drawdown_stats(r)
    assert mdd == pytest.approx(-0.5)
    assert days == 3        # underwater on days 2-4, recovered on day 5 (1.1 -> 0.55 -> 1.1)
    assert peak == str(IDX[0].date()) and trough == str(IDX[1].date())


def test_alpha_beta_of_levered_benchmark():
    rng = np.random.default_rng(2)
    b = pd.Series(rng.normal(0.0004, 0.01, len(IDX)), index=IDX)
    r = M.RF_DAILY + 2 * (b - M.RF_DAILY)
    a, beta = M.alpha_beta(r, b)
    assert beta == pytest.approx(2.0, rel=1e-6)
    assert a == pytest.approx(0.0, abs=1e-9)


def test_var_cvar():
    r = pd.Series(np.linspace(-0.1, 0.1, 101))
    v, cv = M.var_cvar(r, 0.05)
    assert v == pytest.approx(np.quantile(r, 0.05))
    assert cv <= v


def test_classification_counts():
    y = np.array([1, 1, 0, 0, 1], bool)
    yhat = np.array([1, 0, 1, 0, 1], bool)
    c = M.classification(y, yhat)
    assert c["confusion"] == {"tp": 2, "fp": 1, "fn": 1, "tn": 1}
    assert c["hit_rate"] == pytest.approx(2 / 3, abs=1e-6)
    assert c["recall"] == pytest.approx(2 / 3, abs=1e-6)
    assert c["accuracy"] == pytest.approx(0.6)


def test_trade_stats():
    t = pd.DataFrame({"ret": [0.1, -0.05, 0.2, -0.05], "pnl": [100.0, -50.0, 200.0, -50.0], "days": [5, 3, 8, 2]})
    s = M.trade_stats(t)
    assert s["win_rate"] == 0.5
    assert s["profit_factor"] == pytest.approx(3.0)
    assert s["payoff_ratio"] == pytest.approx(3.0)
    assert s["expectancy_inr"] == pytest.approx(50.0)


def test_rank_ic_perfect():
    s = pd.DataFrame(np.arange(50).reshape(10, 5), dtype=float)
    ic, _ = M.rank_ic(s, s * 2)
    assert ic == pytest.approx(1.0)


def test_deflated_sharpe_falls_with_more_trials():
    rng = np.random.default_rng(3)
    r = pd.Series(rng.normal(0.0008, 0.01, 2000))
    few = M.deflated_sharpe(r, rng.normal(0, 0.02, 5))["dsr"]
    many = M.deflated_sharpe(r, rng.normal(0, 0.02, 500))["dsr"]
    assert many < few


def test_cost_model_rates():
    # buy: STT 0.1% + txn 0.00307% + SEBI 0.0001% + GST 18% on (txn+SEBI) + stamp 0.015% + 5 bps
    gst = 0.18 * (0.0000307 + 0.000001)
    assert NET.buy_rate == pytest.approx(0.001 + 0.0000307 + 0.000001 + gst + 0.00015 + 0.0005)
    assert NET.sell_rate == pytest.approx(0.001 + 0.0000307 + 0.000001 + gst + 0.0005)
    assert GROSS.round_trip == 0
    assert CostModel(brokerage_pct=0.001).buy_rate == pytest.approx(NET.buy_rate + 0.001 * 1.18)


def test_risk_free_daily():
    assert (1 + M.RF_DAILY) ** config.TRADING_DAYS == pytest.approx(1 + config.RISK_FREE_ANNUAL)
