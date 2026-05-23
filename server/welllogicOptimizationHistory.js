const DEFAULT_SOURCE_KEY = 'service-compression-fleet'
const DEFAULT_ACCESS_BASE = 'https://mlink-ingest-production.up.railway.app'
const DEFAULT_DEVICE_IDS = ['2507-501508', '2507-500709', '2504-504108', '2507-500076', '2504-504102', '2507-501442']

function normalizeEnvValue(value) {
  let normalized = String(value || '').trim()
  if (!normalized) return ''
  let previous = null
  while (normalized && normalized !== previous) {
    previous = normalized
    normalized = normalized.replace(/^[`"'â€œâ€]+|[`"'â€œâ€]+$/g, '').trim()
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

function buildOptimizationHistoryContext(units) {
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
        ? 'Repeated discharge events detected in retained history'
        : 'No repeated discharge event cluster retained'
      : 'Insufficient retained history',
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

export async function getOptimizationHistory({
  accessBase = DEFAULT_ACCESS_BASE,
  apiToken,
  sourceKey = DEFAULT_SOURCE_KEY,
  deviceIds = DEFAULT_DEVICE_IDS,
  lookbackDays = 14,
  reportLimit = 7,
} = {}) {
  const token = normalizeToken(apiToken)
  if (!token) {
    const error = new Error('MLINK_API_TOKEN not configured')
    error.status = 503
    throw error
  }

  const selectedDeviceIds = parseCsvList(deviceIds)
  const response = await fetch(`${accessBase}/api/access/sources/${encodeURIComponent(sourceKey)}/query`, {
    method: 'POST',
    headers: buildHeaders(token),
    body: JSON.stringify({
      deviceIds: selectedDeviceIds.length ? selectedDeviceIds : DEFAULT_DEVICE_IDS,
      includeLatestSnapshot: true,
      includeReports: true,
      includeMlContext: true,
      reportLimit,
      lookbackDays,
      endAt: toIsoOrNull(new Date()),
    }),
  })

  const text = await response.text()
  let data = text
  try { data = JSON.parse(text) } catch {}
  if (!response.ok) {
    const error = new Error(typeof data === 'string' ? data : data?.error || response.statusText)
    error.status = response.status
    error.payload = data
    throw error
  }

  const units = Array.isArray(data?.units) ? data.units : []
  const optimizationHistoryContext = buildOptimizationHistoryContext(units)

  return {
    fetchedAt: new Date().toISOString(),
    sourceKey,
    lookbackDays,
    reportLimit,
    deviceIds: selectedDeviceIds.length ? selectedDeviceIds : DEFAULT_DEVICE_IDS,
    optimizationHistoryContext,
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
