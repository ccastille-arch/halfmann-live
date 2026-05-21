import { useState, useEffect, useCallback } from 'react'
import {
  findRegisterDatapoint,
  getVisibleCompressorRegisters,
  formatLiveRegisterValue,
  getVisibleLiveRegisters,
  loadAwiRegisterCatalog,
  parseLiveDatapoints,
} from '../engine/liveRegisters'

const API_BASE = import.meta.env.VITE_API_URL || ''
const REFRESH_INTERVAL_S = 60

const HALFMANN_DEVICES = {
  panel:    '2507-501508',
  unit2130: '2507-500709',
  unit2127: '2504-504108',
  unit2129: '2504-504102',
  unit2128: '2507-500076',
}

const HALFMANN_UNITS = [
  { key: 'unit2130', label: 'Unit 2130', deviceId: HALFMANN_DEVICES.unit2130 },
  { key: 'unit2127', label: 'Unit 2127', deviceId: HALFMANN_DEVICES.unit2127 },
  { key: 'unit2129', label: 'Unit 2129', deviceId: HALFMANN_DEVICES.unit2129 },
  { key: 'unit2128', label: 'Unit 2128', deviceId: HALFMANN_DEVICES.unit2128 },
]

const LIVE_WELL_FLOW_KEYS = [
  ['Well 1 Injection Gas Flow Rate', 'Well #1 Flow Rate'],
  ['Well 2 Injection Gas Flow Rate', 'Well #2 Flow Rate'],
  ['Well 3 Injection Gas Flow Rate', 'Well #3 Flow Rate'],
  ['Well 4 Injection Gas Flow Rate', 'Well #4 Flow Rate'],
  ['Well 5 Injection Gas Flow Rate', 'Well # 5 Flow Rate', 'Well #5 Flow Rate'],
]

const LIVE_WELL_YESTERDAY_KEYS = [
  ['Wellhead #1 Yesterdays Total Flow', 'Well 1 Yesterdays Total Flow'],
  ['Wellhead #2 Yesterdays Total Flow', 'Well 2 Yesterdays Total Flow'],
  ['Wellhead #3 Yesterdays Total Flow', 'Well 3 Yesterdays Total Flow'],
  ['Wellhead #4 Yesterdays Total Flow', 'Well 4 Yesterdays Total Flow'],
  ['Wellhead #5 Yesterdays Total Flow', 'Well 5 Yesterdays Total Flow'],
]

async function readErrorPayload(res) {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => ({}))
    return body?.details || body?.error || res.statusText
  }
  return (await res.text().catch(() => '')).trim() || res.statusText
}

async function fetchDevice(deviceId) {
  try {
    const res = await fetch(`${API_BASE}/api/mlink/device?deviceId=${encodeURIComponent(deviceId)}`)
    if (!res.ok) return { data: null, error: `device ${deviceId}: ${await readErrorPayload(res)}` }
    return { data: await res.json(), error: '' }
  } catch (err) {
    return { data: null, error: `device ${deviceId}: ${err.message}` }
  }
}

async function fetchDeviceFull(deviceId) {
  try {
    const res = await fetch(`${API_BASE}/api/mlink/device/full?deviceId=${encodeURIComponent(deviceId)}`)
    if (!res.ok) return fetchDevice(deviceId)
    return { data: await res.json(), error: '' }
  } catch (err) {
    return fetchDevice(deviceId)
  }
}

function getTimestamp(data, idx = 0) {
  if (!data?.timestamps?.[idx]) return null
  return new Date(data.timestamps[idx] * 1000)
}

function parseLiveNumeric(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function resolvePreferredDatapoint(dataMap, labels) {
  for (const label of labels) {
    const datapoint = findRegisterDatapoint(dataMap, { label, decimals: 3 })
    if (datapoint) return datapoint
  }
  return null
}

function getNumeric(dataMap, labels) {
  return parseLiveNumeric(resolvePreferredDatapoint(dataMap, labels)?.value)
}

function computeMatchPct(actual, desired) {
  if (actual == null || desired == null || desired <= 0) return null
  return Math.max(0, 100 - (Math.abs(actual - desired) / desired) * 100)
}

function isWithinTarget(actual, desired) {
  if (actual == null || desired == null || desired <= 0) return false
  return Math.abs(actual - desired) <= desired * 0.05
}

function average(values) {
  const valid = values.filter(v => v != null && Number.isFinite(v))
  if (!valid.length) return null
  return valid.reduce((sum, v) => sum + v, 0) / valid.length
}

function formatFlow(value) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(3)} MMSCFD` : '--'
}

function formatFlowValue(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(3) : '--'
}

function formatHourMeterValue(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toLocaleString() : '--'
}

function getCompressorUnit(label) {
  if (/temperature/i.test(label)) return 'deg F'
  if (/speed/i.test(label)) return 'RPM'
  if (/pressure|prs|dp/i.test(label)) return 'PSI'
  if (/flow/i.test(label)) return 'MMSCFD'
  return ''
}

function getCompressorColor(label, value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '#fff'
  if (/stage 3 discharge prs|discharge pressure/i.test(label)) return numeric > 900 ? '#E8200C' : '#22c55e'
  if (/stage 1 suction prs|suction pressure/i.test(label)) return numeric < 30 ? '#eab308' : '#22c55e'
  if (/3rd stage discharge temperature|discharge temp/i.test(label)) return numeric > 275 ? '#E8200C' : '#22c55e'
  if (/skid - shutdown/i.test(label)) return numeric > 0 ? '#E8200C' : '#22c55e'
  return '#fff'
}

function DataPoint({ label, value, unit, color, compact = false }) {
  return (
    <div className="bg-[#0a0a14] rounded border border-[#2a2a3a] p-2">
      <div className="text-[8px] text-[#888] uppercase tracking-wider">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={compact ? 'text-[16px] font-bold' : 'text-[14px] font-bold'} style={{ color: color || '#fff', fontFamily: "'Arial Black'" }}>
          {value || '--'}
        </span>
        <span className="text-[8px] text-[#666]">{unit}</span>
      </div>
    </div>
  )
}

function CompressorCard({ label, data, time, desiredFlow, actualFlow, registers }) {
  const rpm = data['RPM'] || data['Compressor Speed'] || data['Driver Speed'] || data['Engine Speed']
  const shutdown = data['Skid - Shutdown']
  const isShutdown = shutdown && String(shutdown.value).toLowerCase().includes('shutdown')
  const hasRpm = rpm && parseFloat(rpm.value) > 100
  const hasFlow = actualFlow != null && parseFloat(actualFlow?.value) > 0.01
  const isRunning = (hasRpm || hasFlow) && !isShutdown
  const visibleRegisters = registers.filter(meta => meta.label !== 'Flow Rate PID PV')
  const desiredFlowValue = formatFlowValue(desiredFlow?.value)
  const actualFlowValue = formatFlowValue(actualFlow?.value)
  return (
    <div className="bg-[#111118] rounded-xl border border-[#222] p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-[#22c55e] shadow-lg shadow-[#22c55e]/50' : 'bg-[#E8200C]'}`} />
        <h3 className="text-[13px] text-white font-bold" style={{ fontFamily: "'Arial Black'" }}>{label}</h3>
        <span className={`text-[9px] font-bold ml-auto ${isRunning ? 'text-[#22c55e]' : 'text-[#E8200C]'}`}>
          {isRunning ? 'RUNNING' : 'STOPPED'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <DataPoint label="Desired Flow" value={desiredFlowValue} unit={desiredFlow?.units || 'MMSCFD'} color="#4fc3f7" compact />
        <DataPoint label="Actual Flow" value={actualFlowValue} unit={actualFlow?.units || 'MMSCFD'} color={getCompressorColor('Flow Rate', actualFlow?.value)} compact />
      </div>
      {visibleRegisters.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {visibleRegisters.map(meta => (
            <DataPoint
              key={meta.id}
              label={meta.label}
              value={formatLiveRegisterValue(meta, meta.datapoint)}
              unit={meta.datapoint.units || getCompressorUnit(meta.label)}
              color={getCompressorColor(meta.label, meta.datapoint.value)}
            />
          ))}
        </div>
      )}
      {time && <div className="text-[8px] text-[#444] mt-2 text-right">Updated: {time.toLocaleString()}</div>}
    </div>
  )
}

function StatusCard({ question, good, detail }) {
  const isUnknown = good === null
  return (
    <div className={`rounded-2xl border p-5 flex flex-col gap-2 ${isUnknown ? 'border-[#2a2a3a] bg-[#0e0e1a]' : good ? 'border-[#1d6c3d] bg-[#0a1a10]' : 'border-[#7a1a1a] bg-[#1a0a0a]'}`}>
      <div className="text-[12px] font-semibold uppercase tracking-[0.15em] text-[#888]">{question}</div>
      <div className={`text-[42px] font-black leading-none ${isUnknown ? 'text-[#555]' : good ? 'text-[#22c55e]' : 'text-[#E8200C]'}`} style={{ fontFamily: "'Arial Black'" }}>
        {isUnknown ? '—' : good ? 'YES' : 'NO'}
      </div>
      <div className={`text-[12px] font-medium ${isUnknown ? 'text-[#555]' : good ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>{detail}</div>
    </div>
  )
}

function RefreshCountdown({ secondsLeft, loading, onRefresh }) {
  const pct = Math.round((secondsLeft / REFRESH_INTERVAL_S) * 100)
  return (
    <button onClick={onRefresh} disabled={loading}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#2a2a3a] bg-[#111120] hover:bg-[#1a1a2a] disabled:opacity-50 transition-colors"
      title="Click to refresh now">
      <svg width="16" height="16" viewBox="0 0 36 36" className="shrink-0 -rotate-90">
        <circle cx="18" cy="18" r="15" fill="none" stroke="#1a2a1a" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="#22c55e" strokeWidth="3"
          strokeDasharray={`${2 * Math.PI * 15}`}
          strokeDashoffset={`${2 * Math.PI * 15 * (1 - pct / 100)}`}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s linear' }} />
      </svg>
      <span className="text-[10px] text-[#888]">{loading ? 'Loading…' : `Refreshes in ${secondsLeft}s`}</span>
    </button>
  )
}

function PressureCell({ label, value, unit = 'PSI', warn, danger }) {
  const n = parseLiveNumeric(value)
  const color = n == null ? '#555'
    : danger != null && n >= danger ? '#ef4444'
    : warn != null && n >= warn ? '#f59e0b'
    : '#22c55e'
  return (
    <div className="bg-[#0a0a14] rounded border border-[#1e1e2e] p-2.5">
      <div className="text-[8px] text-[#666] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-[16px] font-black leading-none" style={{ color, fontFamily: "'Arial Black'" }}>
        {n != null ? n.toFixed(0) : '—'}
      </div>
      {n != null && <div className="text-[8px] text-[#555] mt-0.5">{unit}</div>}
    </div>
  )
}

export default function HalfmannLiveView() {
  const [panelData, setPanelData] = useState(null)
  const [unitDataRaw, setUnitDataRaw] = useState({ unit2130: null, unit2127: null, unit2129: null, unit2128: null })
  const [registerCatalog, setRegisterCatalog] = useState([])
  const [loading, setLoading] = useState(true)
  const [liveError, setLiveError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_S)
  const [padVisible, setPadVisible] = useState(true)
  const [recycleAlertThreshold, setRecycleAlertThreshold] = useState(0)

  useEffect(() => {
    fetch(`${API_BASE}/api/public/pad-visibility`)
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (body && body.halfmann === false) setPadVisible(false) })
      .catch(() => {})
    fetch(`${API_BASE}/api/settings`)
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (body?.recycleAlertThreshold != null) setRecycleAlertThreshold(body.recycleAlertThreshold) })
      .catch(() => {})
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLiveError('')
    const [panelResult, ...unitResults] = await Promise.all([
      fetchDeviceFull(HALFMANN_DEVICES.panel),
      ...HALFMANN_UNITS.map(u => fetchDeviceFull(u.deviceId)),
    ])
    setPanelData(panelResult.data)
    const newUnitData = {}
    HALFMANN_UNITS.forEach((u, i) => { newUnitData[u.key] = unitResults[i].data })
    setUnitDataRaw(newUnitData)
    const allNull = !panelResult.data && unitResults.every(r => !r.data)
    if (allNull) {
      const allErrors = [panelResult.error, ...unitResults.map(r => r.error)].filter(Boolean)
      setLiveError(allErrors.length > 0
        ? `No live MLINK data available. ${allErrors.join(' | ')}`
        : 'No live MLINK data available. Check field comms.')
    }
    setLastRefresh(new Date())
    setLoading(false)
    setCountdown(REFRESH_INTERVAL_S)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, REFRESH_INTERVAL_S * 1000)
    return () => clearInterval(interval)
  }, [refresh])

  useEffect(() => {
    const tick = setInterval(() => setCountdown(c => (c > 0 ? c - 1 : REFRESH_INTERVAL_S)), 1000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    loadAwiRegisterCatalog().then(setRegisterCatalog).catch(() => {})
  }, [])

  const panel = parseLiveDatapoints(panelData)
  const panelTime = getTimestamp(panelData)
  const unitDataMaps = HALFMANN_UNITS.map(u => parseLiveDatapoints(unitDataRaw[u.key]))

  // Compute site totals FIRST so they can serve as per-well fallback
  const totalDesiredSite = parseLiveNumeric(resolvePreferredDatapoint(panel, ['Total Desired Site Flow'])?.value)
  const perWellTarget = totalDesiredSite != null ? totalDesiredSite / LIVE_WELL_FLOW_KEYS.length : null

  const liveWellPerformance = LIVE_WELL_FLOW_KEYS.map((keys, index) => {
    const wellNumber = index + 1
    const actual = parseLiveNumeric(resolvePreferredDatapoint(panel, keys)?.value)
    // Use true setpoint registers only — NOT the injection flow rate register (same as actual)
    const desiredDatapoint = resolvePreferredDatapoint(panel, [
      `Wellhead #${wellNumber} Setpoint From Customer PLC`,
      `Well ${wellNumber} Setpoint`,
    ])
    const desired = parseLiveNumeric(desiredDatapoint?.value) ?? perWellTarget
    const yesterday = parseLiveNumeric(resolvePreferredDatapoint(panel, LIVE_WELL_YESTERDAY_KEYS[index])?.value)
    const staticPres = getNumeric(panel, [
      `Wellhead #${wellNumber} Injection Static Pressure From Customer PLC`,
      `Well ${wellNumber} Static Pressure`, `Well #${wellNumber} Static Pressure`,
    ])
    const diffPres = getNumeric(panel, [
      `Wellhead #${wellNumber} Injection Differential Prs From Customer PLC`,
      `Well ${wellNumber} Differential Pressure`,
    ])
    const casingPres = getNumeric(panel, [
      `Well ${wellNumber} Casing Pressure`, `Well #${wellNumber} Casing Pressure`,
      `Wellhead #${wellNumber} Casing Pressure`,
    ])
    const tubingPres = getNumeric(panel, [
      `Well ${wellNumber} Tubing Pressure`, `Well #${wellNumber} Tubing Pressure`,
      `Wellhead #${wellNumber} Tubing Pressure`,
    ])
    return {
      wellNumber, actual, desired, yesterday,
      staticPres, diffPres, casingPres, tubingPres,
      gap: actual != null && desired != null ? actual - desired : null,
      matchPct: computeMatchPct(actual, desired),
      atTarget: isWithinTarget(actual, desired),
    }
  })

  const unitDesiredFlows = HALFMANN_UNITS.map((u, i) =>
    resolvePreferredDatapoint(panel, [
      `Compressor #${i + 1} Desire Flow SP For PID Murphy`,
      `Compressor ${i + 1} Desire Flow SP For PID Murphy`,
    ]) ??
    resolvePreferredDatapoint(unitDataMaps[i], [
      'Desire Flow SP For PID Murphy', 'Desired Flow SP For PID Murphy', 'Flow Rate PID SP',
    ])
  )

  const unitActualFlows = unitDataMaps.map(dataMap =>
    resolvePreferredDatapoint(dataMap, ['Flow Rate', 'Flow Rate PID PV', 'Flow Rate PV', 'Flow PID PV'])
  )

  // Per-compressor pressure readings
  const unitDischargePrs = unitDataMaps.map(dataMap =>
    getNumeric(dataMap, ['Discharge Pressure', 'Compressor Discharge Prs', '3rd Stage Discharge Prs', 'Stage 3 Discharge Prs'])
  )
  const unitSuctionPrs = unitDataMaps.map(dataMap =>
    getNumeric(dataMap, ['Suction Pressure', 'Suction Prs', 'Stage 1 Suction Prs', '1st Stage Suction Prs'])
  )
  const unitSpeedDischargeSP = unitDataMaps.map(dataMap =>
    getNumeric(dataMap, ['Speed Control SP', 'Speed Discharge SP', 'Altronic Discharge Pressure Trigger', 'Altronic Speed Control SP', 'Discharge Pressure SP'])
  )

  const visibleRegisters = getVisibleLiveRegisters(panel, registerCatalog, {})
  const hourMeterRegister = visibleRegisters.find(meta => meta.label === 'Hour Meter')

  const totalActualFlow = liveWellPerformance.reduce((sum, w) => sum + (w.actual ?? 0), 0)
  const padMatchPct = totalDesiredSite != null && totalDesiredSite > 0
    ? Math.max(0, 100 - (Math.abs(totalActualFlow - totalDesiredSite) / totalDesiredSite) * 100) : null

  const activeWells = liveWellPerformance.filter(w => w.actual != null)
  const wellsAtTargetCount = activeWells.filter(w => w.atTarget).length
  const allOnTarget = activeWells.length > 0 ? wellsAtTargetCount === activeWells.length : null

  const recycleVal = getNumeric(panel, ['Recycle Valve Position', 'Recycle Valve', 'RCV Position',
    'Station Recycle Header Valve Command Output'])
  const recycleOpen = recycleVal != null ? recycleVal > recycleAlertThreshold : null

  const dischargeTriggerSP = getNumeric(panel, ['Altronic Discharge Pressure Trigger', 'Discharge Trigger SP', 'Speed Auto Discharge SP'])

  const siteOnTarget = padMatchPct != null ? padMatchPct >= 95 : null

  if (!padVisible) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080810]">
        <div className="text-[15px] text-[#888]">This page is not currently available.</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col bg-[#080810]" style={{ minHeight: 'calc(100vh - 48px)' }}>
      <header className="flex items-center justify-between px-5 py-3 bg-[#0c0c16] border-b border-[#1a1a2a] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e] shadow-lg shadow-[#22c55e]/60 animate-pulse" />
          <div>
            <div className="text-[13px] text-white font-bold" style={{ fontFamily: "'Arial Black'" }}>Live Field Data — Halfmann 1214</div>
            <div className="text-[10px] text-[#666]">Active Pad Logic panel · read-only public view</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && <span className="text-[9px] text-[#555] hidden sm:inline">Last update: {lastRefresh.toLocaleTimeString()}</span>}
          <RefreshCountdown secondsLeft={countdown} loading={loading} onRefresh={refresh} />
          <span className="rounded-full border border-[#2f2f40] bg-[#111120] px-2 py-0.5 text-[8px] uppercase tracking-[0.18em] text-[#777]">
            Hour Meter <span className="ml-1 text-[10px] text-white font-bold normal-case tracking-normal">
              {formatHourMeterValue(hourMeterRegister?.datapoint?.value ?? panel['\t Hour Meter']?.value ?? panel['Hour Meter']?.value)}
            </span>
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-5">
        <div className="max-w-[1280px] mx-auto">
          {loading && !panelData ? (
            <div className="text-center py-24 text-[#888] text-sm">Connecting to field units…</div>
          ) : (
            <>
              {liveError && (
                <div className="mb-4 rounded-lg border border-[#5a1d1d] bg-[#1f0c0c] px-4 py-3 text-[11px] text-[#fca5a5]">{liveError}</div>
              )}

              {/* ── 3 YES/NO Status Cards ── */}
              <div className="grid gap-4 sm:grid-cols-3 mb-5">
                <StatusCard
                  question="Are all wells meeting target flow rate?"
                  good={allOnTarget}
                  detail={activeWells.length > 0
                    ? `${wellsAtTargetCount} of ${activeWells.length} wells within 5% of target`
                    : 'Waiting for flow data…'}
                />
                <StatusCard
                  question="Is site injection on target?"
                  good={siteOnTarget}
                  detail={totalDesiredSite != null
                    ? `${totalActualFlow.toFixed(3)} actual vs ${totalDesiredSite.toFixed(3)} MMSCFD desired`
                    : 'Waiting for desired-rate data…'}
                />
                <StatusCard
                  question="Is the recycle valve closed?"
                  good={recycleOpen === null ? null : !recycleOpen}
                  detail={recycleVal == null
                    ? 'Pending MLink config'
                    : recycleOpen
                      ? `OPEN — valve at ${recycleVal.toFixed(1)}% (threshold: ${recycleAlertThreshold}%)`
                      : `Closed — valve at ${recycleVal.toFixed(1)}%`}
                />
              </div>

              {/* ── Recycle Valve Large Block + Pressure Summary ── */}
              <div className="mb-5 rounded-2xl border p-5"
                style={{ borderColor: recycleOpen === null ? '#1e1e30' : recycleOpen ? '#7a1a1a' : '#1d6c3d', background: recycleOpen ? '#1a0a0a' : '#0a1410' }}>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#49D0E2] mb-4" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                  Recycle Valve &amp; Pressures
                </div>
                <div className="grid gap-4 sm:grid-cols-[auto_1fr] mb-4">
                  {/* Recycle Valve Block */}
                  <div className="rounded-xl border p-5 min-w-[180px]"
                    style={{ borderColor: recycleOpen === null ? '#2a2a3a' : recycleOpen ? '#7a1a1a' : '#1d6c3d', background: recycleOpen ? '#180808' : '#081310' }}>
                    <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#49D0E2' }}>Recycle Valve</div>
                    <div className="text-[52px] font-black leading-none mb-1"
                      style={{ color: recycleVal == null ? '#444' : recycleOpen ? '#E8200C' : '#22c55e', fontFamily: "'Arial Black'" }}>
                      {recycleVal != null ? `${recycleVal.toFixed(1)}%` : '—'}
                    </div>
                    <div className="text-[13px] font-black mb-3"
                      style={{ color: recycleVal == null ? '#555' : recycleOpen ? '#E8200C' : '#22c55e', fontFamily: "'Arial Black'" }}>
                      {recycleVal == null ? 'PENDING' : recycleOpen ? 'NOT MEETING TARGET' : 'ON TARGET'}
                    </div>
                    <div className="text-[9px] text-[#555] uppercase tracking-wider">
                      Target: ≤ {recycleAlertThreshold}% · Adjustable via admin
                    </div>
                    {/* Position bar */}
                    <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: '#1a1a2a' }}>
                      <div className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, recycleVal ?? 0)}%`,
                          background: recycleOpen ? '#E8200C' : '#22c55e',
                        }} />
                    </div>
                  </div>

                  {/* Discharge / Suction Pressures per Compressor */}
                  <div>
                    <div className="text-[9px] text-[#49D0E2] uppercase tracking-[0.15em] font-bold mb-2">Discharge &amp; Suction Pressures — Per Compressor</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                      {HALFMANN_UNITS.map((u, i) => (
                        <div key={u.key} className="rounded-lg border border-[#1e1e30] bg-[#0a0a14] p-2.5">
                          <div className="text-[8px] text-[#49D0E2] font-bold uppercase tracking-wider mb-2">{u.label}</div>
                          <div className="space-y-1.5">
                            <div>
                              <div className="text-[7px] text-[#555] uppercase tracking-wider">Discharge</div>
                              <div className="text-[16px] font-black leading-none"
                                style={{ color: unitDischargePrs[i] != null ? (unitDischargePrs[i] > 900 ? '#ef4444' : '#22c55e') : '#444', fontFamily: "'Arial Black'" }}>
                                {unitDischargePrs[i] != null ? `${unitDischargePrs[i].toFixed(0)}` : '—'}
                              </div>
                              {unitDischargePrs[i] != null && <div className="text-[7px] text-[#555]">PSI</div>}
                            </div>
                            <div>
                              <div className="text-[7px] text-[#555] uppercase tracking-wider">Suction</div>
                              <div className="text-[16px] font-black leading-none"
                                style={{ color: unitSuctionPrs[i] != null ? (unitSuctionPrs[i] < 30 ? '#f59e0b' : '#22c55e') : '#444', fontFamily: "'Arial Black'" }}>
                                {unitSuctionPrs[i] != null ? `${unitSuctionPrs[i].toFixed(0)}` : '—'}
                              </div>
                              {unitSuctionPrs[i] != null && <div className="text-[7px] text-[#555]">PSI</div>}
                            </div>
                            {unitSpeedDischargeSP[i] != null && (
                              <div>
                                <div className="text-[7px] text-[#555] uppercase tracking-wider">Speed Disch SP</div>
                                <div className="text-[13px] font-bold text-[#4fc3f7]">{unitSpeedDischargeSP[i].toFixed(0)} PSI</div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Per-Well Pressures (from Customer PLC) */}
                    <div className="text-[9px] text-[#49D0E2] uppercase tracking-[0.15em] font-bold mb-2">Static, Casing &amp; Tubing Pressures — Per Well</div>
                    <div className="grid grid-cols-5 gap-2">
                      {liveWellPerformance.map((well, i) => (
                        <div key={i} className="rounded-lg border border-[#1e1e30] bg-[#0a0a14] p-2">
                          <div className="text-[8px] text-[#49D0E2] font-bold uppercase tracking-wider mb-1.5">Well {well.wellNumber}</div>
                          <div className="space-y-1.5">
                            <div>
                              <div className="text-[7px] text-[#555] uppercase tracking-wider">Static</div>
                              <div className="text-[14px] font-black leading-none"
                                style={{ color: well.staticPres != null ? (dischargeTriggerSP != null && well.staticPres >= dischargeTriggerSP ? '#ef4444' : '#22c55e') : '#444', fontFamily: "'Arial Black'" }}>
                                {well.staticPres != null ? well.staticPres.toFixed(0) : '—'}
                              </div>
                              {well.staticPres != null && <div className="text-[7px] text-[#555]">PSI</div>}
                            </div>
                            <div>
                              <div className="text-[7px] text-[#555] uppercase tracking-wider">Casing</div>
                              <div className="text-[14px] font-black leading-none"
                                style={{ color: well.casingPres != null ? '#22c55e' : '#2a2a3a', fontFamily: "'Arial Black'" }}>
                                {well.casingPres != null ? well.casingPres.toFixed(0) : '—'}
                              </div>
                              {well.casingPres != null && <div className="text-[7px] text-[#555]">PSI</div>}
                            </div>
                            <div>
                              <div className="text-[7px] text-[#555] uppercase tracking-wider">Tubing</div>
                              <div className="text-[14px] font-black leading-none"
                                style={{ color: well.tubingPres != null ? '#22c55e' : '#2a2a3a', fontFamily: "'Arial Black'" }}>
                                {well.tubingPres != null ? well.tubingPres.toFixed(0) : '—'}
                              </div>
                              {well.tubingPres != null && <div className="text-[7px] text-[#555]">PSI</div>}
                            </div>
                            {well.diffPres != null && (
                              <div>
                                <div className="text-[7px] text-[#555] uppercase tracking-wider">Diff Prs</div>
                                <div className="text-[12px] font-bold text-white">{well.diffPres.toFixed(0)}</div>
                                <div className="text-[7px] text-[#555]">PSI</div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {dischargeTriggerSP != null && (
                      <div className="mt-2 text-[9px] text-[#555]">
                        Altronic discharge trigger SP: <span className="text-[#4fc3f7] font-bold">{dischargeTriggerSP.toFixed(0)} PSI</span>
                        {' '}— static pressure readings shown in red when at or above trigger
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Well-by-Well Columns (all per-well data stacked) ── */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#49D0E2]" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                    Well-by-Well Status
                  </div>
                  <div className="text-[10px] text-[#555]">
                    Total: <span className="text-white font-bold">{totalActualFlow.toFixed(3)}</span>
                    {totalDesiredSite != null && <span className="text-[#555]"> / {totalDesiredSite.toFixed(3)} MMSCFD desired</span>}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                  {liveWellPerformance.map((well) => {
                    const hasData = well.actual != null
                    const onTarget = well.atTarget
                    const borderColor = !hasData ? '#1a1a2a' : onTarget ? '#1d6c3d' : '#5a3a10'
                    const bgColor = !hasData ? '#0a0a14' : onTarget ? '#071410' : '#130e04'
                    return (
                      <div key={well.wellNumber} className="rounded-xl border p-4 flex flex-col gap-0"
                        style={{ borderColor, background: bgColor }}>
                        {/* Header */}
                        <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: '#49D0E2' }}>
                          Well {well.wellNumber}
                        </div>

                        {/* Actual flow — large */}
                        <div className="mb-1">
                          <div className="text-[24px] font-black leading-none"
                            style={{ color: !hasData ? '#333' : onTarget ? '#22c55e' : '#f59e0b', fontFamily: "'Arial Black'" }}>
                            {hasData ? well.actual.toFixed(3) : 'NO DATA'}
                          </div>
                          {hasData && <div className="text-[9px] mt-0.5" style={{ color: onTarget ? '#4ade80' : '#fbbf24' }}>MMSCFD actual</div>}
                        </div>

                        {/* Desired flow */}
                        {well.desired != null && (
                          <div className="mb-2">
                            <div className="text-[16px] font-black leading-none text-[#4fc3f7]" style={{ fontFamily: "'Arial Black'" }}>
                              {well.desired.toFixed(3)}
                            </div>
                            <div className="text-[9px] text-[#4fc3f7]/70">MMSCFD desired</div>
                          </div>
                        )}

                        {/* Progress bar */}
                        {well.matchPct != null && (
                          <div className="mb-2">
                            <div className="h-2 overflow-hidden rounded-full" style={{ background: '#14202c' }}>
                              <div className="h-full rounded-full transition-all"
                                style={{
                                  width: `${Math.min(100, well.matchPct)}%`,
                                  background: well.matchPct >= 95 ? 'linear-gradient(to right, #22c55e, #4fc3f7)' : '#f59e0b',
                                }} />
                            </div>
                            <div className="text-[9px] text-[#555] mt-0.5">{well.matchPct.toFixed(1)}% of target</div>
                          </div>
                        )}

                        {/* Status */}
                        {hasData && (
                          <div className="text-[14px] font-black mb-3"
                            style={{ color: onTarget ? '#22c55e' : '#f59e0b', fontFamily: "'Arial Black'" }}>
                            {onTarget ? 'ON TARGET' : 'LOW'}
                          </div>
                        )}

                        {/* Divider */}
                        <div className="border-t border-[#1a1a2a] my-2" />

                        {/* Yesterday */}
                        <div className="mb-2">
                          <div className="text-[7px] text-[#555] uppercase tracking-wider">Yesterday</div>
                          <div className="text-[14px] font-black leading-none text-white" style={{ fontFamily: "'Arial Black'" }}>
                            {well.yesterday != null ? well.yesterday.toFixed(3) : '—'}
                          </div>
                          {well.yesterday != null && <div className="text-[8px] text-[#555]">MMSCFD</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* ── Online Indicator ── */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-3 h-3 rounded-full bg-[#22c55e] shadow-lg shadow-[#22c55e]/50" />
                <span className="text-[13px] text-[#22c55e] font-bold">ONLINE — Panel Active</span>
                {panelTime && <span className="text-[10px] text-[#555] ml-auto">Data from: {panelTime.toLocaleString()}</span>}
              </div>

              {/* ── Compressor Units ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {HALFMANN_UNITS.map((u, i) => (
                  <CompressorCard
                    key={u.key}
                    label={u.label}
                    data={unitDataMaps[i]}
                    time={getTimestamp(unitDataRaw[u.key])}
                    desiredFlow={unitDesiredFlows[i]}
                    actualFlow={unitActualFlows[i]}
                    registers={getVisibleCompressorRegisters(unitDataMaps[i], {})}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="px-5 py-3 bg-[#0c0c16] border-t border-[#1a1a2a] text-center shrink-0">
        <span className="text-[9px] text-[#444]">Halfmann 1214 · Read-only public view · Data refreshes every 60 seconds</span>
      </footer>
    </div>
  )
}
