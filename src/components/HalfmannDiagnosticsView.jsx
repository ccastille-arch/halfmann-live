import { useState, useEffect, useCallback, useMemo } from 'react'
import { findRegisterDatapoint, parseLiveDatapoints } from '../engine/liveRegisters'
import { PANEL_ADDRESSES, UNIT_ADDRESSES, getNumericByAddress as sharedGetNumericByAddress, resolveDatapointByAddress as sharedResolveDatapointByAddress } from '../engine/halfmannRegisters'
import { useHalfmannData } from '../context/HalfmannDataContext'

const API_BASE = import.meta.env.VITE_API_URL || ''
const REFRESH_INTERVAL_S = 3
const TARGET_TOLERANCE_PCT = 5

const HALFMANN_DEVICES = {
  panel: '2507-501508',
  unit2130: '2507-500709',
  unit2127: '2504-504108',
  unit2128: '2507-500076',
  unit2129: '2504-504102',
  unit1396: '2507-501442',
}

const HALFMANN_UNITS = [
  { key: 'unit2130', label: 'Unit 2130', deviceId: HALFMANN_DEVICES.unit2130, standby: false },
  { key: 'unit2127', label: 'Unit 2127', deviceId: HALFMANN_DEVICES.unit2127, standby: false },
  { key: 'unit2128', label: 'Unit 2128', deviceId: HALFMANN_DEVICES.unit2128, standby: false },
  { key: 'unit2129', label: 'Unit 2129', deviceId: HALFMANN_DEVICES.unit2129, standby: false },
  { key: 'unit1396', label: 'Unit 1396', deviceId: HALFMANN_DEVICES.unit1396, standby: true },
]

const WELL_FLOW_KEYS = [
  ['Well 1 Injection Gas Flow Rate', 'Well #1 Flow Rate'],
  ['Well 2 Injection Gas Flow Rate', 'Well #2 Flow Rate'],
  ['Well 3 Injection Gas Flow Rate', 'Well #3 Flow Rate'],
  ['Well 4 Injection Gas Flow Rate', 'Well #4 Flow Rate'],
  ['Well 5 Injection Gas Flow Rate', 'Well # 5 Flow Rate', 'Well #5 Flow Rate'],
]

const WELL_FLOW_ADDRESSES = PANEL_ADDRESSES.wellFlow
const WELL_SETPOINT_ADDRESSES = PANEL_ADDRESSES.wellSetpoint
const WELL_CALCULATED_DESIRED_ADDRESSES = PANEL_ADDRESSES.wellCalculatedDesiredFlow
const WELL_STATIC_ADDRESSES = PANEL_ADDRESSES.wellStaticPressure
const UNIT_DESIRED_FLOW_ADDRESSES = PANEL_ADDRESSES.unitDesiredFlowSetpoints
const UNIT_CURRENT_FLOW_OUTPUT_ADDRESSES = ['460364', '460384', '460404', '460424']

const WELL_SETPOINT_KEYS = [1, 2, 3, 4, 5].map((n) => [
  `Wellhead #${n} Setpoint From Customer PLC`,
  `Well ${n} Setpoint From Customer PLC`,
  `Well ${n} Setpoint`,
])

const WELL_CALCULATED_DESIRED_KEYS = [1, 2, 3, 4, 5].map((n) => [
  `Wellhead #${n} Calculated Desired Flow`,
  `Well ${n} Calculated Desired Flow`,
])

const WELL_STATIC_KEYS = [1, 2, 3, 4, 5].map((n) => [
  `Wellhead #${n} Injection Static Pressure From Customer PLC`,
  `Wellhead #${n} Injection Static Pressure`,
  `Well ${n} Static Pressure`,
])

const UNIT_TO_COMP_NUM = { unit2128: 1, unit2130: 2, unit2127: 3, unit2129: 4 }

async function readErrorPayload(res) {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => ({}))
    return body?.details || body?.error || res.statusText
  }
  return (await res.text().catch(() => '')).trim() || res.statusText
}

async function fetchDeviceFull(deviceId) {
  try {
    const res = await fetch(`${API_BASE}/api/mlink/device/full?deviceId=${encodeURIComponent(deviceId)}`)
    if (!res.ok) return { data: null, error: `device ${deviceId}: ${await readErrorPayload(res)}` }
    return { data: await res.json(), error: '' }
  } catch (err) {
    return { data: null, error: `device ${deviceId}: ${err.message}` }
  }
}

function resolveDatapoint(dataMap, labels) {
  for (const label of labels) {
    const datapoint = findRegisterDatapoint(dataMap, { label, decimals: 3 })
    if (datapoint) return datapoint
  }
  return null
}

function parseNumeric(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function getNumeric(dataMap, labels) {
  return parseNumeric(resolveDatapoint(dataMap, labels)?.value)
}

function resolveDatapointByAddress(data, addresses) {
  return sharedResolveDatapointByAddress(data, addresses)
}

function getNumericByAddress(data, addresses) {
  return sharedGetNumericByAddress(data, addresses)
}

function normalizeAddress(value) {
  return String(value ?? '').trim().toLowerCase()
}

function hasCurrentAddress(data, addresses) {
  const currentAddresses = Array.isArray(data?._currentDatapointAddresses) ? data._currentDatapointAddresses : []
  if (!currentAddresses.length) return false
  const normalized = addresses.map(normalizeAddress)
  return currentAddresses.some((address) => normalized.includes(normalizeAddress(address)))
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

  const aggregateMeetingValue = resolveDatapointByAddress(data, [420013])?.value ?? resolveDatapoint(dataMap, [
    'Meeting Flow Demand',
    'Compressors Meeting Desired Flow',
  ])?.value
  const aggregateMeeting = parsePanelBooleanValue(aggregateMeetingValue)

  const anyNotMeetingValue = resolveDatapointByAddress(data, [PANEL_ADDRESSES.anyCompressorNotMeetingDesiredFlow])?.value ?? resolveDatapoint(dataMap, [
    'Any Compressor Not Meeting Desired Flow',
  ])?.value
  const anyNotMeeting = parsePanelBooleanValue(anyNotMeetingValue)

  const broadSummaryValue = resolveDatapointByAddress(data, [PANEL_ADDRESSES.compressorsMeetingFlowDemand])?.value ?? resolveDatapoint(dataMap, [
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
  }
}

function getTimestamp(data) {
  if (!data?.timestamps?.[0]) return null
  return new Date(data.timestamps[0] * 1000)
}

function deriveMissingCompressorFlows(unitFlows, totalActualFlow, units) {
  if (totalActualFlow == null || !Number.isFinite(totalActualFlow)) return unitFlows
  const next = [...unitFlows]
  const activeIndexes = units.map((unit, index) => (!unit.standby ? index : null)).filter((index) => index != null)
  const missingIndexes = activeIndexes.filter((index) => next[index] == null)
  if (missingIndexes.length !== 1) return next

  const knownSum = activeIndexes.reduce((sum, index) => sum + (next[index] ?? 0), 0)
  const derivedFlow = totalActualFlow - knownSum
  if (!Number.isFinite(derivedFlow) || derivedFlow <= 0.01) return next

  next[missingIndexes[0]] = derivedFlow
  return next
}

function formatValue(value, decimals = 3) {
  return value != null && Number.isFinite(value) ? value.toFixed(decimals) : '--'
}

function formatPct(value, decimals = 1) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)}%` : '--'
}

function useIsNarrowViewport(breakpoint = 760) {
  const [isNarrow, setIsNarrow] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false
  ))

  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth <= breakpoint)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [breakpoint])

  return isNarrow
}

function isWellMeetingTarget(actual, desired, tolerancePct = TARGET_TOLERANCE_PCT) {
  if (actual == null || desired == null || desired <= 0) return false
  return actual >= desired * (1 - (tolerancePct / 100))
}

function isWellOvershoot(actual, desired, tolerancePct = TARGET_TOLERANCE_PCT) {
  if (actual == null || desired == null || desired <= 0) return false
  return actual > desired * (1 + (tolerancePct / 100))
}

function statusColors(tone) {
  if (tone === 'good') return { border: '#1d6c3d', bg: '#0b1a12', title: '#4ade80', text: '#d1fae5' }
  if (tone === 'warn') return { border: '#8a5b10', bg: '#171207', title: '#fbbf24', text: '#fef3c7' }
  if (tone === 'bad') return { border: '#7a1a1a', bg: '#1b0d0d', title: '#f87171', text: '#fee2e2' }
  return { border: '#24324a', bg: '#101827', title: '#93c5fd', text: '#dbeafe' }
}

function computePercentMatch(actual, target) {
  if (actual == null || target == null || target <= 0) return null
  return Math.max(0, 100 - (Math.abs(actual - target) / target) * 100)
}

function SummaryCard({ label, value, sub, tone = 'neutral' }) {
  const c = statusColors(tone)
  return (
    <div style={{ border: `1px solid ${c.border}`, background: c.bg, borderRadius: 16, padding: '14px 16px' }}>
      <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, color: c.title, fontWeight: 900, lineHeight: 1, fontFamily: "'Arial Black', sans-serif" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: c.text, marginTop: 8, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{sub}</div>}
    </div>
  )
}

function SuctionControllerCard({ score, units, tone = 'neutral', isNarrow = false }) {
  const c = statusColors(tone)
  return (
    <div style={{ border: `1px solid ${c.border}`, background: c.bg, borderRadius: 16, padding: '14px 16px', gridColumn: '1 / -1' }}>
      <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
        Suction Controller Score
      </div>
      <div style={{ fontSize: 28, color: c.title, fontWeight: 900, lineHeight: 1, fontFamily: "'Arial Black', sans-serif", marginBottom: 12 }}>
        {score != null ? formatPct(score, 0) : '--'}
      </div>
      {units?.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isNarrow ? 140 : 180}px, 1fr))`, gap: 10 }}>
          {units.map((unit) => (
            <div key={unit.key} style={{ border: '1px solid #1f3650', background: '#0a1220', borderRadius: 12, padding: '10px 12px' }}>
              <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
                {unit.label}
              </div>
              <div style={{ fontSize: 18, color: unit.score != null && unit.score >= 95 ? '#4ade80' : unit.score != null ? '#fbbf24' : '#93c5fd', fontWeight: 900, lineHeight: 1, fontFamily: "'Arial Black', sans-serif", marginBottom: 6 }}>
                {unit.score != null ? formatPct(unit.score, 0) : '--'}
              </div>
              <div style={{ fontSize: 11, color: '#dbeafe', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                {unit.displayLines?.length
                  ? unit.displayLines.join('\n')
                  : 'Suction controller data not visible on current feed'}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: c.text, marginTop: 8, lineHeight: 1.5 }}>
          Suction controller data not visible on current feed
        </div>
      )}
    </div>
  )
}

function OperatorCallout({ diagnosis }) {
  const c = statusColors(diagnosis.tone)
  return (
    <div style={{ border: `2px solid ${c.border}`, background: c.bg, borderRadius: 22, padding: '20px 22px', marginBottom: 18 }}>
      <div style={{ fontSize: 10, color: '#49D0E2', fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
        Operator Answer
      </div>
      <div style={{ fontSize: 15, color: '#94a3b8', marginBottom: 6 }}>Pad status right now:</div>
      <div style={{ fontSize: 36, color: c.title, fontWeight: 900, lineHeight: 1.05, fontFamily: "'Arial Black', sans-serif", marginBottom: 12 }}>
        {diagnosis.headline}
      </div>
      <div style={{ fontSize: 15, color: c.text, lineHeight: 1.7, marginBottom: 14 }}>
        {diagnosis.reason}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div style={{ border: '1px solid #1f3650', borderRadius: 14, padding: '12px 14px', background: '#0a1220' }}>
          <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>
            Why We Think That
          </div>
          <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.65 }}>{diagnosis.evidence}</div>
        </div>
        <div style={{ border: '1px solid #1f3650', borderRadius: 14, padding: '12px 14px', background: '#0a1220' }}>
          <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>
            What To Do
          </div>
          <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.65 }}>{diagnosis.action}</div>
        </div>
      </div>
    </div>
  )
}

function WellRow({ well }) {
  const tone = well.atTarget ? (well.overshoot ? 'neutral' : 'good') : 'warn'
  const c = statusColors(tone)
  return (
    <div style={{ border: '1px solid #1f3650', background: '#0a1220', borderRadius: 14, padding: '12px 14px', display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: 14, alignItems: 'center' }}>
      <div style={{ fontSize: 13, color: '#fff', fontWeight: 800 }}>Well {well.wellNumber}</div>
      <div>
        <div style={{ fontSize: 12, color: c.title, fontWeight: 800 }}>
          {formatValue(well.actual)} actual / {formatValue(well.desired)} target MMSCFD
        </div>
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
          {well.atTarget
            ? (well.overshoot ? `Potential optimization: ${formatValue(well.actual - well.desired)} MMSCFD above target` : 'Meeting target')
            : `Short by ${formatValue(well.shortfall)} MMSCFD`} | static {well.staticPressure != null ? `${formatValue(well.staticPressure, 0)} PSI` : '--'}
        </div>
      </div>
      <div style={{ fontSize: 10, color: well.atTarget ? (well.overshoot ? '#93c5fd' : '#4ade80') : '#fbbf24', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {well.atTarget ? (well.overshoot ? 'HIGH' : 'OK') : 'LOW'}
      </div>
    </div>
  )
}

function UnitRow({ unit, actualFlow, desiredFlow, suctionActual, suctionTarget, rpm, discharge, derivedFlow }) {
  const running = rpm != null && rpm > 100
  const suctionLine = suctionTarget != null
    ? `Suction ${formatValue(suctionActual, 1)} actual / ${formatValue(suctionTarget, 1)} target PSI`
    : `Suction ${formatValue(suctionActual, 1)} actual | shared target not published on current feed`
  return (
    <div style={{ border: '1px solid #1f3650', background: '#0a1220', borderRadius: 14, padding: '12px 14px', display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 14, alignItems: 'center' }}>
      <div style={{ fontSize: 13, color: '#fff', fontWeight: 800 }}>{unit.label}{unit.standby ? ' (Standby)' : ''}</div>
        <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.65 }}>
        Flow {formatValue(actualFlow)} actual / {formatValue(desiredFlow)} desired MMSCFD
        {derivedFlow ? ' | actual derived from site balance' : ''}
        <br />
        {suctionLine}
        <br />
        RPM {formatValue(rpm, 0)} | discharge {formatValue(discharge, 0)} PSI
      </div>
      <div style={{ fontSize: 10, color: running ? '#4ade80' : '#94a3b8', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {running ? 'Running' : 'Stopped'}
      </div>
    </div>
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
      padding: '6px 10px',
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

function buildDiagnosis({
  allOnTarget,
  wellsShort,
  sacrificedWells,
  totalActual,
  totalDesired,
  siteMatchPct,
  lowestSuction,
  highestDischarge,
  recycleOpen,
  recycleValvePosition,
  recycleDischargeSetpointPsi,
  recyclePressureReached,
  runningUnits,
  recommendedCompressors,
  commandMatchAvg,
  speedSuctionPressAutoSp,
  wellheadControlOverride,
  wellheadControlOverrideCompSpeedSp,
  wellPanelDischargeOverrideSetpointPsi,
  panelOverridePressureReached,
  compressorSpeedControlDischargeSetpointPsi,
  compressorSpeedControlActive,
  panelCompressorsMeetingFlow,
  panelCompressorSignalMismatch,
}) {
  if (allOnTarget) {
    return {
      tone: 'good',
      headline: 'Nothing to diagnose',
      reason: 'Wells are on target and the pad is operating inside expected limits.',
      evidence: `${formatValue(totalActual)} actual vs ${formatValue(totalDesired)} desired. ${wellsShort.length} wells are short.`,
      action: 'No diagnostic action needed right now.',
    }
  }

  if (wellsShort.length === 0) {
    return {
      tone: 'neutral',
      headline: 'Need more live target data',
      reason: 'The page cannot fully judge the pad until it has live well target data for every well.',
      evidence: 'Flow is visible, but at least some live well target tags are still missing from the current feed.',
      action: 'Wait for the panel target registers to publish again before trusting a full well-by-well rate judgment.',
    }
  }

  if (speedSuctionPressAutoSp != null && lowestSuction != null && lowestSuction <= speedSuctionPressAutoSp) {
    return {
      tone: 'warn',
      headline: 'Not meeting rate because suction protection is slowing units down',
      reason: 'At least one compressor is at or below its suction slow-down target, so the panel protects suction pressure before it chases flow.',
      evidence: `Lowest live suction is ${formatValue(lowestSuction, 1)} PSI and the low-suction slow-down target is ${formatValue(speedSuctionPressAutoSp, 1)} PSI. Short wells: ${wellsShort.map((well) => `W${well.wellNumber}`).join(', ')}.`,
      action: 'Check gas supply and suction conditions first. The units may ignore flow demand until suction pressure recovers.',
    }
  }

  if (wellheadControlOverride != null && wellheadControlOverride > 0) {
    return {
      tone: 'bad',
      headline: 'Not meeting rate because the well panel discharge override is active',
      reason: 'The DE4000 / well-panel override latch is on, so the panel is lowering compressor flow commands to protect discharge pressure before it keeps chasing well rate.',
      evidence: `Wellhead Control in Override = ${formatValue(wellheadControlOverride, 0)}. Manual well-panel override setpoint = ${formatValue(wellPanelDischargeOverrideSetpointPsi, 0)} PSI. Override comp speed SP = ${formatValue(wellheadControlOverrideCompSpeedSp, 0)}. Highest site discharge is ${formatValue(highestDischarge, 0)} PSI. Short wells: ${wellsShort.map((well) => `W${well.wellNumber}`).join(', ')}.`,
      action: 'Treat this as the first pressure-protection layer. Check discharge-side conditions before increasing anything on the well side.',
    }
  }

  if (panelOverridePressureReached) {
    return {
      tone: 'warn',
      headline: 'Not meeting rate because the site is at the well panel discharge override trigger',
      reason: 'The site discharge pressure is at or above the manual well-panel override setpoint, so the panel should start trimming unit flow commands before other pressure protections intervene.',
      evidence: `Highest site discharge is ${formatValue(highestDischarge, 0)} PSI against a manual well-panel override setpoint of ${formatValue(wellPanelDischargeOverrideSetpointPsi, 0)} PSI. Short wells: ${wellsShort.map((well) => `W${well.wellNumber}`).join(', ')}.`,
      action: 'Use small and slow panel-side corrections only. Do not chase more flow until discharge pressure is back below the panel override trigger.',
    }
  }

  if (compressorSpeedControlActive) {
    return {
      tone: 'bad',
      headline: 'Not meeting rate because compressor speed control discharge protection is active',
      reason: 'Compressor speed control has reached its discharge pressure limit, so the units will ignore flow demand and slow down enough to stay below the compressor discharge setpoint.',
      evidence: `Highest site discharge is ${formatValue(highestDischarge, 0)} PSI against a compressor speed-control discharge setpoint of ${formatValue(compressorSpeedControlDischargeSetpointPsi, 0)} PSI. Short wells: ${wellsShort.map((well) => `W${well.wellNumber}`).join(', ')}.`,
      action: 'Treat the pad as pressure-limited, not compressor-limited. Do not add compressor load while speed-control discharge protection is active.',
    }
  }

  if (recycleOpen === true || recyclePressureReached) {
    return {
      tone: 'warn',
      headline: 'Not meeting rate because recycle protection is active',
      reason: 'The site has reached the downstream recycle protection layer, so gas is being diverted or is about to be diverted instead of all of it going to the wells.',
      evidence: `Recycle valve position is ${formatValue(recycleValvePosition, 1)}% and the manual station recycle setpoint is ${formatValue(recycleDischargeSetpointPsi, 0)} PSI. Highest site discharge is ${formatValue(highestDischarge, 0)} PSI. Short wells: ${wellsShort.map((well) => `W${well.wellNumber}`).join(', ')}.`,
      action: 'Treat this as optimization inefficiency or system imbalance. Reduce excess compressor flow or improve gas allocation before asking for more well flow.',
    }
  }

  if (recommendedCompressors != null && runningUnits.length < recommendedCompressors) {
    return {
      tone: 'warn',
      headline: 'Not meeting rate because not enough compressors are loaded',
      reason: 'The pad is short on online compression compared with the panel recommendation.',
      evidence: `${runningUnits.length} primary compressors are running and the panel recommends ${formatValue(recommendedCompressors, 0)}. Short wells: ${wellsShort.map((well) => `W${well.wellNumber}`).join(', ')}.`,
      action: 'Check why the missing compressor is not online and loaded before expecting the wells to recover.',
    }
  }

  if (sacrificedWells.length > 0) {
    return {
      tone: 'warn',
      headline: 'Not meeting rate because the panel is sacrificing one or more wells',
      reason: 'This page only uses the word sacrificed when the panel calculated desired flow is lower than that well customer target setpoint.',
      evidence: sacrificedWells.map((well) =>
        `W${well.wellNumber}: actual ${formatValue(well.actual)} vs calculated desired ${formatValue(well.calculatedDesired)} vs customer target ${formatValue(well.desired)}`
      ).join(' | '),
      action: 'Check the pad limiting condition first, then inspect the specific sacrificed wells.',
    }
  }

  if (siteMatchPct != null && siteMatchPct >= 96) {
    return {
      tone: 'warn',
      headline: 'Not meeting rate and the live data does not prove the exact cause yet',
      reason: 'The pad total is close to target, but this page does not have proof that the panel has started sacrificing wells.',
      evidence: `Pad is still at ${formatPct(siteMatchPct)} of total desired. Short wells: ${wellsShort.map((well) => `W${well.wellNumber} short ${formatValue(well.shortfall)}`).join(' | ')}.`,
      action: 'Check the short wells for local restriction and compare calculated desired flow against customer target before calling a well sacrificed.',
    }
  }

  if (panelCompressorsMeetingFlow === false) {
    return {
      tone: 'warn',
      headline: 'Not meeting rate because the panel says compressors are not meeting flow demand',
      reason: panelCompressorSignalMismatch
        ? 'The panel-wide summary bit disagrees with the direct per-compressor meeting bits, so treat this as a panel signal conflict instead of a proven compressor miss.'
        : 'The M-Link panel signal for compressor flow compliance is reporting NO.',
      evidence: `${panelCompressorSignalMismatch ? 'Direct compressor bits say YES while one panel summary bit says NO.' : 'Compressor flow compliance signal = NO.'} ${formatValue(totalActual)} actual vs ${formatValue(totalDesired)} desired. Average compressor flow match is ${commandMatchAvg != null ? formatPct(commandMatchAvg) : 'not visible'}.`,
      action: 'Trust the panel latch first. Check which compressor is under-delivering, then inspect suction, discharge, and any active override logic.',
    }
  }

  return {
    tone: 'warn',
    headline: 'Not meeting rate and no specific limiting condition is proven yet',
    reason: 'The wells are short, but this page does not currently prove suction slow-down, discharge slow-down, recycle-open loss, too few compressors online, or panel sacrifice.',
    evidence: `${formatValue(totalActual)} actual vs ${formatValue(totalDesired)} desired. Average compressor flow match is ${commandMatchAvg != null ? formatPct(commandMatchAvg) : 'not visible'}. Low-suction slow-down target is ${formatValue(speedSuctionPressAutoSp, 1)} PSI.`,
    action: 'Check compressor desired flow versus actual flow on each running unit, then inspect the short wells individually for local restriction.',
  }
}

export default function HalfmannDiagnosticsView() {
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
  const feedLimited = !commsStatus?.isHolding && (commsStatus?.limitedDevices?.length ?? 0) > 0
  const [viewMode, setViewMode] = useState('operations')
  const isNarrow = useIsNarrowViewport()

  const derived = useMemo(() => {
    const panel = parseLiveDatapoints(panelData)
    const unitMaps = HALFMANN_UNITS.map((unit) => parseLiveDatapoints(unitDataRaw[unit.key]))
    const wellTargetPct = Number(siteSettings.wellTargetPct) || TARGET_TOLERANCE_PCT
    const recyclePressureSettings = siteSettings?.derivedTriggerSettings?.recyclePressure || {}
    const recycleActiveThresholdPct = Number(recyclePressureSettings.recycleActiveThresholdPct) || 5
    const wellPanelDischargeOverrideSetpointPsi = Number(recyclePressureSettings.wellPanelDischargeOverrideSetpointPsi) || 1250
    const compressorSpeedControlDischargeSetpointPsi = Number(recyclePressureSettings.compressorSpeedControlDischargeSetpointPsi) || 1340
    const recycleDischargeSetpointPsi = Number(recyclePressureSettings.stationRecycleDischargeSetpointPsi) || 1350

    const wells = WELL_FLOW_KEYS.map((flowKeys, index) => {
      const wellNumber = index + 1
      const desiredDatapoint = resolveDatapointByAddress(panelData, [WELL_SETPOINT_ADDRESSES[index]]) ?? resolveDatapoint(panel, WELL_SETPOINT_KEYS[index])
      const desired = parseNumeric(desiredDatapoint?.value) ?? null
      const calculatedDesired = getNumericByAddress(panelData, [WELL_CALCULATED_DESIRED_ADDRESSES[index]]) ?? getNumeric(panel, WELL_CALCULATED_DESIRED_KEYS[index])
      const actual = getNumericByAddress(panelData, [WELL_FLOW_ADDRESSES[index]]) ?? getNumeric(panel, flowKeys)
      const staticPressure = getNumericByAddress(panelData, [WELL_STATIC_ADDRESSES[index]]) ?? getNumeric(panel, WELL_STATIC_KEYS[index])
      const shortfall = actual != null && desired != null ? Math.max(0, desired - actual) : null
      return {
        wellNumber,
        actual,
        desired,
        calculatedDesired,
        staticPressure,
        shortfall,
        atTarget: meetingState.wells[String(wellNumber)] ?? isWellMeetingTarget(actual, desired, wellTargetPct),
        overshoot: isWellOvershoot(actual, desired, wellTargetPct),
      }
    })

    const totalActual = wells.reduce((sum, well) => sum + (well.actual ?? 0), 0)
    const totalDesiredSite = getNumericByAddress(panelData, [PANEL_ADDRESSES.totalDesiredSiteFlow]) ?? getNumeric(panel, ['Total Desired Site Flow'])
    const totalDesiredFromWells = wells.reduce((sum, well) => sum + (well.desired ?? 0), 0)
    const totalDesired = totalDesiredSite ?? (totalDesiredFromWells > 0 ? totalDesiredFromWells : null)

    const rawUnitDesiredFlows = HALFMANN_UNITS.map((unit, index) => {
      const compressorNumber = UNIT_TO_COMP_NUM[unit.key]
      const unitNumber = unit.label.match(/\d{4}/)?.[0]
      return getNumericByAddress(panelData, [UNIT_DESIRED_FLOW_ADDRESSES[compressorNumber - 1]]) ?? getNumeric(panel, [
        ...(compressorNumber && unitNumber ? [`Compressor #${compressorNumber} Unit ${unitNumber} Desire Flow SP For PID Murphy`] : []),
        ...(compressorNumber ? [`Compressor #${compressorNumber} Desire Flow SP For PID Murphy`, `Compressor ${compressorNumber} Desire Flow SP For PID Murphy`] : []),
      ]) ?? getNumeric(unitMaps[index], [
        'Flow Rate PID Auto Sp',
        'Speed Auto SP Flow',
        'Speed Auto Sp Flow',
        'Desire Flow SP For PID Murphy',
        'Desired Flow SP For PID Murphy',
        'Flow Rate PID SP',
      ])
    })

    const rawUnitActualFlows = HALFMANN_UNITS.map((unit, index) =>
      getNumericByAddress(unitDataRaw[unit.key], UNIT_ADDRESSES.actualFlow) ?? getNumeric(unitMaps[index], ['Flow Rate', 'Flow Rate PID PV', 'Flow Rate PV', 'Flow PID PV']))
    const unitActualFlows = deriveMissingCompressorFlows(rawUnitActualFlows, totalActual, HALFMANN_UNITS)
    const panelUnitCurrentFlowOutputs = HALFMANN_UNITS.map((unit) => {
      const compressorNumber = UNIT_TO_COMP_NUM[unit.key]
      const unitNumber = unit.label.match(/\d{4}/)?.[0]
      return getNumericByAddress(panelData, [UNIT_CURRENT_FLOW_OUTPUT_ADDRESSES[(compressorNumber ?? 1) - 1]]) ?? getNumeric(panel, [
        ...(compressorNumber && unitNumber ? [`Compressor #${compressorNumber} Unit ${unitNumber} Current Flow Output`] : []),
        ...(compressorNumber ? [`Compressor #${compressorNumber} Current Flow Output`, `Compressor ${compressorNumber} Current Flow Output`] : []),
      ])
    })
    const unitSuction = HALFMANN_UNITS.map((unit, index) =>
      getNumericByAddress(unitDataRaw[unit.key], UNIT_ADDRESSES.suctionPressure) ?? getNumeric(unitMaps[index], ['Suction Pressure', 'Stage 1 Suction Prs', 'Suction Prs']))
    const unitSuctionTarget = HALFMANN_UNITS.map((unit, index) =>
      getNumericByAddress(unitDataRaw[unit.key], UNIT_ADDRESSES.loadedAutoSp) ?? getNumeric(unitMaps[index], [
        'Loaded Auto Sp',
        'Loaded Auto SP',
      ]))
    const unitDischarge = HALFMANN_UNITS.map((unit, index) =>
      getNumericByAddress(unitDataRaw[unit.key], UNIT_ADDRESSES.dischargePressure) ?? getNumeric(unitMaps[index], ['Discharge Pressure', 'Stage 3 Discharge Prs', 'Discharge Pressure SP']))
    const unitRpm = HALFMANN_UNITS.map((unit, index) =>
      getNumericByAddress(unitDataRaw[unit.key], UNIT_ADDRESSES.engineSpeed) ?? getNumeric(unitMaps[index], ['RPM', 'Driver Speed', 'Engine Speed', 'ENGINE RPM', 'Engine Speed From EICS']))
    const runningUnits = HALFMANN_UNITS.filter((unit, index) => !unit.standby && unitRpm[index] != null && unitRpm[index] > 100)
    const runningPrimaryCount = runningUnits.length
    const unitDesiredIsDerived = HALFMANN_UNITS.map(() => false)
    const unitDesiredFlows = rawUnitDesiredFlows
    const recommendedCompressors = getNumericByAddress(panelData, [PANEL_ADDRESSES.recommendedCompressors]) ?? getNumeric(panel, ['Recommended Number Of Compressors'])
    const recycleValvePosition = getNumericByAddress(panelData, PANEL_ADDRESSES.recycleValvePosition) ?? getNumeric(panel, ['Recycle Valve Position', 'Recycle Valve', 'RCV Position', 'Station Recycle Header Valve Command Output'])
    const recycleOpen = recycleValvePosition != null ? recycleValvePosition > recycleActiveThresholdPct : null
    const wellheadControlOverride = getNumericByAddress(panelData, [PANEL_ADDRESSES.de4000OverrideLatch]) ?? getNumeric(panel, ['Wellhead Control in Override'])
    const wellheadControlOverrideCompSpeedSp = getNumericByAddress(panelData, [PANEL_ADDRESSES.de4000OverrideCompSpeedSp]) ?? getNumeric(panel, ['Wellhead Control in Override Comp Speed SP'])
    const speedSuctionPressAutoSp = unitMaps.reduce((match, dataMap) => match ?? getNumeric(dataMap, ['Speed - Suction Press PID Auto Sp']), null)
    const compressorMeetingSignals = getPanelCompressorMeetingSignals(panelData, panel)
    const panelCompressorsMeetingFlow = compressorMeetingSignals.effective
    const panelCompressorSignalMismatch =
      compressorMeetingSignals.perCompressor != null &&
      compressorMeetingSignals.broadSummary != null &&
      compressorMeetingSignals.perCompressor !== compressorMeetingSignals.broadSummary
    const lowestSuction = unitSuction.filter((value) => value != null).reduce((min, value) => Math.min(min, value), null)
    const highestDischarge = unitDischarge.filter((value) => value != null).reduce((max, value) => Math.max(max, value), null)
    const panelOverridePressureReached = highestDischarge != null && highestDischarge >= wellPanelDischargeOverrideSetpointPsi
    const compressorSpeedControlActive = highestDischarge != null && highestDischarge >= compressorSpeedControlDischargeSetpointPsi
    const recyclePressureReached = highestDischarge != null && highestDischarge >= recycleDischargeSetpointPsi

    const wellsWithTarget = wells.filter((well) => well.actual != null && well.desired != null)
    const wellsMeetingCount = wellsWithTarget.filter((well) => well.atTarget).length
    const allOnTarget = wellsWithTarget.length > 0 ? wellsMeetingCount === wellsWithTarget.length : null
    const wellsShort = wellsWithTarget.filter((well) => !well.atTarget)
    const sacrificedWells = wellsWithTarget.filter((well) =>
      well.calculatedDesired != null && well.calculatedDesired < well.desired
    )
    const shortfallTotal = wellsShort.reduce((sum, well) => sum + (well.shortfall ?? 0), 0)
    const siteMatchPct = totalDesired != null && totalDesired > 0 ? (totalActual / totalDesired) * 100 : null
    const commandMatchValues = unitDesiredFlows.map((desired, index) => {
      if (HALFMANN_UNITS[index].standby || desired == null || unitActualFlows[index] == null || desired <= 0) return null
      return (unitActualFlows[index] / desired) * 100
    }).filter((value) => value != null)
    const commandMatchAvg = commandMatchValues.length
      ? commandMatchValues.reduce((sum, value) => sum + value, 0) / commandMatchValues.length
      : null
    const suctionMatchValues = HALFMANN_UNITS.map((unit, index) => {
      if (unit.standby) return null
      const target = unitSuctionTarget[index]
      const actual = unitSuction[index]
      const directScore = computePercentMatch(actual, target)
      if (directScore != null) return directScore
      const desiredFlow = unitDesiredFlows[index]
      const panelCurrentFlow = panelUnitCurrentFlowOutputs[index]
      const actualFlow = panelCurrentFlow ?? unitActualFlows[index]
      return computePercentMatch(actualFlow, desiredFlow)
    }).filter((value) => value != null)
    const suctionMatchAvg = suctionMatchValues.length
      ? suctionMatchValues.reduce((sum, value) => sum + value, 0) / suctionMatchValues.length
      : null
    const suctionControllerUnits = HALFMANN_UNITS
      .filter((unit) => !unit.standby)
      .map((unit) => {
        const index = HALFMANN_UNITS.findIndex((entry) => entry.key === unit.key)
        const target = unitSuctionTarget[index]
        const actual = unitSuction[index]
        const desiredFlow = unitDesiredFlows[index]
        const panelCurrentFlow = panelUnitCurrentFlowOutputs[index]
        const actualFlow = panelCurrentFlow ?? unitActualFlows[index]
        const directScore = computePercentMatch(actual, target)
        const fallbackScore = computePercentMatch(actualFlow, desiredFlow)
        const score = directScore ?? fallbackScore
        const displayLines = []
        if (actual != null) displayLines.push(`${formatValue(actual, 1)} suction PSI`)
        if (directScore != null) {
          displayLines.push(`${formatValue(target, 1)} target PSI`)
        } else if (actualFlow != null && desiredFlow != null) {
          displayLines.push(`${formatValue(actualFlow, 2)} actual / ${formatValue(desiredFlow, 2)} command MMSCFD`)
        }
        return {
          key: unit.key,
          label: unit.label,
          actual,
          target,
          score,
          displayLines,
        }
      })
    return {
      timestamp: getTimestamp(panelData),
      wells,
      wellsWithTarget,
      wellsMeetingCount,
      allOnTarget,
      wellsShort,
      sacrificedWells,
      totalActual,
      totalDesired,
      shortfallTotal,
      siteMatchPct,
      lowestSuction,
      unitActualFlows,
      unitDesiredFlows,
      unitDesiredIsDerived,
      unitSuction,
      unitSuctionTarget,
      unitRpm,
      unitDischarge,
      runningUnits,
      recommendedCompressors,
      recycleValvePosition,
      recycleOpen,
      recycleDischargeSetpointPsi,
      recyclePressureReached,
      wellheadControlOverride,
      wellheadControlOverrideCompSpeedSp,
      speedSuctionPressAutoSp,
      wellPanelDischargeOverrideSetpointPsi,
      panelOverridePressureReached,
      compressorSpeedControlDischargeSetpointPsi,
      compressorSpeedControlActive,
      highestDischarge,
      commandMatchAvg,
      suctionMatchAvg,
      suctionControllerUnits,
      panelCompressorsMeetingFlow,
      panelCompressorSignalMismatch,
    }
  }, [panelData, unitDataRaw, siteSettings.wellTargetPct, siteSettings?.derivedTriggerSettings, meetingState.wells])

  const diagnosis = buildDiagnosis(derived)
  const pageTime = derived.timestamp ?? lastRefresh
  const diagnosisNeeded = Boolean(
    derived.wellsShort.length > 0 ||
    derived.recycleOpen === true ||
    derived.recyclePressureReached === true ||
    (derived.wellheadControlOverride != null && derived.wellheadControlOverride > 0) ||
    derived.panelOverridePressureReached === true ||
    derived.compressorSpeedControlActive === true ||
    (derived.panelCompressorsMeetingFlow === false && derived.wellsShort.length > 0) ||
    liveError ||
    commsStatus?.isHolding,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 48px)', background: '#080810' }}>
      <header style={{ display: 'flex', flexDirection: isNarrow ? 'column' : 'row', alignItems: isNarrow ? 'stretch' : 'center', justifyContent: 'space-between', gap: 12, padding: isNarrow ? '12px 14px' : '14px 20px', borderBottom: '1px solid #1a1a2a', background: '#0c0c16' }}>
        <div>
          <div style={{ fontSize: 14, color: '#fff', fontWeight: 900, fontFamily: "'Arial Black', sans-serif" }}>Diagnostics - Halfmann 1214</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>Operator view first. Engineering evidence only when you open it.</div>
        </div>
        <div style={{ display: 'flex', alignItems: isNarrow ? 'stretch' : 'center', flexDirection: isNarrow ? 'column' : 'row', gap: 10 }}>
          <div style={{ display: 'inline-flex', width: isNarrow ? '100%' : 'auto', borderRadius: 999, border: '1px solid rgba(73,208,226,0.22)', overflow: 'hidden' }}>
            <button
              onClick={() => setViewMode('operations')}
              style={{ ...modeButtonStyle(viewMode === 'operations'), flex: isNarrow ? 1 : '0 0 auto' }}
            >
              Operations View
            </button>
            <button
              onClick={() => setViewMode('engineering')}
              style={{ ...modeButtonStyle(viewMode === 'engineering'), flex: isNarrow ? 1 : '0 0 auto' }}
            >
              Engineering Diagnostics
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: isNarrow ? 'space-between' : 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <CommsIndicator commsStatus={commsStatus} />
            {pageTime && <span style={{ fontSize: 10, color: '#64748b' }}>Updated {pageTime.toLocaleTimeString()}</span>}
            <button
              onClick={refresh}
              disabled={loading}
              style={{
                border: '1px solid #253449',
                background: '#131d2e',
                color: loading ? '#64748b' : '#bfdbfe',
                borderRadius: 10,
                padding: '8px 12px',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                cursor: loading ? 'default' : 'pointer',
              }}
            >
              {loading ? `Refreshing ${countdown}s` : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 28px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          {liveError && (
            <div style={{ marginBottom: 16, border: '1px solid #7a1a1a', background: '#1b0d0d', borderRadius: 14, padding: '12px 14px', fontSize: 11, color: '#fecaca' }}>
              {liveError}
            </div>
          )}
          {commsStatus?.message && (
            <div style={{
              marginBottom: 16,
              border: `1px solid ${commsStatus?.isHolding ? '#8a5b10' : '#5d4b12'}`,
              background: commsStatus?.isHolding ? '#171207' : '#17140a',
              borderRadius: 14,
              padding: '12px 14px',
              fontSize: 11,
              color: commsStatus?.isHolding ? '#fef3c7' : '#fde68a',
            }}>
              {commsStatus.message}
            </div>
          )}

          <OperatorCallout diagnosis={diagnosis} />

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isNarrow ? 160 : 220}px, 1fr))`, gap: 14, marginBottom: 20 }}>
            <SummaryCard
              label="Wells Meeting"
              value={`${derived.wellsMeetingCount}/${derived.wellsWithTarget.length || derived.wells.length}`}
              sub={`Only flagged low if more than ${TARGET_TOLERANCE_PCT}% below target`}
              tone={derived.allOnTarget ? 'good' : derived.wellsShort.length > 0 ? 'warn' : 'neutral'}
            />
            <SummaryCard
              label="Total Actual Flow"
              value={`${formatValue(derived.totalActual)} MMSCFD`}
              sub={derived.totalDesired != null ? `${formatPct(derived.siteMatchPct)} of desired` : 'Desired total not visible'}
              tone={derived.siteMatchPct != null && derived.siteMatchPct >= 95 ? 'good' : derived.siteMatchPct != null ? 'warn' : 'neutral'}
            />
            <SummaryCard
              label="Total Desired Flow"
              value={`${formatValue(derived.totalDesired)} MMSCFD`}
              sub={`Total shortfall ${formatValue(derived.shortfallTotal)} MMSCFD`}
              tone="neutral"
            />
            <SummaryCard
              label="Recycle Valve"
              value={derived.recycleValvePosition != null ? `${formatValue(derived.recycleValvePosition, 1)}%` : '--'}
              sub={derived.recycleOpen == null
                ? `Valve position not visible | Manual recycle trigger ${formatValue(derived.recycleDischargeSetpointPsi, 0)} PSI`
                : derived.recycleOpen
                  ? `Open | Manual recycle trigger ${formatValue(derived.recycleDischargeSetpointPsi, 0)} PSI`
                  : `Closed | Manual recycle trigger ${formatValue(derived.recycleDischargeSetpointPsi, 0)} PSI`}
              tone={derived.recycleOpen || derived.recyclePressureReached ? 'bad' : derived.recycleOpen === false ? 'good' : 'neutral'}
            />
            <SummaryCard
              label="DE4000 Override Latch"
              value={derived.wellheadControlOverride != null ? (derived.wellheadControlOverride > 0 ? 'YES' : 'NO') : '--'}
              sub={derived.wellheadControlOverride != null
                ? `Wellhead Control in Override = ${formatValue(derived.wellheadControlOverride, 0)} | Manual panel override ${formatValue(derived.wellPanelDischargeOverrideSetpointPsi, 0)} PSI${derived.wellheadControlOverrideCompSpeedSp != null ? ` | Override Comp Speed SP ${formatValue(derived.wellheadControlOverrideCompSpeedSp, 0)}` : ''}`
                : `Wellhead Control in Override not visible | Manual panel override ${formatValue(derived.wellPanelDischargeOverrideSetpointPsi, 0)} PSI`}
              tone={derived.wellheadControlOverride == null ? (derived.panelOverridePressureReached ? 'warn' : 'neutral') : derived.wellheadControlOverride > 0 ? 'bad' : derived.panelOverridePressureReached ? 'warn' : 'good'}
            />
            <SummaryCard
              label="Discharge Pressure Site"
              value={derived.highestDischarge != null ? `${formatValue(derived.highestDischarge, 0)} PSI` : '--'}
              sub={derived.highestDischarge == null
                ? 'Live site discharge pressure reading'
                : derived.recyclePressureReached || derived.recycleOpen
                  ? `At/above station recycle trigger ${formatValue(derived.recycleDischargeSetpointPsi, 0)} PSI`
                  : derived.compressorSpeedControlActive
                    ? `At/above compressor speed-control trigger ${formatValue(derived.compressorSpeedControlDischargeSetpointPsi, 0)} PSI`
                    : derived.wellheadControlOverride > 0 || derived.panelOverridePressureReached
                      ? `At/above well panel override trigger ${formatValue(derived.wellPanelDischargeOverrideSetpointPsi, 0)} PSI`
                      : `Below manual pressure protection triggers (${formatValue(derived.wellPanelDischargeOverrideSetpointPsi, 0)} / ${formatValue(derived.compressorSpeedControlDischargeSetpointPsi, 0)} / ${formatValue(derived.recycleDischargeSetpointPsi, 0)} PSI)`}
              tone={derived.recyclePressureReached || derived.recycleOpen ? 'bad' : derived.compressorSpeedControlActive ? 'warn' : derived.wellheadControlOverride > 0 ? 'bad' : derived.panelOverridePressureReached ? 'warn' : 'neutral'}
            />
            <SuctionControllerCard
              score={derived.suctionMatchAvg}
              units={derived.suctionControllerUnits}
              isNarrow={isNarrow}
              tone={derived.suctionMatchAvg != null && derived.suctionMatchAvg >= 95 ? 'good' : derived.suctionMatchAvg != null ? 'warn' : 'neutral'}
            />
            <SummaryCard
              label="Compressors Meeting Flow"
              value={derived.panelCompressorsMeetingFlow == null ? '--' : derived.panelCompressorsMeetingFlow ? 'YES' : 'NO'}
              sub={derived.panelCompressorsMeetingFlow == null
                ? 'Compressors Meeting Flow Demand not visible'
                : derived.wellsShort.length === 0 && derived.panelCompressorsMeetingFlow === false
                  ? 'Panel says NO, but no wells are short, so this is monitor-only for now'
                : derived.panelCompressorSignalMismatch
                  ? 'Direct compressor bits say YES, but one panel summary bit says NO'
                  : 'Direct panel signal from M-Link'}
              tone={derived.panelCompressorsMeetingFlow == null ? 'neutral' : derived.panelCompressorsMeetingFlow ? 'good' : derived.wellsShort.length > 0 ? 'bad' : 'neutral'}
            />
          </div>

          {!diagnosisNeeded && viewMode === 'operations' ? (
            <div style={{ marginTop: 4, border: '1px solid #1d6c3d', background: '#0b1a12', borderRadius: 18, padding: '18px 20px' }}>
              <div style={{ fontSize: 10, color: '#49D0E2', fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 8 }}>
                Operations Summary
              </div>
              <div style={{ fontSize: 24, color: '#4ade80', fontWeight: 900, lineHeight: 1.1, fontFamily: "'Arial Black', sans-serif", marginBottom: 10 }}>
                Nothing to diagnose.
              </div>
              <div style={{ fontSize: 13, color: '#d1fae5', lineHeight: 1.7 }}>
                Wells are on target. No recycle or discharge-protection issue is active, so no diagnostic follow-up is needed right now.
              </div>
            </div>
          ) : (
            <>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${isNarrow ? 260 : 320}px, 1fr))`, gap: 18 }}>
            <div style={{ border: '1px solid #1f3650', background: '#0d1726', borderRadius: 18, padding: '16px 18px' }}>
              <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
                Wells To Watch
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {derived.wells.map((well) => <WellRow key={well.wellNumber} well={well} />)}
              </div>
            </div>

            <div style={{ border: '1px solid #1f3650', background: '#0d1726', borderRadius: 18, padding: '16px 18px' }}>
              <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
                Compressor Check
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {HALFMANN_UNITS.map((unit, index) => {
                  const directFlowMissing = unit.key === 'unit2129' && getNumericByAddress(unitDataRaw[unit.key], UNIT_ADDRESSES.actualFlow) == null
                  return (
                    <UnitRow
                      key={unit.key}
                      unit={unit}
                      actualFlow={derived.unitActualFlows[index]}
                      desiredFlow={derived.unitDesiredFlows[index]}
                      suctionActual={derived.unitSuction[index]}
                      suctionTarget={derived.unitSuctionTarget[index]}
                      rpm={derived.unitRpm[index]}
                      discharge={derived.unitDischarge[index]}
                      derivedFlow={directFlowMissing}
                    />
                  )
                })}
              </div>
            </div>
          </div>

          {viewMode === 'engineering' ? (
          <div style={{ marginTop: 18, border: '1px solid #1f3650', background: '#0d1726', borderRadius: 18, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
              Accuracy Rule
            </div>
            {false && <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.75 }}>
              This page is intentionally simple. It picks the most likely operator-level reason in this order:
              high discharge pressure first, then recycle open, then not enough compressors online, then well-priority / sacrifice pattern,
              and finally a general “need more compressor flow” diagnosis if nothing else is stronger.
            </div>}
            <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.75 }}>
              This page only states causes that are supported by the live data shown here. It only calls a well sacrificed when that well
              calculated desired flow is below that well customer target setpoint.
            </div>
          </div>
          ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function modeButtonStyle(active) {
  return {
    border: 'none',
    background: active ? 'linear-gradient(180deg, rgba(73,208,226,0.22) 0%, rgba(73,208,226,0.08) 100%)' : 'rgba(6,10,18,0.9)',
    color: active ? '#7dd3fc' : '#8ca0be',
    padding: '9px 14px',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}
