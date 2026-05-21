import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

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
