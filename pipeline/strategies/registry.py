"""The list of strategies AlgoLens evaluates, with fixed default parameters.

kind:
  sleeve    - per-stock 0/1 signal, one equal-capital sleeve per stock
  portfolio - target weights across the universe (one account)
  index     - trades the Nifty 50 index level (proxy for an index ETF)
"""
from __future__ import annotations

from dataclasses import dataclass, field

STRATEGIES: list[dict] = [
    # Trend following
    {"id": "sma_50_200", "name": "SMA crossover", "family": "Trend", "priority": "P0", "kind": "sleeve",
     "params": {"fast": 50, "slow": 200}, "logic": "Long when the 50-day SMA is above the 200-day SMA."},
    {"id": "ema_12_26", "name": "EMA crossover", "family": "Trend", "priority": "P0", "kind": "sleeve",
     "params": {"fast": 12, "slow": 26}, "logic": "Long when the 12-day EMA is above the 26-day EMA."},
    {"id": "macd_12_26_9", "name": "MACD signal", "family": "Trend", "priority": "P0", "kind": "sleeve",
     "params": {"fast": 12, "slow": 26, "signal": 9}, "logic": "Long while the MACD line is above its 9-day signal line."},
    {"id": "donchian_55_20", "name": "Donchian breakout", "family": "Trend", "priority": "P1", "kind": "sleeve",
     "params": {"entry": 55, "exit": 20}, "logic": "Buy a close above the prior 55-day high; exit on a close below the prior 20-day low."},
    {"id": "supertrend_10_3", "name": "Supertrend", "family": "Trend", "priority": "P1", "kind": "sleeve",
     "params": {"atr": 10, "mult": 3}, "logic": "Long while price is above the ATR(10) x 3 trailing Supertrend line."},
    # Mean reversion
    {"id": "rsi_14", "name": "RSI reversal", "family": "Mean reversion", "priority": "P0", "kind": "sleeve",
     "params": {"period": 14, "entry": 30, "exit": 55}, "logic": "Buy when RSI(14) < 30; exit when RSI > 55."},
    {"id": "bollinger_20_2", "name": "Bollinger reversion", "family": "Mean reversion", "priority": "P0", "kind": "sleeve",
     "params": {"window": 20, "k": 2}, "logic": "Buy a close below the lower 20-day, 2-sigma band; exit at the middle band."},
    {"id": "zscore_20", "name": "Z-score reversion", "family": "Mean reversion", "priority": "P1", "kind": "sleeve",
     "params": {"window": 20, "entry": -2, "exit": 0}, "logic": "Buy when price is 2 sigma below its 20-day mean; exit at the mean."},
    # Momentum
    {"id": "xs_momentum", "name": "Cross-sectional momentum", "family": "Momentum", "priority": "P0", "kind": "portfolio",
     "params": {"lookback_m": 12, "skip_m": 1, "top": 10}, "logic": "Each month end, hold the 10 stocks with the best 12-1 month return, equal weight."},
    {"id": "dual_momentum", "name": "Dual momentum (Nifty)", "family": "Momentum", "priority": "P1", "kind": "index",
     "params": {"lookback_m": 12}, "logic": "Hold the Nifty 50 when its 12-month return beats the risk-free rate; otherwise cash. Checked monthly."},
    # Statistical arbitrage
    {"id": "pairs", "name": "Pairs trading (long-only)", "family": "Stat-arb", "priority": "P1", "kind": "portfolio",
     "params": {"formation_days": 504, "pairs": 5, "entry_z": 2, "exit_z": 0},
     "logic": "Each year, pick 5 cointegrated same-sector pairs from the prior 2 years. Buy the cheap leg when the spread is beyond 2 sigma; exit at 0."},
    # Machine learning
    {"id": "logreg", "name": "Logistic regression", "family": "Machine learning", "priority": "P0", "kind": "sleeve",
     "params": {"C": 1.0, "threshold": 0.5, "retrain": "yearly, expanding window"},
     "logic": "Predict next-day up/down from 12 technical features; long when P(up) > 0.5."},
    {"id": "random_forest", "name": "Random forest", "family": "Machine learning", "priority": "P0", "kind": "sleeve",
     "params": {"trees": 200, "max_depth": 8, "threshold": 0.5, "retrain": "yearly, expanding window"},
     "logic": "Same features and target, non-linear trees; long when P(up) > 0.5."},
    {"id": "gbm", "name": "Gradient boosting", "family": "Machine learning", "priority": "P1", "kind": "sleeve",
     "params": {"impl": "scikit-learn HistGradientBoosting", "tuned": "per fold on last training year", "threshold": 0.5},
     "logic": "Gradient-boosted trees (stand-in for XGBoost); long when P(up) > 0.5."},
    # Benchmarks
    {"id": "buy_hold", "name": "Buy & hold (stocks)", "family": "Benchmark", "priority": "P0", "kind": "sleeve",
     "params": {}, "logic": "Buy every stock on day one with equal capital and hold."},
    {"id": "nifty_bh", "name": "Buy & hold (Nifty 50 index)", "family": "Benchmark", "priority": "P0", "kind": "index",
     "params": {}, "logic": "Hold the Nifty 50 price index (no dividends)."},
]

BY_ID = {s["id"]: s for s in STRATEGIES}
ML_IDS = ["logreg", "random_forest", "gbm"]


@dataclass
class GridSpec:
    strategy: str
    x: str
    y: str
    xs: list
    ys: list
    valid: callable = field(default=lambda a, b: True)


GRIDS = [
    GridSpec("sma_50_200", "fast", "slow", [10, 20, 50, 100], [100, 150, 200, 250], lambda a, b: a < b),
    GridSpec("ema_12_26", "fast", "slow", [5, 12, 20, 50], [26, 50, 100, 150], lambda a, b: a < b),
    GridSpec("rsi_14", "period", "entry", [7, 14, 21], [20, 25, 30, 35]),
    GridSpec("bollinger_20_2", "window", "k", [10, 20, 30, 50], [1.5, 2.0, 2.5, 3.0]),
    GridSpec("donchian_55_20", "entry", "exit", [20, 55, 100], [10, 20, 50], lambda a, b: b < a),
    GridSpec("xs_momentum", "lookback_m", "top", [3, 6, 9, 12], [5, 10, 15]),
]
