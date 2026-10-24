"""Engine checks on the real processed data (skipped if `make data` has not run)."""
from __future__ import annotations

import pytest

from pipeline import config

pytestmark = pytest.mark.skipif(not (config.PROCESSED / "prices.parquet").exists(), reason="run `make data` first")


def test_sma_crossover_matches_hand_calculation():
    from notebooks.verify_sma_by_hand import SYM, by_hand
    from pipeline.backtest import Panel, load_panel, run_sleeves
    from pipeline.costs import NET
    p = load_panel()
    c, o = p.close[[SYM]], p.open[[SYM]]
    sig = (c.rolling(50).mean() > c.rolling(200).mean()).astype(float).where(c.rolling(200).mean().notna(), 0.0)
    hand, _ = by_hand(o[SYM], c[SYM], sig[SYM])
    res = run_sleeves(Panel(o, p.high[[SYM]], p.low[[SYM]], c, p.volume[[SYM]], p.tradable[[SYM]]), sig, NET)
    assert float(res.sleeve_equity().iloc[-1, 0]) == pytest.approx(hand, rel=1e-9)


def test_universe_meets_history_rule():
    import pandas as pd
    u = pd.read_parquet(config.PROCESSED / "universe.parquet")
    assert u["in_universe"].sum() >= 40
    prices = pd.read_parquet(config.PROCESSED / "prices.parquet")
    assert prices["close"].gt(0).all()


def test_no_unexplained_jumps_in_universe():
    """After documented corporate-action fixes, no overnight gap beyond +/-45% remains."""
    import pandas as pd
    from pipeline.backtest import load_panel
    p = load_panel()
    gap = (p.open / p.close.shift(1) - 1).loc[config.BACKTEST_START:]
    assert gap.abs().max().max() < 0.45
