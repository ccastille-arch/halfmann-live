import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { ensureScheduledPerformanceArchives, generatePerformanceReport, getPerformanceReportMeta } from './welllogicPerformanceReport.js'
import { getOptimizationHistory } from './welllogicOptimizationHistory.js'
import { ensureHalfmannHistoryBootstrapped, recordHalfmannPanelMatchSnapshot, recordHalfmannRawSnapshot } from './halfmannHistoryStore.js'
import { listArchivedPerformanceReports, resolveArchivedPerformanceReportPath } from './halfmannReportArchive.js'
import {
  exportDerivedTriggerSettingsPayload,
  getDerivedTriggerSettingsAuditLog,
  getDerivedTriggerSettingsAdminPayload,
  getDerivedTriggerSettingsPublicPayload,
  importDerivedTriggerSettings,
  loadDerivedTriggerSettingsState,
  resetDerivedTriggerSetting,
  resetDerivedTriggerSettingsGroup,
  saveDerivedTriggerSettings,
} from './derivedTriggerSettingsStore.js'
import {
  clearAdminSession,
  getAdminAuthStatus,
  getAdminSession,
  issueAdminSession,
  requireAdmin,
  verifyAdminLogin,
} from './adminAuth.js'

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

function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

function buildLegacySettingsPayload() {
  const payload = getDerivedTriggerSettingsPublicPayload()
  return {
    ...payload.legacySettings,
    derivedTriggerSettings: payload.derivedTriggerSettings,
    fetchedAt: payload.fetchedAt,
  }
}

function applyLegacySettingsToDerived(input = {}) {
  const current = loadDerivedTriggerSettingsState().derivedTriggerSettings
  const next = JSON.parse(JSON.stringify(current))
  if (input.wellTargetPct != null) {
    next.wellFlow.allWellsMeetingFlowTolerancePct = Number(input.wellTargetPct)
    next.wellFlow.individualWellMeetingFlowTolerancePct = Number(input.wellTargetPct)
  }
  if (input.recycleOpenPct != null) {
    next.recyclePressure.recycleActiveThresholdPct = Number(input.recycleOpenPct)
  }
  if (input.recycleAlertThreshold != null) {
    next.recyclePressure.recycleValveAllowedPositionPct = Number(input.recycleAlertThreshold)
  }
  if (input.meetingFlowPersistSeconds != null) {
    next.compressorDispatch.compressorDispatchPersistenceSeconds = Number(input.meetingFlowPersistSeconds)
    next.chokeRestriction.restrictedWellPersistenceSeconds = Number(input.meetingFlowPersistSeconds)
    next.eventHistory.eventPersistenceSeconds = Number(input.meetingFlowPersistSeconds)
  }
  return next
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

app.get('/api/settings', (_req, res) => {
  res.json(buildLegacySettingsPayload())
})

app.get('/api/derived-trigger-settings', (_req, res) => {
  res.json(getDerivedTriggerSettingsPublicPayload())
})

app.post('/api/settings', requireAdmin, (req, res) => {
  try {
    const nextSettings = applyLegacySettingsToDerived(req.body || {})
    const updated = saveDerivedTriggerSettings(nextSettings, {
      user: req.adminSession.username,
      reason: req.body?.reason || 'Legacy settings update',
      ip: getRequestIp(req),
    })
    res.json({
      ...updated.legacySettings,
      derivedTriggerSettings: updated.derivedTriggerSettings,
      fetchedAt: updated.fetchedAt,
    })
  } catch (err) {
    res.status(err.status || 400).json({
      error: err.message || 'Failed to save settings',
      details: err.payload || null,
    })
  }
})

app.get('/api/admin/session', (req, res) => {
  const session = getAdminSession(req)
  res.json({
    authenticated: Boolean(session),
    username: session?.username || null,
    expiresAt: session?.expiresAt ? new Date(session.expiresAt).toISOString() : null,
    authConfigured: getAdminAuthStatus().configured,
  })
})

app.post('/api/admin/login', async (req, res) => {
  try {
    const username = String(req.body?.username || '').trim()
    const password = String(req.body?.password || '')
    const auth = await verifyAdminLogin({ username, password, req })
    issueAdminSession(res, req, auth.username)
    res.json({
      ok: true,
      username: auth.username,
      authConfigured: true,
    })
  } catch (err) {
    res.status(err.status || 401).json({
      error: err.status === 503 ? err.message : 'Invalid credentials',
      authConfigured: getAdminAuthStatus().configured,
    })
  }
})

app.post('/api/admin/logout', (req, res) => {
  clearAdminSession(res, req)
  res.json({ ok: true })
})

app.get('/api/admin/derived-trigger-settings', requireAdmin, (_req, res) => {
  res.json(getDerivedTriggerSettingsAdminPayload())
})

app.put('/api/admin/derived-trigger-settings', requireAdmin, (req, res) => {
  try {
    const updated = saveDerivedTriggerSettings(req.body?.derivedTriggerSettings || req.body, {
      user: req.adminSession.username,
      reason: req.body?.comment || req.body?.reason || '',
      ip: getRequestIp(req),
    })
    res.json(updated)
  } catch (err) {
    res.status(err.status || 400).json({
      error: err.message || 'Failed to save derived trigger settings',
      details: err.payload || null,
    })
  }
})

app.post('/api/admin/derived-trigger-settings/reset-group', requireAdmin, (req, res) => {
  try {
    const updated = resetDerivedTriggerSettingsGroup(String(req.body?.groupKey || ''), {
      user: req.adminSession.username,
      reason: req.body?.comment || req.body?.reason || '',
      ip: getRequestIp(req),
    })
    res.json(updated)
  } catch (err) {
    res.status(err.status || 400).json({
      error: err.message || 'Failed to reset settings group',
      details: err.payload || null,
    })
  }
})

app.post('/api/admin/derived-trigger-settings/reset-setting', requireAdmin, (req, res) => {
  try {
    const updated = resetDerivedTriggerSetting(String(req.body?.path || ''), {
      user: req.adminSession.username,
      reason: req.body?.comment || req.body?.reason || '',
      ip: getRequestIp(req),
    })
    res.json(updated)
  } catch (err) {
    res.status(err.status || 400).json({
      error: err.message || 'Failed to reset setting',
      details: err.payload || null,
    })
  }
})

app.post('/api/admin/derived-trigger-settings/import', requireAdmin, (req, res) => {
  try {
    const updated = importDerivedTriggerSettings(req.body, {
      user: req.adminSession.username,
      reason: req.body?.comment || req.body?.reason || 'Imported config',
      ip: getRequestIp(req),
    })
    res.json(updated)
  } catch (err) {
    res.status(err.status || 400).json({
      error: err.message || 'Failed to import settings',
      details: err.payload || null,
    })
  }
})

app.get('/api/admin/derived-trigger-settings/export', requireAdmin, (_req, res) => {
  res.json(exportDerivedTriggerSettingsPayload())
})

app.get('/api/admin/derived-trigger-settings/audit', requireAdmin, (req, res) => {
  const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 200
  res.json({
    fetchedAt: new Date().toISOString(),
    auditLog: getDerivedTriggerSettingsAuditLog(limit),
  })
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
const HALFMANN_PANEL_DEVICE_ID = '2507-501508'
const HALFMANN_HISTORY_UNIT_DEVICE_IDS = ['2507-500709', '2504-504108', '2507-500076', '2504-504102', '2507-501442']
const LATEST_SNAPSHOT_CACHE = new Map()
const RUN_REPORT_CACHE = new Map()
const RUN_REPORT_TTL_MS = 14 * 60 * 1000

function loadHalfmannPanelFallbackSnapshot() {
  try {
    const fallbackPath = join(__dirname, 'halfmannPanelFallbackSnapshot.json')
    const parsed = JSON.parse(readFileSync(fallbackPath, 'utf8'))
    const datapoints = extractDatapoints(parsed)
    if (!datapoints.length) return null
    return { data: parsed, datapoints }
  } catch {
    return null
  }
}

const HALFMANN_PANEL_FALLBACK_SNAPSHOT = loadHalfmannPanelFallbackSnapshot()

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
  const usePanelFallback = (note, httpStatus) => {
    if (deviceId !== HALFMANN_PANEL_DEVICE_ID || !HALFMANN_PANEL_FALLBACK_SNAPSHOT) return null
    return {
      ok: true,
      httpStatus,
      state: 'fallback-cache',
      note: `Using last known rich Halfmann panel snapshot because authenticated dashboard access is unavailable. ${note}`.trim(),
      data: HALFMANN_PANEL_FALLBACK_SNAPSHOT.data,
      datapoints: HALFMANN_PANEL_FALLBACK_SNAPSHOT.datapoints,
    }
  }

  if (!MLINK_DASHBOARD_COOKIE && !MLINK_DASHBOARD_AUTH_HEADER) {
    return usePanelFallback('Dashboard auth is not configured on the server.', null) || {
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
      return usePanelFallback('Dashboard endpoint returned a login page.', result.status) || {
        ok: false,
        httpStatus: result.status,
        state: 'auth-required',
        note: 'Dashboard endpoint returned a login page',
        data: null,
        datapoints: [],
      }
    }

    const datapoints = extractDatapoints(result.data)
    if (!result.ok && result.status === 401) {
      return usePanelFallback(typeof result.data === 'string' ? result.data.slice(0, 200) : 'Dashboard snapshot request failed with 401.', result.status) || {
        ok: false,
        httpStatus: result.status,
        state: 'error',
        note: typeof result.data === 'string' ? result.data.slice(0, 500) : 'Dashboard snapshot request failed',
        data: null,
        datapoints: [],
      }
    }
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
    return usePanelFallback(err.message, null) || {
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

function buildSourceSummary(latestResult, runReportDps, runReportState, runReportNote, dashboardResult) {
  return {
    latestDeviceData: {
      count: latestResult?.datapoints?.length || 0,
      state: latestResult?.state || 'empty',
      note: latestResult?.note || '',
      httpStatus: latestResult?.httpStatus ?? null,
    },
    runReport: {
      count: runReportDps?.length || 0,
      state: runReportState || 'empty',
      note: runReportNote || '',
      httpStatus: null,
    },
    dashboardSnapshot: {
      count: dashboardResult?.datapoints?.length || 0,
      state: dashboardResult?.state || 'empty',
      note: dashboardResult?.note || '',
      httpStatus: dashboardResult?.httpStatus ?? null,
    },
  }
}

let halfmannHistoryCaptureInFlight = false
let halfmannMonthlyReportMaterializeInFlight = false

async function captureHalfmannRuntimeHistory() {
  if (halfmannHistoryCaptureInFlight) return
  const key = process.env.MLINK_API_KEY
  if (!key) return

  halfmannHistoryCaptureInFlight = true
  try {
    const capturedAt = new Date().toISOString()
    const panelLatest = await fetchLatestSnapshot(HALFMANN_PANEL_DEVICE_ID, key)
    const panelDashboard = await fetchDashboardSnapshot(HALFMANN_PANEL_DEVICE_ID)
    const panelMergedDatapoints = mergeDatapointSources([
      { name: 'latestDeviceData', datapoints: panelLatest?.datapoints || [] },
      { name: 'dashboardSnapshot', datapoints: panelDashboard?.datapoints || [] },
    ])
    const panelSnapshot = {
      deviceId: HALFMANN_PANEL_DEVICE_ID,
      datapoints: panelMergedDatapoints,
      _registerCount: panelMergedDatapoints.length,
      _sourceSummary: buildSourceSummary(panelLatest, [], 'empty', 'History poll does not request RunReport', panelDashboard),
    }

    const unitSnapshots = await Promise.all(
      HALFMANN_HISTORY_UNIT_DEVICE_IDS.map(async (deviceId) => {
        const latestResult = await fetchLatestSnapshot(deviceId, key)
        return {
          deviceId,
          datapoints: latestResult?.datapoints || [],
          _registerCount: latestResult?.datapoints?.length || 0,
          _sourceSummary: buildSourceSummary(latestResult, [], 'empty', 'History poll does not request RunReport', {
            datapoints: [],
            state: 'not-requested',
            note: 'History poll stores unit latest telemetry only',
            httpStatus: null,
          }),
        }
      }),
    )

    if (panelSnapshot.datapoints.length) {
      recordHalfmannRawSnapshot({
        capturedAt,
        panel: panelSnapshot,
        units: unitSnapshots,
      })
      recordHalfmannPanelMatchSnapshot(panelSnapshot)
    }
  } catch (err) {
    console.error('halfmann history capture failed:', err.message)
  } finally {
    halfmannHistoryCaptureInFlight = false
  }
}

async function materializeMonthToDatePerformanceReport() {
  if (halfmannMonthlyReportMaterializeInFlight) return
  halfmannMonthlyReportMaterializeInFlight = true
  try {
    await ensureScheduledPerformanceArchives()
    await generatePerformanceReport({ preset: 'current-month' })
  } catch (err) {
    console.error('halfmann month-to-date report materialize failed:', err.message)
  } finally {
    halfmannMonthlyReportMaterializeInFlight = false
  }
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

  const sourceSummary = buildSourceSummary(latestResult, runReportDps, runReportState, runReportNote, dashboardResult)

  const limitations = []
  if (sourceSummary.dashboardSnapshot.state === 'disabled') {
    limitations.push('Dashboard-only MLink endpoints are not configured on this server.')
  } else if (sourceSummary.dashboardSnapshot.state === 'auth-required') {
    limitations.push('Configured dashboard auth was rejected and returned a login page.')
  } else if (sourceSummary.dashboardSnapshot.state === 'fallback-cache') {
    limitations.push('Authenticated dashboard snapshot is unavailable, so the Halfmann panel is using the last known rich snapshot as a continuity fallback.')
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

app.get('/api/performance-report/archives', async (_req, res) => {
  try {
    res.json({
      fetchedAt: new Date().toISOString(),
      reports: listArchivedPerformanceReports(),
    })
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || 'Failed to list stored reports',
    })
  }
})

app.get('/api/performance-report/download', async (req, res) => {
  try {
    const path = typeof req.query.path === 'string' ? req.query.path : ''
    if (!path) return res.status(400).json({ error: 'path required' })
    const filename = typeof req.query.filename === 'string' && req.query.filename.trim()
      ? req.query.filename.trim()
      : path.split('/').pop() || 'stored-report'
    const fullPath = resolveArchivedPerformanceReportPath(path)
    res.download(fullPath, filename)
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || 'Failed to download stored report',
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

ensureHalfmannHistoryBootstrapped()

app.listen(PORT, () => {
  console.log(`halfmann-live running on port ${PORT}`)
  captureHalfmannRuntimeHistory()
  setInterval(captureHalfmannRuntimeHistory, 2000)
  materializeMonthToDatePerformanceReport()
  setInterval(materializeMonthToDatePerformanceReport, 15 * 60 * 1000)
})
