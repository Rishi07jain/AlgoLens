import { createChart, CrosshairMode, type IChartApi, type SeriesMarker, type Time } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { useTheme } from "../lib/theme";
import type { CompactTrade } from "../lib/types";

/** TradingView Lightweight Charts candlesticks with buy/sell markers at execution opens. */
export default function Candles({ ohlc, trades, height = 380 }: { ohlc: [string, number, number, number, number][]; trades: CompactTrade[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const { pal, mode } = useTheme();
  useEffect(() => {
    if (!el.current) return;
    const chart: IChartApi = createChart(el.current, {
      height,
      layout: { background: { color: pal.surface }, textColor: pal.muted, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" },
      grid: { vertLines: { color: pal.grid }, horzLines: { color: pal.grid } },
      rightPriceScale: { borderColor: pal.axis },
      timeScale: { borderColor: pal.axis },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: true,
    });
    const up = pal.series[0], down = pal.series[7];
    const s = chart.addCandlestickSeries({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
    s.setData(ohlc.map(([t, o, h, l, c]) => ({ time: t as Time, open: o, high: h, low: l, close: c })));
    const valid = new Set(ohlc.map((r) => r[0]));
    const markers: SeriesMarker<Time>[] = [];
    for (const [entry, exit, ret] of trades) {
      if (valid.has(entry)) markers.push({ time: entry as Time, position: "belowBar", color: up, shape: "arrowUp", text: "B" });
      if (exit && valid.has(exit)) markers.push({ time: exit as Time, position: "aboveBar", color: ret >= 0 ? pal.text2 : down, shape: "arrowDown", text: `S ${(ret * 100).toFixed(0)}%` });
    }
    markers.sort((a, b) => (String(a.time) < String(b.time) ? -1 : 1));
    s.setMarkers(markers);
    const last = ohlc.length;
    if (last > 500) chart.timeScale().setVisibleLogicalRange({ from: last - 500, to: last });
    return () => chart.remove();
  }, [ohlc, trades, pal, mode, height]);
  return <div ref={el} style={{ height }} aria-label="Candlestick price chart with trade markers" role="img" />;
}
