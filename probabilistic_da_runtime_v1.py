"""Operational runtime for the extreme-selective ML-centered EnKF.

This module is intentionally separate from the research evaluation scripts.
It loads the latest rolling-origin parameter selection, maintains a small
lead-specific forecast-error state, and records issued forecasts so that only
matured, causal forecast errors are assimilated.

The marginal predictive distributions are represented by deterministic normal
quantiles. The same quantile rank is used across lead times (comonotonic
coupling), providing a reproducible and conservative ensemble for horizon-peak
hazard and impact propagation.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import NormalDist
from threading import RLock
from typing import Any
import json
import math
import time

import numpy as np
import pandas as pd
from ml_error_state_enkf_v1 import standardized_error_members, square_root_member_step


LEAD_HOURS = (6, 12, 24, 48, 72)
NORMAL = NormalDist()


def _utc_hour(value: str | datetime | None) -> datetime:
    if value is None:
        result = datetime.now(timezone.utc)
    elif isinstance(value, datetime):
        result = value
    else:
        text = str(value).strip().replace("Z", "+00:00")
        result = datetime.fromisoformat(text)
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    else:
        result = result.astimezone(timezone.utc)
    return result.replace(minute=0, second=0, microsecond=0)


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float(default)
    return number if math.isfinite(number) else float(default)


def _quantile(values: list[float], probability: float) -> float:
    if not values:
        return math.nan
    return float(np.quantile(np.asarray(values, dtype=float), probability))


@dataclass(frozen=True)
class LeadRuntimeParameters:
    lead_hours: int
    enabled: bool
    gate_name: str
    phi: float
    q_variance: float
    r_variance: float
    init_variance: float
    sigma_scale: float
    extreme_threshold_m: float
    ml_sigma_m: float


@dataclass
class LeadRuntimeState:
    mean: float
    variance: float
    last_step_at: datetime | None = None
    updates: int = 0
    last_nis: float | None = None
    last_gain: float | None = None
    last_update_accepted: bool | None = None
    members: np.ndarray | None = None


class OperationalExtremeSelectiveDA:
    """Thread-safe operational error-state filter for one NOAA station."""

    def __init__(
        self,
        station_id: str,
        station_name: str,
        parameters: dict[int, LeadRuntimeParameters],
        current_threshold_m: float,
        state_path: Path | None = None,
        ensemble_size: int = 101,
        innovation_gate_sigma: float = 4.0,
    ) -> None:
        self.station_id = str(station_id)
        self.station_name = str(station_name)
        self.parameters = dict(parameters)
        self.current_threshold_m = max(float(current_threshold_m), 1.0e-6)
        self.state_path = state_path
        self.ensemble_size = int(ensemble_size)
        self._unit_members = standardized_error_members(self.ensemble_size)
        self.innovation_gate_sigma = float(innovation_gate_sigma)
        self._lock = RLock()
        self.states = {
            lead: LeadRuntimeState(
                mean=0.0,
                variance=max(parameter.init_variance, 0.0),
            )
            for lead, parameter in self.parameters.items()
        }
        self.ledger: dict[str, dict[str, Any]] = {}
        if state_path is not None and state_path.exists():
            self._load_state()

    @classmethod
    def from_research_outputs(
        cls,
        station_id: str,
        station_name: str,
        selection_csv: Path,
        prediction_cache_csv: Path,
        state_path: Path | None = None,
        ensemble_size: int = 101,
        innovation_gate_sigma: float = 4.0,
    ) -> "OperationalExtremeSelectiveDA":
        selections = pd.read_csv(selection_csv)
        if selections.empty:
            raise ValueError(f"No selections in {selection_csv}")
        latest_year = int(selections["evaluation_year"].max())
        latest = selections[selections["evaluation_year"] == latest_year].copy()

        cache = pd.read_csv(prediction_cache_csv)
        cache["t0"] = pd.to_datetime(cache["t0"])
        calibration = cache["t0"].dt.year.isin([2016, 2017]).to_numpy()
        if calibration.sum() < 100:
            raise ValueError(f"Insufficient 2016-2017 calibration data in {prediction_cache_csv}")

        current = cache["surge_t0"].to_numpy(dtype=float)
        current_threshold = float(np.nanquantile(current[calibration], 0.95))
        parameters: dict[int, LeadRuntimeParameters] = {}
        for lead in LEAD_HOURS:
            selected = latest[latest["lead_hours"].astype(int) == lead]
            if len(selected) != 1:
                raise ValueError(
                    f"Expected one latest selection for {station_id} +{lead} h; "
                    f"found {len(selected)}"
                )
            row = selected.iloc[0]
            error = (
                cache[f"observed_{lead}h"].to_numpy(dtype=float)
                - cache[f"ml_{lead}h"].to_numpy(dtype=float)
            )
            ml_sigma = max(float(np.sqrt(np.nanmean(error[calibration] ** 2))), 1.0e-6)
            parameters[lead] = LeadRuntimeParameters(
                lead_hours=lead,
                enabled=str(row["enabled"]).strip().lower() == "true",
                gate_name=str(row["gate_name"]),
                phi=_finite(row["phi"]),
                q_variance=max(_finite(row["q_variance"]), 0.0),
                r_variance=max(_finite(row["r_variance"], ml_sigma**2), 1.0e-12),
                init_variance=max(_finite(row["init_variance"]), 0.0),
                sigma_scale=max(_finite(row["sigma_calibration_scale"], 1.0), 1.0e-6),
                extreme_threshold_m=max(_finite(row["extreme_threshold_m"]), 1.0e-6),
                ml_sigma_m=ml_sigma,
            )

        return cls(
            station_id=station_id,
            station_name=station_name,
            parameters=parameters,
            current_threshold_m=current_threshold,
            state_path=state_path,
            ensemble_size=ensemble_size,
            innovation_gate_sigma=innovation_gate_sigma,
        )

    def _ensure_members(self, state: LeadRuntimeState) -> np.ndarray:
        if state.members is None:
            state.members = state.mean + np.sqrt(max(state.variance, 0.0)) * self._unit_members
        return state.members

    def _advance_to(self, lead: int, target: datetime) -> None:
        parameter = self.parameters[lead]
        state = self.states[lead]
        members = self._ensure_members(state)
        if state.last_step_at is None:
            state.last_step_at = target
            return
        elapsed_hours = int((target - state.last_step_at).total_seconds() // 3600)
        if elapsed_hours <= 0:
            return
        if not parameter.enabled:
            state.mean = 0.0
            state.variance = 0.0
            members[:] = 0.0
        else:
            phi = parameter.phi
            phi_power = phi**elapsed_hours
            if abs(1.0 - phi**2) < 1.0e-12:
                accumulated_q = elapsed_hours * parameter.q_variance
            else:
                accumulated_q = (
                    parameter.q_variance
                    * (1.0 - phi ** (2 * elapsed_hours))
                    / (1.0 - phi**2)
                )
            state.mean, state.variance, _, _, _ = square_root_member_step(
                members, phi_power, accumulated_q, parameter.r_variance,
                np.nan, self.innovation_gate_sigma, self._unit_members, 1.0e-12)
        state.last_step_at += timedelta(hours=elapsed_hours)

    def _assimilate(self, lead: int, matured_error: float, observed_at: datetime) -> None:
        parameter = self.parameters[lead]
        state = self.states[lead]
        self._advance_to(lead, observed_at)
        if not parameter.enabled or not math.isfinite(matured_error):
            return
        state.mean, state.variance, nis, accepted, gain = square_root_member_step(
            self._ensure_members(state), 1.0, 0.0, parameter.r_variance,
            matured_error, self.innovation_gate_sigma, self._unit_members)
        if accepted:
            state.updates += 1
        state.last_nis = nis
        state.last_gain = gain
        state.last_update_accepted = accepted

    def assimilate_observation(
        self,
        observed_at: str | datetime | None,
        observed_surge_m: float | None,
    ) -> list[dict[str, Any]]:
        return self.assimilate_observations([(observed_at, observed_surge_m)])

    def assimilate_observations(
        self,
        observations: list[tuple[str | datetime | None, float | None]],
    ) -> list[dict[str, Any]]:
        valid = [
            (_utc_hour(observed_at), float(observed_surge_m))
            for observed_at, observed_surge_m in observations
            if observed_surge_m is not None
            and math.isfinite(float(observed_surge_m))
        ]
        if not valid:
            return []
        valid.sort(key=lambda item: item[0])
        updates = []
        with self._lock:
            for target_hour, observed_surge_m in valid:
                for lead in LEAD_HOURS:
                    key = f"{target_hour.isoformat()}|{lead}"
                    issued = self.ledger.get(key)
                    if issued is None or issued.get("assimilated"):
                        continue
                    error = observed_surge_m - float(issued["ml_surge_m"])
                    self._assimilate(lead, error, target_hour)
                    issued["assimilated"] = True
                    updates.append(
                        {
                            "lead_hours": lead,
                            "observed_at": target_hour.isoformat(),
                            "matured_error_m": error,
                            "accepted": self.states[lead].last_update_accepted,
                            "nis": self.states[lead].last_nis,
                        }
                    )
            self._prune_ledger(valid[-1][0])
            self._save_state()
        return updates

    def _gate_active(
        self,
        parameter: LeadRuntimeParameters,
        lead_index: int,
        ml_surge_m: np.ndarray,
        current_surge_m: float,
    ) -> bool:
        if not parameter.enabled or parameter.gate_name == "never":
            return False
        name, _, suffix = parameter.gate_name.partition("_")
        ratio = _finite(suffix, 100.0) / 100.0
        thresholds = np.asarray(
            [self.parameters[lead].extreme_threshold_m for lead in LEAD_HOURS],
            dtype=float,
        )
        own_severity = ml_surge_m[lead_index] / thresholds[lead_index]
        system_severity = float(np.nanmax(ml_surge_m / thresholds))
        observed_severity = current_surge_m / self.current_threshold_m
        if name == "own":
            severity = own_severity
        elif name == "system":
            severity = system_severity
        elif name == "risk":
            severity = max(system_severity, observed_severity)
        elif name == "always":
            return True
        else:
            return False
        return bool(severity >= ratio)

    def forecast(
        self,
        ml_surge_m: list[float] | np.ndarray,
        current_surge_m: float,
        issued_at: str | datetime | None,
    ) -> dict[str, Any]:
        ml = np.asarray(ml_surge_m, dtype=float).reshape(-1)
        if ml.size != len(LEAD_HOURS):
            raise ValueError(f"Expected {len(LEAD_HOURS)} lead predictions; got {ml.size}")
        issue_hour = _utc_hour(issued_at)

        with self._lock:
            for lead in LEAD_HOURS:
                self._advance_to(lead, issue_hour)

            active: list[bool] = []
            means: list[float] = []
            sigmas: list[float] = []
            corrections: list[float] = []
            ml_sigmas: list[float] = []
            gates: list[str] = []
            updates: list[int] = []
            nis: list[float | None] = []
            gains: list[float | None] = []
            accepted: list[bool | None] = []

            for index, lead in enumerate(LEAD_HOURS):
                parameter = self.parameters[lead]
                state = self.states[lead]
                is_active = self._gate_active(
                    parameter,
                    index,
                    ml,
                    float(current_surge_m),
                )
                correction = state.mean if is_active else 0.0
                if is_active:
                    sigma = (
                        math.sqrt(max(state.variance + parameter.r_variance, 1.0e-12))
                        * parameter.sigma_scale
                    )
                else:
                    sigma = parameter.ml_sigma_m
                active.append(is_active)
                corrections.append(correction)
                means.append(float(ml[index] + correction))
                sigmas.append(float(sigma))
                ml_sigmas.append(parameter.ml_sigma_m)
                gates.append(parameter.gate_name)
                updates.append(state.updates)
                nis.append(state.last_nis)
                gains.append(state.last_gain)
                accepted.append(state.last_update_accepted)

                valid_at = issue_hour + timedelta(hours=lead)
                key = f"{valid_at.isoformat()}|{lead}"
                self.ledger[key] = {
                    "issued_at": issue_hour.isoformat(),
                    "valid_at": valid_at.isoformat(),
                    "lead_hours": lead,
                    "ml_surge_m": float(ml[index]),
                    "assimilated": False,
                }

            z_values = np.asarray(
                [
                    NORMAL.inv_cdf((index + 0.5) / self.ensemble_size)
                    for index in range(self.ensemble_size)
                ],
                dtype=float,
            )
            mean_array = np.asarray(means)
            sigma_array = np.asarray(sigmas)
            members = mean_array[None, :] + z_values[:, None] * sigma_array[None, :]
            p05 = mean_array + NORMAL.inv_cdf(0.05) * sigma_array
            p10 = mean_array + NORMAL.inv_cdf(0.10) * sigma_array
            p50 = mean_array
            p90 = mean_array + NORMAL.inv_cdf(0.90) * sigma_array
            p95 = mean_array + NORMAL.inv_cdf(0.95) * sigma_array

            self._prune_ledger(issue_hour)
            self._save_state()

        return {
            "station_id": self.station_id,
            "station_name": self.station_name,
            "lead_times": list(LEAD_HOURS),
            "issued_at": issue_hour.isoformat(),
            "model": "XGBoost + Extreme-aware DA (ML-centered EnKF)",
            "ml_surge_m": ml.tolist(),
            "surge_m": mean_array.tolist(),
            "da_correction_m": corrections,
            "sigma_m": sigmas,
            "ml_sigma_m": ml_sigmas,
            "p05_m": p05.tolist(),
            "p10_m": p10.tolist(),
            "p50_m": p50.tolist(),
            "p90_m": p90.tolist(),
            "p95_m": p95.tolist(),
            "surge_members_m": members.tolist(),
            "ensemble_size": self.ensemble_size,
            "filter_formulation": "deterministic_ensemble_square_root",
            "ensemble_strategy": "stratified_comonotonic_gaussian",
            "da_active": active,
            "gate_name": gates,
            "state_updates": updates,
            "last_nis": nis,
            "last_gain": gains,
            "last_update_accepted": accepted,
            "parameter_vintage": "latest rolling-origin selection (2025 evaluation fold)",
        }

    def _prune_ledger(self, reference: datetime) -> None:
        oldest = reference - timedelta(days=8)
        self.ledger = {
            key: row
            for key, row in self.ledger.items()
            if _utc_hour(row["valid_at"]) >= oldest
        }

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "station_id": self.station_id,
                "station_name": self.station_name,
                "current_threshold_m": self.current_threshold_m,
                "ensemble_size": self.ensemble_size,
                "ledger_entries": len(self.ledger),
                "leads": {
                    str(lead): {
                        "parameters": self.parameters[lead].__dict__,
                        "state": {
                            **self.states[lead].__dict__,
                            "members": (self.states[lead].members.tolist()
                                        if self.states[lead].members is not None else None),
                            "last_step_at": (
                                self.states[lead].last_step_at.isoformat()
                                if self.states[lead].last_step_at
                                else None
                            ),
                        },
                    }
                    for lead in LEAD_HOURS
                },
            }

    def _save_state(self) -> None:
        if self.state_path is None:
            return
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "states": {
                str(lead): {
                    **state.__dict__,
                    "members": state.members.tolist() if state.members is not None else None,
                    "last_step_at": (
                        state.last_step_at.isoformat()
                        if state.last_step_at is not None
                        else None
                    ),
                }
                for lead, state in self.states.items()
            },
            "ledger": self.ledger,
        }
        temporary = self.state_path.with_suffix(self.state_path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        # Windows sync/indexing can briefly hold the destination open.
        for attempt in range(6):
            try:
                temporary.replace(self.state_path)
                break
            except PermissionError:
                if attempt == 5:
                    raise
                time.sleep(0.05 * (attempt + 1))

    def _load_state(self) -> None:
        payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        for lead in LEAD_HOURS:
            saved = payload.get("states", {}).get(str(lead))
            if not saved:
                continue
            self.states[lead] = LeadRuntimeState(
                mean=_finite(saved.get("mean")),
                variance=max(_finite(saved.get("variance")), 0.0),
                last_step_at=(
                    _utc_hour(saved["last_step_at"])
                    if saved.get("last_step_at")
                    else None
                ),
                updates=int(saved.get("updates", 0)),
                last_nis=(
                    _finite(saved["last_nis"])
                    if saved.get("last_nis") is not None
                    else None
                ),
                last_gain=(
                    _finite(saved["last_gain"])
                    if saved.get("last_gain") is not None
                    else None
                ),
                last_update_accepted=saved.get("last_update_accepted"),
            )
        self.ledger = dict(payload.get("ledger", {}))
        for lead in LEAD_HOURS:
            saved = payload.get("states", {}).get(str(lead), {})
            values = saved.get("members")
            if values is not None:
                members = np.asarray(values, dtype=float)
                if members.shape == (self.ensemble_size,) and np.all(np.isfinite(members)):
                    self.states[lead].members = members
                    self.states[lead].mean = float(np.mean(members))
                    self.states[lead].variance = float(np.var(members, ddof=1))


def load_operational_runtimes(
    workspace: Path,
    state_directory: Path,
    ensemble_size: int = 101,
) -> dict[str, OperationalExtremeSelectiveDA]:
    config = json.loads(
        (workspace / "EMS" / "da_extreme_config_v2.json").read_text(encoding="utf-8")
    )
    result = {}
    for station in config["stations"]:
        station_id = str(station["id"])
        result[station_id] = OperationalExtremeSelectiveDA.from_research_outputs(
            station_id=station_id,
            station_name=str(station["name"]),
            selection_csv=(
                workspace
                / "EMS"
                / "results_da_extreme_v2"
                / station_id
                / "rolling_selections_extreme_enkf_v2.csv"
            ),
            prediction_cache_csv=(
                workspace
                / "EMS"
                / "cache_da_v1"
                / f"{station_id}_xgboost_predictions_v1.csv"
            ),
            state_path=state_directory / f"{station_id}_operational_da_state_v1.json",
            ensemble_size=ensemble_size,
            innovation_gate_sigma=float(config.get("gate_sigma", 4.0)),
        )
    return result
