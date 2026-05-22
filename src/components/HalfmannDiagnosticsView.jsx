import { useState, useEffect, useCallback, useMemo } from 'react'
import { findRegisterDatapoint, parseLiveDatapoints } from '../engine/liveRegisters'
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

const HALFMANN_WELL_SETPOINT_FALLBACKS = [1.225, 1.1, 1.45, 1.0, 1.35]
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

function UnitRow({ unit, actualFlow, desiredFlow, desiredFlowDerived, suctionActual, suctionTarget, rpm, discharge, derivedFlow }) {
  const running = rpm != null && rpm > 100
  return (
    <div style={{ border: '1px solid #1f3650', background: '#0a1220', borderRadius: 14, padding: '12px 14px', display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 14, alignItems: 'center' }}>
      <div style={{ fontSize: 13, color: '#fff', fontWeight: 800 }}>{unit.label}{unit.standby ? ' (Standby)' : ''}</div>
        <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.65 }}>
        Flow {formatValue(actualFlow)} actual / {formatValue(desiredFlow)} desired MMSCFD
        {desiredFlowDerived ? ' | desired derived from total site target' : ''}
        {derivedFlow ? ' | actual derived from site balance' : ''}
        <br />
        Suction {formatValue(suctionActual, 1)} actual / {formatValue(suctionTarget, 1)} Loaded Auto Sp PSI
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
  dischargeTrigger,
  recycleOpen,
  recycleValvePosition,
  runningUnits,
  recommendedCompressors,
  commandMatchAvg,
  speedSuctionPressAutoSp,
  speedDischargePressAutoSp,
}) {
  if (allOnTarget) {
    return {
      tone: 'good',
      headline: 'Meeting rate',
      reason: 'All wells with targets are at or above 95% of setpoint.',
      evidence: `${formatValue(totalActual)} actual vs ${formatValue(totalDesired)} desired. ${wellsShort.length} wells are short.`,
      action: 'No action needed right now. Keep watching discharge pressure and recycle position.',
    }
  }

  if (wellsShort.length === 0) {
    return {
      tone: 'neutral',
      headline: 'Need more live target data',
      reason: 'The page cannot fully judge the pad until it has live well target data for every well.',
      evidence: 'Flow is visible, but at least some target comparison is still using confirmed fallback targets.',
      action: 'Use the target numbers shown here for now, then verify the panel target registers stay visible in MLink.',
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

  if (speedDischargePressAutoSp != null && highestDischarge != null && highestDischarge >= speedDischargePressAutoSp) {
    return {
      tone: 'bad',
      headline: 'Not meeting rate because discharge protection is slowing units down',
      reason: 'At least one compressor is at or above its discharge slow-down target, so the panel protects discharge pressure before it chases flow.',
      evidence: `Highest site discharge is ${formatValue(highestDischarge, 0)} PSI and the high-discharge slow-down target is ${formatValue(speedDischargePressAutoSp, 0)} PSI. Short wells: ${wellsShort.map((well) => `W${well.wellNumber}`).join(', ')}.`,
      action: 'Check discharge pressure and downstream restriction before changing well targets.',
    }
  }

  if (dischargeTrigger != null && highestDischarge != null && highestDischarge >= dischargeTrigger) {
    return {
      tone: 'bad',
      headline: 'Not meeting rate because discharge pressure is too high',
      reason: 'The panel is likely pulling flow back to protect discharge pressure before it tries to feed the short wells.',
      evidence: `Highest site discharge is ${formatValue(highestDischarge, 0)} PSI and the unit high-discharge slow-down target is ${formatValue(speedDischargePressAutoSp ?? dischargeTrigger, 0)} PSI. Short wells: ${wellsShort.map((well) => `W${well.wellNumber}`).join(', ')}.`,
      action: 'Look at discharge pressure first. Do not chase well flow until the high discharge condition clears.',
    }
  }

  if (recycleOpen === true) {
    return {
      tone: 'warn',
      headline: 'Not meeting rate because the recycle valve is open',
      reason: 'Gas is being recirculated instead of all of it going to the wells.',
      evidence: `Recycle valve is at ${formatValue(recycleValvePosition, 1)}%. Short wells: ${wellsShort.map((well) => `W${well.wellNumber}`).join(', ')}.`,
      action: 'Find out why recycle is open. Until it closes, some gas is not reaching the wells.',
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

  return {
    tone: 'warn',
    headline: 'Not meeting rate and no specific limiting condition is proven yet',
    reason: 'The wells are short, but this page does not currently prove suction slow-down, discharge slow-down, recycle-open loss, too few compressors online, or panel sacrifice.',
    evidence: `${formatValue(totalActual)} actual vs ${formatValue(totalDesired)} desired. Average compressor flow match is ${commandMatchAvg != null ? formatPct(commandMatchAvg) : 'not visible'}. Low-suction slow-down target is ${formatValue(speedSuctionPressAutoSp, 1)} PSI and high-discharge slow-down target is ${formatValue(speedDischargePressAutoSp, 0)} PSI.`,
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

  const derived = useMemo(() => {
    const panel = parseLiveDatapoints(panelData)
    const unitMaps = HALFMANN_UNITS.map((unit) => parseLiveDatapoints(unitDataRaw[unit.key]))
    const wellTargetPct = Number(siteSettings.wellTargetPct) || TARGET_TOLERANCE_PCT

    const wells = WELL_FLOW_KEYS.map((flowKeys, index) => {
      const wellNumber = index + 1
      const desiredDatapoint = resolveDatapoint(panel, WELL_SETPOINT_KEYS[index])
      const desired = parseNumeric(desiredDatapoint?.value) ?? HALFMANN_WELL_SETPOINT_FALLBACKS[index] ?? null
      const calculatedDesired = getNumeric(panel, WELL_CALCULATED_DESIRED_KEYS[index])
      const actual = getNumeric(panel, flowKeys)
      const staticPressure = getNumeric(panel, WELL_STATIC_KEYS[index])
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
    const totalDesiredSite = getNumeric(panel, ['Total Desired Site Flow'])
    const totalDesiredFromWells = wells.reduce((sum, well) => sum + (well.desired ?? 0), 0)
    const totalDesired = totalDesiredSite ?? (totalDesiredFromWells > 0 ? totalDesiredFromWells : null)

    const rawUnitDesiredFlows = HALFMANN_UNITS.map((unit, index) => {
      const compressorNumber = UNIT_TO_COMP_NUM[unit.key]
      const unitNumber = unit.label.match(/\d{4}/)?.[0]
      return getNumeric(panel, [
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

    const rawUnitActualFlows = unitMaps.map((dataMap) => getNumeric(dataMap, ['Flow Rate', 'Flow Rate PID PV', 'Flow Rate PV', 'Flow PID PV']))
    const unitActualFlows = deriveMissingCompressorFlows(rawUnitActualFlows, totalActual, HALFMANN_UNITS)
    const unitSuction = unitMaps.map((dataMap) => getNumeric(dataMap, ['Suction Pressure', 'Stage 1 Suction Prs', 'Suction Prs']))
    const unitSuctionTarget = unitMaps.map((dataMap) => getNumeric(dataMap, [
      'Loaded Auto Sp',
      'Loaded Auto SP',
      'Loaded Auto Sp:',
      'Loaded Auto SP:',
      'Loaded AutoSp',
      'Loaded AutoSP',
      'Auto Loaded Sp',
      'Auto Loaded SP',
      'Auto Load Sp',
      'Auto Load SP',
    ]))
    const unitDischarge = unitMaps.map((dataMap) => getNumeric(dataMap, ['Discharge Pressure', 'Stage 3 Discharge Prs', 'Discharge Pressure SP']))
    const unitRpm = unitMaps.map((dataMap) => getNumeric(dataMap, ['RPM', 'Driver Speed', 'Engine Speed', 'ENGINE RPM', 'Engine Speed From EICS']))
    const runningUnits = HALFMANN_UNITS.filter((unit, index) => !unit.standby && unitRpm[index] != null && unitRpm[index] > 100)
    const runningPrimaryCount = runningUnits.length
    const derivedDesiredPerRunningUnit = totalDesired != null && runningPrimaryCount > 0 ? totalDesired / runningPrimaryCount : null
    const unitDesiredIsDerived = HALFMANN_UNITS.map((unit, index) =>
      !unit.standby && rawUnitDesiredFlows[index] == null && unitRpm[index] != null && unitRpm[index] > 100 && derivedDesiredPerRunningUnit != null
    )
    const unitDesiredFlows = HALFMANN_UNITS.map((unit, index) =>
      rawUnitDesiredFlows[index] ?? (unitDesiredIsDerived[index] ? derivedDesiredPerRunningUnit : null)
    )
    const recommendedCompressors = getNumeric(panel, ['Recommended Number Of Compressors'])
    const recycleValvePosition = getNumeric(panel, ['Recycle Valve Position', 'Recycle Valve', 'RCV Position', 'Station Recycle Header Valve Command Output'])
    const recycleOpen = recycleValvePosition != null ? recycleValvePosition > 5 : null
    const dischargeTrigger = getNumeric(panel, ['Altronic Discharge Pressure Trigger', 'Discharge Trigger SP', 'Speed Auto Discharge SP'])
      ?? unitMaps.reduce((match, dataMap) => match ?? getNumeric(dataMap, ['Speed Auto Discharge SP', 'Altronic Speed Control SP', 'Speed Control SP']), null)
    const speedSuctionPressAutoSp = unitMaps.reduce((match, dataMap) => match ?? getNumeric(dataMap, ['Speed - Suction Press PID Auto Sp']), null)
    const speedDischargePressAutoSp = unitMaps.reduce((match, dataMap) => match ?? getNumeric(dataMap, ['Speed - Discharge Press PID Auto Sp']), null)
    const lowestSuction = unitSuction.filter((value) => value != null).reduce((min, value) => Math.min(min, value), null)
    const highestDischarge = unitDischarge.filter((value) => value != null).reduce((max, value) => Math.max(max, value), null)

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
    const suctionMatchValues = unitSuctionTarget.map((target, index) => {
      if (HALFMANN_UNITS[index].standby || target == null || unitSuction[index] == null || target <= 0) return null
      return Math.max(0, 100 - (Math.abs(unitSuction[index] - target) / target) * 100)
    }).filter((value) => value != null)
    const suctionMatchAvg = suctionMatchValues.length
      ? suctionMatchValues.reduce((sum, value) => sum + value, 0) / suctionMatchValues.length
      : null
    const suctionComparisonLines = HALFMANN_UNITS
      .filter((unit) => !unit.standby)
      .map((unit) => {
        const index = HALFMANN_UNITS.findIndex((entry) => entry.key === unit.key)
        return `${unit.label}: ${formatValue(unitSuction[index], 1)} actual / ${formatValue(unitSuctionTarget[index], 1)} target PSI`
      })
      .join('\n')

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
      dischargeTrigger,
      speedSuctionPressAutoSp,
      speedDischargePressAutoSp,
      highestDischarge,
      commandMatchAvg,
      suctionMatchAvg,
      suctionComparisonLines,
    }
  }, [panelData, unitDataRaw, siteSettings.wellTargetPct, meetingState.wells])

  const diagnosis = buildDiagnosis(derived)
  const pageTime = derived.timestamp ?? lastRefresh

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 48px)', background: '#080810' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: '1px solid #1a1a2a', background: '#0c0c16' }}>
        <div>
          <div style={{ fontSize: 14, color: '#fff', fontWeight: 900, fontFamily: "'Arial Black', sans-serif" }}>Diagnostics - Halfmann 1214</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>Simple operator page: what is wrong, why it is wrong, and what to check next</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
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
              sub={derived.recycleOpen == null ? 'Valve position not visible' : derived.recycleOpen ? 'Open' : 'Closed'}
              tone={derived.recycleOpen ? 'bad' : derived.recycleOpen === false ? 'good' : 'neutral'}
            />
            <SummaryCard
              label="Discharge Pressure Site"
              value={derived.highestDischarge != null ? `${formatValue(derived.highestDischarge, 0)} PSI` : '--'}
              sub={derived.speedDischargePressAutoSp != null ? `Unit slow-down target ${formatValue(derived.speedDischargePressAutoSp, 0)} PSI` : derived.dischargeTrigger != null ? `Panel trigger ${formatValue(derived.dischargeTrigger, 0)} PSI` : 'Slow-down target not visible'}
              tone={derived.highestDischarge != null && ((derived.speedDischargePressAutoSp != null && derived.highestDischarge >= derived.speedDischargePressAutoSp) || (derived.dischargeTrigger != null && derived.highestDischarge >= derived.dischargeTrigger)) ? 'bad' : 'neutral'}
            />
            <SummaryCard
              label="Suction Controller Score"
              value={derived.suctionMatchAvg != null ? `${formatPct(derived.suctionMatchAvg, 0)}` : '--'}
              sub={derived.suctionComparisonLines || (derived.speedSuctionPressAutoSp != null ? `Low-suction slow-down target ${formatValue(derived.speedSuctionPressAutoSp, 1)} PSI` : 'Loaded Auto Sp not visible')}
              tone={derived.suctionMatchAvg != null && derived.suctionMatchAvg >= 95 ? 'good' : derived.suctionMatchAvg != null ? 'warn' : 'neutral'}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
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
                  const directFlowMissing = unit.key === 'unit2129' && getNumeric(parseLiveDatapoints(unitDataRaw[unit.key]), ['Flow Rate', 'Flow Rate PID PV']) == null
                  return (
                    <UnitRow
                      key={unit.key}
                      unit={unit}
                      actualFlow={derived.unitActualFlows[index]}
                      desiredFlow={derived.unitDesiredFlows[index]}
                      desiredFlowDerived={derived.unitDesiredIsDerived[index]}
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
        </div>
      </div>
    </div>
  )
}
