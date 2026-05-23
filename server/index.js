import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { generatePerformanceReport, getPerformanceReportMeta } from './welllogicPerformanceReport.js'
import { getOptimizationHistory } from './welllogicOptimizationHistory.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

// ─── Settings persistence ─────────────────────────────────────────────────────
// Stored in /data/settings.json (Railway volume) or ./settings.json as fallback.
const DATA_DIR = existsSync('/data') ? '/data' : join(__dirname, '../data')
const SETTINGS_PATH = join(DATA_DIR, 'settings.json')

const DEFAULT_SETTINGS = { wellTargetPct: 5, recycleOpenPct: 5, recycleAlertThreshold: 0, meetingFlowPersistSeconds: 120 }

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) } }
  catch { return { ...DEFAULT_SETTINGS } }
}

function saveSettings(s) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2))
  } catch {}
}

// ─── Admin sessions (in-memory, cleared on restart) ──────────────────────────
const ADMIN_SESSIONS = new Map() // token -> expiry timestamp

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

app.get('/api/settings', (_req, res) => {
  res.json(loadSettings())
})

app.post('/api/settings', (req, res) => {
  const token = req.headers['x-admin-token']
  const session = ADMIN_SESSIONS.get(token)
  if (!session || Date.now() > session) {
    ADMIN_SESSIONS.delete(token)
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const updated = { ...loadSettings(), ...req.body }
  saveSettings(updated)
  res.json(updated)
})

app.post('/api/admin/login', (req, res) => {
  const pw = process.env.ADMIN_PASSWORD
  if (!pw) return res.status(503).json({ error: 'ADMIN_PASSWORD not configured' })
  if (!req.body?.password || req.body.password !== pw) {
    return res.status(401).json({ error: 'Invalid password' })
  }
  const token = randomBytes(32).toString('hex')
  ADMIN_SESSIONS.set(token, Date.now() + 8 * 3600 * 1000) // 8-hr session
  res.json({ token })
})

app.post('/api/admin/logout', (req, res) => {
  ADMIN_SESSIONS.delete(req.headers['x-admin-token'])
  res.json({ ok: true })
})

// ─── MLink proxy ──────────────────────────────────────────────────────────────
const MLINK_BASE = 'https://api.fwmurphy-iot.com/api'

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

function normalizeCookieValue(value) {
  const normalized = normalizeEnvValue(value)
  if (!normalized) return ''
  return normalized.replace(/^cookie\s*:\s*/i, '').trim()
}

function normalizeAuthHeaderValue(value) {
  let normalized = normalizeEnvValue(value)
  if (!normalized) return ''

  normalized = normalized
    .replace(/^authorization\s*:\s*/i, '')
    .replace(/^[A-Z0-9_]+\s*=\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const bearerMatch = normalized.match(/bearer\s+(.+)/i)
  if (bearerMatch) {
    return `Bearer ${bearerMatch[1].trim()}`
  }

  return normalized
}

const MLINK_DASHBOARD_BASE = normalizeEnvValue(process.env.MLINK_DASHBOARD_BASE) || 'https://www.fwmurphy-iot.com'
const MLINK_DASHBOARD_COOKIE = normalizeCookieValue(process.env.MLINK_DASHBOARD_COOKIE)
const MLINK_DASHBOARD_AUTH_HEADER = normalizeAuthHeaderValue(process.env.MLINK_DASHBOARD_AUTH_HEADER)
const LATEST_SNAPSHOT_CACHE = new Map()
const RUN_REPORT_CACHE = new Map()
const RUN_REPORT_TTL_MS = 14 * 60 * 1000

function getDatapointKey(dp) {
  return dp?.alias || dp?.desc || dp?.d || dp?.dataSourceName || dp?.Name || dp?.name || null
}

function getDatapointValue(dp) {
  return dp?.value ?? dp?.v ?? (Array.isArray(dp?.values) ? dp.values[0] : undefined)
}

function normalizeDashboardDatapoint(dp) {
  return {
    ...dp,
    portIdx: dp?.portIdx ?? dp?.p ?? null,
    timestampIdx: dp?.timestampIdx ?? dp?.t ?? null,
    desc: dp?.desc ?? dp?.d ?? '',
    alias: dp?.alias ?? null,
    address: dp?.address ?? dp?.a ?? null,
    addressStr: dp?.addressStr ?? dp?.as ?? String(dp?.a ?? ''),
    value: getDatapointValue(dp),
    units: dp?.units ?? dp?.unit ?? dp?.u ?? '',
    writable: dp?.writable ?? false,
  }
}

function extractDatapoints(payload) {
  if (!payload) return []
  if (Array.isArray(payload?.datapoints)) return payload.datapoints
  if (Array.isArray(payload?.dg)) {
    return payload.dg.flatMap(group =>
      Array.isArray(group?.p) ? group.p.map(normalizeDashboardDatapoint) : []
    )
  }
  if (Array.isArray(payload?.data?.datapoints)) return payload.data.datapoints
  if (Array.isArray(payload?.data)) return payload.data.flatMap(extractDatapoints)
  if (Array.isArray(payload)) return payload.flatMap(extractDatapoints)
  return []
}

function mergeDatapointsWithFallback(primaryDatapoints = [], fallbackDatapoints = []) {
  if (!fallbackDatapoints.length) return primaryDatapoints
  const byKey = new Map()
  for (const dp of fallbackDatapoints) {
    const key = getDatapointKey(dp)
    if (!key) continue
    byKey.set(key, dp)
  }
  for (const dp of primaryDatapoints) {
    const key = getDatapointKey(dp)
    if (!key) continue
    byKey.set(key, dp)
  }
  return [...byKey.values()]
}

async function fetchTextOrJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let data = text
  try { data = JSON.parse(text) } catch {}
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    text,
    data,
  }
}

async function fetchLatestSnapshot(deviceId, key) {
  const result = await fetchTextOrJson(`${MLINK_BASE}/LatestDeviceData?deviceId=${encodeURIComponent(deviceId)}&code=${key}`)
  if (!result.ok) {
    return {
      ok: false,
      httpStatus: result.status,
      state: 'error',
      note: typeof result.data === 'string' ? result.data.slice(0, 500) : 'LatestDeviceData request failed',
      data: null,
      datapoints: [],
    }
  }

  const liveDatapoints = extractDatapoints(result.data)
  const cached = LATEST_SNAPSHOT_CACHE.get(deviceId)
  const mergedDatapoints = mergeDatapointsWithFallback(liveDatapoints, cached?.datapoints || [])
  const heldSupplementCount = Math.max(0, mergedDatapoints.length - liveDatapoints.length)
  LATEST_SNAPSHOT_CACHE.set(deviceId, {
    datapoints: mergedDatapoints,
    fetchedAt: Date.now(),
  })

  return {
    ok: true,
    httpStatus: result.status,
    state: 'ok',
    note: heldSupplementCount > 0
      ? `LatestDeviceData public snapshot plus ${heldSupplementCount} held datapoints from the last fuller poll`
      : 'LatestDeviceData public snapshot',
    data: result.data,
    datapoints: mergedDatapoints,
  }
}

async function fetchDashboardSnapshot(deviceId) {
  if (!MLINK_DASHBOARD_COOKIE && !MLINK_DASHBOARD_AUTH_HEADER) {
    return {
      ok: false,
      httpStatus: null,
      state: 'disabled',
      note: 'Dashboard auth not configured on the server',
      data: null,
      datapoints: [],
    }
  }

  const headers = { accept: 'application/json, text/plain, */*' }
  if (MLINK_DASHBOARD_COOKIE) headers.cookie = MLINK_DASHBOARD_COOKIE
  if (MLINK_DASHBOARD_AUTH_HEADER) headers.authorization = MLINK_DASHBOARD_AUTH_HEADER

  try {
    const result = await fetchTextOrJson(
      `${MLINK_DASHBOARD_BASE}/api1/GetSnapshotData/${encodeURIComponent(deviceId)}?v=2`,
      { headers },
    )
    const looksLikeLoginPage = typeof result.data === 'string' && /logging in|sign in|login/i.test(result.data)
    if (looksLikeLoginPage) {
      return {
        ok: false,
        httpStatus: result.status,
        state: 'auth-required',
        note: 'Dashboard endpoint returned a login page',
        data: null,
        datapoints: [],
      }
    }

    const datapoints = extractDatapoints(result.data)
    return {
      ok: result.ok,
      httpStatus: result.status,
      state: result.ok ? (datapoints.length ? 'ok' : 'empty') : 'error',
      note: result.ok
        ? (datapoints.length ? 'Authenticated dashboard snapshot' : 'Dashboard snapshot returned no datapoints')
        : (typeof result.data === 'string' ? result.data.slice(0, 500) : 'Dashboard snapshot request failed'),
      data: result.ok ? result.data : null,
      datapoints,
    }
  } catch (err) {
    return {
      ok: false,
      httpStatus: null,
      state: 'unreachable',
      note: err.message,
      data: null,
      datapoints: [],
    }
  }
}

function mergeDatapointSources(sources) {
  const byKey = new Map()
  for (const source of sources) {
    for (const dp of source.datapoints || []) {
      const key = getDatapointKey(dp)
      if (!key) continue
      byKey.set(key, {
        ...dp,
        value: getDatapointValue(dp),
        units: dp.units || dp.unit,
        _source: source.name,
      })
    }
  }
  return [...byKey.values()]
}

app.get('/api/mlink/device', async (req, res) => {
  const key = process.env.MLINK_API_KEY
  if (!key) return res.status(503).json({ error: 'MLINK_API_KEY not configured' })
  const { deviceId } = req.query
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' })
  try {
    const r = await fetch(`${MLINK_BASE}/LatestDeviceData?deviceId=${deviceId}&code=${key}`)
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      return res.status(r.status).json({ error: 'MLINK error', status: r.status, details: body.slice(0, 500) })
    }
    res.json(await r.json())
  } catch (err) {
    res.status(502).json({ error: 'MLINK unreachable', details: err.message })
  }
})

app.get('/api/mlink/device/full', async (req, res) => {
  const key = process.env.MLINK_API_KEY
  if (!key) return res.status(503).json({ error: 'MLINK_API_KEY not configured' })
  const { deviceId } = req.query
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' })

  let latestResult = null
  try {
    latestResult = await fetchLatestSnapshot(deviceId, key)
  } catch (err) {
    latestResult = {
      ok: false,
      httpStatus: null,
      state: 'unreachable',
      note: err.message,
      data: null,
      datapoints: [],
    }
  }

  const todayMidnightUTC = Math.floor(Date.now() / 86400000) * 86400
  const yesterdayStartUTC = todayMidnightUTC - 86400
  const yesterdayEndUTC = todayMidnightUTC - 1

  let runReportDps = []
  let runReportState = 'empty'
  let runReportNote = 'RunReport returned no datapoints'
  const cached = RUN_REPORT_CACHE.get(deviceId)
  if (cached && Date.now() - cached.fetchedAt < RUN_REPORT_TTL_MS) {
    runReportDps = cached.dps
    runReportState = runReportDps.length ? 'cache' : 'empty'
    runReportNote = runReportDps.length ? 'Yesterday RunReport cache hit' : runReportNote
  } else {
    try {
      const r = await fetch(
        `${MLINK_BASE}/RunReport?deviceId=${encodeURIComponent(deviceId)}&startTs=${yesterdayStartUTC}&endTs=${yesterdayEndUTC}&code=${key}`
      )
      if (r.ok) {
        const data = await r.json()
        const records = Array.isArray(data) ? data : [data]
        for (const rec of records) {
          for (const dp of (rec.datapoints || rec.data || [])) runReportDps.push(dp)
        }
        RUN_REPORT_CACHE.set(deviceId, { dps: runReportDps, fetchedAt: Date.now() })
        runReportState = runReportDps.length ? 'ok' : 'empty'
        runReportNote = runReportDps.length ? 'Yesterday RunReport datapoints merged for lookup coverage' : runReportNote
      } else {
        runReportState = 'error'
        runReportNote = `RunReport request failed with ${r.status}`
      }
    } catch (err) {
      runReportState = 'unreachable'
      runReportNote = err.message
    }
  }

  const dashboardResult = await fetchDashboardSnapshot(deviceId)

  if (!latestResult?.data && runReportDps.length === 0 && dashboardResult.datapoints.length === 0) {
    return res.status(502).json({ error: 'No data from MLink' })
  }

  const mergedDatapoints = mergeDatapointSources([
    { name: 'runReport', datapoints: runReportDps },
    { name: 'latestDeviceData', datapoints: latestResult?.datapoints || [] },
    { name: 'dashboardSnapshot', datapoints: dashboardResult.datapoints || [] },
  ])

  const sourceSummary = {
    latestDeviceData: {
      count: latestResult?.datapoints?.length || 0,
      state: latestResult?.state || 'empty',
      note: latestResult?.note || '',
      httpStatus: latestResult?.httpStatus ?? null,
    },
    runReport: {
      count: runReportDps.length,
      state: runReportState,
      note: runReportNote,
      httpStatus: null,
    },
    dashboardSnapshot: {
      count: dashboardResult.datapoints.length,
      state: dashboardResult.state,
      note: dashboardResult.note,
      httpStatus: dashboardResult.httpStatus,
    },
  }

  const limitations = []
  if (sourceSummary.dashboardSnapshot.state === 'disabled') {
    limitations.push('Dashboard-only MLink endpoints are not configured on this server.')
  } else if (sourceSummary.dashboardSnapshot.state === 'auth-required') {
    limitations.push('Configured dashboard auth was rejected and returned a login page.')
  }
  if (sourceSummary.latestDeviceData.count > 0 && sourceSummary.dashboardSnapshot.count === 0) {
    limitations.push('Merged live data is currently limited to what Murphy publishes through LatestDeviceData and RunReport.')
  }

  res.json({
    ...(latestResult?.data || {}),
    datapoints: mergedDatapoints,
    _merged: true,
    _registerCount: mergedDatapoints.length,
    _sourceSummary: sourceSummary,
    _limitations: limitations,
  })
})

// ─── Generic Murphy API probe (for endpoint discovery) ───────────────────────
app.get('/api/mlink/probe', async (req, res) => {
  const key = process.env.MLINK_API_KEY
  if (!key) return res.status(503).json({ error: 'MLINK_API_KEY not configured' })
  const { deviceId, endpoint, base, method: httpMethod, ...rest } = req.query
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' })
  const baseUrl = base ? decodeURIComponent(base) : MLINK_BASE
  const devicePart = deviceId ? `deviceId=${encodeURIComponent(deviceId)}&` : ''
  const extraParams = Object.entries(rest).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')
  const url = `${baseUrl}/${endpoint}?${devicePart}code=${key}${extraParams}`
  try {
    const r = await fetch(url, { method: httpMethod || 'GET' })
    const text = await r.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = text }
    // Count datapoints if present
    const dpCount = Array.isArray(parsed?.datapoints) ? parsed.datapoints.length
      : Array.isArray(parsed?.data?.datapoints) ? parsed.data.datapoints.length : null
    res.status(r.status).json({ _endpoint: endpoint, _base: baseUrl, _status: r.status, _dpCount: dpCount, _url: url.replace(key, 'REDACTED'), data: parsed })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

app.get('/api/mlink/device/keys', async (req, res) => {
  const key = process.env.MLINK_API_KEY
  if (!key) return res.status(503).json({ error: 'MLINK_API_KEY not configured' })
  const { deviceId } = req.query
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' })
  try {
    const r = await fetch(`${MLINK_BASE}/LatestDeviceData?deviceId=${deviceId}&code=${key}`)
    if (!r.ok) return res.status(r.status).json({ error: 'MLINK error' })
    const data = await r.json()
    const keys = (data?.datapoints || [])
      .map(dp => dp.alias || dp.desc || dp.dataSourceName || dp.Name || dp.name)
      .filter(Boolean).sort()
    res.json({ deviceId, count: keys.length, keys })
  } catch (err) {
    res.status(502).json({ error: 'MLINK unreachable', details: err.message })
  }
})

function parseCsvList(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(parseCsvList).filter(Boolean)
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parseOptionalDate(value) {
  if (!value) return undefined
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function getPerformanceReportConfig() {
  return {
    accessBase: process.env.MLINK_CONSUMER_API_BASE || process.env.MLINK_ACCESS_BASE || 'https://mlink-ingest-production.up.railway.app',
    apiToken: process.env.MLINK_API_TOKEN,
    sourceKey: process.env.MLINK_ACCESS_SOURCE_KEY || 'service-compression-fleet',
  }
}

app.get('/api/performance-report/meta', async (req, res) => {
  try {
    const report = await getPerformanceReportMeta({
      ...getPerformanceReportConfig(),
      groupKey: typeof req.query.groupKey === 'string' ? req.query.groupKey : undefined,
    })
    res.json(report)
  } catch (err) {
    res.status(err.status || 502).json({
      error: err.message || 'Failed to load performance report metadata',
      details: err.payload || null,
    })
  }
})

app.get('/api/performance-report', async (req, res) => {
  try {
    const report = await generatePerformanceReport({
      ...getPerformanceReportConfig(),
      deviceIds: parseCsvList(req.query.deviceIds),
      groupKey: typeof req.query.groupKey === 'string' ? req.query.groupKey : undefined,
      startAt: parseOptionalDate(req.query.startAt),
      endAt: parseOptionalDate(req.query.endAt),
      preset: typeof req.query.preset === 'string' ? req.query.preset : 'current-month',
    })
    res.json(report)
  } catch (err) {
    res.status(err.status || 502).json({
      error: err.message || 'Failed to generate performance report',
      details: err.payload || null,
    })
  }
})

app.get('/api/welllogic-performance-report', async (req, res) => {
  try {
    const report = await generatePerformanceReport({
      ...getPerformanceReportConfig(),
      deviceIds: parseCsvList(req.query.deviceIds),
      groupKey: typeof req.query.groupKey === 'string' ? req.query.groupKey : undefined,
      startAt: parseOptionalDate(req.query.startAt),
      endAt: parseOptionalDate(req.query.endAt),
      preset: typeof req.query.preset === 'string' ? req.query.preset : 'current-month',
    })
    res.json(report)
  } catch (err) {
    res.status(err.status || 502).json({
      error: err.message || 'Failed to generate WellLogic performance report',
      details: err.payload || null,
    })
  }
})

app.get('/api/optimization-history', async (req, res) => {
  try {
    const history = await getOptimizationHistory({
      accessBase: process.env.MLINK_CONSUMER_API_BASE || process.env.MLINK_ACCESS_BASE || 'https://mlink-ingest-production.up.railway.app',
      apiToken: process.env.MLINK_API_TOKEN,
      sourceKey: process.env.MLINK_ACCESS_SOURCE_KEY || 'service-compression-fleet',
      deviceIds: parseCsvList(req.query.deviceIds),
      lookbackDays: Number(req.query.lookbackDays) > 0 ? Number(req.query.lookbackDays) : 14,
      reportLimit: Number(req.query.reportLimit) > 0 ? Number(req.query.reportLimit) : 7,
    })
    res.json(history)
  } catch (err) {
    res.status(err.status || 502).json({
      error: err.message || 'Failed to load optimization history',
      details: err.payload || null,
    })
  }
})

app.use(express.static(join(__dirname, '../dist')))
app.use((_req, res) => res.sendFile(join(__dirname, '../dist/index.html')))

app.listen(PORT, () => console.log(`halfmann-live running on port ${PORT}`))
