import type { ReactNode } from "react";
import { ChartCard, ErrorBox, Loading, PageHeader, useMeta } from "../components/ui";
import { downloadCSV } from "../lib/exporters";
import { pct } from "../lib/format";

function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <h2 className="font-semibold mb-2">{title}</h2>
      <div className="text-[14px] text-ink2 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

const METRICS: [string, string][] = [
  ["Directional hit rate", "Share of days the strategy was long that were followed by a higher close (precision of the 'up' call)."],
  ["Precision / recall / F1", "Precision = hit rate. Recall = share of all up days on which the strategy was long. F1 = their harmonic mean."],
  ["ROC-AUC", "ML only. Probability a random up-day gets a higher predicted P(up) than a random down-day. 0.5 = no skill."],
  ["Win rate", "Share of closed round-trip trades with a positive return after costs."],
  ["Information coefficient", "Mean cross-sectional rank correlation between signal strength and the next return (monthly for momentum, daily for ML)."],
  ["CAGR", "Compound annual growth rate of the ₹10 lakh account."],
  ["Sharpe", "Mean daily return above the risk-free rate ÷ daily volatility × √252."],
  ["Sortino", "As Sharpe, but divides by downside deviation only."],
  ["Calmar", "CAGR ÷ |max drawdown|."],
  ["Max drawdown & duration", "Worst peak-to-trough fall, and the longest run of trading days below a prior peak."],
  ["Profit factor", "Sum of winning trade P&L ÷ |sum of losing trade P&L|."],
  ["Expectancy", "Average ₹ P&L per trade (and average % return per trade)."],
  ["Alpha / beta", "OLS of daily excess returns on Nifty 50 excess returns; alpha annualised."],
  ["VaR / CVaR 95%", "5th percentile daily return, and the average return on days below it."],
  ["Turnover / exposure", "Traded value per year as a multiple of capital; average share of capital invested."],
  ["Bootstrap CI", "95% interval of Sharpe from 1,000 moving-block (21-day) resamples of daily returns."],
  ["Deflated Sharpe ratio", "Bailey & López de Prado (2014): probability the Sharpe exceeds the maximum expected from N trials, adjusting for skew and fat tails."],
];

export default function Methodology() {
  const meta = useMeta();
  if (!meta) return <Loading />;
  if (!meta.strategies) return <ErrorBox error="meta.json missing" />;
  const c = meta.costs.net;
  const dq = meta.data_quality.symbols;
  return (
    <div>
      <PageHeader title="Methodology & data" question="Where the numbers come from, what was assumed and what could make them wrong." />
      <div className="card p-4 mb-4 border-l-4" style={{ borderLeftColor: "var(--bad)" }}>
        <p className="text-[14px]"><strong>Educational project, not investment advice.</strong> AlgoLens shows how strategies would have behaved on historical data under stated assumptions.
          Backtests are not predictions; real trading adds taxes, liquidity limits, errors and behaviour that are not modelled. Nothing here is a recommendation to buy or sell any security.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 mb-4">
        <Sec title="Data sources (no synthetic data)">
          <ul className="list-disc ml-5 space-y-1">
            <li><b>Yahoo Finance via yfinance</b>: daily OHLCV and adjusted close for each <code>SYMBOL.NS</code>, the Nifty 50 index (<code>^NSEI</code>) and India VIX (<code>^INDIAVIX</code>), from 2007. Used for all backtests. Yahoo data is for personal and educational use under Yahoo's terms.</li>
            <li><b>NSE</b>: current Nifty 50 constituent list with industry (<a className="underline" href="https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv">ind_nifty50list.csv</a>). Used for the universe and sectors.</li>
            <li><b>Kaggle</b>: <a className="underline" href="https://www.kaggle.com/datasets/rohanrao/nifty50-stock-market-data">rohanrao/nifty50-stock-market-data</a> (NSE daily data 2000–2021). Used to cross-check Yahoo daily returns; see the dataset page for its licence.</li>
            <li><b>Risk-free rate</b>: a documented constant of {pct(meta.risk_free)} a year (about the average RBI 91-day T-bill yield over the period), used in Sharpe, Sortino, alpha and dual momentum, and earned by idle cash.</li>
          </ul>
          <p>Raw files are cached in <code>data/raw/</code> and never edited; cleaning is scripted (<code>pipeline/clean.py</code>). Data downloaded {meta.data_downloaded_at.slice(0, 10)}.</p>
        </Sec>
        <Sec title="Biases you should know about">
          <p><b>Survivorship bias.</b> The universe is today's Nifty 50 members with at least 10 years of history ({meta.universe.length} stocks). Stocks that left the index, or went bust, are missing,
            so every stock-level result looks better than reality. This is why stock buy-and-hold far outperforms the Nifty index here. Excluded for short history: {meta.excluded.map((e) => `${e.symbol} (${e.years}y)`).join(", ")}.</p>
          <p><b>Index benchmark.</b> <code>^NSEI</code> is a price index without dividends (about 1–1.5% a year), while stock prices are dividend-adjusted. Index strategies use the index level as if it were an ETF with no tracking error.</p>
          <p><b>Multiple testing.</b> {meta.strategies.length} strategies plus parameter grids were tested. The Costs & robustness page reports deflated Sharpe ratios that adjust for this.</p>
          <p><b>Regime tags</b> use a slow 200-day rule, and VIX terciles are computed over the whole period. They describe the past and are never used to trade.</p>
        </Sec>
        <Sec title="Fairness rules applied to every strategy">
          <ul className="list-disc ml-5 space-y-1">
            <li>Same universe, dates ({meta.start} to {meta.end}) and starting capital (₹{meta.capital.toLocaleString("en-IN")}).</li>
            <li><b>No look-ahead:</b> a signal computed at day t's close is executed at day t+1's open. Unit tests check that removing or changing future prices never changes a past signal.</li>
            <li>Long-only. Per-stock strategies give each stock an equal ₹ sleeve and sum the sleeves (no hidden rebalancing). A late-listed stock's sleeve waits in cash.</li>
            <li>Idle cash earns the risk-free rate, the same for every strategy.</li>
            <li>Same cost model and slippage for all; results are shown gross and net.</li>
            <li>In-sample 2010–2019, out-of-sample {meta.oos_start.slice(0, 4)} onward. Default parameters are the textbook values, fixed in advance.</li>
          </ul>
        </Sec>
        <Sec title={`Cost model (rates checked ${meta.costs.checked_on})`}>
          <table className="text-[13px] tnum w-full">
            <tbody>
              {[["Brokerage", `${(c.brokerage_pct * 100).toFixed(2)}% (discount broker default; slider on Costs page)`], ["STT", `${(c.stt_pct * 100).toFixed(2)}% on buy and sell`],
                ["NSE transaction charge", `${(c.exchange_txn_pct * 100).toFixed(5)}% of turnover`], ["SEBI turnover fee", "₹10 per crore (0.0001%)"],
                ["GST", `${(c.gst_rate * 100).toFixed(0)}% on brokerage + exchange + SEBI fees`], ["Stamp duty", `${(c.stamp_buy_pct * 100).toFixed(3)}% on buys`],
                ["Slippage", `${c.slippage_bps} bps per side (assumption)`], ["Total", `buy ${pct(c.buy_rate, 3)} · sell ${pct(c.sell_rate, 3)} · round trip ${pct(c.round_trip, 3)}`]].map(([k, v]) => (
                <tr key={k} className="border-t border-[var(--grid)]"><td className="py-1 pr-3 text-ink">{k}</td><td>{v}</td></tr>
              ))}
            </tbody>
          </table>
          <p>Sources: {meta.costs.sources.map((s, i) => <span key={s.url}>{i > 0 && " · "}<a className="underline" href={s.url}>{s.label}</a></span>)}. Depository (DP) charges of about ₹15 per sell are not modelled.</p>
        </Sec>
        <Sec title="Machine-learning protocol">
          <p>Pooled models across all stocks predict whether tomorrow's close is above today's. Features use only data known at today's close: {meta.ml.features.map((f) => f.label).join(", ")}.</p>
          <p>Expanding-window walk-forward: for each test year, train on every row whose target date is before 1 January of that year, then predict the whole year. Models are retrained yearly. Long when P(up) &gt; 0.5.
            Logistic regression (standardised), random forest (200 trees, depth 8) and gradient-boosted trees (scikit-learn HistGradientBoosting, tuned per fold on the last training year). XGBoost was planned but needs a system OpenMP library, so the scikit-learn booster stands in.</p>
        </Sec>
        <Sec title="Regimes">
          <p><b>Trend:</b> bull when the Nifty is above its 200-day SMA and that SMA is higher than 60 days earlier; bear when below a falling SMA; otherwise sideways.</p>
          <p><b>Volatility:</b> India VIX terciles over the backtest window. A day's strategy return is grouped by the regime known at the previous close.</p>
        </Sec>
      </div>

      <ChartCard className="mb-4" title="Metric definitions">
        <dl className="grid md:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
          {METRICS.map(([k, v]) => <div key={k}><dt className="font-medium">{k}</dt><dd className="text-ink2">{v}</dd></div>)}
        </dl>
      </ChartCard>

      <ChartCard className="mb-4" title="Corporate-action fixes applied by the cleaning script" meaning="Yahoo does not adjust prices for demergers and occasionally misplaces a bonus adjustment. Each fix below is listed in pipeline/corporate_actions.csv with its public source.">
        <div className="overflow-x-auto"><table className="text-[12px] w-full">
          <thead><tr className="text-left text-muted"><th className="pr-3">Stock</th><th className="pr-3">Date</th><th className="pr-3">Fix</th><th>Reason</th></tr></thead>
          <tbody>{meta.corporate_actions.map((a) => (
            <tr key={a.symbol + a.date} className="border-t border-[var(--grid)] align-top"><td className="py-1 pr-3 font-medium">{a.symbol}</td><td className="pr-3 whitespace-nowrap">{a.date}</td><td className="pr-3">{a.action}</td>
              <td>{a.note} {a.source && <a className="underline" href={a.source}>source</a>}</td></tr>
          ))}</tbody>
        </table></div>
      </ChartCard>

      <ChartCard title="Data-quality report" meaning={`Calendar ${meta.data_quality.calendar.first} to ${meta.data_quality.calendar.last} (${meta.data_quality.calendar.days} trading days). India VIX from ${meta.data_quality.vix_first}. "Kaggle median diff" compares daily returns with the independent Kaggle NSE file for 2010–2021; 0 bps means they agree on a typical day (differences appear only on split and dividend dates, which Kaggle does not adjust).`}
        actions={<button className="chip" onClick={() => downloadCSV("algolens_data_quality.csv", [["symbol", "rows", "first", "last", "years", "missing_days", "zero_volume_days", "in_universe", "kaggle_corr", "kaggle_median_diff_bps", "fixes"],
          ...dq.map((d) => [d.symbol, d.rows, d.first, d.last, d.years, d.missing_days, d.zero_volume_days, d.in_universe ? "yes" : "no", d.kaggle_check?.corr, d.kaggle_check?.median_abs_diff_bps, d.fixes.join("; ")])])}>CSV</button>}>
        <div className="overflow-auto max-h-[480px]"><table className="text-[12px] tnum w-full">
          <thead className="sticky top-0 bg-surface"><tr className="text-left text-muted">{["Symbol", "Rows", "First", "Last", "Years", "Missing", "Zero-vol", "In universe", "Kaggle median diff", "Fixes"].map((h) => <th key={h} className="pr-3 py-1 font-normal">{h}</th>)}</tr></thead>
          <tbody>{dq.map((d) => (
            <tr key={d.symbol} className="border-t border-[var(--grid)]"><td className="pr-3 py-1 font-medium">{d.symbol}</td><td className="pr-3">{d.rows}</td><td className="pr-3">{d.first}</td><td className="pr-3">{d.last}</td><td className="pr-3">{d.years}</td>
              <td className="pr-3">{d.missing_days}</td><td className="pr-3">{d.zero_volume_days}</td><td className="pr-3">{d.in_universe ? "yes" : "no"}</td>
              <td className="pr-3">{d.kaggle_check ? `${d.kaggle_check.median_abs_diff_bps} bps` : "–"}</td><td className="text-ink2">{d.fixes.join("; ")}</td></tr>
          ))}</tbody>
        </table></div>
      </ChartCard>
    </div>
  );
}
