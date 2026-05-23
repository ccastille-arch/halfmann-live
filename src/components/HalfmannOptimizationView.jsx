import { useMemo } from 'react'
import { findRegisterDatapoint, parseLiveDatapoints } from '../engine/liveRegisters'
import { PANEL_ADDRESSES, UNIT_ADDRESSES, getNumericByAddress, resolveDatapointByAddress } from '../engine/halfmannRegisters'
import { HALFMANN_UNITS, useHalfmannData } from '../context/HalfmannDataContext'

const TARGET_TOLERANCE_PCT = 5
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
const WELL_STATIC_KEYS = [1, 2, 3, 4, 5].map((n) => [
  `Wellhead #${n} Injection Static Pressure From Customer PLC`,
  `Wellhead #${n} Injection Static Pressure`,
  `Well ${n} Static Pressure`,
])
const UNIT_TO_COMP_NUM = { unit2128: 1, unit2130: 2, unit2127: 3, unit2129: 4 }

function parseNumeric(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function resolveDatapoint(dataMap, labels) {
  for (const label of labels) {
    const datapoint = findRegisterDatapoint(dataMap, { label, decimals: 3 })
    if (datapoint) return datapoint
  }
  return null
}

function getNumeric(dataMap, labels) {
  return parseNumeric(resolveDatapoint(dataMap, labels)?.value)
}

function formatNumber(value, decimals = 3) {
  return value != null && Number.isFinite(value) ? value.toFixed(decimals) : '--'
}

function formatPercent(value, decimals = 0) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)}%` : '--'
}

function getWellSetpoint(panelData, panelMap, wellNumber) {
  return getNumericByAddress(panelData, [WELL_SETPOINT_ADDRESSES[wellNumber - 1]]) ?? getNumeric(panelMap, [
    `Wellhead #${wellNumber} Setpoint From Customer PLC`,
    `Well ${wellNumber} Setpoint From Customer PLC`,
    `Well ${wellNumber} Setpoint`,
  ]) ?? null
}

function getWellCalculatedDesired(panelData, panelMap, wellNumber) {
  return getNumericByAddress(panelData, [WELL_CALCULATED_DESIRED_ADDRESSES[wellNumber - 1]]) ?? getNumeric(panelMap, [
    `Wellhead #${wellNumber} Calculated Desired Flow`,
    `Well ${wellNumber} Calculated Desired Flow`,
  ])
}

function getUnitDesiredFlow(panelData, panelMap, unitData, unitMap, unitKey, unitLabel) {
  const compNum = UNIT_TO_COMP_NUM[unitKey]
  const unitNum = unitLabel.match(/\d{4}/)?.[0]
  return getNumericByAddress(panelData, [PANEL_ADDRESSES.unitDesiredFlowSetpoints[compNum - 1]]) ?? getNumeric(panelMap, [
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
  ]) ?? getNumericByAddress(unitData, UNIT_ADDRESSES.loadedAutoSp) ?? getNumeric(unitMap, [
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

function getUnitActualFlow(unitData, unitMap) {
  return getNumericByAddress(unitData, UNIT_ADDRESSES.actualFlow) ?? getNumeric(unitMap, ['Flow Rate', 'Flow Rate PID PV', 'Flow Rate PV', 'Flow PID PV', 'Compressor Flow Rate PID PV', 'Stage 3 Flow Rate'])
}

function getUnitSuction(unitData, unitMap) {
  return getNumericByAddress(unitData, UNIT_ADDRESSES.suctionPressure) ?? getNumeric(unitMap, ['Suction Pressure', 'Stage 1 Suction Prs', 'Suction Prs'])
}

function getUnitDischarge(unitData, unitMap) {
  return getNumericByAddress(unitData, UNIT_ADDRESSES.dischargePressure) ?? getNumeric(unitMap, ['Discharge Pressure', 'Stage 3 Discharge Prs'])
}

function getUnitRpm(unitData, unitMap) {
  return getNumericByAddress(unitData, UNIT_ADDRESSES.engineSpeed) ?? getNumeric(unitMap, ['RPM', 'Driver Speed', 'ENGINE RPM', 'Engine Speed', 'Engine Speed From EICS'])
}

function deriveMissingCompressorFlows(unitFlows, totalActualFlow) {
  if (totalActualFlow == null || !Number.isFinite(totalActualFlow)) return unitFlows
  const next = [...unitFlows]
  const activeIndexes = HALFMANN_UNITS.map((unit, index) => (!unit.standby ? index : null)).filter((index) => index != null)
  const missingIndexes = activeIndexes.filter((index) => next[index] == null)
  if (missingIndexes.length !== 1) return next
  const knownSum = activeIndexes.reduce((sum, index) => sum + (next[index] ?? 0), 0)
  const derivedFlow = totalActualFlow - knownSum
  if (!Number.isFinite(derivedFlow) || derivedFlow <= 0.01) return next
  next[missingIndexes[0]] = derivedFlow
  return next
}

function getRecommendationTone(priority) {
  if (priority === 'critical') return { border: '#7a1a1a', bg: 'linear-gradient(180deg, #1f1014 0%, #120b0d 100%)', chip: '#f87171', text: '#fee2e2' }
  if (priority === 'high') return { border: '#8a5b10', bg: 'linear-gradient(180deg, #1d1408 0%, #110d08 100%)', chip: '#fbbf24', text: '#fef3c7' }
  if (priority === 'good') return { border: '#1d6c3d', bg: 'linear-gradient(180deg, #0d1a13 0%, #09110d 100%)', chip: '#4ade80', text: '#dcfce7' }
  return { border: '#1f3650', bg: 'linear-gradient(180deg, #0d1622 0%, #090f18 100%)', chip: '#7dd3fc', text: '#dbeafe' }
}

function SectionCard({ title, eyebrow, children, right }) {
  return (
    <section style={{
      border: '1px solid #1a2d44',
      borderRadius: 22,
      background: 'linear-gradient(180deg, rgba(7,18,30,0.96) 0%, rgba(6,10,18,0.98) 100%)',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.28)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '18px 20px 14px',
        borderBottom: '1px solid rgba(31, 54, 80, 0.8)',
        background: 'linear-gradient(90deg, rgba(73,208,226,0.10), rgba(73,208,226,0.02))',
      }}>
        <div>
          {eyebrow && <div style={{ fontSize: 10, color: '#49D0E2', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 }}>{eyebrow}</div>}
          <div style={{ fontSize: 18, color: '#f8fafc', fontWeight: 800 }}>{title}</div>
        </div>
        {right}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </section>
  )
}

function SummaryMetric({ label, value, note, tone = 'neutral' }) {
  const colors = getRecommendationTone(tone)
  return (
    <div style={{
      border: `1px solid ${colors.border}`,
      borderRadius: 18,
      padding: '16px 18px',
      background: colors.bg,
      minHeight: 118,
    }}>
      <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 12 }}>{label}</div>
      <div style={{ fontSize: 30, lineHeight: 1, color: colors.chip, fontWeight: 900, fontFamily: "'Arial Black', sans-serif" }}>{value}</div>
      {note && <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6, color: colors.text }}>{note}</div>}
    </div>
  )
}

function RecommendationCard({ item }) {
  const colors = getRecommendationTone(item.priority)
  return (
    <div style={{
      border: `1px solid ${colors.border}`,
      borderRadius: 18,
      background: colors.bg,
      padding: '18px 18px 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: colors.chip, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase' }}>{item.label}</div>
        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>{item.confidence}</div>
      </div>
      <div style={{ fontSize: 20, color: '#f8fafc', fontWeight: 800, lineHeight: 1.25, marginBottom: 8 }}>{item.headline}</div>
      <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.7, marginBottom: 12 }}>{item.detail}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <div style={{ border: '1px solid rgba(125, 211, 252, 0.18)', borderRadius: 12, background: 'rgba(6, 16, 28, 0.7)', padding: '10px 12px' }}>
          <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>Recommended Move</div>
          <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.6 }}>{item.action}</div>
        </div>
        <div style={{ border: '1px solid rgba(125, 211, 252, 0.18)', borderRadius: 12, background: 'rgba(6, 16, 28, 0.7)', padding: '10px 12px' }}>
          <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>Why It Matters</div>
          <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.6 }}>{item.impact}</div>
        </div>
      </div>
    </div>
  )
}

function WellOpportunityRow({ well }) {
  const tone = well.status === 'under' ? 'high' : well.status === 'over' ? 'neutral' : 'good'
  const colors = getRecommendationTone(tone)
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '110px 1.2fr 1fr 1fr',
      gap: 12,
      alignItems: 'center',
      border: `1px solid ${colors.border}`,
      background: 'rgba(7, 18, 30, 0.72)',
      borderRadius: 16,
      padding: '14px 16px',
    }}>
      <div>
        <div style={{ fontSize: 14, color: '#f8fafc', fontWeight: 800 }}>Well {well.wellNumber}</div>
        <div style={{ fontSize: 10, color: colors.chip, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 4 }}>{well.statusLabel}</div>
      </div>
      <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.7 }}>
        Actual <span style={{ color: '#f8fafc', fontWeight: 700 }}>{formatNumber(well.actual)}</span> vs target <span style={{ color: '#f8fafc', fontWeight: 700 }}>{formatNumber(well.target)}</span> MMSCFD
        <br />
        Calculated desired {formatNumber(well.calculatedDesired)} | static {well.staticPressure != null ? `${formatNumber(well.staticPressure, 0)} PSI` : '--'}
      </div>
      <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.7 }}>{well.guidance}</div>
      <div style={{ fontSize: 12, color: colors.text, lineHeight: 1.7 }}>{well.rationale}</div>
    </div>
  )
}

function CompressorRow({ compressor }) {
  const colors = getRecommendationTone(compressor.tone)
  return (
    <div style={{
      border: `1px solid ${colors.border}`,
      borderRadius: 16,
      background: 'rgba(7, 18, 30, 0.72)',
      padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 14, color: '#f8fafc', fontWeight: 800 }}>{compressor.label}</div>
        <div style={{ fontSize: 10, color: colors.chip, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{compressor.statusText}</div>
      </div>
      <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.7 }}>
        Flow {formatNumber(compressor.actualFlow)} actual / {formatNumber(compressor.desiredFlow)} desired MMSCFD
        <br />
        RPM {formatNumber(compressor.rpm, 0)} | suction {formatNumber(compressor.suction, 1)} PSI | discharge {formatNumber(compressor.discharge, 0)} PSI
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: colors.text, lineHeight: 1.7 }}>{compressor.guidance}</div>
    </div>
  )
}

export default function HalfmannOptimizationView() {
  const { panelData, unitDataRaw, lastRefresh, loading, liveError, siteSettings, meetingState, commsStatus } = useHalfmannData()

  const model = useMemo(() => {
    const panelMap = parseLiveDatapoints(panelData)
    const wells = WELL_FLOW_KEYS.map((labels, index) => {
      const wellNumber = index + 1
      const actual = getNumericByAddress(panelData, [WELL_FLOW_ADDRESSES[index]]) ?? getNumeric(panelMap, labels)
      const target = getWellSetpoint(panelData, panelMap, wellNumber)
      const calculatedDesired = getWellCalculatedDesired(panelData, panelMap, wellNumber)
      const staticPressure = getNumericByAddress(panelData, [WELL_STATIC_ADDRESSES[index]]) ?? getNumeric(panelMap, WELL_STATIC_KEYS[index])
      const desired = calculatedDesired ?? target
      const gap = actual != null && desired != null ? actual - desired : null
      const tolerance = desired != null ? desired * ((Number(siteSettings.wellTargetPct) || TARGET_TOLERANCE_PCT) / 100) : null
      const status = gap == null || tolerance == null
        ? 'unknown'
        : gap < -tolerance
          ? 'under'
          : gap > tolerance
            ? 'over'
            : 'on'
      return {
        wellNumber,
        actual,
        target,
        calculatedDesired,
        desired,
        staticPressure,
        gap,
        status,
      }
    })

    const totalActualFlow = wells.reduce((sum, well) => sum + (well.actual ?? 0), 0)
    const totalDesiredFlow = wells.reduce((sum, well) => sum + (well.desired ?? 0), 0)

    const unitMaps = HALFMANN_UNITS.map((unit) => parseLiveDatapoints(unitDataRaw[unit.key]))
    const rawUnitActualFlows = HALFMANN_UNITS.map((unit, index) => getUnitActualFlow(unitDataRaw[unit.key], unitMaps[index]))
    const actualFlows = deriveMissingCompressorFlows(rawUnitActualFlows, totalActualFlow)
    const compressors = HALFMANN_UNITS.map((unit, index) => {
      const desiredFlow = getUnitDesiredFlow(panelData, panelMap, unitDataRaw[unit.key], unitMaps[index], unit.key, unit.label)
      const actualFlow = actualFlows[index]
      const rpm = getUnitRpm(unitDataRaw[unit.key], unitMaps[index])
      const suction = getUnitSuction(unitDataRaw[unit.key], unitMaps[index])
      const discharge = getUnitDischarge(unitDataRaw[unit.key], unitMaps[index])
      const gap = actualFlow != null && desiredFlow != null ? actualFlow - desiredFlow : null
      const running = rpm != null ? rpm > 100 : actualFlow != null ? actualFlow > 0.05 : false
      const status = gap == null || desiredFlow == null || desiredFlow <= 0
        ? 'unknown'
        : gap < -(desiredFlow * 0.05)
          ? 'under'
          : gap > desiredFlow * 0.05
            ? 'over'
            : 'on'
      return {
        key: unit.key,
        label: unit.label,
        standby: unit.standby,
        desiredFlow,
        actualFlow,
        rpm,
        suction,
        discharge,
        running,
        gap,
        status,
      }
    })

    const underTargetWells = wells.filter((well) => well.status === 'under').sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0))
    const overTargetWells = wells.filter((well) => well.status === 'over').sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0))
    const onTargetWells = wells.filter((well) => well.status === 'on')
    const underDispatchCompressors = compressors.filter((unit) => !unit.standby && unit.status === 'under')
    const overDispatchCompressors = compressors.filter((unit) => !unit.standby && unit.status === 'over')
    const runningCompressors = compressors.filter((unit) => !unit.standby && unit.running)
    const activeAlerts = []
    const usableSignals = wells.filter((well) => well.actual != null).length + compressors.filter((unit) => unit.actualFlow != null || unit.rpm != null).length
    const expectedSignals = wells.length + compressors.length
    const dataConfidence = expectedSignals ? Math.round((usableSignals / expectedSignals) * 100) : 0

    if (commsStatus?.isHolding) {
      activeAlerts.push({
        priority: 'critical',
        label: 'Data Holding',
        confidence: 'Operator review needed',
        headline: 'Decisions are running on last known good values for one or more devices.',
        detail: commsStatus.message || 'The recommendation engine is preserving historical signals until a complete refresh succeeds.',
        action: 'Confirm field conditions before making major setpoint moves and watch the next live refresh for confirmation.',
        impact: 'Protects against chasing stale data when the feed is degraded.',
      })
    }

    if (underTargetWells.length > 0) {
      const lead = underTargetWells[0]
      activeAlerts.push({
        priority: 'high',
        label: 'Recover Flow',
        confidence: meetingState?.wells?.[lead.wellNumber] === false ? 'Persistent deviation' : 'Live deviation',
        headline: `Well ${lead.wellNumber} is the biggest optimization opportunity on the pad.`,
        detail: `It is running ${formatNumber(Math.abs(lead.gap), 3)} MMSCFD below its desired rate${lead.staticPressure != null ? ` with static pressure at ${formatNumber(lead.staticPressure, 0)} PSI` : ''}.`,
        action: overTargetWells.length > 0
          ? `Trim Well ${overTargetWells[0].wellNumber} first, then reallocate gas toward Well ${lead.wellNumber}.`
          : `Increase available injection capacity to Well ${lead.wellNumber} or unload the limiting compressor path.`,
        impact: 'Largest immediate upside for matching site allocation to customer demand.',
      })
    }

    if (overTargetWells.length > 0) {
      const lead = overTargetWells[0]
      activeAlerts.push({
        priority: 'neutral',
        label: 'Trim Excess',
        confidence: 'Good confidence',
        headline: `Well ${lead.wellNumber} appears oversupplied relative to demand.`,
        detail: `Current injection is ${formatNumber(lead.gap, 3)} MMSCFD above desired. That gas may be more valuable on constrained wells.`,
        action: `Trim Well ${lead.wellNumber} in small steps and watch whether a short well recovers without increasing total site demand.`,
        impact: 'Reduces wasted injection and helps rebalance the pad before calling for more compressor work.',
      })
    }

    if (underDispatchCompressors.length > 0) {
      const lead = underDispatchCompressors.sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0))[0]
      activeAlerts.push({
        priority: 'high',
        label: 'Compressor Dispatch',
        confidence: meetingState?.compressors?.[lead.key] === false ? 'Persistent deviation' : 'Live deviation',
        headline: `${lead.label} is not carrying its requested flow.`,
        detail: `It is short by ${formatNumber(Math.abs(lead.gap), 3)} MMSCFD${lead.rpm != null ? ` at ${formatNumber(lead.rpm, 0)} RPM` : ''}${lead.suction != null ? ` with ${formatNumber(lead.suction, 1)} PSI suction` : ''}.`,
        action: 'Check recycle / load path, confirm suction availability, and move incremental load only after the shortfall stabilizes.',
        impact: 'Restoring dispatched flow here can recover multiple underfed wells without changing the site target.',
      })
    }

    if (!activeAlerts.length) {
      activeAlerts.push({
        priority: 'good',
        label: 'Stable Operation',
        confidence: 'High confidence',
        headline: 'Pad is broadly aligned with current flow targets.',
        detail: 'No major redistribution need is visible right now. Use this window to hold steady and watch for the next drift.',
        action: 'Keep present dispatch, monitor persistent state flags, and avoid chasing small second-to-second variance.',
        impact: 'Preserves stable throughput while minimizing unnecessary field adjustments.',
      })
    }

    const siteGap = totalActualFlow - totalDesiredFlow
    const optimizationScore = Math.max(0, Math.min(100,
      100
      - (underTargetWells.length * 12)
      - (overTargetWells.length * 6)
      - (underDispatchCompressors.length * 10)
      - (commsStatus?.isHolding ? 18 : 0)
      - ((100 - dataConfidence) * 0.25),
    ))

    const wellRows = wells.map((well) => ({
      ...well,
      statusLabel: well.status === 'under' ? 'Needs Gas' : well.status === 'over' ? 'Trim Candidate' : well.status === 'on' ? 'On Target' : 'Signal Limited',
      guidance: well.status === 'under'
        ? `Prioritize incremental gas here${well.staticPressure != null && well.staticPressure > 900 ? '; higher static pressure suggests the well may need more push to respond' : ''}.`
        : well.status === 'over'
          ? 'Reduce injection slightly and test whether site shortfalls recover elsewhere.'
          : well.status === 'on'
            ? 'Hold current position unless another well needs gas and this one stays safely above target.'
            : 'Flow or target signal is missing, so treat this as operator-verification only.',
      rationale: well.status === 'under'
        ? `${formatNumber(Math.abs(well.gap), 3)} MMSCFD below desired${meetingState?.wells?.[well.wellNumber] === false ? ' and staying there through the debounce window' : ''}.`
        : well.status === 'over'
          ? `${formatNumber(well.gap, 3)} MMSCFD above desired, creating a likely redistribution opportunity.`
          : well.status === 'on'
            ? `Inside the ${Number(siteSettings.wellTargetPct) || TARGET_TOLERANCE_PCT}% target band.`
            : 'Not enough published data to rank this well confidently.',
    }))

    const compressorRows = compressors.map((compressor) => ({
      ...compressor,
      tone: compressor.status === 'under' ? 'high' : compressor.status === 'over' ? 'neutral' : compressor.running ? 'good' : 'neutral',
      statusText: compressor.status === 'under'
        ? 'Below Dispatch'
        : compressor.status === 'over'
          ? 'Above Dispatch'
          : compressor.running
            ? 'Balanced'
            : compressor.standby
              ? 'Standby'
              : 'Low Load',
      guidance: compressor.status === 'under'
        ? 'Short of requested flow. Check loading path and whether the compressor is supply-limited or recycling.'
        : compressor.status === 'over'
          ? 'Carrying more than requested. This is a good candidate to trim before changing total site flow.'
          : compressor.standby
            ? 'Standby coverage is available if active machines stay short and the field wants more throughput.'
            : 'Dispatch looks reasonable. Use this machine as a stable anchor while moving smaller opportunities.',
    }))

    return {
      wells,
      compressors,
      totalActualFlow,
      totalDesiredFlow,
      siteGap,
      underTargetWells,
      overTargetWells,
      onTargetWells,
      underDispatchCompressors,
      overDispatchCompressors,
      runningCompressors,
      activeAlerts,
      wellRows,
      compressorRows,
      dataConfidence,
      optimizationScore,
      missingSignals: expectedSignals - usableSignals,
    }
  }, [panelData, unitDataRaw, siteSettings, meetingState, commsStatus])

  return (
    <div style={{
      minHeight: '100%',
      color: '#e2e8f0',
      background: 'radial-gradient(circle at top right, rgba(73,208,226,0.13), transparent 28%), linear-gradient(180deg, #050912 0%, #080d18 36%, #05070d 100%)',
      padding: 20,
    }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gap: 18 }}>
        <section style={{
          border: '1px solid #1a2d44',
          borderRadius: 26,
          background: 'linear-gradient(135deg, rgba(8,18,29,0.96) 0%, rgba(4,7,12,0.98) 100%)',
          padding: '24px 24px 22px',
          boxShadow: '0 20px 48px rgba(0, 0, 0, 0.32)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            top: -60,
            right: -40,
            width: 220,
            height: 220,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(73,208,226,0.18) 0%, rgba(73,208,226,0.02) 60%, transparent 72%)',
            pointerEvents: 'none',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', position: 'relative' }}>
            <div style={{ maxWidth: 760 }}>
              <div style={{ fontSize: 10, color: '#49D0E2', fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 10 }}>Halfmann Ai Optimization</div>
              <div style={{ fontSize: 34, lineHeight: 1.08, color: '#f8fafc', fontWeight: 900, fontFamily: "'Arial Black', sans-serif", marginBottom: 12 }}>
                Recommendation engine for where the next unit of gas should go.
              </div>
              <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.8 }}>
                This view ranks live well and compressor moves using the same pad telemetry already feeding the site. It favors recoverable shortfalls first, then trim opportunities, and gracefully falls back when signals are incomplete.
              </div>
            </div>
            <div style={{ minWidth: 260, display: 'grid', gap: 10, alignContent: 'start' }}>
              <div style={{ border: '1px solid #1f3650', background: 'rgba(7,18,30,0.78)', borderRadius: 18, padding: '14px 16px' }}>
                <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>Last Accepted Refresh</div>
                <div style={{ fontSize: 18, color: '#f8fafc', fontWeight: 800 }}>{lastRefresh ? lastRefresh.toLocaleTimeString() : loading ? 'Loading live data' : 'Waiting for first good snapshot'}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                  {liveError ? liveError : commsStatus?.message || 'Recommendations update automatically with each successful refresh.'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ border: '1px solid #1f3650', background: 'rgba(7,18,30,0.78)', borderRadius: 999, padding: '8px 12px', fontSize: 11, color: model.dataConfidence >= 80 ? '#4ade80' : '#fbbf24', fontWeight: 800 }}>
                  Data Confidence {formatPercent(model.dataConfidence)}
                </div>
                <div style={{ border: '1px solid #1f3650', background: 'rgba(7,18,30,0.78)', borderRadius: 999, padding: '8px 12px', fontSize: 11, color: model.optimizationScore >= 80 ? '#4ade80' : model.optimizationScore >= 60 ? '#fbbf24' : '#f87171', fontWeight: 800 }}>
                  Optimization Score {formatPercent(model.optimizationScore)}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <SummaryMetric
            label="Total Injection"
            value={`${formatNumber(model.totalActualFlow)} MMSCFD`}
            note={`Desired ${formatNumber(model.totalDesiredFlow)} MMSCFD`}
            tone={model.siteGap < -0.1 ? 'high' : model.siteGap > 0.1 ? 'neutral' : 'good'}
          />
          <SummaryMetric
            label="Pad Gap"
            value={`${model.siteGap >= 0 ? '+' : ''}${formatNumber(model.siteGap)} MMSCFD`}
            note={model.siteGap < 0 ? 'Site is below aggregate desired flow.' : model.siteGap > 0 ? 'Site is above aggregate desired flow.' : 'Site is aligned with aggregate desired flow.'}
            tone={Math.abs(model.siteGap) <= 0.1 ? 'good' : model.siteGap < 0 ? 'high' : 'neutral'}
          />
          <SummaryMetric
            label="Well Alignment"
            value={`${model.onTargetWells.length}/${model.wells.length}`}
            note={`${model.underTargetWells.length} need gas, ${model.overTargetWells.length} are trim candidates`}
            tone={model.underTargetWells.length > 1 ? 'high' : model.underTargetWells.length === 1 ? 'neutral' : 'good'}
          />
          <SummaryMetric
            label="Compressor Dispatch"
            value={`${model.runningCompressors.length} online`}
            note={`${model.underDispatchCompressors.length} below dispatch, ${model.overDispatchCompressors.length} above dispatch`}
            tone={model.underDispatchCompressors.length > 0 ? 'high' : 'good'}
          />
        </div>

        <SectionCard
          title="Priority Recommendations"
          eyebrow="Ai Stack Rank"
          right={<div style={{ fontSize: 11, color: '#94a3b8' }}>{model.activeAlerts.length} active recommendations</div>}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            {model.activeAlerts.map((item, index) => <RecommendationCard key={`${item.label}-${index}`} item={item} />)}
          </div>
        </SectionCard>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
          <SectionCard title="Well-Level Opportunities" eyebrow="Allocation Detail">
            <div style={{ display: 'grid', gap: 12 }}>
              {model.wellRows.map((well) => <WellOpportunityRow key={well.wellNumber} well={well} />)}
            </div>
          </SectionCard>

          <SectionCard title="Compressor Guidance" eyebrow="Dispatch Detail">
            <div style={{ display: 'grid', gap: 12 }}>
              {model.compressorRows.map((compressor) => <CompressorRow key={compressor.key} compressor={compressor} />)}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Recommendation Context" eyebrow="Model Notes">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <div style={{ border: '1px solid #1f3650', borderRadius: 16, background: 'rgba(7,18,30,0.72)', padding: '14px 16px' }}>
              <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>Decision Logic</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.7 }}>
                Wells are compared to calculated desired flow when available, otherwise to the customer PLC setpoint. Compressors are compared to their requested dispatch, and site balance is only used to estimate a single missing actual flow tag when the rest of the running unit flows are present.
              </div>
            </div>
            <div style={{ border: '1px solid #1f3650', borderRadius: 16, background: 'rgba(7,18,30,0.72)', padding: '14px 16px' }}>
              <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>Signal Coverage</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.7 }}>
                {model.missingSignals > 0
                  ? `${model.missingSignals} of the expected optimization signals are currently limited or missing, so lower-confidence recommendations are marked accordingly.`
                  : 'Current optimization signals are well populated across wells and compressors.'}
              </div>
            </div>
            <div style={{ border: '1px solid #1f3650', borderRadius: 16, background: 'rgba(7,18,30,0.72)', padding: '14px 16px' }}>
              <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>Persistent State Guardrail</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.7 }}>
                The site debounce window is set to {Number(siteSettings.meetingFlowPersistSeconds) || 0} seconds. Persistent flags from the shared meeting state are used to avoid overreacting to noisy short-term drift.
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
