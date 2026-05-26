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

const WELL_TREND_MANIFEST = [
  {
    key: '214',
    label: 'Well 214',
    matchAddress: '420007',
    overrideAddress: '460466',
    analogOutputAddress: '400260',
    actualFlowAddress: '460212',
    targetFlowAddress: '460220',
    staticPressureAddress: '460214',
    runningStatusAddress: '460074',
    flowRunningPctAddress: '460146',
  },
  {
    key: '444',
    label: 'Well 444',
    matchAddress: '420008',
    overrideAddress: '460468',
    analogOutputAddress: '400261',
    actualFlowAddress: '460226',
    targetFlowAddress: '460234',
    staticPressureAddress: '460228',
    runningStatusAddress: '460076',
    flowRunningPctAddress: '460152',
  },
  {
    key: '334',
    label: 'Well 334',
    matchAddress: '420009',
    overrideAddress: '460470',
    analogOutputAddress: '400262',
    actualFlowAddress: '460240',
    targetFlowAddress: '460248',
    staticPressureAddress: '460242',
    runningStatusAddress: '460078',
    flowRunningPctAddress: '460158',
  },
  {
    key: '213',
    label: 'Well 213',
    matchAddress: '420010',
    overrideAddress: '460472',
    analogOutputAddress: '400263',
    actualFlowAddress: '460254',
    targetFlowAddress: '460262',
    staticPressureAddress: '460256',
    runningStatusAddress: '460080',
    flowRunningPctAddress: '460164',
  },
  {
    key: '333',
    label: 'Well 333',
    matchAddress: '420011',
    overrideAddress: '460474',
    analogOutputAddress: '400264',
    actualFlowAddress: '460268',
    targetFlowAddress: '460276',
    staticPressureAddress: '460270',
    runningStatusAddress: '460082',
    flowRunningPctAddress: '460170',
  },
]

const COMPRESSOR_TREND_MANIFEST = [
  { key: 'unit2128', unitLabel: '2128', deviceId: '2507-500076', desiredFlowAddress: '460002', currentFlowAddress: '460364', meetingAddress: '420014' },
  { key: 'unit2130', unitLabel: '2130', deviceId: '2507-500709', desiredFlowAddress: '460004', currentFlowAddress: '460384', meetingAddress: '420015' },
  { key: 'unit2127', unitLabel: '2127', deviceId: '2504-504108', desiredFlowAddress: '460006', currentFlowAddress: '460404', meetingAddress: '420029' },
  { key: 'unit2129', unitLabel: '2129', deviceId: '2504-504102', desiredFlowAddress: '460008', currentFlowAddress: '460424', meetingAddress: '420030' },
]

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
  if (
    normalized === 'yes' ||
    normalized === 'yes (1)' ||
    normalized === 'yes (2)' ||
    normalized === '1' ||
    normalized === '2' ||
    normalized === 'true' ||
    normalized === 'running (1)' ||
    normalized === 'online (1)' ||
    normalized === 'online'
  ) return true
  if (
    normalized === 'no' ||
    normalized === 'no (0)' ||
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'stopped (0)' ||
    normalized === 'offline (0)' ||
    normalized === 'offline'
  ) return false
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

function getSnapshotDatapoints(snapshot) {
  return Array.isArray(snapshot?.datapoints) ? snapshot.datapoints : []
}

function getSnapshotText(snapshot, matcher) {
  const datapoints = getSnapshotDatapoints(snapshot)
  const matchers = Array.isArray(matcher) ? matcher : [matcher]
  const normalizedMatchers = matchers.map((value) => normalizeAddress(value))
  const found = datapoints.find((datapoint) => {
    const label = datapoint?.desc || datapoint?.alias || datapoint?.Name || datapoint?.name || ''
    const normalizedLabel = normalizeAddress(label)
    const normalizedAddress = normalizeAddress(datapoint?.addressStr || datapoint?.address)
    return normalizedMatchers.includes(normalizedLabel) || normalizedMatchers.includes(normalizedAddress)
  })
  const value = found?.value
  return value == null ? null : String(value)
}

function getSnapshotNumberFromMatchers(snapshot, matcher) {
  return parseNumber(getSnapshotText(snapshot, matcher))
}

function getSnapshotBooleanFromMatchers(snapshot, matcher) {
  return parseBoolean(getSnapshotText(snapshot, matcher))
}

function parseTimestampMs(value) {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function buildUnitSnapshotMap(record) {
  const units = Array.isArray(record?.units) ? record.units : []
  return new Map(units.map((unit) => [String(unit?.deviceId || ''), unit]))
}

function mergeHistoryStreams(rawRecords, matchRecords) {
  const byBucket = new Map()

  for (const record of rawRecords) {
    const timestampMs = parseTimestampMs(record?.capturedAt || record?.ts)
    if (timestampMs == null) continue
    const bucket = Math.floor(timestampMs / 1000)
    byBucket.set(bucket, {
      ...(byBucket.get(bucket) || {}),
      raw: record,
      timestampMs,
    })
  }

  for (const record of matchRecords) {
    const timestampMs = parseTimestampMs(record?.ts)
    if (timestampMs == null) continue
    const bucket = Math.floor(timestampMs / 1000)
    const existing = byBucket.get(bucket)
    byBucket.set(bucket, {
      ...(existing || {}),
      match: record,
      timestampMs: existing?.timestampMs ?? timestampMs,
    })
  }

  return [...byBucket.values()].sort((left, right) => left.timestampMs - right.timestampMs)
}

function average(values) {
  const valid = values.filter((value) => value != null && Number.isFinite(value))
  if (!valid.length) return null
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function maxValue(values) {
  const valid = values.filter((value) => value != null && Number.isFinite(value))
  if (!valid.length) return null
  return valid.reduce((max, value) => Math.max(max, value), valid[0])
}

function buildTrendingSample(recordPair) {
  const rawRecord = recordPair.raw
  const matchRecord = recordPair.match
  const panelSnapshot = rawRecord?.panel || null
  const unitMap = buildUnitSnapshotMap(rawRecord)

  const wells = WELL_TREND_MANIFEST.map((well) => ({
    key: well.key,
    label: well.label,
    matchPct: panelSnapshot
      ? getSnapshotNumber(panelSnapshot, well.matchAddress)
      : parseNumber(matchRecord?.matches?.[well.key]),
    chokeCommand: panelSnapshot
      ? getSnapshotNumberFromMatchers(panelSnapshot, [well.analogOutputAddress, `Well #${well.key} Analog Output`, `Well ${well.key} Choke Position`])
      : null,
    overridePosition: panelSnapshot
      ? getSnapshotNumber(panelSnapshot, well.overrideAddress)
      : null,
    actualFlow: panelSnapshot
      ? getSnapshotNumber(panelSnapshot, well.actualFlowAddress)
      : null,
    targetFlow: panelSnapshot
      ? getSnapshotNumber(panelSnapshot, well.targetFlowAddress)
      : null,
    staticPressure: panelSnapshot
      ? getSnapshotNumber(panelSnapshot, well.staticPressureAddress)
      : null,
    online: panelSnapshot
      ? getSnapshotBooleanFromMatchers(panelSnapshot, well.runningStatusAddress)
      : null,
    flowRunningPct: panelSnapshot
      ? getSnapshotNumber(panelSnapshot, well.flowRunningPctAddress)
      : null,
  }))

  const compressors = COMPRESSOR_TREND_MANIFEST.map((compressor, index) => {
    const unitSnapshot = unitMap.get(compressor.deviceId) || null
    return {
      key: compressor.key,
      label: `Compressor ${index + 1}`,
      unitLabel: compressor.unitLabel,
      desiredFlow: panelSnapshot ? getSnapshotNumber(panelSnapshot, compressor.desiredFlowAddress) : null,
      currentFlow: panelSnapshot ? getSnapshotNumber(panelSnapshot, compressor.currentFlowAddress) : null,
      meetingFlow: panelSnapshot ? getSnapshotBoolean(panelSnapshot, compressor.meetingAddress) : null,
      suctionPressure: unitSnapshot
        ? getSnapshotNumberFromMatchers(unitSnapshot, ['400505', 'Stage 1 Suction Prs', 'Suction Pressure', 'Stage 1 Suction Pressure'])
        : null,
      dischargePressure: unitSnapshot
        ? getSnapshotNumberFromMatchers(unitSnapshot, ['400510', 'Stage 3 Discharge Prs', 'Discharge Pressure', 'Stage 3 Discharge Pressure'])
        : null,
      loadedAutoSp: unitSnapshot
        ? getSnapshotNumberFromMatchers(unitSnapshot, ['401018', 'Loaded Auto Sp', 'Loaded Auto SP'])
        : null,
    }
  })

  const siteSuctionRaw = panelSnapshot ? getSnapshotNumberFromMatchers(panelSnapshot, ['400183', 'Suction Header Pressure']) : null
  const siteSuction = siteSuctionRaw != null && siteSuctionRaw > 0
    ? siteSuctionRaw
    : average(compressors.map((compressor) => compressor.suctionPressure))

  return {
    timestampMs: recordPair.timestampMs,
    source: matchRecord?.source || (rawRecord ? 'runtime-poller' : 'unknown'),
    isFallback: Boolean(matchRecord?.isFallback),
    allWellsMeetingFlow: panelSnapshot ? getSnapshotBoolean(panelSnapshot, '420031') : null,
    anyWellBelowSetpoint: panelSnapshot ? getSnapshotBoolean(panelSnapshot, '420021') : matchRecord?.anyWellBelowSetpoint ?? null,
    wellsMeetingRate: panelSnapshot ? getSnapshotNumber(panelSnapshot, '420041') : null,
    runningCompressors: panelSnapshot ? getRunningCompressors(panelSnapshot) : (matchRecord?.runningCompressors ?? null),
    compressorLimited: panelSnapshot ? getSnapshotBoolean(panelSnapshot, '420024') : matchRecord?.compressorLimited ?? null,
    flowTargetBeingReduced: panelSnapshot ? getSnapshotBoolean(panelSnapshot, '420034') : matchRecord?.flowTargetBeingReduced ?? null,
    compressorsMeetingFlowDemand: panelSnapshot ? getSnapshotBoolean(panelSnapshot, '420018') : matchRecord?.compressorsMeetingFlowDemand ?? null,
    anyCompressorNotMeetingDesiredFlow: panelSnapshot ? getSnapshotBoolean(panelSnapshot, '420023') : matchRecord?.anyCompressorNotMeetingDesiredFlow ?? null,
    recycleValvePosition: panelSnapshot
      ? getSnapshotNumberFromMatchers(panelSnapshot, ['400189', '460618', 'Recycle Valve Position'])
      : matchRecord?.recycleValvePosition ?? null,
    dischargeOverrideLatch: panelSnapshot ? getSnapshotNumber(panelSnapshot, '460018') : matchRecord?.dischargeOverrideLatch ?? null,
    dischargeOverrideCompSpeedSp: panelSnapshot ? getSnapshotNumber(panelSnapshot, '460020') : null,
    totalDesiredSiteFlow: panelSnapshot ? getSnapshotNumber(panelSnapshot, '420003') : matchRecord?.totalDesiredSiteFlow ?? null,
    totalAscCompressorFlow: panelSnapshot ? getSnapshotNumber(panelSnapshot, '420012') : matchRecord?.totalAscCompressorFlow ?? null,
    totalSiteFlow: panelSnapshot ? getSnapshotNumber(panelSnapshot, '420005') : matchRecord?.totalSiteFlow ?? null,
    panelCommandedCompressorFlow: panelSnapshot ? getSnapshotNumber(panelSnapshot, '420042') : null,
    siteDischarge: maxValue(compressors.map((compressor) => compressor.dischargePressure)),
    siteSuction,
    wells,
    compressors,
  }
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

export function loadHalfmannTrendingHistory({ startAt, endAt, includeFallback = false } = {}) {
  const rawRecords = loadHalfmannRawHistory({ startAt, endAt })
  const matchRecords = loadHalfmannPanelMatchHistory({ startAt, endAt, includeFallback })
  const merged = mergeHistoryStreams(rawRecords, matchRecords)
  return merged
    .map(buildTrendingSample)
    .filter((sample) => sample.timestampMs != null)
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
