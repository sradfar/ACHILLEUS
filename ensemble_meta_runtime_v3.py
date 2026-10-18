"""Read-only inference utilities for the stored ACHILLEUS meta-stack.

This module provides pickle compatibility for the original ensemble bundles and
uses the same anchor/meta-correction calculation used when Ensemble v2 was
trained.  Existing model files are never modified.
"""

from __future__ import annotations

import copy
import pickle
import sys
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.preprocessing import StandardScaler

from transferability_common_v1 import (
    SurgeScaler,
    WQEObjective,
    XGBMultiOutputWQE,
)


LEAD_TIMES = (6, 12, 24, 48, 72)
BASE_MODEL_NAMES = ("LightGBM", "XGBoost", "RandomForest", "ExtraTrees")


class LGBMMultiOutputWQE:
    """Pickle-compatible one-LightGBM-regressor-per-lead wrapper."""

    def __init__(self, base_model, wqe_obj):
        self.base_model = base_model
        self.wqe_obj = wqe_obj
        self.estimators_ = []

    def fit(self, X, Y, sample_weight=None, warm_start_estimators=None):
        self.estimators_ = []
        for column in range(Y.shape[1]):
            estimator = copy.deepcopy(self.base_model)
            fit_options = {}
            if warm_start_estimators is not None:
                fit_options["init_model"] = warm_start_estimators[column]
            if sample_weight is None:
                estimator.fit(X, Y[:, column], **fit_options)
            else:
                estimator.fit(
                    X,
                    Y[:, column],
                    sample_weight=sample_weight,
                    **fit_options,
                )
            self.estimators_.append(estimator)
        return self

    def predict(self, values):
        return np.column_stack(
            [estimator.predict(values) for estimator in self.estimators_]
        )


class DynamicShrinkage:
    """Pickle-compatible spread-dependent meta-correction shrinkage."""

    def __init__(self, lam_min: float = 0.3, lam_max: float = 0.6):
        self.lam_min = lam_min
        self.lam_max = lam_max
        self.p5_ = None
        self.p95_ = None

    def fit(self, spread: np.ndarray) -> "DynamicShrinkage":
        mean_spread = spread.mean(axis=1)
        self.p5_ = float(np.percentile(mean_spread, 5))
        self.p95_ = float(np.percentile(mean_spread, 95))
        return self

    def transform(self, spread: np.ndarray) -> np.ndarray:
        mean_spread = spread.mean(axis=1)
        normalized = np.clip(
            (mean_spread - self.p5_) / (self.p95_ - self.p5_ + 1.0e-8),
            0.0,
            1.0,
        )
        values = self.lam_max - (self.lam_max - self.lam_min) * normalized
        return values.reshape(-1, 1).astype(np.float32)

    @property
    def mean_lambda(self) -> float:
        return 0.5 * (self.lam_min + self.lam_max)


class MetaMultiOutputXGB:
    """Pickle-compatible residual meta-learner."""

    def __init__(self, params: dict):
        self.params = params
        self.estimators_ = []
        self.x_scaler_ = None

    def fit(self, X, Y_residual, sample_weight=None):
        import xgboost as xgb

        self.x_scaler_ = StandardScaler()
        scaled = self.x_scaler_.fit_transform(X).astype(np.float32)
        self.estimators_ = []
        for column in range(Y_residual.shape[1]):
            estimator = xgb.XGBRegressor(**self.params)
            if sample_weight is None:
                estimator.fit(scaled, Y_residual[:, column], verbose=False)
            else:
                estimator.fit(
                    scaled,
                    Y_residual[:, column],
                    sample_weight=sample_weight,
                    verbose=False,
                )
            self.estimators_.append(estimator)
        return self

    def predict(self, values: np.ndarray) -> np.ndarray:
        scaled = self.x_scaler_.transform(values).astype(np.float32)
        return np.column_stack(
            [estimator.predict(scaled) for estimator in self.estimators_]
        ).astype(np.float32)


def install_pickle_compatibility() -> None:
    """Expose all script-defined classes expected by the original pickles."""

    main_module = sys.modules["__main__"]
    for cls in (
        WQEObjective,
        SurgeScaler,
        XGBMultiOutputWQE,
        LGBMMultiOutputWQE,
        DynamicShrinkage,
        MetaMultiOutputXGB,
    ):
        setattr(main_module, cls.__name__, cls)


def load_pickle(path: Path) -> Any:
    install_pickle_compatibility()
    with path.open("rb") as stream:
        return pickle.load(stream)


def load_station_ensemble(model_directory: Path, station_id: str) -> dict[str, Any]:
    """Load the original read-only meta-stack and its four base models."""

    ensemble_path = model_directory / f"{station_id}_Ensemble_v2.pkl"
    if not ensemble_path.exists():
        raise FileNotFoundError(ensemble_path)
    ensemble = load_pickle(ensemble_path)
    bases = {}
    for model_name in BASE_MODEL_NAMES:
        path = model_directory / f"{station_id}_{model_name}.pkl"
        if not path.exists():
            raise FileNotFoundError(path)
        bases[model_name] = load_pickle(path)
    expected = list(ensemble.get("base_model_names", BASE_MODEL_NAMES))
    if set(expected) != set(bases):
        raise ValueError(
            f"{station_id} base-model mismatch: bundle={expected}, loaded={list(bases)}"
        )
    return {
        "ensemble": ensemble,
        "bases": bases,
        "ensemble_path": ensemble_path,
    }


def predict_base_bundle(bundle: dict, raw_features: np.ndarray) -> np.ndarray:
    scaler = bundle["scaler"]
    model = bundle["model"]
    # The saved forests may request many joblib workers.  A single worker is
    # faster for these small operational batches and avoids process creation in
    # restricted desktop environments; the persisted bundle is unchanged.
    if hasattr(model, "get_params") and hasattr(model, "set_params"):
        if "n_jobs" in model.get_params(deep=False):
            model.set_params(n_jobs=1)
    for estimator in getattr(model, "estimators_", []):
        if hasattr(estimator, "get_params") and hasattr(estimator, "set_params"):
            if "n_jobs" in estimator.get_params(deep=False):
                estimator.set_params(n_jobs=1)
    scaled_features = scaler.transform_X(raw_features)
    scaled_prediction = model.predict(scaled_features)
    prediction = scaler.inverse_y(scaled_prediction)
    if bundle.get("log1p_targets", False):
        prediction = np.sign(prediction) * np.expm1(np.abs(prediction))
    return np.asarray(prediction, dtype=np.float32)


def build_meta_features(
    predictions: dict[str, np.ndarray],
    anchor: np.ndarray,
    surge_t0: np.ndarray,
    storm_flag: np.ndarray,
    storm_physics: np.ndarray,
) -> np.ndarray:
    parts = []
    ordered = []
    for model_name in BASE_MODEL_NAMES:
        values = predictions[model_name]
        parts.append(values)
        ordered.append(values)
    stacked = np.stack(ordered, axis=0)
    spread = stacked.max(axis=0) - stacked.min(axis=0)
    parts.extend(
        [
            spread,
            anchor.astype(np.float32),
            surge_t0.reshape(-1, 1).astype(np.float32),
            storm_flag.reshape(-1, 1).astype(np.float32),
        ]
    )
    if storm_physics.shape[1]:
        parts.append(storm_physics.astype(np.float32))
    return np.hstack(parts).astype(np.float32)


def predict_meta_stack(
    station_bundle: dict[str, Any],
    raw_features: np.ndarray,
    surge_t0: np.ndarray,
    storm_flag: np.ndarray | None = None,
    storm_physics: np.ndarray | None = None,
    return_bases: bool = False,
) -> np.ndarray | tuple[np.ndarray, dict[str, np.ndarray]]:
    """Predict with the stored, training-consistent Ensemble v2 meta-stack.

    Ensemble v2 was trained with the validation-selected best base as the
    residual anchor.  The saved meta-model must therefore be evaluated with
    that same anchor, while all four base predictions still enter its feature
    vector and convex-hull safeguard.
    """

    ensemble = station_bundle["ensemble"]
    bases = station_bundle["bases"]
    raw = np.asarray(raw_features, dtype=np.float32)
    current = np.asarray(surge_t0, dtype=np.float32).reshape(-1)
    if raw.shape[0] != current.size:
        raise ValueError("Feature and surge_t0 row counts differ.")
    if storm_flag is None:
        storm_flag = np.zeros(current.size, dtype=np.float32)
    else:
        storm_flag = np.asarray(storm_flag, dtype=np.float32).reshape(-1)
    if storm_physics is None:
        storm_physics = np.zeros((current.size, 0), dtype=np.float32)
    else:
        storm_physics = np.asarray(storm_physics, dtype=np.float32)

    predictions = {
        model_name: predict_base_bundle(bundle, raw)
        for model_name, bundle in bases.items()
    }
    anchor_name = str(ensemble["best_base_name"])
    if anchor_name not in predictions:
        raise KeyError(f"Missing saved best-base anchor {anchor_name}.")
    anchor = predictions[anchor_name]
    meta_features = build_meta_features(
        predictions,
        anchor,
        current,
        storm_flag,
        storm_physics,
    )
    spread = meta_features[:, 20:25]
    correction = ensemble["meta_model"].predict(meta_features)
    shrinkage = ensemble["dyn_shrink"].transform(spread)
    meta_prediction = anchor + shrinkage * correction

    stacked = np.stack(list(predictions.values()), axis=0)
    result = np.clip(
        meta_prediction,
        stacked.min(axis=0),
        stacked.max(axis=0),
    ).astype(np.float32)
    if return_bases:
        return result, predictions
    return result
