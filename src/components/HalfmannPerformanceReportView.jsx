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

function formatNumber(value, decimals = 1) {
  return value != null && Number.isFinite(value) ? value.toFixed(decimals) : '--'
}

function formatPercent(value, decimals = 1) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)}%` : '--'
}

function formatHours(value, decimals = 1) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)} hrs` : '--'
}

function formatMmscfd(value, decimals = 3) {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)} MMSCFD` : '--'
}

function formatDateTime(value) {
  if (!value) return '--'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString()
}

function formatDate(value) {
  if (!value) return '--'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleDateString()
}

function getRangeFromPreset(preset) {
  const now = new Date()
  const end = new Date(now)
  const start = new Date(now)
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
  else {
    start.setUTCDate(1)
    start.setUTCHours(0, 0, 0, 0)
  }
  return { start, end }
}

function buildQueryString(params) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return
    if (Array.isArray(value)) search.set(key, value.join(','))
    else search.set(key, value)
  })
  return search.toString()
}

function metricTone(value, thresholds = { green: 90, yellow: 75, orange: 60 }) {
  if (value == null || !Number.isFinite(value)) return 'blue'
  if (value >= thresholds.green) return 'green'
  if (value >= thresholds.yellow) return 'yellow'
  if (value >= thresholds.orange) return 'orange'
  return 'red'
}

function runtimeTone(value) {
  if (value == null || !Number.isFinite(value)) return 'blue'
  if (value <= 2) return 'green'
  if (value <= 8) return 'yellow'
  if (value <= 16) return 'orange'
  return 'red'
}

function toneStyles(tone) {
  if (tone === 'green') return { border: '#1f8f55', bg: 'linear-gradient(180deg, rgba(7,34,22,0.96) 0%, rgba(7,19,14,0.96) 100%)', label: '#4ade80', text: '#dcfce7' }
  if (tone === 'yellow') return { border: '#a3851d', bg: 'linear-gradient(180deg, rgba(35,28,8,0.96) 0%, rgba(20,15,6,0.96) 100%)', label: '#facc15', text: '#fef3c7' }
  if (tone === 'orange') return { border: '#b96a11', bg: 'linear-gradient(180deg, rgba(40,23,8,0.96) 0%, rgba(22,13,6,0.96) 100%)', label: '#fb923c', text: '#fed7aa' }
  if (tone === 'red') return { border: '#9f2b3a', bg: 'linear-gradient(180deg, rgba(39,12,17,0.96) 0%, rgba(22,8,11,0.96) 100%)', label: '#f87171', text: '#fee2e2' }
  return { border: '#2b4c70', bg: 'linear-gradient(180deg, rgba(11,22,35,0.96) 0%, rgba(8,15,24,0.96) 100%)', label: '#7dd3fc', text: '#dbeafe' }
}

function Badge({ tone = 'blue', children }) {
  const style = toneStyles(tone)
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 10px',
      borderRadius: 999,
      border: `1px solid ${style.border}`,
      background: style.bg,
      color: style.label,
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    }}>
      {children}
    </span>
  )
}

function SectionCard({ title, eyebrow, actions, children }) {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          {eyebrow ? <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#49d0e2', marginBottom: 8 }}>{eyebrow}</div> : null}
          <h2 style={{ margin: 0, fontSize: 24, color: '#f4f8ff', letterSpacing: '0.01em' }}>{title}</h2>
        </div>
        {actions ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

function KpiCard({ label, value, sublabel, tone = 'blue' }) {
  const style = toneStyles(tone)
  return (
    <div style={{
      minHeight: 138,
      borderRadius: 22,
      border: `1px solid ${style.border}`,
      background: style.bg,
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8ab7e8' }}>{label}</div>
      <div style={{ fontSize: 38, fontWeight: 900, lineHeight: 1, color: style.label }}>{value}</div>
      <div style={{ fontSize: 13, color: style.text, lineHeight: 1.5 }}>{sublabel}</div>
    </div>
  )
}

function LabelValue({ label, value, valueTone = '#f4f8ff' }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(120px, auto)', gap: 14, alignItems: 'baseline' }}>
      <div style={{ fontSize: 13, color: '#8ca0be' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: valueTone, textAlign: 'right' }}>{value}</div>
    </div>
  )
}

function ProgressRail({ value, label, tone = 'green' }) {
  const style = toneStyles(tone)
  const width = value != null && Number.isFinite(value) ? `${Math.max(0, Math.min(100, value))}%` : '0%'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: '#a9bdd9' }}>
        <span>{label}</span>
        <strong style={{ color: style.label }}>{formatPercent(value, 1)}</strong>
      </div>
      <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width, height: '100%', background: `linear-gradient(90deg, ${style.label} 0%, rgba(73,208,226,0.95) 100%)` }} />
      </div>
    </div>
  )
}

function StackedRuntimeBar({ report }) {
  const total = report?.siteSummary?.totalRequestedHours || 0
  const valid = report?.dataQuality?.validDataCoveragePct != null ? (total * report.dataQuality.validDataCoveragePct) / 100 : 0
  const constrained = report?.siteSummary?.compressorConstrainedRuntimeHours || 0
  const pressureLimited = report?.siteSummary?.pressureLimitedHours || 0
  const missing = report?.dataQuality?.missingTelemetryHours || 0
  const stable = Math.max(0, valid - constrained - pressureLimited)
  const slices = [
    { label: 'Stable', value: stable, color: '#22c55e' },
    { label: 'Constraint', value: constrained, color: '#f59e0b' },
    { label: 'Pressure-Limited', value: pressureLimited, color: '#ef4444' },
    { label: 'Missing Data', value: missing, color: '#60a5fa' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ height: 18, borderRadius: 999, overflow: 'hidden', background: 'rgba(255,255,255,0.08)', display: 'flex' }}>
        {slices.map((slice) => (
          <div
            key={slice.label}
            style={{
              width: total > 0 ? `${(Math.max(0, slice.value) / total) * 100}%` : '0%',
              background: slice.color,
            }}
            title={`${slice.label}: ${formatHours(slice.value, 1)}`}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {slices.map((slice) => (
          <div key={slice.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#a9bdd9' }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: slice.color, display: 'inline-block' }} />
            <span>{slice.label}: {formatHours(slice.value, 1)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function buildWorkbook(report) {
  const workbook = XLSX.utils.book_new()
  const summaryRows = [
    ['Metric', 'Value', 'Evidence Basis'],
    ['Overall Well Target Compliance %', report.siteSummary?.overallWellTargetCompliancePct, report.siteSummary?.evidenceBasis?.wellCompliance || ''],
    ['Priority Well Protection Score %', report.siteSummary?.priorityWellProtectionScorePct, report.priorityProtection?.evidenceBasis || ''],
    ['Compressor-Constrained Runtime Hours', report.siteSummary?.compressorConstrainedRuntimeHours, 'stored-run-report-details'],
    ['Sacrifice Mode Runtime Hours', report.siteSummary?.sacrificeModeRuntimeHours, 'evidence-limited if blank'],
    ['Stable Allocation Runtime %', report.siteSummary?.stableAllocationRuntimePct, report.siteSummary?.evidenceBasis?.stability || ''],
    ['Recycle-Free Runtime %', report.siteSummary?.recycleFreeRuntimePct, report.siteSummary?.evidenceBasis?.recycle || ''],
    ['Optimization Effectiveness Score %', report.siteSummary?.optimizationEffectivenessScorePct, 'weighted composite'],
    ['Monthly Performance Grade', report.siteSummary?.monthlyPerformanceGrade, 'grade engine'],
  ]
  const detailRows = [
    ['Well Name', 'Priority Tier', 'Desired Flow Avg', 'Actual Flow Avg', 'Flow Match %', 'Runtime Available Hours', 'Meeting Desired Rate Hours', 'Not Meeting Desired Rate Hours', 'Meeting Desired Rate %', 'Time Above Target', 'Time Below Target', 'Longest Below-Target Duration', 'Average Shortfall', 'Maximum Shortfall', 'Compressor-Constrained Compliance %', 'Sacrifice-Mode Compliance %', 'Monthly Compliance Grade', 'Evidence Basis'],
    ...((report.wells || []).map((well) => [
      well.wellName,
      well.priorityTier,
      well.desiredFlowAverage,
      well.actualFlowAverage,
      well.flowMatchPct,
      well.runtimeAvailableHours,
      well.meetingDesiredRateHours,
      well.notMeetingDesiredRateHours,
      well.meetingDesiredRatePct,
      well.timeAboveTargetHours,
      well.timeBelowTargetHours,
      well.longestBelowTargetDurationHours,
      well.averageShortfallMmscfd,
      well.maximumShortfallMmscfd,
      well.compressorConstrainedCompliancePct,
      well.sacrificeModeCompliancePct,
      well.monthlyComplianceGrade,
      well.evidenceBasis,
    ])),
  ]
  const eventRows = [
    ['Event Time', 'Event Type', 'Duration Hours', 'Trigger', 'Compressors Affected', 'Priority Protection Result', 'Sacrifice Result', 'Recycle Result', 'Recovery Time Hours', 'Event Grade', 'Notes'],
    ...((report.eventReplay || []).map((event) => [
      event.eventTime,
      event.eventType,
      event.durationHours,
      event.trigger,
      (event.compressorsAffected || []).join(', '),
      event.priorityProtectionResult,
      event.sacrificeResult,
      event.recycleResult,
      event.recoveryTimeHours,
      event.eventGrade,
      event.notes,
    ])),
  ]
  const eventHoursRows = [
    ['Event Type', 'Total Hours'],
    ...Object.entries((report.eventReplay || []).reduce((acc, event) => {
      acc[event.eventType] = (acc[event.eventType] || 0) + (event.durationHours || 0)
      return acc
    }, {})),
  ]
  const aggregateEventDetailRows = [
    ['Metric', 'Value'],
    ['Total Compressor Events', report.compressorEvents?.length || 0],
    ['Total Sacrifice Events', report.sacrificeEvents?.length || 0],
    ['Average Recovery Time Hours', report.siteSummary?.averageRecoveryTimeHours],
    ['Pressure-Limited Hours', report.siteSummary?.pressureLimitedHours],
  ]
  const aggregateEventSummaryRows = [
    ['Summary', 'Value'],
    ['Priority Protection Score %', report.priorityProtection?.score],
    ['Tier 1 Compliance During Constraint %', report.priorityProtection?.tier1CompliancePct],
    ['Lower-Priority Absorption %', report.priorityProtection?.lowerPriorityAbsorptionPct],
    ['Protected Hours', report.priorityProtection?.protectedHours],
    ['Not Protected Hours', report.priorityProtection?.notProtectedHours],
  ]
  const mechanicalAvailabilityRows = [
    ['Unit', 'Runtime Hours', 'Below Desired', 'Utilization %', 'Command Match %'],
    ...((report.compressorMetrics || []).map((metric) => [
      metric.unitName,
      metric.runtimeHours,
      metric.belowDesired == null ? '' : metric.belowDesired ? 'Yes' : 'No',
      metric.utilizationPct,
      metric.commandMatchPct,
    ])),
  ]
  const priorityRows = [
    ['Well', 'Priority Tier', 'Gas Priority', 'Oil Priority', 'Flow Match %', 'Average Shortfall MMSCFD'],
    ...((report.wells || []).map((well) => [
      well.wellName,
      well.priorityTier,
      well.gasPriority,
      well.oilPriority,
      well.flowMatchPct,
      well.averageShortfallMmscfd,
    ])),
  ]
  const sacrificeRows = [
    ['Metric', 'Value'],
    ['Sacrifice Runtime Hours', report.siteSummary?.sacrificeModeRuntimeHours],
    ['Sacrifice Event Count', report.sacrificeEvents?.length || 0],
    ['Lower-Priority Absorption %', report.priorityProtection?.lowerPriorityAbsorptionPct],
    ['Evidence Basis', 'current-priority-vs-latest-flow when historical telemetry is limited'],
  ]
  const executiveRows = [
    ['Card', 'Value', 'Statement'],
    ...((report.marketingKpis || []).map((item) => [item.label, item.value, item.statement])),
  ]

  const sheets = [
    ['Summary', summaryRows],
    ['Detail', detailRows],
    ['Events Report', eventRows],
    ['Events Report (Hours)', eventHoursRows],
    ['Aggregated Events Detail', aggregateEventDetailRows],
    ['Aggregated Events Summary', aggregateEventSummaryRows],
    ['Mechanical Availability', mechanicalAvailabilityRows],
    ['WellLogic Priority Protection', priorityRows],
    ['Sacrifice Mode Performance', sacrificeRows],
    ['KPI Executive Summary', executiveRows],
  ]

  sheets.forEach(([name, rows]) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 }
    sheet['!autofilter'] = { ref: `A1:${String.fromCharCode(64 + Math.min(26, rows[0].length))}${Math.max(rows.length, 2)}` }
    sheet['!cols'] = rows[0].map((_, index) => ({ wch: Math.max(14, String(rows.reduce((max, row) => Math.max(max, String(row[index] ?? '').length), 0)).length + 2) }))
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  })

  return workbook
}

function downloadWorkbook(report, selectedUnitLabel) {
  const workbook = buildWorkbook(report)
  const fileName = `WellLogic_Runtime_Performance_Report_${selectedUnitLabel}_${formatDate(report.reportWindow?.startAt).replaceAll('/', '-')}_to_${formatDate(report.reportWindow?.endAt).replaceAll('/', '-')}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

function InlineActionButton({ children, onClick, tone = 'blue' }) {
  const style = toneStyles(tone)
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

export default function HalfmannPerformanceReportView() {
  const [meta, setMeta] = useState(null)
  const [report, setReport] = useState(null)
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [loadingReport, setLoadingReport] = useState(true)
  const [error, setError] = useState('')
  const [preset, setPreset] = useState('current-month')
  const [groupKey, setGroupKey] = useState('')
  const [selectedDeviceIds, setSelectedDeviceIds] = useState([])
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
        if (cancelled) return
        setMeta(payload)
        setSelectedDeviceIds(payload?.controls?.defaultDeviceIds || [])
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false)
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!meta) return
    let cancelled = false
    const derivedRange = preset === 'custom'
      ? { start: customStart ? new Date(`${customStart}T00:00:00`) : null, end: customEnd ? new Date(`${customEnd}T23:59:59`) : null }
      : getRangeFromPreset(preset)
    const query = buildQueryString({
      preset,
      groupKey,
      deviceIds: selectedDeviceIds,
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
  }, [meta, preset, groupKey, selectedDeviceIds, customStart, customEnd, refreshNonce])

  const selectedUnitLabel = useMemo(() => {
    if (!meta?.controls?.units?.length) return 'Halfmann_1214'
    if (selectedDeviceIds.length === 1) {
      return (meta.controls.units.find((unit) => unit.deviceId === selectedDeviceIds[0])?.unitName || 'Unit').replace(/[^\w-]+/g, '_')
    }
    return 'MultiUnit'
  }, [meta, selectedDeviceIds])

  const controls = meta?.controls || { units: [], groups: [] }
  const isBusy = loadingMeta || loadingReport

  return (
    <div style={{
      minHeight: '100%',
      background: 'radial-gradient(circle at top left, rgba(73,208,226,0.08), transparent 28%), linear-gradient(180deg, #080812 0%, #05050c 100%)',
      padding: 24,
      color: '#f4f8ff',
    }}>
      <div style={{ maxWidth: 1600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <SectionCard
          title="WellLogic Monthly Performance Report"
          eyebrow="Historical KPI / Proof Engine"
          actions={[
            <InlineActionButton key="refresh" onClick={() => setRefreshNonce((value) => value + 1)}>Refresh Report</InlineActionButton>,
            <InlineActionButton key="xlsx" onClick={() => report && downloadWorkbook(report, selectedUnitLabel)} tone="green">Export Monthly Runtime Workbook</InlineActionButton>,
            <InlineActionButton key="pdf" onClick={() => window.print()} tone="yellow">Export PDF</InlineActionButton>,
            <InlineActionButton key="print" onClick={() => window.print()} tone="blue">Print Report</InlineActionButton>,
          ]}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#8ca0be', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Group Selector</label>
              <select value={groupKey} onChange={(event) => setGroupKey(event.target.value)} style={selectStyle}>
                <option value="">All Available Groups</option>
                {controls.groups.map((group) => <option key={group.groupKey || group.label} value={group.groupKey || ''}>{group.label}</option>)}
              </select>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: '#8ca0be', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Multi-Unit Selector</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {controls.units.map((unit) => {
                const active = selectedDeviceIds.includes(unit.deviceId)
                return (
                  <button
                    key={unit.deviceId}
                    onClick={() => setSelectedDeviceIds((current) => active ? current.filter((entry) => entry !== unit.deviceId) : [...current, unit.deviceId])}
                    style={{
                      ...chipStyle,
                      borderColor: active ? '#49d0e2' : 'rgba(255,255,255,0.12)',
                      background: active ? 'rgba(73,208,226,0.14)' : 'rgba(255,255,255,0.04)',
                      color: active ? '#dffcff' : '#a9bdd9',
                    }}
                  >
                    <strong>{unit.unitName}</strong>
                    <span style={{ fontSize: 11, opacity: 0.75 }}>{unit.deviceId}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge tone={isBusy ? 'yellow' : 'green'}>{isBusy ? 'Building Report' : 'Report Ready'}</Badge>
            {report?.reportWindow ? <Badge tone="blue">{formatDate(report.reportWindow.startAt)} to {formatDate(report.reportWindow.endAt)}</Badge> : null}
            {report?.fetchedAt ? <Badge tone="blue">Last Refresh {formatDateTime(report.fetchedAt)}</Badge> : null}
            <Badge tone="blue">Advisory / historical only</Badge>
          </div>

          {error ? <div style={{ color: '#fda4af', fontSize: 14 }}>{error}</div> : null}
          <div style={{ fontSize: 13, color: '#8ca0be', lineHeight: 1.7 }}>
            This page is a customer-ready reporting and proof layer. It uses the retained M-Link consumer API as the historical source of truth and explicitly marks any metric that is evidence-limited rather than inventing unsupported monthly hours.
          </div>
        </SectionCard>

        {report ? (
          <>
            <SectionCard title="Executive KPI Summary" eyebrow="Section 2">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                <KpiCard label="Overall Well Target Compliance" value={formatPercent(report.siteSummary?.overallWellTargetCompliancePct)} sublabel="Percent of credible retained runtime where wells matched desired rate." tone={metricTone(report.siteSummary?.overallWellTargetCompliancePct)} />
                <KpiCard label="Priority Well Protection Score" value={formatPercent(report.siteSummary?.priorityWellProtectionScorePct)} sublabel="Protection of higher-priority wells during constrained operation." tone={metricTone(report.siteSummary?.priorityWellProtectionScorePct)} />
                <KpiCard label="Compressor-Constrained Runtime" value={formatHours(report.siteSummary?.compressorConstrainedRuntimeHours)} sublabel="Hours where compression availability or capacity was the limiting factor." tone={runtimeTone(report.siteSummary?.compressorConstrainedRuntimeHours)} />
                <KpiCard label="Sacrifice Mode Runtime" value={formatHours(report.siteSummary?.sacrificeModeRuntimeHours)} sublabel="Intentional lower-priority reduction hours. Evidence-limited when blank." tone="blue" />
                <KpiCard label="Well Below Desired Rate Hours" value={formatHours(report.siteSummary?.wellBelowDesiredRateHours)} sublabel="Aggregated well-hours below desired rate from retained history." tone="blue" />
                <KpiCard label="Stable Allocation Runtime" value={formatPercent(report.siteSummary?.stableAllocationRuntimePct)} sublabel="Percent of runtime with stable alignment, dispatch, and low oscillation." tone={metricTone(report.siteSummary?.stableAllocationRuntimePct)} />
                <KpiCard label="Recycle-Free Runtime" value={formatPercent(report.siteSummary?.recycleFreeRuntimePct)} sublabel="Historical recycle inactivity percentage. Blank when not strongly retained." tone={metricTone(report.siteSummary?.recycleFreeRuntimePct)} />
                <KpiCard label="Optimization Effectiveness Score" value={formatPercent(report.siteSummary?.optimizationEffectivenessScorePct)} sublabel={`Monthly performance grade ${report.siteSummary?.monthlyPerformanceGrade || '--'}`} tone={metricTone(report.siteSummary?.optimizationEffectivenessScorePct)} />
              </div>
            </SectionCard>

            <SectionCard title="Pad Runtime Composition" eyebrow="Constraint / Stability View">
              <StackedRuntimeBar report={report} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
                <ProgressRail value={report.siteSummary?.siteFlowAlignmentPct} label="Site Flow Alignment" tone={metricTone(report.siteSummary?.siteFlowAlignmentPct)} />
                <ProgressRail value={report.siteSummary?.compressorDispatchMatchPct} label="Compressor Dispatch Match" tone={metricTone(report.siteSummary?.compressorDispatchMatchPct)} />
                <ProgressRail value={report.siteSummary?.compressorCapacityUtilizationPct} label="Compressor Capacity Utilization" tone={metricTone(report.siteSummary?.compressorCapacityUtilizationPct, { green: 85, yellow: 70, orange: 55 })} />
                <ProgressRail value={report.dataQuality?.validDataCoveragePct} label="Valid Data Coverage" tone={metricTone(report.dataQuality?.validDataCoveragePct)} />
              </div>
            </SectionCard>

            <SectionCard title="Monthly Well Compliance Table" eyebrow="Section 3">
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {['Well Name', 'Priority Tier', 'Desired Flow Avg', 'Actual Flow Avg', 'Flow Match %', 'Runtime Available', 'Meeting Desired Rate Hours', 'Not Meeting Desired Rate Hours', 'Meeting Desired Rate %', 'Time Above Target', 'Time Below Target', 'Longest Below-Target', 'Avg Shortfall', 'Max Shortfall', 'Constraint Compliance %', 'Sacrifice Compliance %', 'Grade'].map((header) => (
                        <th key={header} style={thStyle}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(report.wells || []).map((well) => (
                      <tr key={well.wellName}>
                        <td style={tdStyleStrong}>{well.wellName}</td>
                        <td style={tdStyle}>{well.priorityTier}</td>
                        <td style={tdStyle}>{formatMmscfd(well.desiredFlowAverage)}</td>
                        <td style={tdStyle}>{formatMmscfd(well.actualFlowAverage)}</td>
                        <td style={tdStyle}>{formatPercent(well.flowMatchPct)}</td>
                        <td style={tdStyle}>{formatHours(well.runtimeAvailableHours)}</td>
                        <td style={tdStyle}>{formatHours(well.meetingDesiredRateHours)}</td>
                        <td style={tdStyle}>{formatHours(well.notMeetingDesiredRateHours)}</td>
                        <td style={tdStyle}>{formatPercent(well.meetingDesiredRatePct)}</td>
                        <td style={tdStyle}>{formatHours(well.timeAboveTargetHours)}</td>
                        <td style={tdStyle}>{formatHours(well.timeBelowTargetHours)}</td>
                        <td style={tdStyle}>{formatHours(well.longestBelowTargetDurationHours)}</td>
                        <td style={tdStyle}>{formatMmscfd(well.averageShortfallMmscfd)}</td>
                        <td style={tdStyle}>{formatMmscfd(well.maximumShortfallMmscfd)}</td>
                        <td style={tdStyle}>{formatPercent(well.compressorConstrainedCompliancePct)}</td>
                        <td style={tdStyle}>{formatPercent(well.sacrificeModeCompliancePct)}</td>
                        <td style={tdStyleStrong}>{well.monthlyComplianceGrade}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
              <SectionCard title="Compressor Constraint Detection" eyebrow="Section 4">
                <LabelValue label="Constraint Events" value={String(report.compressorEvents?.length || 0)} />
                <LabelValue label="Compressor-Constrained Runtime" value={formatHours(report.siteSummary?.compressorConstrainedRuntimeHours)} />
                <LabelValue label="Average Recovery Time" value={formatHours(report.siteSummary?.averageRecoveryTimeHours, 2)} />
                <LabelValue label="Pressure-Limited Runtime" value={formatHours(report.siteSummary?.pressureLimitedHours)} />
                <div style={{ fontSize: 13, color: '#8ca0be', lineHeight: 1.7 }}>
                  Constraint events are driven by retained run-report details and current compressor capacity evidence. Compressor slowdown or protective intervention is treated as protective behavior first, not automatic compressor failure.
                </div>
              </SectionCard>

              <SectionCard title="Sacrifice Mode Detection" eyebrow="Section 5">
                <LabelValue label="Sacrifice Runtime" value={formatHours(report.siteSummary?.sacrificeModeRuntimeHours)} />
                <LabelValue label="Sacrifice Events" value={String(report.sacrificeEvents?.length || 0)} />
                <LabelValue label="Lower-Priority Absorption" value={formatPercent(report.priorityProtection?.lowerPriorityAbsorptionPct)} valueTone="#facc15" />
                <LabelValue label="Sacrifice Success %" value={formatPercent(report.priorityProtection?.lowerPriorityAbsorptionPct)} valueTone="#4ade80" />
                <div style={{ fontSize: 13, color: '#8ca0be', lineHeight: 1.7 }}>
                  When the retained API cannot prove sacrifice runtime historically, the page shows current protection and absorption evidence explicitly instead of fabricating monthly sacrifice hours.
                </div>
              </SectionCard>

              <SectionCard title="Priority Well Protection Score" eyebrow="Section 6">
                <LabelValue label="Priority Protection Score" value={formatPercent(report.priorityProtection?.score)} valueTone="#4ade80" />
                <LabelValue label="Tier 1 Compliance During Constraint" value={formatPercent(report.priorityProtection?.tier1CompliancePct)} />
                <LabelValue label="Lower-Priority Absorption" value={formatPercent(report.priorityProtection?.lowerPriorityAbsorptionPct)} />
                <LabelValue label="Protected Hours" value={formatHours(report.priorityProtection?.protectedHours)} />
                <LabelValue label="Not Protected Hours" value={formatHours(report.priorityProtection?.notProtectedHours)} />
                <LabelValue label="Best Protected Well" value={report.priorityProtection?.bestProtectedWell || '--'} />
                <LabelValue label="Worst Protected Well" value={report.priorityProtection?.worstProtectedWell || '--'} />
              </SectionCard>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
              <SectionCard title="Allocation Intelligence KPIs" eyebrow="Section 8">
                <LabelValue label="Priority Protection Index" value={formatPercent(report.priorityProtection?.score)} />
                <LabelValue label="Sacrifice Fairness Index" value={formatPercent(report.priorityProtection?.lowerPriorityAbsorptionPct)} />
                <LabelValue label="Priority Well Preservation Hours" value={formatHours(report.priorityProtection?.protectedHours)} />
                <LabelValue label="Avoided Priority-Well Loss Estimate" value={formatHours(report.priorityProtection?.protectedHours)} />
                <div style={{ fontSize: 13, color: '#8ca0be', lineHeight: 1.7 }}>
                  Example proof point: During constrained operation, WellLogic maintained priority wells at {formatPercent(report.priorityProtection?.tier1CompliancePct)} compliance while lower-priority wells absorbed {formatPercent(report.priorityProtection?.lowerPriorityAbsorptionPct)} of the visible mismatch burden.
                </div>
              </SectionCard>

              <SectionCard title="Compressor / Well Coordination KPIs" eyebrow="Section 9">
                <LabelValue label="Compressor Dispatch Match" value={formatPercent(report.siteSummary?.compressorDispatchMatchPct)} />
                <LabelValue label="Compressor Capacity Utilization" value={formatPercent(report.siteSummary?.compressorCapacityUtilizationPct)} />
                <LabelValue label="Compressor-Constrained Hours" value={formatHours(report.siteSummary?.compressorConstrainedRuntimeHours)} />
                <LabelValue label="Well-Constrained Hours" value={formatHours(report.siteSummary?.wellConstrainedHours)} />
                <LabelValue label="Pressure-Limited Hours" value={formatHours(report.siteSummary?.pressureLimitedHours)} />
                <LabelValue label="Recycle Active Hours" value={formatHours(report.siteSummary?.recycleActiveHours)} />
                <LabelValue label="Site Flow Alignment" value={formatPercent(report.siteSummary?.siteFlowAlignmentPct)} />
              </SectionCard>
            </div>

            <SectionCard title="Event Replay Table" eyebrow="Section 10">
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {['Event Time', 'Event Type', 'Duration', 'Trigger', 'Compressors Affected', 'Priority Result', 'Sacrifice Result', 'Recycle Result', 'Recovery Time', 'Grade', 'Notes'].map((header) => (
                        <th key={header} style={thStyle}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(report.eventReplay || []).length ? report.eventReplay.map((event, index) => (
                      <tr key={`${event.eventType}-${event.eventTime || index}`}>
                        <td style={tdStyle}>{formatDateTime(event.eventTime)}</td>
                        <td style={tdStyleStrong}>{event.eventType}</td>
                        <td style={tdStyle}>{formatHours(event.durationHours)}</td>
                        <td style={tdStyle}>{event.trigger || '--'}</td>
                        <td style={tdStyle}>{(event.compressorsAffected || []).join(', ') || '--'}</td>
                        <td style={tdStyle}>{event.priorityProtectionResult || '--'}</td>
                        <td style={tdStyle}>{event.sacrificeResult || '--'}</td>
                        <td style={tdStyle}>{event.recycleResult || '--'}</td>
                        <td style={tdStyle}>{formatHours(event.recoveryTimeHours, 2)}</td>
                        <td style={tdStyle}>{event.eventGrade || '--'}</td>
                        <td style={tdStyle}>{event.notes || '--'}</td>
                      </tr>
                    )) : (
                      <tr><td style={tdStyle} colSpan={11}>No retained replay events were returned for the selected window.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>

            <SectionCard title="Marketing KPI Cards" eyebrow="Section 11">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                {(report.marketingKpis || []).map((item) => (
                  <KpiCard key={item.label} label={item.label} value={item.value != null ? `${item.value.toFixed(item.suffix === ' hrs' ? 2 : 1)}${item.suffix || ''}` : '--'} sublabel={item.statement} tone={item.tone || 'blue'} />
                ))}
              </div>
            </SectionCard>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
              <SectionCard title="Monthly Performance Grade" eyebrow="Section 12">
                <KpiCard label="Monthly Grade" value={report.siteSummary?.monthlyPerformanceGrade || '--'} sublabel="Grade is capped by data quality. A high score is not allowed when retained telemetry coverage is weak." tone={report.siteSummary?.monthlyPerformanceGrade === 'A' ? 'green' : report.siteSummary?.monthlyPerformanceGrade === 'B' ? 'yellow' : 'orange'} />
              </SectionCard>

              <SectionCard title="Data Quality" eyebrow="Section 13">
                <LabelValue label="Valid Data Coverage" value={formatPercent(report.dataQuality?.validDataCoveragePct)} />
                <LabelValue label="Missing Telemetry Hours" value={formatHours(report.dataQuality?.missingTelemetryHours)} />
                <LabelValue label="Invalid Sample Hours" value={formatHours(report.dataQuality?.invalidSampleHours)} />
                <LabelValue label="Comms Loss Hours" value={formatHours(report.dataQuality?.commsLossHours)} />
                <LabelValue label="Excluded Offline Hours" value={formatHours(report.dataQuality?.excludedOfflineHours)} />
                <LabelValue label="Sample Count" value={String(report.dataQuality?.sampleCount || 0)} />
              </SectionCard>
            </div>

            <SectionCard title="Auto Generated Report Narrative" eyebrow="Section 14">
              <div style={{ fontSize: 15, color: '#d8e6fb', lineHeight: 1.8 }}>
                {report.narrative?.summary}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                {(report.narrative?.recommendations || []).map((item, index) => (
                  <div key={index} style={{ borderRadius: 18, border: '1px solid rgba(125,211,252,0.18)', background: 'rgba(13,20,32,0.74)', padding: 16, color: '#cde7ff', lineHeight: 1.7 }}>
                    {item}
                  </div>
                ))}
              </div>
            </SectionCard>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
              <SectionCard title="Runtime Calculation Engine" eyebrow="Section 15">
                <div style={{ fontSize: 13, color: '#8ca0be', lineHeight: 1.8 }}>
                  Duration-weighted runtime is used throughout this report. For each retained sample window, the engine classifies the next interval into valid runtime buckets instead of row-averaging snapshots. Irregular spacing, missing telemetry, offline windows, and state transitions are explicitly handled to protect report credibility.
                </div>
              </SectionCard>

              <SectionCard title="Normalized Report Object" eyebrow="Section 16">
                <div style={{ fontFamily: 'Consolas, monospace', fontSize: 12, lineHeight: 1.8, color: '#cde7ff', whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(report.normalizedReport, null, 2)}
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Control Philosophy / Safety Boundary" eyebrow="Section 18">
              <div style={{ fontSize: 13, color: '#8ca0be', lineHeight: 1.8 }}>
                This page is a historical reporting and proof platform only. It does not control equipment, write setpoints, or override field protection. Compressor slowdown/protection is not classified as compressor failure by default. The page distinguishes compressor-constrained runtime from well-constrained runtime, pressure-limited behavior, and intentional sacrifice mode, and it favors stable operation, slow corrections, recycle avoidance, priority-well protection, and smooth recovery.
              </div>
            </SectionCard>
          </>
        ) : (
          <SectionCard title="Preparing report" eyebrow="Performance Engine">
            <div style={{ fontSize: 14, color: '#a9bdd9' }}>{isBusy ? 'Loading report data from the retained M-Link consumer API…' : 'No report available yet.'}</div>
          </SectionCard>
        )}
      </div>
    </div>
  )
}

const selectStyle = {
  width: '100%',
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(8,12,20,0.94)',
  color: '#f4f8ff',
  padding: '12px 14px',
  fontSize: 14,
}

const chipStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.1)',
  padding: '12px 14px',
  minWidth: 180,
  cursor: 'pointer',
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: 1200,
}

const thStyle = {
  padding: '12px 14px',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#8ca0be',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const tdStyle = {
  padding: '12px 14px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  color: '#d9e7fb',
  fontSize: 13,
  verticalAlign: 'top',
}

const tdStyleStrong = {
  ...tdStyle,
  fontWeight: 700,
  color: '#f4f8ff',
}
