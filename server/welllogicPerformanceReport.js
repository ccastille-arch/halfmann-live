import { getHalfmannHistoryPaths, loadHalfmannPanelMatchHistory } from './halfmannHistoryStore.js'
import {
  archivePerformanceReport,
  clampHalfmannHistoryStart,
  getArchivedPerformanceReportStorageMeta,
  getCalendarContext,
  getHalfmannHistoryFloor,
  listArchivedPerformanceReports,
  zonedDateTimeToUtc,
} from './halfmannReportArchive.js'

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
const RELATIVE_PRESET_OPTIONS = [
  { key: 'last-30-minutes', label: 'Last 30 Minutes', minutes: 30 },
  ...Array.from({ length: 24 }, (_, index) => ({
    key: `last-${index + 1}-hour${index === 0 ? '' : 's'}`,
    label: `Last ${index + 1} Hour${index === 0 ? '' : 's'}`,
    hours: index + 1,
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    key: `last-${index + 2}-days`,
    label: `Last ${index + 2} Days`,
    days: index + 2,
  })),
  { key: 'last-14-days', label: 'Last 14 Days', days: 14 },
  { key: 'last-21-days', label: 'Last 21 Days', days: 21 },
  { key: 'last-30-days', label: 'Last 30 Days', days: 30 },
  { key: 'current-month', label: 'Month to Date' },
  { key: 'previous-month', label: 'Last Month' },
  { key: 'last-90-days', label: 'Last 90 Days', days: 90 },
  { key: 'custom', label: 'Custom Range' },
]

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

function getTimeZoneDateParts(date = new Date(), timeZone = 'America/Chicago') {
  const normalizedDate = date instanceof Date ? date : new Date(date)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(
    formatter
      .formatToParts(normalizedDate)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  }
}

function endOfLocalDay(parts, timezone) {
  return new Date(zonedDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day + 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  }, timezone).getTime() - 1)
}

function beginningOfLocalDay(parts, timezone) {
  return zonedDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  }, timezone)
}

function previousLocalDateParts(now, timezone) {
  const parts = getCalendarContext(now, timezone)
  const currentDayStart = zonedDateTimeToUtc({
    year: Number(parts.monthKey.slice(0, 4)),
    month: Number(parts.monthKey.slice(5, 7)),
    day: parts.dayOfMonth,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  }, timezone)
  return getTimeZoneDateParts(new Date(currentDayStart.getTime() - 1000), timezone)
}

function findPresetOption(key) {
  return RELATIVE_PRESET_OPTIONS.find((option) => option.key === key) || null
}

function resolveDateRange({ preset = 'current-month', startAt, endAt, now = new Date() }) {
  if (startAt && endAt) {
    const clampedStart = clampHalfmannHistoryStart(startAt)
    const normalizedEnd = new Date(endAt)
    return {
      startAt: clampedStart,
      endAt: normalizedEnd < clampedStart ? new Date(clampedStart) : normalizedEnd,
      preset,
    }
  }

  const calendar = getCalendarContext(now)
  const effectiveNow = new Date(calendar.nowIso)
  const timezone = calendar.timezone
  const currentYear = Number(calendar.monthKey.slice(0, 4))
  const currentMonth = Number(calendar.monthKey.slice(5, 7))

  const relativePreset = findPresetOption(preset)
  if (relativePreset?.minutes) {
    const start = new Date(effectiveNow.getTime() - (relativePreset.minutes * 60 * 1000))
    const clampedStart = clampHalfmannHistoryStart(start, timezone)
    return {
      startAt: clampedStart,
      endAt: effectiveNow < clampedStart ? new Date(clampedStart) : effectiveNow,
      preset,
    }
  }

  if (relativePreset?.hours) {
    const start = new Date(effectiveNow.getTime() - (relativePreset.hours * 60 * 60 * 1000))
    const clampedStart = clampHalfmannHistoryStart(start, timezone)
    return {
      startAt: clampedStart,
      endAt: effectiveNow < clampedStart ? new Date(clampedStart) : effectiveNow,
      preset,
    }
  }

  if (relativePreset?.days && !['current-month', 'previous-month'].includes(preset)) {
    const start = new Date(effectiveNow.getTime() - (relativePreset.days * 24 * 60 * 60 * 1000))
    const clampedStart = clampHalfmannHistoryStart(start, timezone)
    return {
      startAt: clampedStart,
      endAt: effectiveNow < clampedStart ? new Date(clampedStart) : effectiveNow,
      preset,
    }
  }

  if (preset === 'current-month') {
    const clampedStart = clampHalfmannHistoryStart(calendar.monthStartIso, timezone)
    return {
      startAt: clampedStart,
      endAt: effectiveNow,
      preset,
    }
  }

  if (preset === 'previous-month') {
    const previousMonth = currentMonth === 1
      ? { year: currentYear - 1, month: 12 }
      : { year: currentYear, month: currentMonth - 1 }
    const nextMonth = previousMonth.month === 12
      ? { year: previousMonth.year + 1, month: 1 }
      : { year: previousMonth.year, month: previousMonth.month + 1 }
    const start = zonedDateTimeToUtc({ ...previousMonth, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 }, timezone)
    const end = new Date(zonedDateTimeToUtc({ ...nextMonth, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 }, timezone).getTime() - 1)
    const clampedStart = clampHalfmannHistoryStart(start, timezone)
    return { startAt: clampedStart, endAt: end < clampedStart ? new Date(clampedStart) : end, preset }
  }
  const clampedStart = clampHalfmannHistoryStart(calendar.monthStartIso, timezone)
  return {
    startAt: clampedStart,
    endAt: effectiveNow < clampedStart ? new Date(clampedStart) : effectiveNow,
    preset: 'current-month',
  }
}

function buildControlMeta() {
  return {
    siteName: 'Halfmann 1214',
    units: HALF_MANN_DEVICE_MANIFEST.map((unit) => ({
      ...unit,
      selectedByDefault: true,
    })),
    defaultDeviceIds: HALF_MANN_DEVICE_MANIFEST.map((unit) => unit.deviceId),
    presetOptions: RELATIVE_PRESET_OPTIONS,
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
      weightedSamples.push({ match, weight, priority: well.priority })

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

function buildReportSnapshot(range) {
  const records = loadHalfmannPanelMatchHistory({ startAt: range.startAt, endAt: range.endAt, includeFallback: false })
  const runtime = summarizeWellRuntime(records, range.endAt)
  const prioritization = summarizePrioritization(records, range.endAt)
  const firstRecord = records[0] || null
  const lastRecord = records[records.length - 1] || null
  const validCoveragePct = runtime.wells.length
    ? average(runtime.wells.map((well) => (well.runtimeMeetingPct != null ? 100 : 0)))
    : null
  const siteSummary = {
    overallRuntimeMeetingPct: runtime.overallRuntimeMeetingPct,
    overallAverageMatchPct: runtime.overallAverageMatchPct,
    prioritizationReliabilityPct: prioritization.scorePct,
    constrainedRuntimeHours: prioritization.constrainedRuntimeHours,
    autoPerfectPriorityHours: prioritization.autoPerfectRuntimeHours,
  }
  const kpis = {
    overallWellRuntimePct: runtime.overallRuntimeMeetingPct,
    averageMatchPct: runtime.overallAverageMatchPct,
    prioritizationReliabilityPct: prioritization.scorePct,
    constrainedRuntimeHours: prioritization.constrainedRuntimeHours,
  }

  return {
    reportWindow: {
      startAt: toIso(range.startAt),
      endAt: toIso(range.endAt),
      preset: range.preset,
    },
    runtime,
    prioritization,
    siteSummary,
    kpis,
    dataQuality: {
      sampleCount: records.length,
      firstSampleAt: firstRecord?.ts || null,
      lastSampleAt: lastRecord?.ts || null,
      validCoveragePct,
      fallbackExcluded: true,
      source: 'volume-history-plus-seeded-csv',
    },
    calendar: getCalendarContext(new Date()),
    historyFloor: getHalfmannHistoryFloor(),
  }
}

function windowsMatch(left, right) {
  return left?.startAt === right?.startAt && left?.endAt === right?.endAt && left?.preset === right?.preset
}

function withDownloadUrls(meta) {
  return {
    ...meta,
    jsonDownloadUrl: `/api/performance-report/download?path=${encodeURIComponent(meta.jsonRelativePath)}&filename=${encodeURIComponent(meta.jsonRelativePath.split('/').pop() || 'report.json')}`,
    xlsxDownloadUrl: `/api/performance-report/download?path=${encodeURIComponent(meta.xlsxRelativePath)}&filename=${encodeURIComponent(meta.xlsxRelativePath.split('/').pop() || 'report.xlsx')}`,
  }
}

export async function getPerformanceReportMeta() {
  const historyPaths = getHalfmannHistoryPaths()
  const storageMeta = getArchivedPerformanceReportStorageMeta()
  return {
    fetchedAt: new Date().toISOString(),
    controls: buildControlMeta(),
    calendar: storageMeta.monthToDate,
    historyFloor: getHalfmannHistoryFloor(),
    storage: {
      historyDir: historyPaths.historyDir,
      panelMatchHistoryPath: historyPaths.panelMatchHistoryPath,
      rawHistoryPath: historyPaths.rawHistoryPath,
      reportsDir: storageMeta.reportsDir,
    },
    archivedReports: listArchivedPerformanceReports(),
  }
}

function sameWindow(left, right) {
  return left?.startAt === right?.startAt && left?.endAt === right?.endAt && left?.preset === right?.preset
}

export function buildScheduledArchiveRanges(now = new Date()) {
  const timezone = getCalendarContext(now).timezone
  const yesterdayParts = previousLocalDateParts(now, timezone)
  const dailyStart = clampHalfmannHistoryStart(beginningOfLocalDay(yesterdayParts, timezone), timezone)
  const dailyEnd = endOfLocalDay(yesterdayParts, timezone)

  const weeklyEnd = dailyEnd
  const weeklyStart = clampHalfmannHistoryStart(new Date(dailyStart.getTime() - (6 * 24 * 60 * 60 * 1000)), timezone)

  const calendar = getCalendarContext(now, timezone)
  const currentYear = Number(calendar.monthKey.slice(0, 4))
  const currentMonth = Number(calendar.monthKey.slice(5, 7))
  const previousMonth = currentMonth === 1
    ? { year: currentYear - 1, month: 12 }
    : { year: currentYear, month: currentMonth - 1 }
  const nextMonth = previousMonth.month === 12
    ? { year: previousMonth.year + 1, month: 1 }
    : { year: previousMonth.year, month: previousMonth.month + 1 }
  const monthlyStart = clampHalfmannHistoryStart(zonedDateTimeToUtc({
    ...previousMonth,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  }, timezone), timezone)
  const monthlyEnd = new Date(zonedDateTimeToUtc({
    ...nextMonth,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  }, timezone).getTime() - 1)

  return [
    { kind: 'daily', preset: 'last-24-hours', startAt: dailyStart, endAt: dailyEnd },
    { kind: 'weekly', preset: 'last-7-days', startAt: weeklyStart, endAt: weeklyEnd },
    { kind: 'monthly', preset: 'previous-month', startAt: monthlyStart, endAt: monthlyEnd },
  ]
}

export async function ensureScheduledPerformanceArchives(now = new Date()) {
  const existingReports = listArchivedPerformanceReports(500)
  for (const range of buildScheduledArchiveRanges(now)) {
    const reportWindow = {
      startAt: toIso(range.startAt),
      endAt: toIso(range.endAt),
      preset: range.preset,
    }
    const existing = existingReports.find((item) => item.kind === range.kind && sameWindow(item.reportWindow, reportWindow))
    if (existing) continue
    const report = buildReportSnapshot(range)
    archivePerformanceReport(report, { kind: range.kind })
  }
}

export async function generatePerformanceReport({
  startAt,
  endAt,
  preset = 'current-month',
} = {}) {
  const anchorNow = new Date()
  ensureScheduledPerformanceArchives(anchorNow)
  const selectedRange = resolveDateRange({ preset, startAt, endAt, now: anchorNow })
  const selectedReport = buildReportSnapshot(selectedRange)
  const monthToDateReport = buildReportSnapshot(resolveDateRange({ preset: 'current-month', now: anchorNow }))
  const monthToDateArchive = archivePerformanceReport(monthToDateReport, { kind: 'month-to-date' })
  const selectedArchive = windowsMatch(selectedReport.reportWindow, monthToDateReport.reportWindow)
    ? monthToDateArchive
    : archivePerformanceReport(selectedReport, { kind: selectedRange.preset || 'selected-range' })

  return {
    fetchedAt: new Date().toISOString(),
    controls: buildControlMeta(),
    calendar: monthToDateReport.calendar,
    historyFloor: monthToDateReport.historyFloor,
    reportWindow: selectedReport.reportWindow,
    runtime: selectedReport.runtime,
    prioritization: selectedReport.prioritization,
    siteSummary: selectedReport.siteSummary,
    kpis: selectedReport.kpis,
    dataQuality: selectedReport.dataQuality,
    monthToDate: {
      reportWindow: monthToDateReport.reportWindow,
      siteSummary: monthToDateReport.siteSummary,
      kpis: monthToDateReport.kpis,
      dataQuality: monthToDateReport.dataQuality,
    },
    archives: {
      selectedReport: withDownloadUrls(selectedArchive),
      monthToDate: withDownloadUrls(monthToDateArchive),
      storedReports: listArchivedPerformanceReports(),
    },
  }
}
