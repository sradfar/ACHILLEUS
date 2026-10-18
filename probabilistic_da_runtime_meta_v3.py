"""Operational selective DA centered on the ACHILLEUS meta-stack forecast."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Any
import json

from probabilistic_da_runtime_v1 import (
    LEAD_HOURS,
    LeadRuntimeState,
    OperationalExtremeSelectiveDA,
)


class OperationalMetaStackSelectiveDA(OperationalExtremeSelectiveDA):
    """Meta-stack-specific labeling and safe reset after model promotion."""

    def forecast(self, *args, **kwargs) -> dict[str, Any]:
        result = super().forecast(*args, **kwargs)
        result["model"] = "Ensemble meta-stack + extreme-selective error-state EnKF"
        result["prior_model"] = "Ensemble_v2 meta-stack"
        result["parameter_vintage"] = (
            "meta-stack rolling-origin selection (2025 evaluation fold)"
        )
        return result

    def reset_after_model_promotion(
        self,
        ml_sigma_by_lead: dict[int, float] | None = None,
    ) -> None:
        """Clear states tied to the old model and optionally refresh ML spread."""

        with self._lock:
            if ml_sigma_by_lead:
                self.parameters = {
                    lead: replace(
                        parameter,
                        ml_sigma_m=max(
                            float(ml_sigma_by_lead.get(lead, parameter.ml_sigma_m)),
                            1.0e-6,
                        ),
                    )
                    for lead, parameter in self.parameters.items()
                }
            self.states = {
                lead: LeadRuntimeState(
                    mean=0.0,
                    variance=max(parameter.init_variance, 0.0),
                )
                for lead, parameter in self.parameters.items()
            }
            self.ledger = {}
            self._save_state()


def load_meta_stack_operational_runtimes(
    workspace: Path,
    state_directory: Path,
    ensemble_size: int = 101,
) -> dict[str, OperationalMetaStackSelectiveDA]:
    config = json.loads(
        (workspace / "EMS" / "da_extreme_meta_config_v3.json").read_text(
            encoding="utf-8"
        )
    )
    result = {}
    for station in config["stations"]:
        station_id = str(station["id"])
        result[station_id] = OperationalMetaStackSelectiveDA.from_research_outputs(
            station_id=station_id,
            station_name=str(station["name"]),
            selection_csv=(
                workspace
                / "EMS"
                / "results_da_extreme_meta_v3"
                / station_id
                / "rolling_selections_meta_stack_selective_enkf_v3.csv"
            ),
            prediction_cache_csv=(
                workspace
                / "EMS"
                / "cache_da_meta_v3"
                / f"{station_id}_meta_stack_predictions_v3.csv"
            ),
            state_path=state_directory
            / f"{station_id}_meta_stack_operational_da_state_v3.json",
            ensemble_size=ensemble_size,
            innovation_gate_sigma=float(config.get("gate_sigma", 4.0)),
        )
    return result

