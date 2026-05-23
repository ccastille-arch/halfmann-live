import { PANEL_ADDRESSES, UNIT_ADDRESSES, normalizeRegisterAddress } from '../src/engine/halfmannRegisters.js'

const DEFAULT_SOURCE_KEY = 'service-compression-fleet'
const DEFAULT_ACCESS_BASE = 'https://mlink-ingest-production.up.railway.app'
const HALF_MANN_DEFAULT_DEVICE_IDS = ['2507-501508', '2507-500709', '2504-504108', '2507-500076', '2504-504102', '2507-501442']
const WELL_NAMES = ['214', '444', '334', '213', '333']
const WELL_GAS_PRIORITY_ADDRESSES = ['461002', '461004', '461006', '461008', '461010']
const WELL_OIL_PRIORITY_ADDRESSES = ['461036', '461038', '461040', '461042', '461044']
const WELL_MAX_FLOW_ADDRESSES = ['461134', '461136', '461138', '461140', '461142']
const UNIT_MAX_FLOW_ADDRESSES = ['461062', '461064', '461066', '461068']
const UNIT_DESIRED_FLOW_ADDRESSES = ['460002', '460004', '460006', '460008']
const UNIT_DEVICE_ORDER = ['2507-500076', '2507-500709', '2504-504108', '2504-504102']

const STATUS_NO_DATA = new Set(['No Data'])
const STATUS_RUNNING = new Set(['Running'])
const STATUS_STOPPED = new Set(['Stopped', 'Faulted', 'WarmupCooldown', 'Unknown'])

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizeEnvValue(value) {
  let normalized = String(value || '').trim()
  if (!normalized) return ''
  let previous = null
  while (normalized && normalized !== previous) {
    previous = normalized
    normalized = normalized.replace(/^[`"'“”]+|[`"'“”]+$/g, '').trim()
  }
  return normalized
}

function normalizeToken(token) {
  const normalized = normalizeEnvValue(token)
  return normalized.replace(/^bearer\s+/i, '').trim()
}

function buildFleetHeaders(token) {
  const normalized = normalizeToken(token)
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-api-token': normalized,
    authorization: `Bearer ${normalized}`,
  }
}

async function fetchFleetJson(baseUrl, token, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...buildFleetHeaders(token),
      ...(options.headers || {}),
    },
  })

  const text = await response.text()
  let data = text
  try {
    data = JSON.parse(text)
  } catch {}

  if (!response.ok) {
    const error = new Error(typeof data === 'string' ? data : data?.error || response.statusText)
    error.status = response.status
    error.payload = data
    throw error
  }

  return data
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))]
}

function parseDeviceIds(value) {
  if (!value) return []
  if (Array.isArray(value)) return dedupe(value.flatMap((entry) => String(entry).split(',').map((part) => part.trim())))
  return dedupe(String(value).split(',').map((part) => part.trim()))
}

function parseDateValue(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toIsoOrNull(value) {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function hoursBetween(startAt, endAt) {
  if (!(startAt instanceof Date) || !(endAt instanceof Date)) return 0
  return Math.max(0, (endAt.getTime() - startAt.getTime()) / 3600000)
}

function toTitle(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized === 'UNAVAILABLE' || normalized === 'INVALID') return null
  const numeric = Number(normalized.replace(/,/g, ''))
  return Number.isFinite(numeric) ? numeric : null
}

function parseBoolean(value) {
  if (value == null) return null
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'yes' || normalized === 'yes (1)' || normalized === 'yes (2)' || normalized === '1' || normalized === '2' || normalized === 'true') return true
  if (normalized === 'no' || normalized === 'no (0)' || normalized === '0' || normalized === 'false') return false
  return null
}

function getSnapshotDatapoints(snapshot) {
  return Array.isArray(snapshot?.datapoints) ? snapshot.datapoints : []
}

function matchesAddress(datapoint, addresses) {
  const normalized = normalizeRegisterAddress(datapoint?.address ?? datapoint?.addressStr ?? datapoint?.addressNumeric)
  return addresses.some((address) => normalizeRegisterAddress(address) === normalized)
}

function findSnapshotDatapoint(snapshot, { addresses = [], labels = [] }) {
  const datapoints = getSnapshotDatapoints(snapshot)
  if (!datapoints.length) return null
  if (addresses.length) {
    const match = datapoints.find((datapoint) => matchesAddress(datapoint, addresses))
    if (match) return match
  }
  if (labels.length) {
    const labelSet = labels.map((entry) => String(entry).trim().toLowerCase())
    const match = datapoints.find((datapoint) => {
      const label = toTitle(datapoint.alias || datapoint.description || datapoint.name).toLowerCase()
      return labelSet.includes(label)
    })
    if (match) return match
  }
  return null
}

function getSnapshotNumber(snapshot, config) {
  const datapoint = findSnapshotDatapoint(snapshot, config)
  if (!datapoint) return null
  return parseNumber(datapoint.valueNumber ?? datapoint.valueText)
}

function getSnapshotText(snapshot, config) {
  const datapoint = findSnapshotDatapoint(snapshot, config)
  if (!datapoint) return null
  const raw = datapoint.valueText ?? datapoint.valueNumber
  const text = String(raw ?? '').trim()
  return text || null
}

function average(values) {
  const usable = values.filter((value) => value != null && Number.isFinite(value))
  if (!usable.length) return null
  return usable.reduce((sum, value) => sum + value, 0) / usable.length
}

function gradeFromPct(score, coveragePct = 100) {
  if (coveragePct < 70) return 'D'
  if (coveragePct < 50) return 'F'
  if (score == null) return 'Incomplete'
  if (score >= 93) return 'A'
  if (score >= 85) return 'B'
  if (score >= 75) return 'C'
  if (score >= 65) return 'D'
  return 'F'
}

function getReportHours(report) {
  const summaryHours = Array.isArray(report?.summaries)
    ? report.summaries.reduce((sum, item) => sum + (parseNumber(item.hours) || 0), 0)
    : 0
  if (summaryHours > 0) return summaryHours
  const startAt = parseDateValue(report?.windowStart)
  const endAt = parseDateValue(report?.windowEnd)
  return hoursBetween(startAt, endAt)
}

function collectStatusHours(reports) {
  const totals = {}
  for (const report of reports || []) {
    for (const summary of report?.summaries || []) {
      const key = summary?.statusKey || 'Unknown'
      totals[key] = (totals[key] || 0) + (parseNumber(summary?.hours) || 0)
    }
  }
  return totals
}

function listDetailRows(bundle) {
  return (bundle?.reports || []).flatMap((report) =>
    (report?.details || []).map((detail) => ({
      report,
      detail,
      unit: bundle?.unit,
      snapshot: bundle?.latestSnapshot,
    })),
  )
}

function classifyDetailEvent(detail) {
  const reason = toTitle(detail?.reason || '')
  const status = toTitle(detail?.statusLabel || '')
  const combined = `${reason} ${status}`.toLowerCase()
  if (!combined) return null
  if (combined.includes('no data') || combined.includes('comm')) return 'Data Quality Issue'
  if (combined.includes('recycle')) return 'Recycle Active'
  if (combined.includes('recover')) return 'Recovery Complete'
  if (combined.includes('oscillat') || combined.includes('hunting')) return 'Oscillation Detected'
  if (combined.includes('stopped') || combined.includes('fault') || combined.includes('shutdown')) return 'Compressor Down'
  if (combined.includes('suction') || combined.includes('discharge') || combined.includes('unload') || combined.includes('capacity') || combined.includes('flow')) {
    return 'Compressor Constraint'
  }
  return null
}

function inferUnitMaxFlow(panelSnapshot, bundle, unitIndex) {
  const fromPanel = unitIndex >= 0 ? getSnapshotNumber(panelSnapshot, { addresses: [UNIT_MAX_FLOW_ADDRESSES[unitIndex]] }) : null
  return fromPanel ?? null
}

function getPriorityTier(rank) {
  if (rank == null) return 'Unknown'
  if (rank <= 2) return 'Tier 1'
  if (rank === 3) return 'Tier 2'
  return 'Tier 3'
}

function buildWellMetrics(panelSnapshot, runtimeAvailableHours) {
  const wells = WELL_NAMES.map((name, index) => {
    const desired = getSnapshotNumber(panelSnapshot, { addresses: [PANEL_ADDRESSES.wellSetpoint[index]] })
    const actual = getSnapshotNumber(panelSnapshot, { addresses: [PANEL_ADDRESSES.wellFlow[index]] })
    const calculatedDesired = getSnapshotNumber(panelSnapshot, { addresses: [PANEL_ADDRESSES.wellCalculatedDesiredFlow[index]] })
    const chokePosition = getSnapshotNumber(panelSnapshot, { addresses: [PANEL_ADDRESSES.wellChokePosition[index]] })
    const casingPressure = getSnapshotNumber(panelSnapshot, { addresses: [PANEL_ADDRESSES.wellCasingPressure[index]] })
    const tubingPressure = getSnapshotNumber(panelSnapshot, { addresses: [PANEL_ADDRESSES.wellTubingPressure[index]] })
    const gasPriority = getSnapshotNumber(panelSnapshot, { addresses: [WELL_GAS_PRIORITY_ADDRESSES[index]] })
    const oilPriority = getSnapshotNumber(panelSnapshot, { addresses: [WELL_OIL_PRIORITY_ADDRESSES[index]] })
    const maxFlowRate = getSnapshotNumber(panelSnapshot, { addresses: [WELL_MAX_FLOW_ADDRESSES[index]] })
    const target = calculatedDesired ?? desired
    const flowMatchPct = actual != null && target != null && target > 0 ? clamp((actual / target) * 100, 0, 160) : null
    const shortfall = actual != null && target != null ? Math.max(0, target - actual) : null
    const aboveTarget = actual != null && target != null ? Math.max(0, actual - target) : null
    const withinTolerance = actual != null && target != null ? actual >= target * 0.98 && actual <= target * 1.02 : null
    const complianceGrade = gradeFromPct(flowMatchPct, runtimeAvailableHours > 0 ? 100 : 0)

    return {
      wellName: `Well ${name}`,
      priorityTier: getPriorityTier(oilPriority ?? gasPriority),
      gasPriority,
      oilPriority,
      desiredFlowAverage: target,
      actualFlowAverage: actual,
      flowMatchPct,
      runtimeAvailableHours: runtimeAvailableHours || null,
      meetingDesiredRateHours: null,
      notMeetingDesiredRateHours: null,
      meetingDesiredRatePct: withinTolerance == null ? null : withinTolerance ? 100 : 0,
      timeAboveTargetHours: aboveTarget != null && aboveTarget > 0 ? null : 0,
      timeBelowTargetHours: shortfall != null && shortfall > 0 ? null : 0,
      longestBelowTargetDurationHours: null,
      averageShortfallMmscfd: shortfall,
      maximumShortfallMmscfd: shortfall,
      compressorConstrainedCompliancePct: null,
      sacrificeModeCompliancePct: null,
      monthlyComplianceGrade: complianceGrade,
      chokePosition,
      chokeCommand: null,
      casingPressure,
      tubingPressure,
      maxFlowRate,
      evidenceBasis: 'latest-retained-telemetry',
    }
  })

  return wells
}

function buildCompressorMetrics(bundles, panelSnapshot, siteDesiredFlow) {
  return bundles.map((bundle) => {
    const deviceId = bundle?.unit?.deviceId
    const unitIndex = UNIT_DEVICE_ORDER.indexOf(deviceId)
    const latestSnapshot = bundle?.latestSnapshot
    const desiredFlow = unitIndex >= 0 ? getSnapshotNumber(panelSnapshot, { addresses: [UNIT_DESIRED_FLOW_ADDRESSES[unitIndex]] }) : null
    const actualFlow = getSnapshotNumber(latestSnapshot, { addresses: UNIT_ADDRESSES.actualFlow, labels: ['Flow Rate', 'Flow Rate PID PV', 'Flow Rate PV'] })
    const suctionPressure = getSnapshotNumber(latestSnapshot, { addresses: UNIT_ADDRESSES.suctionPressure, labels: ['Suction Pressure', 'Stage 1 Suction Prs'] })
    const dischargePressure = getSnapshotNumber(latestSnapshot, { addresses: UNIT_ADDRESSES.dischargePressure, labels: ['Discharge Pressure', 'Stage 3 Discharge Prs'] })
    const loadedAutoSp = getSnapshotNumber(latestSnapshot, { addresses: UNIT_ADDRESSES.loadedAutoSp, labels: ['Loaded Auto Sp', 'Loaded Auto SP'] })
    const rpm = getSnapshotNumber(latestSnapshot, { addresses: UNIT_ADDRESSES.engineSpeed, labels: ['RPM', 'Driver Speed', 'Engine Speed'] })
    const maxFlowRate = inferUnitMaxFlow(panelSnapshot, bundle, unitIndex)
    const commandMatchPct = actualFlow != null && desiredFlow != null && desiredFlow > 0 ? clamp((actualFlow / desiredFlow) * 100, 0, 160) : null
    const utilizationPct = actualFlow != null && maxFlowRate != null && maxFlowRate > 0 ? clamp((actualFlow / maxFlowRate) * 100, 0, 160) : null
    const belowDesired = actualFlow != null && desiredFlow != null && desiredFlow > 0 ? actualFlow < desiredFlow * 0.95 : null
    const reportStatusHours = collectStatusHours(bundle?.reports || [])
    const validHours = Object.entries(reportStatusHours)
      .filter(([key]) => !STATUS_NO_DATA.has(key))
      .reduce((sum, [, value]) => sum + value, 0)

    return {
      deviceId,
      unitName: bundle?.unit?.unitName || bundle?.unit?.deviceId,
      desiredFlow,
      actualFlow,
      suctionPressure,
      dischargePressure,
      loadedAutoSp,
      rpm,
      maxFlowRate,
      commandMatchPct,
      utilizationPct,
      belowDesired,
      runtimeHours: validHours || null,
      isStandby: /standby/i.test(bundle?.unit?.unitName || ''),
      siteDesiredFlow,
      evidenceBasis: 'latest-retained-telemetry',
    }
  })
}

function buildCompressorEvents(compressorBundles, panelSnapshot, currentSiteSnapshot) {
  const events = []
  for (const bundle of compressorBundles) {
    const deviceId = bundle?.unit?.deviceId
    const unitIndex = UNIT_DEVICE_ORDER.indexOf(deviceId)
    const unitMaxFlow = inferUnitMaxFlow(panelSnapshot, bundle, unitIndex)
    const detailRows = listDetailRows(bundle)
    for (let index = 0; index < detailRows.length; index += 1) {
      const row = detailRows[index]
      const eventType = classifyDetailEvent(row.detail)
      if (!eventType) continue
      const startAt = parseDateValue(row.detail?.eventTime || row.detail?.actualEventTime || row.report?.windowStart)
      const durationHours = parseNumber(row.detail?.durationHours)
      const endAt = startAt && durationHours != null ? new Date(startAt.getTime() + durationHours * 3600000) : parseDateValue(row.report?.windowEnd)
      const nextRow = detailRows[index + 1]
      const nextAt = parseDateValue(nextRow?.detail?.eventTime || nextRow?.detail?.actualEventTime)
      const recoveryTimeHours = endAt && nextAt ? Math.max(0, (nextAt.getTime() - endAt.getTime()) / 3600000) : null

      events.push({
        eventTime: toIsoOrNull(startAt),
        eventType,
        durationHours: durationHours ?? (startAt && endAt ? hoursBetween(startAt, endAt) : null),
        trigger: row.detail?.reason || row.detail?.statusLabel || 'Stored report detail',
        wellsAffected: [],
        compressorsAffected: [bundle?.unit?.unitName || bundle?.unit?.deviceId],
        priorityProtectionResult: null,
        sacrificeResult: null,
        recycleResult: null,
        recoveryTimeHours,
        eventGrade: eventType === 'Data Quality Issue' ? 'Caution' : eventType === 'Compressor Down' ? 'Critical' : 'Review',
        notes: row.detail?.notes || '',
        estimatedCapacityLostMmscfd: unitMaxFlow != null && durationHours != null ? unitMaxFlow * durationHours : null,
        desiredSiteFlowAtEvent: getSnapshotNumber(currentSiteSnapshot, { addresses: [PANEL_ADDRESSES.totalDesiredSiteFlow] }),
        actualSiteFlowAtEvent: getSnapshotNumber(currentSiteSnapshot, { addresses: [PANEL_ADDRESSES.wellFlow[0], PANEL_ADDRESSES.wellFlow[1], PANEL_ADDRESSES.wellFlow[2], PANEL_ADDRESSES.wellFlow[3], PANEL_ADDRESSES.wellFlow[4]] }),
        recycleActive: null,
        pressureStable: null,
        sacrificeModeActive: null,
      })
    }
  }

  return events.sort((left, right) => String(right.eventTime || '').localeCompare(String(left.eventTime || '')))
}

function classifyPriorityProtection(wells, compressorConstrainedHours) {
  const ranked = [...wells].sort((left, right) => (left.oilPriority ?? 999) - (right.oilPriority ?? 999))
  const tier1 = ranked.filter((well) => well.priorityTier === 'Tier 1')
  const lower = ranked.filter((well) => well.priorityTier !== 'Tier 1')
  const tier1Compliance = tier1.length ? average(tier1.map((well) => well.flowMatchPct)) : null
  const lowerAbsorption = lower.length ? average(lower.map((well) => Math.max(0, 100 - (well.flowMatchPct ?? 100)))) : null
  const protectedHours = compressorConstrainedHours != null && tier1Compliance != null ? compressorConstrainedHours * (tier1Compliance / 100) : null
  const notProtectedHours = compressorConstrainedHours != null && protectedHours != null ? Math.max(0, compressorConstrainedHours - protectedHours) : null
  const score = clamp(
    ((tier1Compliance ?? 0) * 0.7) + ((lowerAbsorption != null ? clamp(lowerAbsorption, 0, 100) : 0) * 0.3),
    0,
    100,
  )
  const bestWell = ranked.find((well) => well.flowMatchPct != null)
  const worstWell = [...ranked].reverse().find((well) => well.flowMatchPct != null)

  return {
    score,
    tier1CompliancePct: tier1Compliance,
    lowerPriorityAbsorptionPct: lowerAbsorption,
    protectedHours,
    notProtectedHours,
    bestProtectedWell: bestWell?.wellName || null,
    worstProtectedWell: worstWell?.wellName || null,
    evidenceBasis: 'current-priority-vs-latest-flow',
  }
}

function buildDataQuality(panelBundle, bundles, requestedHours) {
  const allReports = bundles.flatMap((bundle) => bundle?.reports || [])
  const allStatusHours = bundles.map((bundle) => collectStatusHours(bundle?.reports || []))
  const noDataHours = allStatusHours.reduce((sum, hours) => sum + (hours['No Data'] || 0), 0)
  const runningHours = allStatusHours.reduce((sum, hours) => sum + (hours.Running || 0), 0)
  const stoppedHours = allStatusHours.reduce((sum, hours) => sum + (hours.Stopped || 0) + (hours.Faulted || 0), 0)
  const commsLossHours = bundles.flatMap(listDetailRows).reduce((sum, row) => {
    const text = `${row.detail?.reason || ''} ${row.detail?.statusLabel || ''}`.toLowerCase()
    return sum + (text.includes('comm') || text.includes('no data') ? (parseNumber(row.detail?.durationHours) || 0) : 0)
  }, 0)
  const validHours = Math.max(0, Math.max(runningHours + stoppedHours, requestedHours) - noDataHours)
  const validDataCoveragePct = requestedHours > 0 ? clamp((validHours / requestedHours) * 100, 0, 100) : null

  return {
    validDataCoveragePct,
    missingTelemetryHours: noDataHours || null,
    invalidSampleHours: null,
    commsLossHours: commsLossHours || null,
    excludedOfflineHours: stoppedHours || null,
    sampleCount: allReports.length,
    panelSnapshotAt: panelBundle?.latestSnapshot?.capturedAt || null,
    evidenceBasis: 'stored-run-reports-plus-latest-snapshot',
  }
}

function buildNarrative({ siteSummary, priorityProtection, dataQuality, compressorEvents, sacrificeEvents, wells }) {
  const lines = []
  lines.push(`During the selected reporting period, WellLogic maintained an overall target-compliance score of ${siteSummary.overallWellTargetCompliancePct != null ? siteSummary.overallWellTargetCompliancePct.toFixed(1) : '--'}%.`)
  lines.push(`The site experienced ${siteSummary.compressorConstrainedRuntimeHours != null ? siteSummary.compressorConstrainedRuntimeHours.toFixed(1) : '--'} hours of compressor-constrained runtime based on retained run-report evidence.`)
  lines.push(`Priority wells maintained ${priorityProtection.tier1CompliancePct != null ? priorityProtection.tier1CompliancePct.toFixed(1) : '--'}% compliance on the latest retained priority-vs-flow evidence, while lower-priority wells absorbed ${priorityProtection.lowerPriorityAbsorptionPct != null ? priorityProtection.lowerPriorityAbsorptionPct.toFixed(1) : '--'}% of the current visible mismatch burden.`)
  lines.push(`Recycle-free runtime is ${siteSummary.recycleFreeRuntimePct != null ? `${siteSummary.recycleFreeRuntimePct.toFixed(1)}%` : 'not yet provable from retained historical valve telemetry'}, and data coverage for this report is ${dataQuality.validDataCoveragePct != null ? `${dataQuality.validDataCoveragePct.toFixed(1)}%` : '--'}.`)
  if ((compressorEvents || []).length > 0) {
    lines.push(`The retained event history captured ${compressorEvents.length} compressor-side events, which were used to evaluate recovery behavior and runtime availability.`)
  }
  if ((sacrificeEvents || []).length === 0) {
    lines.push('Historical sacrifice-mode duration is currently evidence-limited in the retained API payload, so the page uses current priority-protection and latest flow state instead of inventing unsupported monthly hours.')
  }
  if (wells.some((well) => well.meetingDesiredRateHours == null)) {
    lines.push('Per-well monthly hours below/above target are shown only when the retained API exposes enough historical well-allocation telemetry; otherwise those cells remain evidence-limited instead of estimated.')
  }
  return {
    summary: lines.join(' '),
    recommendations: [
      siteSummary.compressorConstrainedRuntimeHours > 0 ? 'Use compressor-constrained event review to validate standby dispatch timing and recovery behavior.' : 'No major compressor-constrained runtime was retained in the selected window.',
      priorityProtection.score < 90 ? 'Review lower-priority absorption behavior and verify that Tier 1 wells remain protected during constrained periods.' : 'Priority protection is strong on the retained evidence.',
      dataQuality.validDataCoveragePct != null && dataQuality.validDataCoveragePct < 85 ? 'Improve retained telemetry coverage before using the monthly score as a commercial proof point.' : 'Data coverage is credible enough to support executive reporting.',
    ],
  }
}

function buildMarketingKpis(siteSummary, priorityProtection, dataQuality) {
  return [
    {
      label: 'Priority Wells Protected',
      value: priorityProtection.tier1CompliancePct,
      suffix: '%',
      tone: priorityProtection.tier1CompliancePct != null && priorityProtection.tier1CompliancePct >= 95 ? 'green' : 'orange',
      statement: priorityProtection.tier1CompliancePct != null
        ? `Priority wells maintained ${priorityProtection.tier1CompliancePct.toFixed(1)}% compliance on the retained protection evidence.`
        : 'Historical priority-protection evidence is limited.',
    },
    {
      label: 'Intelligent Sacrifice',
      value: priorityProtection.lowerPriorityAbsorptionPct,
      suffix: '%',
      tone: priorityProtection.lowerPriorityAbsorptionPct != null && priorityProtection.lowerPriorityAbsorptionPct >= 60 ? 'green' : 'yellow',
      statement: priorityProtection.lowerPriorityAbsorptionPct != null
        ? `Lower-priority wells absorbed ${priorityProtection.lowerPriorityAbsorptionPct.toFixed(1)}% of the visible mismatch burden.`
        : 'Sacrifice absorption cannot be proven without retained historical allocation telemetry.',
    },
    {
      label: 'Reduced Operator Burden',
      value: siteSummary.stableAllocationRuntimePct,
      suffix: '%',
      tone: siteSummary.stableAllocationRuntimePct != null && siteSummary.stableAllocationRuntimePct >= 85 ? 'green' : 'blue',
      statement: siteSummary.stableAllocationRuntimePct != null
        ? `Stable autonomous operation score is ${siteSummary.stableAllocationRuntimePct.toFixed(1)}% on available evidence.`
        : 'Stable autonomous runtime is currently evidence-limited.',
    },
    {
      label: 'Recycle Avoidance',
      value: siteSummary.recycleFreeRuntimePct,
      suffix: '%',
      tone: siteSummary.recycleFreeRuntimePct != null && siteSummary.recycleFreeRuntimePct >= 90 ? 'green' : 'blue',
      statement: siteSummary.recycleFreeRuntimePct != null
        ? `Recycle-free runtime held at ${siteSummary.recycleFreeRuntimePct.toFixed(1)}%.`
        : 'Historical recycle runtime is not retained strongly enough for a monthly percentage.',
    },
    {
      label: 'Stable Recovery',
      value: siteSummary.averageRecoveryTimeHours,
      suffix: ' hrs',
      tone: siteSummary.averageRecoveryTimeHours != null && siteSummary.averageRecoveryTimeHours <= 2 ? 'green' : 'yellow',
      statement: siteSummary.averageRecoveryTimeHours != null
        ? `Average recovery time after retained compressor events was ${siteSummary.averageRecoveryTimeHours.toFixed(2)} hours.`
        : 'Recovery-time evidence is limited in the selected window.',
    },
    {
      label: 'Injection Reliability',
      value: siteSummary.overallWellTargetCompliancePct,
      suffix: '%',
      tone: siteSummary.overallWellTargetCompliancePct != null && siteSummary.overallWellTargetCompliancePct >= 90 ? 'green' : 'orange',
      statement: siteSummary.overallWellTargetCompliancePct != null
        ? `Overall well target compliance scored ${siteSummary.overallWellTargetCompliancePct.toFixed(1)}% on the retained evidence set.`
        : 'Injection reliability cannot be fully scored without historical well-allocation telemetry.',
    },
    {
      label: 'Constraint Transparency',
      value: dataQuality.validDataCoveragePct,
      suffix: '%',
      tone: dataQuality.validDataCoveragePct != null && dataQuality.validDataCoveragePct >= 85 ? 'green' : 'yellow',
      statement: dataQuality.validDataCoveragePct != null
        ? `Valid retained report coverage was ${dataQuality.validDataCoveragePct.toFixed(1)}%.`
        : 'Coverage score unavailable.',
    },
    {
      label: 'Autonomous Allocation Stability',
      value: siteSummary.optimizationEffectivenessScorePct,
      suffix: '%',
      tone: siteSummary.optimizationEffectivenessScorePct != null && siteSummary.optimizationEffectivenessScorePct >= 85 ? 'green' : 'yellow',
      statement: siteSummary.optimizationEffectivenessScorePct != null
        ? `The composite optimization score is ${siteSummary.optimizationEffectivenessScorePct.toFixed(1)}%.`
        : 'Composite optimization score is evidence-limited.',
    },
  ]
}

function buildEventReplay(compressorEvents, sacrificeEvents) {
  return [...compressorEvents, ...sacrificeEvents].sort((left, right) => String(right.eventTime || '').localeCompare(String(left.eventTime || '')))
}

function buildSiteSummary({ panelSnapshot, wells, compressorMetrics, compressorEvents, priorityProtection, dataQuality, requestedHours }) {
  const currentWellCompliance = wells.filter((well) => well.flowMatchPct != null)
  const overallWellTargetCompliancePct = currentWellCompliance.length ? average(currentWellCompliance.map((well) => well.flowMatchPct)) : null
  const compressorConstrainedRuntimeHours = compressorEvents
    .filter((event) => event.eventType === 'Compressor Constraint' || event.eventType === 'Compressor Down')
    .reduce((sum, event) => sum + (event.durationHours || 0), 0)
  const recycleFreeRuntimePct = null
  const stableAllocationRuntimePct = getSnapshotNumber(panelSnapshot, { addresses: ['420116'] })
  const siteFlowAlignmentPct = getSnapshotNumber(panelSnapshot, { addresses: ['420101'] }) ?? overallWellTargetCompliancePct
  const stableCompressorLoadingPct = average(compressorMetrics.map((metric) => metric.commandMatchPct))
  const pressureLimitedHours = compressorEvents
    .filter((event) => String(event.trigger || '').toLowerCase().includes('discharge') || String(event.trigger || '').toLowerCase().includes('suction'))
    .reduce((sum, event) => sum + (event.durationHours || 0), 0)
  const averageRecoveryTimeHours = average(compressorEvents.map((event) => event.recoveryTimeHours))
  const optimizationEffectivenessScorePct = clamp(
    average([
      overallWellTargetCompliancePct,
      priorityProtection.score,
      stableAllocationRuntimePct,
      stableCompressorLoadingPct,
      dataQuality.validDataCoveragePct,
    ].filter((value) => value != null)) || 0,
    0,
    100,
  )
  const grade = gradeFromPct(optimizationEffectivenessScorePct, dataQuality.validDataCoveragePct ?? 0)

  return {
    overallWellTargetCompliancePct,
    priorityWellProtectionScorePct: priorityProtection.score,
    compressorConstrainedRuntimeHours: compressorConstrainedRuntimeHours || null,
    sacrificeModeRuntimeHours: null,
    wellBelowDesiredRateHours: null,
    stableAllocationRuntimePct,
    recycleFreeRuntimePct,
    optimizationEffectivenessScorePct,
    monthlyPerformanceGrade: grade,
    compressorDispatchMatchPct: stableCompressorLoadingPct,
    compressorCapacityUtilizationPct: average(compressorMetrics.map((metric) => metric.utilizationPct)),
    wellConstrainedHours: null,
    pressureLimitedHours: pressureLimitedHours || null,
    recycleActiveHours: null,
    averageRecoveryTimeHours,
    siteFlowAlignmentPct,
    totalRequestedHours: requestedHours,
    evidenceBasis: {
      wellCompliance: 'latest-retained-telemetry',
      compressorConstraint: 'stored-run-report-details',
      recycle: 'historical-valve-telemetry-unavailable',
      stability: stableAllocationRuntimePct != null ? 'panel-derived-score' : 'unavailable',
    },
  }
}

function buildControlMeta(units, defaultDeviceIds) {
  const groups = []
  const seen = new Set()
  for (const unit of units) {
    const key = unit.groupKey || unit.groupPath || 'ungrouped'
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({
      groupKey: unit.groupKey || null,
      groupPath: unit.groupPath || unit.groupName || 'Ungrouped',
      label: unit.groupPath || unit.groupName || 'Ungrouped',
    })
  }
  return {
    units: units.map((unit) => ({
      deviceId: unit.deviceId,
      unitName: unit.unitName,
      groupKey: unit.groupKey || null,
      groupPath: unit.groupPath || null,
      selectedByDefault: defaultDeviceIds.includes(unit.deviceId),
    })),
    groups,
    defaultDeviceIds,
  }
}

function detectDefaultDeviceIds(units, requestedDeviceIds) {
  if (requestedDeviceIds.length) return requestedDeviceIds
  const catalogIds = new Set(units.map((unit) => unit.deviceId))
  const defaults = HALF_MANN_DEFAULT_DEVICE_IDS.filter((deviceId) => catalogIds.has(deviceId))
  return defaults.length ? defaults : units.slice(0, Math.min(units.length, 6)).map((unit) => unit.deviceId)
}

async function queryBundles({ baseUrl, token, sourceKey, deviceIds, startAt, endAt, requestedDays }) {
  const payload = await fetchFleetJson(baseUrl, token, `/api/access/sources/${encodeURIComponent(sourceKey)}/query`, {
    method: 'POST',
    body: JSON.stringify({
      deviceIds,
      includeLatestSnapshot: true,
      includeReports: true,
      includeMlContext: true,
      reportLimit: Math.min(90, Math.max(7, Math.ceil(requestedDays) + 2)),
      lookbackDays: clamp(Math.ceil(requestedDays), 1, 30),
      ...(startAt ? { startAt: toIsoOrNull(startAt) } : {}),
      ...(endAt ? { endAt: toIsoOrNull(endAt) } : {}),
    }),
  })
  return payload
}

async function getCatalog(baseUrl, token, sourceKey, groupKey) {
  const params = new URLSearchParams({ page: '1', pageSize: '500' })
  if (groupKey) params.set('groupKey', groupKey)
  const payload = await fetchFleetJson(baseUrl, token, `/api/access/sources/${encodeURIComponent(sourceKey)}/units?${params.toString()}`)
  return Array.isArray(payload?.units) ? payload.units : []
}

export async function getPerformanceReportMeta({
  accessBase = DEFAULT_ACCESS_BASE,
  apiToken,
  sourceKey = DEFAULT_SOURCE_KEY,
  groupKey,
} = {}) {
  const token = normalizeToken(apiToken)
  if (!token) {
    const error = new Error('MLINK_API_TOKEN not configured')
    error.status = 503
    throw error
  }

  const units = await getCatalog(accessBase, token, sourceKey, groupKey)
  const defaultDeviceIds = detectDefaultDeviceIds(units, [])

  return {
    fetchedAt: new Date().toISOString(),
    sourceKey,
    accessBase,
    controls: buildControlMeta(units, defaultDeviceIds),
  }
}

export async function generatePerformanceReport({
  accessBase = DEFAULT_ACCESS_BASE,
  apiToken,
  sourceKey = DEFAULT_SOURCE_KEY,
  deviceIds = [],
  startAt,
  endAt,
  groupKey,
  preset = 'current-month',
} = {}) {
  const token = normalizeToken(apiToken)
  if (!token) {
    const error = new Error('MLINK_API_TOKEN not configured')
    error.status = 503
    throw error
  }

  const rangeStart = startAt instanceof Date ? startAt : parseDateValue(startAt) || new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  const rangeEnd = endAt instanceof Date ? endAt : parseDateValue(endAt) || new Date()
  const requestedDays = Math.max(1, hoursBetween(rangeStart, rangeEnd) / 24)
  const units = await getCatalog(accessBase, token, sourceKey, groupKey)
  const selectedDeviceIds = detectDefaultDeviceIds(units, parseDeviceIds(deviceIds))
  const queryResult = await queryBundles({
    baseUrl: accessBase,
    token,
    sourceKey,
    deviceIds: selectedDeviceIds,
    startAt: rangeStart,
    endAt: rangeEnd,
    requestedDays,
  })

  const bundles = Array.isArray(queryResult?.units) ? queryResult.units : []
  const panelBundle = bundles.find((bundle) => bundle?.unit?.deviceId === '2507-501508' || /panel/i.test(bundle?.unit?.unitName || '')) || bundles[0] || null
  const panelSnapshot = panelBundle?.latestSnapshot || null
  const compressorBundles = bundles.filter((bundle) => bundle?.unit?.deviceId !== panelBundle?.unit?.deviceId)
  const requestedHours = hoursBetween(rangeStart, rangeEnd)

  const wells = buildWellMetrics(panelSnapshot, requestedHours)
  const compressorMetrics = buildCompressorMetrics(compressorBundles, panelSnapshot, getSnapshotNumber(panelSnapshot, { addresses: [PANEL_ADDRESSES.totalDesiredSiteFlow] }))
  const compressorEvents = buildCompressorEvents(compressorBundles, panelSnapshot, panelSnapshot)
  const sacrificeEvents = []
  const priorityProtection = classifyPriorityProtection(wells, compressorEvents
    .filter((event) => event.eventType === 'Compressor Constraint' || event.eventType === 'Compressor Down')
    .reduce((sum, event) => sum + (event.durationHours || 0), 0))
  const dataQuality = buildDataQuality(panelBundle, bundles, requestedHours)
  const siteSummary = buildSiteSummary({
    panelSnapshot,
    wells,
    compressorMetrics,
    compressorEvents,
    priorityProtection,
    dataQuality,
    requestedHours,
  })
  const marketingKpis = buildMarketingKpis(siteSummary, priorityProtection, dataQuality)
  const eventReplay = buildEventReplay(compressorEvents, sacrificeEvents)
  const narrative = buildNarrative({
    siteSummary,
    priorityProtection,
    dataQuality,
    compressorEvents,
    sacrificeEvents,
    wells,
  })

  return {
    fetchedAt: new Date().toISOString(),
    sourceKey,
    accessBase,
    reportWindow: {
      preset,
      startAt: rangeStart.toISOString(),
      endAt: rangeEnd.toISOString(),
      requestedHours,
    },
    controls: buildControlMeta(units, selectedDeviceIds),
    siteSummary,
    wells,
    compressorMetrics,
    compressorEvents,
    sacrificeEvents,
    priorityProtection,
    marketingKpis,
    dataQuality,
    narrative,
    eventReplay,
    coverageNotes: [
      'Stored run-report summaries and details are used as the historical runtime backbone for this report.',
      'Where the retained consumer API does not expose historical well-allocation telemetry, the page uses latest retained panel telemetry and marks the basis explicitly instead of inventing monthly hours.',
      'Compressor slowdown or pressure protection is treated as protective behavior, not automatic compressor failure.',
    ],
    normalizedReport: {
      reportWindow: {
        preset,
        startAt: rangeStart.toISOString(),
        endAt: rangeEnd.toISOString(),
        requestedHours,
      },
      siteSummary,
      wells,
      compressorEvents,
      sacrificeEvents,
      priorityProtection,
      marketingKpis,
      dataQuality,
      narrative,
    },
  }
}
