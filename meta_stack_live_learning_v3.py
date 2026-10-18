"""Causal drift monitoring and candidate retraining for the meta-stack app.

The buffer is populated only after all five issued forecasts have matured.
NIS is deliberately excluded because it diagnoses the DA layer rather than ML
drift.  Original model bundles are read-only; accepted candidates are versioned
under EMS/models_live_meta_v3.
"""

from __future__ import annotations

import copy
import math
import pickle
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np

from ensemble_meta_runtime_v3 import (
    LEAD_TIMES,
    MetaMultiOutputXGB,
    build_meta_features,
    predict_base_bundle,
    predict_meta_stack,
)


MIN_DRIFT_ROWS = 500
MIN_RETRAIN_ROWS = 2000
MAX_BUFFER_ROWS = 50_000
RMSE_DRIFT_FRACTION = 0.15
WQE_DRIFT_FRACTION = 0.20
COOLDOWN_HOURS = 24


def utc_hour(value: str | datetime | None) -> datetime:
    if value is None:
        result = datetime.now(timezone.utc)
    elif isinstance(value, datetime):
        result = value
    else:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result.astimezone(timezone.utc).replace(
        minute=0,
        second=0,
        microsecond=0,
    )


def wqe_loss(observed: np.ndarray, predicted: np.ndarray) -> float:
    error = observed - predicted
    under = error >= 0
    linear = np.where(under, 0.8 * error, -0.2 * error)
    quadratic = np.where(under, 0.7 * error**2, 0.3 * error**2)
    return float(np.mean(0.5 * linear + 0.5 * quadratic))


class CausalCompletedForecastBuffer:
    def __init__(self, max_rows: int = MAX_BUFFER_ROWS):
        self.issued: dict[str, dict[str, Any]] = {}
        self.completed: deque[dict[str, Any]] = deque(maxlen=max_rows)
        self.lock = threading.RLock()

    def register(
        self,
        issued_at: str | datetime | None,
        features: np.ndarray,
        surge_t0: float,
        storm_flag: float,
        prior: np.ndarray,
    ) -> None:
        issue = utc_hour(issued_at)
        with self.lock:
            self.issued[issue.isoformat()] = {
                "issued_at": issue,
                "features": np.asarray(features, dtype=np.float32).reshape(-1),
                "surge_t0": float(surge_t0),
                "storm_flag": float(storm_flag),
                "prior": np.asarray(prior, dtype=np.float32).reshape(-1),
                "observed": np.full(len(LEAD_TIMES), np.nan, dtype=np.float32),
            }
            self._prune(issue)

    def add_observations(
        self,
        observations: list[tuple[str | datetime | None, float | None]],
    ) -> int:
        valid = [
            (utc_hour(observed_at), float(value))
            for observed_at, value in observations
            if value is not None and math.isfinite(float(value))
        ]
        completed_now = 0
        with self.lock:
            for observed_at, value in sorted(valid):
                for index, lead in enumerate(LEAD_TIMES):
                    issue = observed_at - timedelta(hours=lead)
                    row = self.issued.get(issue.isoformat())
                    if row is not None:
                        row["observed"][index] = value
            complete_keys = [
                key
                for key, row in self.issued.items()
                if np.isfinite(row["observed"]).all()
            ]
            for key in complete_keys:
                row = self.issued.pop(key)
                row["completed_at"] = max(
                    row["issued_at"] + timedelta(hours=lead)
                    for lead in LEAD_TIMES
                )
                row["rmse"] = float(
                    np.sqrt(np.mean((row["observed"] - row["prior"]) ** 2))
                )
                row["wqe"] = wqe_loss(row["observed"], row["prior"])
                self.completed.append(row)
                completed_now += 1
            if valid:
                self._prune(valid[-1][0])
        return completed_now

    def _prune(self, reference: datetime) -> None:
        oldest = reference - timedelta(days=8)
        self.issued = {
            key: row
            for key, row in self.issued.items()
            if row["issued_at"] >= oldest
        }

    def arrays(self) -> tuple[np.ndarray, ...]:
        with self.lock:
            rows = list(self.completed)
        if not rows:
            return (
                np.empty((0, 0), dtype=np.float32),
                np.empty((0, len(LEAD_TIMES)), dtype=np.float32),
                np.empty(0, dtype=np.float32),
                np.empty(0, dtype=np.float32),
            )
        return (
            np.stack([row["features"] for row in rows]),
            np.stack([row["observed"] for row in rows]),
            np.asarray([row["surge_t0"] for row in rows], dtype=np.float32),
            np.asarray([row["storm_flag"] for row in rows], dtype=np.float32),
        )

    def diagnostics(self) -> dict[str, Any]:
        with self.lock:
            rows = list(self.completed)
            issued = len(self.issued)
        recent = rows[-30 * 24 :]
        return {
            "completed_rows": len(rows),
            "pending_issuances": issued,
            "recent_rmse": (
                float(np.mean([row["rmse"] for row in recent])) if recent else None
            ),
            "recent_wqe": (
                float(np.mean([row["wqe"] for row in recent])) if recent else None
            ),
        }


class MetaStackLiveLearningManager:
    def __init__(
        self,
        station_id: str,
        historical_rmse: float,
        surge_p95: float,
        output_directory: Path,
        get_bundle: Callable[[], dict[str, Any]],
        promote_bundle: Callable[[dict[str, Any], dict[int, float]], None],
        max_workers: int = 1,
    ) -> None:
        self.station_id = station_id
        self.historical_rmse = max(float(historical_rmse), 1.0e-6)
        self.surge_p95 = float(surge_p95)
        self.output_directory = output_directory
        self.get_bundle = get_bundle
        self.promote_bundle = promote_bundle
        self.buffer = CausalCompletedForecastBuffer()
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.running = False
        self.last_trigger_at: datetime | None = None
        self.history: list[dict[str, Any]] = []
        self.lock = threading.RLock()

    def observe_and_check(
        self,
        observations: list[tuple[str | datetime | None, float | None]],
        current_surge: float,
    ) -> dict[str, Any]:
        completed = self.buffer.add_observations(observations)
        diagnostics = self.buffer.diagnostics()
        reasons = []
        if diagnostics["completed_rows"] >= MIN_DRIFT_ROWS:
            if (
                diagnostics["recent_rmse"] is not None
                and diagnostics["recent_rmse"]
                > self.historical_rmse * (1.0 + RMSE_DRIFT_FRACTION)
            ):
                reasons.append("rolling RMSE drift")
            extreme = float(current_surge) > self.surge_p95
            if extreme:
                reasons.append("observed extreme surge")
            X, y, _, storm = self.buffer.arrays()
            del X, y
            calm_rows = [
                row
                for row in list(self.buffer.completed)
                if row["storm_flag"] <= 0
            ]
            if len(calm_rows) >= 100 and diagnostics["recent_wqe"] is not None:
                baseline = float(np.percentile([row["wqe"] for row in calm_rows], 75))
                corroborated = bool(reasons)
                if (
                    baseline > 0
                    and diagnostics["recent_wqe"]
                    > baseline * (1.0 + WQE_DRIFT_FRACTION)
                    and corroborated
                ):
                    reasons.append("corroborated WQE drift")

        cooldown = False
        if self.last_trigger_at is not None:
            elapsed = (
                datetime.now(timezone.utc) - self.last_trigger_at
            ).total_seconds() / 3600
            cooldown = elapsed < COOLDOWN_HOURS
        triggered = (
            bool(reasons)
            and diagnostics["completed_rows"] >= MIN_RETRAIN_ROWS
            and not cooldown
            and not self.running
        )
        if triggered:
            with self.lock:
                self.running = True
                self.last_trigger_at = datetime.now(timezone.utc)
            self.executor.submit(self._retrain, reasons)
        return {
            **diagnostics,
            "newly_completed": completed,
            "triggered": triggered,
            "reasons": reasons,
            "cooldown": cooldown,
            "retrain_running": self.running,
        }

    def _retrain(self, reasons: list[str]) -> None:
        started = time.time()
        event = {
            "started_utc": datetime.now(timezone.utc).isoformat(),
            "reasons": reasons,
            "accepted": False,
            "error": None,
        }
        try:
            X, y, surge_t0, storm_flag = self.buffer.arrays()
            if len(X) < MIN_RETRAIN_ROWS:
                raise RuntimeError("Insufficient completed rows.")
            split = max(int(len(X) * 0.8), len(X) - 400)
            split = min(split, len(X) - 200)
            train = slice(0, split)
            holdout = slice(split, len(X))
            current = self.get_bundle()
            candidate = copy.deepcopy(current)
            updated = {}
            for model_name in ("XGBoost", "LightGBM"):
                bundle = copy.deepcopy(candidate["bases"][model_name])
                model = bundle["model"]
                scaled_X = bundle["scaler"].transform_X(X[train])
                scaled_y = bundle["scaler"].transform_y(y[train])
                warm = getattr(model, "estimators_", None)
                model.fit(
                    scaled_X,
                    scaled_y,
                    warm_start_estimators=warm,
                )
                updated[model_name] = bundle
            candidate["bases"].update(updated)

            ensemble = candidate["ensemble"]
            train_predictions = {
                name: predict_base_bundle(bundle, X[train])
                for name, bundle in candidate["bases"].items()
            }
            anchor_name = ensemble["best_base_name"]
            anchor = train_predictions[anchor_name]
            meta_X = build_meta_features(
                train_predictions,
                anchor,
                surge_t0[train],
                storm_flag[train],
                np.zeros((split, 0), dtype=np.float32),
            )
            ensemble["dyn_shrink"].fit(meta_X[:, 20:25])
            ensemble["meta_model"] = MetaMultiOutputXGB(
                ensemble.get("meta_xgb_params", {})
            ).fit(meta_X, y[train] - anchor)

            champion = predict_meta_stack(
                current,
                X[holdout],
                surge_t0[holdout],
                storm_flag[holdout],
            )
            challenger = predict_meta_stack(
                candidate,
                X[holdout],
                surge_t0[holdout],
                storm_flag[holdout],
            )
            truth = y[holdout]
            thresholds = np.quantile(y[train], 0.95, axis=0)
            extreme = truth >= thresholds[None, :]
            normal = ~extreme

            def subset_rmse(values: np.ndarray, mask: np.ndarray) -> float:
                return float(np.sqrt(np.mean((truth[mask] - values[mask]) ** 2)))

            champion_all = subset_rmse(champion, np.ones_like(truth, dtype=bool))
            challenger_all = subset_rmse(
                challenger, np.ones_like(truth, dtype=bool)
            )
            champion_extreme = subset_rmse(champion, extreme)
            challenger_extreme = subset_rmse(challenger, extreme)
            champion_normal = subset_rmse(champion, normal)
            challenger_normal = subset_rmse(challenger, normal)
            extreme_gain = 100.0 * (
                1.0 - challenger_extreme / max(champion_extreme, 1.0e-12)
            )
            normal_gain = 100.0 * (
                1.0 - challenger_normal / max(champion_normal, 1.0e-12)
            )
            all_gain = 100.0 * (
                1.0 - challenger_all / max(champion_all, 1.0e-12)
            )
            accepted = (
                extreme_gain >= 1.0
                and normal_gain >= -1.0
                and all_gain >= -0.5
            )
            event["validation"] = {
                "extreme_gain_pct": extreme_gain,
                "normal_gain_pct": normal_gain,
                "all_gain_pct": all_gain,
                "holdout_rows": len(truth),
            }
            event["accepted"] = accepted
            if accepted:
                timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
                target = self.output_directory / self.station_id / timestamp
                target.mkdir(parents=True, exist_ok=True)
                with (target / "ensemble_bundle.pkl").open("wb") as stream:
                    pickle.dump(candidate, stream, protocol=5)
                sigma = np.sqrt(np.mean((truth - challenger) ** 2, axis=0))
                sigma_by_lead = {
                    int(lead): float(sigma[index])
                    for index, lead in enumerate(LEAD_TIMES)
                }
                self.promote_bundle(candidate, sigma_by_lead)
                event["saved_to"] = str(target)
        except Exception as error:
            event["error"] = str(error)
        finally:
            event["duration_s"] = round(time.time() - started, 2)
            event["finished_utc"] = datetime.now(timezone.utc).isoformat()
            with self.lock:
                self.running = False
                self.history.append(event)

    def status(self) -> dict[str, Any]:
        return {
            "station_id": self.station_id,
            **self.buffer.diagnostics(),
            "running": self.running,
            "last_trigger_utc": (
                self.last_trigger_at.isoformat() if self.last_trigger_at else None
            ),
            "n_retraining_attempts": len(self.history),
            "last_retraining": self.history[-1] if self.history else None,
            "nis_used_as_trigger": False,
        }

