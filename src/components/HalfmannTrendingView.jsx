import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { parseLiveDatapoints } from '../engine/liveRegisters'
import { loadSnapshotsSince, pruneSnapshotsBefore, saveSnapshot } from './halfmannTrendingStorage'

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
const POLL_INTERVAL_MS = 5000
const MAX_HISTORY_MS = 7 * 24 * 60 * 60 * 1000
const WINDOWS = ['1h', '4h', '12h', '24h', '48h', '7d']

const HALFMANN_DEVICES = {
  panel: '2507-501508',
  unit2130: '2507-500709',
  unit2127: '2504-504108',
  unit2129: '2504-504102',
  unit2128: '2507-500076',
}

const WELLS = [
  { key: 'well1', label: 'Well 1', fieldLabel: '214', analogIndex: 1, color: '#22c55e' },
  { key: 'well2', label: 'Well 2', fieldLabel: '444', analogIndex: 2, color: '#4fc3f7' },
  { key: 'well3', label: 'Well 3', fieldLabel: '334', analogIndex: 3, color: '#f97316' },
  { key: 'well4', label: 'Well 4', fieldLabel: '213', analogIndex: 4, color: '#eab308' },
  { key: 'well5', label: 'Well 5', fieldLabel: '333', analogIndex: 5, color: '#f472b6' },
]

const COMPRESSORS = [
  { key: 'unit2128', label: 'Compressor 1', unitLabel: '2128', color: '#22c55e' },
  { key: 'unit2130', label: 'Compressor 2', unitLabel: '2130', color: '#4fc3f7' },
  { key: 'unit2127', label: 'Compressor 3', unitLabel: '2127', color: '#f97316' },
  { key: 'unit2129', label: 'Compressor 4', unitLabel: '2129', color: '#f472b6' },
]

const EVENT_LEVELS = {
  wellState: 3,
  choke: 2,
  compressor: 1,
  discharge: 0,
}

const EVENT_LABELS = {
  3: 'Well online/offline',
  2: 'Choke > 5%',
  1: 'Compressor SP change',
  0: 'Discharge shift',
}

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
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return { data: null, error: `device ${deviceId}: API returned ${contentType || 'non-JSON content'}` }
    }
    return { data: await res.json(), error: '' }
  } catch (err) {
    return { data: null, error: `device ${deviceId}: ${err.message}` }
  }
}

function resolvePreferredDatapoint(dataMap, labels) {
  for (const label of labels) {
    if (dataMap[label] != null) return dataMap[label]
  }
  return null
}

function toNumber(raw) {
  const numeric = Number(raw)
  return Number.isFinite(numeric) ? numeric : null
}

function getNumeric(dataMap, labels) {
  return toNumber(resolvePreferredDatapoint(dataMap, labels)?.value)
}

function getText(dataMap, labels) {
  const value = resolvePreferredDatapoint(dataMap, labels)?.value
  return value == null ? null : String(value)
}

function average(values) {
  const valid = values.filter((value) => value != null && Number.isFinite(value))
  if (!valid.length) return null
  return valid.reduce((sum, value) => sum + value, 0) / valid.length
}

function windowToMs(windowKey) {
  if (windowKey === '1h') return 60 * 60 * 1000
  if (windowKey === '4h') return 4 * 60 * 60 * 1000
  if (windowKey === '12h') return 12 * 60 * 60 * 1000
  if (windowKey === '24h') return 24 * 60 * 60 * 1000
  if (windowKey === '48h') return 48 * 60 * 60 * 1000
  return 7 * 24 * 60 * 60 * 1000
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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizeSamples(samples) {
  const byTimestamp = new Map()
  for (const sample of samples) {
    if (sample?.timestampMs == null) continue
    byTimestamp.set(sample.timestampMs, sample)
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestampMs - b.timestampMs)
}

function downsampleSamples(samples, maxPoints = 360) {
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
  }
}

function parseWellOnline(statusText, flowRunningPct) {
  if (statusText) {
    const normalized = statusText.toLowerCase()
    if (normalized.includes('online') || normalized.includes('running')) return true
    if (normalized.includes('offline') || normalized.includes('stopped')) return false
  }
  if (flowRunningPct != null) return flowRunningPct > 0
  return null
}

function buildChokeKeys(well) {
  return [
    `Wellhead ${well.fieldLabel} Override Position`,
    `Wellhead #${well.fieldLabel} Override Position`,
    `Wellhead ${well.analogIndex} Override Position`,
    `Wellhead #${well.analogIndex} Override Position`,
    `Well #${well.fieldLabel} Analog Output ${well.analogIndex}`,
    `Well #${well.analogIndex} Analog Output ${well.analogIndex}`,
    `Well ${well.fieldLabel} Choke Position`,
    `Well ${well.analogIndex} Choke Position`,
  ]
}

function buildStaticPressureKeys(well) {
  return [
    `Wellhead #${well.analogIndex} Injection Static Pressure From Customer PLC`,
    `Wellhead #${well.fieldLabel} Injection Static Pressure From Customer PLC`,
    `Well ${well.analogIndex} Static Pressure`,
    `Well ${well.fieldLabel} Static Pressure`,
  ]
}

function buildRunStatusKeys(well) {
  return [
    `WellHead #${well.analogIndex} Running Status`,
    `WellHead #${well.fieldLabel} Running Status`,
    `Wellhead #${well.analogIndex} Running Status`,
    `Wellhead #${well.fieldLabel} Running Status`,
  ]
}

function buildFlowRunningPctKeys(well) {
  return [
    `Wellhead #${well.analogIndex} Flow Running Status Percent`,
    `Wellhead #${well.fieldLabel} Flow Running Status Percent`,
  ]
}

function buildCompressorDesiredKeys(index) {
  const compressorNumber = index + 1
  return [
    `Compressor #${compressorNumber} Desire Flow SP For PID Murphy`,
    `Compressor #${compressorNumber} Desired Flow SP For PID Murphy`,
    `Compressor ${compressorNumber} Desire Flow SP For PID Murphy`,
    `Compressor ${compressorNumber} Desired Flow SP For PID Murphy`,
  ]
}

function buildCompressorCurrentKeys(compressor) {
  return [
    `Compressor #${compressor.label.split(' ')[1]} Unit ${compressor.unitLabel} Current Flow Output`,
    `Compressor ${compressor.label.split(' ')[1]} Unit ${compressor.unitLabel} Current Flow Output`,
    'Current Flow Output',
    'Flow Rate',
    'Flow Rate PID PV',
  ]
}

function getTimestampMs(payload) {
  const ts = Array.isArray(payload?.timestamps) ? payload.timestamps[0] : null
  if (ts == null) return Date.now()
  return ts > 1_000_000_000_000 ? ts : ts * 1000
}

function buildSnapshot(panelPayload, unitPayloads) {
  const panel = parseLiveDatapoints(panelPayload)
  const unitMaps = Object.fromEntries(
    Object.entries(unitPayloads).map(([key, payload]) => [key, parseLiveDatapoints(payload)]),
  )

  const wellChokes = WELLS.map((well) => getNumeric(panel, buildChokeKeys(well)))
  const wellStatic = WELLS.map((well) => getNumeric(panel, buildStaticPressureKeys(well)))
  const wellOnline = WELLS.map((well) =>
    parseWellOnline(
      getText(panel, buildRunStatusKeys(well)),
      getNumeric(panel, buildFlowRunningPctKeys(well)),
    ),
  )

  const compressorDesired = COMPRESSORS.map((compressor, index) =>
    getNumeric(panel, buildCompressorDesiredKeys(index)) ??
    getNumeric(unitMaps[compressor.key] || {}, [
      'Desire Flow SP For PID Murphy',
      'Desired Flow SP For PID Murphy',
      'Flow Rate PID SP',
    ]),
  )

  const compressorCurrent = COMPRESSORS.map((compressor) =>
    getNumeric(panel, buildCompressorCurrentKeys(compressor)) ??
    getNumeric(unitMaps[compressor.key] || {}, ['Flow Rate', 'Flow Rate PID PV', 'Flow Rate PV', 'Flow PID PV']),
  )

  const compressorSuction = COMPRESSORS.map((compressor) =>
    getNumeric(unitMaps[compressor.key] || {}, ['Suction Pressure', 'Stage 1 Suction Prs', 'Stage 1 Suction Pressure']),
  )

  const compressorDischarge = COMPRESSORS.map((compressor) =>
    getNumeric(unitMaps[compressor.key] || {}, ['Discharge Pressure', 'Stage 3 Discharge Prs', 'Stage 3 Discharge Pressure']),
  )

  const suctionHeader = getNumeric(panel, ['Suction Header Pressure', 'Suction Pressure', 'Stage 1 Suction Prs'])
  const siteSuction = suctionHeader != null && suctionHeader > 0 ? suctionHeader : average(compressorSuction)
  const dischargeValues = compressorDischarge.filter((value) => value != null)
  const siteDischarge = dischargeValues.length ? dischargeValues.reduce((max, value) => Math.max(max, value)) : null

  return {
    timestampMs: getTimestampMs(panelPayload),
    wellChokes,
    wellStatic,
    wellOnline,
    compressorDesired,
    compressorCurrent,
    compressorSuction,
    compressorDischarge,
    siteSuction,
    siteDischarge,
    panelTimestampMs: getTimestampMs(panelPayload),
  }
}

function buildDecisionEvents(samples) {
  const events = []
  for (let index = 1; index < samples.length; index += 1) {
    const prev = samples[index - 1]
    const current = samples[index]

    WELLS.forEach((well, wellIndex) => {
      const prevChoke = prev.wellChokes[wellIndex]
      const currentChoke = current.wellChokes[wellIndex]
      if (prevChoke != null && currentChoke != null && Math.abs(currentChoke - prevChoke) > 5) {
        events.push({
          timestampMs: current.timestampMs,
          type: 'choke',
          level: EVENT_LEVELS.choke,
          label: `${well.label} choke ${prevChoke.toFixed(1)}% -> ${currentChoke.toFixed(1)}%`,
          value: currentChoke,
          seriesIndex: wellIndex,
        })
      }

      const prevOnline = prev.wellOnline[wellIndex]
      const currentOnline = current.wellOnline[wellIndex]
      if (prevOnline != null && currentOnline != null && prevOnline !== currentOnline) {
        events.push({
          timestampMs: current.timestampMs,
          type: 'wellState',
          level: EVENT_LEVELS.wellState,
          label: `${well.label} ${currentOnline ? 'online' : 'offline'}`,
          value: currentChoke ?? 0,
          seriesIndex: wellIndex,
        })
      }
    })

    COMPRESSORS.forEach((compressor, compressorIndex) => {
      const prevDesired = prev.compressorDesired[compressorIndex]
      const currentDesired = current.compressorDesired[compressorIndex]
      if (prevDesired != null && currentDesired != null && Math.abs(currentDesired - prevDesired) >= 0.02) {
        events.push({
          timestampMs: current.timestampMs,
          type: 'compressor',
          level: EVENT_LEVELS.compressor,
          label: `${compressor.label} command ${prevDesired.toFixed(3)} -> ${currentDesired.toFixed(3)} MMSCFD`,
          value: currentDesired,
          seriesIndex: compressorIndex,
        })
      }
    })

    if (
      prev.siteDischarge != null &&
      current.siteDischarge != null &&
      Math.abs(current.siteDischarge - prev.siteDischarge) >= 10
    ) {
      events.push({
        timestampMs: current.timestampMs,
        type: 'discharge',
        level: EVENT_LEVELS.discharge,
        label: `Site discharge ${prev.siteDischarge.toFixed(1)} -> ${current.siteDischarge.toFixed(1)} PSI`,
        value: current.siteDischarge,
        seriesIndex: 0,
      })
    }
  }
  return events
}

function buildSharedChartOptions({ currentTimestampMs, yTitle, yRightTitle, yMin = null, yMax = null, xTickFormatter }) {
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
        min: undefined,
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

function makeLineDataset(label, color, points, extra = {}) {
  return {
    label,
    data: points,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 3,
    spanGaps: true,
    tension: 0.15,
    ...extra,
  }
}

function makeMarkerDataset(label, color, points, pointStyle = 'triangle', extra = {}) {
  return {
    type: 'scatter',
    label,
    data: points,
    borderColor: color,
    backgroundColor: color,
    pointRadius: 4,
    pointHoverRadius: 5,
    showLine: false,
    pointStyle,
    ...extra,
  }
}

function MetricChip({ label, value, helper }) {
  return (
    <div className="rounded-xl border border-[#1f3650] bg-[#0a1220] p-3">
      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#7dd3fc]">{label}</div>
      <div className="mt-2 text-[18px] font-black text-white" style={{ fontFamily: "'Arial Black', sans-serif" }}>
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-relaxed text-[#94a3b8]">{helper}</div>
    </div>
  )
}

function ChartPanel({ title, subtitle, heightClass = 'h-[280px]', children }) {
  return (
    <div className="rounded-2xl border border-[#1f3650] bg-[#0d1726] p-4">
      <div className="mb-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#49d0e2]">{title}</div>
        {subtitle && <div className="mt-1 text-[11px] text-[#94a3b8]">{subtitle}</div>}
      </div>
      <div className={heightClass}>{children}</div>
    </div>
  )
}

export default function HalfmannTrendingView() {
  const [samples, setSamples] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [windowKey, setWindowKey] = useState('24h')
  const [isLiveMode, setIsLiveMode] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [direction, setDirection] = useState(1)
  const [speed, setSpeed] = useState(1)
  const [playheadTimestampMs, setPlayheadTimestampMs] = useState(null)
  const refreshTimerRef = useRef(null)

  const loadPersistedHistory = useCallback(async () => {
    const cutoffMs = Date.now() - MAX_HISTORY_MS
    const rows = await loadSnapshotsSince(cutoffMs)
    if (rows.length) {
      setSamples(normalizeSamples(rows))
      setPlayheadTimestampMs(rows[rows.length - 1].timestampMs)
    }
  }, [])

  const refresh = useCallback(async () => {
    const [panelResult, ...unitResults] = await Promise.all([
      fetchDeviceFull(HALFMANN_DEVICES.panel),
      ...COMPRESSORS.map((compressor) => fetchDeviceFull(HALFMANN_DEVICES[compressor.key])),
    ])

    const allErrors = [panelResult.error, ...unitResults.map((result) => result.error)].filter(Boolean)
    if (!panelResult.data) {
      if (allErrors.length) setError(allErrors.join(' | '))
      setLoading(false)
      return
    }

    const unitPayloads = {}
    COMPRESSORS.forEach((compressor, index) => {
      unitPayloads[compressor.key] = unitResults[index].data
    })

    const snapshot = buildSnapshot(panelResult.data, unitPayloads)
    setSamples((current) => normalizeSamples([...current, snapshot]).filter((sample) => sample.timestampMs >= Date.now() - MAX_HISTORY_MS))
    setError(allErrors.join(' | '))
    setLoading(false)

    if (isLiveMode) {
      setPlayheadTimestampMs(snapshot.timestampMs)
    }

    saveSnapshot(snapshot).catch(() => {})
    pruneSnapshotsBefore(Date.now() - MAX_HISTORY_MS).catch(() => {})
  }, [isLiveMode])

  useEffect(() => {
    loadPersistedHistory().catch(() => {})
  }, [loadPersistedHistory])

  useEffect(() => {
    refresh().catch(() => {})
    if (!isLiveMode) return undefined
    refreshTimerRef.current = window.setInterval(() => {
      refresh().catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => {
      if (refreshTimerRef.current) window.clearInterval(refreshTimerRef.current)
    }
  }, [isLiveMode, refresh])

  const latestTimestampMs = samples[samples.length - 1]?.timestampMs ?? null
  const filteredSamples = useMemo(() => {
    if (!samples.length) return []
    const endMs = latestTimestampMs ?? Date.now()
    const cutoffMs = endMs - windowToMs(windowKey)
    return samples.filter((sample) => sample.timestampMs >= cutoffMs)
  }, [latestTimestampMs, samples, windowKey])

  const currentSample = useMemo(() => {
    if (!filteredSamples.length) return null
    if (isLiveMode || playheadTimestampMs == null) return filteredSamples[filteredSamples.length - 1]
    let best = filteredSamples[0]
    for (const sample of filteredSamples) {
      if (sample.timestampMs <= playheadTimestampMs) best = sample
      else break
    }
    return best
  }, [filteredSamples, isLiveMode, playheadTimestampMs])

  const currentIndex = useMemo(() => {
    if (!currentSample || !filteredSamples.length) return 0
    return filteredSamples.findIndex((sample) => sample.timestampMs === currentSample.timestampMs)
  }, [currentSample, filteredSamples])

  useEffect(() => {
    if (isLiveMode) {
      setIsPlaying(false)
      setDirection(1)
    }
  }, [isLiveMode])

  useEffect(() => {
    if (!isPlaying || isLiveMode || filteredSamples.length < 2 || currentIndex === -1) return undefined
    const delay = Math.max(90, 700 / speed)
    const timer = window.setTimeout(() => {
      const nextIndex = currentIndex + direction
      if (nextIndex < 0 || nextIndex >= filteredSamples.length) {
        setIsPlaying(false)
        return
      }
      setPlayheadTimestampMs(filteredSamples[nextIndex].timestampMs)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [currentIndex, direction, filteredSamples, isLiveMode, isPlaying, speed])

  const downsampledSamples = useMemo(() => downsampleSamples(filteredSamples, 360), [filteredSamples])
  const events = useMemo(() => buildDecisionEvents(filteredSamples), [filteredSamples])

  const colors = getChartColors()
  const xTickFormatter = useCallback((value) => formatCompactTime(value), [])

  const chokeChartData = useMemo(() => {
    const datasets = WELLS.map((well, index) =>
      makeLineDataset(
        `${well.label} Choke`,
        well.color,
        downsampledSamples.map((sample) => ({ x: sample.timestampMs, y: sample.wellChokes[index] })),
      ),
    )

    const chokeEvents = events.filter((event) => event.type === 'choke').map((event) => ({ x: event.timestampMs, y: event.value }))
    if (chokeEvents.length) datasets.push(makeMarkerDataset('Choke > 5%', colors.red, chokeEvents, 'triangle'))

    const wellStateEvents = events.filter((event) => event.type === 'wellState').map((event) => ({ x: event.timestampMs, y: event.value }))
    if (wellStateEvents.length) datasets.push(makeMarkerDataset('Well online/offline', colors.gold, wellStateEvents, 'rectRot'))

    return { datasets }
  }, [colors.gold, colors.red, downsampledSamples, events])

  const chokeChartOptions = useMemo(() => buildSharedChartOptions({
    currentTimestampMs: currentSample?.timestampMs,
    yTitle: 'Choke command (%)',
    yMin: 0,
    yMax: 100,
    xTickFormatter,
  }), [currentSample?.timestampMs, xTickFormatter])

  const compressorChartData = useMemo(() => {
    const datasets = COMPRESSORS.map((compressor, index) =>
      makeLineDataset(
        `${compressor.label} Flow SP`,
        compressor.color,
        downsampledSamples.map((sample) => ({ x: sample.timestampMs, y: sample.compressorDesired[index] })),
      ),
    )

    datasets.push(makeLineDataset(
      'Site Discharge',
      colors.red,
      downsampledSamples.map((sample) => ({ x: sample.timestampMs, y: sample.siteDischarge })),
      { yAxisID: 'y1', borderDash: [8, 4] },
    ))

    const compressorEvents = events.filter((event) => event.type === 'compressor').map((event) => ({ x: event.timestampMs, y: event.value }))
    if (compressorEvents.length) datasets.push(makeMarkerDataset('SP change', colors.white, compressorEvents, 'triangle'))

    const dischargeEvents = events.filter((event) => event.type === 'discharge').map((event) => ({ x: event.timestampMs, y: event.value }))
    if (dischargeEvents.length) datasets.push(makeMarkerDataset('Discharge shift', colors.gold, dischargeEvents, 'circle', { yAxisID: 'y1' }))

    return { datasets }
  }, [colors.gold, colors.red, colors.white, downsampledSamples, events])

  const compressorChartOptions = useMemo(() => buildSharedChartOptions({
    currentTimestampMs: currentSample?.timestampMs,
    yTitle: 'Flow command (MMSCFD)',
    yRightTitle: 'Discharge PSI',
    xTickFormatter,
  }), [currentSample?.timestampMs, xTickFormatter])

  const pressureChartData = useMemo(() => {
    const datasets = [
      makeLineDataset(
        'Site Suction',
        colors.cyan,
        downsampledSamples.map((sample) => ({ x: sample.timestampMs, y: sample.siteSuction })),
      ),
    ]

    WELLS.forEach((well, index) => {
      datasets.push(makeLineDataset(
        `${well.label} Static`,
        well.color,
        downsampledSamples.map((sample) => ({ x: sample.timestampMs, y: sample.wellStatic[index] })),
        { borderDash: [5, 5] },
      ))
    })

    return { datasets }
  }, [colors.cyan, downsampledSamples])

  const pressureChartOptions = useMemo(() => buildSharedChartOptions({
    currentTimestampMs: currentSample?.timestampMs,
    yTitle: 'Pressure (PSI)',
    xTickFormatter,
  }), [currentSample?.timestampMs, xTickFormatter])

  const eventChartData = useMemo(() => ({
    datasets: [
      makeMarkerDataset(
        'Decision events',
        colors.red,
        events.map((event) => ({ x: event.timestampMs, y: event.level })),
        'circle',
      ),
    ],
  }), [colors.red, events])

  const eventChartOptions = useMemo(() => ({
    ...buildSharedChartOptions({
      currentTimestampMs: currentSample?.timestampMs,
      yTitle: '',
      xTickFormatter,
    }),
    plugins: {
      ...buildSharedChartOptions({
        currentTimestampMs: currentSample?.timestampMs,
        xTickFormatter,
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
        },
      },
      legend: { display: false },
      halfmannPlayhead: { xValue: currentSample?.timestampMs },
    },
    scales: {
      x: {
        type: 'linear',
        ticks: {
          color: '#94a3b8',
          maxTicksLimit: 8,
          callback: (value) => xTickFormatter(Number(value)),
        },
        grid: { color: 'rgba(71, 85, 105, 0.18)' },
      },
      y: {
        min: -0.5,
        max: 3.5,
        ticks: {
          color: '#94a3b8',
          stepSize: 1,
          callback: (value) => EVENT_LABELS[value] || '',
        },
        grid: { color: 'rgba(71, 85, 105, 0.18)' },
      },
    },
  }), [currentSample?.timestampMs, events, xTickFormatter])

  const recentEvents = useMemo(() => {
    if (!currentSample) return []
    const end = currentSample.timestampMs
    const start = end - 60 * 60 * 1000
    return events.filter((event) => event.timestampMs >= start && event.timestampMs <= end).slice(-8).reverse()
  }, [currentSample, events])

  const currentTimestampLabel = currentSample ? formatTime(currentSample.timestampMs) : '--'
  const scrubMax = Math.max(filteredSamples.length - 1, 0)

  return (
    <div className="flex min-h-full flex-col bg-[#080810] text-white">
      <header className="border-b border-[#1a1a2a] bg-[#0c0c16] px-4 py-3 sm:px-5">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full ${isLiveMode ? 'bg-[#22c55e] shadow-lg shadow-[#22c55e]/60' : 'bg-[#f97316] shadow-lg shadow-[#f97316]/60'}`} />
            <div>
              <div className="text-[13px] font-bold" style={{ fontFamily: "'Arial Black', sans-serif" }}>
                Trending and Playback - Halfmann 1214
              </div>
              <div className="text-[10px] text-[#64748b]">
                Real panel decisions, synchronized trends, and buffered playback
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                window.location.hash = '#/'
              }}
              className="rounded-full border border-[#1f3650] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#7dd3fc] hover:border-[#49d0e2] hover:text-white"
            >
              Live View
            </button>
            <button
              onClick={() => {
                setIsLiveMode(true)
                setIsPlaying(false)
                if (latestTimestampMs != null) setPlayheadTimestampMs(latestTimestampMs)
              }}
              className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${isLiveMode ? 'bg-[#22c55e] text-black' : 'border border-[#1f3650] text-[#cbd5e1]'}`}
            >
              Live
            </button>
            <button
              onClick={() => {
                setIsLiveMode(false)
                setDirection(direction === -1 ? 1 : -1)
                setIsPlaying(true)
              }}
              className="rounded-full border border-[#1f3650] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#cbd5e1] hover:border-[#49d0e2]"
            >
              Reverse
            </button>
            <button
              onClick={() => {
                if (isLiveMode) setIsLiveMode(false)
                setDirection(1)
                setIsPlaying((current) => !current)
              }}
              className="rounded-full bg-[#49d0e2] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-black"
            >
              {isPlaying && !isLiveMode ? 'Pause' : 'Play'}
            </button>
            {[1, 2, 5, 10].map((multiplier) => (
              <button
                key={multiplier}
                onClick={() => setSpeed(multiplier)}
                className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${speed === multiplier ? 'bg-[#ff5a62] text-white' : 'border border-[#1f3650] text-[#cbd5e1]'}`}
              >
                {multiplier}x
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-5 sm:px-5 sm:py-6">
        {error && (
          <div className="rounded-xl border border-[#7a1a1a] bg-[#1b0d0d] px-4 py-3 text-[11px] text-[#fecaca]">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-[#1f3650] bg-[#0d1726] p-4">
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#49d0e2]">Playback Controls</div>
                <div className="mt-1 text-[12px] text-[#cbd5e1]">
                  Current timestamp: <span className="font-bold text-white">{currentTimestampLabel}</span>
                </div>
                <div className="mt-1 text-[11px] text-[#64748b]">
                  Buffered samples: {samples.length} | Visible window: {filteredSamples.length} | Mode: {isLiveMode ? 'Live follow' : isPlaying ? 'Playback running' : 'Playback paused'}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {WINDOWS.map((key) => (
                  <button
                    key={key}
                    onClick={() => setWindowKey(key)}
                    className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${windowKey === key ? 'bg-[#ff5a62] text-white' : 'border border-[#1f3650] text-[#cbd5e1]'}`}
                  >
                    {key}
                  </button>
                ))}
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
                if (filteredSamples[nextIndex]) setPlayheadTimestampMs(filteredSamples[nextIndex].timestampMs)
              }}
              className="h-3 w-full cursor-pointer accent-[#49d0e2]"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <MetricChip
              label="Site Discharge"
              value={currentSample?.siteDischarge != null ? `${currentSample.siteDischarge.toFixed(1)} PSI` : '--'}
              helper="Max compressor discharge at the current playhead"
            />
            <MetricChip
              label="Site Suction"
              value={currentSample?.siteSuction != null ? `${currentSample.siteSuction.toFixed(1)} PSI` : '--'}
              helper="Header suction, falling back to avg unit suction when needed"
            />
            <MetricChip
              label="Well Decision Events"
              value={`${events.filter((event) => event.type === 'choke' || event.type === 'wellState').length}`}
              helper="Choke swings >5% and online/offline transitions in the visible window"
            />
            <MetricChip
              label="Compressor Decision Events"
              value={`${events.filter((event) => event.type === 'compressor' || event.type === 'discharge').length}`}
              helper="Command setpoint changes and significant discharge shifts"
            />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartPanel
            title="Well Choke Command"
            subtitle="Five wells over the same time axis, with markers when panel decisions jump by more than 5%"
          >
            <Line data={chokeChartData} options={chokeChartOptions} />
          </ChartPanel>

          <ChartPanel
            title="Compressor Commands and Discharge"
            subtitle="Compressor 1-4 flow SPs with site discharge on the same timeline"
          >
            <Line data={compressorChartData} options={compressorChartOptions} />
          </ChartPanel>

          <ChartPanel
            title="Suction and Static Pressures"
            subtitle="Site suction overlaid with each well's static pressure"
          >
            <Line data={pressureChartData} options={pressureChartOptions} />
          </ChartPanel>

          <ChartPanel
            title="Decision Visualization"
            subtitle="Timeline markers for choke jumps, compressor SP changes, discharge moves, and well online/offline changes"
            heightClass="h-[260px]"
          >
            <Line data={eventChartData} options={eventChartOptions} />
          </ChartPanel>
        </div>

        <div className="rounded-2xl border border-[#1f3650] bg-[#0d1726] p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#49d0e2]">Recent Decision Notes</div>
          <div className="grid gap-3 md:grid-cols-2">
            {recentEvents.length ? recentEvents.map((event) => (
              <div key={`${event.type}-${event.timestampMs}-${event.label}`} className="rounded-xl border border-[#1f3650] bg-[#0a1220] p-3">
                <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#7dd3fc]">{EVENT_LABELS[event.level]}</div>
                <div className="mt-1 text-[12px] font-bold text-white">{event.label}</div>
                <div className="mt-1 text-[10px] text-[#64748b]">{formatTime(event.timestampMs)}</div>
              </div>
            )) : (
              <div className="text-[12px] text-[#94a3b8]">
                No decision markers are available yet in the selected time window. Leave the page in live mode to keep buffering.
              </div>
            )}
          </div>
        </div>

        {loading && !samples.length ? (
          <div className="rounded-xl border border-[#1f3650] bg-[#0d1726] px-4 py-3 text-[11px] text-[#cbd5e1]">
            Loading first Halfmann trend sample...
          </div>
        ) : null}
      </main>
    </div>
  )
}
