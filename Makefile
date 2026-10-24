# AlgoLens: real Nifty 50 data -> backtests -> JSON -> React app
.PHONY: setup data ml backtest test web build verify all clean

setup:            ## install Python (uv) and web (pnpm) dependencies
	uv sync
	cd web && pnpm install

data:             ## download raw data (NSE, Yahoo, Kaggle) and clean it; prints a data-quality report
	uv run python -m pipeline.ingest
	uv run python -m pipeline.clean

ml:               ## expanding-window walk-forward for the ML models (~2-3 min)
	uv run python -m pipeline.ml.walkforward

backtest: ml      ## run every strategy and export web/public/results/*.json
	uv run python -m pipeline.export

verify:           ## hand-check one SMA crossover against the engine
	uv run python -m notebooks.verify_sma_by_hand

test:             ## look-ahead, metric and engine tests
	uv run pytest -q

web:              ## start the React app at http://localhost:5173
	cd web && pnpm dev

build:            ## production build of the web app (web/dist)
	cd web && pnpm build

all: data backtest test build

clean:
	rm -rf data/processed web/dist web/public/results
