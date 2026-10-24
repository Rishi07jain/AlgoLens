"""Indian equity-delivery cost model, applied identically to every strategy.

Rates checked on 25 Oct 2026 against Zerodha's published charge sheet
(https://zerodha.com/charges/, "Equity delivery" column):
  * Brokerage            Rs 0 (discount broker; configurable as % of trade value)
  * STT                  0.1% on buy and sell
  * NSE transaction fee  0.00307% of turnover
  * SEBI turnover fee    Rs 10 per crore = 0.0001%
  * GST                  18% on (brokerage + SEBI fee + transaction charges)
  * Stamp duty           0.015% on the buy side only
  * Slippage             5 bps per side (assumption)
Depository (DP) charges per sell (about Rs 15 per scrip) are not modelled; at a
Rs 10 lakh account they are under 0.01% per trade.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class CostModel:
    brokerage_pct: float = 0.0
    stt_pct: float = 0.001
    exchange_txn_pct: float = 0.0000307
    sebi_pct: float = 0.000001
    gst_rate: float = 0.18
    stamp_buy_pct: float = 0.00015
    slippage_bps: float = 5.0

    @property
    def _gst(self) -> float:
        return self.gst_rate * (self.brokerage_pct + self.exchange_txn_pct + self.sebi_pct)

    @property
    def buy_rate(self) -> float:
        return (self.brokerage_pct + self.stt_pct + self.exchange_txn_pct + self.sebi_pct
                + self._gst + self.stamp_buy_pct + self.slippage_bps / 1e4)

    @property
    def sell_rate(self) -> float:
        return (self.brokerage_pct + self.stt_pct + self.exchange_txn_pct + self.sebi_pct
                + self._gst + self.slippage_bps / 1e4)

    @property
    def round_trip(self) -> float:
        return self.buy_rate + self.sell_rate

    def describe(self) -> dict:
        d = asdict(self)
        d.update(buy_rate=self.buy_rate, sell_rate=self.sell_rate, round_trip=self.round_trip)
        return d


NET = CostModel()
GROSS = CostModel(stt_pct=0.0, exchange_txn_pct=0.0, sebi_pct=0.0, gst_rate=0.0,
                  stamp_buy_pct=0.0, slippage_bps=0.0)

SOURCES = [
    {"label": "Zerodha charges (equity delivery)", "url": "https://zerodha.com/charges/"},
    {"label": "NSE transaction charges", "url": "https://www.nseindia.com/trade/platform-services-transaction-charges"},
    {"label": "SEBI fees", "url": "https://www.sebi.gov.in/"},
]
