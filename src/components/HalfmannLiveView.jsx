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
}

// unit2129 is the C4 EICS 1396 standby unit (RPM-controlled, no flow PID)
// units 2130/2127/2128 are ASC C5 units (flow PID controlled)
const HALFMANN_UNITS = [
  { key: 'unit2130', label: 'Unit 2130', deviceId: HALFMANN_DEVICES.unit2130, type: 'asc' },
  { key: 'unit2127', label: 'Unit 2127', deviceId: HALFMANN_DEVICES.unit2127, type: 'asc' },
  { key: 'unit2129', label: 'Unit 2129 (Standby)', deviceId: HALFMANN_DEVICES.unit2129, type: 'c4' },
  { key: 'unit2128', label: 'Unit 2128', deviceId: HALFMANN_DEVICES.unit2128, type: 'asc' },
]

// ─── Well panel lookup keys ────────────────────────────────────────────────────
const WELL_FLOW_KEYS = [
  ['Well 1 Injection Gas Flow Rate', 'Well #1 Flow Rate'],
  ['Well 2 Injection Gas Flow Rate', 'Well #2 Flow Rate'],
  ['Well 3 Injection Gas Flow Rate', 'Well #3 Flow Rate'],
  ['Well 4 Injection Gas Flow Rate', 'Well #4 Flow Rate'],
  ['Well 5 Injection Gas Flow Rate', 'Well # 5 Flow Rate', 'Well #5 Flow Rate'],
]
const WELL_SETPOINT_KEYS = [
  ['Well 1 Setpoint', 'Wellhead #1 Injection Flow Rate From Customer PLC', 'Well 1 Setpoint From Customer PLC'],
  ['Well 2 Setpoint', 'Wellhead #2 Injection Flow Rate From Customer PLC', 'Well 2 Setpoint From Customer PLC'],
  ['Well 3 Setpoint', 'Wellhead #3 Injection Flow Rate From Customer PLC', 'Well 3 Setpoint From Customer PLC'],
  ['Well 4 Setpoint', 'Wellhead #4 Injection Flow Rate From Customer PLC', 'Well 4 Setpoint From Customer PLC'],
  ['Well 5 Setpoint', 'Wellhead #5 Injection Flow Rate From Customer PLC', 'Well 5 Setpoint From Customer PLC'],
]
const WELL_YESTERDAY_KEYS = [
  ['Well 1 Yesterdays Flow', 'Wellhead #1 Yesterdays Total Flow', 'Well 1 Yesterdays Total Flow'],
  ['Well 2 Yesterdays Flow', 'Wellhead #2 Yesterdays Total Flow', 'Well 2 Yesterdays Total Flow'],
  ['Well 3 Yesterdays Flow', 'Wellhead #3 Yesterdays Total Flow', 'Well 3 Yesterdays Total Flow'],
  ['Well 4 Yesterdays Flow', 'Wellhead #4 Yesterdays Total Flow', 'Well 4 Yesterdays Total Flow'],
  ['Well 5 Yesterdays Flow', 'Wellhead #5 Yesterdays Total Flow', 'Well 5 Yesterdays Total Flow'],
]
const WELL_CHOKE_KEYS   = [1,2,3,4,5].map(n => [`Well ${n} Choke Position`])
const WELL_CASING_KEYS  = [1,2,3,4,5].map(n => [`Well ${n} Casing Pressure`, `Well #${n} Casing Pressure`])
const WELL_TUBING_KEYS  = [1,2,3,4,5].map(n => [`Well ${n} Tubing Pressure`, `Well #${n} Tubing Pressure`])

// ─── ASC C5 unit param groups — live MLink published keys ───────────────────────
// Units 2130/2127/2128 currently publish 17 registers. Groups below match exactly.
// Additional registers will appear once Jim (Murphy) completes full Modbus publish.
const ASC_GROUPS = [
  {
    title: 'Performance',
    params: [
      { label: 'Flow Rate',              keys: ['Flow Rate'],                          unit: 'MMSCFD', dec: 3 },
      { label: 'Engine Speed',           keys: ['RPM'],                                unit: 'RPM',    dec: 0 },
      { label: 'Engine Load',            keys: ['Engine Load'],                        unit: '%',      dec: 1 },
    ],
  },
  {
    title: 'Pressures',
    params: [
      { label: 'Suction Pressure',        keys: ['Suction Pressure'],                  unit: 'psi', dec: 1 },
      { label: 'Discharge Pressure',      keys: ['Discharge Pressure'],                unit: 'psi', dec: 0 },
      { label: 'Compressor Oil Pressure', keys: ['Compressor Oil Pressure'],           unit: 'psi', dec: 1 },
      { label: 'Engine Oil Pressure',     keys: ['Engine Oil Pressure'],               unit: 'psi', dec: 1 },
    ],
  },
  {
    title: 'Temperatures',
    params: [
      { label: 'Stg 1 Discharge Temp',    keys: ['Stage 1 Discharge Temperature'],     unit: '°F', dec: 1 },
      { label: 'Stg 2 Discharge Temp',    keys: ['Stage 2 Discharge Temperature'],     unit: '°F', dec: 1 },
      { label: 'Discharge Temp',          keys: ['Discharge Temperature'],             unit: '°F', dec: 1 },
      { label: 'Engine Oil Temp',         keys: ['Engine Oil Temperature'],            unit: '°F', dec: 1 },
      { label: 'EICS Oil Temp',           keys: ['EICS Oil Temperature'],              unit: '°F', dec: 1 },
      { label: 'Compressor Oil Temp',     keys: ['Compressor Oil Temperature'],        unit: '°F', dec: 1 },
    ],
  },
  {
    title: 'Status & Service',
    params: [
      { label: 'Hour Meter',              keys: ['Hour Meter'],                                  unit: 'hrs', dec: 1 },
      { label: 'Start Attempts / Hr',     keys: ['Number of Start Attempts per Hour'],           unit: '',    dec: 0 },
      { label: 'System Voltage',          keys: ['System Voltage'],                              unit: 'V',   dec: 1 },
      { label: 'Setpoint Lockout',        keys: ['Setpoint Edit Lockout Enabled'],               unit: '',    dec: 0 },
    ],
  },
]

// ─── C4 EICS unit param groups — live MLink published keys ──────────────────────
// Unit 2129 (C4 EICS 1396 standby) currently publishes 8 registers via MLink.
const C4_GROUPS = [
  {
    title: 'Performance & Pressures',
    params: [
      { label: 'Driver Speed',            keys: ['Driver Speed'],            unit: 'RPM', dec: 0 },
      { label: 'Suction Pressure',        keys: ['Suction Pressure'],        unit: 'psi', dec: 1 },
      { label: 'Discharge Pressure',      keys: ['Discharge Pressure'],      unit: 'psi', dec: 0 },
      { label: 'Engine Oil Pressure',     keys: ['Engine Oil Pressure'],     unit: 'psi', dec: 1 },
      { label: 'Compressor Oil Pressure', keys: ['Compressor Oil Pressure'], unit: 'psi', dec: 1 },
    ],
  },
  {
    title: 'Temperatures & Status',
    params: [
      { label: 'Discharge Temp',          keys: ['Discharge Temperature'],   unit: '°F', dec: 1 },
      { label: 'EICS Oil Temp',           keys: ['EICS Oil Temperature'],    unit: '°F', dec: 1 },
      { label: 'System Voltage',          keys: ['System Voltage'],          unit: 'V',  dec: 1 },
    ],
  },
]

// ─── Settings ─────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = { wellTargetPct: 5, recycleOpenPct: 5 }
const SETTINGS_SCHEMA = {
  wellTargetPct: { label: 'Well On-Target Threshold', description: 'A well is "on target" when actual flow is within this % of its setpoint.', unit: '%', min: 1, max: 25 },
  recycleOpenPct: { label: 'Recycle Valve Open Threshold', description: 'Recycle valve considered "open" above this position %.', unit: '%', min: 0, max: 25 },
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────────
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

// ─── Numeric helpers ──────────────────────────────────────────────────────────
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
function fmt(v, d = 3) { return v != null && Number.isFinite(v) ? v.toFixed(d) : '—' }
function getGrade(s) { if (s == null) return '—'; if (s >= 95) return 'A'; if (s >= 85) return 'B'; if (s >= 75) return 'C'; return 'D' }
function gradeStatus(g) { return g === 'A' ? 'good' : g === 'B' ? 'warn' : g === '—' ? 'unknown' : 'bad' }

// ─── UI Components ─────────────────────────────────────────────────────────────
const SC = {
  good:    { border: '#1d6c3d', bg: '#06120a', text: '#22c55e' },
  warn:    { border: '#8a6421', bg: '#120e04', text: '#f8c767' },
  bad:     { border: '#7a1a1a', bg: '#130404', text: '#ef4444' },
  unknown: { border: '#1a1a2a', bg: '#0a0a12', text: '#555' },
}

function GearIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}

function Gauge({ label, value, unit, status = 'unknown', sub, isAdmin, settingKey, onSettings }) {
  const c = SC[status] || SC.unknown
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '12px 12px 10px', position: 'relative', display: 'flex', flexDirection: 'column', gap: 3, minHeight: 90 }}>
      {isAdmin && settingKey && (
        <button onClick={() => onSettings(settingKey)} style={{ position: 'absolute', top: 7, right: 7, background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 4, color: '#555', cursor: 'pointer', padding: '2px 3px', lineHeight: 0 }}><GearIcon /></button>
      )}
      <div style={{ fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: '0.11em', fontWeight: 700, paddingRight: isAdmin && settingKey ? 20 : 0, lineHeight: 1.4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: c.text, lineHeight: 1, fontFamily: "'Arial Black',sans-serif", marginTop: 3 }}>{value ?? '—'}</div>
      {unit && <div style={{ fontSize: 8, color: '#555' }}>{unit}</div>}
      {sub && <div style={{ fontSize: 8, color: '#555', marginTop: 1, lineHeight: 1.3 }}>{sub}</div>}
    </div>
  )
}

function YesNoGauge({ label, good, detail, isAdmin, settingKey, onSettings }) {
  const s = good === null || good === undefined ? 'unknown' : good ? 'good' : 'bad'
  const c = SC[s]
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '12px 12px 10px', position: 'relative', display: 'flex', flexDirection: 'column', gap: 3, minHeight: 90 }}>
      {isAdmin && settingKey && (
        <button onClick={() => onSettings(settingKey)} style={{ position: 'absolute', top: 7, right: 7, background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 4, color: '#555', cursor: 'pointer', padding: '2px 3px', lineHeight: 0 }}><GearIcon /></button>
      )}
      <div style={{ fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: '0.11em', fontWeight: 700, paddingRight: isAdmin && settingKey ? 20 : 0, lineHeight: 1.4 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 900, color: c.text, lineHeight: 1, fontFamily: "'Arial Black',sans-serif", marginTop: 3 }}>{s === 'unknown' ? '—' : good ? 'YES' : 'NO'}</div>
      {detail && <div style={{ fontSize: 8, color: '#555', marginTop: 1, lineHeight: 1.4 }}>{detail}</div>}
    </div>
  )
}

function ScoreGauge({ label, score, detail, isAdmin, settingKey, onSettings }) {
  const g = getGrade(score)
  const s = score == null ? 'unknown' : gradeStatus(g)
  const c = SC[s]
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '12px 12px 10px', position: 'relative', display: 'flex', flexDirection: 'column', gap: 3, minHeight: 90 }}>
      {isAdmin && settingKey && (
        <button onClick={() => onSettings(settingKey)} style={{ position: 'absolute', top: 7, right: 7, background: '#1a1a2a', border: '1px solid #2a2a3a', borderRadius: 4, color: '#555', cursor: 'pointer', padding: '2px 3px', lineHeight: 0 }}><GearIcon /></button>
      )}
      <div style={{ fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: '0.11em', fontWeight: 700, paddingRight: isAdmin && settingKey ? 20 : 0, lineHeight: 1.4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 3 }}>
        <div style={{ fontSize: 26, fontWeight: 900, color: c.text, lineHeight: 1, fontFamily: "'Arial Black',sans-serif" }}>{score != null ? `${score.toFixed(0)}%` : '—'}</div>
        <div style={{ fontSize: 16, fontWeight: 900, color: c.text, opacity: 0.7, fontFamily: "'Arial Black',sans-serif" }}>{g}</div>
      </div>
      {score != null && <div style={{ height: 3, background: '#111', borderRadius: 2, marginTop: 5, overflow: 'hidden' }}><div style={{ width: `${Math.max(0, Math.min(100, score))}%`, height: '100%', background: c.text, borderRadius: 2 }} /></div>}
      {detail && <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>{detail}</div>}
    </div>
  )
}

function GaugeGrid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(155px,1fr))', gap: 8 }}>{children}</div>
}

function Section({ id, title, children }) {
  return (
    <div id={id} style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#49D0E2', whiteSpace: 'nowrap' }}>{title}</div>
        <div style={{ flex: 1, height: 1, background: '#1a1a2a' }} />
      </div>
      {children}
    </div>
  )
}

function SubSection({ title, children, accent }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: accent || '#555', marginBottom: 7 }}>{title}</div>
      {children}
    </div>
  )
}

function AdminLoginModal({ onClose, onLogin }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
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
    <button onClick={onRefresh} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 7, border: '1px solid #2a2a3a', background: '#111120', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1 }}>
      <svg width="15" height="15" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx="18" cy="18" r="15" fill="none" stroke="#1a2a1a" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="#22c55e" strokeWidth="3" strokeDasharray={`${2*Math.PI*15}`} strokeDashoffset={`${2*Math.PI*15*(1-pct/100)}`} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s linear' }} />
      </svg>
      <span style={{ fontSize: 9, color: '#888' }}>{loading ? 'Loading…' : `${s}s`}</span>
    </button>
  )
}

// ─── Param-driven gauge row helper ────────────────────────────────────────────
function ParamGauges({ params, dataMap, isAdmin, onSettings }) {
  return (
    <GaugeGrid>
      {params.map(p => {
        const v = getN(dataMap, p.keys)
        return (
          <Gauge key={p.label} label={p.label}
            value={v != null ? fmt(v, p.dec ?? 1) : '—'}
            unit={v != null ? p.unit : ''}
            sub={v == null ? 'Pending MLink' : undefined}
            status="unknown"
            isAdmin={isAdmin} settingKey={p.settingKey} onSettings={onSettings}
          />
        )
      })}
    </GaugeGrid>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function HalfmannLiveView() {
  const [panelData, setPanelData] = useState(null)
  const [unitDataRaw, setUnitDataRaw] = useState({})
  const [loading, setLoading] = useState(true)
  const [liveError, setLiveError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_S)
  const [padVisible, setPadVisible] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminToken, setAdminToken] = useState(() => { try { return localStorage.getItem('halfmann_admin_token') } catch { return null } })
  const [showLogin, setShowLogin] = useState(false)
  const [activeSettings, setActiveSettings] = useState(null)
  const [siteSettings, setSiteSettings] = useState(DEFAULT_SETTINGS)

  useEffect(() => {
    fetch(`${API_BASE}/api/settings`).then(r => r.ok ? r.json() : null).then(s => { if (s) setSiteSettings({ ...DEFAULT_SETTINGS, ...s }) }).catch(() => {})
    fetch(`${API_BASE}/api/public/pad-visibility`).then(r => r.ok ? r.json() : null).then(b => { if (b?.halfmann === false) setPadVisible(false) }).catch(() => {})
  }, [])

  useEffect(() => { if (adminToken) setIsAdmin(true) }, [adminToken])

  function handleLogin(token) {
    setAdminToken(token)
    try { localStorage.setItem('halfmann_admin_token', token) } catch {}
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
      ...HALFMANN_UNITS.map(u => fetchDeviceFull(u.deviceId)),
    ])
    setPanelData(panelResult.data)
    const raw = {}; HALFMANN_UNITS.forEach((u, i) => { raw[u.key] = unitResults[i].data }); setUnitDataRaw(raw)
    const allNull = !panelResult.data && unitResults.every(r => !r.data)
    if (allNull) setLiveError('No live MLink data available. Check field comms.')
    setLastRefresh(new Date()); setLoading(false); setCountdown(REFRESH_INTERVAL_S)
  }, [])

  useEffect(() => { refresh(); const i = setInterval(refresh, REFRESH_INTERVAL_S * 1000); return () => clearInterval(i) }, [refresh])
  useEffect(() => { const t = setInterval(() => setCountdown(c => c > 0 ? c - 1 : REFRESH_INTERVAL_S), 1000); return () => clearInterval(t) }, [])

  // ─── Derived data ─────────────────────────────────────────────────────────────
  const panel = parseLiveDatapoints(panelData)
  const panelTime = getTimestamp(panelData)
  const unitMaps = HALFMANN_UNITS.map(u => parseLiveDatapoints(unitDataRaw[u.key]))

  const wellTargetPct = siteSettings.wellTargetPct ?? 5
  const recycleOpenPct = siteSettings.recycleOpenPct ?? 5

  const wellData = WELL_FLOW_KEYS.map((flowKeys, i) => ({
    n: i + 1,
    actual:    parseLiveNumeric(resolveDP(panel, flowKeys)?.value),
    desired:   parseLiveNumeric(resolveDP(panel, WELL_SETPOINT_KEYS[i])?.value),
    choke:     parseLiveNumeric(resolveDP(panel, WELL_CHOKE_KEYS[i])?.value),
    casing:    getN(panel, WELL_CASING_KEYS[i]),
    tubing:    getN(panel, WELL_TUBING_KEYS[i]),
    yesterday: parseLiveNumeric(resolveDP(panel, WELL_YESTERDAY_KEYS[i])?.value),
  }))

  const totalDesiredSite = parseLiveNumeric(resolveDP(panel, ['Total Desired Site Flow'])?.value)
  const sumSetpoints = wellData.reduce((s, w) => s + (w.desired ?? 0), 0)
  const hasSetpoints = wellData.some(w => w.desired != null)
  const totalDesired = hasSetpoints ? sumSetpoints : totalDesiredSite
  const totalActual = wellData.reduce((s, w) => s + (w.actual ?? 0), 0)
  const perWellTarget = !hasSetpoints && totalDesiredSite ? totalDesiredSite / 5 : null

  const activeWells = wellData.filter(w => w.actual != null).length
  const wellsOnTarget = wellData.filter(w => {
    if (w.actual == null) return false
    const t = w.desired ?? perWellTarget
    return t != null && t > 0 && Math.abs(w.actual - t) <= t * (wellTargetPct / 100)
  }).length
  const allOnTarget = activeWells > 0 ? wellsOnTarget === activeWells : null

  const casingList = wellData.map((w, i) => w.casing != null ? { v: w.casing, n: i + 1 } : null).filter(Boolean)
  const tubingList = wellData.map((w, i) => w.tubing != null ? { v: w.tubing, n: i + 1 } : null).filter(Boolean)
  const highCasing = casingList.length ? casingList.reduce((a, b) => b.v > a.v ? b : a) : null
  const highTubing = tubingList.length ? tubingList.reduce((a, b) => b.v > a.v ? b : a) : null

  const suctionHeaderPres = getN(panel, ['Suction Header Pressure'])
  const suctionValvePos   = getN(panel, ['Suction/Sales Valve Position'])
  const recycleVal        = getN(panel, ['Recycle Valve Position', 'Recycle Valve', 'RCV Position'])
  const recycleOpen       = recycleVal != null ? recycleVal > recycleOpenPct : null

  const dischargeSP = unitMaps.reduce((f, dm) => f ?? getN(dm, ['Speed Auto Discharge SP', 'Altronic Discharge SP', 'Discharge Pressure SP', 'Speed Control SP']), null)
  const padMatchPct = totalDesired != null && totalDesired > 0 ? Math.max(0, 100 - (Math.abs(totalActual - totalDesired) / totalDesired) * 100) : null

  const unitFlows    = unitMaps.map(dm => getN(dm, ['Flow Rate PID PV', 'Flow Rate']))
  const unitDesired  = HALFMANN_UNITS.map((u, i) =>
    getN(panel, [`Compressor #${i+1} Desire Flow SP For PID Murphy`, `Compressor ${i+1} Desire Flow SP For PID Murphy`]) ??
    getN(unitMaps[i], ['Flow Rate PID Auto Sp', 'Desire Flow SP For PID Murphy', 'Desired Flow SP For PID Murphy', 'Flow Rate PID SP'])
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

  if (!padVisible) return <div style={{ display:'flex', minHeight:'100vh', alignItems:'center', justifyContent:'center', background:'#080810' }}><div style={{ color:'#888', fontSize:15 }}>This page is not currently available.</div></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#080810' }}>

      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 18px', background: '#0c0c16', borderBottom: '1px solid #1a1a2a', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 9, height: 9, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 7px #22c55e88' }} />
          <div>
            <div style={{ fontSize: 13, color: '#fff', fontWeight: 700, fontFamily: "'Arial Black'" }}>Live Field Data — Halfmann 1214</div>
            <div style={{ fontSize: 9, color: '#555' }}>{lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Connecting…'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <RefreshBtn s={countdown} loading={loading} onRefresh={refresh} />
          {isAdmin
            ? <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:9, color:'#22c55e', fontWeight:700, letterSpacing:'0.1em' }}>ADMIN</span>
                <button onClick={handleLogout} style={{ background:'#1a1a2a', border:'1px solid #2a2a3a', borderRadius:6, color:'#888', cursor:'pointer', padding:'4px 9px', fontSize:9 }}>Logout</button>
              </div>
            : <button onClick={() => setShowLogin(true)} style={{ background:'#1a1a2a', border:'1px solid #2a2a3a', borderRadius:6, color:'#666', cursor:'pointer', padding:'5px 12px', fontSize:9, fontWeight:700, letterSpacing:'0.1em' }}>ADMIN LOGIN</button>
          }
        </div>
      </header>

      {showLogin && <AdminLoginModal onClose={() => setShowLogin(false)} onLogin={handleLogin} />}
      {activeSettings && <GaugeSettingsModal settingKey={activeSettings} settings={siteSettings} onSave={handleSaveSettings} onClose={() => setActiveSettings(null)} />}

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 18px' }}>
        <div style={{ maxWidth: 1440, margin: '0 auto' }}>
          {liveError && <div style={{ background:'#1f0c0c', border:'1px solid #5a1d1d', borderRadius:7, padding:'9px 14px', marginBottom:18, fontSize:10, color:'#fca5a5' }}>{liveError}</div>}

          {/* ── GROUP 1: SITE SUMMARY ── */}
          <Section id="site-summary" title="Group 1 — Site Summary">
            <GaugeGrid>
              <YesNoGauge label="All Wells Meeting Desired Rate?" good={allOnTarget}
                detail={activeWells > 0 ? `${wellsOnTarget} of ${activeWells} within ${wellTargetPct}%` : 'Awaiting data'}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <Gauge label="Wells Meeting Rate" value={activeWells > 0 ? `${wellsOnTarget} / ${activeWells}` : '—'}
                status={activeWells > 0 ? (wellsOnTarget === activeWells ? 'good' : wellsOnTarget >= activeWells * 0.6 ? 'warn' : 'bad') : 'unknown'}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <Gauge label="Total Desired Flow" value={totalDesired != null ? fmt(totalDesired) : '—'} unit={totalDesired != null ? 'MMSCFD' : ''}
                sub={hasSetpoints ? 'Sum of well setpoints' : totalDesiredSite != null ? 'Panel register' : 'Pending MLink config'} />
              <Gauge label="Total Actual Flow" value={fmt(totalActual)} unit="MMSCFD"
                status={padMatchPct != null ? (padMatchPct >= 95 ? 'good' : padMatchPct >= 80 ? 'warn' : 'bad') : 'unknown'}
                sub={totalDesired != null ? `${fmt(padMatchPct, 1)}% of desired` : undefined} />
              <YesNoGauge label="Recycle Valve Open?" good={recycleOpen === null ? null : !recycleOpen}
                detail={recycleVal == null ? 'Pending MLink config' : `Position: ${recycleVal.toFixed(1)}% (threshold: ${recycleOpenPct}%)`}
                isAdmin={isAdmin} settingKey="recycleOpenPct" onSettings={openSettings} />
              <Gauge label="Highest Casing Pressure" value={highCasing ? fmt(highCasing.v, 0) : '—'} unit={highCasing ? 'PSI' : ''}
                sub={highCasing ? `Well ${highCasing.n}` : 'Pending MLink config'} />
              <Gauge label="Highest Tubing Pressure" value={highTubing ? fmt(highTubing.v, 0) : '—'} unit={highTubing ? 'PSI' : ''}
                sub={highTubing ? `Well ${highTubing.n}` : 'Pending MLink config'} />
              <Gauge label="Altronic Discharge Trigger SP" value={dischargeSP != null ? fmt(dischargeSP, 0) : '—'} unit={dischargeSP != null ? 'PSI' : ''}
                sub={dischargeSP == null ? 'Pending MLink config' : undefined} />
            </GaugeGrid>
          </Section>

          {/* ── GROUP 2: OPTIMIZATION ── */}
          <Section id="optimization" title="Group 2 — Optimization Scorecards">
            <GaugeGrid>
              <ScoreGauge label="Compressor Flow Score" score={compressorScore}
                detail={worstUnit ? `Worst: ${worstUnit.label} (${fmt(worstUnit.s, 0)}%)` : 'Awaiting desired flow data'}
                isAdmin={isAdmin} />
              <ScoreGauge label="Well Injection Score" score={wellScore}
                detail={worstWell ? `Worst: Well ${worstWell.n} (${fmt(worstWell.s, 0)}%)` : 'Awaiting setpoint data'}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <ScoreGauge label="Recycle Efficiency" score={recycleScore}
                detail={recycleVal != null ? `Valve at ${recycleVal.toFixed(1)}%` : 'Pending MLink config'}
                isAdmin={isAdmin} settingKey="recycleOpenPct" onSettings={openSettings} />
              <Gauge label="Worst Performing Unit" value={worstUnit ? worstUnit.label : '—'}
                sub={worstUnit ? `Score: ${fmt(worstUnit.s, 0)}%` : 'Awaiting data'}
                status={worstUnit ? gradeStatus(getGrade(worstUnit.s)) : 'unknown'} />
              <Gauge label="Worst Performing Well" value={worstWell ? `Well ${worstWell.n}` : '—'}
                sub={worstWell ? `Score: ${fmt(worstWell.s, 0)}%` : 'Awaiting data'}
                status={worstWell ? gradeStatus(getGrade(worstWell.s)) : 'unknown'} />
            </GaugeGrid>
          </Section>

          {/* ── GROUP 3: SITE DATA ── */}
          <Section id="site-data" title="Group 3 — Site Data">
            <GaugeGrid>
              <Gauge label="Suction Header Pressure" value={suctionHeaderPres != null ? fmt(suctionHeaderPres, 0) : '—'} unit={suctionHeaderPres != null ? 'PSI' : ''} sub={suctionHeaderPres == null ? 'Pending MLink config' : undefined} />
              <Gauge label="Suction / Sales Valve" value={suctionValvePos != null ? fmt(suctionValvePos, 1) : '—'} unit={suctionValvePos != null ? '%' : ''} sub={suctionValvePos == null ? 'Pending MLink config' : undefined} />
              <Gauge label="Recycle Valve Position" value={recycleVal != null ? `${recycleVal.toFixed(1)}` : '—'} unit={recycleVal != null ? '%' : ''}
                sub={recycleVal == null ? 'Pending MLink config' : recycleVal > recycleOpenPct ? 'OPEN' : 'Closed'}
                status={recycleVal == null ? 'unknown' : recycleVal > recycleOpenPct ? 'bad' : 'good'}
                isAdmin={isAdmin} settingKey="recycleOpenPct" onSettings={openSettings} />
            </GaugeGrid>
          </Section>

          {/* ── GROUP 4: WELL DATA ── */}
          <Section id="wells" title="Group 4 — Well Data">
            {wellData.map(w => (
              <SubSection key={w.n} title={`Well ${w.n}`} accent="#49D0E2">
                <GaugeGrid>
                  <Gauge label={`Well ${w.n} Setpoint`} value={w.desired != null ? fmt(w.desired) : '—'} unit={w.desired != null ? 'MMSCFD' : ''} sub={w.desired == null ? 'Pending MLink config' : undefined} />
                  <Gauge label={`Well ${w.n} Injection Flow`} value={w.actual != null ? fmt(w.actual) : '—'} unit={w.actual != null ? 'MMSCFD' : ''}
                    status={(() => { const t = w.desired ?? perWellTarget; if (w.actual == null || !t) return 'unknown'; const d = Math.abs(w.actual - t) / t * 100; return d <= wellTargetPct ? 'good' : d <= wellTargetPct * 2 ? 'warn' : 'bad' })()} />
                  <Gauge label={`Well ${w.n} Choke Position`} value={w.choke != null ? fmt(w.choke, 1) : '—'} unit={w.choke != null ? '%' : ''} sub={w.choke == null ? 'Pending MLink config' : undefined} />
                  <Gauge label={`Well ${w.n} Casing Pressure`} value={w.casing != null ? fmt(w.casing, 0) : '—'} unit={w.casing != null ? 'PSI' : ''} sub={w.casing == null ? 'Pending MLink config' : undefined} />
                  <Gauge label={`Well ${w.n} Tubing Pressure`} value={w.tubing != null ? fmt(w.tubing, 0) : '—'} unit={w.tubing != null ? 'PSI' : ''} sub={w.tubing == null ? 'Pending MLink config' : undefined} />
                </GaugeGrid>
              </SubSection>
            ))}
          </Section>

          {/* ── GROUP 5: YESTERDAYS FLOW ── */}
          <Section id="yesterday" title="Group 5 — Yesterdays Flow Volumes">
            <GaugeGrid>
              {wellData.map(w => (
                <Gauge key={w.n} label={`Well ${w.n} Yesterdays Flow`}
                  value={w.yesterday != null ? fmt(w.yesterday) : '—'} unit={w.yesterday != null ? 'MMSCFD' : ''}
                  sub={w.yesterday == null ? 'Pending MLink config' : undefined} />
              ))}
            </GaugeGrid>
          </Section>

          {/* ── GROUP 6: COMPRESSOR UNITS ── */}
          <Section id="compressors" title="Group 6 — Compressor Units">
            {HALFMANN_UNITS.map((u, i) => {
              const dm = unitMaps[i]
              const groups = u.type === 'asc' ? ASC_GROUPS : C4_GROUPS
              const rpm = getN(dm, ['Engine Speed From EICS', 'RPM', 'Driver Speed', 'ENGINE RPM', 'Engine Speed', 'Compressor Speed'])
              const isRunning = rpm != null && rpm > 100
              const hasData = unitDataRaw[u.key] != null
              return (
                <div key={u.key} style={{ marginBottom: 28 }}>
                  {/* Unit header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 14px', background: '#0c0c18', border: '1px solid #1a1a2a', borderRadius: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: isRunning ? '#22c55e' : hasData ? '#ef4444' : '#333', boxShadow: isRunning ? '0 0 8px #22c55e88' : 'none', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: "'Arial Black'" }}>{u.label}</div>
                      <div style={{ fontSize: 9, color: '#555' }}>{u.type === 'asc' ? 'ASC C5 — Flow PID Controlled' : 'C4 EICS — RPM Controlled (Standby)'} · {isRunning ? `RUNNING @ ${Math.round(rpm)} RPM` : hasData ? 'STOPPED' : 'NO DATA'}</div>
                    </div>
                    {unitFlows[i] != null && <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <div style={{ fontSize: 20, fontWeight: 900, color: '#22c55e', fontFamily: "'Arial Black'" }}>{fmt(unitFlows[i])} MMSCFD</div>
                      <div style={{ fontSize: 8, color: '#555' }}>Actual Flow</div>
                    </div>}
                  </div>
                  {/* Param groups */}
                  {groups.map(g => (
                    <SubSection key={g.title} title={g.title}>
                      <ParamGauges params={g.params} dataMap={dm} isAdmin={isAdmin} onSettings={openSettings} />
                    </SubSection>
                  ))}
                </div>
              )
            })}
          </Section>

          <footer style={{ textAlign: 'center', padding: '18px 0', borderTop: '1px solid #1a1a2a', marginTop: 8 }}>
            <span style={{ fontSize: 8, color: '#333' }}>Halfmann 1214 · Read-only public view · Refreshes every 60 seconds</span>
          </footer>
        </div>
      </div>
    </div>
  )
}
