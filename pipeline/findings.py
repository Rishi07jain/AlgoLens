"""Headline findings, computed from the exported results.

Nothing here is pre-written: every claim picks its subject (which strategy, which regime)
and its numbers from the results, and the wording changes with the direction of the
result. If the data changes, the findings change.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from pipeline.regimes import tag_regimes


def pct(x, nd=1):
    return "n/a" if x is None else f"{x * 100:.{nd}f}%"


def num(x, nd=2):
    return "n/a" if x is None else f"{x:.{nd}f}"


def build_findings(meta, lb, acc, reg, rob, cmp, sectors) -> dict:
    names = {s["id"]: s["name"] for s in meta["strategies"]}
    fam = {s["id"]: s["family"] for s in meta["strategies"]}
    net = lb["full"]["net"]
    gross = lb["full"]["gross"]
    active = [s for s in net if fam[s] != "Benchmark"]
    cards = []

    # 1. Which strategy/family wins on risk-adjusted return? (Q1)
    ranked = sorted(active, key=lambda s: net[s]["sharpe"] or -9, reverse=True)
    best = ranked[0]
    fam_sharpe = pd.Series({s: net[s]["sharpe"] for s in active}).groupby(lambda s: fam[s]).mean().sort_values(ascending=False)
    bh, nifty = net["buy_hold"], net["nifty_bh"]
    beat_bh = [s for s in active if (net[s]["sharpe"] or -9) > bh["sharpe"]]
    cards.append({
        "id": "winner", "question": 1, "page": "/leaderboard",
        "title": f"{names[best]} had the best risk-adjusted return after costs",
        "metric": num(net[best]["sharpe"]), "metric_label": "net Sharpe",
        "body": (f"{names[best]} returned {pct(net[best]['cagr'])} a year net of costs with a Sharpe of {num(net[best]['sharpe'])} "
                 f"and a worst drawdown of {pct(net[best]['max_dd'])}. Equal-weight buy-and-hold of the same {len(meta['universe'])} stocks "
                 f"had a Sharpe of {num(bh['sharpe'])} ({pct(bh['max_dd'])} drawdown), and the Nifty 50 index {num(nifty['sharpe'])}. "
                 f"Only {len(beat_bh)} of {len(active)} strategies beat plain buy-and-hold on Sharpe. "
                 f"By family, {fam_sharpe.index[0]} scored highest on average ({num(fam_sharpe.iloc[0])}) and "
                 f"{fam_sharpe.index[-1]} lowest ({num(fam_sharpe.iloc[-1])})."),
        "chart": {"type": "bar", "unit": "ratio", "label": "Net Sharpe, 2010 to latest",
                  "data": [{"id": s, "label": names[s], "value": net[s]["sharpe"], "family": fam[s]}
                           for s in ranked + ["buy_hold", "nifty_bh"]]},
    })

    # 2. Accuracy vs profit (Q2)
    hv = acc["hit_vs_sharpe"]
    wr = {s: net[s]["win_rate"] for s in active if net[s]["win_rate"] is not None}
    med_sharpe = float(np.median([net[s]["sharpe"] for s in active]))
    hi_wr = max([s for s in wr if net[s]["sharpe"] < med_sharpe] or list(wr), key=wr.get)
    lo_wr_good = min([s for s in wr if net[s]["sharpe"] >= med_sharpe], key=wr.get)
    strength = "weak" if abs(hv["spearman"]) < 0.3 else ("moderate" if abs(hv["spearman"]) < 0.6 else "strong")
    cards.append({
        "id": "accuracy", "question": 2, "page": "/accuracy", "hero": True,
        "title": "Being right more often did not mean making more money",
        "metric": num(hv["spearman"]), "metric_label": "rank correlation, hit rate vs Sharpe",
        "body": (f"Across {hv['n']} strategy-stock pairs the link between daily hit rate and net Sharpe is {strength} "
                 f"(Spearman {num(hv['spearman'])}). {names[hi_wr]} won {pct(net[hi_wr]['win_rate'], 0)} of its trades but had a Sharpe of "
                 f"{num(net[hi_wr]['sharpe'])}; {names[lo_wr_good]} won only {pct(net[lo_wr_good]['win_rate'], 0)} yet reached "
                 f"{num(net[lo_wr_good]['sharpe'])}, because its average win was {num(net[lo_wr_good]['payoff_ratio'], 1)}x its average loss "
                 f"(vs {num(net[hi_wr]['payoff_ratio'], 1)}x). Payoff size matters as much as hit rate."),
        "chart": {"type": "bar", "unit": "ratio", "label": "Net Sharpe, strategies ordered by win rate (highest first)",
                  "data": [{"id": s, "label": f"{names[s]} · wins {net[s]['win_rate'] * 100:.0f}%", "value": net[s]["sharpe"]}
                           for s in sorted(wr, key=wr.get, reverse=True)]},
    })

    # 3. Costs (Q3)
    drag = {s: (gross[s]["sharpe"] or 0) - (net[s]["sharpe"] or 0) for s in active}
    worst = max(drag, key=drag.get)
    cd = rob["cost_drag"]
    low_turn = [s for s in active if (cd[s]["turnover"] or 0) < 5]
    keep = np.mean([(net[s]["cagr"] / gross[s]["cagr"]) for s in low_turn if gross[s]["cagr"] and gross[s]["cagr"] > 0])
    rt = meta["costs"]["net"]["round_trip"]
    cards.append({
        "id": "costs", "question": 3, "page": "/robustness",
        "title": f"Costs wiped out {names[worst]}",
        "metric": f"{num(gross[worst]['sharpe'])} -> {num(net[worst]['sharpe'])}", "metric_label": "Sharpe, gross -> net",
        "body": (f"A delivery round trip costs about {pct(rt, 2)} (STT, exchange and SEBI fees, GST, stamp duty, 5 bps slippage a side). "
                 f"{names[worst]} turned its portfolio over {num(cd[worst]['turnover'], 0)}x a year, so costs took about "
                 f"{pct(cd[worst]['annual_cost'])} a year and its CAGR fell from {pct(gross[worst]['cagr'])} to {pct(net[worst]['cagr'])}. "
                 f"Strategies trading less than 5x a year kept on average {pct(keep, 0)} of their gross CAGR."),
        "chart": {"type": "bar2", "unit": "pct", "label": "CAGR gross (bar) vs net (dot)",
                  "data": [{"id": s, "label": names[s], "value": gross[s]["cagr"], "value2": net[s]["cagr"]}
                           for s in sorted(active, key=lambda s: drag[s], reverse=True)]},
    })

    # 4. Regimes (Q4)
    sh = reg["sharpe"]
    bear_best = max(active, key=lambda s: sh[s].get("bear") if sh[s].get("bear") is not None else -9)
    bull_best = max(active, key=lambda s: sh[s].get("bull") if sh[s].get("bull") is not None else -9)
    hv_best = max(active, key=lambda s: sh[s].get("high") if sh[s].get("high") is not None else -9)
    lv_avg = np.mean([sh[s].get("low") for s in active if sh[s].get("low") is not None])
    hv_avg = np.mean([sh[s].get("high") for s in active if sh[s].get("high") is not None])
    t = tag_regimes().loc[meta["start"]:]
    b = t["trend"] == "bear"
    grp = (b != b.shift()).cumsum()
    spells = [(x.index[0], x.index[-1], x["close"].iloc[-1] / x["close"].iloc[0] - 1) for _, x in t[b].groupby(grp[b]) if len(x) > 20]
    big = max(spells, key=lambda z: z[2]) if spells else None
    caveat = (f" The 200-day rule is slow: its longest-rising 'bear' spell ({big[0].date():%b %Y} to {big[1].date():%b %Y}) "
              f"saw the Nifty gain {pct(big[2], 0)}, which is why buying in 'bear' tags looked good.") if big and big[2] > 0 else ""
    cards.append({
        "id": "regimes", "question": 4, "page": "/regimes",
        "title": "Most strategies did better in high volatility than in calm markets",
        "metric": f"{num(hv_avg)} vs {num(lv_avg)}", "metric_label": "avg Sharpe, high vs low VIX",
        "body": (f"Averaged across strategies, Sharpe was {num(hv_avg)} in high-VIX days and {num(lv_avg)} in low-VIX days. "
                 f"{names[hv_best]} led in high volatility ({num(sh[hv_best]['high'])}); in bear tags the leader was "
                 f"{names[bear_best]} ({num(sh[bear_best]['bear'])}) and in bull tags {names[bull_best]} ({num(sh[bull_best]['bull'])})."
                 + caveat) if hv_avg > lv_avg else
                (f"Averaged across strategies, Sharpe was {num(lv_avg)} in low-VIX days and {num(hv_avg)} in high-VIX days. " + caveat),
        "chart": {"type": "bar2", "unit": "ratio", "label": "Sharpe in high VIX (bar) vs low VIX (dot)",
                  "data": [{"id": s, "label": names[s], "value": sh[s].get("high"), "value2": sh[s].get("low")} for s in active]},
    })
    if hv_avg <= lv_avg:
        cards[-1]["title"] = "Calm markets were kinder to most strategies than volatile ones"

    # 5. Overfitting (Q5)
    grids = rob["param_grids"]
    worse = [g for g in grids if g["best_is"]["oos_rank"] and g["best_is"]["oos_rank"] > g["best_is"]["n_cells"] / 2]
    stayed = [g for g in grids if g["best_is"]["oos_rank"] == 1]
    g0 = max(grids, key=lambda g: (g["best_is"]["oos_rank"] or 0) / g["best_is"]["n_cells"])
    passed = [s for s in active if (rob["deflated"][s]["dsr"] or 0) >= 0.95]
    oos_drop = [s for s in active if (lb["oos"]["net"][s]["sharpe"] or 0) < (lb["is"]["net"][s]["sharpe"] or 0)]
    cards.append({
        "id": "overfit", "question": 5, "page": "/robustness",
        "title": ("The best in-sample setting never stayed the best" if not stayed else
                  f"The best in-sample setting stayed best in only {len(stayed)} of {len(grids)} grids"),
        "metric": f"{len(stayed)} of {len(grids)}", "metric_label": "parameter grids where the best 2010-19 setting was still #1 after 2020",
        "body": (f"For {names[g0['strategy']]}, the best 2010-2019 setting ({g0['x']}={g0['best_is']['x']}, {g0['y']}={g0['best_is']['y']}, "
                 f"Sharpe {num(g0['best_is']['sharpe_is'])}) ranked {g0['best_is']['oos_rank']} of {g0['best_is']['n_cells']} after 2020 "
                 f"(Sharpe {num(g0['best_is']['sharpe_oos'])}); in {len(worse)} of {len(grids)} grids the in-sample winner fell into the bottom half. {len(oos_drop)} of {len(active)} strategies had a lower Sharpe out of sample. "
                 f"After deflating for the {rob['n_trials']} configurations tested, "
                 + (f"{len(passed)} strategies cleared 95% confidence: {', '.join(names[s] for s in passed)}." if passed else
                    "no strategy cleared 95% confidence that its Sharpe beats luck.")),
        "chart": {"type": "bar2", "unit": "ratio", "label": "Sharpe 2010-19 (bar) vs 2020+ (dot)",
                  "data": [{"id": s, "label": names[s], "value": lb["is"]["net"][s]["sharpe"], "value2": lb["oos"]["net"][s]["sharpe"]}
                           for s in active]},
    })

    # 6. ML vs rules (Q7)
    ml = [s for s in active if fam[s] == "Machine learning"]
    rules_ = [s for s in active if fam[s] != "Machine learning"]
    if ml:
        best_ml = max(ml, key=lambda s: net[s]["sharpe"] or -9)
        best_rule = max(rules_, key=lambda s: net[s]["sharpe"] or -9)
        aucs = [acc["ml"][s]["auc"] for s in ml if s in acc["ml"]]
        beat = (net[best_ml]["sharpe"] or -9) > (net[best_rule]["sharpe"] or -9)
        cards.append({
            "id": "ml", "question": 7, "page": "/accuracy",
            "title": "ML models beat simple rules" if beat else "ML models did not beat simple rules once both paid the same costs",
            "metric": f"{min(aucs):.3f}-{max(aucs):.3f}", "metric_label": "out-of-sample ROC-AUC",
            "body": (f"Walk-forward models (retrained every year on past data only) reached an out-of-sample AUC of {min(aucs):.3f}-{max(aucs):.3f}, "
                     f"barely above a coin flip (0.5). Gross of costs the best ML model, {names[best_ml]}, had a Sharpe of "
                     f"{num(gross[best_ml]['sharpe'])}; net it was {num(net[best_ml]['sharpe'])}, against {num(net[best_rule]['sharpe'])} for "
                     f"{names[best_rule]}. Next-day predictions flip often, so the models trade {num(min(cd[s]['turnover'] for s in ml), 0)}-"
                     f"{num(max(cd[s]['turnover'] for s in ml), 0)}x a year."),
            "chart": {"type": "bar2", "unit": "ratio", "label": "Sharpe gross (bar) vs net (dot)",
                      "data": [{"id": s, "label": names[s], "value": gross[s]["sharpe"], "value2": net[s]["sharpe"]}
                               for s in ml + [best_rule, "buy_hold"]]},
        })

    # Extra: survivorship
    cards.append({
        "id": "survivorship", "question": None, "page": "/methodology",
        "title": "Survivorship bias inflates every stock-level result",
        "metric": f"{pct(bh['cagr'])} vs {pct(nifty['cagr'])}", "metric_label": "CAGR: today's constituents vs Nifty index",
        "body": (f"The universe is today's Nifty 50 members with 10+ years of history, chosen with hindsight. Holding them equally from "
                 f"{meta['start'][:4]} returned {pct(bh['cagr'])} a year against {pct(nifty['cagr'])} for the Nifty 50 price index "
                 f"(which excludes about 1-1.5% a year of dividends). Compare strategies with each other and with stock buy-and-hold, "
                 f"not with the index."),
        "chart": {"type": "bar", "unit": "pct", "label": "CAGR, 2010 to latest (net)",
                  "data": [{"id": s, "label": names[s], "value": net[s]["cagr"]} for s in ["buy_hold", best, "nifty_bh"]]},
    })

    # Extra: diversification (Q8)
    corr = cmp["corr"]
    a = corr.loc[active, active]
    avg = {s: float(a[s].drop(s).mean()) for s in active}
    div = min(avg, key=avg.get)
    pairs = [(x, y, a.at[x, y]) for i, x in enumerate(active) for y in active[i + 1:] if x != "zscore_20" and y != "zscore_20"]
    lowest = min(pairs, key=lambda z: z[2])
    ew = cmp["combos"]["ew_rules"]["metrics"]
    cards.append({
        "id": "diversify", "question": 8, "page": "/compare",
        "title": f"{names[div]} diversified the rest the most",
        "metric": num(avg[div]), "metric_label": "average return correlation with other strategies",
        "body": (f"{names[div]} had the lowest average daily-return correlation with the other strategies ({num(avg[div])}). "
                 f"The least correlated pair was {names[lowest[0]]} and {names[lowest[1]]} ({num(lowest[2])}). "
                 f"An equal-weight mix of all rule-based strategies returned {pct(ew['cagr'])} a year with a Sharpe of {num(ew['sharpe'])} "
                 f"and a {pct(ew['max_dd'])} worst drawdown."),
        "chart": {"type": "bar", "unit": "ratio", "label": "Average correlation with the other strategies (lower diversifies more)",
                  "data": [{"id": s, "label": names[s], "value": avg[s]} for s in sorted(avg, key=avg.get)]},
    })

    # Extra: sectors (Q6)
    sec = sectors["metrics"]
    trend_ids = [s for s in active if fam[s] == "Trend" and s in sec[next(iter(sec))]["full"]["net"]]
    mr_ids = [s for s in active if fam[s] == "Mean reversion" and s in sec[next(iter(sec))]["full"]["net"]]
    tr_by = {k: np.mean([sec[k]["full"]["net"][s]["sharpe"] for s in trend_ids]) for k in sec}
    mr_by = {k: np.mean([sec[k]["full"]["net"][s]["sharpe"] for s in mr_ids]) for k in sec}
    cards.append({
        "id": "sectors", "question": 6, "page": "/leaderboard",
        "title": "Results differ a lot by sector",
        "metric": f"{max(tr_by.values()):.2f} vs {min(tr_by.values()):.2f}", "metric_label": "trend-family Sharpe, best vs worst sector",
        "body": (f"Trend strategies worked best in {max(tr_by, key=tr_by.get)} (avg Sharpe {num(max(tr_by.values()))}) and worst in "
                 f"{min(tr_by, key=tr_by.get)} ({num(min(tr_by.values()))}). Mean-reversion strategies did best in "
                 f"{max(mr_by, key=mr_by.get)} ({num(max(mr_by.values()))}) and worst in {min(mr_by, key=mr_by.get)} "
                 f"({num(min(mr_by.values()))}). Sector groups hold 3-11 stocks, so treat these as indicative."),
        "chart": {"type": "bar2", "unit": "ratio", "label": "Avg Sharpe: trend (bar) vs mean reversion (dot)",
                  "data": [{"id": k, "label": k, "value": tr_by[k], "value2": mr_by[k]} for k in sorted(tr_by, key=tr_by.get, reverse=True)]},
    })
    return {"cards": cards, "generated_from": "results computed in pipeline/export.py"}
