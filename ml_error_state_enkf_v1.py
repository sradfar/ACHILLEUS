"""Causal ML-centered error-state ensemble Kalman filter.

The state is the additive error of an ML forecast, not water level itself:

    corrected_forecast(t, h) = ml_forecast(t, h) + bias_state(t, h)

At issue time ``t``, the only assimilated quantities are errors from older ML
forecasts that are already verifiable:

    observed_error(t, h) = observed_surge(t) - ml_forecast(t-h, h)

This makes the update causal and directly connected to the ML forecast.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable
from statistics import NormalDist

import numpy as np


@dataclass
class LeadParameters:
    """Frozen state-space parameters for one forecast lead."""

    lead_hours: int
    phi: float
    q_variance: float
    r_variance: float
    init_variance: float
    enabled: bool
    q_scale: float
    r_scale: float
    validation_rmse_ml: float
    validation_rmse_da: float

    def to_dict(self) -> dict:
        return asdict(self)


def _finite_variance(values: np.ndarray, floor: float = 1.0e-6) -> float:
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if values.size < 2:
        return floor
    return max(float(np.var(values, ddof=1)), floor)


def estimate_base_parameters(
    errors: np.ndarray,
    lead_hours: int,
    variance_floor: float = 1.0e-6,
) -> LeadParameters:
    """Estimate conservative AR(1) bias-state parameters from calibration errors."""

    error = np.asarray(errors, dtype=float)
    pairs = np.isfinite(error[:-1]) & np.isfinite(error[1:])
    if pairs.sum() >= 20:
        previous = error[:-1][pairs]
        current = error[1:][pairs]
        if np.std(previous) > 0 and np.std(current) > 0:
            phi = float(np.corrcoef(previous, current)[0, 1])
        else:
            phi = 0.0
    else:
        phi = 0.0
    phi = float(np.clip(phi, 0.0, 0.995))

    total_variance = _finite_variance(error, variance_floor)
    differences = np.diff(error)
    difference_variance = _finite_variance(differences, variance_floor)

    # Half the first-difference variance estimates fast, nonpersistent error.
    # Bounds keep the filter conservative when this decomposition is uncertain.
    r_base = float(
        np.clip(
            0.5 * difference_variance,
            0.10 * total_variance,
            0.95 * total_variance,
        )
    )
    state_variance = max(total_variance - r_base, 0.05 * total_variance)
    q_base = max((1.0 - phi**2) * state_variance, variance_floor)

    return LeadParameters(
        lead_hours=int(lead_hours),
        phi=phi,
        q_variance=q_base,
        r_variance=r_base,
        init_variance=max(state_variance, variance_floor),
        enabled=True,
        q_scale=1.0,
        r_scale=1.0,
        validation_rmse_ml=np.nan,
        validation_rmse_da=np.nan,
    )


def run_scalar_kalman_mean(
    matured_errors: np.ndarray,
    phi: float,
    q_variance: float,
    r_variance: float,
    init_variance: float,
    gate_sigma: float = 4.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Run the exact scalar filter used to select EnKF hyperparameters."""

    observed_error = np.asarray(matured_errors, dtype=float)
    correction = np.zeros(observed_error.size, dtype=float)
    nis = np.full(observed_error.size, np.nan, dtype=float)
    mean = 0.0
    variance = max(float(init_variance), 1.0e-12)

    for index, observation in enumerate(observed_error):
        mean_forecast = phi * mean
        variance_forecast = phi**2 * variance + q_variance
        mean = mean_forecast
        variance = variance_forecast

        if np.isfinite(observation):
            innovation = observation - mean_forecast
            innovation_variance = variance_forecast + r_variance
            nis[index] = innovation**2 / max(innovation_variance, 1.0e-12)
            if abs(innovation) <= gate_sigma * np.sqrt(innovation_variance):
                gain = variance_forecast / max(innovation_variance, 1.0e-12)
                mean = mean_forecast + gain * innovation
                variance = max((1.0 - gain) * variance_forecast, 1.0e-12)
        correction[index] = mean

    return correction, nis


def tune_lead_parameters(
    matured_errors: np.ndarray,
    ml_forecast: np.ndarray,
    observed_future: np.ndarray,
    fit_mask: np.ndarray,
    tune_mask: np.ndarray,
    lead_hours: int,
    q_scales: Iterable[float] = (0.25, 0.5, 1.0, 2.0),
    r_scales: Iterable[float] = (0.5, 1.0, 2.0, 4.0),
    minimum_relative_improvement: float = 0.0025,
    gate_sigma: float = 4.0,
) -> LeadParameters:
    """Fit on calibration years and select a conservative setting on tuning years.

    A no-update candidate is always included. Therefore, if persistent forecast
    error is not demonstrated in the tuning period, the frozen test-period
    system retains the original ML point forecast.
    """

    error = np.asarray(matured_errors, dtype=float)
    prediction = np.asarray(ml_forecast, dtype=float)
    truth = np.asarray(observed_future, dtype=float)
    fit = np.asarray(fit_mask, dtype=bool)
    tune = (
        np.asarray(tune_mask, dtype=bool)
        & np.isfinite(prediction)
        & np.isfinite(truth)
    )
    if tune.sum() < 100:
        raise ValueError(
            f"Lead {lead_hours} h has only {int(tune.sum())} finite tuning rows."
        )

    base = estimate_base_parameters(error[fit], lead_hours)
    rmse_ml = float(np.sqrt(np.mean((prediction[tune] - truth[tune]) ** 2)))
    best_rmse = rmse_ml
    best = None

    for q_scale in q_scales:
        for r_scale in r_scales:
            q_variance = max(base.q_variance * float(q_scale), 1.0e-12)
            r_variance = max(base.r_variance * float(r_scale), 1.0e-12)
            correction, _ = run_scalar_kalman_mean(
                error,
                base.phi,
                q_variance,
                r_variance,
                base.init_variance,
                gate_sigma,
            )
            corrected = prediction + correction
            rmse = float(np.sqrt(np.mean((corrected[tune] - truth[tune]) ** 2)))
            if rmse < best_rmse:
                best_rmse = rmse
                best = (float(q_scale), float(r_scale), q_variance, r_variance)

    required_rmse = rmse_ml * (1.0 - minimum_relative_improvement)
    enabled = best is not None and best_rmse < required_rmse
    if enabled:
        q_scale, r_scale, q_variance, r_variance = best
    else:
        q_scale, r_scale = 0.0, 1.0
        q_variance = 0.0
        r_variance = _finite_variance(error[fit])
        best_rmse = rmse_ml

    return LeadParameters(
        lead_hours=int(lead_hours),
        phi=base.phi if enabled else 0.0,
        q_variance=q_variance,
        r_variance=r_variance,
        init_variance=base.init_variance if enabled else 0.0,
        enabled=bool(enabled),
        q_scale=q_scale,
        r_scale=r_scale,
        validation_rmse_ml=rmse_ml,
        validation_rmse_da=best_rmse,
    )


def standardized_error_members(ensemble_size: int) -> np.ndarray:
    """Deterministic, centered members with unit *sample* variance."""
    if ensemble_size < 3:
        raise ValueError("The error-state ensemble requires at least three members.")
    normal = NormalDist()
    members = np.array([normal.inv_cdf((i + 0.5) / ensemble_size)
                        for i in range(ensemble_size)], dtype=float)
    for i in range(ensemble_size // 2):
        members[ensemble_size - 1 - i] = -members[i]
    if ensemble_size % 2:
        members[ensemble_size // 2] = 0.0
    members /= np.std(members, ddof=1)
    return members


def square_root_member_step(members, phi, q_variance, r_variance,
                            observation, gate_sigma, unit_members,
                            forecast_floor=0.0):
    """Forecast and analyze the maintained scalar ensemble, in place.

    The deterministic forecast transform represents additive Q in the sample
    covariance without random perturbations. The gain is calculated from the
    transformed members, and the analysis updates their mean and anomalies.
    The scalar ensemble spans the full state space; Q has no unresolved part.
    Explicit loops also permit optional compilation of the identical kernel.
    """
    count = members.size
    mean = 0.0
    for i in range(count // 2):
        mean += members[i] + members[count-1-i]
    if count % 2:
        mean += members[count//2]
    mean /= count
    variance = 0.0
    for i in range(count):
        variance += (members[i] - mean) ** 2
    variance /= count - 1
    forecast_mean = phi * mean
    target_variance = max(phi * phi * variance + q_variance, forecast_floor)
    if variance > 0.0 and phi != 0.0:
        scale = np.sqrt(target_variance / variance)
        if phi < 0.0:
            scale = -scale
        for i in range(count):
            members[i] = forecast_mean + scale * (members[i] - mean)
    else:
        for i in range(count):
            members[i] = forecast_mean + np.sqrt(target_variance) * unit_members[i]

    # Both the gain and innovation use actual forecast ensemble statistics.
    mean = 0.0
    for i in range(count // 2):
        mean += members[i] + members[count-1-i]
    if count % 2:
        mean += members[count//2]
    mean /= count
    variance = 0.0
    for i in range(count):
        variance += (members[i] - mean) ** 2
    variance /= count - 1
    nis, gain, accepted = np.nan, np.nan, False
    if np.isfinite(observation):
        innovation = observation - mean
        innovation_variance = max(variance + r_variance, 1.0e-12)
        nis = innovation * innovation / innovation_variance
        gain = variance / innovation_variance
        if abs(innovation) <= gate_sigma * np.sqrt(innovation_variance):
            analysis_mean = mean + gain * innovation
            analysis_variance = max((1.0 - gain) * variance, 1.0e-12)
            if variance > 0.0:
                scale = np.sqrt(analysis_variance / variance)
                for i in range(count):
                    members[i] = analysis_mean + scale * (members[i] - mean)
            else:
                for i in range(count):
                    members[i] = analysis_mean + np.sqrt(analysis_variance) * unit_members[i]
            accepted = True
    mean = 0.0
    for i in range(count // 2):
        mean += members[i] + members[count-1-i]
    if count % 2:
        mean += members[count//2]
    mean /= count
    variance = 0.0
    for i in range(count):
        variance += (members[i] - mean) ** 2
    variance /= count - 1
    return mean, variance, nis, accepted, gain


def _member_series_kernel(observations, members, phi, q, r, gate_sigma,
                          unit_members, step):
    mean = np.empty(observations.size)
    variance = np.empty(observations.size)
    nis = np.empty(observations.size)
    accepted = np.empty(observations.size, dtype=np.bool_)
    for i in range(observations.size):
        mean[i], variance[i], nis[i], accepted[i], _ = step(
            members, phi, q, r, observations[i], gate_sigma, unit_members, 0.0)
    return mean, variance, nis, accepted


_COMPILED_MEMBER_SERIES = None


def run_deterministic_ensemble_series(observations, parameter, gate_sigma=4.0,
                                      ensemble_size=200, accelerated=True):
    """Member-based scalar EnSRF, with an optional numerically identical JIT."""
    global _COMPILED_MEMBER_SERIES
    observations = np.asarray(observations, dtype=float)
    unit = standardized_error_members(ensemble_size)
    members = unit * np.sqrt(max(float(parameter.init_variance), 0.0))
    kernel, step = _member_series_kernel, square_root_member_step
    if accelerated:
        try:
            from numba import njit
        except ImportError:
            pass
        else:
            if _COMPILED_MEMBER_SERIES is None:
                _COMPILED_MEMBER_SERIES = (njit(cache=False)(_member_series_kernel),
                                           njit(cache=False)(square_root_member_step))
            kernel, step = _COMPILED_MEMBER_SERIES
    arrays = kernel(observations, members, float(parameter.phi),
                    float(parameter.q_variance), float(parameter.r_variance),
                    float(gate_sigma), unit, step)
    return dict(zip(('mean', 'variance', 'nis', 'accepted'), arrays))


class MLErrorStateEnKF:
    """Five independent lead-specific scalar square-root EnKFs."""

    def __init__(
        self,
        parameters: list[LeadParameters],
        ensemble_size: int = 200,
        random_seed: int = 42,
        gate_sigma: float = 4.0,
    ):
        if ensemble_size < 20:
            raise ValueError("ensemble_size must be at least 20.")
        self.parameters = list(parameters)
        self.ensemble_size = int(ensemble_size)
        self.gate_sigma = float(gate_sigma)
        self.rng = np.random.default_rng(random_seed)
        self.state = np.zeros((self.ensemble_size, len(self.parameters)), dtype=float)
        for column, parameter in enumerate(self.parameters):
            if parameter.enabled and parameter.init_variance > 0:
                self.state[:, column] = self.rng.normal(
                    0.0,
                    np.sqrt(parameter.init_variance),
                    self.ensemble_size,
                )
                self.state[:, column] -= self.state[:, column].mean()

    def step(
        self,
        ml_forecast: np.ndarray,
        matured_error: np.ndarray,
    ) -> dict[str, np.ndarray]:
        """Assimilate available matured errors and correct the new ML forecast."""

        ml = np.asarray(ml_forecast, dtype=float)
        observation = np.asarray(matured_error, dtype=float)
        if ml.shape != (len(self.parameters),):
            raise ValueError("ml_forecast has the wrong number of lead times.")

        correction = np.zeros(len(self.parameters), dtype=float)
        nis = np.full(len(self.parameters), np.nan, dtype=float)
        accepted = np.zeros(len(self.parameters), dtype=bool)

        for column, parameter in enumerate(self.parameters):
            if not parameter.enabled:
                self.state[:, column] = 0.0
                continue

            forecast_ensemble = (
                parameter.phi * self.state[:, column]
                + self.rng.normal(
                    0.0,
                    np.sqrt(parameter.q_variance),
                    self.ensemble_size,
                )
            )
            mean_forecast = float(forecast_ensemble.mean())
            anomaly = forecast_ensemble - mean_forecast
            forecast_variance = float(
                np.dot(anomaly, anomaly) / (self.ensemble_size - 1)
            )
            self.state[:, column] = forecast_ensemble

            if np.isfinite(observation[column]):
                innovation = float(observation[column] - mean_forecast)
                innovation_variance = forecast_variance + parameter.r_variance
                nis[column] = innovation**2 / max(innovation_variance, 1.0e-12)
                if (
                    abs(innovation)
                    <= self.gate_sigma * np.sqrt(innovation_variance)
                ):
                    gain = forecast_variance / max(innovation_variance, 1.0e-12)
                    mean_analysis = mean_forecast + gain * innovation
                    # Deterministic square-root update preserves the exact mean.
                    analysis_anomaly = np.sqrt(max(1.0 - gain, 0.0)) * anomaly
                    self.state[:, column] = mean_analysis + analysis_anomaly
                    accepted[column] = True
            correction[column] = float(self.state[:, column].mean())

        point = ml + correction
        predictive = np.empty_like(self.state)
        for column, parameter in enumerate(self.parameters):
            residual = self.rng.normal(
                0.0,
                np.sqrt(max(parameter.r_variance, 1.0e-12)),
                self.ensemble_size,
            )
            residual -= residual.mean()
            predictive[:, column] = (
                ml[column] + self.state[:, column] + residual
            )

        return {
            "point": point,
            "correction": correction,
            "predictive_ensemble": predictive,
            "p05": np.percentile(predictive, 5.0, axis=0),
            "p95": np.percentile(predictive, 95.0, axis=0),
            "nis": nis,
            "accepted": accepted,
        }


def ensemble_crps(ensemble: np.ndarray, observation: float) -> float:
    """Continuous ranked probability score for a finite ensemble."""

    members = np.sort(np.asarray(ensemble, dtype=float))
    members = members[np.isfinite(members)]
    if members.size == 0 or not np.isfinite(observation):
        return np.nan
    n_members = members.size
    first_term = float(np.mean(np.abs(members - observation)))
    coefficients = 2.0 * np.arange(n_members) - n_members + 1.0
    second_term = float(np.dot(coefficients, members) / (n_members**2))
    return first_term - second_term


def deterministic_metrics(
    observed: np.ndarray,
    predicted: np.ndarray,
) -> dict[str, float]:
    observed = np.asarray(observed, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    mask = np.isfinite(observed) & np.isfinite(predicted)
    if not mask.any():
        return {"n": 0, "rmse": np.nan, "mae": np.nan, "bias": np.nan}
    error = predicted[mask] - observed[mask]
    return {
        "n": int(mask.sum()),
        "rmse": float(np.sqrt(np.mean(error**2))),
        "mae": float(np.mean(np.abs(error))),
        "bias": float(np.mean(error)),
    }
