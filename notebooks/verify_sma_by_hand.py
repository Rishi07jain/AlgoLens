"""Build-order check #2: verify one SMA 50/200 crossover on one stock by hand.

A plain loop with cash and fractional shares (no vectorisation) is compared with the
vectorised sleeve engine. Run:  uv run python -m notebooks.verify_sma_by_hand
"""
from __future__ import annotations

import pandas as pd

from pipeline import config
from pipeline.backtest import cash_rate_daily, extract_trades, load_panel, run_sleeves
from pipeline.costs import NET

SYM = "RELIANCE"


def by_hand(o: pd.Series, c: pd.Series, sig: pd.Series) -> tuple[float, list]:
    cash, shares, trades = float(config.INITIAL_CAPITAL), 0.0, []
    dates = c.index
    start = dates.searchsorted(pd.Timestamp(config.BACKTEST_START))
    for i in range(start, len(dates)):
        want = sig.iloc[i - 1] == 1          # yesterday's close decides today's open
        px = o.iloc[i]
        if want and shares == 0:
            shares = cash / (px * (1 + NET.buy_rate))
            cash = 0.0
            trades.append(("BUY", dates[i].date(), round(px, 2)))
        elif not want and shares > 0:
            cash = shares * px * (1 - NET.sell_rate)
            shares = 0.0
            trades.append(("SELL", dates[i].date(), round(px, 2)))
        if shares == 0:
            cash *= 1 + cash_rate_daily()       # idle cash earns the risk-free rate
    return cash + shares * c.iloc[-1], trades


def main() -> None:
    p = load_panel()
    c, o = p.close[[SYM]], p.open[[SYM]]
    fast, slow = c.rolling(50).mean(), c.rolling(200).mean()
    sig = (fast > slow).astype(float).where(slow.notna(), 0.0)

    hand_final, hand_trades = by_hand(o[SYM], c[SYM], sig[SYM])
    res = run_sleeves(p.__class__(o, p.high[[SYM]], p.low[[SYM]], c, p.volume[[SYM]], p.tradable[[SYM]]), sig, NET)
    eng_final = float(res.sleeve_equity().iloc[-1, 0])
    tr = extract_trades(res.holdings, res.factor, o, config.INITIAL_CAPITAL)

    print(f"{SYM} SMA 50/200, {config.BACKTEST_START} -> {c.index[-1].date()}")
    print("First trades (by hand):", hand_trades[:6])
    print("First trades (engine): ", [(str(r.entry.date()), round(r.entry_px, 2)) for r in tr.head(3).itertuples()])
    print(f"Final equity by hand : Rs {hand_final:,.2f}")
    print(f"Final equity engine  : Rs {eng_final:,.2f}")
    diff = abs(hand_final - eng_final) / hand_final
    print(f"Relative difference  : {diff:.2e}  ->  {'MATCH' if diff < 1e-9 else 'MISMATCH'}")


if __name__ == "__main__":
    main()
