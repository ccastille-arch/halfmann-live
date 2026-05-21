import { useState, useEffect, useCallback } from 'react'
import {
  findRegisterDatapoint,
  getVisibleCompressorRegisters,
  formatLiveRegisterValue,
  getVisibleLiveRegisters,
  loadAwiRegisterCatalog,
  parseLiveDatapoints,
} from '../engine/liveRegisters'

// Public read-only live MLink dashboard — Halfmann 1214 pad — no auth required
// Exact feature parity with PublicLiveView; device IDs swapped for Halfmann devices.

const API_BASE = import.meta.env.VITE_API_URL || ''
const REFRESH_INTERVAL_S = 60 // 1-minute refresh (5 devices, faster than Klondike)

// ─── Halfmann device IDs ───────────────────────────────────────────────────────

const HALFMANN_DEVICES = {
  panel:    '2507-501508', // Halfmann well control panel
  unit2130: '2507-500709', // 2130 Halfmann 1214 01H/02H/03H
  unit2127: '2504-504108', // 2127 Halfmann 1214 01H/02H/03H
  unit2129: '2504-504102', // 2129 Halfmann 1214 01H/02H/03H
  unit2128: '2507-500076', // 2128 Halfmann 1214 01H/02H/03H
}

const HALFMANN_UNITS = [
  { key: 'unit2130', label: 'Unit 2130', deviceId: HALFMANN_DEVICES.unit2130 },
  { key: 'unit2127', label: 'Unit 2127', deviceId: HALFMANN_DEVICES.unit2127 },
  { key: 'unit2129', label: 'Unit 2129', deviceId: HALFMANN_DEVICES.unit2129 },
  { key: 'unit2128', label: 'Unit 2128', deviceId: HALFMANN_DEVICES.unit2128 },
]

// ─── well register key aliases (same naming as Klondike panel) ─────────────────

const LIVE_WELL_FLOW_KEYS = [
  ['Well 1 Injection Gas Flow Rate', 'Well #1 Flow Rate'],
  ['Well 2 Injection Gas Flow Rate', 'Well #2 Flow Rate'],
  ['Well 3 Injection Gas Flow Rate', 'Well #3 Flow Rate'],
  ['Well 4 Injection Gas Flow Rate', 'Well #4 Flow Rate'],
  ['Well 5 Injection Gas Flow Rate', 'Well #5 Flow Rate'],
]

const LIVE_WELL_YESTERDAY_KEYS = [
  ['Wellhead #1 Yesterdays Total Flow', 'Well 1 Yesterdays Total Flow'],
  ['Wellhead #2 Yesterdays Total Flow', 'Well 2 Yesterdays Total Flow'],
  ['Wellhead #3 Yesterdays Total Flow', 'Well 3 Yesterdays Total Flow'],
  ['Wellhead #4 Yesterdays Total Flow', 'Well 4 Yesterdays Total Flow'],
  ['Wellhead #5 Yesterdays Total Flow', 'Well 5 Yesterdays Total Flow'],
]

// ─── fetch helpers ─────────────────────────────────────────────────────────────

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
    if (!res.ok) {
      return { data: null, error: `device ${deviceId}: ${await readErrorPayload(res)}` }
    }
    return { data: await res.json(), error: '' }
  } catch (err) {
    return { data: null, error: `device ${deviceId}: ${err.message}` }
  }
}

// fetchDeviceFull calls /device/full which merges LatestDeviceData (2-sec registers)
// with RunReport data (15-min registers) so fields like desired flows and
// yesterday flows are included even when they aren't in the latest batch.
async function fetchDeviceFull(deviceId) {
  try {
    const res = await fetch(`${API_BASE}/api/mlink/device/full?deviceId=${encodeURIComponent(deviceId)}`)
    if (!res.ok) {
      // Fall back to normal device endpoint if /full fails
      return fetchDevice(deviceId)
    }
    return { data: await res.json(), error: '' }
  } catch (err) {
    return fetchDevice(deviceId)
  }
}

function getTimestamp(data, idx = 0) {
  if (!data?.timestamps?.[idx]) return null
  return new Date(data.timestamps[idx] * 1000)
}

// ─── numeric / display helpers ────────────────────────────────────────────────

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

function formatPercent(value, decimals = 0) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)}%` : '--'
}

function formatFlow(value) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(3)} MMSCFD` : '--'
}

function formatSignedFlow(value) {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value > 0 ? '+' : ''}${value.toFixed(3)} MMSCFD`
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
  if (/stage 3 discharge prs/i.test(label)) return numeric > 900 ? '#E8200C' : '#22c55e'
  if (/stage 1 suction prs/i.test(label)) return numeric < 30 ? '#eab308' : '#22c55e'
  if (/3rd stage discharge temperature/i.test(label)) return numeric > 275 ? '#E8200C' : '#22c55e'
  if (/skid - shutdown/i.test(label)) return numeric > 0 ? '#E8200C' : '#22c55e'
  return '#fff'
}

// ─── sub-components ───────────────────────────────────────────────────────────

function DataPoint({ label, value, unit, color, compact = false }) {
  return (
    <div className={`bg-[#0a0a14] rounded border border-[#2a2a3a] ${compact ? 'p-2' : 'p-2'}`}>
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

function LiveRegisterRow({ label, value, unit }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="text-[8px] text-[#777] leading-tight">{label}</div>
      <div className="text-right">
        <div className="text-[10px] text-white font-bold">{value}</div>
        {unit && <div className="text-[8px] text-[#666]">{unit}</div>}
      </div>
    </div>
  )
}

function WowMetricCard({ label, value, helper, tone }) {
  const tones = {
    green:  'from-[#10311f] to-[#0e1712] border-[#1d6c3d] text-[#5def95]',
    blue:   'from-[#10273d] to-[#0f151d] border-[#275d92] text-[#72c8ff]',
    amber:  'from-[#34260e] to-[#17120d] border-[#8a6421] text-[#f8c767]',
    purple: 'from-[#26183a] to-[#121019] border-[#5c3ea1] text-[#c69bff]',
  }
  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 ${tones[tone] || tones.green}`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">{label}</div>
      <div className="mt-2 text-[28px] font-black leading-none text-white" style={{ fontFamily: "'Arial Black'" }}>
        {value}
      </div>
      <div className="mt-2 text-[11px] leading-relaxed text-white/65">{helper}</div>
    </div>
  )
}

function CompressorCard({ label, data, time, desiredFlow, actualFlow, registers }) {
  const rpm = data['Compressor Speed'] || data['Driver Speed'] || data['RPM']
  const shutdown = data['Skid - Shutdown']
  const isShutdown = shutdown && String(shutdown.value).toLowerCase().includes('shutdown')
  const hasRpm = rpm && parseFloat(rpm.value) > 100
  const hasFlow = actualFlow != null && parseFloat(actualFlow.value) > 0.01
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
        <DataPoint label="Actual Flow" value={actualFlowValue} unit={actualFlow?.units || 'MMSCFD'} color={getCompressorColor('Flow Rate PID PV', actualFlow?.value)} compact />
      </div>
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
      {time && <div className="text-[8px] text-[#444] mt-2 text-right">Updated: {time.toLocaleString()}</div>}
    </div>
  )
}

function LivePerformanceHero({ metrics, wells, timestamp }) {
  const headline = metrics.currentMatch != null && metrics.currentMatch >= 97
    ? 'Running Tight. Running On Target.'
    : metrics.currentMatch != null && metrics.currentMatch >= 93
      ? 'Pad Logic Is Holding This Pad In Tight Balance.'
      : 'Live Field Data Is Tracking In Real Time.'

  return (
    <div className="mb-5 overflow-hidden rounded-2xl border border-[#1c2d21] bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.18),_rgba(8,8,16,0.95)_45%),linear-gradient(135deg,_#10151d,_#090b12)] shadow-[0_0_50px_rgba(34,197,94,0.08)]">
      <div className="grid gap-5 p-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full border border-[#20502d] bg-[#0e1e13] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#66f0a0]">
              Live Performance Proof
            </span>
            {timestamp && <span className="text-[10px] text-[#6b7280]">Snapshot {timestamp.toLocaleString()}</span>}
          </div>
          <div className="text-[12px] font-bold uppercase tracking-[0.2em] text-[#ff6b57]">
            Does your SCADA do this?
          </div>
          <h2 className="text-[30px] font-black leading-none text-white" style={{ fontFamily: "'Arial Black'" }}>
            {headline}
          </h2>
          <p className="mt-2 max-w-[680px] text-[13px] leading-relaxed text-[#a0a7b5]">
            This is actual live data from a running location right now. See how tightly this pad is operating:
            actual well injection riding on top of desired injection, compressors carrying commanded flow, and
            the historical time spent below target exposed in plain sight.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            <WowMetricCard
              label="Live Injection Match"
              value={formatPercent(metrics.currentMatch, 1)}
              tone="green"
              helper={metrics.totalDesired ? `${metrics.totalActual?.toFixed(3)} actual vs ${metrics.totalDesired.toFixed(3)} desired` : 'Waiting on desired-rate tags'}
            />
            <WowMetricCard
              label="Wells On Target"
              value={metrics.wellsAtTarget != null ? `${metrics.wellsAtTarget}/${wells.length}` : '--'}
              tone="blue"
              helper={metrics.wellsAtTarget != null ? 'Within 5% of desired injection' : 'Per-well targets not in API feed'}
            />
            <WowMetricCard
              label="30-Day Under Target"
              value={formatPercent(metrics.historicalUnderTarget, 1)}
              tone={metrics.historicalUnderTarget != null && metrics.historicalUnderTarget <= 8 ? 'green' : 'amber'}
              helper={metrics.historicalUnderTarget != null ? 'Time spent not meeting desired injection' : 'No 30-day history available for this pad'}
            />
            <WowMetricCard
              label="Compressor Flow Match"
              value={formatPercent(metrics.compressorMatch, 1)}
              tone="purple"
              helper="Desired flow vs actual compressor flow"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-[#1c2836] bg-[#0a0f17]/90 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9db2ce]">Actual vs Desired By Well</span>
            <span className="text-[10px] text-[#5e6b80]">Live target tracking</span>
          </div>
          <div className="space-y-3">
            {wells.map((well) => (
              <div key={well.wellNumber} className="rounded-xl border border-[#15202d] bg-[#0b1119] p-3">
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-bold text-white">Well {well.wellNumber}</span>
                    {well.desired != null && (
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${well.atTarget ? 'bg-[#0d2d18] text-[#58e68f]' : 'bg-[#33260c] text-[#f7c65d]'}`}>
                        {well.atTarget ? 'On Target' : 'Chasing'}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[#8d97a8]">{formatPercent(well.matchPct, 1)} match</span>
                </div>
                <div className={`gap-3 text-[11px] ${well.desired != null ? 'grid grid-cols-[1fr_auto_auto]' : 'flex items-center'}`}>
                  {well.desired != null && (
                    <div className="pt-1">
                      <div className="h-2 overflow-hidden rounded-full bg-[#14202c]">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#22c55e] to-[#4fc3f7]" style={{ width: `${Math.max(0, Math.min(100, well.matchPct ?? 0))}%` }} />
                      </div>
                    </div>
                  )}
                  <span className="font-bold text-[#22c55e]">{formatFlow(well.actual)}</span>
                  {well.desired != null && <span className="text-[#8d97a8]">of {formatFlow(well.desired)}</span>}
                </div>
                {well.desired != null && (
                  <div className="mt-1 text-[10px] text-[#697386]">
                    Gap {formatSignedFlow(well.gap)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function RefreshCountdown({ secondsLeft, loading, onRefresh }) {
  const pct = Math.round((secondsLeft / REFRESH_INTERVAL_S) * 100)
  return (
    <button
      onClick={onRefresh}
      disabled={loading}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#2a2a3a] bg-[#111120] hover:bg-[#1a1a2a] disabled:opacity-50 transition-colors"
      title="Click to refresh now"
    >
      <svg width="16" height="16" viewBox="0 0 36 36" className="shrink-0 -rotate-90">
        <circle cx="18" cy="18" r="15" fill="none" stroke="#1a2a1a" strokeWidth="3" />
        <circle
          cx="18" cy="18" r="15" fill="none" stroke="#22c55e" strokeWidth="3"
          strokeDasharray={`${2 * Math.PI * 15}`}
          strokeDashoffset={`${2 * Math.PI * 15 * (1 - pct / 100)}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <span className="text-[10px] text-[#888]">
        {loading ? 'Loading…' : `Refreshes in ${secondsLeft}s`}
      </span>
    </button>
  )
}

// ─── Alert badge ──────────────────────────────────────────────────────────────

function AlertBadge({ label, status, value }) {
  const c = status === 'pass'
    ? { bg: '#0a1f0a', border: '#22c55e44', text: '#22c55e', icon: '✓' }
    : status === 'fail'
    ? { bg: '#1f0a0a', border: '#ef444444', text: '#ef4444', icon: '✗' }
    : { bg: '#0c0c14', border: '#2a2a3a', text: '#444', icon: '—' }
  return (
    <div
      className="rounded-lg p-2.5 flex flex-col gap-1 min-w-0"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[8px] text-[#666] uppercase tracking-wider leading-tight truncate">{label}</span>
        <span className="text-[13px] font-black shrink-0" style={{ color: c.text, fontFamily: "'Arial Black', sans-serif" }}>{c.icon}</span>
      </div>
      <div className="text-[9px] font-bold truncate" style={{ color: c.text, fontFamily: "'Arial Black', sans-serif" }}>
        {value || '—'}
      </div>
    </div>
  )
}

// ─���─ main component ────────────────────────────────────────────────────────────

export default function HalfmannLiveView() {
  const [panelData, setPanelData] = useState(null)
  const [unitDataRaw, setUnitDataRaw] = useState({ unit2130: null, unit2127: null, unit2129: null, unit2128: null })
  const [registerCatalog, setRegisterCatalog] = useState([])
  const [loading, setLoading] = useState(true)
  const [liveError, setLiveError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_S)
  const [padVisible, setPadVisible] = useState(true)

  // ─── pad visibility gate (non-admins see "not available" if hidden) ────���─────
  useEffect(() => {
    fetch(`${API_BASE}/api/public/pad-visibility`)
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (body && body.halfmann === false) setPadVisible(false) })
      .catch(() => {})
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLiveError('')
    const [panelResult, ...unitResults] = await Promise.all([
      fetchDeviceFull(HALFMANN_DEVICES.panel),  // use /full to get 15-min registers too
      ...HALFMANN_UNITS.map(u => fetchDeviceFull(u.deviceId)),
    ])
    setPanelData(panelResult.data)
    const newUnitData = {}
    HALFMANN_UNITS.forEach((u, i) => { newUnitData[u.key] = unitResults[i].data })
    setUnitDataRaw(newUnitData)

    const allErrors = [panelResult.error, ...unitResults.map(r => r.error)].filter(Boolean)
    const allNull = !panelResult.data && unitResults.every(r => !r.data)
    if (allNull) {
      setLiveError(allErrors.length > 0
        ? `No live MLINK data available right now. ${allErrors.join(' | ')}`
        : 'No live MLINK data available right now. Check field comms.')
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

  // ─── derived data ───────────────────────────────────────────────────────────
  const panel = parseLiveDatapoints(panelData)
  const panelTime = getTimestamp(panelData)

  // Parse each unit into a dataMap
  const unitDataMaps = HALFMANN_UNITS.map(u => parseLiveDatapoints(unitDataRaw[u.key]))

  // Compressor desired/actual flow — check panel first (it may carry the SP), then the unit itself
  const unitDesiredFlows = HALFMANN_UNITS.map((u, i) =>
    resolvePreferredDatapoint(panel, [
      `Compressor #${i + 1} Desire Flow SP For PID Murphy`,
      `Compressor ${i + 1} Desire Flow SP For PID Murphy`,
      `Compressor #${i + 1} Desired Flow SP For PID Murphy`,
    ]) ??
    resolvePreferredDatapoint(unitDataMaps[i], [
      'Compressor #1 Desire Flow SP For PID Murphy',
      'Desire Flow SP For PID Murphy',
      'Desired Flow SP For PID Murphy',
      'Flow Rate PID SP',
    ])
  )
  const unitActualFlows = unitDataMaps.map(dataMap =>
    resolvePreferredDatapoint(dataMap, [
      'Flow Rate PID PV',
      'Flow Rate PV',
      'Flow PID PV',
      'Compressor Flow Rate PID PV',
    ])
  )

  const visibleRegisters = getVisibleLiveRegisters(panel, registerCatalog, {})
  const hourMeterRegister = visibleRegisters.find(meta => meta.label === 'Hour Meter')
  const additionalWellRegisters = LIVE_WELL_FLOW_KEYS.map((_, index) =>
    visibleRegisters.filter(meta => (
      meta.groupId === `well-${index + 1}`
      && !meta.label.endsWith('Injection Gas Flow Rate')
      && !meta.label.endsWith('Yesterdays Flow')
    ))
  )

  // Per-well injection performance
  const liveWellPerformance = LIVE_WELL_FLOW_KEYS.map((keys, index) => {
    const wellNumber = index + 1
    const actual = parseLiveNumeric(resolvePreferredDatapoint(panel, keys)?.value)
    const desiredDatapoint = resolvePreferredDatapoint(panel, [
      `Wellhead #${wellNumber} Injection Flow Rate From Customer PLC`,
      `Well ${wellNumber} Injection Flow Rate From Customer PLC`,
      `Wellhead #${wellNumber} Calculated Desired Flow`,
      `Wellhead #${wellNumber} Setpoint From Customer PLC`,
      `Well ${wellNumber} Calculated Desired Flow`,
      `Well ${wellNumber} Setpoint From Customer PLC`,
    ])
    const desired = parseLiveNumeric(desiredDatapoint?.value) ?? null
    const gap = actual != null && desired != null ? actual - desired : null
    return {
      wellNumber,
      actual,
      desired,
      gap,
      matchPct: computeMatchPct(actual, desired),
      atTarget: isWithinTarget(actual, desired),
    }
  })

  // Compressor performance per unit
  const liveUnitPerformance = unitDesiredFlows.map((desiredDp, i) => ({
    desired: parseLiveNumeric(desiredDp?.value),
    actual: parseLiveNumeric(unitActualFlows[i]?.value),
  }))

  // Halfmann panel publishes site-level desired flow and wells-meeting-rate directly
  const totalDesiredSite = parseLiveNumeric(
    resolvePreferredDatapoint(panel, ['Total Desired Site Flow'])?.value
  )
  const wellsMeetingRateRaw = resolvePreferredDatapoint(panel, ['Wells Meeting Rate', 'All Wells Meeting Rate'])
  const wellsMeetingRate = wellsMeetingRateRaw != null
    ? Math.round(parseLiveNumeric(wellsMeetingRateRaw.value) ?? 0)
    : null
  const totalActualFlow = liveWellPerformance.reduce((sum, w) => sum + (w.actual ?? 0), 0)
  const padMatchPct = totalDesiredSite != null && totalDesiredSite > 0
    ? Math.max(0, 100 - (Math.abs(totalActualFlow - totalDesiredSite) / totalDesiredSite) * 100)
    : null

  const validWells = liveWellPerformance.filter(w => w.actual != null && w.desired != null)
  const perWellTarget = totalDesiredSite != null && liveWellPerformance.length > 0
    ? totalDesiredSite / liveWellPerformance.length
    : null
  const wellsAtTargetCount = wellsMeetingRate
    ?? (validWells.length > 0 ? validWells.filter(w => w.atTarget).length : null)
    ?? (perWellTarget != null
      ? liveWellPerformance.filter(w => w.actual != null && isWithinTarget(w.actual, perWellTarget)).length
      : null)
  const wowMetrics = {
    totalActual:  totalActualFlow,
    totalDesired: totalDesiredSite,
    currentMatch: padMatchPct,
    wellsAtTarget: wellsAtTargetCount,
    historicalAtTarget: null,
    historicalUnderTarget: null,
    compressorMatch: average(liveUnitPerformance.map(u => computeMatchPct(u.actual, u.desired))),
  }

  // ── Alert data ──────────────────────────────────────────────────────────────

  // Recycle valve
  const recycleVal = getNumeric(panel, [
    'Recycle Valve Position', 'Recycle Valve', 'Recycle Valve %',
    'Recirc Valve Position', 'Recirc Valve %',
    'Station Recycle Valve Position', 'Station Recycle Valve', 'RCV Position',
  ])

  // Per-well pressures
  const wellCasingPres = LIVE_WELL_FLOW_KEYS.map((_, i) => {
    const n = i + 1
    return getNumeric(panel, [
      `Well ${n} Casing Pressure`, `Well #${n} Casing Pressure`,
      `Wellhead #${n} Casing Pressure`, `Wellhead ${n} Casing Pressure`,
    ])
  })
  const wellTubingPres = LIVE_WELL_FLOW_KEYS.map((_, i) => {
    const n = i + 1
    return getNumeric(panel, [
      `Well ${n} Tubing Pressure`, `Well #${n} Tubing Pressure`,
      `Wellhead #${n} Tubing Pressure`, `Wellhead ${n} Tubing Pressure`,
    ])
  })
  const wellStaticPres = LIVE_WELL_FLOW_KEYS.map((_, i) => {
    const n = i + 1
    return getNumeric(panel, [
      `Wellhead #${n} Injection Static Pressure From Customer PLC`,
      `Well ${n} Injection Static Pressure`, `Well #${n} Injection Static Pressure`,
      `Wellhead #${n} Injection Static Pressure`, `Well ${n} Static Pressure`,
    ])
  })

  // Discharge trigger setpoint from panel — try all known name variants
  const dischargeTriggerSP = getNumeric(panel, [
    'Altronic Discharge Pressure Trigger', 'Discharge Pressure Trigger Setpoint',
    'Discharge Trigger Setpoint', 'Discharge Trigger', 'Altronic Discharge SP',
    'Speed Auto Discharge SP', 'Discharge SP',
  ])

  // Speed Control SP per compressor from unit devices
  const compSpeedControlSP = unitDataMaps.map(dataMap =>
    getNumeric(dataMap, ['Speed Control SP', 'Altronic Speed Control SP', 'Speed Auto Discharge SP', 'Discharge Pressure SP', 'Speed SP'])
  )

  // ── Alert statuses (pass / fail / gray) ─────────────────────────────────────
  const alertRecycle = recycleVal == null ? 'gray' : recycleVal > 0 ? 'fail' : 'pass'

  const alertWellFlow = liveWellPerformance.map(w => {
    if (w.actual == null) return 'gray'
    const target = w.desired ?? perWellTarget
    if (target == null || target <= 0) return 'gray'
    return ((target - w.actual) / target) <= 0.05 ? 'pass' : 'fail'
  })

  const alertStaticVsDischarge = dischargeTriggerSP == null ? 'gray'
    : wellStaticPres.some(p => p != null && p >= dischargeTriggerSP) ? 'fail' : 'pass'

  const alertSpeedControlSP = (() => {
    if (compSpeedControlSP.every(v => v == null)) return 'gray'
    const anyTriggered = unitDataMaps.some((dataMap, i) => {
      const dischPrs = getNumeric(dataMap, ['Stage 3 Discharge Prs', 'Discharge Pressure'])
      const sp = compSpeedControlSP[i]
      return sp != null && dischPrs != null && Math.abs(sp - dischPrs) < 10
    })
    return anyTriggered ? 'fail' : 'pass'
  })()

  const alertSiteFlow = totalDesiredSite == null || totalDesiredSite === 0 ? 'gray'
    : ((totalDesiredSite - totalActualFlow) / totalDesiredSite) <= 0.05 ? 'pass' : 'fail'

  const alertWellPres = LIVE_WELL_FLOW_KEYS.map((_, i) => {
    if (dischargeTriggerSP == null) return 'gray'
    const casing = wellCasingPres[i], tubing = wellTubingPres[i]
    if (casing == null && tubing == null) return 'gray'
    return (casing != null && casing >= dischargeTriggerSP) || (tubing != null && tubing >= dischargeTriggerSP)
      ? 'fail' : 'pass'
  })

  // ─── not available gate ───────────────────────────────────────────────────────
  if (!padVisible) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080810]">
        <div className="text-center">
          <div className="text-[15px] text-[#888]">This page is not currently available.</div>
        </div>
      </div>
    )
  }

  // ─── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen bg-[#080810]">
      <header className="flex items-center justify-between px-5 py-3 bg-[#0c0c16] border-b border-[#1a1a2a] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e] shadow-lg shadow-[#22c55e]/60 animate-pulse" />
          <div>
            <div className="text-[13px] text-white font-bold" style={{ fontFamily: "'Arial Black'" }}>
              Live Field Data — Halfmann 1214
            </div>
            <div className="text-[10px] text-[#666]">
              Active Pad Logic panel · read-only public view
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-[9px] text-[#555] hidden sm:inline">
              Last update: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <RefreshCountdown secondsLeft={countdown} loading={loading} onRefresh={refresh} />
        </div>
      </header>

      <div className="flex-1 overflow-auto p-5 sm:p-6">
        <div className="max-w-[1280px] mx-auto">
          {loading && !panelData ? (
            <div className="text-center py-24 text-[#888] text-sm">Connecting to field units…</div>
          ) : (
            <>
              {liveError && (
                <div className="mb-4 rounded-lg border border-[#5a1d1d] bg-[#1f0c0c] px-4 py-3 text-[11px] text-[#fca5a5]">
                  {liveError}
                </div>
              )}

              <LivePerformanceHero metrics={wowMetrics} wells={liveWellPerformance} timestamp={panelTime} />

              {/* ─── Site Alerts & Status ─────────────────────────────────── */}
              <div style={{ background: '#0c0c16', border: '1px solid #1a1a2a', borderRadius: '12px', padding: '16px 20px', marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: '#49D0E2', marginBottom: '14px', fontFamily: "'Montserrat', sans-serif" }}>
                  Site Alerts &amp; Status
                </div>

                {/* Site-level */}
                <div style={{ fontSize: '9px', color: '#49D0E2', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, marginBottom: '8px' }}>Site</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  <AlertBadge label="Recycle Valve" status={alertRecycle}
                    value={recycleVal != null ? `${recycleVal.toFixed(1)}%` : '—'} />
                  <AlertBadge label="Site Flow Match" status={alertSiteFlow}
                    value={totalDesiredSite != null ? `${totalActualFlow.toFixed(3)} / ${totalDesiredSite.toFixed(3)} MMSCFD` : '—'} />
                  <AlertBadge label="Static vs Discharge" status={alertStaticVsDischarge}
                    value={dischargeTriggerSP != null ? `Trigger: ${dischargeTriggerSP.toFixed(0)} PSI` : '—'} />
                  <AlertBadge label="Speed Control SP" status={alertSpeedControlSP}
                    value={compSpeedControlSP.some(v => v != null)
                      ? compSpeedControlSP.map((v, i) => v != null ? `C${i+1}: ${v.toFixed(0)}` : null).filter(Boolean).join('  ')
                      : '—'} />
                </div>

                {/* Per-well flow */}
                <div style={{ fontSize: '9px', color: '#49D0E2', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, marginBottom: '8px' }}>Per-Well Flow (≥95% of Target)</div>
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {liveWellPerformance.map((w, i) => (
                    <AlertBadge key={i} label={`Well #${i+1} Flow`} status={alertWellFlow[i]}
                      value={w.actual != null ? `${w.actual.toFixed(3)} MMSCFD` : '—'} />
                  ))}
                </div>

                {/* Per-well pressure */}
                <div style={{ fontSize: '9px', color: '#49D0E2', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, marginBottom: '8px' }}>Per-Well Casing / Tubing vs Discharge</div>
                <div className="grid grid-cols-5 gap-2">
                  {LIVE_WELL_FLOW_KEYS.map((_, i) => (
                    <AlertBadge key={i} label={`Well #${i+1} Pressure`} status={alertWellPres[i]}
                      value={wellCasingPres[i] != null ? `C: ${wellCasingPres[i].toFixed(0)} PSI` : wellTubingPres[i] != null ? `T: ${wellTubingPres[i].toFixed(0)} PSI` : '—'} />
                  ))}
                </div>
              </div>

              {/* Surface Equipment */}
              {recycleVal != null && (
                <div className="bg-[#111118] rounded-xl border border-[#222] px-5 py-3 mb-4 flex items-center gap-6">
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#49D0E2] shrink-0">Surface Equipment</span>
                  <DataPoint
                    label="Recycle Valve Position"
                    value={`${recycleVal.toFixed(1)}%`}
                    color={recycleVal > 0 ? '#E8200C' : '#22c55e'}
                  />
                </div>
              )}

              {/* Panel status bar */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-3 h-3 rounded-full bg-[#22c55e] shadow-lg shadow-[#22c55e]/50" />
                <span className="text-[13px] text-[#22c55e] font-bold">ONLINE — Panel Active</span>
                <div className="ml-auto flex items-center gap-3">
                  <span className="rounded-full border border-[#2f2f40] bg-[#111120] px-2 py-0.5 text-[8px] uppercase tracking-[0.18em] text-[#777]">
                    Hour Meter <span className="ml-1 text-[10px] text-white font-bold normal-case tracking-normal">
                      {formatHourMeterValue(hourMeterRegister?.datapoint?.value ?? panel['\t Hour Meter']?.value ?? panel['Hour Meter']?.value)}
                    </span>
                  </span>
                  {panelTime && <span className="text-[10px] text-[#555]">Data from: {panelTime.toLocaleString()}</span>}
                </div>
              </div>

              {/* Well Injection Flow Rates */}
              <div className="bg-[#111118] rounded-xl border border-[#222] p-5 mb-4">
                <h2 className="text-sm text-white font-bold mb-4" style={{ fontFamily: "'Arial Black'" }}>
                  Well Injection Flow Rates
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  {LIVE_WELL_FLOW_KEYS.map((keys, i) => {
                    const dp = resolvePreferredDatapoint(panel, keys)
                    const val = dp ? parseFloat(dp.value) : null
                    const yesterdayDp = resolvePreferredDatapoint(panel, LIVE_WELL_YESTERDAY_KEYS[i])
                    const yesterdayVal = yesterdayDp ? parseFloat(yesterdayDp.value) : null
                    const maxFlow = 1.2
                    const widthPct = val != null && !Number.isNaN(val) ? Math.max(0, Math.min(100, (val / maxFlow) * 100)) : 0
                    return (
                      <div key={i} className="bg-[#0a0a14] rounded-lg border border-[#2a2a3a] p-4 text-center">
                        <div className="text-[10px] text-[#888] mb-1">Well {i + 1}</div>
                        <div className="text-2xl text-[#22c55e] font-bold mb-2" style={{ fontFamily: "'Arial Black'" }}>
                          {val != null && !Number.isNaN(val) ? val.toFixed(3) : '--'}
                        </div>
                        <div className="text-[9px] text-[#888]">MMSCFD</div>
                        <div className="w-full bg-[#1a1a2a] rounded h-2 mt-2 overflow-hidden">
                          <div className="h-full bg-[#22c55e] rounded transition-all" style={{ width: `${widthPct}%` }} />
                        </div>
                        <div className="mt-3 pt-2 border-t border-[#1a1a2a]">
                          <div className="text-[8px] text-[#666] uppercase tracking-wider">Yesterday Flow</div>
                          <div className="text-[12px] text-white font-bold mt-0.5" style={{ fontFamily: "'Arial Black'" }}>
                            {yesterdayVal != null && !Number.isNaN(yesterdayVal) ? yesterdayVal.toFixed(3) : '--'}
                          </div>
                          <div className="text-[8px] text-[#666]">MMSCFD</div>
                        </div>
                        {additionalWellRegisters[i].length > 0 && (
                          <div className="mt-3 pt-2 border-t border-[#1a1a2a] space-y-1.5 text-left">
                            {additionalWellRegisters[i].map(meta => (
                              <LiveRegisterRow
                                key={meta.id}
                                label={meta.label}
                                value={formatLiveRegisterValue(meta, meta.datapoint)}
                                unit={meta.datapoint.units}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 text-center">
                  <span className="text-[#888] text-[11px]">Total Injection: </span>
                  <span className="text-white font-bold text-[14px]" style={{ fontFamily: "'Arial Black'" }}>
                    {LIVE_WELL_FLOW_KEYS.reduce((sum, keys) => {
                      const dp = resolvePreferredDatapoint(panel, keys)
                      return sum + (dp ? parseFloat(dp.value) || 0 : 0)
                    }, 0).toFixed(3)} MMSCFD
                  </span>
                </div>
              </div>

              {/* Compression Units — 2×2 grid for all 4 Halfmann units */}
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

      <footer className="px-5 py-3 bg-[#0c0c16] border-t border-[#1a1a2a] text-center">
        <span className="text-[9px] text-[#444]">WellLogic™ Simulator · Halfmann 1214 · Read-only public view · Data refreshes every 60 seconds</span>
      </footer>
    </div>
  )
}
