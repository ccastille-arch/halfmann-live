import { useState, useEffect, useCallback, useMemo } from 'react'
import { findRegisterDatapoint, parseLiveDatapoints } from '../engine/liveRegisters'

const API_BASE = import.meta.env.VITE_API_URL || ''
const REFRESH_INTERVAL_S = 60

const HALFMANN_DEVICES = {
  panel: '2507-501508',
  unit2130: '2507-500709',
  unit2127: '2504-504108',
  unit2129: '2504-504102',
  unit2128: '2507-500076',
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
  `Wellhead #${n} Calculated Desired Flow`,
  `Wellhead #${n} Setpoint From Customer PLC`,
  `Well ${n} Calculated Desired Flow`,
  `Well ${n} Setpoint From Customer PLC`,
  `Well ${n} Setpoint`,
])

const WELL_STATIC_KEYS = [1, 2, 3, 4, 5].map((n) => [
  `Wellhead #${n} Injection Static Pressure From Customer PLC`,
  `Wellhead #${n} Injection Static Pressure`,
  `Well ${n} Static Pressure`,
])

const HALFMANN_WELL_SETPOINT_FALLBACKS = [1.225, 1.1, 1.45, 1.0, 1.35]

const UNIT_TO_COMP_NUM = { unit2128: 1, unit2130: 2, unit2127: 3, unit2129: 4 }

const DOC_RULES = [
  'Well decisions should be based on individual well flow meters, not compressor current flow rate.',
  'Discharge override takes precedence over increasing well flow demand.',
  'Well sacrifice should be the last resort and only after compressor capacity is exhausted.',
  'Compressors coming online should not steal flow command from loaded units until they are online and loaded.',
  'If wells are short and discharge is not in override, the panel should bump compressor commands in step changes.',
]

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

function withinPct(actual, desired, pct = 5) {
  if (actual == null || desired == null || desired <= 0) return false
  return Math.abs(actual - desired) <= desired * (pct / 100)
}

function cleanUnit(unit) {
  if (!unit) return ''
  return unit.replace(/Ã‚Â°/g, 'Â°').replace(/Ãƒâ€š/g, '').replace(/Â°/g, '°').trim()
}

function formatValue(value, decimals = 3) {
  return value != null && Number.isFinite(value) ? value.toFixed(decimals) : '--'
}

function formatPct(value, decimals = 1) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)}%` : '--'
}

function getNodePalette(status) {
  if (status === 'good') return { border: '#1d6c3d', bg: '#0b1a12', title: '#4ade80', body: '#d1fae5', muted: '#86efac' }
  if (status === 'warn') return { border: '#8a5b10', bg: '#171207', title: '#fbbf24', body: '#fef3c7', muted: '#fcd34d' }
  if (status === 'bad') return { border: '#7a1a1a', bg: '#1b0d0d', title: '#f87171', body: '#fee2e2', muted: '#fca5a5' }
  return { border: '#24324a', bg: '#101827', title: '#93c5fd', body: '#dbeafe', muted: '#94a3b8' }
}

function FlowNode({ title, value, detail, evidence = [], status = 'neutral', kind = 'inferred' }) {
  const palette = getNodePalette(status)
  return (
    <div style={{
      border: `1px solid ${palette.border}`,
      background: palette.bg,
      borderRadius: 18,
      padding: '16px 16px 14px',
      minHeight: 168,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      boxShadow: status === 'good' ? '0 0 24px #1d6c3d22' : status === 'warn' ? '0 0 24px #8a5b1022' : status === 'bad' ? '0 0 24px #7a1a1a22' : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#49D0E2' }}>{title}</div>
        <span style={{
          border: `1px solid ${palette.border}`,
          borderRadius: 999,
          padding: '2px 8px',
          fontSize: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: palette.muted,
          whiteSpace: 'nowrap',
        }}>
          {kind}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color: palette.title, lineHeight: 1.05, fontFamily: "'Arial Black', sans-serif" }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: palette.body, lineHeight: 1.55 }}>
        {detail}
      </div>
      {evidence.length > 0 && (
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {evidence.map((item) => (
            <div key={item} style={{ fontSize: 9, color: palette.muted, lineHeight: 1.45 }}>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BranchLine() {
  return <div style={{ width: 2, height: 24, background: 'linear-gradient(180deg, #1f3650 0%, #28496b 100%)', margin: '0 auto' }} />
}

function DiagnosticBadge({ label, value, tone = '#49D0E2' }) {
  return (
    <div style={{
      border: '1px solid #1f3650',
      background: '#0b1220',
      borderRadius: 12,
      padding: '10px 12px',
      minWidth: 130,
    }}>
      <div style={{ fontSize: 8, color: '#7a8fb0', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: tone, fontFamily: "'Arial Black', sans-serif" }}>{value}</div>
    </div>
  )
}

export default function HalfmannDiagnosticsView() {
  const [panelData, setPanelData] = useState(null)
  const [unitDataRaw, setUnitDataRaw] = useState({ unit2130: null, unit2127: null, unit2128: null, unit2129: null, unit1396: null })
  const [loading, setLoading] = useState(true)
  const [liveError, setLiveError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_S)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLiveError('')
    const [panelResult, ...unitResults] = await Promise.all([
      fetchDeviceFull(HALFMANN_DEVICES.panel),
      ...HALFMANN_UNITS.map((unit) => fetchDeviceFull(unit.deviceId)),
    ])

    setPanelData(panelResult.data)
    const nextUnits = {}
    HALFMANN_UNITS.forEach((unit, index) => { nextUnits[unit.key] = unitResults[index].data })
    setUnitDataRaw(nextUnits)

    const allNull = !panelResult.data && unitResults.every((result) => !result.data)
    if (allNull) {
      const errors = [panelResult.error, ...unitResults.map((result) => result.error)].filter(Boolean)
      setLiveError(errors.length ? `No live MLink data available. ${errors.join(' | ')}` : 'No live MLink data available.')
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
    const tick = setInterval(() => setCountdown((current) => (current > 0 ? current - 1 : REFRESH_INTERVAL_S)), 1000)
    return () => clearInterval(tick)
  }, [])

  const derived = useMemo(() => {
    const panel = parseLiveDatapoints(panelData)
    const unitMaps = HALFMANN_UNITS.map((unit) => parseLiveDatapoints(unitDataRaw[unit.key]))
    const tolerancePct = 5

    const wells = WELL_FLOW_KEYS.map((flowKeys, index) => {
      const wellNumber = index + 1
      const desiredDatapoint = resolveDatapoint(panel, WELL_SETPOINT_KEYS[index])
      const desired = parseNumeric(desiredDatapoint?.value) ?? HALFMANN_WELL_SETPOINT_FALLBACKS[index] ?? null
      const actual = getNumeric(panel, flowKeys)
      const staticPressure = getNumeric(panel, WELL_STATIC_KEYS[index])
      const shortfall = actual != null && desired != null ? Math.max(0, desired - actual) : null
      const pctOfTarget = actual != null && desired != null && desired > 0 ? (actual / desired) * 100 : null
      return {
        wellNumber,
        actual,
        desired,
        desiredSource: desiredDatapoint ? 'feed' : (HALFMANN_WELL_SETPOINT_FALLBACKS[index] != null ? 'confirmed fallback' : null),
        staticPressure,
        shortfall,
        pctOfTarget,
        atTarget: withinPct(actual, desired, tolerancePct),
      }
    })

    const totalActual = wells.reduce((sum, well) => sum + (well.actual ?? 0), 0)
    const totalDesiredSite = getNumeric(panel, ['Total Desired Site Flow'])
    const totalDesiredFromWells = wells.reduce((sum, well) => sum + (well.desired ?? 0), 0)
    const totalDesired = totalDesiredSite ?? (totalDesiredFromWells > 0 ? totalDesiredFromWells : null)

    const unitDesiredFlows = HALFMANN_UNITS.map((unit, index) => {
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
    const unitDischarge = unitMaps.map((dataMap) => getNumeric(dataMap, ['Discharge Pressure', 'Stage 3 Discharge Prs', 'Discharge Pressure SP']))
    const unitRpm = unitMaps.map((dataMap) => getNumeric(dataMap, ['RPM', 'Driver Speed', 'Engine Speed', 'ENGINE RPM', 'Engine Speed From EICS']))
    const runningUnits = HALFMANN_UNITS.filter((unit, index) => !unit.standby && unitRpm[index] != null && unitRpm[index] > 100)
    const recommendedCompressors = getNumeric(panel, ['Recommended Number Of Compressors'])
    const recycleValvePosition = getNumeric(panel, ['Recycle Valve Position', 'Recycle Valve', 'RCV Position', 'Station Recycle Header Valve Command Output'])
    const recycleOpenThreshold = 5
    const recycleOpen = recycleValvePosition != null ? recycleValvePosition > recycleOpenThreshold : null
    const dischargeTrigger = getNumeric(panel, ['Altronic Discharge Pressure Trigger', 'Discharge Trigger SP', 'Speed Auto Discharge SP'])
      ?? unitMaps.reduce((match, dataMap) => match ?? getNumeric(dataMap, ['Speed Auto Discharge SP', 'Altronic Speed Control SP', 'Speed Control SP']), null)
    const highestDischarge = unitDischarge.filter((value) => value != null).reduce((max, value) => Math.max(max, value), null)
    const highestStatic = wells.filter((well) => well.staticPressure != null).reduce((max, well) => Math.max(max, well.staticPressure), null)

    const wellsWithTarget = wells.filter((well) => well.actual != null && well.desired != null)
    const wellsMeetingCount = wellsWithTarget.filter((well) => well.atTarget).length
    const allOnTarget = wellsWithTarget.length > 0 ? wellsMeetingCount === wellsWithTarget.length : null
    const wellsShort = wellsWithTarget.filter((well) => !well.atTarget)
    const shortfallTotal = wellsShort.reduce((sum, well) => sum + (well.shortfall ?? 0), 0)
    const siteMatchPct = totalDesired != null && totalDesired > 0 ? (totalActual / totalDesired) * 100 : null
    const compressorsWithCommands = unitDesiredFlows.filter((value, index) => !HALFMANN_UNITS[index].standby && value != null).length
    const loadedCommandCoverage = compressorsWithCommands > 0
      ? unitDesiredFlows
          .map((desired, index) => {
            if (HALFMANN_UNITS[index].standby || desired == null || unitActualFlows[index] == null || desired <= 0) return null
            return (unitActualFlows[index] / desired) * 100
          })
          .filter((value) => value != null)
      : []
    const commandMatchAvg = loadedCommandCoverage.length
      ? loadedCommandCoverage.reduce((sum, value) => sum + value, 0) / loadedCommandCoverage.length
      : null

    const dischargeLimited = dischargeTrigger != null && highestDischarge != null && highestDischarge >= dischargeTrigger
    const notEnoughLoadedCompressors = recommendedCompressors != null && runningUnits.length < recommendedCompressors
    const likelySacrifice = !!(
      wellsShort.length > 0 &&
      siteMatchPct != null &&
      siteMatchPct >= 96 &&
      recycleOpen === false &&
      !dischargeLimited
    )
    const needsLowFlowOverride = !!(
      wellsShort.length > 0 &&
      !dischargeLimited &&
      recycleOpen === false &&
      siteMatchPct != null &&
      siteMatchPct < 96
    )

    let primaryDiagnosis = {
      title: 'System healthy',
      value: 'All wells are meeting target',
      detail: 'Every well with a target is within 5% of desired flow right now.',
      status: 'good',
      kind: 'direct',
      evidence: [
        `${wellsMeetingCount} of ${wellsWithTarget.length} wells are within 5%`,
        `Total actual ${formatValue(totalActual)} vs desired ${formatValue(totalDesired)}`,
      ],
    }

    if (allOnTarget === null) {
      primaryDiagnosis = {
        title: 'Not enough target evidence',
        value: 'Target comparison is partially inferred',
        detail: 'The tree is using confirmed fallback well targets where live setpoint registers are still absent.',
        status: 'neutral',
        kind: 'inferred',
        evidence: [
          `${wells.filter((well) => well.desiredSource === 'feed').length} well setpoints came from live feed`,
          `${wells.filter((well) => well.desiredSource === 'confirmed fallback').length} well setpoints came from confirmed fallback targets`,
        ],
      }
    } else if (allOnTarget === false) {
      if (dischargeLimited) {
        primaryDiagnosis = {
          title: 'Discharge override is the top suspect',
          value: 'Pad is likely backing off to protect discharge pressure',
          detail: 'The document says discharge override takes precedence over raising well flows. Right now discharge is at or above the likely trigger.',
          status: 'bad',
          kind: 'inferred',
          evidence: [
            `Highest compressor discharge: ${formatValue(highestDischarge, 0)} PSI`,
            `Likely trigger setpoint: ${formatValue(dischargeTrigger, 0)} PSI`,
            `Wells short of target: ${wellsShort.map((well) => `W${well.wellNumber}`).join(', ') || 'none'}`,
          ],
        }
      } else if (notEnoughLoadedCompressors) {
        primaryDiagnosis = {
          title: 'Loaded compressor count is short',
          value: 'The pad likely does not have enough loaded compression online',
          detail: 'The logic document says oncoming compressors should not count until they are online and loaded. The live pad is below the recommended loaded count.',
          status: 'warn',
          kind: 'inferred',
          evidence: [
            `Running compressors: ${runningUnits.length}`,
            `Recommended compressors: ${formatValue(recommendedCompressors, 0)}`,
            `${HALFMANN_UNITS.filter((unit, index) => !unit.standby && !(unitRpm[index] != null && unitRpm[index] > 100)).map((unit) => unit.label).join(', ') || 'No offline primary units'}`,
          ],
        }
      } else if (recycleOpen) {
        primaryDiagnosis = {
          title: 'Recycle loss is visible',
          value: 'Gas is being recirculated while wells are short',
          detail: 'An open recycle valve is direct evidence that some gas is not reaching the wells.',
          status: 'warn',
          kind: 'direct',
          evidence: [
            `Recycle valve position: ${formatValue(recycleValvePosition, 1)}%`,
            `Total actual flow: ${formatValue(totalActual)}`,
            `Total desired flow: ${formatValue(totalDesired)}`,
          ],
        }
      } else if (likelySacrifice) {
        primaryDiagnosis = {
          title: 'Well sacrifice or priority balancing is likely',
          value: 'The pad total is close, but one or more wells are carrying the shortfall',
          detail: 'This matches the logic document case where total compression is mostly there but lower-priority wells end up taking the hit.',
          status: 'warn',
          kind: 'inferred',
          evidence: [
            `Site is still at ${formatPct(siteMatchPct)}`,
            `Short wells: ${wellsShort.map((well) => `W${well.wellNumber} short ${formatValue(well.shortfall)}`).join(' | ')}`,
            `Recycle valve is ${recycleOpen === false ? 'closed' : 'not proven closed'}`,
          ],
        }
      } else if (needsLowFlowOverride) {
        primaryDiagnosis = {
          title: 'The panel should be in low-flow bump logic',
          value: 'Wells are short without discharge override evidence',
          detail: 'Based on the document, this is when the panel should be stepping compressor commands upward by configured increments.',
          status: 'bad',
          kind: 'inferred',
          evidence: [
            `Site match is only ${formatPct(siteMatchPct)}`,
            `Aggregate well shortfall: ${formatValue(shortfallTotal)} MMSCFD`,
            `Average compressor command match: ${commandMatchAvg != null ? formatPct(commandMatchAvg) : 'desired flow not visible'}`,
          ],
        }
      } else {
        primaryDiagnosis = {
          title: 'Pad is off target, but the reason is mixed',
          value: 'Need more direct live evidence for a single culprit',
          detail: 'The tree sees missed wells, but the missing command and state registers keep this from being a one-cause diagnosis.',
          status: 'neutral',
          kind: 'inferred',
          evidence: [
            `Wells short of target: ${wellsShort.length}`,
            `Desired compressor flow registers visible on ${compressorsWithCommands} primary units`,
            `Discharge trigger register: ${dischargeTrigger != null ? 'visible' : 'not visible'}`,
          ],
        }
      }
    }

    return {
      timestamp: getTimestamp(panelData),
      wells,
      totalActual,
      totalDesired,
      totalDesiredSite,
      totalDesiredFromWells,
      unitActualFlows,
      unitDesiredFlows,
      unitRpm,
      unitDischarge,
      runningUnits,
      recommendedCompressors,
      recycleValvePosition,
      recycleOpen,
      dischargeTrigger,
      highestDischarge,
      highestStatic,
      allOnTarget,
      wellsMeetingCount,
      wellsWithTarget,
      wellsShort,
      siteMatchPct,
      shortfallTotal,
      commandMatchAvg,
      notEnoughLoadedCompressors,
      dischargeLimited,
      likelySacrifice,
      needsLowFlowOverride,
      primaryDiagnosis,
    }
  }, [panelData, unitDataRaw])

  const pageTime = derived.timestamp ?? lastRefresh

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 48px)', background: '#080810' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 20px', borderBottom: '1px solid #1a1a2a', background: '#0c0c16' }}>
        <div>
          <div style={{ fontSize: 14, color: '#fff', fontWeight: 900, fontFamily: "'Arial Black', sans-serif" }}>Diagnostics - Halfmann 1214</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>Flowchart-style logic tree using live MLink evidence plus Halfmann panel logic</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {pageTime && <span style={{ fontSize: 10, color: '#64748b' }}>Updated {pageTime.toLocaleTimeString()}</span>}
          <button onClick={refresh} disabled={loading} style={{
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
          }}>
            {loading ? `Refreshing ${countdown}s` : 'Refresh'}
          </button>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 28px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          {liveError && (
            <div style={{ marginBottom: 16, border: '1px solid #7a1a1a', background: '#1b0d0d', borderRadius: 14, padding: '12px 14px', fontSize: 11, color: '#fecaca' }}>
              {liveError}
            </div>
          )}

          <div style={{ marginBottom: 18, border: '1px solid #1f3650', background: '#0d1726', borderRadius: 18, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 8 }}>
              Diagnostic Intent
            </div>
            <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.7 }}>
              This page tattles when the pad is missing well flow. It follows the control priorities from the Halfmann logic document:
              first confirm the wells are short, then test for discharge override pressure, loaded compressor shortage, recycle loss,
              and finally whether the pattern looks like deliberate sacrifice of a lower-priority well.
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <DiagnosticBadge label="Wells Meeting" value={`${derived.wellsMeetingCount}/${derived.wellsWithTarget.length || derived.wells.length}`} tone={derived.allOnTarget ? '#4ade80' : '#fbbf24'} />
            <DiagnosticBadge label="Total Actual" value={`${formatValue(derived.totalActual)} MMSCFD`} tone="#ffffff" />
            <DiagnosticBadge label="Total Desired" value={`${formatValue(derived.totalDesired)} MMSCFD`} tone="#93c5fd" />
            <DiagnosticBadge label="Recycle Valve" value={derived.recycleValvePosition != null ? `${formatValue(derived.recycleValvePosition, 1)}%` : '--'} tone={derived.recycleOpen ? '#f87171' : '#4ade80'} />
            <DiagnosticBadge label="High Discharge" value={derived.highestDischarge != null ? `${formatValue(derived.highestDischarge, 0)} PSI` : '--'} tone="#fca5a5" />
            <DiagnosticBadge label="Trigger SP" value={derived.dischargeTrigger != null ? `${formatValue(derived.dischargeTrigger, 0)} PSI` : '--'} tone="#93c5fd" />
            <DiagnosticBadge label="Running Compressors" value={`${derived.runningUnits.length}${derived.recommendedCompressors != null ? ` / ${formatValue(derived.recommendedCompressors, 0)} rec` : ''}`} tone="#49D0E2" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ width: 'min(100%, 1060px)' }}>
              <FlowNode
                title="Root Check"
                value={derived.allOnTarget ? 'YES - all wells are meeting target' : derived.allOnTarget === false ? 'NO - one or more wells are missing flow' : 'PARTIAL - target evidence is mixed'}
                detail={derived.allOnTarget
                  ? 'The diagnostic tree sees every well with a target inside the 5% tolerance band.'
                  : derived.allOnTarget === false
                    ? `The tree sees ${derived.wellsShort.length} wells outside the 5% band and now traces the likely reason below.`
                    : 'Some setpoints are still inferred from confirmed fallback targets, so this tree explains the most likely reason with that limitation called out.'}
                status={derived.allOnTarget ? 'good' : derived.allOnTarget === false ? 'bad' : 'neutral'}
                kind={derived.allOnTarget === null ? 'inferred' : 'direct'}
                evidence={[
                  `Total actual ${formatValue(derived.totalActual)} vs desired ${formatValue(derived.totalDesired)}`,
                  `Short wells: ${derived.wellsShort.map((well) => `W${well.wellNumber}`).join(', ') || 'none'}`,
                ]}
              />
              <BranchLine />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                <FlowNode
                  title="Branch 1 - Setpoint Confidence"
                  value={`${derived.wells.filter((well) => well.desiredSource === 'feed').length} live / ${derived.wells.filter((well) => well.desiredSource === 'confirmed fallback').length} fallback`}
                  detail="Live well setpoints are preferred. Confirmed fallback targets are only used so the diagnostics tree can still evaluate pad behavior instead of going blind."
                  status={derived.wells.every((well) => well.desiredSource === 'feed') ? 'good' : 'warn'}
                  kind={derived.wells.every((well) => well.desiredSource === 'feed') ? 'direct' : 'inferred'}
                  evidence={derived.wells.map((well) => `Well ${well.wellNumber}: ${formatValue(well.desired)} MMSCFD (${well.desiredSource || 'missing'})`)}
                />
                <FlowNode
                  title="Branch 2 - Discharge Override"
                  value={derived.dischargeLimited ? 'LIKELY ACTIVE' : derived.dischargeTrigger != null ? 'Not currently tripped' : 'Trigger not visible'}
                  detail={derived.dischargeLimited
                    ? 'Discharge is at or above the likely trigger, so the panel should protect pressure before it tries to bump flow.'
                    : derived.dischargeTrigger != null
                      ? 'Discharge is below the visible trigger, so override pressure is not the lead suspect at this instant.'
                      : 'The tree cannot directly prove the override trigger without that register.'}
                  status={derived.dischargeLimited ? 'bad' : derived.dischargeTrigger != null ? 'good' : 'neutral'}
                  kind={derived.dischargeTrigger != null ? 'direct' : 'inferred'}
                  evidence={[
                    `Highest discharge ${formatValue(derived.highestDischarge, 0)} PSI`,
                    `Trigger setpoint ${formatValue(derived.dischargeTrigger, 0)} PSI`,
                    `Highest static pressure ${formatValue(derived.highestStatic, 0)} PSI`,
                  ]}
                />
                <FlowNode
                  title="Branch 3 - Loaded Compression"
                  value={derived.notEnoughLoadedCompressors ? 'SHORT ON LOADED UNITS' : 'Loaded count looks adequate'}
                  detail={derived.notEnoughLoadedCompressors
                    ? 'The logic document says new units should not count until they are online and loaded. The running count is below the pad recommendation.'
                    : 'Loaded compressor count does not appear to be the first-order problem right now.'}
                  status={derived.notEnoughLoadedCompressors ? 'warn' : 'good'}
                  kind={derived.recommendedCompressors != null ? 'direct' : 'inferred'}
                  evidence={[
                    `Running primaries ${derived.runningUnits.length}`,
                    `Recommended compressors ${formatValue(derived.recommendedCompressors, 0)}`,
                    `Command visibility on primaries ${derived.unitDesiredFlows.filter((value, index) => !HALFMANN_UNITS[index].standby && value != null).length} of 4`,
                  ]}
                />
                <FlowNode
                  title="Branch 4 - Gas Waste / Recycle"
                  value={derived.recycleOpen ? 'RECYCLE IS OPEN' : derived.recycleOpen === false ? 'Recycle appears closed' : 'Recycle position not visible'}
                  detail={derived.recycleOpen
                    ? 'An open recycle valve is direct evidence that some compressor gas is not reaching the wells.'
                    : derived.recycleOpen === false
                      ? 'Recycle does not look like the cause of missed well flow right now.'
                      : 'The valve position register still matters for a stronger answer here.'}
                  status={derived.recycleOpen ? 'warn' : derived.recycleOpen === false ? 'good' : 'neutral'}
                  kind={derived.recycleOpen != null ? 'direct' : 'inferred'}
                  evidence={[
                    `Valve position ${derived.recycleValvePosition != null ? `${formatValue(derived.recycleValvePosition, 1)}%` : '--'}`,
                    `Site match ${formatPct(derived.siteMatchPct)}`,
                    `Shortfall ${formatValue(derived.shortfallTotal)} MMSCFD`,
                  ]}
                />
              </div>
              <BranchLine />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 14 }}>
                <FlowNode
                  title="Branch 5 - Low-Flow Override Path"
                  value={derived.needsLowFlowOverride ? 'SHOULD BE BUMPING COMPRESSOR COMMANDS' : 'Not the lead path'}
                  detail={derived.needsLowFlowOverride
                    ? 'Wells are short, discharge is not tripped, and recycle is not the explanation. That is the exact scenario where the document says to step compressor demand upward.'
                    : 'This branch is secondary right now because another higher-priority cause is showing stronger evidence.'}
                  status={derived.needsLowFlowOverride ? 'bad' : 'neutral'}
                  kind="inferred"
                  evidence={[
                    `Average command match ${derived.commandMatchAvg != null ? formatPct(derived.commandMatchAvg) : 'desired flow hidden'}`,
                    `Aggregate shortfall ${formatValue(derived.shortfallTotal)} MMSCFD`,
                    `Short wells ${derived.wellsShort.map((well) => `W${well.wellNumber}`).join(', ') || 'none'}`,
                  ]}
                />
                <FlowNode
                  title="Branch 6 - Well Sacrifice Pattern"
                  value={derived.likelySacrifice ? 'LIKELY SACRIFICE / PRIORITY BALANCE' : 'Pattern not dominant'}
                  detail={derived.likelySacrifice
                    ? 'Total site flow is close enough that the missing gas is likely being concentrated on one or more lower-priority wells instead of the entire pad being uniformly short.'
                    : 'The current pattern looks more like general shortage or pressure control than deliberate single-well sacrifice.'}
                  status={derived.likelySacrifice ? 'warn' : 'neutral'}
                  kind="inferred"
                  evidence={[
                    `Site total is ${formatPct(derived.siteMatchPct)}`,
                    `Short wells ${derived.wellsShort.map((well) => `W${well.wellNumber} ${formatPct(well.pctOfTarget)}`).join(' | ') || 'none'}`,
                    `Healthy wells ${derived.wells.filter((well) => well.atTarget).map((well) => `W${well.wellNumber}`).join(', ') || 'none'}`,
                  ]}
                />
              </div>
              <BranchLine />
              <FlowNode
                title={derived.primaryDiagnosis.title}
                value={derived.primaryDiagnosis.value}
                detail={derived.primaryDiagnosis.detail}
                status={derived.primaryDiagnosis.status}
                kind={derived.primaryDiagnosis.kind}
                evidence={derived.primaryDiagnosis.evidence}
              />
            </div>
          </div>

          <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            <div style={{ border: '1px solid #1f3650', background: '#0d1726', borderRadius: 18, padding: '16px 18px' }}>
              <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
                Current Well Evidence
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {derived.wells.map((well) => (
                  <div key={well.wellNumber} style={{ display: 'grid', gridTemplateColumns: '74px 1fr', gap: 10, alignItems: 'center', border: '1px solid #1a2740', borderRadius: 12, padding: '10px 12px', background: '#0a1220' }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#49D0E2', letterSpacing: '0.14em', textTransform: 'uppercase' }}>Well {well.wellNumber}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ fontSize: 12, color: well.atTarget ? '#4ade80' : '#fbbf24', fontWeight: 800 }}>
                        {formatValue(well.actual)} actual / {formatValue(well.desired)} target MMSCFD
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>
                        {well.atTarget ? 'Within 5% of target' : `Short by ${formatValue(well.shortfall)} MMSCFD`} | target source: {well.desiredSource || 'missing'} | static {well.staticPressure != null ? `${formatValue(well.staticPressure, 0)} PSI` : '--'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ border: '1px solid #1f3650', background: '#0d1726', borderRadius: 18, padding: '16px 18px' }}>
              <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
                Compressor Evidence
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {HALFMANN_UNITS.map((unit, index) => (
                  <div key={unit.key} style={{ border: '1px solid #1a2740', borderRadius: 12, padding: '10px 12px', background: '#0a1220' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 11, color: '#fff', fontWeight: 800 }}>{unit.label}{unit.standby ? ' (Standby)' : ''}</div>
                      <div style={{ fontSize: 10, color: derived.unitRpm[index] != null && derived.unitRpm[index] > 100 ? '#4ade80' : '#94a3b8', fontWeight: 700 }}>
                        {derived.unitRpm[index] != null && derived.unitRpm[index] > 100 ? 'RUNNING' : 'STOPPED / UNKNOWN'}
                      </div>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 10, color: '#94a3b8', lineHeight: 1.6 }}>
                      Actual flow: {formatValue(derived.unitActualFlows[index])} MMSCFD
                      {derived.unitActualFlows[index] != null && unit.key === 'unit2129' && getNumeric(parseLiveDatapoints(unitDataRaw[unit.key]), ['Flow Rate', 'Flow Rate PID PV']) == null ? ' (derived pad balance)' : ''}
                      <br />
                      Desired flow: {formatValue(derived.unitDesiredFlows[index])} MMSCFD
                      <br />
                      RPM: {formatValue(derived.unitRpm[index], 0)} | discharge: {formatValue(derived.unitDischarge[index], 0)} PSI
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 22, border: '1px solid #1f3650', background: '#0d1726', borderRadius: 18, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
              Logic Basis From Document
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
              {DOC_RULES.map((rule) => (
                <div key={rule} style={{ border: '1px solid #1a2740', borderRadius: 12, background: '#0a1220', padding: '12px 14px', fontSize: 11, color: '#dbeafe', lineHeight: 1.6 }}>
                  {rule}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 10, color: '#94a3b8', lineHeight: 1.6 }}>
              Direct = the live site is currently reading the evidence register. Inferred = the page is applying the Halfmann control logic to the evidence it does have.
            </div>
          </div>

          <footer style={{ textAlign: 'center', paddingTop: 20 }}>
            <span style={{ fontSize: 9, color: '#475569' }}>
              Halfmann 1214 diagnostics refresh every {REFRESH_INTERVAL_S} seconds. Units are shown using the current live MLink feed and confirmed Halfmann fallback targets where needed.
            </span>
          </footer>
        </div>
      </div>
    </div>
  )
}
