# Historical replay

Each station-year NPZ stores saved hourly rolling-origin evaluation records for 2020–2025. Lead-specific arrays retain observations, meta-stack forecasts, selected DA forecasts, uncertainties, gate activity and observed extremes. Station selection CSV files in the parent directory identify the frozen evaluation-year gate choices. These files are read without pickle and never update a visitor's live assimilation or challenger state.
