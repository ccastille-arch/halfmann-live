import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, relative, resolve } from 'path'
import * as XLSX from 'xlsx'
import { getHalfmannHistoryPaths } from './halfmannHistoryStore.js'

export const REPORT_TIMEZONE = process.env.HALFMANN_REPORT_TIMEZONE || 'America/Chicago'
export const HALFMANN_HISTORY_FLOOR_ISO = process.env.HALFMANN_HISTORY_FLOOR_ISO || '2026-05-22T05:00:00.000Z'
const REPORT_SITE_NAME = 'Halfmann 1214'
const REPORTS_DIR = join(getHalfmannHistoryPaths().historyDir, 'reports')

function ensureReportsDir(dirPath = REPORTS_DIR) {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true })
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : null
}

function getTimeZoneParts(date = new Date(), timeZone = REPORT_TIMEZONE) {
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
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

function getTimeZoneOffsetMs(date, timeZone = REPORT_TIMEZONE) {
  const parts = getTimeZoneParts(date, timeZone)
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return localAsUtc - date.getTime()
}

export function zonedDateTimeToUtc(parts, timeZone = REPORT_TIMEZONE) {
  const {
    year,
    month,
    day,
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0,
  } = parts
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  let candidate = new Date(utcGuess)
  let offsetMs = getTimeZoneOffsetMs(candidate, timeZone)
  candidate = new Date(utcGuess - offsetMs)
  offsetMs = getTimeZoneOffsetMs(candidate, timeZone)
  return new Date(utcGuess - offsetMs)
}

function formatDateKey(value, timeZone = REPORT_TIMEZONE) {
  const parts = getTimeZoneParts(value, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function buildMonthKey(value, timeZone = REPORT_TIMEZONE) {
  const parts = getTimeZoneParts(value, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`
}

function sanitizeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/^_+|_+$/g, '') || 'report'
}

export function getCalendarContext(now = new Date(), timeZone = REPORT_TIMEZONE) {
  const parts = getTimeZoneParts(now, timeZone)
  const monthStart = zonedDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  }, timeZone)

  return {
    timezone: timeZone,
    nowIso: now.toISOString(),
    dayOfMonth: parts.day,
    monthKey: buildMonthKey(now, timeZone),
    monthStartIso: monthStart.toISOString(),
    monthToDateLabel: `${parts.year}-${String(parts.month).padStart(2, '0')} month-to-date`,
  }
}

export function getHalfmannHistoryFloor(timeZone = REPORT_TIMEZONE) {
  const floor = new Date(HALFMANN_HISTORY_FLOOR_ISO)
  return {
    iso: floor.toISOString(),
    timezone: timeZone,
    dateKey: formatDateKey(floor, timeZone),
    monthKey: buildMonthKey(floor, timeZone),
    localLabel: `${formatDateKey(floor, timeZone)} 00:00 ${timeZone}`,
  }
}

export function clampHalfmannHistoryStart(date, timeZone = REPORT_TIMEZONE) {
  const candidate = date instanceof Date ? new Date(date) : new Date(date)
  const floor = new Date(HALFMANN_HISTORY_FLOOR_ISO)
  if (Number.isNaN(candidate.getTime())) return new Date(floor)
  return candidate < floor ? new Date(floor) : candidate
}

function buildWorkbook(report) {
  const workbook = XLSX.utils.book_new()
  const kpis = report?.kpis || {}
  const runtimeWells = report?.runtime?.wells || []
  const priorityWells = report?.prioritization?.wells || []

  const summaryRows = [
    ['Metric', 'Value'],
    ['Site', REPORT_SITE_NAME],
    ['Timezone', report?.calendar?.timezone || REPORT_TIMEZONE],
    ['Report Start', report?.reportWindow?.startAt || ''],
    ['Report End', report?.reportWindow?.endAt || ''],
    ['Overall Well Runtime %', safeNumber(kpis.overallWellRuntimePct)],
    ['Average Match %', safeNumber(kpis.averageMatchPct)],
    ['Prioritization Reliability %', safeNumber(kpis.prioritizationReliabilityPct)],
    ['Constrained Runtime Hours', safeNumber(kpis.constrainedRuntimeHours)],
    ['Auto-Perfect Priority Hours', safeNumber(report?.siteSummary?.autoPerfectPriorityHours)],
    ['Sample Count', safeNumber(report?.dataQuality?.sampleCount)],
  ]

  const runtimeRows = [
    ['Well', 'Priority Rank', 'Average Match %', 'Runtime Meeting %', 'Meeting Hours', 'Below Target Hours', 'Valid Hours', 'Samples'],
    ...runtimeWells.map((well) => [
      well.wellName,
      safeNumber(well.priorityRank),
      safeNumber(well.averageMatchPct),
      safeNumber(well.runtimeMeetingPct),
      safeNumber(well.meetingHours),
      safeNumber(well.belowHours),
      safeNumber(well.validHours),
      safeNumber(well.sampleCount),
    ]),
  ]

  const priorityRows = [
    ['Well', 'Priority Rank', 'Protected % During Constraint', 'Short Hours During Constraint', 'Constraint Valid Hours'],
    ...priorityWells.map((well) => [
      well.wellName,
      safeNumber(well.priorityRank),
      safeNumber(well.protectedPctDuringConstraint),
      safeNumber(well.shortHoursDuringConstraint),
      safeNumber(well.constrainedValidHours),
    ]),
  ]

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(runtimeRows), 'Well Runtime')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(priorityRows), 'Priority Reliability')
  return workbook
}

export function archivePerformanceReport(report, { kind = 'generated' } = {}) {
  ensureReportsDir()
  const monthKey = buildMonthKey(report?.reportWindow?.startAt || new Date(), report?.calendar?.timezone || REPORT_TIMEZONE)
  const archiveDir = join(REPORTS_DIR, monthKey)
  ensureReportsDir(archiveDir)

  const startKey = formatDateKey(report?.reportWindow?.startAt || new Date(), report?.calendar?.timezone || REPORT_TIMEZONE)
  const endKey = formatDateKey(report?.reportWindow?.endAt || new Date(), report?.calendar?.timezone || REPORT_TIMEZONE)
  const presetKey = sanitizeSegment(kind === 'month-to-date' ? 'month_to_date' : report?.reportWindow?.preset || kind)
  const baseName = sanitizeSegment(`WellLogic_Runtime_Performance_Report_Halfmann_1214_${startKey}_to_${endKey}_${presetKey}`)
  const jsonFileName = `${baseName}.json`
  const xlsxFileName = `${baseName}.xlsx`
  const metaFileName = `${baseName}.meta.json`
  const jsonPath = join(archiveDir, jsonFileName)
  const xlsxPath = join(archiveDir, xlsxFileName)
  const metaPath = join(archiveDir, metaFileName)

  writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8')
  const workbookBuffer = XLSX.write(buildWorkbook(report), { type: 'buffer', bookType: 'xlsx' })
  writeFileSync(xlsxPath, workbookBuffer)

  const meta = {
    id: `${monthKey}/${baseName}`,
    label: kind === 'month-to-date'
      ? `Month-to-date report ${startKey} to ${endKey}`
      : `Stored report ${startKey} to ${endKey}`,
    generatedAt: new Date().toISOString(),
    kind,
    monthKey,
    timezone: report?.calendar?.timezone || REPORT_TIMEZONE,
    reportWindow: report?.reportWindow || null,
    kpis: report?.kpis || null,
    jsonRelativePath: relative(REPORTS_DIR, jsonPath).replace(/\\/g, '/'),
    xlsxRelativePath: relative(REPORTS_DIR, xlsxPath).replace(/\\/g, '/'),
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

export function listArchivedPerformanceReports(limit = 60) {
  ensureReportsDir()
  const metas = []
  const monthDirs = readdirSync(REPORTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  for (const monthDir of monthDirs) {
    const fullMonthDir = join(REPORTS_DIR, monthDir)
    const files = readdirSync(fullMonthDir).filter((name) => name.endsWith('.meta.json'))
    for (const fileName of files) {
      const fullPath = join(fullMonthDir, fileName)
      try {
        const parsed = JSON.parse(readFileSync(fullPath, 'utf8'))
        metas.push(parsed)
      } catch {}
    }
  }

  return metas
    .sort((left, right) => String(right.generatedAt || '').localeCompare(String(left.generatedAt || '')))
    .slice(0, limit)
    .map((meta) => ({
      ...meta,
      jsonDownloadUrl: `/api/performance-report/download?path=${encodeURIComponent(meta.jsonRelativePath)}&filename=${encodeURIComponent(meta.jsonRelativePath.split('/').pop() || 'report.json')}`,
      xlsxDownloadUrl: `/api/performance-report/download?path=${encodeURIComponent(meta.xlsxRelativePath)}&filename=${encodeURIComponent(meta.xlsxRelativePath.split('/').pop() || 'report.xlsx')}`,
    }))
}

export function resolveArchivedPerformanceReportPath(relativePath) {
  const root = resolve(REPORTS_DIR)
  const fullPath = resolve(root, relativePath)
  if (!fullPath.startsWith(root)) {
    const error = new Error('Invalid report path')
    error.status = 400
    throw error
  }
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    const error = new Error('Stored report not found')
    error.status = 404
    throw error
  }
  return fullPath
}

export function getArchivedPerformanceReportStorageMeta() {
  ensureReportsDir()
  return {
    timezone: REPORT_TIMEZONE,
    reportsDir: REPORTS_DIR,
    monthToDate: getCalendarContext(),
  }
}
