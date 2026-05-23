import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'

const API_BASE = import.meta.env.VITE_API_URL || ''
const PRESETS = [
  { key: 'current-month', label: 'Current Month' },
  { key: 'previous-month', label: 'Previous Month' },
  { key: 'last-7-days', label: 'Last 7 Days' },
  { key: 'last-14-days', label: 'Last 14 Days' },
  { key: 'last-30-days', label: 'Last 30 Days' },
  { key: 'custom', label: 'Custom Range' },
]

function toInputDate(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function formatNumber(value, decimals = 1, suffix = '') {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)}${suffix}` : '--'
}

function formatPercent(value, decimals = 1) {
  return formatNumber(value, decimals, '%')
}

function formatHours(value, decimals = 1) {
  return formatNumber(value, decimals, ' hrs')
}

function formatDate(value) {
  if (!value) return '--'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleDateString()
}

function formatDateTime(value) {
  if (!value) return '--'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString()
}

function getRangeFromPreset(preset) {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)
  if (preset === 'previous-month') {
    start.setUTCDate(1)
    start.setUTCMonth(start.getUTCMonth() - 1)
    start.setUTCHours(0, 0, 0, 0)
    end.setUTCDate(0)
    end.setUTCHours(23, 59, 59, 999)
    return { start, end }
  }
  if (preset === 'last-7-days') start.setUTCDate(start.getUTCDate() - 7)
  else if (preset === 'last-14-days') start.setUTCDate(start.getUTCDate() - 14)
  else if (preset === 'last-30-days') start.setUTCDate(start.getUTCDate() - 30)
  else start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)
  end.setUTCHours(23, 59, 59, 999)
  return { start, end }
}

function buildQueryString(params) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '') return
    search.set(key, value)
  })
  return search.toString()
}

function tone(value) {
  if (value == null || !Number.isFinite(value)) return 'blue'
  if (value >= 98) return 'green'
  if (value >= 95) return 'yellow'
  if (value >= 90) return 'orange'
  return 'red'
}

function toneStyles(currentTone) {
  if (currentTone === 'green') return { border: '#1f8f55', bg: 'linear-gradient(180deg, rgba(7,34,22,0.96) 0%, rgba(7,19,14,0.96) 100%)', label: '#4ade80', text: '#dcfce7' }
  if (currentTone === 'yellow') return { border: '#a3851d', bg: 'linear-gradient(180deg, rgba(35,28,8,0.96) 0%, rgba(20,15,6,0.96) 100%)', label: '#facc15', text: '#fef3c7' }
  if (currentTone === 'orange') return { border: '#b96a11', bg: 'linear-gradient(180deg, rgba(40,23,8,0.96) 0%, rgba(22,13,6,0.96) 100%)', label: '#fb923c', text: '#fed7aa' }
  if (currentTone === 'red') return { border: '#9f2b3a', bg: 'linear-gradient(180deg, rgba(39,12,17,0.96) 0%, rgba(22,8,11,0.96) 100%)', label: '#f87171', text: '#fee2e2' }
  return { border: '#2b4c70', bg: 'linear-gradient(180deg, rgba(11,22,35,0.96) 0%, rgba(8,15,24,0.96) 100%)', label: '#7dd3fc', text: '#dbeafe' }
}

function KpiCard({ label, value, sublabel, currentTone = 'blue' }) {
  const style = toneStyles(currentTone)
  return (
    <div style={{
      borderRadius: 20,
      border: `1px solid ${style.border}`,
      background: style.bg,
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      minHeight: 132,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8ab7e8' }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1, color: style.label }}>{value}</div>
      <div style={{ fontSize: 13, lineHeight: 1.5, color: style.text }}>{sublabel}</div>
    </div>
  )
}

function Section({ title, eyebrow, children, actions = null }) {
  return (
    <section style={{
      borderRadius: 24,
      border: '1px solid rgba(74, 144, 226, 0.18)',
      background: 'linear-gradient(180deg, rgba(11,16,27,0.96) 0%, rgba(8,12,20,0.96) 100%)',
      boxShadow: '0 24px 80px rgba(0,0,0,0.26)',
      padding: 24,
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          {eyebrow ? <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#49d0e2', marginBottom: 8 }}>{eyebrow}</div> : null}
          <h2 style={{ margin: 0, fontSize: 24, color: '#f4f8ff' }}>{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function InlineButton({ children, onClick, currentTone = 'blue' }) {
  const style = toneStyles(currentTone)
  return (
    <button
      onClick={onClick}
      style={{
        borderRadius: 14,
        border: `1px solid ${style.border}`,
        background: style.bg,
        color: style.label,
        fontWeight: 800,
        fontSize: 12,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '10px 14px',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function exportWorkbook(report) {
  const workbook = XLSX.utils.book_new()
  const runtimeRows = [
    ['Well', 'Priority Rank', 'Average Match %', 'Runtime Meeting %', 'Meeting Hours', 'Below Target Hours', 'Valid Hours', 'Samples'],
    ...((report.runtime?.wells || []).map((well) => [
      well.wellName,
      well.priorityRank,
      well.averageMatchPct,
      well.runtimeMeetingPct,
      well.meetingHours,
      well.belowHours,
      well.validHours,
      well.sampleCount,
    ])),
  ]
  const priorityRows = [
    ['Well', 'Priority Rank', 'Protected % During Constraint', 'Short Hours During Constraint', 'Constraint Valid Hours'],
    ...((report.prioritization?.wells || []).map((well) => [
      well.wellName,
      well.priorityRank,
      well.protectedPctDuringConstraint,
      well.shortHoursDuringConstraint,
      well.constrainedValidHours,
    ])),
  ]
  const summaryRows = [
    ['Metric', 'Value'],
    ['Overall Runtime Meeting %', report.siteSummary?.overallRuntimeMeetingPct],
    ['Overall Average Match %', report.siteSummary?.overallAverageMatchPct],
    ['Prioritization Reliability %', report.siteSummary?.prioritizationReliabilityPct],
    ['Constrained Runtime Hours', report.siteSummary?.constrainedRuntimeHours],
    ['Auto-Perfect Priority Hours', report.siteSummary?.autoPerfectPriorityHours],
    ['Samples', report.dataQuality?.sampleCount],
  ]

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(runtimeRows), 'Well Runtime')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(priorityRows), 'Priority Reliability')
  XLSX.writeFile(workbook, `Halfmann_Runtime_Report_${formatDate(report.reportWindow?.startAt).replaceAll('/', '-')}_to_${formatDate(report.reportWindow?.endAt).replaceAll('/', '-')}.xlsx`)
}

const selectStyle = {
  width: '100%',
  minHeight: 46,
  borderRadius: 14,
  border: '1px solid rgba(138,183,232,0.22)',
  background: 'rgba(10,15,24,0.94)',
  color: '#f4f8ff',
  padding: '0 14px',
  fontSize: 14,
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: 760,
}

export default function HalfmannPerformanceReportView() {
  const [meta, setMeta] = useState(null)
  const [report, setReport] = useState(null)
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [loadingReport, setLoadingReport] = useState(true)
  const [error, setError] = useState('')
  const [preset, setPreset] = useState('current-month')
  const [customStart, setCustomStart] = useState(toInputDate(getRangeFromPreset('current-month').start))
  const [customEnd, setCustomEnd] = useState(toInputDate(new Date()))
  const [refreshNonce, setRefreshNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoadingMeta(true)
    fetch(`${API_BASE}/api/performance-report/meta`)
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText)
        return response.json()
      })
      .then((payload) => {
        if (!cancelled) setMeta(payload)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    const derivedRange = preset === 'custom'
      ? { start: customStart ? new Date(`${customStart}T00:00:00`) : null, end: customEnd ? new Date(`${customEnd}T23:59:59`) : null }
      : getRangeFromPreset(preset)
    const query = buildQueryString({
      preset,
      startAt: derivedRange.start?.toISOString?.(),
      endAt: derivedRange.end?.toISOString?.(),
    })

    setLoadingReport(true)
    setError('')
    fetch(`${API_BASE}/api/performance-report?${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || response.statusText)
        return response.json()
      })
      .then((payload) => {
        if (!cancelled) setReport(payload)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingReport(false)
      })

    return () => { cancelled = true }
  }, [preset, customStart, customEnd, refreshNonce])

  const isBusy = loadingMeta || loadingReport
  const controls = meta?.controls || { siteName: 'Halfmann 1214', units: [] }

  const topCards = useMemo(() => ([
    {
      label: 'Overall Well Runtime',
      value: formatPercent(report?.siteSummary?.overallRuntimeMeetingPct),
      sublabel: `Percent of valid retained time at or above ${report?.runtime?.tolerancePct || 98}% desired injection match.`,
      currentTone: tone(report?.siteSummary?.overallRuntimeMeetingPct),
    },
    {
      label: 'Average Match',
      value: formatPercent(report?.siteSummary?.overallAverageMatchPct),
      sublabel: 'Weighted average match to desired injection rate across all five wells.',
      currentTone: tone(report?.siteSummary?.overallAverageMatchPct),
    },
    {
      label: 'Prioritization Reliability',
      value: formatPercent(report?.siteSummary?.prioritizationReliabilityPct),
      sublabel: 'Auto-scores 100% whenever compression is not constrained and no sacrifice is needed.',
      currentTone: tone(report?.siteSummary?.prioritizationReliabilityPct),
    },
    {
      label: 'Constrained Runtime',
      value: formatHours(report?.siteSummary?.constrainedRuntimeHours),
      sublabel: 'Only this time window is allowed to influence priority-protection scoring.',
      currentTone: report?.siteSummary?.constrainedRuntimeHours > 0 ? 'orange' : 'green',
    },
  ]), [report])

  return (
    <div style={{
      minHeight: '100%',
      background: 'radial-gradient(circle at top left, rgba(73,208,226,0.08), transparent 28%), linear-gradient(180deg, #080812 0%, #05050c 100%)',
      padding: 24,
      color: '#f4f8ff',
    }}>
      <div style={{ maxWidth: 1480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <Section
          title="WellLogic Monthly Performance Report"
          eyebrow="Halfmann 1214 Runtime History"
          actions={(
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <InlineButton onClick={() => setRefreshNonce((value) => value + 1)}>Refresh</InlineButton>
              <InlineButton onClick={() => report && exportWorkbook(report)} currentTone="green">Export Workbook</InlineButton>
              <InlineButton onClick={() => window.print()} currentTone="yellow">Print</InlineButton>
            </div>
          )}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#8ca0be', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Site Scope</label>
              <div style={{ ...selectStyle, display: 'flex', alignItems: 'center' }}>{controls.siteName} only</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#8ca0be', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Date Range Preset</label>
              <select value={preset} onChange={(event) => setPreset(event.target.value)} style={selectStyle}>
                {PRESETS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#8ca0be', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Start Date</label>
              <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} style={selectStyle} disabled={preset !== 'custom'} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#8ca0be', textTransform: 'uppercase', letterSpacing: '0.12em' }}>End Date</label>
              <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} style={selectStyle} disabled={preset !== 'custom'} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(controls.units || []).map((unit) => (
              <div key={unit.deviceId} style={{
                borderRadius: 999,
                border: '1px solid rgba(73,208,226,0.22)',
                background: 'rgba(73,208,226,0.12)',
                color: '#dffcff',
                padding: '8px 12px',
                fontSize: 12,
                display: 'inline-flex',
                gap: 8,
              }}>
                <strong>{unit.unitName}</strong>
                <span style={{ opacity: 0.7 }}>{unit.deviceId}</span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 13, color: '#8ca0be', lineHeight: 1.7 }}>
            This page only tracks Halfmann. Monthly well runtime is based on retained live injection match percentage history. Prioritization reliability only scores time periods where compression is actually constrained or sacrifice behavior is active. When there is no need to prioritize, the score is forced to 100% by design.
          </div>

          {error ? <div style={{ color: '#fda4af', fontSize: 14 }}>{error}</div> : null}
          <div style={{ fontSize: 12, color: '#8ca0be' }}>
            {isBusy ? 'Building report…' : `Last refresh ${formatDateTime(report?.fetchedAt)} | Samples ${report?.dataQuality?.sampleCount ?? '--'} | History source ${report?.dataQuality?.source || '--'}`}
          </div>
        </Section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {topCards.map((card) => <KpiCard key={card.label} {...card} />)}
        </div>

        <Section title="Monthly Well Runtime %" eyebrow="Percent Meeting Desired Injection Rate">
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {['Well', 'Priority Rank', 'Average Match %', 'Runtime Meeting %', 'Meeting Hours', 'Below Target Hours', 'Valid Hours', 'Samples'].map((header) => (
                    <th key={header} style={headerCellStyle}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(report?.runtime?.wells || []).map((well) => (
                  <tr key={well.wellName}>
                    <td style={cellStyleStrong}>{well.wellName}</td>
                    <td style={cellStyle}>{well.priorityRank}</td>
                    <td style={{ ...cellStyle, color: toneStyles(tone(well.averageMatchPct)).label }}>{formatPercent(well.averageMatchPct)}</td>
                    <td style={{ ...cellStyle, color: toneStyles(tone(well.runtimeMeetingPct)).label }}>{formatPercent(well.runtimeMeetingPct)}</td>
                    <td style={cellStyle}>{formatHours(well.meetingHours)}</td>
                    <td style={cellStyle}>{formatHours(well.belowHours)}</td>
                    <td style={cellStyle}>{formatHours(well.validHours)}</td>
                    <td style={cellStyle}>{well.sampleCount ?? '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Prioritization Reliability" eyebrow="Only Scored During Real Constraint">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <KpiCard
              label="Priority Reliability"
              value={formatPercent(report?.prioritization?.scorePct)}
              sublabel={report?.prioritization?.ruleNote || 'Constraint-only scoring'}
              currentTone={tone(report?.prioritization?.scorePct)}
            />
            <KpiCard
              label="Constraint Runtime"
              value={formatHours(report?.prioritization?.constrainedRuntimeHours)}
              sublabel="Time where compressor supply was not fully covering demand or sacrifice logic was active."
              currentTone={report?.prioritization?.constrainedRuntimeHours > 0 ? 'orange' : 'green'}
            />
            <KpiCard
              label="Auto-Perfect Hours"
              value={formatHours(report?.prioritization?.autoPerfectRuntimeHours)}
              sublabel="Time where no prioritization was needed, so the score is automatically 100%."
              currentTone="green"
            />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {['Well', 'Priority Rank', 'Protected % During Constraint', 'Short Hours During Constraint', 'Constraint Valid Hours'].map((header) => (
                    <th key={header} style={headerCellStyle}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(report?.prioritization?.wells || []).map((well) => (
                  <tr key={well.wellName}>
                    <td style={cellStyleStrong}>{well.wellName}</td>
                    <td style={cellStyle}>{well.priorityRank}</td>
                    <td style={{ ...cellStyle, color: toneStyles(tone(well.protectedPctDuringConstraint)).label }}>{formatPercent(well.protectedPctDuringConstraint)}</td>
                    <td style={cellStyle}>{formatHours(well.shortHoursDuringConstraint)}</td>
                    <td style={cellStyle}>{formatHours(well.constrainedValidHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 13, color: '#8ca0be', lineHeight: 1.7 }}>
            Scoring logic: if there is enough compressor supply and no sacrifice behavior, priority reliability is forced to 100% for that time slice. The score only moves when there is an actual compressor constraint, compressor down condition, or panel target-reduction behavior that creates a real need to prioritize between wells.
          </div>
        </Section>
      </div>
    </div>
  )
}

const headerCellStyle = {
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#8ca0be',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
}

const cellStyle = {
  padding: '14px',
  fontSize: 14,
  color: '#dbeafe',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
}

const cellStyleStrong = {
  ...cellStyle,
  fontWeight: 800,
  color: '#f4f8ff',
}
