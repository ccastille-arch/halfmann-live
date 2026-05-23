import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = existsSync('/data') ? '/data' : join(__dirname, '../data')
const HISTORY_DIR = join(DATA_DIR, 'halfmann-history')
const RAW_HISTORY_PATH = join(HISTORY_DIR, 'raw-snapshots.ndjson')
const PANEL_MATCH_HISTORY_PATH = join(HISTORY_DIR, 'panel-match-history.ndjson')
const SEED_IMPORTED_MARKER_PATH = join(HISTORY_DIR, 'seed-imported.json')
const SEED_CSV_PATH = join(__dirname, 'seed/halfmann-panel-match-seed.csv')

const WELL_HEADERS = {
  '214': ['Wellhead #214 Live Injection Match Percentage', 'Wellhead 214 Live Injection Match Percentage', 'Wellhead #1 Live Injection Match Percentage'],
  '444': ['Wellhead #444 Live Injection Match Percentage', 'Wellhead 444 Live Injection Match Percentage', 'Wellhead #2 Live Injection Match Percentage'],
  '334': ['Wellhead #334 Live Injection Match Percentage', 'Wellhead 334 Live Injection Match Percentage', 'Wellhead #3 Live Injection Match Percentage'],
  '213': ['Wellhead #213 Live Injection Match Percentage', 'Wellhead 213 Live Injection Match Percentage', 'Wellhead #4 Live Injection Match Percentage'],
  '333': ['Wellhead #333 Live Injection Match Percentage', 'Wellhead 333 Live Injection Match Percentage', 'Wellhead #5 Live Injection Match Percentage'],
}

const WELL_PRIORITY = {
  '214': 2,
  '444': 5,
  '334': 4,
  '213': 3,
  '333': 1,
}

const MATCH_ADDRESSES = {
  '214': '420007',
  '444': '420008',
  '334': '420009',
  '213': '420010',
  '333': '420011',
}

const COMPRESSOR_RUN_STATUS_ADDRESSES = ['400114', '400115', '400116', '400117']

function ensureHistoryDir() {
  if (!existsSync(HISTORY_DIR)) mkdirSync(HISTORY_DIR, { recursive: true })
}

function normalizeAddress(value) {
  return String(value ?? '').trim().toLowerCase()
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const normalized = String(value ?? '').trim()
  if (!normalized || normalized === 'UNAVAILABLE' || normalized === 'INVALID') return null
  const numeric = Number(normalized.replace(/,/g, ''))
  return Number.isFinite(numeric) ? numeric : null
}

function parseBoolean(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'yes' || normalized === 'yes (1)' || normalized === 'yes (2)' || normalized === '1' || normalized === '2' || normalized === 'true' || normalized === 'running (1)') return true
  if (normalized === 'no' || normalized === 'no (0)' || normalized === '0' || normalized === 'false' || normalized === 'stopped (0)') return false
  return null
}

function appendJsonLine(filePath, payload) {
  ensureHistoryDir()
  appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8')
}

function readJsonLines(filePath) {
  if (!existsSync(filePath)) return []
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function findDatapoint(snapshot, address) {
  const datapoints = Array.isArray(snapshot?.datapoints) ? snapshot.datapoints : []
  return datapoints.find((datapoint) =>
    normalizeAddress(datapoint.addressStr || datapoint.address) === normalizeAddress(address),
  ) || null
}

function getSnapshotNumber(snapshot, address) {
  return parseNumber(findDatapoint(snapshot, address)?.value)
}

function getSnapshotBoolean(snapshot, address) {
  return parseBoolean(findDatapoint(snapshot, address)?.value)
}

function getRunningCompressors(snapshot) {
  return COMPRESSOR_RUN_STATUS_ADDRESSES.reduce((count, address) => (
    getSnapshotBoolean(snapshot, address) ? count + 1 : count
  ), 0)
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key]
    if (String(value ?? '').trim() !== '') return value
  }
  return null
}

export function ensureHalfmannHistoryBootstrapped() {
  ensureHistoryDir()
  if (existsSync(SEED_IMPORTED_MARKER_PATH) || !existsSync(SEED_CSV_PATH)) return

  const workbook = XLSX.read(readFileSync(SEED_CSV_PATH, 'utf8'), { type: 'string', raw: false })
  const firstSheet = workbook.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' })
  const records = rows
    .map((row) => {
      const timestamp = row.Timestamp ? new Date(row.Timestamp) : null
      if (!timestamp || Number.isNaN(timestamp.getTime())) return null
      const matches = Object.fromEntries(
        Object.entries(WELL_HEADERS).map(([wellName, headers]) => [wellName, parseNumber(firstValue(row, headers))]),
      )
      return {
        ts: timestamp.toISOString(),
        source: 'csv-seed',
        isFallback: false,
        matches,
        priorities: { ...WELL_PRIORITY },
        runningCompressors: null,
        compressorLimited: null,
        flowTargetBeingReduced: null,
        anyWellBelowSetpoint: null,
        totalDesiredSiteFlow: null,
        totalAscCompressorFlow: null,
        totalSiteFlow: null,
      }
    })
    .filter(Boolean)

  if (records.length) {
    writeFileSync(PANEL_MATCH_HISTORY_PATH, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8')
  }
  writeFileSync(SEED_IMPORTED_MARKER_PATH, JSON.stringify({
    importedAt: new Date().toISOString(),
    seedRows: records.length,
  }, null, 2))
}

export function recordHalfmannRawSnapshot(record) {
  appendJsonLine(RAW_HISTORY_PATH, record)
}

export function recordHalfmannPanelMatchSnapshot(panelSnapshot) {
  const matches = Object.fromEntries(
    Object.entries(MATCH_ADDRESSES).map(([wellName, address]) => [wellName, getSnapshotNumber(panelSnapshot, address)]),
  )
  const hasAnyMatch = Object.values(matches).some((value) => value != null)
  if (!hasAnyMatch) return

  const sourceState = panelSnapshot?._sourceSummary?.dashboardSnapshot?.state || 'unknown'
  appendJsonLine(PANEL_MATCH_HISTORY_PATH, {
    ts: new Date().toISOString(),
    source: 'runtime-poller',
    isFallback: sourceState === 'fallback-cache',
    matches,
    priorities: { ...WELL_PRIORITY },
    runningCompressors: getRunningCompressors(panelSnapshot),
    compressorLimited: getSnapshotBoolean(panelSnapshot, '420024'),
    flowTargetBeingReduced: getSnapshotBoolean(panelSnapshot, '420034'),
    anyWellBelowSetpoint: getSnapshotBoolean(panelSnapshot, '420021'),
    compressorsMeetingFlowDemand: getSnapshotBoolean(panelSnapshot, '420018'),
    anyCompressorNotMeetingDesiredFlow: getSnapshotBoolean(panelSnapshot, '420023'),
    recycleValvePosition: getSnapshotNumber(panelSnapshot, '400189') ?? getSnapshotNumber(panelSnapshot, '460618'),
    dischargeOverrideLatch: getSnapshotNumber(panelSnapshot, '460018'),
    totalDesiredSiteFlow: getSnapshotNumber(panelSnapshot, '420003'),
    totalAscCompressorFlow: getSnapshotNumber(panelSnapshot, '420012'),
    totalSiteFlow: getSnapshotNumber(panelSnapshot, '420005'),
  })
}

export function loadHalfmannPanelMatchHistory({ startAt, endAt, includeFallback = false } = {}) {
  ensureHalfmannHistoryBootstrapped()
  const startMs = startAt ? new Date(startAt).getTime() : null
  const endMs = endAt ? new Date(endAt).getTime() : null

  return readJsonLines(PANEL_MATCH_HISTORY_PATH)
    .filter((record) => {
      const ts = new Date(record.ts).getTime()
      if (!Number.isFinite(ts)) return false
      if (!includeFallback && record.isFallback) return false
      if (startMs != null && ts < startMs) return false
      if (endMs != null && ts > endMs) return false
      return true
    })
    .sort((left, right) => String(left.ts).localeCompare(String(right.ts)))
}

export function loadHalfmannRawHistory({ startAt, endAt } = {}) {
  ensureHalfmannHistoryBootstrapped()
  const startMs = startAt ? new Date(startAt).getTime() : null
  const endMs = endAt ? new Date(endAt).getTime() : null

  return readJsonLines(RAW_HISTORY_PATH)
    .filter((record) => {
      const ts = new Date(record.capturedAt || record.ts).getTime()
      if (!Number.isFinite(ts)) return false
      if (startMs != null && ts < startMs) return false
      if (endMs != null && ts > endMs) return false
      return true
    })
    .sort((left, right) => String(left.capturedAt || left.ts).localeCompare(String(right.capturedAt || right.ts)))
}

export function getHalfmannHistoryPaths() {
  ensureHistoryDir()
  return {
    historyDir: HISTORY_DIR,
    rawHistoryPath: RAW_HISTORY_PATH,
    panelMatchHistoryPath: PANEL_MATCH_HISTORY_PATH,
    seedImportedMarkerPath: SEED_IMPORTED_MARKER_PATH,
  }
}
