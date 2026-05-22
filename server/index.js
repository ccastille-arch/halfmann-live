import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

// ─── Settings persistence ─────────────────────────────────────────────────────
// Stored in /data/settings.json (Railway volume) or ./settings.json as fallback.
const DATA_DIR = existsSync('/data') ? '/data' : join(__dirname, '../data')
const SETTINGS_PATH = join(DATA_DIR, 'settings.json')

const DEFAULT_SETTINGS = { wellTargetPct: 5, recycleOpenPct: 5, recycleAlertThreshold: 0 }

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
const RUN_REPORT_CACHE = new Map()
const RUN_REPORT_TTL_MS = 14 * 60 * 1000

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

  let latestData = null
  try {
    const r = await fetch(`${MLINK_BASE}/LatestDeviceData?deviceId=${encodeURIComponent(deviceId)}&code=${key}`)
    if (r.ok) latestData = await r.json()
  } catch {}

  const todayMidnightUTC = Math.floor(Date.now() / 86400000) * 86400
  const yesterdayStartUTC = todayMidnightUTC - 86400
  const yesterdayEndUTC = todayMidnightUTC - 1

  let runReportDps = []
  const cached = RUN_REPORT_CACHE.get(deviceId)
  if (cached && Date.now() - cached.fetchedAt < RUN_REPORT_TTL_MS) {
    runReportDps = cached.dps
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
      }
    } catch {}
  }

  if (!latestData && runReportDps.length === 0) {
    return res.status(502).json({ error: 'No data from MLink' })
  }

  const byKey = {}
  const keyOf = dp => dp.alias || dp.desc || dp.dataSourceName || dp.Name || dp.name
  for (const dp of runReportDps) { const k = keyOf(dp); if (k && !byKey[k]) byKey[k] = dp }
  for (const dp of (latestData?.datapoints || [])) { const k = keyOf(dp); if (k) byKey[k] = dp }

  res.json({ ...(latestData || {}), datapoints: Object.values(byKey), _merged: true })
})

// ─── Generic Murphy API probe (for endpoint discovery) ───────────────────────
app.get('/api/mlink/probe', async (req, res) => {
  const key = process.env.MLINK_API_KEY
  if (!key) return res.status(503).json({ error: 'MLINK_API_KEY not configured' })
  const { deviceId, endpoint, ...rest } = req.query
  if (!deviceId || !endpoint) return res.status(400).json({ error: 'deviceId and endpoint required' })
  const extraParams = Object.entries(rest).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('')
  const url = `${MLINK_BASE}/${endpoint}?deviceId=${encodeURIComponent(deviceId)}&code=${key}${extraParams}`
  try {
    const r = await fetch(url)
    const text = await r.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = text }
    res.status(r.status).json({ _endpoint: endpoint, _status: r.status, _url: url.replace(key, 'REDACTED'), data: parsed })
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

app.use(express.static(join(__dirname, '../dist')))
app.use((_req, res) => res.sendFile(join(__dirname, '../dist/index.html')))

app.listen(PORT, () => console.log(`halfmann-live running on port ${PORT}`))
