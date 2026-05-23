import { useEffect, useMemo, useState } from 'react'
import { HALFMANN_UNITS, useHalfmannData } from '../context/HalfmannDataContext'
import { PANEL_ADDRESSES, UNIT_ADDRESSES, getNumericByAddress } from '../engine/halfmannRegisters'

const API_BASE = import.meta.env.VITE_API_URL || ''
const WELL_NAMES = ['214', '444', '334', '213', '333']
const UNIT_FLOW_SETPOINTS = ['460002', '460004', '460006', '460008']
const WELL_OIL_PRIORITY = ['461036', '461038', '461040', '461042', '461044']
const MONITOR_BAND = 3
const REVIEW_BAND = 7
const INVESTIGATE_BAND = 12

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function parseBoolean(value) {
  if (value == null) return null
  const normalized = String(value).trim().toLowerCase()
  if (normalized.includes('yes') || normalized === '1' || normalized === '2' || normalized === 'true') return true
  if (normalized.includes('no') || normalized === '0' || normalized === 'false') return false
  return null
}

function formatNumber(value, decimals = 1) {
  return value != null && Number.isFinite(value) ? value.toFixed(decimals) : '--'
}

function formatPercent(value, decimals = 0) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)}%` : '--'
}

function formatMmscfd(value, decimals = 3) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)} MMSCFD` : '--'
}

function toneStyles(tone) {
  if (tone === 'green') return { border: '#1f8f55', bg: 'linear-gradient(180deg, rgba(7,34,22,0.96) 0%, rgba(7,19,14,0.96) 100%)', label: '#4ade80', text: '#dcfce7' }
  if (tone === 'yellow') return { border: '#9a7d18', bg: 'linear-gradient(180deg, rgba(35,28,8,0.96) 0%, rgba(20,15,6,0.96) 100%)', label: '#facc15', text: '#fef3c7' }
  if (tone === 'orange') return { border: '#b26a14', bg: 'linear-gradient(180deg, rgba(38,22,8,0.96) 0%, rgba(22,13,6,0.96) 100%)', label: '#fb923c', text: '#fed7aa' }
  if (tone === 'red') return { border: '#952c37', bg: 'linear-gradient(180deg, rgba(37,11,16,0.96) 0%, rgba(20,7,11,0.96) 100%)', label: '#f87171', text: '#fee2e2' }
  return { border: '#29547a', bg: 'linear-gradient(180deg, rgba(10,21,34,0.96) 0%, rgba(8,14,24,0.96) 100%)', label: '#7dd3fc', text: '#dbeafe' }
}

function scoreTone(score) {
  if (score >= 90) return 'green'
  if (score >= 75) return 'yellow'
  if (score >= 60) return 'orange'
  return 'red'
}

function scoreLabel(score) {
  if (score >= 90) return 'Stable'
  if (score >= 75) return 'Watch'
  if (score >= 60) return 'Tune Needed'
  return 'Investigate'
}

function evidenceBadge(live, historical, event) {
  if (event) return 'Event Supported'
  if (historical) return 'Trend Supported'
  if (live) return 'Snapshot Only'
  return 'Insufficient History'
}

function badgeTone(text) {
  if (text === 'Event Supported') return 'green'
  if (text === 'Trend Supported') return 'yellow'
  if (text === 'Snapshot Only') return 'blue'
  return 'orange'
}

function SectionCard({ title, eyebrow, children, right }) {
  return (
    <section style={{
      borderRadius: 24,
      border: '1px solid rgba(73,208,226,0.16)',
      background: 'linear-gradient(180deg, rgba(7,16,28,0.98) 0%, rgba(4,8,14,1) 100%)',
      boxShadow: '0 18px 42px rgba(0,0,0,0.3)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '18px 20px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 16,
        borderBottom: '1px solid rgba(31,60,88,0.8)',
        background: 'linear-gradient(90deg, rgba(73,208,226,0.12) 0%, rgba(73,208,226,0.02) 55%)',
      }}>
        <div>
          {eyebrow ? <div style={{ fontSize: 10, color: '#49d0e2', fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 }}>{eyebrow}</div> : null}
          <div style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>{title}</div>
        </div>
        {right}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </section>
  )
}

function ScoreCard({ label, score, note }) {
  const tone = scoreTone(score)
  const style = toneStyles(tone)
  return (
    <div style={{
      borderRadius: 22,
      border: `1px solid ${style.border}`,
      background: style.bg,
      padding: 18,
      minHeight: 152,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ fontSize: 11, color: '#8ab7e8', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontSize: 42, lineHeight: 1, fontWeight: 900, color: style.label }}>{formatNumber(score, 0)}</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: style.text }}>{scoreLabel(score)}</div>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.7, color: style.text }}>{note}</div>
    </div>
  )
}

function Badge({ children, tone = 'blue' }) {
  const style = toneStyles(tone)
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      border: `1px solid ${style.border}`,
      background: style.bg,
      color: style.label,
      padding: '6px 10px',
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    }}>
      {children}
    </span>
  )
}

function EvidenceRow({ label, value }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ color: '#8ca0be', fontSize: 13 }}>{label}</div>
      <div style={{ color: '#f4f8ff', fontSize: 13, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function getUnitDesiredFlow(panelData, unitIndex) {
  return getNumericByAddress(panelData, [UNIT_FLOW_SETPOINTS[unitIndex]])
}

function buildWellRows(panelData) {
  return WELL_NAMES.map((name, index) => {
    const actual = getNumericByAddress(panelData, [PANEL_ADDRESSES.wellFlow[index]])
    const desired = getNumericByAddress(panelData, [PANEL_ADDRESSES.wellSetpoint[index]]) ?? getNumericByAddress(panelData, [PANEL_ADDRESSES.wellCalculatedDesiredFlow[index]])
    const choke = getNumericByAddress(panelData, [PANEL_ADDRESSES.wellChokePosition[index]])
    const casing = getNumericByAddress(panelData, [PANEL_ADDRESSES.wellCasingPressure[index]])
    const tubing = getNumericByAddress(panelData, [PANEL_ADDRESSES.wellTubingPressure[index]])
    const oilPriority = getNumericByAddress(panelData, [WELL_OIL_PRIORITY[index]])
    const errorPct = actual != null && desired != null && desired > 0 ? ((actual - desired) / desired) * 100 : null
    const underTarget = errorPct != null ? errorPct < -2 : null
    const overTarget = errorPct != null ? errorPct > 2 : null
    const restrictedCandidate = Boolean(underTarget && choke != null && choke >= 90)
    return {
      wellName: `Well ${name}`,
      actual,
      desired,
      errorPct,
      underTarget,
      overTarget,
      choke,
      casing,
      tubing,
      oilPriority,
      restrictedCandidate,
    }
  })
}

function buildCompressorRows(panelData, unitDataRaw) {
  return HALFMANN_UNITS.map((unit, index) => {
    const data = unitDataRaw[unit.key]
    const desired = unit.standby ? null : getUnitDesiredFlow(panelData, index)
    const actual = getNumericByAddress(data, UNIT_ADDRESSES.actualFlow)
    const suction = getNumericByAddress(data, UNIT_ADDRESSES.suctionPressure)
    const discharge = getNumericByAddress(data, UNIT_ADDRESSES.dischargePressure)
    const loadedAutoSp = getNumericByAddress(data, UNIT_ADDRESSES.loadedAutoSp)
    const mismatchPct = actual != null && desired != null && desired > 0 ? Math.abs(((actual - desired) / desired) * 100) : null
    return {
      label: unit.label,
      standby: unit.standby,
      desired,
      actual,
      suction,
      discharge,
      loadedAutoSp,
      mismatchPct,
    }
  })
}

function buildHistoryFlags(history) {
  const ctx = history?.optimizationHistoryContext || {}
  const hasHistory = Boolean(ctx.hasHistoricalData)
  return {
    hasHistory,
    lowFlow: hasHistory && (ctx.lowFlowEventCount || 0) > 0,
    discharge: hasHistory && (ctx.dischargeOverrideEventCount || 0) > 0,
    recycle: hasHistory && (ctx.recycleEventCount || 0) > 0,
    dispatch: hasHistory && (ctx.compressorDispatchMismatchEvents || 0) > 0,
    constraint: hasHistory && (ctx.compressorConstraintEvents || 0) > 0,
    sacrifice: hasHistory && (ctx.sacrificeModeEvents || 0) > 0,
  }
}

function makeSetting({ setting, action, amount, confidence, reason, whatToWatch, liveEvidence, historicalEvidence, eventEvidence, whenNotToChange }) {
  return {
    setting,
    action,
    amount,
    confidence,
    reason,
    whatToWatch,
    liveEvidence,
    historicalEvidence,
    eventEvidence,
    badge: evidenceBadge(liveEvidence, historicalEvidence, eventEvidence),
    whenNotToChange,
  }
}

function readBooleanPanel(panelData, address) {
  return parseBoolean(getNumericByAddress(panelData, [address]) ?? null) ?? parseBoolean(panelData?.datapoints?.find((dp) => String(dp.addressStr || dp.address) === String(address))?.value)
}

export default function HalfmannOptimizationView() {
  const { panelData, unitDataRaw, lastRefresh, liveError, commsStatus, siteSettings } = useHalfmannData()
  const [history, setHistory] = useState(null)
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError('')
    fetch(`${API_BASE}/api/optimization-history?lookbackDays=14&reportLimit=7`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.error || response.statusText)
        }
        return response.json()
      })
      .then((payload) => {
        if (!cancelled) setHistory(payload)
      })
      .catch((err) => {
        if (!cancelled) setHistoryError(err.message)
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const derived = useMemo(() => {
    const wells = buildWellRows(panelData)
    const compressors = buildCompressorRows(panelData, unitDataRaw)
    const historyFlags = buildHistoryFlags(history)

    const underTargetCount = wells.filter((well) => well.underTarget).length
    const overTargetCount = wells.filter((well) => well.overTarget).length
    const restrictedCount = wells.filter((well) => well.restrictedCandidate).length
    const averageWellMismatch = wells.filter((well) => well.errorPct != null).length
      ? wells.filter((well) => well.errorPct != null).reduce((sum, well) => sum + Math.abs(well.errorPct), 0) / wells.filter((well) => well.errorPct != null).length
      : 0
    const highChokeCount = wells.filter((well) => well.choke != null && well.choke >= 90).length
    const recyclePosition = getNumericByAddress(panelData, PANEL_ADDRESSES.recycleValvePosition)
    const recycleActive = recyclePosition != null && recyclePosition > (siteSettings.recycleOpenPct || 5)
    const dischargeOverrideActive = (getNumericByAddress(panelData, [PANEL_ADDRESSES.de4000OverrideLatch]) ?? 0) > 0
    const panelConstraintFlag = parseBoolean(panelData?.datapoints?.find((dp) => String(dp.addressStr || dp.address) === '420024')?.value) === true
    const panelAnyCompressorNotMeeting = parseBoolean(panelData?.datapoints?.find((dp) => String(dp.addressStr || dp.address) === '420023')?.value) === true
    const avgCompressorMismatch = compressors.filter((unit) => !unit.standby && unit.mismatchPct != null).length
      ? compressors.filter((unit) => !unit.standby && unit.mismatchPct != null).reduce((sum, unit) => sum + unit.mismatchPct, 0) / compressors.filter((unit) => !unit.standby && unit.mismatchPct != null).length
      : 0
    const maxCompressorMismatch = compressors.filter((unit) => !unit.standby && unit.mismatchPct != null).reduce((max, unit) => Math.max(max, unit.mismatchPct), 0)
    const dischargeSpread = compressors.filter((unit) => !unit.standby && unit.discharge != null).map((unit) => unit.discharge)
    const dischargeInstability = dischargeSpread.length >= 2 ? Math.max(...dischargeSpread) - Math.min(...dischargeSpread) : 0
    const compressorSlowdownActive = dischargeOverrideActive || historyFlags.discharge
    const mismatchPersistent = (history?.optimizationHistoryContext?.compressorMismatchPersistenceMinutes || 0) >= 10
    const wellBelowPersistent = (history?.optimizationHistoryContext?.wellBelowTargetPersistenceMinutes || 0) >= 10

    let compressorScore = 100
    if (avgCompressorMismatch > MONITOR_BAND) compressorScore -= Math.min(25, (avgCompressorMismatch - MONITOR_BAND) * 2.5)
    if (maxCompressorMismatch > REVIEW_BAND) compressorScore -= Math.min(18, (maxCompressorMismatch - REVIEW_BAND) * 2)
    if (dischargeInstability > 40) compressorScore -= 10
    if (recycleActive) compressorScore -= 12
    if (compressorSlowdownActive) compressorScore -= 16
    if (panelConstraintFlag) compressorScore -= 10
    if (mismatchPersistent) compressorScore -= 10
    compressorScore = clamp(compressorScore, 20, 100)

    let wellScore = 100
    wellScore -= Math.min(30, averageWellMismatch * 1.7)
    wellScore -= underTargetCount * 10
    wellScore -= Math.max(0, overTargetCount - 1) * 4
    wellScore -= highChokeCount * 4
    wellScore -= restrictedCount * 10
    if (historyFlags.sacrifice && underTargetCount > 0) wellScore -= 8
    if (wellBelowPersistent) wellScore -= 10
    wellScore = clamp(wellScore, 20, 100)

    let pressureScore = 100
    if (recycleActive) pressureScore -= 25
    if (dischargeOverrideActive) pressureScore -= 20
    if (compressorSlowdownActive) pressureScore -= 12
    if (dischargeInstability > 40) pressureScore -= 10
    pressureScore = clamp(pressureScore, 20, 100)

    const overallScore = clamp((wellScore * 0.4) + (compressorScore * 0.4) + (pressureScore * 0.2), 20, 100)

    let primaryRecommendation
    if (recycleActive || dischargeOverrideActive) {
      primaryRecommendation = {
        title: 'Prioritize pressure / recycle stability first',
        action: 'Hold well-side tuning until pressure protection clears.',
        amount: 'No immediate flow increase',
        confidence: historyFlags.discharge || historyFlags.recycle ? 82 : 68,
        why: 'Pressure protection is active, so adding more flow now risks chasing the pad into compressor slowdown or recycle.',
        whenNotToChange: 'Do not change well-allocation settings until recycle is closed and discharge protection is inactive.',
      }
    } else if (compressorScore > 90 && wellScore > 90) {
      primaryRecommendation = {
        title: 'HOLD',
        action: 'No tuning change justified.',
        amount: '—',
        confidence: 94,
        why: 'Compressor stability, well stability, and pressure stability are all strong. No setting adjustment is supported by current evidence.',
        whenNotToChange: 'Do not change anything unless a meaningful mismatch persists and causes a real consequence.',
      }
    } else if (wellScore < 90 && compressorScore >= 90) {
      primaryRecommendation = {
        title: restrictedCount > 0 ? 'Review restricted well response' : 'Adjust well-side behavior conservatively',
        action: restrictedCount > 0 ? 'Investigate the saturated well before increasing bumps.' : 'Use a small well-side timer or amount adjustment only if under-target behavior persists.',
        amount: restrictedCount > 0 ? 'No automatic change yet' : 'One small step or 5–10%',
        confidence: restrictedCount > 0 ? 76 : 71,
        why: restrictedCount > 0 ? 'A well is short while choke is near open, which looks more like deliverability restriction than compressor shortage.' : 'Wells are the unstable side while compressors are carrying load cleanly.',
        whenNotToChange: 'Do not increase well-side aggressiveness if recycle or discharge protection starts to activate.',
      }
    } else if (compressorScore < 90 && wellScore >= 90) {
      primaryRecommendation = {
        title: 'Review compressor-side stability first',
        action: 'Monitor compressor mismatch or local compressor tuning before touching well allocation.',
        amount: maxCompressorMismatch > INVESTIGATE_BAND ? 'Investigate >12% mismatch' : 'Monitor only',
        confidence: mismatchPersistent ? 79 : 67,
        why: 'Wells are broadly stable, so the unstable signal is coming from compressor loading or dispatch rather than well allocation.',
        whenNotToChange: 'Do not change well-side timers while the compressor side is the weaker score.',
      }
    } else {
      primaryRecommendation = {
        title: 'Stabilize compressor / discharge side before allocation changes',
        action: 'Treat compressor and pressure stability as the first target.',
        amount: 'No aggressive change now',
        confidence: 74,
        why: 'Both compressor and well scores are soft, which means the safest next move is to calm the compressor/discharge side before changing allocation behavior.',
        whenNotToChange: 'Do not stack multiple setting changes at once.',
      }
    }

    const settings = []
    settings.push(
      makeSetting({
        setting: 'Low Flow Override Timer',
        action: historyFlags.lowFlow && wellBelowPersistent ? 'Increase' : 'Hold',
        amount: historyFlags.lowFlow && wellBelowPersistent ? '30–60 sec' : '—',
        confidence: historyFlags.lowFlow && wellBelowPersistent ? 76 : 91,
        reason: historyFlags.lowFlow && wellBelowPersistent
          ? 'Low-flow events are repeating before the process has clearly recovered.'
          : 'No repeated low-flow retriggers are visible in retained history.',
        whatToWatch: 'Watch 2-minute and 5-minute well recovery after any timer change.',
        liveEvidence: underTargetCount > 0,
        historicalEvidence: historyFlags.lowFlow,
        eventEvidence: historyFlags.lowFlow && wellBelowPersistent,
        whenNotToChange: 'Do not shorten the timer unless a sustained shortfall is clearly lagging too long.',
      }),
    )
    settings.push(
      makeSetting({
        setting: 'Low Flow Override Amount',
        action: recycleActive || dischargeOverrideActive ? 'Decrease' : underTargetCount > 0 && compressorScore >= 90 && !restrictedCount ? 'Monitor' : 'Hold',
        amount: recycleActive || dischargeOverrideActive ? '5–10%' : '—',
        confidence: recycleActive || dischargeOverrideActive ? 80 : 72,
        reason: recycleActive || dischargeOverrideActive
          ? 'Flow corrections are happening into pressure/recycle instability.'
          : 'No current evidence shows low-flow bumps are causing a harmful consequence.',
        whatToWatch: 'Watch whether lower bump sizes reduce pressure/recycle upset without creating well shortfall.',
        liveEvidence: recycleActive || dischargeOverrideActive || underTargetCount > 0,
        historicalEvidence: historyFlags.lowFlow || historyFlags.discharge || historyFlags.recycle,
        eventEvidence: historyFlags.lowFlow && (historyFlags.discharge || historyFlags.recycle),
        whenNotToChange: 'Do not reduce the amount if wells are short and pressure protection is inactive.',
      }),
    )
    settings.push(
      makeSetting({
        setting: 'Discharge Settle-Out Timer',
        action: historyFlags.discharge && (history?.optimizationHistoryContext?.repeatedDischargeRetriggerCount || 0) > 0 ? 'Increase' : 'Hold',
        amount: historyFlags.discharge && (history?.optimizationHistoryContext?.repeatedDischargeRetriggerCount || 0) > 0 ? '60–120 sec' : '—',
        confidence: historyFlags.discharge ? 78 : 88,
        reason: historyFlags.discharge && (history?.optimizationHistoryContext?.repeatedDischargeRetriggerCount || 0) > 0
          ? 'Discharge events are clustering before pressure has settled.'
          : 'No repeat discharge clustering is retained in history.',
        whatToWatch: 'Watch whether discharge events space out after the increase.',
        liveEvidence: dischargeOverrideActive,
        historicalEvidence: historyFlags.discharge,
        eventEvidence: historyFlags.discharge && (history?.optimizationHistoryContext?.repeatedDischargeRetriggerCount || 0) > 0,
        whenNotToChange: 'Do not increase it if high discharge is staying elevated too long before any correction.',
      }),
    )
    settings.push(
      makeSetting({
        setting: 'Discharge Override Amount',
        action: dischargeOverrideActive && underTargetCount === 0 ? 'Hold' : dischargeOverrideActive && underTargetCount > 0 ? 'Decrease' : 'Hold',
        amount: dischargeOverrideActive && underTargetCount > 0 ? '5–10%' : '—',
        confidence: dischargeOverrideActive ? 73 : 90,
        reason: dischargeOverrideActive && underTargetCount > 0
          ? 'Pressure protection is active and wells are going short, which suggests the reduction may be a little too strong.'
          : 'No supported evidence shows the discharge amount needs to move right now.',
        whatToWatch: 'Watch discharge pressure recovery and whether wells stay inside target after the next event.',
        liveEvidence: dischargeOverrideActive,
        historicalEvidence: historyFlags.discharge,
        eventEvidence: historyFlags.discharge && underTargetCount > 0,
        whenNotToChange: 'Do not increase the amount from one live snapshot.',
      }),
    )
    settings.push(
      makeSetting({
        setting: 'Well Sacrifice Amount',
        action: historyFlags.sacrifice && underTargetCount > 0 ? 'Investigate' : 'Hold',
        amount: historyFlags.sacrifice && underTargetCount > 0 ? 'Manual validation first' : '—',
        confidence: historyFlags.sacrifice ? 70 : 92,
        reason: historyFlags.sacrifice && underTargetCount > 0
          ? 'Sacrifice behavior is present, but priority-well protection needs validation before changing the amount.'
          : 'No active compressor constraint or failed priority-protection event supports a sacrifice amount change.',
        whatToWatch: 'Watch whether priority wells stay protected when lower-priority wells absorb reduction.',
        liveEvidence: underTargetCount > 0,
        historicalEvidence: historyFlags.sacrifice,
        eventEvidence: historyFlags.sacrifice,
        whenNotToChange: 'Do not move sacrifice amount without a real compressor constraint consequence.',
      }),
    )
    settings.push(
      makeSetting({
        setting: 'Compressor Flow PV Offset',
        action: maxCompressorMismatch <= MONITOR_BAND ? 'Monitor' : maxCompressorMismatch <= REVIEW_BAND ? 'Hold' : maxCompressorMismatch <= INVESTIGATE_BAND ? 'Investigate' : 'Investigate',
        amount: '—',
        confidence: mismatchPersistent ? 79 : 66,
        reason: maxCompressorMismatch <= MONITOR_BAND
          ? 'Unit mismatch is inside the ±3% monitor band.'
          : maxCompressorMismatch <= REVIEW_BAND
            ? 'Mismatch is present but still inside the monitor-only band unless it persists.'
            : maxCompressorMismatch <= INVESTIGATE_BAND
              ? 'Mismatch has reached the review band and should be watched if persistent.'
              : 'Mismatch exceeds the investigate band and is large enough to justify compressor-side review.',
        whatToWatch: 'Watch persistence, not just magnitude, before changing offsets.',
        liveEvidence: maxCompressorMismatch > 0,
        historicalEvidence: historyFlags.dispatch,
        eventEvidence: historyFlags.dispatch && mismatchPersistent,
        whenNotToChange: 'Do not retune offsets off a one-off mismatch spike.',
      }),
    )

    const relevantSettings = settings.filter((item) =>
      item.action !== 'Hold' || item.setting === 'Compressor Flow PV Offset' || item.setting === 'Low Flow Override Timer'
    )

    return {
      wells,
      compressors,
      underTargetCount,
      overTargetCount,
      restrictedCount,
      recycleActive,
      recyclePosition,
      dischargeOverrideActive,
      panelConstraintFlag,
      panelAnyCompressorNotMeeting,
      compressorScore,
      wellScore,
      overallScore,
      pressureScore,
      avgCompressorMismatch,
      maxCompressorMismatch,
      averageWellMismatch,
      historyFlags,
      mismatchPersistent,
      wellBelowPersistent,
      primaryRecommendation,
      settings: relevantSettings,
      rawValues: {
        totalDesiredSiteFlow: getNumericByAddress(panelData, [PANEL_ADDRESSES.totalDesiredSiteFlow]),
        recyclePosition,
        dischargeOverrideLatch: getNumericByAddress(panelData, [PANEL_ADDRESSES.de4000OverrideLatch]),
        dischargeOverrideCompSpeedSp: getNumericByAddress(panelData, [PANEL_ADDRESSES.de4000OverrideCompSpeedSp]),
        avgCompressorMismatch,
        maxCompressorMismatch,
        averageWellMismatch,
      },
    }
  }, [panelData, unitDataRaw, history, siteSettings])

  return (
    <div style={{
      minHeight: '100%',
      background: 'radial-gradient(circle at top left, rgba(73,208,226,0.08), transparent 30%), linear-gradient(180deg, #05050c 0%, #080812 100%)',
      padding: 22,
      color: '#f4f8ff',
    }}>
      <div style={{ maxWidth: 1480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <SectionCard
          title="WellLogic Optimization Advisor"
          eyebrow="Compact Stability View"
          right={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Badge tone={liveError ? 'red' : 'green'}>{liveError ? 'Live feed degraded' : 'Live feed healthy'}</Badge>
              <Badge tone={historyError ? 'orange' : historyLoading ? 'yellow' : 'blue'}>
                {historyError ? 'History limited' : historyLoading ? 'Loading history' : 'History checked'}
              </Badge>
            </div>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <ScoreCard label="Overall Pad Stability Score" score={derived.overallScore} note={`${scoreLabel(derived.overallScore)}. Combined from wells, compressors, and pressure/recycle stability.`} />
            <ScoreCard label="Compressor Stability Score" score={derived.compressorScore} note={`${formatPercent(100 - derived.avgCompressorMismatch, 1)} average dispatch fit. ${derived.mismatchPersistent ? 'Mismatch is persistent.' : 'Mismatch is not persistent.'}`} />
            <ScoreCard label="Well Stability Score" score={derived.wellScore} note={`${derived.underTargetCount} wells under target, ${derived.overTargetCount} wells over target, ${derived.restrictedCount} restricted-well candidates.`} />
          </div>
        </SectionCard>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 1.05fr) minmax(360px, 1fr)', gap: 18, alignItems: 'start' }}>
          <SectionCard
            title="Primary Recommendation"
            eyebrow="Best Next Move"
            right={<Badge tone={scoreTone(derived.primaryRecommendation.confidence)}>{formatPercent(derived.primaryRecommendation.confidence, 0)} confidence</Badge>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: scoreTone(derived.overallScore) === 'green' ? '#4ade80' : '#f8fafc' }}>
                {derived.primaryRecommendation.title}
              </div>
              <div style={{ fontSize: 14, color: '#d8e6fb', lineHeight: 1.8 }}>
                <strong style={{ color: '#7dd3fc' }}>What to adjust:</strong> {derived.primaryRecommendation.action}<br />
                <strong style={{ color: '#7dd3fc' }}>How much:</strong> {derived.primaryRecommendation.amount}<br />
                <strong style={{ color: '#7dd3fc' }}>Why:</strong> {derived.primaryRecommendation.why}<br />
                <strong style={{ color: '#7dd3fc' }}>When not to change it:</strong> {derived.primaryRecommendation.whenNotToChange}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Recommended Setting Adjustments" eyebrow="Only Relevant Items">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {derived.settings.map((item) => (
                <div key={item.setting} style={{
                  borderRadius: 18,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(9,15,24,0.92)',
                  padding: 16,
                  display: 'grid',
                  gridTemplateColumns: 'minmax(180px, 220px) minmax(0, 1fr)',
                  gap: 16,
                }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#8ab7e8', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>{item.setting}</div>
                    <Badge tone={badgeTone(item.badge)}>{item.badge}</Badge>
                    <div style={{ marginTop: 10, fontSize: 12, color: '#a9bdd9' }}>Action: <strong style={{ color: '#f4f8ff' }}>{item.action}</strong></div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#a9bdd9' }}>Amount: <strong style={{ color: '#f4f8ff' }}>{item.amount}</strong></div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#a9bdd9' }}>Confidence: <strong style={{ color: '#f4f8ff' }}>{formatPercent(item.confidence, 0)}</strong></div>
                  </div>
                  <div style={{ fontSize: 13, color: '#d8e6fb', lineHeight: 1.8 }}>
                    <div><strong style={{ color: '#7dd3fc' }}>Reason:</strong> {item.reason}</div>
                    <div><strong style={{ color: '#7dd3fc' }}>What to watch:</strong> {item.whatToWatch}</div>
                    <div><strong style={{ color: '#7dd3fc' }}>When not to change:</strong> {item.whenNotToChange}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                      <Badge tone={item.liveEvidence ? 'green' : 'blue'}>Live evidence: {item.liveEvidence ? 'Yes' : 'No'}</Badge>
                      <Badge tone={item.historicalEvidence ? 'green' : 'blue'}>Historical evidence: {item.historicalEvidence ? 'Yes' : 'No'}</Badge>
                      <Badge tone={item.eventEvidence ? 'green' : 'blue'}>Event evidence: {item.eventEvidence ? 'Yes' : 'No'}</Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Expandable Evidence" eyebrow="Collapsed by Default">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <details style={detailsStyle}>
              <summary style={summaryStyle}>Show compressor evidence</summary>
              <div style={detailsBodyStyle}>
                {derived.compressors.filter((unit) => !unit.standby).map((unit) => (
                  <div key={unit.label} style={evidenceCardStyle}>
                    <div style={{ fontWeight: 800, color: '#f4f8ff', marginBottom: 8 }}>{unit.label}</div>
                    <EvidenceRow label="Desired Flow" value={formatMmscfd(unit.desired)} />
                    <EvidenceRow label="Actual Flow" value={formatMmscfd(unit.actual)} />
                    <EvidenceRow label="Dispatch mismatch" value={formatPercent(unit.mismatchPct, 1)} />
                    <EvidenceRow label="Loaded Auto SP" value={formatNumber(unit.loadedAutoSp, 1)} />
                    <EvidenceRow label="Suction / Discharge" value={`${formatNumber(unit.suction, 1)} / ${formatNumber(unit.discharge, 0)} PSI`} />
                  </div>
                ))}
              </div>
            </details>

            <details style={detailsStyle}>
              <summary style={summaryStyle}>Show well evidence</summary>
              <div style={detailsBodyStyle}>
                {derived.wells.map((well) => (
                  <div key={well.wellName} style={evidenceCardStyle}>
                    <div style={{ fontWeight: 800, color: '#f4f8ff', marginBottom: 8 }}>{well.wellName}</div>
                    <EvidenceRow label="Actual / Desired" value={`${formatMmscfd(well.actual)} / ${formatMmscfd(well.desired)}`} />
                    <EvidenceRow label="Flow error" value={formatPercent(well.errorPct, 1)} />
                    <EvidenceRow label="Choke position" value={formatNumber(well.choke, 1)} />
                    <EvidenceRow label="Oil priority" value={formatNumber(well.oilPriority, 0)} />
                    <EvidenceRow label="Restricted candidate" value={well.restrictedCandidate ? 'Yes' : 'No'} />
                  </div>
                ))}
              </div>
            </details>

            <details style={detailsStyle}>
              <summary style={summaryStyle}>Show raw derived values</summary>
              <div style={detailsBodyStyle}>
                <div style={evidenceCardStyle}>
                  <EvidenceRow label="Total Desired Site Flow" value={formatMmscfd(derived.rawValues.totalDesiredSiteFlow)} />
                  <EvidenceRow label="Recycle Valve Position" value={formatNumber(derived.rawValues.recyclePosition, 1)} />
                  <EvidenceRow label="Discharge Override Latch" value={formatNumber(derived.rawValues.dischargeOverrideLatch, 0)} />
                  <EvidenceRow label="Override Comp Speed SP" value={formatNumber(derived.rawValues.dischargeOverrideCompSpeedSp, 0)} />
                  <EvidenceRow label="Average Compressor Mismatch" value={formatPercent(derived.rawValues.avgCompressorMismatch, 1)} />
                  <EvidenceRow label="Max Compressor Mismatch" value={formatPercent(derived.rawValues.maxCompressorMismatch, 1)} />
                  <EvidenceRow label="Average Well Mismatch" value={formatPercent(derived.rawValues.averageWellMismatch, 1)} />
                </div>
              </div>
            </details>

            <details style={detailsStyle}>
              <summary style={summaryStyle}>Show event memory</summary>
              <div style={detailsBodyStyle}>
                <div style={evidenceCardStyle}>
                  <EvidenceRow label="Low-flow events" value={String(history?.optimizationHistoryContext?.lowFlowEventCount ?? '--')} />
                  <EvidenceRow label="Discharge override events" value={String(history?.optimizationHistoryContext?.dischargeOverrideEventCount ?? '--')} />
                  <EvidenceRow label="Recycle events" value={String(history?.optimizationHistoryContext?.recycleEventCount ?? '--')} />
                  <EvidenceRow label="Dispatch mismatch events" value={String(history?.optimizationHistoryContext?.compressorDispatchMismatchEvents ?? '--')} />
                  <EvidenceRow label="Constraint events" value={String(history?.optimizationHistoryContext?.compressorConstraintEvents ?? '--')} />
                  <EvidenceRow label="Sacrifice mode events" value={String(history?.optimizationHistoryContext?.sacrificeModeEvents ?? '--')} />
                  <EvidenceRow label="Pressure recovery pattern" value={history?.optimizationHistoryContext?.pressureRecoveryPattern || (historyLoading ? 'Loading…' : historyError ? historyError : 'Insufficient retained history')} />
                </div>
              </div>
            </details>
          </div>
        </SectionCard>

        <div style={{ fontSize: 12, color: '#7c8da8', letterSpacing: '0.04em', padding: '0 4px 10px' }}>
          Last live refresh: {lastRefresh ? new Date(lastRefresh).toLocaleString() : '--'} | History source: {historyLoading ? 'loading' : historyError ? 'limited' : 'checked'} {commsStatus?.message ? `| ${commsStatus.message}` : ''}
        </div>
      </div>
    </div>
  )
}

const detailsStyle = {
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(9,15,24,0.9)',
}

const summaryStyle = {
  cursor: 'pointer',
  padding: '14px 16px',
  color: '#d8e6fb',
  fontWeight: 800,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  fontSize: 12,
}

const detailsBodyStyle = {
  padding: '0 16px 16px',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 12,
}

const evidenceCardStyle = {
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(6,11,18,0.94)',
  padding: 14,
}
