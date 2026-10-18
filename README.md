# ACHILLEUS

Coastal observations, probabilistic surge forecasting, ensemble data assimilation, rapid connected inundation mapping, and first-order residential impact screening.

## Workspaces

- **Overview:** current NOAA water levels, tides and surge residuals.
- **Timeseries:** live and historical water-level and surge charts. Every temporal chart supports inspection by mouse, touch or keyboard, with UTC timestamps and values.
- **Weather:** hourly National Weather Service forecasts.
- **Forecast:** four-model meta-stack predictions at 6, 12, 24, 48 and 72 hours, with extreme-aware error-state EnKF updating.
- **Probabilistic:** 101 forecast members, uncertainty bounds and assimilation diagnostics. Historical mode provides saved 2020–2025 rolling-origin DA replay.
- **Impact:** MSCC or c-HAND connected flood masks, datum-consistent depths, county-scaled exposure proxies and residential NSI record-level loss screening.

The six stations are Galveston Pier 21, Sewells Point, The Battery, Boston, Atlantic City and St. Petersburg. Light and dark themes use the ACHILLEUS logo palette. Hover over a time-series chart to inspect data; use Tab and the left/right arrow keys for keyboard access.

## Run

Use Python 3.11:

```sh
pip install -r requirements.txt
streamlit run app.py
```

The built React interface is included in `frontend/dist`; Node.js is not needed to run the app. To rebuild the interface, use Node.js 22.12 or newer, then run `npm install` and `npm run build` in `frontend`.

Models and elevation grids are downloaded on demand from this repository's `models-v1` release. SHA-256 manifests accompany the source. A station's first forecast requires a model download of approximately 0.7–1.5 GB; later forecasts reuse local cached assets. The compact forest representation retains all fitted trees and float64 leaf values. Conversion checks reproduced the original forest predictions exactly at all six stations.

## Data and interpretation

Operational predictors use verified NOAA CO-OPS observations and GFS meteorology retrieved through Open-Meteo. NWS provides the weather workspace. Elevation inputs use AWS Terrain Tiles and USGS 3DEP. Public NSI residential records and Census 2020 county totals support impact screening. No provider API keys are required.

Terrain and water levels are converted to a common vertical datum before flood depths are calculated. Flood statistics use the complete selected-resolution raster; map previews are sampled for browser display. Residential loss is summed from local inundation depths and each exposed record's reported structure value. The generic depth–damage relationship and population/housing area scaling remain screening approximations.

Live EnKF and challenger state is isolated by browser session. It is not a persistent, shared production learning service; restarting or disconnecting a session resets its live state. Historical replay reads saved evaluation results without updating live state. Forecast and impact uncertainty is conditional on the forecast water-level ensemble; it does not quantify all terrain, inventory, damage-curve or flood-model uncertainty. Results support research and rapid screening and should not replace official warnings or site-specific hydraulic assessment.
