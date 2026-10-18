/** Physical still-water depth: both elevations must use the same datum. */
export function floodDepthV5(terrainElevation, waterSurface) {
  if (!Number.isFinite(terrainElevation) || !Number.isFinite(waterSurface)) return 0
  return Math.max(0, waterSurface - terrainElevation)
}

export function quantileV5(values, probability) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b)
  if (!sorted.length) return Number.NaN
  const position = (sorted.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  const fraction = position - lower
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction
}

export function formatNoaaUtcV5(date) {
  const value = new Date(date)
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid NOAA request date.")
  const pad = number => String(number).padStart(2, "0")
  return `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`
}

export function floorUtcHourV5(date = new Date()) {
  const value = new Date(date)
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid forecast origin.")
  value.setUTCMinutes(0, 0, 0)
  return value
}

function parsedTideV5(tideForecast) {
  return (tideForecast ?? []).map(item => ({
    time: new Date(item?.t).getTime(),
    value: Number(item?.v),
  })).filter(item => Number.isFinite(item.time) && Number.isFinite(item.value))
}

export function tideAtLeadV5(tideForecast, leadHours, issuedAt) {
  const origin = new Date(issuedAt).getTime()
  if (!Number.isFinite(origin)) throw new Error("Forecast issue time is unavailable.")
  const target = origin + Number(leadHours) * 3600 * 1000
  const closest = parsedTideV5(tideForecast).reduce((best, item) => {
    const distance = Math.abs(item.time - target)
    return !best || distance < best.distance ? { ...item, distance } : best
  }, null)
  if (!closest || closest.distance > 31 * 60 * 1000) {
    throw new Error(`No hourly NOAA tide prediction matches the +${leadHours} h valid time.`)
  }
  return closest.value
}

export function alignHourlyTideV5(tideForecast, issuedAt, hours = 72) {
  const origin = new Date(issuedAt).getTime()
  if (!Number.isFinite(origin)) throw new Error("Forecast issue time is unavailable.")
  return Array.from({ length: hours }, (_, index) => {
    const lead = index + 1
    return {
      t: new Date(origin + lead * 3600 * 1000).toISOString(),
      v: tideAtLeadV5(tideForecast, lead, issuedAt),
    }
  })
}

export function totalWaterLevelAtLeadsV5(surgeValues, leads, tideForecast, issuedAt) {
  return leads.map((lead, index) => tideAtLeadV5(tideForecast, lead, issuedAt) + surgeValues[index])
}

export function peakWaterLevelMembersV5(probabilisticResult, tideForecast) {
  if (!probabilisticResult?.surge_members_m?.length) return []
  const issuedAt = probabilisticResult.issued_at ?? probabilisticResult.t0
  return probabilisticResult.surge_members_m.map(member =>
    Math.max(...totalWaterLevelAtLeadsV5(
      member, probabilisticResult.lead_times, tideForecast, issuedAt,
    )),
  )
}

/** Reconstruct the stored historical DA distribution without modifying live state. */
export function buildHistoricalReplayForecastV5(record, replayMetadata) {
  if (!record?.surge_m?.length || !record?.sigma_m?.length) return null
  const zQuantiles = replayMetadata?.ensemble_z_quantiles ?? []
  if (!zQuantiles.length) return null
  return {
    issued_at: record.t0,
    t0: record.t0,
    lead_times: replayMetadata.lead_times,
    ml_surge_m: record.ml_surge_m,
    surge_m: record.surge_m,
    sigma_m: record.sigma_m,
    da_active: record.da_active,
    ensemble_size: zQuantiles.length,
    ensemble_strategy: replayMetadata.ensemble_strategy,
    surge_members_m: zQuantiles.map(z =>
      record.surge_m.map((mean, index) => mean + z * record.sigma_m[index]),
    ),
    forecast_model: "Historical extreme-aware DA replay",
  }
}

function summarizeV5(records, key) {
  const values = records.map(record => record[key]).filter(Number.isFinite)
  return {
    p10: quantileV5(values, 0.10),
    p50: quantileV5(values, 0.50),
    p90: quantileV5(values, 0.90),
  }
}

function roundedWaterLevelV5(value, binSize) {
  return Math.round(value / binSize) * binSize
}

/** Propagate time-aligned extreme-aware-DA members through hazard and impact. */
export async function propagateHazardImpactV5({
  probabilisticResult,
  tideForecast,
  elevationGrid,
  stationId,
  census,
  structureValue,
  floodMethod,
  runFloodModel,
  calculateImpact,
  waterLevelBinM = 0.05,
  onProgress = () => {},
}) {
  const peakMembers = peakWaterLevelMembersV5(probabilisticResult, tideForecast)
  if (!peakMembers.length) throw new Error("No extreme-aware-DA surge members are available.")

  const binned = peakMembers.map(value => roundedWaterLevelV5(value, waterLevelBinM))
  const uniqueLevels = [...new Set(binned)].sort((a, b) => a - b)
  const responseCache = new Map()
  for (let index = 0; index < uniqueLevels.length; index += 1) {
    const waterLevel = uniqueLevels[index]
    const hazard = runFloodModel(elevationGrid, waterLevel, stationId, { method: floodMethod })
    const impact = calculateImpact(hazard, census, structureValue)
    responseCache.set(waterLevel, { hazard, impact })
    onProgress(Math.round(((index + 1) / uniqueLevels.length) * 100))
    if (index % 3 === 2) await new Promise(resolve => setTimeout(resolve, 0))
  }

  const hazards = binned.map(value => responseCache.get(value).hazard)
  const impacts = binned.map(value => responseCache.get(value).impact)
  const peakQuantiles = {
    p10: quantileV5(peakMembers, 0.10),
    p50: quantileV5(peakMembers, 0.50),
    p90: quantileV5(peakMembers, 0.90),
  }
  const representativeP50 = runFloodModel(elevationGrid, peakQuantiles.p50, stationId, { method: floodMethod })
  const representativeP90 = runFloodModel(elevationGrid, peakQuantiles.p90, stationId, { method: floodMethod })

  const probability = new Map()
  binned.forEach((waterLevel, memberIndex) => {
    const hazard = hazards[memberIndex]
    hazard.flooded.forEach(cell => {
      const key = `${cell.lat.toFixed(7)}|${cell.lon.toFixed(7)}`
      const current = probability.get(key) ?? { lat: cell.lat, lon: cell.lon, flood: 0, depth03: 0, depth10: 0 }
      current.flood += 1
      if (cell.depth > 0.3) current.depth03 += 1
      if (cell.depth > 1.0) current.depth10 += 1
      probability.set(key, current)
    })
  })

  const denominator = peakMembers.length
  const probabilityCells = [...probability.values()].map(cell => ({
    lat: cell.lat,
    lon: cell.lon,
    flood_probability: cell.flood / denominator,
    probability_depth_gt_0_3m: cell.depth03 / denominator,
    probability_depth_gt_1_0m: cell.depth10 / denominator,
  }))
  const daActiveLeads = (probabilisticResult.da_active ?? [])
    .map((active, index) => active ? probabilisticResult.lead_times[index] : null)
    .filter(Number.isFinite)

  return {
    ensembleSize: peakMembers.length,
    ensembleStrategy: probabilisticResult.ensemble_strategy ?? "operational DA ensemble",
    forecastModel: probabilisticResult.forecast_model ?? "Meta-stack + extreme-aware DA",
    daActiveLeads,
    floodMethod,
    responseLevelsEvaluated: uniqueLevels.length,
    waterLevelBinM,
    peakWaterLevelM: peakQuantiles,
    peakWaterLevelMembersM: peakMembers,
    representativeP50,
    representativeP90,
    probabilityCells,
    hazard: {
      floodKm2: summarizeV5(hazards, "floodKm2"),
      floodFraction: summarizeV5(hazards, "floodFrac"),
      meanDepthM: summarizeV5(hazards, "meanDepth"),
      maxDepthM: summarizeV5(hazards, "maxDepth"),
    },
    impact: {
      affectedPopulation: summarizeV5(impacts, "affPop"),
      displacedPopulation: summarizeV5(impacts, "displaced"),
      housingUnitsAtRisk: summarizeV5(impacts, "affUnits"),
      meanDamageRatioPct: summarizeV5(impacts, "avgDamage"),
      propertyDamageUsd: summarizeV5(impacts, "damage"),
    },
    uncertaintyScope: "Conditional forecast scenarios: extreme-aware-DA water-level uncertainty is propagated; terrain, datum, exposure, and vulnerability uncertainty are not.",
  }
}
