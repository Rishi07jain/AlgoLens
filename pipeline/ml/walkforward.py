"""Expanding-window walk-forward for the ML strategies.

For each test year Y (2010 -> latest): train one pooled model on every stock-day whose
*target date* is before 1 Jan Y, then predict every day of year Y. A model therefore
never sees any price from its test year. Long when P(up) > 0.5.

Models: logistic regression, random forest (200 trees), gradient-boosted trees
(scikit-learn HistGradientBoosting, tuned per fold on the last training year).
XGBoost (P1) is not used because its macOS wheel needs the system OpenMP library.

Run:  uv run python -m pipeline.ml.walkforward
"""
from __future__ import annotations

import json
import time
import warnings

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from pipeline import config
from pipeline.backtest import load_panel
from pipeline.ml.features import FEATURES, build_features

warnings.filterwarnings("ignore")
SEED = 42


def walk_forward_splits(dates: pd.Series, target_dates: pd.Series, first_test_year: int, last_test_year: int):
    """Yield (year, train_mask, test_mask). Train rows have target_date < 1 Jan of the
    test year, so no test-year price is used for training."""
    for y in range(first_test_year, last_test_year + 1):
        ys = pd.Timestamp(f"{y}-01-01")
        ye = pd.Timestamp(f"{y}-12-31")
        train = (target_dates < ys).to_numpy()
        test = ((dates >= ys) & (dates <= ye)).to_numpy()
        yield y, train, test


def make_logreg():
    return make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=2000))


def make_rf():
    return RandomForestClassifier(n_estimators=200, max_depth=8, min_samples_leaf=200, max_features="sqrt",
                                  n_jobs=-1, random_state=SEED)


GBM_GRID = [
    {"max_depth": 2, "learning_rate": 0.05, "max_iter": 150},
    {"max_depth": 3, "learning_rate": 0.05, "max_iter": 300},
    {"max_depth": 4, "learning_rate": 0.03, "max_iter": 300},
]


def make_gbm(params: dict):
    return HistGradientBoostingClassifier(**params, l2_regularization=1.0, min_samples_leaf=200,
                                          early_stopping=False, random_state=SEED)


def tune_gbm(X: np.ndarray, y: np.ndarray, d: pd.Series) -> dict:
    """Pick GBM params on the last year of the training window (time-ordered hold-out)."""
    cut = d.max() - pd.Timedelta(days=365)
    tr, va = (d < cut).to_numpy(), (d >= cut).to_numpy()
    if tr.sum() < 5000 or va.sum() < 1000:
        return GBM_GRID[0]
    best, best_auc = GBM_GRID[0], -1.0
    for g in GBM_GRID:
        m = make_gbm(g).fit(X[tr], y[tr])
        auc = roc_auc_score(y[va], m.predict_proba(X[va])[:, 1])
        if auc > best_auc:
            best, best_auc = g, auc
    return best


MODELS = {"logreg": "Logistic regression", "random_forest": "Random forest", "gbm": "Gradient boosting"}


def main() -> None:
    t0 = time.time()
    p = load_panel()
    F = build_features(p)
    F = F[F["target"].notna()].reset_index(drop=True)
    last_year = int(F["date"].max().year)
    first = int(pd.Timestamp(config.BACKTEST_START).year)
    print(f"Feature rows: {len(F):,}  ({F['date'].min().date()} -> {F['date'].max().date()}), "
          f"{F['symbol'].nunique()} stocks")
    X_all = F[FEATURES].to_numpy(dtype=float)
    y_all = F["target"].to_numpy(dtype=int)
    preds, folds = [], []
    importances: dict[str, list] = {"random_forest": [], "gbm": [], "logreg": []}
    for y, tr, te in walk_forward_splits(F["date"], F["target_date"], first, last_year):
        if te.sum() == 0:
            continue
        Xtr, ytr, Xte, yte = X_all[tr], y_all[tr], X_all[te], y_all[te]
        assert F.loc[tr, "target_date"].max() < pd.Timestamp(f"{y}-01-01"), "look-ahead in training window"
        row = {"year": y, "train_start": str(F.loc[tr, "date"].min().date()),
               "train_end": str(F.loc[tr, "date"].max().date()), "n_train": int(tr.sum()), "n_test": int(te.sum())}
        out = F.loc[te, ["date", "symbol", "target", "fwd_ret"]].copy()
        for key in MODELS:
            if key == "logreg":
                m = make_logreg().fit(Xtr, ytr)
                coef = m[-1].coef_[0]
                importances["logreg"].append({"year": y, **{f: float(c) for f, c in zip(FEATURES, coef)}})
            elif key == "random_forest":
                m = make_rf().fit(Xtr, ytr)
                importances["random_forest"].append({"year": y, **{f: float(c) for f, c in zip(FEATURES, m.feature_importances_)}})
            else:
                g = tune_gbm(Xtr, ytr, F.loc[tr, "date"])
                m = make_gbm(g).fit(Xtr, ytr)
                row["gbm_params"] = g
            prob = m.predict_proba(Xte)[:, 1]
            out[f"p_{key}"] = prob
            row[f"auc_{key}"] = round(float(roc_auc_score(yte, prob)), 4) if len(set(yte)) > 1 else None
        preds.append(out)
        folds.append(row)
        print(f"  {y}: train {row['train_start']}..{row['train_end']} n={row['n_train']:>7,}  test n={row['n_test']:>6,}  "
              f"AUC lr={row['auc_logreg']} rf={row['auc_random_forest']} gbm={row['auc_gbm']}  ({time.time() - t0:.0f}s)")
    P = pd.concat(preds, ignore_index=True)
    P.to_parquet(config.PROCESSED / "ml_predictions.parquet", index=False)
    (config.PROCESSED / "ml_folds.json").write_text(json.dumps({"folds": folds, "importances": importances,
                                                                 "features": FEATURES}, indent=2))
    print(f"Saved {len(P):,} out-of-sample predictions in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
