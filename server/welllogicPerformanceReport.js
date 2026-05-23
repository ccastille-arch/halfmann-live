import { getHalfmannHistoryPaths, loadHalfmannPanelMatchHistory } from './halfmannHistoryStore.js'

const HALF_MANN_DEVICE_MANIFEST = [
  { deviceId: '2507-501508', unitName: 'Halfmann Well Panel' },
  { deviceId: '2507-501442', unitName: 'Unit 1396 (Standby)' },
  { deviceId: '2504-504108', unitName: 'Unit 2127' },
  { deviceId: '2507-500076', unitName: 'Unit 2128' },
  { deviceId: '2504-504102', unitName: 'Unit 2129' },
  { deviceId: '2507-500709', unitName: 'Unit 2130' },
]

const WELL_CONFIG = [
  { wellName: 'Well 214', key: '214', priority: 2 },
  { wellName: 'Well 444', key: '444', priority: 5 },
  { wellName: 'Well 334', key: '334', priority: 4 },
  { wellName: 'Well 213', key: '213', priority: 3 },
  { wellName: 'Well 333', key: '333', priority: 1 },
]

const MAIN_COMPRESSOR_COUNT = 4
const MATCH_TOLERANCE_PCT = 98
const DEFAULT_SAMPLE_MS = 2000
const MAX_CONTIGUOUS_SAMPLE_MS = 5000

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function average(values) {
  const usable = values.filter((value) => value != null && Number.isFinite(value))
  if (!usable.length) return null
  return usable.reduce((sum, value) => sum + value, 0) / usable.length
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function resolveDateRange({ preset = 'current-month', startAt, endAt }) {
  if (startAt && endAt) return { startAt: new Date(startAt), endAt: new Date(endAt) }

  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)

  if (preset === 'previous-month') {
    start.setUTCDate(1)
    start.setUTCMonth(start.getUTCMonth() - 1)
    start.setUTCHours(0, 0, 0, 0)
    end.setUTCDate(0)
    end.setUTCHours(23, 59, 59, 999)
    return { startAt: start, endAt: end }
  }

  if (preset === 'last-7-days') start.setUTCDate(start.getUTCDate() - 7)
  else if (preset === 'last-14-days') start.setUTCDate(start.getUTCDate() - 14)
  else if (preset === 'last-30-days') start.setUTCDate(start.getUTCDate() - 30)
  else {
    start.setUTCDate(1)
  }
  start.setUTCHours(0, 0, 0, 0)
  end.setUTCHours(23, 59, 59, 999)
  return { startAt: start, endAt: end }
}

function buildControlMeta() {
  return {
    siteName: 'Halfmann 1214',
    units: HALF_MANN_DEVICE_MANIFEST.map((unit) => ({
      ...unit,
      selectedByDefault: true,
    })),
    defaultDeviceIds: HALF_MANN_DEVICE_MANIFEST.map((unit) => unit.deviceId),
  }
}

function getDurationHours(currentRecord, nextRecord, reportEndAt) {
  const currentTs = new Date(currentRecord.ts).getTime()
  const nextTs = nextRecord ? new Date(nextRecord.ts).getTime() : new Date(reportEndAt).getTime()
  const rawDurationMs = Number.isFinite(nextTs - currentTs) && nextTs > currentTs ? (nextTs - currentTs) : DEFAULT_SAMPLE_MS
  const durationMs = rawDurationMs > 0 && rawDurationMs <= MAX_CONTIGUOUS_SAMPLE_MS ? rawDurationMs : DEFAULT_SAMPLE_MS
  return durationMs / 3600000
}

function summarizeWellRuntime(records, reportEndAt) {
  const totals = Object.fromEntries(WELL_CONFIG.map((well) => [well.key, {
    wellName: well.wellName,
    priority: well.priority,
    validHours: 0,
    meetingHours: 0,
    belowHours: 0,
    weightedMatch: 0,
    sampleCount: 0,
  }]))

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const durationHours = getDurationHours(record, records[index + 1], reportEndAt)
    for (const well of WELL_CONFIG) {
      const match = record.matches?.[well.key]
      if (match == null || !Number.isFinite(match)) continue
      const bucket = totals[well.key]
      bucket.validHours += durationHours
      bucket.weightedMatch += match * durationHours
      bucket.sampleCount += 1
      if (match >= MATCH_TOLERANCE_PCT) bucket.meetingHours += durationHours
      else bucket.belowHours += durationHours
    }
  }

  const wells = WELL_CONFIG.map((well) => {
    const bucket = totals[well.key]
    const avgMatchPct = bucket.validHours > 0 ? bucket.weightedMatch / bucket.validHours : null
    const runtimePct = bucket.validHours > 0 ? (bucket.meetingHours / bucket.validHours) * 100 : null
    return {
      wellName: bucket.wellName,
      priorityRank: bucket.priority,
      averageMatchPct: avgMatchPct,
      runtimeMeetingPct: runtimePct,
      meetingHours: bucket.meetingHours || null,
      belowHours: bucket.belowHours || null,
      validHours: bucket.validHours || null,
      sampleCount: bucket.sampleCount,
    }
  })

  return {
    tolerancePct: MATCH_TOLERANCE_PCT,
    wells,
    overallRuntimeMeetingPct: average(wells.map((well) => well.runtimeMeetingPct)),
    overallAverageMatchPct: average(wells.map((well) => well.averageMatchPct)),
  }
}

function isConstraintActive(record) {
  if (record.flowTargetBeingReduced === true) return true
  if (record.compressorLimited === true) return true
  if (record.runningCompressors != null && record.runningCompressors < MAIN_COMPRESSOR_COUNT) return true
  if (
    record.totalAscCompressorFlow != null &&
    record.totalDesiredSiteFlow != null &&
    Number.isFinite(record.totalAscCompressorFlow) &&
    Number.isFinite(record.totalDesiredSiteFlow) &&
    record.totalAscCompressorFlow + 0.05 < record.totalDesiredSiteFlow
  ) {
    return true
  }
  return false
}

function summarizePrioritization(records, reportEndAt) {
  let totalWeightedScore = 0
  let totalHours = 0
  let constrainedHours = 0
  let autoPerfectHours = 0

  const perWell = Object.fromEntries(WELL_CONFIG.map((well) => [well.key, {
    wellName: well.wellName,
    priorityRank: well.priority,
    constrainedProtectedHours: 0,
    constrainedShortHours: 0,
    constrainedValidHours: 0,
  }]))

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const durationHours = getDurationHours(record, records[index + 1], reportEndAt)
    const constrained = isConstraintActive(record)
    totalHours += durationHours

    if (!constrained) {
      totalWeightedScore += 100 * durationHours
      autoPerfectHours += durationHours
      continue
    }

    constrainedHours += durationHours
    const weightedSamples = []
    let samplePenalty = 0

    for (const well of WELL_CONFIG) {
      const match = record.matches?.[well.key]
      if (match == null || !Number.isFinite(match)) continue
      const weight = 6 - well.priority
      weightedSamples.push({ match, weight, priority: well.priority, key: well.key })

      const wellBucket = perWell[well.key]
      wellBucket.constrainedValidHours += durationHours
      if (match >= MATCH_TOLERANCE_PCT) wellBucket.constrainedProtectedHours += durationHours
      else wellBucket.constrainedShortHours += durationHours
    }

    if (!weightedSamples.length) continue

    for (const sample of weightedSamples) {
      const lowerPriorityBetter = weightedSamples.some((other) =>
        other.priority > sample.priority &&
        other.match > sample.match + 2 &&
        sample.match < MATCH_TOLERANCE_PCT,
      )
      if (lowerPriorityBetter) samplePenalty += 6
    }

    const sampleScore = clamp(
      (weightedSamples.reduce((sum, sample) => sum + sample.match * sample.weight, 0) /
        weightedSamples.reduce((sum, sample) => sum + sample.weight, 0)) - samplePenalty,
      0,
      100,
    )

    totalWeightedScore += sampleScore * durationHours
  }

  const scorePct = totalHours > 0 ? totalWeightedScore / totalHours : null
  return {
    scorePct,
    constrainedRuntimeHours: constrainedHours || null,
    autoPerfectRuntimeHours: autoPerfectHours || null,
    ruleNote: 'Priority reliability only scores constrained or sacrifice periods. All unconstrained time auto-scores 100% by design.',
    wells: WELL_CONFIG.map((well) => {
      const bucket = perWell[well.key]
      return {
        wellName: bucket.wellName,
        priorityRank: bucket.priorityRank,
        protectedPctDuringConstraint: bucket.constrainedValidHours > 0
          ? (bucket.constrainedProtectedHours / bucket.constrainedValidHours) * 100
          : null,
        shortHoursDuringConstraint: bucket.constrainedShortHours || null,
        constrainedValidHours: bucket.constrainedValidHours || null,
      }
    }),
  }
}

export async function getPerformanceReportMeta() {
  const historyPaths = getHalfmannHistoryPaths()
  return {
    fetchedAt: new Date().toISOString(),
    controls: buildControlMeta(),
    storage: {
      historyDir: historyPaths.historyDir,
      panelMatchHistoryPath: historyPaths.panelMatchHistoryPath,
      rawHistoryPath: historyPaths.rawHistoryPath,
    },
  }
}

export async function generatePerformanceReport({
  startAt,
  endAt,
  preset = 'current-month',
} = {}) {
  const range = resolveDateRange({ preset, startAt, endAt })
  const records = loadHalfmannPanelMatchHistory({ startAt: range.startAt, endAt: range.endAt, includeFallback: false })
  const runtime = summarizeWellRuntime(records, range.endAt)
  const prioritization = summarizePrioritization(records, range.endAt)
  const firstRecord = records[0] || null
  const lastRecord = records[records.length - 1] || null
  const validCoveragePct = runtime.wells.length
    ? average(runtime.wells.map((well) => (well.runtimeMeetingPct != null ? 100 : 0)))
    : null

  return {
    fetchedAt: new Date().toISOString(),
    reportWindow: {
      startAt: toIso(range.startAt),
      endAt: toIso(range.endAt),
      preset,
    },
    controls: buildControlMeta(),
    runtime,
    prioritization,
    siteSummary: {
      overallRuntimeMeetingPct: runtime.overallRuntimeMeetingPct,
      overallAverageMatchPct: runtime.overallAverageMatchPct,
      prioritizationReliabilityPct: prioritization.scorePct,
      constrainedRuntimeHours: prioritization.constrainedRuntimeHours,
      autoPerfectPriorityHours: prioritization.autoPerfectRuntimeHours,
    },
    dataQuality: {
      sampleCount: records.length,
      firstSampleAt: firstRecord?.ts || null,
      lastSampleAt: lastRecord?.ts || null,
      validCoveragePct,
      fallbackExcluded: true,
      source: 'volume-history-plus-seeded-csv',
    },
  }
}
