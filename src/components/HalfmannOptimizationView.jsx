import { useEffect, useMemo, useState } from 'react'
import { HALFMANN_UNITS, useHalfmannData } from '../context/HalfmannDataContext'
import { UNIT_ADDRESSES, getNumericByAddress, resolveDatapointByAddress } from '../engine/halfmannRegisters'

const TARGET_TOLERANCE_PCT = 5
const EVENT_MEMORY_KEY = 'halfmann-optimization-event-memory-v1'
const EVENT_CHECKPOINTS_MINUTES = [2, 5, 10, 20]

const WELL_NAMES = ['214', '444', '334', '213', '333']

const PANEL_ADDR = {
  totalDesiredSiteFlow: '420003',
  totalCalculatedDesiredInjection: '420004',
  totalSiteFlow: '420005',
  compressorFlowMeetingRate: '420006',
  wellMatchPct: ['420007', '420008', '420009', '420010', '420011'],
  totalAscCompressorFlow: '420012',
  meetingFlowDemandSummary: '420013',
  compressorMeetingBits: ['420014', '420015', '420029', '420030'],
  recommendedFlowOffset: '420016',
  totalCompressorFlowMinusDesired: '420017',
  compressorsMeetingFlowDemand: '420018',
  anyWellInManual: '420019',
  anyWellOffline: '420020',
  anyWellBelowSetpoint: '420021',
  anyCompressorCommsLoss: '420022',
  anyCompressorNotMeetingDesiredFlow: '420023',
  siteCompressorLimited: '420024',
  siteWellDeliveryLimited: '420025',
  panelSeeingCompressorTrouble: '420026',
  panelSeeingWellTrouble: '420027',
  troubleshootingActive: '420028',
  allWellsMeetingFlow: '420031',
  flowTargetDrift: '420032',
  flowTargetDriftPct: '420033',
  flowTargetBeingReduced: '420034',
  flowTargetFollowingCompressor: '420035',
  possibleCompressorUnload: '420036',
  currentCompressorCapacity: '420037',
  avgRunningCompressorCapacityPct: '420038',
  recommendedCompressors: '420039',
  flowTroubleshooter: '420040',
  wellsMeetingRate: '420041',
  wellPanelCommandedCompressorFlow: '420042',
  anyWellBelow98Pct: '420045',
  runtimeCause: '420046',
  aiDataConfidence: '420100',
  aiFlowAlignmentScore: '420101',
  aiTotalFlowDeficit: '420102',
  aiTotalFlowExcess: '420103',
  aiCompressorCapacityMargin: '420104',
  aiCompressorHeadroomPct: '420105',
  aiCompressorDispatchError: '420106',
  aiCompressorDispatchMatchScore: '420107',
  aiRecycleActiveFlag: '420108',
  aiRecycleWasteScore: '420109',
  aiAverageChokeCommandError: '420110',
  aiHighChokeCount: '420111',
  aiLowChokeCount: '420112',
  aiRestrictedWellCandidateCount: '420113',
  aiOverTargetWellCount: '420114',
  aiUnderTargetWellCount: '420115',
  aiStabilityScore: '420116',
  aiAddFlowOpportunityFlag: '420117',
  aiReduceFlowOpportunityFlag: '420118',
  aiInvestigateRestrictionFlag: '420119',
  aiCompressorConstraintFlag: '420120',
  aiTuningSafeToEvaluateFlag: '420121',
  aiRecommendationConfidence: '420122',
  aiConditionSummaryCode: '420123',
  priorityMode: '460016',
  de4000OverrideLatch: '460018',
  de4000OverrideCompSpeedSp: '460020',
  wellManualAuto: ['460026', '460028', '460030', '460032', '460034'],
  wellCalculatedDesiredFlow: ['460050', '460052', '460054', '460056', '460058'],
  wellRunningStatus: ['460074', '460076', '460078', '460080', '460082'],
  wellPidMinOutput: ['460142', '460148', '460154', '460160', '460166'],
  wellFlowRunningStatusPct: ['460146', '460152', '460158', '460164', '460170'],
  wellPriorityRelease: '460134',
  wellFlow: ['460212', '460226', '460240', '460254', '460268'],
  wellStaticPressure: ['460214', '460228', '460242', '460256', '460270'],
  wellDifferentialPressure: ['460216', '460230', '460244', '460258', '460272'],
  wellSetpoint: ['460220', '460234', '460248', '460262', '460276'],
  wellYesterdayFlow: ['460222', '460236', '460250', '460264', '460278'],
  wellOverridePosition: ['460466', '460468', '460470', '460472', '460474'],
  wellGasPriority: ['461002', '461004', '461006', '461008', '461010'],
  wellOilPriority: ['461036', '461038', '461040', '461042', '461044'],
  wellMaxFlowRate: ['461134', '461136', '461138', '461140', '461142'],
  unitDesiredFlow: ['460002', '460004', '460006', '460008'],
  unitCurrentFlowOutput: ['460364', '460384', '460404', '460424'],
  unitMaxFlowRate: ['461062', '461064', '461066', '461068'],
  unitRunStatus: ['400114', '400115', '400116', '400117'],
  unitCommsLoss: ['460452', '460454', '460456', '460458'],
  recycleValvePosition: '400189',
  recycleValveCommand: '400191',
  suctionHeaderPressure: '400183',
  suctionSalesValvePosition: '400185',
  suctionSalesValveCommand: '400187',
  wellCasingPressure: ['400231', '400235', '400239', '400243', '400247'],
  wellTubingPressure: ['400233', '400237', '400241', '400245', '400249'],
  wellChokePosition: ['400260', '400261', '400262', '400263', '400264'],
}

function parseNumeric(value) {
  if (value == null) return null
  const normalized = String(value).trim()
  if (!normalized || normalized === 'UNAVAILABLE' || normalized === 'INVALID') return null
  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric : null
}

function parseBoolean(value) {
  if (value == null) return null
  const normalized = String(value).trim().toLowerCase()
  if (normalized.includes('yes') || normalized === '1' || normalized === '2' || normalized === 'true') return true
  if (normalized.includes('no') || normalized === '0' || normalized === 'false') return false
  return null
}

function parseMode(value) {
  if (value == null) return null
  const normalized = String(value).trim().toLowerCase()
  if (normalized.includes('manual')) return 'manual'
  if (normalized.includes('auto')) return 'auto'
  return null
}

function parseRunning(value) {
  if (value == null) return null
  const normalized = String(value).trim().toLowerCase()
  if (normalized.includes('running') || normalized.includes('online')) return true
  if (normalized.includes('stopped') || normalized.includes('offline')) return false
  return parseBoolean(value)
}

function getTextByAddress(data, address) {
  const raw = resolveDatapointByAddress(data, [address])?.value
  if (raw == null) return null
  const text = String(raw).trim()
  if (!text || text === 'UNAVAILABLE' || text === 'INVALID') return null
  return text
}

function getNumberByAddress(data, address) {
  return getNumericByAddress(data, [address])
}

function getNumberByAddresses(data, addresses) {
  for (const address of addresses) {
    const value = getNumberByAddress(data, address)
    if (value != null) return value
  }
  return null
}

function formatNumber(value, decimals = 1) {
  return value != null && Number.isFinite(value) ? value.toFixed(decimals) : '--'
}

function formatPercent(value, decimals = 0) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)}%` : '--'
}

function formatTimestamp(value) {
  if (!value) return '--'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString()
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function average(values) {
  const usable = values.filter((value) => value != null && Number.isFinite(value))
  if (!usable.length) return null
  return usable.reduce((sum, value) => sum + value, 0) / usable.length
}

function readEventMemory() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(EVENT_MEMORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveEventMemory(events) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(EVENT_MEMORY_KEY, JSON.stringify(events))
  } catch {}
}

function toneStyles(tone) {
  if (tone === 'red') return { border: '#7a1a1a', bg: 'linear-gradient(180deg, #1d0d12 0%, #12080c 100%)', label: '#f87171', text: '#fee2e2' }
  if (tone === 'orange') return { border: '#8a5b10', bg: 'linear-gradient(180deg, #1b1408 0%, #110d08 100%)', label: '#f59e0b', text: '#ffedd5' }
  if (tone === 'yellow') return { border: '#6e6218', bg: 'linear-gradient(180deg, #171407 0%, #100d05 100%)', label: '#facc15', text: '#fef3c7' }
  if (tone === 'green') return { border: '#1d6c3d', bg: 'linear-gradient(180deg, #0c1a12 0%, #07110c 100%)', label: '#4ade80', text: '#dcfce7' }
  return { border: '#24405b', bg: 'linear-gradient(180deg, #0d1724 0%, #09111a 100%)', label: '#7dd3fc', text: '#dbeafe' }
}

function confidenceTone(score) {
  if (score == null) return 'blue'
  if (score >= 85) return 'green'
  if (score >= 70) return 'yellow'
  if (score >= 55) return 'orange'
  return 'red'
}

function yesNoTone(value) {
  if (value == null) return 'blue'
  return value ? 'yellow' : 'green'
}

function SectionCard({ title, eyebrow, right, children }) {
  return (
    <section style={{
      border: '1px solid #1a2f46',
      borderRadius: 24,
      background: 'linear-gradient(180deg, rgba(7, 16, 28, 0.98) 0%, rgba(4, 8, 14, 1) 100%)',
      overflow: 'hidden',
      boxShadow: '0 16px 38px rgba(0, 0, 0, 0.28)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '18px 20px 14px',
        borderBottom: '1px solid rgba(31, 60, 88, 0.8)',
        background: 'linear-gradient(90deg, rgba(73,208,226,0.12) 0%, rgba(73,208,226,0.02) 55%)',
      }}>
        <div>
          {eyebrow && <div style={{ fontSize: 10, color: '#49D0E2', fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 6 }}>{eyebrow}</div>}
          <div style={{ fontSize: 18, color: '#f8fafc', fontWeight: 800 }}>{title}</div>
        </div>
        {right}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </section>
  )
}

function MetricCard({ label, value, note, tone = 'blue' }) {
  const colors = toneStyles(tone)
  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 18, background: colors.bg, padding: '16px 18px', minHeight: 124 }}>
      <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 30, lineHeight: 1, color: colors.label, fontWeight: 900, fontFamily: "'Arial Black', sans-serif" }}>{value}</div>
      {note && <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.65, color: colors.text, whiteSpace: 'pre-line' }}>{note}</div>}
    </div>
  )
}

function Chip({ text, tone = 'blue' }) {
  const colors = toneStyles(tone)
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      border: `1px solid ${colors.border}`,
      background: colors.bg,
      color: colors.label,
      borderRadius: 999,
      padding: '7px 11px',
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {text}
    </div>
  )
}

function ScoreBar({ label, value, tone }) {
  const colors = toneStyles(tone)
  const width = clamp(value ?? 0, 0, 100)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 11, color: colors.label, fontWeight: 800 }}>{formatPercent(value)}</div>
      </div>
      <div style={{ height: 9, borderRadius: 999, background: '#111c2d', overflow: 'hidden', border: '1px solid #1d334d' }}>
        <div style={{ width: `${width}%`, height: '100%', background: `linear-gradient(90deg, ${colors.label} 0%, rgba(255,255,255,0.18) 100%)` }} />
      </div>
    </div>
  )
}

function ExecutiveCard({ recommendation, confidence }) {
  const colors = toneStyles(recommendation.tone)
  return (
    <div style={{
      border: `1px solid ${colors.border}`,
      borderRadius: 22,
      background: colors.bg,
      padding: '20px 20px 18px',
      display: 'grid',
      gap: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: colors.label, fontWeight: 900, letterSpacing: '0.17em', textTransform: 'uppercase', marginBottom: 8 }}>
            {recommendation.title}
          </div>
          <div style={{ fontSize: 28, lineHeight: 1.08, color: '#f8fafc', fontWeight: 900, fontFamily: "'Arial Black', sans-serif", marginBottom: 8 }}>
            {recommendation.headline}
          </div>
          <div style={{ fontSize: 13, color: colors.text, lineHeight: 1.7 }}>{recommendation.reasoningSummary}</div>
        </div>
        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          <Chip text={`${recommendation.operationalRisk} risk`} tone={recommendation.riskTone} />
          <Chip text={`${formatPercent(confidence.recommendation, 0)} recommendation confidence`} tone={confidenceTone(confidence.recommendation)} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        <div style={{ border: '1px solid rgba(125, 211, 252, 0.16)', borderRadius: 14, background: 'rgba(5, 15, 24, 0.72)', padding: '12px 14px' }}>
          <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>Expected Benefit</div>
          <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.6 }}>{recommendation.expectedBenefit}</div>
        </div>
        <div style={{ border: '1px solid rgba(125, 211, 252, 0.16)', borderRadius: 14, background: 'rgba(5, 15, 24, 0.72)', padding: '12px 14px' }}>
          <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>Data Points Used</div>
          <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.6 }}>{recommendation.dataPointsUsed.join(' | ')}</div>
        </div>
        <div style={{ border: '1px solid rgba(125, 211, 252, 0.16)', borderRadius: 14, background: 'rgba(5, 15, 24, 0.72)', padding: '12px 14px' }}>
          <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>What Not To Do</div>
          <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.6 }}>{recommendation.whatNotToDo}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <div style={{ border: '1px solid #203854', borderRadius: 14, background: '#0a1220', padding: '12px 14px' }}>
          <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>What We See</div>
          <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.65 }}>{recommendation.whatWeSee}</div>
        </div>
        <div style={{ border: '1px solid #203854', borderRadius: 14, background: '#0a1220', padding: '12px 14px' }}>
          <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>Why It Matters</div>
          <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.65 }}>{recommendation.whyItMatters}</div>
        </div>
        <div style={{ border: '1px solid #203854', borderRadius: 14, background: '#0a1220', padding: '12px 14px' }}>
          <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>What To Do</div>
          <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.65 }}>{recommendation.whatToDo}</div>
        </div>
        <div style={{ border: '1px solid #203854', borderRadius: 14, background: '#0a1220', padding: '12px 14px' }}>
          <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>What Would Raise Confidence</div>
          <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.65 }}>{recommendation.whatRaisesConfidence}</div>
        </div>
      </div>
    </div>
  )
}

function WellOpportunityRow({ well }) {
  const colors = toneStyles(well.tone)
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '120px 1.15fr 0.95fr 0.75fr 1.05fr',
      gap: 12,
      alignItems: 'start',
      border: `1px solid ${colors.border}`,
      background: 'rgba(6, 14, 24, 0.78)',
      borderRadius: 16,
      padding: '14px 16px',
    }}>
      <div>
        <div style={{ fontSize: 14, color: '#f8fafc', fontWeight: 800 }}>{well.label}</div>
        <div style={{ fontSize: 10, color: colors.label, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 4 }}>{well.priorityLabel}</div>
      </div>
      <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.7 }}>
        Actual <span style={{ color: '#fff', fontWeight: 700 }}>{formatNumber(well.actual, 3)}</span> vs target <span style={{ color: '#fff', fontWeight: 700 }}>{formatNumber(well.target, 3)}</span> MMSCFD
        <br />
        Error {formatNumber(well.flowError, 3)} | match {formatPercent(well.matchPct, 1)}
        <br />
        Choke pos {formatNumber(well.chokePosition, 0)} | command {formatNumber(well.chokeCommand, 0)}
      </div>
      <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.7 }}>
        Casing {formatNumber(well.casingPressure, 0)}
        <br />
        Tubing {formatNumber(well.tubingPressure, 0)}
        <br />
        Diff {formatNumber(well.differentialPressure, 0)}
      </div>
      <div style={{ fontSize: 13, color: colors.label, fontWeight: 900, lineHeight: 1.4 }}>
        {formatPercent(well.opportunityScore, 0)}
        <div style={{ fontSize: 10, color: colors.text, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 4 }}>
          {well.restrictedRisk}
        </div>
      </div>
      <div style={{ fontSize: 12, color: colors.text, lineHeight: 1.7 }}>
        <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: 4 }}>{well.recommendation}</div>
        {well.recommendationReason}
      </div>
    </div>
  )
}

function CompressorRow({ compressor }) {
  const colors = toneStyles(compressor.tone)
  return (
    <div style={{
      border: `1px solid ${colors.border}`,
      borderRadius: 16,
      background: 'rgba(6, 14, 24, 0.78)',
      padding: '14px 16px',
      display: 'grid',
      gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: '#f8fafc', fontWeight: 800 }}>{compressor.label}</div>
        <Chip text={compressor.statusLabel} tone={compressor.tone} />
      </div>
      <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.7 }}>
        Current capacity {formatNumber(compressor.maxFlow, 2)} MMSCFD | utilization {formatPercent(compressor.utilization, 0)}
        <br />
        Commanded {formatNumber(compressor.desiredFlow, 3)} vs actual {formatNumber(compressor.actualFlow, 3)} MMSCFD
        <br />
        RPM {formatNumber(compressor.rpm, 0)} | suction {formatNumber(compressor.suction, 1)} PSI | discharge {formatNumber(compressor.discharge, 0)} PSI
      </div>
      <div style={{ fontSize: 12, color: colors.text, lineHeight: 1.65 }}>{compressor.guidance}</div>
    </div>
  )
}

function SettingTable({ rows }) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {rows.map((row) => {
        const colors = toneStyles(row.tone)
        return (
          <div key={row.setting} style={{
            border: `1px solid ${colors.border}`,
            borderRadius: 18,
            background: colors.bg,
            padding: '16px 18px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>{row.setting}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Chip text={row.readiness} tone={row.tone} />
                  <Chip text={row.recommendation} tone={row.tone} />
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>Confidence</div>
                <div style={{ fontSize: 20, color: colors.label, fontWeight: 900 }}>{formatPercent(row.confidence, 0)}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {[
                ['Current behavior', row.currentBehavior],
                ['Suggested change', row.suggestedChange],
                ['Why this direction', row.reason],
                ['What would reverse it', row.reverseEvidence],
                ['Safety limit / max allowed change', row.safetyLimit],
                ['Risk', row.risk],
                ['Validation', row.validation],
              ].map(([label, value]) => (
                <div key={`${row.setting}-${label}`} style={{ border: '1px solid #17314c', borderRadius: 14, background: 'rgba(8, 16, 28, 0.72)', padding: '12px 14px' }}>
                  <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.7 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function EventMemoryTable({ events }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {events.length === 0 ? (
        <div style={{ border: '1px solid #1f3650', borderRadius: 16, background: 'rgba(7,18,30,0.72)', padding: '14px 16px', fontSize: 12, color: '#cbd5e1', lineHeight: 1.7 }}>
          Event memory is armed but still warming up. The page will start storing low-flow, discharge override, compressor dispatch, recycle, and recovery events as they happen.
        </div>
      ) : events.map((event) => (
        <div key={event.id} style={{ border: '1px solid #1f3650', borderRadius: 16, background: 'rgba(7,18,30,0.72)', padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 13, color: '#f8fafc', fontWeight: 800 }}>{event.title}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{formatTimestamp(event.createdAt)}</div>
            </div>
            <Chip text={`${formatPercent(event.confidence, 0)} confidence`} tone={confidenceTone(event.confidence)} />
          </div>
          <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.7, marginBottom: 10 }}>
            Pre-event flow {formatNumber(event.pre?.totalActualFlow, 3)} / {formatNumber(event.pre?.totalDesiredFlow, 3)} MMSCFD | recycle {formatNumber(event.pre?.recycleValvePosition, 1)}% | discharge {formatNumber(event.pre?.dischargeHeaderPressure, 0)} PSI
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {EVENT_CHECKPOINTS_MINUTES.map((minutes) => {
              const checkpoint = event.checkpoints?.[String(minutes)] ?? null
              return (
                <div key={`${event.id}-${minutes}`} style={{ border: '1px solid #17314c', borderRadius: 12, background: '#0a1220', padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>{minutes} min</div>
                  {checkpoint ? (
                    <div style={{ fontSize: 11, color: '#dbeafe', lineHeight: 1.6 }}>
                      Flow {formatNumber(checkpoint.totalActualFlow, 3)}
                      <br />
                      Recycle {formatNumber(checkpoint.recycleValvePosition, 1)}%
                      <br />
                      Stability {formatPercent(checkpoint.stabilityScore, 0)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>Waiting for enough history.</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function buildPrimaryRecommendation(model) {
  const missingConfidenceSignals = [
    model.recycleValvePosition == null ? 'Recycle valve position' : null,
    model.suctionHeaderPressure == null ? 'Suction header pressure' : null,
    model.wells.some((well) => well.chokePosition == null) ? 'Choke position coverage' : null,
    model.wells.some((well) => well.casingPressure == null || well.tubingPressure == null) ? 'Casing/tubing pressure coverage' : null,
    model.compressors.some((compressor) => compressor.loadedAutoSp == null) ? 'Loaded Auto Sp coverage' : null,
    model.overrideActive == null ? 'Override latch status' : null,
  ].filter(Boolean)

  const whatRaisesConfidence = missingConfidenceSignals.length
    ? `More confidence would come from: ${missingConfidenceSignals.slice(0, 4).join(', ')}${missingConfidenceSignals.length > 4 ? ', and more history' : ''}.`
    : 'More confidence would come from 20 minutes of stable event-memory history without new diagnostics firing.'

  if (model.commsHold || model.confidence.data < 70 || model.anyWellOffline === true || model.anyCompressorCommsLoss === true) {
    return {
      title: 'Review data quality before action',
      headline: 'Recommendation engine is throttled because key live trust signals are degraded.',
      operationalRisk: 'High',
      riskTone: 'red',
      tone: 'red',
      expectedBenefit: 'Prevents unsupported optimization changes when the live decision layer is degraded.',
      reasoningSummary: 'The page can still summarize what it sees, but it should not lead aggressive tuning while comms, feed quality, or required live tags are incomplete.',
      dataPointsUsed: [
        `Data confidence ${formatPercent(model.confidence.data, 0)}`,
        `Comms hold ${model.commsHold ? 'YES' : 'NO'}`,
        `Any well offline ${model.anyWellOffline === true ? 'YES' : 'NO'}`,
        `Any compressor comms loss ${model.anyCompressorCommsLoss === true ? 'YES' : 'NO'}`,
      ],
      whatNotToDo: 'Do not tune low-flow, discharge override, recycle, or choke settings until the decision layer is clean again.',
      whatWeSee: model.commsMessage || 'One or more required live trust signals are low-confidence or unavailable.',
      whyItMatters: 'Optimization recommendations become hard to defend when the trusted score layer is degraded.',
      whatToDo: 'Restore signal quality first, then re-check whether the same imbalance persists through the debounce and event-memory windows.',
      whatRaisesConfidence,
    }
  }

  if (model.overrideActive === true) {
    const title = model.flowExcess > 0.03 ? 'Decrease discharge override amount' : 'Increase discharge settle-out timer'
    return {
      title,
      headline: 'Discharge protection is active, so stability should outrank any gas-adding move.',
      operationalRisk: 'High',
      riskTone: 'red',
      tone: 'red',
      expectedBenefit: 'Protects compressor and header stability before chasing well optimization.',
      reasoningSummary: 'The DE4000 override latch is active. That means the pad is already protecting discharge behavior, so adding or reallocating flow aggressively would be hard to justify.',
      dataPointsUsed: [
        `Override latch ${model.overrideActive ? 'YES' : 'NO'}`,
        `Discharge site ${formatNumber(model.dischargeHeaderPressure, 0)} PSI`,
        `Flow excess ${formatNumber(model.flowExcess, 3)} MMSCFD`,
        `Stability score ${formatPercent(model.stabilityScore, 0)}`,
      ],
      whatNotToDo: 'Do not add compressor flow or force chokes wider while discharge protection is already active.',
      whatWeSee: 'The pad is actively slowing or limiting compressor behavior through the DE4000 override path.',
      whyItMatters: 'Pressure-protection actions are already competing with flow targets, so aggressive optimization would likely create oscillation.',
      whatToDo: title === 'Decrease discharge override amount'
        ? 'Review whether discharge override amount is too aggressive for the current pad balance and reduce it conservatively only after validating the event trend.'
        : 'Give the pressure response more settle-out time before the next correction so the panel is not judging recovery too early.',
      whatRaisesConfidence,
    }
  }

  if (model.pressureLimited && model.compressorSlowdownProtectionLikely) {
    return {
      title: 'Increase discharge settle-out timer',
      headline: 'The pad looks pressure-limited, not compressor-limited, so avoid adding more compressor load.',
      operationalRisk: 'High',
      riskTone: 'red',
      tone: 'red',
      expectedBenefit: 'Prevents the optimization layer from treating protective slowdown like a machine failure.',
      reasoningSummary: 'Compressor-side trouble is showing up while wells are still below target, but the hierarchy says pressure protection should be interpreted before calling the compressor fleet weak. That means slower, smaller pressure-side correction is safer than loading harder.',
      dataPointsUsed: [
        `Override latch ${model.overrideActive ? 'YES' : 'NO'}`,
        `Compressor slowdown likely ${model.compressorSlowdownProtectionLikely ? 'YES' : 'NO'}`,
        `Recycle active ${model.recycleOpen ? 'YES' : 'NO'}`,
        `Under target wells ${model.underTargetCount}`,
      ],
      whatNotToDo: 'Do not recommend additional compressor loading while the pad is behaving like a pressure-limited system.',
      whatWeSee: 'Compressors appear to be backing away from demand while the wells still want gas, but the pattern looks like protective behavior rather than a simple compressor miss.',
      whyItMatters: 'Pressure rises faster than it recovers, so aggressive flow increases can create delayed instability even if the immediate live flow looks recoverable.',
      whatToDo: 'Favor slower discharge-side tuning and more settle-out time before pushing harder on compressor loading.',
      whatRaisesConfidence,
    }
  }

  if (model.recycleOpen && model.underTargetCount === 0) {
    return {
      title: 'Reduce recycle',
      headline: 'The pad is meeting flow while still sending gas through recycle.',
      operationalRisk: 'Medium',
      riskTone: 'orange',
      tone: 'orange',
      expectedBenefit: 'Cuts unnecessary recirculation and lowers wasted compressor work.',
      reasoningSummary: 'All wells are broadly aligned, but recycle is still open. That means the system is carrying more compressor flow than the wells actually need.',
      dataPointsUsed: [
        `Recycle valve ${formatNumber(model.recycleValvePosition, 1)}%`,
        `All wells meeting ${model.allWellsMeetingFlow === true ? 'YES' : 'NO'}`,
        `Flow excess ${formatNumber(model.flowExcess, 3)} MMSCFD`,
        `Compressor headroom ${formatPercent(model.compressorHeadroomPct, 0)}`,
      ],
      whatNotToDo: 'Do not add compressor load while recycle is already burning off excess flow.',
      whatWeSee: 'Recycle is active even though the wells are not currently asking for more gas.',
      whyItMatters: 'That usually means compression is being over-supplied relative to the pad demand.',
      whatToDo: 'Trim compressor-side excess slowly and watch recycle closure before making any well-side tuning changes.',
      whatRaisesConfidence,
    }
  }

  if (model.restrictedWellCount > 0 || model.wells.some((well) => well.restrictedRisk === 'High')) {
    const lead = model.wells.find((well) => well.restrictedRisk === 'High') ?? model.wells[0]
    return {
      title: 'Review restricted well',
      headline: `${lead.label} looks more like a restricted-well candidate than a simple gas-allocation miss.`,
      operationalRisk: 'Medium',
      riskTone: 'orange',
      tone: 'orange',
      expectedBenefit: 'Prevents the panel from pouring more gas into a well that is not responding.',
      reasoningSummary: 'This recommendation appears when a well stays below target while already carrying high choke demand or poor response signals, especially when the trusted derived layer flags a restriction candidate.',
      dataPointsUsed: [
        `${lead.label} match ${formatPercent(lead.matchPct, 1)}`,
        `${lead.label} choke ${formatNumber(lead.chokePosition, 0)}%`,
        `Restricted candidates ${formatNumber(model.restrictedWellCount, 0)}`,
        `Well-side trouble ${model.panelSeeingWellTrouble === true ? 'YES' : 'NO'}`,
      ],
      whatNotToDo: 'Do not keep increasing compressor flow into a well that is already showing poor response.',
      whatWeSee: `${lead.label} is lagging while the pad thinks the problem is well-side, not compressor-side.`,
      whyItMatters: 'More gas may only increase instability if the well is already at a response limit.',
      whatToDo: `Review ${lead.label} for restriction, actuator limits, or poor choke response before escalating total pad flow.`,
      whatRaisesConfidence,
    }
  }

  if (model.compressorConstraintActive || model.underDispatchCompressors.length > 0) {
    const highUtilization = (model.avgRunningCompressorCapacityPct ?? 0) >= 90 || (model.compressorHeadroomPct ?? 100) <= 10
    return {
      title: highUtilization && !model.pressureLimited ? 'Add/load compressor' : 'Review compressor dispatch balance',
      headline: highUtilization
        ? 'The compressor side is close enough to its working limit that a standby or added load is the safer next move.'
        : 'The wells are not the main limiter right now; dispatch balance on the compressor side needs review first.',
      operationalRisk: 'Medium',
      riskTone: 'orange',
      tone: 'orange',
      expectedBenefit: 'Targets the compression bottleneck directly instead of chasing well-side settings first.',
      reasoningSummary: 'The trusted derived layer is pointing at compressor-side limitation or under-delivery relative to commanded flow. That makes compressor dispatch the better first adjustment axis.',
      dataPointsUsed: [
        `Compressor limited ${model.siteCompressorLimited === true ? 'YES' : 'NO'}`,
        `Average utilization ${formatPercent(model.avgRunningCompressorCapacityPct, 0)}`,
        `Capacity margin ${formatNumber(model.compressorCapacityMargin, 3)} MMSCFD`,
        `Compressors under dispatch ${model.underDispatchCompressors.length}`,
      ],
      whatNotToDo: 'Do not start sacrificing well-side stability if the compressors are the obvious bottleneck.',
      whatWeSee: 'The derived layer sees compressor-side trouble or persistent under-delivery versus demand.',
      whyItMatters: 'Trying to optimize wells while the compressor side is short usually creates confusion instead of recovery.',
      whatToDo: highUtilization && !model.pressureLimited
        ? 'Prepare to add or load standby compression conservatively if the shortfall persists through the next stable observation window.'
        : model.pressureLimited
          ? 'Treat this as a pressure-limited dispatch problem first and review discharge-side behavior before loading harder.'
          : 'Rebalance compressor load first and confirm which unit is not carrying its command before touching well-side tuning.',
      whatRaisesConfidence,
    }
  }

  if (model.chokeHuntingRisk) {
    return {
      title: 'Review choke hunting',
      headline: 'Choke behavior looks unstable enough that slower tuning is safer than more aggressive correction.',
      operationalRisk: 'Medium',
      riskTone: 'orange',
      tone: 'orange',
      expectedBenefit: 'Reduces oscillation and prevents the panel from overreacting to short-term movement.',
      reasoningSummary: 'Large average choke command error or repeated short-interval choke events usually means the panel is chasing response instead of letting the well settle.',
      dataPointsUsed: [
        `Average choke error ${formatPercent(model.averageChokeCommandError, 0)}`,
        `High choke count ${formatNumber(model.highChokeCount, 0)}`,
        `Low choke count ${formatNumber(model.lowChokeCount, 0)}`,
        `Recent choke events ${model.recentChokeEvents}`,
      ],
      whatNotToDo: 'Do not speed up choke corrections while the feedback path already looks noisy.',
      whatWeSee: 'The choke behavior panel is showing enough evidence of hunting or saturation risk to slow down tuning.',
      whyItMatters: 'Faster moves under noisy choke behavior usually produce worse flow stability.',
      whatToDo: 'Increase time between changes or decrease change size before asking the panel to make more aggressive well corrections.',
      whatRaisesConfidence,
    }
  }

  if (model.allWellsWithinBand && !model.recycleOpen) {
    const keepStandbyOffline = (model.avgRunningCompressorCapacityPct ?? 0) < 88 && (model.compressorHeadroomPct ?? 0) > 10
    return {
      title: keepStandbyOffline ? 'Keep standby compressor offline' : 'Hold current settings',
      headline: keepStandbyOffline
        ? 'The pad is balanced enough that the standby unit should stay out until a real deficit appears.'
        : 'The safest next move is to hold current settings and preserve stability.',
      operationalRisk: 'Low',
      riskTone: 'green',
      tone: 'green',
      expectedBenefit: 'Protects stable injection and avoids creating unnecessary oscillation.',
      reasoningSummary: 'All wells are inside the accepted band, recycle is not wasting gas, and compressor capacity still has breathing room. That is the exact scenario where stability should win over more optimization.',
      dataPointsUsed: [
        `Flow alignment ${formatPercent(model.flowAlignmentScore, 0)}`,
        `Wells meeting rate ${formatNumber(model.wellsMeetingRate, 0)}`,
        `Recycle valve ${formatNumber(model.recycleValvePosition, 1)}%`,
        `Average compressor utilization ${formatPercent(model.avgRunningCompressorCapacityPct, 0)}`,
      ],
      whatNotToDo: 'Do not chase tiny second-to-second mismatch while the pad is already aligned.',
      whatWeSee: 'The pad is broadly balanced right now and the trusted score layer is not asking for a large correction.',
      whyItMatters: 'Holding a stable pad is usually more valuable than squeezing out tiny gains at the cost of oscillation risk.',
      whatToDo: keepStandbyOffline
        ? 'Leave the standby compressor out of service and keep watching for a persistent shortfall before adding more machine load.'
        : 'Hold settings, continue monitoring the trusted score layer, and act only if a stable deficit or constraint pattern emerges.',
      whatRaisesConfidence,
    }
  }

  return {
    title: 'Increase low-flow timer',
    headline: 'The pad can improve stability more safely by slowing the correction cadence first.',
    operationalRisk: 'Medium',
    riskTone: 'yellow',
    tone: 'yellow',
    expectedBenefit: 'Helps the panel avoid overcorrecting before the well and compressor response settle.',
    reasoningSummary: 'When the pad is not in a hard constraint but also is not fully stable, the safest engineering move is usually to slow the correction loop before changing larger amplitudes.',
    dataPointsUsed: [
      `Stability score ${formatPercent(model.stabilityScore, 0)}`,
      `Flow target drift ${formatNumber(model.flowTargetDrift, 3)} MMSCFD`,
      `Any well below setpoint ${model.anyWellBelowSetpoint === true ? 'YES' : 'NO'}`,
      `Troubleshooting active ${model.troubleshootingActive === true ? 'YES' : 'NO'}`,
    ],
    whatNotToDo: 'Do not increase bump aggressiveness before you know the existing response lag is acceptable.',
    whatWeSee: 'The pad is not in a hard red state, but it is still active enough that slower correction is safer than harder correction.',
    whyItMatters: 'Lag-aware timing protects the field from chasing transient flow movement.',
    whatToDo: 'Lengthen the low-flow correction timer before changing larger amplitude settings, then watch the next event-memory checkpoints.',
    whatRaisesConfidence,
  }
}

function buildSettingRows(model) {
  const stable = model.allWellsWithinBand && !model.recycleOpen && model.overrideActive !== true
  const hunting = model.chokeHuntingRisk
  const compressorLimited = model.compressorConstraintActive || model.underDispatchCompressors.length > 0
  const pressureRisk = model.overrideActive === true || model.recycleOpen || model.compressorSlowdownProtectionLikely
  const eventHistoryThin = model.eventMemory.length < 2
  const wellRestrictionActive = model.restrictedWellCount > 0 || model.panelSeeingWellTrouble === true
  const stableButExcess = stable && model.flowExcess > 0.03
  const retriggerRisk = hunting || (model.flowTargetDriftPct ?? 0) > 2
  const mk = (row) => ({ confidence: model.confidence.recommendation, tone: 'blue', ...row })

  return [
    mk({
      setting: 'Low Flow Override Amount',
      readiness: stableButExcess ? 'Actionable now' : retriggerRisk ? 'Monitor only' : 'Monitor only',
      recommendation: stableButExcess ? 'Decrease' : stable ? 'Hold' : 'Needs manual validation',
      currentBehavior: stableButExcess
        ? 'Wells are broadly meeting rate and the pad is carrying slight excess flow.'
        : retriggerRisk
          ? 'The loop may be reacting a little faster than the process has time to settle.'
          : 'No strong low-flow amplitude issue is visible in the current state.',
      suggestedChange: stableButExcess
        ? 'Reduce by 5-10% or one small configured step.'
        : retriggerRisk
          ? 'Hold for now. If low-flow retriggers stack, reduce by one small configured step.'
          : 'No change.',
      reason: stableButExcess
        ? 'No wells are short, flow excess exists, and compressor dispatch is already close to target.'
        : retriggerRisk
          ? 'Smaller bumps are only justified if the panel is moving again before the field has physically responded.'
          : 'The live evidence does not justify changing bump size yet.',
      reverseEvidence: 'Reverse to Hold if one or more wells stay below target at the 2-minute and 5-minute checkpoints after any reduction.',
      safetyLimit: 'No more than 10% or one small configured step per change.',
      risk: 'Too much reduction can create a real shortfall on the next under-target event.',
      validation: 'Watch 2-minute and 5-minute well flow response after the next low-flow event.',
      confidence: stableButExcess ? model.confidence.recommendation : retriggerRisk ? model.confidence.stability : model.confidence.recommendation,
      tone: stableButExcess ? 'orange' : stable ? 'green' : 'blue',
    }),
    mk({
      setting: 'Low Flow Override Time Between Changes',
      readiness: retriggerRisk ? 'Requires event history' : 'Monitor only',
      recommendation: retriggerRisk ? 'Increase' : 'Hold',
      currentBehavior: retriggerRisk
        ? 'Repeated correction risk is present or target drift is still moving before the process fully settles.'
        : 'No repeated low-flow retrigger pattern is proven.',
      suggestedChange: retriggerRisk ? 'Increase by 30-60 seconds.' : 'No change unless repeated low-flow retriggers are detected.',
      reason: 'The timer should only be increased when the panel is acting before the process has physically responded.',
      reverseEvidence: 'Reverse to Hold if retriggers stop and wells recover cleanly without stacked low-flow events.',
      safetyLimit: 'Limit to 60 seconds per adjustment unless event memory repeatedly proves more lag.',
      risk: 'Too much delay can slow recovery of a genuinely underfed well.',
      validation: 'Use at least one clean low-flow event with 2-minute and 5-minute recovery checkpoints.',
      confidence: retriggerRisk ? model.confidence.stability : model.confidence.recommendation,
      tone: retriggerRisk ? 'yellow' : 'green',
    }),
    mk({
      setting: 'Low Flow Override Max Change',
      readiness: retriggerRisk ? 'Requires event history' : 'Monitor only',
      recommendation: retriggerRisk ? 'Decrease' : 'Hold',
      currentBehavior: retriggerRisk
        ? 'Correction amplitude may be stacking before lagged field response is visible.'
        : 'No evidence yet that the panel is taking too large a low-flow step.',
      suggestedChange: retriggerRisk ? 'Reduce maximum single-step change by 5-10% or one small configured step.' : 'No change.',
      reason: 'Smaller capped moves protect against overshoot when the process response is slower than the controller loop.',
      reverseEvidence: 'Reverse to Hold if wells remain short after smaller capped steps and pressure/recycle stay stable.',
      safetyLimit: 'Do not cut more than 10% from the max step in one adjustment.',
      risk: 'A cap that is too small can make the pad slow to recover from a real deficit.',
      validation: 'Compare one event before and after the cap change using 2-minute, 5-minute, and 10-minute checkpoints.',
      confidence: retriggerRisk ? model.confidence.stability : model.confidence.recommendation,
      tone: retriggerRisk ? 'yellow' : 'green',
    }),
    mk({
      setting: 'Discharge Override Amount',
      readiness: pressureRisk ? 'Requires event history' : 'Monitor only',
      recommendation: model.overrideActive === true && model.flowExcess > 0.03 ? 'Decrease' : model.overrideActive === true ? 'Hold' : 'Hold',
      currentBehavior: model.overrideActive === true
        ? 'First-layer discharge protection is active on the panel.'
        : 'No active discharge override issue is visible in the current state.',
      suggestedChange: model.overrideActive === true && model.flowExcess > 0.03
        ? 'If pressure remains high while wells are already meeting rate, reduce by 5-10%. If pressure falls too far and wells go short, move the other direction by 5-10%.'
        : 'Hold unless discharge override activates and pressure does not recover.',
      reason: 'The override amount should only move after the event proves whether pressure is being corrected too hard or not hard enough.',
      reverseEvidence: 'Reverse toward Increase if discharge stays above target too long. Reverse to Hold if one clean override event recovers pressure without pushing wells short.',
      safetyLimit: 'Limit to one 5-10% move per review cycle and do not weaken pressure protection below a conservative operating floor.',
      risk: 'Too much reduction can weaken pressure protection. Too much increase can push wells short.',
      validation: 'Review a clean override event with 2-minute, 5-minute, 10-minute, and 20-minute pressure response checkpoints first.',
      confidence: pressureRisk ? model.confidence.safety : model.confidence.recommendation,
      tone: pressureRisk ? 'orange' : 'green',
    }),
    mk({
      setting: 'Discharge Override Timer',
      readiness: model.overrideActive === true ? 'Requires event history' : 'Monitor only',
      recommendation: model.overrideActive === true ? 'Increase' : 'Hold',
      currentBehavior: model.overrideActive === true
        ? 'Pressure protection is active and should not be allowed to chatter.'
        : 'No timer issue is proven right now.',
      suggestedChange: model.overrideActive === true
        ? 'Increase by 30-60 seconds if override triggers before the pressure trend proves sustained high pressure. Decrease by 15-30 seconds only if pressure remains high too long before correction.'
        : 'No change.',
      reason: 'The timer should separate real pressure events from transient spikes and avoid fast oscillation.',
      reverseEvidence: 'Reverse back toward Hold if pressure recovery is timely and override events stop clustering.',
      safetyLimit: 'Increase in 30-60 second steps. Decrease in smaller 15-30 second steps only after repeated evidence.',
      risk: 'A timer that is too long can delay real correction. A timer that is too short can make the panel chatter.',
      validation: 'Compare pre-event and 2-minute / 5-minute pressure recovery before adjusting.',
      confidence: model.overrideActive === true ? model.confidence.safety : model.confidence.recommendation,
      tone: model.overrideActive === true ? 'orange' : 'green',
    }),
    mk({
      setting: 'Discharge Override Max Change',
      readiness: model.overrideActive === true ? 'Requires event history' : 'Monitor only',
      recommendation: model.overrideActive === true && model.flowExcess > 0.03 ? 'Decrease' : 'Hold',
      currentBehavior: model.overrideActive === true
        ? 'Discharge protection is active, so one large correction could overshoot while pressure lags down more slowly than it rises.'
        : 'No evidence yet that the discharge max step is too large.',
      suggestedChange: model.overrideActive === true && model.flowExcess > 0.03 ? 'Reduce the max single-step discharge correction by 5-10%.' : 'No change.',
      reason: 'Capping the step is safer than chasing pressure with large abrupt reductions when pressure inertia is high.',
      reverseEvidence: 'Reverse to Hold if discharge remains high without recovery after smaller steps, or if wells stay short after the reduced cap.',
      safetyLimit: 'No more than 10% per edit.',
      risk: 'If the cap is cut too far, real pressure events may recover too slowly.',
      validation: 'Use override event history, not a single live glance.',
      confidence: model.overrideActive === true ? model.confidence.safety : model.confidence.recommendation,
      tone: model.overrideActive === true ? 'yellow' : 'green',
    }),
    mk({
      setting: 'Discharge Settle-Out Timer',
      readiness: model.overrideActive === true || model.recycleOpen ? 'Requires event history' : 'Monitor only',
      recommendation: model.overrideActive === true || model.recycleOpen ? 'Increase' : 'Hold',
      currentBehavior: model.overrideActive === true || model.recycleOpen
        ? 'Repeated discharge-side evaluation too soon could create back-to-back corrections.'
        : 'No settle-out problem is proven.',
      suggestedChange: model.overrideActive === true || model.recycleOpen ? 'Increase by 60-120 seconds.' : 'No change.',
      reason: 'Discharge pressure recovery is slower than pressure rise, so repeated corrections can create oscillation.',
      reverseEvidence: 'Reverse to Hold if override events stop clustering and pressure settles cleanly before the next correction window.',
      safetyLimit: 'Increase in 60-120 second steps only.',
      risk: 'Long settle-out can delay the next legitimate correction.',
      validation: 'Use event-memory pressure response checkpoints, not a single snapshot.',
      confidence: model.overrideActive === true || model.recycleOpen ? model.confidence.safety : model.confidence.recommendation,
      tone: model.overrideActive === true || model.recycleOpen ? 'yellow' : 'green',
    }),
    mk({
      setting: 'Well Sacrifice Amount',
      readiness: wellRestrictionActive ? 'Requires event history' : compressorLimited && !pressureRisk ? 'Needs manual validation' : 'Monitor only',
      recommendation: wellRestrictionActive ? 'Decrease' : compressorLimited && !pressureRisk ? 'Increase' : 'Hold',
      currentBehavior: wellRestrictionActive
        ? 'One or more wells look restricted or broad sacrifice behavior may be spreading instability.'
        : compressorLimited && !pressureRisk
          ? 'Compressor capacity appears tight without a pressure or recycle intervention dominating.'
          : 'No sacrifice-amplitude problem is clearly justified.',
      suggestedChange: wellRestrictionActive
        ? 'Reduce by 5-10% or one small configured flow step.'
        : compressorLimited && !pressureRisk
          ? 'Increase by one small configured flow step only after validation.'
          : 'No change.',
      reason: wellRestrictionActive
        ? 'Sacrificing too hard can push one well too far below target and make the whole pad less stable.'
        : compressorLimited && !pressureRisk
          ? 'A small increase is only justified when compressor capacity is truly maxed and no pressure or recycle issue is present.'
          : 'The live evidence does not justify a sacrifice amount change.',
      reverseEvidence: 'Reverse to Hold if the affected well recovers without broad pad instability, or if added sacrifice causes recycle/pressure trouble.',
      safetyLimit: 'No more than 10% or one configured flow step per edit.',
      risk: 'Changing sacrifice logic too casually can move instability from one well to the whole pad.',
      validation: 'Confirm calculated desired, choke response, and restriction evidence on the affected well first.',
      confidence: wellRestrictionActive || compressorLimited ? model.confidence.recommendation : model.confidence.recommendation,
      tone: wellRestrictionActive ? 'orange' : compressorLimited ? 'yellow' : 'green',
    }),
    mk({
      setting: 'Well Sacrifice Time Between Changes',
      readiness: wellRestrictionActive || retriggerRisk ? 'Requires event history' : 'Monitor only',
      recommendation: wellRestrictionActive || retriggerRisk ? 'Increase' : 'Hold',
      currentBehavior: wellRestrictionActive || retriggerRisk
        ? 'Sacrifice events may be stacking before flow response is visible.'
        : 'No repeated sacrifice timing problem is proven.',
      suggestedChange: wellRestrictionActive || retriggerRisk ? 'Increase by 30-60 seconds.' : 'No change.',
      reason: 'Longer spacing helps the panel wait for true well response before taking another sacrifice action.',
      reverseEvidence: 'Reverse to Hold if wells recover cleanly without stacked sacrifice events.',
      safetyLimit: 'Increase by no more than 60 seconds at a time.',
      risk: 'Too much delay can slow recovery when a real sacrifice move is needed.',
      validation: 'Use event memory and one-well response history before editing.',
      confidence: wellRestrictionActive || retriggerRisk ? model.confidence.stability : model.confidence.recommendation,
      tone: wellRestrictionActive || retriggerRisk ? 'yellow' : 'green',
    }),
    mk({
      setting: 'Compressor Loaded Gate / Minimum Loaded State / Maximum Loaded State',
      readiness: compressorLimited ? 'Needs manual validation' : 'Monitor only',
      recommendation: compressorLimited ? 'Increase' : 'Hold',
      currentBehavior: compressorLimited
        ? 'Compressors may be counted as available before they are carrying load cleanly.'
        : 'No compressor gating issue is proven.',
      suggestedChange: compressorLimited ? 'Increase gate delay by 30-60 seconds. Decrease only if a proven stable compressor is being ignored too long.' : 'No change.',
      reason: 'Dispatch logic should wait until a unit is truly loaded and stable before treating it as usable capacity.',
      reverseEvidence: 'Reverse to Hold if per-unit command versus actual flow aligns cleanly and standby/active sequencing becomes stable.',
      safetyLimit: 'Change delay in 30-60 second steps only. Do not widen min/max loaded state in one large jump.',
      risk: 'Changing loading logic too early can destabilize a pad that is otherwise balanced.',
      validation: 'Review per-unit command versus actual flow and event memory around compressor starts and stops.',
      confidence: compressorLimited ? model.confidence.recommendation : model.confidence.recommendation,
      tone: compressorLimited ? 'orange' : 'green',
    }),
    mk({
      setting: 'Compressor Max Flow Rate',
      readiness: compressorLimited ? 'Requires event history' : 'Monitor only',
      recommendation: eventHistoryThin ? 'Lock out / do not change' : compressorLimited ? 'Needs manual validation' : 'Hold',
      currentBehavior: compressorLimited
        ? 'Headroom or dispatch margin is being consumed.'
        : 'No max-flow problem is proven from the current state.',
      suggestedChange: eventHistoryThin
        ? 'Do not adjust from one snapshot.'
        : compressorLimited
          ? 'Increase by 2-5% only if verified compressor capacity repeatedly exceeds the model without pressure or recycle instability. Decrease by 2-5% only if a unit repeatedly cannot meet modeled max flow under normal suction/discharge conditions.'
          : 'No change.',
      reason: 'Max-flow edits need repeated compressor-side evidence, not a single live view.',
      reverseEvidence: 'Reverse to Hold if repeated evidence disappears, or if a higher max creates pressure / recycle instability.',
      safetyLimit: 'Cap edits at 2-5% per review cycle.',
      risk: 'Pushing max flow too high can create pressure and recycle instability; pushing it too low can strand usable capacity.',
      validation: 'Check unit temperature, suction, discharge, utilization, and persistent under-delivery before editing limits.',
      confidence: compressorLimited ? model.confidence.recommendation : model.confidence.recommendation,
      tone: eventHistoryThin ? 'blue' : compressorLimited ? 'orange' : 'green',
    }),
    mk({
      setting: 'Choke PID Min Output',
      readiness: wellRestrictionActive || hunting ? 'Needs manual validation' : 'Monitor only',
      recommendation: wellRestrictionActive ? 'Increase' : hunting ? 'Hold' : 'Hold',
      currentBehavior: wellRestrictionActive
        ? 'At least one well looks response-limited and may not be reacting to low command cleanly.'
        : hunting
          ? 'Choke behavior looks twitchy, so a broad PID minimum change would be risky.'
          : 'No choke baseline problem is proven.',
      suggestedChange: wellRestrictionActive ? 'Increase minimum output by 2-5% on the affected well only after validation. Do not apply globally.' : 'No change.',
      reason: 'This should only move when one well is clearly not responding to the current correction range.',
      reverseEvidence: 'Reverse to Hold if the affected well responds without needing a higher minimum output, or if a higher output worsens hunting.',
      safetyLimit: '2-5% on one well only. No global edit from a mixed pad snapshot.',
      risk: 'Improper minimum output changes can mask restriction or create hunting.',
      validation: 'Validate on one well with clean pre/post response, not on the full pad at once.',
      confidence: wellRestrictionActive || hunting ? model.confidence.recommendation : model.confidence.recommendation,
      tone: wellRestrictionActive ? 'yellow' : hunting ? 'blue' : 'green',
    }),
    mk({
      setting: 'Suction Valve PID / Recycle Valve PID',
      readiness: model.recycleOpen ? 'Requires event history' : 'Monitor only',
      recommendation: model.recycleOpen ? 'Needs manual validation' : 'Hold',
      currentBehavior: model.recycleOpen
        ? 'Recycle or suction-side behavior is participating in current pad balance.'
        : 'No PID instability is clearly visible.',
      suggestedChange: model.recycleOpen ? 'Hold unless recycle or suction oscillation is proven. If oscillation is confirmed, make only small tuning steps after event history review.' : 'No change.',
      reason: 'Valve PID tuning should follow confirmed recycle or suction instability, not a single flow miss.',
      reverseEvidence: 'Reverse to Hold if recycle events stop or if pressure response proves stable after non-PID changes.',
      safetyLimit: 'Small tuning steps only after event history confirms oscillation. Do not stack PID changes with other major tuning edits.',
      risk: 'PID changes can create broad system oscillation if applied without trend validation.',
      validation: 'Use recycle events and pressure response checkpoints first.',
      confidence: model.recycleOpen ? model.confidence.stability : model.confidence.recommendation,
      tone: model.recycleOpen ? 'yellow' : 'green',
    }),
  ]
}

function buildEventSnapshot(model) {
  return {
    totalActualFlow: model.totalActualFlow,
    totalDesiredFlow: model.totalDesiredFlow,
    recycleValvePosition: model.recycleValvePosition,
    dischargeHeaderPressure: model.dischargeHeaderPressure,
    stabilityScore: model.stabilityScore,
    underTargetWellIds: model.wells.filter((well) => well.status === 'under').map((well) => well.label),
    overrideActive: model.overrideActive,
    recycleOpen: model.recycleOpen,
    commandedCompressorFlow: model.wellPanelCommandedCompressorFlow,
    chokeSignature: model.wells.map((well) => well.chokePosition ?? 'x').join('|'),
    compressorRunSignature: model.compressors.map((compressor) => `${compressor.key}:${compressor.running ? 1 : 0}`).join('|'),
  }
}

function createEvent(type, title, now, pre, confidence) {
  return {
    id: `${type}-${now}`,
    type,
    title,
    createdAt: now,
    pre,
    checkpoints: {},
    confidence,
  }
}

function updateEventMemory(events, previousSnapshot, nextSnapshot, confidence) {
  const now = Date.now()
  const nextEvents = [...events]

  if (previousSnapshot) {
    if (!previousSnapshot.overrideActive && nextSnapshot.overrideActive) {
      nextEvents.unshift(createEvent('discharge-override', 'Discharge override event', now, previousSnapshot, confidence.safety))
    }
    if (!previousSnapshot.recycleOpen && nextSnapshot.recycleOpen) {
      nextEvents.unshift(createEvent('recycle-open', 'Recycle opening event', now, previousSnapshot, confidence.stability))
    }
    if (previousSnapshot.underTargetWellIds.length === 0 && nextSnapshot.underTargetWellIds.length > 0) {
      nextEvents.unshift(createEvent('wells-below-target', 'Wells fell below target', now, previousSnapshot, confidence.recommendation))
    }
    if (previousSnapshot.underTargetWellIds.length > 0 && nextSnapshot.underTargetWellIds.length === 0) {
      nextEvents.unshift(createEvent('wells-recovered', 'Wells recovered to target', now, previousSnapshot, confidence.recommendation))
    }
    if (previousSnapshot.commandedCompressorFlow != null && nextSnapshot.commandedCompressorFlow != null && Math.abs(previousSnapshot.commandedCompressorFlow - nextSnapshot.commandedCompressorFlow) >= 0.05) {
      nextEvents.unshift(createEvent('compressor-command-change', 'Compressor command change', now, previousSnapshot, confidence.recommendation))
    }
    if (previousSnapshot.compressorRunSignature !== nextSnapshot.compressorRunSignature) {
      nextEvents.unshift(createEvent('compressor-start-stop', 'Compressor run-state change', now, previousSnapshot, confidence.safety))
    }
    if (previousSnapshot.chokeSignature !== nextSnapshot.chokeSignature) {
      nextEvents.unshift(createEvent('choke-adjustment', 'Choke adjustment event', now, previousSnapshot, confidence.stability))
    }
  }

  const snapshotForCheckpoint = {
    totalActualFlow: nextSnapshot.totalActualFlow,
    totalDesiredFlow: nextSnapshot.totalDesiredFlow,
    recycleValvePosition: nextSnapshot.recycleValvePosition,
    dischargeHeaderPressure: nextSnapshot.dischargeHeaderPressure,
    stabilityScore: confidence.stability,
  }

  const enriched = nextEvents.map((event) => {
    const createdAt = new Date(event.createdAt).getTime()
    if (!Number.isFinite(createdAt)) return event
    const checkpoints = { ...(event.checkpoints || {}) }
    for (const minutes of EVENT_CHECKPOINTS_MINUTES) {
      const key = String(minutes)
      if (checkpoints[key]) continue
      if (now - createdAt >= minutes * 60 * 1000) {
        checkpoints[key] = snapshotForCheckpoint
      }
    }
    return { ...event, checkpoints }
  })

  return enriched.slice(0, 18)
}

export default function HalfmannOptimizationView() {
  const {
    panelData,
    unitDataRaw,
    lastRefresh,
    loading,
    liveError,
    commsStatus,
  } = useHalfmannData()

  const [eventMemory, setEventMemory] = useState(() => readEventMemory())

  const model = useMemo(() => {
    const wellTolerance = TARGET_TOLERANCE_PCT

    const panelDataConfidence = getNumberByAddress(panelData, PANEL_ADDR.aiDataConfidence)
    const flowAlignmentScore = getNumberByAddress(panelData, PANEL_ADDR.aiFlowAlignmentScore)
    const totalFlowDeficit = getNumberByAddress(panelData, PANEL_ADDR.aiTotalFlowDeficit)
    const totalFlowExcess = getNumberByAddress(panelData, PANEL_ADDR.aiTotalFlowExcess)
    const compressorCapacityMargin = getNumberByAddress(panelData, PANEL_ADDR.aiCompressorCapacityMargin)
    const compressorHeadroomPct = getNumberByAddress(panelData, PANEL_ADDR.aiCompressorHeadroomPct)
    const compressorDispatchError = getNumberByAddress(panelData, PANEL_ADDR.aiCompressorDispatchError)
    const compressorDispatchMatchScore = getNumberByAddress(panelData, PANEL_ADDR.aiCompressorDispatchMatchScore)
    const recycleWasteScore = getNumberByAddress(panelData, PANEL_ADDR.aiRecycleWasteScore)
    const averageChokeCommandError = getNumberByAddress(panelData, PANEL_ADDR.aiAverageChokeCommandError)
    const highChokeCount = getNumberByAddress(panelData, PANEL_ADDR.aiHighChokeCount)
    const lowChokeCount = getNumberByAddress(panelData, PANEL_ADDR.aiLowChokeCount)
    const restrictedWellCount = getNumberByAddress(panelData, PANEL_ADDR.aiRestrictedWellCandidateCount)
    const overTargetCount = getNumberByAddress(panelData, PANEL_ADDR.aiOverTargetWellCount)
    const underTargetCount = getNumberByAddress(panelData, PANEL_ADDR.aiUnderTargetWellCount)
    const stabilityScore = getNumberByAddress(panelData, PANEL_ADDR.aiStabilityScore)
    const recommendationConfidenceRaw = getNumberByAddress(panelData, PANEL_ADDR.aiRecommendationConfidence)
    const currentCompressorCapacity = getNumberByAddress(panelData, PANEL_ADDR.currentCompressorCapacity)
    const avgRunningCompressorCapacityPct = getNumberByAddress(panelData, PANEL_ADDR.avgRunningCompressorCapacityPct)
    const wellPanelCommandedCompressorFlow = getNumberByAddress(panelData, PANEL_ADDR.wellPanelCommandedCompressorFlow)
    const totalAscCompressorFlow = getNumberByAddress(panelData, PANEL_ADDR.totalAscCompressorFlow)
    const totalCompressorFlowMinusDesired = getNumberByAddress(panelData, PANEL_ADDR.totalCompressorFlowMinusDesired)
    const recycleValvePosition = getNumberByAddress(panelData, PANEL_ADDR.recycleValvePosition)
    const recycleValveCommand = getNumberByAddress(panelData, PANEL_ADDR.recycleValveCommand)
    const suctionHeaderPressure = getNumberByAddress(panelData, PANEL_ADDR.suctionHeaderPressure)
    const suctionSalesValvePosition = getNumberByAddress(panelData, PANEL_ADDR.suctionSalesValvePosition)
    const suctionSalesValveCommand = getNumberByAddress(panelData, PANEL_ADDR.suctionSalesValveCommand)
    const totalActualFlow = getNumberByAddress(panelData, PANEL_ADDR.totalSiteFlow) ?? getNumberByAddress(panelData, PANEL_ADDR.totalAscCompressorFlow)
    const totalDesiredFlow = getNumberByAddress(panelData, PANEL_ADDR.totalCalculatedDesiredInjection) ?? getNumberByAddress(panelData, PANEL_ADDR.totalDesiredSiteFlow)
    const allWellsMeetingFlow = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.allWellsMeetingFlow))
    const anyWellBelowSetpoint = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.anyWellBelowSetpoint))
    const anyWellOffline = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.anyWellOffline))
    const anyWellInManual = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.anyWellInManual))
    const anyCompressorCommsLoss = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.anyCompressorCommsLoss))
    const anyCompressorNotMeeting = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.anyCompressorNotMeetingDesiredFlow))
    const siteCompressorLimited = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.siteCompressorLimited))
    const siteWellDeliveryLimited = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.siteWellDeliveryLimited))
    const panelSeeingCompressorTrouble = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.panelSeeingCompressorTrouble))
    const panelSeeingWellTrouble = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.panelSeeingWellTrouble))
    const troubleshootingActive = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.troubleshootingActive))
    const flowTargetBeingReduced = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.flowTargetBeingReduced))
    const flowTargetFollowingCompressor = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.flowTargetFollowingCompressor))
    const possibleCompressorUnload = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.possibleCompressorUnload))
    const addFlowOpportunityFlag = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.aiAddFlowOpportunityFlag))
    const reduceFlowOpportunityFlag = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.aiReduceFlowOpportunityFlag))
    const compressorConstraintActive = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.aiCompressorConstraintFlag))
    const tuningSafe = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.aiTuningSafeToEvaluateFlag))
    const investigateRestrictionFlag = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.aiInvestigateRestrictionFlag))
    const recycleActiveFlag = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.aiRecycleActiveFlag))
    const overrideActive = (getNumberByAddress(panelData, PANEL_ADDR.de4000OverrideLatch) ?? 0) > 0
    const overrideCompSpeedSp = getNumberByAddress(panelData, PANEL_ADDR.de4000OverrideCompSpeedSp)
    const recommendedCompressors = getNumberByAddress(panelData, PANEL_ADDR.recommendedCompressors)
    const wellsMeetingRate = getNumberByAddress(panelData, PANEL_ADDR.wellsMeetingRate)
    const flowTroubleshooter = getTextByAddress(panelData, PANEL_ADDR.flowTroubleshooter)
    const runtimeCause = getTextByAddress(panelData, PANEL_ADDR.runtimeCause)
    const flowTargetDrift = getNumberByAddress(panelData, PANEL_ADDR.flowTargetDrift)
    const flowTargetDriftPct = getNumberByAddress(panelData, PANEL_ADDR.flowTargetDriftPct)

    const wells = WELL_NAMES.map((wellName, index) => {
      const label = `Well ${wellName}`
      const actual = getNumberByAddress(panelData, PANEL_ADDR.wellFlow[index])
      const customerTarget = getNumberByAddress(panelData, PANEL_ADDR.wellSetpoint[index])
      const calculatedDesired = getNumberByAddress(panelData, PANEL_ADDR.wellCalculatedDesiredFlow[index])
      const target = calculatedDesired ?? customerTarget
      const flowError = actual != null && target != null ? actual - target : null
      const matchPct = getNumberByAddress(panelData, PANEL_ADDR.wellMatchPct[index])
      const chokePosition = getNumberByAddress(panelData, PANEL_ADDR.wellChokePosition[index])
      const chokeCommand = null
      const casingPressure = getNumberByAddress(panelData, PANEL_ADDR.wellCasingPressure[index])
      const tubingPressure = getNumberByAddress(panelData, PANEL_ADDR.wellTubingPressure[index])
      const differentialPressure = getNumberByAddress(panelData, PANEL_ADDR.wellDifferentialPressure[index])
      const yesterdayFlow = getNumberByAddress(panelData, PANEL_ADDR.wellYesterdayFlow[index])
      const staticPressure = getNumberByAddress(panelData, PANEL_ADDR.wellStaticPressure[index])
      const gasPriority = getNumberByAddress(panelData, PANEL_ADDR.wellGasPriority[index])
      const oilPriority = getNumberByAddress(panelData, PANEL_ADDR.wellOilPriority[index])
      const maxFlowRate = getNumberByAddress(panelData, PANEL_ADDR.wellMaxFlowRate[index])
      const pidMinOutput = getNumberByAddress(panelData, PANEL_ADDR.wellPidMinOutput[index])
      const flowRunningStatusPct = getNumberByAddress(panelData, PANEL_ADDR.wellFlowRunningStatusPct[index])
      const overridePosition = getNumberByAddress(panelData, PANEL_ADDR.wellOverridePosition[index])
      const manualMode = parseMode(getTextByAddress(panelData, PANEL_ADDR.wellManualAuto[index]))
      const running = parseRunning(getTextByAddress(panelData, PANEL_ADDR.wellRunningStatus[index]))
      const tolerance = target != null ? target * (wellTolerance / 100) : null
      const status = flowError == null || tolerance == null
        ? 'unknown'
        : flowError < -tolerance
          ? 'under'
          : flowError > tolerance
            ? 'over'
            : 'aligned'
      const restrictedRiskScore =
        (status === 'under' ? 30 : 0)
        + ((chokePosition ?? 0) >= 90 ? 25 : 0)
        + ((matchPct ?? 100) < 95 ? 18 : 0)
        + (manualMode === 'manual' ? 20 : 0)
        + (investigateRestrictionFlag === true ? 18 : 0)
      const restrictedRisk = restrictedRiskScore >= 50 ? 'High' : restrictedRiskScore >= 25 ? 'Medium' : 'Low'
      const opportunityScore = clamp(
        55
        + (status === 'under' ? 26 : status === 'over' ? -18 : 4)
        + (gasPriority != null ? (6 - gasPriority) * 4 : 0)
        + (manualMode === 'manual' ? -30 : 0)
        + (running === false ? -25 : 0)
        + ((chokePosition ?? 50) >= 95 ? -18 : 6)
        + ((differentialPressure ?? 0) > 100 ? 8 : 0)
        + ((matchPct ?? 100) < 95 ? 10 : 0),
        0,
        100,
      )
      const recommendation = status === 'under'
        ? restrictedRisk === 'High'
          ? 'Review restricted-well behavior before adding more pad gas.'
          : 'Best near-term gas candidate if compressor margin exists.'
        : status === 'over'
          ? 'Do not give this well additional gas right now.'
          : status === 'aligned'
            ? 'Hold current allocation unless another well shows a persistent deficit.'
            : 'Insufficient live signal for a ranked move.'
      const recommendationReason = status === 'under'
        ? restrictedRisk === 'High'
          ? 'Below target while already showing weak response or high choke demand.'
          : 'Below target with some room to improve if compressor-side limits are clear.'
        : status === 'over'
          ? 'Already above its desired flow and is a trim candidate before adding site flow.'
          : status === 'aligned'
            ? 'Inside the accepted match band and not the best place to hunt for gain.'
            : 'Missing target or live response data lowers confidence.'
      return {
        index,
        label,
        actual,
        target,
        customerTarget,
        calculatedDesired,
        flowError,
        matchPct,
        chokePosition,
        chokeCommand,
        casingPressure,
        tubingPressure,
        differentialPressure,
        yesterdayFlow,
        staticPressure,
        gasPriority,
        oilPriority,
        maxFlowRate,
        pidMinOutput,
        flowRunningStatusPct,
        overridePosition,
        manualMode,
        running,
        status,
        restrictedRisk,
        opportunityScore,
        recommendation,
        recommendationReason,
        priorityLabel: gasPriority != null ? `Gas priority ${gasPriority}` : 'Priority limited',
        tone: status === 'under' ? (restrictedRisk === 'High' ? 'red' : 'orange') : status === 'over' ? 'yellow' : status === 'aligned' ? 'green' : 'blue',
      }
    })

    const compressors = HALFMANN_UNITS.map((unit, index) => {
      const desiredFlow = getNumberByAddress(panelData, PANEL_ADDR.unitDesiredFlow[index]) ?? null
      const actualFlow = getNumberByAddress(panelData, PANEL_ADDR.unitCurrentFlowOutput[index]) ?? getNumberByAddresses(unitDataRaw[unit.key], UNIT_ADDRESSES.actualFlow) ?? null
      const maxFlow = getNumberByAddress(panelData, PANEL_ADDR.unitMaxFlowRate[index]) ?? null
      const utilization = actualFlow != null && maxFlow != null && maxFlow > 0 ? (actualFlow / maxFlow) * 100 : null
      const meetingBit = parseBoolean(getTextByAddress(panelData, PANEL_ADDR.compressorMeetingBits[index]))
      const commsLoss = parseRunning(getTextByAddress(panelData, PANEL_ADDR.unitCommsLoss[index])) === false
      const running = parseRunning(getTextByAddress(panelData, PANEL_ADDR.unitRunStatus[index])) ?? ((getNumberByAddresses(unitDataRaw[unit.key], UNIT_ADDRESSES.engineSpeed) ?? 0) > 100)
      const rpm = getNumberByAddresses(unitDataRaw[unit.key], UNIT_ADDRESSES.engineSpeed)
      const suction = getNumberByAddresses(unitDataRaw[unit.key], UNIT_ADDRESSES.suctionPressure)
      const discharge = getNumberByAddresses(unitDataRaw[unit.key], UNIT_ADDRESSES.dischargePressure)
      const loadedAutoSp = getNumberByAddresses(unitDataRaw[unit.key], UNIT_ADDRESSES.loadedAutoSp)
      const flowError = actualFlow != null && desiredFlow != null ? actualFlow - desiredFlow : null
      const underDispatch = meetingBit === false || (flowError != null && desiredFlow != null && flowError < -(desiredFlow * 0.05))
      const overDispatch = flowError != null && desiredFlow != null && flowError > desiredFlow * 0.05
      const tone = commsLoss ? 'red' : underDispatch ? 'orange' : overDispatch ? 'yellow' : running ? 'green' : 'blue'
      const statusLabel = commsLoss
        ? 'Comms Loss'
        : !running
          ? unit.standby ? 'Standby' : 'Stopped'
          : underDispatch
            ? 'Below Dispatch'
            : overDispatch
              ? 'Above Dispatch'
              : 'Balanced'
      const guidance = commsLoss
        ? 'Do not treat this unit as a stable anchor until its live comms quality recovers.'
        : underDispatch
          ? 'Unit is not carrying commanded flow cleanly. Review suction, discharge, and whether recycle or unload behavior is interfering.'
          : overDispatch
            ? 'This unit is carrying more than requested. Trim here before adding more total site gas.'
            : !running
              ? unit.standby
                ? 'Standby machine is available if the active fleet proves compressor-limited.'
                : 'Offline unit. Do not assume its capacity until it is confirmed loaded and stable.'
              : 'Use this unit as a stable anchor before making aggressive well-side changes.'
      return {
        key: unit.key,
        label: unit.label,
        standby: unit.standby,
        desiredFlow,
        actualFlow,
        maxFlow,
        utilization,
        meetingBit,
        commsLoss,
        running,
        rpm,
        suction,
        discharge,
        loadedAutoSp,
        flowError,
        underDispatch,
        overDispatch,
        tone,
        statusLabel,
        guidance,
      }
    })

    const derivedUnderTargetCount = wells.filter((well) => well.status === 'under').length
    const derivedOverTargetCount = wells.filter((well) => well.status === 'over').length
    const normalizedUnderTargetCount = underTargetCount ?? derivedUnderTargetCount
    const normalizedOverTargetCount = overTargetCount ?? derivedOverTargetCount
    const allWellsWithinBand = normalizedUnderTargetCount === 0 && (allWellsMeetingFlow === true || wells.every((well) => well.status === 'aligned' || well.status === 'over'))
    const recycleOpen = recycleValvePosition != null ? recycleValvePosition > 5 : recycleActiveFlag === true
    const dischargeHeaderPressure = average(compressors.filter((compressor) => compressor.running && compressor.discharge != null).map((compressor) => compressor.discharge))
    const recentChokeEvents = eventMemory.filter((event) => event.type === 'choke-adjustment').length
    const chokeHuntingRisk = (averageChokeCommandError ?? 0) >= 8 || recentChokeEvents >= 3
    const compressorSlowdownProtectionLikely =
      !overrideActive &&
      !recycleOpen &&
      normalizedUnderTargetCount > 0 &&
      (panelSeeingCompressorTrouble === true || siteCompressorLimited === true) &&
      compressors.some((compressor) => compressor.running && compressor.underDispatch)
    const pressureLimited = normalizedUnderTargetCount > 0 && (overrideActive || recycleOpen || compressorSlowdownProtectionLikely)

    const rawDataConfidence = panelDataConfidence ?? clamp(
      100
      - (wells.filter((well) => well.actual == null || well.target == null).length * 7)
      - (compressors.filter((compressor) => compressor.actualFlow == null || compressor.desiredFlow == null).length * 6)
      - (recycleValvePosition == null ? 8 : 0)
      - (suctionHeaderPressure == null ? 6 : 0),
      25,
      100,
    )
    const rawStabilityConfidence = stabilityScore ?? clamp(
      100
      - (overrideActive ? 28 : 0)
      - (recycleOpen ? 18 : 0)
      - (chokeHuntingRisk ? 14 : 0)
      - (normalizedUnderTargetCount * 6),
      20,
      100,
    )
    const rawSafetyConfidence = clamp(
      100
      - (tuningSafe === false ? 28 : 0)
      - (anyWellInManual === true ? 16 : 0)
      - (anyCompressorCommsLoss === true ? 18 : 0)
      - (commsStatus?.isHolding ? 22 : 0)
      - (overrideActive ? 12 : 0),
      20,
      100,
    )
    const rawRecommendationConfidence = recommendationConfidenceRaw ?? clamp(
      Math.min(rawDataConfidence, rawStabilityConfidence, rawSafetyConfidence)
      - (liveError ? 10 : 0)
      - (normalizedUnderTargetCount > 0 && restrictedWellCount == null ? 6 : 0),
      15,
      100,
    )

    const confidence = {
      data: rawDataConfidence,
      stability: rawStabilityConfidence,
      recommendation: rawRecommendationConfidence,
      safety: rawSafetyConfidence,
    }

    const primaryRecommendation = buildPrimaryRecommendation({
      wells,
      compressors,
      confidence,
      allWellsWithinBand,
      recycleOpen,
      overrideActive,
      anyWellOffline,
      anyWellInManual,
      anyCompressorCommsLoss,
      recycleValvePosition,
      suctionHeaderPressure,
      compressorHeadroomPct,
      compressorCapacityMargin,
      compressorConstraintActive,
      panelSeeingWellTrouble,
      restrictedWellCount: restrictedWellCount ?? wells.filter((well) => well.restrictedRisk === 'High').length,
      underDispatchCompressors: compressors.filter((compressor) => compressor.underDispatch),
      avgRunningCompressorCapacityPct,
      flowExcess: totalFlowExcess ?? Math.max(0, (totalActualFlow ?? 0) - (totalDesiredFlow ?? 0)),
      flowDeficit: totalFlowDeficit ?? Math.max(0, (totalDesiredFlow ?? 0) - (totalActualFlow ?? 0)),
      dischargeHeaderPressure,
      tuningSafe,
      allWellsMeetingFlow,
      flowAlignmentScore: flowAlignmentScore ?? clamp(((totalActualFlow ?? 0) / Math.max(totalDesiredFlow ?? 1, 1)) * 100, 0, 140),
      troubleshootingActive,
      anyWellBelowSetpoint,
      flowTargetDrift,
      stabilityScore: rawStabilityConfidence,
      siteCompressorLimited,
      commsHold: Boolean(commsStatus?.isHolding),
      commsMessage: commsStatus?.message || '',
      recycleWasteScore,
      highChokeCount,
      lowChokeCount,
      averageChokeCommandError,
      recentChokeEvents,
      chokeHuntingRisk,
      underTargetCount: normalizedUnderTargetCount,
      panelSeeingCompressorTrouble,
      siteWellDeliveryLimited,
      wellPanelCommandedCompressorFlow,
      totalCompressorFlowMinusDesired,
      compressorDispatchMatchScore,
      overrideCompSpeedSp,
    })

    return {
      lastRefresh,
      liveError,
      commsStatus,
      commsHold: Boolean(commsStatus?.isHolding),
      totalActualFlow,
      totalDesiredFlow,
      flowAlignmentScore: flowAlignmentScore ?? clamp(((totalActualFlow ?? 0) / Math.max(totalDesiredFlow ?? 1, 1)) * 100, 0, 140),
      flowDeficit: totalFlowDeficit ?? Math.max(0, (totalDesiredFlow ?? 0) - (totalActualFlow ?? 0)),
      flowExcess: totalFlowExcess ?? Math.max(0, (totalActualFlow ?? 0) - (totalDesiredFlow ?? 0)),
      compressorCapacityMargin,
      compressorHeadroomPct,
      compressorDispatchError,
      compressorDispatchMatchScore,
      recycleWasteScore,
      averageChokeCommandError,
      highChokeCount,
      lowChokeCount,
      restrictedWellCount: restrictedWellCount ?? wells.filter((well) => well.restrictedRisk === 'High').length,
      underTargetCount: normalizedUnderTargetCount,
      overTargetCount: normalizedOverTargetCount,
      stabilityScore: rawStabilityConfidence,
      recommendationConfidence: rawRecommendationConfidence,
      allWellsMeetingFlow,
      anyWellBelowSetpoint,
      anyWellOffline,
      anyWellInManual,
      anyCompressorCommsLoss,
      anyCompressorNotMeeting,
      siteCompressorLimited,
      siteWellDeliveryLimited,
      panelSeeingCompressorTrouble,
      panelSeeingWellTrouble,
      troubleshootingActive,
      flowTargetBeingReduced,
      flowTargetFollowingCompressor,
      possibleCompressorUnload,
      addFlowOpportunityFlag,
      reduceFlowOpportunityFlag,
      compressorConstraintActive: compressorConstraintActive || siteCompressorLimited === true || panelSeeingCompressorTrouble === true,
      tuningSafe,
      investigateRestrictionFlag,
      recycleActiveFlag,
      overrideActive,
      overrideCompSpeedSp,
      recommendedCompressors,
      wellsMeetingRate: wellsMeetingRate ?? wells.filter((well) => well.status === 'aligned' || well.status === 'over').length,
      flowTroubleshooter,
      runtimeCause,
      flowTargetDrift,
      flowTargetDriftPct,
      recycleValvePosition,
      recycleValveCommand,
      recycleOpen,
      suctionHeaderPressure,
      suctionSalesValvePosition,
      suctionSalesValveCommand,
      totalAscCompressorFlow,
      currentCompressorCapacity,
      avgRunningCompressorCapacityPct,
      wellPanelCommandedCompressorFlow,
      totalCompressorFlowMinusDesired,
      dischargeHeaderPressure,
      wells,
      compressors,
      eventMemory,
      runningCompressors: compressors.filter((compressor) => compressor.running && !compressor.standby),
      underDispatchCompressors: compressors.filter((compressor) => compressor.underDispatch),
      overDispatchCompressors: compressors.filter((compressor) => compressor.overDispatch),
      allWellsWithinBand,
      confidence,
      primaryRecommendation,
      chokeHuntingRisk,
      recentChokeEvents,
      compressorSlowdownProtectionLikely,
      pressureLimited,
    }
  }, [panelData, unitDataRaw, lastRefresh, liveError, commsStatus, eventMemory])

  useEffect(() => {
    const nextSnapshot = buildEventSnapshot(model)
    const previousEvents = readEventMemory()
    const previousSnapshot = previousEvents.length ? previousEvents[0]?.latestSnapshot ?? null : null
    const updated = updateEventMemory(previousEvents, previousSnapshot, nextSnapshot, model.confidence)
      .map((event) => ({
        ...event,
        latestSnapshot: nextSnapshot,
      }))
    setEventMemory(updated)
    saveEventMemory(updated)
  }, [model])

  const settingRows = useMemo(() => buildSettingRows(model), [model])

  const padBalanceText = model.flowDeficit > 0.03
    ? 'Underfed'
    : model.flowExcess > 0.03
      ? 'Overfed'
      : 'Aligned'

  const wellsNeedingGas = model.wells.filter((well) => well.status === 'under')
  const wellsToAvoid = model.wells.filter((well) => well.status === 'over' || well.manualMode === 'manual' || well.running === false)
  const stableEnoughForChange = model.confidence.stability >= 70 && model.confidence.safety >= 70 && model.overrideActive !== true && !model.commsHold

  const dataQualityLines = [
    model.liveError ? `Live API warning: ${model.liveError}` : 'Live API is currently responding.',
    model.commsStatus?.message || 'No active comms hold is present.',
    model.wells.some((well) => well.chokePosition == null) ? 'Some choke feedback is still missing from the live feed.' : 'Choke position coverage is currently present.',
    model.wells.some((well) => well.casingPressure == null || well.tubingPressure == null) ? 'Some casing/tubing pressure tags are unavailable.' : 'Casing/tubing pressure coverage is currently present.',
  ]

  return (
    <div style={{
      minHeight: '100%',
      color: '#e2e8f0',
      background: 'radial-gradient(circle at top right, rgba(73,208,226,0.12), transparent 30%), radial-gradient(circle at bottom left, rgba(59,130,246,0.08), transparent 24%), linear-gradient(180deg, #04070d 0%, #070d16 45%, #05070c 100%)',
      padding: 20,
    }}>
      <div style={{ maxWidth: 1500, margin: '0 auto', display: 'grid', gap: 18 }}>
        <section style={{
          border: '1px solid #17314b',
          borderRadius: 28,
          padding: '24px 24px 20px',
          background: 'linear-gradient(135deg, rgba(7,18,29,0.98) 0%, rgba(4,8,14,1) 100%)',
          boxShadow: '0 22px 52px rgba(0, 0, 0, 0.34)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute',
            top: -40,
            right: -20,
            width: 230,
            height: 230,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(73,208,226,0.18) 0%, rgba(73,208,226,0.03) 60%, transparent 74%)',
            pointerEvents: 'none',
          }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', position: 'relative' }}>
            <div style={{ maxWidth: 860 }}>
              <div style={{ fontSize: 10, color: '#49D0E2', fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 10 }}>
                WellLogic Gas Lift / Injection Optimization Advisor
              </div>
              <div style={{ fontSize: 34, lineHeight: 1.08, color: '#f8fafc', fontWeight: 900, fontFamily: "'Arial Black', sans-serif", marginBottom: 12 }}>
                Advisory optimization only. Facts first, recommendations second, stability always first.
              </div>
              <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.8 }}>
                This page uses the trusted M-Link derived score layer and live register evidence to recommend the safest next operational adjustment. It does not directly control equipment, write setpoints, or approve changes on its own.
              </div>
            </div>
            <div style={{ minWidth: 280, display: 'grid', gap: 10, alignContent: 'start' }}>
              <div style={{ border: '1px solid #1f3650', background: 'rgba(7,18,30,0.82)', borderRadius: 18, padding: '14px 16px' }}>
                <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>Last Accepted Refresh</div>
                <div style={{ fontSize: 18, color: '#f8fafc', fontWeight: 800 }}>{model.lastRefresh ? model.lastRefresh.toLocaleTimeString() : loading ? 'Loading live data' : 'Waiting for first accepted refresh'}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                  {liveError || commsStatus?.message || 'Recommendations refresh automatically as the live derived layer updates.'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Chip text={`${formatPercent(model.confidence.data, 0)} data confidence`} tone={confidenceTone(model.confidence.data)} />
                <Chip text={`${formatPercent(model.confidence.recommendation, 0)} recommendation confidence`} tone={confidenceTone(model.confidence.recommendation)} />
              </div>
            </div>
          </div>
        </section>

        <SectionCard title="Executive Recommendation" eyebrow="Section 1">
          <ExecutiveCard recommendation={model.primaryRecommendation} confidence={model.confidence} />
        </SectionCard>

        <SectionCard title="Gas Lift / Injection Balance Score" eyebrow="Section 2">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 16 }}>
            <MetricCard label="Current Injection Balance" value={padBalanceText} note={`${formatNumber(model.totalActualFlow, 3)} actual vs ${formatNumber(model.totalDesiredFlow, 3)} desired MMSCFD`} tone={padBalanceText === 'Aligned' ? 'green' : padBalanceText === 'Underfed' ? 'orange' : 'yellow'} />
            <MetricCard label="Flow Alignment Score" value={formatPercent(model.flowAlignmentScore, 0)} note={`Deficit ${formatNumber(model.flowDeficit, 3)} | Excess ${formatNumber(model.flowExcess, 3)} MMSCFD`} tone={confidenceTone(model.flowAlignmentScore)} />
            <MetricCard label="Wells Meeting Rate" value={`${formatNumber(model.wellsMeetingRate, 0)}/${model.wells.length}`} note={`${model.underTargetCount} under target | ${model.overTargetCount} over target`} tone={model.underTargetCount === 0 ? 'green' : 'orange'} />
            <MetricCard label="Pad Capacity Margin" value={`${formatNumber(model.compressorCapacityMargin, 3)} MMSCFD`} note={`Headroom ${formatPercent(model.compressorHeadroomPct, 0)} | compressor dispatch error ${formatNumber(model.compressorDispatchError, 3)}`} tone={model.compressorCapacityMargin != null && model.compressorCapacityMargin > 0.2 ? 'green' : 'orange'} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            <div style={{ border: '1px solid #1f3650', borderRadius: 16, background: '#0a1220', padding: '14px 16px', fontSize: 12, color: '#dbeafe', lineHeight: 1.75 }}>
              <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>Which Wells Need Gas</div>
              {wellsNeedingGas.length
                ? wellsNeedingGas.map((well) => `${well.label}: ${formatNumber(Math.abs(well.flowError), 3)} MMSCFD short`).join(' | ')
                : 'No wells are currently below the target band.'}
            </div>
            <div style={{ border: '1px solid #1f3650', borderRadius: 16, background: '#0a1220', padding: '14px 16px', fontSize: 12, color: '#dbeafe', lineHeight: 1.75 }}>
              <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>Which Wells Should Not Receive More Gas</div>
              {wellsToAvoid.length
                ? wellsToAvoid.map((well) => `${well.label}${well.status === 'over' ? ' above target' : well.manualMode === 'manual' ? ' in manual' : ' offline'}`).join(' | ')
                : 'No clear do-not-feed well is present right now.'}
            </div>
            <div style={{ border: '1px solid #1f3650', borderRadius: 16, background: '#0a1220', padding: '14px 16px', fontSize: 12, color: '#dbeafe', lineHeight: 1.75 }}>
              <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>Stable Enough For A Change</div>
              {stableEnoughForChange
                ? 'Yes. The advisory engine sees enough stability and safety margin to consider a conservative adjustment.'
                : 'No. The safer move is to let the current state settle or improve confidence before making a new tuning move.'}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Well Opportunity Ranking" eyebrow="Section 3" right={<Chip text="Best next unit of gas ranked" tone="blue" />}>
          <div style={{ display: 'grid', gap: 12 }}>
            {model.wells
              .slice()
              .sort((a, b) => b.opportunityScore - a.opportunityScore)
              .map((well) => <WellOpportunityRow key={well.label} well={well} />)}
          </div>
        </SectionCard>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18 }}>
          <SectionCard title="Choke Stability Optimization" eyebrow="Section 4">
            <div style={{ display: 'grid', gap: 12 }}>
              <ScoreBar label="Average choke command error" value={model.averageChokeCommandError} tone={confidenceTone(model.averageChokeCommandError != null ? 100 - model.averageChokeCommandError : null)} />
              <ScoreBar label="Choke position validity" value={model.wells.filter((well) => well.chokePosition != null).length / model.wells.length * 100} tone={confidenceTone(model.wells.filter((well) => well.chokePosition != null).length / model.wells.length * 100)} />
              <ScoreBar label="Choke saturation risk" value={model.highChokeCount != null ? clamp((model.highChokeCount / model.wells.length) * 100, 0, 100) : model.wells.filter((well) => (well.chokePosition ?? 0) >= 90).length / model.wells.length * 100} tone={model.highChokeCount > 0 ? 'orange' : 'green'} />
              <ScoreBar label="Restricted well candidate pressure" value={model.restrictedWellCount != null ? clamp((model.restrictedWellCount / model.wells.length) * 100, 0, 100) : model.wells.filter((well) => well.restrictedRisk === 'High').length / model.wells.length * 100} tone={model.restrictedWellCount > 0 ? 'orange' : 'green'} />
            </div>
            <div style={{ marginTop: 14, fontSize: 12, color: '#dbeafe', lineHeight: 1.75 }}>
              {model.chokeHuntingRisk
                ? 'Choke behavior has enough noise or repeated movement to justify slowing the correction cadence before increasing aggressiveness.'
                : 'Choke behavior is not currently the strongest reason to change the pad. Stable wells should stay stable.'}
            </div>
          </SectionCard>

          <SectionCard title="Compressor Stability Optimization" eyebrow="Section 5">
            <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
              {model.compressors.map((compressor) => <CompressorRow key={compressor.key} compressor={compressor} />)}
            </div>
            <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.75 }}>
              {model.compressorConstraintActive
                ? 'The trusted derived layer is pointing at compressor-side limitation or unstable dispatch behavior. Compressor moves should be reviewed before well-side tuning.'
                : model.anyCompressorNotMeeting === true
                  ? 'At least one compressor is not meeting desired flow even though the pad may still be balanced overall. Watch the unit-level detail before changing total site demand.'
                  : 'Compressor-side stability is currently good enough that well-side optimization can stay conservative.'}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Discharge / Recycle Stability" eyebrow="Section 6">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 16 }}>
            <MetricCard label="Discharge Header Pressure" value={`${formatNumber(model.dischargeHeaderPressure, 0)} PSI`} note={model.overrideActive ? 'Override latch is active.' : 'No active discharge override latch.'} tone={model.overrideActive ? 'red' : 'blue'} />
            <MetricCard label="Recycle Valve Position" value={`${formatNumber(model.recycleValvePosition, 1)}%`} note={`Command ${formatNumber(model.recycleValveCommand, 1)}%`} tone={model.recycleOpen ? 'orange' : 'green'} />
            <MetricCard label="Suction Header Pressure" value={`${formatNumber(model.suctionHeaderPressure, 1)} PSI`} note={`Sales valve ${formatNumber(model.suctionSalesValvePosition, 1)}% | command ${formatNumber(model.suctionSalesValveCommand, 1)}%`} tone={model.suctionHeaderPressure == null ? 'blue' : 'green'} />
            <MetricCard label="Stability Score" value={formatPercent(model.stabilityScore, 0)} note={model.flowTroubleshooter || 'Trusted pressure / flow derived stability layer'} tone={confidenceTone(model.stabilityScore)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 16 }}>
            <MetricCard
              label="Protection Layer 1"
              value="Well Panel / Altronic"
              note={model.overrideActive ? 'Active first-layer discharge override response.' : 'Standing by. No active first-layer override.'}
              tone={model.overrideActive ? 'red' : 'green'}
            />
            <MetricCard
              label="Protection Layer 2"
              value="Compressor Slowdown"
              note={model.compressorSlowdownProtectionLikely
                ? 'Likely protective slowdown pattern. Do not default this to compressor failure.'
                : 'No strong slowdown-protection pattern is currently indicated.'}
              tone={model.compressorSlowdownProtectionLikely ? 'orange' : 'green'}
            />
            <MetricCard
              label="Protection Layer 3"
              value="Recycle Protection"
              note={model.recycleOpen
                ? 'Recycle is active. Treat this as optimization inefficiency or imbalance.'
                : 'Recycle is not currently intervening.'}
              tone={model.recycleOpen ? 'orange' : 'green'}
            />
          </div>
          <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.8, whiteSpace: 'pre-line' }}>
            {model.pressureLimited && model.compressorSlowdownProtectionLikely
              ? 'Compressors appear to be slowing while wells are still below target. The engine treats this as pressure-limited behavior, not a default compressor failure, and avoids recommending added compressor loading.'
              : model.recycleOpen && model.underTargetCount > 0
              ? 'Recycle is open while some wells still need gas. That points away from a simple well-side shortage and toward dispatch, pressure, or delivery-path review.'
              : model.recycleOpen && model.underTargetCount === 0
                ? 'Recycle is open while the wells are broadly aligned. That is a strong sign the pad may be carrying excess compressor flow.'
                : model.overrideActive
                  ? 'Discharge protection is currently active. Stability wins over aggressiveness until the override path clears.'
                  : 'No strong recycle or discharge instability is dominating the pad right now.'}
          </div>
        </SectionCard>

        <SectionCard title="Recommended Setting Adjustments" eyebrow="Section 7">
          <SettingTable rows={settingRows} />
        </SectionCard>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
          <SectionCard title="Confidence Breakdown" eyebrow="Section 8">
            <div style={{ display: 'grid', gap: 12 }}>
              <ScoreBar label="Data confidence" value={model.confidence.data} tone={confidenceTone(model.confidence.data)} />
              <ScoreBar label="Stability confidence" value={model.confidence.stability} tone={confidenceTone(model.confidence.stability)} />
              <ScoreBar label="Recommendation confidence" value={model.confidence.recommendation} tone={confidenceTone(model.confidence.recommendation)} />
              <ScoreBar label="Safety confidence" value={model.confidence.safety} tone={confidenceTone(model.confidence.safety)} />
            </div>
            <div style={{ marginTop: 14, fontSize: 12, color: '#cbd5e1', lineHeight: 1.75 }}>
              Confidence is reduced any time required tags are unavailable, manual states are active, comms degrade, or the pad has not had enough stable event memory to validate a change direction.
            </div>
          </SectionCard>

          <SectionCard title="Data Quality" eyebrow="Section 12">
            <div style={{ display: 'grid', gap: 10 }}>
              {dataQualityLines.map((line, index) => (
                <div key={`dq-${index}`} style={{ border: '1px solid #1f3650', borderRadius: 14, background: '#0a1220', padding: '12px 14px', fontSize: 12, color: '#dbeafe', lineHeight: 1.65 }}>
                  {line}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Event Memory / Learning Layer" eyebrow="Section 9">
          <EventMemoryTable events={eventMemory} />
        </SectionCard>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
          <SectionCard title="Operator Language" eyebrow="Section 10">
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ border: '1px solid #1f3650', borderRadius: 14, background: '#0a1220', padding: '12px 14px' }}>
                <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>What We See</div>
                <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.7 }}>{model.primaryRecommendation.whatWeSee}</div>
              </div>
              <div style={{ border: '1px solid #1f3650', borderRadius: 14, background: '#0a1220', padding: '12px 14px' }}>
                <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>Why It Matters</div>
                <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.7 }}>{model.primaryRecommendation.whyItMatters}</div>
              </div>
              <div style={{ border: '1px solid #1f3650', borderRadius: 14, background: '#0a1220', padding: '12px 14px' }}>
                <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>What To Do</div>
                <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.7 }}>{model.primaryRecommendation.whatToDo}</div>
              </div>
              <div style={{ border: '1px solid #1f3650', borderRadius: 14, background: '#0a1220', padding: '12px 14px' }}>
                <div style={{ fontSize: 9, color: '#7dd3fc', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>What To Watch Next</div>
                <div style={{ fontSize: 12, color: '#dbeafe', lineHeight: 1.7 }}>{model.primaryRecommendation.whatRaisesConfidence}</div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Safety Boundaries" eyebrow="Section 11">
            <div style={{ border: '1px solid #7a1a1a', borderRadius: 16, background: 'linear-gradient(180deg, #160b10 0%, #10080c 100%)', padding: '16px 18px', fontSize: 12, color: '#fee2e2', lineHeight: 1.8 }}>
              <div style={{ fontSize: 13, color: '#f8fafc', fontWeight: 800, marginBottom: 8 }}>
                This page provides advisory optimization only. It does not directly control equipment or approve setpoint changes.
              </div>
              <div>It will never recommend bypassing shutdowns, ignoring compressor limits, defeating recycle protection, forcing chokes against known limits, restarting equipment, overriding manual mode, or changing settings when confidence is low.</div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  )
}
