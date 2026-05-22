import { useState, useEffect, useCallback } from 'react'
import { findRegisterDatapoint, parseLiveDatapoints } from '../engine/liveRegisters'
import { useHalfmannData } from '../context/HalfmannDataContext'

const API_BASE = import.meta.env.VITE_API_URL || ''
const REFRESH_INTERVAL_S = 3
const NOT_PUBLISHED_COPY = 'Not returned by current site feed'

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
  { key: 'unit2129', label: 'Unit 2129', deviceId: HALFMANN_DEVICES.unit2129, type: 'asc' },
  { key: 'unit2128', label: 'Unit 2128', deviceId: HALFMANN_DEVICES.unit2128, type: 'asc' },
  { key: 'unit1396', label: 'Unit 1396 (Standby)', deviceId: HALFMANN_DEVICES.unit1396, type: 'c4' },
]

const HALFMANN_WELL_SETPOINT_FALLBACKS = [1.225, 1.1, 1.45, 1.0, 1.35]

const WELL_FLOW_KEYS = [
  ['Well 1 Injection Gas Flow Rate', 'Well #1 Flow Rate'],
  ['Well 2 Injection Gas Flow Rate', 'Well #2 Flow Rate'],
  ['Well 3 Injection Gas Flow Rate', 'Well #3 Flow Rate'],
  ['Well 4 Injection Gas Flow Rate', 'Well #4 Flow Rate'],
  ['Well 5 Injection Gas Flow Rate', 'Well # 5 Flow Rate', 'Well #5 Flow Rate'],
]
const WELL_SETPOINT_KEYS = [1,2,3,4,5].map(n => [
  `Wellhead #${n} Calculated Desired Flow`,
  `Wellhead #${n} Setpoint From Customer PLC`,
  `Well ${n} Calculated Desired Flow`,
  `Well ${n} Setpoint From Customer PLC`,
  `Well ${n} Setpoint`,
])
const WELL_YESTERDAY_KEYS = [1,2,3,4,5].map(n => [
  `Well ${n} Yesterdays Flow`,
  `Wellhead #${n} Yesterday's Total Flow`,
  `Wellhead #${n} Yesterdays Total Flow`,
  `Well ${n} Yesterday's Total Flow`,
  `Well ${n} Yesterdays Total Flow`,
])
const WELL_CHOKE_KEYS  = [1,2,3,4,5].map(n => [
  `Well ${n} Choke Position`, `Well #${n} Choke Position`,
  `Well #${n} Analog Output ${n}`,   // Altronic DE4000 alias seen in MLink portal
  `Well ${n} Analog Output`,
])
const WELL_CASING_KEYS = [1,2,3,4,5].map(n => [`Well ${n} Casing Pressure`, `Well #${n} Casing Pressure`])
const WELL_TUBING_KEYS = [1,2,3,4,5].map(n => [`Well ${n} Tubing Pressure`, `Well #${n} Tubing Pressure`])

// ASC units: 17 live MLink keys
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
      { label: 'Stg 1 Discharge',         keys: ['Stage 1 Discharge Temperature'],          unit: 'deg F', dec: 1 },
      { label: 'Stg 2 Discharge',         keys: ['Stage 2 Discharge Temperature'],          unit: 'deg F', dec: 1 },
      { label: 'Discharge Temp',          keys: ['Discharge Temperature'],                  unit: 'deg F', dec: 1 },
      { label: 'Engine Oil Temp',         keys: ['Engine Oil Temperature'],                 unit: 'deg F', dec: 1 },
      { label: 'EICS Oil Temp',           keys: ['EICS Oil Temperature'],                   unit: 'deg F', dec: 1 },
      { label: 'Comp Oil Temp',           keys: ['Compressor Oil Temperature'],             unit: 'deg F', dec: 1 },
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

// C4 unit 2129: 8 live MLink keys
const C4_GROUPS = [
  {
    title: 'Performance & Pressures',
    params: [
      { label: 'Desired RPM',             keys: ['Target Speed'],                            unit: 'RPM', dec: 0 },
      { label: 'Actual RPM',              keys: ['ENGINE RPM', 'Driver Speed'],              unit: 'RPM', dec: 0 },
      { label: 'Suction Pressure',        keys: ['Suction Pressure'],                       unit: 'psi', dec: 1 },
      { label: 'Discharge Pressure',      keys: ['Discharge Pressure'],                     unit: 'psi', dec: 0 },
      { label: 'Engine Oil Pressure',     keys: ['Engine Oil Pressure'],                    unit: 'psi', dec: 1 },
      { label: 'Comp Oil Pressure',       keys: ['Compressor Oil Pressure'],                unit: 'psi', dec: 1 },
    ],
  },
  {
    title: 'Temperatures & Status',
    params: [
      { label: 'Discharge Temp',          keys: ['Discharge Temperature'],                  unit: 'deg F', dec: 1 },
      { label: 'EICS Oil Temp',           keys: ['EICS Oil Temperature'],                   unit: 'deg F', dec: 1 },
      { label: 'System Voltage',          keys: ['System Voltage'],                          unit: 'V',  dec: 1 },
    ],
  },
]

const DEFAULT_SETTINGS = { wellTargetPct: 5, recycleOpenPct: 5, meetingFlowPersistSeconds: 120 }
const SETTINGS_SCHEMA = {
  wellTargetPct:   { label: 'Well On-Target Threshold',    description: 'A well is "on target" when actual flow is within this % of its setpoint.', unit: '%', min: 1, max: 25 },
  recycleOpenPct:  { label: 'Recycle Valve Open Threshold', description: 'Recycle valve is "open" above this position %.', unit: '%', min: 0, max: 25 },
  meetingFlowPersistSeconds: { label: 'Meeting Flow Persist Time', description: 'A well or compressor must stay off target this many seconds before the site flips from meeting to not meeting flow.', unit: 'sec', min: 0, max: 900 },
}

// Fetch
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

// Helpers
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
function getWellSetpointInfo(dataMap, wellNumber, fallbackValue = null) {
  const liveValue = getN(dataMap, [
    `Wellhead #${wellNumber} Setpoint From Customer PLC`,
    `Well ${wellNumber} Setpoint From Customer PLC`,
    `Well ${wellNumber} Setpoint`,
  ])
  if (liveValue != null) return { value: liveValue, source: 'live' }
  if (fallbackValue != null && Number.isFinite(fallbackValue)) return { value: fallbackValue, source: 'fallback' }
  return { value: null, source: null }
}
function getWellCalculatedDesired(dataMap, wellNumber) {
  return getN(dataMap, [
    `Wellhead #${wellNumber} Calculated Desired Flow`,
    `Well ${wellNumber} Calculated Desired Flow`,
  ])
}
function getUnitDesiredFlow(dataMapPanel, dataMapUnit, unitKey, unitLabel) {
  const compNum = { unit2128: 1, unit2130: 2, unit2127: 3, unit2129: 4 }[unitKey]
  const unitNum = unitLabel.match(/\d{4}/)?.[0]
  return getN(dataMapPanel, [
    ...(compNum && unitNum ? [`Compressor #${compNum} Unit ${unitNum} Desire Flow SP For PID Murphy`] : []),
    ...(compNum && unitNum ? [`Compressor #${compNum} Unit ${unitNum} Desired Flow SP For PID Murphy`] : []),
    ...(compNum ? [
      `Compressor #${compNum} Desire Flow SP For PID Murphy`,
      `Compressor ${compNum} Desire Flow SP For PID Murphy`,
      `Compressor #${compNum} Desired Flow SP For PID Murphy`,
      `Compressor ${compNum} Desired Flow SP For PID Murphy`,
      `Compressor #${compNum} Desired Flow`,
      `Compressor ${compNum} Desired Flow`,
      `Compressor #${compNum} Flow Setpoint`,
      `Compressor ${compNum} Flow Setpoint`,
    ] : []),
  ]) ?? getN(dataMapUnit, [
    'Flow Rate PID Auto Sp',
    'Speed Auto SP Flow',
    'Speed Auto Sp Flow',
    'Desire Flow SP For PID Murphy',
    'Desired Flow SP For PID Murphy',
    'Flow Rate PID SP',
    'Quck Start Setting - Desired Flow Rate',
    'Quick Start Setting - Desired Flow Rate',
    'Flow Rate Setpoint',
    'Flow Setpoint',
    'Desired Flow',
    'Desired Flow Rate',
    'Target Flow',
  ])
}
function getUnitActualFlow(dataMap) {
  return getN(dataMap, ['Flow Rate', 'Flow Rate PID PV', 'Flow Rate PV', 'Flow PID PV', 'Compressor Flow Rate PID PV', 'Stage 3 Flow Rate'])
}
function getTimestamp(data) { return data?.timestamps?.[0] ? new Date(data.timestamps[0] * 1000) : null }
function fmt(v, d = 3) { return v != null && Number.isFinite(v) ? v.toFixed(d) : null }
function getRegisterCount(data) { return data?._registerCount ?? data?.datapoints?.length ?? 0 }
function getSourceMeta(data, sourceName) { return data?._sourceSummary?.[sourceName] || null }
function getDatapointName(dp) { return dp?.alias || dp?.desc || dp?.dataSourceName || dp?.Name || dp?.name || '' }
function getDatapointValue(dp) { return dp?.value ?? (Array.isArray(dp?.values) ? dp.values[0] : undefined) }
function formatAuditValue(value) {
  if (value == null || value === '') return '--'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return String(value)
  return numeric % 1 === 0 ? numeric.toFixed(0) : numeric.toFixed(3)
}
function getRegisterRows(data) {
  const rows = []
  const seen = new Set()
  for (const dp of data?.datapoints || []) {
    const name = getDatapointName(dp)
    if (!name || seen.has(name)) continue
    seen.add(name)
    rows.push({
      name,
      value: formatAuditValue(getDatapointValue(dp)),
      unit: cleanUnit(dp?.units || dp?.unit || ''),
      source: dp?._source || 'latestDeviceData',
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

function deriveMissingCompressorFlowValues(unitFlows, totalActualFlow, units) {
  if (totalActualFlow == null || !Number.isFinite(totalActualFlow)) return unitFlows
  const next = [...unitFlows]
  const activeIndexes = units.map((unit, index) => (unit.type === 'asc' ? index : null)).filter(index => index != null)
  const missingIndexes = activeIndexes.filter(index => next[index] == null)
  if (missingIndexes.length !== 1) return next

  const knownSum = activeIndexes.reduce((sum, index) => sum + (next[index] ?? 0), 0)
  const derivedFlow = totalActualFlow - knownSum
  if (!Number.isFinite(derivedFlow) || derivedFlow <= 0.01) return next

  next[missingIndexes[0]] = derivedFlow
  return next
}

function getGrade(pct) {
  if (pct == null) return null
  if (pct >= 95) return 'A'
  if (pct >= 85) return 'B'
  if (pct >= 75) return 'C'
  return 'D'
}
function gradeStatus(g) { return g === 'A' ? 'good' : g === 'B' ? 'warn' : g ? 'bad' : 'unknown' }

// Colors
const C = {
  good:    { border: '#22c55e', glow: '#22c55e28', bg: '#030f07', val: '#4ade80',  lbl: '#22c55e', sub: '#1a5c2e' },
  warn:    { border: '#f59e0b', glow: '#f59e0b28', bg: '#0f0800', val: '#fbbf24',  lbl: '#f59e0b', sub: '#5c3e0a' },
  bad:     { border: '#ef4444', glow: '#ef444428', bg: '#0f0303', val: '#f87171',  lbl: '#ef4444', sub: '#5c1a1a' },
  unknown: { border: '#1e1e30', glow: 'transparent', bg: '#080812', val: '#94a3b8', lbl: '#4a5568', sub: '#2a2a3a' },
}

// Components

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
        {v || '--'}
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
        {good === null ? '--' : good ? 'YES' : 'NO'}
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
        {score != null ? `${score.toFixed(0)}%` : '--'}
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
            sub={display == null ? NOT_PUBLISHED_COPY : undefined}
            status="unknown"
            isAdmin={isAdmin} settingKey={p.settingKey} onSettings={onSettings}
          />
        )
      })}
    </GaugeGrid>
  )
}

function DeviceRegisterAudit({ title, deviceId, data }) {
  const rows = getRegisterRows(data)
  const sourceCards = [
    ['LatestDeviceData', getSourceMeta(data, 'latestDeviceData')],
    ['RunReport', getSourceMeta(data, 'runReport')],
    ['Dashboard Snapshot', getSourceMeta(data, 'dashboardSnapshot')],
  ].filter(([, meta]) => meta)

  return (
    <details open style={{ marginBottom: 16, border: '1px solid #1a2740', borderRadius: 14, background: '#08101a' }}>
      <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '14px 16px', borderBottom: '1px solid #142033', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: "'Arial Black'" }}>{title}</span>
        <span style={{ fontSize: 10, color: '#7dd3fc' }}>{deviceId}</span>
        <span style={{ fontSize: 10, color: '#cbd5e1' }}>{getRegisterCount(data)} merged registers</span>
        {data?.timestamps?.[0] && <span style={{ fontSize: 10, color: '#64748b' }}>Updated {new Date(data.timestamps[0] * 1000).toLocaleString()}</span>}
      </summary>
      <div style={{ padding: 16 }}>
        {sourceCards.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {sourceCards.map(([label, meta]) => (
              <div key={label} style={{ border: '1px solid #22324d', borderRadius: 999, padding: '6px 10px', background: '#0c1524', fontSize: 10, color: '#cbd5e1' }}>
                <span style={{ color: '#7dd3fc', fontWeight: 700 }}>{label}</span>
                {' '} {meta.count} ({meta.state})
              </div>
            ))}
          </div>
        )}
        {Array.isArray(data?._limitations) && data._limitations.length > 0 && (
          <div style={{ marginBottom: 12, border: '1px solid #5a3a00', borderRadius: 10, background: '#120d02', padding: '10px 12px', fontSize: 10, lineHeight: 1.6, color: '#fcd34d' }}>
            {data._limitations.join(' ')}
          </div>
        )}
        {!rows.length ? (
          <div style={{ fontSize: 11, color: '#94a3b8' }}>No registers returned for this device.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {rows.map(row => (
              <div key={row.name} style={{ border: '1px solid #17263c', borderRadius: 10, background: '#0b1320', padding: '10px 12px' }}>
                <div style={{ fontSize: 9, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, lineHeight: 1.5 }}>{row.name}</div>
                <div style={{ fontSize: 20, color: '#fff', fontWeight: 900, fontFamily: "'Arial Black', sans-serif", lineHeight: 1.1, marginTop: 4 }}>{row.value}</div>
                {row.unit && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{row.unit}</div>}
                <div style={{ fontSize: 9, color: '#475569', marginTop: 6 }}>Source: {row.source}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
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
          <button type="submit" disabled={busy} style={{ flex: 1, background: '#1d4ed8', border: 'none', borderRadius: 7, color: '#fff', padding: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>{busy ? '...' : 'Login'}</button>
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
          <button onClick={save} disabled={busy} style={{ flex: 1, background: '#1d6c3d', border: 'none', borderRadius: 7, color: '#fff', padding: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>{busy ? 'Saving...' : 'Save'}</button>
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
  <span style={{ fontSize: 9, color: '#666' }}>{loading ? 'Loading...' : `${s}s`}</span>
    </button>
  )
}

function CommsIndicator({ commsStatus }) {
  const isHolding = commsStatus?.isHolding
  const isLimited = !isHolding && (commsStatus?.limitedDevices?.length ?? 0) > 0
  return (
    <div style={{
      border: `1px solid ${isHolding ? '#8a5b10' : isLimited ? '#5d4b12' : '#1d6c3d'}`,
      background: isHolding ? '#171207' : isLimited ? '#17140a' : '#0b1a12',
      color: isHolding ? '#fbbf24' : isLimited ? '#facc15' : '#4ade80',
      borderRadius: 999,
      padding: '5px 10px',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {isHolding ? 'Holding Last Good Data' : isLimited ? 'Feed Limited' : 'MLink Refresh OK'}
    </div>
  )
}

  // Main component
export default function HalfmannTelemetryView() {
  const {
    panelData,
    unitDataRaw,
    loading,
    liveError,
    lastRefresh,
    countdown,
    siteSettings,
    meetingState,
    commsStatus,
    refresh,
    saveSettings,
  } = useHalfmannData()
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminToken, setAdminToken] = useState(() => { try { return localStorage.getItem('halfmann_admin_token') } catch { return null } })
  const [showLogin, setShowLogin] = useState(false)
  const [activeSettings, setActiveSettings] = useState(null)
  const feedLimited = !commsStatus?.isHolding && (commsStatus?.limitedDevices?.length ?? 0) > 0

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
      const r = await saveSettings(updated, adminToken)
      if (r && r.status === 401) { setIsAdmin(false); setAdminToken(null); try { localStorage.removeItem('halfmann_admin_token') } catch {} }
    } catch {}
  }
  const openSettings = key => { if (isAdmin) setActiveSettings(key) }

  // Derived
  const panel = parseLiveDatapoints(panelData)
  const unitMaps = HALFMANN_UNITS.map(u => parseLiveDatapoints(unitDataRaw[u.key]))
  const { wellTargetPct = 5, recycleOpenPct = 5 } = siteSettings

  const wellData = WELL_FLOW_KEYS.map((flowKeys, i) => {
    const desiredInfo = getWellSetpointInfo(panel, i + 1, HALFMANN_WELL_SETPOINT_FALLBACKS[i])
    const stableAtTarget = meetingState.wells[String(i + 1)]
    return {
      n: i + 1,
      actual: getN(panel, flowKeys),
      desired: desiredInfo.value,
      desiredSource: desiredInfo.source,
      liveDesired: desiredInfo.source === 'live' ? desiredInfo.value : null,
      calculatedDesired: getWellCalculatedDesired(panel, i + 1),
      choke: getN(panel, WELL_CHOKE_KEYS[i]),
      casing: getN(panel, WELL_CASING_KEYS[i]),
      tubing: getN(panel, WELL_TUBING_KEYS[i]),
      yesterday: getN(panel, WELL_YESTERDAY_KEYS[i]),
      stableAtTarget,
    }
  })

  const totalDesiredSite = getN(panel, ['Total Desired Site Flow'])
  const sumSetpoints = wellData.reduce((s, w) => s + (w.desired ?? 0), 0)
  const hasAnySetpoints = wellData.some(w => w.desired != null)
  const liveSetpointCount = wellData.filter(w => w.desiredSource === 'live').length
  const fallbackSetpointCount = wellData.filter(w => w.desiredSource === 'fallback').length
  const totalDesired = hasAnySetpoints ? sumSetpoints : totalDesiredSite
  const totalActual  = wellData.reduce((s, w) => s + (w.actual ?? 0), 0)
  // Do not split totalDesiredSite by 5 as a per-well target - individual setpoints differ significantly.
  // Example: 1.225 / 1.100 / 1.450 / 1.000 / 1.350 from the Altronic panel.
  const perWellTarget = null
  const activeWells = wellData.filter(w => w.actual != null).length
  // Only evaluate wells that have an actual target to compare against.
  const wellsWithTarget = wellData.filter(w => w.actual != null && (w.desired != null || perWellTarget != null))
  const wellsOnTarget = wellsWithTarget.filter(w => {
    const t = w.desired ?? perWellTarget
    return w.stableAtTarget ?? (t != null && t > 0 && Math.abs(w.actual - t) <= t * (wellTargetPct / 100))
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

  const rawUnitFlows = unitMaps.map(dm => getUnitActualFlow(dm))
  const unitDesired = HALFMANN_UNITS.map((u, i) => getUnitDesiredFlow(panel, unitMaps[i], u.key, u.label))

  const unitFlows = deriveMissingCompressorFlowValues(rawUnitFlows, totalActual, HALFMANN_UNITS)

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
  const auditDevices = [
    { title: 'Well Panel', deviceId: HALFMANN_DEVICES.panel, data: panelData },
    ...HALFMANN_UNITS.map(unit => ({ title: unit.label, deviceId: unit.deviceId, data: unitDataRaw[unit.key] })),
  ]
  const auditRegisterTotal = auditDevices.reduce((sum, device) => sum + getRegisterCount(device.data), 0)
  const auditRespondingDevices = auditDevices.filter(device => device.data).length

  // Render
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#080810' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 18px', background: '#0a0a14', borderBottom: '1px solid #1a1a2a', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: commsStatus?.isHolding ? '#f59e0b' : feedLimited ? '#facc15' : '#22c55e',
            boxShadow: commsStatus?.isHolding ? '0 0 7px #f59e0b88' : feedLimited ? '0 0 7px #facc1588' : '0 0 7px #22c55e88',
          }} />
          <div>
            <div style={{ fontSize: 13, color: '#fff', fontWeight: 700, fontFamily: "'Arial Black'" }}>Telemetry Dashboard - Halfmann 1214</div>
            <div style={{ fontSize: 9, color: '#444' }}>{lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Connecting...'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <CommsIndicator commsStatus={commsStatus} />
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
          {commsStatus?.message && (
            <div style={{
              background: commsStatus?.isHolding ? '#171207' : '#17140a',
              border: `1px solid ${commsStatus?.isHolding ? '#8a5b10' : '#5d4b12'}`,
              borderRadius: 7,
              padding: '9px 14px',
              marginBottom: 18,
              fontSize: 10,
              color: commsStatus?.isHolding ? '#fef3c7' : '#fde68a',
            }}>
              {commsStatus.message}
            </div>
          )}

          <div style={{ background: '#081523', border: '1px solid #1f4b6d', borderRadius: 10, padding: '12px 14px', marginBottom: 18, fontSize: 10, color: '#bfdbfe', lineHeight: 1.7 }}>
            <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4 }}>Feed Audit</div>
            Halfmann is wired as 6 MLink devices across 3 configs. This page now lists every register the site can currently fetch for each device.
            Current payload: <span style={{ color: '#fff', fontWeight: 700 }}> {auditRegisterTotal} </span> merged registers across
            <span style={{ color: '#fff', fontWeight: 700 }}> {auditRespondingDevices} </span> responding devices.
          </div>

          <Section id="published-audit" title="Group 0 - Published Device Audit">
            {auditDevices.map(device => (
              <DeviceRegisterAudit key={device.deviceId} title={device.title} deviceId={device.deviceId} data={device.data} />
            ))}
          </Section>

          {/* GROUP 1 - SITE SUMMARY */}
          <Section id="site-summary" title="Group 1 - Site Summary">
            <GaugeGrid>
              <YesNoGauge label="All Wells Meeting Desired Rate?" good={allOnTarget}
                detail={wellsWithTarget.length > 0
                  ? `${wellsOnTarget} of ${wellsWithTarget.length} within ${wellTargetPct}%${liveSetpointCount === 0 && fallbackSetpointCount > 0 ? ' using confirmed fallback targets' : ''}`
                  : activeWells > 0 ? 'Well targets are not available yet' : 'Awaiting data'}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <Gauge label="Wells Meeting Rate"
                value={wellsWithTarget.length > 0 ? `${wellsOnTarget}/${wellsWithTarget.length}` : null}
                status={wellsWithTarget.length > 0 ? (wellsOnTarget === wellsWithTarget.length ? 'good' : wellsOnTarget >= wellsWithTarget.length * 0.6 ? 'warn' : 'bad') : 'unknown'}
                sub={wellsWithTarget.length === 0 && activeWells > 0 ? 'No target data yet' : liveSetpointCount === 0 && fallbackSetpointCount > 0 ? 'Using confirmed fallback targets' : undefined}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <Gauge label="Total Desired Flow"
                value={totalDesired != null ? fmt(totalDesired) : null} unit="MMSCFD"
                sub={hasAnySetpoints ? (liveSetpointCount > 0 ? 'Sum of well setpoints' : 'Sum of confirmed fallback targets') : totalDesiredSite != null ? 'Panel register' : NOT_PUBLISHED_COPY} />
              <Gauge label="Total Actual Flow"
                value={fmt(totalActual)} unit="MMSCFD"
                status={padMatchPct != null ? (padMatchPct >= 95 ? 'good' : padMatchPct >= 80 ? 'warn' : 'bad') : 'unknown'}
                sub={totalDesired != null ? `${fmt(padMatchPct, 1)}% of desired` : undefined} />
              <YesNoGauge label="Recycle Valve Open?" good={recycleOpen === null ? null : !recycleOpen}
                detail={recycleVal == null ? NOT_PUBLISHED_COPY : `Position: ${recycleVal.toFixed(1)}% (threshold: ${recycleOpenPct}%)`}
                isAdmin={isAdmin} settingKey="recycleOpenPct" onSettings={openSettings} />
              <Gauge label="Highest Casing Pressure"
                value={highCasing ? fmt(highCasing.v, 0) : null} unit="PSI"
                sub={highCasing ? `Well ${highCasing.n}` : NOT_PUBLISHED_COPY} />
              <Gauge label="Highest Tubing Pressure"
                value={highTubing ? fmt(highTubing.v, 0) : null} unit="PSI"
                sub={highTubing ? `Well ${highTubing.n}` : NOT_PUBLISHED_COPY} />
              <Gauge label="Altronic Discharge SP"
                value={dischargeSP != null ? fmt(dischargeSP, 0) : null} unit="PSI"
                sub={dischargeSP == null ? NOT_PUBLISHED_COPY : undefined} />
              <Gauge label="Recommended Compressors"
                value={getN(panel, ['Recommended Number Of Compressors']) != null ? fmt(getN(panel, ['Recommended Number Of Compressors']), 0) : null}
                status={(() => {
                  const rec = getN(panel, ['Recommended Number Of Compressors'])
                  const running = unitMaps.filter((dm, i) => { const r = getN(dm, ['RPM','Driver Speed']); return r != null && r > 100 }).length
                  if (rec == null) return 'unknown'
                  return running >= rec ? 'good' : running === rec - 1 ? 'warn' : 'bad'
                })()}
                sub={getN(panel, ['Recommended Number Of Compressors']) == null ? NOT_PUBLISHED_COPY : 'Panel system recommendation'} />
            </GaugeGrid>
          </Section>

          {/* GROUP 2 - OPTIMIZATION */}
          <Section id="optimization" title="Group 2 - Optimization Scorecards">
            <GaugeGrid>
              <ScoreGauge label="Compressor Flow Score" score={compressorScore}
                detail={worstUnit ? `Worst: ${worstUnit.label} (${fmt(worstUnit.s, 0)}%)` : 'Awaiting desired flow data'} />
              <ScoreGauge label="Well Injection Score" score={wellScore}
                detail={worstWell ? `Worst: Well ${worstWell.n} (${fmt(worstWell.s, 0)}%)` : 'Awaiting setpoint data'}
                isAdmin={isAdmin} settingKey="wellTargetPct" onSettings={openSettings} />
              <ScoreGauge label="Recycle Efficiency" score={recycleScore}
                detail={recycleVal != null ? `Valve at ${recycleVal.toFixed(1)}%` : NOT_PUBLISHED_COPY}
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

          {/* GROUP 3 - SITE DATA */}
          <Section id="site-data" title="Group 3 - Site Data">
            <GaugeGrid>
              <Gauge label="Suction Header Pressure"
                value={suctionHeaderPres != null ? fmt(suctionHeaderPres, 0) : null} unit="PSI"
                sub={suctionHeaderPres == null ? NOT_PUBLISHED_COPY : undefined} />
              <Gauge label="Suction / Sales Valve"
                value={suctionValvePos != null ? fmt(suctionValvePos, 1) : null} unit="%"
                sub={suctionValvePos == null ? NOT_PUBLISHED_COPY : undefined} />
              <Gauge label="Recycle Valve Position"
                value={recycleVal != null ? fmt(recycleVal, 1) : null} unit="%"
                sub={recycleVal == null ? NOT_PUBLISHED_COPY : recycleVal > recycleOpenPct ? 'OPEN' : 'Closed'}
                status={recycleVal == null ? 'unknown' : recycleVal > recycleOpenPct ? 'bad' : 'good'}
                isAdmin={isAdmin} settingKey="recycleOpenPct" onSettings={openSettings} />
            </GaugeGrid>
          </Section>

          {/* GROUP 4 - WELL DATA */}
          <Section id="wells" title="Group 4 - Well Data">
            {wellData.map(w => {
              const wellOffline = w.actual == null && w.liveDesired == null && w.choke == null && w.casing == null && w.tubing == null && w.yesterday == null
              return (
                <SubSection key={w.n} title={`Well ${w.n}`} accent="#49D0E2">
                  {wellOffline ? (
                    <div style={{ padding: '16px 20px', borderRadius: 10, border: '1px solid #2a1a1a', background: '#120808', color: '#ef4444', fontSize: 12, fontWeight: 700 }}>
                      Well {w.n} is not being returned by the current site feed.
                    </div>
                  ) : (
                    <GaugeGrid>
                      <Gauge label={`Well ${w.n} Setpoint`}
                        value={w.desired != null ? fmt(w.desired) : null} unit="MMSCFD"
                        sub={w.desired == null ? NOT_PUBLISHED_COPY : w.desiredSource === 'live' ? 'Live setpoint tag' : 'Confirmed fallback target'} />
                      <Gauge label={`Well ${w.n} Injection Flow`}
                        value={w.actual != null ? fmt(w.actual) : null} unit="MMSCFD"
                        status={(() => {
                          const t = w.desired ?? perWellTarget
                          if (w.actual == null || !t) return 'unknown'
                          const d = Math.abs(w.actual - t) / t * 100
                          if (d <= wellTargetPct) return 'good'
                          return w.calculatedDesired != null && w.desired != null && w.calculatedDesired < w.desired ? 'warn' : 'bad'
                        })()}
                        sub={(() => {
                          const t = w.desired ?? perWellTarget
                          if (w.actual == null || !t) return undefined
                          const d = Math.abs(w.actual - t) / t * 100
                          if (d <= wellTargetPct) return 'Within target'
                          return w.calculatedDesired != null && w.desired != null && w.calculatedDesired < w.desired
                            ? 'Panel calculated desired is below customer target'
                            : 'Below target'
                        })()} />
                      <Gauge label={`Well ${w.n} Choke Position`}
                        value={w.choke != null ? fmt(w.choke, 1) : null} unit="%"
                        sub={w.choke == null ? NOT_PUBLISHED_COPY : undefined} />
                      <Gauge label={`Well ${w.n} Casing Pressure`}
                        value={w.casing != null ? fmt(w.casing, 0) : null} unit="PSI"
                        sub={w.casing == null ? NOT_PUBLISHED_COPY : undefined} />
                      <Gauge label={`Well ${w.n} Tubing Pressure`}
                        value={w.tubing != null ? fmt(w.tubing, 0) : null} unit="PSI"
                        sub={w.tubing == null ? NOT_PUBLISHED_COPY : undefined} />
                    </GaugeGrid>
                  )}
                </SubSection>
              )
            })}
          </Section>

          {/* GROUP 5 - YESTERDAY FLOW */}
          <Section id="yesterday" title="Group 5 - Yesterday Flow Volumes">
            <GaugeGrid>
              {wellData.map(w => {
                const offline = w.actual == null && w.yesterday == null
                return offline
                  ? <div key={w.n} style={{ padding: '12px 14px', borderRadius: 8, border: '1px dashed #2a1a1a', background: '#0f0808', color: '#555', fontSize: 10, display: 'flex', alignItems: 'center', minHeight: 80 }}>Well {w.n} offline</div>
                  : <Gauge key={w.n} label={`Well ${w.n} Yesterday Flow`}
                      value={w.yesterday != null ? fmt(w.yesterday) : null} unit="MMSCFD"
                      sub={w.yesterday == null ? NOT_PUBLISHED_COPY : undefined} />
              })}
            </GaugeGrid>
          </Section>

          {/* GROUP 6 - COMPRESSOR UNITS */}
          <Section id="compressors" title="Group 6 - Compressor Units">
            {HALFMANN_UNITS.map((u, i) => {
              const dm = unitMaps[i]
              const groups = u.type === 'asc' ? ASC_GROUPS : C4_GROUPS
              const rpm = getN(dm, ['RPM', 'Driver Speed', 'ENGINE RPM', 'Engine Speed From EICS'])
              const isRunning = rpm != null && rpm > 100
              const hasData = unitDataRaw[u.key] != null
              return (
                <div key={u.key} style={{ marginBottom: 32 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 16px', background: '#0a0a16', border: `1px solid ${isRunning ? '#22c55e44' : '#1a1a2a'}`, borderRadius: 12 }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: isRunning ? '#22c55e' : hasData ? '#ef4444' : '#333', boxShadow: isRunning ? '0 0 10px #22c55e88' : 'none', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: "'Arial Black'" }}>{u.label}</div>
                      <div style={{ fontSize: 9, color: '#555' }}>
                        {u.type === 'asc' ? 'ASC C5 - Flow PID Controlled' : 'C4 EICS - RPM Controlled (Standby)'}
                        {' | '}{isRunning ? `RUNNING @ ${Math.round(rpm)} RPM` : hasData ? 'STOPPED' : 'NO DATA'}
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
                      Warning: MLink Device ID not configured for {u.label}. Contact Jim or Murphy Field Services to get the MLink device ID, then update HALFMANN_DEVICES.unit1396 in the code. All live registers will appear automatically once the ID is set.
                    </div>
                  )}
                  <SubSection title="Command & Flow">
                    <GaugeGrid>
                      {u.type === 'asc' ? (
                        <>
                          <Gauge
                            label="Desired Flow"
                            value={unitDesired[i] != null ? fmt(unitDesired[i]) : null}
                            unit="MMSCFD"
                            sub={unitDesired[i] == null ? NOT_PUBLISHED_COPY : undefined}
                          />
                          <Gauge
                            label="Actual Flow"
                            value={unitFlows[i] != null ? fmt(unitFlows[i]) : null}
                            unit="MMSCFD"
                            sub={unitFlows[i] == null ? NOT_PUBLISHED_COPY : undefined}
                          />
                        </>
                      ) : (
                        <>
                          <Gauge
                            label="Desired RPM"
                            value={getN(dm, ['Target Speed', 'Speed Control SP', 'RPM Setpoint']) != null ? fmt(getN(dm, ['Target Speed', 'Speed Control SP', 'RPM Setpoint']), 0) : null}
                            unit="RPM"
                            sub={getN(dm, ['Target Speed', 'Speed Control SP', 'RPM Setpoint']) == null ? NOT_PUBLISHED_COPY : undefined}
                          />
                          <Gauge
                            label="Actual RPM"
                            value={rpm != null ? fmt(rpm, 0) : null}
                            unit="RPM"
                            sub={rpm == null ? NOT_PUBLISHED_COPY : undefined}
                          />
                        </>
                      )}
                    </GaugeGrid>
                  </SubSection>
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
            <span style={{ fontSize: 8, color: '#2a2a3a' }}>Halfmann 1214 - Telemetry Dashboard - Refreshes every 3 seconds</span>
          </footer>
        </div>
      </div>
    </div>
  )
}
