import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { findRegisterDatapoint, parseLiveDatapoints } from '../engine/liveRegisters'
import { PANEL_ADDRESSES, UNIT_ADDRESSES, getNumericByAddress, hasAnyAddress } from '../engine/halfmannRegisters'

const API_BASE = import.meta.env.VITE_API_URL || ''
export const REFRESH_INTERVAL_S = 3
const CACHE_KEY = 'halfmann-live-cache-v1'

export const HALFMANN_DEVICES = {
  panel: '2507-501508',
  unit2130: '2507-500709',
  unit2127: '2504-504108',
  unit2128: '2507-500076',
  unit2129: '2504-504102',
  unit1396: '2507-501442',
}

export const HALFMANN_UNITS = [
  { key: 'unit2130', label: 'Unit 2130', deviceId: HALFMANN_DEVICES.unit2130, standby: false, type: 'asc' },
  { key: 'unit2127', label: 'Unit 2127', deviceId: HALFMANN_DEVICES.unit2127, standby: false, type: 'asc' },
  { key: 'unit2128', label: 'Unit 2128', deviceId: HALFMANN_DEVICES.unit2128, standby: false, type: 'asc' },
  { key: 'unit2129', label: 'Unit 2129', deviceId: HALFMANN_DEVICES.unit2129, standby: false, type: 'asc' },
  { key: 'unit1396', label: 'Unit 1396 (Standby)', deviceId: HALFMANN_DEVICES.unit1396, standby: true, type: 'c4' },
]

const LIVE_WELL_FLOW_KEYS = [
  ['Well 1 Injection Gas Flow Rate', 'Well #1 Flow Rate'],
  ['Well 2 Injection Gas Flow Rate', 'Well #2 Flow Rate'],
  ['Well 3 Injection Gas Flow Rate', 'Well #3 Flow Rate'],
  ['Well 4 Injection Gas Flow Rate', 'Well #4 Flow Rate'],
  ['Well 5 Injection Gas Flow Rate', 'Well # 5 Flow Rate', 'Well #5 Flow Rate'],
]

export const DEFAULT_SETTINGS = {
  wellTargetPct: 5,
  recycleOpenPct: 5,
  recycleAlertThreshold: 0,
  meetingFlowPersistSeconds: 120,
}

const HalfmannDataContext = createContext(null)

function loadCachedState() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      panelData: parsed?.panelData ?? null,
      unitDataRaw: parsed?.unitDataRaw ?? {},
      lastRefresh: parsed?.lastRefresh ? new Date(parsed.lastRefresh) : null,
    }
  } catch {
    return null
  }
}

function saveCachedState(panelData, unitDataRaw, lastRefresh) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({
      panelData,
      unitDataRaw,
      lastRefresh: lastRefresh?.toISOString?.() ?? null,
    }))
  } catch {}
}

async function readErrorPayload(res) {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => ({}))
    return body?.details || body?.error || res.statusText
  }
  return (await res.text().catch(() => '')).trim() || res.statusText
}

async function fetchDevice(deviceId) {
  try {
    const res = await fetch(`${API_BASE}/api/mlink/device?deviceId=${encodeURIComponent(deviceId)}`)
    if (!res.ok) return { data: null, error: `device ${deviceId}: ${await readErrorPayload(res)}` }
    return { data: await res.json(), error: '' }
  } catch (err) {
    return { data: null, error: `device ${deviceId}: ${err.message}` }
  }
}

async function fetchDeviceFull(deviceId) {
  try {
    const res = await fetch(`${API_BASE}/api/mlink/device/full?deviceId=${encodeURIComponent(deviceId)}`)
    if (!res.ok) return fetchDevice(deviceId)
    return { data: await res.json(), error: '' }
  } catch {
    return fetchDevice(deviceId)
  }
}

function parseNumeric(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function datapointIdentity(dp) {
  return dp?.alias || dp?.desc || dp?.dataSourceName || dp?.Name || dp?.name || null
}

function datapointAddress(dp) {
  return String(dp?.addressStr || dp?.address || '').trim().toLowerCase()
}

function mergeSnapshotData(previousData, nextData) {
  if (!nextData) return previousData ?? null
  if (!previousData?.datapoints?.length || !nextData?.datapoints?.length) {
    return {
      ...nextData,
      _currentDatapointAddresses: [...new Set(
        (nextData?.datapoints || [])
          .map(datapointAddress)
          .filter(Boolean),
      )],
    }
  }

  const mergedByKey = new Map()
  for (const dp of previousData.datapoints || []) {
    const key = datapointIdentity(dp)
    if (!key) continue
    mergedByKey.set(key, dp)
  }
  for (const dp of nextData.datapoints || []) {
    const key = datapointIdentity(dp)
    if (!key) continue
    mergedByKey.set(key, dp)
  }

  const currentAddresses = [...new Set(
    (nextData.datapoints || [])
      .map(datapointAddress)
      .filter(Boolean),
  )]

  return {
    ...previousData,
    ...nextData,
    datapoints: [...mergedByKey.values()],
    _registerCount: mergedByKey.size,
    _heldSupplementCount: Math.max(0, mergedByKey.size - (nextData?.datapoints?.length || 0)),
    _currentDatapointAddresses: currentAddresses,
  }
}

function hasAnyDatapoint(dataMap, labelSets) {
  return labelSets.some((labels) => resolveDatapoint(dataMap, labels))
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

function getWellTarget(data, dataMap, wellNumber) {
  return getNumericByAddress(data, [PANEL_ADDRESSES.wellSetpoint[wellNumber - 1]]) ?? getNumeric(dataMap, [
    `Wellhead #${wellNumber} Setpoint From Customer PLC`,
    `Well ${wellNumber} Setpoint From Customer PLC`,
    `Well ${wellNumber} Setpoint`,
  ]) ?? null
}

function getUnitDesiredFlow(panelData, panelMap, unitData, unitMap, unitKey, unitLabel) {
  const compNum = { unit2128: 1, unit2130: 2, unit2127: 3, unit2129: 4 }[unitKey]
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

function isWellMeetingTarget(actual, desired, tolerancePct) {
  if (actual == null || desired == null || desired <= 0) return null
  return actual >= desired * (1 - (tolerancePct / 100))
}

function deriveMissingCompressorFlowValues(unitFlows, totalActualFlow) {
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

function isUsableDeviceSnapshot(deviceKey, data) {
  if (!data) return false
  const count = data?._registerCount ?? data?.datapoints?.length ?? 0
  if (!count) return false

  if (deviceKey === 'panel') {
    return hasAnyAddress(data, PANEL_ADDRESSES.wellFlow)
  }

  const dataMap = parseLiveDatapoints(data)
  if (hasAnyAddress(data, [...UNIT_ADDRESSES.engineSpeed, ...UNIT_ADDRESSES.actualFlow, ...UNIT_ADDRESSES.suctionPressure, ...UNIT_ADDRESSES.dischargePressure])) {
    return true
  }
  return hasAnyDatapoint(dataMap, [
    ['RPM', 'Driver Speed', 'ENGINE RPM', 'Engine Speed', 'Engine Speed From EICS'],
    ['Flow Rate', 'Flow Rate PID PV', 'Flow Rate PV', 'Compressor Flow Rate PID PV'],
    ['Suction Pressure', 'Stage 1 Suction Prs', 'Suction Prs'],
    ['Discharge Pressure', 'Stage 3 Discharge Prs'],
    ['Compressor Oil Pressure'],
    ['Engine Oil Pressure'],
    ['System Voltage'],
  ])
}

function updateDebouncedEntry(entry, currentValue, nowMs, persistMs) {
  if (currentValue == null) {
    return { stableValue: null, pendingValue: null, pendingSince: null }
  }
  if (!entry) {
    return { stableValue: currentValue, pendingValue: null, pendingSince: null }
  }
  if (persistMs <= 0) {
    return { stableValue: currentValue, pendingValue: null, pendingSince: null }
  }
  if (currentValue === entry.stableValue) {
    return { stableValue: entry.stableValue, pendingValue: null, pendingSince: null }
  }
  if (entry.pendingValue === currentValue && entry.pendingSince != null && nowMs - entry.pendingSince >= persistMs) {
    return { stableValue: currentValue, pendingValue: null, pendingSince: null }
  }
  if (entry.pendingValue === currentValue) {
    return entry
  }
  return { ...entry, pendingValue: currentValue, pendingSince: nowMs }
}

export function HalfmannDataProvider({ children }) {
  const cachedState = useMemo(() => loadCachedState(), [])
  const [panelData, setPanelData] = useState(cachedState?.panelData ?? null)
  const [unitDataRaw, setUnitDataRaw] = useState(cachedState?.unitDataRaw ?? {})
  const [loading, setLoading] = useState(true)
  const [liveError, setLiveError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(cachedState?.lastRefresh ?? null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_S)
  const [siteSettings, setSiteSettings] = useState(DEFAULT_SETTINGS)
  const [padVisible, setPadVisible] = useState(true)
  const [meetingState, setMeetingState] = useState({ wells: {}, compressors: {}, updatedAt: null })
  const [commsStatus, setCommsStatus] = useState({
    isHolding: false,
    allHeld: false,
    heldDevices: [],
    limitedDevices: [],
    healthyDevices: [],
    lastAttemptAt: null,
    message: '',
  })
  const decisionRef = useRef({ wells: {}, compressors: {} })
  const panelRef = useRef(panelData)
  const unitDataRef = useRef(unitDataRaw)

  useEffect(() => { panelRef.current = panelData }, [panelData])
  useEffect(() => { unitDataRef.current = unitDataRaw }, [unitDataRaw])

  const reloadSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`, { credentials: 'include' })
      if (!res.ok) return
      const body = await res.json()
      setSiteSettings({ ...DEFAULT_SETTINGS, ...body })
    } catch {}
  }, [])

  const saveSettings = useCallback(async (updated) => {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updated),
    })
    if (!res.ok) return res
    const body = await res.json()
    setSiteSettings({ ...DEFAULT_SETTINGS, ...body })
    return res
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setLiveError('')
    const [panelResult, ...unitResults] = await Promise.all([
      fetchDeviceFull(HALFMANN_DEVICES.panel),
      ...HALFMANN_UNITS.map((unit) => fetchDeviceFull(unit.deviceId)),
    ])

    const heldDevices = []
    const limitedDevices = []
    const healthyDevices = []
    const panelUsable = isUsableDeviceSnapshot('panel', panelResult.data)
    const previousPanel = panelRef.current
    const panelCount = panelResult.data?._registerCount ?? panelResult.data?.datapoints?.length ?? 0
    const panelHardFailure = !!panelResult.error || panelCount === 0
    const nextPanel = panelUsable
      ? mergeSnapshotData(previousPanel, panelResult.data)
      : (panelResult.data ? mergeSnapshotData(previousPanel, panelResult.data) : previousPanel)
    if (panelUsable) healthyDevices.push('Panel')
    else if (panelHardFailure && previousPanel) heldDevices.push('Panel')
    else if (!panelUsable && panelCount > 0) limitedDevices.push('Panel')

    const previousUnits = unitDataRef.current || {}
    const nextUnits = { ...previousUnits }
    HALFMANN_UNITS.forEach((unit, index) => {
      const unitCount = unitResults[index].data?._registerCount ?? unitResults[index].data?.datapoints?.length ?? 0
      const unitHardFailure = !!unitResults[index].error || unitCount === 0
      const usable = isUsableDeviceSnapshot(unit.key, unitResults[index].data)
      if (usable) {
        nextUnits[unit.key] = mergeSnapshotData(previousUnits[unit.key], unitResults[index].data)
        healthyDevices.push(unit.label)
      } else if (unitHardFailure && previousUnits[unit.key]) {
        heldDevices.push(unit.label)
      } else if (!usable && unitCount > 0) {
        nextUnits[unit.key] = mergeSnapshotData(previousUnits[unit.key], unitResults[index].data)
        limitedDevices.push(unit.label)
      } else {
        nextUnits[unit.key] = unitResults[index].data
      }
    })

    setPanelData(nextPanel)
    setUnitDataRaw(nextUnits)

    const acceptedAny = panelUsable || unitResults.some((result, index) => isUsableDeviceSnapshot(HALFMANN_UNITS[index].key, result.data))
    if (acceptedAny) {
      const acceptedAt = new Date()
      setLastRefresh(acceptedAt)
      saveCachedState(nextPanel, nextUnits, acceptedAt)
    }

    const errors = [panelResult.error, ...unitResults.map((result) => result.error)].filter(Boolean)
    const allHeld = heldDevices.length === HALFMANN_UNITS.length + (previousPanel ? 1 : 0) && heldDevices.length > 0
    const hasCachedData = !!nextPanel || Object.values(nextUnits).some(Boolean)
    let message = ''
    if (heldDevices.length > 0) {
      message = `Last refresh returned invalid data for ${heldDevices.join(', ')}. Showing last known good readings until the next successful refresh.`
    } else if (limitedDevices.length > 0) {
      message = `Latest refresh succeeded, but ${limitedDevices.join(', ')} returned a limited tag set. Preserving previously seen values where newer tags were missing.`
    }

    setCommsStatus({
      isHolding: heldDevices.length > 0,
      allHeld,
      heldDevices,
      limitedDevices,
      healthyDevices,
      lastAttemptAt: new Date(),
      message,
    })

    if (heldDevices.length > 0 && hasCachedData) {
      setLiveError('')
    } else if (!acceptedAny) {
      setLiveError(errors.length ? `No live MLINK data available. ${errors.join(' | ')}` : 'No live MLINK data available.')
    } else {
      setLiveError('')
    }

    setLoading(false)
    setCountdown(REFRESH_INTERVAL_S)
  }, [])

  useEffect(() => {
    fetch(`${API_BASE}/api/public/pad-visibility`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (body && body.halfmann === false) setPadVisible(false) })
      .catch(() => {})
    reloadSettings()
  }, [reloadSettings])

  useEffect(() => {
    function handleSettingsUpdated(event) {
      const next = event?.detail
      if (!next) return
      setSiteSettings((current) => ({ ...current, ...next }))
    }

    window.addEventListener('derived-trigger-settings-updated', handleSettingsUpdated)
    return () => window.removeEventListener('derived-trigger-settings-updated', handleSettingsUpdated)
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

  useEffect(() => {
    const panel = parseLiveDatapoints(panelData)
    const unitMaps = HALFMANN_UNITS.map((unit) => parseLiveDatapoints(unitDataRaw[unit.key]))
    const totalActual = PANEL_ADDRESSES.wellFlow.reduce((sum, address, index) =>
      sum + (getNumericByAddress(panelData, [address]) ?? getNumeric(panel, LIVE_WELL_FLOW_KEYS[index]) ?? 0), 0)
    const persistMs = Math.max(0, Number(siteSettings.meetingFlowPersistSeconds) || 0) * 1000
    const nowMs = Date.now()

    const rawWellStates = {}
    for (let index = 0; index < LIVE_WELL_FLOW_KEYS.length; index += 1) {
      const wellNumber = index + 1
      const actual = getNumericByAddress(panelData, [PANEL_ADDRESSES.wellFlow[index]]) ?? getNumeric(panel, LIVE_WELL_FLOW_KEYS[index])
      const desired = getWellTarget(panelData, panel, wellNumber)
      rawWellStates[wellNumber] = isWellMeetingTarget(actual, desired, Number(siteSettings.wellTargetPct) || 5)
    }

    const rawUnitDesired = HALFMANN_UNITS.map((unit, index) =>
      getUnitDesiredFlow(panelData, panel, unitDataRaw[unit.key], unitMaps[index], unit.key, unit.label))
    const rawUnitActual = deriveMissingCompressorFlowValues(
      HALFMANN_UNITS.map((unit, index) => getUnitActualFlow(unitDataRaw[unit.key], unitMaps[index])),
      totalActual,
    )
    const rawCompressorStates = {}
    HALFMANN_UNITS.forEach((unit, index) => {
      if (unit.standby) return
      const actual = rawUnitActual[index]
      const desired = rawUnitDesired[index]
      rawCompressorStates[unit.key] = actual != null && desired != null && desired > 0
        ? Math.abs(actual - desired) <= desired * 0.05
        : null
    })

    const nextWellStates = {}
    for (const [key, value] of Object.entries(rawWellStates)) {
      const next = updateDebouncedEntry(decisionRef.current.wells[key], value, nowMs, persistMs)
      decisionRef.current.wells[key] = next
      nextWellStates[key] = next.stableValue
    }

    const nextCompressorStates = {}
    for (const [key, value] of Object.entries(rawCompressorStates)) {
      const next = updateDebouncedEntry(decisionRef.current.compressors[key], value, nowMs, persistMs)
      decisionRef.current.compressors[key] = next
      nextCompressorStates[key] = next.stableValue
    }

    setMeetingState({ wells: nextWellStates, compressors: nextCompressorStates, updatedAt: nowMs })
  }, [panelData, unitDataRaw, siteSettings])

  const value = useMemo(() => ({
    API_BASE,
    panelData,
    unitDataRaw,
    loading,
    liveError,
    lastRefresh,
    countdown,
    siteSettings,
    padVisible,
    meetingState,
    commsStatus,
    refresh,
    reloadSettings,
    saveSettings,
  }), [panelData, unitDataRaw, loading, liveError, lastRefresh, countdown, siteSettings, padVisible, meetingState, commsStatus, refresh, reloadSettings, saveSettings])

  return (
    <HalfmannDataContext.Provider value={value}>
      {children}
    </HalfmannDataContext.Provider>
  )
}

export function useHalfmannData() {
  const context = useContext(HalfmannDataContext)
  if (!context) throw new Error('useHalfmannData must be used inside HalfmannDataProvider')
  return context
}
