import { useEffect, useMemo, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''
const FALLBACK_PRESETS = [
  { key: 'last-30-minutes', label: 'Last 30 Minutes' },
  ...Array.from({ length: 24 }, (_, index) => ({
    key: `last-${index + 1}-hour${index === 0 ? '' : 's'}`,
    label: `Last ${index + 1} Hour${index === 0 ? '' : 's'}`,
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    key: `last-${index + 2}-days`,
    label: `Last ${index + 2} Days`,
  })),
  { key: 'last-14-days', label: 'Last 14 Days' },
  { key: 'last-21-days', label: 'Last 21 Days' },
  { key: 'last-30-days', label: 'Last 30 Days' },
  { key: 'current-month', label: 'Month to Date' },
  { key: 'previous-month', label: 'Last Month' },
  { key: 'last-90-days', label: 'Last 90 Days' },
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

function formatDateTime(value) {
  if (!value) return '--'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString()
}

function getRangeFromPreset(preset) {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)
  const minuteMatch = /^last-(\d+)-minutes$/.exec(preset)
  if (minuteMatch) {
    start.setTime(now.getTime() - (Number(minuteMatch[1]) * 60 * 1000))
    return { start, end }
  }
  const hourMatch = /^last-(\d+)-hours?$/.exec(preset)
  if (hourMatch) {
    start.setTime(now.getTime() - (Number(hourMatch[1]) * 60 * 60 * 1000))
    return { start, end }
  }
  const dayMatch = /^last-(\d+)-days$/.exec(preset)
  if (dayMatch) {
    start.setTime(now.getTime() - (Number(dayMatch[1]) * 24 * 60 * 60 * 1000))
    return { start, end }
  }

  if (preset === 'previous-month') {
    start.setUTCDate(1)
    start.setUTCMonth(start.getUTCMonth() - 1)
    start.setUTCHours(0, 0, 0, 0)
    end.setUTCDate(0)
    end.setUTCHours(23, 59, 59, 999)
    return { start, end }
  }

  if (preset === 'last-90-days') {
    start.setUTCDate(start.getUTCDate() - 90)
    return { start, end }
  }

  start.setUTCDate(1)
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

function InlineButton({ children, onClick, currentTone = 'blue', href, disabled = false }) {
  const style = toneStyles(currentTone)
  const commonStyle = {
    borderRadius: 14,
    border: `1px solid ${disabled ? 'rgba(90,103,123,0.35)' : style.border}`,
    background: disabled ? 'rgba(16,22,30,0.9)' : style.bg,
    color: disabled ? '#6b7f98' : style.label,
    fontWeight: 800,
    fontSize: 12,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '10px 14px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
  }

  if (href) {
    return <a href={href} style={commonStyle}>{children}</a>
  }

  return (
    <button onClick={onClick} style={commonStyle} disabled={disabled}>
      {children}
    </button>
  )
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

export default function HalfmannPerformanceReportView() {
  const [meta, setMeta] = useState(null)
  const [report, setReport] = useState(null)
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [loadingReport, setLoadingReport] = useState(true)
  const [error, setError] = useState('')
  const [selectedPreset, setSelectedPreset] = useState('current-month')
  const [customStart, setCustomStart] = useState(toInputDate(getRangeFromPreset('current-month').start))
  const [customEnd, setCustomEnd] = useState(toInputDate(new Date()))
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [reportRequest, setReportRequest] = useState({
    preset: 'current-month',
    customStart: '',
    customEnd: '',
    sequence: 0,
  })

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
  }, [refreshNonce])

  useEffect(() => {
    let cancelled = false
    const derivedRange = reportRequest.preset === 'custom'
      ? {
          start: reportRequest.customStart ? new Date(`${reportRequest.customStart}T00:00:00`) : null,
          end: reportRequest.customEnd ? new Date(`${reportRequest.customEnd}T23:59:59`) : null,
        }
      : getRangeFromPreset(reportRequest.preset)

    const query = buildQueryString({
      preset: reportRequest.preset,
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
  }, [reportRequest, refreshNonce])

  const isBusy = loadingMeta || loadingReport
  const controls = meta?.controls || { siteName: 'Halfmann 1214', units: [] }
  const presetOptions = controls.presetOptions || FALLBACK_PRESETS
  const isCustomPreset = selectedPreset === 'custom'
  const canGenerate = selectedPreset !== 'custom' || (customStart && customEnd)

  function handleGenerateReport() {
    if (!canGenerate) return
    setReportRequest({
      preset: selectedPreset,
      customStart,
      customEnd,
      sequence: Date.now(),
    })
  }

  const monthToDateCards = useMemo(() => {
    const mtd = report?.monthToDate
    return [
      {
        label: 'MTD Overall Well Runtime',
        value: formatPercent(mtd?.kpis?.overallWellRuntimePct),
        sublabel: `Month-to-date well runtime at or above ${report?.runtime?.tolerancePct || 98}% desired injection match.`,
        currentTone: tone(mtd?.kpis?.overallWellRuntimePct),
      },
      {
        label: 'MTD Average Match',
        value: formatPercent(mtd?.kpis?.averageMatchPct),
        sublabel: 'Month-to-date weighted average match to desired injection rate.',
        currentTone: tone(mtd?.kpis?.averageMatchPct),
      },
      {
        label: 'MTD Prioritization Reliability',
        value: formatPercent(mtd?.kpis?.prioritizationReliabilityPct),
        sublabel: 'Auto-scores 100% whenever no prioritization was required.',
        currentTone: tone(mtd?.kpis?.prioritizationReliabilityPct),
      },
      {
        label: 'MTD Constrained Runtime',
        value: formatHours(mtd?.kpis?.constrainedRuntimeHours),
        sublabel: 'Only real constrained runtime is allowed to affect priority scoring.',
        currentTone: mtd?.kpis?.constrainedRuntimeHours > 0 ? 'orange' : 'green',
      },
    ]
  }, [report])

  const storedReports = report?.archives?.storedReports || meta?.archivedReports || []

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
              <InlineButton onClick={handleGenerateReport} currentTone="green" disabled={!canGenerate}>Generate Report</InlineButton>
              <InlineButton href={report?.archives?.selectedReport?.xlsxDownloadUrl} currentTone="green">Download Current Workbook</InlineButton>
              <InlineButton href={report?.archives?.selectedReport?.jsonDownloadUrl} currentTone="blue">Download Current JSON</InlineButton>
              <InlineButton onClick={() => window.print()} currentTone="yellow">Print</InlineButton>
            </div>
          )}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#8ca0be', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Site Scope</label>
              <div style={{ ...selectStyle, display: 'flex', alignItems: 'center' }}>{controls.siteName} well panel only</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#8ca0be', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Performance Period</label>
              <select value={selectedPreset} onChange={(event) => setSelectedPreset(event.target.value)} style={selectStyle}>
                {presetOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#8ca0be', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Start Date</label>
              <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} style={selectStyle} disabled={!isCustomPreset} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#8ca0be', textTransform: 'uppercase', letterSpacing: '0.12em' }}>End Date</label>
              <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} style={selectStyle} disabled={!isCustomPreset} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 13, color: '#8ca0be', lineHeight: 1.7 }}>
              Selected period: <strong style={{ color: '#f4f8ff' }}>{presetOptions.find((option) => option.key === selectedPreset)?.label || 'Month to Date'}</strong>
            </div>
            <InlineButton onClick={handleGenerateReport} currentTone="green" disabled={!canGenerate}>Generate Report</InlineButton>
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
            Halfmann reporting is currently hard-clamped to {report?.historyFloor?.localLabel || meta?.historyFloor?.localLabel || 'the new panel logic go-live timestamp'}, so no performance or optimization scoring uses older pre-install data. Month-to-date KPI cards reset on the first day of the month at midnight after that go-live floor, and scheduled daily, weekly, and monthly archives are stored in the Halfmann Railway volume for download.
          </div>

          {error ? <div style={{ color: '#fda4af', fontSize: 14 }}>{error}</div> : null}
          <div style={{ fontSize: 12, color: '#8ca0be' }}>
            {isBusy ? 'Building report...' : `Last refresh ${formatDateTime(report?.fetchedAt)} | Samples ${report?.dataQuality?.sampleCount ?? '--'} | Stored reports ${storedReports.length} | Timezone ${report?.calendar?.timezone || meta?.calendar?.timezone || '--'}`}
          </div>
        </Section>

        <Section title="Month-to-Date KPI Scoreboard" eyebrow={report?.calendar?.monthToDateLabel || meta?.calendar?.monthToDateLabel || 'Month-to-Date'}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {monthToDateCards.map((card) => <KpiCard key={card.label} {...card} />)}
          </div>
        </Section>

        <Section title="Selected Report Window" eyebrow={`${report?.reportWindow?.preset || reportRequest.preset} | ${formatDateTime(report?.reportWindow?.startAt)} to ${formatDateTime(report?.reportWindow?.endAt)}`}>
          <div style={{ fontSize: 13, color: '#8ca0be', lineHeight: 1.7 }}>
            This section follows the selected date range, but it will never score anything earlier than {report?.historyFloor?.localLabel || meta?.historyFloor?.localLabel || 'the Halfmann logic go-live floor'}. Month-to-date KPI cards above stay pinned to the live calendar month after that floor.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <KpiCard
              label="Window Well Runtime"
              value={formatPercent(report?.kpis?.overallWellRuntimePct)}
              sublabel="Selected-window runtime at or above desired injection match tolerance."
              currentTone={tone(report?.kpis?.overallWellRuntimePct)}
            />
            <KpiCard
              label="Window Average Match"
              value={formatPercent(report?.kpis?.averageMatchPct)}
              sublabel="Selected-window weighted average match to desired injection rate."
              currentTone={tone(report?.kpis?.averageMatchPct)}
            />
            <KpiCard
              label="Window Priority Reliability"
              value={formatPercent(report?.kpis?.prioritizationReliabilityPct)}
              sublabel="Only scored when actual prioritization was needed."
              currentTone={tone(report?.kpis?.prioritizationReliabilityPct)}
            />
            <KpiCard
              label="Window Constrained Runtime"
              value={formatHours(report?.kpis?.constrainedRuntimeHours)}
              sublabel="Real compressor-constrained or sacrifice runtime only."
              currentTone={report?.kpis?.constrainedRuntimeHours > 0 ? 'orange' : 'green'}
            />
          </div>
        </Section>

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
              sublabel="Time where compressor supply did not fully cover demand or sacrifice logic was active."
              currentTone={report?.prioritization?.constrainedRuntimeHours > 0 ? 'orange' : 'green'}
            />
            <KpiCard
              label="Auto-Perfect Hours"
              value={formatHours(report?.prioritization?.autoPerfectRuntimeHours)}
              sublabel="Time where no prioritization was needed, so the score was locked at 100%."
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
        </Section>

        <Section title="Stored Reports" eyebrow="Archived In Railway Volume">
          <div style={{ fontSize: 13, color: '#8ca0be', lineHeight: 1.7 }}>
            Daily archives store the prior 24-hour day window, weekly archives store the prior 7-day window, monthly archives store the prior month, and every manually generated report is also saved here.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  {['Generated', 'Label', 'Window', 'JSON', 'Workbook'].map((header) => (
                    <th key={header} style={headerCellStyle}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {storedReports.map((item) => (
                  <tr key={item.id}>
                    <td style={cellStyle}>{formatDateTime(item.generatedAt)}</td>
                    <td style={cellStyleStrong}>{item.label}</td>
                    <td style={cellStyle}>{`${item.reportWindow?.startAt || '--'} -> ${item.reportWindow?.endAt || '--'}`}</td>
                    <td style={cellStyle}><a href={item.jsonDownloadUrl} style={{ color: '#7dd3fc' }}>Download JSON</a></td>
                    <td style={cellStyle}><a href={item.xlsxDownloadUrl} style={{ color: '#4ade80' }}>Download XLSX</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  )
}
