import { useState, useEffect, useCallback } from 'react'
import {
  findRegisterDatapoint,
  getVisibleCompressorRegisters,
  formatLiveRegisterValue,
  getVisibleLiveRegisters,
  loadAwiRegisterCatalog,
  parseLiveDatapoints,
} from '../engine/liveRegisters'
import { PANEL_ADDRESSES, UNIT_ADDRESSES, getNumericByAddress as sharedGetNumericByAddress, resolveDatapointByAddress as sharedResolveDatapointByAddress } from '../engine/halfmannRegisters'
import { useHalfmannData } from '../context/HalfmannDataContext'

const API_BASE = import.meta.env.VITE_API_URL || ''
const REFRESH_INTERVAL_S = 3
const NOT_PUBLISHED_COPY = 'Not published by current MLink feed'

const HALFMANN_DEVICES = {
  panel:    '2507-501508',
  unit2130: '2507-500709',
  unit2127: '2504-504108',
  unit2129: '2504-504102',
  unit2128: '2507-500076',
  unit1396: '2507-501442',
}

const HALFMANN_UNITS = [
  { key: 'unit2130', label: 'Unit 2130', deviceId: HALFMANN_DEVICES.unit2130 },
  { key: 'unit2127', label: 'Unit 2127', deviceId: HALFMANN_DEVICES.unit2127 },
  { key: 'unit2128', label: 'Unit 2128', deviceId: HALFMANN_DEVICES.unit2128 },
  { key: 'unit2129', label: 'Unit 2129', deviceId: HALFMANN_DEVICES.unit2129 },
  { key: 'unit1396', label: 'Unit 1396 (Standby)', deviceId: HALFMANN_DEVICES.unit1396, standby: true },
]

const LIVE_WELL_FLOW_KEYS = [
  ['Well 1 Injection Gas Flow Rate', 'Well #1 Flow Rate'],
  ['Well 2 Injection Gas Flow Rate', 'Well #2 Flow Rate'],
  ['Well 3 Injection Gas Flow Rate', 'Well #3 Flow Rate'],
  ['Well 4 Injection Gas Flow Rate', 'Well #4 Flow Rate'],
  ['Well 5 Injection Gas Flow Rate', 'Well # 5 Flow Rate', 'Well #5 Flow Rate'],
]
const LIVE_WELL_DISPLAY_NAMES = ['214', '444', '334', '213', '333']
const LIVE_WELL_FLOW_ADDRESSES = PANEL_ADDRESSES.wellFlow
const LIVE_WELL_SETPOINT_ADDRESSES = PANEL_ADDRESSES.wellSetpoint
const LIVE_WELL_CALCULATED_DESIRED_ADDRESSES = PANEL_ADDRESSES.wellCalculatedDesiredFlow
const LIVE_WELL_STATIC_ADDRESSES = PANEL_ADDRESSES.wellStaticPressure
const LIVE_WELL_DIFF_ADDRESSES = PANEL_ADDRESSES.wellDifferentialPressure
const LIVE_WELL_CASING_ADDRESSES = PANEL_ADDRESSES.wellCasingPressure
const LIVE_WELL_TUBING_ADDRESSES = PANEL_ADDRESSES.wellTubingPressure
const LIVE_WELL_OIL_PRIORITY_ADDRESSES = ['461036', '461038', '461040', '461042', '461044']

const LIVE_WELL_YESTERDAY_KEYS = [
  ["Wellhead #1 Yesterday's Total Flow", 'Wellhead #1 Yesterdays Total Flow', "Well 1 Yesterday's Total Flow", 'Well 1 Yesterdays Total Flow'],
  ["Wellhead #2 Yesterday's Total Flow", 'Wellhead #2 Yesterdays Total Flow', "Well 2 Yesterday's Total Flow", 'Well 2 Yesterdays Total Flow'],
  ["Wellhead #3 Yesterday's Total Flow", 'Wellhead #3 Yesterdays Total Flow', "Well 3 Yesterday's Total Flow", 'Well 3 Yesterdays Total Flow'],
  ["Wellhead #4 Yesterday's Total Flow", 'Wellhead #4 Yesterdays Total Flow', "Well 4 Yesterday's Total Flow", 'Well 4 Yesterdays Total Flow'],
  ["Wellhead #5 Yesterday's Total Flow", 'Wellhead #5 Yesterdays Total Flow', "Well 5 Yesterday's Total Flow", 'Well 5 Yesterdays Total Flow'],
]

const LIVE_WELL_YESTERDAY_ADDRESSES = PANEL_ADDRESSES.wellYesterdayFlow

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

function parsePercentNumeric(value) {
  if (value == null) return null
  const direct = Number(value)
  if (Number.isFinite(direct)) return direct
  const match = String(value).match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const numeric = Number(match[0])
  return Number.isFinite(numeric) ? numeric : null
}

function resolvePreferredDatapoint(dataMap, labels) {
  for (const label of labels) {
    const datapoint = findRegisterDatapoint(dataMap, { label, decimals: 3 })
    if (datapoint) return datapoint
  }
  return null
}

function resolveDatapointByAddress(data, addresses) { return sharedResolveDatapointByAddress(data, addresses) }

function isFallbackCacheDatapoint(data, datapoint) {
  return getSourceState(data, 'dashboardSnapshot') === 'fallback-cache' && datapoint?._source === 'dashboardSnapshot'
}

function resolveFreshDatapointByAddress(data, addresses) {
  const datapoint = resolveDatapointByAddress(data, addresses)
  return isFallbackCacheDatapoint(data, datapoint) ? null : datapoint
}

function resolvePreferredFreshDatapoint(data, dataMap, labels) {
  const datapoint = resolvePreferredDatapoint(dataMap, labels)
  return isFallbackCacheDatapoint(data, datapoint) ? null : datapoint
}

function getNumeric(dataMap, labels) {
  return parseLiveNumeric(resolvePreferredDatapoint(dataMap, labels)?.value)
}

function getNumericByAddress(data, addresses) { return sharedGetNumericByAddress(data, addresses) }

function getFreshNumericByAddress(data, addresses) {
  return parseLiveNumeric(resolveFreshDatapointByAddress(data, addresses)?.value)
}

function getFreshNumeric(data, dataMap, labels) {
  return parseLiveNumeric(resolvePreferredFreshDatapoint(data, dataMap, labels)?.value)
}

function parsePanelBooleanValue(raw) {
  if (raw == null) return null
  const normalized = String(raw).trim().toLowerCase()
  if (normalized === 'yes' || normalized === 'yes (1)' || normalized === 'yes (2)' || normalized === '1' || normalized === '2' || normalized === 'true') return true
  if (normalized === 'no' || normalized === 'no (0)' || normalized === '0' || normalized === 'false') return false
  return null
}

function getPanelCompressorMeetingSignals(data, dataMap) {
  const directFlags = [420014, 420015, 420029, 420030]
    .map((address) => parsePanelBooleanValue(resolveDatapointByAddress(data, [address])?.value))
    .filter((value) => value != null)

  const aggregateMeetingValue = resolveDatapointByAddress(data, [420013])?.value ?? resolvePreferredDatapoint(dataMap, [
    'Meeting Flow Demand',
    'Compressors Meeting Desired Flow',
  ])?.value
  const aggregateMeeting = parsePanelBooleanValue(aggregateMeetingValue)

  const anyNotMeetingValue = resolveDatapointByAddress(data, [PANEL_ADDRESSES.anyCompressorNotMeetingDesiredFlow])?.value ?? resolvePreferredDatapoint(dataMap, [
    'Any Compressor Not Meeting Desired Flow',
  ])?.value
  const anyNotMeeting = parsePanelBooleanValue(anyNotMeetingValue)

  const broadSummaryValue = resolveDatapointByAddress(data, [PANEL_ADDRESSES.compressorsMeetingFlowDemand])?.value ?? resolvePreferredDatapoint(dataMap, [
    'Compressors Meeting Flow Demand',
    'Compressor Meeting Flow Demand',
  ])?.value
  const broadSummary = parsePanelBooleanValue(broadSummaryValue)

  const perCompressor = directFlags.length === 4 ? directFlags.every(Boolean) : null
  const inverseAnyNotMeeting = anyNotMeeting == null ? null : !anyNotMeeting
  const effective = perCompressor ?? aggregateMeeting ?? inverseAnyNotMeeting ?? broadSummary

  return {
    effective,
    perCompressor,
    aggregateMeeting,
    inverseAnyNotMeeting,
    broadSummary,
    directFlags,
  }
}

function getWellSetpointInfo(data, dataMap, wellNumber) {
  const customerTargetDatapoint = resolveFreshDatapointByAddress(data, [LIVE_WELL_SETPOINT_ADDRESSES[wellNumber - 1]]) ?? resolvePreferredFreshDatapoint(data, dataMap, [
    `Wellhead #${wellNumber} Setpoint From Customer PLC`,
    `Well ${wellNumber} Setpoint From Customer PLC`,
    `Well ${wellNumber} Setpoint`,
  ])
  const customerTargetValue = parseLiveNumeric(customerTargetDatapoint?.value)
  if (customerTargetValue != null) return { value: customerTargetValue, source: 'live' }
  return { value: null, source: null }
}

function getWellCalculatedDesiredFlow(data, dataMap, wellNumber) {
  return getFreshNumericByAddress(data, [LIVE_WELL_CALCULATED_DESIRED_ADDRESSES[wellNumber - 1]]) ?? parseLiveNumeric(resolvePreferredFreshDatapoint(data, dataMap, [
    `Wellhead #${wellNumber} Calculated Desired Flow`,
    `Well ${wellNumber} Calculated Desired Flow`,
  ])?.value)
}

function getUnitDesiredFlowDatapoint(panelData, panelDataMap, unitData, unitDataMap, unitKey, unitLabel) {
  const compNum = { unit2128: 1, unit2130: 2, unit2127: 3, unit2129: 4 }[unitKey]
  const unitNum = unitLabel.match(/\d{4}/)?.[0]
  return resolveFreshDatapointByAddress(panelData, [PANEL_ADDRESSES.unitDesiredFlowSetpoints[compNum - 1]]) ?? resolvePreferredFreshDatapoint(panelData, panelDataMap, [
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
  ]) ?? resolvePreferredDatapoint(unitDataMap, [
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

function getUnitActualFlowDatapoint(data, dataMap) {
  return resolveDatapointByAddress(data, UNIT_ADDRESSES.actualFlow) ?? resolvePreferredDatapoint(dataMap, [
    'Flow Rate',
    'Flow Rate PID PV',
    'Flow Rate PV',
    'Flow PID PV',
    'Compressor Flow Rate PID PV',
    'Stage 3 Flow Rate',
  ])
}

function computeMatchPct(actual, desired) {
  if (actual == null || desired == null || desired <= 0) return null
  if (actual >= desired) return 100
  return Math.max(0, (actual / desired) * 100)
}

function isWithinTarget(actual, desired) {
  if (actual == null || desired == null || desired <= 0) return false
  return actual >= desired * 0.95
}

function average(values) {
  const valid = values.filter(v => v != null && Number.isFinite(v))
  if (!valid.length) return null
  return valid.reduce((sum, v) => sum + v, 0) / valid.length
}

function parseLeadingCount(value) {
  if (value == null) return null
  const match = String(value).match(/-?\d+/)
  if (!match) return null
  const numeric = Number(match[0])
  return Number.isFinite(numeric) ? numeric : null
}

function deriveMissingCompressorFlowDatapoints(unitDatapoints, totalActualFlow, units) {
  if (totalActualFlow == null || !Number.isFinite(totalActualFlow)) return unitDatapoints
  const numericFlows = unitDatapoints.map(dp => parseLiveNumeric(dp?.value))
  const activeIndexes = units.map((unit, index) => (!unit.standby ? index : null)).filter(index => index != null)
  const missingIndexes = activeIndexes.filter(index => numericFlows[index] == null)
  if (missingIndexes.length !== 1) return unitDatapoints

  const knownSum = activeIndexes.reduce((sum, index) => sum + (numericFlows[index] ?? 0), 0)
  const derivedFlow = totalActualFlow - knownSum
  if (!Number.isFinite(derivedFlow) || derivedFlow <= 0.01) return unitDatapoints

  const next = [...unitDatapoints]
  next[missingIndexes[0]] = {
    value: derivedFlow.toFixed(3),
    units: 'MMSCFD',
    alias: 'Derived Site Balance Flow',
    desc: 'Derived Site Balance Flow',
    keyUsed: 'Derived Site Balance Flow',
    _source: 'derived',
  }
  return next
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

function cleanUnit(u) {
  if (!u) return ''
  return u
    .replace(/Ã‚Â°/g, '°')
    .replace(/Â°/g, '°')
    .replace(/Ãƒâ€š/g, '')
    .replace(/Ã‚/g, '')
    .trim()
}

function getRegisterCount(data) {
  return data?._registerCount ?? data?.datapoints?.length ?? 0
}

function getSourceState(data, sourceName) {
  return data?._sourceSummary?.[sourceName]?.state || ''
}

function DataPoint({ label, value, unit, color, compact = false }) {
  return (
    <div className={`bg-[#1c2333] rounded border border-[#1e2638] ${compact ? 'p-1.5' : 'p-2'}`}>
      <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} text-[#94a3b8] uppercase tracking-wider leading-tight`}>{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className={compact ? 'text-[15px] font-bold' : 'text-[14px] font-bold'} style={{ color: color || '#e8efff', fontFamily: "'Arial Black'" }}>
          {value || '--'}
        </span>
        <span className={`${compact ? 'text-[9px]' : 'text-[10px]'} text-[#7a8fb0]`}>{cleanUnit(unit)}</span>
      </div>
    </div>
  )
}

function CompressorCard({ label, data, time, desiredFlow, actualFlow, registers, standby = false, rawDatapoints = [] }) {
  const rpm = data['RPM'] || data['Compressor Speed'] || data['Driver Speed'] || data['Engine Speed'] || data['Engine Speed From EICS'] || data['ENGINE RPM']
  const shutdown = data['Skid - Shutdown']
  const isShutdown = shutdown && String(shutdown.value).toLowerCase().includes('shutdown')
  const hasRpm = rpm && parseFloat(rpm.value) > 100
  const hasFlow = actualFlow != null && parseFloat(actualFlow?.value) > 0.01
  const isRunning = (hasRpm || hasFlow) && !isShutdown

  // Standby (RPM-controlled) units: show speed as primary metric, not flow
  const desiredRpmDp = data['Target Speed'] || data['Speed Control SP'] || data['RPM Setpoint'] || data['Speed Setpoint']
    || data['Altronic Speed Control SP'] || data['Speed Discharge SP'] || data['Desired Speed']
  const actualRpmNum = rpm ? parseFloat(rpm.value) : null
  const desiredRpmNum = desiredRpmDp ? parseFloat(desiredRpmDp.value) : null
  const actualRpmStr = actualRpmNum != null && Number.isFinite(actualRpmNum) ? Math.round(actualRpmNum).toLocaleString() : '--'
  const desiredRpmStr = desiredRpmNum != null && Number.isFinite(desiredRpmNum) ? Math.round(desiredRpmNum).toLocaleString() : '--'

  // Filter registers shown in the detail grid — skip what's already shown in the primary metric row
  const skipLabels = standby
    ? new Set(['RPM', 'Engine Speed', 'Engine Speed From EICS', 'Driver Speed', 'Compressor Speed', 'ENGINE RPM',
               'Target Speed', 'Speed Control SP', 'RPM Setpoint', 'Speed Setpoint', 'Altronic Speed Control SP',
               'Speed Discharge SP', 'Desired Speed', 'Flow Rate PID PV'])
    : new Set(['Flow Rate PID PV'])
  const visibleRegisters = registers.filter(meta => !skipLabels.has(meta.label))

  // Dynamic catch-all: show any raw datapoints not already covered by the catalog
  // This ensures units with non-standard MLink configs (e.g. Unit 2129) show all their data
  const norm = s => String(s || '').replace(/[^a-z0-9]+/gi, '').toLowerCase()
  const coveredNorms = new Set([
    ...Array.from(skipLabels).map(norm),
    ...visibleRegisters.map(r => norm(r.label)),
    ...visibleRegisters.map(r => norm(r.datapoint?.keyUsed || '')).filter(Boolean),
    // Always exclude: flow/RPM shown in the header block
    norm('Flow Rate'), norm('Flow Rate PID PV'), norm('Flow Rate PV'),
    norm('RPM'), norm('Compressor Speed'), norm('Driver Speed'), norm('Engine Speed'),
    ...(actualFlow?.keyUsed ? [norm(actualFlow.keyUsed)] : []),
    ...(desiredFlow?.keyUsed ? [norm(desiredFlow.keyUsed)] : []),
  ])
  const extraDps = rawDatapoints.filter(dp => {
    const v = dp.value ?? (Array.isArray(dp.values) ? dp.values[0] : undefined)
    if (v == null || String(v).trim() === '' || String(v).toLowerCase() === 'nan') return false
    const aliasN = norm(dp.alias || dp.desc || '')
    const descN = norm(dp.desc || '')
    if (!aliasN) return false
    return !coveredNorms.has(aliasN) && !coveredNorms.has(descN)
  })

  const desiredFlowValue = formatFlowValue(desiredFlow?.value)
  const actualFlowValue = formatFlowValue(actualFlow?.value)
  return (
    <div className="bg-[#161b27] rounded-xl border border-[#1e2638] p-3 xl:p-2.5">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-[#22c55e] shadow-lg shadow-[#22c55e]/50' : 'bg-[#E8200C]'}`} />
        <h3 className="text-[13px] text-white font-bold" style={{ fontFamily: "'Arial Black'" }}>{label}</h3>
        <span className={`text-[11px] font-bold ml-auto ${isRunning ? 'text-[#22c55e]' : 'text-[#E8200C]'}`}>
          {isRunning ? 'RUNNING' : 'STOPPED'}
        </span>
      </div>
      <div className="mb-3">
        {standby ? (
          <div className="grid grid-cols-2 gap-1.5">
            <DataPoint label="Desired RPM" value={desiredRpmStr} unit="RPM" color="#4fc3f7" compact />
            <DataPoint label="Actual RPM" value={actualRpmStr} unit="RPM"
              color={actualRpmNum != null && Number.isFinite(actualRpmNum) && actualRpmNum > 100 ? '#22c55e' : '#647a9a'} compact />
          </div>
        ) : desiredFlow != null ? (
          <div className="grid grid-cols-2 gap-1.5">
            <DataPoint label="Desired Flow" value={desiredFlowValue} unit={cleanUnit(desiredFlow?.units) || 'MMSCFD'} color="#4fc3f7" compact />
            <DataPoint label="Actual Flow" value={actualFlowValue} unit={cleanUnit(actualFlow?.units) || 'MMSCFD'} color={getCompressorColor('Flow Rate', actualFlow?.value)} compact />
          </div>
        ) : (
          <div>
            <DataPoint label="Actual Flow" value={actualFlowValue} unit={cleanUnit(actualFlow?.units) || 'MMSCFD'} color={getCompressorColor('Flow Rate', actualFlow?.value)} compact />
            <div className="text-[10px] mt-1" style={{ color: '#4a5a7a' }}>Desired flow setpoint not published by current feed</div>
          </div>
        )}
      </div>
      {visibleRegisters.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
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
      {extraDps.length > 0 && (
        <div className={`grid grid-cols-2 gap-1.5 ${visibleRegisters.length > 0 ? 'mt-1.5' : ''}`}>
          {extraDps.map((dp, i) => {
            const lbl = dp.alias || dp.desc || 'Unknown'
            const val = dp.value ?? (Array.isArray(dp.values) ? dp.values[0] : undefined)
            return (
              <DataPoint
                key={`extra-${i}`}
                label={lbl}
                value={String(val ?? '--')}
                unit={cleanUnit(dp.units)}
                color="#888"
              />
            )
          })}
        </div>
      )}
      {standby && !isRunning && (
        <div className="mt-2 text-[11px] text-[#4d6080] italic">Unit on standby - will activate if primary units fault</div>
      )}
      {time && <div className="text-[10px] text-[#4d6080] mt-2 text-right">Updated: {time.toLocaleString()}</div>}
    </div>
  )
}

function StatusCard({ question, good, detail, value }) {
  const isUnknown = good === null
  const displayValue = value ?? (isUnknown ? '--' : good ? 'YES' : 'NO')
  return (
    <div className={`rounded-2xl border p-5 flex flex-col gap-2 ${isUnknown ? 'border-[#2d3a52] bg-[#131d2e]' : good ? 'border-[#1d6c3d] bg-[#0c1e14]' : 'border-[#7a1a1a] bg-[#1c0e0e]'}`}>
      <div className="text-[12px] font-semibold uppercase tracking-[0.15em] text-[#94a3b8]">{question}</div>
      <div className={`text-[42px] font-black leading-none ${isUnknown ? 'text-[#647a9a]' : good ? 'text-[#22c55e]' : 'text-[#E8200C]'}`} style={{ fontFamily: "'Arial Black'" }}>
        {displayValue}
      </div>
      <div className={`text-[12px] font-medium ${isUnknown ? 'text-[#647a9a]' : good ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>{detail}</div>
    </div>
  )
}

function RefreshCountdown({ secondsLeft, loading, onRefresh }) {
  const pct = Math.round((secondsLeft / REFRESH_INTERVAL_S) * 100)
  return (
    <button onClick={onRefresh} disabled={loading}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#2d3a52] bg-[#161b27] hover:bg-[#1e2638] disabled:opacity-50 transition-colors"
      title="Click to refresh now">
      <svg width="16" height="16" viewBox="0 0 36 36" className="shrink-0 -rotate-90">
        <circle cx="18" cy="18" r="15" fill="none" stroke="#1a2a1a" strokeWidth="3" />
        <circle cx="18" cy="18" r="15" fill="none" stroke="#22c55e" strokeWidth="3"
          strokeDasharray={`${2 * Math.PI * 15}`}
          strokeDashoffset={`${2 * Math.PI * 15 * (1 - pct / 100)}`}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s linear' }} />
      </svg>
      <span className="text-[10px] text-[#888]">{loading ? 'Loading...' : `Refreshes in ${secondsLeft}s`}</span>
    </button>
  )
}

function CommsIndicator({ commsStatus }) {
  const isDown = commsStatus?.siteDown
  const isHolding = !isDown && commsStatus?.isHolding
  const isLimited = !isHolding && (commsStatus?.limitedDevices?.length ?? 0) > 0
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[8px] uppercase tracking-[0.18em] ${
      isDown
        ? 'border-[#7a1a1a] bg-[#1c0e0e] text-[#f87171]'
        : isHolding
        ? 'border-[#8a5b10] bg-[#171107] text-[#fbbf24]'
        : isLimited
          ? 'border-[#5d4b12] bg-[#17140a] text-[#facc15]'
        : 'border-[#1d6c3d] bg-[#0a1410] text-[#4ade80]'
    }`}>
      {isDown ? 'Site Status Unproven' : isHolding ? 'Holding Last Good Data' : isLimited ? 'Feed Limited' : 'MLink Refresh OK'}
    </span>
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
        {n != null ? n.toFixed(0) : '--'}
      </div>
      {n != null && <div className="text-[8px] text-[#555] mt-0.5">{unit}</div>}
    </div>
  )
}

export default function HalfmannLiveView() {
  const [registerCatalog, setRegisterCatalog] = useState([])
  const [padVisible, setPadVisible] = useState(true)
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
  } = useHalfmannData()
  const recycleAlertThreshold = siteSettings.recycleAlertThreshold ?? 0
  const wellTargetPct = siteSettings.wellTargetPct ?? 5
  const compressorCommandTolerancePct = Number(siteSettings?.derivedTriggerSettings?.compressorDispatch?.compressorCommandMatchTolerancePct) || 5
  const feedLimited = !commsStatus?.isHolding && (commsStatus?.limitedDevices?.length ?? 0) > 0
  const feedStaleOrDown = Boolean(commsStatus?.siteDown || commsStatus?.allHeld || commsStatus?.isStale)
  const dashboardFallbackActive = getSourceState(panelData, 'dashboardSnapshot') === 'fallback-cache'

  useEffect(() => {
    fetch(`${API_BASE}/api/public/pad-visibility`)
      .then(res => res.ok ? res.json() : null)
      .then(body => { if (body && body.halfmann === false) setPadVisible(false) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadAwiRegisterCatalog().then(setRegisterCatalog).catch(() => {})
  }, [])

  const panel = parseLiveDatapoints(panelData)
  const panelTime = getTimestamp(panelData)
  const unitDataMaps = HALFMANN_UNITS.map(u => parseLiveDatapoints(unitDataRaw[u.key]))

  // Site-level total desired - used only for site header comparison, not split across wells.
  // Individual well setpoints vary (e.g. 1.225 / 1.100 / 1.450 / 1.000 / 1.350 MMSCFD from Altronic panel).
  // Dividing total by 5 produces wrong ON TARGET / LOW per well - do not use as a per-well fallback.
  const totalDesiredSite = getNumericByAddress(panelData, [PANEL_ADDRESSES.totalDesiredSiteFlow]) ?? parseLiveNumeric(resolvePreferredDatapoint(panel, ['Total Desired Site Flow'])?.value)
  const perWellTarget = null

  const liveWellPerformance = LIVE_WELL_FLOW_KEYS.map((keys, index) => {
    const wellNumber = index + 1
    const wellLabel = LIVE_WELL_DISPLAY_NAMES[index] ?? String(wellNumber)
    const actualAddressDatapoint = resolveDatapointByAddress(panelData, [LIVE_WELL_FLOW_ADDRESSES[index]])
    const actualFreshDatapoint = isFallbackCacheDatapoint(panelData, actualAddressDatapoint) ? null : actualAddressDatapoint
    const actualTextDatapoint = resolvePreferredFreshDatapoint(panelData, panel, keys)
    const actual = parseLiveNumeric(actualFreshDatapoint?.value) ?? parseLiveNumeric(actualTextDatapoint?.value)
    const actualHiddenAsStale = actual == null && isFallbackCacheDatapoint(panelData, actualAddressDatapoint)
    const desiredInfo = getWellSetpointInfo(panelData, panel, wellNumber, perWellTarget)
    const calculatedDesired = getWellCalculatedDesiredFlow(panelData, panel, wellNumber)
    const desired = desiredInfo.value
    const yesterday = getFreshNumericByAddress(panelData, [LIVE_WELL_YESTERDAY_ADDRESSES[index]]) ?? parseLiveNumeric(resolvePreferredFreshDatapoint(panelData, panel, LIVE_WELL_YESTERDAY_KEYS[index])?.value)
    const staticPres = getFreshNumericByAddress(panelData, [LIVE_WELL_STATIC_ADDRESSES[index]]) ?? getFreshNumeric(panelData, panel, [
      `Wellhead #${wellNumber} Injection Static Pressure From Customer PLC`,
      `Well ${wellNumber} Static Pressure`, `Well #${wellNumber} Static Pressure`,
    ])
    const diffPres = getFreshNumericByAddress(panelData, [LIVE_WELL_DIFF_ADDRESSES[index]]) ?? getFreshNumeric(panelData, panel, [
      `Wellhead #${wellNumber} Injection Differential Prs From Customer PLC`,
      `Well ${wellNumber} Differential Pressure`,
    ])
    const casingPres = getFreshNumericByAddress(panelData, [LIVE_WELL_CASING_ADDRESSES[index]]) ?? getFreshNumeric(panelData, panel, [
      `Well ${wellNumber} Casing Pressure`, `Well #${wellNumber} Casing Pressure`,
      `Wellhead #${wellNumber} Casing Pressure`,
    ])
    const tubingPres = getFreshNumericByAddress(panelData, [LIVE_WELL_TUBING_ADDRESSES[index]]) ?? getFreshNumeric(panelData, panel, [
      `Well ${wellNumber} Tubing Pressure`, `Well #${wellNumber} Tubing Pressure`,
      `Wellhead #${wellNumber} Tubing Pressure`,
    ])
    const oilPriority = getFreshNumericByAddress(panelData, [LIVE_WELL_OIL_PRIORITY_ADDRESSES[index]])
    const liveInjectionMatchDatapoint = resolveDatapointByAddress(panelData, [PANEL_ADDRESSES.wellLiveInjectionMatchPct[index]])
    const liveInjectionMatchTextDatapoint = resolvePreferredDatapoint(panel, [
      `Wellhead #${wellLabel} Live Injection Match Percentage`,
      `Wellhead #${wellNumber} Live Injection Match Percentage`,
      `Well ${wellLabel} Live Injection Match Percentage`,
      `Well ${wellNumber} Live Injection Match Percentage`,
    ])
    const liveInjectionMatchPct = parsePercentNumeric(liveInjectionMatchDatapoint?.value ?? liveInjectionMatchTextDatapoint?.value)
    const liveInjectionMatchFallback = isFallbackCacheDatapoint(panelData, liveInjectionMatchDatapoint)
    const liveMatchAtTarget = liveInjectionMatchPct != null ? liveInjectionMatchPct >= (100 - wellTargetPct) : null
    return {
      wellNumber,
      wellLabel,
      actual,
      desired,
      desiredSource: desiredInfo.source,
      calculatedDesired,
      yesterday,
      staticPres,
      diffPres,
      casingPres,
      tubingPres,
      oilPriority,
      gap: actual != null && desired != null ? actual - desired : null,
      actualHiddenAsStale,
      matchPct: liveInjectionMatchPct,
      matchPctFallback: liveInjectionMatchFallback,
      atTarget: liveMatchAtTarget,
      sacrificed: calculatedDesired != null && desired != null && calculatedDesired < desired,
    }
  })

  const unitDesiredFlows = HALFMANN_UNITS.map((u, i) => getUnitDesiredFlowDatapoint(panelData, panel, unitDataRaw[u.key], unitDataMaps[i], u.key, u.label))
  const rawUnitActualFlows = HALFMANN_UNITS.map((u, i) => getUnitActualFlowDatapoint(unitDataRaw[u.key], unitDataMaps[i]))

  const unitDischargePrs = HALFMANN_UNITS.map((u, i) =>
    getNumericByAddress(unitDataRaw[u.key], UNIT_ADDRESSES.dischargePressure) ?? getNumeric(unitDataMaps[i], ['Discharge Pressure', 'Compressor Discharge Prs', '3rd Stage Discharge Prs', 'Stage 3 Discharge Prs'])
  )
  const unitSuctionPrs = HALFMANN_UNITS.map((u, i) =>
    getNumericByAddress(unitDataRaw[u.key], UNIT_ADDRESSES.suctionPressure) ?? getNumeric(unitDataMaps[i], ['Suction Pressure', 'Suction Prs', 'Stage 1 Suction Prs', '1st Stage Suction Prs'])
  )
  const unitSpeedDischargeSP = unitDataMaps.map(dataMap =>
    getNumeric(dataMap, ['Speed Control SP', 'Speed Discharge SP', 'Altronic Discharge Pressure Trigger', 'Altronic Speed Control SP', 'Discharge Pressure SP'])
  )

  const visibleRegisters = getVisibleLiveRegisters(panel, registerCatalog, {})
  const hourMeterRegister = visibleRegisters.find(meta => meta.label === 'Hour Meter')
  const recommendedCompressors = getNumericByAddress(panelData, [PANEL_ADDRESSES.recommendedCompressors]) ?? getNumeric(panel, ['Recommended Number Of Compressors'])

  const totalActualFlow = liveWellPerformance.reduce((sum, w) => sum + (w.actual ?? 0), 0)
  const wellsWithBoth = liveWellPerformance.filter(w => w.actual != null && w.desired != null)
  const totalDesiredFromWells = wellsWithBoth.reduce((sum, w) => sum + (w.desired ?? 0), 0)
  const effectiveTotalDesired = totalDesiredSite ?? (wellsWithBoth.length > 0 ? totalDesiredFromWells : null)
  const activeWells = liveWellPerformance.filter(w => w.actual != null)
  const wellsWithMatchPct = liveWellPerformance.filter(w => w.matchPct != null)
  const wellsAtTargetCount = wellsWithMatchPct.filter(w => w.atTarget === true).length
  const panelAllWellsMeetingFlow = parsePanelBooleanValue(
    resolveDatapointByAddress(panelData, [PANEL_ADDRESSES.allWellsMeetingFlow])?.value
      ?? resolvePreferredDatapoint(panel, ['All Wells Meeting Flow?'])?.value,
  )
  const panelAnyWellBelowSetpoint = parsePanelBooleanValue(
    resolveDatapointByAddress(panelData, [PANEL_ADDRESSES.anyWellBelowSetpoint])?.value
      ?? resolvePreferredDatapoint(panel, ['Any Well Below Setpoint'])?.value,
  )
  const panelWellsMeetingRateCount = parseLeadingCount(
    resolveDatapointByAddress(panelData, [PANEL_ADDRESSES.wellsMeetingRate])?.value
      ?? resolvePreferredDatapoint(panel, ['Wells Meeting Rate'])?.value,
  )
  const displayedWellMeetingCount = panelWellsMeetingRateCount ?? wellsAtTargetCount
  const displayedWellMeetingTotal = liveWellPerformance.length || 5
  const topWellStatusGood = feedStaleOrDown ? null : panelAllWellsMeetingFlow

  // Site on target: compare total actual vs Total Desired Site Flow panel register.
  // Per-well individual setpoints may still be missing, but the site total can still be valid.
  const siteOnTarget = feedStaleOrDown ? null : totalDesiredSite != null && totalDesiredSite > 0
    ? Math.abs(totalActualFlow - totalDesiredSite) / totalDesiredSite <= 0.05
    : wellsWithBoth.length > 0 && totalDesiredFromWells > 0
      ? Math.abs(totalActualFlow - totalDesiredFromWells) / totalDesiredFromWells <= 0.05
      : null

  const unitActualFlows = deriveMissingCompressorFlowDatapoints(rawUnitActualFlows, totalActualFlow, HALFMANN_UNITS)
  const primaryUnitIndexes = HALFMANN_UNITS.map((unit, index) => (!unit.standby ? index : null)).filter(index => index != null)
  const compressorCommandScores = primaryUnitIndexes.map((index) => {
    const actual = parseLiveNumeric(unitActualFlows[index]?.value)
    const desired = parseLiveNumeric(unitDesiredFlows[index]?.value)
    if (actual == null || desired == null || desired <= 0) return null
    return Math.max(0, Math.min(100, 100 - (Math.abs(actual - desired) / desired) * 100))
  }).filter(score => score != null)
  const compressorsMeetingCount = primaryUnitIndexes.filter((index) => {
    const actual = parseLiveNumeric(unitActualFlows[index]?.value)
    const desired = parseLiveNumeric(unitDesiredFlows[index]?.value)
    return meetingState.compressors[HALFMANN_UNITS[index].key] ?? (actual != null && desired != null && desired > 0 && Math.abs(actual - desired) <= desired * (compressorCommandTolerancePct / 100))
  }).length
  const compressorMeetingSignals = getPanelCompressorMeetingSignals(panelData, panel)
  const panelCompressorsMeetingFlow = compressorMeetingSignals.effective
  const panelCompressorMeetingCount = compressorMeetingSignals.directFlags.length
    ? compressorMeetingSignals.directFlags.filter(Boolean).length
    : null
  const panelCompressorMeetingTotal = compressorMeetingSignals.directFlags.length || null
  const displayedCompressorMeetingCount = panelCompressorMeetingCount ?? compressorsMeetingCount
  const displayedCompressorMeetingTotal = panelCompressorMeetingTotal ?? compressorCommandScores.length
  const allCompressorsMeetingCommands = feedStaleOrDown
    ? null
    : panelCompressorsMeetingFlow ?? (compressorCommandScores.length > 0 ? compressorsMeetingCount === compressorCommandScores.length : null)
  const compressorCommandScore = compressorCommandScores.length > 0
    ? compressorCommandScores.reduce((sum, score) => sum + score, 0) / compressorCommandScores.length
    : null
  const compressorSignalSummary = []
  if (compressorMeetingSignals.perCompressor != null) {
    compressorSignalSummary.push(`Per-compressor panel bits: ${compressorMeetingSignals.perCompressor ? 'YES' : 'NO'}`)
  }
  if (
    compressorMeetingSignals.broadSummary != null &&
    compressorMeetingSignals.perCompressor != null &&
    compressorMeetingSignals.broadSummary !== compressorMeetingSignals.perCompressor
  ) {
    compressorSignalSummary.push(`summary bit disagrees: ${compressorMeetingSignals.broadSummary ? 'YES' : 'NO'}`)
  } else if (compressorMeetingSignals.aggregateMeeting != null && compressorMeetingSignals.perCompressor == null) {
    compressorSignalSummary.push(`Panel says: ${compressorMeetingSignals.aggregateMeeting ? 'YES' : 'NO'}`)
  } else if (compressorMeetingSignals.inverseAnyNotMeeting != null && compressorMeetingSignals.perCompressor == null && compressorMeetingSignals.aggregateMeeting == null) {
    compressorSignalSummary.push(`Any-not-meeting bit says: ${compressorMeetingSignals.inverseAnyNotMeeting ? 'YES' : 'NO'}`)
  } else if (compressorMeetingSignals.broadSummary != null && compressorSignalSummary.length === 0) {
    compressorSignalSummary.push(`Panel says: ${compressorMeetingSignals.broadSummary ? 'YES' : 'NO'}`)
  }

  const recycleVal = getNumericByAddress(panelData, PANEL_ADDRESSES.recycleValvePosition) ?? getNumeric(panel, ['Recycle Valve Position', 'Recycle Valve', 'RCV Position',
    'Station Recycle Header Valve Command Output'])
  const recycleOpen = recycleVal != null ? recycleVal > recycleAlertThreshold : null

  const dischargeTriggerSP = getNumeric(panel, ['Altronic Discharge Pressure Trigger', 'Discharge Trigger SP', 'Speed Auto Discharge SP'])

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
          <div className={`w-2.5 h-2.5 rounded-full shadow-lg animate-pulse ${
            commsStatus?.siteDown
              ? 'bg-[#ef4444] shadow-[#ef4444]/60'
              : commsStatus?.isHolding
              ? 'bg-[#f59e0b] shadow-[#f59e0b]/60'
              : feedLimited
                ? 'bg-[#facc15] shadow-[#facc15]/60'
                : 'bg-[#22c55e] shadow-[#22c55e]/60'
          }`} />
          <div>
            <div className="text-[13px] text-white font-bold" style={{ fontFamily: "'Arial Black'" }}>Live Field Data - Halfmann 1214</div>
            <div className="text-[10px] text-[#666]">Active Pad Logic panel - read-only public view</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <CommsIndicator commsStatus={commsStatus} />
          {lastRefresh && <span className="text-[9px] text-[#555] hidden sm:inline">Last update: {lastRefresh.toLocaleTimeString()}</span>}
          <RefreshCountdown secondsLeft={countdown} loading={loading} onRefresh={refresh} />
          <span className="rounded-full border border-[#2f2f40] bg-[#111120] px-2 py-0.5 text-[8px] uppercase tracking-[0.18em] text-[#777]">
            Hour Meter <span className="ml-1 text-[10px] text-white font-bold normal-case tracking-normal">
              {formatHourMeterValue(hourMeterRegister?.datapoint?.value ?? panel['\t Hour Meter']?.value ?? panel['Hour Meter']?.value)}
            </span>
          </span>
          {recommendedCompressors != null && (
            <span className="rounded-full border border-[#2f2f40] bg-[#111120] px-2 py-0.5 text-[8px] uppercase tracking-[0.18em] text-[#777]">
              Rec. Comp <span className="ml-1 text-[10px] font-bold normal-case tracking-normal" style={{ color: '#49D0E2' }}>
                {Math.round(recommendedCompressors)}
              </span>
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-5">
        <div className="max-w-[1280px] mx-auto">
          {loading && !panelData ? (
            <div className="text-center py-24 text-[#888] text-sm">Connecting to field units...</div>
          ) : (
            <>
              {liveError && (
                <div className="mb-4 rounded-lg border border-[#5a1d1d] bg-[#1f0c0c] px-4 py-3 text-[11px] text-[#fca5a5]">{liveError}</div>
              )}
              {commsStatus?.message && (
                <div className={`mb-4 rounded-lg px-4 py-3 text-[11px] ${
                  commsStatus?.siteDown
                    ? 'border border-[#7a1a1a] bg-[#1c0e0e] text-[#fecaca]'
                    : commsStatus?.isHolding
                    ? 'border border-[#8a5b10] bg-[#171107] text-[#fef3c7]'
                    : 'border border-[#5d4b12] bg-[#17140a] text-[#fde68a]'
                }`}>
                  {commsStatus.message}
                </div>
              )}
              {dashboardFallbackActive && (
                <div className="mb-4 rounded-lg border border-[#8a5b10] bg-[#171107] px-4 py-3 text-[11px] leading-relaxed text-[#fef3c7]">
                  Murphy dashboard auth is unavailable, so dashboard-only panel values are hidden instead of showing old cached readings. Live values still shown are from the current MLink feed.
                </div>
              )}

              {/* 3 status cards */}
              <div className="grid gap-4 sm:grid-cols-3 mb-5">
                <StatusCard
                  question="Are all wells meeting target flow rate?"
                  good={topWellStatusGood}
                  value={feedStaleOrDown ? 'STALE' : undefined}
                  detail={feedStaleOrDown
                    ? `Showing cached/held data from ${lastRefresh ? lastRefresh.toLocaleTimeString() : 'an earlier refresh'}. Current well-meeting status is not proven.`
                    : panelAllWellsMeetingFlow != null
                    ? `Direct MLink register${panelWellsMeetingRateCount != null ? ` | ${displayedWellMeetingCount} of ${displayedWellMeetingTotal} wells meeting rate` : ''}${panelAnyWellBelowSetpoint != null ? ` | Any well below setpoint: ${panelAnyWellBelowSetpoint ? 'YES' : 'NO'}` : ''}`
                    : 'All Wells Meeting Flow? register not visible on current feed'}
                />
                <StatusCard
                  question="Is site injection on target?"
                  good={siteOnTarget}
                  value={feedStaleOrDown ? 'STALE' : undefined}
                  detail={feedStaleOrDown
                    ? `Latest good totals are ${totalActualFlow.toFixed(3)} actual${totalDesiredSite != null ? ` vs ${totalDesiredSite.toFixed(3)} MMSCFD desired` : ''}, but live site health is not proven while the feed is stale/down.`
                    : totalDesiredSite != null
                    ? `${totalActualFlow.toFixed(3)} actual vs ${totalDesiredSite.toFixed(3)} MMSCFD site total`
                    : wellsWithBoth.length > 0
                      ? `${totalActualFlow.toFixed(3)} actual vs ${totalDesiredFromWells.toFixed(3)} MMSCFD desired`
                      : activeWells.length > 0
                        ? 'Well targets are not available yet'
                        : 'Waiting for flow data...'}
                />
                <StatusCard
                  question="Are all compressors meeting flow commands?"
                  good={allCompressorsMeetingCommands}
                  value={feedStaleOrDown ? 'STALE' : undefined}
                  detail={feedStaleOrDown
                    ? 'Compressor command compliance is not being judged while the site is on held/stale data.'
                    : panelCompressorsMeetingFlow != null
                    ? `${compressorSignalSummary.join(' | ')}${compressorCommandScore != null ? `${compressorSignalSummary.length ? ' | ' : ''}${displayedCompressorMeetingCount} of ${displayedCompressorMeetingTotal} compressors within ${compressorCommandTolerancePct}% | ${compressorCommandScore.toFixed(1)}% avg command score` : ''}`
                    : compressorCommandScore != null
                    ? `${compressorsMeetingCount} of ${compressorCommandScores.length} compressors within ${compressorCommandTolerancePct}% | ${compressorCommandScore.toFixed(1)}% avg command score`
                    : 'Desired flow command not visible on current site feed'}
                />
              </div>

              <div className="mb-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#49D0E2]" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                    Well-by-Well Status
                  </div>
                  <div className="text-[10px] text-[#555]">
                    Total: <span className="text-white font-bold">{totalActualFlow.toFixed(3)}</span>
                    {effectiveTotalDesired != null && <span className="text-[#555]"> / {effectiveTotalDesired.toFixed(3)} MMSCFD desired</span>}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                  {liveWellPerformance.map((well) => {
                    const hasData = well.actual != null
                    const onTarget = well.atTarget === true
                    const hasMatchPct = well.matchPct != null
                    const liveFeedGap = !hasData && well.actualHiddenAsStale
                    const tone = liveFeedGap ? 'warning' : !hasData ? 'none' : !hasMatchPct ? 'neutral' : onTarget ? 'good' : 'bad'
                    const borderColor = tone === 'good' ? '#1d6c3d' : tone === 'bad' ? '#7a1a1a' : tone === 'warning' ? '#9a6a00' : tone === 'neutral' ? '#2d3a52' : '#1a1a2a'
                    const bgColor = tone === 'good' ? '#071410' : tone === 'bad' ? '#180909' : tone === 'warning' ? '#160f03' : tone === 'neutral' ? '#101827' : '#0a0a14'
                    return (
                      <div key={well.wellNumber} className="rounded-xl border p-4 flex flex-col gap-0"
                        style={{ borderColor, background: bgColor }}>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#49D0E2' }}>
                            Well {well.wellLabel}
                          </div>
                          {well.matchPct != null ? (
                            <div
                              className="text-[9px] font-bold uppercase tracking-wider shrink-0"
                              style={{ color: tone === 'good' ? '#4ade80' : tone === 'bad' ? '#fca5a5' : tone === 'warning' ? '#facc15' : '#93c5fd' }}
                            >
                              {well.matchPct.toFixed(1)}% {well.matchPctFallback ? 'last match' : 'on target'}
                            </div>
                          ) : null}
                        </div>
                        <div className="mb-1">
                          <div className="text-[24px] font-black leading-none"
                            style={{ color: liveFeedGap ? '#facc15' : !hasData ? '#333' : tone === 'good' ? '#22c55e' : tone === 'bad' ? '#ef4444' : '#93c5fd', fontFamily: "'Arial Black'" }}>
                            {hasData ? well.actual.toFixed(3) : liveFeedGap ? 'FEED GAP' : 'NO DATA'}
                          </div>
                          {hasData && <div className="text-[9px] mt-0.5" style={{ color: tone === 'good' ? '#4ade80' : tone === 'bad' ? '#fca5a5' : '#93c5fd' }}>MMSCFD actual</div>}
                          {liveFeedGap && <div className="text-[9px] mt-0.5 text-[#facc15]">Actual flow not posted in current live feed</div>}
                        </div>
                        {well.desired != null ? (
                          <div className="mb-2">
                            <div className="text-[16px] font-black leading-none text-[#4fc3f7]" style={{ fontFamily: "'Arial Black'" }}>
                              {well.desired.toFixed(3)}
                            </div>
                            <div className="text-[9px] text-[#4fc3f7]/70">MMSCFD live setpoint</div>
                          </div>
                        ) : (
                          <div className="mb-2 text-[9px]" style={{ color: '#4a4a60' }}>Setpoint not visible in live payload</div>
                        )}
                        {well.matchPct != null && (
                          <div className="mb-2">
                            <div className="h-2 overflow-hidden rounded-full" style={{ background: '#14202c' }}>
                              <div className="h-full rounded-full transition-all"
                                style={{
                                  width: `${Math.min(100, well.matchPct)}%`,
                                  background: onTarget ? 'linear-gradient(to right, #22c55e, #4fc3f7)' : '#ef4444',
                                }} />
                            </div>
                            <div className="text-[9px] text-[#555] mt-0.5">
                              {well.matchPctFallback ? 'Last cached panel match register' : 'Direct MLink injection match register'}
                            </div>
                          </div>
                        )}
                        {hasData && hasMatchPct && (
                          <div className="text-[14px] font-black mb-3"
                            style={{ color: tone === 'good' ? '#22c55e' : '#ef4444', fontFamily: "'Arial Black'" }}>
                            {onTarget ? 'ON TARGET' : 'LOW'}
                          </div>
                        )}
                        <div className="border-t border-[#1a1a2a] my-2" />
                        <div className="mb-2">
                          <div className="text-[7px] text-[#555] uppercase tracking-wider">Yesterday</div>
                          <div className="text-[14px] font-black leading-none text-white" style={{ fontFamily: "'Arial Black'" }}>
                            {well.yesterday != null ? well.yesterday.toFixed(3) : '--'}
                          </div>
                          {well.yesterday != null && <div className="text-[8px] text-[#555]">MMSCFD</div>}
                        </div>
                        <div>
                          <div className="text-[7px] text-[#555] uppercase tracking-wider">Oil Priority</div>
                          <div className="text-[14px] font-black leading-none text-white" style={{ fontFamily: "'Arial Black'" }}>
                            {well.oilPriority != null ? well.oilPriority.toFixed(0) : '--'}
                          </div>
                          {well.oilPriority != null && <div className="text-[8px] text-[#555]">Rank</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Recycle valve and pressure summary */}
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
                      {recycleVal != null ? `${recycleVal.toFixed(1)}%` : '--'}
                    </div>
                    <div className="text-[13px] font-black mb-3"
                      style={{ color: recycleVal == null ? '#555' : recycleOpen ? '#E8200C' : '#22c55e', fontFamily: "'Arial Black'" }}>
                      {recycleVal == null ? 'PENDING' : recycleOpen ? 'NOT MEETING TARGET' : 'ON TARGET'}
                    </div>
                    <div className="text-[9px] text-[#555] uppercase tracking-wider">
                      Target: {'<='} {recycleAlertThreshold}% - Adjustable via admin
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
                    <div className="text-[9px] text-[#49D0E2] uppercase tracking-[0.15em] font-bold mb-2">Discharge &amp; Suction Pressures - Per Compressor</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                      {HALFMANN_UNITS.map((u, i) => (
                        <div key={u.key} className="rounded-lg border border-[#1e1e30] bg-[#0a0a14] p-2.5">
                          <div className="text-[8px] text-[#49D0E2] font-bold uppercase tracking-wider mb-2">{u.label}</div>
                          <div className="space-y-1.5">
                            <div>
                              <div className="text-[7px] text-[#555] uppercase tracking-wider">Discharge</div>
                              <div className="text-[16px] font-black leading-none"
                                style={{ color: unitDischargePrs[i] != null ? (unitDischargePrs[i] > 900 ? '#ef4444' : '#22c55e') : '#444', fontFamily: "'Arial Black'" }}>
                                {unitDischargePrs[i] != null ? `${unitDischargePrs[i].toFixed(0)}` : '--'}
                              </div>
                              {unitDischargePrs[i] != null && <div className="text-[7px] text-[#555]">PSI</div>}
                            </div>
                            <div>
                              <div className="text-[7px] text-[#555] uppercase tracking-wider">Suction</div>
                              <div className="text-[16px] font-black leading-none"
                                style={{ color: unitSuctionPrs[i] != null ? (unitSuctionPrs[i] < 30 ? '#f59e0b' : '#22c55e') : '#444', fontFamily: "'Arial Black'" }}>
                                {unitSuctionPrs[i] != null ? `${unitSuctionPrs[i].toFixed(0)}` : '--'}
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
                    <div className="text-[9px] text-[#49D0E2] uppercase tracking-[0.15em] font-bold mb-2">Static, Casing &amp; Tubing Pressures - Per Well</div>
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                      {liveWellPerformance.map((well, i) => (
                        <div key={i} className="rounded-lg border border-[#1e1e30] bg-[#0a0a14] p-2">
                          <div className="text-[8px] text-[#49D0E2] font-bold uppercase tracking-wider mb-1.5">Well {well.wellLabel}</div>
                          <div className="space-y-1.5">
                            <div>
                              <div className="text-[7px] text-[#555] uppercase tracking-wider">Static</div>
                              <div className="text-[14px] font-black leading-none"
                                style={{ color: well.staticPres != null ? (dischargeTriggerSP != null && well.staticPres >= dischargeTriggerSP ? '#ef4444' : '#22c55e') : '#444', fontFamily: "'Arial Black'" }}>
                                {well.staticPres != null ? well.staticPres.toFixed(0) : '--'}
                              </div>
                              {well.staticPres != null && <div className="text-[7px] text-[#555]">PSI</div>}
                            </div>
                            <div>
                              <div className="text-[7px] text-[#555] uppercase tracking-wider">Casing</div>
                              <div className="text-[14px] font-black leading-none"
                                style={{ color: well.casingPres != null ? '#22c55e' : '#2a2a3a', fontFamily: "'Arial Black'" }}>
                                {well.casingPres != null ? well.casingPres.toFixed(0) : '--'}
                              </div>
                              {well.casingPres != null && <div className="text-[7px] text-[#555]">PSI</div>}
                            </div>
                            <div>
                              <div className="text-[7px] text-[#555] uppercase tracking-wider">Tubing</div>
                              <div className="text-[14px] font-black leading-none"
                                style={{ color: well.tubingPres != null ? '#22c55e' : '#2a2a3a', fontFamily: "'Arial Black'" }}>
                                {well.tubingPres != null ? well.tubingPres.toFixed(0) : '--'}
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
                        {' '}- static pressure readings shown in red when at or above trigger
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {false && (
              <>
              {/* ── Well-by-Well Columns (all per-well data stacked) ── */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#49D0E2]" style={{ fontFamily: "'Montserrat', sans-serif" }}>
                    Well-by-Well Status
                  </div>
                  <div className="text-[10px] text-[#555]">
                    Total: <span className="text-white font-bold">{totalActualFlow.toFixed(3)}</span>
                    {effectiveTotalDesired != null && <span className="text-[#555]"> / {effectiveTotalDesired.toFixed(3)} MMSCFD desired</span>}
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
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#49D0E2' }}>
                            Well {well.wellLabel}
                          </div>
                          {well.matchPct != null ? (
                            <div
                              className="text-[9px] font-bold uppercase tracking-wider shrink-0"
                              style={{ color: onTarget ? '#4ade80' : '#fbbf24' }}
                            >
                              {well.matchPct.toFixed(1)}% on target
                            </div>
                          ) : null}
                        </div>

                        {/* Actual flow — large */}
                        <div className="mb-1">
                          <div className="text-[24px] font-black leading-none"
                            style={{ color: !hasData ? '#333' : onTarget ? '#22c55e' : '#f59e0b', fontFamily: "'Arial Black'" }}>
                            {hasData ? well.actual.toFixed(3) : 'NO DATA'}
                          </div>
                          {hasData && <div className="text-[9px] mt-0.5" style={{ color: onTarget ? '#4ade80' : '#fbbf24' }}>MMSCFD actual</div>}
                        </div>

                        {/* Desired flow — only shown when a real setpoint register is in MLink */}
                        {well.desired != null ? (
                          <div className="mb-2">
                            <div className="text-[16px] font-black leading-none text-[#4fc3f7]" style={{ fontFamily: "'Arial Black'" }}>
                              {well.desired.toFixed(3)}
                            </div>
                            <div className="text-[9px] text-[#4fc3f7]/70">MMSCFD setpoint</div>
                          </div>
                        ) : (
                          <div className="mb-2 text-[9px]" style={{ color: '#4a4a60' }}>Setpoint not visible in live payload</div>
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

                        {/* Status — only show when we have a desired target to compare against */}
                        {hasData && well.desired != null && (
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
              </>
              )}

              {/* Online indicator */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-3 h-3 rounded-full bg-[#22c55e] shadow-lg shadow-[#22c55e]/50" />
                <span className="text-[13px] text-[#22c55e] font-bold">ONLINE - Panel Active</span>
                {panelTime && <span className="text-[10px] text-[#555] ml-auto">Data from: {panelTime.toLocaleString()}</span>}
              </div>

              {/* Compressor units */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
                {HALFMANN_UNITS.map((u, i) => (
                  <CompressorCard
                    key={u.key}
                    label={u.label}
                    data={unitDataMaps[i]}
                    time={getTimestamp(unitDataRaw[u.key])}
                    desiredFlow={unitDesiredFlows[i]}
                    actualFlow={unitActualFlows[i]}
                    registers={getVisibleCompressorRegisters(unitDataMaps[i], {})}
                    standby={u.standby || false}
                    rawDatapoints={unitDataRaw[u.key]?.datapoints || []}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="px-5 py-3 bg-[#0c0c16] border-t border-[#1a1a2a] text-center shrink-0">
        <span className="text-[9px] text-[#444]">Halfmann 1214 - Read-only public view - Data refreshes every 3 seconds</span>
      </footer>
    </div>
  )
}
