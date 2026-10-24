# AlgoLens

I got curious about algorithmic trading a while back. Every YouTube video and blog post seemed to have "the" strategy that beats the market: a moving-average crossover here, an RSI trick there, and lately a lot of machine-learning models that supposedly predict tomorrow's price. What bugged me was that almost all of them showed one stock, one time period, and returns before any costs. So I wanted to answer a simple question for myself:

**If you take the popular trading algorithms and run them all fairly on Indian stocks, which one actually makes the most money, and does it still hold up once you pay real brokerage, taxes and fees?**

That's what AlgoLens is. I took 44 Nifty 50 stocks, pulled their real daily prices from 2010 to October 2026, and ran 14 strategies plus two "do nothing" benchmarks (just buying and holding). Every strategy got the same ₹10 lakh, the same stocks, the same dates and the same Indian transaction costs, so nobody gets an unfair head start.

Along the way I also wanted to understand something I kept getting wrong in my head: a strategy that is *right* more often is not automatically the one that *makes* more money. So for every algorithm I measure both:

- **accuracy**: how often does the signal guess the direction correctly?
- **effectiveness**: after costs, how much money did it make for the risk it took?

![Findings page](docs/screenshots/findings.jpg)

## So, which algorithm won?

Short answer: a pretty boring one. A simple **EMA crossover** (buy when the 12-day average is above the 26-day average) had the best risk-adjusted return: about **20.8% a year after costs**, a Sharpe ratio of 1.00, and its worst fall was only 14%. Pairs trading and monthly momentum were close behind.

A few things genuinely surprised me:

- **Being right more often didn't mean making more money.** The RSI strategy wins about 70% of its trades but barely makes money, because its wins are small. The EMA crossover wins only 38% of the time, but its winners are about 3.5 times bigger than its losers.
- **The machine-learning models looked great until I added costs.** Before costs the random forest did about 17% a year. After costs it did 1.4%, because it was trading almost every day and each round trip costs around 0.32%. Its prediction accuracy was barely better than a coin flip.
- **Tuning parameters is a trap.** The settings that looked best on 2010–2019 data were never still the best after 2020.
- **Only 3 of the 14 strategies beat simply buying all the stocks and holding them.**

One honest caveat: I used today's Nifty 50 stocks, which are the winners by definition. That makes every stock-level number look better than real life, so it's fairer to compare the strategies with each other than with the index.

None of this is investment advice. It's a learning project.

## What's in the app

I built a small website on top of the results so you can poke around yourself:

- **Findings**: the main takeaways in a couple of minutes
- **Leaderboard**: every strategy ranked, sortable by return, Sharpe, drawdown and more
- **Deep dive**: one strategy at a time, with its growth over time, monthly returns, and a candlestick chart of any stock showing exactly where it bought and sold
- **Accuracy vs profit**: the "being right isn't the same as making money" story, with charts
- **Regime lab**: which strategies do well in rising, falling and choppy markets
- **Costs & robustness**: sliders to see what higher brokerage does, plus checks for overfitting
- **Compare & combine**: put strategies side by side, or mix them into one portfolio
- **Methodology**: where the data came from and every assumption I made

![Deep dive with candlesticks](docs/screenshots/deep-dive.jpg)

![Accuracy vs profit](docs/screenshots/accuracy.jpg)

## How it's built

The heavy lifting happens in Python: downloading prices (NSE, Yahoo Finance, and a Kaggle dataset as a cross-check), cleaning them, running the backtests and machine-learning models, and saving the results as JSON files. The website is React + TypeScript and just reads those files, so it's fast and can be hosted for free.

To avoid fooling myself, every trade happens at the next day's opening price (never using information from the future), the ML models are only ever trained on past years, and there are tests that check for both.

## Running it yourself

You'll need Python (with [uv](https://docs.astral.sh/uv/)) and Node with pnpm.

```bash
make setup     # install everything
make web       # open the app at http://localhost:5173
```

The results are already included, so that's enough to explore. If you want to download fresh data and rerun everything:

```bash
make data
make backtest
```

## Data

- Stock list and sectors: NSE's Nifty 50 constituent list
- Daily prices, the Nifty index and India VIX: Yahoo Finance (via yfinance)
- Cross-check: Kaggle's [Nifty 50 stock market data](https://www.kaggle.com/datasets/rohanrao/nifty50-stock-market-data)
- Trading costs: [Zerodha's published charges](https://zerodha.com/charges/)
