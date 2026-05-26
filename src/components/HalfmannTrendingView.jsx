import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  ScatterController,
  Tooltip,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import * as XLSX from 'xlsx'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ScatterController, Tooltip, Legend, Filler)

const playheadPlugin = {
  id: 'halfmannPlayhead',
  afterDatasetsDraw(chart, _args, options) {
    const xValue = options?.xValue
    if (xValue == null) return
    const xScale = chart.scales?.x
    const yScale = chart.scales?.y
    if (!xScale || !yScale) return
    const x = xScale.getPixelForValue(xValue)
    if (!Number.isFinite(x)) return
    const { ctx, chartArea } = chart
    ctx.save()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.setLineDash([5, 5])
    ctx.beginPath()
    ctx.moveTo(x, chartArea.top)
    ctx.lineTo(x, chartArea.bottom)
    ctx.stroke()
    ctx.restore()
  },
}

ChartJS.register(playheadPlugin)

const API_BASE = import.meta.env.VITE_API_URL || ''
const POLL_INTERVAL_MS = 15000
const MAX_VISIBLE_POINTS = 720
const TREND_CACHE_PREFIX = 'halfmann-trending-cache-v1'

const WINDOWS = [
  { key: '1h', hours: 1 },
  { key: '4h', hours: 4 },
  { key: '12h', hours: 12 },
  { key: '24h', hours: 24 },
  { key: '48h', hours: 48 },
  { key: '7d', hours: 24 * 7 },
]

const WELLS = [
  { key: '214', label: 'Well 214', color: '#22c55e' },
  { key: '444', label: 'Well 444', color: '#4fc3f7' },
  { key: '334', label: 'Well 334', color: '#f97316' },
  { key: '213', label: 'Well 213', color: '#eab308' },
  { key: '333', label: 'Well 333', color: '#f472b6' },
]

const COMPRESSORS = [
  { key: 'unit2128', label: 'Compressor 1', unitLabel: '2128', color: '#22c55e' },
  { key: 'unit2130', label: 'Compressor 2', unitLabel: '2130', color: '#4fc3f7' },
  { key: 'unit2127', label: 'Compressor 3', unitLabel: '2127', color: '#f97316' },
  { key: 'unit2129', label: 'Compressor 4', unitLabel: '2129', color: '#f472b6' },
]

const EVENT_LEVELS = {
  reduceForDischarge: 4,
  raiseForRate: 3,
  chokeMove: 2,
  compressorShift: 1,
  wellState: 0,
}

const EVENT_LABELS = {
  4: 'Reduce for discharge',
  3: 'Raise for rate',
  2: 'Choke move',
  1: 'Compressor shift',
  0: 'Well state',
}

async function readErrorPayload(res) {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => ({}))
    return body?.details || body?.error || res.statusText
  }
  return (await res.text().catch(() => '')).trim() || res.statusText
}

async function fetchTrendingHistory(windowHours) {
  const res = await fetch(`${API_BASE}/api/halfmann/trending?hours=${windowHours}&includeFallback=true`)
  if (!res.ok) throw new Error(await readErrorPayload(res))
  return res.json()
}

function getTrendCacheKey(windowHours) {
  return `${TREND_CACHE_PREFIX}:${windowHours}`
}

function readTrendingCache(windowHours) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(getTrendCacheKey(windowHours))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.samples?.length ? parsed : null
  } catch {
    return null
  }
}

function writeTrendingCache(windowHours, payload) {
  if (typeof window === 'undefined' || !payload?.samples?.length) return
  try {
    window.sessionStorage.setItem(getTrendCacheKey(windowHours), JSON.stringify(payload))
  } catch {
    // Ignore cache write failures.
  }
}

function getWindowHours(windowKey) {
  return WINDOWS.find((entry) => entry.key === windowKey)?.hours || 24
}

function toNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function average(values) {
  const valid = values.filter((value) => value != null && Number.isFinite(value))
  if (!valid.length) return null
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function formatTime(ts) {
  return new Date(ts).toLocaleString([], {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatCompactTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatSignedDelta(value, digits = 3, unit = '') {
  if (!Number.isFinite(value)) return '--'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`
}

function formatFileTimestamp(ts = Date.now()) {
  const date = new Date(ts)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  const second = `${date.getSeconds()}`.padStart(2, '0')
  return `${year}${month}${day}-${hour}${minute}${second}`
}

function sanitizeSheetName(value) {
  return String(value || 'Sheet')
    .replace(/[\\/*?:[\]]/g, ' ')
    .slice(0, 31)
}

function downloadWorkbook({ fileName, sheetName, rows }) {
  const worksheet = XLSX.utils.json_to_sheet(rows?.length ? rows : [{ Message: 'No rows available for this graph in the selected time window.' }])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(sheetName))
  XLSX.writeFile(workbook, fileName)
}

function downsampleSamples(samples, maxPoints = MAX_VISIBLE_POINTS) {
  if (samples.length <= maxPoints) return samples
  const step = Math.ceil(samples.length / maxPoints)
  const downsampled = []
  for (let index = 0; index < samples.length; index += step) {
    downsampled.push(samples[index])
  }
  if (downsampled[downsampled.length - 1]?.timestampMs !== samples[samples.length - 1]?.timestampMs) {
    downsampled.push(samples[samples.length - 1])
  }
  return downsampled
}

function getChartColors(alpha = 1) {
  return {
    cyan: `rgba(79, 195, 247, ${alpha})`,
    green: `rgba(34, 197, 94, ${alpha})`,
    orange: `rgba(249, 115, 22, ${alpha})`,
    gold: `rgba(234, 179, 8, ${alpha})`,
    red: `rgba(255, 90, 98, ${alpha})`,
    pink: `rgba(244, 114, 182, ${alpha})`,
    white: `rgba(255, 255, 255, ${alpha})`,
    slate: `rgba(148, 163, 184, ${alpha})`,
  }
}

function pointRadiusForCount(count) {
  if (count > 500) return 1.25
  if (count > 240) return 1.75
  return 2.25
}

function makeLineDataset(label, color, points, extra = {}) {
  const pointRadius = pointRadiusForCount(points.length)
  return {
    label,
    data: points,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius,
    pointHoverRadius: Math.max(pointRadius + 1.5, 3),
    pointHitRadius: 8,
    spanGaps: true,
    tension: 0.12,
    ...extra,
  }
}

function makeReferenceDataset(label, color, points, extra = {}) {
  return makeLineDataset(label, color, points, {
    borderDash: [6, 4],
    pointRadius: 0,
    pointHoverRadius: 0,
    borderWidth: 1.5,
    ...extra,
  })
}

function makeMarkerDataset(label, color, points, pointStyle = 'circle', extra = {}) {
  return {
    type: 'scatter',
    label,
    data: points,
    borderColor: color,
    backgroundColor: color,
    pointRadius: 4.5,
    pointHoverRadius: 5.5,
    pointHitRadius: 9,
    showLine: false,
    pointStyle,
    ...extra,
  }
}

function buildSharedChartOptions({
  currentTimestampMs,
  yTitle,
  yRightTitle,
  yMin = null,
  yMax = null,
  xTickFormatter,
  xMin = null,
  xMax = null,
}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', intersect: false },
    parsing: false,
    plugins: {
      legend: {
        labels: {
          color: '#cbd5e1',
          boxWidth: 12,
          boxHeight: 12,
          usePointStyle: true,
          font: { size: 11, family: 'Montserrat, sans-serif' },
        },
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#ffffff',
        bodyColor: '#dbeafe',
        borderColor: '#1f3650',
        borderWidth: 1,
        callbacks: {
          title: (items) => (items.length ? formatTime(items[0].parsed.x) : ''),
        },
      },
      halfmannPlayhead: { xValue: currentTimestampMs },
    },
    scales: {
      x: {
        type: 'linear',
        min: xMin,
        max: xMax,
        ticks: {
          color: '#94a3b8',
          maxTicksLimit: 8,
          callback: (value) => xTickFormatter(Number(value)),
        },
        grid: { color: 'rgba(71, 85, 105, 0.18)' },
      },
      y: {
        ticks: { color: '#94a3b8' },
        grid: { color: 'rgba(71, 85, 105, 0.18)' },
        title: yTitle ? { display: true, text: yTitle, color: '#cbd5e1' } : undefined,
        min: yMin,
        max: yMax,
      },
      ...(yRightTitle ? {
        y1: {
          position: 'right',
          ticks: { color: '#94a3b8' },
          grid: { drawOnChartArea: false },
          title: { display: true, text: yRightTitle, color: '#cbd5e1' },
        },
      } : {}),
    },
  }
}

function getZoomBounds(samples) {
  if (!samples.length) return null
  return {
    min: samples[0].timestampMs,
    max: samples[samples.length - 1].timestampMs,
  }
}

function clampZoomRange(range, bounds) {
  if (!range || !bounds) return null
  const min = clamp(Math.min(range.min, range.max), bounds.min, bounds.max)
  const max = clamp(Math.max(range.min, range.max), bounds.min, bounds.max)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 30 * 1000) return null
  return { min, max }
}

function getDemandValue(sample) {
  return sample?.panelCommandedCompressorFlow ?? sample?.totalDesiredSiteFlow ?? null
}

function getWellChokeValue(wellSample) {
  return toNumber(wellSample?.chokeCommand)
}

function getCompressorDemandDelta(prev, current) {
  const prevValue = getDemandValue(prev)
  const currentValue = getDemandValue(current)
  if (prevValue != null && currentValue != null) return currentValue - prevValue
  const prevSum = average(prev?.compressors?.map((compressor) => compressor.desiredFlow).filter((value) => value != null) || [])
  const currentSum = average(current?.compressors?.map((compressor) => compressor.desiredFlow).filter((value) => value != null) || [])
  if (prevSum == null || currentSum == null) return null
  return currentSum - prevSum
}

function getCompressorCommandNotes(prev, current) {
  const notes = []
  COMPRESSORS.forEach((compressor, index) => {
    const prevValue = toNumber(prev?.compressors?.[index]?.desiredFlow)
    const currentValue = toNumber(current?.compressors?.[index]?.desiredFlow)
    if (prevValue == null || currentValue == null) return
    const delta = currentValue - prevValue
    if (Math.abs(delta) >= 0.02) {
      notes.push(`${compressor.unitLabel} ${prevValue.toFixed(3)} -> ${currentValue.toFixed(3)}`)
    }
  })
  return notes
}

function getCompressorOutputNotes(prev, current) {
  const notes = []
  COMPRESSORS.forEach((compressor, index) => {
    const prevValue = toNumber(prev?.compressors?.[index]?.currentFlow)
    const currentValue = toNumber(current?.compressors?.[index]?.currentFlow)
    if (prevValue == null || currentValue == null) return
    const delta = currentValue - prevValue
    if (Math.abs(delta) >= 0.02) {
      notes.push(`${compressor.unitLabel} ${prevValue.toFixed(3)} -> ${currentValue.toFixed(3)}`)
    }
  })
  return notes
}

function buildDecisionEvents(samples, thresholds) {
  const events = []
  const dischargeThreshold = toNumber(thresholds?.panelDischargeOverridePsi)

  for (let index = 1; index < samples.length; index += 1) {
    const prev = samples[index - 1]
    const current = samples[index]
    const demandDelta = getCompressorDemandDelta(prev, current)
    const commandNotes = getCompressorCommandNotes(prev, current)
    const dischargeAtOverride =
      dischargeThreshold != null &&
      current.siteDischarge != null &&
      current.siteDischarge >= dischargeThreshold - 0.5

    if (
      demandDelta != null &&
      demandDelta <= -0.01 &&
      (current.flowTargetBeingReduced || current.dischargeOverrideLatch > 0 || dischargeAtOverride)
    ) {
      events.push({
        timestampMs: current.timestampMs,
        type: 'reduceForDischarge',
        level: EVENT_LEVELS.reduceForDischarge,
        label: `Panel lowered compressor demand ${formatSignedDelta(demandDelta, 3, 'MMSCFD')} because discharge protection was active`,
        note: `Demand ${toNumber(getDemandValue(prev))?.toFixed(3) ?? '--'} -> ${toNumber(getDemandValue(current))?.toFixed(3) ?? '--'} MMSCFD | Site discharge ${current.siteDischarge?.toFixed(1) ?? '--'} PSI${dischargeThreshold != null ? ` vs override ${dischargeThreshold.toFixed(0)} PSI` : ''}${commandNotes.length ? ` | Unit SPs: ${commandNotes.join(', ')}` : ''}`,
        value: toNumber(getDemandValue(current)),
      })
    }

    if (
      demandDelta != null &&
      demandDelta >= 0.01 &&
      current.anyWellBelowSetpoint &&
      !current.flowTargetBeingReduced
    ) {
      const shortWells = (current.wells || [])
        .filter((well) => well.matchPct != null && well.matchPct < 99.95)
        .map((well) => well.key)
      events.push({
        timestampMs: current.timestampMs,
        type: 'raiseForRate',
        level: EVENT_LEVELS.raiseForRate,
        label: `Panel raised compressor demand ${formatSignedDelta(demandDelta, 3, 'MMSCFD')} because wells were not meeting rate`,
        note: `Demand ${toNumber(getDemandValue(prev))?.toFixed(3) ?? '--'} -> ${toNumber(getDemandValue(current))?.toFixed(3) ?? '--'} MMSCFD | Wells below rate flag = YES${shortWells.length ? ` | Short wells: ${shortWells.join(', ')}` : ''}${commandNotes.length ? ` | Unit SPs: ${commandNotes.join(', ')}` : ''}`,
        value: toNumber(getDemandValue(current)),
      })
    }
  }

  return events.sort((left, right) => left.timestampMs - right.timestampMs)
}

function getAverageWellMatch(sample) {
  return average((sample?.wells || []).map((well) => toNumber(well?.matchPct)).filter((value) => value != null))
}

function getShortWellKeys(sample) {
  return (sample?.wells || [])
    .filter((well) => well?.matchPct != null && Number(well.matchPct) < 99.95)
    .map((well) => well.key)
}

function buildPressureInvestigations(samples, thresholds, events) {
  const investigations = []
  const dischargeThreshold = toNumber(thresholds?.panelDischargeOverridePsi)
  const lookbackMs = 5 * 60 * 1000
  const lookaheadMs = 5 * 60 * 1000
  const episodeGapMs = 3 * 60 * 1000

  for (let index = 1; index < samples.length; index += 1) {
    const prev = samples[index - 1]
    const current = samples[index]
    const prevDischarge = toNumber(prev?.siteDischarge)
    const currentDischarge = toNumber(current?.siteDischarge)
    if (prevDischarge == null || currentDischarge == null) continue

    const dischargeDelta = currentDischarge - prevDischarge
    const crossedOverride = (
      dischargeThreshold != null &&
      prevDischarge < dischargeThreshold - 0.5 &&
      currentDischarge >= dischargeThreshold - 0.5
    )
    const hardRise = dischargeDelta >= 8
    if (!crossedOverride && !hardRise) continue

    const last = investigations[investigations.length - 1]
    if (last && current.timestampMs - last.timestampMs < episodeGapMs) continue

    const lookbackStart = current.timestampMs - lookbackMs
    const baseline = samples.find((sample) => sample.timestampMs >= lookbackStart) || prev
    const demandBefore = (
      getDemandValue(baseline) != null && getDemandValue(current) != null
        ? getDemandValue(current) - getDemandValue(baseline)
        : null
    )
    const totalFlowBefore = (
      toNumber(baseline?.totalSiteFlow) != null && toNumber(current?.totalSiteFlow) != null
        ? toNumber(current.totalSiteFlow) - toNumber(baseline.totalSiteFlow)
        : null
    )
    const avgMatchBefore = (
      getAverageWellMatch(baseline) != null && getAverageWellMatch(current) != null
        ? getAverageWellMatch(current) - getAverageWellMatch(baseline)
        : null
    )

    const precedingRaise = events.find((event) => (
      event.type === 'raiseForRate' &&
      event.timestampMs >= lookbackStart &&
      event.timestampMs <= current.timestampMs
    ))
    const followingReduce = events.find((event) => (
      event.type === 'reduceForDischarge' &&
      event.timestampMs >= current.timestampMs &&
      event.timestampMs <= current.timestampMs + lookaheadMs
    ))

    const demandRoseFirst = Boolean(precedingRaise) || (demandBefore != null && demandBefore >= 0.01)
    const responseLabel = followingReduce
      ? `Panel later cut demand at ${formatTime(followingReduce.timestampMs)}`
      : current.flowTargetBeingReduced || (current.dischargeOverrideLatch ?? 0) > 0
        ? 'Pressure protection was already active at this point'
        : 'No panel cut was captured in the next 5 minutes'

    const headline = demandRoseFirst
      ? 'Demand was already up before the discharge jump'
      : 'Discharge jumped before any new panel demand increase'

    const causeHint = demandRoseFirst
      ? 'This spike may have followed a panel increase in compressor demand.'
      : (totalFlowBefore != null && totalFlowBefore < -0.03) || (avgMatchBefore != null && avgMatchBefore < -0.15)
        ? 'This looks more like a well-side unload / pressure backup than a panel-caused ramp.'
        : 'The live signals do not prove the root cause yet, but the panel does not appear to have raised demand first.'

    const shortWells = getShortWellKeys(current)
    const evidence = [
      `Discharge ${prevDischarge.toFixed(0)} -> ${currentDischarge.toFixed(0)} PSI (${formatSignedDelta(dischargeDelta, 0, 'PSI')})${dischargeThreshold != null ? ` | override ${dischargeThreshold.toFixed(0)} PSI` : ''}`,
      `Panel commanded flow ${getDemandValue(baseline)?.toFixed(3) ?? '--'} -> ${getDemandValue(current)?.toFixed(3) ?? '--'} MMSCFD${demandBefore != null ? ` (${formatSignedDelta(demandBefore, 3, 'MMSCFD')})` : ''}`,
      `Total site flow ${toNumber(baseline?.totalSiteFlow)?.toFixed(3) ?? '--'} -> ${toNumber(current?.totalSiteFlow)?.toFixed(3) ?? '--'} MMSCFD${totalFlowBefore != null ? ` (${formatSignedDelta(totalFlowBefore, 3, 'MMSCFD')})` : ''}`,
      `Avg well match ${getAverageWellMatch(baseline)?.toFixed(1) ?? '--'}% -> ${getAverageWellMatch(current)?.toFixed(1) ?? '--'}%${shortWells.length ? ` | short wells: ${shortWells.join(', ')}` : ''}`,
      responseLabel,
    ]

    investigations.push({
      timestampMs: current.timestampMs,
      headline,
      causeHint,
      evidence,
      demandRoseFirst,
      hadReduceResponse: Boolean(followingReduce || current.flowTargetBeingReduced || (current.dischargeOverrideLatch ?? 0) > 0),
    })
  }

  return investigations.sort((left, right) => right.timestampMs - left.timestampMs).slice(0, 8)
}

function getWindowedSamples(samples, hours) {
  if (!samples.length) return []
  const endMs = samples[samples.length - 1].timestampMs
  const cutoffMs = endMs - hours * 60 * 60 * 1000
  return samples.filter((sample) => sample.timestampMs >= cutoffMs)
}

function computeValveStability(samples) {
  if (!samples.length) return []
  return WELLS.map((well, wellIndex) => {
    const points = samples
      .map((sample) => ({
        timestampMs: sample.timestampMs,
        value: getWellChokeValue(sample?.wells?.[wellIndex]),
      }))
      .filter((point) => point.value != null)

    if (!points.length) {
      return {
        ...well,
        avgPosition: null,
        avgStepChange: null,
        travelPerHour: null,
        stabilityScore: null,
        sampleCount: 0,
      }
    }

    const positions = points.map((point) => point.value)
    const deltas = []
    let totalTravel = 0
    for (let index = 1; index < points.length; index += 1) {
      const delta = Math.abs(points[index].value - points[index - 1].value)
      deltas.push(delta)
      totalTravel += delta
    }

    const spanHours = points.length > 1
      ? Math.max((points[points.length - 1].timestampMs - points[0].timestampMs) / 3600000, 1 / 60)
      : 1 / 60
    const travelPerHour = totalTravel / spanHours
    const avgStepChange = deltas.length ? average(deltas) : 0
    const stabilityScore = clamp(100 - travelPerHour * 2.6 - avgStepChange * 4, 0, 100)

    return {
      ...well,
      avgPosition: average(positions),
      avgStepChange,
      travelPerHour,
      stabilityScore,
      sampleCount: points.length,
    }
  })
}

function MetricChip({ label, value, helper }) {
  return (
    <div className="rounded-xl border border-[#1f3650] bg-[#0a1220] p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7dd3fc]">{label}</div>
      <div className="mt-2 text-[24px] font-black text-white lg:text-[28px]" style={{ fontFamily: "'Arial Black', sans-serif" }}>
        {value}
      </div>
      <div className="mt-2 text-[12px] leading-relaxed text-[#94a3b8]">{helper}</div>
    </div>
  )
}

function InvestigationCard({ item }) {
  return (
    <div className="rounded-xl border border-[#1f3650] bg-[#0a1220] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7dd3fc]">{formatTime(item.timestampMs)}</div>
          <div className="mt-1 text-[15px] font-bold leading-snug text-white">{item.headline}</div>
        </div>
        <div className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${item.demandRoseFirst ? 'bg-[#3b1f17] text-[#fdba74]' : 'bg-[#102235] text-[#7dd3fc]'}`}>
          {item.demandRoseFirst ? 'Demand first' : 'Pressure first'}
        </div>
      </div>
      <div className="mt-3 text-[12px] leading-relaxed text-[#cbd5e1]">{item.causeHint}</div>
      <div className="mt-3 grid gap-2">
        {item.evidence.map((line) => (
          <div key={line} className="text-[11px] leading-relaxed text-[#94a3b8]">
            {line}
          </div>
        ))}
      </div>
    </div>
  )
}

function ChartPanel({ title, subtitle, heightClass = 'h-[360px] lg:h-[420px] 2xl:h-[340px]', action, children }) {
  return (
    <div className="rounded-2xl border border-[#1f3650] bg-[#0d1726] p-4 lg:p-5">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#49d0e2]">{title}</div>
          {subtitle ? <div className="mt-1 text-[12px] leading-relaxed text-[#94a3b8]">{subtitle}</div> : null}
        </div>
        {action ? <div className="shrink-0 self-start">{action}</div> : null}
      </div>
      <div className={heightClass}>{children}</div>
    </div>
  )
}

function getTimestampFromPointer(chart, event) {
  if (!chart?.canvas || !chart?.scales?.x) return null
  const rect = chart.canvas.getBoundingClientRect()
  if (!rect.width) return null
  const scaledX = ((event.clientX - rect.left) * chart.width) / rect.width
  const clampedX = clamp(scaledX, chart.chartArea?.left ?? 0, chart.chartArea?.right ?? chart.width)
  const value = chart.scales.x.getValueForPixel(clampedX)
  return Number.isFinite(value) ? value : null
}

function getPixelFromTimestamp(chart, timestampMs) {
  if (!chart?.canvas || !chart?.scales?.x) return null
  const rect = chart.canvas.getBoundingClientRect()
  if (!rect.width || !chart.width) return null
  const pixel = chart.scales.x.getPixelForValue(timestampMs)
  if (!Number.isFinite(pixel)) return null
  return (pixel * rect.width) / chart.width
}

function ZoomableChart({ data, options, dragState, onDragStart, onDragMove, onDragEnd }) {
  const chartRef = useRef(null)
  const isDragging = Boolean(dragState?.active)

  const selectionStyle = useMemo(() => {
    if (!isDragging || !chartRef.current) return null
    const startPixel = getPixelFromTimestamp(chartRef.current, dragState.startTs)
    const currentPixel = getPixelFromTimestamp(chartRef.current, dragState.currentTs)
    if (!Number.isFinite(startPixel) || !Number.isFinite(currentPixel)) return null
    return {
      left: Math.min(startPixel, currentPixel),
      width: Math.max(Math.abs(currentPixel - startPixel), 2),
    }
  }, [dragState, isDragging])

  return (
    <div className="h-full overflow-x-auto overscroll-x-contain">
      <div
        className="relative h-full min-w-[760px] sm:min-w-0"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          const chart = chartRef.current
          const ts = getTimestampFromPointer(chart, event)
          if (ts == null) return
          event.currentTarget.setPointerCapture?.(event.pointerId)
          onDragStart(ts)
        }}
        onPointerMove={(event) => {
          if (!isDragging) return
          const chart = chartRef.current
          const ts = getTimestampFromPointer(chart, event)
          if (ts == null) return
          onDragMove(ts)
        }}
        onPointerUp={(event) => {
          if (!isDragging) return
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          const chart = chartRef.current
          const ts = getTimestampFromPointer(chart, event)
          onDragEnd(ts)
        }}
        onPointerLeave={(event) => {
          if (!isDragging) return
          const chart = chartRef.current
          const ts = getTimestampFromPointer(chart, event)
          onDragEnd(ts)
        }}
        onDoubleClick={() => onDragEnd(null, true)}
      >
        <Line ref={chartRef} data={data} options={options} />
        {selectionStyle ? (
          <div
            className="pointer-events-none absolute top-0 bottom-0 rounded-md border border-[#7dd3fc] bg-[#49d0e2]/12"
            style={selectionStyle}
          />
        ) : null}
      </div>
    </div>
  )
}

function StabilityCard({ metric }) {
  return (
    <div className="rounded-xl border border-[#1f3650] bg-[#0a1220] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#7dd3fc]">{metric.label}</div>
        <div className="text-[22px] font-black text-white" style={{ fontFamily: "'Arial Black', sans-serif" }}>
          {metric.stabilityScore != null ? `${metric.stabilityScore.toFixed(0)}%` : '--'}
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#64748b]">Avg Position</div>
          <div className="mt-1 text-[14px] font-bold text-white">{metric.avgPosition != null ? `${metric.avgPosition.toFixed(1)}%` : '--'}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#64748b]">Travel / Hr</div>
          <div className="mt-1 text-[14px] font-bold text-white">{metric.travelPerHour != null ? `${metric.travelPerHour.toFixed(1)}%` : '--'}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#64748b]">Avg Step</div>
          <div className="mt-1 text-[14px] font-bold text-white">{metric.avgStepChange != null ? `${metric.avgStepChange.toFixed(2)}%` : '--'}</div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-[#64748b]">{metric.sampleCount} retained samples over the last 24 hours</div>
      {metric.sampleCount === 0 ? (
        <div className="mt-2 text-[11px] text-[#fca5a5]">No retained choke-command history available for this well yet.</div>
      ) : null}
    </div>
  )
}

export default function HalfmannTrendingView() {
  const [historyPayload, setHistoryPayload] = useState(() => readTrendingCache(24))
  const [loading, setLoading] = useState(() => !readTrendingCache(24))
  const [error, setError] = useState('')
  const [windowKey, setWindowKey] = useState('24h')
  const [selectedWindowKey, setSelectedWindowKey] = useState('24h')
  const [isLiveMode, setIsLiveMode] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [direction, setDirection] = useState(1)
  const [speed, setSpeed] = useState(1)
  const [playheadTimestampMs, setPlayheadTimestampMs] = useState(null)
  const [zoomRange, setZoomRange] = useState(null)
  const [dragState, setDragState] = useState(null)
  const refreshTimerRef = useRef(null)

  const loadHistory = async (selectedWindowKey, liveMode) => {
    const requestedHours = Math.max(getWindowHours(selectedWindowKey), 24)
    const cachedPayload = readTrendingCache(requestedHours)
    if (cachedPayload?.samples?.length) {
      setHistoryPayload(cachedPayload)
      setLoading(false)
      setError('')
      if (liveMode) {
        const cachedLatestTs = cachedPayload.samples[cachedPayload.samples.length - 1]?.timestampMs ?? null
        if (cachedLatestTs != null) setPlayheadTimestampMs(cachedLatestTs)
      }
    }
    const nextPayload = await fetchTrendingHistory(requestedHours)
    setHistoryPayload(nextPayload)
    setLoading(false)
    setError('')
    writeTrendingCache(requestedHours, nextPayload)
    if (liveMode) {
      const latestTs = nextPayload?.samples?.[nextPayload.samples.length - 1]?.timestampMs ?? null
      if (latestTs != null) setPlayheadTimestampMs(latestTs)
    }
  }

  useEffect(() => {
    const cachedPayload = readTrendingCache(Math.max(getWindowHours(windowKey), 24))
    setLoading(!cachedPayload?.samples?.length)
    loadHistory(windowKey, isLiveMode).catch((err) => {
      setError(err.message || 'Failed to load Halfmann trending history')
      setLoading(false)
    })
  }, [windowKey])

  useEffect(() => {
    if (!isLiveMode) return undefined
    refreshTimerRef.current = window.setInterval(() => {
      loadHistory(windowKey, true).catch((err) => setError(err.message || 'Failed to refresh Halfmann trending history'))
    }, POLL_INTERVAL_MS)
    return () => {
      if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current)
    }
  }, [isLiveMode, windowKey])

  const samples = historyPayload?.samples || []
  const windowHours = getWindowHours(windowKey)
  const visibleSamples = useMemo(() => getWindowedSamples(samples, windowHours), [samples, windowHours])
  const downsampledVisibleSamples = useMemo(() => downsampleSamples(visibleSamples), [visibleSamples])
  const last24HoursSamples = useMemo(() => getWindowedSamples(samples, 24), [samples])
  const latestTimestampMs = visibleSamples[visibleSamples.length - 1]?.timestampMs ?? null
  const thresholds = historyPayload?.thresholds || {}
  const zoomBounds = useMemo(() => getZoomBounds(visibleSamples), [visibleSamples])
  const activeZoomRange = useMemo(() => clampZoomRange(zoomRange, zoomBounds), [zoomBounds, zoomRange])
  const exportSamples = useMemo(() => (
    activeZoomRange
      ? visibleSamples.filter((sample) => sample.timestampMs >= activeZoomRange.min && sample.timestampMs <= activeZoomRange.max)
      : visibleSamples
  ), [activeZoomRange, visibleSamples])

  useEffect(() => {
    if (!zoomBounds) {
      setZoomRange(null)
      setDragState(null)
      return
    }
    setZoomRange((current) => {
      if (!current) return null
      const clamped = clampZoomRange(current, zoomBounds)
      if (!clamped) return null
      if (clamped.min === current.min && clamped.max === current.max) return current
      return clamped
    })
  }, [zoomBounds])

  const resetZoom = () => {
    setZoomRange(null)
    setDragState(null)
  }

  const generateSelectedWindow = () => {
    resetZoom()
    setLoading(true)
    if (windowKey === selectedWindowKey) {
      loadHistory(selectedWindowKey, isLiveMode).catch((err) => {
        setError(err.message || 'Failed to load Halfmann trending history')
        setLoading(false)
      })
      return
    }
    setWindowKey(selectedWindowKey)
  }

  const startChartZoom = (timestampMs) => {
    setDragState({
      active: true,
      startTs: timestampMs,
      currentTs: timestampMs,
    })
  }

  const updateChartZoom = (timestampMs) => {
    setDragState((current) => (current?.active ? { ...current, currentTs: timestampMs } : current))
  }

  const endChartZoom = (timestampMs, reset = false) => {
    if (reset) {
      resetZoom()
      return
    }

    const finalState = dragState
      ? {
          ...dragState,
          currentTs: timestampMs ?? dragState.currentTs,
        }
      : null

    setDragState(null)
    if (!finalState || !zoomBounds) return

    const nextRange = clampZoomRange(
      {
        min: finalState.startTs,
        max: finalState.currentTs,
      },
      zoomBounds,
    )

    if (!nextRange) return
    setZoomRange(nextRange)
    setIsLiveMode(false)
    setIsPlaying(false)
  }

  useEffect(() => {
    if (isLiveMode) {
      setIsPlaying(false)
      setDirection(1)
    }
  }, [isLiveMode])

  const currentSample = useMemo(() => {
    if (!visibleSamples.length) return null
    if (isLiveMode || playheadTimestampMs == null) return visibleSamples[visibleSamples.length - 1]
    let best = visibleSamples[0]
    for (const sample of visibleSamples) {
      if (sample.timestampMs <= playheadTimestampMs) best = sample
      else break
    }
    return best
  }, [visibleSamples, isLiveMode, playheadTimestampMs])

  const currentIndex = useMemo(() => {
    if (!currentSample || !visibleSamples.length) return 0
    return visibleSamples.findIndex((sample) => sample.timestampMs === currentSample.timestampMs)
  }, [currentSample, visibleSamples])

  useEffect(() => {
    if (!isPlaying || isLiveMode || visibleSamples.length < 2 || currentIndex === -1) return undefined
    const delay = Math.max(90, 700 / speed)
    const timer = window.setTimeout(() => {
      const nextIndex = currentIndex + direction
      if (nextIndex < 0 || nextIndex >= visibleSamples.length) {
        setIsPlaying(false)
        return
      }
      setPlayheadTimestampMs(visibleSamples[nextIndex].timestampMs)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [currentIndex, direction, isLiveMode, isPlaying, speed, visibleSamples])

  const events = useMemo(() => buildDecisionEvents(visibleSamples, thresholds), [thresholds, visibleSamples])
  const pressureInvestigations = useMemo(() => buildPressureInvestigations(visibleSamples, thresholds, events), [events, thresholds, visibleSamples])
  const valveStability = useMemo(() => computeValveStability(last24HoursSamples), [last24HoursSamples])
  const colors = getChartColors()
  const xTickFormatter = (value) => formatCompactTime(value)

  const flowDecisionChartData = useMemo(() => {
    const datasets = [
      makeLineDataset(
        'Panel Commanded Compressor Flow',
        colors.cyan,
        downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: sample.panelCommandedCompressorFlow })),
      ),
      makeLineDataset(
        'Total Desired Site Flow',
        colors.white,
        downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: sample.totalDesiredSiteFlow })),
        { borderDash: [5, 4] },
      ),
      makeLineDataset(
        'Total Site Flow',
        colors.green,
        downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: sample.totalSiteFlow })),
      ),
    ]

    const reduceEvents = events
      .filter((event) => event.type === 'reduceForDischarge')
      .map((event) => ({ x: event.timestampMs, y: event.value }))
    if (reduceEvents.length) {
      datasets.push(makeMarkerDataset('Reduced for discharge', colors.red, reduceEvents, 'triangle'))
    }

    const raiseEvents = events
      .filter((event) => event.type === 'raiseForRate')
      .map((event) => ({ x: event.timestampMs, y: event.value }))
    if (raiseEvents.length) {
      datasets.push(makeMarkerDataset('Raised for rate', colors.gold, raiseEvents, 'rectRot'))
    }

    return { datasets }
  }, [colors.cyan, colors.gold, colors.green, colors.red, colors.white, downsampledVisibleSamples, events])

  const flowDecisionChartOptions = useMemo(() => buildSharedChartOptions({
    currentTimestampMs: currentSample?.timestampMs,
    yTitle: 'Flow demand (MMSCFD)',
    xTickFormatter,
    xMin: activeZoomRange?.min,
    xMax: activeZoomRange?.max,
  }), [activeZoomRange?.max, activeZoomRange?.min, currentSample?.timestampMs])

  const wellMatchChartData = useMemo(() => {
    const datasets = WELLS.map((well, index) =>
      makeLineDataset(
        `${well.label} Match`,
        well.color,
        downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: sample.wells[index]?.matchPct })),
      ),
    )

    datasets.push(
      makeReferenceDataset(
        '100% target',
        colors.slate,
        downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: 100 })),
      ),
    )

    return { datasets }
  }, [colors.slate, downsampledVisibleSamples])

  const wellMatchChartOptions = useMemo(() => buildSharedChartOptions({
    currentTimestampMs: currentSample?.timestampMs,
    yTitle: 'Live injection match (%)',
    yMin: 90,
    yMax: 102,
    xTickFormatter,
    xMin: activeZoomRange?.min,
    xMax: activeZoomRange?.max,
  }), [activeZoomRange?.max, activeZoomRange?.min, currentSample?.timestampMs])

  const chokeChartData = useMemo(() => {
    const datasets = WELLS.map((well, index) =>
      makeLineDataset(
        `${well.label} Choke`,
        well.color,
        downsampledVisibleSamples.map((sample) => ({
          x: sample.timestampMs,
          y: getWellChokeValue(sample.wells[index]),
        })),
      ),
    )

    const chokeEvents = events
      .filter((event) => event.type === 'chokeMove')
      .map((event) => ({ x: event.timestampMs, y: event.value }))
    if (chokeEvents.length) {
      datasets.push(makeMarkerDataset('Choke move > 5%', colors.red, chokeEvents, 'triangle'))
    }

    return { datasets }
  }, [colors.red, downsampledVisibleSamples, events])

  const chokeChartOptions = useMemo(() => buildSharedChartOptions({
    currentTimestampMs: currentSample?.timestampMs,
    yTitle: 'Choke output (%)',
    yMin: 0,
    yMax: 100,
    xTickFormatter,
    xMin: activeZoomRange?.min,
    xMax: activeZoomRange?.max,
  }), [activeZoomRange?.max, activeZoomRange?.min, currentSample?.timestampMs])

  const compressorChartData = useMemo(() => {
    const datasets = []

    COMPRESSORS.forEach((compressor, index) => {
      datasets.push(
        makeLineDataset(
          `${compressor.label} SP`,
          compressor.color,
          downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: sample.compressors[index]?.desiredFlow })),
        ),
      )
      datasets.push(
        makeLineDataset(
          `${compressor.label} Output`,
          compressor.color,
          downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: sample.compressors[index]?.currentFlow })),
          { borderDash: [4, 4], borderWidth: 1.5 },
        ),
      )
    })

    datasets.push(
      makeLineDataset(
        'Site Discharge',
        colors.red,
        downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: sample.siteDischarge })),
        { yAxisID: 'y1' },
      ),
    )

    if (thresholds?.panelDischargeOverridePsi != null) {
      datasets.push(
        makeReferenceDataset(
          'Discharge Override Setting',
          colors.gold,
          downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: thresholds.panelDischargeOverridePsi })),
          { yAxisID: 'y1' },
        ),
      )
    }

    if (thresholds?.compressorSpeedControlDischargePsi != null) {
      datasets.push(
        makeReferenceDataset(
          'Compressor Speed-Control SP',
          colors.white,
          downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: thresholds.compressorSpeedControlDischargePsi })),
          { yAxisID: 'y1' },
        ),
      )
    }

    return { datasets }
  }, [colors.gold, colors.red, colors.white, downsampledVisibleSamples, thresholds?.compressorSpeedControlDischargePsi, thresholds?.panelDischargeOverridePsi])

  const compressorChartOptions = useMemo(() => buildSharedChartOptions({
    currentTimestampMs: currentSample?.timestampMs,
    yTitle: 'Flow (MMSCFD)',
    yRightTitle: 'Discharge PSI',
    xTickFormatter,
    xMin: activeZoomRange?.min,
    xMax: activeZoomRange?.max,
  }), [activeZoomRange?.max, activeZoomRange?.min, currentSample?.timestampMs])

  const pressureChartData = useMemo(() => {
    const datasets = [
      makeLineDataset(
        'Site Suction',
        colors.cyan,
        downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: sample.siteSuction })),
      ),
    ]

    WELLS.forEach((well, index) => {
      datasets.push(
        makeLineDataset(
          `${well.label} Diff`,
          well.color,
          downsampledVisibleSamples.map((sample) => ({ x: sample.timestampMs, y: sample.wells[index]?.differentialPressure })),
          { borderDash: [5, 5], borderWidth: 1.5, yAxisID: 'y1' },
        ),
      )
    })

    return { datasets }
  }, [colors.cyan, downsampledVisibleSamples])

  const pressureChartOptions = useMemo(() => buildSharedChartOptions({
    currentTimestampMs: currentSample?.timestampMs,
    yTitle: 'Site Suction (PSI)',
    yRightTitle: 'Well Differential (In/H2O)',
    xTickFormatter,
    xMin: activeZoomRange?.min,
    xMax: activeZoomRange?.max,
  }), [activeZoomRange?.max, activeZoomRange?.min, currentSample?.timestampMs])

  const eventChartData = useMemo(() => ({
    datasets: [
      makeMarkerDataset(
        'Decision events',
        colors.red,
        events.map((event) => ({ x: event.timestampMs, y: event.level })),
      ),
    ],
  }), [colors.red, events])

  const eventChartOptions = useMemo(() => ({
    ...buildSharedChartOptions({
      currentTimestampMs: currentSample?.timestampMs,
      xTickFormatter,
      xMin: activeZoomRange?.min,
      xMax: activeZoomRange?.max,
    }),
    plugins: {
      ...buildSharedChartOptions({
        currentTimestampMs: currentSample?.timestampMs,
        xTickFormatter,
        xMin: activeZoomRange?.min,
        xMax: activeZoomRange?.max,
      }).plugins,
      tooltip: {
        backgroundColor: '#0f172a',
        titleColor: '#ffffff',
        bodyColor: '#dbeafe',
        borderColor: '#1f3650',
        borderWidth: 1,
        callbacks: {
          title: (items) => (items.length ? formatTime(items[0].parsed.x) : ''),
          label: (context) => {
            const matched = events.find((event) => event.timestampMs === context.parsed.x && event.level === context.parsed.y)
            return matched?.label || EVENT_LABELS[context.parsed.y] || 'Event'
          },
          afterLabel: (context) => {
            const matched = events.find((event) => event.timestampMs === context.parsed.x && event.level === context.parsed.y)
            return matched?.note || ''
          },
        },
      },
      legend: { display: false },
      halfmannPlayhead: { xValue: currentSample?.timestampMs },
    },
    scales: {
      x: {
        type: 'linear',
        min: activeZoomRange?.min,
        max: activeZoomRange?.max,
        ticks: {
          color: '#94a3b8',
          maxTicksLimit: 8,
          callback: (value) => xTickFormatter(Number(value)),
        },
        grid: { color: 'rgba(71, 85, 105, 0.18)' },
      },
      y: {
        min: -0.5,
        max: 4.5,
        ticks: {
          color: '#94a3b8',
          stepSize: 1,
          callback: (value) => EVENT_LABELS[value] || '',
        },
        grid: { color: 'rgba(71, 85, 105, 0.18)' },
      },
    },
  }), [activeZoomRange?.max, activeZoomRange?.min, currentSample?.timestampMs, events])

  const recentEvents = useMemo(() => events.slice(-12).reverse(), [events])
  const bufferedSampleCount = samples.length
  const visibleSampleCount = visibleSamples.length
  const currentTimestampLabel = currentSample ? formatTime(currentSample.timestampMs) : '--'
  const scrubMax = Math.max(visibleSamples.length - 1, 0)
  const generatePending = selectedWindowKey !== windowKey
  const exportSuffix = `${windowKey}${activeZoomRange ? '-zoom' : ''}-${formatFileTimestamp()}`

  const exportFlowDecisionChart = () => downloadWorkbook({
    fileName: `halfmann-panel-flow-decisions-${exportSuffix}.xlsx`,
    sheetName: 'Panel Flow Decisions',
    rows: exportSamples.map((sample) => ({
      Timestamp: formatTime(sample.timestampMs),
      TimestampMs: sample.timestampMs,
      PanelCommandedCompressorFlow_MMSCFD: sample.panelCommandedCompressorFlow,
      TotalDesiredSiteFlow_MMSCFD: sample.totalDesiredSiteFlow,
      TotalSiteFlow_MMSCFD: sample.totalSiteFlow,
      SiteDischarge_PSI: sample.siteDischarge,
      FlowTargetBeingReduced: sample.flowTargetBeingReduced,
      AnyWellBelowSetpoint: sample.anyWellBelowSetpoint,
      DischargeOverrideLatch: sample.dischargeOverrideLatch,
      ReduceForDischargeEvent: events.some((event) => event.type === 'reduceForDischarge' && event.timestampMs === sample.timestampMs),
      RaiseForRateEvent: events.some((event) => event.type === 'raiseForRate' && event.timestampMs === sample.timestampMs),
    })),
  })

  const exportWellMatchChart = () => downloadWorkbook({
    fileName: `halfmann-well-live-match-${exportSuffix}.xlsx`,
    sheetName: 'Well Live Match',
    rows: exportSamples.map((sample) => ({
      Timestamp: formatTime(sample.timestampMs),
      TimestampMs: sample.timestampMs,
      Well214_MatchPct: sample.wells?.[0]?.matchPct,
      Well444_MatchPct: sample.wells?.[1]?.matchPct,
      Well334_MatchPct: sample.wells?.[2]?.matchPct,
      Well213_MatchPct: sample.wells?.[3]?.matchPct,
      Well333_MatchPct: sample.wells?.[4]?.matchPct,
    })),
  })

  const exportChokeChart = () => downloadWorkbook({
    fileName: `halfmann-well-choke-commands-${exportSuffix}.xlsx`,
    sheetName: 'Well Choke Commands',
    rows: exportSamples.map((sample) => ({
      Timestamp: formatTime(sample.timestampMs),
      TimestampMs: sample.timestampMs,
      Well214_ChokePct: getWellChokeValue(sample.wells?.[0]),
      Well444_ChokePct: getWellChokeValue(sample.wells?.[1]),
      Well334_ChokePct: getWellChokeValue(sample.wells?.[2]),
      Well213_ChokePct: getWellChokeValue(sample.wells?.[3]),
      Well333_ChokePct: getWellChokeValue(sample.wells?.[4]),
    })),
  })

  const exportCompressorChart = () => downloadWorkbook({
    fileName: `halfmann-compressor-commands-discharge-${exportSuffix}.xlsx`,
    sheetName: 'Compressor Trend',
    rows: exportSamples.map((sample) => ({
      Timestamp: formatTime(sample.timestampMs),
      TimestampMs: sample.timestampMs,
      Compressor1_SP_MMSCFD: sample.compressors?.[0]?.desiredFlow,
      Compressor1_Output_MMSCFD: sample.compressors?.[0]?.currentFlow,
      Compressor2_SP_MMSCFD: sample.compressors?.[1]?.desiredFlow,
      Compressor2_Output_MMSCFD: sample.compressors?.[1]?.currentFlow,
      Compressor3_SP_MMSCFD: sample.compressors?.[2]?.desiredFlow,
      Compressor3_Output_MMSCFD: sample.compressors?.[2]?.currentFlow,
      Compressor4_SP_MMSCFD: sample.compressors?.[3]?.desiredFlow,
      Compressor4_Output_MMSCFD: sample.compressors?.[3]?.currentFlow,
      SiteDischarge_PSI: sample.siteDischarge,
      DischargeOverrideSetting_PSI: thresholds?.panelDischargeOverridePsi,
      CompressorSpeedControlSP_PSI: thresholds?.compressorSpeedControlDischargePsi,
    })),
  })

  const exportPressureChart = () => downloadWorkbook({
    fileName: `halfmann-suction-differential-pressures-${exportSuffix}.xlsx`,
    sheetName: 'Pressure Trend',
    rows: exportSamples.map((sample) => ({
      Timestamp: formatTime(sample.timestampMs),
      TimestampMs: sample.timestampMs,
      SiteSuction_PSI: sample.siteSuction,
      Well214_InjectionDifferentialPressure_InH2O: sample.wells?.[0]?.differentialPressure,
      Well444_InjectionDifferentialPressure_InH2O: sample.wells?.[1]?.differentialPressure,
      Well334_InjectionDifferentialPressure_InH2O: sample.wells?.[2]?.differentialPressure,
      Well213_InjectionDifferentialPressure_InH2O: sample.wells?.[3]?.differentialPressure,
      Well333_InjectionDifferentialPressure_InH2O: sample.wells?.[4]?.differentialPressure,
    })),
  })

  const exportDecisionTimeline = () => downloadWorkbook({
    fileName: `halfmann-decision-timeline-${exportSuffix}.xlsx`,
    sheetName: 'Decision Timeline',
    rows: events.map((event) => ({
      Timestamp: formatTime(event.timestampMs),
      TimestampMs: event.timestampMs,
      EventType: event.type,
      EventLane: EVENT_LABELS[event.level] || event.level,
      Label: event.label,
      Note: event.note,
      Value: event.value,
      WellKey: event.wellKey || '',
    })),
  })

  return (
    <div className="flex min-h-full flex-col bg-[#080810] text-white">
      <header className="border-b border-[#1a1a2a] bg-[#0c0c16] px-3 py-3 sm:px-5">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3 sm:items-center">
            <div className={`h-2.5 w-2.5 rounded-full ${isLiveMode ? 'bg-[#22c55e] shadow-lg shadow-[#22c55e]/60' : 'bg-[#f97316] shadow-lg shadow-[#f97316]/60'}`} />
            <div>
              <div className="text-[12px] font-bold sm:text-[13px]" style={{ fontFamily: "'Arial Black', sans-serif" }}>
                Trending and Playback - Halfmann 1214
              </div>
              <div className="text-[10px] text-[#64748b]">
                Real panel decisions, synchronized trends, and retained playback history
              </div>
            </div>
          </div>
          <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => {
                window.location.hash = '#/'
              }}
              className="shrink-0 rounded-full border border-[#1f3650] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#7dd3fc] hover:border-[#49d0e2] hover:text-white"
            >
              Live View
            </button>
            <button
              onClick={() => {
                setIsLiveMode(true)
                setIsPlaying(false)
                if (latestTimestampMs != null) setPlayheadTimestampMs(latestTimestampMs)
              }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${isLiveMode ? 'bg-[#22c55e] text-black' : 'border border-[#1f3650] text-[#cbd5e1]'}`}
            >
              Live
            </button>
            <button
              onClick={() => {
                setIsLiveMode(false)
                setDirection(-1)
                setIsPlaying(true)
              }}
              className="shrink-0 rounded-full border border-[#1f3650] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#cbd5e1] hover:border-[#49d0e2]"
            >
              Reverse
            </button>
            <button
              onClick={() => {
                if (isLiveMode) setIsLiveMode(false)
                setDirection(1)
                setIsPlaying((current) => !current)
              }}
              className="shrink-0 rounded-full bg-[#49d0e2] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-black"
            >
              {isPlaying && !isLiveMode ? 'Pause' : 'Play'}
            </button>
            {[1, 2, 5, 10].map((multiplier) => (
              <button
                key={multiplier}
                onClick={() => setSpeed(multiplier)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${speed === multiplier ? 'bg-[#ff5a62] text-white' : 'border border-[#1f3650] text-[#cbd5e1]'}`}
              >
                {multiplier}x
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1720px] flex-col gap-5 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
        {error ? (
          <div className="rounded-xl border border-[#7a1a1a] bg-[#1b0d0d] px-4 py-3 text-[11px] text-[#fecaca]">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 min-[1500px]:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.85fr)]">
          <div className="rounded-2xl border border-[#1f3650] bg-[#0d1726] p-4 lg:p-5">
            <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#49d0e2]">Playback Controls</div>
                <div className="mt-1 text-[13px] leading-relaxed text-[#cbd5e1]">
                  Current timestamp: <span className="font-bold text-white">{currentTimestampLabel}</span>
                </div>
                <div className="mt-1 text-[12px] text-[#64748b]">
                  Retained samples: {bufferedSampleCount} | Visible window: {visibleSampleCount} | Mode: {isLiveMode ? 'Live follow' : isPlaying ? 'Playback running' : 'Playback paused'}
                </div>
                <div className="mt-1 text-[12px] text-[#64748b]">
                  Drag across any graph to zoom that time slice. Double-click a graph or use Reset Zoom to return to the full selected window.
                </div>
              </div>
              <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
                {WINDOWS.map((entry) => (
                  <button
                    key={entry.key}
                    onClick={() => setSelectedWindowKey(entry.key)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${selectedWindowKey === entry.key ? 'bg-[#ff5a62] text-white' : 'border border-[#1f3650] text-[#cbd5e1]'}`}
                  >
                    {entry.key}
                  </button>
                ))}
                <button
                  onClick={generateSelectedWindow}
                  disabled={loading}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${loading ? 'cursor-wait bg-[#334155] text-[#cbd5e1]' : generatePending ? 'bg-[#49d0e2] text-black' : 'border border-[#49d0e2] text-[#7dd3fc] hover:bg-[#49d0e2] hover:text-black'}`}
                >
                  {loading ? 'Generating...' : 'Generate'}
                </button>
                {activeZoomRange ? (
                  <button
                    onClick={resetZoom}
                    className="shrink-0 rounded-full border border-[#49d0e2] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#7dd3fc] hover:bg-[#49d0e2] hover:text-black"
                  >
                    Reset Zoom
                  </button>
                ) : null}
              </div>
            </div>

            <input
              type="range"
              min={0}
              max={scrubMax}
              step={1}
              value={currentIndex === -1 ? scrubMax : currentIndex}
              onChange={(event) => {
                const nextIndex = clamp(Number(event.target.value), 0, scrubMax)
                setIsLiveMode(false)
                setIsPlaying(false)
                if (visibleSamples[nextIndex]) setPlayheadTimestampMs(visibleSamples[nextIndex].timestampMs)
              }}
              className="h-3 w-full cursor-pointer accent-[#49d0e2]"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <MetricChip
              label="Site Discharge"
              value={currentSample?.siteDischarge != null ? `${currentSample.siteDischarge.toFixed(1)} PSI` : '--'}
              helper={`Max compressor discharge at the current playhead${thresholds?.panelDischargeOverridePsi != null ? ` | override ${thresholds.panelDischargeOverridePsi.toFixed(0)} PSI` : ''}`}
            />
            <MetricChip
              label="Site Suction"
              value={currentSample?.siteSuction != null ? `${currentSample.siteSuction.toFixed(1)} PSI` : '--'}
              helper="Header suction, falling back to avg unit suction when needed"
            />
            <MetricChip
              label="Discharge-Reduce Events"
              value={`${events.filter((event) => event.type === 'reduceForDischarge').length}`}
              helper="Times the panel lowered compressor demand while pressure protection was active"
            />
            <MetricChip
              label="Rate-Recovery Events"
              value={`${events.filter((event) => event.type === 'raiseForRate').length}`}
              helper="Times the panel raised compressor demand because wells were below rate"
            />
          </div>
        </div>

        <div className="grid gap-5 min-[1680px]:grid-cols-2">
          <div className="min-[1680px]:col-span-2 rounded-2xl border border-[#1f3650] bg-[#0d1726] p-4">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#49d0e2]">Pressure Event Diagnosis</div>
            <div className="mb-4 text-[12px] leading-relaxed text-[#94a3b8]">
              For each hard discharge rise or override hit, show whether panel demand had already been increased first or whether the pressure jump happened before any new demand increase, then show whether the panel later cut demand.
            </div>
            <div className="grid gap-4 min-[1680px]:grid-cols-2">
              {pressureInvestigations.length ? pressureInvestigations.map((item) => (
                <InvestigationCard key={`investigation-${item.timestampMs}`} item={item} />
              )) : (
                <div className="text-[12px] text-[#94a3b8]">
                  No qualifying discharge-rise investigations were found in the selected time window.
                </div>
              )}
            </div>
          </div>

          <ChartPanel
            title="Panel Flow Demand Decisions"
            subtitle="Real panel demand lines with markers when compressor flow demand was reduced for discharge pressure or raised for wells below rate"
            action={
              <button
                onClick={exportFlowDecisionChart}
                className="rounded-full border border-[#1f3650] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#cbd5e1] hover:border-[#49d0e2] hover:text-white"
              >
                Export
              </button>
            }
          >
            <ZoomableChart
              data={flowDecisionChartData}
              options={flowDecisionChartOptions}
              dragState={dragState}
              onDragStart={startChartZoom}
              onDragMove={updateChartZoom}
              onDragEnd={endChartZoom}
            />
          </ChartPanel>

          <ChartPanel
            title="Well Live Match Percent"
            subtitle="Direct MLink live injection match percentage registers for all five wells"
            action={
              <button
                onClick={exportWellMatchChart}
                className="rounded-full border border-[#1f3650] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#cbd5e1] hover:border-[#49d0e2] hover:text-white"
              >
                Export
              </button>
            }
          >
            <ZoomableChart
              data={wellMatchChartData}
              options={wellMatchChartOptions}
              dragState={dragState}
              onDragStart={startChartZoom}
              onDragMove={updateChartZoom}
              onDragEnd={endChartZoom}
            />
          </ChartPanel>

          <ChartPanel
            title="Well Choke Commands"
            subtitle="Real commanded choke outputs from the panel, with dots on each visible retained sample and markers when a choke jumps by more than 5%"
            action={
              <button
                onClick={exportChokeChart}
                className="rounded-full border border-[#1f3650] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#cbd5e1] hover:border-[#49d0e2] hover:text-white"
              >
                Export
              </button>
            }
          >
            <ZoomableChart
              data={chokeChartData}
              options={chokeChartOptions}
              dragState={dragState}
              onDragStart={startChartZoom}
              onDragMove={updateChartZoom}
              onDragEnd={endChartZoom}
            />
          </ChartPanel>

          <ChartPanel
            title="Compressor Commands, Outputs, and Discharge"
            subtitle="Per-compressor desired flow SP vs current flow output, overlaid with site discharge and the configured discharge override thresholds"
            action={
              <button
                onClick={exportCompressorChart}
                className="rounded-full border border-[#1f3650] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#cbd5e1] hover:border-[#49d0e2] hover:text-white"
              >
                Export
              </button>
            }
          >
            <ZoomableChart
              data={compressorChartData}
              options={compressorChartOptions}
              dragState={dragState}
              onDragStart={startChartZoom}
              onDragMove={updateChartZoom}
              onDragEnd={endChartZoom}
            />
          </ChartPanel>

          <ChartPanel
            title="Suction and Well Differential Pressures"
            subtitle="Site suction overlaid with each well's injection differential pressure so you can line up real well pressure movement with panel decisions"
            action={
              <button
                onClick={exportPressureChart}
                className="rounded-full border border-[#1f3650] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#cbd5e1] hover:border-[#49d0e2] hover:text-white"
              >
                Export
              </button>
            }
          >
            <ZoomableChart
              data={pressureChartData}
              options={pressureChartOptions}
              dragState={dragState}
              onDragStart={startChartZoom}
              onDragMove={updateChartZoom}
              onDragEnd={endChartZoom}
            />
          </ChartPanel>

          <ChartPanel
            title="Decision Timeline"
            subtitle="Only real panel demand decisions: reduced-for-discharge override or raised-for-wells-not-meeting-rate"
            heightClass="h-[320px] lg:h-[360px] 2xl:h-[300px]"
            action={
              <button
                onClick={exportDecisionTimeline}
                className="rounded-full border border-[#1f3650] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#cbd5e1] hover:border-[#49d0e2] hover:text-white"
              >
                Export
              </button>
            }
          >
            <ZoomableChart
              data={eventChartData}
              options={eventChartOptions}
              dragState={dragState}
              onDragStart={startChartZoom}
              onDragMove={updateChartZoom}
              onDragEnd={endChartZoom}
            />
          </ChartPanel>
        </div>

        <div className="rounded-2xl border border-[#1f3650] bg-[#0d1726] p-4 lg:p-5">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#49d0e2]">24h Valve Stability</div>
          <div className="grid gap-3 lg:grid-cols-2 min-[1500px]:grid-cols-3 min-[1800px]:grid-cols-5">
            {valveStability.map((metric) => (
              <StabilityCard key={metric.key} metric={metric} />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#1f3650] bg-[#0d1726] p-4 lg:p-5">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#49d0e2]">Recent Decision Notes</div>
          <div className="grid gap-3 min-[1600px]:grid-cols-2">
            {recentEvents.length ? recentEvents.map((event) => (
              <div key={`${event.type}-${event.timestampMs}-${event.label}`} className="rounded-xl border border-[#1f3650] bg-[#0a1220] p-3">
                <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#7dd3fc]">{EVENT_LABELS[event.level]}</div>
                <div className="mt-1 text-[12px] font-bold text-white">{event.label}</div>
                <div className="mt-1 text-[11px] text-[#cbd5e1]">{event.note}</div>
                <div className="mt-1 text-[10px] text-[#64748b]">{formatTime(event.timestampMs)}</div>
              </div>
            )) : (
              <div className="text-[12px] text-[#94a3b8]">
                No retained panel demand decisions are available yet in the selected time window. This list only shows true panel raise/lower demand decisions.
              </div>
            )}
          </div>
        </div>

        {loading && !samples.length ? (
          <div className="rounded-xl border border-[#1f3650] bg-[#0d1726] px-4 py-3 text-[11px] text-[#cbd5e1]">
            Loading retained Halfmann history...
          </div>
        ) : null}
      </main>
    </div>
  )
}
