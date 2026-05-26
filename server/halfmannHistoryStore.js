import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import * as XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = existsSync('/data') ? '/data' : join(__dirname, '../data')
const HISTORY_DIR = join(DATA_DIR, 'halfmann-history')
const RAW_HISTORY_PATH = join(HISTORY_DIR, 'raw-snapshots.ndjson')
const PANEL_MATCH_HISTORY_PATH = join(HISTORY_DIR, 'panel-match-history.ndjson')
const TREND_HISTORY_PATH = join(HISTORY_DIR, 'trend-samples.ndjson')
const SEED_IMPORTED_MARKER_PATH = join(HISTORY_DIR, 'seed-imported.json')
const SEED_CSV_PATH = join(__dirname, 'seed/halfmann-panel-match-seed.csv')
const RECENT_TREND_SAMPLE_LIMIT = 1800
const RECENT_TREND_SAMPLES = []

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
    wellNumber: 1,
    label: 'Well 214',
    matchAddress: '420007',
    overrideAddress: '460466',
    chokePositionAddress: '400017',
    analogOutputAddress: '400260',
    actualFlowAddress: '460212',
    targetFlowAddress: '460220',
    staticPressureAddress: '460214',
    differentialPressureAddress: '460216',
    runningStatusAddress: '460074',
    flowRunningPctAddress: '460146',
  },
  {
    key: '444',
    wellNumber: 2,
    label: 'Well 444',
    matchAddress: '420008',
    overrideAddress: '460468',
    chokePositionAddress: '400035',
    analogOutputAddress: '400261',
    actualFlowAddress: '460226',
    targetFlowAddress: '460234',
    staticPressureAddress: '460228',
    differentialPressureAddress: '460230',
    runningStatusAddress: '460076',
    flowRunningPctAddress: '460152',
  },
  {
    key: '334',
    wellNumber: 3,
    label: 'Well 334',
    matchAddress: '420009',
    overrideAddress: '460470',
    chokePositionAddress: '400053',
    analogOutputAddress: '400262',
    actualFlowAddress: '460240',
    targetFlowAddress: '460248',
    staticPressureAddress: '460242',
    differentialPressureAddress: '460244',
    runningStatusAddress: '460078',
    flowRunningPctAddress: '460158',
  },
  {
    key: '213',
    wellNumber: 4,
    label: 'Well 213',
    matchAddress: '420010',
    overrideAddress: '460472',
    chokePositionAddress: '400071',
    analogOutputAddress: '400263',
    actualFlowAddress: '460254',
    targetFlowAddress: '460262',
    staticPressureAddress: '460256',
    differentialPressureAddress: '460258',
    runningStatusAddress: '460080',
    flowRunningPctAddress: '460164',
  },
  {
    key: '333',
    wellNumber: 5,
    label: 'Well 333',
    matchAddress: '420011',
    overrideAddress: '460474',
    chokePositionAddress: '400089',
    analogOutputAddress: '400264',
    actualFlowAddress: '460268',
    targetFlowAddress: '460276',
    staticPressureAddress: '460270',
    differentialPressureAddress: '460272',
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

function readJsonLinesTail(filePath, maxLines) {
  if (!existsSync(filePath)) return []
  if (!Number.isFinite(maxLines) || maxLines <= 0) return readJsonLines(filePath)

  const stats = statSync(filePath)
  if (!stats.size) return []

  const fd = openSync(filePath, 'r')
  const chunkSize = 64 * 1024
  let position = stats.size
  let text = ''
  let lines = []

  try {
    while (position > 0 && lines.length <= maxLines + 1) {
      const bytesToRead = Math.min(chunkSize, position)
      position -= bytesToRead
      const buffer = Buffer.alloc(bytesToRead)
      readSync(fd, buffer, 0, bytesToRead, position)
      text = buffer.toString('utf8') + text
      lines = text.split(/\r?\n/)
    }
  } finally {
    closeSync(fd)
  }

  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-maxLines)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function estimateTailLineBudget({ startAt, endAt, cadenceSeconds = 2, multiplier = 1.5, minimum = 2000, maximum = 400000 } = {}) {
  const startMs = startAt ? new Date(startAt).getTime() : null
  const endMs = endAt ? new Date(endAt).getTime() : Date.now()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return minimum
  const spanSeconds = Math.max(1, Math.ceil((endMs - startMs) / 1000))
  const estimated = Math.ceil((spanSeconds / cadenceSeconds) * multiplier)
  return Math.max(minimum, Math.min(maximum, estimated))
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

function firstDefinedNumber(...values) {
  for (const value of values) {
    if (value != null && Number.isFinite(value)) return value
  }
  return null
}

function pushRecentTrendSample(sample) {
  if (!sample?.timestampMs) return
  const last = RECENT_TREND_SAMPLES[RECENT_TREND_SAMPLES.length - 1]
  if (last?.timestampMs === sample.timestampMs) {
    RECENT_TREND_SAMPLES[RECENT_TREND_SAMPLES.length - 1] = sample
  } else {
    RECENT_TREND_SAMPLES.push(sample)
  }
  if (RECENT_TREND_SAMPLES.length > RECENT_TREND_SAMPLE_LIMIT) {
    RECENT_TREND_SAMPLES.splice(0, RECENT_TREND_SAMPLES.length - RECENT_TREND_SAMPLE_LIMIT)
  }
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

  const wells = WELL_TREND_MANIFEST.map((well) => {
    const overridePosition = panelSnapshot
      ? getSnapshotNumber(panelSnapshot, well.overrideAddress)
      : null
    const directChokeCommand = panelSnapshot
      ? getSnapshotNumberFromMatchers(panelSnapshot, [
          well.chokePositionAddress,
          well.analogOutputAddress,
          `Wellhead #${well.wellNumber} Choke Position`,
          `Well ${well.wellNumber} Choke Position`,
          `Well #${well.wellNumber} Analog Output ${well.wellNumber}`,
        ])
      : null

    return {
      key: well.key,
      label: well.label,
      matchPct: panelSnapshot
        ? getSnapshotNumber(panelSnapshot, well.matchAddress)
        : parseNumber(matchRecord?.matches?.[well.key]),
      chokeCommand: firstDefinedNumber(
        directChokeCommand,
        overridePosition != null && overridePosition > 0 ? overridePosition : null,
      ),
      overridePosition,
      actualFlow: panelSnapshot
        ? getSnapshotNumberFromMatchers(panelSnapshot, [
            well.actualFlowAddress,
            `Wellhead #${well.wellNumber} Injection Flow Rate From Customer PLC`,
            `Well #${well.wellNumber} Flow Rate`,
          ])
        : null,
      targetFlow: panelSnapshot
        ? getSnapshotNumberFromMatchers(panelSnapshot, [
            well.targetFlowAddress,
            `Wellhead #${well.wellNumber} Setpoint From Customer PLC`,
            `Well ${well.wellNumber} Setpoint`,
          ])
        : null,
      staticPressure: panelSnapshot
        ? getSnapshotNumberFromMatchers(panelSnapshot, [
            well.staticPressureAddress,
            `Wellhead #${well.wellNumber} Injection Static Pressure From Customer PLC`,
            `Well ${well.wellNumber} Static Pressure`,
          ])
        : null,
      differentialPressure: panelSnapshot
        ? getSnapshotNumberFromMatchers(panelSnapshot, [
            well.differentialPressureAddress,
            `Wellhead #${well.wellNumber} Injection Differential Prs From Customer PLC`,
            `Well ${well.wellNumber} Injection Differential Pressure`,
            `Well ${well.wellNumber} Differential Pressure`,
          ])
        : null,
      online: panelSnapshot
        ? getSnapshotBooleanFromMatchers(panelSnapshot, [
            well.runningStatusAddress,
            `WellHead #${well.wellNumber} Running Status`,
          ])
        : null,
      flowRunningPct: panelSnapshot
        ? getSnapshotNumberFromMatchers(panelSnapshot, [
            well.flowRunningPctAddress,
            `Wellhead #${well.wellNumber} Flow Running Status Percent`,
          ])
        : null,
    }
  })

  const compressors = COMPRESSOR_TREND_MANIFEST.map((compressor, index) => {
    const unitSnapshot = unitMap.get(compressor.deviceId) || null
    return {
      key: compressor.key,
      label: `Compressor ${index + 1}`,
      unitLabel: compressor.unitLabel,
      desiredFlow: panelSnapshot
        ? getSnapshotNumberFromMatchers(panelSnapshot, [
            compressor.desiredFlowAddress,
            `Compressor #${index + 1} Unit ${compressor.unitLabel} Desire Flow SP For PID Murphy`,
            `Compressor #${index + 1} Desire Flow SP For PID Murphy`,
          ])
        : null,
      currentFlow: panelSnapshot
        ? getSnapshotNumberFromMatchers(panelSnapshot, [
            compressor.currentFlowAddress,
            `Compressor #${index + 1} Unit ${compressor.unitLabel} Current Flow Output`,
            `Compressor #${index + 1} Current Flow Output`,
          ])
        : null,
      meetingFlow: panelSnapshot
        ? getSnapshotBooleanFromMatchers(panelSnapshot, [
            compressor.meetingAddress,
            `Compressor #${index + 1} Meeting Flow Demand`,
          ])
        : null,
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

  const siteSuctionRaw = panelSnapshot
    ? getSnapshotNumberFromMatchers(panelSnapshot, ['400183', 'Suction Header Pressure', 'Site Suction'])
    : null
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
    totalDesiredSiteFlow: panelSnapshot ? getSnapshotNumberFromMatchers(panelSnapshot, ['420003', 'Total Desired Site Flow']) : matchRecord?.totalDesiredSiteFlow ?? null,
    totalAscCompressorFlow: panelSnapshot ? getSnapshotNumberFromMatchers(panelSnapshot, ['420012', 'Total ASC Compressor Flow']) : matchRecord?.totalAscCompressorFlow ?? null,
    totalSiteFlow: panelSnapshot ? getSnapshotNumberFromMatchers(panelSnapshot, ['420005', 'Total Site Flow']) : matchRecord?.totalSiteFlow ?? null,
    panelCommandedCompressorFlow: panelSnapshot ? getSnapshotNumberFromMatchers(panelSnapshot, ['420042', 'Well Panel Commanded Compressor Flow']) : null,
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
  const timestampMs = parseTimestampMs(record?.capturedAt || record?.ts)
  if (timestampMs != null) {
    const trendSample = buildTrendingSample({
      raw: record,
      match: null,
      timestampMs,
    })
    appendJsonLine(TREND_HISTORY_PATH, trendSample)
    pushRecentTrendSample(trendSample)
  }
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
  const maxLines = estimateTailLineBudget({
    startAt,
    endAt,
    // Request-time trending does not need every 2-second point to stay usable.
    // Keep this bounded so one trending request cannot stall the whole server.
    cadenceSeconds: 10,
    multiplier: 1.2,
    minimum: 360,
    maximum: 12000,
  })

  return readJsonLinesTail(PANEL_MATCH_HISTORY_PATH, maxLines)
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
  if (!existsSync(RAW_HISTORY_PATH)) return []
  const maxLines = estimateTailLineBudget({
    startAt,
    endAt,
    // Raw snapshot lines are much heavier than panel-match lines, so do not
    // try to parse every 2-second capture for long windows at request time.
    cadenceSeconds: 12,
    multiplier: 1.15,
    minimum: 180,
    maximum: 900,
  })

  return readJsonLinesTail(RAW_HISTORY_PATH, maxLines)
    .filter((record) => {
      const ts = new Date(record.capturedAt || record.ts).getTime()
      if (!Number.isFinite(ts)) return false
      if (startMs != null && ts < startMs) return false
      if (endMs != null && ts > endMs) return false
      return true
    })
    .sort((left, right) => String(left.capturedAt || left.ts).localeCompare(String(right.capturedAt || right.ts)))
}

export function loadHalfmannTrendSampleHistory({ startAt, endAt, includeFallback = false } = {}) {
  ensureHalfmannHistoryBootstrapped()
  const startMs = startAt ? new Date(startAt).getTime() : null
  const endMs = endAt ? new Date(endAt).getTime() : null
  if (!existsSync(TREND_HISTORY_PATH)) return []
  const maxLines = estimateTailLineBudget({
    startAt,
    endAt,
    // Lightweight trend rows are safe to read more densely than raw snapshots.
    cadenceSeconds: 2,
    multiplier: 1.12,
    minimum: 600,
    maximum: 120000,
  })

  return readJsonLinesTail(TREND_HISTORY_PATH, maxLines)
    .filter((sample) => {
      const timestampMs = Number(sample?.timestampMs)
      if (!Number.isFinite(timestampMs)) return false
      if (!includeFallback && sample.isFallback) return false
      if (startMs != null && timestampMs < startMs) return false
      if (endMs != null && timestampMs > endMs) return false
      return true
    })
    .sort((left, right) => Number(left.timestampMs) - Number(right.timestampMs))
}

export function loadHalfmannTrendingHistory({ startAt, endAt, includeFallback = false } = {}) {
  const startMs = startAt ? new Date(startAt).getTime() : null
  const endMs = endAt ? new Date(endAt).getTime() : null
  const recentSamples = RECENT_TREND_SAMPLES.filter((sample) => {
    if (!sample?.timestampMs) return false
    if (startMs != null && sample.timestampMs < startMs) return false
    if (endMs != null && sample.timestampMs > endMs) return false
    if (!includeFallback && sample.isFallback) return false
    return true
  })

  const lightweightHistory = loadHalfmannTrendSampleHistory({ startAt, endAt, includeFallback })
  const fastSamplesByTimestamp = new Map()
  for (const sample of lightweightHistory) {
    if (sample?.timestampMs != null) fastSamplesByTimestamp.set(sample.timestampMs, sample)
  }
  for (const sample of recentSamples) {
    if (sample?.timestampMs != null) fastSamplesByTimestamp.set(sample.timestampMs, sample)
  }
  const fastSamples = [...fastSamplesByTimestamp.values()].sort((left, right) => left.timestampMs - right.timestampMs)

  const needsHistoricalBackfill =
    !fastSamples.length

  let historicalSamples = []

  if (needsHistoricalBackfill) {
    const rawRecords = loadHalfmannRawHistory({ startAt, endAt })
    const matchRecords = loadHalfmannPanelMatchHistory({ startAt, endAt, includeFallback })
    const merged = mergeHistoryStreams(rawRecords, matchRecords)
    historicalSamples = merged
      .map(buildTrendingSample)
      .filter((sample) => sample.timestampMs != null)
  }
  if (!historicalSamples.length) return fastSamples
  if (!fastSamples.length) return historicalSamples

  const byTimestamp = new Map()
  for (const sample of historicalSamples) {
    if (sample?.timestampMs != null) byTimestamp.set(sample.timestampMs, sample)
  }
  for (const sample of fastSamples) {
    if (sample?.timestampMs != null) byTimestamp.set(sample.timestampMs, sample)
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestampMs - right.timestampMs)
}

export function getHalfmannHistoryPaths() {
  ensureHistoryDir()
  return {
    historyDir: HISTORY_DIR,
    rawHistoryPath: RAW_HISTORY_PATH,
    panelMatchHistoryPath: PANEL_MATCH_HISTORY_PATH,
    trendHistoryPath: TREND_HISTORY_PATH,
    seedImportedMarkerPath: SEED_IMPORTED_MARKER_PATH,
  }
}
