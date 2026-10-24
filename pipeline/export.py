"""Run every strategy, compute all metrics and write web/public/results/*.json.

Run:  uv run python -m pipeline.export
"""
from __future__ import annotations

import json
import math
import shutil
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, roc_curve

from pipeline import config
from pipeline import metrics as M
from pipeline.costs import GROSS, NET, SOURCES as COST_SOURCES, CostModel
from pipeline.evaluate import Context, Run, default_runs, next_day_up
from pipeline.findings import build_findings
from pipeline.ml.features import FEATURE_LABELS, FEATURES
from pipeline.regimes import tag_regimes
from pipeline.strategies.portfolio import momentum_scores, month_end_flags
from pipeline.strategies.registry import BY_ID, GRIDS, ML_IDS, STRATEGIES

OUT = config.RESULTS
PERIODS = {
    "full": (config.BACKTEST_START, None),
    "is": (config.BACKTEST_START, config.IS_END),
    "oos": (config.OOS_START, None),
}


# ---------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------
def sanitize(o):
    if isinstance(o, dict):
        return {str(k): sanitize(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [sanitize(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return None if not math.isfinite(f) else f
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, pd.Timestamp):
        return str(o.date())
    return o


def write(name: str, obj) -> int:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(sanitize(obj), separators=(",", ":"), allow_nan=False)
    path.write_text(txt)
    return len(txt)


def stock_slug(sym: str) -> str:
    """File-safe name for a symbol (M&M -> M_M); the web app uses the same rule."""
    return "".join(ch if ch.isalnum() or ch == "-" else "_" for ch in sym)


def r4(x, nd=4):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def slice_period(s, period: str):
    a, b = PERIODS[period]
    s = s.loc[pd.Timestamp(a):]
    return s.loc[:pd.Timestamp(b)] if b else s


def weekly_last(s: pd.Series) -> pd.Series:
    return s.groupby(s.index.to_period("W-FRI")).tail(1)


def monthly_last(s: pd.Series) -> pd.Series:
    return s.groupby(s.index.to_period("M")).tail(1)


def equity_from(r: pd.Series, capital: float = config.INITIAL_CAPITAL) -> pd.Series:
    return (1 + r).cumprod() * capital


# ---------------------------------------------------------------------------------------
# accuracy
# ---------------------------------------------------------------------------------------
class Truth:
    def __init__(self, ctx: Context):
        self.up = next_day_up(ctx.p)
        self.idx_up = next_day_up(ctx.idx)
        self.tradable = ctx.p.tradable
        self.fwd = ctx.p.close.shift(-1) / ctx.p.close - 1


def accuracy(run: Run, truth: Truth, period: str) -> dict:
    sig = run.signal
    if sig is None:
        return {}
    up = truth.idx_up if run.kind == "index" else truth.up
    sig = slice_period(sig, period)
    up = up.reindex(sig.index)
    mask = up.notna()
    if run.kind != "index":
        mask &= truth.tradable.reindex(sig.index).fillna(False)
    y = up.where(mask).stack().astype(bool)
    yhat = (sig.where(mask) > 0).stack().reindex(y.index).fillna(False)
    return M.classification(y.to_numpy(), yhat.to_numpy())


def information_coefficient(sid: str, ctx: Context, truth: Truth, period: str):
    if sid == "xs_momentum":
        score = momentum_scores(ctx.p, 12, 1)
        me = month_end_flags(ctx.p.close.index)
        c = ctx.p.close[me.to_numpy()]
        fwd = c.shift(-1) / c - 1
        sc = score[me.to_numpy()]
        return M.rank_ic(slice_period(sc, period), slice_period(fwd, period))
    if sid in ML_IDS and ctx.ml is not None:
        w = ctx.ml.pivot(index="date", columns="symbol", values=f"p_{sid}")
        f = truth.fwd.reindex(index=w.index, columns=w.columns)
        return M.rank_ic(slice_period(w, period), slice_period(f, period))
    return None, None


# ---------------------------------------------------------------------------------------
# metrics for a run over a period
# ---------------------------------------------------------------------------------------
def run_metrics(run: Run, ctx: Context, truth: Truth, period: str, with_acc: bool = True) -> dict:
    r = slice_period(run.returns, period)
    expo = slice_period(run.exposure, period)
    turn = slice_period(run.turnover_daily, period)
    years = len(r) / config.TRADING_DAYS
    tr = run.trades
    if len(tr):
        a, b = PERIODS[period]
        m = tr["entry"] >= pd.Timestamp(a)
        if b:
            m &= tr["entry"] <= pd.Timestamp(b)
        tr = tr[m]
    out = M.effectiveness(r, ctx.nifty_ret, expo, float(turn.sum() / years) if years else None, tr, run.n_sleeves)
    if with_acc:
        acc = accuracy(run, truth, period)
        out.update({k: acc.get(k) for k in ("hit_rate", "accuracy", "precision", "recall", "f1", "base_rate")})
        out["confusion"] = acc.get("confusion")
        ic, ic_t = information_coefficient(run.sid, ctx, truth, period)
        out["ic"], out["ic_t"] = ic, ic_t
        if run.sid in ML_IDS and ctx.ml is not None:
            pr = slice_period(ctx.ml.set_index("date"), period)
            out["auc"] = r4(roc_auc_score(pr["target"], pr[f"p_{run.sid}"]))
    return out


# ---------------------------------------------------------------------------------------
# main export
# ---------------------------------------------------------------------------------------
def main() -> None:
    t0 = time.time()
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    ctx = Context()
    truth = Truth(ctx)
    print("Running strategies (net + gross) ...")
    net = default_runs(ctx, NET)
    gross = {sid: ctx.run(sid, GROSS) for sid in net}
    sids = list(net)
    active = [s for s in sids if BY_ID[s]["family"] != "Benchmark"]
    dates = net[sids[0]].returns.index
    print(f"  done in {time.time() - t0:.0f}s")

    # ---------------- leaderboard ----------------
    lb = {p: {"net": {}, "gross": {}} for p in PERIODS}
    for sid in sids:
        for p in PERIODS:
            lb[p]["net"][sid] = run_metrics(net[sid], ctx, truth, p)
            lb[p]["gross"][sid] = run_metrics(gross[sid], ctx, truth, p, with_acc=False)
            for k in ("hit_rate", "accuracy", "precision", "recall", "f1", "base_rate", "confusion", "ic", "ic_t", "auc"):
                if k in lb[p]["net"][sid]:
                    lb[p]["gross"][sid][k] = lb[p]["net"][sid][k]
    spark = {}
    for sid in sids:
        eq = monthly_last(equity_from(net[sid].returns, 1.0))
        spark[sid] = [r4(v, 4) for v in eq.to_numpy()]
    write("leaderboard.json", {"periods": PERIODS, "metrics": lb, "sparklines": spark,
                               "spark_dates": [str(d.date()) for d in monthly_last(net[sids[0]].returns).index]})
    print(f"  leaderboard ({time.time() - t0:.0f}s)")

    # ---------------- sectors ----------------
    sec_counts = ctx.universe["sector"].value_counts()
    sectors = [s for s, n in sec_counts.items() if n >= 3]
    sec_out = {"sectors": {s: int(sec_counts[s]) for s in sectors}, "metrics": {}}
    keep = ("cagr", "sharpe", "sortino", "max_dd", "calmar", "vol", "exposure", "total_return", "alpha", "beta")
    for sec in sectors:
        cols = [c for c in ctx.p.symbols if ctx.sectors.get(c) == sec]
        sec_out["metrics"][sec] = {p: {"net": {}, "gross": {}} for p in PERIODS}
        for sid in sids:
            if BY_ID[sid]["kind"] != "sleeve":
                continue
            for cost, runs in (("net", net), ("gross", gross)):
                f = runs[sid].sleeve_factor[cols]
                eq = f.cumprod().sum(axis=1)
                r = eq.pct_change().fillna(0.0)
                for p in PERIODS:
                    m = M.effectiveness(slice_period(r, p), ctx.nifty_ret)
                    sec_out["metrics"][sec][p][cost][sid] = {k: m[k] for k in keep}
    write("sectors.json", sec_out)

    # ---------------- equity / per-strategy deep dive ----------------
    nifty_eq = equity_from(ctx.nifty_ret)
    wk_idx = weekly_last(nifty_eq).index
    for sid in sids:
        rn, rg = net[sid].returns, gross[sid].returns
        en, eg = equity_from(rn), equity_from(rg)
        dd = M.drawdown(rn)
        tr = net[sid].trades
        best = worst = []
        hist = None
        if len(tr):
            t2 = tr.copy()
            t2["entry"] = t2["entry"].astype(str).str[:10]
            t2["exit"] = t2["exit"].astype(str).str[:10].where(t2["exit"].notna(), None)
            cols = ["symbol", "entry", "exit", "entry_px", "exit_px", "ret", "pnl", "days", "open"]
            best = t2.nlargest(15, "ret")[cols].to_dict("records")
            worst = t2.nsmallest(15, "ret")[cols].to_dict("records")
            edges = np.linspace(-0.3, 0.3, 25)
            h, _ = np.histogram(tr["ret"].clip(-0.3, 0.3), bins=edges)
            hist = {"edges": [r4(e) for e in edges], "counts": h.tolist()}
        extra = {}
        if sid == "pairs":
            extra["pairs_chosen"] = ctx.pairs_chosen
        if sid == "xs_momentum":
            w = net[sid].extra["weights"]
            last = w.iloc[-1]
            extra["current_holdings"] = [{"symbol": s, "weight": r4(v)} for s, v in last[last > 0.001].sort_values(ascending=False).items()]
            held = (w > 0.001).sum()
            extra["months_held"] = {s: int(v) for s, v in (held / 21).round().sort_values(ascending=False).head(15).items()}
        write(f"strategies/{sid}.json", {
            "id": sid,
            "dates": [str(d.date()) for d in wk_idx],
            "equity_net": [r4(v, 0) for v in en.reindex(wk_idx).to_numpy()],
            "equity_gross": [r4(v, 0) for v in eg.reindex(wk_idx).to_numpy()],
            "benchmark": [r4(v, 0) for v in nifty_eq.reindex(wk_idx).to_numpy()],
            "drawdown": [r4(v) for v in dd.groupby(dd.index.to_period("W-FRI")).min().to_numpy()],
            "exposure": [r4(v, 3) for v in net[sid].exposure.groupby(net[sid].exposure.index.to_period("W-FRI")).mean().to_numpy()],
            "monthly": M.monthly_returns(rn),
            "yearly": M.yearly_returns(rn),
            "best_trades": best, "worst_trades": worst, "trade_hist": hist,
            **extra,
        })
    print(f"  strategy files ({time.time() - t0:.0f}s)")

    # ---------------- per-stock files ----------------
    sleeve_ids = [s for s in sids if BY_ID[s]["kind"] == "sleeve"]
    port_ids = [s for s in sids if BY_ID[s]["kind"] == "portfolio"]
    stock_points = []
    up_all = truth.up
    for sym in ctx.p.symbols:
        o, h, l, c = (getattr(ctx.p, k)[sym].loc[config.BACKTEST_START:] for k in ("open", "high", "low", "close"))
        ok = c.notna() & o.notna()
        ohlc = [[str(d.date()), round(float(o[d]), 2), round(float(h[d]), 2), round(float(l[d]), 2), round(float(c[d]), 2)]
                for d in c.index[ok.to_numpy()]]
        first_live = c.index[ok.to_numpy()][0]
        st = {}
        for sid in sleeve_ids:
            fn = net[sid].sleeve_factor[sym].loc[first_live:]
            fg = gross[sid].sleeve_factor[sym].loc[first_live:]
            rn, rg = fn - 1, fg - 1
            hold = net[sid].sleeve_holdings[sym].loc[first_live:]
            tr = net[sid].trades
            tr = tr[tr["symbol"] == sym].copy() if len(tr) else tr
            # per-stock trades use the full Rs 10 lakh on this one stock
            if len(tr):
                scale = config.INITIAL_CAPITAL / (config.INITIAL_CAPITAL / net[sid].n_sleeves)
                tr["pnl"] = tr["pnl"] * scale
            mn = M.effectiveness(rn, ctx.nifty_ret, hold, None, tr if len(tr) else None, 1)
            mg = M.effectiveness(rg, ctx.nifty_ret)
            sig = net[sid].signal[sym].loc[first_live:]
            upj = up_all[sym].reindex(sig.index)
            m = upj.notna() & truth.tradable[sym].reindex(sig.index)
            acc = M.classification(upj[m].astype(bool).to_numpy(), (sig[m] > 0).to_numpy())
            wk = weekly_last((1 + rn).cumprod() * config.INITIAL_CAPITAL)
            trades_c = [[str(t.entry.date()), str(t.exit.date()) if t.exit is not None and not pd.isna(t.exit) else None,
                         r4(t.ret), r4(t.pnl, 0), int(t.days)] for t in tr.itertuples()] if len(tr) else []
            st[sid] = {
                "equity": [r4(v, 0) for v in wk.to_numpy()],
                "metrics": {k: mn[k] for k in ("cagr", "sharpe", "sortino", "max_dd", "max_dd_days", "calmar", "vol", "alpha",
                                                "beta", "exposure", "n_trades", "win_rate", "profit_factor", "payoff_ratio",
                                                "expectancy_inr", "expectancy_pct", "avg_hold_days", "trades_per_year",
                                                "var95", "cvar95", "total_return")},
                "gross": {k: mg[k] for k in ("cagr", "sharpe", "total_return")},
                "accuracy": {k: acc[k] for k in ("hit_rate", "accuracy", "precision", "recall", "f1", "base_rate")},
                "trades": trades_c,
            }
            stock_points.append({"sid": sid, "symbol": sym, "sector": ctx.sectors.get(sym),
                                 "hit_rate": acc["hit_rate"], "base_rate": acc["base_rate"], "sharpe": mn["sharpe"],
                                 "cagr": mn["cagr"], "win_rate": mn["win_rate"], "payoff": mn["payoff_ratio"],
                                 "n_trades": mn["n_trades"], "gross_sharpe": mg["sharpe"]})
        for sid in port_ids:
            tr = net[sid].trades
            tr = tr[tr["symbol"] == sym] if len(tr) else tr
            st[sid] = {"trades": [[str(t.entry.date()), str(t.exit.date()) if t.exit is not None and not pd.isna(t.exit) else None,
                                   r4(t.ret), r4(t.pnl, 0), int(t.days)] for t in tr.itertuples()] if len(tr) else []}
        wk_dates = weekly_last(c.loc[first_live:]).index
        write(f"stocks/{stock_slug(sym)}.json", {
            "symbol": sym, "name": ctx.universe.loc[sym, "name"], "sector": ctx.sectors.get(sym),
            "ohlc": ohlc, "weekly_dates": [str(d.date()) for d in wk_dates], "strategies": st,
        })
    print(f"  stock files ({time.time() - t0:.0f}s)")

    # ---------------- accuracy vs effectiveness ----------------
    acc_out = {"points": stock_points, "universe": {}, "ml": {}}
    for sid in sids:
        m = lb["full"]["net"][sid]
        acc_out["universe"][sid] = {k: m.get(k) for k in ("hit_rate", "accuracy", "precision", "recall", "f1", "base_rate",
                                                          "win_rate", "payoff_ratio", "profit_factor", "sharpe", "cagr",
                                                          "confusion", "ic", "ic_t", "auc", "n_trades", "expectancy_pct")}
    if ctx.ml is not None:
        folds = json.loads((config.PROCESSED / "ml_folds.json").read_text())
        for sid in ML_IDS:
            P = ctx.ml
            fpr, tpr, _ = roc_curve(P["target"], P[f"p_{sid}"])
            pick = np.unique(np.linspace(0, len(fpr) - 1, 80).astype(int))
            prob = P[f"p_{sid}"]
            bins = np.linspace(0.3, 0.7, 21)
            hcount, _ = np.histogram(prob.clip(0.3, 0.7), bins=bins)
            dec = pd.qcut(prob, 10, labels=False, duplicates="drop")
            by_dec = P.groupby(dec).agg(p=(f"p_{sid}", "mean"), up=("target", "mean"), ret=("fwd_ret", "mean"))
            acc_out["ml"][sid] = {
                "roc": [[r4(fpr[i]), r4(tpr[i])] for i in pick],
                "auc": r4(roc_auc_score(P["target"], prob)),
                "auc_by_year": [{"year": f["year"], "auc": f.get(f"auc_{sid}")} for f in folds["folds"]],
                "prob_hist": {"edges": [r4(b) for b in bins], "counts": hcount.tolist()},
                "deciles": [{"decile": int(i) + 1, "p": r4(r.p), "up_rate": r4(r.up), "avg_ret": r4(r.ret, 6)} for i, r in by_dec.iterrows()],
                "share_long": r4(float((prob > 0.5).mean())),
            }
        imp = {}
        for key in ("random_forest", "logreg"):
            df = pd.DataFrame(folds["importances"][key]).drop(columns="year")
            v = df.mean() if key == "random_forest" else df.abs().mean()
            imp[key] = [{"feature": f, "label": FEATURE_LABELS[f], "value": r4(float(v[f]), 5)} for f in v.sort_values(ascending=False).index]
        acc_out["feature_importance"] = imp
        acc_out["folds"] = folds["folds"]
    pts = pd.DataFrame(stock_points)
    rule_pts = pts[~pts["sid"].isin(["buy_hold"])].dropna(subset=["hit_rate", "sharpe"])
    acc_out["hit_vs_sharpe"] = {
        "spearman": r4(float(rule_pts["hit_rate"].corr(rule_pts["sharpe"], method="spearman"))),
        "pearson": r4(float(rule_pts["hit_rate"].corr(rule_pts["sharpe"]))),
        "n": int(len(rule_pts)),
    }
    write("accuracy.json", acc_out)
    print(f"  accuracy ({time.time() - t0:.0f}s)")

    # ---------------- regimes ----------------
    reg = tag_regimes()
    rw = reg.loc[config.BACKTEST_START:]
    tag_prev = reg.shift(1).reindex(dates)
    reg_out = {"vix_terciles": reg.attrs["vix_terciles"], "counts": {}, "sharpe": {}, "ann_return": {}, "combo": {}}
    for col in ("trend", "vol"):
        reg_out["counts"][col] = {k: int(v) for k, v in tag_prev[col].value_counts().items()}
    for sid in sids:
        r = net[sid].returns
        reg_out["sharpe"][sid] = {}
        reg_out["ann_return"][sid] = {}
        for col in ("trend", "vol"):
            for k, g in r.groupby(tag_prev[col]):
                reg_out["sharpe"][sid][k] = r4(M.sharpe(g))
                reg_out["ann_return"][sid][k] = r4(float((1 + g).prod() ** (config.TRADING_DAYS / len(g)) - 1))
        combo = {}
        for (t, v), g in r.groupby([tag_prev["trend"], tag_prev["vol"]]):
            if len(g) >= 40:
                combo[f"{t}|{v}"] = {"sharpe": r4(M.sharpe(g)), "ann_return": r4(float((1 + g).prod() ** (config.TRADING_DAYS / len(g)) - 1)), "days": int(len(g))}
        reg_out["combo"][sid] = combo
    combo_counts = tag_prev.groupby(["trend", "vol"]).size()
    reg_out["combo_counts"] = {f"{t}|{v}": int(n) for (t, v), n in combo_counts.items()}
    wk = weekly_last(rw["close"]).index
    reg_out["nifty"] = [{"d": str(d.date()), "c": r4(rw.at[d, "close"], 2), "sma": r4(rw.at[d, "sma200"], 2),
                         "vix": r4(rw.at[d, "vix"], 2), "t": rw.at[d, "trend"], "v": rw.at[d, "vol"]} for d in wk]
    write("regimes.json", reg_out)
    print(f"  regimes ({time.time() - t0:.0f}s)")

    # ---------------- robustness ----------------
    rob = {"cost_grid": {}, "param_grids": [], "yearly": {}, "bootstrap": {}, "deflated": {}, "cost_drag": {}}
    slips = [0, 5, 10, 20, 30]
    broks = [0.0, 0.0003, 0.001, 0.003]
    rob["cost_axes"] = {"slippage_bps": slips, "brokerage_pct": broks}
    for sid in sids:
        rows = []
        for b in broks:
            row = []
            for s in slips:
                cm = CostModel(brokerage_pct=b, slippage_bps=s)
                r = ctx.run(sid, cm, with_trades=False).returns
                row.append({"cagr": r4(M.cagr(r)), "sharpe": r4(M.sharpe(r))})
            rows.append(row)
        rob["cost_grid"][sid] = rows
        g, n = lb["full"]["gross"][sid], lb["full"]["net"][sid]
        rob["cost_drag"][sid] = {"gross_cagr": g["cagr"], "net_cagr": n["cagr"], "gross_sharpe": g["sharpe"],
                                 "net_sharpe": n["sharpe"], "turnover": n["turnover"],
                                 "annual_cost": r4(float(slice_period(net[sid].returns, "full").sub(slice_period(gross[sid].returns, "full")).mean() * -config.TRADING_DAYS))}
    print(f"  cost grid ({time.time() - t0:.0f}s)")
    trial_sr = []
    for sid in active:
        r = net[sid].returns
        trial_sr.append(float((r.mean() - M.RF_DAILY) / r.std(ddof=1)))
    for gspec in GRIDS:
        cells = []
        for xv in gspec.xs:
            for yv in gspec.ys:
                if not gspec.valid(xv, yv):
                    continue
                params = {gspec.x: xv, gspec.y: yv}
                r = ctx.run(gspec.strategy, NET, with_trades=False, **params).returns
                is_r, oos_r = slice_period(r, "is"), slice_period(r, "oos")
                default = all(BY_ID[gspec.strategy]["params"].get(k) == v for k, v in params.items())
                cells.append({"x": xv, "y": yv, "sharpe": r4(M.sharpe(r)), "cagr": r4(M.cagr(r)),
                              "sharpe_is": r4(M.sharpe(is_r)), "sharpe_oos": r4(M.sharpe(oos_r)), "default": default})
                if not default:
                    trial_sr.append(float((r.mean() - M.RF_DAILY) / r.std(ddof=1)))
        best_is = max(cells, key=lambda c: c["sharpe_is"] if c["sharpe_is"] is not None else -9)
        oos_sorted = sorted([c["sharpe_oos"] for c in cells if c["sharpe_oos"] is not None], reverse=True)
        dflt = next(c for c in cells if c["default"])
        rob["param_grids"].append({
            "strategy": gspec.strategy, "x": gspec.x, "y": gspec.y, "xs": gspec.xs, "ys": gspec.ys, "cells": cells,
            "best_is": {"x": best_is["x"], "y": best_is["y"], "sharpe_is": best_is["sharpe_is"], "sharpe_oos": best_is["sharpe_oos"],
                        "oos_rank": oos_sorted.index(best_is["sharpe_oos"]) + 1 if best_is["sharpe_oos"] in oos_sorted else None,
                        "n_cells": len(cells)},
            "default": {"sharpe_is": dflt["sharpe_is"], "sharpe_oos": dflt["sharpe_oos"]},
            "share_positive_oos": r4(float(np.mean([c["sharpe_oos"] > 0 for c in cells if c["sharpe_oos"] is not None]))),
        })
    print(f"  param grids ({time.time() - t0:.0f}s)")
    trial_sr = np.array(trial_sr)
    for sid in sids:
        r = net[sid].returns
        lo, hi = M.bootstrap_sharpe_ci(r)
        rob["bootstrap"][sid] = {"sharpe": r4(M.sharpe(r)), "lo": r4(lo), "hi": r4(hi)}
        rob["deflated"][sid] = M.deflated_sharpe(r, trial_sr)
        rob["yearly"][sid] = M.yearly_returns(r)
    rob["n_trials"] = int(len(trial_sr))
    write("robustness.json", rob)
    print(f"  robustness ({time.time() - t0:.0f}s)")

    # ---------------- compare & combine ----------------
    R = pd.DataFrame({sid: net[sid].returns for sid in sids})
    corr = R.corr()
    ew = R[active].mean(axis=1)
    rule_ids = [s for s in active if s not in ML_IDS]
    ew_rules = R[rule_ids].mean(axis=1)
    wk_eq = {sid: [r4(v, 4) for v in weekly_last(equity_from(R[sid], 1.0)).to_numpy()] for sid in sids}
    combos = {
        "ew_all": {"label": f"Equal weight, all {len(active)} strategies", "members": active,
                   "metrics": M.effectiveness(ew, ctx.nifty_ret),
                   "equity": [r4(v, 4) for v in weekly_last(equity_from(ew, 1.0)).to_numpy()]},
        "ew_rules": {"label": "Equal weight, rule-based only (no ML)", "members": rule_ids,
                     "metrics": M.effectiveness(ew_rules, ctx.nifty_ret),
                     "equity": [r4(v, 4) for v in weekly_last(equity_from(ew_rules, 1.0)).to_numpy()]},
    }
    write("compare.json", {"ids": sids, "corr": [[r4(corr.at[a, b], 3) for b in sids] for a in sids],
                           "dates": [str(d.date()) for d in weekly_last(R[sids[0]]).index],
                           "equity": wk_eq, "combos": combos})

    # ---------------- meta ----------------
    dq = json.loads((config.PROCESSED / "data_quality.json").read_text())
    manifest = json.loads((config.RAW / "manifest.json").read_text())
    ca = pd.read_csv(config.ROOT / "pipeline" / "corporate_actions.csv").fillna("").to_dict("records")
    strategies = []
    for s in STRATEGIES:
        if s["id"] not in sids:
            continue
        d = dict(s)
        if s["id"] == "zscore_20":
            d["note"] = ("Mathematically the same rule as Bollinger reversion (20, 2-sigma, exit at the mean), so results "
                         "are identical. Kept to show that two differently named indicators can be one strategy.")
        strategies.append(d)
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_downloaded_at": manifest["downloaded_at"],
        "start": str(dates.min().date()), "end": str(dates.max().date()),
        "is_end": config.IS_END, "oos_start": config.OOS_START,
        "capital": config.INITIAL_CAPITAL, "risk_free": config.RISK_FREE_ANNUAL,
        "strategies": strategies,
        "universe": [{"symbol": s, "name": r["name"], "sector": r["sector"], "first_date": r["first_date"]}
                     for s, r in ctx.universe.iterrows()],
        "excluded": dq["excluded"],
        "costs": {"net": NET.describe(), "sources": COST_SOURCES, "checked_on": "2026-10-25"},
        "data_quality": {"calendar": dq["calendar"], "vix_first": dq["vix_first"],
                         "symbols": [{k: s[k] for k in ("symbol", "rows", "first", "last", "years", "missing_days",
                                                         "zero_volume_days", "fixes", "kaggle_check", "in_universe")}
                                     for s in dq["symbols"]]},
        "corporate_actions": ca,
        "ml": {"features": [{"id": f, "label": FEATURE_LABELS[f]} for f in FEATURES]},
        "sectors": sectors,
    }
    write("meta.json", meta)

    # ---------------- findings (computed from the results above) ----------------
    findings = build_findings(meta=meta, lb=lb, acc=acc_out, reg=reg_out, rob=rob, cmp={"corr": corr, "combos": combos},
                              sectors=sec_out)
    write("findings.json", findings)
    sizes = {p.name: p.stat().st_size for p in OUT.glob("*.json")}
    print("  files:", {k: f"{v / 1024:.0f}KB" for k, v in sorted(sizes.items())})
    print(f"Export finished in {time.time() - t0:.0f}s -> {OUT.relative_to(config.ROOT)}")


if __name__ == "__main__":
    main()
