import { useState, useEffect, useCallback } from 'react'
import { findRegisterDatapoint, parseLiveDatapoints } from '../engine/liveRegisters'

const API_BASE = import.meta.env.VITE_API_URL || ''
const REFRESH_INTERVAL_S = 60

const HALFMANN_DEVICES = {
  panel:    '2507-501508',
  unit2130: '2507-500709',
  unit2127: '2504-504108',
  unit2129: '2504-504102',
  unit2128: '2507-500076',
  unit1396: '2507-501442',
}

const HALFMANN_UNITS = [
  { key: 'unit2130', label: 'Unit 2130', deviceId: HALFMANN_DEVICES.unit2130, type: 'asc' },
  { key: 'unit2127', label: 'Unit 2127', deviceId: HALFMANN_DEVICES.unit2127, type: 'asc' },
  { key: 'unit2129', label: 'Unit 2129', deviceId: HALFMANN_DEVICES.unit2129, type: 'c4' },
  { key: 'unit2128', label: 'Unit 2128', deviceId: HALFMANN_DEVICES.unit2128, type: 'asc' },
  { key: 'unit1396', label: 'Unit 1396 (Standby)', deviceId: HALFMANN_DEVICES.unit1396, type: 'asc' },
]

const WELL_FLOW_KEYS = [
  ['Well 1 Injection Gas Flow Rate', 'Well #1 Flow Rate'],
  ['Well 2 Injection Gas Flow Rate', 'Well #2 Flow Rate'],
  ['Well 3 Injection Gas Flow Rate', 'Well #3 Flow Rate'],
  ['Well 4 Injection Gas Flow Rate', 'Well #4 Flow Rate'],
  ['Well 5 Injection Gas Flow Rate', 'Well # 5 Flow Rate', 'Well #5 Flow Rate'],
]
// NOT falling back to "Injection Flow Rate" — that desc is an alias of the actual flow register.
// Desired = actual when that fallback is used (misleading). Show null until Jim configures real setpoints in MLink.
const WELL_SETPOINT_KEYS = [1,2,3,4,5].map(n => [
  `Wellhead #${n} Setpoint From Customer PLC`,
  `Well ${n} Setpoint From Customer PLC`,
  `Well ${n} Setpoint`,
])
const WELL_YESTERDAY_KEYS = [1,2,3,4,5].map(n => [
  `Well ${n} Yesterdays Flow`,
  `Wellhead #${n} Yesterdays Total Flow`,
  `Well ${n} Yesterdays Total Flow`,
])
const WELL_CHOKE_KEYS  = [1,2,3,4,5].map(n => [`Well ${n} Choke Position`, `Well #${n} Choke Position`])
const WELL_CASING_KEYS = [1,2,3,4,5].map(n => [`Well ${n} Casing Pressure`, `Well #${n} Casing Pressure`])
const WELL_TUBING_KEYS = [1,2,3,4,5].map(n => [`Well ${n} Tubing Pressure`, `Well #${n} Tubing Pressure`])

// ─── ASC units: 17 live MLink keys ────────────────────────────────────────────
const ASC_GROUPS = [
  {
    title: 'Performance',
    params: [
      { label: 'Flow Rate',              keys: ['Flow Rate'],                               unit: 'MMSCFD', dec: 3 },
      { label: 'Engine Speed',           keys: ['RPM'],                                     unit: 'RPM',    dec: 0 },
      { label: 'Engine Load',            keys: ['Engine Load'],                             unit: '%',      dec: 1 },
    ],
  },
  {
    title: 'Pressures',
    params: [
      { label: 'Suction Pressure',        keys: ['Suction Pressure'],                       unit: 'psi', dec: 1 },
      { label: 'Discharge Pressure',      keys: ['Discharge Pressure'],                     unit: 'psi', dec: 0 },
      { label: 'Comp Oil Pressure',       keys: ['Compressor Oil Pressure'],                unit: 'psi', dec: 1 },
      { label: 'Engine Oil Pressure',     keys: ['Engine Oil Pressure'],                    unit: 'psi', dec: 1 },
    ],
  },
  {
    title: 'Temperatures',
    params: [
      { label: 'Stg 1 Discharge',         keys: ['Stage 1 Discharge Temperature'],          unit: '°F', dec: 1 },
      { label: 'Stg 2 Discharge',         keys: ['Stage 2 Discharge Temperature'],          unit: '°F', dec: 1 },
      { label: 'Discharge Temp',          keys: ['Discharge Temperature'],                  unit: '°F', dec: 1 },
      { label: 'Engine Oil Temp',         keys: ['Engine Oil Temperature'],                 unit: '°F', dec: 1 },
      { label: 'EICS Oil Temp',           keys: ['EICS Oil Temperature'],                   unit: '°F', dec: 1 },
      { label: 'Comp Oil Temp',           keys: ['Compressor Oil Temperature'],             unit: '°F', dec: 1 },
    ],
  },
  {
    title: 'Status & Service',
    params: [
      { label: 'Hour Meter',              keys: ['Hour Meter'],                              unit: 'hrs', dec: 1 },
      { label: 'Start Attempts / Hr',     keys: ['Number of Start Attempts per Hour'],       unit: '',    dec: 0 },
      { label: 'System Voltage',          keys: ['System Voltage'],                          unit: 'V',   dec: 1 },
      { label: 'Setpoint Lockout',        keys: ['Setpoint Edit Lockout Enabled'],           unit: '',    dec: 0 },
    ],
  },
]

// ─── C4 unit 2129: 8 live MLink keys ──────────────────────────────────────────
const C4_GROUPS = [
  {
    title: 'Performance & Pressures',
    params: [
      { label: 'Driver Speed',            keys: ['Driver Speed'],                            unit: 'RPM', dec: 0 },
      { label: 'Suction Pressure',        keys: ['Suction Pressure'],                       unit: 'psi', dec: 1 },
      { label: 'Discharge Pressure',      keys: ['Discharge Pressure'],                     unit: 'psi', dec: 0 },
      { label: 'Engine Oil Pressure',     keys: ['Engine Oil Pressure'],                    unit: 'psi', dec: 1 },
      { label: 'Comp Oil Pressure',       keys: ['Compressor Oil Pressure'],                unit: 'psi', dec: 1 },
    ],
  },
  {
    title: 'Temperatures & Status',
    params: [
      { label: 'Discharge Temp',          keys: ['Discharge Temperature'],                  unit: '°F', dec: 1 },
      { label: 'EICS Oil Temp',           keys: ['EICS Oil Temperature'],                   unit: '°F', dec: 1 },
      { label: 'System Voltage',          keys: ['System Voltage'],                          unit: 'V',  dec: 1 },
    ],
  },
]

const DEFAULT_SETTINGS = { wellTargetPct: 5, recycleOpenPct: 5 }
const SETTINGS_SCHEMA = {
  wellTargetPct:   { label: 'Well On-Target Threshold',    description: 'A well is "on target" when actual flow is within this % of its setpoint.', unit: '%', min: 1, max: 25 },
  recycleOpenPct:  { label: 'Recycle Valve Open Threshold', description: 'Recycle valve is "open" above this position %.', unit: '%', min: 0, max: 25 },
}

// ─── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchDeviceFull(deviceId) {
  try {
    const r = await fetch(`${API_BASE}/api/mlink/device/full?deviceId=${encodeURIComponent(deviceId)}`)
    if (!r.ok) {
      const r2 = await fetch(`${API_BASE}/api/mlink/device?deviceId=${encodeURIComponent(deviceId)}`)
      return r2.ok ? { data: await r2.json(), error: '' } : { data: null, error: `${deviceId}: ${r2.status}` }
    }
    return { data: await r.json(), error: '' }
  } catch (err) { return { data: null, error: err.message } }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function cleanUnit(u) {
  if (!u) return ''
  return u.replace(/Â°/g, '°').replace(/Ã‚/g, '').trim()
}
function parseLiveNumeric(v) { const n = Number(v); return Number.isFinite(n) ? n : null }
function resolveDP(dataMap, labels) {
  for (const label of labels) {
    const dp = findRegisterDatapoint(dataMap, { label, decimals: 3 })
    if (dp) return dp
  }
  return null
}
function getN(dataMap, labels) { return parseLiveNumeric(resolveDP(dataMap, labels)?.value) }
function getTimestamp(data) { return data?.timestamps?.[0] ? new Date(data.timestamps[0] * 1000) : null }
function fmt(v, d = 3) { return v != null && Number.isFinite(v) ? v.toFixed(d) : null }

function getGrade(pct) {
  if (pct == null) return null
  if (pct >= 95) return 'A'
  if (pct >= 85) return 'B'
  if (pct >= 75) return 'C'
  return 'D'
}
function gradeStatus(g) { return g === 'A' ? 'good' : g === 'B' ? 'warn' : g ? 'bad' : 'unknown' }

// ─── Colors ────────────────────────────────────────────────────────────────────
const C = {
  good:    { border: '#22c55e', glow: '#22c55e28', bg: '#030f07', val: '#4ade80',  lbl: '#22c55e', sub: '#1a5c2e' },
  warn:    { border: '#f59e0b', glow: '#f59e0b28', bg: '#0f0800', val: '#fbbf24',  lbl: '#f59e0b', sub: '#5c3e0a' },
  bad:     { border: '#ef4444', glow: '#ef444428', bg: '#0f0303', val: '#f87171',  lbl: '#ef4444', sub: '#5c1a1a' },
  unknown: { border: '#1e1e30', glow: 'transparent', bg: '#080812', val: '#94a3b8', lbl: '#4a5568', sub: '#2a2a3a' },
}

// ─── Components ────────────────────────────────────────────────────────────────

function GaugeGrid({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 12 }}>
      {children}
    </div>
  )
}

function Gauge({ label, value, unit, status = 'unknown', sub, isAdmin, settingKey, onSettings }) {
  const c = C[status] || C.unknown
  const v = value != null ? String(value) : null
  const fontSize = !v ? 32 : v.length > 8 ? 18 : v.length > 5 ? 24 : 32
  return (
    <div style={{
      position: 'relative', border: `2px solid ${c.border}`, borderRadius: 16,
      background: c.bg, boxShadow: status !== 'unknown' ? `0 0 18px ${c.glow}` : 'none',
      padding: '16px 10px 13px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', minHeight: 130, justifyContent: 'center', gap: 3,
    }}>
      {isAdmin && settingKey && onSettings && (
        <button onClick={() => onSettings(settingKey)} title="Configure"
          style={{ position: 'absolute', top: 7, right: 7, background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 13, padding: 2, lineHeight: 1 }}>⚙</button>
      )}
      <div style={{ fontSize: 8, color: c.lbl, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, lineHeight: 1.4 }}>{label}</div>
      <div style={{ fontSize, fontWeight: 900, color: v ? c.val : '#1e1e30', fontFamily: "'Arial Black', sans-serif", lineHeight: 1.05 }}>
        {v || '—'}
      </div>
      {unit && v && <div style={{ fontSize: 10, color: c.lbl, fontWeight: 700, letterSpacing: '0.04em' }}>{cleanUnit(unit)}</div>}
      {sub && <div style={{ fontSize: 8, color: c.sub, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  )
}

function YesNoGauge({ label, good, detail, isAdmin, settingKey, onSettings }) {
  const status = good === null ? 'unknown' : good ? 'good' : 'bad'
  const c = C[status]
  return (
    <div style={{
      position: 'relative', border: `2px solid ${c.border}`, borderRadius: 16,
      background: c.bg, boxShadow: good !== null ? `0 0 18px ${c.glow}` : 'none',
      padding: '16px 10px 13px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', minHeight: 130, justifyContent: 'center', gap: 4,
    }}>
      {isAdmin && settingKey && onSettings && (
        <button onClick={() => onSettings(settingKey)}
          style={{ position: 'absolute', top: 7, right: 7, background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 13, padding: 2, lineHeight: 1 }}>⚙</button>
      )}
      <div style={{ fontSize: 8, color: c.lbl, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 44, fontWeight: 900, color: c.val, fontFamily: "'Arial Black', sans-serif", lineHeight: 1 }}>
        {good === null ? '—' : good ? 'YES' : 'NO'}
      </div>
      {detail && <div style={{ fontSize: 8, color: c.sub, lineHeight: 1.5 }}>{detail}</div>}
    </div>
  )
}

function ScoreGauge({ label, score, detail, isAdmin, settingKey, onSettings }) {
  const grade = getGrade(score)
  const status = gradeStatus(grade)
  const c = C[status]
  return (
    <div style={{
      position: 'relative', border: `2px solid ${c.border}`, borderRadius: 16,
      background: c.bg, boxShadow: grade ? `0 0 18px ${c.glow}` : 'none',
      padding: '16px 10px 13px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', minHeight: 130, justifyContent: 'center', gap: 2,
    }}>
      {isAdmin && settingKey && onSettings && (
        <button onClick={() => onSettings(settingKey)}
          style={{ position: 'absolute', top: 7, right: 7, background: 'none', border: 'none', color: '#444', cursor: 'pointer', fontSize: 13, padding: 2, lineHeight: 1 }}>⚙</button>
      )}
      <div style={{ fontSize: 8, color: c.lbl, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 900, color: c.val, fontFamily: "'Arial Black', sans-serif", lineHeight: 1.05 }}>
        {score != null ? `${score.toFixed(0)}%` : '—'}
      </div>
      {grade && <div style={{ fontSize: 22, fontWeight: 900, color: c.val, fontFamily: "'Arial Black', sans-serif", lineHeight: 1 }}>{grade}</div>}
      {detail && <div style={{ fontSize: 8, color: c.sub, lineHeight: 1.4, marginTop: 1 }}>{detail}</div>}
    </div>
  )
}

function Section({ id, title, children }) {
  return (
    <div id={id} style={{ marginBottom: 32 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#49D0E2', marginBottom: 14, fontFamily: "'Arial Black', sans-serif" }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function SubSection({ title, accent = '#334155', children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: accent, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )
}

function ParamGauges({ params, dataMap, isAdmin, onSettings }) {
  return (
    <GaugeGrid>
      {params.map(p => {
        const raw = getN(dataMap, p.keys)
        const display = raw != null ? fmt(raw, p.dec ?? 1) : null
        return (
          <Gauge key={p.label} label={p.label}
            value={display} unit={display != null ? p.unit : ''}
            sub={display == null ? 'Pending MLink' : undefined}
            status="unknown"
            isAdmin={isAdmin} settingKey={p.settingKey} onSettings={onSettings}
          />
        )
      })}
    </GaugeGrid>
  )
}

function AdminLoginModal({ onClose, onLogin }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      const r = await fetch(`${API_BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      if (r.ok) { const { token } = await r.json(); onLogin(token) }
      else setErr('Invalid password')
    } catch { setErr('Connection error') }
    setBusy(false)
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: '#0e0e1a', border: '1px solid #2a2a3a', borderRadius: 14, padding: 28, width: 300 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 18, fontFamily: "'Arial Black'" }}>Admin Login</div>
        <form onSubmit={submit}>
          <input type="password" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} autoFocus
            style={{ width: '100%', background: '#080810', border: '1px solid #2a2a3a', borderRadius: 7, padding: '9px 11px', color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          {err && <div style={{ color: '#ef4444', fontSize: 10, marginTop: 7 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 7, color: '#888', padding: 8, cursor: 'pointer', fontSize: 11 }}>Cancel</button>
            <button type="submit" disabled={busy} style={{ flex: 1, background: '#1d4ed8', border: 'none', borderRadius: 7, color: '#fff', padding: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>{busy ? '…' : 'Login'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function GaugeSettingsModal({ settingKey, settings, onSave, onClose }) {
  const schema = SETTINGS_SCHEMA[settingKey]
  const [val, setVal] = useState(settings[settingKey] ?? DEFAULT_SETTINGS[settingKey] ?? '')
  const [busy, setBusy] = useState(false)
  if (!schema) return null
  async function save() { setBusy(true); await onSave(settingKey, Number(val)); setBusy(false); onClose() }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div style={{ background: '#0e0e1a', border: '1px solid #2a2a3a', borderRadius: 14, padding: 28, width: 320 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 5, fontFamily: "'Arial Black'" }}>{schema.label}</div>
        <div style={{ fontSize: 10, color: '#666', marginBottom: 18, lineHeight: 1.6 }}>{schema.description}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="number" value={val} min={schema.min} max={schema.max} step="0.5" onChange={e => setVal(e.target.value)}
            style={{ flex: 1, background: '#080810', border: '1px solid #2a2a3a', borderRadius: 7, padding: '9px 11px', color: '#fff', fontSize: 18, fontWeight: 700, outline: 'none', textAlign: 'center' }} />
          <div style={{ color: '#888', fontSize: 12 }}>{schema.unit}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ flex: 1, background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 7, color: '#888', padding: 8, cursor: 'pointer', fontSize: 11 }}>Cancel</button>
          <button onClick={save} disabled={busy} style={{ flex: 1, background: '#1d6c3d', border: 'none', borderRadius: 7, color: '#fff', padding: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function RefreshBtn({ s, loading, onRefresh }) {
  const pct = Math.round((s / REFRESH_INTERVAL_S) * 100)
  return (
    <button onClick={onRefresh} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 7, border: '1px solid #2a2a3a', background: '#0c0c18', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}>
      <svg width="15" height="15" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx="18" cy="18" r="15" fill="none" stroke="#1a2a1a" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="#22c55e" strokeWidth="3"
          strokeDasharray={`${2*Math.PI*15}`} strokeDashoffset={`${2*Math.PI*15*(1-pct/100)}`}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s linear' }} />
      </svg>
      <span style={{ fontSize: 9, color: '#666' }}>{loading ? 'Loading…' : `${s}s`}</span>
    </button>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────────
export default function HalfmannTelemetryView() {
  const [panelData, setPanelData] = useState(null)
  const [unitDataRaw, setUnitDataRaw] = useState({})
  const [loading, setLoading] = useState(true)
  const [liveError, setLiveError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_S)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminToken, setAdminToken] = useState(() => { try { return localStorage.getItem('halfmann_admin_token') } catch { return null } })
  const [showLogin, setShowLogin] = useState(false)
  const [activeSettings, setActiveSettings] = useState(null)
  const [siteSettings, setSiteSettings] = useState(DEFAULT_SETTINGS)

  useEffect(() => {
    fetch(`${API_BASE}/api/settings`).then(r => r.ok ? r.json() : null).then(s => { if (s) setSiteSettings({ ...DEFAULT_SETTINGS, ...s }) }).catch(() => {})
  }, [])

  useEffect(() => { if (adminToken) setIsAdmin(true) }, [adminToken])

  function handleLogin(token) {
    setAdminToken(token); try { localStorage.setItem('halfmann_admin_token', token) } catch {}
    setIsAdmin(true); setShowLogin(false)
  }
  async function handleLogout() {
    if (adminToken) fetch(`${API_BASE}/api/admin/logout`, { method: 'POST', headers: { 'x-admin-token': adminToken } }).catch(() => {})
    try { localStorage.removeItem('halfmann_admin_token') } catch {}
    setAdminToken(null); setIsAdmin(false)
  }
  async function handleSaveSettings(key, value) {
    const updated = { ...siteSettings, [key]: value }
    try {
      const r = await fetch(`${API_BASE}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken }, body: JSON.stringify(updated) })
      if (r.ok) setSiteSettings({ ...DEFAULT_SETTINGS, ...await r.json() })
      else if (r.status === 401) { setIsAdmin(false); setAdminToken(null); try { localStorage.removeItem('halfmann_admin_token') } catch {} }
    } catch {}
  }
  const openSettings = key => { if (isAdmin) setActiveSettings(key) }

  const refresh = useCallback(async () => {
    setLoading(true); setLiveError('')
    const [panelResult, ...unitResults] = await Promise.all([
      fetchDeviceFull(HALFMANN_DEVICES.panel),
      ...HALFMANN_UNITS.map(u => u.deviceId ? fetchDeviceFull(u.deviceId) : Promise.resolve({ data: null, error: '' })),
    ])
    setPanelData(panelResult.data)
    const raw = {}; HALFMANN_UNITS.forEach((u, i) => { raw[u.key] = unitResults[i].data }); setUnitDataRaw(raw)
    if (!panelResult.data && unitResults.every(r => !r.data)) setLiveError('No live MLink data. Check field comms.')
    setLastRefresh(new Date()); setLoading(false); setCountdown(REFRESH_INTERVAL_S)
  }, [])

  useEffect(() => { refresh(); const i = setInterval(refresh, REFRESH_INTERVAL_S * 1000); return () => clearInterval(i) }, [refresh])
  useEffect(() => { const t = setInterval(() => setCountdown(c => c > 0 ? c - 1 : REFRESH_INTERVAL_S), 1000); return () => clearInterval(t) }, [])

  // ─── Derived ────────────────────────────────────────────────────────────────
  const panel = parseLiveDatapoints(panelData)
  const unitMaps = HALFMANN_UNITS.map(u => parseLiveDatapoints(unitDataRaw[u.key]))
  const { wellTargetPct = 5, recycleOpenPct = 5 } = siteSettings

  const wellData = WELL_FLOW_KEYS.map((flowKeys, i) => ({
    n: i + 1,
    actual:    getN(panel, flowKeys),
    desired:   getN(panel, WELL_SETPOINT_KEYS[i]),
    choke:     getN(panel, WELL_CHOKE_KEYS[i]),
    casing:    getN(panel, WELL_CASING_KEYS[i]),
    tubing:    getN(panel, WELL_TUBING_KEYS[i]),
    yesterday: getN(panel, WELL_YESTERDAY_KEYS[i]),
  }))

  const totalDesiredSite = getN(panel, ['Total Desired Site Flow'])
  const sumSetpoints = wellData.reduce((s, w) => s + (w.desired ?? 0), 0)
  const hasSetpoints = wellData.some(w => w.desired != null)
  const totalDesired = hasSetpoints ? sumSetpoints : totalDesiredSite
  const totalActual  = wellData.reduce((s, w) => s + (w.actual ?? 0), 0)
  // Do NOT split totalDesiredSite÷5 as per-well target — individual setpoints differ significantly.
  // (e.g. 1.225 / 1.100 / 1.450 / 1.000 / 1.350 from Altronic panel — equal split produces wrong LOW/ON TARGET)
  const perWellTarget = null

  const activeWells = wellData.filter(w => w.actual != null).length
  // Only evaluate wells that have an actual target to compare against — avoids false NO when MLink has no setpoints
  const wellsWithTarget = wellData.filter(w => w.actual != null && (w.desired != null || perWellTarget != null))
  const wellsOnTarget = wellsWithTarget.filter(w => {
    const t = w.desired ?? perWellTarget
    return t != null && t > 0 && Math.abs(w.actual - t) <= t * (wellTargetPct / 100)
  }).length
  const allOnTarget = wellsWithTarget.length > 0 ? wellsOnTarget === wellsWithTarget.length : null
  const padMatchPct = totalDesired != null && totalDesired > 0 ? Math.max(0, 100 - (Math.abs(totalActual - totalDesired) / totalDesired) * 100) : null

  const casingList = wellData.map((w, i) => w.casing != null ? { v: w.casing, n: i+1 } : null).filter(Boolean)
  const tubingList = wellData.map((w, i) => w.tubing != null ? { v: w.tubing, n: i+1 } : null).filter(Boolean)
  const highCasing = casingList.length ? casingList.reduce((a, b) => b.v > a.v ? b : a) : null
  const highTubing = tubingList.length ? tubingList.reduce((a, b) => b.v > a.v ? b : a) : null

  const recycleVal  = getN(panel, ['Recycle Valve Position', 'Recycle Valve', 'RCV Position'])
  const recycleOpen = recycleVal != null ? recycleVal > recycleOpenPct : null
  const suctionHeaderPres = getN(panel, ['Suction Header Pressure'])
  const suctionValvePos   = getN(panel, ['Suction/Sales Valve Position', 'Suction Valve Position', 'Sales Valve Position'])
  const dischargeSP = unitMaps.reduce((f, dm) => f ?? getN(dm, ['Speed Auto Discharge SP', 'Altronic Discharge SP', 'Discharge Pressure SP']), null)

  const unitFlows   = unitMaps.map(dm => getN(dm, ['Flow Rate', 'Flow Rate PID PV']))
  const unitDesired = HALFMANN_UNITS.map((u, i) =>
    getN(panel, [`Compressor #${i+1} Desire Flow SP For PID Murphy`]) ??
    getN(unitMaps[i], ['Desire Flow SP For PID Murphy', 'Desired Flow SP For PID Murphy', 'Flow Rate PID SP'])
  )

  const wellScores = wellData.map(w => {
    const t = w.desired ?? perWellTarget
    return w.actual != null && t != null && t > 0 ? Math.min(100, (w.actual / t) * 100) : null
  }).filter(v => v != null)
  const wellScore = wellScores.length ? wellScores.reduce((a, b) => a + b, 0) / wellScores.length : null

  const unitScores = unitFlows.map((f, i) => f != null && unitDesired[i] != null && unitDesired[i] > 0 ? Math.min(100, (f / unitDesired[i]) * 100) : null).filter(v => v != null)
  const compressorScore = unitScores.length ? unitScores.reduce((a, b) => a + b, 0) / unitScores.length : null
  const recycleScore = recycleVal != null ? Math.max(0, 100 - recycleVal) : null

  const worstWell = wellData.reduce((w, d) => {
    const t = d.desired ?? perWellTarget
    if (d.actual == null || t == null || t <= 0) return w
    const s = (d.actual / t) * 100
    return w == null || s < w.s ? { n: d.n, s } : w
  }, null)
  const worstUnit = HALFMANN_UNITS.reduce((w, u, i) => {
    if (unitFlows[i] == null || unitDesired[i] == null || unitDesired[i] <= 0) return w
    const s = (unitFlows[i] / unitDesired[i]) * 100
    return w == null || s < w.s ? { label: u.label, s } : w
  }, null)

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#080810' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 18px', background: '#0a0a14', borderBottom: '1px solid #1a1a2a', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 7px #22c55e88' }} />
          <div>
            <div style={{ fontSize: 13, color: '#fff', fontWeight: 700, fontFamily: "'Arial Black'" }}>Telemetry Dashboard — Halfmann 1214</div>
            <div style={{ fontSize: 9, color: '#444' }}>{lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Connecting…'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <RefreshBtn s={countdown} loading={loading} onRefresh={refresh} />
          {isAdmin
            ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, color: '#22c55e', fontWeight: 700, letterSpacing: '0.1em' }}>ADMIN</span>
                <button onClick={handleLogout} style={{ background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 6, color: '#888', cursor: 'pointer', padding: '4px 9px', fontSize: 9 }}>Logout</button>
              </div>
            : <button onClick={() => setShowLogin(true)} style={{ background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 6, color: '#555', cursor: 'pointer', padding: '5px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em' }}>ADMIN</button>
          }
        </div>
      </header>

      {showLogin && <AdminLoginModal onClose={() => setShowLogin(false)} onLogin={handleLogin} />}
      {activeSettings && <GaugeSettingsModal settingKey={activeSettings} settings={siteSettings} onSave={handleSaveSettings} onClose={() => setActiveSettings(null)} />}

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
        <div style={{ maxWidth: 1440, margin: '0 auto' }}>
          {liveError && <div style={{ background: '#1f0c0c', border: '1px solid #5a1d1d', borderRadius: 7, padding: '9px 14px', marginBottom: 18, fontSize: 10, color: '#fca5a5' }}>{liveError}</div>}

          {/* GROUP 1 — SITE SUMMARY */}
          <Section id="site-summary" title="Group 1 — Site Summary">
            <GaugeGrid>
              <YesNoGauge label="All Wells Meeting Desired Rate?" good={allOnTarget}
                detail={wellsWithTarget.length > 0
                  ? `${wellsOnTarget} of ${wellsWithTarget.length} within ${wellTargetPct}%`
                  : activeWells > 0 ? 'Setpoints not yet in MLink config' : 'Awaiting data'}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <Gauge label="Wells Meeting Rate"
                value={wellsWithTarget.length > 0 ? `${wellsOnTarget}/${wellsWithTarget.length}` : null}
                status={wellsWithTarget.length > 0 ? (wellsOnTarget === wellsWithTarget.length ? 'good' : wellsOnTarget >= wellsWithTarget.length * 0.6 ? 'warn' : 'bad') : 'unknown'}
                sub={wellsWithTarget.length === 0 && activeWells > 0 ? 'No setpoints in MLink' : undefined}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <Gauge label="Total Desired Flow"
                value={totalDesired != null ? fmt(totalDesired) : null} unit="MMSCFD"
                sub={hasSetpoints ? 'Sum of well setpoints' : totalDesiredSite != null ? 'Panel register' : 'Pending MLink config'} />
              <Gauge label="Total Actual Flow"
                value={fmt(totalActual)} unit="MMSCFD"
                status={padMatchPct != null ? (padMatchPct >= 95 ? 'good' : padMatchPct >= 80 ? 'warn' : 'bad') : 'unknown'}
                sub={totalDesired != null ? `${fmt(padMatchPct, 1)}% of desired` : undefined} />
              <YesNoGauge label="Recycle Valve Open?" good={recycleOpen === null ? null : !recycleOpen}
                detail={recycleVal == null ? 'Pending MLink config' : `Position: ${recycleVal.toFixed(1)}% (threshold: ${recycleOpenPct}%)`}
                isAdmin={isAdmin} settingKey="recycleOpenPct" onSettings={openSettings} />
              <Gauge label="Highest Casing Pressure"
                value={highCasing ? fmt(highCasing.v, 0) : null} unit="PSI"
                sub={highCasing ? `Well ${highCasing.n}` : 'Pending MLink config'} />
              <Gauge label="Highest Tubing Pressure"
                value={highTubing ? fmt(highTubing.v, 0) : null} unit="PSI"
                sub={highTubing ? `Well ${highTubing.n}` : 'Pending MLink config'} />
              <Gauge label="Altronic Discharge SP"
                value={dischargeSP != null ? fmt(dischargeSP, 0) : null} unit="PSI"
                sub={dischargeSP == null ? 'Pending MLink config' : undefined} />
              <Gauge label="Recommended Compressors"
                value={getN(panel, ['Recommended Number Of Compressors']) != null ? fmt(getN(panel, ['Recommended Number Of Compressors']), 0) : null}
                status={(() => {
                  const rec = getN(panel, ['Recommended Number Of Compressors'])
                  const running = unitMaps.filter((dm, i) => { const r = getN(dm, ['RPM','Driver Speed']); return r != null && r > 100 }).length
                  if (rec == null) return 'unknown'
                  return running >= rec ? 'good' : running === rec - 1 ? 'warn' : 'bad'
                })()}
                sub={getN(panel, ['Recommended Number Of Compressors']) == null ? 'Pending MLink config' : 'Panel system recommendation'} />
            </GaugeGrid>
          </Section>

          {/* GROUP 2 — OPTIMIZATION */}
          <Section id="optimization" title="Group 2 — Optimization Scorecards">
            <GaugeGrid>
              <ScoreGauge label="Compressor Flow Score" score={compressorScore}
                detail={worstUnit ? `Worst: ${worstUnit.label} (${fmt(worstUnit.s, 0)}%)` : 'Awaiting desired flow data'} />
              <ScoreGauge label="Well Injection Score" score={wellScore}
                detail={worstWell ? `Worst: Well ${worstWell.n} (${fmt(worstWell.s, 0)}%)` : 'Awaiting setpoint data'}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <ScoreGauge label="Recycle Efficiency" score={recycleScore}
                detail={recycleVal != null ? `Valve at ${recycleVal.toFixed(1)}%` : 'Pending MLink config'}
                isAdmin={isAdmin} settingKey="recycleOpenPct" onSettings={openSettings} />
              <Gauge label="Worst Performing Unit"
                value={worstUnit ? worstUnit.label.replace('Unit ', '') : null}
                sub={worstUnit ? `Score: ${fmt(worstUnit.s, 0)}%` : 'Awaiting data'}
                status={worstUnit ? gradeStatus(getGrade(worstUnit.s)) : 'unknown'} />
              <Gauge label="Worst Performing Well"
                value={worstWell ? `Well ${worstWell.n}` : null}
                sub={worstWell ? `Score: ${fmt(worstWell.s, 0)}%` : 'Awaiting data'}
                status={worstWell ? gradeStatus(getGrade(worstWell.s)) : 'unknown'} />
            </GaugeGrid>
          </Section>

          {/* GROUP 3 — SITE DATA */}
          <Section id="site-data" title="Group 3 — Site Data">
            <GaugeGrid>
              <Gauge label="Suction Header Pressure"
                value={suctionHeaderPres != null ? fmt(suctionHeaderPres, 0) : null} unit="PSI"
                sub={suctionHeaderPres == null ? 'Pending MLink config' : undefined} />
              <Gauge label="Suction / Sales Valve"
                value={suctionValvePos != null ? fmt(suctionValvePos, 1) : null} unit="%"
                sub={suctionValvePos == null ? 'Pending MLink config' : undefined} />
              <Gauge label="Recycle Valve Position"
                value={recycleVal != null ? fmt(recycleVal, 1) : null} unit="%"
                sub={recycleVal == null ? 'Pending MLink config' : recycleVal > recycleOpenPct ? 'OPEN' : 'Closed'}
                status={recycleVal == null ? 'unknown' : recycleVal > recycleOpenPct ? 'bad' : 'good'}
                isAdmin={isAdmin} settingKey="recycleOpenPct" onSettings={openSettings} />
            </GaugeGrid>
          </Section>

          {/* GROUP 4 — WELL DATA */}
          <Section id="wells" title="Group 4 — Well Data">
            {wellData.map(w => {
              const wellOffline = w.actual == null && w.desired == null && w.choke == null && w.casing == null && w.tubing == null && w.yesterday == null
              return (
                <SubSection key={w.n} title={`Well ${w.n}`} accent="#49D0E2">
                  {wellOffline ? (
                    <div style={{ padding: '16px 20px', borderRadius: 10, border: '1px solid #2a1a1a', background: '#120808', color: '#ef4444', fontSize: 12, fontWeight: 700 }}>
                      ⚠ Well {w.n} not published by MLink panel — register missing from Jim's current config. Will auto-populate when added.
                    </div>
                  ) : (
                    <GaugeGrid>
                      <Gauge label={`Well ${w.n} Setpoint`}
                        value={w.desired != null ? fmt(w.desired) : null} unit="MMSCFD"
                        sub={w.desired == null ? 'Pending MLink config' : undefined} />
                      <Gauge label={`Well ${w.n} Injection Flow`}
                        value={w.actual != null ? fmt(w.actual) : null} unit="MMSCFD"
                        status={(() => {
                          const t = w.desired ?? perWellTarget
                          if (w.actual == null || !t) return 'unknown'
                          const d = Math.abs(w.actual - t) / t * 100
                          return d <= wellTargetPct ? 'good' : d <= wellTargetPct * 2 ? 'warn' : 'bad'
                        })()} />
                      <Gauge label={`Well ${w.n} Choke Position`}
                        value={w.choke != null ? fmt(w.choke, 1) : null} unit="%"
                        sub={w.choke == null ? 'Pending MLink config' : undefined} />
                      <Gauge label={`Well ${w.n} Casing Pressure`}
                        value={w.casing != null ? fmt(w.casing, 0) : null} unit="PSI"
                        sub={w.casing == null ? 'Pending MLink config' : undefined} />
                      <Gauge label={`Well ${w.n} Tubing Pressure`}
                        value={w.tubing != null ? fmt(w.tubing, 0) : null} unit="PSI"
                        sub={w.tubing == null ? 'Pending MLink config' : undefined} />
                    </GaugeGrid>
                  )}
                </SubSection>
              )
            })}
          </Section>

          {/* GROUP 5 — YESTERDAYS FLOW */}
          <Section id="yesterday" title="Group 5 — Yesterdays Flow Volumes">
            <GaugeGrid>
              {wellData.map(w => {
                const offline = w.actual == null && w.yesterday == null
                return offline
                  ? <div key={w.n} style={{ padding: '12px 14px', borderRadius: 8, border: '1px dashed #2a1a1a', background: '#0f0808', color: '#555', fontSize: 10, display: 'flex', alignItems: 'center', minHeight: 80 }}>Well {w.n} offline</div>
                  : <Gauge key={w.n} label={`Well ${w.n} Yesterdays Flow`}
                      value={w.yesterday != null ? fmt(w.yesterday) : null} unit="MMSCFD"
                      sub={w.yesterday == null ? 'Pending MLink config' : undefined} />
              })}
            </GaugeGrid>
          </Section>

          {/* GROUP 6 — COMPRESSOR UNITS */}
          <Section id="compressors" title="Group 6 — Compressor Units">
            {HALFMANN_UNITS.map((u, i) => {
              const dm = unitMaps[i]
              const groups = u.type === 'asc' ? ASC_GROUPS : C4_GROUPS
              const rpm = getN(dm, ['RPM', 'Driver Speed', 'Engine Speed From EICS'])
              const isRunning = rpm != null && rpm > 100
              const hasData = unitDataRaw[u.key] != null
              return (
                <div key={u.key} style={{ marginBottom: 32 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 16px', background: '#0a0a16', border: `1px solid ${isRunning ? '#22c55e44' : '#1a1a2a'}`, borderRadius: 12 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: isRunning ? '#22c55e' : hasData ? '#ef4444' : '#333', boxShadow: isRunning ? '0 0 10px #22c55e88' : 'none', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: "'Arial Black'" }}>{u.label}</div>
                      <div style={{ fontSize: 9, color: '#555' }}>
                        {u.type === 'asc' ? 'ASC C5 — Flow PID Controlled' : 'C4 EICS — RPM Controlled (Standby)'}
                        {' · '}{isRunning ? `RUNNING @ ${Math.round(rpm)} RPM` : hasData ? 'STOPPED' : 'NO DATA'}
                      </div>
                    </div>
                    {unitFlows[i] != null && (
                      <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: '#22c55e', fontFamily: "'Arial Black'" }}>{fmt(unitFlows[i])} MMSCFD</div>
                        <div style={{ fontSize: 8, color: '#444' }}>Actual Flow</div>
                      </div>
                    )}
                  </div>
                  {!u.deviceId && (
                    <div style={{ padding: '14px 18px', background: '#0f0a00', border: '1px solid #5a3a00', borderRadius: 10, marginBottom: 18, fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
                      ⚠ MLink Device ID not configured for {u.label}. Contact Jim or Murphy Field Services to get the MLink device ID, then update HALFMANN_DEVICES.unit1396 in the code. All live registers will appear automatically once the ID is set.
                    </div>
                  )}
                  {groups.map(g => (
                    <SubSection key={g.title} title={g.title}>
                      <ParamGauges params={g.params} dataMap={dm} isAdmin={isAdmin} onSettings={openSettings} />
                    </SubSection>
                  ))}
                  {/* Dynamic catch-all: show every raw datapoint NOT already covered by the groups above */}
                  {(() => {
                    const rawDps = unitDataRaw[u.key]?.datapoints
                    if (!rawDps?.length) return null
                    // Collect all register keys the predefined groups already look up
                    const coveredKeys = new Set()
                    for (const g of groups) {
                      for (const p of g.params) {
                        for (const k of p.keys) coveredKeys.add(k.toLowerCase().trim())
                      }
                    }
                    const extra = []
                    const seenNames = new Set()
                    for (const dp of rawDps) {
                      const name = dp.alias || dp.desc || dp.dataSourceName || dp.Name || dp.name
                      if (!name || seenNames.has(name)) continue
                      seenNames.add(name)
                      if (coveredKeys.has(name.toLowerCase().trim())) continue
                      const v = dp.value ?? (Array.isArray(dp.values) ? dp.values[0] : undefined)
                      if (v == null || v === '' || String(v).toLowerCase() === 'n/a') continue
                      extra.push({ name, value: v, units: dp.units || dp.unit || '' })
                    }
                    if (!extra.length) return null
                    return (
                      <SubSection title="Additional Live Registers">
                        <GaugeGrid>
                          {extra.map(ep => {
                            const rawVal = Number(ep.value)
                            const display = Number.isFinite(rawVal)
                              ? rawVal.toFixed(rawVal % 1 === 0 ? 0 : 2)
                              : String(ep.value)
                            return <Gauge key={ep.name} label={ep.name} value={display} unit={cleanUnit(ep.units)} status="unknown" />
                          })}
                        </GaugeGrid>
                      </SubSection>
                    )
                  })()}
                </div>
              )
            })}
          </Section>

          <footer style={{ textAlign: 'center', padding: '16px 0', borderTop: '1px solid #1a1a2a', marginTop: 8 }}>
            <span style={{ fontSize: 8, color: '#2a2a3a' }}>Halfmann 1214 · Telemetry Dashboard · Refreshes every 60 seconds</span>
          </footer>
        </div>
      </div>
    </div>
  )
}
