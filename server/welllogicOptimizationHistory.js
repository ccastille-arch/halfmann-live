import { loadHalfmannPanelMatchHistory, loadHalfmannRawHistory } from './halfmannHistoryStore.js'
import { clampHalfmannHistoryStart, getHalfmannHistoryFloor } from './halfmannReportArchive.js'

const DEFAULT_SOURCE_KEY = 'service-compression-fleet'
const DEFAULT_ACCESS_BASE = 'https://mlink-ingest-production.up.railway.app'
const DEFAULT_DEVICE_IDS = ['2507-501508', '2507-500709', '2504-504108', '2507-500076', '2504-504102', '2507-501442']
const DEFAULT_SAMPLE_MS = 2000
const MAX_CONTIGUOUS_SAMPLE_MS = 5000
const PANEL_DESIRED_FLOW_ADDRESSES = ['460002', '460004', '460006', '460008']
const UNIT_ACTUAL_FLOW_ADDRESSES = ['400656']
const PANEL_RECYCLE_ADDRESSES = ['400189', '460618']
const PANEL_OVERRIDE_LATCH_ADDRESS = '460018'

function normalizeEnvValue(value) {
  let normalized = String(value || '').trim()
  if (!normalized) return ''
  let previous = null
  while (normalized && normalized !== previous) {
    previous = normalized
    normalized = normalized.replace(/^[`"'Ã¢â‚¬Å“Ã¢â‚¬Â]+|[`"'Ã¢â‚¬Å“Ã¢â‚¬Â]+$/g, '').trim()
  }
  return normalized
}

function normalizeToken(value) {
  return normalizeEnvValue(value).replace(/^bearer\s+/i, '').trim()
}

function buildHeaders(token) {
  const normalized = normalizeToken(token)
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-api-token': normalized,
    authorization: `Bearer ${normalized}`,
  }
}

function toIsoOrNull(value) {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseCsvList(value) {
  if (!value) return []
  if (Array.isArray(value)) return [...new Set(value.flatMap(parseCsvList).filter(Boolean))]
  return [...new Set(String(value).split(',').map((entry) => entry.trim()).filter(Boolean))]
}

function matchKeyword(text, keywords) {
  const normalized = String(text || '').toLowerCase()
  return keywords.some((keyword) => normalized.includes(keyword))
}

function sumNumeric(values) {
  return values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value))
  if (!usable.length) return null
  return usable.reduce((sum, value) => sum + value, 0) / usable.length
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized === 'UNAVAILABLE' || normalized === 'INVALID') return null
  const numeric = Number(normalized.replace(/,/g, ''))
  return Number.isFinite(numeric) ? numeric : null
}

function getDatapoint(snapshot, addresses) {
  const lookup = Array.isArray(addresses) ? addresses : [addresses]
  const normalized = lookup.map((address) => String(address).trim().toLowerCase())
  return (snapshot?.datapoints || []).find((datapoint) =>
    normalized.includes(String(datapoint.addressStr || datapoint.address).trim().toLowerCase()),
  ) || null
}

function getNumber(snapshot, addresses) {
  return parseNumber(getDatapoint(snapshot, addresses)?.value)
}

function computeDurationMinutes(currentTs, nextTs) {
  const rawDurationMs = Number.isFinite(nextTs - currentTs) && nextTs > currentTs ? (nextTs - currentTs) : DEFAULT_SAMPLE_MS
  const durationMs = rawDurationMs > 0 && rawDurationMs <= MAX_CONTIGUOUS_SAMPLE_MS ? rawDurationMs : DEFAULT_SAMPLE_MS
  return durationMs / 60000
}

function buildConsumerOptimizationHistoryContext(units) {
  const details = units.flatMap((unit) =>
    (unit?.reports || []).flatMap((report) =>
      (report?.details || []).map((detail) => ({
        unitName: unit?.unit?.unitName || unit?.unit?.deviceId || 'Unknown unit',
        detail,
      })),
    ),
  )

  const topReasons = units.flatMap((unit) => unit?.mlContext?.features?.topReasons || [])
  const allReasonTexts = [
    ...topReasons.map((entry) => `${entry?.reason || ''} ${entry?.statusLabel || ''}`),
    ...details.map((entry) => `${entry.detail?.reason || ''} ${entry.detail?.statusLabel || ''}`),
  ]

  const countByKeywords = (keywords) => allReasonTexts.filter((text) => matchKeyword(text, keywords)).length
  const recoveryWindows = details
    .map((entry) => Number(entry.detail?.durationHours))
    .filter((value) => Number.isFinite(value) && value > 0)

  const reportWindows = sumNumeric(units.map((unit) => Number(unit?.mlContext?.features?.reportWindows)))
  const totalReportedHours = sumNumeric(units.map((unit) => Number(unit?.mlContext?.features?.totalReportedHours)))
  const hasHistoricalEvidence = reportWindows > 0 || details.length > 0 || totalReportedHours > 0

  return {
    lowFlowEventCount: countByKeywords(['low flow', 'below setpoint']),
    dischargeOverrideEventCount: countByKeywords(['discharge override', 'high discharge', 'discharge']),
    recycleEventCount: countByKeywords(['recycle']),
    compressorDispatchMismatchEvents: countByKeywords(['not meeting desired flow', 'dispatch', 'underload', 'unload']),
    compressorConstraintEvents: countByKeywords(['constraint', 'capacity', 'compressor down', 'shutdown', 'fault']),
    sacrificeModeEvents: countByKeywords(['sacrifice']),
    repeatedLowFlowRetriggerCount: Math.max(0, countByKeywords(['low flow']) - 1),
    repeatedDischargeRetriggerCount: Math.max(0, countByKeywords(['discharge']) - 1),
    averageRecovery2Min: recoveryWindows.length ? average(recoveryWindows.map((value) => Math.min(value * 60, 2))) : null,
    averageRecovery5Min: recoveryWindows.length ? average(recoveryWindows.map((value) => Math.min(value * 60, 5))) : null,
    averageRecovery10Min: recoveryWindows.length ? average(recoveryWindows.map((value) => Math.min(value * 60, 10))) : null,
    averageRecovery20Min: recoveryWindows.length ? average(recoveryWindows.map((value) => Math.min(value * 60, 20))) : null,
    compressorMismatchPersistenceMinutes: countByKeywords(['not meeting desired flow', 'dispatch']) * 15,
    wellBelowTargetPersistenceMinutes: countByKeywords(['low flow', 'below setpoint']) * 15,
    pressureRecoveryPattern: hasHistoricalEvidence
      ? countByKeywords(['discharge']) > 1
        ? 'Repeated discharge events detected in retained consumer history'
        : 'No repeated discharge event cluster retained in consumer history'
      : 'Insufficient retained consumer history',
    recycleDuringRecovery: countByKeywords(['recycle']) > 0,
    priorRecommendationEvidenceAvailable: hasHistoricalEvidence,
    hasHistoricalData: hasHistoricalEvidence,
    reportWindows,
    totalReportedHours,
    recommendationCount: sumNumeric(units.map((unit) => (unit?.mlContext?.recommendations || []).length)),
    topReasons: topReasons.slice(0, 6).map((entry) => ({
      reason: entry?.reason || entry?.statusLabel || 'Unknown',
      hours: Number(entry?.hours) || null,
    })),
  }
}

function buildVolumeOptimizationHistoryContext(panelRecords, rawRecords) {
  if (!panelRecords.length && !rawRecords.length) {
    return {
      lowFlowEventCount: 0,
      dischargeOverrideEventCount: 0,
      recycleEventCount: 0,
      compressorDispatchMismatchEvents: 0,
      compressorConstraintEvents: 0,
      sacrificeModeEvents: 0,
      repeatedLowFlowRetriggerCount: 0,
      repeatedDischargeRetriggerCount: 0,
      averageRecovery2Min: null,
      averageRecovery5Min: null,
      averageRecovery10Min: null,
      averageRecovery20Min: null,
      compressorMismatchPersistenceMinutes: 0,
      wellBelowTargetPersistenceMinutes: 0,
      pressureRecoveryPattern: 'Insufficient retained volume history',
      recycleDuringRecovery: false,
      priorRecommendationEvidenceAvailable: false,
      hasHistoricalData: false,
      historySource: 'volume-history',
      reportWindows: 0,
      totalReportedHours: 0,
      recommendationCount: 0,
      topReasons: [],
    }
  }

  let lowFlowEventCount = 0
  let compressorConstraintEvents = 0
  let sacrificeModeEvents = 0
  let wellBelowTargetPersistenceMinutes = 0
  let lowFlowActive = false
  let constraintActive = false
  let sacrificeActive = false

  for (let index = 0; index < panelRecords.length; index += 1) {
    const record = panelRecords[index]
    const currentTs = new Date(record.ts).getTime()
    const nextTs = panelRecords[index + 1] ? new Date(panelRecords[index + 1].ts).getTime() : currentTs + DEFAULT_SAMPLE_MS
    const durationMinutes = computeDurationMinutes(currentTs, nextTs)
    const wellBelow = Object.values(record.matches || {}).some((match) => Number.isFinite(match) && match < 98)
    const constraint = record.flowTargetBeingReduced === true
      || record.compressorLimited === true
      || (record.runningCompressors != null && record.runningCompressors < 4)
      || (
        Number.isFinite(record.totalAscCompressorFlow)
        && Number.isFinite(record.totalDesiredSiteFlow)
        && record.totalAscCompressorFlow + 0.05 < record.totalDesiredSiteFlow
      )
    const sacrifice = record.flowTargetBeingReduced === true

    if (wellBelow && !lowFlowActive) lowFlowEventCount += 1
    if (constraint && !constraintActive) compressorConstraintEvents += 1
    if (sacrifice && !sacrificeActive) sacrificeModeEvents += 1

    if (wellBelow) wellBelowTargetPersistenceMinutes += durationMinutes

    lowFlowActive = wellBelow
    constraintActive = constraint
    sacrificeActive = sacrifice
  }

  let dischargeOverrideEventCount = 0
  let recycleEventCount = 0
  let compressorDispatchMismatchEvents = 0
  let compressorMismatchPersistenceMinutes = 0
  let recycleDuringRecovery = false
  let dischargeActive = false
  let recycleActive = false
  let mismatchActive = false

  for (let index = 0; index < rawRecords.length; index += 1) {
    const record = rawRecords[index]
    const currentTs = new Date(record.capturedAt || record.ts).getTime()
    const nextTs = rawRecords[index + 1] ? new Date(rawRecords[index + 1].capturedAt || rawRecords[index + 1].ts).getTime() : currentTs + DEFAULT_SAMPLE_MS
    const durationMinutes = computeDurationMinutes(currentTs, nextTs)
    const panelSnapshot = record.panel
    const units = Array.isArray(record.units) ? record.units : []

    const dischargeOverride = (getNumber(panelSnapshot, PANEL_OVERRIDE_LATCH_ADDRESS) ?? 0) > 0
    const recycleValue = getNumber(panelSnapshot, PANEL_RECYCLE_ADDRESSES)
    const recycle = recycleValue != null && recycleValue > 0
    const desiredFlows = PANEL_DESIRED_FLOW_ADDRESSES.map((address) => getNumber(panelSnapshot, address))
    const mismatches = units.map((unit, unitIndex) => {
      const desired = desiredFlows[unitIndex]
      const actual = getNumber(unit, UNIT_ACTUAL_FLOW_ADDRESSES)
      if (!Number.isFinite(desired) || !Number.isFinite(actual) || desired <= 0) return null
      return Math.abs(((actual - desired) / desired) * 100)
    }).filter((value) => Number.isFinite(value))
    const mismatch = mismatches.some((value) => value > 7)

    if (dischargeOverride && !dischargeActive) dischargeOverrideEventCount += 1
    if (recycle && !recycleActive) recycleEventCount += 1
    if (mismatch && !mismatchActive) compressorDispatchMismatchEvents += 1

    if (mismatch) compressorMismatchPersistenceMinutes += durationMinutes
    if (recycle && dischargeOverride) recycleDuringRecovery = true

    dischargeActive = dischargeOverride
    recycleActive = recycle
    mismatchActive = mismatch
  }

  const pressureRecoveryPattern = dischargeOverrideEventCount > 1
    ? 'Repeated discharge override seen in retained volume history'
    : dischargeOverrideEventCount === 1
      ? 'Single discharge override seen in retained volume history'
      : 'No retained discharge override events in volume history'

  return {
    lowFlowEventCount,
    dischargeOverrideEventCount,
    recycleEventCount,
    compressorDispatchMismatchEvents,
    compressorConstraintEvents,
    sacrificeModeEvents,
    repeatedLowFlowRetriggerCount: Math.max(0, lowFlowEventCount - 1),
    repeatedDischargeRetriggerCount: Math.max(0, dischargeOverrideEventCount - 1),
    averageRecovery2Min: lowFlowEventCount > 0 ? 2 : null,
    averageRecovery5Min: lowFlowEventCount > 0 ? 5 : null,
    averageRecovery10Min: dischargeOverrideEventCount > 0 ? 10 : null,
    averageRecovery20Min: dischargeOverrideEventCount > 0 ? 20 : null,
    compressorMismatchPersistenceMinutes,
    wellBelowTargetPersistenceMinutes,
    pressureRecoveryPattern,
    recycleDuringRecovery,
    priorRecommendationEvidenceAvailable: true,
    hasHistoricalData: true,
    historySource: 'volume-history',
    reportWindows: 0,
    totalReportedHours: panelRecords.length ? panelRecords.length * (DEFAULT_SAMPLE_MS / 3600000) : 0,
    recommendationCount: 0,
    topReasons: [
      { reason: 'Retained Halfmann panel history', hours: panelRecords.length ? panelRecords.length * (DEFAULT_SAMPLE_MS / 3600000) : null },
    ],
  }
}

function mergeContexts(volumeContext, consumerContext) {
  const hasVolume = volumeContext?.hasHistoricalData
  const hasConsumer = consumerContext?.hasHistoricalData
  return {
    lowFlowEventCount: (volumeContext?.lowFlowEventCount || 0) + (consumerContext?.lowFlowEventCount || 0),
    dischargeOverrideEventCount: (volumeContext?.dischargeOverrideEventCount || 0) + (consumerContext?.dischargeOverrideEventCount || 0),
    recycleEventCount: (volumeContext?.recycleEventCount || 0) + (consumerContext?.recycleEventCount || 0),
    compressorDispatchMismatchEvents: (volumeContext?.compressorDispatchMismatchEvents || 0) + (consumerContext?.compressorDispatchMismatchEvents || 0),
    compressorConstraintEvents: (volumeContext?.compressorConstraintEvents || 0) + (consumerContext?.compressorConstraintEvents || 0),
    sacrificeModeEvents: (volumeContext?.sacrificeModeEvents || 0) + (consumerContext?.sacrificeModeEvents || 0),
    repeatedLowFlowRetriggerCount: Math.max(volumeContext?.repeatedLowFlowRetriggerCount || 0, consumerContext?.repeatedLowFlowRetriggerCount || 0),
    repeatedDischargeRetriggerCount: Math.max(volumeContext?.repeatedDischargeRetriggerCount || 0, consumerContext?.repeatedDischargeRetriggerCount || 0),
    averageRecovery2Min: volumeContext?.averageRecovery2Min ?? consumerContext?.averageRecovery2Min ?? null,
    averageRecovery5Min: volumeContext?.averageRecovery5Min ?? consumerContext?.averageRecovery5Min ?? null,
    averageRecovery10Min: volumeContext?.averageRecovery10Min ?? consumerContext?.averageRecovery10Min ?? null,
    averageRecovery20Min: volumeContext?.averageRecovery20Min ?? consumerContext?.averageRecovery20Min ?? null,
    compressorMismatchPersistenceMinutes: Math.max(volumeContext?.compressorMismatchPersistenceMinutes || 0, consumerContext?.compressorMismatchPersistenceMinutes || 0),
    wellBelowTargetPersistenceMinutes: Math.max(volumeContext?.wellBelowTargetPersistenceMinutes || 0, consumerContext?.wellBelowTargetPersistenceMinutes || 0),
    pressureRecoveryPattern: hasVolume
      ? volumeContext.pressureRecoveryPattern
      : consumerContext?.pressureRecoveryPattern || 'Insufficient retained history',
    recycleDuringRecovery: Boolean(volumeContext?.recycleDuringRecovery || consumerContext?.recycleDuringRecovery),
    priorRecommendationEvidenceAvailable: Boolean(volumeContext?.priorRecommendationEvidenceAvailable || consumerContext?.priorRecommendationEvidenceAvailable),
    hasHistoricalData: Boolean(hasVolume || hasConsumer),
    historySource: hasVolume && hasConsumer ? 'volume-plus-consumer' : hasVolume ? 'volume-history' : hasConsumer ? 'consumer-history' : 'no-history',
    reportWindows: (consumerContext?.reportWindows || 0),
    totalReportedHours: (volumeContext?.totalReportedHours || 0) + (consumerContext?.totalReportedHours || 0),
    recommendationCount: consumerContext?.recommendationCount || 0,
    topReasons: [...(volumeContext?.topReasons || []), ...(consumerContext?.topReasons || [])].slice(0, 6),
  }
}

export async function getOptimizationHistory({
  accessBase = DEFAULT_ACCESS_BASE,
  apiToken,
  sourceKey = DEFAULT_SOURCE_KEY,
  deviceIds = DEFAULT_DEVICE_IDS,
  lookbackDays = 14,
  reportLimit = 7,
} = {}) {
  const selectedDeviceIds = parseCsvList(deviceIds)
  const requestedStartAt = new Date(Date.now() - (lookbackDays * 24 * 60 * 60 * 1000))
  const startAt = clampHalfmannHistoryStart(requestedStartAt)
  const endAt = new Date()
  const effectiveLookbackDays = Math.max(1, Math.ceil((endAt.getTime() - startAt.getTime()) / (24 * 60 * 60 * 1000)))
  const panelHistory = loadHalfmannPanelMatchHistory({ startAt, endAt, includeFallback: false })
  const rawHistory = loadHalfmannRawHistory({ startAt, endAt })
  const volumeContext = buildVolumeOptimizationHistoryContext(panelHistory, rawHistory)

  let units = []
  let consumerContext = {
    lowFlowEventCount: 0,
    dischargeOverrideEventCount: 0,
    recycleEventCount: 0,
    compressorDispatchMismatchEvents: 0,
    compressorConstraintEvents: 0,
    sacrificeModeEvents: 0,
    repeatedLowFlowRetriggerCount: 0,
    repeatedDischargeRetriggerCount: 0,
    averageRecovery2Min: null,
    averageRecovery5Min: null,
    averageRecovery10Min: null,
    averageRecovery20Min: null,
    compressorMismatchPersistenceMinutes: 0,
    wellBelowTargetPersistenceMinutes: 0,
    pressureRecoveryPattern: 'Insufficient retained consumer history',
    recycleDuringRecovery: false,
    priorRecommendationEvidenceAvailable: false,
    hasHistoricalData: false,
    reportWindows: 0,
    totalReportedHours: 0,
    recommendationCount: 0,
    topReasons: [],
  }
  let consumerError = null

  const token = normalizeToken(apiToken)
  if (token) {
    try {
      const response = await fetch(`${accessBase}/api/access/sources/${encodeURIComponent(sourceKey)}/query`, {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({
          deviceIds: selectedDeviceIds.length ? selectedDeviceIds : DEFAULT_DEVICE_IDS,
          includeLatestSnapshot: true,
          includeReports: true,
          includeMlContext: true,
          reportLimit,
          lookbackDays: effectiveLookbackDays,
          endAt: toIsoOrNull(endAt),
        }),
      })

      const text = await response.text()
      let data = text
      try { data = JSON.parse(text) } catch {}
      if (!response.ok) {
        throw Object.assign(new Error(typeof data === 'string' ? data : data?.error || response.statusText), {
          status: response.status,
          payload: data,
        })
      }

      units = Array.isArray(data?.units) ? data.units : []
      consumerContext = buildConsumerOptimizationHistoryContext(units)
    } catch (error) {
      consumerError = {
        status: error.status || null,
        message: error.message,
      }
    }
  }

  const optimizationHistoryContext = mergeContexts(volumeContext, consumerContext)

  return {
    fetchedAt: new Date().toISOString(),
    sourceKey,
    lookbackDays: effectiveLookbackDays,
    reportLimit,
    deviceIds: selectedDeviceIds.length ? selectedDeviceIds : DEFAULT_DEVICE_IDS,
    historyFloor: getHalfmannHistoryFloor(),
    reportWindow: {
      startAt: toIsoOrNull(startAt),
      endAt: toIsoOrNull(endAt),
    },
    optimizationHistoryContext,
    volumeHistory: {
      panelSamples: panelHistory.length,
      rawSamples: rawHistory.length,
      source: 'halfmann-history volume',
    },
    consumerStatus: {
      available: Boolean(token),
      error: consumerError,
      unitCount: units.length,
    },
    units: units.map((unit) => ({
      deviceId: unit?.unit?.deviceId || null,
      unitName: unit?.unit?.unitName || null,
      latestSnapshotAt: unit?.latestSnapshot?.capturedAt || null,
      latestDatapointCount: unit?.latestSnapshot?.datapoints?.length || unit?.latestSnapshot?.datapointCount || 0,
      reportCount: (unit?.reports || []).length,
      mlContextAvailable: Boolean(unit?.mlContext),
      recommendationCount: (unit?.mlContext?.recommendations || []).length,
      topReasons: (unit?.mlContext?.features?.topReasons || []).slice(0, 3),
    })),
  }
}
